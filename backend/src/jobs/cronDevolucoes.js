// =====================================================================
// CRON DIÁRIO DE AVISO DE DEVOLUÇÃO — roda às 08:00 BRT todo dia
// =====================================================================
// Para cada tenant ativo, acha Devolucao pendentes (devolvidoEm null,
// lembreteEnviadoEm null) cuja dataDevolucao esta dentro da janela de aviso
// configurada (Cliente.diasAvisoDevolucao). Pra cada uma:
//   - cria notificacao na plataforma (tipo DEVOLUCAO_PROXIMA) — canal garantido;
//   - tenta mandar WhatsApp pro cliente final pelo canal do tenant (oficial
//     ou QR Code — services/whatsappDoTenant.js), com o 55 no numero e
//     respeitando quem pediu SAIR (best-effort: a Meta bloqueia mensagem
//     livre se a ultima conversa foi ha mais de 24h, e o QR Code so existe no
//     processo do worker — o alerta na plataforma acima e o que sempre funciona);
//   - marca lembreteEnviadoEm pra nao avisar de novo no proximo tick.
//
// setTimeout encadeado (mesma estrategia do cronRelatorioMensal/cronCaixaDiario
// — projeto nao tem node-cron e e so 1 trigger diario).

const prisma = require('../prisma');
const { criarNotificacaoTenant } = require('../utils/notificacoes');
const { canalWhatsappDoTenant, telefoneParaWhatsapp } = require('../services/whatsappDoTenant');
const { reabrirLeadSeFechado } = require('../services/etapaLeadAuto');

const TZ = 'America/Sao_Paulo';

// Calcula o próximo 08:00 BRT em ms.
function proximaExecucaoMs() {
  const agora = new Date();
  const agoraBRT = agora.toLocaleDateString('en-CA', { timeZone: TZ });
  const [ano, mes, dia] = agoraBRT.split('-').map(Number);
  // 08:00 BRT = 11:00 UTC
  const hojeAs8 = new Date(Date.UTC(ano, mes - 1, dia, 11, 0, 0, 0));
  if (hojeAs8.getTime() > agora.getTime()) return hojeAs8.getTime() - agora.getTime();
  const amanhaAs8 = new Date(Date.UTC(ano, mes - 1, dia + 1, 11, 0, 0, 0));
  return amanhaAs8.getTime() - agora.getTime();
}

/**
 * Data-limite da janela de aviso: dataDevolucao <= hoje + diasAviso dias
 * (23:59:59 do dia-limite, pra cobrir o dia inteiro). Funcao pura — `agora`
 * injetavel pra teste deterministico.
 */
function limiteJanelaAviso(diasAvisoDevolucao, agora = new Date()) {
  const limite = new Date(agora.getTime() + Math.max(0, diasAvisoDevolucao || 0) * 24 * 60 * 60 * 1000);
  limite.setHours(23, 59, 59, 999);
  return limite;
}

/** Manda o aviso por WhatsApp (best-effort). Nunca lanca. */
async function enviarAvisoWhatsapp({ canal, clienteId, telefone, texto }) {
  if (!canal?.ok || !telefone) return { ok: false, motivo: canal?.motivo || 'SEM_TELEFONE' };
  const para = telefoneParaWhatsapp(telefone);
  if (!para || para.length < 12) return { ok: false, motivo: 'TELEFONE_INVALIDO' };
  const optOut = await prisma.optOutWhatsapp.findUnique({ where: { clienteId_telefone: { clienteId, telefone: para } } }).catch(() => null);
  if (optOut) return { ok: false, motivo: 'OPT_OUT' };
  try {
    const r = await canal.adapter.enviarTexto({ para, texto, tipo: 'lembrete' });
    return r?.ok ? { ok: true, para } : { ok: false, motivo: r?.erro || 'FALHA_ENVIO' };
  } catch (e) {
    console.error('[cronDevolucoes] falha ao mandar WhatsApp', e?.message);
    return { ok: false, motivo: 'FALHA_ENVIO' };
  }
}

