// Resposta publica da oferta de encaixe (/encaixe/:token).
// Montado em /publico/encaixe (src/index.js). Frente A da fase 2.
//
//   GET  /publico/encaixe/:token   -> resumo da oferta pra quem recebeu
//   POST /publico/encaixe/:token   -> { acao: ACEITAR | RECUSAR }
//
// Sem login. O token (18 bytes aleatorios) so mostra o primeiro nome, o
// servico, o horario e o primeiro nome do profissional.

const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../prisma');
const { responderEnvio } = require('../agenda/encaixe');
const { primeiroNome } = require('../agenda/utilAgenda');

const roteador = express.Router();

const limitadorLeitura = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const limitadorEscrita = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente de novo mais tarde.' },
});

const tokenValido = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t);

roteador.get('/:token', limitadorLeitura, async (req, res) => {
  try {
    if (!tokenValido(req.params.token)) return res.status(404).json({ erro: 'Link inválido.' });
    const envio = await prisma.ofertaEncaixeEnvio.findUnique({
      where: { token: req.params.token },
      include: { oferta: true, listaEspera: { select: { nome: true, servico: true } } },
    });
    if (!envio) return res.status(404).json({ erro: 'Link inválido.' });
    const { oferta } = envio;
    const [cliente, esp] = await Promise.all([
      prisma.cliente.findUnique({ where: { id: oferta.clienteId }, select: { nome: true, brandNome: true, brandLogo: true } }),
      oferta.especialistaId ? prisma.especialista.findUnique({ where: { id: oferta.especialistaId }, select: { nome: true } }) : null,
    ]);
    const vencida = oferta.status !== 'ABERTA' || new Date(oferta.expiraEm).getTime() <= Date.now();
    let situacao = 'ABERTA';
    if (envio.resposta === 'ACEITOU') situacao = 'SUA';
    else if (envio.resposta === 'RECUSOU') situacao = 'RECUSOU';
    else if (envio.resposta === 'TARDE_DEMAIS' || oferta.status === 'PREENCHIDA') situacao = 'PREENCHIDA';
    else if (vencida) situacao = 'VENCIDA';
    res.json({
      negocio: { nome: cliente?.brandNome || cliente?.nome || '', logo: cliente?.brandLogo || null },
      oferta: {
        primeiroNome: primeiroNome(envio.listaEspera.nome),
        servico: oferta.servico || envio.listaEspera.servico,
        profissional: esp ? primeiroNome(esp.nome) : null,
        data: oferta.data, duracao: oferta.duracao, expiraEm: oferta.expiraEm,
        situacao,
      },
    });
  } catch (e) {
    console.error('[publico/encaixe get]', e);
    res.status(500).json({ erro: 'Erro ao carregar a oferta.' });
  }
});

roteador.post('/:token', limitadorEscrita, async (req, res) => {
  try {
    if (!tokenValido(req.params.token)) return res.status(404).json({ erro: 'Link inválido.' });
    const acao = req.body?.acao;
    if (acao !== 'ACEITAR' && acao !== 'RECUSAR') return res.status(422).json({ erro: 'Resposta inválida.', campos: ['acao'] });
    const r = await responderEnvio({ token: req.params.token, acao });
    res.status(r.ok ? 200 : 409).json(r);
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ erro: e.message, codigo: e.codigo });
    console.error('[publico/encaixe post]', e);
    res.status(500).json({ erro: 'Erro ao registrar sua resposta. Tente de novo.' });
  }
});

module.exports = roteador;
