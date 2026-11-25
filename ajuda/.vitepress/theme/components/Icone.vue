<script setup>
// Icones dos modulos (traco, mesmo estilo do menu do sistema).
defineProps({ nome: { type: String, required: true }, tamanho: { type: Number, default: 20 } });
const D = {
  inicio: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  conta: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  plano: 'M2 6h20v12H2zM2 10h20M6 15h4',
  clientes: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM3 22a9 9 0 0 1 18 0',
  agenda: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18',
  vendas: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  servicos: 'M21 16V8l-9-5-9 5v8l9 5zM3.3 7L12 12l8.7-5M12 22V12',
  campanhas: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  estoque: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  financeiro: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  pagamentos: 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4z',
  fiscal: 'M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2l-1 .7-3-2-3 2-3-2-3 2-3-2zM8 8h8M8 12h8M8 16h5',
  relatorios: 'M3 3v18h18M7 16v-4M12 16V8M17 16v-7',
};
</script>

<template>
  <svg aria-hidden="true" :width="tamanho" :height="tamanho" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path :d="D[nome] || D.inicio" /></svg>
</template>
