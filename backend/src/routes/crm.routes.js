const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  ehAdmin,
  requerModuloLiberado,
  requerPermissao,
  requerPapelPrivilegiado,
} = require('../middlewares/permissoes.middleware');
const {
  substituirVinculosDoLead,
  adicionarVinculo,
  removerVinculo,
} = require('../leadProdutos');
const {
  ETAPAS_CATALOGO,
  buscarEtapaCatalogo,
} = require('../constants/etapasCatalogo');
const {
  lerLead, lerObservacao, mudouDeEtapa, lerListagem, diasDeAniversario,
} = require('../crm/lead');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerModuloLiberado('CRM'));

// Inclui produtos vinculados ao retornar lead (`variacoes` com produto/categoria
// pra o front montar UI sem N+1). Reutilizado em todas as rotas de leitura.
const INCLUDE_LEAD = {
  etapa: true,
  variacoes: {
    include: {
      variacao: {
        include: {
          produto: { include: { categoria: true } },
        },
      },
    },
  },
};

const SLUGS_FECHADOS = ['fechado-ganho', 'fechado-perdido'];
const DIAS_PARADO = 60;
const DIA_MS = 24 * 60 * 60 * 1000;
const COR_RE = /^#[0-9a-fA-F]{6}$/;

function tenantDoSolicitante(req, queryClienteId) {
  if (ehAdmin(req.usuario)) return typeof queryClienteId === 'string' && queryClienteId ? queryClienteId : null;
  return req.usuario.clienteId || null;
}

// Lead do negocio do solicitante. Id de outro negocio = 404 (nao revela que existe).
async function leadDoTenant(req, id, extra = {}) {
  if (typeof id !== 'string' || !id) return null;
  const where = ehAdmin(req.usuario) ? { id } : { id, clienteId: req.usuario.clienteId };
  return prisma.lead.findFirst({ where, ...extra });
}

// etapaId recebido no corpo: precisa ser do mesmo negocio do lead.
async function etapaDoTenant(etapaId, clienteId) {
  if (!etapaId) return null;
  return prisma.etapaLead.findFirst({ where: { id: etapaId, clienteId }, select: { id: true, nome: true, slug: true } });
}

// Aviso de cadastro repetido (mesmo CPF ou telefone no negocio). Nao bloqueia:
// a mesma pessoa pode voltar ao funil, mas a tela avisa.
async function avisosDeDuplicado(clienteId, dados, excetoId = null) {
  const avisos = [];
  if (dados.cpf) {
    const outro = await prisma.lead.findFirst({
      where: { clienteId, cpf: dados.cpf, ...(excetoId ? { id: { not: excetoId } } : {}) }, select: { id: true, nome: true },
    });
    if (outro) avisos.push({ campo: 'cpf', mensagem: `Já existe um cliente com este CPF: ${outro.nome}.`, leadId: outro.id });
  }
  const digitos = String(dados.telefone || '').replace(/\D/g, '');
  if (digitos.length >= 10) {
    const candidatos = await prisma.lead.findMany({
      where: { clienteId, telefone: { contains: digitos.slice(-4) }, ...(excetoId ? { id: { not: excetoId } } : {}) },
      select: { id: true, nome: true, telefone: true }, take: 50,
    });
    const semPais = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d; };
    const outro = candidatos.find((c) => semPais(c.telefone) === semPais(digitos));
    if (outro) avisos.push({ campo: 'telefone', mensagem: `Já existe um cliente com este telefone: ${outro.nome}.`, leadId: outro.id });
  }
  return avisos;
}

function erroDeEntrada(res, v) {
  return res.status(400).json({ error: v.erro, campos: v.campos });
}

// ==========================================
// LEAD STAGES (Fases do Kanban)
// ==========================================

roteador.get('/stages', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const clienteId = tenantDoSolicitante(req, req.query.clienteId);
    if (!clienteId) {
      return res.status(400).json({ error: 'clienteId eh obrigatorio' });
    }

    const stages = await prisma.etapaLead.findMany({
      where: { clienteId },
      orderBy: { ordem: 'asc' }
    });
    res.json(stages);
  } catch (error) {
    console.error('[crm/stages-list]', error);
    res.status(500).json({ error: 'Erro ao buscar fases do CRM' });
  }
});