async function processarTenant(tenant, { obterCanal = canalWhatsappDoTenant } = {}) {
  const limite = limiteJanelaAviso(tenant.diasAvisoDevolucao);
  const pendentes = await prisma.devolucao.findMany({
    where: {
      clienteId: tenant.id,
      devolvidoEm: null,
      // Devolucao encerrada pelo cancelamento da venda nao gera lembrete.
      canceladaEm: null,
      lembreteEnviadoEm: null,
      dataDevolucao: { lte: limite },
    },
    include: {
      lead: { select: { nome: true, telefone: true } },
      variacao: { select: { nome: true, produto: { select: { nome: true } } } },
    },
  });
  if (pendentes.length === 0) return { avisos: 0 };

  // Canal do tenant (oficial ou QR Code) — best-effort. Sem canal, so o
  // alerta na plataforma acontece — ja e util sozinho.
  const canal = await obterCanal(tenant.id).catch(() => ({ ok: false, motivo: 'ERRO_CANAL' }));

  let avisos = 0;
  for (const d of pendentes) {
    const nomeProduto = `${d.variacao.produto.nome} (${d.variacao.nome})`;
    const dataFmt = d.dataDevolucao.toLocaleDateString('pt-BR', { timeZone: TZ });
    try {
      await criarNotificacaoTenant(prisma, {
        clienteId: tenant.id,
        tipo: 'DEVOLUCAO_PROXIMA',
        titulo: `Devolução de ${nomeProduto}`,
        mensagem: `${d.lead?.nome || 'Cliente'} precisa devolver "${nomeProduto}" em ${dataFmt}.`,
        link: '/app/devolucoes',
        dados: { devolucaoId: d.id, vendaId: d.vendaId },
      });

      await enviarAvisoWhatsapp({
        canal,
        clienteId: tenant.id,
        telefone: d.lead?.telefone,
        texto: `Olá${d.lead?.nome ? `, ${d.lead.nome}` : ''}! Passando pra lembrar que a devolução de "${nomeProduto}" é em ${dataFmt}. Qualquer dúvida, é só chamar por aqui.`,
      });

      await prisma.devolucao.update({ where: { id: d.id }, data: { lembreteEnviadoEm: new Date() } });

      // Devolucao se aproximando: se o lead tinha sido fechado (venda
      // concluida), reabre pro kanban mostrar que ainda precisa de
      // acompanhamento ate o item voltar.
      await reabrirLeadSeFechado(prisma, {
        clienteId: tenant.id,
        leadId: d.leadId,
        motivo: `Reaberto automaticamente: devolução de "${nomeProduto}" prevista para ${dataFmt}.`,
      }).catch((e) => console.error('[cronDevolucoes] falha ao reabrir lead', e?.message));

      avisos++;
    } catch (e) {
      console.error(`[cronDevolucoes] falha ao processar devolucao ${d.id}:`, e?.message);
    }
  }
  return { avisos };
}

async function executar() {
  console.log('[cronDevolucoes] Tick às 08:00 BRT');
  try {
    const tenants = await prisma.cliente.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, nome: true, diasAvisoDevolucao: true },
    });
    for (const tenant of tenants) {
      try {
        const r = await processarTenant(tenant);
        if (r.avisos > 0) console.log(`[cronDevolucoes] ${tenant.nome}: ${r.avisos} aviso(s)`);
      } catch (e) {
        console.error(`[cronDevolucoes] falha no tenant ${tenant.nome}:`, e?.message);
      }
    }
  } catch (e) {
    console.error('[cronDevolucoes] Falha geral:', e?.message);
  }
}

function agendar() {
  const ms = proximaExecucaoMs();
  const horas = (ms / 1000 / 60 / 60).toFixed(2);
  console.log(`[cronDevolucoes] Próxima execução em ~${horas}h`);
  setTimeout(async () => {
    // Trava entre processos: com 2 instancias da API, so uma avisa.
    const { comTrava } = require('../utils/travaRotina');
    await comTrava('cron-devolucoes', executar, { ttlMs: 15 * 60_000, manterPorMs: 60 * 60_000 })
      .catch((e) => console.error('[cronDevolucoes] trava:', e?.message));
    agendar();
  }, ms);
}

function iniciar() {
  console.log('[cronDevolucoes] Inicializado.');
  agendar();
}

module.exports = { iniciar, executar, limiteJanelaAviso, processarTenant, enviarAvisoWhatsapp };
