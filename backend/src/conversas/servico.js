// Caixa de entrada do WhatsApp: grava cada mensagem que entra e sai pelo
// numero conectado do negocio (oficial ou QR Code) e avisa a tela em tempo
// real. Roda nos DOIS processos:
//   - API: webhook da Meta, resposta da equipe;
//   - worker: mensagens do QR Code (Baileys), lembretes, envios enfileirados.
// Por isso o aviso em tempo real vai pelo Redis (canal "conversas:eventos");
// quem repassa pro socket.io e conversas/tempoReal.js, dentro da API.
//
// Tudo aqui e "best-effort" pra quem chama do atendimento: gravar a conversa
// nunca pode derrubar a resposta do bot (use registrarSeguro).

const midia = require('./midia');
const porTelefone = require('../clientesFinais/porTelefone');
const prisma = require('../prisma');
const r = require('./regras');

const CANAL_EVENTOS = 'conversas:eventos';

// ---------- tempo real (Redis pub/sub) ----------

let publicador = null;
function obterPublicador() {
  if (!publicador) {
    const IORedis = require('ioredis');
    publicador = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 2 });
    publicador.on('error', () => {}); // queda do Redis nao derruba o processo; o ioredis reconecta
  }
  return publicador;
}

/** Avisa a tela do negocio. Nunca lanca. Nos testes (node --test) nao abre Redis. */
async function publicar(clienteId, tipo, dados) {
  if (!clienteId || process.env.NODE_TEST_CONTEXT) return;
  try {
    await obterPublicador().publish(CANAL_EVENTOS, JSON.stringify({ clienteId, tipo, dados }));
  } catch (e) {
    console.error('[conversas] falha ao publicar evento', e?.message);
  }
}

// ---------- contato -> lead do CRM ----------

/**
 * Lead do negocio com o mesmo telefone. Lead.telefone e cadastrado do jeito
 * que a pessoa digitou ("(11) 98888-7777", sem DDI): compara pela chave
 * normalizada (com o 9) e, de reserva, pelo sufixo dos digitos.
 */
async function acharLeadPorTelefone(clienteId, chave, telefoneBruto) {
  if (!chave) return null;
  const ultimos4 = chave.slice(-4);
  const candidatos = await prisma.lead.findMany({
    where: { clienteId, telefone: { contains: ultimos4 } },
    select: { id: true, telefone: true },
    orderBy: { atualizadoEm: 'desc' },
    take: 50,
  });
  const bruto = r.digitos(telefoneBruto);
  const lead = candidatos.find((l) => {
    const d = r.digitos(l.telefone);
    if (d.length < 8) return false;
    return r.chaveTelefone(d) === chave || chave.endsWith(d) || bruto.endsWith(d);
  });
  return lead?.id || null;
}

// ---------- gravar ----------

function resumoConversa(c) {
  if (!c) return null;
  return {
    id: c.id,
    telefone: c.telefone,
    nomeContato: c.nomeContato,
    leadId: c.leadId,
    canal: c.canal,
    ultimaMensagemEm: c.ultimaMensagemEm,
    ultimaMensagemTexto: c.ultimaMensagemTexto,
    ultimaMensagemOrigem: c.ultimaMensagemOrigem,
    ultimaEntradaEm: c.ultimaEntradaEm,
    naoLidas: c.naoLidas,
    botPausado: c.botPausado,
    botPausadoAte: c.botPausadoAte,
    pausaAtiva: r.pausaAtiva(c),
    situacao: r.situacao(c),
  };
}

const CAMPOS_MENSAGEM = {
  id: true, conversaId: true, direcao: true, origem: true, texto: true, status: true,
  erro: true, autorNome: true, criadoEm: true, idExterno: true,
  // Midia: a chave do storage nunca sai; a tela usa /conversas/:id/midia/:mensagemId.
  tipo: true, midiaMime: true, midiaNome: true, midiaTamanho: true, midiaSegundos: true, extra: true, respondeAId: true,
};

