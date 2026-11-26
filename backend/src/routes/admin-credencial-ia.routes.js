// Rota ADMIN pra gerenciar a UNICA credencial de IA da plataforma (a chave da
// DeepSeek, da Sellergy — nao do tenant). Montada em /admin/plataforma.
//
// Diferenca da rota de credenciais por-cliente (admin-credenciais.routes.js):
// aqui nao existe :clienteId — a credencial nao pertence a nenhum tenant, e
// so pode existir UMA linha desse tipo (ver credenciais.js). Por isso rota
// propria em vez de reaproveitar aquela.
//
// SEGURANCA (mesmo padrao da rota por-cliente):
//  - So ADMIN do sistema: middlewareAutenticacao + requerAdmin.
//  - O SEGREDO vai so no corpo do PUT — nunca retorna pela API (semSegredos).
//  - Cifrada com AES-GCM, contexto de derivacao proprio de plataforma (nao
//    reaproveita a derivacao por-tenant) — ver credenciais.js.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerAdmin } = require('../middlewares/permissoes.middleware');
const { salvarCredencialPlataforma } = require('../credenciais');
const {
  TAM_MAX_NOME,
  validarPayload,
  semSegredos,
} = require('../credenciaisCore');

const TIPO = 'DEEPSEEK_KEY';

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerAdmin);

// GET — metadata da credencial de IA da plataforma (sem o segredo). Devolve
// null se ainda nao foi configurada (o front trata como "IA nao disponivel").
roteador.get('/credencial-ia', async (req, res) => {
  try {
    const credencial = await prisma.credencial.findFirst({ where: { clienteId: null, tipo: TIPO } });
    res.json(credencial ? semSegredos(credencial) : null);
  } catch (erro) {
    console.error('[admin/plataforma/credencial-ia/get]', erro);
    res.status(500).json({ erro: 'Erro ao buscar credencial de IA.' });
  }
});

// PUT — cria ou substitui a chave. Body: { nome?, apiKey }.
roteador.put('/credencial-ia', async (req, res) => {
  try {
    const { nome, apiKey } = req.body || {};
    const nomeFinal = typeof nome === 'string' && nome.trim() ? nome.trim() : 'DeepSeek (plataforma)';
    if (nomeFinal.length > TAM_MAX_NOME) {
      return res.status(400).json({ erro: `Nome excede ${TAM_MAX_NOME} caracteres.` });
    }

    const valid = validarPayload(TIPO, { apiKey });
    if (valid.erro) return res.status(400).json({ erro: valid.erro });

    const credencial = await salvarCredencialPlataforma({
      tipo: TIPO,
      nome: nomeFinal,
      payload: { apiKey: String(apiKey).trim() },
      criadoPorId: req.usuario.id || null,
    });
    res.json(semSegredos(credencial));
  } catch (erro) {
    console.error('[admin/plataforma/credencial-ia/put]', erro);
    res.status(500).json({ erro: 'Erro ao salvar credencial de IA.' });
  }
});

// DELETE — remove a chave (desliga o atendimento com IA pra toda a plataforma
// ate uma nova ser cadastrada). Bots com iaAtiva continuam ativos no cadastro,
// mas a chamada a DeepSeek falha e cai no aviso de erro tratado pelo iaRouter.
roteador.delete('/credencial-ia', async (req, res) => {
  try {
    await prisma.credencial.deleteMany({ where: { clienteId: null, tipo: TIPO } });
    res.json({ ok: true });
  } catch (erro) {
    console.error('[admin/plataforma/credencial-ia/delete]', erro);
    res.status(500).json({ erro: 'Erro ao remover credencial de IA.' });
  }
});

// =====================================================================
// INTEGRACOES DA PLATAFORMA (tela Admin › Integracoes)
// Chaves da Sellergy, uma por tipo: a da IA (DeepSeek) e a de revenda fiscal
// (Focus NFe — unico emissor fiscal; ver fiscal/revenda.js). Pagamento e WhatsApp oficial NAO entram aqui:
// sao sempre do cliente (o Pix cai na conta do dono da chave; o WhatsApp
// oficial usa o app do proprio cliente na Meta).
// =====================================================================
const { carregarCredencialDecifrada } = require('../credenciais');

const TIPOS_PLATAFORMA = {
  DEEPSEEK_KEY: { nome: 'DeepSeek (plataforma)', campos: ['apiKey'] },
  FOCUS_NFE_KEY: { nome: 'Focus NFe (revenda)', campos: ['token'] },
};
const TIPOS_PAGAMENTO = { MERCADO_PAGO_KEY: 'Mercado Pago', ASAAS_KEY: 'Asaas', PAGARME_KEY: 'Pagar.me' };

