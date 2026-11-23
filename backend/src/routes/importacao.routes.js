// Importar planilha de clientes, produtos e servicos (e desfazer).
// Montado em /importacao (src/index.js). Frente C da fase 2.
//
// A planilha e lida no navegador (CSV/XLSX) e chega aqui como linhas JSON ja
// mapeadas pros campos do sistema. Fluxo:
//   POST /importacao/mapear     -> sugere o campo de cada coluna (por nome)
//   POST /importacao/analisar   -> valida tudo e diz o que entra, junta ou tem problema
//   POST /importacao            -> grava (revalida no servidor) e registra a Importacao
//   GET  /importacao            -> ultimas importacoes
//   POST /importacao/:id/desfazer -> apaga so o que foi criado e ainda nao foi usado
//
// O corpo pode passar de 1 MB (5.000 linhas), entao o front manda com o tipo
// `application/vnd.sellergy.importacao+json`, que o parser global ignora e este
// roteador le com limite proprio.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  requerTenant, requerModuloLiberado, requerPapelPrivilegiado,
} = require('../middlewares/permissoes.middleware');
const {
  TIPOS, CAMPOS, ROTULOS, LIMITE_LINHAS, sugerirMapeamento,
} = require('../importacao/normalizar');
const servico = require('../importacao/servico');

const TIPO_CORPO = 'application/vnd.sellergy.importacao+json';

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerTenant);
roteador.use(requerPapelPrivilegiado);
// Importacao e sempre de um negocio: o admin do sistema (sem clienteId) nao usa.
roteador.use((req, res, next) => (req.usuario.clienteId ? next() : res.status(403).json({ erro: 'Entre com a conta do negócio para importar.' })));
roteador.use(express.json({ type: TIPO_CORPO, limit: '6mb' }));

const MODULO_POR_TIPO = { CLIENTES: 'CRM', PRODUTOS: 'CATALOGO', SERVICOS: 'CATALOGO' };

function clienteIdDe(req) {
  return req.usuario.clienteId;
}

/** Valida o corpo comum (tipo + linhas) e ja confere o modulo do tipo. */
function lerCorpo(req, res, next) {
  const corpo = req.body || {};
  const tipo = String(corpo.tipo || '').toUpperCase();
  if (!TIPOS.includes(tipo)) return res.status(400).json({ erro: 'Escolha o que vai importar: clientes, produtos ou serviços.', campos: ['tipo'] });
  if (!Array.isArray(corpo.linhas) || corpo.linhas.length === 0) {
    return res.status(400).json({ erro: 'A planilha está vazia.', campos: ['linhas'] });
  }
  if (corpo.linhas.length > LIMITE_LINHAS) {
    return res.status(413).json({ erro: `A planilha tem ${corpo.linhas.length} linhas. O máximo é ${LIMITE_LINHAS} por vez: divida em partes.` });
  }
  const campos = new Set([...CAMPOS[tipo], '_linha', 'pular']);
  const linhas = corpo.linhas.map((l) => {
    const limpa = {};
    if (!l || typeof l !== 'object' || Array.isArray(l)) return limpa;
    for (const [k, v] of Object.entries(l)) {
      if (!campos.has(k)) continue;
      if (k === 'pular') limpa.pular = v === true;
      else if (k === '_linha') limpa._linha = Number.isInteger(v) ? v : undefined;
      else if (typeof v === 'string' || typeof v === 'number') limpa[k] = typeof v === 'string' ? v.slice(0, 2000) : v;
    }
    return limpa;
  });
  req.importacao = { tipo, linhas, arquivoNome: String(corpo.arquivoNome || 'planilha').slice(0, 200) };
  return requerModuloLiberado(MODULO_POR_TIPO[tipo])(req, res, next);
}

roteador.get('/', async (req, res) => {
  try {
    const lista = await prisma.importacao.findMany({
      where: { clienteId: clienteIdDe(req) },
      orderBy: { criadoEm: 'desc' },
      take: 20,
    });
    res.json(lista.map(servico.resumoImportacao));
  } catch (e) {
    console.error('[importacao/listar]', e);
    res.status(500).json({ erro: 'Não foi possível carregar as importações.' });
  }
});

// Sugestao automatica de colunas (mesma regra do servidor, fonte unica).
roteador.post('/mapear', (req, res) => {
  const tipo = String(req.body?.tipo || '').toUpperCase();
  const cabecalhos = Array.isArray(req.body?.cabecalhos) ? req.body.cabecalhos.slice(0, 200).map((c) => String(c ?? '').slice(0, 120)) : null;
  if (!TIPOS.includes(tipo) || !cabecalhos) return res.status(400).json({ erro: 'Envie o tipo e os nomes das colunas.' });
  return res.json({
    mapeamento: sugerirMapeamento(cabecalhos, tipo),
    campos: CAMPOS[tipo].map((c) => ({ campo: c, rotulo: ROTULOS[c], obrigatorio: c === 'nome' || (tipo !== 'CLIENTES' && c === 'preco') })),
    limiteLinhas: LIMITE_LINHAS,
  });
});

roteador.post('/analisar', lerCorpo, async (req, res) => {
  try {
    const analise = await servico.analisar({ clienteId: clienteIdDe(req), tipo: req.importacao.tipo, linhas: req.importacao.linhas });
    res.json(servico.paraResposta(analise));
  } catch (e) {
    console.error('[importacao/analisar]', e);
    res.status(500).json({ erro: 'Não foi possível conferir a planilha. Tente de novo.' });
  }
});

roteador.post('/', lerCorpo, async (req, res) => {
  try {
    const r = await servico.importar({
      clienteId: clienteIdDe(req),
      usuarioId: req.usuario.id,
      tipo: req.importacao.tipo,
      arquivoNome: req.importacao.arquivoNome,
      linhas: req.importacao.linhas,
    });
    res.status(r.falha ? 207 : 201).json(r);
  } catch (e) {
    console.error('[importacao/importar]', e);
    res.status(500).json({ erro: 'Não foi possível importar. Nada foi gravado.' });
  }
});

roteador.post('/:id/desfazer', async (req, res) => {
  try {
    const imp = await prisma.importacao.findFirst({ where: { id: req.params.id, clienteId: clienteIdDe(req) }, select: { tipo: true } });
    if (!imp) return res.status(404).json({ erro: 'Importação não encontrada.' });
    const liberado = await new Promise((ok) => {
      res.once('finish', () => ok(false));
      requerModuloLiberado(MODULO_POR_TIPO[imp.tipo])(req, res, () => ok(true));
    });
    if (!liberado || res.headersSent) return undefined;
    const r = await servico.desfazer({ clienteId: clienteIdDe(req), importacaoId: req.params.id });
    return res.json(r);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ erro: e.message });
    console.error('[importacao/desfazer]', e);
    return res.status(500).json({ erro: 'Não foi possível desfazer a importação.' });
  }
});

module.exports = roteador;
