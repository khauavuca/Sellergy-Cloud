// Comunicados da plataforma visiveis pro cliente.
// Montado em /comunicados (src/index.js). Frente D da fase 2.
//
//   GET  /comunicados/atual                  -> comunicado mais recente que esta pessoa nao fechou (ou null)
//   POST /comunicados/:notificacaoId/fechar  -> marca como lido SO pra esta pessoa
//
// O "fechado" e a propria Notificacao da pessoa (lida = true), criada no
// envio (admin/comunicados.js). Na sessao de suporte (so leitura) o fechar e
// barrado pelo auth.middleware; a faixa nem mostra o botao nesse caso.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerTenant, ehAdmin } = require('../middlewares/permissoes.middleware');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerTenant);
roteador.use((req, res, next) => {
  if (ehAdmin(req.usuario) || !req.usuario.clienteId) return res.status(403).json({ erro: 'Só para usuários de um negócio.' });
  return next();
});

const FILTRO_COMUNICADO = { path: ['origem'], equals: 'COMUNICADO' };

roteador.get('/atual', async (req, res) => {
  try {
    const n = await prisma.notificacao.findFirst({
      where: { clienteId: req.usuario.clienteId, usuarioId: req.usuario.id, lida: false, dados: FILTRO_COMUNICADO },
      orderBy: { criadoEm: 'desc' },
      select: { id: true, titulo: true, mensagem: true, criadoEm: true, dados: true },
    });
    res.json(n ? { notificacaoId: n.id, comunicadoId: n.dados?.comunicadoId || null, titulo: n.titulo, texto: n.mensagem, criadoEm: n.criadoEm } : null);
  } catch (e) {
    console.error('[comunicados/atual]', e);
    res.status(500).json({ erro: 'Erro ao carregar o comunicado.' });
  }
});

roteador.post('/:notificacaoId/fechar', async (req, res) => {
  try {
    const r = await prisma.notificacao.updateMany({
      where: { id: req.params.notificacaoId, clienteId: req.usuario.clienteId, usuarioId: req.usuario.id, dados: FILTRO_COMUNICADO },
      data: { lida: true, lidaEm: new Date() },
    });
    if (!r.count) return res.status(404).json({ erro: 'Comunicado não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[comunicados/fechar]', e);
    res.status(500).json({ erro: 'Erro ao fechar o comunicado.' });
  }
});

module.exports = roteador;
