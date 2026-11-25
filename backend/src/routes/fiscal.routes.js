// Fiscal — Frente 3. Fiacao sobre a camada de adapters (adapters/fiscal):
// config do emissor por tenant + emissao/consulta de DocumentoFiscal.
//
// Emissao e ASSINCRONA no provedor: emitir cria o documento em PROCESSANDO; o
// status final (EMITIDA/ERRO) vem por sincronizacao (consultarStatus): sob
// demanda (POST /documentos/:id/sincronizar) e pela rotina do worker
// (fiscal/tarefasFiscal.js, documentos parados em PROCESSANDO). Sem
// FISCAL_LIVE=true tudo roda em modo 'fixture' (nao bate na rede).
//
// Gating: modulo FISCAL + papel privilegiado (dono/admin) — nota fiscal e
// sensivel; fora da matriz de colaborador por enquanto.
// Ref: docs/erp-arquitetura-e-operacao.md §5. Models: DocumentoFiscal / ConfiguracaoFiscal.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  requerModuloLiberado,
  requerPapelPrivilegiado,
} = require('../middlewares/permissoes.middleware');
const { exigirRecursoNaEscrita } = require('../planos/recursos');
const {
  PROVEDORES,
  TIPO_CREDENCIAL_POR_PROVEDOR,
} = require('../adapters/fiscal');
const {
  emissorDoTenant, criarDocumentoUnico, reservarNumero, mensagemFalhaEmissor, credencialValida,
  codigosFiscaisConhecidos, STATUS_ATIVOS,
} = require('../fiscal/emissao');
const { garantirLimiteNotas } = require('../fiscal/limiteNotas');
const { montarAtualizacaoConfig, avaliarCancelamento, CAMPOS_EMITENTE } = require('../fiscal/regrasRotas');
const assistente = require('../fiscal/assistente');
const { aplicarDocumento, CAMPOS_DOCUMENTO } = require('../services/documentoFiscal');
const {
  soDigitos, validarDocumento, validarNcm, validarCfop, validarCest,
  validarUf, resolverModoFiscal, conteudoCertificadoProibido, validarProntidaoProducao,
} = require('../utils/validacaoFiscal');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerModuloLiberado('FISCAL'));
roteador.use(requerPapelPrivilegiado);
// Nota fiscal: plano Profissional para cima (a tela carrega e mostra o upgrade).
roteador.use(exigirRecursoNaEscrita('notaFiscal'));

const TIPOS = ['NFCE', 'NFSE'];
// Campos do emitente (identidade da empresa na nota): ver fiscal/regrasRotas.js.

// Config (sem o conteudo da credencial / certificado).
const CAMPOS_CONFIG = {
  provedor: true, credencialId: true, regime: true, cnpj: true, inscricao: true,
  csc: true, serie: true, ambiente: true, ativo: true, atualizadoEm: true,
  certificadoRef: true, certificadoValidoAte: true, certificadoTitular: true,
  proximoNumero: true, emitirAutomatico: true, tributacao: true,
  ...Object.fromEntries(CAMPOS_EMITENTE.map((k) => [k, true])),
};

// Emissor do tenant (config + credencial cifrada): ver src/fiscal/emissao.js.
// 'fixture' por padrao; 'live' so com FISCAL_LIVE=true + ambiente PRODUCAO.

// --- Configuracao fiscal (1 por tenant) ---

// GET /fiscal/config
roteador.get('/config', async (req, res) => {
  try {
    const config = await prisma.configuracaoFiscal.findUnique({
      where: { clienteId: req.usuario.clienteId },
      select: CAMPOS_CONFIG,
    });
    res.json(config || null);
  } catch (e) {
    console.error('[fiscal/config get]', e);
    res.status(500).json({ erro: 'Erro ao carregar configuracao fiscal.' });
  }
});

