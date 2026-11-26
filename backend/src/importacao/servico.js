// =====================================================================
// IMPORTAR PLANILHA — parte que fala com o banco: confere contra o que ja
// existe, grava em lotes (cada lote numa transacao) e desfaz.
// Regras puras em ./normalizar.js.
// =====================================================================

const crypto = require('crypto');
const prisma = require('../prisma');
const { tentarTravarNegocio } = require('../utils/travaNegocio');
const {
  validarLinhas, juntarCamposVazios, chaveNome, finalTelefone, dddDe, normalizarTelefone,
} = require('./normalizar');

const TAMANHO_LOTE = 200;

const TIPO_PRODUTO = { PRODUTOS: 'FISICO', SERVICOS: 'SERVICO' };

/** DDD do negocio (telefone do Cliente ou do dono) pra sugerir em celular sem DDD. */
async function dddDoNegocio(clienteId) {
  const c = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { telefone: true } });
  let ddd = dddDe(c?.telefone);
  if (!ddd) {
    const dono = await prisma.usuario.findFirst({ where: { clienteId, perfil: 'CLIENT' }, select: { telefone: true } });
    ddd = dddDe(dono?.telefone);
  }
  return ddd;
}

// ---------------------------------------------------------------------
// Indices do que ja existe no banco
// ---------------------------------------------------------------------

async function indiceLeads(clienteId) {
  const leads = await prisma.lead.findMany({
    where: { clienteId },
    select: { id: true, nome: true, telefone: true, email: true, cpf: true, dataNascimento: true, observacoes: true },
  });
  const porTel = new Map();
  const porFinal = new Map();
  const porEmail = new Map();
  const porCpf = new Map();
  for (const l of leads) {
    const tel = normalizarTelefone(l.telefone);
    if (tel.valor) porTel.set(tel.valor, l);
    else {
      const f = finalTelefone(l.telefone);
      if (f) porFinal.set(f, l); // telefone antigo sem DDD
    }
    if (l.email) porEmail.set(l.email.trim().toLowerCase(), l);
    if (l.cpf) porCpf.set(String(l.cpf).replace(/\D/g, ''), l);
  }
  return (dados) => (dados.telefone && (porTel.get(dados.telefone) || porFinal.get(finalTelefone(dados.telefone))))
    || (dados.email && porEmail.get(dados.email))
    || (dados.cpf && porCpf.get(dados.cpf))
    || null;
}

async function indiceProdutos(clienteId, tipo) {
  const produtos = await prisma.produto.findMany({
    where: { clienteId, tipo: TIPO_PRODUTO[tipo] },
    select: {
      id: true, nome: true, descricao: true, categoriaId: true,
      variacoes: { select: { id: true, sku: true, preco: true, precoCusto: true, duracaoMin: true }, orderBy: { criadoEm: 'asc' } },
    },
  });
  const porSku = new Map();
  const porNome = new Map();
  for (const p of produtos) {
    porNome.set(chaveNome(p.nome), p);
    for (const v of p.variacoes) if (v.sku) porSku.set(v.sku.toLowerCase(), p);
  }
  return (dados) => (dados.sku && porSku.get(dados.sku.toLowerCase())) || porNome.get(chaveNome(dados.nome)) || null;
}

// SKU e unico no banco inteiro: codigo ja usado por OUTRO negocio entra sem codigo.
async function skusDeOutros(clienteId, skus) {
  if (!skus.length) return new Set();
  const usados = await prisma.variacaoProduto.findMany({
    where: { sku: { in: skus }, produto: { clienteId: { not: clienteId } } },
    select: { sku: true },
  });
  return new Set(usados.map((u) => u.sku));
}

/**
 * Analisa as linhas (ja mapeadas) e devolve o resultado de cada uma com o
 * status: NOVO | JUNTAR (ja existe no banco) | DUPLICADA (repete outra linha
 * do arquivo) | PROBLEMA | PULAR.
 */
