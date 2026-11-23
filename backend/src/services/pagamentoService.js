// Nucleo de criacao de cobranca — extraido de pagamentos.routes.js pra ser
// reusado pela ferramenta GERAR_COBRANCA_PIX do bot (mesma logica, sem
// duplicar a parte que fala com o PSP).
//
// Modo e ambiente do PSP do tenant (fase 2):
//   - modo 'live' (bate no PSP de verdade) quando PAGAMENTO_LIVE=true; sem
//     isso fica 'fixture' (monta o request mas devolve dado de teste) — o
//     padrao em dev e nos testes;
//   - ambiente (producao x sandbox) vem da credencial (`dados.ambiente`, que a
//     subconta aberta pela plataforma ja grava) e, sem isso, de
//     PAGAMENTO_AMBIENTE_PADRAO; sem nenhum dos dois, live = producao e
//     fixture = homologacao.

const prisma = require('../prisma');
const { carregarCredencialDecifrada } = require('../credenciais');
const { criarProvedor } = require('../adapters/pagamento');

/** 'live' so com PAGAMENTO_LIVE=true; qualquer outra coisa = 'fixture'. */
function modoPagamento(env = process.env) {
  return String(env.PAGAMENTO_LIVE || '').trim().toLowerCase() === 'true' ? 'live' : 'fixture';
}

/** Traduz os nomes aceitos pro vocabulario dos adapters: 'producao' | 'homologacao'. */
function normalizarAmbiente(valor) {
  const v = String(valor || '').trim().toLowerCase();
  if (['producao', 'produção', 'production', 'prod'].includes(v)) return 'producao';
  if (['sandbox', 'homologacao', 'homologação', 'teste', 'test', 'dev'].includes(v)) return 'homologacao';
  return null;
}

/** Ambiente efetivo: credencial > PAGAMENTO_AMBIENTE_PADRAO > padrao do modo. */
function ambienteDaCredencial(credencial, env = process.env) {
  return normalizarAmbiente(credencial?.dados?.ambiente)
    || normalizarAmbiente(env.PAGAMENTO_AMBIENTE_PADRAO)
    || (modoPagamento(env) === 'live' ? 'producao' : 'homologacao');
}

/** Opcoes pro criarProvedor a partir da credencial decifrada. */
function opcoesDoProvedor(credencial, env = process.env) {
  return { credencial, modo: modoPagamento(env), ambiente: ambienteDaCredencial(credencial, env) };
}

/**
 * Monta o provedor do tenant a partir da config + credencial cifrada do cofre.
 * Lanca (com .status) se o tenant nao tem pagamento configurado/ativo — quem
 * chama decide como comunicar isso (HTTP 400 na rota; mensagem de erro pra
 * ferramenta devolver a IA, no caso do bot).
 */
async function provedorDoTenant(clienteId) {
  const config = await prisma.configuracaoPagamento.findUnique({ where: { clienteId } });
  if (!config || !config.ativo) {
    throw Object.assign(new Error('Pagamento nao configurado ou inativo para este tenant.'), { status: 400, codigo: 'PAGAMENTO_NAO_CONFIGURADO' });
  }
  const credencial = await carregarCredencialDecifrada({ credencialId: config.credencialId, clienteId });
  const opcoes = opcoesDoProvedor(credencial);
  // Em modo live, sem chave nao ha como cobrar: falha clara em vez de um 401
  // do PSP la na frente.
  if (opcoes.modo === 'live' && !credencial) {
    throw Object.assign(new Error('O provedor de pagamento esta sem chave de acesso. Conecte a conta de novo.'), { status: 400, codigo: 'PAGAMENTO_SEM_CHAVE' });
  }
  const psp = criarProvedor(config.provedor, opcoes);
  return { config, psp };
}

/**
 * Cria uma Cobranca (Pix ou link) via o adapter do PSP do tenant e persiste.
 * Mesma sequencia da rota POST /pagamentos/cobrancas: cria PENDENTE primeiro
 * (o id dela vira a refExterna que liga de volta), chama o PSP, atualiza com
 * o resultado; se o PSP falhar, cancela a Cobranca em vez de deixar lixo
 * PENDENTE sem QR/link nenhum.
 *
 * @param {{clienteId:string, origem:string, refId?:string|null, valor:number,
 *   metodo?:'PIX'|'LINK', descricao?:string, vencimento?:string,
 *   pagador?:Object, itensPendentes?:Array}} p
 * `itensPendentes` (opcional): carrinho que a ferramenta do bot quer
 * confirmar como Venda quando o Pix for pago — ver services/cobrancaPagamento.js.
 * `pagador` (opcional): { nome?, email?, telefone?, cpfCnpj? } — o Asaas exige
 * CPF/CNPJ de quem paga em modo live.
 */
async function criarCobranca({ clienteId, origem = 'AVULSA', refId = null, valor, metodo = 'PIX', descricao, vencimento, pagador, itensPendentes }) {
  const { config, psp } = await provedorDoTenant(clienteId);

  const cobranca = await prisma.cobranca.create({
    data: {
      clienteId, origem, refId, valor, metodo, status: 'PENDENTE', provedor: config.provedor,
      vencimento: vencimento ? new Date(vencimento) : null,
      itensPendentes: itensPendentes || undefined,
    },
  });

  let dto;
  try {
    const params = {
      valor, descricao: descricao || `Cobranca ${cobranca.id}`, refExterna: cobranca.id, vencimento, pagador,
    };
    dto = metodo === 'PIX' ? await psp.criarCobrancaPix(params) : await psp.criarLink(params);
  } catch (errPsp) {
    await prisma.cobranca.update({ where: { id: cobranca.id }, data: { status: 'CANCELADO' } });
    throw errPsp;
  }

  const atualizada = await prisma.cobranca.update({
    where: { id: cobranca.id },
    data: {
      provedorCobrancaId: dto.provedorCobrancaId,
      status: dto.status || 'PENDENTE',
      qrCode: dto.qrCode || null,
      linkUrl: dto.linkUrl || null,
      vencimento: dto.vencimento ? new Date(dto.vencimento) : (vencimento ? new Date(vencimento) : null),
    },
  });

  // qrCodeBase64 (imagem do QR) nao e persistido — so devolvido neste retorno.
  return { ...atualizada, qrCodeBase64: dto.qrCodeBase64 || null };
}

module.exports = {
  provedorDoTenant,
  criarCobranca,
  modoPagamento,
  normalizarAmbiente,
  ambienteDaCredencial,
  opcoesDoProvedor,
};
