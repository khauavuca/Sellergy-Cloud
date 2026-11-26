<script setup>
// Passo numerado do passo a passo. Uso no .md:
// <Passo n="1">No menu, abra **Fiscal**.</Passo>
defineProps({ n: { type: [String, Number], required: true } });
</script>

<template>
  <div class="sg-passo">
    <span class="sg-n" aria-hidden="true">{{ n }}</span>
    <div class="sg-txt"><span class="sr-only">Passo {{ n }}: </span><slot /></div>
  </div>
</template>

<style scoped>
.sg-passo { display: flex; gap: 14px; margin: 18px 0; }
.sg-n { width: 30px; height: 30px; border-radius: 99px; background: #136F4D; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0; }
.sg-txt { flex: 1; padding-top: 2px; }
.sg-txt :deep(p) { margin: 0 0 10px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
