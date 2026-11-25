// Rotinas periodicas da fase 2, rodando no worker. Cada frente exporta as
// suas tarefas num arquivo proprio (sem mexer aqui):
//   src/agenda/tarefasAgenda.js     (encaixe que expira, sinal nao pago, pacote vencido)
//   src/pedidos/tarefasPedidos.js   (pedido sem pagamento que expira)
//   src/admin/tarefasAdmin.js       (comunicados, limpeza)
//   src/fiscal/tarefasFiscal.js     (emite a nota das vendas pagas, se ligado)
// Formato: module.exports = [{ nome, intervaloMs, rodar: async () => {} }]

const MODULOS = ['./tarefasAgenda', '../pedidos/tarefasPedidos', '../admin/tarefasAdmin', '../fiscal/tarefasFiscal'];

function carregarTarefas() {
  const tarefas = [];
  for (const m of MODULOS) {
    try {
      const lista = require(m);
      if (Array.isArray(lista)) tarefas.push(...lista);
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND' || !String(e.message).includes(m.split('/').pop())) throw e;
    }
  }
  return tarefas;
}

// Cada tarefa roda com trava entre processos (utils/travaRotina): com 2
// instancias do worker, so uma executa cada rodada.
function iniciar() {
  const { iniciarIntervaloComTrava } = require('../utils/travaRotina');
  const paradas = carregarTarefas().map((t) => iniciarIntervaloComTrava({
    nome: `fase2:${t.nome}`,
    intervaloMs: t.intervaloMs,
    rodar: t.rodar,
  }));
  return () => paradas.forEach((parar) => parar());
}

module.exports = { iniciar, carregarTarefas };
