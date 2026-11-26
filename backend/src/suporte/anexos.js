// Fotos temporarias dos chamados de suporte.
//
// Regra (pedido do dono): a foto so existe enquanto o chamado esta aberto.
//  - Ao resolver o chamado, as fotos sao apagadas do storage na hora.
//  - A conversa (texto) fica guardada por 7 dias depois de resolvido, como
//    respaldo se houver ofensa de qualquer lado. Depois disso as mensagens
//    sao apagadas e fica so o resumo do chamado (assunto, tempos, avaliacao).
//
// A foto nunca sai com URL do MinIO: o navegador busca pela API, com login,
// e a API confere de quem e o chamado antes de repassar o arquivo.

const crypto = require('crypto');
const prisma = require('../prisma');
const { upload, baixar, remover } = require('../storage/minio');
const { extensaoDeMime } = require('../middlewares/upload.middleware');

const DIAS_GUARDA_CONVERSA = 7;

/** Formato da mensagem pra API. `base` = prefixo da rota que serve a foto. */
function formatarMensagem(m, base) {
  let anexo = null;
  if (m.anexoChave) anexo = { tipo: m.anexoTipo, nome: m.anexoNome || 'foto', caminho: `${base}/${m.id}` };
  else if (m.anexoApagadoEm) anexo = { apagado: true, nome: m.anexoNome || 'foto' };
  return { id: m.id, autor: m.autor, autorNome: m.autorNome, texto: m.texto, criadoEm: m.criadoEm, anexo };
}

/** Sobe a foto (ja validada pelo uploadSeguro) e cria a mensagem com ela. */
async function criarMensagemComFoto({ chamado, arquivo, autor, autorNome, texto }) {
  const ext = extensaoDeMime(arquivo.mimetype);
  const chave = `suporte/${chamado.clienteId}/${chamado.id}/${crypto.randomBytes(12).toString('hex')}.${ext}`;
  await upload({ key: chave, body: arquivo.buffer, contentType: arquivo.mimetype, cacheControl: 'private, no-store' });
  return prisma.chamadoMensagem.create({
    data: {
      chamadoId: chamado.id, autor, autorNome, texto: texto || '',
      anexoChave: chave, anexoTipo: arquivo.mimetype, anexoNome: `foto.${ext}`,
    },
  });
}

/** Repassa a foto da mensagem. Quem chama ja conferiu o acesso ao chamado. */
async function enviarFoto(res, mensagem) {
  if (!mensagem?.anexoChave) return res.status(404).json({ erro: 'Foto não encontrada ou já apagada.' });
  try {
    const { corpo, tipo, tamanho } = await baixar(mensagem.anexoChave);
    res.setHeader('Content-Type', mensagem.anexoTipo || tipo || 'application/octet-stream');
    if (tamanho) res.setHeader('Content-Length', String(tamanho));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    corpo.pipe(res);
  } catch (e) {
    console.error('[suporte/foto]', e?.message);
    if (!res.headersSent) res.status(404).json({ erro: 'Foto não encontrada ou já apagada.' });
  }
}

/** Apaga as fotos do chamado (storage + marca na mensagem). Devolve quantas. */
async function apagarFotosDoChamado(chamadoId) {
  const comFoto = await prisma.chamadoMensagem.findMany({ where: { chamadoId, anexoChave: { not: null } }, select: { id: true, anexoChave: true } });
  for (const m of comFoto) {
    await remover(m.anexoChave).catch((e) => console.error('[suporte/fotos] remover', e?.message));
  }
  if (comFoto.length) {
    await prisma.chamadoMensagem.updateMany({ where: { id: { in: comFoto.map((m) => m.id) } }, data: { anexoChave: null, anexoApagadoEm: new Date() } });
  }
  return comFoto.length;
}

/** Ao resolver: apaga as fotos e marca a data (a conversa conta 7 dias dali). */
async function aoResolver(chamadoId) {
  await apagarFotosDoChamado(chamadoId);
  await prisma.chamado.update({ where: { id: chamadoId }, data: { resolvidoEm: new Date() } });
}

/** Ao reabrir: some o prazo de apagar (a conversa volta a valer). */
async function aoReabrir(chamadoId) {
  await prisma.chamado.update({ where: { id: chamadoId }, data: { resolvidoEm: null } });
}

/** Data limite: chamado resolvido antes dela perde a conversa. PURA. */
function limiteGuarda(agora = new Date(), dias = DIAS_GUARDA_CONVERSA) {
  return new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);
}

/** Apaga a conversa dos chamados resolvidos ha mais de 7 dias. */
async function limparConversasVencidas(agora = new Date()) {
  const vencidos = await prisma.chamado.findMany({
    where: { status: 'RESOLVIDO', resolvidoEm: { lt: limiteGuarda(agora) }, conversaApagadaEm: null },
    select: { id: true }, take: 500,
  });
  for (const c of vencidos) {
    await apagarFotosDoChamado(c.id); // seguranca: nenhuma foto sobra
    await prisma.$transaction([
      prisma.chamadoMensagem.deleteMany({ where: { chamadoId: c.id } }),
      prisma.chamado.update({ where: { id: c.id }, data: { conversaApagadaEm: agora } }),
    ]);
  }
  return vencidos.length;
}

module.exports = {
  DIAS_GUARDA_CONVERSA,
  formatarMensagem,
  criarMensagemComFoto,
  enviarFoto,
  apagarFotosDoChamado,
  aoResolver,
  aoReabrir,
  limiteGuarda,
  limparConversasVencidas,
};