// PUT /fiscal/config -> escolhe emissor + dados do emissor + credencial.
roteador.put('/config', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;

    // SEGURANCA: o certificado digital NUNCA fica conosco — vai pro provedor.
    // Recusa qualquer tentativa de mandar o conteudo/senha do certificado.
    const chaveCert = conteudoCertificadoProibido(req.body || {});
    if (chaveCert) {
      return res.status(400).json({
        erro: 'Por seguranca, o certificado digital nao fica armazenado aqui — ele e enviado direto ao provedor (Focus NFe / Nuvem Fiscal). Informe apenas a referencia, nunca o arquivo ou a senha.',
      });
    }

    const corpo = req.body || {};
    const atual = await prisma.configuracaoFiscal.findUnique({ where: { clienteId } });
    const provedor = corpo.provedor !== undefined ? corpo.provedor : atual?.provedor;

    // PRODUCAO so com o assistente concluido (mesmas pendencias do "Ativar").
    let prontoParaProducao = false;
    if (corpo.ambiente !== undefined && String(corpo.ambiente).toUpperCase() === 'PRODUCAO') {
      const futuro = { ...(atual || {}), ...corpo, provedor };
      const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { segmento: true } });
      const temCredencial = Boolean(await credencialValida(clienteId, futuro));
      const pend = assistente.pendencias(futuro, {
        temCredencial,
        tipos: assistente.tiposPorSegmento(cliente?.segmento),
        emissaoReal: String(process.env.FISCAL_LIVE || '').toLowerCase() === 'true',
      });
      prontoParaProducao = pend.prontoParaTeste;
    }

    const r = montarAtualizacaoConfig(corpo, { atual, provedores: PROVEDORES, prontoParaProducao });
    if (r.erro) return res.status(r.status || 400).json({ erro: r.erro, ...(r.campos ? { campos: r.campos } : {}) });

    const credencialId = r.dados.credencialId !== undefined ? r.dados.credencialId : atual?.credencialId;
    if (credencialId && (r.dados.credencialId !== undefined || r.dados.provedor !== undefined)) {
      const cred = await prisma.credencial.findFirst({
        where: { id: credencialId, clienteId }, select: { tipo: true },
      });
      if (!cred) return res.status(400).json({ erro: 'Credencial nao encontrada para este tenant.' });
      const tipoEsperado = TIPO_CREDENCIAL_POR_PROVEDOR[provedor];
      if (cred.tipo !== tipoEsperado) {
        return res.status(400).json({ erro: `A credencial precisa ser do tipo ${tipoEsperado} para ${provedor}.` });
      }
    }

    const config = await prisma.configuracaoFiscal.upsert({
      where: { clienteId },
      create: { clienteId, ...r.dados },
      update: r.dados,
      select: CAMPOS_CONFIG,
    });
    res.json(config);
  } catch (e) {
    console.error('[fiscal/config put]', e);
    res.status(500).json({ erro: 'Erro ao salvar configuracao fiscal.' });
  }
});

// --- Documentos ---

// GET /fiscal/documentos?status=EMITIDA
roteador.get('/documentos', async (req, res) => {
  try {
    const where = { clienteId: req.usuario.clienteId };
    if (req.query.status) where.status = String(req.query.status).toUpperCase();
    const docs = await prisma.documentoFiscal.findMany({
      where, select: CAMPOS_DOCUMENTO, orderBy: { criadoEm: 'desc' }, take: 100,
    });
    res.json(docs);
  } catch (e) {
    console.error('[fiscal/documentos list]', e);
    res.status(500).json({ erro: 'Erro ao listar documentos fiscais.' });
  }
});

