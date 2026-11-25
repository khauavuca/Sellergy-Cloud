// =====================================================================
// LEMBRETE E CONFIRMACAO DE AGENDAMENTO POR WHATSAPP
// =====================================================================
// O buraco nº 1 das clinicas (doc de mercado, 21/11/2026): a agenda nao
// avisava ninguem. Agora:
//
//   24 h antes -> lembrete com "Confirmar" / "Remarcar" (PENDING e CONFIRMED)
//    2 h antes -> novo lembrete SO pra quem ainda nao confirmou (PENDING)
//
// Canal:
//   - META_CLOUD (oficial): template aprovado (configLembrete.nomeTemplate)
//     com 2 botoes de resposta rapida. O payload dos botoes carrega o token:
//     "CONFIRMAR:<token>" / "REMARCAR:<token>" (ver ./respostaLembrete.js).
//   - BAILEYS (QR Code): texto livre com "responda 1 ou 2" + o link.
//   Nos dois, vai o link /confirmar/<token> (funciona sem depender do bot).
//
// Roda no worker.js a cada CICLO_MS. Cada agendamento e RESERVADO com um
// updateMany condicional antes do envio (lembreteReservadoAte, expira sozinho
// se o processo cair): dois workers nunca mandam o mesmo lembrete. O campo
// lembrete24hEm/lembrete2hEm so e gravado DEPOIS do envio dar certo. Falha
// passageira (socket do QR Code fora do ar, erro de rede) fica pra proxima
// rodada, ate MAX_TENTATIVAS; falha definitiva (opt-out, sem canal) desiste
// na hora. Respeita a cota mensal do plano (limites.lembretesMes).
// =====================================================================

const crypto = require('crypto');
const prisma = require('../prisma');
const { temRecurso, limiteDo } = require('../planos/recursos');
const { situacaoAssinatura } = require('../assinatura/situacao');
const { canalWhatsappDoTenant, telefoneParaWhatsapp } = require('../services/whatsappDoTenant');

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const CICLO_MS = 5 * MIN;
const RESERVA_MS = 15 * MIN;
const MAX_TENTATIVAS = 3;
// Falhas que nao se resolvem tentando de novo na proxima rodada.
const FALHAS_DEFINITIVAS = new Set(['OPT_OUT', 'SEM_WHATSAPP', 'SEM_CREDENCIAL', 'TELEFONE_INVALIDO', 'NUMERO_SEM_WHATSAPP']);

const ANTECEDENCIAS = Object.freeze({
  '24h': { ms: 24 * HORA, campo: 'lembrete24hEm', minimoRestanteMs: 3 * HORA, status: ['PENDING', 'CONFIRMED'] },
  '2h': { ms: 2 * HORA, campo: 'lembrete2hEm', minimoRestanteMs: 20 * MIN, status: ['PENDING'] },
});

const CONFIG_PADRAO = Object.freeze({
  ativo: true,
  nomeTemplate: 'lembrete_agendamento',
  idioma: 'pt_BR',
  antecedencias: ['24h', '2h'],
});

const FUSO = 'America/Sao_Paulo';

/** Mescla a config salva com o padrao, descartando valores invalidos. */
function configLembreteEfetiva(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const antecedencias = Array.isArray(c.antecedencias)
    ? c.antecedencias.filter((a) => Object.prototype.hasOwnProperty.call(ANTECEDENCIAS, a))
    : CONFIG_PADRAO.antecedencias;
  return {
    ativo: typeof c.ativo === 'boolean' ? c.ativo : CONFIG_PADRAO.ativo,
    nomeTemplate: typeof c.nomeTemplate === 'string' && /^[a-z0-9_]{1,512}$/.test(c.nomeTemplate) ? c.nomeTemplate : CONFIG_PADRAO.nomeTemplate,
    idioma: typeof c.idioma === 'string' && /^[a-z]{2}(_[A-Z]{2})?$/.test(c.idioma) ? c.idioma : CONFIG_PADRAO.idioma,
    antecedencias: [...new Set(antecedencias)],
  };
}

/**
 * Qual lembrete (se algum) este agendamento deve receber agora. Regra pura.
 * @returns {'24h'|'2h'|null}
 */
