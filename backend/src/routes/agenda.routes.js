const express = require('express');
const { obterOuAbrirSessaoCaixa } = require('../services/caixaAutomatico');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  ehAdmin,
  requerModuloLiberado,
  requerPermissao,
  requerPapelPrivilegiado,
  escopoDoUsuario,
} = require('../middlewares/permissoes.middleware');
const { lockClienteAdvisory } = require('../utils/locks');
const { temRecurso, CAMPOS_ASSINATURA } = require('../planos/recursos');
const { aoLiberarHorario } = require('../agenda/eventosAgenda');
const sinal = require('../agenda/sinal');
const pacotes = require('../agenda/pacotes');
const { gerarComissaoAtendimento } = require('../agenda/comissoes');

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

// Escopo da AGENDA: ADMIN/CLIENT/ADMINISTRADOR veem todos os agendamentos do
// tenant; um usuario com escopo PROPRIAS (ex.: especialista que tem login) ve
// SO os agendamentos do especialista vinculado a ele.
async function escopoAgendaWhere(req) {
  const u = req.usuario;
  if (ehAdmin(u) || u.perfil === 'CLIENT' || u.perfil === 'ADMINISTRADOR') return {};
  const dados = await prisma.usuario.findUnique({
    where: { id: u.id },
    select: { permissoes: true, especialista: { select: { id: true } } },
  });
  const escopo = escopoDoUsuario(u, dados?.permissoes || {}, 'AGENDA');
  if (escopo === 'TODAS') return {};
  // PROPRIAS: filtra pelo especialista do usuario; sem especialista, nao ve nada.
  return { especialistaId: dados?.especialista?.id || '__sem_especialista__' };
}

