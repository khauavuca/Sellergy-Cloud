// Links da Central de Ajuda (ajuda.sellergycloud.com) por tela do sistema.
// Cada rota do /app aponta pro artigo (ou modulo) que explica aquela tela.
// Os enderecos sao os arquivos de ajuda/<modulo>/<artigo>.md: se renomear um
// artigo la, atualize aqui.
export const URL_AJUDA = String(import.meta.env.VITE_URL_AJUDA || 'https://ajuda.sellergycloud.com').replace(/\/$/, '');

const POR_ROTA = {
  '/app/dashboard': 'primeiros-passos/primeiro-dia',
  '/app/hoje': 'primeiros-passos/tela-hoje',
  '/app/crm': 'clientes/',
  '/app/agenda': 'agenda/marcar-horario',
  '/app/agenda/encaixe': 'agenda/lista-de-espera',
  '/app/pacotes': 'agenda/vender-pacote',
  '/app/vendas': 'vendas/registrar-uma-venda',
  '/app/pedidos': 'vendas/acompanhar-um-pedido',
  '/app/devolucoes': 'vendas/devolucao-de-aluguel',
  '/app/catalogo': 'servicos/cadastrar-servico',
  '/app/whatsapp': 'whatsapp/responder-uma-conversa',
  '/app/bots': 'whatsapp/conectar-por-qr-code',
  '/app/campanhas': 'campanhas/criar-campanha',
  '/app/campanhas/nova': 'campanhas/criar-campanha',
  '/app/estoque': 'estoque/',
  '/app/estoque/visao-geral': 'estoque/',
  '/app/estoque/produtos': 'estoque/cadastrar-produto',
  '/app/estoque/movimentacoes': 'estoque/registrar-movimentacao',
  '/app/estoque/reposicao': 'estoque/ver-o-que-repor',
  '/app/estoque/categorias': 'estoque/',
  '/app/estoque/fornecedores': 'estoque/',
  '/app/estoque/notas': 'estoque/dar-entrada-nota',
  '/app/financeiro': 'financeiro/',
  '/app/financeiro/lancamentos': 'financeiro/lancar-receita-ou-despesa',
  '/app/financeiro/caixa': 'financeiro/abrir-e-fechar-caixa',
  '/app/financeiro/contas-pagar': 'financeiro/lancar-conta-a-pagar',
  '/app/financeiro/categorias': 'financeiro/',
  '/app/comissoes': 'financeiro/calcular-comissoes',
  '/app/pagamentos': 'pagamentos/cobrar-pelo-sistema',
  '/app/recebimentos': 'pagamentos/abrir-conta-de-recebimento',
  '/app/fiscal': 'fiscal/emitir-nota-fiscal',
  '/app/fiscal/ativar': 'fiscal/configurar-nota-fiscal',
  '/app/relatorios': 'relatorios/',
  '/app/relatorios/visao-executiva': 'relatorios/ler-visao-executiva',
  '/app/relatorios/mensais': 'relatorios/entender-fechamento-mensal',
  '/app/relatorios/crm': 'relatorios/exportar-relatorio',
  '/app/relatorios/financeiro': 'relatorios/exportar-relatorio',
  '/app/relatorios/caixa': 'relatorios/exportar-relatorio',
  '/app/relatorios/vendas': 'relatorios/exportar-relatorio',
  '/app/relatorios/estoque': 'relatorios/exportar-relatorio',
  '/app/plano': 'plano/escolher-ou-trocar-plano',
  '/app/importar': 'conta/importar-planilha',
  '/app/usuarios': 'conta/convidar-equipe',
  '/app/configuracoes': 'conta/',
  '/app/configuracoes/perfil': 'conta/meu-perfil',
};

/** Link da ajuda da tela atual; sem artigo especifico, cai no modulo ou no inicio. */
export function linkAjuda(pathname = '') {
  const caminho = String(pathname).replace(/\/$/, '');
  if (POR_ROTA[caminho]) return `${URL_AJUDA}/${POR_ROTA[caminho]}`;
  // Telas com parametro (/app/relatorios/mensais/2026-10, /app/estoque/<aba>) usam o link do pai.
  const pai = Object.keys(POR_ROTA)
    .filter((r) => caminho.startsWith(`${r}/`))
    .sort((a, b) => b.length - a.length)[0];
  return pai ? `${URL_AJUDA}/${POR_ROTA[pai]}` : URL_AJUDA;
}
