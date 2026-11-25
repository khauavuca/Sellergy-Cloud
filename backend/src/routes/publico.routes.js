// =====================================================================
// ROTAS PUBLICAS (sem login) — quem chama e o cliente final.
// =====================================================================
//   GET  /publico/planos                          -> planos e precos (landing)
//   GET  /publico/agenda/:slug                    -> negocio + servicos + profissionais
//   GET  /publico/agenda/:slug/horarios           -> ?especialistaId&variacaoId&data=YYYY-MM-DD
//   POST /publico/agenda/:slug/agendamentos       -> agenda (nome, telefone, horario)
//   GET  /publico/confirmacao/:token              -> resumo do horario
//   POST /publico/confirmacao/:token              -> { acao: CONFIRMAR | REMARCAR }
//
// Seguranca:
//   - nunca le o cookie de sessao (por isso isento de CSRF no middleware);
//   - so expoe nome do negocio, servicos ativos, primeiro nome do profissional
//     e horarios livres — nada de cliente, valor de caixa ou contato;
//   - token de confirmacao aleatorio (18 bytes), sem enumerar;
//   - limite de requisicoes proprio, mais apertado que o geral.
// =====================================================================

const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../prisma');
const { planosPublicos } = require('../planos/catalogo');
const { temRecurso } = require('../planos/recursos');
const { situacaoAssinatura } = require('../assinatura/situacao');
const { listarHorariosLivres } = require('../services/agendaSlots');
const { aplicarResposta } = require('../agenda/respostaLembrete');
const { lockClienteAdvisory } = require('../utils/locks');
const sinal = require('../agenda/sinal');
const pacotes = require('../agenda/pacotes');
const encaixe = require('../agenda/encaixe');
const { partesBRT, mesmoTelefone } = require('../agenda/utilAgenda');

const roteador = express.Router();

const limitadorLeitura = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const limitadorEscrita = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente de novo mais tarde.' },
});

const DIAS_MAX_ANTECEDENCIA = 60;
const DURACAO_PADRAO_MIN = 30;

roteador.get('/planos', limitadorLeitura, (req, res) => {
  res.json({ planos: planosPublicos(), diasDeTeste: require('../planos/catalogo').DIAS_DE_TRIAL });
});

// ---------------------------------------------------------------------
// Agendamento pelo link
// ---------------------------------------------------------------------

/** Carrega o negocio pelo slug e checa se a agenda online esta disponivel. */
async function negocioComAgendaOnline(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  const cliente = await prisma.cliente.findUnique({
    where: { slugPublico: slug },
    select: {
      id: true, nome: true, brandNome: true, brandLogo: true, status: true,
      plano: true, statusAssinatura: true, trialAte: true, modulosLiberados: true,
    },
  });
  if (!cliente || cliente.status !== 'ACTIVE') return null;
  if (!situacaoAssinatura(cliente).podeOperar) return null;
  if (!temRecurso(cliente, 'linkAgendamento')) return null;
  if (cliente.modulosLiberados?.AGENDA !== true) return null;
  return cliente;
}

/** Preco entre 0 e 1 milhao e duracao (se houver) de 5 min a 12 h. */
function variacaoPublicavel(v) {
  if (!v || !Number.isFinite(v.preco) || v.preco < 0 || v.preco > 1_000_000) return false;
  if (v.duracaoMin != null && (!Number.isInteger(v.duracaoMin) || v.duracaoMin < 5 || v.duracaoMin > 720)) return false;
  return true;
}

const indisponivel = (res) => res.status(404).json({ erro: 'Agenda online indisponível para este endereço.', codigo: 'AGENDA_INDISPONIVEL' });

