// Tema da Central: o padrao do VitePress com as cores e fontes do Sellergy,
// a home com os modulos e o rodape "Esta pagina ajudou?" em todo artigo.
import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import './custom.css';
import Inicio from './components/Inicio.vue';
import Pergunta from './components/Pergunta.vue';
import Ajudou from './components/Ajudou.vue';
import Passo from './components/Passo.vue';

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-after': () => h(Ajudou),
    });
  },
  enhanceApp({ app }) {
    app.component('Inicio', Inicio);
    app.component('Pergunta', Pergunta);
    app.component('Passo', Passo);
  },
};
