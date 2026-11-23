// =====================================================================
// PLANOS E PRECOS editaveis pelo admin + cupons da assinatura
// =====================================================================
// Preco mensal e limites ficam em PlanoConfig e sobrepoem o catalogo do
// codigo (planos/catalogo.js). Recursos (o que cada plano libera) NAO sao
// editaveis aqui: mudar recurso e decisao de produto, fica no codigo.
//
// Regra do preco novo: vale pra quem assinar a partir de agora. Quem JA
// assina (ativa, atrasada, suspensa, ou com assinatura no Asaas) e paga o
// preco de tabela ganha o preco antigo gravado em Cliente.mensalidade (o
// mesmo campo do "preco negociado"), entao a proxima fatura nao muda. Isso so
// acontece quando o preco SOBE; quando desce, quem paga tabela passa a pagar o
// novo valor na proxima fatura (gerada localmente). A assinatura recorrente
// no Asaas guarda o proprio valor: mudar la e outro passo (nao automatico).
//
// Cupons: sem modelo proprio no banco, ficam em ConfigPlataforma 'cupons'.
// Aqui so cadastra/lista/desliga. Pra aplicar no POST /conta/assinar (outra
// frente), ver validarCupomParaAssinatura() abaixo.
// =====================================================================

const prisma = require('../prisma');
const { PLANOS, PLANOS_BASE, LIMITES, ILIMITADO, planosPersonalizados } = require('../planos/catalogo');

const CHAVE_CUPONS = 'cupons';
const STATUS_ASSINANTE = ['ATIVA', 'ATRASADA', 'SUSPENSA'];

function limitesParaJson(limites) {
  return Object.fromEntries(Object.entries(limites).map(([k, v]) => [k, v === ILIMITADO ? null : v]));
}

/** Valida { precoMensal, limites } do PUT. */
function validarPlano(corpo) {
  const campos = [];
  const preco = Number(corpo?.precoMensal);
  if (!Number.isFinite(preco) || preco < 1 || preco > 100_000) campos.push('precoMensal');
  const limites = {};
  const entrada = corpo?.limites && typeof corpo.limites === 'object' ? corpo.limites : {};
  for (const chave of LIMITES) {
    const v = entrada[chave];
    if (v === undefined) continue;
    if (v === null) { limites[chave] = null; continue; } // ilimitado
    if (!Number.isInteger(v) || v < 0 || v > 1_000_000) campos.push(`limites.${chave}`);
    else limites[chave] = v;
  }
  if (campos.length) return { erro: 'Confira o preço (a partir de R$ 1,00) e os limites (números inteiros).', campos };
  return { dados: { precoMensal: Math.round(preco * 100) / 100, limites } };
}

async function listarPlanos() {
  const [contagem, linhas] = await Promise.all([
    prisma.cliente.groupBy({ by: ['plano', 'statusAssinatura'], _count: { _all: true } }),
    prisma.planoConfig.findMany(),
  ]);
  const editados = new Set(planosPersonalizados());
  const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));
  return Object.values(PLANOS).map((p) => {
    const clientes = contagem.filter((g) => g.plano === p.codigo);
    const somar = (pred) => clientes.filter(pred).reduce((t, g) => t + g._count._all, 0);
    const base = PLANOS_BASE[p.codigo];
    return {
      codigo: p.codigo,
      nome: p.nome,
      descricao: p.descricao,
      precoMensal: p.precoMensal,
      limites: limitesParaJson(p.limites),
      recursos: { ...p.recursos },
      padrao: { precoMensal: base.precoMensal, limites: limitesParaJson(base.limites) },
      personalizado: editados.has(p.codigo),
      atualizadoEm: porCodigo.get(p.codigo)?.atualizadoEm || null,
      clientes: {
        pagantes: somar((g) => ['ATIVA', 'ATRASADA'].includes(g.statusAssinatura)),
        emTeste: somar((g) => g.statusAssinatura === 'TRIAL'),
        total: somar((g) => g.statusAssinatura !== 'CANCELADA'),
      },
    };
  });
}

/**
 * Grava o preco/limite e protege quem ja assina (preco antigo em
 * Cliente.mensalidade quando o preco sobe). Devolve { mantidos }.
 */
async function salvarPlano(codigo, { precoMensal, limites }, usuarioNome) {
  const anterior = PLANOS[codigo];
  let mantidos = 0;
  await prisma.$transaction(async (tx) => {
    if (precoMensal > anterior.precoMensal) {
      const r = await tx.cliente.updateMany({
        where: {
          plano: codigo,
          mensalidade: { lte: 0 },
          statusAssinatura: { not: 'CANCELADA' },
          OR: [{ statusAssinatura: { in: STATUS_ASSINANTE } }, { asaasAssinaturaId: { not: null } }],
        },
        data: { mensalidade: anterior.precoMensal },
      });
      mantidos = r.count;
    }
    const limitesFinais = { ...limitesParaJson(PLANOS_BASE[codigo].limites), ...limitesParaJson(anterior.limites), ...limites };
    await tx.planoConfig.upsert({
      where: { codigo },
      create: { codigo, precoMensal, limites: limitesFinais, atualizadoPor: usuarioNome || null },
      update: { precoMensal, limites: limitesFinais, atualizadoPor: usuarioNome || null },
    });
  });
  return { mantidos, anterior: { precoMensal: anterior.precoMensal, limites: limitesParaJson(anterior.limites) } };
}

