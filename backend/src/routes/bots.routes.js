const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  ehAdmin,
  requerAdmin,
  requerModuloLiberado,
  requerPermissao,
} = require('../middlewares/permissoes.middleware');
const { MODELOS_VALIDOS } = require('../adapters/ia/deepseek');
const { REGISTRO: FERRAMENTAS_VALIDAS } = require('../services/iaFerramentas');
const { periodoAtual } = require('../services/iaRouter');
const { avaliarCota, consumoDoClienteNoMes, situacaoTetoGlobal } = require('../services/iaLimites');
const { emitirEventoBot } = require('../services/eventosBot');
const { enfileirarComandoBaileys } = require('../filas');
const { cifrarPayload } = require('../cripto/cofreCredenciais');
const { carregarCredencialDecifrada } = require('../credenciais');
const { validarDadosOficiais, gerarVerifyToken, conferirNaMeta } = require('../services/whatsappOficialConexao');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerModuloLiberado('BOTS'));

// Pós-pivô ERP-first: o Bot deixou de ter agente de IA, fluxo e tools. Sobrou a
// "casca de conexão" do WhatsApp (canal + credencial + verify token). O
// agendamento/atendimento/campanha automatizados (sem IA) serão remontados nas
// fases seguintes. Ver erp-pivo.md §5/§7 e erp-arquitetura-e-operacao.md §6.
//
// A IA voltou (DeepSeek, opcional por bot) — ver iaAtiva/iaModelo/etc abaixo e
// services/iaRouter.js.
const camposBotPublicos = {
  id: true,
  clienteId: true,
  nome: true,
  canal: true,
  status: true,
  telefone: true,
  totalMensagens: true,
  mensagensHoje: true,
  ultimaAtividadeEm: true,
  credencialCanalId: true,
  identificadorCanal: true,
  verifyTokenCanal: true,
  webhookConfirmadoEm: true,
  oficialNumeroExibicao: true,
  provedorCanal: true,
  statusConexaoBaileys: true,
  qrCodeAtual: true,
  baileysNumeroConectado: true,
  baileysAtualizadoEm: true,
  iaAtiva: true,
  iaModelo: true,
  iaPromptSistema: true,
  iaTokensIncluidosMes: true,
  iaPrecoPorMilTokensExcedenteCentavos: true,
  iaExcedenteAutorizadoTokens: true,
  acoesPermitidas: true,
  criadoEm: true,
  atualizadoEm: true,
};

const TAM_MAX_PROMPT_IA = 4000;

// Campos de IA que so o admin da plataforma pode mudar (ver PUT /:id).
const CAMPOS_IA_SO_ADMIN = [
  'iaAtiva',
  'iaModelo',
  'iaTokensIncluidosMes',
  'iaPrecoPorMilTokensExcedenteCentavos',
  'iaExcedenteAutorizadoTokens',
];

