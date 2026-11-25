// Disparo de campanha — usado pela rota (Enviar agora / Disparar) e pelo cron
// das campanhas agendadas. Resolve o publico de novo (dado fresco), cria 1
// CampanhaEnvio por cliente que pode receber e enfileira. Quem pediu SAIR ou
// nao tem telefone fica de fora (nem entra na fila).
//
// Trava contra disparo duplo: a campanha so sai de RASCUNHO pra ENVIANDO num
// updateMany condicional — se dois pedidos chegam juntos (clique duplo, cron
// + botao), so um ganha.

const prisma = require('../prisma');
const { enfileirarEnvioCampanha, enfileirarEnvioCampanhaBaileys } = require('../filas');
const { resumirPublico, DIAS_PADRAO } = require('./campanhaPublico');

// Teto por campanha no canal QR Code. O ritmo real (cota diaria com
// aquecimento do numero, horario comercial, espacamento) fica no envio
// humano (services/baileys/envioHumano.js).
const LIMITE_LEADS_BAILEYS = 2000;

/** Canal WhatsApp conectado do negocio (ou null). */
async function canalDoNegocio(clienteId) {
  return prisma.bot.findFirst({
    where: { clienteId, identificadorCanal: { not: null } },
    select: { provedorCanal: true, telefone: true, baileysNumeroConectado: true },
  });
}

/**
 * Dispara 1 campanha do negocio. Nunca lanca por regra de negocio: devolve
 * { ok:true, totalAlvo } ou { ok:false, status, erro, codigo?, campos? }.
 */
async function dispararCampanha({ clienteId, campanhaId }) {
  const campanha = await prisma.campanha.findFirst({ where: { id: campanhaId, clienteId } });
  if (!campanha) return { ok: false, status: 404, erro: 'Campanha nao encontrada.' };
  if (campanha.status !== 'RASCUNHO') return { ok: false, status: 422, erro: 'Essa campanha ja foi disparada.' };

  const bot = await canalDoNegocio(clienteId);
  const usaBaileys = bot?.provedorCanal === 'BAILEYS';

  if (usaBaileys && process.env.CAMPANHA_CANAL_NAO_OFICIAL === 'bloqueado') {
    return {
      ok: false, status: 422, codigo: 'CAMPANHA_CANAL_NAO_OFICIAL_PAUSADO',
      erro: 'Campanhas pelo WhatsApp Web estão pausadas no momento. Tente mais tarde ou use o WhatsApp oficial.',
    };
  }
  if (!usaBaileys && !campanha.nomeTemplate) {
    return { ok: false, status: 422, erro: 'Configure o nome do template aprovado na Meta antes de disparar.', campos: ['nomeTemplate'] };
  }

  const publico = await resumirPublico(clienteId, {
    segmento: campanha.segmento,
    diasRecompra: campanha.diasRecompra || DIAS_PADRAO,
    gastoMinimo: campanha.gastoMinimo || null,
  });
  const leadIds = publico.recebem;
  if (leadIds.length === 0) {
    return { ok: false, status: 422, erro: 'Ninguém desse público pode receber agora (sem clientes, sem telefone ou pediram SAIR).' };
  }
  if (usaBaileys && leadIds.length > LIMITE_LEADS_BAILEYS) {
    return {
      ok: false, status: 422,
      erro: `Pelo WhatsApp Web o máximo é ${LIMITE_LEADS_BAILEYS} contatos por campanha. O envio é espalhado em vários dias automaticamente para proteger seu número.`,
    };
  }

  // Trava: so um pedido tira a campanha de RASCUNHO.
  const trava = await prisma.campanha.updateMany({
    where: { id: campanha.id, clienteId, status: 'RASCUNHO' },
    data: { status: 'ENVIANDO', agendadoPara: null },
  });
  if (trava.count !== 1) return { ok: false, status: 422, erro: 'Essa campanha ja foi disparada.' };

  let envios;
  try {
    envios = await prisma.$transaction(
      leadIds.map((leadId) => prisma.campanhaEnvio.upsert({
        where: { campanhaId_leadId: { campanhaId: campanha.id, leadId } },
        create: { campanhaId: campanha.id, leadId },
        update: {},
      })),
    );
  } catch (erro) {
    // Nada foi pra fila: devolve a campanha pro rascunho.
    await prisma.campanha.update({ where: { id: campanha.id }, data: { status: 'RASCUNHO' } }).catch(() => {});
    throw erro;
  }

  await prisma.campanha.update({ where: { id: campanha.id }, data: { totalAlvo: envios.length } });

  for (const envio of envios) {
    if (envio.status !== 'PENDENTE') continue;
    if (usaBaileys) await enfileirarEnvioCampanhaBaileys(envio.id);
    else await enfileirarEnvioCampanha(envio.id);
  }

  return { ok: true, totalAlvo: envios.length, ficaramDeFora: publico.semPermissao + publico.semTelefone };
}

/**
 * Dispara as campanhas agendadas que ja venceram. Campanha que nao pode sair
 * (sem modelo, publico vazio...) perde o agendamento e volta a ser rascunho,
 * com aviso na plataforma. `avisar` injetavel pra teste.
 */
async function dispararAgendadas({ agora = new Date(), avisar } = {}) {
  const vencidas = await prisma.campanha.findMany({
    where: { status: 'RASCUNHO', agendadoPara: { not: null, lte: agora } },
    select: { id: true, clienteId: true, nome: true },
    take: 50,
    orderBy: { agendadoPara: 'asc' },
  });
  const resultados = [];
  for (const c of vencidas) {
    let r;
    try {
      r = await dispararCampanha({ clienteId: c.clienteId, campanhaId: c.id });
    } catch (erro) {
      r = { ok: false, erro: 'Erro interno ao disparar.' };
      console.error('[campanhas/agendadas]', c.id, erro?.message);
    }
    if (!r.ok) {
      await prisma.campanha.updateMany({
        where: { id: c.id, clienteId: c.clienteId, status: 'RASCUNHO' },
        data: { agendadoPara: null },
      });
      if (avisar) {
        await avisar({
          clienteId: c.clienteId,
          tipo: 'GENERICA',
          titulo: 'Campanha agendada não saiu',
          mensagem: `"${c.nome}" não foi enviada: ${r.erro} Ela voltou para rascunho.`,
          link: '/app/campanhas',
        }).catch(() => {});
      }
    }
    resultados.push({ id: c.id, ...r });
  }
  return resultados;
}

module.exports = { dispararCampanha, dispararAgendadas, canalDoNegocio, LIMITE_LEADS_BAILEYS };