// =====================================================================
// CATALOGO DE ETAPAS PRE-DEFINIDAS
// =====================================================================
// O usuario nao cria etapa com nome livre — escolhe do catalogo curado.
// Mantemos esses endpoints sob requerPapelPrivilegiado: VENDEDOR nao mexe
// na estrutura do funil, mesmo com permissao CRM/criar.

roteador.get('/stages/catalogo', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const clienteId = tenantDoSolicitante(req, req.query.clienteId);
    if (!clienteId) return res.status(400).json({ error: 'clienteId eh obrigatorio' });

    const existentes = await prisma.etapaLead.findMany({
      where: { clienteId, slug: { not: null } },
      select: { id: true, slug: true, nome: true },
    });
    const habilitadas = new Map(existentes.map((e) => [e.slug, e]));

    const catalogo = ETAPAS_CATALOGO.map((e) => ({
      ...e,
      // Nome que o negocio usa (ex.: "Em conversa" no lugar de "Em contato").
      nome: habilitadas.get(e.slug)?.nome || e.nome,
      habilitada: habilitadas.has(e.slug),
      etapaId: habilitadas.get(e.slug)?.id || null,
    }));
    res.json(catalogo);
  } catch (error) {
    console.error('[crm/stages-catalogo]', error);
    res.status(500).json({ error: 'Erro ao carregar catalogo de etapas' });
  }
});

// Habilita uma etapa do catalogo pro tenant. Idempotente (upsert).
roteador.post('/stages/catalogo/:slug', requerPapelPrivilegiado, async (req, res) => {
  try {
    const { slug } = req.params;
    const def = buscarEtapaCatalogo(slug);
    if (!def) return res.status(400).json({ error: 'Slug invalido. Use um do catalogo.' });

    const clienteId = tenantDoSolicitante(req, req.body?.clienteId);
    if (!clienteId) return res.status(400).json({ error: 'clienteId eh obrigatorio' });

    const stage = await prisma.etapaLead.upsert({
      where: { clienteId_slug: { clienteId, slug } },
      create: { clienteId, slug, nome: def.nome, ordem: def.ordem, cor: def.cor },
      update: {},
    });
    res.status(201).json(stage);
  } catch (error) {
    if (error?.code === 'P2002') return res.status(201).json({ ok: true });
    console.error('[crm/stages-catalogo-habilitar]', error);
    res.status(500).json({ error: 'Erro ao habilitar etapa' });
  }
});

// Apaga a etapa SO se nao tiver lead (numa instrucao so: dois cliques ou um
// lead entrando ao mesmo tempo nao deixam lead orfao). 409 com leads.
async function apagarEtapaSemLeads(res, etapa) {
  const r = await prisma.etapaLead.deleteMany({ where: { id: etapa.id, clienteId: etapa.clienteId, leads: { none: {} } } });
  if (r.count === 1) return res.json({ message: 'Etapa desabilitada' });
  const totalLeads = await prisma.lead.count({ where: { etapaId: etapa.id } });
  if (totalLeads > 0) {
    return res.status(409).json({
      error: `Esta etapa tem ${totalLeads} cliente(s). Mova eles para outra etapa antes de desligar.`,
      codigo: 'ETAPA_COM_LEADS',
      totalLeads,
    });
  }
  return res.status(404).json({ error: 'Etapa nao encontrada.' });
}

roteador.delete('/stages/catalogo/:slug', requerPapelPrivilegiado, async (req, res) => {
  try {
    const { slug } = req.params;
    const clienteId = tenantDoSolicitante(req, req.query?.clienteId);
    if (!clienteId) return res.status(400).json({ error: 'clienteId eh obrigatorio' });
    if (!buscarEtapaCatalogo(slug)) return res.status(400).json({ error: 'Slug invalido. Use um do catalogo.' });

    const stage = await prisma.etapaLead.findUnique({ where: { clienteId_slug: { clienteId, slug } }, select: { id: true, clienteId: true } });
    if (!stage) return res.status(404).json({ error: 'Etapa nao esta habilitada.' });
    return apagarEtapaSemLeads(res, stage);
  } catch (error) {
    console.error('[crm/stages-catalogo-desabilitar]', error);
    res.status(500).json({ error: 'Erro ao desabilitar etapa' });
  }
});

// =====================================================================
// ETAPAS LIVRES (LEGACY — nao expor mais no front)
// =====================================================================

