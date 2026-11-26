# Protótipos clicáveis

Telas desenhadas antes do código, publicadas como canvas no claude.ai (privados, só o dono abre):

| Pasta | O que é | Link |
|---|---|---|
| `clientes/` | Sistema de quem usa o Sellergy (36 telas: landing, cadastro, agenda, vendas, celular...) | https://claude.ai/artifact/Ln6dehHYUPB85BQWTWYUCB |
| `admin/` | Painel do dono do Sellergy (login 2FA + 9 áreas) | https://claude.ai/artifact/24nCHhMDUG7wzVVy8MhNSC |

- `project/` traz os arquivos publicados: `canvas.json` mais um `.dc.html` por tela.
- Em `clientes/`, a pasta `frag/` guarda o texto-fonte das telas montadas com o menu lateral. O `gen.py` monta o `.dc.html`; rode de dentro de `clientes/`.
- `check.js` clica em todos os botões de cada tela e avisa quando falta valor. Uso: `node check.js NomeDaTela`.