// GET /admin/plataforma/credenciais — situacao de cada chave (sem segredo).
roteador.get('/credenciais', async (req, res) => {
  try {
    const linhas = await prisma.credencial.findMany({
      where: { clienteId: null, tipo: { in: Object.keys(TIPOS_PLATAFORMA) } },
      select: { id: true, tipo: true, nome: true, criadoEm: true, atualizadoEm: true, ultimoUsoEm: true },
    });
    const porTipo = Object.fromEntries(linhas.map((l) => [l.tipo, l]));
    res.json(Object.keys(TIPOS_PLATAFORMA).map((tipo) => ({ tipo, configurada: !!porTipo[tipo], ...(porTipo[tipo] || {}) })));
  } catch (erro) {
    console.error('[admin/plataforma/credenciais/listar]', erro);
    res.status(500).json({ erro: 'Erro ao listar as chaves da plataforma.' });
  }
});

// PUT /admin/plataforma/credenciais/:tipo — cria ou troca. Body: { dados: {...} }.
roteador.put('/credenciais/:tipo', async (req, res) => {
  try {
    const { tipo } = req.params;
    const def = TIPOS_PLATAFORMA[tipo];
    if (!def) return res.status(404).json({ erro: 'Tipo de chave da plataforma desconhecido.' });
    const entrada = req.body?.dados && typeof req.body.dados === 'object' ? req.body.dados : {};
    const payload = {};
    for (const campo of def.campos) {
      const v = entrada[campo];
      if (typeof v === 'string' && v.trim()) payload[campo] = v.trim();
    }
    const valid = validarPayload(tipo, payload);
    if (valid.erro) return res.status(400).json({ erro: valid.erro });
    const credencial = await salvarCredencialPlataforma({ tipo, nome: def.nome, payload, criadoPorId: req.usuario.id || null });
    res.json({ ...semSegredos(credencial), configurada: true });
  } catch (erro) {
    console.error('[admin/plataforma/credenciais/salvar]', erro);
    res.status(500).json({ erro: 'Erro ao salvar a chave.' });
  }
});

// DELETE /admin/plataforma/credenciais/:tipo
roteador.delete('/credenciais/:tipo', async (req, res) => {
  try {
    if (!TIPOS_PLATAFORMA[req.params.tipo]) return res.status(404).json({ erro: 'Tipo de chave da plataforma desconhecido.' });
    await prisma.credencial.deleteMany({ where: { clienteId: null, tipo: req.params.tipo } });
    res.json({ ok: true });
  } catch (erro) {
    console.error('[admin/plataforma/credenciais/remover]', erro);
    res.status(500).json({ erro: 'Erro ao remover a chave.' });
  }
});

/** Regra pura: como mostrar o WhatsApp de um bot na tabela "Por cliente". */
function situacaoWhatsapp(bot, temSegredo) {
  if (!bot) return { rotulo: 'Sem bot', tom: 'neutro' };
  if (bot.provedorCanal === 'BAILEYS') {
    return bot.statusConexaoBaileys === 'CONECTADO' ? { rotulo: 'QR Code', tom: 'info' } : { rotulo: 'QR Code desconectado', tom: 'alerta' };
  }
  if (!bot.identificadorCanal || !bot.credencialCanalId) return { rotulo: 'Não conectado', tom: 'neutro' };
  if (!temSegredo) return { rotulo: 'Oficial · falta segredo', tom: 'alerta' };
  if (!bot.webhookConfirmadoEm) return { rotulo: 'Oficial · falta webhook', tom: 'alerta' };
  return { rotulo: 'Oficial', tom: 'ok' };
}

/** Regra pura: como mostrar as notas fiscais do cliente. */
function situacaoNotas(fiscal, idsRevenda = new Set()) {
  if (!fiscal?.credencialId) return { rotulo: 'Não ativou', tom: 'neutro' };
  const ativa = fiscal.ativo && fiscal.ambiente === 'PRODUCAO';
  const origem = idsRevenda.has(fiscal.credencialId) ? 'Sellergy' : 'Chave própria';
  return ativa ? { rotulo: origem, tom: origem === 'Sellergy' ? 'ok' : 'info' } : { rotulo: `${origem} · em teste`, tom: 'alerta' };
}

