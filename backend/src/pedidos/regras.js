// =====================================================================
// PEDIDOS — regras puras (sem banco), testadas em regras.test.js.
// =====================================================================
// Tudo que decide dinheiro e estado do pedido mora aqui:
//   - recalcularPedido: preco SEMPRE do servidor (o navegador manda so
//     variacaoId + quantidade), estoque conferido, frete e pedido minimo;
//   - podeIr / TRANSICOES: quem pode virar o que;
//   - validarContato: nome, celular e CPF;
//   - textos do WhatsApp.
// =====================================================================

const { validarCpf } = require('../utils/validacaoFiscal');

const STATUS = Object.freeze({
  NOVO: 'NOVO',
  AGUARDANDO_PAGAMENTO: 'AGUARDANDO_PAGAMENTO',
  PAGO: 'PAGO',
  ENTREGUE: 'ENTREGUE',
  CANCELADO: 'CANCELADO',
});

// De -> para. PAGO so chega por pagamento (hook do PSP ou "marcar como pago");
// depois de PAGO nao cancela por aqui (exigiria estorno).
const TRANSICOES = Object.freeze({
  NOVO: ['AGUARDANDO_PAGAMENTO', 'PAGO', 'CANCELADO'],
  AGUARDANDO_PAGAMENTO: ['AGUARDANDO_PAGAMENTO', 'PAGO', 'CANCELADO'],
  PAGO: ['ENTREGUE'],
  ENTREGUE: [],
  CANCELADO: [],
});

function podeIr(de, para) {
  return Array.isArray(TRANSICOES[de]) && TRANSICOES[de].includes(para);
}

/** Status de onde se pode ir pra `para` (pro where do updateMany atomico). */
function origensPara(para) {
  return Object.keys(TRANSICOES).filter((de) => TRANSICOES[de].includes(para));
}

const MAX_ITENS = 30;
const MAX_QUANTIDADE = 99;
const HORAS_PARA_EXPIRAR = 24;

const centavos = (v) => Math.round(Number(v) * 100) / 100;

class ErroPedido extends Error {
  constructor(mensagem, { status = 422, codigo = 'PEDIDO_INVALIDO', campos } = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    if (campos) this.campos = campos;
  }
}

/**
 * Junta itens repetidos e valida formato. Entrada do navegador:
 * [{ variacaoId, quantidade }]. Qualquer outro campo (preco, nome) e ignorado.
 * @returns {Array<{variacaoId:string, quantidade:number}>}
 */
function normalizarItens(itens) {
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new ErroPedido('A sacola está vazia.', { campos: ['itens'] });
  }
  if (itens.length > MAX_ITENS) throw new ErroPedido(`No máximo ${MAX_ITENS} produtos por pedido.`, { campos: ['itens'] });
  const mapa = new Map();
  for (const it of itens) {
    const id = typeof it?.variacaoId === 'string' ? it.variacaoId.trim() : '';
    const q = Number(it?.quantidade);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroPedido('Produto inválido na sacola.', { campos: ['itens'] });
    if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTIDADE) {
      throw new ErroPedido(`Quantidade inválida (de 1 a ${MAX_QUANTIDADE}).`, { campos: ['itens'] });
    }
    mapa.set(id, (mapa.get(id) || 0) + q);
  }
  for (const [id, q] of mapa) {
    if (q > MAX_QUANTIDADE) throw new ErroPedido(`Quantidade inválida (de 1 a ${MAX_QUANTIDADE}).`, { campos: ['itens'] });
    mapa.set(id, q);
  }
  return [...mapa].map(([variacaoId, quantidade]) => ({ variacaoId, quantidade }));
}

function nomeDaVariacao(v) {
  const produto = v.produto?.nome || '';
  return v.nome && v.nome !== produto && !/^(padr[aã]o|unico|único)$/i.test(v.nome) ? `${produto} — ${v.nome}` : produto;
}

