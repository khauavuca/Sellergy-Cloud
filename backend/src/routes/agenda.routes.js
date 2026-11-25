const express = require('express');
const { obterOuAbrirSessaoCaixa } = require('../services/caixaAutomatico');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  ehAdmin,
  requerModuloLiberado,
  requerPermissao,
  requerPapelPrivilegiado,
} = require('../middlewares/permissoes.middleware');
const { especialistaDoEscopo, escopoAgendaWhere } = require('../agenda/escopoAgenda');
const { lerCamposAgendamento } = require('../agenda/validacaoAgendamento');
const { desfazerConclusao } = require('../agenda/vendaAtendimento');
const { partesBRT, horaTexto, mesmoTelefone, avisosDoHorario } = require('../agenda/utilAgenda');
const { lockClienteAdvisory } = require('../utils/locks');
const { temRecurso, CAMPOS_ASSINATURA } = require('../planos/recursos');
const { aoLiberarHorario } = require('../agenda/eventosAgenda');
const sinal = require('../agenda/sinal');
const pacotes = require('../agenda/pacotes');
const { provedorAtivo, leadPorTelefone } = require('../services/pagamentoService');
const { cpfCnpjValido } = require('../services/pagadorCobranca');
const { gerarComissaoAtendimento } = require('../agenda/comissoes');
const { lerDinheiro } = require('../utils/numero');
const { proximoNumero: proximoNumeroVenda } = require('../services/vendaService');

// Mesmo limite usado no VendaController/tool — cobre colisao da unique
// [clienteId, numero] quando 2+ vendas chegam no mesmo ms.
const MAX_RETRIES_NUMERO = 5;

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerModuloLiberado('AGENDA'));

function tenantFiltro(req) {
  if (ehAdmin(req.usuario)) return {};
  return { clienteId: req.usuario.clienteId };
}

// Escopo da AGENDA (agenda/escopoAgenda.js): ADMIN/CLIENT/ADMINISTRADOR veem
// todos os agendamentos do tenant; um usuario com escopo PROPRIAS (ex.:
// especialista que tem login) ve e mexe SO nos do especialista dele. Fora do
// escopo = 404 (nao revela que existe).
async function agendamentoDoTenant(id, req) {
  if (typeof id !== 'string' || !id) return null;
  const filtro = ehAdmin(req.usuario) ? { id } : { id, clienteId: req.usuario.clienteId };
  return prisma.agendamento.findFirst({
    where: { ...filtro, ...(await escopoAgendaWhere(req)) },
    select: { id: true, clienteId: true, data: true, status: true },
  });
}

const erroHttp = (status, erro, extra = {}) => Object.assign(new Error(erro), { status, extra });

function responderErroHttp(res, e) {
  if (!e?.status) return false;
  res.status(e.status).json({ erro: e.message, ...(e.extra || {}) });
  return true;
}

// Avisos (passado / fora do expediente) pedem confirmacao: a tela mostra e
// reenvia com confirmarAvisos=true. Devolve os avisos que ainda faltam confirmar.
async function avisosPendentes({ clienteId, especialistaId, inicio, duracao, confirmado }) {
  if (confirmado === true) return [];
  const [cliente, esp] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { horarioFuncionamento: true } }),
    especialistaId ? prisma.especialista.findFirst({ where: { id: especialistaId, clienteId }, select: { jornada: true } }) : null,
  ]);
  return avisosDoHorario({ inicio, duracao, jornada: esp?.jornada || null, horarioFuncionamento: cliente?.horarioFuncionamento || null });
}

const METODOS_PAGAMENTO = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA'];

// =====================================================================
// REGRA DE IMUTABILIDADE
// =====================================================================
// Agendamento e considerado imutavel quando:
//   1. A data ja passou (data < hoje 00:00 BRT) E
//   2. O status nao e PENDING (ou seja, alguem ja atualizou pra
//      CONFIRMED, COMPLETED ou CANCELED)
//
// Justificativa: PENDING sao agendas "esquecidas" — permitimos atualizar
// status retroativamente (ex: marcar como concluido depois). Mas uma vez
// atualizado, vira historico imutavel pra evitar adulteracao de dados
// passados (relatorios, financeiro).
//
// IMPORTANTE — TZ: como o sistema e Brasil-only, hardcode TZ BRT (UTC-3,
// sem DST desde 2019). Sem isso, servidor rodando em UTC marcava um item
// de 22:00 BRT (= ja "ontem" pro usuario) como ainda "hoje".

// Retorna o Date que representa 00:00 BRT do dia atual (em UTC).
function inicioDoDiaBRT() {
  // pt-BR formatado em America/Sao_Paulo da YYYY-MM-DD do dia atual no BRT
  const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  // 00:00 BRT = 03:00 UTC (offset fixo -03:00).
  return new Date(`${hojeStr}T03:00:00.000Z`);
}

function ehImutavel(ag) {
  if (!ag) return false;
  if (ag.status === 'PENDING') return false;
  return new Date(ag.data) < inicioDoDiaBRT();
}

function bloqueioImutavel(res) {
  return res.status(423).json({
    erro: 'Agendamento bloqueado: itens passados com status atualizado ficam imutaveis pra preservar o historico.',
    codigo: 'IMUTAVEL',
  });
}

// =====================================================================
// LOG DE AUDITORIA
// =====================================================================
// Registra cada mudanca em agendamento. Best-effort: se falhar nao quebra
// a operacao principal. usuarioId/Nome sao snapshot (preservam mesmo se
// usuario for deletado depois).
//
// alteracoes (so pra EDITADO/STATUS_MUDADO): { campo: { de, para } }
async function logHistorico({ agendamentoId, acao, alteracoes = null, req, origem = null }) {
  try {
    await prisma.historicoAgendamento.create({
      data: {
        agendamentoId,
        acao,
        alteracoes,
        usuarioId: req?.usuario?.id || null,
        usuarioNome: req?.usuario?.nome || null,
        origem,
      },
    });
  } catch (e) {
    console.error('[agenda/historico] falha ao logar', e?.message);
  }
}

