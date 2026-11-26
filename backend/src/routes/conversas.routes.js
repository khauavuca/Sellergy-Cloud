// Caixa de entrada do WhatsApp (tela /app/whatsapp). Lê as conversas gravadas
// por conversas/servico.js e deixa a equipe responder pelo número conectado.
//
//   GET  /conversas/canal                 número conectado? + não lidas (menu)
//   GET  /conversas/atalhos               quais atalhos de resposta existem
//   GET  /conversas/atalhos/horarios      texto com horários livres de um dia (?dia&variacaoId&especialistaId)
//   GET  /conversas/atalhos/dias          próximos 14 dias livre/poucos/lotado/fechado (?variacaoId&especialistaId)
//   GET  /conversas                       lista (busca, filtro, cursor)
//   GET  /conversas/:id                   conversa + ficha do cliente (lead)
//   GET  /conversas/:id/mensagens         mensagens (paginado, mais novas por último)
//   POST /conversas/:id/lida              zera as não lidas
//   POST /conversas/:id/mensagens         equipe responde (pausa o bot)
//   POST /conversas/:id/pausar            { horas | null } bot quieto nesta conversa
//   POST /conversas/:id/retomar           devolve ao bot
//
// Sempre preso ao negócio do usuário (clienteId do banco): id de outro negócio
// = 404. Gating: módulo CRM; ler = CRM visualizar, responder/pausar = CRM editar.
// Envio: respeita WHATSAPP_ENVIO_REAL / BAILEYS_ENVIO_REAL — com a trava
// desligada a resposta só é gravada (status SIMULADA) e logada.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerModuloLiberado, requerPermissao, ehAdmin } = require('../middlewares/permissoes.middleware');
const regras = require('../conversas/regras');
const conversas = require('../conversas/servico');
const { temRecurso } = require('../planos/recursos');
const multer = require('multer');
const midia = require('../conversas/midia');
const { resumoDosDias } = require('../services/agendaSlots');

// Arquivo da tela (foto, video, audio gravado, documento, figurinha).
// Em memoria: o maior permitido (documento) e 100 MB, mas a tela limita a 25 MB.
const TAM_MAX_ENVIO = 25 * 1024 * 1024;
const receberArquivo = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAM_MAX_ENVIO, files: 1 } }).single('arquivo');
function aceitarArquivo(req, res, next) {
  receberArquivo(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ erro: 'Arquivo grande demais (máximo 25 MB).' });
    return res.status(400).json({ erro: 'Não foi possível receber o arquivo.' });
  });
}
// Executavel e script nao viram anexo (nem pro cliente, nem pra equipe).
const EXT_BLOQUEADA = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|js|jar|sh|apk|dll|html?|svg)$/i;


const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use((req, res, next) => {
  if (ehAdmin(req.usuario) || !req.usuario?.clienteId) return res.status(403).json({ erro: 'Disponível só para a conta do negócio.' });
  return next();
});
roteador.use(requerModuloLiberado('CRM'));

const ver = requerPermissao('CRM', 'visualizar');
const responder = requerPermissao('CRM', 'editar');

const CAMPOS_BOT_CANAL = {
  id: true, provedorCanal: true, identificadorCanal: true, credencialCanalId: true, verifyTokenCanal: true,
  statusConexaoBaileys: true, baileysNumeroConectado: true, telefone: true,
};

async function canalDoNegocio(clienteId) {
  const bots = await prisma.bot.findMany({ where: { clienteId }, select: CAMPOS_BOT_CANAL, orderBy: { criadoEm: 'asc' } });
  return regras.canalConectado(bots);
}

async function conversaDoNegocio(req) {
  const id = String(req.params.id || '');
  if (!id || id.length > 64) return null;
  return prisma.conversa.findFirst({ where: { id, clienteId: req.usuario.clienteId } });
}

const naoEncontrada = (res) => res.status(404).json({ erro: 'Conversa não encontrada.' });

function erro500(res, rotulo, e) {
  console.error(`[conversas ${rotulo}]`, e?.message || e);
  return res.status(500).json({ erro: 'Não foi possível carregar agora. Tente de novo.' });
}

