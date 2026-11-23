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

function iniciar() {
  const timers = carregarTarefas().map((t) => {
    let rodando = false;
    return setInterval(async () => {
      if (rodando) return;
      rodando = true;
      try { await t.rodar(); } catch (e) { console.error(`[rotinas:${t.nome}]`, e?.message); } finally { rodando = false; }
    }, t.intervaloMs);
  });
  return () => timers.forEach(clearInterval);
}

module.exports = { iniciar, carregarTarefas };
