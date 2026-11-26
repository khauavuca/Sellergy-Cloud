// =====================================================================
// PRIMEIRO USO — o basico que toda conta nova ja recebe pronto.
// =====================================================================
// Antes a conta nascia vazia: nao dava pra cadastrar o 1o servico (exigia
// categoria financeira e especialista) nem o 1o cliente (o funil nao tinha
// etapa). Agora o cadastro ja cria:
//   - categorias financeiras: "Serviços" (receita, uso SERVICO), "Produtos"
//     (receita, uso PRODUTO) e "Despesas fixas" (despesa, uso DESPESA/FIXA);
//   - etapas do funil: Novo, Em conversa e Cliente (fechado) — do catalogo;
//   - segmento de servico (SERVICO/HIBRIDO): a dona como profissional que atende.
// As contas que ja existiam recebem o mesmo pela migration
// 20261125130100_padroes_primeiro_uso (idempotente).
// =====================================================================

const { buscarEtapaCatalogo } = require('../constants/etapasCatalogo');

const CATEGORIAS_PADRAO = Object.freeze([
  { nome: 'Serviços', tipo: 'RECEITA', uso: 'SERVICO', subTipo: null },
  { nome: 'Produtos', tipo: 'RECEITA', uso: 'PRODUTO', subTipo: null },
  { nome: 'Despesas fixas', tipo: 'DESPESA', uso: 'DESPESA', subTipo: 'FIXA' },
]);

// Nome amigavel por cima do catalogo (o slug continua o do catalogo).
const ETAPAS_PADRAO = Object.freeze([
  { slug: 'novo', nome: 'Novo' },
  { slug: 'em-contato', nome: 'Em conversa' },
  { slug: 'fechado-ganho', nome: 'Cliente (fechado)' },
]);

const SEGMENTOS_COM_PROFISSIONAL = new Set(['SERVICO', 'HIBRIDO']);

/** O que criar pra um segmento. PURA. */
function planoDePadroes(segmento) {
  return {
    categorias: CATEGORIAS_PADRAO.map((c) => ({ ...c })),
    etapas: ETAPAS_PADRAO.map((e) => {
      const def = buscarEtapaCatalogo(e.slug);
      return { slug: e.slug, nome: e.nome, ordem: def.ordem, cor: def.cor };
    }),
    donoProfissional: SEGMENTOS_COM_PROFISSIONAL.has(String(segmento || '').toUpperCase()),
  };
}

/**
 * Cria os padroes do negocio (dentro da transacao do cadastro). So cria o que
 * falta, entao pode ser chamado de novo sem duplicar.
 */
async function criarPadroesDoNegocio(tx, { clienteId, segmento, usuario }) {
  const plano = planoDePadroes(segmento);

  const categorias = await tx.categoriaFinanceira.findMany({ where: { clienteId }, select: { tipo: true, uso: true } });
  const faltam = plano.categorias.filter((c) => !categorias.some((x) => x.tipo === c.tipo && x.uso === c.uso));
  if (faltam.length) await tx.categoriaFinanceira.createMany({ data: faltam.map((c) => ({ clienteId, ...c })) });

  const temEtapa = await tx.etapaLead.count({ where: { clienteId } });
  if (!temEtapa) await tx.etapaLead.createMany({ data: plano.etapas.map((e) => ({ clienteId, ...e })), skipDuplicates: true });

  if (plano.donoProfissional && usuario?.id) {
    const temProfissional = await tx.especialista.count({ where: { clienteId } });
    if (!temProfissional) {
      await tx.especialista.create({ data: { clienteId, nome: usuario.nome, usuarioId: usuario.id, ativo: true } });
    }
  }
  return plano;
}

module.exports = { CATEGORIAS_PADRAO, ETAPAS_PADRAO, planoDePadroes, criarPadroesDoNegocio };
