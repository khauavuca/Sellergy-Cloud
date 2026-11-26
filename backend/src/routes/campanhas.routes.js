// Campanhas — v1: RECOMPRA POR CADENCIA (recompra leve).
//
// O plano define campanhas completas (disparo HSM em massa, templates Meta)
// como fase 2 do produto — depende de aprovacao de template pela Meta e da
// infra de envio. Aqui entregamos o nucleo nao-bloqueado e de valor imediato:
// a FILA DE RECOMPRA. Calcula quem comprou ha >= N dias e nao voltou, pra a
// equipe agir manualmente (abrir conversa no WhatsApp). Nada e disparado
// automaticamente nesta versao.
//
// Gating: modulo CRM (recompra e relacionamento/funil) + permissao CRM.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  requerModuloLiberado,
  requerPermissao,
} = require('../middlewares/permissoes.middleware');
const { formatarListaLeads, LIMITE_RECORRENTE, DIAS_MIN_LEAD_NOVO } = require('../services/segmentacaoLeads');
const {
  SEGMENTOS_VALIDOS, buscarConversoesPorLead, resumirPublico,
} = require('../services/campanhaPublico');
const { dispararCampanha, canalDoNegocio } = require('../services/campanhaDisparo');
const { BOTOES } = require('../services/campanhaTexto');
const { normalizarCodigo } = require('../services/cupomService');
const { lerDinheiro, lerInteiro } = require('../utils/numero');
const { exigirRecursoNaEscrita } = require('../planos/recursos');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerModuloLiberado('CRM'));
// Campanhas: plano Profissional para cima (a tela carrega e mostra o upgrade).
roteador.use(exigirRecursoNaEscrita('campanhas'));

const MS_DIA = 24 * 60 * 60 * 1000;
const DIAS_PADRAO = 30;
const DIAS_MIN = 1;
const DIAS_MAX = 365;

const MAX_NOME_CAMPANHA = 120;
const MAX_MENSAGEM_CAMPANHA = 1000;
const MAX_NOME_TEMPLATE = 120;
// Objetivo escolhido no 1o passo da tela (so registro; o publico e o texto
// e que valem pro envio).
const OBJETIVOS_VALIDOS = new Set(['voltar', 'aniversario', 'novidade', 'horario-vazio']);
const MAX_GASTO_MINIMO = 1000000;
// Agendamento: pelo menos 2 min no futuro e no maximo 60 dias.
const AGENDAR_MIN_MS = 2 * 60 * 1000;
const AGENDAR_MAX_MS = 60 * MS_DIA;

// ==========================================
// CUPOM — regra de quem cria e validacao dos dados.
// ==========================================
const MAX_CODIGO_CUPOM = 30;
const MAX_VALOR_CUPOM = 1000000;
const MAX_USO_CUPOM = 1000000;

/** Janela de recompra em dias (1..365, padrao 30). PURA. */
function lerDiasRecompra(valor) {
  const n = parseInt(valor, 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : DIAS_PADRAO, DIAS_MIN), DIAS_MAX);
}

/** "Gastou mais de R$ X": vazio/0 = sem filtro. PURA. */
function lerGastoMinimo(valor) {
  if (valor === undefined || valor === null || valor === '') return { ok: true, valor: null };
  const v = lerDinheiro(valor, { min: 0, max: MAX_GASTO_MINIMO });
  if (!v.ok) return { ok: false, erro: 'Gasto mínimo inválido.' };
  return { ok: true, valor: v.valor > 0 ? v.valor : null };
}

/** Data/hora do agendamento: ISO com hora, entre 2 min e 60 dias pra frente. PURA. */
function lerAgendadoPara(valor, agora = new Date()) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor.trim())) {
    return { ok: false, erro: 'Informe a data e a hora do envio.' };
  }
  const d = new Date(valor.trim());
  if (Number.isNaN(d.getTime())) return { ok: false, erro: 'Data do envio inválida.' };
  const diff = d.getTime() - agora.getTime();
  if (diff < AGENDAR_MIN_MS) return { ok: false, erro: 'Escolha um horário pelo menos 2 minutos à frente.' };
  if (diff > AGENDAR_MAX_MS) return { ok: false, erro: 'Dá pra agendar no máximo 60 dias à frente.' };
  return { ok: true, valor: d };
}

