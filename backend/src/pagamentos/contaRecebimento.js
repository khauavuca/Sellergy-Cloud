// =====================================================================
// CONTA DE RECEBIMENTO — orquestra subconta Asaas + cofre + banco.
// =====================================================================
// abrir():   valida os 3 passos -> grava RASCUNHO -> POST /accounts (conta da
//            plataforma) -> apiKey cifrada no cofre do tenant (ASAAS_KEY com
//            ambiente e segredo do webhook) -> EM_ANALISE. Se o tenant ainda
//            nao recebe por nenhum provedor, ja aponta o ConfiguracaoPagamento
//            pra subconta; se ja recebe (Mercado Pago/Asaas proprio), troca so
//            quando a conta ficar ATIVA.
// sincronizar(): GET /myAccount/status com a chave da subconta (fonte da
//            verdade, usada pelo botao e pelo webhook de conta).
// =====================================================================

const crypto = require('crypto');
const prisma = require('../prisma');
const { cifrarPayload } = require('../cripto/cofreCredenciais');
const { carregarCredencialDecifrada } = require('../credenciais');
const { criarNotificacaoTenant } = require('../utils/notificacoes');
const { avisarNoWhatsapp } = require('../assinatura/avisos');
const asaas = require('./subcontaAsaas');

const NOME_CREDENCIAL = 'Conta de recebimento Sellergy (Asaas)';
const ABRINDO = 'ABRINDO';

async function contaDoTenant(clienteId) {
  return prisma.contaRecebimento.findUnique({ where: { clienteId } });
}

/** apiKey da subconta, decifrada na hora (nunca sai daqui). */
async function chaveDaSubconta(conta) {
  const credencialId = conta?.dados?.credencialId;
  if (!credencialId) throw new asaas.ErroSubconta('Conta de recebimento sem chave. Fale com o suporte.', 409, { codigo: 'SEM_CHAVE' });
  const cred = await carregarCredencialDecifrada({ credencialId, clienteId: conta.clienteId });
  if (!cred?.dados?.apiKey) throw new asaas.ErroSubconta('Conta de recebimento sem chave. Fale com o suporte.', 409, { codigo: 'SEM_CHAVE' });
  return cred.dados.apiKey;
}

async function apontarPagamentoPraSubconta(clienteId, credencialId) {
  await prisma.configuracaoPagamento.upsert({
    where: { clienteId },
    create: { clienteId, provedor: 'ASAAS', credencialId, ativo: true },
    update: { provedor: 'ASAAS', credencialId, ativo: true },
  });
}

async function avisar(clienteId, titulo, mensagem) {
  await criarNotificacaoTenant(prisma, { clienteId, tipo: 'GENERICA', titulo, mensagem, link: '/app/recebimentos' })
    .catch((e) => console.error('[conta-recebimento] notificacao', e?.message));
  await avisarNoWhatsapp(clienteId, `*${titulo}*\n${mensagem}`).catch(() => {});
}

/**
 * Abre a subconta. Devolve a ContaRecebimento atualizada.
 * @param {string} clienteId
 * @param {Object} entrada  { negocio, responsavel, repasse }
 */
