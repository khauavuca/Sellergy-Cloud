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
const { resolverPagador, exigeCpfCnpj, cpfCnpjValido } = require('./pagadorCobranca');

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

/**
 * Webhook de pagamento com o PSP em modo fixture/simulado: a "consulta" do
 * adapter devolve PAGO pra qualquer id, entao aplicar o evento deixaria
 * qualquer POST (a API local fica exposta por tunel) marcar cobranca como paga.
 * Por isso o webhook so aplica status em modo 'live' — a nao ser que o dev
 * ligue explicitamente PAGAMENTO_WEBHOOK_SIMULADO=1 (nunca vale em producao).
 * @returns {boolean} true = pode aplicar o status consultado
 */
function webhookPodeAplicar(modo, env = process.env) {
  if (modo === 'live') return true;
  if (env.NODE_ENV === 'production') return false;
  return String(env.PAGAMENTO_WEBHOOK_SIMULADO || '').trim() === '1';
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
 * CPF/CNPJ de quem paga (ver services/pagadorCobranca.js).
 * `leadId` (opcional): cliente final; completa o pagador com nome/telefone/CPF
 * do lead e, se o CPF veio digitado e o lead nao tinha, grava no lead.
 */
async function criarCobranca({ clienteId, origem = 'AVULSA', refId = null, valor, metodo = 'PIX', descricao, vencimento, pagador, leadId = null, itensPendentes }) {
  const { config, psp } = await provedorDoTenant(clienteId);

  // CPF/CNPJ resolvido ANTES de criar a Cobranca: faltando (Asaas), a tela ou
  // o bot pedem o dado sem deixar uma cobranca CANCELADO de lixo pra tras.
  const lead = leadId
    ? await prisma.lead.findFirst({ where: { id: leadId, clienteId }, select: { id: true, nome: true, telefone: true, email: true, cpf: true } })
    : null;
  const { pagador: pagadorFinal, cpfNovoDoLead } = resolverPagador({ provedor: config.provedor, pagador, lead });
  if (cpfNovoDoLead) {
    await prisma.lead.update({ where: { id: lead.id }, data: { cpf: cpfNovoDoLead } })
      .catch((e) => console.error('[pagamento] falha ao gravar CPF no lead', e?.message));
  }

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
      valor, descricao: descricao || `Cobranca ${cobranca.id}`, refExterna: cobranca.id, vencimento, pagador: pagadorFinal,
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

/**
 * Provedor ativo do tenant e se ele pede CPF/CNPJ de quem paga — pra tela
 * saber se mostra o campo. null quando nao ha pagamento ativo.
 */
async function provedorAtivo(clienteId) {
  const config = await prisma.configuracaoPagamento.findUnique({ where: { clienteId }, select: { provedor: true, ativo: true } });
  if (!config?.ativo) return null;
  return { provedor: config.provedor, exigeCpfCnpj: exigeCpfCnpj(config.provedor) };
}

/**
 * Lead do tenant pelo telefone (compara os ultimos 10 digitos, com ou sem 55),
 * preferindo o que ja tem CPF valido. Usado pra achar o CPF de quem paga o
 * sinal quando o agendamento nao veio ligado a um lead.
 * @returns {Promise<{id:string, cpf:string|null}|null>}
 */
async function leadPorTelefone(clienteId, telefone) {
  const tel = String(telefone || '').replace(/\D/g, '');
  if (tel.length < 10) return null;
  const candidatos = await prisma.lead.findMany({
    // ultimos 4 digitos aparecem juntos mesmo em telefone gravado com mascara;
    // a comparacao exata (ultimos 10) e feita abaixo.
    where: { clienteId, telefone: { contains: tel.slice(-4) } },
    select: { id: true, telefone: true, cpf: true },
    take: 50,
  });
  const mesmos = candidatos.filter((l) => String(l.telefone || '').replace(/\D/g, '').endsWith(tel.slice(-10)));
  const escolhido = mesmos.find((l) => cpfCnpjValido(l.cpf)) || mesmos[0];
  return escolhido ? { id: escolhido.id, cpf: escolhido.cpf || null } : null;
}

module.exports = {
  provedorDoTenant,
  provedorAtivo,
  leadPorTelefone,
  criarCobranca,
  modoPagamento,
  normalizarAmbiente,
  ambienteDaCredencial,
  opcoesDoProvedor,
  webhookPodeAplicar,
};
