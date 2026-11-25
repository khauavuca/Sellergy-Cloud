// Regras de cupom de desconto. Cupom pertence a 1 tenant; codigo unico por
// clienteId, sempre normalizado pra MAIUSCULO/sem espaco (tanto na criacao
// quanto na busca) pra "promo10" e "PROMO10" serem o mesmo cupom.

const prisma = require('../prisma');

function normalizarCodigo(codigo) {
  return String(codigo || '').trim().toUpperCase();
}

/**
 * Valida se um cupom pode ser usado AGORA, pra um valorTotal dado. Funcao
 * pura — recebe o cupom ja buscado do banco, nao busca nada sozinha.
 * @param {{cupom:Object|null, valorTotal:number, agora?:Date}} p
 * @returns {{valido:boolean, motivo?:string, valorDesconto?:number, valorComDesconto?:number}}
 */
function validarCupom({ cupom, valorTotal, agora = new Date() }) {
  if (!cupom) return { valido: false, motivo: 'Cupom nao encontrado.' };
  if (!cupom.ativo) return { valido: false, motivo: 'Cupom inativo.' };
  if (cupom.validoAte && new Date(cupom.validoAte).getTime() < agora.getTime()) {
    return { valido: false, motivo: 'Cupom expirado.' };
  }
  if (cupom.usoMaximo != null && cupom.usosAtuais >= cupom.usoMaximo) {
    return { valido: false, motivo: 'Cupom esgotado (limite de uso atingido).' };
  }
  if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
    return { valido: false, motivo: 'Valor da venda invalido.' };
  }

  // Desconto fixo (VALOR) nunca passa do total — venda nao fica negativa.
  const valorDesconto = cupom.tipo === 'PERCENTUAL'
    ? Math.round(valorTotal * (cupom.valor / 100) * 100) / 100
    : Math.min(cupom.valor, valorTotal);
  const valorComDesconto = Math.max(0, Math.round((valorTotal - valorDesconto) * 100) / 100);

  return { valido: true, valorDesconto, valorComDesconto };
}

// Busca o cupom do tenant pelo codigo (normalizado). Nao filtra por `ativo`
// aqui de proposito — validarCupom() ja rejeita inativo com motivo claro,
// em vez de um generico "nao encontrado" que confundiria o lojista.
async function buscarCupom(clienteId, codigo) {
  const codigoSan = normalizarCodigo(codigo);
  if (!codigoSan) return null;
  return prisma.cupom.findFirst({ where: { clienteId, codigo: codigoSan } });
}

// Consome 1 uso do cupom. Roda DENTRO da transacao da venda (tx). O
// incremento e CONDICIONAL (ativo, nao expirado e usosAtuais < usoMaximo) num
// UPDATE so: com 10 vendas paralelas de um cupom de 1 uso, o Postgres trava a
// linha e reavalia o WHERE, entao so 1 incrementa. Devolve true se consumiu;
// false = esgotou/expirou entre a validacao e a gravacao (quem chama desfaz).
async function registrarUsoCupom(tx, cupomId, agora = new Date()) {
  const r = await tx.cupom.updateMany({
    where: {
      id: cupomId,
      ativo: true,
      AND: [
        { OR: [{ validoAte: null }, { validoAte: { gte: agora } }] },
        { OR: [{ usoMaximo: null }, { usosAtuais: { lt: prisma.cupom.fields.usoMaximo } }] },
      ],
    },
    data: { usosAtuais: { increment: 1 } },
  });
  return r.count === 1;
}

module.exports = { validarCupom, buscarCupom, registrarUsoCupom, normalizarCodigo };
