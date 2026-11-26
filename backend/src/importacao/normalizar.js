// =====================================================================
// IMPORTAR PLANILHA — regras puras (sem banco): normalizacao, mapeamento
// automatico de colunas, validacao por linha e duplicados dentro do arquivo.
// =====================================================================
// A planilha e lida no NAVEGADOR (CSV ou XLSX) e chega aqui ja como linhas
// { campo: valor } depois do mapeamento. O servidor nunca confia no que o
// front "corrigiu": valida tudo de novo antes de gravar.
// =====================================================================

const { validarCpf } = require('../utils/validacaoFiscal');

const TIPOS = ['CLIENTES', 'PRODUTOS', 'SERVICOS'];
const LIMITE_LINHAS = 5000;

// Campos de destino por tipo (a ordem e a ordem da tela).
const CAMPOS = {
  CLIENTES: ['nome', 'telefone', 'email', 'cpf', 'nascimento', 'observacoes'],
  PRODUTOS: ['nome', 'preco', 'custo', 'estoque', 'sku', 'categoria', 'descricao'],
  SERVICOS: ['nome', 'preco', 'duracao', 'categoria', 'descricao'],
};

const ROTULOS = {
  nome: 'Nome',
  telefone: 'Celular (WhatsApp)',
  email: 'E-mail',
  cpf: 'CPF',
  nascimento: 'Aniversário',
  observacoes: 'Anotações',
  preco: 'Preço de venda',
  custo: 'Custo',
  estoque: 'Estoque',
  sku: 'Código / código de barras',
  categoria: 'Categoria',
  descricao: 'Descrição',
  duracao: 'Duração (minutos)',
};

// Nomes de coluna comuns (inclusive de outros sistemas: Trinks, Avec,
// Belasis, Simples Agenda, Bling, Tiny, planilha do contador). Ja na forma
// "chave" (minusculo, sem acento, so letras e numeros).
const SINONIMOS = {
  nome: ['nome', 'nomecompleto', 'nomedocliente', 'nomecliente', 'cliente', 'paciente', 'nomedopaciente', 'name', 'fullname',
    'produto', 'nomedoproduto', 'nomeproduto', 'servico', 'nomedoservico', 'nomeservico', 'procedimento', 'item', 'titulo'],
  telefone: ['celular', 'telefone', 'whatsapp', 'whats', 'zap', 'cel', 'fone', 'tel', 'telefonecelular', 'celular1', 'telefone1',
    'fone1', 'telcelular', 'phone', 'mobile', 'numero', 'contato'],
  email: ['email', 'mail', 'emailprincipal', 'correioeletronico'],
  cpf: ['cpf', 'cpfcnpj', 'documento', 'doc', 'numerodocpf'],
  nascimento: ['nascimento', 'datanascimento', 'datadenascimento', 'dtnascimento', 'dtnasc', 'nasc', 'aniversario', 'niver',
    'birthday', 'birthdate', 'datadeaniversario'],
  observacoes: ['observacoes', 'observacao', 'obs', 'anotacoes', 'anotacao', 'notas', 'nota', 'comentarios', 'comentario', 'notes'],
  preco: ['preco', 'precovenda', 'precodevenda', 'valor', 'valorvenda', 'valordevenda', 'venda', 'pvenda', 'price',
    'precounitario', 'valorunitario', 'precofinal'],
  custo: ['custo', 'precocusto', 'precodecusto', 'valorcusto', 'valordecusto', 'custounitario', 'cost', 'precocompra', 'precodecompra'],
  estoque: ['estoque', 'quantidade', 'qtd', 'qtde', 'quant', 'saldo', 'estoqueatual', 'saldoestoque', 'stock', 'unidades'],
  sku: ['sku', 'codigo', 'cod', 'codigodebarras', 'codbarras', 'codigobarras', 'ean', 'gtin', 'barcode', 'referencia', 'ref',
    'codigointerno'],
  categoria: ['categoria', 'grupo', 'departamento', 'secao', 'category', 'familia', 'tipo'],
  descricao: ['descricao', 'detalhes', 'description', 'descricaocompleta'],
  duracao: ['duracao', 'duracaominutos', 'duracaomin', 'tempo', 'tempoemminutos', 'minutos', 'tempodeatendimento', 'tempomedio'],
};