function lerEtapaLivre(corpo = {}, { parcial = false } = {}) {
  const dados = {};
  if (!parcial || corpo.nome !== undefined) {
    if (typeof corpo.nome !== 'string' || !corpo.nome.trim() || corpo.nome.trim().length > 60) {
      return { erro: 'Nome da etapa: de 1 a 60 caracteres.', campos: ['nome'] };
    }
    dados.nome = corpo.nome.trim();
  }
  if (corpo.ordem !== undefined) {
    const o = Number(corpo.ordem);
    if (!Number.isInteger(o) || o < 0 || o > 1000) return { erro: 'Ordem inválida (0 a 1000).', campos: ['ordem'] };
    dados.ordem = o;
  } else if (!parcial) dados.ordem = 0;
  if (corpo.cor !== undefined && corpo.cor !== null && corpo.cor !== '') {
    if (typeof corpo.cor !== 'string' || !COR_RE.test(corpo.cor)) return { erro: 'Cor inválida (use #RRGGBB).', campos: ['cor'] };
    dados.cor = corpo.cor;
  } else if (corpo.cor === null || corpo.cor === '') dados.cor = null;
  return { dados };
}

roteador.post('/stages', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = tenantDoSolicitante(req, req.body?.clienteId);
    if (!clienteId) {
      return res.status(400).json({ error: 'clienteId eh obrigatorio para criar fase' });
    }
    const v = lerEtapaLivre(req.body || {});
    if (v.erro) return erroDeEntrada(res, v);

    const stage = await prisma.etapaLead.create({ data: { clienteId, ...v.dados } });
    res.status(201).json(stage);
  } catch (error) {
    console.error('[crm/stage-create]', error);
    res.status(500).json({ error: 'Erro ao criar fase no CRM' });
  }
});

roteador.put('/stages/:id', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = tenantDoSolicitante(req, req.body?.clienteId);
    const where = ehAdmin(req.usuario) && !clienteId ? { id: req.params.id } : { id: req.params.id, clienteId };
    const stageOriginal = await prisma.etapaLead.findFirst({ where });
    if (!stageOriginal) return res.status(404).json({ error: 'Fase nao encontrada.' });

    const v = lerEtapaLivre(req.body || {}, { parcial: true });
    if (v.erro) return erroDeEntrada(res, v);

    const stage = await prisma.etapaLead.update({ where: { id: stageOriginal.id }, data: v.dados });
    res.json(stage);
  } catch (error) {
    console.error('[crm/stage-update]', error);
    res.status(500).json({ error: 'Erro ao atualizar fase do CRM' });
  }
});

roteador.delete('/stages/:id', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = tenantDoSolicitante(req, req.query?.clienteId);
    const where = ehAdmin(req.usuario) && !clienteId ? { id: req.params.id } : { id: req.params.id, clienteId };
    const stageOriginal = await prisma.etapaLead.findFirst({ where, select: { id: true, clienteId: true } });
    if (!stageOriginal) return res.status(404).json({ error: 'Fase nao encontrada.' });
    return apagarEtapaSemLeads(res, stageOriginal);
  } catch (error) {
    console.error('[crm/stage-delete]', error);
    res.status(500).json({ error: 'Erro ao excluir fase' });
  }
});

// ==========================================
// LEADS
// ==========================================

// Filtro das abas (mesma regra da tela):
//   aberto = nao fechado (ganho/perdido) · ganho = etapa fechado-ganho
//   parado = em aberto, fora de pausa, sem contato/atualizacao ha 60+ dias
//   aniversario = faz aniversario de hoje ate daqui a 6 dias
async function filtroDaAba(aba, clienteId, etapas, agora) {
  const idsPorSlug = (slugs) => etapas.filter((e) => slugs.includes(e.slug)).map((e) => e.id);
  const naoEm = (ids) => (ids.length ? { OR: [{ etapaId: null }, { etapaId: { notIn: ids } }] } : {});
  if (aba === 'aberto') return naoEm(idsPorSlug(SLUGS_FECHADOS));
  if (aba === 'ganho') return { etapaId: { in: idsPorSlug(['fechado-ganho']) } };
  if (aba === 'parado') {
    const limite = new Date(agora.getTime() - DIAS_PARADO * DIA_MS);
    return {
      AND: [
        naoEm(idsPorSlug([...SLUGS_FECHADOS, 'em-pausa'])),
        { atualizadoEm: { lt: limite } },
        { OR: [{ ultimoContato: null }, { ultimoContato: { lt: limite } }] },
      ],
    };
  }
  if (aba === 'aniversario') {
    const dias = diasDeAniversario(agora);
    const linhas = await prisma.$queryRaw`
      SELECT "id" FROM "leads"
      WHERE "clienteId" = ${clienteId} AND "dataNascimento" IS NOT NULL
        AND to_char("dataNascimento", 'MM-DD') = ANY(${dias})`;
    return { id: { in: linhas.map((l) => l.id) } };
  }
  return {};
}

