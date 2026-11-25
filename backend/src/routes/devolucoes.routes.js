// Devolucoes de itens alugados (produtos com temDevolucao=true). Cada linha
// nasce junto com a Venda (ver vendaService.criarVenda) e some da lista
// "pendente" quando o item volta fisicamente (concluir estorna estoque, mesma
// logica do cancelamento de venda).
const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  requerModuloLiberado,
  requerPermissao,
} = require('../middlewares/permissoes.middleware');
const { fecharLeadAutomatico } = require('../services/etapaLeadAuto');
const { lerInteiro } = require('../utils/numero');

const roteador = express.Router();
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
roteador.use(middlewareAutenticacao);
roteador.use(requerModuloLiberado('VENDAS'));

// ==========================================
// CONFIGURACAO — quantos dias antes da data o cron avisa (ver
// jobs/cronDevolucoes.js e Cliente.diasAvisoDevolucao). Registrado ANTES de
// '/:id/concluir' nao ser um problema aqui (paths distintos), mas mantido no
// topo por clareza.
// ==========================================
roteador.get('/config', requerPermissao('VENDAS', 'visualizar'), async (req, res) => {
  try {
    const { clienteId } = req.usuario;
    if (!clienteId) return res.status(403).json({ erro: 'Tenant indefinido.' });
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { diasAvisoDevolucao: true } });
    res.json({ diasAvisoDevolucao: cliente?.diasAvisoDevolucao ?? 1 });
  } catch (erro) {
    console.error('[devolucoes/config/get]', erro);
    res.status(500).json({ erro: 'Erro ao buscar configuração.' });
  }
});

roteador.put('/config', requerPermissao('VENDAS', 'editar'), async (req, res) => {
  try {
    const { clienteId } = req.usuario;
    if (!clienteId) return res.status(403).json({ erro: 'Tenant indefinido.' });
    const { diasAvisoDevolucao } = req.body || {};
    const lido = lerInteiro(diasAvisoDevolucao, { min: 0, max: 30 });
    const n = lido.ok ? lido.valor : NaN;
    if (!Number.isInteger(n)) {
      return res.status(422).json({ erro: 'diasAvisoDevolucao deve ser um inteiro entre 0 e 30.' });
    }
    const cliente = await prisma.cliente.update({
      where: { id: clienteId },
      data: { diasAvisoDevolucao: n },
      select: { diasAvisoDevolucao: true },
    });
    res.json(cliente);
  } catch (erro) {
    console.error('[devolucoes/config/put]', erro);
    res.status(500).json({ erro: 'Erro ao salvar configuração.' });
  }
});

const INCLUDE_PADRAO = {
  lead: { select: { id: true, nome: true, telefone: true, cpf: true } },
  variacao: { select: { id: true, nome: true, produto: { select: { nome: true, tipo: true } } } },
  venda: { select: { id: true, numero: true } },
};

// GET /devolucoes?status=pendente|atrasada|concluida (default: pendente)
// 'pendente' = tudo ainda nao devolvido; 'atrasada' e o mesmo filtro + data
// de devolucao ja passou — recorte feito no servidor pra nao trazer tudo e
// filtrar no cliente a toa.
roteador.get('/', requerPermissao('VENDAS', 'visualizar'), async (req, res) => {
  try {
    const { clienteId } = req.usuario;
    if (!clienteId) return res.status(403).json({ erro: 'Tenant indefinido.' });

    const { status } = req.query;
    const onde = { clienteId };
    if (status === 'concluida') {
      onde.devolvidoEm = { not: null };
    } else if (status === 'cancelada') {
      onde.canceladaEm = { not: null };
    } else {
      // Pendente = ainda fora e de venda que vale (venda cancelada encerra).
      onde.devolvidoEm = null;
      onde.canceladaEm = null;
      onde.venda = { status: { not: 'CANCELLED' } };
      if (status === 'atrasada') onde.dataDevolucao = { lt: new Date() };
    }

    const devolucoes = await prisma.devolucao.findMany({
      where: onde,
      include: INCLUDE_PADRAO,
      orderBy: { dataDevolucao: 'asc' },
    });
    res.json(devolucoes);
  } catch (erro) {
    console.error('[devolucoes/listar]', erro);
    res.status(500).json({ erro: 'Erro ao listar devoluções.' });
  }
});