/** Dono da conta, ADMINISTRADOR e ADMIN do sistema criam cupom. PURA. */
function podeCriarCupom(usuario) {
  return ['ADMIN', 'CLIENT', 'ADMINISTRADOR'].includes(usuario?.perfil);
}

/** Data "AAAA-MM-DD[...]" valida de verdade (sem 31/02), ano 1900..2100. PURA. */
function lerDataEstrita(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  const m = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (ano < 1900 || ano > 2100 || mes < 1 || mes > 12 || dia < 1) return null;
  if (dia > new Date(Date.UTC(ano, mes, 0)).getUTCDate()) return null;
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Valida o cupom embutido na campanha. PURA.
 * @returns {{dados:{codigo,tipo,valor,validoAte,usoMaximo}}|{erro:string, campos:string[]}}
 */
function validarDadosCupom(cupom) {
  const codigo = typeof cupom.codigo === 'string' ? normalizarCodigo(cupom.codigo) : '';
  if (!codigo) return { erro: 'Informe o codigo do cupom.', campos: ['cupom.codigo'] };
  if (codigo.length > MAX_CODIGO_CUPOM || !/^[A-Z0-9_-]+$/.test(codigo)) {
    return { erro: `Código do cupom: use só letras, números, - ou _ (até ${MAX_CODIGO_CUPOM}).`, campos: ['cupom.codigo'] };
  }
  const tipo = cupom.tipo === 'VALOR' ? 'VALOR' : 'PERCENTUAL';
  const v = lerDinheiro(cupom.valor, { min: 0, max: MAX_VALOR_CUPOM });
  if (!v.ok || v.valor <= 0) return { erro: 'Valor do cupom deve ser maior que zero.', campos: ['cupom.valor'] };
  if (tipo === 'PERCENTUAL' && v.valor > 100) {
    return { erro: 'Desconto percentual nao pode passar de 100%.', campos: ['cupom.valor'] };
  }
  let validoAte = null;
  if (cupom.validoAte !== undefined && cupom.validoAte !== null && cupom.validoAte !== '') {
    validoAte = lerDataEstrita(cupom.validoAte);
    if (!validoAte) return { erro: 'Data de validade do cupom invalida.', campos: ['cupom.validoAte'] };
  }
  let usoMaximo = null;
  if (cupom.usoMaximo !== undefined && cupom.usoMaximo !== null && cupom.usoMaximo !== '') {
    const u = lerInteiro(cupom.usoMaximo, { min: 1, max: MAX_USO_CUPOM });
    if (!u.ok) return { erro: 'Limite de usos do cupom: número inteiro maior que zero (ou vazio para sem limite).', campos: ['cupom.usoMaximo'] };
    usoMaximo = u.valor;
  }
  return { dados: { codigo, tipo, valor: v.valor, validoAte, usoMaximo } };
}

// ==========================================
// CAMPANHA — criar, listar, disparar. O cupom (se houver) nasce junto da
// campanha (mais simples que uma tela separada de cupons por ora).
// ==========================================

// POST /campanhas — cria em RASCUNHO. totalAlvo e so um preview no momento da
// criacao; o disparo resolve o segmento de novo (dado fresco) antes de enviar.
roteador.post('/', requerPermissao('CRM', 'criar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!clienteId) return res.status(400).json({ erro: 'Apenas usuarios de um tenant criam campanhas.' });

    const { nome, segmento, diasRecompra, mensagem, nomeTemplate, cupom, objetivo, gastoMinimo, botao } = req.body || {};

    const nomeSan = typeof nome === 'string' ? nome.trim().slice(0, MAX_NOME_CAMPANHA) : '';
    if (!nomeSan) return res.status(422).json({ erro: 'Informe o nome da campanha.', campos: ['nome'] });

    if (!SEGMENTOS_VALIDOS.has(segmento)) {
      return res.status(422).json({ erro: `Segmento invalido. Valores: ${[...SEGMENTOS_VALIDOS].join(', ')}.`, campos: ['segmento'] });
    }

    const mensagemSan = typeof mensagem === 'string' ? mensagem.trim().slice(0, MAX_MENSAGEM_CAMPANHA) : '';
    if (!mensagemSan) return res.status(422).json({ erro: 'Informe a mensagem da campanha.', campos: ['mensagem'] });

    const nomeTemplateSan = typeof nomeTemplate === 'string' && nomeTemplate.trim()
      ? nomeTemplate.trim().slice(0, MAX_NOME_TEMPLATE)
      : null;

    const diasRecompraSan = segmento === 'recompra' ? lerDiasRecompra(diasRecompra) : null;

    const gasto = lerGastoMinimo(gastoMinimo);
    if (!gasto.ok) return res.status(422).json({ erro: gasto.erro, campos: ['gastoMinimo'] });

    const objetivoSan = OBJETIVOS_VALIDOS.has(objetivo) ? objetivo : null;
    const botaoSan = BOTOES.has(botao) ? botao : null;

    // Cupom opcional, embutido na criacao da campanha.
    let cupomId = null;
    if (cupom && typeof cupom === 'object') {
      // Cupom e desconto: so quem gerencia a conta (dono, ADMINISTRADOR,
      // ADMIN) cria. VENDEDOR com "CRM criar" faz campanha, mas sem cupom —
      // senao criava um cupom de 100% e usava na propria venda.
      if (!podeCriarCupom(req.usuario)) {
        return res.status(403).json({ erro: 'Só o dono da conta ou um administrador pode criar cupom de desconto. Crie a campanha sem cupom ou peça a eles.', codigo: 'SEM_PERMISSAO_CUPOM', campos: ['cupom'] });
      }
      const cupomValidado = validarDadosCupom(cupom);
      if (cupomValidado.erro) return res.status(422).json({ erro: cupomValidado.erro, campos: cupomValidado.campos });
      const { codigo, tipo, valor, validoAte: validoAteSan, usoMaximo: usoMaximoSan } = cupomValidado.dados;

      const existente = await prisma.cupom.findFirst({ where: { clienteId, codigo } });
      if (existente) return res.status(409).json({ erro: `Ja existe um cupom com o codigo ${codigo}.`, campos: ['cupom.codigo'] });

      const novoCupom = await prisma.cupom.create({
        data: { clienteId, codigo, tipo, valor, validoAte: validoAteSan, usoMaximo: usoMaximoSan },
      });
      cupomId = novoCupom.id;
    }

    const publico = await resumirPublico(clienteId, {
      segmento, diasRecompra: diasRecompraSan || DIAS_PADRAO, gastoMinimo: gasto.valor,
    });

    const campanha = await prisma.campanha.create({
      data: {
        clienteId,
        nome: nomeSan,
        segmento,
        diasRecompra: diasRecompraSan,
        mensagem: mensagemSan,
        nomeTemplate: nomeTemplateSan,
        cupomId,
        objetivo: objetivoSan,
        gastoMinimo: gasto.valor,
        botao: botaoSan,
        totalAlvo: publico.recebem.length,
        criadoPorId: req.usuario.id || null,
      },
      include: { cupom: true },
    });

    res.status(201).json(campanha);
  } catch (erro) {
    console.error('[campanhas/criar]', erro);
    res.status(500).json({ erro: 'Erro ao criar campanha.' });
  }
});

