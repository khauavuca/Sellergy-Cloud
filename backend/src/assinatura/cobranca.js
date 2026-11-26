// =====================================================================
// COBRANCA DA MENSALIDADE DO SELLERGY — faturas, ciclo e regua de cobranca.
// =====================================================================
// Dois modos, escolhidos sozinhos:
//
//   AUTOMATICO (ASAAS_PLATAFORMA_API_KEY preenchida): ao assinar, o cliente
//   vira uma assinatura recorrente no Asaas (Pix, boleto ou cartao). O Asaas
//   gera cada cobranca e avisa pelo webhook (ver ./webhookAsaas.js), que cria
//   e baixa as faturas aqui. O cartao e digitado na pagina do Asaas: o numero
//   nunca passa pelo nosso servidor.
//
//   MANUAL (sem chave): faturas geradas aqui todo mes e baixa feita pelo admin.
//
// Rotina diaria (worker.js, 06:00), nos dois modos:
//   1. (manual) gera a fatura de quem vence em ate 3 dias;
//   2. marca como VENCIDA a fatura ABERTA que passou do vencimento;
//   3. recalcula o status (ATIVA -> ATRASADA -> SUSPENSA em 10 dias);
//   4. regua: avisa no sistema e no WhatsApp 3 dias antes, no dia, e com
//      1, 3 e 7 dias de atraso; teste gratis acabando (3 e 1 dia) e acabado.
// =====================================================================

const prisma = require('../prisma');
const { obterPlano, DESCONTO_ANUAL, DIAS_DE_TRIAL } = require('../planos/catalogo');
const { proximoStatusPorFaturas, situacaoAssinatura, DIA_MS, DIAS_ATE_SUSPENDER } = require('./situacao');
const asaas = require('./asaasPlataforma');
const { avisar } = require('./avisos');

const DIAS_ANTES_PARA_FATURAR = 3;
// Passos da regua: dias em relacao ao vencimento (negativo = antes).
const REGUA = [-3, 0, 1, 3, 7];

function competenciaDe(data) {
  const d = new Date(data);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function somarMeses(data, meses) {
  const d = new Date(data);
  const dia = d.getDate();
  d.setMonth(d.getMonth() + meses);
  // 31/01 + 1 mes nao pode virar 03/03: fica no ultimo dia do mes.
  if (d.getDate() !== dia) d.setDate(0);
  return d;
}

function somarUmMes(data) {
  return somarMeses(data, 1);
}

function brl(v) {
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
}

function dataBr(d) {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Valor de UMA cobranca: mensal, ou o ano inteiro com 20% de desconto. */
function valorDoCiclo(plano, ciclo = 'MENSAL', mensalidadeNegociada = 0) {
  const mensal = mensalidadeNegociada > 0 ? mensalidadeNegociada : obterPlano(plano).precoMensal;
  if (ciclo === 'ANUAL') return Math.round(mensal * 12 * (1 - DESCONTO_ANUAL) * 100) / 100;
  return mensal;
}

function valorDaFatura(cliente) {
  return valorDoCiclo(cliente.plano, cliente.cicloAssinatura, cliente.mensalidade);
}

function descricaoAssinatura(plano, ciclo) {
  return `Sellergy Cloud - plano ${obterPlano(plano).nome} (${ciclo === 'ANUAL' ? 'anual' : 'mensal'})`;
}

/** Cria (idempotente por competencia) a fatura local. So no modo manual. */
async function gerarFatura(cliente, referencia) {
  const competencia = competenciaDe(referencia);
  const existente = await prisma.faturaAssinatura.findUnique({
    where: { clienteId_competencia: { clienteId: cliente.id, competencia } },
  });
  const fatura = existente || await prisma.faturaAssinatura.create({
    data: { clienteId: cliente.id, competencia, valor: valorDaFatura(cliente), vencimento: new Date(referencia) },
  });
  const meses = cliente.cicloAssinatura === 'ANUAL' ? 12 : 1;
  await prisma.cliente.update({ where: { id: cliente.id }, data: { proximaCobrancaEm: somarMeses(referencia, meses) } });

  if (!existente) {
    await avisar(cliente.id, {
      titulo: 'Fatura do Sellergy disponível',
      mensagem: `Sua mensalidade de ${competencia} (${brl(fatura.valor)}) vence em ${dataBr(fatura.vencimento)}.`,
      whatsapp: false, // a regua manda o WhatsApp 3 dias antes
      dados: { faturaId: fatura.id },
    });
  }
  return fatura;
}

/** Recalcula o status de um cliente pelas faturas vencidas. */
async function recalcularStatus(clienteId, agora = new Date()) {
  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true, statusAssinatura: true } });
  if (!cliente) return null;
  const vencida = await prisma.faturaAssinatura.findFirst({
    where: { clienteId, status: 'VENCIDA' }, orderBy: { vencimento: 'asc' }, select: { vencimento: true },
  });
  const novo = proximoStatusPorFaturas({ statusAtual: cliente.statusAssinatura, faturaVencidaMaisAntiga: vencida?.vencimento || null, agora });
  if (novo !== cliente.statusAssinatura) {
    await prisma.cliente.update({ where: { id: clienteId }, data: { statusAssinatura: novo } });
    if (novo === 'SUSPENSA') {
      await avisar(clienteId, {
        titulo: 'Conta em modo somente leitura',
        mensagem: `A mensalidade está em atraso há mais de ${DIAS_ATE_SUSPENDER} dias. Você ainda consulta tudo, mas não registra vendas nem agendamentos até regularizar. Nenhum dado foi apagado.`,
      });
    }
    if (novo === 'ATIVA' && ['ATRASADA', 'SUSPENSA'].includes(cliente.statusAssinatura)) {
      await avisar(clienteId, { titulo: 'Pagamento recebido', mensagem: 'Tudo certo com a sua assinatura. Obrigado!' });
    }
  }
  return novo;
}