// Cadastro do contato: mensagem que CHEGA ja cria o cliente (regra unica em
// clientesFinais/porTelefone.js); mensagem que sai so liga se ja existir.
async function leadDoContato({ clienteId, chave, nomeContato, criarLead }) {
  if (criarLead) {
    const { lead } = await porTelefone.acharOuCriarLead({ clienteId, telefone: chave, nome: nomeContato, origem: 'WHATSAPP' });
    return lead?.id || null;
  }
  return (await porTelefone.acharLeadPorTelefone(clienteId, chave))?.id || null;
}

async function obterOuCriarConversa({ clienteId, chave, telefone, nomeContato, botId, canal, criarLead = false }) {
  const where = { clienteId_telefone: { clienteId, telefone: chave } };
  const existente = await prisma.conversa.findUnique({ where });
  if (existente) {
    if (!existente.leadId) {
      const leadId = await leadDoContato({ clienteId, chave, nomeContato, criarLead }).catch((e) => { console.error('[conversas] cadastro do contato', e?.message); return null; });
      if (leadId) return prisma.conversa.update({ where: { id: existente.id }, data: { leadId } });
    }
    return existente;
  }
  const leadId = await leadDoContato({ clienteId, chave, nomeContato, criarLead }).catch((e) => { console.error('[conversas] cadastro do contato', e?.message); return null; });
  try {
    return await prisma.conversa.create({
      data: {
        clienteId, telefone: chave, telefoneEnvio: r.digitos(telefone) || chave,
        nomeContato: nomeContato || null, leadId, botId: botId || null, canal: canal || null,
      },
    });
  } catch (e) {
    // Duas mensagens do mesmo contato ao mesmo tempo: a outra criou primeiro.
    if (e?.code === 'P2002') return prisma.conversa.findUnique({ where });
    throw e;
  }
}

/**
 * Grava UMA mensagem na conversa do contato (cria a conversa se preciso).
 * @param {{
 *   clienteId: string, telefone: string, texto: string,
 *   direcao: 'ENTRADA'|'SAIDA', origem: string, status?: string,
 *   botId?: string, canal?: string, nomeContato?: string,
 *   autorUsuarioId?: string, autorNome?: string, idExterno?: string, erro?: string,
 *   dadosConversa?: object,
 * }} p
 * @returns {Promise<{ conversa: object, mensagem: object } | null>}
 */
async function registrarMensagem(p) {
  const chave = r.chaveTelefone(p.telefone);
  const tipo = p.tipo || 'TEXTO';
  const texto = r.textoParaGuardar(p.texto);
  // Texto e obrigatorio so na mensagem de texto; midia pode vir sem legenda.
  if (!p.clienteId || !chave || (tipo === 'TEXTO' && !texto)) return null;
  const nota = tipo === 'NOTA';
  if (!r.ORIGENS.includes(p.origem)) throw new Error(`origem invalida: ${p.origem}`);

  const entrada = p.direcao === 'ENTRADA';
  const agora = new Date();
  const conversa = await obterOuCriarConversa({
    clienteId: p.clienteId, chave, telefone: p.telefone, nomeContato: p.nomeContato, botId: p.botId, canal: p.canal,
    criarLead: entrada && p.origem === 'CONTATO',
  });

  const resumo = (texto || midia.rotuloDoTipo(tipo) || '').slice(0, 200);
  // Nota interna nao mexe na lista (nao e mensagem trocada com o cliente).
  const dados = nota ? { ...(p.dadosConversa || {}) } : {
    ultimaMensagemEm: agora,
    ultimaMensagemTexto: resumo,
    ultimaMensagemOrigem: p.origem,
    ...(p.botId ? { botId: p.botId } : {}),
    ...(p.canal ? { canal: p.canal } : {}),
    ...(entrada ? {
      ultimaEntradaEm: agora,
      naoLidas: { increment: 1 },
      // Responde pro numero do jeito que o WhatsApp entregou (com ou sem o 9).
      telefoneEnvio: r.digitos(p.telefone) || conversa.telefoneEnvio,
      ...(p.nomeContato ? { nomeContato: String(p.nomeContato).slice(0, 120) } : {}),
    } : {}),
    ...(p.dadosConversa || {}),
  };

  const [mensagem, atualizada] = await prisma.$transaction([
    prisma.mensagemConversa.create({
      data: {
        conversaId: conversa.id,
        clienteId: p.clienteId,
        direcao: entrada ? 'ENTRADA' : 'SAIDA',
        origem: p.origem,
        texto: texto || '',
        tipo,
        midiaChave: p.midiaChave || null,
        midiaMime: p.midiaMime || null,
        midiaNome: p.midiaNome || null,
        midiaTamanho: p.midiaTamanho ?? null,
        midiaSegundos: p.midiaSegundos ?? null,
        extra: p.extra ?? undefined,
        respondeAId: p.respondeAId || null,
        status: p.status || (nota ? 'NOTA' : entrada ? 'RECEBIDA' : 'ENVIADA'),
        erro: p.erro ? String(p.erro).slice(0, 300) : null,
        idExterno: p.idExterno || null,
        autorUsuarioId: p.autorUsuarioId || null,
        autorNome: p.autorNome || null,
      },
      select: CAMPOS_MENSAGEM,
    }),
    prisma.conversa.update({ where: { id: conversa.id }, data: dados }),
  ]);

  await publicar(p.clienteId, 'conversa_mensagem', { conversa: resumoConversa(atualizada), mensagem });
  return { conversa: atualizada, mensagem };
}

