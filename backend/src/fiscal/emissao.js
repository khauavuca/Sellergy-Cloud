// Emissao fiscal fora da tela de documentos: nota de teste do assistente,
// "emitir sozinho" das vendas pagas e a sincronizacao dos documentos que
// ficaram em PROCESSANDO (rotinas em ./tarefasFiscal.js).
// A emissao manual continua em routes/fiscal.routes.js (POST /documentos),
// usando os helpers daqui (criarDocumentoUnico, dadosNotaDaVenda...).

const prisma = require('../prisma');
const { carregarCredencialDecifrada } = require('../credenciais');
const { criarProvedor, TIPO_CREDENCIAL_POR_PROVEDOR } = require('../adapters/fiscal');
const { aplicarDocumento, CAMPOS_DOCUMENTO } = require('../services/documentoFiscal');
const { resolverModoFiscal, validarProntidaoProducao } = require('../utils/validacaoFiscal');
const { tiposPorSegmento } = require('./assistente');
const { criarNotificacaoTenant } = require('../utils/notificacoes');
const { garantirLimiteNotas } = require('./limiteNotas');

// Documento "vivo" (bloqueia outro da mesma venda/tipo — indice unico parcial
// documentos_fiscais_vendaId_tipo_ativo_key). ERRO e CANCELADA liberam nova emissao.
const STATUS_ATIVOS = ['PENDENTE', 'PROCESSANDO', 'EMITIDA'];

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

/** Violacao de unicidade do Prisma (P2002) — aqui, a trava venda+tipo. */
function ehViolacaoUnica(e) {
  return e?.code === 'P2002';
}

/**
 * Cria o DocumentoFiscal respeitando a trava "1 documento vivo por venda e
 * tipo". Se ja existe (corrida entre duas emissoes, clique duplo, rotina +
 * tela), devolve o existente em vez de criar outro.
 * @returns {Promise<{ doc: Object, existente: boolean }>}
 */
async function criarDocumentoUnico(data, db = prisma) {
  const buscarExistente = () => db.documentoFiscal.findFirst({
    where: { clienteId: data.clienteId, vendaId: data.vendaId, tipo: data.tipo, status: { in: STATUS_ATIVOS } },
    orderBy: { criadoEm: 'asc' },
  });
  if (data.vendaId) {
    const ja = await buscarExistente();
    if (ja) return { doc: ja, existente: true };
  }
  try {
    return { doc: await db.documentoFiscal.create({ data }), existente: false };
  } catch (e) {
    if (!ehViolacaoUnica(e) || !data.vendaId) throw e;
    const ja = await buscarExistente();
    if (!ja) throw e;
    return { doc: ja, existente: true };
  }
}

/**
 * Proximo numero da nota (Nuvem Fiscal exige nNF/nDPS no corpo; a Focus numera
 * sozinha). Incremento atomico no banco.
 */
async function reservarNumero(clienteId, db = prisma) {
  const r = await db.configuracaoFiscal.update({
    where: { clienteId },
    data: { proximoNumero: { increment: 1 } },
    select: { proximoNumero: true },
  });
  return Number(r.proximoNumero) - 1;
}

/** Mensagem que vai para a tela quando a chamada ao emissor falha (sem dado sensivel). */
function mensagemFalhaEmissor(e) {
  if (e?.mensagemEmissor) return `O emissor recusou: ${e.mensagemEmissor}`.slice(0, 500);
  if (e?.status === 422 || /^FISCAL_TOKEN/.test(String(e?.codigo || ''))) return String(e.message).slice(0, 500);
  if (e?.codigo === 'TIMEOUT') return 'O emissor demorou demais para responder. Tente sincronizar em alguns minutos.';
  if (e?.status === 502) return 'O emissor não respondeu ou recusou o acesso.';
  return String(e?.message || 'Falha na emissão.').slice(0, 500);
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
      // Numero de teste (so homologacao): nao gasta a numeracao de producao.
      const numero = (Math.floor(inicio / 1000) % 899999999) + 100000000;
      const params = { valor: 1, descricao: 'Nota de teste Sellergy (homologação, sem valor fiscal)', refExterna: ref, numero, formaPagamento: 'DINHEIRO' };
      let dto = tipo === 'NFCE' ? await emissor.emitirNFCe(params) : await emissor.emitirNFSe(params);
      if (dto.status === 'PROCESSANDO' && dto.provedorDocId) {
        dto = await emissor.consultarStatus(dto.provedorDocId, tipo);
      }
      resultados.push({
        tipo,
        status: dto.status,
        numero: dto.numero || null,
        mensagem: dto.status === 'ERRO' ? (dto.mensagemErro || 'O emissor recusou a nota.') : null,
        ms: Date.now() - inicio,
      });
    } catch (e) {
      resultados.push({ tipo, status: 'ERRO', numero: null, mensagem: mensagemFalhaEmissor(e), ms: Date.now() - inicio });
    }
  }
  return { simulado: !live, resultados, ok: resultados.every((r) => r.status === 'EMITIDA') };
}