/** Baixa (manual pelo admin ou pelo webhook do Asaas). Idempotente. */
async function marcarFaturaPaga(faturaId, agora = new Date(), { formaPagamento } = {}) {
  const atual = await prisma.faturaAssinatura.findUnique({ where: { id: faturaId } });
  if (!atual) throw Object.assign(new Error('Fatura nao encontrada.'), { code: 'P2025' });
  if (atual.status === 'PAGA') return atual;
  const fatura = await prisma.faturaAssinatura.update({
    where: { id: faturaId },
    data: { status: 'PAGA', pagaEm: agora, ...(formaPagamento ? { formaPagamento } : {}) },
  });
  // Pagou durante o teste ou cancelado reativando: vira ATIVA.
  await prisma.cliente.updateMany({ where: { id: fatura.clienteId, statusAssinatura: { in: ['TRIAL'] } }, data: { statusAssinatura: 'ATIVA' } });
  await recalcularStatus(fatura.clienteId, agora);
  return fatura;
}

/**
 * O cliente escolheu um plano (no teste, depois dele ou trocando).
 * @param {string} clienteId
 * @param {string} plano BASIC | PRO | PREMIUM
 * @param {{ ciclo?: 'MENSAL'|'ANUAL', formaPagamento?: string, cpfCnpj?: string, agora?: Date }} [op]
 * @returns {Promise<{ cliente: object, fatura: object|null, linkPagamento: string|null, modo: 'AUTOMATICO'|'MANUAL' }>}
 */
