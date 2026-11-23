// =====================================================================
// WEBHOOK DO ASAAS DA PLATAFORMA — mensalidade do Sellergy.
// =====================================================================
// POST /webhooks/assinatura/asaas
//
// Seguranca:
//   - token fixo no header `asaas-access-token`, comparado em tempo constante;
//     sem ASAAS_PLATAFORMA_WEBHOOK_TOKEN configurado a rota RECUSA tudo
//     (falha fechada: nunca aceita evento sem conferir quem mandou);
//   - nao confia no corpo: busca a cobranca de novo na API do Asaas pelo id;
//   - idempotente: cada evento processado fica em EventoWebhookAssinatura.
// =====================================================================

const crypto = require('crypto');
const prisma = require('../prisma');
const asaas = require('./asaasPlataforma');
const { sincronizarCobranca, recalcularStatus } = require('./cobranca');
const { avisar } = require('./avisos');

const EVENTOS_DE_COBRANCA = new Set([
  'PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_RESTORED',
]);

function tokenConfere(recebido) {
  const esperado = process.env.ASAAS_PLATAFORMA_WEBHOOK_TOKEN;
  if (!esperado || !recebido) return false;
  const a = crypto.createHash('sha256').update(String(recebido)).digest();
  const b = crypto.createHash('sha256').update(String(esperado)).digest();
  return crypto.timingSafeEqual(a, b);
}

function idDoEvento(body) {
  if (body?.id) return String(body.id);
  const p = body?.payment || {};
  return `${body?.event}:${p.id}:${p.status}:${p.dateCreated || ''}`;
}

async function acharCliente(pagamento) {
  const ors = [];
  if (pagamento.subscription) ors.push({ asaasAssinaturaId: pagamento.subscription });
  if (pagamento.customer) ors.push({ asaasCustomerId: pagamento.customer });
  if (!ors.length) return null;
  return prisma.cliente.findFirst({ where: { OR: ors }, select: { id: true } });
}

/**
 * @returns {Promise<{ status: number, corpo: object }>}
 */
async function processarWebhook({ headers, body, query }) {
  if (!process.env.ASAAS_PLATAFORMA_WEBHOOK_TOKEN) return { status: 503, corpo: { erro: 'webhook nao configurado' } };
  if (!tokenConfere(headers['asaas-access-token'])) return { status: 401, corpo: { erro: 'token invalido' } };
  // Status da conta de recebimento (subconta aberta pela plataforma): o
  // status e reconsultado na API com a chave da subconta, entao reentrega e
  // evento fora de ordem nao fazem mal. Ver pagamentos/contaRecebimento.js.
  if (typeof body?.event === 'string' && body.event.startsWith('ACCOUNT_STATUS_')) {
    return require('../pagamentos/contaRecebimento').processarEventoConta({ body, query });
  }
  if (!body?.event || !body?.payment?.id) return { status: 200, corpo: { ok: true, ignorado: 'sem cobranca' } };
  if (!EVENTOS_DE_COBRANCA.has(body.event)) return { status: 200, corpo: { ok: true, ignorado: body.event } };

  const idEvento = idDoEvento(body).slice(0, 190);
  // createMany + skipDuplicates: evento repetido nao vira erro no log.
  const novo = await prisma.eventoWebhookAssinatura.createMany({ data: [{ id: idEvento, evento: body.event }], skipDuplicates: true });
  if (novo.count === 0) return { status: 200, corpo: { ok: true, repetido: true } };

  try {
    // Fonte da verdade: a API, nao o corpo recebido.
    const pg = asaas.ativo() ? await asaas.obterCobranca(body.payment.id) : body.payment;
    const cliente = await acharCliente(pg);
    if (!cliente) return { status: 200, corpo: { ok: true, ignorado: 'cliente desconhecido' } };

    const anterior = await prisma.faturaAssinatura.findFirst({ where: { cobrancaExternaId: pg.id }, select: { status: true } });
    const fatura = await sincronizarCobranca(cliente.id, pg);
    const pagaAgora = fatura.status === 'PAGA' && anterior?.status !== 'PAGA';
    if (pagaAgora) {
      await prisma.cliente.updateMany({ where: { id: cliente.id, statusAssinatura: { in: ['TRIAL', 'CANCELADA'] } }, data: { statusAssinatura: 'ATIVA' } });
    }
    await recalcularStatus(cliente.id);
    if (pagaAgora) {
      await avisar(cliente.id, {
        titulo: 'Pagamento confirmado',
        mensagem: `Recebemos R$ ${Number(pg.value).toFixed(2).replace('.', ',')} da sua mensalidade do Sellergy. Obrigado!`,
        dados: { faturaId: fatura.id },
      });
    }
    return { status: 200, corpo: { ok: true } };
  } catch (e) {
    // Libera o evento pra o Asaas reenviar.
    await prisma.eventoWebhookAssinatura.delete({ where: { id: idEvento } }).catch(() => {});
    throw e;
  }
}

module.exports = { processarWebhook, tokenConfere, idDoEvento };