/**
 * Recalcula o pedido com os dados do BANCO.
 * @param {Array<{variacaoId:string, quantidade:number}>} itens  ja normalizados
 * @param {Map<string, Object>} variacoes  id -> variacao do banco com `produto`
 *   ({ id, nome, preco, estoqueAtual, produto: { id, nome, tipo, visibilidade } })
 * @param {{entrega:'RETIRADA'|'ENTREGA', aceitaRetirada:boolean, aceitaEntrega:boolean,
 *   freteEntrega?:number|null, pedidoMinimo?:number|null, freteManual?:number|null,
 *   conferirEstoque?:boolean, conferirMinimo?:boolean}} regras
 */
function recalcularPedido(itens, variacoes, regras) {
  const entrega = regras.entrega === 'ENTREGA' ? 'ENTREGA' : 'RETIRADA';
  if (entrega === 'ENTREGA' && !regras.aceitaEntrega) {
    throw new ErroPedido('Esta loja não faz entrega. Escolha retirar.', { campos: ['entrega'] });
  }
  if (entrega === 'RETIRADA' && !regras.aceitaRetirada) {
    throw new ErroPedido('Esta loja só faz entrega.', { campos: ['entrega'] });
  }

  const linhas = [];
  const semEstoque = [];
  for (const it of itens) {
    const v = variacoes.get(it.variacaoId);
    if (!v || !v.produto || v.produto.visibilidade !== 'ATIVO' || v.produto.tipo !== 'FISICO') {
      throw new ErroPedido('Um dos produtos não está mais disponível. Atualize a página.', { codigo: 'PRODUTO_INDISPONIVEL', campos: ['itens'] });
    }
    const preco = centavos(typeof v.preco === 'number' ? v.preco : 0);
    if (!(preco > 0)) {
      throw new ErroPedido('Um dos produtos está sem preço. Fale com a loja.', { codigo: 'PRODUTO_INDISPONIVEL', campos: ['itens'] });
    }
    if (regras.conferirEstoque !== false && (v.estoqueAtual ?? 0) < it.quantidade) {
      semEstoque.push({ variacaoId: v.id, nome: nomeDaVariacao(v), disponivel: Math.max(0, v.estoqueAtual ?? 0) });
    }
    linhas.push({
      variacaoId: v.id,
      produtoId: v.produto.id,
      nome: nomeDaVariacao(v),
      quantidade: it.quantidade,
      precoUnitario: preco,
      subtotal: centavos(preco * it.quantidade),
    });
  }
  if (semEstoque.length) {
    const e = new ErroPedido(
      semEstoque.length === 1
        ? `Só temos ${semEstoque[0].disponivel} de "${semEstoque[0].nome}" agora.`
        : 'Alguns produtos não têm a quantidade pedida.',
      { status: 409, codigo: 'SEM_ESTOQUE', campos: ['itens'] },
    );
    e.semEstoque = semEstoque;
    throw e;
  }

  const subtotal = centavos(linhas.reduce((t, l) => t + l.subtotal, 0));
  if (regras.conferirMinimo !== false && regras.pedidoMinimo > 0 && subtotal < regras.pedidoMinimo) {
    throw new ErroPedido(`O pedido mínimo é de ${brl(regras.pedidoMinimo)}.`, { codigo: 'PEDIDO_MINIMO', campos: ['itens'] });
  }
  let frete = 0;
  if (entrega === 'ENTREGA') {
    const manual = Number(regras.freteManual);
    frete = Number.isFinite(manual) && manual >= 0 && regras.freteManual !== null && regras.freteManual !== undefined
      ? centavos(manual)
      : centavos(Number(regras.freteEntrega) || 0);
  }
  return { entrega, itens: linhas, subtotal, frete, total: centavos(subtotal + frete) };
}

// ---------------------------------------------------------------------
// Contato
// ---------------------------------------------------------------------

/**
 * @returns {{nome:string, telefone:string, cpf:string|null, endereco:string|null, observacao:string|null}}
 */