function chave(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Sugere o campo de destino de cada coluna. Cada campo recebe no maximo uma
 * coluna (a de melhor nota). Retorna { [coluna]: campo | null }.
 */
function sugerirMapeamento(cabecalhos, tipo) {
  const campos = CAMPOS[tipo] || [];
  const candidatos = [];
  (cabecalhos || []).forEach((col, idx) => {
    const k = chave(col);
    if (!k) return;
    for (const campo of campos) {
      for (const s of SINONIMOS[campo] || []) {
        let nota = 0;
        if (k === s) nota = 100;
        else if (s.length >= 3 && k.startsWith(s)) nota = 60 + s.length;
        else if (s.length >= 4 && k.includes(s)) nota = 40 + s.length;
        if (nota) candidatos.push({ idx, campo, nota });
      }
    }
  });
  candidatos.sort((a, b) => b.nota - a.nota || a.idx - b.idx);
  const resultado = {};
  (cabecalhos || []).forEach((c) => { resultado[c] = null; });
  const usadosCampo = new Set();
  const usadasColuna = new Set();
  for (const c of candidatos) {
    if (usadosCampo.has(c.campo) || usadasColuna.has(c.idx)) continue;
    usadosCampo.add(c.campo);
    usadasColuna.add(c.idx);
    resultado[cabecalhos[c.idx]] = c.campo;
  }
  // Muitos sistemas de loja chamam o nome do produto de "Descricao".
  if (tipo !== 'CLIENTES' && !usadosCampo.has('nome')) {
    const col = Object.keys(resultado).find((c) => resultado[c] === 'descricao');
    if (col) resultado[col] = 'nome';
  }
  return resultado;
}

// ---------------------------------------------------------------------
// Normalizacao de valores
// ---------------------------------------------------------------------

// DDDs validos no Brasil (Anatel).
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

function texto(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

/**
 * Telefone BR -> "55" + DDD + numero (celular com 9 digitos).
 * Retorna { valor } | { erro, sugestao? } | { valor: null } (vazio).
 * `corrigido` = true quando o numero mudou alem da mascara (ex.: ganhou o 9).
 */
function normalizarTelefone(entrada, { dddPadrao = null } = {}) {
  const bruto = texto(entrada);
  if (!bruto) return { valor: null };
  let d = bruto.replace(/\D/g, '');
  if (!d) return { erro: 'Celular sem números' };
  const comZero = d.startsWith('0');
  d = d.replace(/^0+/, '');
  // 0 + operadora + DDD (ex.: 0 21 11 98888-7777)
  if (comZero && (d.length === 12 || d.length === 13)) {
    const semOperadora = d.slice(2);
    if (DDDS.has(Number(semOperadora.slice(0, 2)))) d = semOperadora;
  }
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);

  let corrigido = false;
  if (d.length === 8 || d.length === 9) {
    const local = d.length === 8 && /^[6-9]/.test(d) ? `9${d}` : d;
    if (dddPadrao && DDDS.has(Number(dddPadrao))) {
      return {
        erro: `Celular sem DDD: ${bruto}`,
        sugestao: { valor: `55${dddPadrao}${local}`, texto: `Pôr ${dddPadrao}${local !== d ? ' e 9' : ''} na frente` },
      };
    }
    return { erro: `Celular sem DDD: ${bruto}` };
  }
  if (d.length === 10) {
    const ddd = Number(d.slice(0, 2));
    if (!DDDS.has(ddd)) return { erro: `DDD ${d.slice(0, 2)} não existe` };
    if (/^[6-9]/.test(d[2])) { d = `${d.slice(0, 2)}9${d.slice(2)}`; corrigido = true; }
  } else if (d.length === 11) {
    const ddd = Number(d.slice(0, 2));
    if (!DDDS.has(ddd)) return { erro: `DDD ${d.slice(0, 2)} não existe` };
    if (d[2] !== '9') return { erro: `Celular com dígito a mais: ${bruto}` };
  } else {
    return { erro: `Celular com ${d.length} dígitos: ${bruto}` };
  }
  return { valor: `55${d}`, corrigido };
}

const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/i;
function normalizarEmail(entrada) {
  const v = texto(entrada).toLowerCase();
  if (!v) return { valor: null };
  if (v.length > 160 || !EMAIL_RE.test(v)) return { erro: `E-mail inválido: ${v}` };
  return { valor: v };
}

function normalizarCpf(entrada) {
  const bruto = texto(entrada);
  if (!bruto) return { valor: null };
  let d = bruto.replace(/\D/g, '');
  // Excel come zero a esquerda de CPF numerico.
  if (d.length >= 9 && d.length < 11) d = d.padStart(11, '0');
  if (!validarCpf(d)) return { erro: `CPF inválido: ${bruto}` };
  return { valor: d };
}

// Datas: dd/mm/aaaa, dd/mm/aa, dd-mm-aaaa, aaaa-mm-dd, serial do Excel.
function normalizarData(entrada) {
  const bruto = texto(entrada);
  if (!bruto) return { valor: null };
  let ano; let mes; let dia;
  let m;
  if (/^\d{4,5}(\.\d+)?$/.test(bruto)) {
    // Arredonda: data gravada com fuso vira 32984,875 em vez de 32985.
    const serial = Math.round(Number(bruto));
    if (serial < 60 || serial > 80000) return { erro: `Data inválida: ${bruto}` };
    const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    ano = dt.getUTCFullYear(); mes = dt.getUTCMonth() + 1; dia = dt.getUTCDate();
  } else if ((m = bruto.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) {
    ano = Number(m[1]); mes = Number(m[2]); dia = Number(m[3]);
  } else if ((m = bruto.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    dia = Number(m[1]); mes = Number(m[2]); ano = Number(m[3]);
    if (m[3].length === 2) ano += ano > (new Date().getFullYear() % 100) ? 1900 : 2000;
  } else {
    return { erro: `Data inválida: ${bruto}` };
  }
  const dt = new Date(Date.UTC(ano, mes - 1, dia, 12));
  if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== dia || dt.getUTCMonth() !== mes - 1
    || ano < 1900 || dt.getTime() > Date.now()) {
    return { erro: `Data inválida: ${bruto}` };
  }
  return { valor: dt.toISOString().slice(0, 10) };
}

// "R$ 1.234,56", "1234.56", "1,5", 12 -> numero. Vazio -> null.
function normalizarNumero(entrada) {
  if (typeof entrada === 'number') return Number.isFinite(entrada) ? { valor: entrada } : { erro: 'Número inválido' };
  let v = texto(entrada).replace(/R\$|\s/gi, '');
  if (!v) return { valor: null };
  const negativo = v.startsWith('-');
  v = v.replace(/^-/, '');
  if (!/^[\d.,]+$/.test(v)) return { erro: `Número inválido: ${texto(entrada)}` };
  const ultVirg = v.lastIndexOf(',');
  const ultPonto = v.lastIndexOf('.');
  if (ultVirg > ultPonto) v = v.replace(/\./g, '').replace(',', '.');
  else if (ultPonto > ultVirg && ultVirg >= 0) v = v.replace(/,/g, '');
  else if (ultPonto >= 0 && (v.match(/\./g) || []).length > 1) v = v.replace(/\./g, '');
  else if (ultPonto >= 0 && /^\d{1,3}\.\d{3}$/.test(v)) v = v.replace('.', ''); // "1.500" = mil e quinhentos
  const n = Number(v);
  if (!Number.isFinite(n)) return { erro: `Número inválido: ${texto(entrada)}` };
  return { valor: negativo ? -n : n };
}

// "90", "1h30", "1:30", "01:30:00", "45 min" -> minutos.
function normalizarDuracao(entrada) {
  const bruto = texto(entrada).toLowerCase();
  if (!bruto) return { valor: null };
  let m;
  let min = null;
  if ((m = bruto.match(/^(\d{1,2}):(\d{2})(:\d{2})?$/))) min = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = bruto.match(/^(\d{1,2})\s*h\s*(\d{1,2})?\s*(m|min)?$/))) min = Number(m[1]) * 60 + Number(m[2] || 0);
  else if ((m = bruto.match(/^(\d{1,3})(\s*(m|min|minutos))?$/))) min = Number(m[1]);
  if (!min || min < 5 || min > 720) return { erro: `Duração inválida: ${texto(entrada)}` };
  return { valor: min };
}