function filtroDeBusca(busca, etapaId) {
  const e = [];
  if (etapaId === '_sem_etapa') e.push({ etapaId: null });
  else if (etapaId) e.push({ etapaId });
  if (busca) {
    const digitos = busca.replace(/\D/g, '');
    e.push({
      OR: [
        { nome: { contains: busca, mode: 'insensitive' } },
        { email: { contains: busca, mode: 'insensitive' } },
        { tags: { contains: busca, mode: 'insensitive' } },
        { telefone: { contains: busca } },
        ...(digitos.length >= 3 ? [{ cpf: { contains: digitos } }] : []),
      ],
    });
  }
  return e;
}

// Lista paginada: GET /crm/leads?pagina=1&limite=25&aba=&busca=&etapaId=
// Devolve { itens, total, pagina, limite, contagens (por aba), numeros }.
// Sem `pagina` mantem a resposta antiga (array) pras outras telas.
roteador.get('/leads', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const clienteId = tenantDoSolicitante(req, req.query.clienteId);
    if (!clienteId) {
      return res.status(400).json({ error: 'clienteId eh obrigatorio' });
    }

    if (req.query.pagina === undefined) {
      const leads = await prisma.lead.findMany({
        where: { clienteId },
        include: INCLUDE_LEAD,
        orderBy: { atualizadoEm: 'desc' }
      });
      return res.json(leads);
    }

    const { pagina, limite, aba, busca, etapaId } = lerListagem(req.query);
    const agora = new Date();
    const etapas = await prisma.etapaLead.findMany({ where: { clienteId }, select: { id: true, slug: true } });
    const base = [{ clienteId }, ...filtroDeBusca(busca, etapaId)];

    const filtros = {};
    for (const a of ['todos', 'aberto', 'ganho', 'parado', 'aniversario']) filtros[a] = await filtroDaAba(a, clienteId, etapas, agora);

    const whereAba = { AND: [...base, filtros[aba]] };
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const [itens, total, contagensLista, valorAberto, novosMes, totalGeral] = await Promise.all([
      prisma.lead.findMany({
        where: whereAba, include: INCLUDE_LEAD, orderBy: [{ atualizadoEm: 'desc' }, { id: 'asc' }],
        skip: (pagina - 1) * limite, take: limite,
      }),
      prisma.lead.count({ where: whereAba }),
      Promise.all(Object.entries(filtros).map(async ([a, f]) => [a, await prisma.lead.count({ where: { AND: [...base, f] } })])),
      prisma.lead.aggregate({ where: { AND: [{ clienteId }, filtros.aberto] }, _sum: { valor: true } }),
      prisma.lead.count({ where: { clienteId, criadoEm: { gte: inicioMes } } }),
      prisma.lead.count({ where: { clienteId } }),
    ]);
    const contagens = Object.fromEntries(contagensLista);
    // Faixa de numeros do topo: sempre do negocio inteiro (sem busca).
    const [emAberto, ganhos, parados, aniversariantes] = await Promise.all(
      ['aberto', 'ganho', 'parado', 'aniversario'].map((a) => prisma.lead.count({ where: { AND: [{ clienteId }, filtros[a]] } })),
    );

    return res.json({
      itens, total, pagina, limite,
      totalPaginas: Math.max(1, Math.ceil(total / limite)),
      contagens,
      numeros: {
        total: totalGeral, emAberto, ganhos, parados, aniversariantes, novosMes,
        valorAberto: Math.round((valorAberto._sum.valor || 0) * 100) / 100,
      },
    });
  } catch (error) {
    console.error('[crm/leads-list]', error);
    res.status(500).json({ error: 'Erro ao buscar leads' });
  }
});