// GET /admin/plataforma/integracoes/clientes — de onde vem cada integracao de cada cliente.
roteador.get('/integracoes/clientes', async (req, res) => {
  try {
    const [clientes, bots, fiscais, credsRevenda, pagamentos] = await Promise.all([
      prisma.cliente.findMany({ select: { id: true, nome: true, status: true }, orderBy: { nome: 'asc' }, take: 500 }),
      prisma.bot.findMany({
        select: {
          clienteId: true, provedorCanal: true, statusConexaoBaileys: true, identificadorCanal: true,
          credencialCanalId: true, webhookConfirmadoEm: true, iaAtiva: true,
        },
        orderBy: { criadoEm: 'asc' },
      }),
      prisma.configuracaoFiscal.findMany({ select: { clienteId: true, credencialId: true, ativo: true, ambiente: true } }),
      prisma.credencial.findMany({ where: { clienteId: { not: null }, descricao: 'revenda-sellergy' }, select: { id: true } }),
      prisma.credencial.findMany({
        where: { clienteId: { not: null }, tipo: { in: Object.keys(TIPOS_PAGAMENTO) } },
        select: { clienteId: true, tipo: true },
      }),
    ]);
    const botPorCliente = new Map();
    for (const b of bots) if (!botPorCliente.has(b.clienteId)) botPorCliente.set(b.clienteId, b);
    const fiscalPorCliente = new Map(fiscais.map((f) => [f.clienteId, f]));
    const idsRevenda = new Set(credsRevenda.map((c) => c.id));
    const pagPorCliente = new Map();
    for (const p of pagamentos) {
      const l = pagPorCliente.get(p.clienteId) || [];
      l.push(TIPOS_PAGAMENTO[p.tipo]);
      pagPorCliente.set(p.clienteId, l);
    }

    const linhas = [];
    for (const c of clientes) {
      const bot = botPorCliente.get(c.id) || null;
      let temSegredo = false;
      if (bot && bot.provedorCanal === 'META_CLOUD' && bot.credencialCanalId) {
        const cred = await carregarCredencialDecifrada({ credencialId: bot.credencialCanalId, clienteId: c.id }).catch(() => null);
        temSegredo = !!cred?.dados?.appSecret;
      }
      const fiscal = fiscalPorCliente.get(c.id);
      const pag = [...new Set(pagPorCliente.get(c.id) || [])];
      linhas.push({
        clienteId: c.id,
        nome: c.nome,
        status: c.status,
        whatsapp: situacaoWhatsapp(bot, temSegredo),
        notas: situacaoNotas(fiscal, idsRevenda),
        ia: bot ? (bot.iaAtiva ? { rotulo: 'Ligada', tom: 'ok' } : { rotulo: 'Desligada', tom: 'neutro' }) : { rotulo: '—', tom: 'neutro' },
        pagamento: pag.length ? { rotulo: pag.join(', '), tom: 'neutro' } : { rotulo: 'Não configurado', tom: 'alerta' },
      });
    }
    res.json({
      clientes: linhas,
      totais: {
        clientes: linhas.length,
        iaLigada: linhas.filter((l) => l.ia.rotulo === 'Ligada').length,
        oficialConectado: linhas.filter((l) => l.whatsapp.rotulo === 'Oficial').length,
        oficialPendente: linhas.filter((l) => l.whatsapp.rotulo.startsWith('Oficial ·')).length,
        semPagamento: linhas.filter((l) => l.pagamento.rotulo === 'Não configurado').length,
      },
    });
  } catch (erro) {
    console.error('[admin/plataforma/integracoes/clientes]', erro);
    res.status(500).json({ erro: 'Erro ao montar as integrações por cliente.' });
  }
});

// =====================================================================
// IA DA PLATAFORMA (cartao "IA da plataforma" em Admin › Integracoes):
// provedor (DeepSeek direto ou OpenRouter), modelo e teste. Tudo dentro da
// mesma credencial cifrada DEEPSEEK_KEY — ver services/iaPlataforma.js.
// =====================================================================
const credModulo = require('../credenciais');
const iaPlataforma = require('../services/iaPlataforma');
const { criarProvedorIA } = require('../adapters/ia');