async function abrir(clienteId, entrada) {
  if (!asaas.ativa()) {
    throw new asaas.ErroSubconta('A abertura automática de conta está desligada.', 503, { codigo: 'SUBCONTA_DESLIGADA' });
  }
  const dados = asaas.validarDadosSubconta(entrada);

  const existente = await contaDoTenant(clienteId);
  if (existente && existente.status !== 'RASCUNHO') {
    throw new asaas.ErroSubconta('Este negócio já tem uma conta de recebimento.', 409, { codigo: 'JA_EXISTE' });
  }

  // Rascunho primeiro (se o Asaas recusar, o que foi digitado fica salvo) e
  // trava de "abrindo" atomica: duplo clique ou duas abas, so um passa.
  const dadosSemSegredo = { negocio: dados.negocio, responsavel: dados.responsavel, repasse: dados.repasse };
  let conta;
  if (!existente) {
    try {
      conta = await prisma.contaRecebimento.create({
        data: { clienteId, provedor: 'ASAAS', status: 'RASCUNHO', dados: dadosSemSegredo, prazoRepasse: dados.repasse.prazo, motivoRecusa: ABRINDO },
      });
    } catch (e) {
      if (e?.code === 'P2002') throw new asaas.ErroSubconta('A abertura já está em andamento.', 409, { codigo: 'EM_ANDAMENTO' });
      throw e;
    }
  } else {
    const trava = await prisma.contaRecebimento.updateMany({
      where: {
        id: existente.id, status: 'RASCUNHO', contaExternaId: null,
        OR: [{ motivoRecusa: null }, { motivoRecusa: { not: ABRINDO } }, { atualizadoEm: { lt: new Date(Date.now() - 2 * 60 * 1000) } }],
      },
      data: { dados: dadosSemSegredo, prazoRepasse: dados.repasse.prazo, motivoRecusa: ABRINDO },
    });
    if (trava.count === 0) throw new asaas.ErroSubconta('A abertura já está em andamento.', 409, { codigo: 'EM_ANDAMENTO' });
    conta = await prisma.contaRecebimento.findUnique({ where: { id: existente.id } });
  }

  const webhookSecret = crypto.randomBytes(24).toString('hex');
  const corpo = asaas.montarPayloadSubconta(dados, {
    webhookSecret,
    apiUrlPublica: process.env.API_URL_PUBLICA,
    tokenWebhookPlataforma: process.env.ASAAS_PLATAFORMA_WEBHOOK_TOKEN,
    contaId: conta.id,
  });

  let criada;
  try {
    criada = await asaas.criarSubconta(corpo);
  } catch (e) {
    await prisma.contaRecebimento.update({ where: { id: conta.id }, data: { motivoRecusa: e.message?.slice(0, 300) || 'Falha ao abrir a conta.' } });
    throw e;
  }

  // apiKey -> cofre do tenant, ANTES de qualquer outra gravacao: o Asaas so
  // devolve essa chave uma vez. Se o cofre falhar, a subconta existe e a chave
  // se perderia — entao o id externo fica gravado (estado recuperavel pelo
  // suporte, que gera chave nova no painel do Asaas) e o log nunca leva a chave.
  const payload = {
    apiKey: criada.apiKey,
    webhookSecret,
    ambiente: asaas.ambiente(),
    origem: 'SUBCONTA_PLATAFORMA',
    contaExternaId: criada.id,
  };
  let credencial;
  try {
    const cifrado = cifrarPayload(clienteId, payload);
    credencial = await prisma.credencial.create({
      data: {
        clienteId,
        nome: NOME_CREDENCIAL,
        tipo: 'ASAAS_KEY',
        descricao: 'Criada automaticamente ao abrir a conta de recebimento.',
        dadosCifrados: cifrado.conteudoCifrado,
        iv: cifrado.iv,
        tag: cifrado.tag,
        versaoChave: cifrado.versaoChave,
      },
      select: { id: true },
    });
  } catch (e) {
    console.error(`[conta-recebimento] subconta ${criada.id} criada no Asaas mas a chave NAO foi pro cofre (cliente=${clienteId}): ${e?.message}`);
    await prisma.contaRecebimento.update({
      where: { id: conta.id },
      data: {
        contaExternaId: criada.id,
        walletId: criada.walletId,
        motivoRecusa: 'CHAVE_PENDENTE: conta aberta no Asaas, mas a chave não foi guardada. Fale com o suporte.',
        dados: { ...dadosSemSegredo, chavePendente: true, enviadoEm: new Date().toISOString() },
      },
    }).catch((e2) => console.error(`[conta-recebimento] nao gravou o estado da subconta ${criada.id}: ${e2?.message}`));
    throw new asaas.ErroSubconta('A conta foi aberta, mas não conseguimos guardar a chave. Fale com o suporte antes de tentar de novo.', 502, { codigo: 'CHAVE_NAO_GUARDADA' });
  }

  let atualizada;
  try {
    atualizada = await prisma.contaRecebimento.update({
      where: { id: conta.id },
      data: {
        contaExternaId: criada.id,
        walletId: criada.walletId,
        status: 'EM_ANALISE',
        motivoRecusa: null,
        dados: { ...dadosSemSegredo, credencialId: credencial.id, enviadoEm: new Date().toISOString() },
      },
    });
  } catch (e) {
    // A chave ja esta no cofre (credencial.id): o suporte religa pela credencial.
    console.error(`[conta-recebimento] subconta ${criada.id} com chave no cofre (credencial=${credencial.id}) mas a conta local nao atualizou: ${e?.message}`);
    throw e;
  }

  const pagamento = await prisma.configuracaoPagamento.findUnique({ where: { clienteId }, select: { ativo: true } });
  if (!pagamento?.ativo) await apontarPagamentoPraSubconta(clienteId, credencial.id);

  if (dados.repasse.prazo === 'ANTECIPADO') {
    await asaas.configurarAntecipacao(criada.apiKey, true).catch((e) => console.error('[conta-recebimento] antecipacao', e?.message));
  }

  // Status imediato (o Asaas pode aprovar na hora).
  return sincronizar(atualizada).catch(() => atualizada);
}

