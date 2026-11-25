<script setup>
// Pergunta frequente em sanfona. Uso no .md:
// <Pergunta titulo="Pergunta do cliente?">Resposta.</Pergunta>
defineProps({ titulo: { type: String, required: true } });
</script>

<template>
  <details class="sg-pergunta">
    <summary>{{ titulo }}<span aria-hidden="true">+</span></summary>
    <div class="sg-resposta"><slot /></div>
  </details>
</template>

<style scoped>
.sg-pergunta { border-bottom: 1px solid var(--vp-c-divider); }
.sg-pergunta:first-of-type { border-top: 1px solid var(--vp-c-divider); }
summary { list-style: none; min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 600; font-size: 16px; cursor: pointer; }
summary::-webkit-details-marker { display: none; }
summary span { color: var(--vp-c-brand-1); font-size: 22px; font-weight: 400; transition: transform .15s; }
details[open] summary span { transform: rotate(45deg); }
summary:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px; }
.sg-resposta { padding-bottom: 16px; color: var(--vp-c-text-2); }
.sg-resposta :deep(p) { margin: 0 0 8px; }
</style>