async function analisar({ clienteId, tipo, linhas }) {
  const dddPadrao = await dddDoNegocio(clienteId);
  const validadas = validarLinhas(tipo, linhas, { dddPadrao });
  const acharExistente = tipo === 'CLIENTES' ? await indiceLeads(clienteId) : await indiceProdutos(clienteId, tipo);

  let skusBloqueados = new Set();
  if (tipo === 'PRODUTOS') {
    const skus = [...new Set(validadas.filter((r) => !r.problemas.length && r.dados.sku).map((r) => r.dados.sku))];
    skusBloqueados = await skusDeOutros(clienteId, skus);
  }

  const resultado = validadas.map((r) => {
    if (r.pular) return { ...r, status: 'PULAR' };
    if (r.problemas.length) return { ...r, status: 'PROBLEMA' };
    if (r.dados.sku && skusBloqueados.has(r.dados.sku)) {
      r.avisos.push({ campo: 'sku', mensagem: `O código ${r.dados.sku} já é usado em outro cadastro. Entra sem código.` });
      r.dados.sku = null;
    }
    if (r.duplicadaDe !== null) return { ...r, status: 'DUPLICADA' };
    const existente = acharExistente(r.dados);
    if (existente) return { ...r, status: 'JUNTAR', existente: { id: existente.id, nome: existente.nome }, _registro: existente };
    return { ...r, status: 'NOVO' };
  });

  const resumo = { total: resultado.length, novos: 0, juntar: 0, duplicadas: 0, problemas: 0, pular: 0 };
  for (const r of resultado) {
    if (r.status === 'NOVO') resumo.novos++;
    else if (r.status === 'JUNTAR') resumo.juntar++;
    else if (r.status === 'DUPLICADA') resumo.duplicadas++;
    else if (r.status === 'PROBLEMA') resumo.problemas++;
    else resumo.pular++;
  }
  return { linhas: resultado, resumo, dddPadrao };
}

/** Tira campos internos antes de mandar pro front. */
function paraResposta(analise) {
  return {
    resumo: analise.resumo,
    dddPadrao: analise.dddPadrao,
    linhas: analise.linhas.map(({ _registro, ...r }) => r),
  };
}

// ---------------------------------------------------------------------
// Gravacao
// ---------------------------------------------------------------------

function dataNasc(iso) {
  return iso ? new Date(`${iso}T12:00:00.000Z`) : null;
}

/** Junta as linhas DUPLICADAS na primeira ocorrencia (so campos vazios). */
function consolidarDuplicadas(linhas) {
  const porIndice = new Map(linhas.map((r) => [r.indice, r]));
  for (const r of linhas) {
    if (r.status !== 'DUPLICADA') continue;
    const alvo = porIndice.get(r.duplicadaDe);
    if (alvo) alvo.dados = juntarCamposVazios(alvo.dados, r.dados);
  }
}

async function gravarLoteClientes(tx, clienteId, lote, nomeArquivo) {
  const criados = [];
  const novos = lote.filter((r) => r.status === 'NOVO');
  if (novos.length) {
    const data = novos.map((r) => ({
      id: crypto.randomUUID(),
      clienteId,
      nome: r.dados.nome,
      telefone: r.dados.telefone || null,
      email: r.dados.email || null,
      cpf: r.dados.cpf || null,
      dataNascimento: dataNasc(r.dados.nascimento),
      observacoes: r.dados.observacoes || null,
      origem: 'IMPORTACAO',
      valor: 0,
    }));
    await tx.lead.createMany({ data });
    await tx.historicoLead.createMany({
      data: data.map((l) => ({ leadId: l.id, acao: 'CRIADO', paraEtapa: 'Inicio', observacoes: `Importado da planilha ${nomeArquivo}`.slice(0, 250) })),
    });
    criados.push(...data.map((l) => l.id));
  }
  let juntados = 0;
  for (const r of lote.filter((x) => x.status === 'JUNTAR')) {
    const atual = r._registro;
    const novo = {
      telefone: r.dados.telefone, email: r.dados.email, cpf: r.dados.cpf,
      dataNascimento: dataNasc(r.dados.nascimento), observacoes: r.dados.observacoes,
    };
    const data = {};
    for (const [k, v] of Object.entries(novo)) {
      if ((atual[k] === null || atual[k] === undefined || atual[k] === '') && v) data[k] = v;
    }
    if (Object.keys(data).length) {
      await tx.lead.updateMany({ where: { id: atual.id, clienteId }, data });
    }
    juntados++;
  }
  return { criados, juntados };
}