// Valida os campos de IA vindos do body. Retorna { data } com so o que veio
// definido, ou { erro }.
function validarCamposIA(body) {
  const {
    iaAtiva, iaModelo, iaPromptSistema, iaTokensIncluidosMes, iaPrecoPorMilTokensExcedenteCentavos,
    iaExcedenteAutorizadoTokens, acoesPermitidas,
  } = body;
  const data = {};

  if (iaAtiva !== undefined) {
    if (typeof iaAtiva !== 'boolean') return { erro: 'iaAtiva deve ser true ou false.' };
    data.iaAtiva = iaAtiva;
  }
  if (iaModelo !== undefined) {
    if (!MODELOS_VALIDOS.has(iaModelo)) {
      return { erro: `iaModelo invalido. Valores: ${[...MODELOS_VALIDOS].join(', ')}.` };
    }
    data.iaModelo = iaModelo;
  }
  if (iaPromptSistema !== undefined) {
    if (iaPromptSistema !== null && typeof iaPromptSistema !== 'string') {
      return { erro: 'iaPromptSistema deve ser texto ou null.' };
    }
    if (typeof iaPromptSistema === 'string' && iaPromptSistema.length > TAM_MAX_PROMPT_IA) {
      return { erro: `iaPromptSistema excede ${TAM_MAX_PROMPT_IA} caracteres.` };
    }
    data.iaPromptSistema = iaPromptSistema ? iaPromptSistema.trim() : null;
  }
  if (iaTokensIncluidosMes !== undefined) {
    const n = Number(iaTokensIncluidosMes);
    if (!Number.isInteger(n) || n < 0) return { erro: 'iaTokensIncluidosMes deve ser inteiro >= 0.' };
    data.iaTokensIncluidosMes = n;
  }
  if (iaPrecoPorMilTokensExcedenteCentavos !== undefined) {
    // Centavos por mil tokens, com fracao (R$ 15/milhao = 1,5).
    const n = Number(iaPrecoPorMilTokensExcedenteCentavos);
    if (!Number.isFinite(n) || n < 0) return { erro: 'iaPrecoPorMilTokensExcedenteCentavos deve ser numero >= 0.' };
    data.iaPrecoPorMilTokensExcedenteCentavos = Math.round(n * 10000) / 10000;
  }
  if (iaExcedenteAutorizadoTokens !== undefined) {
    const n = Number(iaExcedenteAutorizadoTokens);
    if (!Number.isInteger(n) || n < 0) return { erro: 'iaExcedenteAutorizadoTokens deve ser inteiro >= 0.' };
    data.iaExcedenteAutorizadoTokens = n;
  }
  if (acoesPermitidas !== undefined) {
    if (!Array.isArray(acoesPermitidas) || !acoesPermitidas.every((a) => typeof a === 'string')) {
      return { erro: 'acoesPermitidas deve ser uma lista de textos.' };
    }
    const invalidas = acoesPermitidas.filter((a) => !FERRAMENTAS_VALIDAS[a]);
    if (invalidas.length > 0) {
      return { erro: `Acao invalida: ${invalidas.join(', ')}. Valores: ${Object.keys(FERRAMENTAS_VALIDAS).join(', ')}.` };
    }
    data.acoesPermitidas = [...new Set(acoesPermitidas)];
  }
  return { data };
}

function filtroTenant(req) {
  // ADMIN do sistema vê tudo. Demais perfis ficam restritos ao seu clienteId.
  if (ehAdmin(req.usuario)) return {};
  return { clienteId: req.usuario.clienteId };
}

roteador.get('/', requerPermissao('BOTS', 'visualizar'), async (req, res) => {
  try {
    // Admin pode pedir os bots de um negocio so (?clienteId=), ex.: tela de IA.
    const where = filtroTenant(req);
    if (ehAdmin(req.usuario) && typeof req.query.clienteId === 'string' && req.query.clienteId) {
      where.clienteId = req.query.clienteId;
    }
    const bots = await prisma.bot.findMany({
      where,
      select: {
        ...camposBotPublicos,
        cliente: { select: { nome: true } },
      },
      orderBy: { criadoEm: 'desc' }
    });
    res.json(bots);
  } catch (erro) {
    console.error('[bots/list]', erro);
    res.status(500).json({ erro: 'Erro ao listar bots' });
  }
});

