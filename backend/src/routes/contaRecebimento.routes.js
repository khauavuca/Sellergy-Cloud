// Conta de recebimento do tenant (subconta Asaas pela plataforma).
// Montado em /conta-recebimento (src/index.js). Frente B da fase 2.
//
//   GET  /conta-recebimento                  -> estado (abertura automatica ligada?, conta, pagamento atual)
//   GET  /conta-recebimento/cnpj/:cnpj       -> razao social e endereco pela Receita (BrasilAPI), pra preencher o passo 1
//   POST /conta-recebimento                  -> abre a subconta { negocio, responsavel, repasse } -> EM_ANALISE
//   POST /conta-recebimento/atualizar-status -> consulta o Asaas e aplica (+ documentos pendentes)
//   GET  /conta-recebimento/financeiro       -> saldo, a liberar, extrato (?offset), taxas
//   POST /conta-recebimento/saque            -> { valor } Pix pra chave cadastrada
//   PUT  /conta-recebimento/repasse          -> { prazo?, tipoChavePix?, chavePix?, senha?|codigo? } (trocar a chave pede senha ou 2 etapas)
//
// Dinheiro e dados do dono: modulo PAGAMENTOS + papel privilegiado (dono ou
// administrador), igual a /pagamentos. A apiKey da subconta nunca sai daqui.

const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  requerTenant, requerModuloLiberado, requerPapelPrivilegiado,
} = require('../middlewares/permissoes.middleware');
const { fetchComRetentativa } = require('../utils/httpSeguro');
const { validarCnpj } = require('../utils/validacaoFiscal');
const asaas = require('../pagamentos/subcontaAsaas');
const conta = require('../pagamentos/contaRecebimento');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerTenant);
roteador.use((req, res, next) => (req.usuario?.clienteId ? next() : res.status(403).json({ erro: 'Acesso negado: usuario sem tenant.' })));
roteador.use(requerModuloLiberado('PAGAMENTOS'));
roteador.use(requerPapelPrivilegiado);

// Saque e abertura: poucas tentativas por janela (anti-abuso/duplo clique).
const limitadorDinheiro = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `conta-rec:${req.usuario?.clienteId || req.ip}`,
  message: { erro: 'Muitas tentativas seguidas. Espere alguns minutos.' },
});

function responderErro(res, e, contexto) {
  if (e instanceof asaas.ErroSubconta) {
    return res.status(e.status).json({ erro: e.message, codigo: e.codigo, campos: e.campos });
  }
  console.error(`[conta-recebimento/${contexto}]`, e);
  return res.status(500).json({ erro: 'Erro ao falar com a conta de recebimento. Tente de novo.' });
}

function contaPublica(c) {
  if (!c) return null;
  return {
    status: c.status,
    abrindo: c.motivoRecusa === 'ABRINDO',
    motivoRecusa: c.motivoRecusa === 'ABRINDO' ? null : c.motivoRecusa,
    prazoRepasse: c.prazoRepasse,
    dados: asaas.dadosPublicos(c.dados),
    enviadoEm: c.dados?.enviadoEm || null,
    criadoEm: c.criadoEm,
    atualizadoEm: c.atualizadoEm,
  };
}

roteador.get('/', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const [c, pagamento, cliente] = await Promise.all([
      conta.contaDoTenant(clienteId),
      prisma.configuracaoPagamento.findUnique({ where: { clienteId }, select: { provedor: true, ativo: true, credencialId: true } }),
      prisma.cliente.findUnique({ where: { id: clienteId }, select: { cpfCnpj: true, email: true, telefone: true, nome: true } }),
    ]);
    const credencialDaSubconta = c?.dados?.credencialId || null;
    res.json({
      automaticaDisponivel: asaas.ativa(),
      ambiente: asaas.ambiente(),
      conta: contaPublica(c),
      pagamento: pagamento
        ? { provedor: pagamento.provedor, ativo: pagamento.ativo, usaContaSellergy: Boolean(credencialDaSubconta) && pagamento.credencialId === credencialDaSubconta }
        : null,
      // Sugestoes pro passo 1 (o que o negocio ja cadastrou no Sellergy).
      sugestoes: { cnpj: cliente?.cpfCnpj && cliente.cpfCnpj.replace(/\D/g, '').length === 14 ? cliente.cpfCnpj.replace(/\D/g, '') : null, email: cliente?.email || null, telefone: cliente?.telefone || null, nome: cliente?.nome || null },
    });
  } catch (e) {
    responderErro(res, e, 'ler');
  }
});