// PATCH /devolucoes/:id/concluir — marca como devolvida. Se o produto for
// FISICO, estorna o estoque (MovimentacaoEstoque tipo DEVOLUCAO).
// Clique duplo/pedidos paralelos: a marcacao e um UPDATE condicional
// (devolvidoEm e canceladaEm nulos) dentro da transacao — so um passa e
// devolve o estoque; os outros recebem "ja concluida". Devolucao de venda
// cancelada nao conclui (o cancelamento ja devolveu o estoque): 409.
roteador.patch('/:id/concluir', requerPermissao('VENDAS', 'editar'), async (req, res) => {
  try {
    const { clienteId } = req.usuario;
    if (!clienteId) return res.status(403).json({ erro: 'Tenant indefinido.' });
    const { id } = req.params;
    if (!RE_UUID.test(String(id))) return res.status(404).json({ erro: 'Devolução não encontrada.' });

    const agora = new Date();
    const resultado = await prisma.$transaction(async (tx) => {
      const devolucao = await tx.devolucao.findFirst({
        where: { id, clienteId },
        include: { variacao: { include: { produto: true } }, venda: { select: { numero: true, status: true } } },
      });
      if (!devolucao) return { status: 404, corpo: { erro: 'Devolução não encontrada.' } };
      if (devolucao.canceladaEm || devolucao.venda?.status === 'CANCELLED') {
        return { status: 409, corpo: { erro: 'A venda deste aluguel foi cancelada; o estoque já voltou no cancelamento.', codigo: 'VENDA_CANCELADA' } };
      }

      const marcou = await tx.devolucao.updateMany({
        where: { id, clienteId, devolvidoEm: null, canceladaEm: null },
        data: { devolvidoEm: agora },
      });
      if (marcou.count === 0) {
        const atual = await tx.devolucao.findFirst({ where: { id, clienteId } });
        if (atual?.canceladaEm) {
          return { status: 409, corpo: { erro: 'A venda deste aluguel foi cancelada; o estoque já voltou no cancelamento.', codigo: 'VENDA_CANCELADA' } };
        }
        return { status: 200, corpo: { ok: true, jaConcluida: true, devolucao: atual } };
      }

      // Confere a venda de novo com a linha travada: cancelamento em curso
      // espera esta transacao e depois nao devolve de novo (saldo liquido).
      const venda = await tx.venda.findFirst({ where: { id: devolucao.vendaId, clienteId }, select: { status: true } });
      if (!venda || venda.status === 'CANCELLED') {
        throw Object.assign(new Error('venda cancelada'), { cancelada: true });
      }

      if (devolucao.variacao.produto.tipo === 'FISICO') {
        await tx.movimentacaoEstoque.create({
          data: {
            variacaoId: devolucao.variacaoId,
            tipo: 'DEVOLUCAO',
            quantidade: devolucao.quantidade,
            motivo: `Devolução do aluguel — Venda #${devolucao.venda.numero}`,
            vendaId: devolucao.vendaId,
          },
        });
        await tx.variacaoProduto.update({
          where: { id: devolucao.variacaoId },
          data: { estoqueAtual: { increment: devolucao.quantidade } },
        });
      }

      // Devolucao concluida fecha o lead de novo — pode ter sido reaberto
      // pelo aviso de devolucao proxima (cronDevolucoes.js).
      if (devolucao.leadId) {
        await fecharLeadAutomatico(tx, {
          clienteId,
          leadId: devolucao.leadId,
          motivo: `Fechado automaticamente: devolução da venda #${devolucao.venda.numero} concluída.`,
        });
      }

      const d = await tx.devolucao.findFirst({ where: { id, clienteId } });
      return { status: 200, corpo: { ok: true, devolucao: d } };
    });

    res.status(resultado.status).json(resultado.corpo);
  } catch (erro) {
    if (erro?.cancelada) {
      return res.status(409).json({ erro: 'A venda deste aluguel foi cancelada; o estoque já voltou no cancelamento.', codigo: 'VENDA_CANCELADA' });
    }
    console.error('[devolucoes/concluir]', erro);
    res.status(500).json({ erro: 'Erro ao concluir devolução.' });
  }
});

module.exports = roteador;