// Um lead (link direto ?lead=<id> vindo de Vendas, Financeiro etc.).
roteador.get('/leads/:id', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const lead = await leadDoTenant(req, req.params.id, { include: INCLUDE_LEAD });
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });
    res.json(lead);
  } catch (error) {
    console.error('[crm/leads-get]', error);
    res.status(500).json({ error: 'Erro ao buscar lead' });
  }
});

// Tudo que esta ligado a este cliente: conversa do WhatsApp, horarios,
// vendas, pedidos, pacotes e cobrancas. A ficha mostra num lugar so.
roteador.get('/leads/:id/vinculos', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const lead = await leadDoTenant(req, req.params.id, { select: { id: true, clienteId: true } });
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });
    const base = { clienteId: lead.clienteId, leadId: lead.id };
    const agora = new Date();
    const [conversa, proximos, passados, vendas, pedidos, pacotes, cobrancas, totalVendas] = await Promise.all([
      prisma.conversa.findFirst({ where: base, select: { id: true, canal: true, naoLidas: true, ultimaMensagemEm: true, ultimaMensagemTexto: true, ultimaMensagemOrigem: true } }),
      prisma.agendamento.findMany({ where: { ...base, data: { gte: agora } }, orderBy: { data: 'asc' }, take: 5, select: { id: true, data: true, servico: true, status: true, preco: true } }),
      prisma.agendamento.findMany({ where: { ...base, data: { lt: agora } }, orderBy: { data: 'desc' }, take: 5, select: { id: true, data: true, servico: true, status: true, preco: true } }),
      prisma.venda.findMany({ where: base, orderBy: { data: 'desc' }, take: 5, select: { id: true, numero: true, valor: true, status: true, data: true } }),
      prisma.pedido.findMany({ where: base, orderBy: { criadoEm: 'desc' }, take: 5, select: { id: true, numero: true, total: true, status: true, criadoEm: true } }),
      prisma.pacoteCliente.findMany({ where: base, orderBy: { criadoEm: 'desc' }, take: 5, select: { id: true, sessoesTotal: true, sessoesUsadas: true, status: true, validoAte: true, modeloId: true } }),
      prisma.cobranca.findMany({ where: base, orderBy: { criadoEm: 'desc' }, take: 5, select: { id: true, valor: true, status: true, metodo: true, origem: true, criadoEm: true } }),
      prisma.venda.aggregate({ where: { ...base, status: 'COMPLETED' }, _sum: { valor: true }, _count: { _all: true } }),
    ]);
    res.json({
      conversa, proximos, passados, vendas, pedidos, pacotes, cobrancas,
      totalGasto: totalVendas._sum.valor || 0, qtdVendas: totalVendas._count._all,
    });
  } catch (error) {
    console.error('[crm/leads-vinculos]', error);
    res.status(500).json({ error: 'Erro ao buscar o histórico do cliente' });
  }
});

roteador.post('/leads', requerPermissao('CRM', 'criar'), async (req, res) => {
  try {
    const corpo = req.body || {};
    const clienteId = tenantDoSolicitante(req, corpo.clienteId);
    if (!clienteId) {
      return res.status(400).json({ error: 'clienteId eh obrigatorio para criar lead' });
    }

    const v = lerLead(corpo);
    if (v.erro) return erroDeEntrada(res, v);
    const dados = v.dados;
    // Etapa precisa ser deste negocio; sem etapa e permitido (salao/clinica
    // usam Clientes sem funil).
    if (dados.etapaId) {
      if (!(await etapaDoTenant(dados.etapaId, clienteId))) return res.status(404).json({ error: 'Etapa nao encontrada.', campos: ['etapaId'] });
    }

    const lead = await prisma.$transaction(async (tx) => {
      const novo = await tx.lead.create({
        data: {
          clienteId,
          nome: dados.nome,
          telefone: dados.telefone ?? null,
          email: dados.email ?? null,
          cpf: dados.cpf ?? null,
          dataNascimento: dados.dataNascimento ?? null,
          etapaId: dados.etapaId ?? null,
          tags: dados.tags ?? null,
          prioridade: dados.prioridade || 'MEDIUM',
          origem: dados.origem ?? 'MANUAL',
          observacoes: dados.observacoes ?? null,
          valor: 0,
        },
      });
      if (Array.isArray(corpo.variacoes) && corpo.variacoes.length > 0) {
        await substituirVinculosDoLead({ leadId: novo.id, clienteId, vinculos: corpo.variacoes, tx });
      }
      await tx.historicoLead.create({
        data: { leadId: novo.id, acao: 'CRIADO', paraEtapa: null, observacoes: `Cliente "${dados.nome}" cadastrado`.slice(0, 250) },
      });
      return tx.lead.findUnique({ where: { id: novo.id }, include: INCLUDE_LEAD });
    });

    const avisos = await avisosDeDuplicado(clienteId, dados, lead.id).catch(() => []);
    res.status(201).json({ ...lead, avisos });
  } catch (error) {
    console.error('[crm/leads-create]', error);
    res.status(500).json({ error: 'Erro ao criar lead' });
  }
});