async function assinarPlano(clienteId, plano, { ciclo = 'MENSAL', formaPagamento = 'UNDEFINED', cpfCnpj, mensalidade, carenciaMeses = 0, agora = new Date() } = {}) {
  const atual = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: {
      id: true, nome: true, email: true, telefone: true, cpfCnpj: true, plano: true, mensalidade: true,
      statusAssinatura: true, trialAte: true, asaasCustomerId: true, asaasAssinaturaId: true, cicloAssinatura: true,
    },
  });
  if (!atual) throw Object.assign(new Error('Cliente nao encontrado.'), { code: 'P2025' });

  // Assinou ainda no teste: a primeira cobranca so vence quando o teste
  // acaba (nada de cobrar pelos dias gratis). Fora do teste: em 3 dias.
  const fimTeste = atual.statusAssinatura === 'TRIAL' && atual.trialAte && new Date(atual.trialAte) > agora ? new Date(atual.trialAte) : null;
  // Cupom de meses gratis empurra a primeira cobranca.
  const vencimentoBase = fimTeste || new Date(agora.getTime() + DIAS_ANTES_PARA_FATURAR * DIA_MS);
  const vencimento = carenciaMeses > 0 ? somarMeses(vencimentoBase, carenciaMeses) : vencimentoBase;
  // Mensalidade negociada (cupom de %): passa a valer ja nesta assinatura.
  if (mensalidade !== undefined) {
    await prisma.cliente.update({ where: { id: clienteId }, data: { mensalidade } });
    atual.mensalidade = mensalidade;
  }
  const valor = valorDoCiclo(plano, ciclo, atual.mensalidade);
  const documento = cpfCnpj || atual.cpfCnpj;

  if (asaas.ativo()) {
    if (!documento) throw Object.assign(new Error('Informe o CPF ou CNPJ para emitir a cobrança.'), { status: 422, campos: ['cpfCnpj'] });
    let customerId = atual.asaasCustomerId;
    if (!customerId) {
      customerId = await asaas.criarCustomer({ nome: atual.nome, cpfCnpj: documento, email: atual.email, telefone: atual.telefone, referencia: atual.id });
    } else if (cpfCnpj && cpfCnpj !== atual.cpfCnpj) {
      await asaas.atualizarCustomer(customerId, { nome: atual.nome, cpfCnpj: documento, email: atual.email, telefone: atual.telefone });
    }

    let assinaturaId = atual.asaasAssinaturaId;
    if (assinaturaId) {
      await asaas.atualizarAssinatura(assinaturaId, { valor, ciclo, forma: formaPagamento, descricao: descricaoAssinatura(plano, ciclo) });
    } else {
      assinaturaId = await asaas.criarAssinatura({
        customerId, valor, ciclo, forma: formaPagamento, primeiroVencimento: vencimento,
        descricao: descricaoAssinatura(plano, ciclo), referencia: atual.id,
      });
    }

    const cliente = await prisma.cliente.update({
      where: { id: clienteId },
      data: {
        plano, cicloAssinatura: ciclo, formaPagamento, cpfCnpj: documento,
        asaasCustomerId: customerId, asaasAssinaturaId: assinaturaId,
        // Assinou = ATIVA (mesmo no teste: os dias gratis restantes viram
        // carencia, porque a primeira cobranca so vence no fim do teste).
        statusAssinatura: ['TRIAL', 'CANCELADA'].includes(atual.statusAssinatura) ? 'ATIVA' : atual.statusAssinatura,
        proximaCobrancaEm: null, canceladoEm: null, motivoCancelamento: null,
      },
      select: { id: true, plano: true, cicloAssinatura: true, statusAssinatura: true },
    });

    // Link da cobranca em aberto mais proxima (pagina do Asaas: Pix, boleto ou cartao).
    const cobrancas = await asaas.cobrancasDaAssinatura(assinaturaId).catch(() => []);
    const aberta = cobrancas.find((c) => ['PENDING', 'OVERDUE'].includes(c.status));
    if (aberta) await sincronizarCobranca(clienteId, aberta);
    return { cliente, fatura: null, linkPagamento: aberta?.invoiceUrl || null, modo: 'AUTOMATICO' };
  }

  // Modo manual.
  const cliente = await prisma.cliente.update({
    where: { id: clienteId },
    data: {
      plano, cicloAssinatura: ciclo, formaPagamento, cpfCnpj: documento || undefined,
      statusAssinatura: 'ATIVA', proximaCobrancaEm: vencimento, canceladoEm: null, motivoCancelamento: null,
    },
    select: { id: true, plano: true, mensalidade: true, cicloAssinatura: true, statusAssinatura: true },
  });
  const fatura = await gerarFatura(cliente, vencimento);
  return { cliente, fatura, linkPagamento: null, modo: 'MANUAL' };
}

