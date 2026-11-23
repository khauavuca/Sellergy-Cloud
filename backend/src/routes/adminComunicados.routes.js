// Criar e enviar comunicados pra base de clientes.
// Montado em /admin/comunicados (src/index.js). Frente D da fase 2.
//
//   GET  /admin/comunicados            -> historico com quantos leram
//   GET  /admin/comunicados/previa     -> ?publico=TODOS|SERVICO|PRODUTO|TRIAL  alcance real
//   POST /admin/comunicados            -> { titulo, texto, publico, noSistema, noWhatsapp } envia
//
// Ver: todos os papeis. Enviar: so o dono. Logica em admin/comunicados.js.

const express = require('express');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerAdmin, requerPapelAdmin } = require('../middlewares/permissoes.middleware');
const { registrarAuditoria } = require('../seguranca/auditoria');
const { PUBLICOS, validarComunicado, previaDoAlcance, enviarComunicado, historico } = require('../admin/comunicados');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerAdmin);

roteador.get('/', requerPapelAdmin('comunicados.ver'), async (req, res) => {
  try {
    res.json({ comunicados: await historico(), canalWhatsappConfigurado: Boolean(process.env.PLATAFORMA_CLIENTE_ID) });
  } catch (e) {
    console.error('[admin/comunicados]', e);
    res.status(500).json({ erro: 'Erro ao carregar os comunicados.' });
  }
});

roteador.get('/previa', requerPapelAdmin('comunicados.ver'), async (req, res) => {
  try {
    const publico = PUBLICOS.includes(req.query.publico) ? req.query.publico : null;
    if (!publico) return res.status(422).json({ erro: 'Público inválido.', campos: ['publico'] });
    res.json({ publico, ...(await previaDoAlcance(publico)) });
  } catch (e) {
    console.error('[admin/comunicados/previa]', e);
    res.status(500).json({ erro: 'Erro ao calcular o alcance.' });
  }
});

roteador.post('/', requerPapelAdmin('comunicados.enviar'), async (req, res) => {
  try {
    const { erro, campos, dados } = validarComunicado(req.body);
    if (erro) return res.status(422).json({ erro, campos });
    const r = await enviarComunicado({ ...dados, criadoPorId: req.usuario.id });
    await registrarAuditoria(req, {
      acao: 'COMUNICADO_ENVIAR', alvoTipo: 'COMUNICADO', alvoId: r.comunicado.id,
      detalhes: { titulo: dados.titulo, publico: dados.publico, alcance: r.comunicado.alcance, noSistema: dados.noSistema, noWhatsapp: dados.noWhatsapp, whatsappEnfileirados: r.whatsappEnfileirados },
    });
    res.status(201).json(r);
  } catch (e) {
    console.error('[admin/comunicados/enviar]', e);
    res.status(500).json({ erro: 'Erro ao enviar o comunicado.' });
  }
});

module.exports = roteador;