// Calcula o diff entre o estado antes e o body recebido. Retorna so os
// campos que mudaram. Ignora campos undefined no body (nao foram enviados).
function calcularAlteracoes(antes, depois, campos) {
  const diff = {};
  for (const campo of campos) {
    if (depois[campo] === undefined) continue;
    const valorAntes = antes[campo];
    const valorDepois = depois[campo];
    // Normaliza Date pra string ISO pra comparacao limpa.
    const a = valorAntes instanceof Date ? valorAntes.toISOString() : valorAntes;
    const b = valorDepois instanceof Date ? valorDepois.toISOString() : valorDepois;
    if (a !== b) diff[campo] = { de: valorAntes, para: valorDepois };
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

// =====================================================================
// VALIDACOES DE NEGOCIO DA AGENDA
// =====================================================================
// Verifica 2 regras antes de criar/editar um agendamento:
//   1. Conflito de horario — sobreposicao de intervalos [data, data+duracao]
//      entre o novo e os existentes do mesmo tenant (ignora CANCELED).
//   2. Cliente duplicado no mesmo dia — mesmo telefone (so digitos) ja agendado
//      no dia (ignora CANCELED).
//
// Retorna { erro: string, conflito: agendamento } ou null se OK.
// Aceita `excluirId` pra edicao (nao bate contra o proprio).
async function validarConflitosAgenda({ clienteId, dataNova, duracaoNova, telefone, excluirId = null, especialistaId = null, client = prisma }) {
  // Normaliza telefone — só digitos
  const telefoneNorm = (telefone || '').replace(/\D/g, '');

  // Dia do novo agendamento no horario de Brasilia (cliente duplicado no dia).
  const ymd = partesBRT(dataNova).ymd;
  const inicioDia = new Date(`${ymd}T00:00:00.000-03:00`);
  const fimDia = new Date(`${ymd}T23:59:59.999-03:00`);
  const fimNovo = new Date(dataNova.getTime() + (duracaoNova || 30) * 60000);

  // Janela de busca: o dia inteiro E tudo que pode encostar no intervalo novo,
  // inclusive o que comecou no dia anterior e atravessa a meia-noite
  // (duracao maxima 12 h, buscamos 24 h pra tras).
  const desde = new Date(Math.min(inicioDia.getTime(), dataNova.getTime() - 24 * 3600000));
  const ate = new Date(Math.max(fimDia.getTime(), fimNovo.getTime()));

  const existentes = await client.agendamento.findMany({
    where: {
      clienteId,
      data: { gte: desde, lte: ate },
      status: { not: 'CANCELED' },
      ...(excluirId ? { NOT: { id: excluirId } } : {}),
    },
    select: {
      id: true, nomeCliente: true, telefoneCliente: true,
      data: true, duracao: true, servico: true, status: true, especialistaId: true,
    },
  });

  // 1. Conflito de horario — so conta quando e o MESMO recurso (mesmo
  // especialista, ou ambos sem especialista = recurso unico da loja).
  // Especialistas diferentes podem atender no mesmo horario.
  const espNovo = especialistaId || null;
  for (const e of existentes) {
    if ((e.especialistaId || null) !== espNovo) continue;
    const inicio = new Date(e.data);
    const fim = new Date(inicio.getTime() + (e.duracao || 30) * 60000);
    if (dataNova < fim && fimNovo > inicio) {
      const hh = horaTexto(inicio);
      return {
        erro: `Conflito de horário: já existe agendamento de ${e.nomeCliente || 'cliente'} às ${hh} (${e.duracao || 30}min). Escolha outro horário.`,
        conflito: e,
      };
    }
  }

  // 2. Cliente duplicado no dia (mesmo telefone)
  if (telefoneNorm && telefoneNorm.length >= 8) {
    const duplicado = existentes.find((e) => {
      const d = new Date(e.data);
      if (d < inicioDia || d > fimDia) return false;
      const tel = (e.telefoneCliente || '').replace(/\D/g, '');
      return tel === telefoneNorm || mesmoTelefone(tel, telefoneNorm);
    });
    if (duplicado) {
      const hh = horaTexto(duplicado.data);
      return {
        erro: `Este cliente já tem agendamento neste dia às ${hh}. Edite o existente em vez de criar outro.`,
        conflito: duplicado,
      };
    }
  }

  return null;
}

// Campos que os efeitos da fase 2 (encaixe, sinal, pacote, comissao) precisam
// do agendamento ANTES de uma mudanca.
const SELECT_ANTES = {
  id: true, clienteId: true, data: true, duracao: true, especialistaId: true, servico: true,
  status: true, telefoneCliente: true, nomeCliente: true, preco: true,
  sinalStatus: true, sinalCobrancaId: true, pacoteClienteId: true,
};

function exigeTenant(req, res) {
  if (!req.usuario?.clienteId) {
    res.status(403).json({ erro: 'Acesso negado: usuario sem tenant.' });
    return null;
  }
  return req.usuario.clienteId;
}

// =====================================================================
// CONFIGURACAO DA AGENDA (fase 2): sinal padrao e encaixe automatico
// =====================================================================
roteador.get('/config', requerPermissao('AGENDA', 'visualizar'), async (req, res) => {
  try {
    const clienteId = exigeTenant(req, res);
    if (!clienteId) return;
    const cliente = await prisma.cliente.findUnique({
      where: { id: clienteId },
      select: { sinalPadraoPct: true, encaixeAutomatico: true, ...CAMPOS_ASSINATURA },
    });
    res.json({
      sinalPadraoPct: cliente?.sinalPadraoPct ?? 0,
      encaixeAutomatico: !!cliente?.encaixeAutomatico,
      pagamentoConfigurado: await sinal.pagamentoConfigurado(clienteId),
      // Asaas pede CPF/CNPJ de quem paga (venda de pacote por Pix mostra o campo).
      pagamentoExigeCpf: Boolean((await provedorAtivo(clienteId))?.exigeCpfCnpj),
      pacotesNoPlano: cliente ? temRecurso(cliente, 'pacotes') : false,
      prazoSinalHoras: sinal.PRAZO_PADRAO_HORAS,
    });
  } catch (erro) {
    console.error('[agenda/config get]', erro);
    res.status(500).json({ erro: 'Erro ao carregar as configurações da agenda.' });
  }
});

roteador.put('/config', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = exigeTenant(req, res);
    if (!clienteId) return;
    const { sinalPadraoPct, encaixeAutomatico } = req.body || {};
    const data = {};
    if (sinalPadraoPct !== undefined) {
      const n = sinalPadraoPct === null || sinalPadraoPct === '' ? 0 : Number(sinalPadraoPct);
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        return res.status(422).json({ erro: 'O sinal precisa ser um número inteiro de 0 a 100.', campos: ['sinalPadraoPct'] });
      }
      data.sinalPadraoPct = n;
    }
    if (encaixeAutomatico !== undefined) {
      if (typeof encaixeAutomatico !== 'boolean') return res.status(422).json({ erro: 'Valor inválido.', campos: ['encaixeAutomatico'] });
      data.encaixeAutomatico = encaixeAutomatico;
    }
    if (!Object.keys(data).length) return res.status(422).json({ erro: 'Nada para salvar.' });
    const c = await prisma.cliente.update({ where: { id: clienteId }, data, select: { sinalPadraoPct: true, encaixeAutomatico: true } });
    res.json({ sinalPadraoPct: c.sinalPadraoPct ?? 0, encaixeAutomatico: c.encaixeAutomatico });
  } catch (erro) {
    console.error('[agenda/config put]', erro);
    res.status(500).json({ erro: 'Erro ao salvar as configurações da agenda.' });
  }
});