/** Nome mostrado: lead do CRM > nome do perfil do WhatsApp > telefone. */
async function comNomes(lista) {
  const ids = [...new Set(lista.map((c) => c.leadId).filter(Boolean))];
  const leads = ids.length
    ? await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })
    : [];
  const nomes = new Map(leads.map((l) => [l.id, l.nome]));
  return lista.map((c) => ({ ...conversas.resumoConversa(c), nome: nomes.get(c.leadId) || c.nomeContato || null, telefoneEnvio: c.telefoneEnvio }));
}

// ---------- canal e atalhos ----------

roteador.get('/canal', ver, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const [canal, soma] = await Promise.all([
      canalDoNegocio(clienteId),
      prisma.conversa.aggregate({ where: { clienteId }, _sum: { naoLidas: true } }),
    ]);
    res.json({
      conectado: canal.conectado,
      provedor: canal.provedor,
      numero: canal.numero,
      envioReal: canal.conectado ? regras.envioRealLigado(canal.provedor) : false,
      naoLidas: soma._sum.naoLidas || 0,
    });
  } catch (e) {
    erro500(res, 'canal', e);
  }
});

roteador.get('/atalhos', ver, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const cliente = await prisma.cliente.findUnique({
      where: { id: clienteId },
      select: {
        slugPublico: true, modulosLiberados: true, plano: true, statusAssinatura: true, trialAte: true,
        configuracaoCatalogo: { select: { online: true, aceitaRetirada: true, aceitaEntrega: true } },
      },
    });
    const agenda = cliente?.modulosLiberados?.AGENDA === true;
    const base = (process.env.APP_URL_PUBLICA || process.env.VITE_URL_PUBLICA || '').replace(/\/$/, '');
    const link = agenda && cliente?.slugPublico && base && temRecurso(cliente, 'linkAgendamento')
      ? `${base}/agendar/${cliente.slugPublico}` : null;

    // Pix: dono/administrador, módulo PAGAMENTOS e provedor configurado (mesma
    // regra da rota /pagamentos/cobrancas, que é quem gera o Pix).
    let pix = false;
    if (['CLIENT', 'ADMINISTRADOR'].includes(req.usuario.perfil) && cliente?.modulosLiberados?.PAGAMENTOS === true) {
      const cfg = await prisma.configuracaoPagamento.findUnique({ where: { clienteId }, select: { ativo: true } });
      pix = Boolean(cfg?.ativo);
    }
    // Catálogo online (mesma regra da rota pública /publico/loja/:slug).
    const cat = cliente?.configuracaoCatalogo;
    const linkLoja = cliente?.slugPublico && base && cliente?.modulosLiberados?.VENDAS === true && temRecurso(cliente, 'catalogoOnline')
      && cat?.online && (cat.aceitaRetirada || cat.aceitaEntrega)
      ? `${base}/loja/${cliente.slugPublico}` : null;

    // Serviços e profissionais pro modal de horários (opcional: sem escolha = qualquer).
    let servicos = [];
    let profissionais = [];
    if (agenda) {
      const [prods, esps] = await Promise.all([
        prisma.produto.findMany({
          where: { clienteId, tipo: 'SERVICO', visibilidade: 'ATIVO' },
          select: { nome: true, variacoes: { select: { id: true, nome: true, duracaoMin: true }, orderBy: { preco: 'asc' } } },
          orderBy: { nome: 'asc' }, take: 50,
        }),
        prisma.especialista.findMany({ where: { clienteId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' }, take: 30 }),
      ]);
      servicos = prods.flatMap((pr) => pr.variacoes.map((v) => ({
        variacaoId: v.id, nome: v.nome && v.nome !== pr.nome ? `${pr.nome} — ${v.nome}` : pr.nome, duracaoMin: v.duracaoMin || null,
      })));
      profissionais = esps.map((e) => ({ id: e.id, nome: e.nome }));
    }
    res.json({ linkAgendamento: link, linkLoja, horarios: agenda, pix, servicos, profissionais });
  } catch (e) {
    erro500(res, 'atalhos', e);
  }
});

roteador.get('/atalhos/horarios', ver, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const dia = String(req.query.dia || '');
    const rotulo = regras.rotuloDia(dia);
    if (!rotulo) return res.status(422).json({ erro: 'Escolha um dia válido.', campos: ['dia'] });
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const data = new Date(`${dia}T12:00:00`);
    if (data < hoje || data.getTime() - hoje.getTime() > 60 * 86400000) {
      return res.status(422).json({ erro: 'Escolha um dia entre hoje e os próximos 60 dias.', campos: ['dia'] });
    }
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { modulosLiberados: true } });
    if (cliente?.modulosLiberados?.AGENDA !== true) return res.status(403).json({ erro: 'A agenda não está liberada para este negócio.' });

    const alvo = await alvoDosHorarios(clienteId, req.query);
    if (alvo.erro) return res.status(422).json({ erro: alvo.erro });
    const [resumo] = await resumoDosDias({ clienteId, especialistaIds: alvo.profissionais.map((p) => p.id), dias: [data], duracao: alvo.duracao });
    const porProfissional = alvo.profissionais.map((p) => ({
      nome: String(p.nome || '').trim().split(/\s+/)[0] || 'Equipe',
      horarios: (resumo?.horarios || []).filter((h) => h.especialistaId === p.id).slice(0, 6)
        .map((h) => { const d = new Date(h.inicio); return regras.horaDeMinutos(d.getHours() * 60 + d.getMinutes()); }),
    }));
    res.json({
      rotulo,
      status: resumo?.status || 'fechado',
      profissionais: porProfissional,
      texto: regras.textoHorarios(alvo.servicoNome ? `${rotulo} para ${alvo.servicoNome.toLowerCase()}` : rotulo, porProfissional),
    });
  } catch (e) {
    erro500(res, 'horarios', e);
  }
});