/** Cancela a assinatura. A conta fica so pra consulta; nada e apagado. */
async function cancelarAssinatura(clienteId, { motivo = null, agora = new Date() } = {}) {
  const c = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { asaasAssinaturaId: true } });
  if (!c) throw Object.assign(new Error('Cliente nao encontrado.'), { code: 'P2025' });
  if (c.asaasAssinaturaId && asaas.ativo()) {
    await asaas.cancelarAssinatura(c.asaasAssinaturaId).catch((e) => {
      if (e.status !== 404) throw e;
    });
  }
  await prisma.faturaAssinatura.updateMany({ where: { clienteId, status: 'ABERTA' }, data: { status: 'CANCELADA' } });
  const cliente = await prisma.cliente.update({
    where: { id: clienteId },
    data: { statusAssinatura: 'CANCELADA', asaasAssinaturaId: null, proximaCobrancaEm: null, canceladoEm: agora, motivoCancelamento: motivo ? String(motivo).slice(0, 300) : null },
    select: { id: true, statusAssinatura: true, canceladoEm: true },
  });
  await avisar(clienteId, {
    titulo: 'Assinatura cancelada',
    mensagem: 'Sua conta fica disponível só para consulta e exportação por 60 dias. Para voltar, é só escolher um plano.',
  });
  return cliente;
}

// ---------- cupom com prazo ----------
// Desconto de cupom por N meses fica registrado em ConfigPlataforma
// ('descontosTemporarios': [{ clienteId, ate }]). Vencido, a mensalidade
// volta ao preco do plano (inclusive na assinatura do Asaas).
const CHAVE_DESCONTOS = 'descontosTemporarios';

async function registrarDescontoTemporario(clienteId, ate) {
  const linha = await prisma.configPlataforma.findUnique({ where: { chave: CHAVE_DESCONTOS } });
  const lista = (Array.isArray(linha?.valor) ? linha.valor : []).filter((d) => d.clienteId !== clienteId);
  lista.push({ clienteId, ate: new Date(ate).toISOString() });
  await prisma.configPlataforma.upsert({ where: { chave: CHAVE_DESCONTOS }, create: { chave: CHAVE_DESCONTOS, valor: lista }, update: { valor: lista } });
}

async function reverterDescontosVencidos(agora = new Date()) {
  const linha = await prisma.configPlataforma.findUnique({ where: { chave: CHAVE_DESCONTOS } });
  const lista = Array.isArray(linha?.valor) ? linha.valor : [];
  const vencidos = lista.filter((d) => new Date(d.ate) <= agora);
  if (!vencidos.length) return 0;
  for (const d of vencidos) {
    const c = await prisma.cliente.update({
      where: { id: d.clienteId }, data: { mensalidade: 0 },
      select: { plano: true, cicloAssinatura: true, asaasAssinaturaId: true },
    }).catch(() => null);
    if (c?.asaasAssinaturaId && asaas.ativo()) {
      await asaas.atualizarAssinatura(c.asaasAssinaturaId, { valor: valorDoCiclo(c.plano, c.cicloAssinatura, 0) })
        .catch((e) => console.error('[assinatura/desconto] asaas', e?.message));
    }
    if (c) await avisar(d.clienteId, { titulo: 'Desconto do cupom terminou', mensagem: 'A partir da próxima fatura a mensalidade volta ao preço do seu plano.', whatsapp: false });
  }
  const resto = lista.filter((d) => new Date(d.ate) > agora);
  await prisma.configPlataforma.update({ where: { chave: CHAVE_DESCONTOS }, data: { valor: resto } });
  return vencidos.length;
}

/** Estende o teste gratis (admin). */
async function estenderTeste(clienteId, dias = 7, agora = new Date()) {
  const c = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { trialAte: true, statusAssinatura: true } });
  if (!c) throw Object.assign(new Error('Cliente nao encontrado.'), { code: 'P2025' });
  const base = c.trialAte && new Date(c.trialAte) > agora ? new Date(c.trialAte) : agora;
  return prisma.cliente.update({
    where: { id: clienteId },
    data: { statusAssinatura: 'TRIAL', trialAte: new Date(base.getTime() + dias * DIA_MS) },
    select: { id: true, statusAssinatura: true, trialAte: true },
  });
}