// GET /admin/plataforma/ia — situacao (sem a chave).
roteador.get('/ia', async (req, res) => {
  try {
    const linha = await prisma.credencial.findFirst({
      where: { clienteId: null, tipo: TIPO },
      select: { atualizadoEm: true, criadoEm: true, ultimoUsoEm: true },
    });
    let config = { provedor: 'DEEPSEEK', modelo: null };
    if (linha) {
      const cred = await credModulo.carregarCredencialPlataforma(TIPO);
      config = iaPlataforma.configDaCredencial(cred?.dados);
    }
    res.json({
      configurada: !!linha,
      ...config,
      desde: linha ? (linha.atualizadoEm || linha.criadoEm) : null,
      ultimoUsoEm: linha?.ultimoUsoEm || null,
      ligadaNosBots: process.env.IA_MODO === 'live',
    });
  } catch (erro) {
    console.error('[admin/plataforma/ia/get]', erro);
    res.status(500).json({ erro: 'Erro ao buscar a IA da plataforma.' });
  }
});

// PUT /admin/plataforma/ia — { provedor, modelo?, apiKey? }. Sem apiKey,
// mantem a chave atual (so troca o modelo) — mas trocar de provedor exige
// chave nova, porque a chave de um nao vale no outro.
roteador.put('/ia', async (req, res) => {
  try {
    const corpo = req.body || {};
    const cfg = iaPlataforma.validarConfigIA(corpo);
    if (cfg.erro) return res.status(400).json({ erro: cfg.erro });
    let apiKey = typeof corpo.apiKey === 'string' ? corpo.apiKey.trim() : '';
    if (apiKey.length > 2000) return res.status(400).json({ erro: 'Chave grande demais.' });
    if (!apiKey) {
      const atual = await credModulo.carregarCredencialPlataforma(TIPO);
      if (!atual?.dados?.apiKey) return res.status(400).json({ erro: 'Cole a chave (API key).' });
      if (iaPlataforma.configDaCredencial(atual.dados).provedor !== cfg.provedor) {
        return res.status(400).json({ erro: `Cole a chave do ${iaPlataforma.PROVEDORES_IA[cfg.provedor].nome}.` });
      }
      apiKey = atual.dados.apiKey;
    }
    const payload = { apiKey, provedor: cfg.provedor, ...(cfg.modelo ? { modelo: cfg.modelo } : {}) };
    await credModulo.salvarCredencialPlataforma({
      tipo: TIPO,
      nome: `${iaPlataforma.PROVEDORES_IA[cfg.provedor].nome} (plataforma)`,
      payload,
      criadoPorId: req.usuario.id || null,
    });
    res.json({ ok: true, configurada: true, provedor: cfg.provedor, modelo: cfg.modelo });
  } catch (erro) {
    console.error('[admin/plataforma/ia/put]', erro);
    res.status(500).json({ erro: 'Erro ao salvar a IA da plataforma.' });
  }
});

// GET /admin/plataforma/ia/modelos — modelos do OpenRouter que aceitam ferramentas.
roteador.get('/ia/modelos', async (req, res) => {
  try {
    res.json(await iaPlataforma.modelosOpenRouter());
  } catch (erro) {
    console.error('[admin/plataforma/ia/modelos]', erro?.message || erro);
    res.status(502).json({ erro: 'Não foi possível buscar a lista do OpenRouter agora.' });
  }
});

// POST /admin/plataforma/ia/testar — manda um "oi" de verdade (ignora
// IA_MODO) com a chave salva e devolve a resposta ou o erro do provedor.
roteador.post('/ia/testar', async (req, res) => {
  const inicio = Date.now();
  let config = null;
  try {
    const cred = await credModulo.carregarCredencialPlataforma(TIPO);
    if (!cred) return res.status(400).json({ ok: false, erro: 'Salve a chave antes de testar.' });
    config = iaPlataforma.configDaCredencial(cred.dados);
    const provedor = criarProvedorIA('DEEPSEEK', { credencial: cred, modo: 'live' });
    const r = await provedor.responder({
      mensagens: [
        { role: 'system', content: 'Você é o atendente de uma loja. Responda em português, em uma frase curta.' },
        { role: 'user', content: 'Oi, tudo bem? Vocês estão abertos hoje?' },
      ],
      maxTokens: 400,
    });
    res.json({
      ok: true,
      texto: String(r.texto || '').slice(0, 500),
      modelo: r.bruto?.model || config.modelo,
      ms: Date.now() - inicio,
      tokens: r.tokensTotal,
    });
  } catch (erro) {
    res.json({ ok: false, erro: iaPlataforma.mensagemDoErro(erro), modelo: config?.modelo || null, ms: Date.now() - inicio });
  }
});

module.exports = roteador;
module.exports.situacaoWhatsapp = situacaoWhatsapp;
module.exports.situacaoNotas = situacaoNotas;