// GET /campanhas — lista as campanhas do tenant.
roteador.get('/', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!clienteId) return res.status(400).json({ erro: 'Apenas usuarios de um tenant acessam campanhas.' });
    const campanhas = await prisma.campanha.findMany({
      where: { clienteId },
      include: { cupom: true },
      orderBy: { criadoEm: 'desc' },
    });
    res.json(campanhas);
  } catch (erro) {
    console.error('[campanhas/listar]', erro);
    res.status(500).json({ erro: 'Erro ao listar campanhas.' });
  }
});

// GET /campanhas/recompra?dias=30
// Candidatos: leads cuja ULTIMA compra (venda COMPLETED) foi ha >= `dias` dias
// e que nao compraram de novo desde entao. Ordena do mais "vencido" ao mais
// recente. v1: lista pra acao manual; nao dispara mensagem.
roteador.get('/recompra', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!clienteId) {
      return res.status(400).json({ erro: 'Apenas usuarios de um tenant acessam a recompra.' });
    }

    const diasBruto = parseInt(req.query.dias, 10);
    const dias = Math.min(Math.max(Number.isFinite(diasBruto) ? diasBruto : DIAS_PADRAO, DIAS_MIN), DIAS_MAX);
    const corte = new Date(Date.now() - dias * MS_DIA);

    // Ultima compra por lead (so vendas concluidas, com lead vinculado).
    const grupos = await prisma.venda.groupBy({
      by: ['leadId'],
      where: { clienteId, status: 'COMPLETED', leadId: { not: null } },
      _max: { data: true },
      _count: { _all: true },
      _sum: { valor: true },
    });

    // Vencidos: ultima compra <= corte (nao voltaram dentro da janela).
    const vencidos = grupos.filter((g) => g._max.data && new Date(g._max.data) <= corte);
    const leadIds = vencidos.map((g) => g.leadId);
    if (leadIds.length === 0) {
      return res.json({ dias, corte, candidatos: [] });
    }

    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, clienteId },
      select: { id: true, nome: true, telefone: true, ultimoContato: true },
    });
    const mapaLead = new Map(leads.map((l) => [l.id, l]));

    const candidatos = vencidos
      .map((g) => {
        const lead = mapaLead.get(g.leadId);
        if (!lead) return null;
        const ultimaCompra = g._max.data;
        const diasDesde = Math.floor((Date.now() - new Date(ultimaCompra).getTime()) / MS_DIA);
        return {
          leadId: lead.id,
          nome: lead.nome,
          telefone: lead.telefone,
          ultimaCompra,
          diasDesde,
          totalCompras: g._count._all,
          valorTotal: g._sum.valor || 0,
          // Pra UI sinalizar quem ja foi contatado depois da ultima compra.
          ultimoContato: lead.ultimoContato,
          contatadoAposCompra: lead.ultimoContato ? new Date(lead.ultimoContato) > new Date(ultimaCompra) : false,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.diasDesde - a.diasDesde);

    res.json({ dias, corte, candidatos });
  } catch (erro) {
    console.error('[campanhas/recompra]', erro);
    res.status(500).json({ erro: 'Erro ao calcular a fila de recompra.' });
  }
});