/**
 * Qual fatura local recebe uma cobranca do Asaas. PURA (testavel).
 * - Achou pelo id da cobranca -> atualiza essa.
 * - Senao, a do mes (competencia): sem id externo -> adota; com OUTRO id:
 *   evento de cancelamento/estorno (de outra cobranca) nao mexe nela; fatura
 *   ja paga nao e trocada; cobranca nova paga (ou fatura do mes cancelada)
 *   passa a ser a da fatura; o resto e ignorado.
 * - Sem fatura no mes -> cria.
 * @returns {{acao:'atualizar'|'criar'|'ignorar', fatura:Object|null, motivo?:string}}
 */
function escolherFatura({ porId, porCompetencia, status }) {
  if (porId) return { acao: 'atualizar', fatura: porId };
  if (!porCompetencia) return { acao: 'criar', fatura: null };
  if (!porCompetencia.cobrancaExternaId) {
    // Paga a mao (sem id) e chega o cancelamento da cobranca do Asaas: nao despaga.
    if (porCompetencia.status === 'PAGA' && status === 'CANCELADA') return { acao: 'ignorar', fatura: porCompetencia, motivo: 'fatura do mes ja paga' };
    return { acao: 'atualizar', fatura: porCompetencia };
  }
  if (status === 'CANCELADA') return { acao: 'ignorar', fatura: porCompetencia, motivo: 'cancelamento de outra cobranca do mes' };
  if (porCompetencia.status === 'PAGA') return { acao: 'ignorar', fatura: porCompetencia, motivo: 'fatura do mes ja paga por outra cobranca' };
  if (status === 'PAGA' || porCompetencia.status === 'CANCELADA') return { acao: 'atualizar', fatura: porCompetencia };
  return { acao: 'ignorar', fatura: porCompetencia, motivo: 'fatura do mes ja ligada a outra cobranca' };
}

/**
 * Espelha uma cobranca do Asaas como fatura local (cria ou atualiza).
 * Devolve a fatura + `statusAnterior` (e `ignorada: true` quando a cobranca
 * nao mexeu em nada) pra quem chama saber se ela acabou de ser paga.
 * @param {string} clienteId
 * @param {{ id: string, value: number, dueDate: string, status: string, invoiceUrl?: string, billingType?: string, paymentDate?: string }} pg
 */
async function sincronizarCobranca(clienteId, pg) {
  const vencimento = new Date(`${pg.dueDate}T12:00:00-03:00`);
  const competencia = competenciaDe(vencimento);
  const status = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(pg.status) ? 'PAGA'
    : pg.status === 'OVERDUE' ? 'VENCIDA'
      : ['REFUNDED', 'DELETED', 'CANCELLED', 'CANCELED'].includes(pg.status) ? 'CANCELADA'
        : 'ABERTA';

  // Casa primeiro pelo id da cobranca; so pela competencia quando a fatura do
  // mes ainda nao tem id externo (ver escolherFatura).
  const porId = await prisma.faturaAssinatura.findFirst({ where: { clienteId, cobrancaExternaId: pg.id } });
  const porCompetencia = porId ? null : await prisma.faturaAssinatura.findFirst({ where: { clienteId, competencia } });
  const escolha = escolherFatura({ porId, porCompetencia, status });
  if (escolha.acao === 'ignorar') {
    console.warn(`[assinatura/fatura] cobranca ${pg.id} (${pg.status}) ignorada: ${escolha.motivo} (cliente=${clienteId}, competencia=${competencia}).`);
    return { ...escolha.fatura, ignorada: true, statusAnterior: escolha.fatura.status };
  }
  const existente = escolha.fatura;
  const dados = {
    valor: Number(pg.value), vencimento, cobrancaExternaId: pg.id,
    linkPagamento: pg.invoiceUrl || null, formaPagamento: pg.billingType || null,
  };
  if (existente) {
    // Nunca "despaga": PAGA so sai por estorno (REFUNDED) desta mesma cobranca.
    const estornoDela = pg.status === 'REFUNDED' && existente.cobrancaExternaId === pg.id;
    const novoStatus = existente.status === 'PAGA' && !estornoDela ? 'PAGA' : status;
    const fatura = await prisma.faturaAssinatura.update({
      where: { id: existente.id },
      data: { ...dados, status: novoStatus, pagaEm: novoStatus === 'PAGA' ? (existente.pagaEm || new Date(pg.paymentDate || Date.now())) : null },
    });
    return { ...fatura, statusAnterior: existente.status };
  }
  const fatura = await prisma.faturaAssinatura.create({
    data: { clienteId, competencia, ...dados, status, pagaEm: status === 'PAGA' ? new Date(pg.paymentDate || Date.now()) : null },
  });
  return { ...fatura, statusAnterior: null };
}