/**
 * Consulta o status no Asaas com a chave da subconta e aplica.
 * @returns {Promise<Object>} conta atualizada
 */
async function sincronizar(conta) {
  if (!conta?.contaExternaId) return conta;
  const apiKey = await chaveDaSubconta(conta);
  const st = await asaas.statusDaConta(apiKey);
  const novo = asaas.mapearStatusConta(st);
  if (novo === conta.status && (novo !== 'RECUSADA' || conta.motivoRecusa)) return conta;

  const data = { status: novo, motivoRecusa: novo === 'RECUSADA' ? asaas.motivoRecusa(st) : null };
  const r = await prisma.contaRecebimento.updateMany({ where: { id: conta.id, status: conta.status }, data });
  const atualizada = await prisma.contaRecebimento.findUnique({ where: { id: conta.id } });
  if (r.count === 0) return atualizada; // outro processo ja aplicou

  if (novo === 'ATIVA' && conta.status !== 'ATIVA') {
    await apontarPagamentoPraSubconta(conta.clienteId, conta.dados.credencialId);
    await avisar(conta.clienteId, 'Conta de recebimento liberada', 'Pix e cartão já caem na sua conta do Sellergy. O saldo e os saques ficam em Conta de recebimento.');
  } else if (novo === 'RECUSADA' && conta.status !== 'RECUSADA') {
    await avisar(conta.clienteId, 'Conta de recebimento recusada', `${data.motivoRecusa} Abra a Conta de recebimento para ver o que fazer.`);
  }
  return atualizada;
}

/** Links pra mandar documentos (quando o Asaas pede). */
async function documentos(conta) {
  const apiKey = await chaveDaSubconta(conta);
  const r = await asaas.documentosPendentes(apiKey);
  const lista = Array.isArray(r?.data) ? r.data : [];
  return lista
    .filter((d) => d && String(d.status || '').toUpperCase() !== 'APPROVED')
    .map((d) => ({
      titulo: String(d.title || d.type || 'Documento').slice(0, 120),
      descricao: d.description ? String(d.description).slice(0, 300) : null,
      status: String(d.status || 'PENDING').toUpperCase(),
      link: typeof d.onboardingUrl === 'string' && /^https:\/\//.test(d.onboardingUrl) ? d.onboardingUrl : null,
    }));
}

