// Webhooks externos (PSP) — Frente 2. SEM middlewareAutenticacao: quem chama e
// o provedor, nao um usuario logado. A autenticidade vem da assinatura HMAC
// (validada com o segredo do tenant) + a consulta do status no PSP (o corpo do
// evento nunca e aplicado direto) e o processamento e IDEMPOTENTE por
// (provedor, provedorCobrancaId) — webhook duplicado nao reprocessa o efeito.
// Ref: docs/erp-arquitetura-e-operacao.md §4.

const express = require('express');
const prisma = require('../prisma');
const { criarProvedor } = require('../adapters/pagamento');
const { carregarCredencialDecifrada } = require('../credenciais');
const { aplicarStatusCobranca } = require('../services/cobrancaPagamento');
const { opcoesDoProvedor, webhookPodeAplicar } = require('../services/pagamentoService');

const roteador = express.Router();

// POST /webhooks/assinatura/asaas — mensalidade do PROPRIO Sellergy (conta
// Asaas da plataforma). Token conferido em tempo constante e evento
// idempotente; ver src/assinatura/webhookAsaas.js.
roteador.post('/assinatura/asaas', async (req, res) => {
  try {
    const { processarWebhook } = require('../assinatura/webhookAsaas');
    const r = await processarWebhook({ headers: req.headers, body: req.body, query: req.query });
    if (r.status === 401) console.warn('[webhook/assinatura] token invalido de', req.ip);
    res.status(r.status).json(r.corpo);
  } catch (e) {
    console.error('[webhook/assinatura]', e?.message);
    // 500 faz o Asaas reenviar depois.
    res.status(500).json({ erro: 'falha ao processar' });
  }
});