function lembreteDevido(ag, agora, antecedenciasAtivas = CONFIG_PADRAO.antecedencias) {
  if (!ag?.telefoneCliente) return null;
  const faltaMs = new Date(ag.data).getTime() - agora.getTime();
  if (faltaMs <= 0) return null;
  // Do mais perto pro mais longe: perto do horario, o de 2h tem prioridade e o
  // de 24h ja nao faz sentido.
  for (const chave of ['2h', '24h']) {
    if (!antecedenciasAtivas.includes(chave)) continue;
    const a = ANTECEDENCIAS[chave];
    if (ag[a.campo]) continue;
    if (!a.status.includes(ag.status)) continue;
    if (faltaMs <= a.ms && faltaMs > a.minimoRestanteMs) return chave;
  }
  return null;
}

function gerarTokenConfirmacao() {
  return crypto.randomBytes(18).toString('base64url');
}

function formatarDataHora(data) {
  const d = new Date(data);
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long', day: '2-digit', month: '2-digit' }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }).format(d);
  return { dia, hora };
}

function urlConfirmacao(token) {
  const base = (process.env.APP_URL_PUBLICA || process.env.VITE_URL_PUBLICA || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/confirmar/${token}`;
}

/** Texto do lembrete (canal sem template). */
function montarTextoLembrete({ nomeNegocio, nomeCliente, data, servico, profissional, link }) {
  const { dia, hora } = formatarDataHora(data);
  const primeiroNome = String(nomeCliente || '').trim().split(/\s+/)[0] || 'tudo bem';
  const detalhe = [servico, profissional ? `com ${profissional}` : null].filter(Boolean).join(' ');
  return [
    `Olá, ${primeiroNome}! Passando para lembrar do seu horário na ${nomeNegocio}:`,
    `${dia}, às ${hora}${detalhe ? ` — ${detalhe}` : ''}.`,
    '',
    'Responda *1* para confirmar ou *2* para remarcar.',
    `Ou toque aqui: ${link}`,
  ].join('\n');
}

/** Componentes do template oficial: corpo {{1}}..{{4}} + 2 botoes rapidos. */
function componentesTemplate({ nomeNegocio, nomeCliente, data, token }) {
  const { dia, hora } = formatarDataHora(data);
  const primeiroNome = String(nomeCliente || '').trim().split(/\s+/)[0] || 'cliente';
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: primeiroNome },
        { type: 'text', text: nomeNegocio },
        { type: 'text', text: dia },
        { type: 'text', text: hora },
      ],
    },
    { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `CONFIRMAR:${token}` }] },
    { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: `REMARCAR:${token}` }] },
  ];
}

function inicioDoMes(agora = new Date()) {
  return new Date(agora.getFullYear(), agora.getMonth(), 1);
}

/** Lembretes ja enviados no mes (24h + 2h) — base da cota do plano. */
async function contarLembretesDoMes(clienteId, agora = new Date()) {
  const desde = inicioDoMes(agora);
  const [a, b] = await Promise.all([
    prisma.agendamento.count({ where: { clienteId, lembrete24hEm: { gte: desde } } }),
    prisma.agendamento.count({ where: { clienteId, lembrete2hEm: { gte: desde } } }),
  ]);
  return a + b;
}

async function registrarHistorico(agendamentoId, acao, alteracoes) {
  try {
    await prisma.historicoAgendamento.create({
      data: { agendamentoId, acao, alteracoes, usuarioNome: 'Sistema', origem: 'LEMBRETE' },
    });
  } catch (e) {
    console.error('[lembretes] historico', e?.message);
  }
}

function codigoDaFalha(r) {
  if (r?.codigo === 'SEM_WHATSAPP') return 'NUMERO_SEM_WHATSAPP'; // o destino nao tem WhatsApp
  if (r?.erro === 'Telefone inválido.') return 'TELEFONE_INVALIDO';
  return r?.codigo || 'FALHA_ENVIO';
}

/**
 * Regra pura: depois de uma falha, tenta de novo na proxima rodada ou desiste?
 * @param {{ codigo?: string, tentativas: number, max?: number }} p  tentativas = ja feitas, contando esta
 * @returns {'TENTAR_DE_NOVO'|'DESISTIR'}
 */
function decidirAposFalha({ codigo, tentativas, max = MAX_TENTATIVAS }) {
  if (FALHAS_DEFINITIVAS.has(codigo)) return 'DESISTIR';
  return tentativas < max ? 'TENTAR_DE_NOVO' : 'DESISTIR';
}

/** Envia 1 lembrete ja reservado. Nunca lanca: devolve { ok, erro? }. */
async function enviarLembrete(ag, chave, cfg) {
  try {
    const canal = await canalWhatsappDoTenant(ag.clienteId);
    if (!canal.ok) return { ok: false, erro: canal.motivo, codigo: canal.motivo };

    let token = ag.tokenConfirmacao;
    if (!token) {
      token = gerarTokenConfirmacao();
      await prisma.agendamento.update({ where: { id: ag.id }, data: { tokenConfirmacao: token } });
    }
    const para = telefoneParaWhatsapp(ag.telefoneCliente);
    if (!para || para.length < 12) return { ok: false, erro: 'Telefone inválido.', codigo: 'TELEFONE_INVALIDO' };
    // Quem respondeu SAIR/PARAR nao recebe mais nada automatico.
    const optOut = await prisma.optOutWhatsapp.findUnique({ where: { clienteId_telefone: { clienteId: ag.clienteId, telefone: para } } }).catch(() => null);
    if (optOut) return { ok: false, erro: 'OPT_OUT', codigo: 'OPT_OUT' };
    const base = {
      nomeNegocio: ag.cliente.nome,
      nomeCliente: ag.nomeCliente,
      data: ag.data,
      servico: ag.servico,
      profissional: ag.especialista?.nome || null,
    };

    if (canal.provedor === 'META_CLOUD') {
      const r = await canal.adapter.enviarTemplate({ para, nomeTemplate: cfg.nomeTemplate, idioma: cfg.idioma, componentes: componentesTemplate({ ...base, token }) });
      return r?.ok ? { ok: true, canal: canal.provedor } : { ok: false, erro: r?.erro || 'Falha no envio.', codigo: codigoDaFalha(r) };
    }

    // Canal QR Code: texto + enquete Confirmar/Remarcar (um toque pra
    // responder). "1"/"2" e o link continuam valendo pra quem nao ve enquete.
    const r = await canal.adapter.enviarTexto({ para, tipo: 'lembrete', texto: montarTextoLembrete({ ...base, link: urlConfirmacao(token) }) });
    if (!r?.ok) return { ok: false, erro: r?.erro || 'Falha no envio.', codigo: codigoDaFalha(r) };
    if (typeof canal.adapter.enviarEnquete === 'function') {
      const e = await canal.adapter.enviarEnquete({ para, pergunta: 'Você confirma o horário?', opcoes: ['Confirmar', 'Remarcar'] });
      if (e?.ok && e.mensagem) {
        const { registrarEnquete } = require('../services/baileys/gerenciadorConexao');
        await registrarEnquete({ botId: canal.botId, mensagem: e.mensagem, tipo: 'CONFIRMACAO_AGENDAMENTO', referenciaId: ag.id });
      }
    }
    return { ok: true, canal: canal.provedor };
  } catch (e) {
    return { ok: false, erro: e?.message || 'Erro inesperado.' };
  }
}

/**
 * Um ciclo: acha os agendamentos que precisam de lembrete agora e envia.
 * `enviar` injetavel pra teste (padrao: enviarLembrete).
 * @returns {Promise<{ avaliados: number, enviados: number, falhas: number, adiados: number, puladosPorCota: number }>}
 */
async function processarLembretes(agora = new Date(), { enviar = enviarLembrete } = {}) {
  const ate = new Date(agora.getTime() + ANTECEDENCIAS['24h'].ms);
  const candidatos = await prisma.agendamento.findMany({
    where: {
      status: { in: ['PENDING', 'CONFIRMED'] },
      data: { gt: agora, lte: ate },
      telefoneCliente: { not: null },
      OR: [{ lembrete24hEm: null }, { lembrete2hEm: null }],
    },
    select: {
      id: true, clienteId: true, data: true, status: true, nomeCliente: true, telefoneCliente: true,
      servico: true, tokenConfirmacao: true, lembrete24hEm: true, lembrete2hEm: true,
      lembreteReservadoAte: true, lembreteTentativas: true,
      especialista: { select: { nome: true } },
      cliente: { select: { nome: true, plano: true, statusAssinatura: true, trialAte: true, configLembrete: true } },
    },
    orderBy: { data: 'asc' },
    take: 500,
  });

  const usoPorTenant = new Map();
  const resultado = { avaliados: candidatos.length, enviados: 0, falhas: 0, adiados: 0, puladosPorCota: 0 };

  for (const ag of candidatos) {
    const cfg = configLembreteEfetiva(ag.cliente.configLembrete);
    if (!cfg.ativo) continue;
    if (!situacaoAssinatura(ag.cliente, agora).podeOperar) continue;
    if (!temRecurso(ag.cliente, 'lembretesWhatsapp', agora)) continue;

    const chave = lembreteDevido(ag, agora, cfg.antecedencias);
    if (!chave) continue;

    if (!usoPorTenant.has(ag.clienteId)) usoPorTenant.set(ag.clienteId, await contarLembretesDoMes(ag.clienteId, agora));
    if (usoPorTenant.get(ag.clienteId) >= limiteDo(ag.cliente, 'lembretesMes', agora)) {
      resultado.puladosPorCota += 1;
      continue;
    }

    // Reserva: so um processo consegue (campo ainda nulo e sem reserva viva).
    // A reserva expira sozinha (RESERVA_MS) se o worker cair no meio.
    const campo = ANTECEDENCIAS[chave].campo;
    const reservado = await prisma.agendamento.updateMany({
      where: { id: ag.id, [campo]: null, OR: [{ lembreteReservadoAte: null }, { lembreteReservadoAte: { lt: agora } }] },
      data: { lembreteReservadoAte: new Date(agora.getTime() + RESERVA_MS), lembreteTentativas: { increment: 1 } },
    });
    if (reservado.count === 0) continue;
    const tentativas = (ag.lembreteTentativas || 0) + 1;

    const envio = await enviar(ag, chave, cfg);

    if (envio.ok) {
      // So agora conta como enviado (e entra na cota do mes).
      await prisma.agendamento.update({ where: { id: ag.id }, data: { [campo]: new Date(), lembreteReservadoAte: null, lembreteTentativas: 0 } });
      usoPorTenant.set(ag.clienteId, usoPorTenant.get(ag.clienteId) + 1);
      await registrarHistorico(ag.id, 'LEMBRETE_ENVIADO', { antecedencia: chave, canal: envio.canal || null, tentativas });
      resultado.enviados += 1;
      continue;
    }

    if (decidirAposFalha({ codigo: envio.codigo, tentativas }) === 'TENTAR_DE_NOVO') {
      // Solta a reserva: a proxima rodada tenta de novo. Sem historico a cada
      // tentativa pra nao encher a linha do tempo do agendamento.
      await prisma.agendamento.update({ where: { id: ag.id }, data: { lembreteReservadoAte: null } });
      resultado.adiados += 1;
      continue;
    }

    // Desiste: marca o campo pra nao tentar mais este lembrete.
    await prisma.agendamento.update({ where: { id: ag.id }, data: { [campo]: new Date(), lembreteReservadoAte: null, lembreteTentativas: 0 } });
    await registrarHistorico(ag.id, 'LEMBRETE_FALHOU', { antecedencia: chave, canal: envio.canal || null, erro: envio.erro || null, tentativas });
    resultado.falhas += 1;
  }
  return resultado;
}

/** Liga o ciclo no processo atual (worker.js). Devolve a funcao de parar. */
function iniciarCicloLembretes({ intervaloMs = CICLO_MS } = {}) {
  let rodando = false;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await processarLembretes();
      if (r.enviados || r.falhas || r.adiados || r.puladosPorCota) console.log('[lembretes]', JSON.stringify(r));
    } catch (e) {
      console.error('[lembretes] ciclo falhou:', e?.message);
    } finally {
      rodando = false;
    }
  };
  const id = setInterval(tick, intervaloMs);
  setTimeout(tick, 15 * 1000); // primeira passada logo depois do boot
  return () => clearInterval(id);
}

module.exports = {
  ANTECEDENCIAS,
  CONFIG_PADRAO,
  configLembreteEfetiva,
  lembreteDevido,
  gerarTokenConfirmacao,
  montarTextoLembrete,
  componentesTemplate,
  urlConfirmacao,
  contarLembretesDoMes,
  decidirAposFalha,
  MAX_TENTATIVAS,
  processarLembretes,
  iniciarCicloLembretes,
};