/**
 * NCM/CFOP/CEST ja usados por produto em notas anteriores (o cadastro de
 * produto ainda nao tem esses campos). Mapa produtoId -> { ncm, cfop, cest }.
 */
async function codigosFiscaisConhecidos(clienteId, produtoIds, db = prisma) {
  const ids = [...new Set(produtoIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const linhas = await db.documentoFiscalItem.findMany({
    where: { produtoId: { in: ids }, documento: { clienteId }, OR: [{ ncm: { not: null } }, { cfop: { not: null } }] },
    select: { produtoId: true, ncm: true, cfop: true, cest: true },
    orderBy: { documento: { criadoEm: 'desc' } },
    take: 500,
  });
  const mapa = new Map();
  for (const l of linhas) {
    const atual = mapa.get(l.produtoId) || {};
    mapa.set(l.produtoId, {
      ncm: atual.ncm || l.ncm || null,
      cfop: atual.cfop || l.cfop || null,
      cest: atual.cest || l.cest || null,
    });
  }
  return mapa;
}

/** Destinatario a partir do cliente final da venda (Lead), quando houver. */
function destinatarioDoLead(lead) {
  if (!lead || (!lead.nome && !lead.cpf)) return null;
  return { nome: lead.nome || null, documento: lead.cpf || null, email: lead.email || null };
}

/**
 * Emite a(s) nota(s) de uma venda paga: servicos -> NFS-e, produtos -> NFC-e,
 * conforme o que o negocio emite. Valor de cada item vem do catalogo e e
 * ajustado pelo desconto da venda. Idempotente: venda que ja tem documento
 * daquele tipo e pulada (e a trava unica no banco segura a corrida).
 * Respeita o teto de notas do plano (limite notasMes): ao passar, para e
 * devolve { status: 'LIMITE' }.
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
  const codigos = await codigosFiscaisConhecidos(clienteId, movs.map((m) => m.variacao.produto.id));

  const grupos = { NFSE: [], NFCE: [] };
  for (const m of movs) grupos[m.variacao.produto.tipo === 'SERVICO' ? 'NFSE' : 'NFCE'].push(m);
  if (!movs.length) grupos[tipos.includes('NFSE') ? 'NFSE' : 'NFCE'] = null; // venda sem itens: nota pelo valor

  const destinatario = destinatarioDoLead(venda.lead);
  const live = resolverModoFiscal(config) === 'live';
  const emitidos = [];
  for (const tipo of ['NFSE', 'NFCE']) {
    const itensMov = grupos[tipo];
    if (!tipos.includes(tipo) || feitos.has(tipo)) continue;
    if (Array.isArray(itensMov) && !itensMov.length) continue;
    const itens = (itensMov || []).map((m) => {
      const unit = Math.round(Number(m.variacao.preco || 0) * fator * 100) / 100;
      const qtd = Math.abs(m.quantidade);
      const ehPadrao = !m.variacao.nome || /^padr[aã]o$/i.test(m.variacao.nome);
      const cod = codigos.get(m.variacao.produto.id) || {};
      return {
        produtoId: m.variacao.produto.id,
        variacaoId: m.variacao.id,
        descricao: ehPadrao ? m.variacao.produto.nome : `${m.variacao.produto.nome} — ${m.variacao.nome}`,
        quantidade: qtd,
        valorUnitario: unit,
        valorTotal: Math.round(unit * qtd * 100) / 100,
        ncm: cod.ncm || null,
        cfop: cod.cfop || null,
        cest: cod.cest || null,
      };
    });
    const valor = itens.length ? Math.round(itens.reduce((s, i) => s + i.valorTotal, 0) * 100) / 100 : Number(venda.valor);
    if (!(valor > 0)) continue;

    try {
      await garantirLimiteNotas({ clienteId });
    } catch (e) {
      if (e.codigo !== 'LIMITE_DO_PLANO') throw e;
      emitidos.push({ tipo, status: 'LIMITE', mensagem: e.message });
      break;
    }

    const { doc, existente } = await criarDocumentoUnico({
      clienteId, vendaId: venda.id, tipo, status: 'PENDENTE', provedor: config.provedor,
      baseValor: itens.length ? 'VENDA' : null, valorTotal: valor,
      ...(destinatario ? {
        destNome: destinatario.nome ? String(destinatario.nome).slice(0, 120) : null,
        destDocumento: destinatario.documento || null,
        destEmail: destinatario.email || null,
      } : {}),
      ...(itens.length ? { itens: { create: itens } } : {}),
    });
    if (existente) {
      emitidos.push({ tipo, status: doc.status, existente: true });
      continue;
    }
    if (live) {
      const falta = validarProntidaoProducao(config, tipo === 'NFCE' ? itens : [], { tipo });
      if (falta.length) {
        await prisma.documentoFiscal.update({ where: { id: doc.id }, data: { status: 'ERRO', mensagemErro: `Falta: ${falta.join('; ')}`.slice(0, 500) } });
        emitidos.push({ tipo, status: 'ERRO' });
        continue;
      }
    }
    try {
      const numero = live && config.provedor === 'NUVEM_FISCAL' ? await reservarNumero(clienteId) : null;
      const params = {
        valor, descricao: venda.descricao || `Venda #${venda.numero}`, refExterna: doc.id,
        itens, destinatario, formaPagamento: venda.metodoPagamento, numero,
      };
      const dto = tipo === 'NFCE' ? await emissor.emitirNFCe(params) : await emissor.emitirNFSe(params);
      const r = await aplicarDocumento(doc, dto);
      emitidos.push({ tipo, status: r.status });
    } catch (e) {
      await prisma.documentoFiscal.update({ where: { id: doc.id }, data: { status: 'ERRO', mensagemErro: mensagemFalhaEmissor(e) } });
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
        select: {
          id: true, numero: true, valor: true, descricao: true, metodoPagamento: true,
          lead: { select: { nome: true, cpf: true, email: true } },
        },
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
      let limite = null;
      for (const venda of pendentes) {
        const r = await emitirNotasDaVenda({ clienteId: c.clienteId, venda, config, emissor, tipos });
        total += r.filter((x) => x.status !== 'LIMITE' && !x.existente).length;
        comErro += r.filter((x) => x.status === 'ERRO').length;
        limite = r.find((x) => x.status === 'LIMITE') || null;
        if (limite) break;
      }
      if (comErro) {
        await criarNotificacaoTenant(prisma, {
          clienteId: c.clienteId, tipo: 'GENERICA',
          titulo: 'Nota fiscal com erro',
          mensagem: `${comErro} nota(s) automática(s) não saíram. Confira em Notas fiscais.`,
          link: '/app/fiscal',
        }).catch(() => {});
      }
      if (limite) {
        await criarNotificacaoTenant(prisma, {
          clienteId: c.clienteId, tipo: 'GENERICA',
          titulo: 'Limite de notas fiscais do mês',
          mensagem: limite.mensagem,
          link: '/app/plano',
        }).catch(() => {});
      }
    } catch (e) {
      console.error(`[fiscal/auto] ${c.clienteId}:`, e?.message);
    }
  }
  return total;
}

/**
 * Rotina de sincronizacao: documentos em PROCESSANDO (ou PENDENTE ja com id no
 * emissor) parados ha mais de `minutos` sao consultados no emissor. No maximo
 * `limite` por rodada, os mais antigos primeiro. Falha num documento so
 * "empurra" ele para o fim da fila (atualizadoEm), sem parar a rodada.
 */
async function sincronizarProcessando({
  agora = new Date(),
  minutos = Number(process.env.FISCAL_SYNC_MINUTOS) || 5,
  limite = Number(process.env.FISCAL_SYNC_LIMITE) || 50,
  db = prisma,
  obterEmissor = emissorDoTenant,
} = {}) {
  const corte = new Date(agora.getTime() - minutos * 60 * 1000);
  const docs = await db.documentoFiscal.findMany({
    where: {
      provedorDocId: { not: null },
      status: { in: ['PROCESSANDO', 'PENDENTE'] },
      atualizadoEm: { lt: corte },
    },
    orderBy: { atualizadoEm: 'asc' },
    take: limite,
  });
  const resumo = { consultados: 0, emitidos: 0, erros: 0, falhas: 0 };
  const emissores = new Map(); // clienteId -> emissor | Error
  for (const doc of docs) {
    try {
      if (!emissores.has(doc.clienteId)) {
        emissores.set(doc.clienteId, await obterEmissor(doc.clienteId).then((r) => r.emissor).catch((e) => e));
      }
      const emissor = emissores.get(doc.clienteId);
      if (emissor instanceof Error) throw emissor;
      const dto = await emissor.consultarStatus(doc.provedorDocId, doc.tipo);
      resumo.consultados += 1;
      if (dto.status === doc.status) {
        await db.documentoFiscal.update({ where: { id: doc.id }, data: { status: doc.status } }); // so mexe no atualizadoEm
        continue;
      }
      const r = await aplicarDocumento(doc, dto);
      if (r?.status === 'EMITIDA') resumo.emitidos += 1;
      if (r?.status === 'ERRO') resumo.erros += 1;
    } catch (e) {
      resumo.falhas += 1;
      console.error(`[fiscal/sync] documento ${doc.id}:`, mensagemFalhaEmissor(e));
      await db.documentoFiscal.update({ where: { id: doc.id }, data: { status: doc.status } }).catch(() => {});
    }
  }
  return resumo;
}

module.exports = {
  STATUS_ATIVOS,
  emissorDoTenant,
  credencialValida,
  criarDocumentoUnico,
  reservarNumero,
  mensagemFalhaEmissor,
  codigosFiscaisConhecidos,
  destinatarioDoLead,
  emitirNotaDeTeste,
  emitirNotasDaVenda,
  emitirVendasPendentes,
  sincronizarProcessando,
  CAMPOS_DOCUMENTO,
};