// POST /fiscal/documentos -> emite NFC-e ou NFS-e.
// Body: { tipo, vendaId?, valor, descricao, payload? }
roteador.post('/documentos', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    // `payload` livre nao e mais repassado ao emissor: o corpo da nota e montado
    // aqui (adapters/fiscal/corpoNota) e nao pode ser sobrescrito pelo cliente.
    const { tipo, vendaId, valor, descricao, itens, baseValor } = req.body || {};

    const t = String(tipo || '').toUpperCase();
    if (!TIPOS.includes(t)) {
      return res.status(400).json({ erro: `Tipo invalido. Use: ${TIPOS.join(', ')}.` });
    }

    // Dois modos: por PRODUTOS (valor travado do catalogo, com toggle venda/custo)
    // ou por VALOR avulso (compat). Quando ha itens, o valor vem deles.
    let valorNum;
    let base = null;
    let itensData = [];
    if (Array.isArray(itens) && itens.length > 0) {
      base = String(baseValor || 'VENDA').toUpperCase() === 'CUSTO' ? 'CUSTO' : 'VENDA';
      const norm = [];
      for (let i = 0; i < itens.length; i++) {
        const variacaoId = itens[i]?.variacaoId;
        const quantidade = Number(itens[i]?.quantidade);
        if (!variacaoId || typeof variacaoId !== 'string') {
          return res.status(400).json({ erro: `Item ${i + 1}: produto invalido.` });
        }
        if (!Number.isFinite(quantidade) || quantidade <= 0) {
          return res.status(400).json({ erro: `Item ${i + 1}: quantidade invalida.` });
        }
        // Campos fiscais (opcionais em fixture; obrigatorios no gate de producao).
        const ncm = soDigitos(itens[i]?.ncm);
        const cfop = soDigitos(itens[i]?.cfop);
        const cest = soDigitos(itens[i]?.cest);
        if (!validarNcm(ncm)) return res.status(400).json({ erro: `Item ${i + 1}: NCM deve ter 8 digitos.` });
        if (!validarCfop(cfop)) return res.status(400).json({ erro: `Item ${i + 1}: CFOP deve ter 4 digitos.` });
        if (!validarCest(cest)) return res.status(400).json({ erro: `Item ${i + 1}: CEST deve ter 7 digitos.` });
        norm.push({ variacaoId, quantidade, ncm, cfop, cest });
      }
      const ids = [...new Set(norm.map((n) => n.variacaoId))];
      const variacoes = await prisma.variacaoProduto.findMany({
        where: { id: { in: ids }, produto: { clienteId } },
        include: { produto: { select: { id: true, nome: true } } },
      });
      const mapa = new Map(variacoes.map((v) => [v.id, v]));
      for (const n of norm) {
        const v = mapa.get(n.variacaoId);
        if (!v) return res.status(404).json({ erro: 'Um dos produtos nao foi encontrado.' });
        // valorUnitario TRAVADO do catalogo conforme a base escolhida.
        const unit = base === 'CUSTO' ? Number(v.precoCusto || 0) : Number(v.preco || 0);
        const ehPadrao = !v.nome || v.nome === 'Padrão' || v.nome === 'Padrao';
        itensData.push({
          produtoId: v.produto.id,
          variacaoId: v.id,
          descricao: ehPadrao ? v.produto.nome : `${v.produto.nome} — ${v.nome}`,
          quantidade: n.quantidade,
          valorUnitario: unit,
          valorTotal: Math.round(unit * n.quantidade * 100) / 100,
          ncm: n.ncm || null,
          cfop: n.cfop || null,
          cest: n.cest || null,
        });
      }
      valorNum = Math.round(itensData.reduce((s, it) => s + it.valorTotal, 0) * 100) / 100;
      if (valorNum <= 0) {
        return res.status(400).json({ erro: 'O total da nota ficou zero — confira preco/custo dos itens.' });
      }
    } else {
      valorNum = Number(valor);
      if (!Number.isFinite(valorNum) || valorNum <= 0) {
        return res.status(400).json({ erro: 'Valor invalido.' });
      }
    }

    // Destinatario (validado quando informado).
    const dest = (req.body && req.body.destinatario) || {};
    const destDoc = soDigitos(dest.documento);
    if (destDoc && !validarDocumento(destDoc)) {
      return res.status(400).json({ erro: 'Documento do destinatario (CNPJ/CPF) invalido.' });
    }
    if (dest.uf && !validarUf(dest.uf)) {
      return res.status(400).json({ erro: 'UF do destinatario invalida.' });
    }
    const destData = {
      destNome: dest.nome ? String(dest.nome).slice(0, 120) : null,
      destDocumento: destDoc || null,
      destEmail: dest.email ? String(dest.email).slice(0, 160) : null,
      destUf: dest.uf ? String(dest.uf).toUpperCase().slice(0, 2) : null,
      destMunicipio: dest.municipio ? String(dest.municipio).slice(0, 120) : null,
    };

    // Venda de origem: precisa ser deste negocio; dela vem a forma de pagamento.
    let venda = null;
    if (vendaId) {
      venda = await prisma.venda.findFirst({
        where: { id: String(vendaId), clienteId },
        select: { id: true, metodoPagamento: true, lead: { select: { nome: true, cpf: true, email: true } } },
      });
      if (!venda) return res.status(404).json({ erro: 'Venda nao encontrada.' });
    }

    const { config, emissor } = await emissorDoTenant(clienteId);
    const live = resolverModoFiscal(config) === 'live';

    // NCM/CFOP/CEST que o produto ja usou em nota anterior completam o item.
    if (itensData.some((it) => !it.ncm || !it.cfop)) {
      const conhecidos = await codigosFiscaisConhecidos(clienteId, itensData.map((it) => it.produtoId));
      for (const it of itensData) {
        const c = conhecidos.get(it.produtoId) || {};
        it.ncm = it.ncm || c.ncm || null;
        it.cfop = it.cfop || c.cfop || null;
        it.cest = it.cest || c.cest || null;
      }
    }

    // GATE de PRODUCAO: antes de emitir DE VERDADE, exige emitente/certificado/
    // credencial completos + NCM/CFOP por item + destinatario; senao bloqueia
    // (nada e enviado). Em fixture, nada disso e exigido — facilita o teste.
    if (live) {
      const falta = validarProntidaoProducao(config, t === 'NFCE' ? itensData : [], { tipo: t });
      if (!destData.destNome || !destData.destDocumento) falta.push('destinatario (nome e CNPJ/CPF)');
      if (falta.length) {
        return res.status(422).json({ erro: `Emissao em producao bloqueada — falta: ${falta.join('; ')}.` });
      }
    }

    // Teto de notas do plano (limite notasMes). Venda que ja tem nota viva
    // deste tipo nao gasta cota: cai no "existente" logo abaixo.
    const jaTemNota = venda && await prisma.documentoFiscal.findFirst({
      where: { clienteId, vendaId: venda.id, tipo: t, status: { in: STATUS_ATIVOS } }, select: { id: true },
    });
    if (!jaTemNota) await garantirLimiteNotas({ clienteId });

    // Cria o documento PENDENTE (+ itens); o id vira a refExterna (idempotencia).
    // Trava unica venda+tipo: se ja existe nota viva desta venda, devolve ela.
    const { doc, existente } = await criarDocumentoUnico({
      clienteId,
      vendaId: venda?.id || null,
      tipo: t,
      status: 'PENDENTE',
      provedor: config.provedor,
      baseValor: base,
      valorTotal: valorNum,
      ...destData,
      ...(itensData.length ? { itens: { create: itensData } } : {}),
    });
    if (existente) {
      const atual = await prisma.documentoFiscal.findUnique({ where: { id: doc.id }, select: CAMPOS_DOCUMENTO });
      return res.status(200).json({ ...atual, jaExistia: true, aviso: 'Esta venda já tem uma nota deste tipo. Mostramos a existente.' });
    }

    let dto;
    try {
      const destinatario = destData.destNome || destData.destDocumento
        ? { nome: destData.destNome, documento: destData.destDocumento, email: destData.destEmail, uf: destData.destUf, municipio: destData.destMunicipio }
        : (venda?.lead ? { nome: venda.lead.nome, documento: venda.lead.cpf, email: venda.lead.email } : null);
      const numero = live && config.provedor === 'NUVEM_FISCAL' ? await reservarNumero(clienteId) : null;
      const params = {
        valor: valorNum,
        descricao: descricao || `Documento ${doc.id}`,
        refExterna: doc.id,
        itens: itensData,
        destinatario,
        formaPagamento: req.body?.formaPagamento || venda?.metodoPagamento,
        numero,
      };
      dto = t === 'NFCE' ? await emissor.emitirNFCe(params) : await emissor.emitirNFSe(params);
    } catch (errEmissor) {
      const comErro = await prisma.documentoFiscal.update({
        where: { id: doc.id },
        data: { status: 'ERRO', mensagemErro: mensagemFalhaEmissor(errEmissor) },
        select: CAMPOS_DOCUMENTO,
      });
      return res.status(errEmissor.status === 422 ? 422 : 502).json({ ...comErro, erro: comErro.mensagemErro });
    }

    const atualizado = await aplicarDocumento(doc, dto);
    res.status(201).json(atualizado);
  } catch (e) {
    if (e.status) {
      return res.status(e.status).json({
        erro: e.message,
        ...(e.codigo ? { codigo: e.codigo } : {}),
        ...(e.limite ? { limite: e.limite, maximo: e.maximo, planoSugerido: e.planoSugerido } : {}),
      });
    }
    console.error('[fiscal/documentos emit]', e);
    res.status(500).json({ erro: 'Erro ao emitir documento fiscal.' });
  }
});