async function agendamentoDoTenant(id, req) {
  const filtro = ehAdmin(req.usuario) ? { id } : { id, clienteId: req.usuario.clienteId };
  return prisma.agendamento.findFirst({
    where: filtro,
    select: { id: true, clienteId: true, data: true, status: true },
  });
}

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
async function validarConflitosAgenda({ clienteId, dataNova, duracaoNova, telefone, excluirId = null, especialistaId = null }) {
  // Normaliza telefone — só digitos
  const telefoneNorm = (telefone || '').replace(/\D/g, '');

  // Janela do dia (00:00 — 23:59:59) baseado na data do novo agendamento
  const inicioDia = new Date(dataNova);
  inicioDia.setHours(0, 0, 0, 0);
  const fimDia = new Date(dataNova);
  fimDia.setHours(23, 59, 59, 999);

  // Pega todos os agendamentos do dia, exceto CANCELED.
  const existentes = await prisma.agendamento.findMany({
    where: {
      clienteId,
      data: { gte: inicioDia, lte: fimDia },
      status: { not: 'CANCELED' },
      ...(excluirId ? { NOT: { id: excluirId } } : {}),
    },
    select: {
      id: true, nomeCliente: true, telefoneCliente: true,
      data: true, duracao: true, servico: true, status: true, especialistaId: true,
    },
  });

  const fimNovo = new Date(dataNova.getTime() + (duracaoNova || 30) * 60000);

  // 1. Conflito de horario — so conta quando e o MESMO recurso (mesmo
  // especialista, ou ambos sem especialista = recurso unico da loja).
  // Especialistas diferentes podem atender no mesmo horario.
  const espNovo = especialistaId || null;
  for (const e of existentes) {
    if ((e.especialistaId || null) !== espNovo) continue;
    const inicio = new Date(e.data);
    const fim = new Date(inicio.getTime() + (e.duracao || 30) * 60000);
    if (dataNova < fim && fimNovo > inicio) {
      const hh = inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return {
        erro: `Conflito de horário: já existe agendamento de ${e.nomeCliente || 'cliente'} às ${hh} (${e.duracao || 30}min). Escolha outro horário.`,
        conflito: e,
      };
    }
  }

  // 2. Cliente duplicado no dia (mesmo telefone)
  if (telefoneNorm && telefoneNorm.length >= 8) {
    const duplicado = existentes.find((e) => {
      const tel = (e.telefoneCliente || '').replace(/\D/g, '');
      return tel === telefoneNorm;
    });
    if (duplicado) {
      const hh = new Date(duplicado.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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
    const preco = Number(req.query.preco) || 0;

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
    res.json({
      pacotes: lista,
      pacotesNoPlano,
      sinal: {
        pct,
        valor: sinal.valorSinal({ preco, pct }),
        pagamentoConfigurado: await sinal.pagamentoConfigurado(clienteId),
        prazoHoras: sinal.PRAZO_PADRAO_HORAS,
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

roteador.post('/', requerPermissao('AGENDA', 'criar'), async (req, res) => {
  try {
    let clienteId = req.usuario.clienteId;
    const {
      leadId, nomeCliente, telefoneCliente, data, duracao,
      servico, preco, observacoes, origem, especialistaId,
      clienteId: bodyClienteId,
      // fase 2: servico do catalogo (sinal por servico), pacote e sinal
      produtoId, pacoteClienteId, cobrarSinal,
    } = req.body;

    // Apenas ADMIN pode criar para outro tenant.
    if (ehAdmin(req.usuario)) {
      if (bodyClienteId) {
        clienteId = bodyClienteId;
      } else if (leadId) {
        const lead = await prisma.lead.findUnique({ where: { id: leadId } });
        if (lead) clienteId = lead.clienteId;
      }
    }

    if (!clienteId) {
      return res.status(403).json({ erro: 'Acao nao permitida.' });
    }

    // Verifica se o leadId, se fornecido, pertence ao mesmo tenant.
    if (leadId) {
      const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { clienteId: true } });
      if (!lead || (lead.clienteId !== clienteId && !ehAdmin(req.usuario))) {
        return res.status(400).json({ erro: 'Lead invalido para este tenant.' });
      }
    }

    // Especialista (opcional): precisa ser do mesmo tenant.
    let especialistaIdValidado = null;
    if (especialistaId) {
      const esp = await prisma.especialista.findFirst({
        where: { id: especialistaId, clienteId }, select: { id: true },
      });
      if (!esp) return res.status(400).json({ erro: 'Especialista invalido para este tenant.' });
      especialistaIdValidado = esp.id;
    }

    const dataNova = new Date(data);
    const duracaoNova = parseInt(duracao) || 30;

    // Validacao: conflito de horario + cliente duplicado no dia
    const conflito = await validarConflitosAgenda({
      clienteId,
      dataNova,
      duracaoNova,
      telefone: telefoneCliente,
      especialistaId: especialistaIdValidado,
    });
    if (conflito) {
      return res.status(422).json({ erro: conflito.erro, conflito: conflito.conflito });
    }

    // Pacote (opcional): da cliente, ativo, do servico, com sessao livre.
    let pacoteIdValidado = null;
    if (pacoteClienteId) {
      if (typeof pacoteClienteId !== 'string') return res.status(422).json({ erro: 'Pacote inválido.', campos: ['pacoteClienteId'] });
      const dadosPlano = await prisma.cliente.findUnique({ where: { id: clienteId }, select: CAMPOS_ASSINATURA });
      if (!dadosPlano || !temRecurso(dadosPlano, 'pacotes')) {
        return res.status(403).json({ erro: 'Seu plano não inclui pacotes de sessões.', codigo: 'PLANO_SEM_RECURSO', recurso: 'pacotes' });
      }
      try {
        const p = await pacotes.validarUsoNoAgendamento({
          clienteId, pacoteClienteId, leadId: leadId || null, telefone: telefoneCliente, servico, dataAgendamento: dataNova,
        });
        pacoteIdValidado = p.id;
      } catch (e) {
        if (e.status) return res.status(e.status).json({ erro: e.message, campos: e.campos });
        throw e;
      }
    }

    let produtoIdValidado = null;
    if (typeof produtoId === 'string' && produtoId) {
      const prod = await prisma.produto.findFirst({ where: { id: produtoId, clienteId }, select: { id: true } });
      produtoIdValidado = prod?.id || null;
    }

    const novoAgendamento = await prisma.agendamento.create({
      data: {
        clienteId,
        leadId: leadId || null,
        especialistaId: especialistaIdValidado,
        nomeCliente,
        telefoneCliente,
        data: dataNova,
        duracao: duracaoNova,
        servico,
        preco: parseFloat(preco) || 0,
        observacoes,
        origem: origem || 'MANUAL',
        status: 'PENDING',
        pacoteClienteId: pacoteIdValidado,
      }
    });

    // Log: criacao do agendamento (snapshot inicial nas alteracoes pra contexto)
    await logHistorico({
      agendamentoId: novoAgendamento.id,
      acao: 'CRIADO',
      alteracoes: {
        snapshot: {
          nomeCliente, servico, data: dataNova.toISOString(),
          duracao: duracaoNova, preco: parseFloat(preco) || 0,
        },
      },
      req,
      origem: origem || 'MANUAL',
    });

    if (leadId) {
      await prisma.historicoLead.create({
        data: {
          leadId,
          acao: 'EDITADO',
          observacoes: `Novo agendamento criado: ${servico} em ${new Date(data).toLocaleString()}`
        }
      });
    }

    // Sinal por Pix: so quando a equipe pediu, sem pacote e com valor.
    let sinalResultado = null;
    if (cobrarSinal === true && !pacoteIdValidado) {
      sinalResultado = await sinal.cobrarSinal({ agendamento: novoAgendamento, produtoId: produtoIdValidado });
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
    console.error('[agenda/create]', erro);
    res.status(500).json({ erro: 'Erro ao salvar agendamento' });
  }
});

roteador.put('/:id', requerPermissao('AGENDA', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;
    const dados = req.body;

    const existente = await agendamentoDoTenant(id, req);
    if (!existente) return res.status(404).json({ erro: 'Agendamento nao encontrado.' });
    if (ehImutavel(existente)) return bloqueioImutavel(res);

    if (dados.data) dados.data = new Date(dados.data);
    if (dados.preco) dados.preco = parseFloat(dados.preco);
    if (dados.duracao) dados.duracao = parseInt(dados.duracao);

    // Validacao de conflito so faz sentido se mudou data, duracao ou telefone.
    // Pega o agendamento completo pra pegar os campos que nao vieram no body.
    if (dados.data || dados.duracao || dados.telefoneCliente !== undefined) {
      const atual = await prisma.agendamento.findUnique({
        where: { id },
        select: { data: true, duracao: true, telefoneCliente: true, clienteId: true, especialistaId: true },
      });
      const conflito = await validarConflitosAgenda({
        clienteId: atual.clienteId,
        dataNova: dados.data || atual.data,
        duracaoNova: dados.duracao || atual.duracao,
        telefone: dados.telefoneCliente !== undefined ? dados.telefoneCliente : atual.telefoneCliente,
        excluirId: id, // nao bate contra ele mesmo
        especialistaId: atual.especialistaId,
      });
      if (conflito) {
        return res.status(422).json({ erro: conflito.erro, conflito: conflito.conflito });
      }
    }

    // Pega o estado antes pra calcular diff no log
    const antes = await prisma.agendamento.findUnique({
      where: { id },
      select: { ...SELECT_ANTES, observacoes: true },
    });
    if (dados.status !== undefined && !['PENDING', 'CONFIRMED', 'CANCELED', 'COMPLETED'].includes(dados.status)) {
      return res.status(400).json({ erro: 'Status invalido' });
    }

    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: {
        nomeCliente: dados.nomeCliente,
        telefoneCliente: dados.telefoneCliente,
        data: dados.data,
        duracao: dados.duracao,
        servico: dados.servico,
        preco: dados.preco,
        observacoes: dados.observacoes,
        status: dados.status
      }
    });

    // Diff entre estado antes e dados recebidos. Se nada mudou, nao loga
    // (evita lixo no historico de salvar sem alterar).
    const alteracoes = calcularAlteracoes(antes, dados, [
      'nomeCliente', 'telefoneCliente', 'data', 'duracao',
      'servico', 'preco', 'observacoes', 'status',
    ]);
    if (alteracoes) {
      // Se a unica mudanca foi status, marcamos como STATUS_MUDADO pra UX
      const ehSoStatus = Object.keys(alteracoes).length === 1 && alteracoes.status;
      await logHistorico({
        agendamentoId: id,
        acao: ehSoStatus ? 'STATUS_MUDADO' : 'EDITADO',
        alteracoes,
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

    res.json(atualizado);
  } catch (erro) {
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

    // Snapshot completo pra preservar no log apos delete. SET NULL no FK
    // mantem a linha do historico viva; o snapshot identifica o que foi.
    const snapshot = await prisma.agendamento.findUnique({
      where: { id },
      select: {
        nomeCliente: true, telefoneCliente: true, data: true, duracao: true,
        servico: true, preco: true, status: true, observacoes: true,
      },
    });

    // Loga ANTES do delete pra inserir com agendamentoId ainda valido;
    // o SetNull rebaixa depois sem perder a linha.
    await logHistorico({
      agendamentoId: id,
      acao: 'EXCLUIDO',
      alteracoes: { snapshot: { ...snapshot, data: snapshot?.data?.toISOString() } },
      req,
    });

    const antesFase2 = await prisma.agendamento.findUnique({ where: { id }, select: SELECT_ANTES });
    await prisma.agendamento.delete({ where: { id } });
    // Fase 2: horario futuro excluido vira vaga; concluido excluido estorna.
    if (antesFase2 && antesFase2.status !== 'CANCELED') await aoLiberarHorario(antesFase2, { cancelado: true });
    res.status(204).send();
  } catch (erro) {
    console.error('[agenda/delete]', erro);
    res.status(500).json({ erro: 'Erro ao excluir agendamento' });
  }
});

roteador.patch('/:id/status', requerPermissao('AGENDA', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const statusValidos = ['PENDING', 'CONFIRMED', 'CANCELED', 'COMPLETED'];
    if (!statusValidos.includes(status)) {
      return res.status(400).json({ erro: 'Status invalido' });
    }

    const existente = await agendamentoDoTenant(id, req);
    if (!existente) return res.status(404).json({ erro: 'Agendamento nao encontrado.' });
    // Patch de status: tambem barra se o item ja estiver imutavel. Detalhe:
    // a 1a transicao PENDING -> X em item passado e permitida (ehImutavel
    // checa o estado ATUAL antes da mudanca, e PENDING nao trava).
    if (ehImutavel(existente)) return bloqueioImutavel(res);

    const antesFase2 = await prisma.agendamento.findUnique({ where: { id }, select: SELECT_ANTES });
    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: { status }
    });

    // Fase 2: cancelou -> vaga pra fila; desfez concluido -> estorna pacote/comissao.
    if ((status === 'CANCELED' && existente.status !== 'CANCELED') || (existente.status === 'COMPLETED' && status !== 'COMPLETED')) {
      await aoLiberarHorario(antesFase2, { cancelado: status === 'CANCELED' });
    }

    // Log so se realmente mudou
    if (existente.status !== status) {
      await logHistorico({
        agendamentoId: id,
        acao: 'STATUS_MUDADO',
        alteracoes: { status: { de: existente.status, para: status } },
        req,
      });
    }

    res.json(atualizado);
  } catch (erro) {
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
// (valor/descricao do agendamento) + lançamento no caixa, numa transação.
// Serviço NÃO mexe em estoque. Trava de dupla-conclusão (status + venda 1:1).
// Caixa auto (AUTO_BOT) se não houver aberto, igual ao fluxo do bot.
// Respeita o escopo: especialista só conclui os próprios atendimentos.
// "Não compareceu" reusa PATCH /:id/status (CANCELED) — sem venda.
roteador.patch('/:id/concluir', requerPermissao('AGENDA', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;
    const escopoW = await escopoAgendaWhere(req);
    const ag = await prisma.agendamento.findFirst({
      where: { id, ...tenantFiltro(req), ...escopoW },
      select: {
        id: true, clienteId: true, status: true, servico: true, preco: true,
        leadId: true, nomeCliente: true, venda: { select: { id: true } },
        especialistaId: true, pacoteClienteId: true, sinalValor: true, sinalStatus: true,
      },
    });
    if (!ag) return res.status(404).json({ erro: 'Agendamento nao encontrado.' });
    if (ag.status === 'COMPLETED' || ag.venda) {
      return res.status(409).json({ erro: 'Este atendimento ja foi concluido.' });
    }
    if (ag.status === 'CANCELED') {
      return res.status(422).json({ erro: 'Agendamento cancelado nao pode ser concluido.' });
    }

    const metodoPagamento = typeof req.body?.metodoPagamento === 'string' && req.body.metodoPagamento.trim()
      ? req.body.metodoPagamento.trim() : null;
    const precoCheio = Number.isFinite(ag.preco) ? ag.preco : 0;
    // Sinal pago por Pix ja entrou no financeiro: no balcao so cobra o resto.
    const valorSemPacote = sinal.valorAposSinal({ preco: precoCheio, sinalValor: ag.sinalValor, sinalStatus: ag.sinalStatus });
    const descricaoBase = ag.servico ? `Atendimento: ${ag.servico}` : `Atendimento de ${ag.nomeCliente}`;

    let resultado;
    let tentativa = 0;
    while (true) {
      try {
        const ultima = await prisma.venda.findFirst({
          where: { clienteId: ag.clienteId }, orderBy: { numero: 'desc' }, select: { numero: true },
        });
        const proximoNumero = (ultima?.numero || 0) + 1;

        resultado = await prisma.$transaction(async (tx) => {
          await lockClienteAdvisory(tx, ag.clienteId);

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
              clienteId: ag.clienteId, numero: proximoNumero, leadId: ag.leadId || null,
              sessaoCaixaId: sessao.id, valor, metodoPagamento, descricao,
              status: 'COMPLETED', agendamentoId: ag.id,
            },
          });

          if (valor > 0) {
            await tx.lancamentoFinanceiro.create({
              data: {
                clienteId: ag.clienteId, leadId: ag.leadId || null, vendaId: venda.id,
                sessaoCaixaId: sessao.id, descricao: `Receita Venda #${venda.numero}: ${descricao}`,
                valor, tipo: 'RECEITA', status: 'PAGO',
                dataVencimento: new Date(), dataPagamento: new Date(),
              },
            });
          }

          const agAtualizado = await tx.agendamento.update({
            where: { id: ag.id }, data: { status: 'COMPLETED' },
          });
          return { venda, agendamento: agAtualizado, uso, comissao };
        });
        break;
      } catch (err) {
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
    console.error('[agenda/concluir]', erro);
    res.status(500).json({ erro: 'Erro ao concluir o atendimento.' });
  }
});

module.exports = roteador;
