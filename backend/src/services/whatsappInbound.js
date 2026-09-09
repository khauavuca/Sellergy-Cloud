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
const { montarRespostaBot } = require('./iaRouter');
const { reabrirLeadSeFechado } = require('./etapaLeadAuto');
const { candidatosDeBusca } = require('../utils/telefone');

// O remetente chega como 55 + DDD + numero; o lead guarda so DDD + numero (ou
// o que o usuario digitou). A forma canonica dos dois lados e
// Lead.telefoneNormalizado (utils/telefone.js), indexada por tenant — 1 busca
// por igualdade, em vez de carregar todos os leads do tenant a cada mensagem.
async function reabrirLeadPorTelefone(clienteId, telefoneRemetente) {
  const candidatos = candidatosDeBusca(telefoneRemetente);
  if (candidatos.length === 0) return;

  const lead = await prisma.lead.findFirst({
    where: { clienteId, telefoneNormalizado: { in: candidatos } },
    select: { id: true },
    // Se mais de um lead tem o mesmo numero (recorrente que virou lead de
    // novo), reabre o mais recente.
    orderBy: { atualizadoEm: 'desc' },
  });
  if (!lead) return;

  await reabrirLeadSeFechado(prisma, {
    clienteId,
    leadId: lead.id,
    motivo: 'Reaberto automaticamente: novo contato recebido pelo WhatsApp.',
  });
}

/**
 * Processa UMA mensagem recebida: reabre/avanca o lead (best-effort), monta a
 * resposta (IA ou FAQ) e envia via o adapter ja resolvido por quem chama.
 * @param {{
 *   bot: Object, texto: string, de: string, faqs: Array,
 *   canalContexto: Object, adapter: import('../adapters/whatsapp').ProvedorWhatsApp,
 * }} p
 * @returns {Promise<{texto?:string}|null>} resposta montada (pra log/depuracao de quem chama)
 */
async function processarMensagemRecebida({ bot, texto, de, faqs, canalContexto, adapter }) {
  // Best-effort: cliente que ja tinha lead fechado (venda concluida) e voltou
  // a escrever, ou mandou a primeira mensagem (lead 'novo') — reabre/avanca
  // pro kanban, nao bloqueia a resposta.
  reabrirLeadPorTelefone(bot.clienteId, de)
    .catch((e) => console.error('[whatsappInbound reabrir-lead]', e?.message));

  const resposta = await montarRespostaBot({ bot, texto, faqs, canalContexto });

  if (resposta?.texto && adapter) {
    await adapter.enviarTexto({ para: de, texto: resposta.texto });
  }

  return resposta;
}

module.exports = { processarMensagemRecebida, reabrirLeadPorTelefone };
