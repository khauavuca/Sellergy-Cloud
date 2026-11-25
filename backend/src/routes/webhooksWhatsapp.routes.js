// Webhook do WhatsApp Cloud (Meta) — Frente 4. SEM middlewareAutenticacao:
// quem chama e a Meta, nao um usuario logado.
//   GET  /webhooks/whatsapp  -> verificacao do endpoint (ecoa hub.challenge se
//        o verify token casar com algum bot conectado).
//   POST /webhooks/whatsapp  -> mensagens recebidas -> processarMensagemRecebida
//        decide entre IA (DeepSeek, se bot.iaAtiva) e o roteador de menu fixo
//        (botRouter) -> resposta via adapter META_CLOUD (DRY_RUN ate o App
//        Review da Meta). Ref: erp-arquitetura-e-operacao.md §6.
//
// So atende bot.provedorCanal=META_CLOUD — o canal Baileys (WhatsApp Web nao
// oficial) nao tem webhook HTTP, a mensagem chega direto no processo worker.js
// via evento messages.upsert (ver services/baileys/gerenciadorConexao.js), que
// chama a MESMA processarMensagemRecebida (services/whatsappInbound.js).
//
// Arquivo proprio (nao o webhooks.routes.js de pagamento) pra as Frentes 2 e 4
// nao colidirem no mesmo arquivo. Montado em /webhooks no index.js.
//
// SEGURANCA: todo POST precisa da assinatura X-Hub-Signature-256 (HMAC-SHA256
// do corpo cru com WHATSAPP_APP_SECRET) — ver services/assinaturaWebhookMeta.js.
// O corpo cru vem de req.rawBody (express.json com verify, no index.js).

const express = require('express');
const prisma = require('../prisma');
const { processarMensagemRecebida, CAMPOS_BOT_ATENDIMENTO } = require('../services/whatsappInbound');
const { conferirWebhookMeta } = require('../services/assinaturaWebhookMeta');
const { ehPedidoDeSaida } = require('../services/baileys/envioHumano');
const { carregarCredencialDecifrada } = require('../credenciais');
const { criarProvedorWhatsapp } = require('../adapters/whatsapp');
const conversas = require('../conversas/servico');
const { statusDoEnvio } = require('../conversas/regras');

const roteador = express.Router();

const TEXTO_OPT_OUT = 'Pronto, você não vai mais receber nossas mensagens automáticas. Se precisar de algo, é só escrever aqui.';

// GET — a Meta valida o endpoint ecoando hub.challenge se o verify token bater.
roteador.get('/whatsapp', async (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode !== 'subscribe' || !token) return res.sendStatus(400);

    const bot = await prisma.bot.findFirst({
      where: { verifyTokenCanal: String(token) },
      select: { id: true },
    });
    if (!bot) return res.sendStatus(403);
    return res.status(200).send(String(challenge ?? ''));
  } catch (e) {
    console.error('[webhook/whatsapp verify]', e);
    return res.sendStatus(500);
  }
});

/** "SAIR"/"PARAR" no canal oficial: grava o opt-out (campanhas e automaticos respeitam). */
async function registrarOptOut(clienteId, telefone) {
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (!digitos) return;
  await prisma.optOutWhatsapp.upsert({
    where: { clienteId_telefone: { clienteId, telefone: digitos } },
    create: { clienteId, telefone: digitos },
    update: {},
  });
}

// POST — recebe eventos. Confere a assinatura ANTES de tudo; depois ack 200
// imediato (a Meta re-tenta se demorar) e processa sem bloquear a resposta.
roteador.post('/whatsapp', async (req, res) => {
  const conferencia = conferirWebhookMeta({ corpoCru: req.rawBody, cabecalho: req.get('x-hub-signature-256') });
  if (!conferencia.ok) {
    console.warn(`[webhook/whatsapp] POST recusado: ${conferencia.motivo}`);
    return res.sendStatus(conferencia.status);
  }

  res.sendStatus(200);
  try {
    const entradas = req.body?.entry || [];
    for (const entry of entradas) {
      for (const mudanca of entry.changes || []) {
        const value = mudanca.value || {};
        const phoneNumberId = value.metadata?.phone_number_id;
        const mensagens = value.messages || [];
        if (!phoneNumberId || mensagens.length === 0) continue;

        const bot = await prisma.bot.findFirst({
          where: { identificadorCanal: String(phoneNumberId), provedorCanal: 'META_CLOUD' },
          select: { ...CAMPOS_BOT_ATENDIMENTO },
        });
        if (!bot) continue;

        // So carrega FAQ se o bot nao estiver no modo IA — economiza uma
        // query que o motor de decisao nem vai usar (se a IA ficar
        // indisponivel, o iaRouter busca as FAQs ele mesmo).
        const faqs = bot.iaAtiva ? [] : await prisma.faq.findMany({
          where: { clienteId: bot.clienteId, ativo: true },
          orderBy: { ordem: 'asc' },
        });

        // Token do canal (decifrado) pra responder — best-effort.
        let token = null;
        if (bot.credencialCanalId) {
          const cred = await carregarCredencialDecifrada({ credencialId: bot.credencialCanalId, clienteId: bot.clienteId }).catch(() => null);
          token = cred?.dados?.token || cred?.dados?.accessToken || null;
        }
        const adapter = criarProvedorWhatsapp('META_CLOUD', {
          credencial: { dados: { accessToken: token } },
          identificadorCanal: phoneNumberId,
          modo: 'live',
        });

        // Nome do perfil do WhatsApp de quem escreveu (vai pra caixa de entrada).
        const nomes = new Map((value.contacts || []).map((c) => [c.wa_id, c.profile?.name || null]));

        for (const msg of mensagens) {
          const de = msg.from;
          const nomeContato = nomes.get(de) || null;
          const texto = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';

          if (ehPedidoDeSaida(texto)) {
            await registrarOptOut(bot.clienteId, de).catch((e) => console.error('[webhook/whatsapp optout]', e?.message));
            const envio = await adapter.enviarTexto({ para: de, texto: TEXTO_OPT_OUT }).catch(() => null);
            const base = { clienteId: bot.clienteId, telefone: de, botId: bot.id, canal: 'META_CLOUD' };
            await conversas.registrarSeguro({ ...base, texto, direcao: 'ENTRADA', origem: 'CONTATO', nomeContato });
            await conversas.registrarSeguro({ ...base, texto: TEXTO_OPT_OUT, direcao: 'SAIDA', origem: 'BOT', status: statusDoEnvio(envio), erro: envio?.ok ? null : envio?.erro });
            continue;
          }

          // canalContexto: so usado por ferramentas que enviam midia direto
          // (ex.: CATALOGO manda o PDF como documento, fora da resposta de texto).
          // Botao de resposta rapida (template de lembrete) chega com payload.
          const payload = msg.button?.payload || msg.interactive?.button_reply?.id || null;
          await processarMensagemRecebida({
            bot, texto, de, faqs, adapter, payload, nomeContato,
            canalContexto: { phoneNumberId, token, telefoneCliente: de },
          });
          // TODO(seam): resposta.encaminhar -> notificar a equipe (fila/atendimento).
        }

        // Estatistica leve do bot (best-effort, nao bloqueia).
        prisma.bot.update({
          where: { id: bot.id },
          data: { totalMensagens: { increment: mensagens.length }, ultimaAtividadeEm: new Date() },
        }).catch((e) => console.error('[webhook/whatsapp stats]', e?.message));
      }
    }
  } catch (e) {
    console.error('[webhook/whatsapp]', e);
  }
});

module.exports = roteador;
module.exports.registrarOptOut = registrarOptOut;