roteador.get('/agenda/:slug', limitadorLeitura, async (req, res) => {
  try {
    const cliente = await negocioComAgendaOnline(req.params.slug);
    if (!cliente) return indisponivel(res);

    const servicos = await prisma.produto.findMany({
      where: { clienteId: cliente.id, tipo: 'SERVICO', visibilidade: 'ATIVO' },
      select: {
        id: true, nome: true, descricao: true,
        variacoes: { select: { id: true, nome: true, preco: true, duracaoMin: true }, orderBy: { preco: 'asc' } },
        especialistas: { select: { especialista: { select: { id: true, nome: true, ativo: true } } } },
      },
      orderBy: { nome: 'asc' },
    });

    res.json({
      negocio: { nome: cliente.brandNome || cliente.nome, logo: cliente.brandLogo || null },
      servicos: servicos
        .map((s) => ({
          id: s.id,
          nome: s.nome,
          descricao: s.descricao,
          // Variacao com preco/duracao fora do razoavel (cadastro antigo) nao vai pro link.
          variacoes: s.variacoes
            .filter(variacaoPublicavel)
            .map((v) => ({ ...v, duracaoMin: v.duracaoMin || DURACAO_PADRAO_MIN })),
          profissionais: s.especialistas
            .map((e) => e.especialista)
            .filter((e) => e.ativo)
            .map((e) => ({ id: e.id, nome: String(e.nome).trim().split(/\s+/)[0] })),
        }))
        .filter((s) => String(s.nome || '').trim() && s.variacoes.length > 0 && s.profissionais.length > 0),
    });
  } catch (e) {
    console.error('[publico/agenda]', e);
    res.status(500).json({ erro: 'Erro ao carregar a agenda.' });
  }
});

function lerDia(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const dia = new Date(`${texto}T12:00:00`);
  if (Number.isNaN(dia.getTime())) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const limite = new Date(hoje.getTime() + DIAS_MAX_ANTECEDENCIA * 86400000);
  if (dia < hoje || dia > limite) return null;
  return dia;
}

/** Garante que o profissional faz o servico da variacao, no mesmo negocio. */
async function validarCombinacao(clienteId, especialistaId, variacaoId) {
  if (typeof especialistaId !== 'string' || typeof variacaoId !== 'string') return null;
  const variacao = await prisma.variacaoProduto.findFirst({
    where: { id: variacaoId, produto: { clienteId, tipo: 'SERVICO', visibilidade: 'ATIVO' } },
    select: { id: true, nome: true, preco: true, duracaoMin: true, produtoId: true, produto: { select: { nome: true } } },
  });
  if (!variacao || !variacaoPublicavel(variacao)) return null;
  const vinculo = await prisma.especialistaServico.findFirst({
    where: { especialistaId, produtoId: variacao.produtoId, especialista: { clienteId, ativo: true } },
    select: { id: true },
  });
  return vinculo ? variacao : null;
}

roteador.get('/agenda/:slug/horarios', limitadorLeitura, async (req, res) => {
  try {
    const cliente = await negocioComAgendaOnline(req.params.slug);
    if (!cliente) return indisponivel(res);
    const { especialistaId, variacaoId, data } = req.query;
    const dia = lerDia(data);
    if (!dia) return res.status(422).json({ erro: `Escolha um dia entre hoje e os próximos ${DIAS_MAX_ANTECEDENCIA} dias.`, campos: ['data'] });
    const variacao = await validarCombinacao(cliente.id, especialistaId, variacaoId);
    if (!variacao) return res.status(422).json({ erro: 'Serviço ou profissional inválido.', campos: ['variacaoId', 'especialistaId'] });

    const horarios = await listarHorariosLivres({ clienteId: cliente.id, especialistaId, data: dia, variacaoId });
    res.json({ horarios: horarios.map((h) => ({ inicio: h.inicio, fim: h.fim })) });
  } catch (e) {
    console.error('[publico/horarios]', e);
    res.status(500).json({ erro: 'Erro ao carregar os horários.' });
  }
});