// Sinal por servico: null = segue o padrao do negocio; 0 = nao cobra.
roteador.get('/servicos/sinal', requerPermissao('AGENDA', 'visualizar'), async (req, res) => {
  try {
    const clienteId = exigeTenant(req, res);
    if (!clienteId) return;
    const servicos = await prisma.produto.findMany({
      where: { clienteId, tipo: 'SERVICO' }, select: { id: true, sinalPercentual: true },
    });
    res.json(servicos);
  } catch (erro) {
    console.error('[agenda/servicos sinal]', erro);
    res.status(500).json({ erro: 'Erro ao carregar o sinal dos serviços.' });
  }
});

roteador.put('/servicos/:produtoId/sinal', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = exigeTenant(req, res);
    if (!clienteId) return;
    const produto = await prisma.produto.findFirst({ where: { id: req.params.produtoId, clienteId, tipo: 'SERVICO' }, select: { id: true } });
    if (!produto) return res.status(404).json({ erro: 'Serviço não encontrado.' });
    const bruto = req.body?.sinalPercentual;
    let valor = null;
    if (bruto !== null && bruto !== undefined && bruto !== '') {
      valor = Number(bruto);
      if (!Number.isInteger(valor) || valor < 0 || valor > 100) {
        return res.status(422).json({ erro: 'O sinal precisa ser um número inteiro de 0 a 100.', campos: ['sinalPercentual'] });
      }
    }
    const p = await prisma.produto.update({ where: { id: produto.id }, data: { sinalPercentual: valor }, select: { id: true, sinalPercentual: true } });
    res.json(p);
  } catch (erro) {
    console.error('[agenda/servico sinal put]', erro);
    res.status(500).json({ erro: 'Erro ao salvar o sinal do serviço.' });
  }
});

// Antes de marcar: pacotes ativos da cliente e o sinal que vale pro servico.
//   GET /agenda/pre-agendamento?telefone=&leadId=&produtoId=&preco=
roteador.get('/pre-agendamento', requerPermissao('AGENDA', 'visualizar'), async (req, res) => {
  try {
    const clienteId = exigeTenant(req, res);
    if (!clienteId) return;
    const telefone = typeof req.query.telefone === 'string' ? req.query.telefone : null;
    const leadId = typeof req.query.leadId === 'string' && req.query.leadId ? req.query.leadId : null;
    const produtoId = typeof req.query.produtoId === 'string' && req.query.produtoId ? req.query.produtoId : null;
    const precoLido = lerDinheiro(req.query.preco ?? 0, { min: 0, max: 100000 });
    const preco = precoLido.ok ? precoLido.valor : 0;

    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: CAMPOS_ASSINATURA });
    const pacotesNoPlano = cliente ? temRecurso(cliente, 'pacotes') : false;
    let lista = [];
    if (pacotesNoPlano && (telefone || leadId)) {
      if (leadId) {
        const lead = await prisma.lead.findFirst({ where: { id: leadId, clienteId }, select: { id: true } });
        if (!lead) return res.status(422).json({ erro: 'Cliente inválida.', campos: ['leadId'] });
      }
      lista = await pacotes.pacotesAtivosDaCliente({ clienteId, leadId, telefone });
    }
    const pct = await sinal.percentualDoServico(clienteId, produtoId);
    // Asaas pede CPF/CNPJ de quem paga o sinal: a tela so pede o campo quando
    // o provedor exige e a cliente (achada pelo lead ou telefone) nao tem CPF.
    const prov = await provedorAtivo(clienteId);
    let cpfCadastrado = false;
    if (prov?.exigeCpfCnpj && (leadId || telefone)) {
      const lead = leadId
        ? await prisma.lead.findFirst({ where: { id: leadId, clienteId }, select: { cpf: true } })
        : await leadPorTelefone(clienteId, telefone);
      cpfCadastrado = Boolean(cpfCnpjValido(lead?.cpf));
    }
    res.json({
      pacotes: lista,
      pacotesNoPlano,
      sinal: {
        pct,
        valor: sinal.valorSinal({ preco, pct }),
        pagamentoConfigurado: await sinal.pagamentoConfigurado(clienteId),
        prazoHoras: sinal.PRAZO_PADRAO_HORAS,
        exigeCpf: Boolean(prov?.exigeCpfCnpj),
        cpfCadastrado,
      },
    });
  } catch (erro) {
    console.error('[agenda/pre-agendamento]', erro);
    res.status(500).json({ erro: 'Erro ao consultar pacote e sinal.' });
  }
});