// ---------- regua ----------

function diasEntre(a, b) {
  // dias corridos de b ate a, no calendario de Brasilia
  const dia = (d) => new Date(new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })).getTime();
  return Math.round((dia(a) - dia(b)) / DIA_MS);
}

function textoRegua(passo, fatura) {
  const link = fatura.linkPagamento ? `\nPague por aqui: ${fatura.linkPagamento}` : '\nVeja como pagar em Plano e cobrança, dentro do Sellergy.';
  const valor = brl(fatura.valor);
  if (passo === -3) return { titulo: 'Sua fatura vence em 3 dias', mensagem: `A mensalidade do Sellergy (${valor}) vence em ${dataBr(fatura.vencimento)}.${link}` };
  if (passo === 0) return { titulo: 'Sua fatura vence hoje', mensagem: `A mensalidade do Sellergy (${valor}) vence hoje.${link}` };
  if (passo === 7) {
    return { titulo: 'Último aviso antes de limitar a conta', mensagem: `A mensalidade (${valor}) está em atraso há 7 dias. Em ${DIAS_ATE_SUSPENDER - 7} dias a conta fica só para consulta.${link}` };
  }
  return { titulo: 'Mensalidade em atraso', mensagem: `A mensalidade do Sellergy (${valor}) venceu em ${dataBr(fatura.vencimento)}. Regularize para não ter a conta limitada.${link}` };
}

async function rodarRegua(agora = new Date()) {
  let enviados = 0;
  const faturas = await prisma.faturaAssinatura.findMany({
    where: {
      status: { in: ['ABERTA', 'VENCIDA'] },
      vencimento: { gte: new Date(agora.getTime() - 8 * DIA_MS), lte: new Date(agora.getTime() + 4 * DIA_MS) },
      cliente: { statusAssinatura: { not: 'CANCELADA' } },
    },
    select: { id: true, clienteId: true, valor: true, vencimento: true, linkPagamento: true, avisosRegua: true },
  });
  for (const f of faturas) {
    const passo = diasEntre(agora, f.vencimento);
    const jaAvisados = Array.isArray(f.avisosRegua) ? f.avisosRegua : [];
    if (!REGUA.includes(passo) || jaAvisados.includes(passo)) continue;
    await avisar(f.clienteId, { ...textoRegua(passo, f), dados: { faturaId: f.id } });
    await prisma.faturaAssinatura.update({ where: { id: f.id }, data: { avisosRegua: [...jaAvisados, passo] } });
    enviados += 1;
  }
  return enviados;
}