// POST /webhooks/pagamento/:provedor
// Fluxo: parse "cego" do id -> acha a Cobranca (e o tenant dono) -> carrega a
// credencial do tenant -> valida assinatura -> consulta status real -> aplica.
roteador.post('/pagamento/:provedor', async (req, res) => {
  const provedor = String(req.params.provedor || '').toUpperCase();
  try {
    // 1) Parse sem credencial so pra extrair o provedorCobrancaId do evento.
    let parserCego;
    try {
      parserCego = criarProvedor(provedor, { modo: 'fixture' });
    } catch {
      return res.status(404).json({ erro: 'Provedor desconhecido.' });
    }
    const previa = parserCego.parsearWebhook({ headers: req.headers, body: req.body, query: req.query });
    if (!previa || !previa.provedorCobrancaId) {
      return res.status(200).json({ ok: true, ignorado: 'evento sem cobranca' });
    }

    // 2) Acha a Cobranca (e, com ela, o tenant). Primeiro pelo id do PSP; se
    //    nao bater (link do Mercado Pago/Pagar.me: a Cobranca guarda o id do
    //    link/preference e o evento traz o do pagamento/charge), pela
    //    referencia externa (= id da Cobranca, enviado ao criar). Casada pela
    //    referencia, so vale se a CONSULTA ao PSP devolver a mesma referencia.
    let cobranca = await prisma.cobranca.findFirst({
      where: { provedor, provedorCobrancaId: previa.provedorCobrancaId },
    });
    let viaReferencia = false;
    if (!cobranca && typeof previa.refExterna === 'string' && previa.refExterna) {
      cobranca = await prisma.cobranca.findFirst({ where: { id: previa.refExterna, provedor } });
      viaReferencia = Boolean(cobranca);
    }
    if (!cobranca) {
      return res.status(200).json({ ok: true, ignorado: 'cobranca desconhecida' });
    }

    // 3) Carrega config + credencial do tenant dono da cobranca. Modo (live x
    //    fixture) e ambiente (producao x sandbox) saem do mesmo lugar que a
    //    criacao da cobranca usa — ver services/pagamentoService.js.
    const config = await prisma.configuracaoPagamento.findUnique({ where: { clienteId: cobranca.clienteId } });
    const credencial = config?.credencialId
      ? await carregarCredencialDecifrada({ credencialId: config.credencialId, clienteId: cobranca.clienteId }).catch(() => null)
      : null;
    const opcoes = opcoesDoProvedor(credencial);

    // Fixture/simulado: a "consulta" devolveria pago pra qualquer id, entao
    // nada e aplicado — em producao nunca, e fora dela so com
    // PAGAMENTO_WEBHOOK_SIMULADO=1 (a API local fica exposta pelo tunel, um
    // POST forjado marcaria cobranca como paga). Ver webhookPodeAplicar.
    if (!webhookPodeAplicar(opcoes.modo)) {
      console.warn(`[webhook/pagamento] ignorado: pagamento em modo simulado (cobranca=${cobranca.id}).`);
      return res.status(200).json({ ok: true, ignorado: 'pagamento em modo de teste' });
    }
    // Em live a consulta precisa da chave do tenant; sem ela, nao confirma nada.
    if (opcoes.modo === 'live' && !credencial) {
      console.warn(`[webhook/pagamento] tenant sem credencial pra confirmar (cobranca=${cobranca.id}).`);
      return res.status(200).json({ ok: true, aviso: 'status nao confirmado' });
    }
    const psp = criarProvedor(provedor, opcoes);

    // 4) Valida a assinatura quando ha segredo configurado (webhookSecret no cofre).
    const segredo = credencial?.dados?.webhookSecret;
    if (segredo) {
      // query: o Mercado Pago assina o data.id que vem na query string.
      const ok = psp.verificarAssinatura({ headers: req.headers, rawBody: req.rawBody, segredo, query: req.query, body: req.body });
      if (!ok) {
        console.warn(`[webhook/pagamento] assinatura invalida (provedor=${provedor}, cobranca=${cobranca.id}).`);
        return res.status(401).json({ erro: 'assinatura invalida' });
      }
    }

    // 5) Status definitivo SEMPRE vem da consulta ao PSP, nunca do corpo do
    //    evento (com ou sem segredo: sem segredo qualquer um poderia mandar
    //    "pago"; com segredo, o PSP pode mandar evento fora de ordem). Sem
    //    conseguir consultar, nao aplica nada. aplicarStatusCobranca e idempotente.
    // Casada pela referencia, consulta o PAGAMENTO do evento (o id gravado e
    // o do link/preference, que nao tem status de pagamento).
    const idConsulta = viaReferencia ? (previa.pagamentoId || previa.provedorCobrancaId) : cobranca.provedorCobrancaId;
    let status;
    let pagoEm;
    let refConsultada;
    try {
      const atual = await psp.consultarStatus(idConsulta, { refExterna: cobranca.id });
      status = atual.status;
      pagoEm = atual.pagoEm;
      refConsultada = atual.refExterna;
    } catch (errConsulta) {
      // Responde 200 (o PSP nao precisa re-tentar — o "Atualizar" manual em
      // Pagamentos cobre depois).
      console.error(`[webhook/pagamento ${provedor}] falha ao consultar status:`, errConsulta?.message || errConsulta);
      return res.status(200).json({ ok: true, aviso: 'status nao confirmado' });
    }
    if (!status) return res.status(200).json({ ok: true, aviso: 'status nao confirmado' });

    if (viaReferencia) {
      // A referencia veio do evento/URL (forjavel); a do PSP, consultada com a
      // chave do tenant, nao.
      if (refConsultada !== cobranca.id) {
        console.warn(`[webhook/pagamento] referencia nao confere (provedor=${provedor}, cobranca=${cobranca.id}).`);
        return res.status(200).json({ ok: true, ignorado: 'referencia nao confere' });
      }
      // Num link, um pagamento recusado nao encerra a cobranca (o cliente
      // tenta de novo no mesmo link): so pago/estornado contam.
      if (status !== 'PAGO' && status !== 'ESTORNADO') {
        return res.status(200).json({ ok: true, ignorado: 'pagamento do link ainda nao concluido' });
      }
      // Passa a guardar o id do pagamento: "Atualizar" e estorno usam ele.
      if (status === 'PAGO' && idConsulta !== cobranca.provedorCobrancaId) {
        await prisma.cobranca.updateMany({
          where: { id: cobranca.id, provedorCobrancaId: cobranca.provedorCobrancaId },
          data: { provedorCobrancaId: idConsulta },
        }).catch((e) => console.error(`[webhook/pagamento] nao gravou o id do pagamento (cobranca=${cobranca.id}):`, e?.message));
      }
    }

    await aplicarStatusCobranca(cobranca, status, pagoEm);
    return res.status(200).json({ ok: true });
  } catch (e) {
    // Erro inesperado: 500 pra o PSP re-tentar a entrega (idempotencia cobre).
    console.error(`[webhook/pagamento ${provedor}]`, e);
    return res.status(500).json({ erro: 'Erro ao processar webhook.' });
  }
});

module.exports = roteador;