roteador.put('/leads/:id', requerPermissao('CRM', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;
    const corpo = req.body || {};

    const anterior = await leadDoTenant(req, id, { include: { etapa: true } });
    if (!anterior) return res.status(404).json({ error: 'Lead nao encontrado' });

    const v = lerLead(corpo, { parcial: true });
    if (v.erro) return erroDeEntrada(res, v);
    const dados = v.dados;

    // Lead fechado (ganho ou perdido) e etapa final — nao move manualmente.
    // Reabertura so acontece automaticamente (services/etapaLeadAuto.js).
    if (SLUGS_FECHADOS.includes(anterior.etapa?.slug) && mudouDeEtapa(anterior.etapaId, dados.etapaId)) {
      return res.status(409).json({ error: 'Lead fechado nao pode ser movido manualmente.' });
    }
    let novaEtapa = null;
    if (dados.etapaId) {
      novaEtapa = await etapaDoTenant(dados.etapaId, anterior.clienteId);
      if (!novaEtapa) return res.status(404).json({ error: 'Etapa nao encontrada.', campos: ['etapaId'] });
    }

    const lead = await prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: anterior.id }, data: dados });
      if (Array.isArray(corpo.variacoes)) {
        await substituirVinculosDoLead({ leadId: anterior.id, clienteId: anterior.clienteId, vinculos: corpo.variacoes, tx });
      }
      // Historico so quando a etapa muda de verdade (antes gravava "X -> X"
      // a cada edicao).
      if (mudouDeEtapa(anterior.etapaId, dados.etapaId)) {
        await tx.historicoLead.create({
          data: {
            leadId: anterior.id,
            acao: 'MOVIDO',
            deEtapa: anterior.etapa?.nome || 'Sem etapa',
            paraEtapa: novaEtapa?.nome || 'Sem etapa',
            observacoes: `Movido para ${novaEtapa?.nome || 'sem etapa'}`,
          },
        });
      }
      return tx.lead.findUnique({ where: { id: anterior.id }, include: INCLUDE_LEAD });
    });

    const avisos = (dados.cpf || dados.telefone) ? await avisosDeDuplicado(anterior.clienteId, dados, anterior.id).catch(() => []) : [];
    res.json({ ...lead, avisos });
  } catch (error) {
    console.error('[crm/leads-update]', error);
    res.status(500).json({ error: 'Erro ao atualizar lead' });
  }
});

// ==========================================
// PRODUTOS VINCULADOS AO LEAD
// ==========================================

roteador.post('/leads/:leadId/variacoes', requerPermissao('CRM', 'editar'), async (req, res) => {
  try {
    const { leadId } = req.params;
    const { variacaoId, quantidade, observacao } = req.body || {};
    const lead = await leadDoTenant(req, leadId);
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado.' });
    if (typeof variacaoId !== 'string' || !variacaoId) return res.status(400).json({ error: 'Escolha o produto ou serviço.' });
    const out = await adicionarVinculo({
      leadId,
      clienteId: lead.clienteId,
      variacaoId,
      quantidade,
      observacao: typeof observacao === 'string' ? observacao.slice(0, 500) : null,
    });
    res.json(out);
  } catch (error) {
    console.error('[crm/leads-add-variacao]', error);
    res.status(400).json({ error: 'Não foi possível vincular o produto.' });
  }
});

roteador.delete('/leads/:leadId/variacoes/:variacaoId', requerPermissao('CRM', 'editar'), async (req, res) => {
  try {
    const { leadId, variacaoId } = req.params;
    const lead = await leadDoTenant(req, leadId);
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado.' });
    const out = await removerVinculo({ leadId, variacaoId });
    res.json(out);
  } catch (error) {
    console.error('[crm/leads-remove-variacao]', error);
    res.status(500).json({ error: 'Erro ao desvincular produto.' });
  }
});

