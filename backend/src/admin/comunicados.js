// =====================================================================
// COMUNICADOS DA PLATAFORMA (Sellergy -> negocios clientes)
// =====================================================================
// Publico:
//   TODOS   -> negocios ativos (nao cancelados, nao inativos)
//   SERVICO -> clinicas/saloes (segmento SERVICO ou HIBRIDO)
//   PRODUTO -> lojas (segmento PRODUTO ou HIBRIDO)
//   TRIAL   -> em teste gratis
// O negocio do proprio Sellergy (PLATAFORMA_CLIENTE_ID) fica de fora.
//
// No sistema: 1 Notificacao por PESSOA do negocio (dados.comunicadoId). A
// FaixaComunicado mostra o mais recente nao lido; "fechar" marca a
// notificacao daquela pessoa como lida — por isso "quantos leram" sai das
// proprias notificacoes.
//
// WhatsApp: fila aviso-plataforma (mesma do assinatura/avisos.js, consumida
// no worker pelo avisarNoWhatsapp), com um atraso crescente por negocio pra
// espacar o envio do numero do Sellergy.
// =====================================================================

const prisma = require('../prisma');

const PUBLICOS = Object.freeze(['TODOS', 'SERVICO', 'PRODUTO', 'TRIAL']);
const ESPACO_WHATSAPP_MS = 25_000; // + ate 20 s aleatorios por mensagem

function filtroDoPublico(publico) {
  const base = { status: 'ACTIVE', statusAssinatura: { not: 'CANCELADA' } };
  const plataforma = process.env.PLATAFORMA_CLIENTE_ID;
  if (plataforma) base.id = { not: plataforma };
  if (publico === 'SERVICO') return { ...base, segmento: { in: ['SERVICO', 'HIBRIDO'] } };
  if (publico === 'PRODUTO') return { ...base, segmento: { in: ['PRODUTO', 'HIBRIDO'] } };
  if (publico === 'TRIAL') return { ...base, statusAssinatura: 'TRIAL' };
  return base;
}

function validarComunicado(corpo) {
  const titulo = typeof corpo?.titulo === 'string' ? corpo.titulo.trim() : '';
  const texto = typeof corpo?.texto === 'string' ? corpo.texto.trim() : '';
  const publico = corpo?.publico;
  const noSistema = corpo?.noSistema !== false;
  const noWhatsapp = corpo?.noWhatsapp === true;
  const campos = [];
  if (titulo.length < 3 || titulo.length > 100) campos.push('titulo');
  if (texto.length < 5 || texto.length > 1000) campos.push('texto');
  if (!PUBLICOS.includes(publico)) campos.push('publico');
  if (!noSistema && !noWhatsapp) campos.push('canais');
  if (campos.length) return { erro: 'Confira título (3 a 100 letras), texto (5 a 1.000), público e onde aparece.', campos };
  return { dados: { titulo, texto, publico, noSistema, noWhatsapp } };
}

async function previaDoAlcance(publico) {
  const clientes = await prisma.cliente.findMany({ where: filtroDoPublico(publico), select: { id: true, telefone: true } });
  const ids = clientes.map((c) => c.id);
  const pessoas = ids.length ? await prisma.usuario.count({ where: { clienteId: { in: ids } } }) : 0;
  return { negocios: clientes.length, pessoas, comTelefone: clientes.filter((c) => c.telefone && c.telefone.replace(/\D/g, '').length >= 10).length };
}

let filaAviso = null;
function obterFilaAviso() {
  if (!filaAviso) {
    const { Queue } = require('bullmq');
    const { criarConexaoRedis, NOME_FILA_AVISO_PLATAFORMA } = require('../filas');
    filaAviso = new Queue(NOME_FILA_AVISO_PLATAFORMA, {
      connection: criarConexaoRedis(),
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 200, removeOnFail: 200 },
    });
  }
  return filaAviso;
}

async function enviarComunicado({ titulo, texto, publico, noSistema, noWhatsapp, criadoPorId }) {
  const clientes = await prisma.cliente.findMany({ where: filtroDoPublico(publico), select: { id: true, telefone: true } });
  const comunicado = await prisma.comunicado.create({
    data: { titulo, texto, publico, noSistema, noWhatsapp, alcance: clientes.length, criadoPorId: criadoPorId || null },
  });

  let notificacoes = 0;
  if (noSistema && clientes.length) {
    const usuarios = await prisma.usuario.findMany({ where: { clienteId: { in: clientes.map((c) => c.id) } }, select: { id: true, clienteId: true } });
    const linhas = usuarios.map((u) => ({
      clienteId: u.clienteId, usuarioId: u.id, tipo: 'GENERICA', titulo, mensagem: texto,
      dados: { comunicadoId: comunicado.id, origem: 'COMUNICADO' },
    }));
    for (let i = 0; i < linhas.length; i += 500) {
      const r = await prisma.notificacao.createMany({ data: linhas.slice(i, i + 500) });
      notificacoes += r.count;
    }
  }

  let whatsappEnfileirados = 0;
  let whatsappErro = null;
  if (noWhatsapp) {
    const alvo = clientes.filter((c) => c.telefone && c.telefone.replace(/\D/g, '').length >= 10);
    if (!process.env.PLATAFORMA_CLIENTE_ID) {
      whatsappErro = 'SEM_CANAL_PLATAFORMA';
    } else {
      try {
        const fila = obterFilaAviso();
        const mensagem = `*${titulo}*\n${texto}`;
        let atraso = 0;
        for (const c of alvo) {
          await fila.add('avisar', { clienteId: c.id, texto: mensagem, comunicadoId: comunicado.id }, { delay: atraso });
          atraso += ESPACO_WHATSAPP_MS + Math.floor(Math.random() * 20_000);
          whatsappEnfileirados += 1;
        }
      } catch (e) {
        console.error('[comunicados] fila do WhatsApp', e?.message);
        whatsappErro = 'FILA_INDISPONIVEL';
      }
    }
  }
  return { comunicado, notificacoes, whatsappEnfileirados, whatsappErro };
}

/** Historico com quantos leram (pessoas e negocios). */
async function historico(limite = 30) {
  const lista = await prisma.comunicado.findMany({ orderBy: { criadoEm: 'desc' }, take: limite });
  return Promise.all(lista.map(async (c) => {
    if (!c.noSistema) return { ...c, leitura: null };
    const filtro = { dados: { path: ['comunicadoId'], equals: c.id } };
    const [pessoas, leram, negociosQueLeram] = await Promise.all([
      prisma.notificacao.count({ where: filtro }),
      prisma.notificacao.count({ where: { ...filtro, lida: true } }),
      prisma.notificacao.groupBy({ by: ['clienteId'], where: { ...filtro, lida: true } }),
    ]);
    return {
      ...c,
      leitura: {
        pessoas, leram,
        negociosQueLeram: negociosQueLeram.length,
        pct: c.alcance ? Math.round((negociosQueLeram.length / c.alcance) * 1000) / 10 : null,
      },
    };
  }));
}

module.exports = { PUBLICOS, filtroDoPublico, validarComunicado, previaDoAlcance, enviarComunicado, historico };