// ==========================================
// SEGMENTACAO DE LEADS — pra fidelizar quem ja passou pela base (loja ou
// clinica/servico). "Conversao" conta tanto VENDA quanto ATENDIMENTO
// concluido, porque um tenant de servico nao tem venda de produto. Regras
// puras (merge/formatacao) vivem em services/segmentacaoLeads.js.
// ==========================================

// Busca os dados de contato dos leads e monta a resposta.
async function montarListaLeads(clienteId, entradas) {
  const leadIds = entradas.map((e) => e.leadId);
  if (leadIds.length === 0) return [];
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, clienteId },
    select: { id: true, nome: true, telefone: true },
  });
  return formatarListaLeads(entradas, leads);
}

// GET /campanhas/publico?segmento=&dias=&gastoMinimo= — previa da tela "Nova
// campanha": quantos recebem, quantos ficam de fora (SAIR / sem telefone) e
// por qual canal/numero sai.
roteador.get('/publico', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!clienteId) return res.status(400).json({ erro: 'Apenas usuarios de um tenant acessam campanhas.' });
    const segmento = String(req.query.segmento || '');
    if (!SEGMENTOS_VALIDOS.has(segmento)) return res.status(422).json({ erro: 'Segmento invalido.', campos: ['segmento'] });
    const gasto = lerGastoMinimo(req.query.gastoMinimo);
    if (!gasto.ok) return res.status(422).json({ erro: gasto.erro, campos: ['gastoMinimo'] });

    const [publico, bot, cliente] = await Promise.all([
      resumirPublico(clienteId, {
        segmento,
        diasRecompra: segmento === 'recompra' ? lerDiasRecompra(req.query.dias) : DIAS_PADRAO,
        gastoMinimo: gasto.valor,
      }),
      canalDoNegocio(clienteId),
      prisma.cliente.findUnique({ where: { id: clienteId }, select: { slugPublico: true } }),
    ]);
    const base = (process.env.APP_URL_PUBLICA || '').replace(/\/$/, '');
    const canal = !bot ? null : bot.provedorCanal === 'BAILEYS' ? 'QR_CODE' : 'OFICIAL';
    res.json({
      total: publico.total,
      recebem: publico.recebem.length,
      semPermissao: publico.semPermissao,
      semTelefone: publico.semTelefone,
      canal,
      numeroSaida: (canal === 'QR_CODE' ? bot.baileysNumeroConectado : bot?.telefone) || null,
      // Mesmo link que vai no [link de agendamento] / botao Marcar horario.
      linkAgendamento: cliente?.slugPublico && base ? `${base}/agendar/${cliente.slugPublico}` : null,
    });
  } catch (erro) {
    console.error('[campanhas/publico]', erro);
    res.status(500).json({ erro: 'Erro ao calcular o publico.' });
  }
});

