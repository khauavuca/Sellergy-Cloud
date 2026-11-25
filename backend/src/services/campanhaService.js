// Disparo de campanha — logica de ENVIO de 1 CampanhaEnvio (1 lead), chamada
// pelo worker BullMQ (ver filas/index.js + worker.js). Fora daqui, a fila so
// enfileira { campanhaEnvioId } — toda a logica de negocio mora aqui.

const prisma = require('../prisma');
const { criarProvedorWhatsapp } = require('../adapters/whatsapp');
const { carregarCredencialDecifrada } = require('../credenciais');
const { obterSocket } = require('./baileys/gerenciadorConexao');
const { telefoneParaWhatsapp } = require('./whatsappDoTenant');

// Marca 1 envio como falho + soma no contador da campanha.
async function marcarFalha(envio, motivo) {
  await prisma.$transaction([
    prisma.campanhaEnvio.update({ where: { id: envio.id }, data: { status: 'FALHOU', erro: motivo } }),
    prisma.campanha.update({ where: { id: envio.campanhaId }, data: { totalFalhou: { increment: 1 } } }),
  ]);
  await finalizarSeCompleto(envio.campanhaId);
}

// Quando nao sobra nenhum envio PENDENTE, a campanha vira CONCLUIDA. Rodar
// isso mais de uma vez (corrida entre jobs terminando quase juntos) e
// inofensivo — so reescreve o mesmo status/data.
async function finalizarSeCompleto(campanhaId) {
  const pendentes = await prisma.campanhaEnvio.count({ where: { campanhaId, status: 'PENDENTE' } });
  if (pendentes === 0) {
    await prisma.campanha.update({ where: { id: campanhaId }, data: { status: 'CONCLUIDA', enviadoEm: new Date() } });
  }
}

/**
 * Processa 1 envio de campanha: manda a mensagem (template Meta) pro lead e
 * atualiza status + contadores. Idempotente — envio que ja saiu de PENDENTE
 * (ENVIADO/FALHOU) e ignorado, protege contra reprocessamento (retry do
 * BullMQ, job duplicado).
 * @param {string} campanhaEnvioId
 */
async function processarEnvioCampanha(campanhaEnvioId) {
  const envio = await prisma.campanhaEnvio.findUnique({
    where: { id: campanhaEnvioId },
    include: {
      campanha: { select: { id: true, clienteId: true, nomeTemplate: true, mensagem: true } },
      lead: { select: { id: true, nome: true, telefone: true } },
    },
  });
  if (!envio || envio.status !== 'PENDENTE') return;

  if (!envio.lead.telefone) return marcarFalha(envio, 'Lead sem telefone cadastrado.');

  const bot = await prisma.bot.findFirst({
    where: { clienteId: envio.campanha.clienteId, identificadorCanal: { not: null } },
    select: { id: true, provedorCanal: true, identificadorCanal: true, credencialCanalId: true },
  });
  if (!bot?.identificadorCanal || !bot.credencialCanalId) {
    return marcarFalha(envio, 'Nenhum bot com WhatsApp conectado.');
  }

  // Lead.telefone fica sem o 55 (DDD + numero): o WhatsApp exige o DDI.
  const para = telefoneParaWhatsapp(envio.lead.telefone);
  if (!para || para.length < 12) return marcarFalha(envio, 'Telefone do lead invalido.');

  // Quem respondeu SAIR/PARAR (no QR Code OU no oficial) nao recebe campanha.
  const optOut = await prisma.optOutWhatsapp.findUnique({
    where: { clienteId_telefone: { clienteId: envio.campanha.clienteId, telefone: para } },
  }).catch(() => null);
  if (optOut) return marcarFalha(envio, 'Contato pediu para não receber mensagens (SAIR).');

  let resultado;
  if (bot.provedorCanal === 'BAILEYS' && process.env.CAMPANHA_CANAL_NAO_OFICIAL === 'bloqueado') {
    // Interruptor de emergencia do operador (ex.: onda de banimentos).
    return marcarFalha(envio, 'Campanha pelo WhatsApp Web desligada pelo operador.');
  }
  if (bot.provedorCanal === 'BAILEYS') {
    // Sem template no WhatsApp Web: a mensagem da campanha e o texto que sai,
    // com variacao {a|b} e todo o "envio humano" (ver envioHumano.js). O
    // espacamento e a cota diaria ja foram reservados no worker antes daqui.
    const socket = obterSocket(bot.id);
    if (!socket) throw new Error('WhatsApp Web nao esta conectado no momento.'); // retry do BullMQ
    const adapter = criarProvedorWhatsapp('BAILEYS', { modo: 'live', socket });
    const primeiroNome = String(envio.lead.nome || '').trim().split(/\s+/)[0] || '';
    const texto = String(envio.campanha.mensagem || '').replace(/\[nome\]|\{\{\s*nome\s*\}\}/gi, primeiroNome);
    resultado = await adapter.enviarTexto({ para, texto, tipo: 'campanha' });
  } else {
    if (!envio.campanha.nomeTemplate) return marcarFalha(envio, 'Campanha sem template aprovado configurado.');

    const credencial = await carregarCredencialDecifrada({
      credencialId: bot.credencialCanalId, clienteId: envio.campanha.clienteId,
    }).catch(() => null);
    const token = credencial?.dados?.token || credencial?.dados?.accessToken || null;
    if (!token) return marcarFalha(envio, 'Credencial do WhatsApp invalida ou ausente.');

    const adapter = criarProvedorWhatsapp('META_CLOUD', {
      credencial: { dados: { accessToken: token } }, identificadorCanal: bot.identificadorCanal, modo: 'live',
    });
    resultado = await adapter.enviarTemplate({ para, nomeTemplate: envio.campanha.nomeTemplate, idioma: 'pt_BR' });
  }

  if (!resultado.ok) {
    return marcarFalha(envio, resultado.erro || 'Falha no envio pelo WhatsApp.');
  }

  await prisma.$transaction([
    prisma.campanhaEnvio.update({ where: { id: envio.id }, data: { status: 'ENVIADO', enviadoEm: new Date() } }),
    prisma.campanha.update({ where: { id: envio.campanhaId }, data: { totalEnviado: { increment: 1 } } }),
  ]);
  await finalizarSeCompleto(envio.campanhaId);
}

/** Bot com canal conectado do tenant dono do envio (pro worker reservar a vez). */
async function numeroDoEnvio(campanhaEnvioId) {
  const envio = await prisma.campanhaEnvio.findUnique({ where: { id: campanhaEnvioId }, select: { campanha: { select: { clienteId: true } } } });
  if (!envio) return null;
  const bot = await prisma.bot.findFirst({
    where: { clienteId: envio.campanha.clienteId, provedorCanal: 'BAILEYS', identificadorCanal: { not: null } },
    select: { id: true, baileysNumeroConectado: true },
  });
  return bot?.baileysNumeroConectado || null;
}

module.exports = { processarEnvioCampanha, numeroDoEnvio };
