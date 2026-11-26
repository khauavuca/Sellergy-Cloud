// Precos e limites dos planos editaveis + cupons.
// Montado em /admin/planos (src/index.js). Frente D da fase 2.
//
//   GET    /admin/planos                 -> planos efetivos, padrao do codigo, clientes por plano
//   PUT    /admin/planos/:codigo         -> { precoMensal, limites: { usuarios, profissionais, lembretesMes } }
//   DELETE /admin/planos/:codigo         -> volta ao preco/limite do codigo
//   GET    /admin/planos/cupons
//   POST   /admin/planos/cupons          -> { codigo, tipo: PERCENTUAL|MESES_GRATIS, valor, duracaoMeses?, validoAte?, limiteUsos?, descricao? }
//   PUT    /admin/planos/cupons/:codigo  -> { ativo }
//
// Ver: todos. Editar preco e cupom: so o dono. Regras (preco novo vale pra
// novos; quem ja assina mantem) em admin/planos.js. Sincronizacao do cache
// em memoria em planos/sincronizacao.js (ligada aqui, no boot da API).

const express = require('express');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerAdmin, requerPapelAdmin } = require('../middlewares/permissoes.middleware');
const { registrarAuditoria } = require('../seguranca/auditoria');
const { PLANOS_BASE } = require('../planos/catalogo');
const { recarregarPlanos, publicarMudanca, iniciarSincronizacao } = require('../planos/sincronizacao');
const planosAdmin = require('../admin/planos');

// Carrega o override do banco assim que a API sobe (este arquivo e montado
// no boot pelo src/index.js) e mantem atualizado.
iniciarSincronizacao();

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerAdmin);

roteador.get('/', requerPapelAdmin('clientes.ver'), async (req, res) => {
  try {
    res.json({ planos: await planosAdmin.listarPlanos() });
  } catch (e) {
    console.error('[admin/planos]', e);
    res.status(500).json({ erro: 'Erro ao carregar os planos.' });
  }
});

// ---------- Cupons (antes de /:codigo) ----------

roteador.get('/cupons', requerPapelAdmin('clientes.ver'), async (req, res) => {
  try {
    res.json({ cupons: await planosAdmin.lerCupons() });
  } catch (e) {
    console.error('[admin/planos/cupons]', e);
    res.status(500).json({ erro: 'Erro ao carregar os cupons.' });
  }
});

roteador.post('/cupons', requerPapelAdmin('cupons.editar'), async (req, res) => {
  try {
    const atuais = await planosAdmin.lerCupons();
    if (atuais.length >= 200) return res.status(422).json({ erro: 'Limite de 200 cupons. Desligue os antigos.' });
    const { erro, campos, cupom } = planosAdmin.validarCupom(req.body, atuais);
    if (erro) return res.status(422).json({ erro, campos });
    const completo = { ...cupom, criadoEm: new Date().toISOString(), criadoPor: req.usuario.nome || null };
    await planosAdmin.gravarCupons([completo, ...atuais]);
    await registrarAuditoria(req, { acao: 'CUPOM_CRIAR', alvoTipo: 'CUPOM', alvoId: cupom.codigo, detalhes: cupom });
    res.status(201).json(completo);
  } catch (e) {
    console.error('[admin/planos/cupons/criar]', e);
    res.status(500).json({ erro: 'Erro ao criar o cupom.' });
  }
});

roteador.put('/cupons/:codigo', requerPapelAdmin('cupons.editar'), async (req, res) => {
  try {
    if (typeof req.body?.ativo !== 'boolean') return res.status(422).json({ erro: 'Informe se o cupom fica ligado.', campos: ['ativo'] });
    const atuais = await planosAdmin.lerCupons();
    const codigo = String(req.params.codigo).toUpperCase();
    const idx = atuais.findIndex((c) => c.codigo === codigo);
    if (idx < 0) return res.status(404).json({ erro: 'Cupom não encontrado.' });
    atuais[idx] = { ...atuais[idx], ativo: req.body.ativo };
    await planosAdmin.gravarCupons(atuais);
    await registrarAuditoria(req, { acao: req.body.ativo ? 'CUPOM_LIGAR' : 'CUPOM_DESLIGAR', alvoTipo: 'CUPOM', alvoId: codigo });
    res.json(atuais[idx]);
  } catch (e) {
    console.error('[admin/planos/cupons/editar]', e);
    res.status(500).json({ erro: 'Erro ao atualizar o cupom.' });
  }
});

// ---------- Preco e limites ----------

roteador.put('/:codigo', requerPapelAdmin('precos.editar'), async (req, res) => {
  try {
    const codigo = req.params.codigo;
    if (!PLANOS_BASE[codigo]) return res.status(404).json({ erro: 'Plano não encontrado.' });
    const { erro, campos, dados } = planosAdmin.validarPlano(req.body);
    if (erro) return res.status(422).json({ erro, campos });
    const r = await planosAdmin.salvarPlano(codigo, dados, req.usuario.nome);
    await recarregarPlanos();
    await publicarMudanca();
    await registrarAuditoria(req, {
      acao: 'PLANO_EDITAR', alvoTipo: 'PLANO', alvoId: codigo,
      detalhes: { antes: r.anterior, depois: dados, assinantesMantiveramPreco: r.mantidos },
    });
    res.json({ planos: await planosAdmin.listarPlanos(), assinantesMantiveramPreco: r.mantidos });
  } catch (e) {
    console.error('[admin/planos/salvar]', e);
    res.status(500).json({ erro: 'Erro ao salvar o plano.' });
  }
});

roteador.delete('/:codigo', requerPapelAdmin('precos.editar'), async (req, res) => {
  try {
    const codigo = req.params.codigo;
    if (!PLANOS_BASE[codigo]) return res.status(404).json({ erro: 'Plano não encontrado.' });
    const r = await planosAdmin.restaurarPadrao(codigo, req.usuario.nome);
    await recarregarPlanos();
    await publicarMudanca();
    await registrarAuditoria(req, {
      acao: 'PLANO_RESTAURAR_PADRAO', alvoTipo: 'PLANO', alvoId: codigo,
      detalhes: { antes: r.anterior, assinantesMantiveramPreco: r.mantidos },
    });
    res.json({ planos: await planosAdmin.listarPlanos(), assinantesMantiveramPreco: r.mantidos });
  } catch (e) {
    console.error('[admin/planos/restaurar]', e);
    res.status(500).json({ erro: 'Erro ao voltar o plano ao padrão.' });
  }
});

module.exports = roteador;