/**
 * Profissionais e duração pros atalhos de horário. Sem serviço: duração padrão
 * e todos os profissionais. Com serviço: quem faz o serviço (nenhum marcado = todos).
 */
async function alvoDosHorarios(clienteId, { variacaoId, especialistaId } = {}) {
  let duracao = 30;
  let servicoNome = null;
  let ids = null;
  if (typeof variacaoId === 'string' && variacaoId) {
    const v = await prisma.variacaoProduto.findFirst({
      where: { id: variacaoId, produto: { clienteId, tipo: 'SERVICO' } },
      select: { duracaoMin: true, nome: true, produtoId: true, produto: { select: { nome: true } } },
    });
    if (!v) return { erro: 'Serviço não encontrado.' };
    duracao = v.duracaoMin || 30;
    servicoNome = v.produto.nome;
    const vinc = await prisma.especialistaServico.findMany({ where: { produtoId: v.produtoId }, select: { especialistaId: true } });
    if (vinc.length) ids = vinc.map((x) => x.especialistaId);
  }
  const where = { clienteId, ativo: true };
  if (typeof especialistaId === 'string' && especialistaId && especialistaId !== 'qualquer') where.id = especialistaId;
  else if (ids) where.id = { in: ids };
  const profissionais = await prisma.especialista.findMany({ where, select: { id: true, nome: true }, orderBy: { nome: 'asc' }, take: 8 });
  if (!profissionais.length) return { erro: 'Nenhum profissional ativo para esse serviço.' };
  return { profissionais, duracao, servicoNome };
}

roteador.get('/atalhos/dias', ver, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const alvo = await alvoDosHorarios(clienteId, req.query);
    if (alvo.erro) return res.status(422).json({ erro: alvo.erro });
    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    const dias = Array.from({ length: 14 }, (_, i) => new Date(hoje.getTime() + i * 86400000));
    const resumo = await resumoDosDias({ clienteId, especialistaIds: alvo.profissionais.map((p) => p.id), dias, duracao: alvo.duracao });
    res.json({ dias: resumo.map((d) => ({ dia: d.dia, status: d.status, livres: d.livres })) });
  } catch (e) {
    erro500(res, 'dias', e);
  }
});

// ---------- lista ----------