/** Igual a registrarMensagem, mas nunca lanca (atendimento do bot segue). */
async function registrarSeguro(p) {
  try {
    return await registrarMensagem(p);
  } catch (e) {
    console.error('[conversas] falha ao gravar mensagem', e?.message);
    return null;
  }
}

/** Atualiza o status de um envio (ex.: worker terminou de mandar pelo QR Code). */
async function atualizarStatusMensagem(mensagemId, { status, erro = null, idExterno = null }) {
  const m = await prisma.mensagemConversa.update({
    where: { id: mensagemId },
    data: { status, erro: erro ? String(erro).slice(0, 300) : null, ...(idExterno ? { idExterno } : {}) },
    select: { ...CAMPOS_MENSAGEM, clienteId: true },
  });
  const { clienteId, ...mensagem } = m;
  await publicar(clienteId, 'conversa_mensagem_status', { mensagem });
  return mensagem;
}

/** O bot esta pausado pra esse contato? (consulta direta, sem gravar) */
async function pausaDoContato(clienteId, telefone) {
  const chave = r.chaveTelefone(telefone);
  if (!clienteId || !chave) return false;
  const c = await prisma.conversa.findUnique({
    where: { clienteId_telefone: { clienteId, telefone: chave } },
    select: { botPausado: true, botPausadoAte: true },
  });
  return r.pausaAtiva(c);
}

/**
 * Importa conversas antigas (historico que o WhatsApp entrega ao conectar o
 * numero). Diferente de registrarMensagem: grava com a data original, nao soma
 * "nao lidas", nao dispara bot e pula o que ja foi importado (mesmo id).
 * Cada contato que ja escreveu vira cliente (regra unica do telefone).
 * @param {{ clienteId: string, botId?: string, canal?: string, itens: Array<{
 *   telefone: string, nomeContato?: string, direcao: string, origem: string, texto?: string, tipo?: string,
 *   extra?: object, idExterno?: string, criadoEm: Date, autorNome?: string,
 *   midiaChave?: string, midiaMime?: string, midiaNome?: string, midiaTamanho?: number, midiaSegundos?: number }> }} p
 */