/** Rotina diaria. Devolve um resumo pra log. */
async function processarAssinaturas(agora = new Date()) {
  const resumo = { faturasGeradas: 0, faturasVencidas: 0, statusAlterados: 0, avisosTrial: 0, avisosRegua: 0, descontosEncerrados: 0 };

  // 1. Faturas a gerar (so modo manual: no automatico quem gera e o Asaas).
  const limite = new Date(agora.getTime() + DIAS_ANTES_PARA_FATURAR * DIA_MS);
  const aFaturar = await prisma.cliente.findMany({
    where: { statusAssinatura: { in: ['ATIVA', 'ATRASADA'] }, asaasAssinaturaId: null, proximaCobrancaEm: { lte: limite } },
    select: { id: true, plano: true, mensalidade: true, cicloAssinatura: true, proximaCobrancaEm: true },
  });
  for (const c of aFaturar) {
    await gerarFatura(c, c.proximaCobrancaEm);
    resumo.faturasGeradas += 1;
  }

  // 2. Abertas que venceram.
  const venc = await prisma.faturaAssinatura.updateMany({ where: { status: 'ABERTA', vencimento: { lt: new Date(agora.getTime() - DIA_MS) } }, data: { status: 'VENCIDA' } });
  resumo.faturasVencidas = venc.count;

  // 3. Status de quem tem fatura vencida ou estava atrasado/suspenso.
  const afetados = await prisma.cliente.findMany({
    where: { OR: [{ statusAssinatura: { in: ['ATRASADA', 'SUSPENSA'] } }, { faturasAssinatura: { some: { status: 'VENCIDA' } } }] },
    select: { id: true, statusAssinatura: true },
  });
  for (const c of afetados) {
    const novo = await recalcularStatus(c.id, agora);
    if (novo && novo !== c.statusAssinatura) resumo.statusAlterados += 1;
  }

  // 3b. Cupom com prazo que acabou.
  resumo.descontosEncerrados = await reverterDescontosVencidos(agora);

  // 4a. Regua de cobranca.
  resumo.avisosRegua = await rodarRegua(agora);

  // 4b. Teste gratis acabando (3 e 1 dia antes) ou acabado hoje.
  const trials = await prisma.cliente.findMany({
    where: { statusAssinatura: 'TRIAL', trialAte: { lte: new Date(agora.getTime() + 3 * DIA_MS), gte: new Date(agora.getTime() - DIA_MS) } },
    select: { id: true, plano: true, statusAssinatura: true, trialAte: true },
  });
  for (const c of trials) {
    const s = situacaoAssinatura(c, agora);
    if (s.diasRestantesTrial === 3 || s.diasRestantesTrial === 1) {
      await avisar(c.id, { titulo: 'Seu teste grátis está acabando', mensagem: `Faltam ${s.diasRestantesTrial} dia(s) dos ${DIAS_DE_TRIAL} dias grátis. Escolha um plano para continuar sem interrupção: seus dados ficam do jeito que estão. Se assinar agora, a primeira cobrança só vence no fim do teste.` });
      resumo.avisosTrial += 1;
    } else if (s.aviso === 'TRIAL_VENCIDO') {
      await avisar(c.id, { titulo: 'Seu teste grátis terminou', mensagem: 'Seus dados estão salvos. Escolha um plano para voltar a registrar vendas e agendamentos.' });
      resumo.avisosTrial += 1;
    }
  }
  return resumo;
}

/** Roda uma vez por dia (09:00, horario de gente) no worker. */
function iniciarRotinaAssinaturas({ hora = 9 } = {}) {
  let timer = null;
  const rodar = async () => {
    try {
      const r = await processarAssinaturas();
      console.log('[assinaturas]', JSON.stringify(r));
      const { limparEnquetesAntigas } = require('../services/baileys/gerenciadorConexao');
      await limparEnquetesAntigas().catch(() => {});
    } catch (e) {
      console.error('[assinaturas] rotina falhou:', e?.message);
    }
  };
  const agendarProxima = () => {
    const agora = new Date();
    const proxima = new Date(agora);
    proxima.setHours(hora, 0, 0, 0);
    if (proxima <= agora) proxima.setDate(proxima.getDate() + 1);
    timer = setTimeout(async () => { await rodar(); agendarProxima(); }, proxima.getTime() - agora.getTime());
  };
  agendarProxima();
  return () => clearTimeout(timer);
}

module.exports = {
  competenciaDe,
  somarUmMes,
  somarMeses,
  valorDoCiclo,
  valorDaFatura,
  gerarFatura,
  recalcularStatus,
  marcarFaturaPaga,
  assinarPlano,
  cancelarAssinatura,
  estenderTeste,
  registrarDescontoTemporario,
  reverterDescontosVencidos,
  sincronizarCobranca,
  escolherFatura,
  rodarRegua,
  diasEntre,
  processarAssinaturas,
  iniciarRotinaAssinaturas,
  DIAS_ANTES_PARA_FATURAR,
  REGUA,
};