// GET /campanhas/recorrentes — leads com 2+ compras/atendimentos concluidos.
// Ja fidelizados; uteis pra campanha de fidelidade/indicacao.
roteador.get('/recorrentes', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!clienteId) return res.status(400).json({ erro: 'Apenas usuarios de um tenant acessam campanhas.' });
    const mapa = await buscarConversoesPorLead(clienteId);
    const entradas = [...mapa.values()].filter((e) => (e.compras + e.atendimentos) >= LIMITE_RECORRENTE);
    const leads = await montarListaLeads(clienteId, entradas);
    res.json({ leads });
  } catch (erro) {
    console.error('[campanhas/recorrentes]', erro);
    res.status(500).json({ erro: 'Erro ao buscar leads recorrentes.' });
  }
});

// GET /campanhas/convertidos — todo lead com pelo menos 1 conversao (venda ou
// atendimento concluido). Superset de recorrentes + fila de recompra.
roteador.get('/convertidos', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!clienteId) return res.status(400).json({ erro: 'Apenas usuarios de um tenant acessam campanhas.' });
    const mapa = await buscarConversoesPorLead(clienteId);
    const leads = await montarListaLeads(clienteId, [...mapa.values()]);
    res.json({ leads });
  } catch (erro) {
    console.error('[campanhas/convertidos]', erro);
    res.status(500).json({ erro: 'Erro ao buscar leads convertidos.' });
  }
});

// GET /campanhas/nunca-converteram — leads sem nenhuma venda/atendimento
// concluido, cadastrados ha 7+ dias (lead novo ainda esta no funil normal,
// nao "perdeu a chance" ainda).
roteador.get('/nunca-converteram', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!clienteId) return res.status(400).json({ erro: 'Apenas usuarios de um tenant acessam campanhas.' });
    const mapa = await buscarConversoesPorLead(clienteId);
    const corte = new Date(Date.now() - DIAS_MIN_LEAD_NOVO * MS_DIA);
    const leads = await prisma.lead.findMany({
      where: { clienteId, criadoEm: { lte: corte }, id: { notIn: [...mapa.keys()] } },
      select: { id: true, nome: true, telefone: true, criadoEm: true },
      orderBy: { criadoEm: 'asc' },
    });
    res.json({
      leads: leads.map((l) => ({
        leadId: l.id,
        nome: l.nome,
        telefone: l.telefone,
        criadoEm: l.criadoEm,
        diasSemConverter: Math.floor((Date.now() - new Date(l.criadoEm).getTime()) / MS_DIA),
      })),
    });
  } catch (erro) {
    console.error('[campanhas/nunca-converteram]', erro);
    res.status(500).json({ erro: 'Erro ao buscar leads sem conversao.' });
  }
});

// POST /campanhas/:id/disparar — resolve o segmento de novo (dado fresco, nao
// o totalAlvo salvo na criacao), cria 1 CampanhaEnvio por lead (idempotente —
// upsert) e enfileira 1 job por envio. Exige nomeTemplate configurado: a Meta
// bloqueia mensagem livre em massa fora da janela de 24h.
// Registrada DEPOIS dos segmentos (path literal) de proposito — ':id' e
// generico e casaria com "recompra" etc se viesse antes.
roteador.post('/:id/disparar', requerPermissao('CRM', 'editar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!clienteId) return res.status(400).json({ erro: 'Apenas usuarios de um tenant disparam campanhas.' });
    const r = await dispararCampanha({ clienteId, campanhaId: String(req.params.id) });
    if (!r.ok) {
      const { status, ok: _ok, ...corpo } = r;
      return res.status(status || 422).json(corpo);
    }
    res.json(r);
  } catch (erro) {
    console.error('[campanhas/disparar]', erro);
    res.status(500).json({ erro: 'Erro ao disparar campanha.' });
  }
});