// GET /fiscal/documentos/:id
roteador.get('/documentos/:id', async (req, res) => {
  try {
    const doc = await prisma.documentoFiscal.findFirst({
      where: { id: req.params.id, clienteId: req.usuario.clienteId },
      select: {
        ...CAMPOS_DOCUMENTO,
        itens: {
          select: {
            id: true, descricao: true, quantidade: true,
            valorUnitario: true, valorTotal: true, ncm: true, cfop: true, cest: true,
          },
        },
      },
    });
    if (!doc) return res.status(404).json({ erro: 'Documento nao encontrado.' });
    res.json(doc);
  } catch (e) {
    console.error('[fiscal/documentos get]', e);
    res.status(500).json({ erro: 'Erro ao carregar documento.' });
  }
});

// POST /fiscal/documentos/:id/sincronizar -> consulta o status no emissor.
roteador.post('/documentos/:id/sincronizar', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const doc = await prisma.documentoFiscal.findFirst({ where: { id: req.params.id, clienteId } });
    if (!doc) return res.status(404).json({ erro: 'Documento nao encontrado.' });
    if (!doc.provedorDocId) return res.status(400).json({ erro: 'Documento sem id no emissor — nada a sincronizar.' });

    const { emissor } = await emissorDoTenant(clienteId);
    let dto;
    try {
      dto = await emissor.consultarStatus(doc.provedorDocId, doc.tipo);
    } catch (errEmissor) {
      return res.status(errEmissor.status || 502).json({ erro: mensagemFalhaEmissor(errEmissor) });
    }
    const atualizado = await aplicarDocumento(doc, dto);
    res.json(atualizado);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ erro: e.message });
    console.error('[fiscal/documentos sync]', e);
    res.status(500).json({ erro: 'Erro ao sincronizar documento.' });
  }
});