roteador.get('/', requerPermissao('AGENDA', 'visualizar'), async (req, res) => {
  try {
    const { month, year, date, inicio, fim, especialistaId, status } = req.query;
    const where = { ...tenantFiltro(req) };
    const escopoW = await escopoAgendaWhere(req);
    Object.assign(where, escopoW);
    // O filtro de especialista por query so vale pra quem ve TODAS (gestor).
    if (!escopoW.especialistaId && typeof especialistaId === 'string' && especialistaId) {
      where.especialistaId = especialistaId;
    }
    // Filtro de status (opcional).
    if (typeof status === 'string' && ['PENDING', 'CONFIRMED', 'CANCELED', 'COMPLETED'].includes(status)) {
      where.status = status;
    }

    // PREFERIDO: front manda inicio/fim em ISO ja calculados no fuso do
    // usuario. Backend so passa adiante — zero risco de TZ shift.
    const invalida = (v) => v !== undefined && (typeof v !== 'string' || Number.isNaN(new Date(v).getTime()));
    if (invalida(inicio) || invalida(fim) || invalida(date)) {
      return res.status(422).json({ erro: 'Período inválido.', campos: ['inicio', 'fim'] });
    }
    if (month !== undefined || year !== undefined) {
      const m = Number(month); const y = Number(year);
      if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 1900 || y > 2100) {
        return res.status(422).json({ erro: 'Mês ou ano inválido.', campos: ['month', 'year'] });
      }
    }
    if (inicio && fim) {
      where.data = { gte: new Date(inicio), lte: new Date(fim) };
    } else if (date) {
      // Compat com clientes antigos. Cuidado: pode shiftar de dia se o
      // servidor nao estiver no mesmo TZ do cliente.
      const inicioDia = new Date(date);
      inicioDia.setHours(0, 0, 0, 0);
      const fimDia = new Date(date);
      fimDia.setHours(23, 59, 59, 999);
      where.data = { gte: inicioDia, lte: fimDia };
    } else if (month && year) {
      const inicioMes = new Date(year, month - 1, 1);
      const fimMes = new Date(year, month, 0, 23, 59, 59, 999);
      where.data = { gte: inicioMes, lte: fimMes };
    }

    const agendamentos = await prisma.agendamento.findMany({
      where,
      include: {
        lead: { select: { nome: true, telefone: true } },
        especialista: { select: { id: true, nome: true } }
      },
      orderBy: { data: 'asc' }
    });

    // Saldo do pacote em cada horario que usa pacote ("pacote 3 de 10").
    const idsPacote = [...new Set(agendamentos.map((a) => a.pacoteClienteId).filter(Boolean))];
    if (idsPacote.length) {
      const lista = await prisma.pacoteCliente.findMany({
        where: { id: { in: idsPacote } },
        select: { id: true, clienteId: true, sessoesTotal: true, sessoesUsadas: true, modelo: { select: { nome: true } } },
      });
      const mapa = new Map(lista.map((p) => [p.id, p]));
      for (const a of agendamentos) {
        const p = a.pacoteClienteId ? mapa.get(a.pacoteClienteId) : null;
        a.pacote = p && p.clienteId === a.clienteId
          ? { id: p.id, nome: p.modelo.nome, sessoesTotal: p.sessoesTotal, sessoesUsadas: p.sessoesUsadas, saldo: pacotes.saldoPacote(p) }
          : null;
      }
    }

    res.json(agendamentos);
  } catch (erro) {
    console.error('[agenda/list]', erro);
    res.status(500).json({ erro: 'Erro ao carregar agenda' });
  }
});