async function importarHistorico({ clienteId, botId = null, canal = 'BAILEYS', itens = [] }) {
  const porTelefoneChave = new Map();
  for (const it of itens) {
    const chave = r.chaveTelefone(it.telefone);
    if (!chave) continue;
    if (!porTelefoneChave.has(chave)) porTelefoneChave.set(chave, []);
    porTelefoneChave.get(chave).push(it);
  }
  let conversasNovas = 0;
  let mensagensNovas = 0;
  for (const [chave, lista] of porTelefoneChave) {
    lista.sort((a, b) => a.criadoEm - b.criadoEm);
    const nomeContato = lista.map((i) => i.nomeContato).find(Boolean) || null;
    const temEntrada = lista.some((i) => i.direcao === 'ENTRADA');
    const where = { clienteId_telefone: { clienteId, telefone: chave } };
    let conversa = await prisma.conversa.findUnique({ where });
    if (!conversa) {
      conversa = await prisma.conversa.create({
        data: {
          clienteId, telefone: chave, telefoneEnvio: r.digitos(lista[0].telefone) || chave, nomeContato,
          botId, canal, ultimaMensagemEm: lista[0].criadoEm,
        },
      }).catch(async (e) => { if (e?.code === 'P2002') return prisma.conversa.findUnique({ where }); throw e; });
      conversasNovas += 1;
    }
    if (!conversa.leadId) {
      const leadId = await leadDoContato({ clienteId, chave, nomeContato, criarLead: temEntrada }).catch(() => null);
      if (leadId) conversa = await prisma.conversa.update({ where: { id: conversa.id }, data: { leadId } });
    }
    const ids = lista.map((i) => i.idExterno).filter(Boolean);
    const existentes = ids.length
      ? new Set((await prisma.mensagemConversa.findMany({ where: { conversaId: conversa.id, idExterno: { in: ids } }, select: { idExterno: true } })).map((m) => m.idExterno))
      : new Set();
    const novas = lista.filter((i) => !i.idExterno || !existentes.has(i.idExterno));
    if (!novas.length) continue;
    await prisma.mensagemConversa.createMany({
      data: novas.map((i) => ({
        conversaId: conversa.id, clienteId,
        direcao: i.direcao === 'ENTRADA' ? 'ENTRADA' : 'SAIDA',
        origem: i.origem, texto: r.textoParaGuardar(i.texto) || '', tipo: i.tipo || 'TEXTO',
        status: i.direcao === 'ENTRADA' ? 'RECEBIDA' : 'ENVIADA',
        idExterno: i.idExterno || null, autorNome: i.autorNome || null,
        midiaChave: i.midiaChave || null, midiaMime: i.midiaMime || null, midiaNome: i.midiaNome || null,
        midiaTamanho: i.midiaTamanho ?? null, midiaSegundos: i.midiaSegundos ?? null,
        extra: i.extra ?? undefined, criadoEm: i.criadoEm,
      })),
    });
    mensagensNovas += novas.length;
    const ultima = novas[novas.length - 1];
    const ultimaEntrada = [...novas].reverse().find((i) => i.direcao === 'ENTRADA');
    const dados = {};
    if (!conversa.ultimaMensagemTexto || ultima.criadoEm > conversa.ultimaMensagemEm) {
      Object.assign(dados, {
        ultimaMensagemEm: ultima.criadoEm,
        ultimaMensagemTexto: (ultima.texto || midia.rotuloDoTipo(ultima.tipo) || '').slice(0, 200),
        ultimaMensagemOrigem: ultima.origem,
      });
    }
    if (ultimaEntrada && (!conversa.ultimaEntradaEm || ultimaEntrada.criadoEm > conversa.ultimaEntradaEm)) dados.ultimaEntradaEm = ultimaEntrada.criadoEm;
    if (!conversa.nomeContato && nomeContato) dados.nomeContato = String(nomeContato).slice(0, 120);
    if (Object.keys(dados).length) await prisma.conversa.update({ where: { id: conversa.id }, data: dados });
  }
  if (conversasNovas || mensagensNovas) await publicar(clienteId, 'conversas_importadas', { conversasNovas, mensagensNovas }).catch(() => {});
  return { conversasNovas, mensagensNovas };
}

module.exports = {
  importarHistorico,
  CANAL_EVENTOS,
  publicar,
  registrarMensagem,
  registrarSeguro,
  atualizarStatusMensagem,
  pausaDoContato,
  acharLeadPorTelefone,
  resumoConversa,
  CAMPOS_MENSAGEM,
};