roteador.get('/', ver, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const filtro = regras.FILTROS.includes(req.query.filtro) ? req.query.filtro : 'todas';
    const limite = regras.lerTamanhoPagina(req.query.limite);
    const antes = regras.lerCursorData(req.query.antes);
    const agora = new Date();
    const where = regras.filtroLista({ clienteId, busca: req.query.busca, filtro, agora });
    if (antes) where.ultimaMensagemEm = { lt: antes };

    const contar = (f) => prisma.conversa.count({ where: regras.filtroLista({ clienteId, busca: req.query.busca, filtro: f, agora }) });
    const [lista, ...totais] = await Promise.all([
      prisma.conversa.findMany({ where, orderBy: { ultimaMensagemEm: 'desc' }, take: limite + 1 }),
      ...regras.FILTROS.map(contar),
    ]);
    const temMais = lista.length > limite;
    const pagina = lista.slice(0, limite);
    res.json({
      conversas: await comNomes(pagina),
      proximo: temMais ? pagina[pagina.length - 1].ultimaMensagemEm : null,
      contagens: Object.fromEntries(regras.FILTROS.map((f, i) => [f, totais[i]])),
    });
  } catch (e) {
    erro500(res, 'lista', e);
  }
});

// ---------- uma conversa ----------

async function fichaDoLead(clienteId, leadId) {
  if (!leadId) return null;
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, clienteId },
    select: {
      id: true, nome: true, telefone: true, email: true, valor: true, observacoes: true, tags: true,
      dataNascimento: true, origem: true, criadoEm: true, etapa: { select: { nome: true, cor: true } },
    },
  });
  if (!lead) return null;
  const agora = new Date();
  const [vendas, ultimaVenda, proximo] = await Promise.all([
    prisma.venda.aggregate({ where: { clienteId, leadId, status: 'COMPLETED' }, _count: true, _sum: { valor: true } }),
    prisma.venda.findFirst({ where: { clienteId, leadId, status: 'COMPLETED' }, orderBy: { data: 'desc' }, select: { data: true, valor: true, metodoPagamento: true } }),
    prisma.agendamento.findFirst({
      where: { clienteId, leadId, data: { gte: agora }, status: { in: ['PENDING', 'CONFIRMED'] } },
      orderBy: { data: 'asc' },
      select: { id: true, data: true, servico: true, status: true, especialista: { select: { nome: true } } },
    }),
  ]);
  return {
    ...lead,
    compras: vendas._count || 0,
    totalGasto: vendas._sum.valor || 0,
    ultimaCompra: ultimaVenda,
    proximoHorario: proximo,
  };
}

roteador.get('/:id', ver, async (req, res) => {
  try {
    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);
    const [[resumo], ficha, canal] = await Promise.all([
      comNomes([conversa]),
      fichaDoLead(req.usuario.clienteId, conversa.leadId),
      canalDoNegocio(req.usuario.clienteId),
    ]);
    const hojeIni = new Date(); hojeIni.setHours(0, 0, 0, 0);
    const autoHoje = await prisma.mensagemConversa.count({ where: { conversaId: conversa.id, origem: 'BOT', criadoEm: { gte: hojeIni } } });
    res.json({
      conversa: {
        ...resumo,
        janelaAte: regras.janelaAte({ canal: canal.provedor || conversa.canal, ultimaEntradaEm: conversa.ultimaEntradaEm }),
      },
      ficha,
      canal: { conectado: canal.conectado, provedor: canal.provedor, envioReal: canal.conectado ? regras.envioRealLigado(canal.provedor) : false },
      respostasDoBotHoje: autoHoje,
    });
  } catch (e) {
    erro500(res, 'detalhe', e);
  }
});

roteador.get('/:id/mensagens', ver, async (req, res) => {
  try {
    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);
    const limite = regras.lerTamanhoPagina(req.query.limite);
    const antes = regras.lerCursorData(req.query.antes);
    const lista = await prisma.mensagemConversa.findMany({
      where: { conversaId: conversa.id, clienteId: req.usuario.clienteId, ...(antes ? { criadoEm: { lt: antes } } : {}) },
      orderBy: { criadoEm: 'desc' },
      take: limite + 1,
      select: conversas.CAMPOS_MENSAGEM,
    });
    const temMais = lista.length > limite;
    const pagina = lista.slice(0, limite).reverse(); // mais antiga primeiro
    res.json({ mensagens: pagina, temMais, proximo: temMais ? pagina[0].criadoEm : null });
  } catch (e) {
    erro500(res, 'mensagens', e);
  }
});