// Criar agendamento manual. Conferencia de conflito + gravacao numa transacao
// com trava do negocio (pg_advisory_xact_lock): dois cliques/pedidos ao mesmo
// tempo no mesmo horario e profissional, so um grava (igual ao link publico).
roteador.post('/', requerPermissao('AGENDA', 'criar'), async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    let clienteId = req.usuario.clienteId;
    const {
      leadId, especialistaId, clienteId: bodyClienteId,
      // fase 2: servico do catalogo (sinal por servico), pacote e sinal
      produtoId, pacoteClienteId, cobrarSinal,
      // Asaas pede CPF/CNPJ de quem paga o sinal (quando o lead nao tem)
      cpfCnpj,
    } = body;

    // Apenas ADMIN pode criar para outro tenant.
    if (ehAdmin(req.usuario)) {
      if (typeof bodyClienteId === 'string' && bodyClienteId) {
        clienteId = bodyClienteId;
      } else if (typeof leadId === 'string' && leadId) {
        const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { clienteId: true } });
        if (lead) clienteId = lead.clienteId;
      }
    }
    if (!clienteId) return res.status(403).json({ erro: 'Acao nao permitida.' });

    const lido = lerCamposAgendamento(body);
    if (lido.erro) return res.status(422).json({ erro: lido.erro, campos: lido.campos });
    const campos = lido.data;

    // Lead (opcional): do mesmo negocio. De outro negocio = 404.
    let leadIdValidado = null;
    if (leadId !== undefined && leadId !== null && leadId !== '') {
      if (typeof leadId !== 'string') return res.status(422).json({ erro: 'Cliente inválida.', campos: ['leadId'] });
      const lead = await prisma.lead.findFirst({ where: { id: leadId, clienteId }, select: { id: true } });
      if (!lead) return res.status(404).json({ erro: 'Cliente não encontrada.', campos: ['leadId'] });
      leadIdValidado = lead.id;
    }

    // Escopo "so os proprios": so marca na propria agenda.
    const espEscopo = await especialistaDoEscopo(req);
    if (espEscopo && especialistaId !== espEscopo) {
      return res.status(403).json({ erro: 'Você só pode marcar horários na sua própria agenda.', campos: ['especialistaId'] });
    }

    // Especialista (opcional): do mesmo negocio.
    let especialistaIdValidado = null;
    if (especialistaId !== undefined && especialistaId !== null && especialistaId !== '') {
      if (typeof especialistaId !== 'string') return res.status(422).json({ erro: 'Profissional inválido.', campos: ['especialistaId'] });
      const esp = await prisma.especialista.findFirst({ where: { id: especialistaId, clienteId }, select: { id: true } });
      if (!esp) return res.status(404).json({ erro: 'Profissional não encontrado.', campos: ['especialistaId'] });
      especialistaIdValidado = esp.id;
    }

    // Passado / fora do expediente: avisa e pede confirmacao.
    const avisos = await avisosPendentes({
      clienteId, especialistaId: especialistaIdValidado, inicio: campos.data, duracao: campos.duracao, confirmado: body.confirmarAvisos,
    });
    if (avisos.length) {
      return res.status(422).json({ erro: `${avisos.join(' ')} Confirme para marcar mesmo assim.`, codigo: 'CONFIRMAR_AVISOS', avisos, campos: ['data'] });
    }

    if (pacoteClienteId !== undefined && pacoteClienteId !== null && pacoteClienteId !== '') {
      if (typeof pacoteClienteId !== 'string') return res.status(422).json({ erro: 'Pacote inválido.', campos: ['pacoteClienteId'] });
      const dadosPlano = await prisma.cliente.findUnique({ where: { id: clienteId }, select: CAMPOS_ASSINATURA });
      if (!dadosPlano || !temRecurso(dadosPlano, 'pacotes')) {
        return res.status(403).json({ erro: 'Seu plano não inclui pacotes de sessões.', codigo: 'PLANO_SEM_RECURSO', recurso: 'pacotes' });
      }
    }

    let produtoIdValidado = null;
    if (typeof produtoId === 'string' && produtoId) {
      const prod = await prisma.produto.findFirst({ where: { id: produtoId, clienteId }, select: { id: true } });
      produtoIdValidado = prod?.id || null;
    }

    const novoAgendamento = await prisma.$transaction(async (tx) => {
      await lockClienteAdvisory(tx, clienteId);
      const conflito = await validarConflitosAgenda({
        clienteId, dataNova: campos.data, duracaoNova: campos.duracao, telefone: campos.telefoneCliente,
        especialistaId: especialistaIdValidado, client: tx,
      });
      if (conflito) throw erroHttp(422, conflito.erro, { conflito: conflito.conflito });

      // Pacote: conferido com a trava, pra 2 pedidos nao reservarem a mesma sessao.
      let pacoteIdValidado = null;
      if (typeof pacoteClienteId === 'string' && pacoteClienteId) {
        try {
          const p = await pacotes.validarUsoNoAgendamento({
            clienteId, pacoteClienteId, leadId: leadIdValidado, telefone: campos.telefoneCliente, servico: campos.servico, dataAgendamento: campos.data,
          });
          pacoteIdValidado = p.id;
        } catch (e) {
          if (e.status) throw erroHttp(e.status, e.message, { campos: e.campos });
          throw e;
        }
      }

      return tx.agendamento.create({
        data: {
          clienteId,
          leadId: leadIdValidado,
          especialistaId: especialistaIdValidado,
          nomeCliente: campos.nomeCliente,
          telefoneCliente: campos.telefoneCliente ?? null,
          data: campos.data,
          duracao: campos.duracao,
          servico: campos.servico ?? null,
          preco: campos.preco,
          observacoes: campos.observacoes ?? null,
          origem: campos.origem,
          status: 'PENDING',
          pacoteClienteId: pacoteIdValidado,
        },
      });
    }, { timeout: 15000 });

    // Log: criacao do agendamento (snapshot inicial nas alteracoes pra contexto)
    await logHistorico({
      agendamentoId: novoAgendamento.id,
      acao: 'CRIADO',
      alteracoes: {
        snapshot: {
          nomeCliente: campos.nomeCliente, servico: campos.servico ?? null, data: campos.data.toISOString(),
          duracao: campos.duracao, preco: campos.preco,
        },
      },
      req,
      origem: campos.origem,
    });

    if (leadIdValidado) {
      await prisma.historicoLead.create({
        data: {
          leadId: leadIdValidado,
          acao: 'EDITADO',
          observacoes: `Novo agendamento criado: ${campos.servico || 'atendimento'} em ${campos.data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        },
      }).catch((e) => console.error('[agenda/create] historicoLead', e?.message));
    }

    // Sinal por Pix: so quando a equipe pediu, sem pacote e com valor.
    let sinalResultado = null;
    if (cobrarSinal === true && !novoAgendamento.pacoteClienteId) {
      sinalResultado = await sinal.cobrarSinal({
        agendamento: novoAgendamento, produtoId: produtoIdValidado,
        cpfCnpj: typeof cpfCnpj === 'string' ? cpfCnpj : null,
      });
    }
    const final = sinalResultado?.cobrado
      ? await prisma.agendamento.findUnique({ where: { id: novoAgendamento.id } })
      : novoAgendamento;

    res.status(201).json({
      ...final,
      sinal: sinalResultado?.cobrado ? sinalResultado.sinal : null,
      sinalMotivo: sinalResultado && !sinalResultado.cobrado ? sinalResultado.motivo : null,
    });
  } catch (erro) {
    if (responderErroHttp(res, erro)) return;
    console.error('[agenda/create]', erro);
    res.status(500).json({ erro: 'Erro ao salvar agendamento' });
  }
});

roteador.put('/:id', requerPermissao('AGENDA', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

    const existente = await agendamentoDoTenant(id, req);
    if (!existente) return res.status(404).json({ erro: 'Agendamento nao encontrado.' });
    if (ehImutavel(existente)) return bloqueioImutavel(res);

    const lido = lerCamposAgendamento(body, { parcial: true });
    if (lido.erro) return res.status(422).json({ erro: lido.erro, campos: lido.campos });
    const dados = lido.data;

    // "Concluido" so pelo botao Concluir (que gera a venda e gasta a sessao).
    if (dados.status === 'COMPLETED' && existente.status !== 'COMPLETED') {
      return res.status(422).json({ erro: 'Para marcar como concluído, use o botão Concluir (ele lança a venda).', codigo: 'USE_CONCLUIR', campos: ['status'] });
    }

    const antes = await prisma.agendamento.findUnique({
      where: { id },
      select: { ...SELECT_ANTES, observacoes: true },
    });

    // Trocar o profissional: do mesmo negocio; quem ve "so os proprios" nao troca.
    if (body.especialistaId !== undefined) {
      const alvo = body.especialistaId || null;
      if (alvo !== (antes.especialistaId || null)) {
        if (await especialistaDoEscopo(req)) {
          return res.status(403).json({ erro: 'Você não pode passar o atendimento para outra profissional.', campos: ['especialistaId'] });
        }
        if (alvo !== null) {
          if (typeof alvo !== 'string') return res.status(422).json({ erro: 'Profissional inválido.', campos: ['especialistaId'] });
          const esp = await prisma.especialista.findFirst({ where: { id: alvo, clienteId: antes.clienteId }, select: { id: true } });
          if (!esp) return res.status(404).json({ erro: 'Profissional não encontrado.', campos: ['especialistaId'] });
        }
        dados.especialistaId = alvo;
      }
    }

    // Atendimento concluido: o valor ja virou venda. Muda so depois de reabrir.
    if (antes.status === 'COMPLETED' && (dados.status === undefined || dados.status === 'COMPLETED')
      && dados.preco !== undefined && dados.preco !== antes.preco) {
      return res.status(409).json({ erro: 'Atendimento já concluído: o valor virou venda. Reabra o atendimento antes de mudar o preço.', campos: ['preco'] });
    }

    const mudouHorario = dados.data && new Date(dados.data).getTime() !== new Date(antes.data).getTime();
    if (mudouHorario || (dados.duracao && dados.duracao !== antes.duracao)) {
      const avisos = await avisosPendentes({
        clienteId: antes.clienteId,
        especialistaId: dados.especialistaId !== undefined ? dados.especialistaId : antes.especialistaId,
        inicio: dados.data || antes.data, duracao: dados.duracao || antes.duracao, confirmado: body.confirmarAvisos,
      });
      if (avisos.length) {
        return res.status(422).json({ erro: `${avisos.join(' ')} Confirme para salvar mesmo assim.`, codigo: 'CONFIRMAR_AVISOS', avisos, campos: ['data'] });
      }
    }

    const { atualizado, desfeito } = await prisma.$transaction(async (tx) => {
      await lockClienteAdvisory(tx, antes.clienteId);
      const atual = await tx.agendamento.findUnique({ where: { id }, select: { status: true } });
      if (!atual) throw erroHttp(404, 'Agendamento nao encontrado.');
      if (atual.status !== antes.status) throw erroHttp(409, 'Esse agendamento acabou de mudar. Recarregue e tente de novo.');

      const precisaConferir = dados.data || dados.duracao || dados.telefoneCliente !== undefined || dados.especialistaId !== undefined;
      const statusFinal = dados.status || antes.status;
      if (precisaConferir && statusFinal !== 'CANCELED') {
        const conflito = await validarConflitosAgenda({
          clienteId: antes.clienteId,
          dataNova: dados.data || antes.data,
          duracaoNova: dados.duracao || antes.duracao,
          telefone: dados.telefoneCliente !== undefined ? dados.telefoneCliente : antes.telefoneCliente,
          excluirId: id,
          especialistaId: dados.especialistaId !== undefined ? dados.especialistaId : antes.especialistaId,
          client: tx,
        });
        if (conflito) throw erroHttp(422, conflito.erro, { conflito: conflito.conflito });
      }

      const upd = await tx.agendamento.update({ where: { id }, data: dados });
      let desfeitoTx = null;
      if (antes.status === 'COMPLETED' && upd.status !== 'COMPLETED') {
        desfeitoTx = await desfazerConclusao(tx, {
          agendamentoId: id, clienteId: antes.clienteId, usuarioId: req.usuario?.id || null,
          motivo: upd.status === 'CANCELED' ? 'Atendimento cancelado na agenda' : 'Atendimento reaberto na agenda',
        });
      }
      return { atualizado: upd, desfeito: desfeitoTx };
    }, { timeout: 15000 });

    // Diff entre estado antes e dados gravados. Se nada mudou, nao loga.
    const alteracoes = calcularAlteracoes(antes, dados, [
      'nomeCliente', 'telefoneCliente', 'data', 'duracao',
      'servico', 'preco', 'observacoes', 'status', 'especialistaId',
    ]);
    if (alteracoes) {
      const ehSoStatus = Object.keys(alteracoes).length === 1 && alteracoes.status;
      await logHistorico({
        agendamentoId: id,
        acao: ehSoStatus ? 'STATUS_MUDADO' : 'EDITADO',
        alteracoes: desfeito?.vendaCancelada ? { ...alteracoes, vendaCancelada: desfeito.vendaCancelada.numero } : alteracoes,
        req,
      });
    }

    // Fase 2: cancelou ou mudou de horario -> o horario antigo vagou.
    const cancelou = atualizado.status === 'CANCELED' && antes.status !== 'CANCELED';
    const moveu = new Date(atualizado.data).getTime() !== new Date(antes.data).getTime() && antes.status !== 'CANCELED' && atualizado.status !== 'CANCELED';
    const desfezConclusao = antes.status === 'COMPLETED' && atualizado.status !== 'COMPLETED';
    if (cancelou || moveu || desfezConclusao) {
      await aoLiberarHorario(antes, { cancelado: cancelou });
    }

    res.json({ ...atualizado, vendaCancelada: desfeito?.vendaCancelada || null });
  } catch (erro) {
    if (responderErroHttp(res, erro)) return;
    console.error('[agenda/update]', erro);
    res.status(500).json({ erro: 'Erro ao atualizar agendamento' });
  }
});

roteador.delete('/:id', requerPermissao('AGENDA', 'excluir'), async (req, res) => {
  try {
    const { id } = req.params;

    const existente = await agendamentoDoTenant(id, req);
    if (!existente) return res.status(404).json({ erro: 'Agendamento nao encontrado.' });
    if (ehImutavel(existente)) return bloqueioImutavel(res);

    // Tudo numa transacao com trava: clique duplo vira 1x 204 e o resto 404
    // (antes dava 500). Atendimento concluido excluido cancela a venda junto.
    const r = await prisma.$transaction(async (tx) => {
      await lockClienteAdvisory(tx, existente.clienteId);
      const antes = await tx.agendamento.findFirst({
        where: { id, clienteId: existente.clienteId },
        select: { ...SELECT_ANTES, observacoes: true },
      });
      if (!antes) return null;
      // Loga ANTES do delete pra inserir com agendamentoId ainda valido;
      // o SetNull rebaixa depois sem perder a linha.
      await tx.historicoAgendamento.create({
        data: {
          agendamentoId: id, acao: 'EXCLUIDO',
          alteracoes: { snapshot: {
            nomeCliente: antes.nomeCliente, telefoneCliente: antes.telefoneCliente, data: antes.data.toISOString(),
            duracao: antes.duracao, servico: antes.servico, preco: antes.preco, status: antes.status, observacoes: antes.observacoes,
          } },
          usuarioId: req.usuario?.id || null, usuarioNome: req.usuario?.nome || null,
        },
      });
      let desfeito = null;
      if (antes.status === 'COMPLETED') {
        desfeito = await desfazerConclusao(tx, {
          agendamentoId: id, clienteId: existente.clienteId, usuarioId: req.usuario?.id || null, motivo: 'Atendimento excluído na agenda',
        });
      }
      const del = await tx.agendamento.deleteMany({ where: { id, clienteId: existente.clienteId } });
      if (!del.count) return null;
      return { antes, desfeito };
    }, { timeout: 15000 });
    if (!r) return res.status(404).json({ erro: 'Agendamento nao encontrado.' });

    // Fase 2: horario futuro excluido vira vaga; concluido excluido estorna.
    if (r.antes.status !== 'CANCELED') await aoLiberarHorario(r.antes, { cancelado: true });
    res.status(204).send();
  } catch (erro) {
    if (responderErroHttp(res, erro)) return;
    console.error('[agenda/delete]', erro);
    res.status(500).json({ erro: 'Erro ao excluir agendamento' });
  }
});

roteador.patch('/:id/status', requerPermissao('AGENDA', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;
    const status = req.body?.status;

    const statusValidos = ['PENDING', 'CONFIRMED', 'CANCELED', 'COMPLETED'];
    if (!statusValidos.includes(status)) {
      return res.status(400).json({ erro: 'Status invalido' });
    }

    const existente = await agendamentoDoTenant(id, req);
    if (!existente) return res.status(404).json({ erro: 'Agendamento nao encontrado.' });
    // "Concluido" so pelo Concluir: e ele que lanca a venda e gasta a sessao.
    if (status === 'COMPLETED' && existente.status !== 'COMPLETED') {
      return res.status(422).json({ erro: 'Para marcar como concluído, use o botão Concluir (ele lança a venda).', codigo: 'USE_CONCLUIR' });
    }
    // Patch de status: tambem barra se o item ja estiver imutavel. Detalhe:
    // a 1a transicao PENDING -> X em item passado e permitida (ehImutavel
    // checa o estado ATUAL antes da mudanca, e PENDING nao trava).
    if (ehImutavel(existente)) return bloqueioImutavel(res);
    if (existente.status === status) {
      return res.json(await prisma.agendamento.findUnique({ where: { id } }));
    }

    const { antesFase2, atualizado, desfeito } = await prisma.$transaction(async (tx) => {
      await lockClienteAdvisory(tx, existente.clienteId);
      const antesTx = await tx.agendamento.findUnique({ where: { id }, select: SELECT_ANTES });
      // Atualizacao condicional: so muda se ainda esta no status que a tela viu.
      const mudou = await tx.agendamento.updateMany({ where: { id, status: existente.status }, data: { status } });
      if (!antesTx || !mudou.count) throw erroHttp(409, 'Esse agendamento acabou de mudar. Recarregue e tente de novo.');
      let desfeitoTx = null;
      if (existente.status === 'COMPLETED') {
        desfeitoTx = await desfazerConclusao(tx, {
          agendamentoId: id, clienteId: existente.clienteId, usuarioId: req.usuario?.id || null,
          motivo: status === 'CANCELED' ? 'Atendimento cancelado na agenda' : 'Atendimento reaberto na agenda',
        });
      }
      return { antesFase2: antesTx, atualizado: await tx.agendamento.findUnique({ where: { id } }), desfeito: desfeitoTx };
    }, { timeout: 15000 });

    // Fase 2: cancelou -> vaga pra fila; desfez concluido -> sinal/encaixe.
    if ((status === 'CANCELED' && existente.status !== 'CANCELED') || existente.status === 'COMPLETED') {
      await aoLiberarHorario(antesFase2, { cancelado: status === 'CANCELED' });
    }

    await logHistorico({
      agendamentoId: id,
      acao: 'STATUS_MUDADO',
      alteracoes: {
        status: { de: existente.status, para: status },
        ...(desfeito?.vendaCancelada ? { vendaCancelada: desfeito.vendaCancelada.numero } : {}),
      },
      req,
    });

    res.json({ ...atualizado, vendaCancelada: desfeito?.vendaCancelada || null });
  } catch (erro) {
    if (responderErroHttp(res, erro)) return;
    console.error('[agenda/status]', erro);
    res.status(500).json({ erro: 'Erro ao mudar status' });
  }
});

// =====================================================================
// HISTORICO DE UM AGENDAMENTO
// =====================================================================
// Retorna o log completo de mudancas (mais recente primeiro).
// Permissao: AGENDA/visualizar (mesma do GET).
roteador.get('/:id/historico', requerPermissao('AGENDA', 'visualizar'), async (req, res) => {
  try {
    const { id } = req.params;
    const existente = await agendamentoDoTenant(id, req);
    if (!existente) return res.status(404).json({ erro: 'Agendamento nao encontrado.' });

    const historico = await prisma.historicoAgendamento.findMany({
      where: { agendamentoId: id },
      orderBy: { criadoEm: 'desc' },
    });

    res.json(historico);
  } catch (erro) {
    console.error('[agenda/historico]', erro);
    res.status(500).json({ erro: 'Erro ao carregar historico' });
  }
});

// =====================================================================
// CONCLUIR ATENDIMENTO — marca COMPLETED e gera a venda do servico
// =====================================================================
// O serviço só vira receita quando acontece: ao concluir, cria a Venda
// (valor/descricao do agendamento) + lançamento no caixa, numa transação com
// trava do negocio. Status muda por atualizacao condicional: clique duplo dá
// 1x 200 e o resto 409 "já concluído" (nunca 500). Serviço NÃO mexe em
// estoque. Caixa auto (AUTO_BOT) se não houver aberto, igual ao fluxo do bot.
// Respeita o escopo e a trava de atendimento passado (423).
// "Não compareceu" reusa PATCH /:id/status (CANCELED) — sem venda.
roteador.patch('/:id/concluir', requerPermissao('AGENDA', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string' || !id) return res.status(404).json({ erro: 'Agendamento nao encontrado.' });
    const escopoW = await escopoAgendaWhere(req);
    const ag = await prisma.agendamento.findFirst({
      where: { id, ...tenantFiltro(req), ...escopoW },
      select: {
        id: true, clienteId: true, status: true, servico: true, preco: true, data: true,
        leadId: true, nomeCliente: true, venda: { select: { id: true, status: true } },
        especialistaId: true, pacoteClienteId: true, sinalValor: true, sinalStatus: true,
      },
    });
    if (!ag) return res.status(404).json({ erro: 'Agendamento nao encontrado.' });
    if (ag.status === 'COMPLETED' || (ag.venda && ag.venda.status !== 'CANCELLED')) {
      return res.status(409).json({ erro: 'Este atendimento ja foi concluido.' });
    }
    if (ag.status === 'CANCELED') {
      return res.status(422).json({ erro: 'Agendamento cancelado nao pode ser concluido.' });
    }
    if (ehImutavel(ag)) return bloqueioImutavel(res);

    let metodoPagamento = null;
    if (req.body?.metodoPagamento !== undefined && req.body.metodoPagamento !== null && req.body.metodoPagamento !== '') {
      if (!METODOS_PAGAMENTO.includes(req.body.metodoPagamento)) {
        return res.status(422).json({ erro: 'Forma de pagamento inválida.', campos: ['metodoPagamento'] });
      }
      metodoPagamento = req.body.metodoPagamento;
    }
    const precoCheio = Number.isFinite(ag.preco) && ag.preco > 0 ? ag.preco : 0;
    // Sinal pago por Pix ja entrou no financeiro: no balcao so cobra o resto.
    const valorSemPacote = Math.max(0, sinal.valorAposSinal({ preco: precoCheio, sinalValor: ag.sinalValor, sinalStatus: ag.sinalStatus }));
    const descricaoBase = ag.servico ? `Atendimento: ${ag.servico}` : `Atendimento de ${ag.nomeCliente}`;

    let resultado;
    let tentativa = 0;
    while (true) {
      try {
        resultado = await prisma.$transaction(async (tx) => {
          await lockClienteAdvisory(tx, ag.clienteId);

          const atual = await tx.agendamento.findUnique({
            where: { id: ag.id }, select: { status: true, venda: { select: { id: true, status: true } } },
          });
          if (!atual) throw erroHttp(404, 'Agendamento nao encontrado.');
          if (atual.status === 'COMPLETED' || (atual.venda && atual.venda.status !== 'CANCELLED')) {
            throw erroHttp(409, 'Este atendimento ja foi concluido.');
          }
          if (atual.status === 'CANCELED') throw erroHttp(422, 'Agendamento cancelado nao pode ser concluido.');
          const marcado = await tx.agendamento.updateMany({ where: { id: ag.id, status: atual.status }, data: { status: 'COMPLETED' } });
          if (!marcado.count) throw erroHttp(409, 'Este atendimento ja foi concluido.');
          // Venda antiga (ja cancelada quando o atendimento foi reaberto) solta
          // o vinculo 1:1 pra nova venda nascer.
          if (atual.venda) await tx.venda.update({ where: { id: atual.venda.id }, data: { agendamentoId: null } });

          // Mesma trava do numero de venda que o vendaService usa: Concluir e
          // venda do caixa em paralelo nunca pegam o mesmo numero.
          await lockClienteAdvisory(tx, `venda-numero:${ag.clienteId}`);
          const numeroVenda = await proximoNumeroVenda(tx, ag.clienteId);

          const { sessao } = await obterOuAbrirSessaoCaixa(tx, ag.clienteId, {
            motivo: 'Aberto automaticamente ao concluir um atendimento sem caixa aberto.',
          });

          // Pacote: consome 1 sessao (idempotente) e o atendimento sai sem cobrar.
          const uso = await pacotes.consumirSessao(tx, ag);
          let valor = valorSemPacote;
          let descricao = descricaoBase;
          if (uso) {
            valor = 0;
            descricao = `${descricaoBase} (pacote: sessão ${uso.pacote.sessoesUsadas} de ${uso.pacote.sessoesTotal})`;
          } else if (ag.sinalStatus === 'PAGO' && ag.sinalValor > 0) {
            descricao = `${descricaoBase} (sinal de R$ ${Number(ag.sinalValor).toFixed(2).replace('.', ',')} já pago por Pix)`;
          }

          // Comissao da profissional: base = preco cheio (ou 1 sessao do pacote).
          const comissao = await gerarComissaoAtendimento(tx, {
            agendamento: ag, base: uso ? uso.valorSessao : precoCheio,
          });

          const venda = await tx.venda.create({
            data: {
              clienteId: ag.clienteId, numero: numeroVenda, leadId: ag.leadId || null,
              sessaoCaixaId: sessao.id, valor, metodoPagamento, descricao,
              status: 'COMPLETED', agendamentoId: ag.id,
            },
          });

          if (valor > 0) {
            await tx.lancamentoFinanceiro.create({
              data: {
                clienteId: ag.clienteId, leadId: ag.leadId || null, vendaId: venda.id,
                sessaoCaixaId: sessao.id, descricao: `Receita Venda #${venda.numero}: ${descricao}`,
                valor, tipo: 'RECEITA', status: 'PAGO', metodoPagamento,
                dataVencimento: new Date(), dataPagamento: new Date(),
              },
            });
          }

          const agAtualizado = await tx.agendamento.findUnique({ where: { id: ag.id } });
          return { venda, agendamento: agAtualizado, uso, comissao };
        }, { timeout: 15000 });
        break;
      } catch (err) {
        // Numero de venda repetido (venda feita por outra tela no mesmo ms): tenta de novo.
        if (err?.code === 'P2002' && tentativa < MAX_RETRIES_NUMERO) { tentativa += 1; continue; }
        throw err;
      }
    }

    await logHistorico({
      agendamentoId: ag.id,
      acao: 'STATUS_MUDADO',
      alteracoes: { status: { de: ag.status, para: 'COMPLETED' }, vendaNumero: resultado.venda.numero },
      req,
    });

    res.json({
      ok: true,
      agendamento: resultado.agendamento,
      venda: { id: resultado.venda.id, numero: resultado.venda.numero, valor: resultado.venda.valor },
      pacote: resultado.uso
        ? { id: resultado.uso.pacote.id, sessoesUsadas: resultado.uso.pacote.sessoesUsadas, sessoesTotal: resultado.uso.pacote.sessoesTotal }
        : null,
      sinalAbatido: !resultado.uso && ag.sinalStatus === 'PAGO' ? ag.sinalValor : 0,
      comissao: resultado.comissao ? { valor: resultado.comissao.valor } : null,
    });
  } catch (erro) {
    if (responderErroHttp(res, erro)) return;
    if (erro?.code === 'P2002') return res.status(409).json({ erro: 'Este atendimento ja foi concluido.' });
    console.error('[agenda/concluir]', erro);
    res.status(500).json({ erro: 'Erro ao concluir o atendimento.' });
  }
});

module.exports = roteador;
// Exposto pra teste (regra pura de conflito usa o banco; aqui so o helper).
module.exports._internos = { validarConflitosAgenda };