async function resolverCategorias(clienteId, tipo, linhas) {
  const uso = tipo === 'SERVICOS' ? 'SERVICO' : 'PRODUTO';
  const existentes = await prisma.categoriaFinanceira.findMany({
    where: { clienteId, tipo: 'RECEITA' },
    select: { id: true, nome: true, uso: true },
  });
  const mapa = new Map(existentes.map((c) => [chaveNome(c.nome), c.id]));
  const padraoExistente = existentes.find((c) => c.uso === uso);
  const nomesPedidos = new Map();
  for (const r of linhas) {
    if (r.dados.categoria && !mapa.has(chaveNome(r.dados.categoria))) nomesPedidos.set(chaveNome(r.dados.categoria), r.dados.categoria);
  }
  for (const [k, nome] of nomesPedidos) {
    const c = await prisma.categoriaFinanceira.create({ data: { clienteId, nome, tipo: 'RECEITA', uso }, select: { id: true } });
    mapa.set(k, c.id);
  }
  let padrao = padraoExistente?.id || null;
  const precisaPadrao = linhas.some((r) => !r.dados.categoria);
  if (!padrao && precisaPadrao) {
    const nome = tipo === 'SERVICOS' ? 'Serviços' : 'Produtos';
    padrao = mapa.get(chaveNome(nome)) || (await prisma.categoriaFinanceira.create({
      data: { clienteId, nome, tipo: 'RECEITA', uso }, select: { id: true },
    })).id;
  }
  return (nome) => (nome ? mapa.get(chaveNome(nome)) : padrao) || padrao;
}

async function gravarLoteProdutos(tx, clienteId, tipo, lote, categoriaDe, especialistasIds) {
  const criados = [];
  for (const r of lote.filter((x) => x.status === 'NOVO')) {
    const d = r.dados;
    const custo = tipo === 'PRODUTOS' && d.custo !== null && d.custo !== undefined ? d.custo : 0;
    const variacao = {
      nome: 'Padrão',
      sku: d.sku || null,
      preco: d.preco,
      precoCusto: custo,
      lucroTipo: 'VALOR',
      lucroValor: Math.round((d.preco - custo) * 100) / 100,
      estoqueAtual: tipo === 'PRODUTOS' ? d.estoque || 0 : 0,
      duracaoMin: tipo === 'SERVICOS' ? d.duracao || null : null,
    };
    const produto = await tx.produto.create({
      data: {
        clienteId,
        nome: d.nome,
        descricao: d.descricao || null,
        tipo: TIPO_PRODUTO[tipo],
        categoriaId: categoriaDe(d.categoria),
        variacoes: { create: [variacao] },
        ...(tipo === 'SERVICOS' && especialistasIds.length
          ? { especialistas: { create: especialistasIds.map((especialistaId) => ({ especialistaId })) } }
          : {}),
      },
      select: { id: true, variacoes: { select: { id: true } } },
    });
    if (tipo === 'PRODUTOS' && variacao.estoqueAtual > 0) {
      await tx.movimentacaoEstoque.create({
        data: {
          variacaoId: produto.variacoes[0].id, tipo: 'AJUSTE', quantidade: variacao.estoqueAtual,
          custoUnitario: custo || null, motivo: 'Estoque inicial (importação de planilha)',
        },
      });
    }
    criados.push(produto.id);
  }
  let juntados = 0;
  for (const r of lote.filter((x) => x.status === 'JUNTAR')) {
    const p = r._registro;
    const d = r.dados;
    const dataProduto = {};
    if (!p.descricao && d.descricao) dataProduto.descricao = d.descricao;
    if (!p.categoriaId && d.categoria) dataProduto.categoriaId = categoriaDe(d.categoria);
    if (Object.keys(dataProduto).length) await tx.produto.updateMany({ where: { id: p.id, clienteId }, data: dataProduto });
    const v = p.variacoes[0];
    if (v) {
      const dataVar = {};
      if (!v.sku && d.sku) dataVar.sku = d.sku;
      if (tipo === 'PRODUTOS' && !v.precoCusto && d.custo) {
        dataVar.precoCusto = d.custo;
        dataVar.lucroTipo = 'VALOR';
        dataVar.lucroValor = Math.round((v.preco - d.custo) * 100) / 100;
      }
      if (tipo === 'SERVICOS' && !v.duracaoMin && d.duracao) dataVar.duracaoMin = d.duracao;
      if (Object.keys(dataVar).length) await tx.variacaoProduto.update({ where: { id: v.id }, data: dataVar });
    }
    juntados++;
  }
  return { criados, juntados };
}

