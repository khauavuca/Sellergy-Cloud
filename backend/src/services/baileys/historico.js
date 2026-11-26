// Historico do numero conectado por QR Code: ao parear, o WhatsApp entrega as
// conversas, os contatos e as mensagens antigas (evento messaging-history.set,
// em varios lotes). Aqui isso vira conversas na tela WhatsApp do sistema,
// com o cliente criado pra cada contato que ja escreveu.
//
// Midia antiga: baixa as dos ultimos DIAS_MIDIA dias (ate MAX_MIDIAS por
// lote); as mais velhas entram com o tipo (foto, audio...) sem o arquivo.

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const conversas = require('../../conversas/servico');
const midiaConversa = require('../../conversas/midia');
const { lerConteudo } = require('./conteudoMensagem');

const DIAS_MIDIA = 30;
const MAX_MIDIAS = 300;

function digitosDoJid(jid) {
  const j = String(jid || '');
  return j.endsWith('@s.whatsapp.net') ? j.split('@')[0].split(':')[0] : null;
}

/** Mapa de nomes e de LID -> numero com o que veio no lote. PURA. */
function montarMapas({ contacts = [], lidPnMappings = [] }) {
  const lidParaPn = new Map();
  for (const m of lidPnMappings || []) {
    if (m?.lid && m?.pn) lidParaPn.set(m.lid, m.pn);
  }
  const nomes = new Map();
  for (const c of contacts || []) {
    const nome = c.name || c.notify || c.verifiedName || null;
    if (c.lid && c.phoneNumber) lidParaPn.set(c.lid, c.phoneNumber);
    if (c.id?.endsWith('@lid') && c.phoneNumber) lidParaPn.set(c.id, c.phoneNumber);
    const pn = digitosDoJid(c.phoneNumber) || digitosDoJid(c.id) || digitosDoJid(lidParaPn.get(c.id));
    if (pn && nome) nomes.set(pn, nome);
  }
  return { lidParaPn, nomes };
}

async function telefoneDoChat(sock, jid, lidParaPn, key = {}) {
  const j = String(jid || '');
  if (j.endsWith('@s.whatsapp.net')) return digitosDoJid(j);
  if (!j.endsWith('@lid')) return null; // grupo, status, canal
  const direto = digitosDoJid(key.remoteJidAlt) || digitosDoJid(key.senderPn) || digitosDoJid(lidParaPn.get(j));
  if (direto) return direto;
  try {
    return digitosDoJid(await sock?.signalRepository?.lidMapping?.getPNForLID(j));
  } catch {
    return null;
  }
}

/** Importa um lote do historico. Devolve { conversasNovas, mensagensNovas }. */
async function importarLote({ bot, sock, lote }) {
  const { lidParaPn, nomes } = montarMapas(lote);
  const limiteMidia = Date.now() - DIAS_MIDIA * 24 * 60 * 60 * 1000;
  let baixadas = 0;
  const itens = [];
  for (const msg of lote.messages || []) {
    const telefone = await telefoneDoChat(sock, msg.key?.remoteJid, lidParaPn, msg.key);
    if (!telefone) continue;
    const conteudo = lerConteudo(msg);
    if (!conteudo || conteudo.tipo === 'REACAO') continue;
    const criadoEm = new Date(Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0) * 1000 || Date.now());
    const deMim = Boolean(msg.key?.fromMe);
    let campos = {};
    if (conteudo.midia) {
      if (criadoEm.getTime() >= limiteMidia && baixadas < MAX_MIDIAS) {
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
          campos = await midiaConversa.guardar({ clienteId: bot.clienteId, conversaId: telefone, buffer, mime: conteudo.midia.mime, nome: conteudo.midia.nome, tipo: conteudo.tipo });
          baixadas += 1;
        } catch {
          campos = { extra: { ...(conteudo.extra || {}), falhaDownload: true } };
        }
      } else {
        campos = { extra: { ...(conteudo.extra || {}), historicoSemArquivo: true } };
      }
    }
    itens.push({
      telefone,
      nomeContato: deMim ? (nomes.get(telefone) || null) : (msg.pushName || nomes.get(telefone) || null),
      direcao: deMim ? 'SAIDA' : 'ENTRADA',
      origem: deMim ? 'EQUIPE' : 'CONTATO',
      autorNome: deMim ? 'Celular' : null,
      texto: conteudo.texto || '',
      tipo: conteudo.tipo,
      extra: campos.extra || conteudo.extra,
      idExterno: msg.key?.id || null,
      criadoEm,
      midiaSegundos: conteudo.midia?.segundos ?? null,
      ...(campos.midiaChave ? { midiaChave: campos.midiaChave, midiaMime: campos.midiaMime, midiaNome: campos.midiaNome, midiaTamanho: campos.midiaTamanho } : {}),
    });
  }
  // Chat sem nenhuma mensagem no lote (so o contato): entra a conversa vazia?
  // Nao: so chats com mensagem viram conversa, pra a caixa nao encher de vazio.
  const r = itens.length
    ? await conversas.importarHistorico({ clienteId: bot.clienteId, botId: bot.id, canal: 'BAILEYS', itens })
    : { conversasNovas: 0, mensagensNovas: 0 };
  console.log(`[baileys/historico] bot ${bot.id}: lote com ${lote.messages?.length || 0} msgs e ${lote.contacts?.length || 0} contatos -> ${r.conversasNovas} conversas e ${r.mensagensNovas} mensagens novas (${baixadas} arquivos)`);
  return r;
}

/** Contatos que chegam depois (contacts.upsert/update): completa o nome das conversas. */
async function atualizarNomes({ bot, contatos }) {
  const prisma = require('../../prisma');
  const { lidParaPn, nomes } = montarMapas({ contacts: contatos });
  void lidParaPn;
  for (const [pn, nome] of nomes) {
    await prisma.conversa.updateMany({
      where: { clienteId: bot.clienteId, telefone: { endsWith: pn.slice(-8) }, nomeContato: null },
      data: { nomeContato: String(nome).slice(0, 120) },
    }).catch(() => {});
  }
}

module.exports = { montarMapas, importarLote, atualizarNomes, DIAS_MIDIA };