roteador.post('/:id/lida', ver, async (req, res) => {
  try {
    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);
    if (conversa.naoLidas > 0) {
      const atualizada = await prisma.conversa.update({ where: { id: conversa.id }, data: { naoLidas: 0 } });
      await conversas.publicar(req.usuario.clienteId, 'conversa_atualizada', { conversa: conversas.resumoConversa(atualizada) });
    }
    res.json({ ok: true });
  } catch (e) {
    erro500(res, 'lida', e);
  }
});

// ---------- responder ----------

roteador.post('/:id/mensagens', responder, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const lido = regras.validarTexto(req.body?.texto);
    if (lido.erro) return res.status(422).json({ erro: lido.erro, campos: ['texto'] });

    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);

    const canal = await canalDoNegocio(clienteId);
    if (!canal.conectado) {
      return res.status(409).json({ erro: 'Conecte o WhatsApp em "Bots e conexão" para responder.', codigo: 'WHATSAPP_DESCONECTADO' });
    }
    if (!regras.dentroDaJanela({ canal: canal.provedor, ultimaEntradaEm: conversa.ultimaEntradaEm })) {
      return res.status(422).json({
        erro: 'No WhatsApp oficial só dá para responder até 24 horas depois da última mensagem do cliente. Depois disso, use um modelo aprovado (campanha).',
        codigo: 'FORA_DA_JANELA',
      });
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { nome: true } });
    const base = {
      clienteId, telefone: conversa.telefone, texto: lido.texto, direcao: 'SAIDA', origem: 'EQUIPE',
      botId: canal.botId, canal: canal.provedor, autorUsuarioId: req.usuario.id, autorNome: usuario?.nome || null,
      // Equipe assumiu: bot quieto por algumas horas (ou até retomar) e conversa lida.
      dadosConversa: { ...regras.pausaAoResponder(conversa), naoLidas: 0 },
    };

    let registro;
    if (!regras.envioRealLigado(canal.provedor)) {
      console.log(`[conversas:SIMULADO] ${canal.provedor} -> final ${conversa.telefoneEnvio.slice(-4)} (${lido.texto.length} caracteres)`);
      registro = await conversas.registrarMensagem({ ...base, status: 'SIMULADA' });
    } else if (canal.provedor === 'META_CLOUD') {
      const { canalWhatsappDoTenant } = require('../services/whatsappDoTenant');
      const c = await canalWhatsappDoTenant(clienteId);
      const envio = c.ok
        ? await c.adapter.enviarTexto({ para: conversa.telefoneEnvio, texto: lido.texto })
        : { ok: false, erro: 'Credencial do WhatsApp oficial indisponível.' };
      registro = await conversas.registrarMensagem({
        ...base, status: regras.statusDoEnvio(envio), erro: envio?.ok ? null : envio?.erro, idExterno: envio?.idMensagem,
      });
    } else {
      // QR Code: o socket vive no worker. Grava PENDENTE e o worker envia e
      // atualiza o status (services/mensagemTenant.js).
      registro = await conversas.registrarMensagem({ ...base, status: 'PENDENTE' });
      const { enfileirarMensagemTenant } = require('../filas');
      await enfileirarMensagemTenant({
        clienteId, para: conversa.telefoneEnvio, texto: lido.texto, tipo: 'conversa', mensagemConversaId: registro.mensagem.id,
      }).catch(async (e) => {
        console.error('[conversas] falha ao enfileirar', e?.message);
        await conversas.atualizarStatusMensagem(registro.mensagem.id, { status: 'FALHOU', erro: 'Fila indisponível.' }).catch(() => {});
        registro.mensagem.status = 'FALHOU';
      });
    }

    if (!registro) return res.status(422).json({ erro: 'Telefone da conversa inválido.' });
    const [resumo] = await comNomes([registro.conversa]);
    res.status(201).json({ mensagem: registro.mensagem, conversa: resumo });
  } catch (e) {
    erro500(res, 'responder', e);
  }
});

// ---------- midia, nota interna e reacao ----------

/** Abre (ou baixa) a midia de uma mensagem da conversa. */
roteador.get('/:id/midia/:mensagemId', ver, async (req, res) => {
  try {
    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);
    const mensagem = await prisma.mensagemConversa.findFirst({
      where: { id: String(req.params.mensagemId || ''), conversaId: conversa.id, clienteId: req.usuario.clienteId },
      select: { midiaChave: true, midiaMime: true, midiaNome: true },
    });
    return midia.enviarAoNavegador(res, mensagem, { baixarArquivo: req.query.baixar === '1' });
  } catch (e) {
    return erro500(res, 'midia', e);
  }
});

