// Worker BullMQ (esqueleto pós-pivô ERP-first).
//
// Os consumidores de execução de fluxo (execucao-fluxo / agendamento-disparo /
// retencao-execucoes) foram removidos na limpeza do pivô. Este processo segue
// vivo como base para os jobs do ERP das próximas fases (lembrete de
// agendamento, disparo de campanha, emissão fiscal, conciliação de pagamento,
// expiração de cobrança — ver erp-arquitetura-e-operacao.md §8.4).
//
// Para registrar um job: crie a Queue em ./filas, instancie um `new Worker(...)`
// aqui com sua conexão própria, e trate o shutdown abaixo.
const path = require('path');
// Marca o processo: modulos que precisam do socket do QR Code (so existe
// aqui) sabem que podem enviar direto em vez de enfileirar.
process.env.SELLERGY_PROCESSO = 'worker';
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
// Em producao nao sobe com segredo fraco, faltando ou valor de exemplo.
require('./seguranca/validarAmbiente').garantirAmbienteSeguro();

const { Worker, DelayedError } = require('bullmq');
const { criarConexaoRedis, NOME_FILA_CAMPANHA, NOME_FILA_CAMPANHA_BAILEYS, NOME_FILA_BAILEYS_COMANDO, NOME_FILA_AVISO_PLATAFORMA, NOME_FILA_WHATSAPP_TENANT } = require('./filas');
const { processarEnvioCampanha, numeroDoEnvio } = require('./services/campanhaService');
const envioHumano = require('./services/baileys/envioHumano');
const gerenciadorConexaoBaileys = require('./services/baileys/gerenciadorConexao');

// Conexão base mantida viva para o processo continuar disponível ao orquestrador
// (Docker Compose) enquanto ainda não há consumidores registrados.
const conexao = criarConexaoRedis({ paraWorker: true });

const consumidores = [];

// CAMPANHA-DISPARO — envia a mensagem (template Meta) de 1 lead por job.
// concurrency baixa + limiter conservador pra nao estourar rate limit da
// Meta em campanhas grandes.
const workerCampanha = new Worker(
  NOME_FILA_CAMPANHA,
  async (job) => processarEnvioCampanha(job.data.campanhaEnvioId),
  {
    connection: criarConexaoRedis({ paraWorker: true }),
    concurrency: 5,
    limiter: { max: 20, duration: 60_000 },
  },
);
workerCampanha.on('failed', (job, err) => {
  console.error(`[worker:${NOME_FILA_CAMPANHA}] job ${job?.id} falhou:`, err?.message);
});
consumidores.push(workerCampanha);

// CAMPANHA-DISPARO-BAILEYS — cada job pede a vez ao "envio humano" (cota
// diaria com aquecimento, horario comercial, disjuntor de falhas). Se nao e a
// vez, o job volta pra fila com o atraso certo, sem gastar tentativa. A
// concorrencia > 1 deixa numeros de clientes diferentes andarem em paralelo;
// o espacamento entre mensagens do MESMO numero e garantido no Redis.
const workerCampanhaBaileys = new Worker(
  NOME_FILA_CAMPANHA_BAILEYS,
  async (job, token) => {
    const numero = await numeroDoEnvio(job.data.campanhaEnvioId);
    if (numero) {
      const vaga = await envioHumano.reservarCampanha(numero);
      if (!vaga.agora) {
        await job.moveToDelayed(Date.now() + vaga.esperarMs, token);
        throw new DelayedError();
      }
    }
    return processarEnvioCampanha(job.data.campanhaEnvioId);
  },
  { connection: criarConexaoRedis({ paraWorker: true }), concurrency: 4 },
);
workerCampanhaBaileys.on('failed', (job, err) => {
  console.error(`[worker:${NOME_FILA_CAMPANHA_BAILEYS}] job ${job?.id} falhou:`, err?.message);
});
consumidores.push(workerCampanhaBaileys);