roteador.post('/agenda/:slug/agendamentos', limitadorEscrita, async (req, res) => {
  try {
    const cliente = await negocioComAgendaOnline(req.params.slug);
    if (!cliente) return indisponivel(res);

    const { especialistaId, variacaoId, inicio, nome, telefone } = req.body || {};
    const nomeLimpo = typeof nome === 'string' ? nome.trim().slice(0, 80) : '';
    const telefoneDigitos = typeof telefone === 'string' ? telefone.replace(/\D/g, '') : '';
    const campos = [];
    if (nomeLimpo.length < 2) campos.push('nome');
    if (telefoneDigitos.length < 10 || telefoneDigitos.length > 13) campos.push('telefone');
    const dataInicio = new Date(inicio);
    if (Number.isNaN(dataInicio.getTime()) || dataInicio.getTime() <= Date.now()) campos.push('inicio');
    if (campos.length) return res.status(422).json({ erro: 'Confira os campos destacados.', campos });

    const variacao = await validarCombinacao(cliente.id, especialistaId, variacaoId);
    if (!variacao) return res.status(422).json({ erro: 'Serviço ou profissional inválido.', campos: ['variacaoId', 'especialistaId'] });

    // O horario pedido precisa estar na lista de livres (respeita jornada,
    // expediente e passo) — o cliente nao inventa horario.
    const livres = await listarHorariosLivres({ clienteId: cliente.id, especialistaId, data: dataInicio, variacaoId });
    if (!livres.some((h) => new Date(h.inicio).getTime() === dataInicio.getTime())) {
      return res.status(409).json({ erro: 'Esse horário acabou de ser ocupado. Escolha outro.', codigo: 'HORARIO_OCUPADO' });
    }

    const duracao = variacao.duracaoMin || DURACAO_PADRAO_MIN;
    const fim = new Date(dataInicio.getTime() + duracao * 60000);

    const agendamento = await prisma.$transaction(async (tx) => {
      // Lock do tenant + rechecagem: duas pessoas no mesmo horario, so uma leva.
      await lockClienteAdvisory(tx, cliente.id);
      const conflitos = await tx.agendamento.findMany({
        where: {
          clienteId: cliente.id, especialistaId, status: { not: 'CANCELED' },
          data: { lt: fim, gte: new Date(dataInicio.getTime() - 24 * 3600000) },
        },
        select: { data: true, duracao: true },
      });
      const ocupado = conflitos.some((c) => {
        const ini = new Date(c.data).getTime();
        return ini < fim.getTime() && ini + (c.duracao || DURACAO_PADRAO_MIN) * 60000 > dataInicio.getTime();
      });
      if (ocupado) throw Object.assign(new Error('ocupado'), { codigo: 'HORARIO_OCUPADO' });

      // Lead: reaproveita pelo telefone (so digitos) ou cria.
      const leads = await tx.lead.findMany({ where: { clienteId: cliente.id, telefone: { not: null } }, select: { id: true, telefone: true } });
      // Numero COMPLETO com DDD (antes eram so os 8 ultimos: outro DDD virava
      // a cliente errada e gastava o pacote dela).
      let lead = leads.find((l) => mesmoTelefone(l.telefone, telefoneDigitos)) || null;
      if (!lead) {
        lead = await tx.lead.create({ data: { clienteId: cliente.id, nome: nomeLimpo, telefone: telefoneDigitos, origem: 'AGENDA_ONLINE', valor: 0 } });
      }

      const criado = await tx.agendamento.create({
        data: {
          clienteId: cliente.id, leadId: lead.id, especialistaId,
          nomeCliente: nomeLimpo, telefoneCliente: telefoneDigitos,
          data: dataInicio, duracao,
          servico: variacao.nome && variacao.nome !== variacao.produto.nome ? `${variacao.produto.nome} — ${variacao.nome}` : variacao.produto.nome,
          preco: variacao.preco, origem: 'LINK_PUBLICO', status: 'PENDING',
        },
        select: {
          id: true, clienteId: true, leadId: true, data: true, duracao: true, servico: true, preco: true,
          nomeCliente: true, telefoneCliente: true, tokenConfirmacao: true,
        },
      });
      await tx.historicoAgendamento.create({
        data: { agendamentoId: criado.id, acao: 'CRIADO', usuarioNome: nomeLimpo, origem: 'LINK_PUBLICO' },
      });
      return criado;
    });

    // Fase 2: quem tem pacote desse servico usa o pacote (e nao paga sinal);
    // senao, cobra o sinal quando o negocio configurou.
    let pacoteUsado = null;
    if (temRecurso(cliente, 'pacotes')) {
      const lista = await pacotes.pacotesAtivosDaCliente({ clienteId: cliente.id, leadId: agendamento.leadId, telefone: telefoneDigitos });
      for (const p of lista.filter((x) => x.produtoId === variacao.produtoId && x.livres > 0)) {
        try {
          await pacotes.validarUsoNoAgendamento({
            clienteId: cliente.id, pacoteClienteId: p.id, leadId: agendamento.leadId, telefone: telefoneDigitos,
            servico: agendamento.servico, dataAgendamento: agendamento.data, ignorarAgendamentoId: agendamento.id,
          });
          await prisma.agendamento.update({ where: { id: agendamento.id }, data: { pacoteClienteId: p.id } });
          pacoteUsado = { nome: p.nome, restantes: p.livres - 1 };
          break;
        } catch (e) {
          if (!e.status) throw e;
        }
      }
    }
    let sinalPublico = null;
    if (!pacoteUsado) {
      const r = await sinal.cobrarSinal({ agendamento, produtoId: variacao.produtoId });
      if (r.cobrado) sinalPublico = await sinalParaTela({ ...r.sinal, qrCode: r.sinal.qrCode }, r.sinal.qrCodeBase64);
    }

    const { leadId: _l, clienteId: _c, tokenConfirmacao: _t, nomeCliente: _n, telefoneCliente: _f, ...publicoAg } = agendamento; // eslint-disable-line no-unused-vars
    res.status(201).json({
      agendamento: publicoAg,
      pacote: pacoteUsado,
      sinal: sinalPublico,
      mensagem: sinalPublico
        ? 'Pague o sinal por Pix para garantir o horário. A confirmação chega aqui e no seu WhatsApp.'
        : 'Você vai receber um lembrete no WhatsApp antes do atendimento.',
    });
  } catch (e) {
    if (e?.codigo === 'HORARIO_OCUPADO') return res.status(409).json({ erro: 'Esse horário acabou de ser ocupado. Escolha outro.', codigo: 'HORARIO_OCUPADO' });
    console.error('[publico/agendar]', e);
    res.status(500).json({ erro: 'Erro ao agendar. Tente de novo.' });
  }
});