/** Equipe manda foto, video, GIF, audio, voz (gravada na tela), documento ou figurinha. */
roteador.post('/:id/midia', responder, aceitarArquivo, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!req.file) return res.status(422).json({ erro: 'Escolha um arquivo.', campos: ['arquivo'] });
    if (EXT_BLOQUEADA.test(req.file.originalname || '')) return res.status(415).json({ erro: 'Esse tipo de arquivo não pode ser enviado.' });
    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);
    const canal = await canalDoNegocio(clienteId);
    if (!canal.conectado) return res.status(409).json({ erro: 'Conecte o WhatsApp em "Bots e conexão" para responder.', codigo: 'WHATSAPP_DESCONECTADO' });
    if (!regras.dentroDaJanela({ canal: canal.provedor, ultimaEntradaEm: conversa.ultimaEntradaEm })) {
      return res.status(422).json({ erro: 'No WhatsApp oficial só dá para enviar até 24 horas depois da última mensagem do cliente.', codigo: 'FORA_DA_JANELA' });
    }
    const legenda = typeof req.body?.legenda === 'string' ? req.body.legenda.trim().slice(0, 1000) : '';
    const pedido = String(req.body?.tipo || '').toUpperCase();
    const tipo = midia.tipoPeloMime(req.file.mimetype, { voz: pedido === 'VOZ', gif: pedido === 'GIF', figurinha: pedido === 'FIGURINHA' });
    const segundos = Number.parseInt(req.body?.segundos, 10) || null;
    let buffer = req.file.buffer;
    let mime = req.file.mimetype;
    let nome = req.file.originalname;
    // Voz gravada na tela: converte pro OGG/Opus do WhatsApp (senao nao toca no celular).
    if (tipo === 'VOZ' && !/ogg/.test(midia.mimeBase(mime))) {
      try {
        buffer = await midia.converterParaVoz(buffer);
        mime = 'audio/ogg';
        nome = 'mensagem-de-voz.ogg';
      } catch (e) {
        console.error('[conversas] conversao de voz', e?.message);
        return res.status(422).json({ erro: 'Não foi possível preparar a mensagem de voz. Tente gravar de novo.' });
      }
    }
    const guardado = await midia.guardar({ clienteId, conversaId: conversa.id, buffer, mime, nome, tipo });
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { nome: true } });
    const real = regras.envioRealLigado(canal.provedor);
    const respondeAId = typeof req.body?.respondeAId === 'string' ? req.body.respondeAId.slice(0, 120) : null;
    const registro = await conversas.registrarMensagem({
      clienteId, telefone: conversa.telefone, texto: legenda, tipo, direcao: 'SAIDA', origem: 'EQUIPE',
      botId: canal.botId, canal: canal.provedor, autorUsuarioId: req.usuario.id, autorNome: usuario?.nome || null,
      status: real ? 'PENDENTE' : 'SIMULADA', midiaSegundos: segundos, respondeAId, ...guardado,
      dadosConversa: { ...regras.pausaAoResponder(conversa), naoLidas: 0 },
    });
    if (!registro) return res.status(422).json({ erro: 'Telefone da conversa inválido.' });
    if (real) {
      // Os dois canais saem pela fila (o socket do QR Code vive no worker).
      const { enfileirarMensagemTenant } = require('../filas');
      await enfileirarMensagemTenant({
        clienteId, para: conversa.telefoneEnvio, texto: legenda, tipo: 'conversa', mensagemConversaId: registro.mensagem.id,
        midia: { chave: guardado.midiaChave, mime: guardado.midiaMime, nome: guardado.midiaNome, tipo, segundos, respondeAId },
      }).catch(async (e) => {
        console.error('[conversas] falha ao enfileirar midia', e?.message);
        await conversas.atualizarStatusMensagem(registro.mensagem.id, { status: 'FALHOU', erro: 'Fila indisponível.' }).catch(() => {});
        registro.mensagem.status = 'FALHOU';
      });
    } else {
      console.log(`[conversas:SIMULADO] ${canal.provedor} ${tipo} -> final ${conversa.telefoneEnvio.slice(-4)}`);
    }
    const [resumo] = await comNomes([registro.conversa]);
    return res.status(201).json({ mensagem: registro.mensagem, conversa: resumo });
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ erro: e.message });
    return erro500(res, 'enviar midia', e);
  }
});