// POST /fiscal/documentos/:id/cancelar -> cancela no emissor.
roteador.post('/documentos/:id/cancelar', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const { motivo, confirmarForaDoPrazo } = req.body || {};
    const doc = await prisma.documentoFiscal.findFirst({ where: { id: req.params.id, clienteId } });
    if (!doc) return res.status(404).json({ erro: 'Documento nao encontrado.' });
    if (!doc.provedorDocId || doc.status !== 'EMITIDA') {
      return res.status(400).json({ erro: 'So documentos EMITIDOS podem ser cancelados.' });
    }

    // Justificativa >= 15 caracteres (SEFAZ/prefeitura) e prazo: NFC-e fora
    // dos ~30 min pede confirmacao; NFS-e so avisa (prazo e do municipio).
    const regra = avaliarCancelamento({
      tipo: doc.tipo, emitidoEm: doc.criadoEm, motivo, confirmarForaDoPrazo: confirmarForaDoPrazo === true,
    });
    if (regra.erro) return res.status(regra.status).json({ erro: regra.erro, codigo: regra.codigo });

    const { emissor } = await emissorDoTenant(clienteId);
    let r;
    try {
      r = await emissor.cancelar(doc.provedorDocId, regra.motivo, doc.tipo);
    } catch (errEmissor) {
      return res.status(errEmissor.status || 502).json({ erro: mensagemFalhaEmissor(errEmissor), aviso: regra.aviso });
    }
    if (r.status === 'ERRO') {
      // A nota continua EMITIDA; so o pedido de cancelamento foi recusado.
      return res.status(422).json({ erro: `O emissor não cancelou a nota: ${r.mensagemErro || 'motivo não informado'}.`, aviso: regra.aviso });
    }
    if (r.status !== 'CANCELADA') {
      return res.status(202).json({ id: doc.id, status: doc.status, aviso: 'Cancelamento em processamento no emissor. Sincronize em alguns minutos.' });
    }
    const atualizado = await aplicarDocumento(doc, { provedorDocId: doc.provedorDocId, status: r.status });
    res.json({ ...atualizado, aviso: regra.aviso });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ erro: e.message });
    console.error('[fiscal/documentos cancel]', e);
    res.status(500).json({ erro: 'Erro ao cancelar documento.' });
  }
});

roteador.use('/assistente', require('../fiscal/assistente.routes'));

module.exports = roteador;