/** Saldo, a liberar, extrato e taxas. Cada parte falha sozinha. */
async function financeiro(conta, { offset = 0 } = {}) {
  const apiKey = await chaveDaSubconta(conta);
  const [s, liberar, ext, tx] = await Promise.allSettled([
    asaas.saldo(apiKey),
    asaas.estatisticaRecebimentos(apiKey, 'CONFIRMED'),
    asaas.extrato(apiKey, { limite: 30, offset }),
    asaas.taxas(apiKey),
  ]);
  const ok = (p) => (p.status === 'fulfilled' ? p.value : null);
  const extrato = ok(ext);
  return {
    saldo: ok(s) ? Number(ok(s).balance) || 0 : null,
    aLiberar: ok(liberar) ? Number(ok(liberar).netValue ?? ok(liberar).value) || 0 : null,
    extrato: extrato
      ? {
        itens: (extrato.data || []).map((t) => ({
          id: String(t.id),
          data: t.date || null,
          descricao: String(t.description || t.type || '').slice(0, 200),
          tipo: String(t.type || ''),
          valor: Number(t.value) || 0,
          saldo: t.balance !== undefined ? Number(t.balance) : null,
        })),
        temMais: Boolean(extrato.hasMore),
      }
      : null,
    taxas: ok(tx) ? resumirTaxas(ok(tx)) : null,
  };
}