/**
 * Importa: reanalisa tudo no servidor, junta duplicadas, grava em lotes de
 * 200 (cada lote numa transacao) e registra a Importacao com os ids criados.
 * Se um lote falhar, o que ja entrou fica registrado (da pra desfazer).
 */
async function importar(args) {
  // Uma importacao por negocio de cada vez. A trava fica presa numa transacao
  // aberta durante toda a gravacao (os lotes usam outras conexoes); a segunda
  // planilha enviada ao mesmo tempo recebe 409 em vez de duplicar tudo. Como a
  // analise roda depois da trava, um reenvio da mesma planilha encontra os
  // clientes ja gravados e so junta.
  return prisma.$transaction(async (trava) => {
    if (!(await tentarTravarNegocio(trava, 'importacao', args.clienteId))) {
      throw Object.assign(new Error('Já tem uma importação em andamento neste negócio. Espere ela terminar e confira a lista antes de enviar de novo.'), { status: 409, codigo: 'IMPORTACAO_EM_ANDAMENTO' });
    }
    return importarSemTrava(args);
  }, { timeout: 15 * 60 * 1000, maxWait: 10000 });
}

async function importarSemTrava({ clienteId, usuarioId, tipo, arquivoNome, linhas }) {
  const analise = await analisar({ clienteId, tipo, linhas });
  consolidarDuplicadas(analise.linhas);
  const gravar = analise.linhas.filter((r) => r.status === 'NOVO' || r.status === 'JUNTAR');
  const duplicadas = analise.resumo.duplicadas;

  let categoriaDe = null;
  let especialistasIds = [];
  if (tipo !== 'CLIENTES') {
    categoriaDe = await resolverCategorias(clienteId, tipo, gravar);
    if (tipo === 'SERVICOS') {
      especialistasIds = (await prisma.especialista.findMany({ where: { clienteId, ativo: true }, select: { id: true } })).map((e) => e.id);
    }
  }

  const idsCriados = [];
  let juntados = 0;
  let falha = null;
  for (let i = 0; i < gravar.length; i += TAMANHO_LOTE) {
    const lote = gravar.slice(i, i + TAMANHO_LOTE);
    try {
      const r = await prisma.$transaction(
        (tx) => (tipo === 'CLIENTES'
          ? gravarLoteClientes(tx, clienteId, lote, arquivoNome)
          : gravarLoteProdutos(tx, clienteId, tipo, lote, categoriaDe, especialistasIds)),
        { timeout: 60000, maxWait: 10000 },
      );
      idsCriados.push(...r.criados);
      juntados += r.juntados;
    } catch (e) {
      console.error('[importacao] lote falhou', e?.message);
      falha = { linhaInicial: lote[0]?.numero, mensagem: 'Parte da planilha não entrou por um erro no servidor. O que já entrou pode ser desfeito.' };
      break;
    }
  }

  const importacao = await prisma.importacao.create({
    data: {
      clienteId,
      tipo,
      arquivoNome: String(arquivoNome || 'planilha').slice(0, 200),
      total: analise.resumo.total,
      criados: idsCriados.length,
      juntados: juntados + duplicadas,
      ignorados: analise.resumo.total - idsCriados.length - juntados - duplicadas,
      idsCriados,
      status: 'CONCLUIDA',
      criadoPorId: usuarioId || null,
    },
  });
  return { importacao: resumoImportacao(importacao), falha };
}

function resumoImportacao(i) {
  return {
    id: i.id, tipo: i.tipo, arquivoNome: i.arquivoNome, total: i.total, criados: i.criados,
    juntados: i.juntados, ignorados: i.ignorados, status: i.status, criadoEm: i.criadoEm,
  };
}

// ---------------------------------------------------------------------
// Desfazer
// ---------------------------------------------------------------------

/** Quais leads criados ainda podem ser apagados (sem venda, agenda etc.). */
async function leadsApagaveis(clienteId, ids) {
  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, clienteId },
    select: {
      id: true,
      _count: { select: { vendas: true, agendamentos: true, lancamentosFinanceiros: true, devolucoes: true, campanhaEnvios: true, mensagens: true } },
    },
  });
  const [pacotes, pedidos, espera] = await Promise.all([
    prisma.pacoteCliente.findMany({ where: { clienteId, leadId: { in: ids } }, select: { leadId: true } }),
    prisma.pedido.findMany({ where: { clienteId, leadId: { in: ids } }, select: { leadId: true } }),
    prisma.listaEspera.findMany({ where: { clienteId, leadId: { in: ids } }, select: { leadId: true } }),
  ]);
  const presos = new Set([...pacotes, ...pedidos, ...espera].map((x) => x.leadId));
  return leads.filter((l) => !presos.has(l.id) && Object.values(l._count).every((n) => n === 0)).map((l) => l.id);
}

