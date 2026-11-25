# Central de Ajuda Sellergy

Site público em **ajuda.sellergycloud.com** com os documentos do sistema para o cliente final:
passo a passo e perguntas frequentes, organizados **exatamente como o menu do Sellergy**.

Não tem login nem nada da parte interna. É um site estático (VitePress), com busca própria.

## Rodar no PC

```bash
cd ajuda
npm install
npm run dev        # http://localhost:5180
npm run build      # gera .vitepress/dist (o que vai pro ar)
npm run preview    # confere o build em http://localhost:5180
```

## Onde fica cada coisa

| Caminho | O que é |
|---|---|
| `index.md` | Página inicial (busca + módulos) |
| `<modulo>/index.md` | Página do módulo: resumo, telas, lista de artigos e perguntas frequentes |
| `<modulo>/<artigo>.md` | Um artigo. O nome do arquivo vira o endereço |
| `novidades.md` | O que mudou no sistema |
| `MODELO-DE-ARTIGO.md` | Modelo pra copiar ao escrever artigo novo (não é publicado) |
| `public/prints/<modulo>/` | Prints das telas |
| `.vitepress/modulos.json` | Lista e ordem dos módulos, grupos, ícones e resumos. Espelha o menu do sistema (`frontend/src/components/ClientLayout.jsx`) |
| `.vitepress/config.mjs` | Configuração. O menu lateral é montado sozinho a partir dos arquivos |
| `.vitepress/theme/` | Cores, fontes e componentes (`Passo`, `Pergunta`, rodapé "Esta página ajudou?") |

## Escrever um artigo

1. Copie `MODELO-DE-ARTIGO.md` para a pasta do módulo, ex.: `fiscal/trocar-certificado.md`.
2. Escreva usando os nomes exatos do menu e dos botões. Confira na tela antes de publicar.
3. Ponha o link na lista **Artigos** do `index.md` do módulo.
4. Rode `npm run dev` e confira.

O menu lateral pega o artigo sozinho (ordenado por `ordem` no topo do arquivo).
Quando um módulo muda no sistema, atualize `modulos.json` e a página do módulo.

## Pôr no ar

Qualquer hospedagem de site estático serve. O build sai em `ajuda/.vitepress/dist`.

**Opção 1: Cloudflare Pages (recomendado, o DNS já está no Cloudflare)**
1. Cloudflare › Workers & Pages › Create › Pages › conectar o GitHub `Sellergy-Cloud`.
2. Diretório raiz: `ajuda` · comando de build: `npm run build` · saída: `.vitepress/dist`.
3. Custom domain: `ajuda.sellergycloud.com` (o Cloudflare cria o registro sozinho).

**Opção 2: Hostinger** (como o sellergycloud.com)
Novo site estático apontando pra pasta `ajuda`, build `npm run build`, saída `.vitepress/dist`,
e no Cloudflare um CNAME `ajuda` pro endereço que a Hostinger der.

Cada push no branch publicado atualiza a central sozinha.
