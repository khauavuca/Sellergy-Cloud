// Teto de notas fiscais por mes (limite `notasMes` do catalogo de planos).
//
// Regra de negocio (docs/custos-e-ajustes-integracoes.md §4.3): por enquanto a
// nota e cobrada como adicional; mais adiante cada plano tera um teto
// (Essencial 0, Profissional 100, Negocio 300 por mes, excedente a combinar).
// Este modulo ja aplica o teto na emissao e alimenta o "uso do plano".
//
// Conta como nota do mes tudo que foi (ou esta sendo) emitido no provedor:
// PENDENTE, PROCESSANDO, EMITIDA e CANCELADA (nota cancelada ja foi emitida e
// cobrada pelo emissor). ERRO nao conta. A nota de teste do assistente nao
// vira DocumentoFiscal, entao tambem nao conta.

const prisma = require('../prisma');
const { CAMPOS_ASSINATURA, limiteDo, planoEfetivo, planoMaisBaratoCom } = require('../planos/recursos');
const { ILIMITADO, obterPlano } = require('../planos/catalogo');

const STATUS_QUE_CONTAM = ['PENDENTE', 'PROCESSANDO', 'EMITIDA', 'CANCELADA'];

function inicioDoMes(agora = new Date()) {
  return new Date(agora.getFullYear(), agora.getMonth(), 1);
}

async function contarNotasDoMes(clienteId, agora = new Date(), db = prisma) {
  return db.documentoFiscal.count({
    where: { clienteId, status: { in: STATUS_QUE_CONTAM }, criadoEm: { gte: inicioDoMes(agora) } },
  });
}

/**
 * Regra pura. Devolve null se cabe, ou o erro (403 LIMITE_DO_PLANO) se
 * `usadas + quantidade` passa do maximo.
 */
function avaliarLimiteNotas({ usadas, maximo, quantidade = 1, planoNome = '', planoSugerido = null, nomeSugerido = '' }) {
  if (maximo === ILIMITADO || !Number.isFinite(Number(maximo))) return null;
  if (usadas + quantidade <= maximo) return null;
  const mensagem = maximo <= 0
    ? `O plano ${planoNome} não inclui emissão de nota fiscal.`
    : `Seu plano ${planoNome} inclui até ${maximo} notas fiscais por mês e este mês já foram ${usadas}.`;
  const sugestao = planoSugerido ? ` Passe para o plano ${nomeSugerido} para emitir mais.` : ' Fale com o suporte para contratar notas adicionais.';
  return Object.assign(new Error(`${mensagem}${sugestao}`), {
    status: 403, codigo: 'LIMITE_DO_PLANO', limite: 'notasMes', maximo, uso: usadas, planoSugerido,
  });
}

/** Lanca 403 LIMITE_DO_PLANO se emitir `quantidade` nota(s) agora passa do teto. */
async function garantirLimiteNotas({ clienteId, quantidade = 1, agora = new Date(), db = prisma }) {
  const cliente = await db.cliente.findUnique({ where: { id: clienteId }, select: CAMPOS_ASSINATURA });
  if (!cliente) return;
  const maximo = limiteDo(cliente, 'notasMes', agora);
  if (maximo === ILIMITADO) return;
  const usadas = await contarNotasDoMes(clienteId, agora, db);
  const sugerido = planoMaisBaratoCom((p) => (p.limites.notasMes ?? 0) >= usadas + quantidade);
  const erro = avaliarLimiteNotas({
    usadas, maximo, quantidade,
    planoNome: planoEfetivo(cliente, agora).nome,
    planoSugerido: sugerido,
    nomeSugerido: sugerido ? obterPlano(sugerido).nome : '',
  });
  if (erro) throw erro;
}

module.exports = { STATUS_QUE_CONTAM, inicioDoMes, contarNotasDoMes, avaliarLimiteNotas, garantirLimiteNotas };
