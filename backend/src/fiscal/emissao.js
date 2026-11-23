// Emissao fiscal fora da tela de documentos: nota de teste do assistente e
// "emitir sozinho" das vendas pagas (rotina em ./tarefasFiscal.js).
// A emissao manual continua em routes/fiscal.routes.js (POST /documentos).

const prisma = require('../prisma');
const { carregarCredencialDecifrada } = require('../credenciais');
const { criarProvedor, TIPO_CREDENCIAL_POR_PROVEDOR } = require('../adapters/fiscal');
const { aplicarDocumento } = require('../services/documentoFiscal');
const { resolverModoFiscal, validarProntidaoProducao } = require('../utils/validacaoFiscal');
const { tiposPorSegmento } = require('./assistente');
const { criarNotificacaoTenant } = require('../utils/notificacoes');

function erro(status, mensagem) {
  return Object.assign(new Error(mensagem), { status });
}

/** Monta o emissor do tenant (mesma regra da rota: 'live' so com FISCAL_LIVE e PRODUCAO). */
async function emissorDoTenant(clienteId) {
  const config = await prisma.configuracaoFiscal.findUnique({ where: { clienteId } });
  if (!config || !config.ativo) throw erro(400, 'Fiscal nao configurado ou inativo para este tenant.');
  const credencial = await carregarCredencialDecifrada({ credencialId: config.credencialId, clienteId });
  const ambiente = config.ambiente === 'PRODUCAO' ? 'producao' : 'homologacao';
  const emissor = criarProvedor(config.provedor, { credencial, config, ambiente, modo: resolverModoFiscal(config) });
  return { config, emissor };
}

/** Credencial do emissor escolhido existe e e do tipo certo? */
async function credencialValida(clienteId, config) {
  if (!config?.credencialId || !config?.provedor) return null;
  const cred = await prisma.credencial.findFirst({
    where: { id: config.credencialId, clienteId, tipo: TIPO_CREDENCIAL_POR_PROVEDOR[config.provedor] },
    select: { id: true },
  });
  return cred ? cred.id : null;
}

/**
 * Nota de teste de R$ 1,00 no ambiente de HOMOLOGACAO (sem valor fiscal).
 * Bate no provedor de verdade so com FISCAL_LIVE=true; sem isso, simula.
 * Nao grava DocumentoFiscal (nao polui a lista de notas da empresa).
 */
async function emitirNotaDeTeste({ clienteId, tipos }) {
  const config = await prisma.configuracaoFiscal.findUnique({ where: { clienteId } });
  const credencial = await carregarCredencialDecifrada({ credencialId: config.credencialId, clienteId });
  const live = String(process.env.FISCAL_LIVE || '').toLowerCase() === 'true';
  const emissor = criarProvedor(config.provedor, {
    credencial, config: { ...config, ambiente: 'HOMOLOGACAO' }, ambiente: 'homologacao', modo: live ? 'live' : 'fixture',
  });
  const resultados = [];
  for (const tipo of tipos) {
    const inicio = Date.now();
    const ref = `teste-${clienteId.slice(0, 8)}-${tipo.toLowerCase()}-${inicio}`;
    try {
      const params = { valor: 1, descricao: 'Nota de teste Sellergy (homologação, sem valor fiscal)', refExterna: ref };
      let dto = tipo === 'NFCE' ? await emissor.emitirNFCe(params) : await emissor.emitirNFSe(params);
      if (dto.status === 'PROCESSANDO' && dto.provedorDocId) {
        dto = await emissor.consultarStatus(dto.provedorDocId);
      }
      resultados.push({
        tipo,
        status: dto.status,
        numero: dto.numero || null,
        mensagem: dto.status === 'ERRO' ? (dto.mensagemErro || 'O emissor recusou a nota.') : null,
        ms: Date.now() - inicio,
      });
    } catch (e) {
      resultados.push({ tipo, status: 'ERRO', numero: null, mensagem: e.status === 502 ? 'O emissor não respondeu ou recusou o acesso.' : (e.message || 'Falha ao emitir.'), ms: Date.now() - inicio });
    }
  }
  return { simulado: !live, resultados, ok: resultados.every((r) => r.status === 'EMITIDA') };
}

/**
 * Emite a(s) nota(s) de uma venda paga: servicos -> NFS-e, produtos -> NFC-e,
 * conforme o que o negocio emite. Valor de cada item vem do catalogo e e
 * ajustado pelo desconto da venda. Idempotente: venda que ja tem documento
 * daquele tipo e pulada.
 */
