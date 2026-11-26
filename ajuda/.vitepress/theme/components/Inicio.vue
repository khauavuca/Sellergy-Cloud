<script setup>
// Pagina inicial: busca grande e os modulos agrupados como no menu do Sellergy.
import { withBase } from 'vitepress';
import grupos from '../../modulos.json';
import Icone from './Icone.vue';

// A busca do VitePress abre com Ctrl+K; o campo da home so dispara ela.
function abrirBusca() {
  document.querySelector('.DocSearch-Button, .VPNavBarSearchButton, #local-search button')?.click();
}
const buscados = ['emitir nota', 'cadastrar serviço', 'lembrete no WhatsApp', 'fechar o caixa'];
</script>

<template>
  <div class="sg-inicio">
    <section class="sg-hero">
      <h1>Como podemos ajudar?</h1>
      <p>Passo a passo de cada tela do Sellergy, com os mesmos nomes do menu.</p>
      <button class="sg-busca" type="button" @click="abrirBusca">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <span>Buscar: emitir nota, cadastrar serviço, lembrete...</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div class="sg-buscados">
        Mais buscados:
        <button v-for="b in buscados" :key="b" type="button" @click="abrirBusca">{{ b }}</button>
      </div>
    </section>

    <section class="sg-grupos">
      <div v-for="g in grupos" :key="g.grupo" class="sg-grupo">
        <h2>{{ g.grupo }}</h2>
        <div class="sg-grade">
          <a v-for="m in g.modulos" :key="m.slug" class="sg-card" :href="withBase(`/${m.slug}/`)">
            <span class="sg-ico"><Icone :nome="m.icone" /></span>
            <span class="sg-titulo">{{ m.titulo }}</span>
            <span class="sg-resumo">{{ m.resumo }}</span>
          </a>
        </div>
      </div>

      <div class="sg-contato">
        <div>
          <strong>Não achou o que precisava?</strong>
          <span>Abra um chamado pelo botão Ajuda dentro do Sellergy. A equipe responde por lá.</span>
        </div>
        <a class="sg-botao" href="https://sellergycloud.com/app/login">Abrir o Sellergy</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sg-hero { background: var(--sg-escuro); color: #fff; padding: 72px 24px 80px; display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; }
.sg-hero h1 { margin: 0; font-family: var(--vp-font-family-heading); font-size: clamp(32px, 5vw, 50px); line-height: 1.05; letter-spacing: -0.03em; }
.sg-hero p { margin: 0; color: #B9BEC6; font-size: 17px; }
.sg-busca { width: 100%; max-width: 620px; min-height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 18px; border-radius: 14px; background: #fff; color: #5B616B; font-size: 16px; text-align: left; cursor: text; }
.sg-busca span { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 640px) { .sg-busca kbd { display: none; } .sg-hero { padding: 48px 16px 56px; } }
.sg-busca kbd { font-family: inherit; font-size: 12px; border: 1px solid #E3E5E8; border-radius: 6px; padding: 2px 8px; }
.sg-buscados { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; align-items: center; color: #B9BEC6; font-size: 13px; }
.sg-buscados button { border: 1px solid #3A3F46; color: #E3E5E8; border-radius: 99px; padding: 6px 12px; min-height: 32px; }
.sg-buscados button:hover { border-color: #7FE0B4; }
.sg-grupos { max-width: 1200px; margin: 0 auto; padding: 48px 24px 72px; display: flex; flex-direction: column; gap: 40px; }
.sg-grupo h2 { margin: 0 0 16px; font-family: var(--vp-font-family-heading); font-size: 22px; border: 0; padding: 0; }
.sg-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
.sg-card { display: flex; flex-direction: column; gap: 8px; padding: 20px; border: 1px solid var(--vp-c-divider); border-radius: 14px; background: var(--vp-c-bg); color: var(--vp-c-text-1); text-decoration: none; transition: border-color .15s, box-shadow .15s; }
.sg-card:hover { border-color: var(--vp-c-brand-1); box-shadow: 0 6px 20px rgba(19, 111, 77, .08); }
.sg-card:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px; }
.sg-ico { width: 40px; height: 40px; border-radius: 10px; background: var(--sg-suave); color: var(--vp-c-brand-1); display: flex; align-items: center; justify-content: center; }
.sg-titulo { font-weight: 700; font-size: 16px; }
.sg-resumo { color: var(--vp-c-text-2); font-size: 14px; line-height: 1.45; }
.sg-contato { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between; background: var(--vp-c-bg-alt); border-radius: 16px; padding: 24px 28px; }
.sg-contato div { display: flex; flex-direction: column; gap: 4px; }
.sg-contato strong { font-family: var(--vp-font-family-heading); font-size: 20px; }
.sg-contato span { color: var(--vp-c-text-2); }
.sg-botao { display: inline-flex; align-items: center; min-height: 44px; padding: 0 18px; border-radius: 10px; background: #136F4D; color: #fff !important; font-weight: 600; text-decoration: none; }
.sg-botao:hover { background: #0F5C40; }
</style>
