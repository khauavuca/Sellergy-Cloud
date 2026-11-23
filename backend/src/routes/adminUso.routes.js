// Uso e custos por cliente (mensagens, notas) e margem.
// Montado em /admin/uso (src/index.js). Frente D da fase 2.
//
//   GET /admin/uso?mes=YYYY-MM  -> uso por cliente, custo, quanto paga, margem e totais
//   GET /admin/uso/custos       -> precos unitarios e custos fixos (ConfigPlataforma 'custos')
//   PUT /admin/uso/custos       -> { mensagemOficial, mensagemQr, nota, fixos: [{ nome, valor }] }
//
// Ver: todos os papeis. Editar custos: so o dono. Logica em admin/uso.js.

const express = require('express');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerAdmin, requerPapelAdmin } = require('../middlewares/permissoes.middleware');
const { registrarAuditoria } = require('../seguranca/auditoria');
const { relatorioDeUso, lerCustos, salvarCustos, validarCustos } = require('../admin/uso');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerAdmin);

roteador.get('/', requerPapelAdmin('uso.ver'), async (req, res) => {
  try {
    const mes = typeof req.query.mes === 'string' ? req.query.mes : undefined;
    if (mes !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return res.status(422).json({ erro: 'Mês inválido (use AAAA-MM).', campos: ['mes'] });
    res.json(await relatorioDeUso(mes));
  } catch (e) {
    console.error('[admin/uso]', e);
    res.status(500).json({ erro: 'Erro ao calcular o uso.' });
  }
});

roteador.get('/custos', requerPapelAdmin('uso.ver'), async (req, res) => {
  try {
    res.json(await lerCustos());
  } catch (e) {
    console.error('[admin/uso/custos]', e);
    res.status(500).json({ erro: 'Erro ao carregar os custos.' });
  }
});

roteador.put('/custos', requerPapelAdmin('custos.editar'), async (req, res) => {
  try {
    const { erro, campos, custos } = validarCustos(req.body);
    if (erro) return res.status(422).json({ erro, campos });
    const antes = await lerCustos();
    await salvarCustos(custos);
    await registrarAuditoria(req, { acao: 'CUSTOS_EDITAR', alvoTipo: 'PLATAFORMA', detalhes: { antes, depois: custos } });
    res.json(custos);
  } catch (e) {
    console.error('[admin/uso/custos/salvar]', e);
    res.status(500).json({ erro: 'Erro ao salvar os custos.' });
  }
});

module.exports = roteador;
