// Logica de resposta a UMA mensagem recebida — compartilhada entre os dois
// canais de entrada: webhook HTTP da Meta (routes/webhooksWhatsapp.routes.js)
// e o evento messages.upsert do Baileys (services/baileys/gerenciadorConexao.js).
// Extraida daqui pra nao duplicar a logica de IA/FAQ/reabertura de lead entre
// os dois caminhos — cada canal so resolve o que e especifico dele (token
// decifrado + phoneNumberId pra Meta; o socket vivo pra Baileys) e monta o
// `adapter` (ver adapters/whatsapp) ANTES de chamar isso aqui.
//
// O que fica de fora de proposito (fica com quem chama, 1x por lote de
// mensagens, nao por mensagem): buscar `faqs` do bot e incrementar as
// estatisticas (`totalMensagens`/`ultimaAtividadeEm`) — o formato original do
// webhook ja fazia isso 1x por POST, nao por mensagem individual.
//
// LIMITACAO CONHECIDA (Fase A do WhatsApp nao oficial): a ferramenta CATALOGO
// (services/iaFerramentas/enviarCatalogo.js) ainda manda o PDF direto via
// whatsappCloud.enviarDocumento usando canalContexto.phoneNumberId/token —
// nao funciona ainda pra bot BAILEYS (o guard de phoneNumberId/token ausente
// so faz o envio da ferramenta falhar silenciosamente, sem derrubar o
// atendimento). Migrar essa ferramenta pra usar a factory de adapter fica
// pra uma proxima rodada.

const prisma = require('../prisma');
const { tratarRespostaWhatsapp } = require('../agenda/respostaLembrete');
const { montarRespostaBot } = require('./iaRouter');
const { reabrirLeadSeFechado } = require('./etapaLeadAuto');
const { permitirRespostaBot } = require('./limiteContato');
// Caixa de entrada do WhatsApp (tela /app/whatsapp): grava o que entra e sai.
const conversas = require('../conversas/servico');
const { pausaAtiva, statusDoEnvio } = require('../conversas/regras');

// Campos do Bot que o atendimento precisa — o MESMO select nos dois canais
// (webhook da Meta e Baileys). Faltar `acoesPermitidas` deixava as
// ferramentas da IA sempre desligadas; faltar `status` fazia bot OFFLINE
// continuar respondendo.
const CAMPOS_BOT_ATENDIMENTO = Object.freeze({
  id: true, clienteId: true, credencialCanalId: true, provedorCanal: true, status: true,
  iaAtiva: true, iaModelo: true, iaPromptSistema: true, acoesPermitidas: true,
  iaTokensIncluidosMes: true, iaPrecoPorMilTokensExcedenteCentavos: true, iaExcedenteAutorizadoTokens: true,
});

// Lead.telefone e cadastrado sem o codigo do pais (DDD + numero, 10-11
// digitos — ver VendaController.validarClienteFinal), mas o remetente sempre
// vem com ele (ex: 55 + DDD + numero, tanto na Meta quanto no Baileys). Por
// isso a comparacao e por sufixo nos digitos, nao igualdade exata.
async function reabrirLeadPorTelefone(clienteId, telefoneRemetente) {
  const digitosRemetente = String(telefoneRemetente || '').replace(/\D/g, '');
  if (!digitosRemetente) return;

  const leads = await prisma.lead.findMany({
    where: { clienteId, telefone: { not: null } },
    select: { id: true, telefone: true },
  });
  const lead = leads.find((l) => {
    const digitosLead = (l.telefone || '').replace(/\D/g, '');
    return digitosLead.length >= 8 && digitosRemetente.endsWith(digitosLead);
  });
  if (!lead) return;

  await reabrirLeadSeFechado(prisma, {
    clienteId,
    leadId: lead.id,
    motivo: 'Reaberto automaticamente: novo contato recebido pelo WhatsApp.',
  });
}

/** Bot desligado (OFFLINE/ERROR) nao responde nada sozinho. Regra pura. */
function botPodeResponder(bot) {
  return bot?.status === 'ONLINE';
}