function validarContato({ nome, telefone, cpf, endereco, observacao }, { exigeCpf = false, entrega = 'RETIRADA' } = {}) {
  const campos = [];
  const nomeLimpo = typeof nome === 'string' ? nome.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (nomeLimpo.length < 2) campos.push('nome');
  const tel = typeof telefone === 'string' ? telefone.replace(/\D/g, '') : '';
  if (tel.length < 10 || tel.length > 13) campos.push('telefone');
  const cpfDig = typeof cpf === 'string' ? cpf.replace(/\D/g, '') : '';
  if ((exigeCpf || cpfDig) && !validarCpf(cpfDig)) campos.push('cpf');
  const end = typeof endereco === 'string' ? endereco.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  if (entrega === 'ENTREGA' && end.length < 8) campos.push('endereco');
  const obs = typeof observacao === 'string' ? observacao.trim().slice(0, 300) : '';
  if (campos.length) throw new ErroPedido('Confira os campos destacados.', { campos });
  return {
    nome: nomeLimpo,
    telefone: tel,
    cpf: cpfDig || null,
    endereco: entrega === 'ENTREGA' ? end : null,
    observacao: obs || null,
  };
}

// ---------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------

function brl(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

function resumoItens(itens, max = 3) {
  const partes = (itens || []).slice(0, max).map((i) => `${i.quantidade}× ${i.nome}`);
  const resto = (itens || []).length - max;
  return resto > 0 ? `${partes.join(', ')} e mais ${resto}` : partes.join(', ');
}

function linkPedido(baseUrl, token) {
  return `${String(baseUrl || '').replace(/\/$/, '')}/pedido/${token}`;
}

const textos = {
  recebido: ({ pedido, negocio, link }) => `Oi, ${primeiroNome(pedido.nomeCliente)}! Recebemos seu pedido #${pedido.numero} na ${negocio}: ${resumoItens(pedido.itens)}, total ${brl(pedido.total)}. Já já mandamos o Pix por aqui. Acompanhe: ${link}`,
  cobranca: ({ pedido, negocio, link, pix }) => [
    `Oi, ${primeiroNome(pedido.nomeCliente)}! Separei pra você na ${negocio}: ${resumoItens(pedido.itens)}${pedido.frete > 0 ? ` + entrega ${brl(pedido.frete)}` : ''}, total ${brl(pedido.total)}.`,
    `Pague por aqui: ${link}`,
    pix ? `Ou use o Pix copia e cola:\n${pix}` : null,
    'Quando o pagamento cair, o pedido anda sozinho.',
  ].filter(Boolean).join('\n\n'),
  pago: ({ pedido }) => `Pagamento do pedido #${pedido.numero} confirmado! ${pedido.entrega === 'ENTREGA' ? 'Já estamos separando pra entrega.' : 'Já estamos separando. Avisamos quando puder retirar.'}`,
  entregue: ({ pedido }) => (pedido.entrega === 'ENTREGA'
    ? `Seu pedido #${pedido.numero} saiu pra entrega. Obrigado pela compra!`
    : `Seu pedido #${pedido.numero} foi retirado. Obrigado pela compra!`),
  cancelado: ({ pedido, motivo }) => `Seu pedido #${pedido.numero} foi cancelado${motivo ? `: ${motivo}` : '.'} Qualquer dúvida, é só responder aqui.`,
  expirado: ({ pedido }) => `O pedido #${pedido.numero} foi cancelado porque o pagamento não chegou em ${HORAS_PARA_EXPIRAR} horas. Se ainda quiser, é só fazer de novo.`,
};

module.exports = {
  STATUS,
  TRANSICOES,
  podeIr,
  origensPara,
  normalizarItens,
  recalcularPedido,
  validarContato,
  validarCpf,
  nomeDaVariacao,
  ErroPedido,
  brl,
  primeiroNome,
  resumoItens,
  linkPedido,
  textos,
  MAX_ITENS,
  MAX_QUANTIDADE,
  HORAS_PARA_EXPIRAR,
};
