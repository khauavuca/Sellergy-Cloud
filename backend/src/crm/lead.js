// =====================================================================
// CLIENTES (CRM) — validacao do lead e regras da listagem. PURAS.
// =====================================================================
// Entrada invalida vira 400 com mensagem clara (antes caia no banco e voltava
// 500 com o texto interno do Prisma na tela). Campos permitidos apenas: nada
// do corpo vai direto pro banco.
// =====================================================================

const { normalizarEmail, emailValido } = require('../seguranca/validarConta');

const PRIORIDADES = ['LOW', 'MEDIUM', 'HIGH'];
const NOME_MAXIMO = 120;
const OBSERVACAO_MAXIMA = 2000;
const TAGS_MAXIMO = 500;
const ORIGEM_MAXIMA = 60;
const ANO_MINIMO = 1900;

/** CPF com digitos verificadores validos (recusa 111.111.111-11). PURA. */
function cpfValido(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[t])) return false;
  }
  return true;
}

/**
 * Data de nascimento: 'AAAA-MM-DD' (ou ISO com hora) de uma data que existe,
 * entre 1900 e hoje. Devolve { valor: Date (meio-dia UTC) } ou { erro }.
 */
function lerDataNascimento(valor, agora = new Date()) {
  if (valor === null || valor === undefined || valor === '') return { valor: null };
  if (typeof valor !== 'string') return { erro: 'Data de nascimento inválida.' };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(valor.trim());
  if (!m) return { erro: 'Data de nascimento inválida (use dia/mês/ano).' };
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia, 12));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return { erro: 'Essa data não existe (confira dia e mês).' };
  }
  if (ano < ANO_MINIMO || d.getTime() > agora.getTime()) return { erro: `A data de nascimento precisa estar entre ${ANO_MINIMO} e hoje.` };
  return { valor: d };
}

function textoOpcional(v, maximo, rotulo) {
  if (v === null || v === undefined) return { valor: null };
  if (typeof v !== 'string') return { erro: `${rotulo} inválido.` };
  const t = v.trim();
  if (t.length > maximo) return { erro: `${rotulo}: no máximo ${maximo} caracteres.` };
  return { valor: t || null };
}

/**
 * Le e valida o corpo do lead. `parcial` (editar): campo ausente nao muda.
 * etapaId: '' ou null = sem etapa (permitido); a posse da etapa e conferida
 * na rota. Devolve { dados } ou { erro, campos }.
 */
