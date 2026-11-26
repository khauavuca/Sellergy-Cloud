// Central de Ajuda do Sellergy (ajuda.sellergycloud.com).
// Documentos do sistema pro cliente final, organizados como o menu do Sellergy.
// Conteudo: um .md por artigo, dentro da pasta do modulo. O menu lateral e
// montado sozinho a partir de .vitepress/modulos.json + os arquivos da pasta.
import { defineConfig } from 'vitepress';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const grupos = JSON.parse(fs.readFileSync(path.join(raiz, '.vitepress', 'modulos.json'), 'utf8'));

// Le title/ordem/status do frontmatter sem dependencia extra.
function frontmatter(arquivo) {
  const txt = fs.readFileSync(arquivo, 'utf8');
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const dados = {};
  if (m) for (const linha of m[1].split(/\r?\n/)) {
    const i = linha.indexOf(':');
    if (i > 0) dados[linha.slice(0, i).trim()] = linha.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return dados;
}

function artigosDoModulo(slug) {
  const pasta = path.join(raiz, slug);
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta)
    .filter((f) => f.endsWith('.md') && f !== 'index.md')
    .map((f) => ({ f, fm: frontmatter(path.join(pasta, f)) }))
    .filter(({ fm }) => fm.status !== 'oculto')
    .sort((a, b) => (Number(a.fm.ordem) || 99) - (Number(b.fm.ordem) || 99) || a.fm.title?.localeCompare(b.fm.title || '', 'pt-BR'))
    .map(({ f, fm }) => ({ text: fm.title || f.replace(/\.md$/, ''), link: `/${slug}/${f.replace(/\.md$/, '')}` }));
}

const sidebar = grupos.map((g) => ({
  text: g.grupo,
  items: g.modulos.map((m) => {
    const artigos = artigosDoModulo(m.slug);
    return artigos.length
      ? { text: m.titulo, link: `/${m.slug}/`, collapsed: true, items: artigos }
      : { text: m.titulo, link: `/${m.slug}/` };
  }),
}));

const URL_SITE = 'https://ajuda.sellergycloud.com';

export default defineConfig({
  lang: 'pt-BR',
  title: 'Central de Ajuda Sellergy',
  titleTemplate: ':title · Ajuda Sellergy',
  description: 'Passo a passo de cada tela do Sellergy, com os mesmos nomes do menu.',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['README.md', 'MODELO-DE-ARTIGO.md', 'PENDENCIAS.md', 'node_modules/**'],
  sitemap: { hostname: URL_SITE },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#136F4D' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap' }],
  ],
  themeConfig: {
    logo: { src: '/logo.png', alt: '' },
    siteTitle: 'Sellergy Ajuda',
    nav: [
      { text: 'Início', link: '/' },
      { text: 'Novidades', link: '/novidades' },
      { text: 'Entrar no Sellergy', link: 'https://sellergycloud.com/app/login' },
    ],
    sidebar,
    outline: { level: [2, 3], label: 'Nesta página' },
    docFooter: { prev: 'Anterior', next: 'Próximo' },
    lastUpdated: { text: 'Atualizado em', formatOptions: { dateStyle: 'short' } },
    returnToTopLabel: 'Voltar ao topo',
    sidebarMenuLabel: 'Menu',
    darkModeSwitchLabel: 'Tema',
    lightModeSwitchTitle: 'Usar tema claro',
    darkModeSwitchTitle: 'Usar tema escuro',
    notFound: { title: 'Página não encontrada', quote: 'Esse endereço não existe ou mudou de lugar.', linkText: 'Voltar pro início' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar na ajuda' },
          modal: {
            displayDetails: 'Mostrar detalhes',
            resetButtonTitle: 'Limpar busca',
            backButtonTitle: 'Fechar busca',
            noResultsText: 'Nada encontrado para',
            footer: { selectText: 'abrir', navigateText: 'navegar', closeText: 'fechar' },
          },
        },
      },
    },
    footer: { message: 'ajuda.sellergycloud.com', copyright: '<a href="https://sellergycloud.com">sellergycloud.com</a> · <a href="https://sellergycloud.com/termos">Termos</a> · <a href="https://sellergycloud.com/privacidade">Privacidade</a>' },
  },
});