// ---------------------------------------------------------------------
// Sinal por Pix (fase 2): a cliente acompanha o pagamento na mesma pagina
// ---------------------------------------------------------------------

async function sinalParaTela({ valor, status, expiraEm, qrCode, token }, base64 = null) {
  // O QR sai do proprio copia-e-cola (o mesmo codigo que a cliente copia);
  // a imagem do PSP so entra se nao houver o texto.
  let qrImagem = null;
  if (qrCode) {
    try { qrImagem = await require('qrcode').toDataURL(qrCode, { margin: 1, width: 240 }); } catch { qrImagem = null; }
  }
  if (!qrImagem && base64) qrImagem = `data:image/png;base64,${base64}`;
  return { valor, status, expiraEm, qrCode: qrCode || null, qrImagem, token };
}

roteador.get('/agenda/:slug/sinal/:token', limitadorLeitura, async (req, res) => {
  try {
    const cliente = await negocioComAgendaOnline(req.params.slug);
    if (!cliente) return indisponivel(res);
    const token = req.params.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{10,64}$/.test(token)) return res.status(404).json({ erro: 'Link inválido.' });
    const ag = await prisma.agendamento.findFirst({
      where: { tokenConfirmacao: token, clienteId: cliente.id },
      select: { status: true, sinalValor: true, sinalStatus: true, sinalExpiraEm: true, sinalCobrancaId: true, preco: true },
    });
    if (!ag || !ag.sinalStatus) return res.status(404).json({ erro: 'Link inválido.' });
    const cob = ag.sinalCobrancaId
      ? await prisma.cobranca.findFirst({ where: { id: ag.sinalCobrancaId, clienteId: cliente.id }, select: { qrCode: true } })
      : null;
    const tela = await sinalParaTela({
      valor: ag.sinalValor, status: ag.sinalStatus, expiraEm: ag.sinalExpiraEm,
      qrCode: ag.sinalStatus === 'PENDENTE' ? cob?.qrCode : null, token,
    });
    res.json({ ...tela, horarioStatus: ag.status, restante: sinal.valorAposSinal({ preco: ag.preco, sinalValor: ag.sinalValor, sinalStatus: ag.sinalStatus }) });
  } catch (e) {
    console.error('[publico/sinal]', e);
    res.status(500).json({ erro: 'Erro ao consultar o pagamento.' });
  }
});

// ---------------------------------------------------------------------
// "Me avise se vagar" (fase 2): entra na fila de encaixe pelo link
// ---------------------------------------------------------------------

const limitadorFila = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente de novo mais tarde.' },
});

