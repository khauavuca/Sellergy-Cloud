// CRUD de Especialistas (recurso agendavel — perfil Servico).
// Especialista = quem executa servicos e pode ser agendado. Vinculo opcional
// 1:1 com um Usuario (login). Os servicos que executa sao M:N com Produto
// (EspecialistaServico). A jornada e um JSON (ver schema).
//
// Gateado por AGENDA (especialista so faz sentido em tenant de servico com agenda).
// Multi-tenant rigido: tudo filtra por clienteId.

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  ehAdmin,
  requerModuloLiberado,
  requerPermissao,
  requerPapelPrivilegiado,
} = require('../middlewares/permissoes.middleware');
const { garantirDentroDoLimite } = require('../planos/recursos');
const { lockClienteAdvisory } = require('../utils/locks');
const { validarJornada } = require('../agenda/utilAgenda');

const NOME_MAX = 120;

// Erro de limite do plano vira 403 com o codigo pro front oferecer upgrade.
function respostaLimite(res, erro) {
  if (erro?.codigo !== 'LIMITE_DO_PLANO') return false;
  res.status(403).json({ erro: erro.message, codigo: erro.codigo, limite: erro.limite, maximo: erro.maximo, planoSugerido: erro.planoSugerido });
  return true;
}

// Senha inicial do login do especialista: ALEATORIA (nada de "123456" fixo),
// mostrada uma unica vez pro dono na resposta; deveTrocarSenha forca a troca
// no primeiro acesso. 12 caracteres sem letras/numeros que confundem (0/O, 1/l).
const ALFABETO_SENHA = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function gerarSenhaInicial(tamanho = 12) {
  const bytes = crypto.randomBytes(tamanho);
  let s = '';
  for (let i = 0; i < tamanho; i++) s += ALFABETO_SENHA[bytes[i] % ALFABETO_SENHA.length];
  return s;
}

function lerNome(nome) {
  if (typeof nome !== 'string' || !nome.trim()) return { erro: 'Informe o nome.' };
  const t = nome.trim();
  if (t.length > NOME_MAX) return { erro: `O nome pode ter no máximo ${NOME_MAX} caracteres.` };
  return { valor: t };
}

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerModuloLiberado('AGENDA'));

function filtroTenant(req) {
  return ehAdmin(req.usuario) ? {} : { clienteId: req.usuario.clienteId };
}

// Valida que os produtos (servicos) pertencem ao tenant. Retorna os ids validos.
async function validarServicos(clienteId, servicosIds) {
  if (!Array.isArray(servicosIds) || servicosIds.length === 0) return [];
  const ids = servicosIds.filter((x) => typeof x === 'string');
  const produtos = await prisma.produto.findMany({
    where: { id: { in: ids }, clienteId },
    select: { id: true },
  });
  return produtos.map((p) => p.id);
}

// Valida o vinculo opcional com Usuario: precisa ser do tenant e nao estar
// vinculado a outro especialista. Retorna { erro } ou { usuarioId }.
async function validarUsuarioVinculo({ usuarioId, clienteId, especialistaIdAtual = null }) {
  if (!usuarioId) return { usuarioId: null };
  if (typeof usuarioId !== 'string') return { erro: 'Usuario invalido.' };
  const u = await prisma.usuario.findFirst({
    where: { id: usuarioId, clienteId },
    select: { id: true, especialista: { select: { id: true } } },
  });
  if (!u) return { erro: 'Usuario nao pertence ao tenant.' };
  if (u.especialista && u.especialista.id !== especialistaIdAtual) {
    return { erro: 'Esse usuario ja esta vinculado a outro especialista.' };
  }
  return { usuarioId: u.id };
}


// Regra de comissao (fase 2): percentuais de 0 a 100 e valor fixo >= 0.
// null/'' limpa o campo. Devolve { erro, campos } ou { data }.
function lerRegraComissao(body) {
  const data = {};
  const campos = [];
  const ler = (chave, max) => {
    if (body[chave] === undefined) return;
    if (body[chave] === null || body[chave] === '') { data[chave] = null; return; }
    const n = Number(body[chave]);
    if (!Number.isFinite(n) || n < 0 || (max != null && n > max)) { campos.push(chave); return; }
    data[chave] = Math.round(n * 100) / 100;
  };
  ler('comissaoServicoPct', 100);
  ler('comissaoProdutoPct', 100);
  ler('comissaoFixa', null);
  if (campos.length) return { erro: 'Comissão inválida: use percentuais de 0 a 100 e valor fixo a partir de zero.', campos };
  return { data };
}

function saida(esp) {
  return {
    ...esp,
    servicosIds: (esp.servicos || []).map((s) => s.produtoId),
    servicos: undefined,
  };
}