function lerLead(corpo = {}, { parcial = false, agora = new Date() } = {}) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const dados = {};
  const falha = (erro, campo) => ({ erro, campos: [campo] });
  const tem = (k) => c[k] !== undefined;

  if (!parcial || tem('nome')) {
    if (typeof c.nome !== 'string' || !c.nome.trim()) return falha('Informe o nome do cliente.', 'nome');
    if (c.nome.trim().length > NOME_MAXIMO) return falha(`O nome pode ter no máximo ${NOME_MAXIMO} caracteres.`, 'nome');
    dados.nome = c.nome.trim();
  }
  if (tem('telefone')) {
    if (c.telefone === null || c.telefone === '') dados.telefone = null;
    else {
      if (typeof c.telefone !== 'string' && typeof c.telefone !== 'number') return falha('Telefone inválido.', 'telefone');
      const t = String(c.telefone).trim();
      const digitos = t.replace(/\D/g, '');
      if (/[a-z]/i.test(t) || digitos.length < 10 || digitos.length > 13) return falha('Telefone inválido: use DDD + número (ex.: (11) 99999-9999).', 'telefone');
      dados.telefone = t.slice(0, 20);
    }
  }
  if (tem('email')) {
    if (c.email === null || c.email === '') dados.email = null;
    else {
      const e = normalizarEmail(c.email);
      if (!emailValido(e)) return falha('E-mail inválido.', 'email');
      dados.email = e;
    }
  }
  if (tem('cpf')) {
    if (c.cpf === null || c.cpf === '') dados.cpf = null;
    else {
      if (typeof c.cpf !== 'string' && typeof c.cpf !== 'number') return falha('CPF inválido.', 'cpf');
      const d = String(c.cpf).replace(/\D/g, '');
      if (!cpfValido(d)) return falha('CPF inválido: confira os números.', 'cpf');
      dados.cpf = d;
    }
  }
  if (tem('dataNascimento')) {
    const r = lerDataNascimento(c.dataNascimento, agora);
    if (r.erro) return falha(r.erro, 'dataNascimento');
    dados.dataNascimento = r.valor;
  }
  if (tem('prioridade')) {
    if (c.prioridade === null || c.prioridade === '') dados.prioridade = 'MEDIUM';
    else if (!PRIORIDADES.includes(c.prioridade)) return falha('Urgência inválida.', 'prioridade');
    else dados.prioridade = c.prioridade;
  }
  for (const [campo, maximo, rotulo] of [['tags', TAGS_MAXIMO, 'Etiquetas'], ['origem', ORIGEM_MAXIMA, 'Origem'], ['observacoes', OBSERVACAO_MAXIMA, 'Anotações']]) {
    if (!tem(campo)) continue;
    const r = textoOpcional(c[campo], maximo, rotulo);
    if (r.erro) return falha(r.erro, campo);
    dados[campo] = r.valor;
  }
  if (tem('etapaId')) {
    if (c.etapaId === null || c.etapaId === '') dados.etapaId = null;
    else if (typeof c.etapaId !== 'string' || c.etapaId.length > 64) return falha('Etapa inválida.', 'etapaId');
    else dados.etapaId = c.etapaId;
  }
  if (tem('variacoes') && c.variacoes !== null && !Array.isArray(c.variacoes)) return falha('Itens inválidos.', 'variacoes');
  return { dados };
}

/** Texto da observacao da linha do tempo: 1 a 2.000 caracteres. */
function lerObservacao(v) {
  if (typeof v !== 'string' || !v.trim()) return { erro: 'Escreva a observação.' };
  if (v.trim().length > OBSERVACAO_MAXIMA) return { erro: `A observação pode ter no máximo ${OBSERVACAO_MAXIMA} caracteres.` };
  return { valor: v.trim() };
}

/** So registra "MOVIDO" quando a etapa muda de verdade. PURA. */
function mudouDeEtapa(anteriorId, novoId) {
  if (novoId === undefined) return false;
  return (anteriorId || null) !== (novoId || null);
}

const ABAS = ['todos', 'aberto', 'ganho', 'parado', 'aniversario'];
const LIMITE_PADRAO = 25;
const LIMITE_MAXIMO = 200;

/** Le pagina/limite/aba/busca da query. PURA. */
function lerListagem(q = {}) {
  const pagina = Math.max(1, Number.parseInt(q.pagina, 10) || 1);
  const limite = Math.min(LIMITE_MAXIMO, Math.max(1, Number.parseInt(q.limite, 10) || LIMITE_PADRAO));
  const aba = ABAS.includes(q.aba) ? q.aba : 'todos';
  const busca = typeof q.busca === 'string' ? q.busca.trim().slice(0, 100) : '';
  const etapaId = typeof q.etapaId === 'string' && q.etapaId ? q.etapaId.slice(0, 64) : '';
  return { pagina, limite, aba, busca, etapaId };
}

/** 'MM-DD' de hoje e dos proximos 6 dias no fuso de Sao Paulo. PURA. */
function diasDeAniversario(agora = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const [a, m, d] = fmt.format(agora).split('-').map(Number);
  const lista = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(a, m - 1, d + i));
    lista.push(`${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`);
  }
  return lista;
}

module.exports = {
  PRIORIDADES, OBSERVACAO_MAXIMA, LIMITE_MAXIMO, ABAS,
  cpfValido, lerDataNascimento, lerLead, lerObservacao, mudouDeEtapa, lerListagem, diasDeAniversario,
};