// ==========================================
// RELATORIO DE CONSUMO DE IA — so ADMIN (visao entre clientes, nao e um dado
// do tenant). Registrado ANTES de '/:id' de proposito: '/:id' e um parametro
// generico e casaria com este path primeiro se viesse depois, escondendo esta
// rota atras de um 404 "bot nao encontrado".
// Query: ?periodo=AAAA-MM (default: mes atual).
// ==========================================
roteador.get('/relatorio-consumo-ia', requerAdmin, async (req, res) => {
  try {
    const agora = new Date();
    const periodo = typeof req.query.periodo === 'string' && /^\d{4}-\d{2}$/.test(req.query.periodo)
      ? req.query.periodo
      : `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;

    const itens = await prisma.consumoIA.findMany({
      where: { periodo },
      orderBy: { valorExcedenteCentavos: 'desc' },
      select: {
        clienteId: true,
        botId: true,
        periodo: true,
        tokensUsados: true,
        tokensExcedentes: true,
        valorExcedenteCentavos: true,
        faturadoEm: true,
        cliente: { select: { nome: true } },
        bot: { select: { nome: true, iaTokensIncluidosMes: true } },
      },
    });

    res.json({ periodo, itens });
  } catch (erro) {
    console.error('[bots/relatorio-consumo-ia]', erro);
    res.status(500).json({ erro: 'Erro ao gerar relatorio de consumo de IA.' });
  }
});

roteador.get('/:id', requerPermissao('BOTS', 'visualizar'), async (req, res) => {
  try {
    const bot = await prisma.bot.findFirst({
      where: { id: req.params.id, ...filtroTenant(req) },
      select: { ...camposBotPublicos, cliente: { select: { nome: true, segmento: true } } },
    });
    if (!bot) return res.status(404).json({ erro: 'Bot nao encontrado' });
    res.json(bot);
  } catch (erro) {
    console.error('[bots/get]', erro);
    res.status(500).json({ erro: 'Erro ao buscar bot' });
  }
});

// ==========================================
// CONSUMO DE IA DO MES ATUAL — visao do proprio tenant (diferente de
// /relatorio-consumo-ia, que e admin-only e cruza todos os clientes).
// ==========================================
roteador.get('/:id/consumo-ia', requerPermissao('BOTS', 'visualizar'), async (req, res) => {
  try {
    const bot = await prisma.bot.findFirst({
      where: { id: req.params.id, ...filtroTenant(req) },
      select: {
        id: true, clienteId: true, iaTokensIncluidosMes: true,
        iaPrecoPorMilTokensExcedenteCentavos: true, iaExcedenteAutorizadoTokens: true,
      },
    });
    if (!bot) return res.status(404).json({ erro: 'Bot nao encontrado' });

    const periodo = periodoAtual();
    const [consumo, usadoCliente, global] = await Promise.all([
      prisma.consumoIA.findUnique({
        where: { botId_periodo: { botId: bot.id, periodo } },
        select: { tokensUsados: true, tokensExcedentes: true, valorExcedenteCentavos: true },
      }),
      consumoDoClienteNoMes(bot.clienteId, periodo),
      situacaoTetoGlobal().catch(() => ({ bloqueado: false })),
    ]);
    // A cota e por cliente (soma dos bots) — e o que decide se a IA responde.
    const cota = avaliarCota({
      usadoMes: usadoCliente,
      tokensIncluidosMes: bot.iaTokensIncluidosMes,
      excedenteAutorizado: bot.iaExcedenteAutorizadoTokens,
    });

    res.json({
      periodo,
      tokensUsados: consumo?.tokensUsados || 0,
      tokensUsadosCliente: usadoCliente,
      tokensIncluidosMes: bot.iaTokensIncluidosMes,
      excedenteAutorizadoTokens: bot.iaExcedenteAutorizadoTokens,
      limiteTokens: cota.limite,
      tokensRestantes: cota.restante,
      cotaEsgotada: cota.esgotada,
      iaPausadaNaPlataforma: Boolean(global.bloqueado),
      precoPorMilhaoCentavos: Math.round(bot.iaPrecoPorMilTokensExcedenteCentavos * 1000),
      tokensExcedentes: consumo?.tokensExcedentes || 0,
      valorExcedenteCentavos: consumo?.valorExcedenteCentavos || 0,
    });
  } catch (erro) {
    console.error('[bots/consumo-ia]', erro);
    res.status(500).json({ erro: 'Erro ao buscar consumo de IA.' });
  }
});

roteador.post('/', requerPermissao('BOTS', 'criar'), async (req, res) => {
  try {
    const { clienteId: clienteIdBody, nome, canal, telefone } = req.body;

    // ADMIN pode criar para qualquer tenant; demais sao forcados ao proprio.
    const clienteId = ehAdmin(req.usuario) ? clienteIdBody : req.usuario.clienteId;
    if (!clienteId) {
      return res.status(400).json({ erro: 'clienteId eh obrigatorio.' });
    }

    const bot = await prisma.bot.create({
      data: { clienteId, nome, canal, telefone },
      select: camposBotPublicos,
    });
    res.status(201).json(bot);
  } catch (erro) {
    console.error('[bots/create]', erro);
    res.status(500).json({ erro: 'Erro ao criar bot' });
  }
});

roteador.put('/:id', requerPermissao('BOTS', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;

    // Garante que o bot pertence ao tenant antes de atualizar.
    const existente = await prisma.bot.findFirst({
      where: { id, ...filtroTenant(req) },
      select: { id: true }
    });
    if (!existente) return res.status(404).json({ erro: 'Bot nao encontrado' });

    const { nome, canal, status, telefone } = req.body;

    const { data: dadosIA, erro: erroIA } = validarCamposIA(req.body || {});
    if (erroIA) return res.status(400).json({ erro: erroIA });
    // Ligar a IA, o modelo, a cota, o preco do excedente e o pacote extra sao
    // regra comercial (a IA custa pra plataforma): so o admin muda. O dono do
    // negocio so ajusta a instrucao (prompt) e as acoes da IA.
    if (!ehAdmin(req.usuario)) {
      for (const campo of CAMPOS_IA_SO_ADMIN) delete dadosIA[campo];
    }

    const bot = await prisma.bot.update({
      where: { id },
      data: { nome, canal, status, telefone, ...dadosIA },
      select: camposBotPublicos,
    });

    emitirEventoBot(req.io, 'bot_atualizado', bot.clienteId, bot);

    res.json(bot);
  } catch (erro) {
    console.error('[bots/update]', erro);
    res.status(500).json({ erro: 'Erro ao atualizar bot' });
  }
});

// ==========================================
// PUBLICAR / DESPUBLICAR — toggle de status ONLINE <-> OFFLINE.
// ERROR e estado de sistema (falha de execucao), nao setavel pela UI.
// Body: { status: 'ONLINE' | 'OFFLINE' }
// ==========================================
roteador.patch('/:id/status', requerPermissao('BOTS', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (status !== 'ONLINE' && status !== 'OFFLINE') {
      return res.status(400).json({ erro: "status deve ser 'ONLINE' ou 'OFFLINE'." });
    }

    const existente = await prisma.bot.findFirst({
      where: { id, ...filtroTenant(req) },
      select: { id: true },
    });
    if (!existente) return res.status(404).json({ erro: 'Bot nao encontrado' });

    const bot = await prisma.bot.update({
      where: { id },
      data: { status },
      select: camposBotPublicos,
    });

    emitirEventoBot(req.io, 'bot_atualizado', bot.clienteId, bot);
    res.json(bot);
  } catch (erro) {
    console.error('[bots/status]', erro);
    res.status(500).json({ erro: 'Erro ao mudar status do bot' });
  }
});

roteador.delete('/:id', requerPermissao('BOTS', 'excluir'), async (req, res) => {
  try {
    const { id } = req.params;

    const existente = await prisma.bot.findFirst({
      where: { id, ...filtroTenant(req) },
      select: { id: true, clienteId: true }
    });
    if (!existente) return res.status(404).json({ erro: 'Bot nao encontrado' });

    await prisma.bot.delete({ where: { id } });
    emitirEventoBot(req.io, 'bot_deletado', existente.clienteId, id);
    res.json({ message: 'Bot excluido com sucesso' });
  } catch (error) {
    console.error('[bots/delete]', error);
    res.status(500).json({ error: 'Erro ao excluir bot.' });
  }
});

roteador.post('/:id/duplicate', requerPermissao('BOTS', 'criar'), async (req, res) => {
  try {
    const { id } = req.params;

    const botOriginal = await prisma.bot.findFirst({
      where: { id, ...filtroTenant(req) },
      include: { variaveis: true },
    });

    if (!botOriginal) return res.status(404).json({ erro: 'Bot nao encontrado' });

    const novoBot = await prisma.bot.create({
      data: {
        clienteId: botOriginal.clienteId,
        nome: `${botOriginal.nome} (Copia)`,
        canal: botOriginal.canal,
        telefone: botOriginal.telefone,
        status: 'OFFLINE'
      }
    });

    if (botOriginal.variaveis.length > 0) {
      await prisma.variavelBot.createMany({
        data: botOriginal.variaveis.map(v => ({
          botId: novoBot.id,
          chave: v.chave,
          valor: v.valor,
          descricao: v.descricao,
          tipo: v.tipo
        }))
      });
    }

    const botCompleto = await prisma.bot.findUnique({
      where: { id: novoBot.id },
      select: {
        ...camposBotPublicos,
        cliente: { select: { nome: true } },
      }
    });

    emitirEventoBot(req.io, 'bot_criado', botCompleto.clienteId, botCompleto);

    res.status(201).json(botCompleto);
  } catch (error) {
    console.error('[bots/duplicate]', error);
    res.status(500).json({ error: 'Erro ao duplicar o bot.' });
  }
});

// ==========================================
// Configuracao de canal externo (conexão WhatsApp).
// Body: { credencialCanalId?, identificadorCanal?, verifyTokenCanal?, canal? }
// ==========================================
roteador.patch('/:id/canal', requerPermissao('BOTS', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;
    const where = ehAdmin(req.usuario) ? { id } : { id, clienteId: req.usuario.clienteId };
    const bot = await prisma.bot.findFirst({ where, select: { id: true, clienteId: true } });
    if (!bot) return res.status(404).json({ erro: 'Bot nao encontrado.' });

    const { credencialCanalId, identificadorCanal, verifyTokenCanal, canal, provedorCanal } = req.body || {};
    const data = {};

    if (canal !== undefined) {
      if (typeof canal !== 'string') return res.status(400).json({ erro: 'canal invalido.' });
      data.canal = canal;
    }
    if (provedorCanal !== undefined) {
      if (!['META_CLOUD', 'BAILEYS'].includes(provedorCanal)) {
        return res.status(400).json({ erro: "provedorCanal deve ser 'META_CLOUD' ou 'BAILEYS'." });
      }
      data.provedorCanal = provedorCanal;
    }
    if (credencialCanalId !== undefined) {
      if (credencialCanalId === null || credencialCanalId === '') {
        data.credencialCanalId = null;
      } else {
        const cred = await prisma.credencial.findFirst({
          where: { id: credencialCanalId, clienteId: bot.clienteId },
          select: { id: true },
        });
        if (!cred) return res.status(400).json({ erro: 'Credencial nao pertence ao tenant.' });
        data.credencialCanalId = credencialCanalId;
      }
    }
    if (identificadorCanal !== undefined) {
      const valor = identificadorCanal ? String(identificadorCanal).trim() : '';
      data.identificadorCanal = valor || null;
      // Numero novo (ou removido): a Meta precisa confirmar o webhook de novo.
      data.webhookConfirmadoEm = null;
      if (data.identificadorCanal) {
        // Um numero so pode estar em um bot: sem isso, outro cliente poderia
        // cadastrar o phoneNumberId de alguem e receber as mensagens dele.
        const emUso = await prisma.bot.findFirst({
          where: { identificadorCanal: data.identificadorCanal, id: { not: bot.id } },
          select: { id: true, clienteId: true },
        });
        if (emUso) {
          return res.status(409).json({
            erro: emUso.clienteId === bot.clienteId
              ? 'Este número já está ligado a outro bot do seu negócio. Desconecte lá primeiro.'
              : 'Este número de WhatsApp já está em uso em outra conta.',
          });
        }
      }
    }
    if (verifyTokenCanal !== undefined) {
      data.verifyTokenCanal = verifyTokenCanal ? String(verifyTokenCanal).trim() : null;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ erro: 'Nenhum campo para atualizar.' });
    }

    const atualizado = await prisma.bot.update({
      where: { id: bot.id },
      data,
      select: camposBotPublicos,
    });
    res.json(atualizado);
  } catch (erro) {
    // Corrida entre a checagem e o update: o indice unico do banco segura.
    if (erro?.code === 'P2002') return res.status(409).json({ erro: 'Este número de WhatsApp já está em uso em outra conta.' });
    console.error('[bots/canal]', erro);
    res.status(500).json({ erro: 'Erro ao configurar canal.' });
  }
});

// ==========================================
// WHATSAPP OFICIAL COM O APP DO PROPRIO CLIENTE — um passo so.
// Body: { identificadorCanal, accessToken?, appSecret? }
// Grava/atualiza a credencial WHATSAPP_CLOUD_TOKEN do negocio (token + segredo
// do app), liga o bot no oficial, gera o verify token se faltar e, com o envio
// real ligado, confere na Meta antes de salvar. Token/segredo vazios mantem o
// que ja estava salvo (trocar so o numero, por exemplo).
// ==========================================
roteador.put('/:id/canal/oficial', requerPermissao('BOTS', 'editar'), async (req, res) => {
  try {
    const where = ehAdmin(req.usuario) ? { id: req.params.id } : { id: req.params.id, clienteId: req.usuario.clienteId };
    const bot = await prisma.bot.findFirst({
      where,
      select: { id: true, clienteId: true, credencialCanalId: true, identificadorCanal: true, verifyTokenCanal: true },
    });
    if (!bot) return res.status(404).json({ erro: 'Bot nao encontrado.' });

    // Credencial atual do bot (so se for WhatsApp oficial do proprio negocio).
    let credAtual = null;
    if (bot.credencialCanalId) {
      const linha = await prisma.credencial.findFirst({
        where: { id: bot.credencialCanalId, clienteId: bot.clienteId, tipo: 'WHATSAPP_CLOUD_TOKEN' },
        select: { id: true },
      });
      if (linha) {
        const dec = await carregarCredencialDecifrada({ credencialId: linha.id, clienteId: bot.clienteId }).catch(() => null);
        if (dec) credAtual = { id: linha.id, dados: dec.dados || {} };
      }
    }
    const tokenSalvo = credAtual?.dados?.accessToken || credAtual?.dados?.token || null;
    const segredoSalvo = credAtual?.dados?.appSecret || null;

    const v = validarDadosOficiais(req.body || {}, { temToken: !!tokenSalvo, temSegredo: !!segredoSalvo });
    if (!v.ok) return res.status(400).json({ erro: v.erro, campo: v.campo });
    const { identificadorCanal } = v.dados;
    const accessToken = v.dados.accessToken || tokenSalvo;
    const appSecret = v.dados.appSecret || segredoSalvo;

    const emUso = await prisma.bot.findFirst({
      where: { identificadorCanal, id: { not: bot.id } },
      select: { clienteId: true },
    });
    if (emUso) {
      return res.status(409).json({
        campo: 'identificadorCanal',
        erro: emUso.clienteId === bot.clienteId
          ? 'Este número já está ligado a outro bot do seu negócio. Desconecte lá primeiro.'
          : 'Este número de WhatsApp já está em uso em outra conta.',
      });
    }

    const meta = await conferirNaMeta({ phoneNumberId: identificadorCanal, token: accessToken });
    if (!meta.ok) return res.status(422).json({ erro: meta.erro, motivo: meta.motivo });

    const cifrado = cifrarPayload(bot.clienteId, { accessToken, appSecret });
    const camposCifra = { dadosCifrados: cifrado.conteudoCifrado, iv: cifrado.iv, tag: cifrado.tag, versaoChave: cifrado.versaoChave };
    const numeroMudou = bot.identificadorCanal !== identificadorCanal;

    const atualizado = await prisma.$transaction(async (tx) => {
      const credencialId = credAtual
        ? (await tx.credencial.update({ where: { id: credAtual.id }, data: camposCifra, select: { id: true } })).id
        : (await tx.credencial.create({
          data: { clienteId: bot.clienteId, nome: 'WhatsApp oficial', tipo: 'WHATSAPP_CLOUD_TOKEN', ...camposCifra, criadoPorId: req.usuario.id || null },
          select: { id: true },
        })).id;
      return tx.bot.update({
        where: { id: bot.id },
        data: {
          canal: 'WHATSAPP',
          provedorCanal: 'META_CLOUD',
          credencialCanalId: credencialId,
          identificadorCanal,
          verifyTokenCanal: bot.verifyTokenCanal || gerarVerifyToken(),
          ...(numeroMudou ? { webhookConfirmadoEm: null } : {}),
          oficialNumeroExibicao: meta.numero ? [meta.numero, meta.nome].filter(Boolean).join(' · ') : (numeroMudou ? null : undefined),
        },
        select: camposBotPublicos,
      });
    });

    res.json({ bot: atualizado, conferidoNaMeta: !meta.simulado });
  } catch (erro) {
    if (erro?.code === 'P2002') return res.status(409).json({ campo: 'identificadorCanal', erro: 'Este número de WhatsApp já está em uso em outra conta.' });
    console.error('[bots/canal/oficial]', erro);
    res.status(500).json({ erro: 'Erro ao salvar a conexão oficial.' });
  }
});

// ==========================================
// WHATSAPP NAO OFICIAL (Baileys/QR Code) — pareamento via WhatsApp Web.
// Exige o modulo WHATSAPP_BAILEYS liberado pelo admin pro tenant (risco de
// banimento do numero reconhecido — so o admin decide quem pode correr esse
// risco). A conexao de verdade vive no worker.js; estas rotas so enfileiram
// o comando e devolvem 202 — o QR/status chega depois pela sala do socket.io
// (join_bot) ou por GET /:id/canal/baileys/status como fallback.
// ==========================================
roteador.post(
  '/:id/canal/baileys/conectar',
  requerPermissao('BOTS', 'editar'),
  requerModuloLiberado('WHATSAPP_BAILEYS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const where = ehAdmin(req.usuario) ? { id } : { id, clienteId: req.usuario.clienteId };
      const bot = await prisma.bot.findFirst({ where, select: { id: true, clienteId: true, credencialCanalId: true } });
      if (!bot) return res.status(404).json({ erro: 'Bot nao encontrado.' });

      // Credencial WHATSAPP_BAILEYS_SESSION propria do bot — busca sempre por
      // credencialCanalId, nunca por clienteId+tipo (Credencial nao tem botId;
      // um tenant pode um dia ter mais de uma, seria ambiguo).
      let credencialId = bot.credencialCanalId;
      const credencialAtual = credencialId
        ? await prisma.credencial.findFirst({ where: { id: credencialId, clienteId: bot.clienteId, tipo: 'WHATSAPP_BAILEYS_SESSION' } })
        : null;
      if (!credencialAtual) {
        const cifrado = cifrarPayload(bot.clienteId, {});
        const nova = await prisma.credencial.create({
          data: {
            clienteId: bot.clienteId,
            tipo: 'WHATSAPP_BAILEYS_SESSION',
            nome: 'Sessao WhatsApp Web',
            dadosCifrados: cifrado.conteudoCifrado,
            iv: cifrado.iv,
            tag: cifrado.tag,
            versaoChave: cifrado.versaoChave,
          },
        });
        credencialId = nova.id;
      }

      await prisma.bot.update({
        where: { id: bot.id },
        data: { provedorCanal: 'BAILEYS', credencialCanalId: credencialId, statusConexaoBaileys: 'CONECTANDO' },
      });

      await enfileirarComandoBaileys('conectar', bot.id);
      console.log(`[bots/canal/baileys/conectar] bot ${bot.id}: comando enfileirado.`);
      res.status(202).json({ ok: true });
    } catch (erro) {
      console.error('[bots/canal/baileys/conectar]', erro);
      res.status(500).json({ erro: 'Erro ao iniciar conexao WhatsApp Web.' });
    }
  },
);

roteador.post(
  '/:id/canal/baileys/desconectar',
  requerPermissao('BOTS', 'editar'),
  requerModuloLiberado('WHATSAPP_BAILEYS'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const where = ehAdmin(req.usuario) ? { id } : { id, clienteId: req.usuario.clienteId };
      const bot = await prisma.bot.findFirst({ where, select: { id: true, provedorCanal: true } });
      if (!bot) return res.status(404).json({ erro: 'Bot nao encontrado.' });
      if (bot.provedorCanal !== 'BAILEYS') {
        return res.status(422).json({ erro: 'Este bot nao esta no provedor WhatsApp Web.' });
      }

      await enfileirarComandoBaileys('desconectar', bot.id);
      console.log(`[bots/canal/baileys/desconectar] bot ${bot.id}: comando enfileirado.`);
      res.status(202).json({ ok: true });
    } catch (erro) {
      console.error('[bots/canal/baileys/desconectar]', erro);
      res.status(500).json({ erro: 'Erro ao desconectar WhatsApp Web.' });
    }
  },
);

roteador.get(
  '/:id/canal/baileys/status',
  requerPermissao('BOTS', 'visualizar'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const where = ehAdmin(req.usuario) ? { id } : { id, clienteId: req.usuario.clienteId };
      const bot = await prisma.bot.findFirst({
        where,
        select: { statusConexaoBaileys: true, qrCodeAtual: true, baileysNumeroConectado: true, baileysAtualizadoEm: true },
      });
      if (!bot) return res.status(404).json({ erro: 'Bot nao encontrado.' });
      res.json(bot);
    } catch (erro) {
      console.error('[bots/canal/baileys/status]', erro);
      res.status(500).json({ erro: 'Erro ao buscar status da conexao.' });
    }
  },
);

module.exports = roteador;