roteador.get('/', requerPermissao('AGENDA', 'visualizar'), async (req, res) => {
  try {
    const especialistas = await prisma.especialista.findMany({
      where: filtroTenant(req),
      include: {
        servicos: { select: { produtoId: true } },
        usuario: { select: { id: true, nome: true, email: true } },
      },
      orderBy: { nome: 'asc' },
    });
    const privilegiado = ehAdmin(req.usuario) || req.usuario.perfil === 'CLIENT' || req.usuario.perfil === 'ADMINISTRADOR';
    if (privilegiado) return res.json(especialistas.map(saida));
    // Equipe sem papel de gestao: so o basico das colegas (nome, ativo, servicos);
    // o proprio cadastro vem completo.
    res.json(especialistas.map((e) => {
      const s = saida(e);
      if (e.usuarioId === req.usuario.id) return s;
      return {
        id: s.id, clienteId: s.clienteId, nome: s.nome, ativo: s.ativo, jornada: s.jornada, servicosIds: s.servicosIds,
        usuarioId: s.usuarioId, usuario: e.usuario ? { id: e.usuario.id, nome: e.usuario.nome } : null,
      };
    }));
  } catch (erro) {
    console.error('[especialistas/list]', erro);
    res.status(500).json({ erro: 'Erro ao listar especialistas.' });
  }
});

roteador.post('/', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = ehAdmin(req.usuario) ? req.body?.clienteId : req.usuario.clienteId;
    if (!clienteId) return res.status(400).json({ erro: 'clienteId obrigatorio.' });

    const { ativo, usuarioId, jornada, servicosIds, acesso } = req.body || {};
    const nomeLido = lerNome(req.body?.nome);
    if (nomeLido.erro) return res.status(422).json({ erro: nomeLido.erro, campos: ['nome'] });
    const nome = nomeLido.valor;
    if (ativo !== undefined && typeof ativo !== 'boolean') return res.status(422).json({ erro: 'Valor inválido.', campos: ['ativo'] });
    const jornadaLida = validarJornada(jornada);
    if (!jornadaLida.ok) return res.status(422).json({ erro: jornadaLida.erro, campos: ['jornada'] });

    const regra = lerRegraComissao(req.body || {});
    if (regra.erro) return res.status(422).json({ erro: regra.erro, campos: regra.campos });

    const servicosValidos = await validarServicos(clienteId, servicosIds);

    // Validacoes de leitura ANTES da transacao.
    // (1) Criar login novo (acesso) OU (2) linkar usuario existente.
    let emailNovo = null;
    let vincExistente = null;
    if (acesso && typeof acesso === 'object' && acesso.email) {
      emailNovo = String(acesso.email).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNovo)) {
        return res.status(400).json({ erro: 'E-mail invalido.' });
      }
      const jaExiste = await prisma.usuario.findUnique({ where: { email: emailNovo }, select: { id: true } });
      if (jaExiste) return res.status(400).json({ erro: 'Este e-mail ja esta cadastrado.' });
    } else if (usuarioId) {
      vincExistente = await validarUsuarioVinculo({ usuarioId, clienteId });
      if (vincExistente.erro) return res.status(400).json({ erro: vincExistente.erro });
    }

    // Senha gerada fora da transacao (bcrypt e lento; nao segura a trava).
    const senhaInicial = emailNovo ? gerarSenhaInicial() : null;
    const senhaHasheada = senhaInicial ? await bcrypt.hash(senhaInicial, 12) : null;

    const especialista = await prisma.$transaction(async (tx) => {
      // Limite de profissionais ativos do plano, contado DENTRO da trava do
      // negocio: pedidos ao mesmo tempo nao passam do limite.
      await lockClienteAdvisory(tx, clienteId);
      if (ativo !== false) {
        await garantirDentroDoLimite({
          clienteId, limite: 'profissionais',
          usoAtual: await tx.especialista.count({ where: { clienteId, ativo: true } }),
        });
      }
      let usuarioIdFinal = vincExistente ? vincExistente.usuarioId : null;
      if (emailNovo) {
        // AGENDA sempre garantida no escopo proprio. O dono libera outros
        // modulos depois, na tela de Equipe.
        const novoUsuario = await tx.usuario.create({
          data: {
            nome: nome.trim(),
            email: emailNovo,
            senha: senhaHasheada,
            perfil: 'VENDEDOR',
            clienteId,
            deveTrocarSenha: true,
            permissoes: {
              AGENDA: { visualizar: true, criar: false, editar: false, excluir: false, escopo: 'PROPRIAS' },
            },
          },
          select: { id: true },
        });
        usuarioIdFinal = novoUsuario.id;
      }
      return tx.especialista.create({
        data: {
          clienteId,
          nome: nome.trim(),
          ativo: ativo === false ? false : true,
          usuarioId: usuarioIdFinal,
          jornada: jornadaLida.valor,
          ...regra.data,
          servicos: { create: servicosValidos.map((produtoId) => ({ produtoId })) },
        },
        include: { servicos: { select: { produtoId: true } } },
      });
    }, { timeout: 15000 });
    // A senha inicial so aparece aqui, uma vez, pro dono repassar.
    res.status(201).json({ ...saida(especialista), ...(senhaInicial ? { senhaInicial, deveTrocarSenha: true } : {}) });
  } catch (erro) {
    if (respostaLimite(res, erro)) return;
    console.error('[especialistas/create]', erro);
    if (erro.code === 'P2002') return res.status(400).json({ erro: 'E-mail ja cadastrado.' });
    res.status(500).json({ erro: 'Erro ao criar especialista.' });
  }
});