// Consulta publica de CNPJ (dados da Receita). So preenche a tela; o que vale
// e o que o dono confirmar. Falhou -> 404 e ele digita.
roteador.get('/cnpj/:cnpj', async (req, res) => {
  try {
    const cnpj = String(req.params.cnpj || '').replace(/\D/g, '');
    if (!validarCnpj(cnpj)) return res.status(422).json({ erro: 'CNPJ inválido.', campos: ['negocio.cnpj'] });
    const resp = await fetchComRetentativa(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { 'User-Agent': 'sellergy-cloud' } }, { timeoutMs: 8000, tentativas: 1 })
      .catch(() => null);
    if (!resp || !resp.ok) return res.status(404).json({ erro: 'Não achamos esse CNPJ agora. Preencha os dados abaixo.' });
    const d = await resp.json().catch(() => null);
    if (!d) return res.status(404).json({ erro: 'Não achamos esse CNPJ agora. Preencha os dados abaixo.' });
    const natureza = String(d.natureza_juridica || '').toLowerCase();
    const tipoEmpresa = d.opcao_pelo_mei ? 'MEI'
      : natureza.includes('associa') ? 'ASSOCIATION'
        : natureza.includes('individual') ? 'INDIVIDUAL'
          : 'LIMITED';
    res.json({
      razaoSocial: d.razao_social || '',
      nomeFantasia: d.nome_fantasia || '',
      tipoEmpresa,
      cep: String(d.cep || '').replace(/\D/g, ''),
      endereco: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' ').trim(),
      numero: d.numero || '',
      complemento: d.complemento || '',
      bairro: d.bairro || '',
      situacao: d.descricao_situacao_cadastral || null,
    });
  } catch (e) {
    responderErro(res, e, 'cnpj');
  }
});

roteador.post('/', limitadorDinheiro, async (req, res) => {
  try {
    const c = await conta.abrir(req.usuario.clienteId, req.body || {});
    res.status(201).json({ conta: contaPublica(c) });
  } catch (e) {
    responderErro(res, e, 'abrir');
  }
});

roteador.post('/atualizar-status', async (req, res) => {
  try {
    const c = await conta.contaDoTenant(req.usuario.clienteId);
    if (!c || !c.contaExternaId) return res.status(404).json({ erro: 'Nenhuma conta de recebimento aberta.' });
    const atualizada = await conta.sincronizar(c);
    let documentos = [];
    if (atualizada.status !== 'ATIVA') documentos = await conta.documentos(atualizada).catch(() => []);
    res.json({ conta: contaPublica(atualizada), documentos });
  } catch (e) {
    responderErro(res, e, 'status');
  }
});

roteador.get('/financeiro', async (req, res) => {
  try {
    const c = await conta.contaDoTenant(req.usuario.clienteId);
    if (!c || c.status !== 'ATIVA') return res.status(409).json({ erro: 'A conta ainda não está liberada.', codigo: 'CONTA_NAO_ATIVA' });
    const offset = Math.max(0, Math.min(10000, parseInt(req.query.offset, 10) || 0));
    res.json(await conta.financeiro(c, { offset }));
  } catch (e) {
    responderErro(res, e, 'financeiro');
  }
});

roteador.post('/saque', limitadorDinheiro, async (req, res) => {
  try {
    const c = await conta.contaDoTenant(req.usuario.clienteId);
    if (!c) return res.status(404).json({ erro: 'Nenhuma conta de recebimento aberta.' });
    const r = await conta.sacar(c, req.body?.valor);
    console.log(`[conta-recebimento] saque de R$ ${r.valor} pedido por usuario=${req.usuario.id} cliente=${req.usuario.clienteId}`);
    res.status(201).json(r);
  } catch (e) {
    responderErro(res, e, 'saque');
  }
});

roteador.put('/repasse', limitadorDinheiro, async (req, res) => {
  try {
    const c = await conta.contaDoTenant(req.usuario.clienteId);
    if (!c || !c.contaExternaId) return res.status(404).json({ erro: 'Nenhuma conta de recebimento aberta.' });
    const { prazo, tipoChavePix, chavePix, senha, codigo } = req.body || {};
    // Trocar a chave Pix muda pra onde vai o dinheiro: confirma senha (ou o
    // codigo de 2 etapas, se ligado) de quem esta logado.
    if (conta.trocaChavePix(c, { tipoChavePix, chavePix })) {
      const usuario = await prisma.usuario.findUnique({
        where: { id: req.usuario.id },
        select: { id: true, senha: true, totpAtivo: true, totpSegredoCifrado: true },
      });
      await conta.confirmarIdentidade(usuario, { senha, codigo });
      console.log(`[conta-recebimento] chave Pix do repasse trocada por usuario=${req.usuario.id} cliente=${req.usuario.clienteId}`);
    }
    const atualizada = await conta.atualizarRepasse(c, { prazo, tipoChavePix, chavePix });
    res.json({ conta: contaPublica(atualizada) });
  } catch (e) {
    responderErro(res, e, 'repasse');
  }
});

module.exports = roteador;