/** Converte o /myAccount/fees num formato simples pra tela. */
function resumirTaxas(f) {
  const p = f?.payment || f || {};
  const linhas = [];
  const pix = p.pix || {};
  if (pix.fixedFeeValue !== undefined || pix.percentageFee !== undefined) {
    linhas.push({ forma: 'Pix', percentual: num(pix.percentageFee), fixo: num(pix.fixedFeeValue) });
  }
  const boleto = p.bankSlip || {};
  if (boleto.netValue !== undefined || boleto.defaultValue !== undefined) {
    linhas.push({ forma: 'Boleto', percentual: null, fixo: num(boleto.defaultValue ?? boleto.netValue) });
  }
  const cartao = p.creditCard || {};
  if (cartao.operationValue !== undefined || cartao.oneInstallmentPercentage !== undefined) {
    linhas.push({ forma: 'Crédito à vista', percentual: num(cartao.oneInstallmentPercentage), fixo: num(cartao.operationValue) });
    if (cartao.upToSixInstallmentsPercentage !== undefined) linhas.push({ forma: 'Crédito 2 a 6×', percentual: num(cartao.upToSixInstallmentsPercentage), fixo: num(cartao.operationValue) });
    if (cartao.upToTwelveInstallmentsPercentage !== undefined) linhas.push({ forma: 'Crédito 7 a 12×', percentual: num(cartao.upToTwelveInstallmentsPercentage), fixo: num(cartao.operationValue) });
  }
  const debito = p.debitCard || {};
  if (debito.defaultPercentage !== undefined || debito.operationValue !== undefined) {
    linhas.push({ forma: 'Débito', percentual: num(debito.defaultPercentage), fixo: num(debito.operationValue) });
  }
  const transf = f?.transfer || {};
  const saque = transf.pix?.feeValue ?? transf.ted?.feeValue;
  return { linhas, saque: saque !== undefined ? num(saque) : null };
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Intervalo minimo entre dois saques do mesmo negocio. Trava no banco
// (ContaRecebimento.saqueTravadoAte, update condicional): duplo clique, duas
// abas ou retentativa do navegador nao viram dois Pix.
const SAQUE_INTERVALO_MS = 2 * 60 * 1000;

async function travarSaque(conta, agora = new Date()) {
  const r = await prisma.contaRecebimento.updateMany({
    where: { id: conta.id, OR: [{ saqueTravadoAte: null }, { saqueTravadoAte: { lt: agora } }] },
    data: { saqueTravadoAte: new Date(agora.getTime() + SAQUE_INTERVALO_MS) },
  });
  if (r.count !== 1) {
    throw new asaas.ErroSubconta('Já tem um saque sendo feito agora. Espere 2 minutos e confira o extrato antes de pedir outro.', 409, { codigo: 'SAQUE_RECENTE' });
  }
}

async function liberarSaque(conta) {
  await prisma.contaRecebimento.updateMany({ where: { id: conta.id }, data: { saqueTravadoAte: null } })
    .catch((e) => console.error('[conta-recebimento] liberar trava do saque', e?.message));
}

/** Saque pra chave Pix cadastrada (nunca uma chave vinda do navegador). */
async function sacar(conta, valor) {
  if (conta.status !== 'ATIVA') throw new asaas.ErroSubconta('A conta ainda não está liberada.', 409, { codigo: 'CONTA_NAO_ATIVA' });
  const v = Math.round(Number(valor) * 100) / 100;
  if (!Number.isFinite(v) || v < 1) throw new asaas.ErroSubconta('Informe um valor a partir de R$ 1,00.', 422, { campos: ['valor'], codigo: 'VALOR_INVALIDO' });
  const repasse = conta.dados?.repasse || {};
  if (!repasse.chavePix || !repasse.tipoChavePix) throw new asaas.ErroSubconta('Cadastre a chave Pix do repasse primeiro.', 409, { codigo: 'SEM_CHAVE_PIX' });

  await travarSaque(conta);
  let pedidoEnviado = false;
  try {
    const apiKey = await chaveDaSubconta(conta);
    const s = await asaas.saldo(apiKey);
    if (v > (Number(s?.balance) || 0)) throw new asaas.ErroSubconta('Valor maior que o disponível pra sacar.', 422, { campos: ['valor'], codigo: 'SALDO_INSUFICIENTE' });
    pedidoEnviado = true;
    const t = await asaas.transferirPix(apiKey, { valor: v, chavePix: repasse.chavePix, tipoChavePix: repasse.tipoChavePix });
    return { id: t?.id ? String(t.id) : null, status: String(t?.status || 'PENDING'), valor: v, taxa: num(t?.transferFee), data: t?.effectiveDate || t?.scheduleDate || null };
  } catch (e) {
    // So destrava quando com certeza nada saiu: falhou antes de pedir o Pix,
    // ou o Asaas recusou o pedido (4xx -> 422). 5xx/timeout no POST pode ter
    // transferido — a trava segura ate o extrato mostrar.
    const recusado = e instanceof asaas.ErroSubconta && e.status === 422;
    if (!pedidoEnviado || recusado) await liberarSaque(conta);
    throw e;
  }
}

/** O pedido troca a chave Pix (tipo ou chave diferente da atual)? */
function trocaChavePix(conta, { tipoChavePix, chavePix }) {
  const atual = conta.dados?.repasse || {};
  if (chavePix === undefined && tipoChavePix === undefined) return false;
  const tipo = String(tipoChavePix || atual.tipoChavePix || '').toUpperCase();
  const chave = asaas.normalizarChavePix(tipo, chavePix ?? atual.chavePix);
  return tipo !== String(atual.tipoChavePix || '').toUpperCase() || chave !== atual.chavePix;
}

/**
 * Confirma que quem pede e o dono da sessao antes de trocar a chave Pix (o
 * destino do dinheiro): com 2 etapas ligado, pede o codigo do app; sem, a senha.
 * @param {{id:string, senha:string, totpAtivo?:boolean, totpSegredoCifrado?:string}} usuario
 * @param {{senha?:string, codigo?:string}} prova
 */
async function confirmarIdentidade(usuario, { senha, codigo } = {}, deps = {}) {
  const bcrypt = deps.bcrypt || require('bcryptjs');
  const totp = deps.totp || require('../seguranca/totp');
  if (!usuario) throw new asaas.ErroSubconta('Entre de novo para trocar a chave Pix.', 401, { codigo: 'CONFIRMACAO_INVALIDA' });
  if (usuario.totpAtivo && usuario.totpSegredoCifrado) {
    if (!codigo) throw new asaas.ErroSubconta('Digite o código do app autenticador para trocar a chave Pix.', 401, { campos: ['codigo'], codigo: 'CONFIRMACAO_NECESSARIA' });
    const segredo = totp.decifrarSegredo(usuario.id, usuario.totpSegredoCifrado);
    if (totp.verificarCodigo(segredo, String(codigo)) === null) {
      throw new asaas.ErroSubconta('Código incorreto.', 401, { campos: ['codigo'], codigo: 'CONFIRMACAO_INVALIDA' });
    }
    return true;
  }
  if (!senha) throw new asaas.ErroSubconta('Digite sua senha para trocar a chave Pix.', 401, { campos: ['senha'], codigo: 'CONFIRMACAO_NECESSARIA' });
  if (!(await bcrypt.compare(String(senha), String(usuario.senha || '')))) {
    throw new asaas.ErroSubconta('Senha incorreta.', 401, { campos: ['senha'], codigo: 'CONFIRMACAO_INVALIDA' });
  }
  return true;
}

/** Troca chave Pix e/ou prazo do repasse. */
async function atualizarRepasse(conta, { prazo, tipoChavePix, chavePix }) {
  const atual = conta.dados?.repasse || {};
  const novo = { ...atual };
  if (prazo !== undefined) {
    if (!['PADRAO', 'ANTECIPADO'].includes(prazo)) throw new asaas.ErroSubconta('Prazo inválido.', 422, { campos: ['prazo'] });
    novo.prazo = prazo;
  }
  if (chavePix !== undefined || tipoChavePix !== undefined) {
    const tipo = String(tipoChavePix || atual.tipoChavePix || '').toUpperCase();
    const chave = asaas.normalizarChavePix(tipo, chavePix ?? atual.chavePix);
    const motivo = asaas.validarChavePix(tipo, chave, { cnpj: conta.dados?.negocio?.cnpj });
    if (motivo) throw new asaas.ErroSubconta(motivo, 422, { campos: ['chavePix'] });
    novo.tipoChavePix = tipo;
    novo.chavePix = chave;
  }
  if (novo.prazo !== atual.prazo && conta.contaExternaId) {
    const apiKey = await chaveDaSubconta(conta);
    await asaas.configurarAntecipacao(apiKey, novo.prazo === 'ANTECIPADO');
  }
  return prisma.contaRecebimento.update({
    where: { id: conta.id },
    data: { dados: { ...conta.dados, repasse: novo }, prazoRepasse: novo.prazo || conta.prazoRepasse },
  });
}

/**
 * Evento ACCOUNT_STATUS_* do webhook do Asaas (token ja conferido). Acha a
 * conta pelo `?conta=` da URL que cadastramos (ou pelo id da subconta no
 * corpo) e confere o status na API — o corpo nunca e aplicado direto.
 */
async function processarEventoConta({ body, query }) {
  const idLocal = typeof query?.conta === 'string' && /^[0-9a-f-]{36}$/i.test(query.conta) ? query.conta : null;
  const idExterno = body?.accountStatus?.id ? String(body.accountStatus.id) : null;
  let conta = idLocal ? await prisma.contaRecebimento.findUnique({ where: { id: idLocal } }) : null;
  if (!conta && idExterno) conta = await prisma.contaRecebimento.findUnique({ where: { contaExternaId: idExterno } });
  if (!conta || !conta.contaExternaId) return { status: 200, corpo: { ok: true, ignorado: 'conta desconhecida' } };
  const atualizada = await sincronizar(conta);
  return { status: 200, corpo: { ok: true, status: atualizada.status } };
}

module.exports = {
  abrir,
  sincronizar,
  documentos,
  financeiro,
  sacar,
  atualizarRepasse,
  trocaChavePix,
  confirmarIdentidade,
  SAQUE_INTERVALO_MS,
  processarEventoConta,
  contaDoTenant,
  resumirTaxas,
  NOME_CREDENCIAL,
};