/** Nota interna: fica na conversa, so a equipe ve, nao vai pro WhatsApp. */
roteador.post('/:id/nota', responder, async (req, res) => {
  try {
    const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
    if (!texto) return res.status(422).json({ erro: 'Escreva a nota.', campos: ['texto'] });
    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { nome: true } });
    const registro = await conversas.registrarMensagem({
      clienteId: req.usuario.clienteId, telefone: conversa.telefone, texto: texto.slice(0, 4000), tipo: 'NOTA',
      direcao: 'SAIDA', origem: 'EQUIPE', autorUsuarioId: req.usuario.id, autorNome: usuario?.nome || null,
    });
    if (!registro) return res.status(422).json({ erro: 'Não foi possível salvar a nota.' });
    return res.status(201).json({ mensagem: registro.mensagem });
  } catch (e) {
    return erro500(res, 'nota', e);
  }
});

/** Reagir com emoji a uma mensagem (emoji vazio tira a reacao). */
roteador.post('/:id/reacao', responder, async (req, res) => {
  try {
    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);
    const alvo = await prisma.mensagemConversa.findFirst({
      where: { id: String(req.body?.mensagemId || ''), conversaId: conversa.id }, select: { id: true, idExterno: true, direcao: true },
    });
    if (!alvo?.idExterno) return res.status(422).json({ erro: 'Essa mensagem não pode receber reação.' });
    const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.slice(0, 8) : '';
    const canal = await canalDoNegocio(req.usuario.clienteId);
    if (!canal.conectado) return res.status(409).json({ erro: 'WhatsApp desconectado.', codigo: 'WHATSAPP_DESCONECTADO' });
    const registro = await conversas.registrarMensagem({
      clienteId: req.usuario.clienteId, telefone: conversa.telefone, texto: emoji, tipo: 'REACAO', direcao: 'SAIDA', origem: 'EQUIPE',
      canal: canal.provedor, botId: canal.botId, extra: { emoji, alvo: alvo.idExterno },
      status: regras.envioRealLigado(canal.provedor) ? 'PENDENTE' : 'SIMULADA',
    });
    if (regras.envioRealLigado(canal.provedor)) {
      const { enfileirarMensagemTenant } = require('../filas');
      await enfileirarMensagemTenant({
        clienteId: req.usuario.clienteId, para: conversa.telefoneEnvio, texto: emoji, tipo: 'conversa', mensagemConversaId: registro?.mensagem?.id,
        reacao: { alvoId: alvo.idExterno, emoji, deMim: alvo.direcao === 'SAIDA' },
      }).catch((e) => console.error('[conversas] reacao', e?.message));
    }
    return res.status(201).json({ mensagem: registro?.mensagem || null });
  } catch (e) {
    return erro500(res, 'reacao', e);
  }
});

// ---------- bot nesta conversa ----------

async function mudarPausa(req, res, dados) {
  const conversa = await conversaDoNegocio(req);
  if (!conversa) return naoEncontrada(res);
  const atualizada = await prisma.conversa.update({ where: { id: conversa.id }, data: dados });
  const [resumo] = await comNomes([atualizada]);
  await conversas.publicar(req.usuario.clienteId, 'conversa_atualizada', { conversa: conversas.resumoConversa(atualizada) });
  return res.json({ conversa: resumo });
}

roteador.post('/:id/pausar', responder, async (req, res) => {
  try {
    const pausa = regras.lerPausa(req.body?.horas);
    if (pausa.erro) return res.status(422).json({ erro: pausa.erro, campos: ['horas'] });
    return await mudarPausa(req, res, pausa);
  } catch (e) {
    return erro500(res, 'pausar', e);
  }
});

roteador.post('/:id/retomar', responder, async (req, res) => {
  try {
    return await mudarPausa(req, res, { botPausado: false, botPausadoAte: null });
  } catch (e) {
    return erro500(res, 'retomar', e);
  }
});

module.exports = roteador;