async function emitirNotasDaVenda({ clienteId, venda, config, emissor, tipos }) {
  const jaTem = await prisma.documentoFiscal.findMany({ where: { clienteId, vendaId: venda.id }, select: { tipo: true } });
  const feitos = new Set(jaTem.map((d) => d.tipo));
  const movs = await prisma.movimentacaoEstoque.findMany({
    where: { vendaId: venda.id, tipo: 'VENDA', variacao: { produto: { clienteId } } },
    include: { variacao: { include: { produto: { select: { id: true, nome: true, tipo: true } } } } },
  });
  const brutoTotal = movs.reduce((s, m) => s + Number(m.variacao.preco || 0) * Math.abs(m.quantidade), 0);
  const fator = brutoTotal > 0 ? Number(venda.valor) / brutoTotal : 1;

  const grupos = { NFSE: [], NFCE: [] };
  for (const m of movs) grupos[m.variacao.produto.tipo === 'SERVICO' ? 'NFSE' : 'NFCE'].push(m);
  if (!movs.length) grupos[tipos.includes('NFSE') ? 'NFSE' : 'NFCE'] = null; // venda sem itens: nota pelo valor

  const emitidos = [];
  for (const tipo of ['NFSE', 'NFCE']) {
    const itensMov = grupos[tipo];
    if (!tipos.includes(tipo) || feitos.has(tipo)) continue;
    if (Array.isArray(itensMov) && !itensMov.length) continue;
    const itens = (itensMov || []).map((m) => {
      const unit = Math.round(Number(m.variacao.preco || 0) * fator * 100) / 100;
      const qtd = Math.abs(m.quantidade);
      const ehPadrao = !m.variacao.nome || /^padr[aã]o$/i.test(m.variacao.nome);
      return {
        produtoId: m.variacao.produto.id,
        variacaoId: m.variacao.id,
        descricao: ehPadrao ? m.variacao.produto.nome : `${m.variacao.produto.nome} — ${m.variacao.nome}`,
        quantidade: qtd,
        valorUnitario: unit,
        valorTotal: Math.round(unit * qtd * 100) / 100,
      };
    });
    const valor = itens.length ? Math.round(itens.reduce((s, i) => s + i.valorTotal, 0) * 100) / 100 : Number(venda.valor);
    if (!(valor > 0)) continue;

    const doc = await prisma.documentoFiscal.create({
      data: {
        clienteId, vendaId: venda.id, tipo, status: 'PENDENTE', provedor: config.provedor,
        baseValor: itens.length ? 'VENDA' : null, valorTotal: valor,
        ...(itens.length ? { itens: { create: itens } } : {}),
      },
    });
    if (resolverModoFiscal(config) === 'live') {
      const falta = validarProntidaoProducao(config, tipo === 'NFCE' ? itens : []);
      if (falta.length) {
        await prisma.documentoFiscal.update({ where: { id: doc.id }, data: { status: 'ERRO', mensagemErro: `Falta: ${falta.join('; ')}`.slice(0, 500) } });
        emitidos.push({ tipo, status: 'ERRO' });
        continue;
      }
    }
    try {
      const params = { valor, descricao: venda.descricao || `Venda #${venda.numero}`, refExterna: doc.id };
      const dto = tipo === 'NFCE' ? await emissor.emitirNFCe(params) : await emissor.emitirNFSe(params);
      const r = await aplicarDocumento(doc, dto);
      emitidos.push({ tipo, status: r.status });
    } catch (e) {
      await prisma.documentoFiscal.update({ where: { id: doc.id }, data: { status: 'ERRO', mensagemErro: String(e.message || 'Falha na emissão').slice(0, 500) } });
      emitidos.push({ tipo, status: 'ERRO' });
    }
  }
  return emitidos;
}

/**
 * Rotina "emitir sozinho": vendas concluidas desde a ultima mudanca na
 * configuracao (no maximo 24 h pra tras), sem nota ainda.
 */
async function emitirVendasPendentes({ agora = new Date(), limitePorTenant = 30 } = {}) {
  const configs = await prisma.configuracaoFiscal.findMany({
    where: { emitirAutomatico: true, ativo: true, ambiente: 'PRODUCAO' },
    select: { clienteId: true, atualizadoEm: true },
  });
  let total = 0;
  for (const c of configs) {
    try {
      const desde = new Date(Math.max(agora.getTime() - 24 * 3600 * 1000, new Date(c.atualizadoEm).getTime()));
      const vendas = await prisma.venda.findMany({
        where: { clienteId: c.clienteId, status: 'COMPLETED', data: { gte: desde } },
        select: { id: true, numero: true, valor: true, descricao: true },
        orderBy: { data: 'asc' },
        take: limitePorTenant * 2,
      });
      if (!vendas.length) continue;
      const comNota = new Set((await prisma.documentoFiscal.findMany({
        where: { clienteId: c.clienteId, vendaId: { in: vendas.map((v) => v.id) } }, select: { vendaId: true },
      })).map((d) => d.vendaId));
      const pendentes = vendas.filter((v) => !comNota.has(v.id)).slice(0, limitePorTenant);
      if (!pendentes.length) continue;
      const { config, emissor } = await emissorDoTenant(c.clienteId);
      const cliente = await prisma.cliente.findUnique({ where: { id: c.clienteId }, select: { segmento: true } });
      const tipos = tiposPorSegmento(cliente?.segmento);
      let comErro = 0;
      for (const venda of pendentes) {
        const r = await emitirNotasDaVenda({ clienteId: c.clienteId, venda, config, emissor, tipos });
        total += r.length;
        comErro += r.filter((x) => x.status === 'ERRO').length;
      }
      if (comErro) {
        await criarNotificacaoTenant(prisma, {
          clienteId: c.clienteId, tipo: 'GENERICA',
          titulo: 'Nota fiscal com erro',
          mensagem: `${comErro} nota(s) automática(s) não saíram. Confira em Notas fiscais.`,
          link: '/app/fiscal',
        }).catch(() => {});
      }
    } catch (e) {
      console.error(`[fiscal/auto] ${c.clienteId}:`, e?.message);
    }
  }
  return total;
}

module.exports = { emissorDoTenant, credencialValida, emitirNotaDeTeste, emitirNotasDaVenda, emitirVendasPendentes };