roteador.post('/agenda/:slug/fila', limitadorFila, async (req, res) => {
  try {
    const cliente = await negocioComAgendaOnline(req.params.slug);
    if (!cliente) return indisponivel(res);
    const { variacaoId, especialistaId, dia, soEsseDia, nome, telefone } = req.body || {};

    const variacao = typeof variacaoId === 'string'
      ? await prisma.variacaoProduto.findFirst({
        where: { id: variacaoId, produto: { clienteId: cliente.id, tipo: 'SERVICO', visibilidade: 'ATIVO' } },
        select: { produtoId: true },
      })
      : null;
    if (!variacao) return res.status(422).json({ erro: 'Escolha o serviço.', campos: ['variacaoId'] });
    if (especialistaId && !(await validarCombinacao(cliente.id, especialistaId, variacaoId))) {
      return res.status(422).json({ erro: 'Profissional inválido.', campos: ['especialistaId'] });
    }

    // Validade: so o dia escolhido, ou as proximas 2 semanas.
    const diaValido = typeof dia === 'string' && lerDia(dia) ? dia : null;
    const hoje = partesBRT(new Date()).ymd;
    const ate = soEsseDia && diaValido
      ? diaValido
      : partesBRT(new Date(Date.now() + 14 * 86400000)).ymd;
    const r = encaixe.normalizarEntradaFila({
      nome, telefone, produtoId: variacao.produtoId, especialistaId: especialistaId || null, ate: ate < hoje ? hoje : ate,
      preferencia: soEsseDia && diaValido ? `Pelo link: só no dia ${diaValido.split('-').reverse().join('/')}` : 'Pelo link: qualquer dia nas próximas 2 semanas',
    });
    if (r.erro) return res.status(422).json({ erro: r.erro, campos: r.campos });

    const leads = await prisma.lead.findMany({ where: { clienteId: cliente.id, telefone: { not: null } }, select: { id: true, telefone: true } });
    const lead = leads.find((l) => mesmoTelefone(l.telefone, r.dados.telefone));
    try {
      await encaixe.adicionarNaFila({ clienteId: cliente.id, dados: { ...r.dados, leadId: lead?.id || null } });
    } catch (e) {
      if (e.codigo === 'JA_NA_FILA') return res.status(200).json({ ok: true, mensagem: 'Você já está na fila desse serviço. Avisamos pelo WhatsApp quando vagar.' });
      throw e;
    }
    res.status(201).json({ ok: true, mensagem: 'Pronto! Se vagar um horário, avisamos pelo WhatsApp. Quem responder primeiro fica com ele.' });
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ erro: e.message });
    console.error('[publico/fila]', e);
    res.status(500).json({ erro: 'Erro ao entrar na fila. Tente de novo.' });
  }
});

// ---------------------------------------------------------------------
// Confirmacao pelo link do lembrete
// ---------------------------------------------------------------------

async function agendamentoPorToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  return prisma.agendamento.findUnique({
    where: { tokenConfirmacao: token },
    select: {
      id: true, clienteId: true, data: true, duracao: true, status: true, servico: true,
      nomeCliente: true, telefoneCliente: true,
      especialista: { select: { nome: true } },
      cliente: { select: { nome: true, brandNome: true, brandLogo: true } },
    },
  });
}

roteador.get('/confirmacao/:token', limitadorLeitura, async (req, res) => {
  const ag = await agendamentoPorToken(req.params.token).catch(() => null);
  if (!ag) return res.status(404).json({ erro: 'Link inválido ou expirado.' });
  res.json({
    negocio: { nome: ag.cliente.brandNome || ag.cliente.nome, logo: ag.cliente.brandLogo || null },
    agendamento: {
      data: ag.data, duracao: ag.duracao, status: ag.status, servico: ag.servico,
      profissional: ag.especialista ? String(ag.especialista.nome).trim().split(/\s+/)[0] : null,
      primeiroNome: String(ag.nomeCliente || '').trim().split(/\s+/)[0],
    },
  });
});

roteador.post('/confirmacao/:token', limitadorEscrita, async (req, res) => {
  try {
    const acao = req.body?.acao;
    if (acao !== 'CONFIRMAR' && acao !== 'REMARCAR') return res.status(422).json({ erro: 'Ação inválida.', campos: ['acao'] });
    const ag = await agendamentoPorToken(req.params.token);
    if (!ag) return res.status(404).json({ erro: 'Link inválido ou expirado.' });
    const r = await aplicarResposta({ agendamento: ag, acao, origem: 'CLIENTE_LINK' });
    res.status(r.ok ? 200 : 409).json(r);
  } catch (e) {
    console.error('[publico/confirmacao]', e);
    res.status(500).json({ erro: 'Erro ao registrar sua resposta.' });
  }
});

module.exports = roteador;
