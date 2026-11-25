// Rotinas periodicas da frente C (carregadas por agenda/rotinasFase2.js no worker,
// cada uma com trava entre processos — ver utils/travaRotina.js).
//   - "Emitir sozinho": nota das vendas pagas pra quem ligou no assistente fiscal.
//   - Sincronizar: documentos parados em PROCESSANDO ha mais de
//     FISCAL_SYNC_MINUTOS (padrao 5) sao consultados no emissor, no maximo
//     FISCAL_SYNC_LIMITE (padrao 50) por rodada.

const { emitirVendasPendentes, sincronizarProcessando } = require('./emissao');

module.exports = [
  {
    nome: 'fiscal-emitir-sozinho',
    intervaloMs: 2 * 60 * 1000,
    rodar: () => emitirVendasPendentes(),
  },
  {
    nome: 'fiscal-sincronizar-processando',
    intervaloMs: 3 * 60 * 1000,
    rodar: async () => {
      const r = await sincronizarProcessando();
      if (r.consultados || r.falhas) console.log('[fiscal/sync]', JSON.stringify(r));
    },
  },
];
