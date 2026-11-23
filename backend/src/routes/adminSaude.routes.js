// Saude do sistema: banco, Redis, filas, WhatsApp, memoria, erros.
// Montado em /admin/saude (src/index.js). Frente D da fase 2.
//
//   GET /admin/saude -> tudo medido na hora (a tela atualiza a cada 30 s).
// Logica em admin/saude.js. Todos os papeis veem.

const express = require('express');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerAdmin, requerPapelAdmin } = require('../middlewares/permissoes.middleware');
const { situacaoGeral, alertasDaSaude } = require('../admin/saude');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerAdmin);

roteador.get('/', requerPapelAdmin('saude.ver'), async (req, res) => {
  try {
    const s = await situacaoGeral();
    res.set('Cache-Control', 'no-store');
    res.json({ ...s, alertas: alertasDaSaude(s) });
  } catch (e) {
    console.error('[admin/saude]', e);
    res.status(500).json({ erro: 'Erro ao medir a saúde do sistema.' });
  }
});

module.exports = roteador;