/** Volta o plano ao preco/limite do codigo (mesma regra de quem ja assina). */
async function restaurarPadrao(codigo, usuarioNome) {
  const base = PLANOS_BASE[codigo];
  const r = await salvarPlano(codigo, { precoMensal: base.precoMensal, limites: limitesParaJson(base.limites) }, usuarioNome);
  await prisma.planoConfig.deleteMany({ where: { codigo } });
  return r;
}

// ---------- Cupons ----------

const CODIGO_CUPOM = /^[A-Z0-9]{3,20}$/;

function validarCupom(corpo, existentes = []) {
  const campos = [];
  const codigo = typeof corpo?.codigo === 'string' ? corpo.codigo.trim().toUpperCase() : '';
  const tipo = corpo?.tipo;
  const valor = Number(corpo?.valor);
  const duracaoMeses = corpo?.duracaoMeses === null || corpo?.duracaoMeses === undefined || corpo?.duracaoMeses === '' ? null : Number(corpo.duracaoMeses);
  const limiteUsos = corpo?.limiteUsos === null || corpo?.limiteUsos === undefined || corpo?.limiteUsos === '' ? null : Number(corpo.limiteUsos);
  const validoAte = corpo?.validoAte ? new Date(`${corpo.validoAte}T23:59:59`) : null;
  const descricao = typeof corpo?.descricao === 'string' ? corpo.descricao.trim().slice(0, 120) : '';
  if (!CODIGO_CUPOM.test(codigo)) campos.push('codigo');
  else if (existentes.some((c) => c.codigo === codigo)) campos.push('codigo');
  if (!['PERCENTUAL', 'MESES_GRATIS'].includes(tipo)) campos.push('tipo');
  if (tipo === 'PERCENTUAL' && (!Number.isFinite(valor) || valor < 1 || valor > 100)) campos.push('valor');
  if (tipo === 'MESES_GRATIS' && (!Number.isInteger(valor) || valor < 1 || valor > 12)) campos.push('valor');
  if (duracaoMeses !== null && (!Number.isInteger(duracaoMeses) || duracaoMeses < 1 || duracaoMeses > 36)) campos.push('duracaoMeses');
  if (limiteUsos !== null && (!Number.isInteger(limiteUsos) || limiteUsos < 1 || limiteUsos > 100_000)) campos.push('limiteUsos');
  if (validoAte && (Number.isNaN(validoAte.getTime()) || validoAte < new Date())) campos.push('validoAte');
  if (campos.length) {
    const repetido = campos.includes('codigo') && existentes.some((c) => c.codigo === codigo);
    return { erro: repetido ? 'Já existe um cupom com esse código.' : 'Confira os campos do cupom.', campos };
  }
  return {
    cupom: {
      codigo, tipo, valor, descricao: descricao || null,
      duracaoMeses: tipo === 'MESES_GRATIS' ? null : duracaoMeses,
      limiteUsos, validoAte: validoAte ? validoAte.toISOString() : null,
      usos: 0, ativo: true,
    },
  };
}

async function lerCupons() {
  const linha = await prisma.configPlataforma.findUnique({ where: { chave: CHAVE_CUPONS } });
  return Array.isArray(linha?.valor) ? linha.valor : [];
}

async function gravarCupons(lista) {
  await prisma.configPlataforma.upsert({ where: { chave: CHAVE_CUPONS }, create: { chave: CHAVE_CUPONS, valor: lista }, update: { valor: lista } });
  return lista;
}

/**
 * Pra quem for plugar no POST /conta/assinar: devolve { ok, cupom, erro }.
 * Depois de criar a assinatura, somar 1 em `usos` com gravarCupons().
 * Desconto PERCENTUAL: valor da mensalidade * (1 - valor/100) por duracaoMeses
 * (null = sempre). MESES_GRATIS: primeiras `valor` faturas zeradas.
 */
function validarCupomParaAssinatura(cupons, codigo, agora = new Date()) {
  const c = cupons.find((x) => x.codigo === String(codigo || '').trim().toUpperCase());
  if (!c || !c.ativo) return { ok: false, erro: 'Cupom inválido.' };
  if (c.validoAte && new Date(c.validoAte) < agora) return { ok: false, erro: 'Esse cupom venceu.' };
  if (c.limiteUsos && c.usos >= c.limiteUsos) return { ok: false, erro: 'Esse cupom já foi usado o máximo de vezes.' };
  return { ok: true, cupom: c };
}

module.exports = {
  CHAVE_CUPONS,
  validarPlano,
  listarPlanos,
  salvarPlano,
  restaurarPadrao,
  validarCupom,
  lerCupons,
  gravarCupons,
  validarCupomParaAssinatura,
};