/**
 * Processa UMA mensagem recebida: reabre/avanca o lead (best-effort), monta a
 * resposta (IA ou FAQ) e envia via o adapter ja resolvido por quem chama.
 *
 * Ordem:
 *   1. resposta a lembrete (confirma/remarca) — vale mesmo com o bot
 *      desligado: o lembrete e do sistema, nao do bot;
 *   2. bot desligado -> nao responde (so reabre o lead);
 *   3. IA ou menu (iaRouter decide, com as travas de custo);
 *   2b. equipe assumiu a conversa (bot pausado na tela WhatsApp) -> nao responde;
 *   4. resposta sem IA tem limite por contato (anti-loop com outro robo).
 * Tudo que entra e sai fica gravado na conversa (conversas/servico.js).
 * @param {{
 *   bot: Object, texto: string, de: string, faqs: Array,
 *   canalContexto: Object, adapter: import('../adapters/whatsapp').ProvedorWhatsApp,
 * }} p
 * @returns {Promise<{texto?:string, origem?:string}|null>} resposta montada (pra log/depuracao de quem chama)
 */
async function processarMensagemRecebida({ bot, texto, de, faqs, canalContexto, adapter, payload = null, nomeContato = null }) {
  const base = { clienteId: bot.clienteId, telefone: de, botId: bot.id, canal: bot.provedorCanal };
  const registro = await conversas.registrarSeguro({ ...base, texto, direcao: 'ENTRADA', origem: 'CONTATO', nomeContato });

  // Envia pelo adapter e guarda o que saiu (com o status do envio).
  const responder = async (textoResposta, origem = 'BOT') => {
    const envio = await adapter.enviarTexto({ para: de, texto: textoResposta });
    await conversas.registrarSeguro({
      ...base, texto: textoResposta, direcao: 'SAIDA', origem,
      status: statusDoEnvio(envio), erro: envio?.ok ? null : envio?.erro, idExterno: envio?.idMensagem,
    });
    return envio;
  };

  // Resposta a lembrete de agendamento ("1"/"2" ou botao do template) tem
  // prioridade sobre o bot: confirma/remarca e responde, sem cair no FAQ/IA.
  try {
    const lembrete = await tratarRespostaWhatsapp({ clienteId: bot.clienteId, de, texto, payload });
    if (lembrete.tratado) {
      if (adapter && lembrete.resposta) await responder(lembrete.resposta);
      return { texto: lembrete.resposta, origem: 'LEMBRETE' };
    }
  } catch (e) {
    console.error('[whatsappInbound lembrete]', e?.message);
  }

  // Best-effort: cliente que ja tinha lead fechado (venda concluida) e voltou
  // a escrever, ou mandou a primeira mensagem (lead 'novo') — reabre/avanca
  // pro kanban, nao bloqueia a resposta.
  reabrirLeadPorTelefone(bot.clienteId, de)
    .catch((e) => console.error('[whatsappInbound reabrir-lead]', e?.message));

  if (!botPodeResponder(bot)) return null;

  // Equipe assumiu a conversa: o bot fica quieto ate a pausa acabar.
  const pausado = registro?.conversa
    ? pausaAtiva(registro.conversa)
    : await conversas.pausaDoContato(bot.clienteId, de).catch(() => false);
  if (pausado) return { texto: null, origem: 'PAUSADO' };

  const resposta = await montarRespostaBot({ bot, texto, faqs, de, canalContexto });

  // Limite por contato pras respostas SEM IA (a IA ja passou pelo limite
  // dela no iaRouter): outro robo respondendo o menu/fallback em loop.
  if (resposta?.origem !== 'IA' && !permitirRespostaBot(bot.id, de)) {
    return { ...resposta, texto: null, silenciado: 'LIMITE_CONTATO' };
  }

  if (resposta?.texto && adapter) {
    await responder(resposta.texto);
  }

  return resposta;
}

module.exports = { processarMensagemRecebida, reabrirLeadPorTelefone, botPodeResponder, CAMPOS_BOT_ATENDIMENTO };
