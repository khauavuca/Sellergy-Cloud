// Leitura e validacao do corpo de criar/editar agendamento (pura, sem banco).
// Nunca passa req.body direto pro Prisma: so os campos daqui, ja validados.

const { lerDinheiro, lerInteiro } = require('../utils/numero');
const { lerDataHora, lerTexto, digitos } = require('./utilAgenda');

const STATUS = ['PENDING', 'CONFIRMED', 'CANCELED', 'COMPLETED'];
const ORIGENS = ['MANUAL', 'AI', 'LINK_PUBLICO'];
const DURACAO_MIN = 5;
const DURACAO_MAX = 720; // 12 h
const PRECO_MAX = 100_000;

const vazio = (v) => v === undefined || v === null || v === '';

/**
 * @param {object} body
 * @param {{ parcial?: boolean }} op parcial=true no PUT (so o que veio).
 * @returns {{ data: object } | { erro: string, campos: string[] }}
 */
function lerCamposAgendamento(body, { parcial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const data = {};
  const erros = [];
  const falhar = (campo, msg) => erros.push({ campo, msg });

  if (!parcial || b.nomeCliente !== undefined) {
    const r = lerTexto(b.nomeCliente, { max: 120, obrigatorio: true, rotulo: 'Nome do cliente' });
    if (!r.ok) falhar('nomeCliente', r.erro); else data.nomeCliente = r.valor;
  }

  if (b.telefoneCliente !== undefined) {
    if (vazio(b.telefoneCliente)) data.telefoneCliente = null;
    else if (typeof b.telefoneCliente !== 'string') falhar('telefoneCliente', 'Telefone inválido.');
    else {
      const d = digitos(b.telefoneCliente);
      if (d.length < 10 || d.length > 13) falhar('telefoneCliente', 'Telefone inválido: informe com DDD.');
      else data.telefoneCliente = b.telefoneCliente.trim().slice(0, 30);
    }
  }

  if (!parcial || b.data !== undefined) {
    const r = lerDataHora(b.data);
    if (!r.ok) falhar('data', r.erro); else data.data = r.valor;
  }

  if (!parcial || b.duracao !== undefined) {
    if (vazio(b.duracao)) {
      if (!parcial) data.duracao = 30;
    } else {
      const r = lerInteiro(b.duracao, { min: DURACAO_MIN, max: DURACAO_MAX });
      if (!r.ok) falhar('duracao', `Duração inválida: use de ${DURACAO_MIN} a ${DURACAO_MAX} minutos.`);
      else data.duracao = r.valor;
    }
  }

  if (b.servico !== undefined) {
    const r = lerTexto(b.servico, { max: 200, rotulo: 'Serviço' });
    if (!r.ok) falhar('servico', r.erro); else data.servico = r.valor;
  }

  if (!parcial || b.preco !== undefined) {
    if (vazio(b.preco)) {
      if (!parcial) data.preco = 0;
    } else {
      const r = lerDinheiro(b.preco, { min: 0, max: PRECO_MAX });
      if (!r.ok) falhar('preco', r.erro); else data.preco = r.valor;
    }
  }

  if (b.observacoes !== undefined) {
    const r = lerTexto(b.observacoes, { max: 2000, rotulo: 'Observação' });
    if (!r.ok) falhar('observacoes', r.erro); else data.observacoes = r.valor;
  }

  if (parcial && b.status !== undefined) {
    if (!STATUS.includes(b.status)) falhar('status', 'Status inválido.'); else data.status = b.status;
  }

  if (!parcial) {
    if (vazio(b.origem)) data.origem = 'MANUAL';
    else if (!ORIGENS.includes(b.origem)) falhar('origem', 'Origem inválida.');
    else data.origem = b.origem;
  }

  if (erros.length) {
    return { erro: erros.length === 1 ? erros[0].msg : 'Confira os campos destacados.', campos: erros.map((e) => e.campo) };
  }
  return { data };
}

module.exports = { lerCamposAgendamento, STATUS, DURACAO_MAX, PRECO_MAX };