// BAILEYS-COMANDO — backend (rota HTTP) manda "conectar"/"desconectar" pra cá,
// que é o único processo que segura a conexão Baileys de verdade (ver
// services/baileys/gerenciadorConexao.js). concurrency baixa: pareamento é
// coisa rara/manual, não precisa de paralelismo.
const workerBaileysComando = new Worker(
  NOME_FILA_BAILEYS_COMANDO,
  async (job) => {
    const { acao, botId } = job.data;
    console.log(`[worker:${NOME_FILA_BAILEYS_COMANDO}] processando "${acao}" pro bot ${botId}...`);
    if (acao === 'conectar') return gerenciadorConexaoBaileys.iniciarPareamento(botId);
    if (acao === 'desconectar') return gerenciadorConexaoBaileys.desconectar(botId);
    console.error(`[worker:${NOME_FILA_BAILEYS_COMANDO}] acao desconhecida:`, acao);
  },
  { connection: criarConexaoRedis({ paraWorker: true }), concurrency: 2 },
);
workerBaileysComando.on('failed', (job, err) => {
  console.error(`[worker:${NOME_FILA_BAILEYS_COMANDO}] job ${job?.id} falhou:`, err?.message);
});
consumidores.push(workerBaileysComando);

// AVISO-PLATAFORMA — WhatsApp do proprio Sellergy pros clientes (gerado
// pela API, ex.: webhook de pagamento). Envio direto daqui, onde o socket vive.
const workerAvisoPlataforma = new Worker(
  NOME_FILA_AVISO_PLATAFORMA,
  async (job) => {
    const { avisarNoWhatsapp } = require('./assinatura/avisos');
    const r = await avisarNoWhatsapp(job.data.clienteId, job.data.texto);
    if (!r?.ok && r?.motivo === 'SOCKET_INDISPONIVEL') throw new Error('socket do Sellergy indisponivel'); // tenta de novo
  },
  { connection: criarConexaoRedis({ paraWorker: true }), concurrency: 1 },
);
workerAvisoPlataforma.on('failed', (job, err) => {
  console.error(`[worker:${NOME_FILA_AVISO_PLATAFORMA}] job ${job?.id} falhou:`, err?.message);
});
consumidores.push(workerAvisoPlataforma);

// WHATSAPP-TENANT — mensagem do negocio pro cliente final gerada na API.
const workerWhatsappTenant = new Worker(
  NOME_FILA_WHATSAPP_TENANT,
  async (job) => {
    const { enviarAgora } = require('./services/mensagemTenant');
    const r = await enviarAgora(job.data);
    if (!r?.ok && r?.motivo === 'SOCKET_INDISPONIVEL') throw new Error('socket do tenant indisponivel'); // tenta de novo
    return r;
  },
  { connection: criarConexaoRedis({ paraWorker: true }), concurrency: 4 },
);
workerWhatsappTenant.on('failed', (job, err) => {
  console.error(`[worker:${NOME_FILA_WHATSAPP_TENANT}] job ${job?.id} falhou:`, err?.message);
});
consumidores.push(workerWhatsappTenant);

// Rotinas da fase 2 (encaixe que expira, sinal nao pago, pacote vencido...).
const pararRotinasFase2 = require('./agenda/rotinasFase2').iniciar();

// Reconecta sozinho os bots Baileys que já estavam pareados antes do worker
// reiniciar (deploy, crash) — sem isso o tenant precisaria escanear o QR de
// novo toda vez que o container sobe.
gerenciadorConexaoBaileys.reconectarBotsPareados()
  .catch((e) => console.error('[worker] falha ao reconectar bots Baileys no boot:', e?.message));

// Fase 1: lembrete/confirmacao de agendamento (a cada 5 min — precisa rodar
// AQUI porque o socket do canal QR Code so existe neste processo) e a rotina
// diaria das assinaturas (faturas, atraso, aviso de fim de teste).
const pararLembretes = require('./agenda/lembretes').iniciarCicloLembretes();
const pararAssinaturas = require('./assinatura/cobranca').iniciarRotinaAssinaturas();

console.log(`[worker] iniciado · filas: ${NOME_FILA_CAMPANHA}, ${NOME_FILA_CAMPANHA_BAILEYS}, ${NOME_FILA_BAILEYS_COMANDO}, ${NOME_FILA_AVISO_PLATAFORMA}`);

async function shutdown(sinal) {
  console.log(`[worker] sinal ${sinal} recebido, encerrando...`);
  try {
    pararLembretes();
    pararAssinaturas();
    pararRotinasFase2();
    for (const w of consumidores) await w.close();
    await conexao.quit();
  } catch (err) {
    console.error('[worker] erro ao encerrar:', err);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