// ---------------------------------------------------------------------
// Validacao de linhas
// ---------------------------------------------------------------------

function limitar(v, max) {
  const t = texto(v);
  return t ? t.slice(0, max) : null;
}

/** Valida e normaliza uma linha. Retorna { dados, problemas, avisos }. */
function validarLinha(tipo, bruta, { numero, dddPadrao } = {}) {
  const linha = bruta && typeof bruta === 'object' ? bruta : {};
  const dados = {};
  const problemas = [];
  const avisos = [];
  const problema = (campo, mensagem, sugestao) => problemas.push({ campo, mensagem, ...(sugestao ? { sugestao } : {}) });

  dados.nome = limitar(linha.nome, 120);
  if (!dados.nome) {
    const rotulo = tipo === 'CLIENTES' ? 'Cliente' : tipo === 'SERVICOS' ? 'Serviço' : 'Produto';
    problema('nome', 'Linha sem nome', { valor: `${rotulo} ${numero}`, texto: `Usar "${rotulo} ${numero}"` });
  }

  if (tipo === 'CLIENTES') {
    const tel = normalizarTelefone(linha.telefone, { dddPadrao });
    if (tel.erro) problema('telefone', tel.erro, tel.sugestao);
    else {
      dados.telefone = tel.valor;
      if (tel.corrigido) avisos.push({ campo: 'telefone', mensagem: 'Colocamos o 9 na frente do celular' });
    }
    const email = normalizarEmail(linha.email);
    if (email.erro) problema('email', email.erro, { valor: '', texto: 'Importar sem e-mail' });
    else dados.email = email.valor;
    const cpf = normalizarCpf(linha.cpf);
    if (cpf.erro) problema('cpf', cpf.erro, { valor: '', texto: 'Importar sem CPF' });
    else dados.cpf = cpf.valor;
    const nasc = normalizarData(linha.nascimento);
    if (nasc.erro) problema('nascimento', nasc.erro, { valor: '', texto: 'Importar sem aniversário' });
    else dados.nascimento = nasc.valor;
    dados.observacoes = limitar(linha.observacoes, 2000);
    if (!dados.telefone && !dados.email && !dados.cpf && !problemas.some((p) => p.campo !== 'nome')) {
      avisos.push({ campo: 'telefone', mensagem: 'Sem celular, e-mail nem CPF' });
    }
    return { dados, problemas, avisos };
  }

  const preco = normalizarNumero(linha.preco);
  if (preco.erro) problema('preco', preco.erro);
  else if (preco.valor === null) problema('preco', 'Sem preço de venda');
  else if (preco.valor < 0 || preco.valor > 1e7) problema('preco', 'Preço fora do normal');
  else dados.preco = Math.round(preco.valor * 100) / 100;

  dados.categoria = limitar(linha.categoria, 60);
  dados.descricao = limitar(linha.descricao, 1000);

  if (tipo === 'PRODUTOS') {
    const custo = normalizarNumero(linha.custo);
    if (custo.erro) problema('custo', custo.erro, { valor: '', texto: 'Importar sem custo' });
    else if (custo.valor !== null && (custo.valor < 0 || custo.valor > 1e7)) problema('custo', 'Custo fora do normal', { valor: '', texto: 'Importar sem custo' });
    else dados.custo = custo.valor === null ? null : Math.round(custo.valor * 100) / 100;

    const estoque = normalizarNumero(linha.estoque);
    if (estoque.erro) problema('estoque', estoque.erro, { valor: '0', texto: 'Começar com estoque 0' });
    else if (estoque.valor !== null && (!Number.isInteger(estoque.valor) || estoque.valor < 0 || estoque.valor > 1e6)) {
      problema('estoque', 'Estoque precisa ser um número inteiro, sem negativo', { valor: '0', texto: 'Começar com estoque 0' });
    } else dados.estoque = estoque.valor === null ? 0 : estoque.valor;

    const sku = texto(linha.sku).replace(/\s+/g, '');
    dados.sku = sku ? sku.slice(0, 60) : null;
  } else {
    const dur = normalizarDuracao(linha.duracao);
    if (dur.erro) problema('duracao', dur.erro, { valor: '', texto: 'Importar sem duração' });
    else dados.duracao = dur.valor;
  }
  return { dados, problemas, avisos };
}