roteador.patch('/leads/:leadId/variacoes/:variacaoId', requerPermissao('CRM', 'editar'), async (req, res) => {
  try {
    const { leadId, variacaoId } = req.params;
    const { quantidade, observacao } = req.body || {};
    const lead = await leadDoTenant(req, leadId);
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado.' });

    const dadosUpdate = {};
    if (quantidade !== undefined) {
      const q = Number(quantidade);
      if (!Number.isInteger(q) || q < 1 || q > 100000) return res.status(400).json({ error: 'Quantidade inválida (inteiro de 1 a 100.000).' });
      dadosUpdate.quantidade = q;
    }
    if (observacao !== undefined) {
      if (observacao !== null && typeof observacao !== 'string') return res.status(400).json({ error: 'Observação inválida.' });
      dadosUpdate.observacao = observacao ? observacao.slice(0, 500) : null;
    }
    if (Object.keys(dadosUpdate).length === 0) {
      return res.status(400).json({ error: 'Nada pra atualizar.' });
    }

    const r = await prisma.leadVariacao.updateMany({ where: { leadId, variacaoId }, data: dadosUpdate });
    if (r.count === 0) return res.status(404).json({ error: 'Este item não está no cliente.' });

    const { calcularValorAgregado } = require('../leadProdutos');
    const vinculos = await prisma.leadVariacao.findMany({
      where: { leadId },
      include: { variacao: true },
    });
    const { valorTotal } = calcularValorAgregado(vinculos);
    await prisma.lead.update({ where: { id: leadId }, data: { valor: valorTotal } });
    res.json({ vinculos, valorTotal });
  } catch (error) {
    console.error('[crm/leads-patch-variacao]', error);
    res.status(500).json({ error: 'Erro ao atualizar vinculo.' });
  }
});

roteador.delete('/leads/:id', requerPermissao('CRM', 'excluir'), async (req, res) => {
  try {
    const lead = await leadDoTenant(req, req.params.id, { select: { id: true, clienteId: true } });
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });

    // deleteMany com o negocio no where: clique duplo nao vira 500.
    const r = await prisma.lead.deleteMany({ where: { id: lead.id, clienteId: lead.clienteId } });
    if (r.count === 0) return res.status(404).json({ error: 'Lead nao encontrado' });
    res.json({ message: 'Lead excluido com sucesso' });
  } catch (error) {
    // P2003 = FK bloqueando (venda, devolucao, agendamento ou lancamento
    // financeiro vinculados) — nunca perde rastro fiscal/financeiro.
    if (error?.code === 'P2003') {
      return res.status(409).json({
        error: 'Este cliente tem vendas, devoluções, agendamentos ou lançamentos financeiros vinculados e não pode ser excluído. Considere movê-lo para uma etapa de encerramento em vez de excluir.',
      });
    }
    console.error('[crm/leads-delete]', error);
    res.status(500).json({ error: 'Erro ao excluir lead' });
  }
});

// ==========================================
// HISTORICO DO LEAD
// ==========================================

roteador.get('/leads/:leadId/history', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const lead = await leadDoTenant(req, req.params.leadId, { select: { id: true } });
    if (!lead) return res.json([]);

    const history = await prisma.historicoLead.findMany({
      where: { leadId: lead.id },
      orderBy: { criadoEm: 'desc' },
      take: 200,
    });
    res.json(history);
  } catch (error) {
    console.error('[crm/leads-history]', error);
    res.json([]);
  }
});

roteador.post('/leads/:leadId/history', requerPermissao('CRM', 'editar'), async (req, res) => {
  try {
    const v = lerObservacao(req.body?.observacoes);
    if (v.erro) return res.status(400).json({ error: v.erro, campos: ['observacoes'] });

    const lead = await leadDoTenant(req, req.params.leadId, { select: { id: true } });
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });

    const entry = await prisma.historicoLead.create({
      data: { leadId: lead.id, acao: 'OBSERVACAO', observacoes: v.valor }
    });
    res.status(201).json(entry);
  } catch (error) {
    console.error('[crm/leads-history-create]', error);
    res.status(500).json({ error: 'Erro ao adicionar observacao' });
  }
});

module.exports = roteador;