roteador.put('/:id', requerPapelPrivilegiado, async (req, res) => {
  try {
    const existente = await prisma.especialista.findFirst({
      where: { id: req.params.id, ...filtroTenant(req) },
      select: { id: true, clienteId: true },
    });
    if (!existente) return res.status(404).json({ erro: 'Especialista nao encontrado.' });

    const { nome, ativo, usuarioId, jornada, servicosIds } = req.body || {};
    const data = {};
    if (nome !== undefined) {
      const lido = lerNome(nome);
      if (lido.erro) return res.status(422).json({ erro: lido.erro, campos: ['nome'] });
      data.nome = lido.valor;
    }
    if (ativo !== undefined) {
      if (typeof ativo !== 'boolean') return res.status(422).json({ erro: 'Valor inválido.', campos: ['ativo'] });
      data.ativo = ativo;
    }
    if (jornada !== undefined) {
      const j = validarJornada(jornada);
      if (!j.ok) return res.status(422).json({ erro: j.erro, campos: ['jornada'] });
      data.jornada = j.valor;
    }
    const regra = lerRegraComissao(req.body || {});
    if (regra.erro) return res.status(422).json({ erro: regra.erro, campos: regra.campos });
    Object.assign(data, regra.data);
    if (usuarioId !== undefined) {
      const vinc = await validarUsuarioVinculo({
        usuarioId, clienteId: existente.clienteId, especialistaIdAtual: existente.id,
      });
      if (vinc.erro) return res.status(400).json({ erro: vinc.erro });
      data.usuarioId = vinc.usuarioId;
    }

    // Se servicosIds veio, substitui o conjunto inteiro (deleteMany + createMany).
    if (servicosIds !== undefined) {
      const validos = await validarServicos(existente.clienteId, servicosIds);
      await prisma.$transaction([
        prisma.especialistaServico.deleteMany({ where: { especialistaId: existente.id } }),
        ...(validos.length
          ? [prisma.especialistaServico.createMany({
              data: validos.map((produtoId) => ({ especialistaId: existente.id, produtoId })),
            })]
          : []),
      ]);
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      // Reativar conta no limite do plano (senao reativar burlaria o limite);
      // contado dentro da trava do negocio.
      await lockClienteAdvisory(tx, existente.clienteId);
      if (data.ativo === true) {
        const atual = await tx.especialista.findUnique({ where: { id: existente.id }, select: { ativo: true } });
        if (!atual?.ativo) {
          await garantirDentroDoLimite({
            clienteId: existente.clienteId, limite: 'profissionais',
            usoAtual: await tx.especialista.count({ where: { clienteId: existente.clienteId, ativo: true } }),
          });
        }
      }
      return tx.especialista.update({
        where: { id: existente.id },
        data,
        include: { servicos: { select: { produtoId: true } } },
      });
    }, { timeout: 15000 });
    res.json(saida(atualizado));
  } catch (erro) {
    if (respostaLimite(res, erro)) return;
    console.error('[especialistas/update]', erro);
    res.status(500).json({ erro: 'Erro ao atualizar especialista.' });
  }
});

roteador.delete('/:id', requerPapelPrivilegiado, async (req, res) => {
  try {
    const existente = await prisma.especialista.findFirst({
      where: { id: req.params.id, ...filtroTenant(req) },
      select: { id: true },
    });
    if (!existente) return res.status(404).json({ erro: 'Especialista nao encontrado.' });
    // Horarios futuros ficariam "sem profissional" (FK SetNull) e passariam a
    // disputar a agenda da loja: avisa e so exclui com ?confirmar=1.
    const futuros = await prisma.agendamento.count({
      where: { especialistaId: existente.id, data: { gte: new Date() }, status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    if (futuros > 0 && req.query.confirmar !== '1') {
      return res.status(409).json({
        erro: `Essa profissional tem ${futuros} horário(s) marcado(s). Passe esses horários para outra pessoa ou desative o cadastro em vez de excluir.`,
        codigo: 'CONFIRMAR_EXCLUSAO', agendamentosFuturos: futuros,
      });
    }
    // Agendamentos do especialista sobrevivem (FK SetNull); vinculos M:N caem (Cascade).
    const r = await prisma.especialista.deleteMany({ where: { id: existente.id } });
    if (!r.count) return res.status(404).json({ erro: 'Especialista nao encontrado.' });
    res.json({ ok: true });
  } catch (erro) {
    console.error('[especialistas/delete]', erro);
    res.status(500).json({ erro: 'Erro ao excluir especialista.' });
  }
});

module.exports = roteador;