function chaveNome(nome) {
  return chave(nome);
}

/** Chaves de identidade de uma linha ja normalizada (pra achar duplicado). */
function chavesIdentidade(tipo, dados) {
  const ks = [];
  if (tipo === 'CLIENTES') {
    if (dados.telefone) ks.push(`tel:${dados.telefone}`);
    if (dados.email) ks.push(`email:${dados.email}`);
    if (dados.cpf) ks.push(`cpf:${dados.cpf}`);
  } else {
    if (dados.sku) ks.push(`sku:${dados.sku.toLowerCase()}`);
    if (dados.nome) ks.push(`nome:${chaveNome(dados.nome)}`);
  }
  return ks;
}

/**
 * Valida todas as linhas e marca duplicados DENTRO do arquivo: a primeira
 * ocorrencia fica, as seguintes apontam pra ela (`duplicadaDe` = indice).
 * Linhas com `pular: true` nao entram na conta.
 */
function validarLinhas(tipo, linhas, { dddPadrao = null } = {}) {
  const vistos = new Map();
  return (linhas || []).map((bruta, i) => {
    const numero = Number(bruta?._linha) || i + 2; // linha 1 = cabecalho
    if (bruta?.pular) return { indice: i, numero, pular: true, dados: {}, problemas: [], avisos: [] };
    const r = validarLinha(tipo, bruta, { numero, dddPadrao });
    let duplicadaDe = null;
    if (!r.problemas.length) {
      const ks = chavesIdentidade(tipo, r.dados);
      for (const k of ks) {
        if (vistos.has(k)) { duplicadaDe = vistos.get(k); break; }
      }
      if (duplicadaDe === null) ks.forEach((k) => vistos.set(k, i));
    }
    return { indice: i, numero, ...r, duplicadaDe };
  });
}

/** Preenche em `alvo` so os campos vazios com o que vier de `fonte`. */
function juntarCamposVazios(alvo, fonte) {
  const out = { ...alvo };
  for (const [k, v] of Object.entries(fonte || {})) {
    const vazio = out[k] === null || out[k] === undefined || out[k] === '';
    if (vazio && v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

/** Ultimos 8 digitos (compara telefone salvo em formato antigo). */
function finalTelefone(t) {
  const d = String(t || '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : null;
}

/** DDD de um telefone (com ou sem 55). */
function dddDe(t) {
  const n = normalizarTelefone(t);
  return n.valor ? n.valor.slice(2, 4) : null;
}

module.exports = {
  TIPOS,
  CAMPOS,
  ROTULOS,
  LIMITE_LINHAS,
  chave,
  chaveNome,
  sugerirMapeamento,
  normalizarTelefone,
  normalizarEmail,
  normalizarCpf,
  normalizarData,
  normalizarNumero,
  normalizarDuracao,
  validarLinha,
  validarLinhas,
  chavesIdentidade,
  juntarCamposVazios,
  finalTelefone,
  dddDe,
};
