<script setup>
// Rodape de todo artigo: "Esta pagina ajudou?" e o caminho pro chamado.
// Por enquanto o voto fica so no navegador; quando a API tiver a rota de
// avaliacao da ajuda, e so mandar { pagina, util } pra ela aqui.
import { ref, watch } from 'vue';
import { useData, useRoute } from 'vitepress';

const { frontmatter } = useData();
const route = useRoute();
const voto = ref(null);
watch(() => route.path, () => { voto.value = null; });
function votar(util) {
  voto.value = util;
  try { localStorage.setItem(`ajuda-voto:${route.path}`, util ? 'sim' : 'nao'); } catch { /* navegador sem armazenamento */ }
}
</script>

<template>
  <div v-if="frontmatter.layout !== 'page' && frontmatter.ajudou !== false" class="sg-ajudou">
    <div v-if="voto === null" class="sg-linha">
      <strong>Esta página ajudou?</strong>
      <button type="button" @click="votar(true)">Sim</button>
      <button type="button" @click="votar(false)">Não</button>
    </div>
    <p v-else-if="voto" class="sg-obrigado">Que bom! Obrigado por avisar.</p>
    <p v-else class="sg-obrigado">Poxa. Abra um chamado pelo botão <b>Ajuda</b> dentro do Sellergy que a equipe te ajuda e a gente melhora esta página.</p>
    <a href="https://sellergycloud.com/app/login" class="sg-chamado">Ainda com dúvida? Abrir chamado no Sellergy</a>
  </div>
</template>

<style scoped>
.sg-ajudou { margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--vp-c-divider); display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
.sg-linha { display: flex; gap: 8px; align-items: center; }
.sg-linha button { min-height: 40px; padding: 0 16px; border: 1px solid var(--vp-c-divider); border-radius: 10px; font-weight: 600; }
.sg-linha button:hover { border-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1); }
.sg-obrigado { margin: 0; color: var(--vp-c-text-2); max-width: 520px; }
.sg-chamado { font-weight: 600; font-size: 14px; }
</style>
