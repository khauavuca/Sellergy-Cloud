// Resumo do dia pro celular da dona (3 numeros, agenda, avisos) e "Cobrar rapido".
// Montado em /hoje (src/index.js). Frente C da fase 2.
//
//   GET  /hoje                 -> vendeu hoje, a receber, saldo do caixa, horarios e avisos
//   POST /hoje/cobrar          -> { centavos, descricao? } gera Pix avulso (criarCobranca)
//   GET  /hoje/cobrancas/:id   -> status do Pix (a tela consulta a cada poucos segundos)
//
// So dona/ADMINISTRADOR: a tela mostra dinheiro do negocio.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerTenant, requerPapelPrivilegiado, requerModuloLiberado } = require('../middlewares/permissoes.middleware');
const { helpers: caixa } = require('../controllers/CaixaController');
const { criarCobranca } = require('../services/pagamentoService');
const { intervaloDoDia, valorDosCentavos, ROTULO_STATUS_AGENDA, arred } = require('../hoje/regras');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerTenant);
roteador.use(requerPapelPrivilegiado);
roteador.use((req, res, next) => (req.usuario.clienteId ? next() : res.status(403).json({ erro: 'Entre com a conta do negócio.' })));

roteador.get('/', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const agora = new Date();
    const { inicio, fim } = intervaloDoDia(agora);

    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { modulosLiberados: true } });
    const modulos = cliente?.modulosLiberados || {};

    const [vendas, aReceber, sessao, agendamentos, avisos, configPagamento] = await Promise.all([
      prisma.venda.aggregate({
        where: { clienteId, status: 'COMPLETED', data: { gte: inicio, lt: fim } },
        _sum: { valor: true }, _count: true,
      }),
      prisma.cobranca.aggregate({
        where: { clienteId, status: 'PENDENTE', OR: [{ vencimento: null }, { vencimento: { gte: agora } }] },
        _sum: { valor: true }, _count: true,
      }),
      caixa.buscarSessaoAberta(clienteId),
      modulos.AGENDA === true
        ? prisma.agendamento.findMany({
          where: { clienteId, data: { gte: inicio, lt: fim }, status: { not: 'CANCELED' } },
          select: {
            id: true, data: true, nomeCliente: true, servico: true, status: true, duracao: true,
            especialista: { select: { nome: true } },
          },
          orderBy: { data: 'asc' },
          take: 60,
        })
        : Promise.resolve(null),
      prisma.notificacao.findMany({
        where: { clienteId, OR: [{ usuarioId: req.usuario.id }, { usuarioId: null }] },
        select: { id: true, titulo: true, mensagem: true, link: true, lida: true, criadoEm: true },
        orderBy: { criadoEm: 'desc' },
        take: 6,
      }),
      prisma.configuracaoPagamento.findUnique({ where: { clienteId }, select: { ativo: true } }),
    ]);

    const saldo = sessao ? await caixa.calcularSaldoEsperado(sessao.id) : null;

    res.json({
      data: inicio,
      vendeu: { valor: arred(vendas._sum.valor), quantidade: vendas._count },
      aReceber: { valor: arred(aReceber._sum.valor), quantidade: aReceber._count },
      caixa: sessao ? { aberto: true, saldo: arred(saldo), abertoEm: sessao.abertaEm } : { aberto: false, saldo: null },
      agenda: agendamentos === null ? null : {
        total: agendamentos.length,
        horarios: agendamentos.map((a) => ({
            id: a.id,
            inicio: a.data,
            cliente: a.nomeCliente,
            servico: a.servico,
            profissional: a.especialista?.nome || null,
            status: a.status,
            rotuloStatus: ROTULO_STATUS_AGENDA[a.status] || a.status,
            passou: new Date(a.data).getTime() < agora.getTime(),
        })),
      },
      avisos,
      pagamentoConfigurado: Boolean(configPagamento?.ativo) && modulos.PAGAMENTOS === true,
    });
  } catch (e) {
    console.error('[hoje/resumo]', e);
    res.status(500).json({ erro: 'Não foi possível carregar o resumo de hoje.' });
  }
});

const CAMPOS_PIX = { id: true, valor: true, status: true, qrCode: true, pagoEm: true, criadoEm: true, vencimento: true };

roteador.post('/cobrar', requerModuloLiberado('PAGAMENTOS'), async (req, res) => {
  try {
    const { valor, erro } = valorDosCentavos(req.body?.centavos);
    if (erro) return res.status(422).json({ erro, campos: ['centavos'] });
    const descricao = typeof req.body?.descricao === 'string' && req.body.descricao.trim()
      ? req.body.descricao.trim().slice(0, 80)
      : 'Cobrança rápida';
    const cobranca = await criarCobranca({ clienteId: req.usuario.clienteId, origem: 'AVULSA', refId: 'COBRANCA_RAPIDA', valor, metodo: 'PIX', descricao });
    const resposta = Object.fromEntries(Object.keys(CAMPOS_PIX).map((k) => [k, cobranca[k] ?? null]));
    return res.status(201).json({ ...resposta, qrCodeBase64: cobranca.qrCodeBase64 || null });
  } catch (e) {
    if (e.status === 400 && /nao configurado|inativo/i.test(e.message)) {
      return res.status(400).json({ erro: 'Configure o recebimento por Pix antes de cobrar.', codigo: 'PAGAMENTO_NAO_CONFIGURADO' });
    }
    if (e.status) return res.status(e.status >= 500 ? 502 : e.status).json({ erro: 'O provedor de pagamento não respondeu. Tente de novo.' });
    console.error('[hoje/cobrar]', e);
    return res.status(500).json({ erro: 'Não foi possível gerar o Pix.' });
  }
});

roteador.get('/cobrancas/:id', async (req, res) => {
  try {
    const cobranca = await prisma.cobranca.findFirst({
      where: { id: req.params.id, clienteId: req.usuario.clienteId, origem: 'AVULSA' },
      select: CAMPOS_PIX,
    });
    if (!cobranca) return res.status(404).json({ erro: 'Cobrança não encontrada.' });
    return res.json(cobranca);
  } catch (e) {
    console.error('[hoje/cobranca]', e);
    return res.status(500).json({ erro: 'Não foi possível consultar o Pix.' });
  }
});

module.exports = roteador;