async function produtosApagaveis(clienteId, ids) {
  const produtos = await prisma.produto.findMany({
    where: { id: { in: ids }, clienteId },
    select: {
      id: true,
      variacoes: {
        select: {
          id: true,
          _count: { select: { movimentacoes: { where: { NOT: { tipo: 'AJUSTE' } } }, vinculosLead: true, devolucoes: true } },
        },
      },
    },
  });
  const [pacotes, espera, ofertas, itensNota] = await Promise.all([
    prisma.pacoteModelo.findMany({ where: { clienteId, produtoId: { in: ids } }, select: { produtoId: true } }),
    prisma.listaEspera.findMany({ where: { clienteId, produtoId: { in: ids } }, select: { produtoId: true } }),
    prisma.ofertaEncaixe.findMany({ where: { clienteId, produtoId: { in: ids } }, select: { produtoId: true } }),
    prisma.documentoFiscalItem.findMany({ where: { produtoId: { in: ids } }, select: { produtoId: true } }),
  ]);
  const presos = new Set([...pacotes, ...espera, ...ofertas, ...itensNota].map((x) => x.produtoId));
  // Produto que ja apareceu em pedido do catalogo tambem fica.
  const pedidos = await prisma.pedido.findMany({ where: { clienteId }, select: { itens: true } });
  for (const p of pedidos) {
    for (const it of Array.isArray(p.itens) ? p.itens : []) if (it?.produtoId) presos.add(it.produtoId);
  }
  return produtos
    .filter((p) => !presos.has(p.id) && p.variacoes.every((v) => Object.values(v._count).every((n) => n === 0)))
    .map((p) => p.id);
}

/**
 * Apaga SO o que a importacao criou e ainda nao foi usado. O que ja tem
 * venda, agendamento, pedido etc. fica (e volta na contagem `mantidos`).
 */
async function desfazer({ clienteId, importacaoId }) {
  const imp = await prisma.importacao.findFirst({ where: { id: importacaoId, clienteId } });
  if (!imp) throw Object.assign(new Error('Importação não encontrada.'), { status: 404 });
  if (imp.status === 'DESFEITA') throw Object.assign(new Error('Esta importação já foi desfeita.'), { status: 409 });
  const ids = Array.isArray(imp.idsCriados) ? imp.idsCriados.filter((x) => typeof x === 'string') : [];

  return prisma.$transaction(async (tx) => {
    // Marca DESFEITA primeiro, com o status esperado no where: o segundo
    // "desfazer" ao mesmo tempo espera a linha, ve count 0 e recebe 409 — nada
    // e apagado nem contado duas vezes.
    const marcado = await tx.importacao.updateMany({
      where: { id: imp.id, clienteId, status: { not: 'DESFEITA' } },
      data: { status: 'DESFEITA' },
    });
    if (marcado.count !== 1) throw Object.assign(new Error('Esta importação já foi desfeita.'), { status: 409 });

    const apagaveis = imp.tipo === 'CLIENTES' ? await leadsApagaveis(clienteId, ids) : await produtosApagaveis(clienteId, ids);
    const apagar = new Set(apagaveis);
    const mantidos = ids.filter((id) => !apagar.has(id));
    let apagados = 0;
    for (let i = 0; i < apagaveis.length; i += 500) {
      const parte = apagaveis.slice(i, i + 500);
      const r = imp.tipo === 'CLIENTES'
        ? await tx.lead.deleteMany({ where: { id: { in: parte }, clienteId } })
        : await tx.produto.deleteMany({ where: { id: { in: parte }, clienteId } });
      apagados += r.count;
    }
    await tx.importacao.update({ where: { id: imp.id }, data: { idsCriados: mantidos } });
    return { apagados, mantidos: mantidos.length };
  }, { timeout: 60000, maxWait: 15000 });
}

module.exports = { analisar, paraResposta, importar, desfazer, resumoImportacao, TAMANHO_LOTE };