// POST /campanhas/:id/agendar { agendadoPara } — marca o envio pra depois. O
// cron (jobs/cronCampanhasAgendadas.js) dispara na hora, pelo mesmo caminho
// do "Enviar agora". Mesma permissao do disparo.
roteador.post('/:id/agendar', requerPermissao('CRM', 'editar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!clienteId) return res.status(400).json({ erro: 'Apenas usuarios de um tenant agendam campanhas.' });
    const quando = lerAgendadoPara(req.body?.agendadoPara);
    if (!quando.ok) return res.status(422).json({ erro: quando.erro, campos: ['agendadoPara'] });

    const campanha = await prisma.campanha.findFirst({ where: { id: String(req.params.id), clienteId } });
    if (!campanha) return res.status(404).json({ erro: 'Campanha nao encontrada.' });
    if (campanha.status !== 'RASCUNHO') return res.status(422).json({ erro: 'Essa campanha ja foi disparada.' });

    const bot = await canalDoNegocio(clienteId);
    if (bot?.provedorCanal !== 'BAILEYS' && !campanha.nomeTemplate) {
      return res.status(422).json({ erro: 'Configure o nome do modelo aprovado na Meta antes de agendar.', campos: ['nomeTemplate'] });
    }

    const r = await prisma.campanha.updateMany({
      where: { id: campanha.id, clienteId, status: 'RASCUNHO' },
      data: { agendadoPara: quando.valor },
    });
    if (r.count !== 1) return res.status(422).json({ erro: 'Essa campanha ja foi disparada.' });
    res.json({ ok: true, agendadoPara: quando.valor });
  } catch (erro) {
    console.error('[campanhas/agendar]', erro);
    res.status(500).json({ erro: 'Erro ao agendar campanha.' });
  }
});

// DELETE /campanhas/:id/agendamento — desfaz o agendamento (volta a rascunho).
roteador.delete('/:id/agendamento', requerPermissao('CRM', 'editar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!clienteId) return res.status(400).json({ erro: 'Apenas usuarios de um tenant agendam campanhas.' });
    const campanha = await prisma.campanha.findFirst({ where: { id: String(req.params.id), clienteId }, select: { id: true, status: true } });
    if (!campanha) return res.status(404).json({ erro: 'Campanha nao encontrada.' });
    if (campanha.status !== 'RASCUNHO') return res.status(422).json({ erro: 'Essa campanha ja foi disparada.' });
    await prisma.campanha.updateMany({ where: { id: campanha.id, clienteId, status: 'RASCUNHO' }, data: { agendadoPara: null } });
    res.json({ ok: true });
  } catch (erro) {
    console.error('[campanhas/desagendar]', erro);
    res.status(500).json({ erro: 'Erro ao cancelar o agendamento.' });
  }
});

// GET /campanhas/:id — detalhe + progresso do disparo.
roteador.get('/:id', requerPermissao('CRM', 'visualizar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    if (!clienteId) return res.status(400).json({ erro: 'Apenas usuarios de um tenant acessam campanhas.' });
    const campanha = await prisma.campanha.findFirst({
      where: { id: req.params.id, clienteId },
      include: { cupom: true },
    });
    if (!campanha) return res.status(404).json({ erro: 'Campanha nao encontrada.' });
    res.json(campanha);
  } catch (erro) {
    console.error('[campanhas/detalhe]', erro);
    res.status(500).json({ erro: 'Erro ao buscar campanha.' });
  }
});

// Regras puras expostas pra teste.
roteador.podeCriarCupom = podeCriarCupom;
roteador.validarDadosCupom = validarDadosCupom;
roteador.lerGastoMinimo = lerGastoMinimo;
roteador.lerAgendadoPara = lerAgendadoPara;
module.exports = roteador;
