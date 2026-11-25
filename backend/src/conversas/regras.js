// Regras PURAS da caixa de entrada do WhatsApp (sem banco). Testadas em
// regras.test.js. Quem grava/lê é conversas/servico.js; as rotas ficam em
// routes/conversas.routes.js.

const TAM_MAX_TEXTO = 4096; // limite de texto da API da Meta
const TAM_MAX_GUARDADO = 8000; // mensagem recebida maior que isso é cortada ao guardar
const HORAS_PAUSA_PADRAO = 4; // equipe respondeu: bot fica quieto por 4 h
const HORAS_PAUSA_MAX = 72;
const JANELA_META_MS = 24 * 60 * 60 * 1000;
const TAM_PAGINA_PADRAO = 40;
const TAM_PAGINA_MAX = 100;

const ORIGENS = Object.freeze(['CONTATO', 'BOT', 'EQUIPE', 'LEMBRETE', 'CAMPANHA', 'SISTEMA']);
const FILTROS = Object.freeze(['todas', 'nao-lidas', 'aguardando', 'equipe', 'bot']);

function digitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

/**
 * Chave do contato: só dígitos, com DDI e com o 9 do celular brasileiro.
 * O WhatsApp entrega números antigos sem o 9 (55 + DDD + 8 dígitos) e o
 * cadastro costuma ter com: os dois viram a mesma conversa.
 *   "(11) 98888-7777" -> "5511988887777"
 *   "551188887777"    -> "5511988887777"
 * Fixo (8 dígitos começando com 2-5) fica como está. Inválido -> null.
 */
function chaveTelefone(valor) {
  let d = digitos(valor);
  if (d.length < 10 || d.length > 15) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.startsWith('55') && d.length === 12 && /[6-9]/.test(d[4])) {
    d = `${d.slice(0, 4)}9${d.slice(4)}`;
  }
  return d;
}

/** Bot calado nesta conversa agora? */
function pausaAtiva(conversa, agora = new Date()) {
  if (!conversa?.botPausado) return false;
  if (!conversa.botPausadoAte) return true; // até alguém devolver ao bot
  return new Date(conversa.botPausadoAte).getTime() > agora.getTime();
}

/**
 * Lê o pedido de pausa. `horas` null/'' = até retomar; número = por N horas.
 * @returns {{ botPausado: true, botPausadoAte: Date|null } | { erro: string }}
 */
function lerPausa(horas, agora = new Date()) {
  if (horas === null || horas === undefined || horas === '') return { botPausado: true, botPausadoAte: null };
  const n = Number(horas);
  if (!Number.isFinite(n) || n <= 0 || n > HORAS_PAUSA_MAX) {
    return { erro: `Escolha de 1 a ${HORAS_PAUSA_MAX} horas, ou pause até retomar.` };
  }
  return { botPausado: true, botPausadoAte: new Date(agora.getTime() + n * 3600_000) };
}

/** Pausa automática quando a equipe responde (estende, nunca encurta). */
function pausaAoResponder(conversa, agora = new Date(), horas = HORAS_PAUSA_PADRAO) {
  if (conversa?.botPausado && !conversa.botPausadoAte) return { botPausado: true, botPausadoAte: null };
  const nova = agora.getTime() + horas * 3600_000;
  const atual = conversa?.botPausado && conversa.botPausadoAte ? new Date(conversa.botPausadoAte).getTime() : 0;
  return { botPausado: true, botPausadoAte: new Date(Math.max(nova, atual)) };
}

/** Texto da resposta da equipe. */
function validarTexto(texto) {
  if (typeof texto !== 'string') return { erro: 'Escreva a mensagem.' };
  const limpo = texto.replace(/\r\n/g, '\n').trim();
  if (!limpo) return { erro: 'Escreva a mensagem.' };
  if (limpo.length > TAM_MAX_TEXTO) return { erro: `Mensagem grande demais (máximo ${TAM_MAX_TEXTO} caracteres).` };
  return { texto: limpo };
}

/** Texto guardado (recebido ou do bot): nunca vazio, nunca gigante. */
function textoParaGuardar(texto) {
  const t = String(texto ?? '').trim();
  return t.length > TAM_MAX_GUARDADO ? `${t.slice(0, TAM_MAX_GUARDADO)}…` : t;
}

/**
 * WhatsApp oficial: fora de 24 h desde a última mensagem do cliente só sai
 * modelo aprovado. QR Code não tem janela.
 */
function dentroDaJanela({ canal, ultimaEntradaEm }, agora = new Date()) {
  if (canal !== 'META_CLOUD') return true;
  if (!ultimaEntradaEm) return false;
  return agora.getTime() - new Date(ultimaEntradaEm).getTime() < JANELA_META_MS;
}

function janelaAte({ canal, ultimaEntradaEm }) {
  if (canal !== 'META_CLOUD' || !ultimaEntradaEm) return null;
  return new Date(new Date(ultimaEntradaEm).getTime() + JANELA_META_MS);
}

/** Trava de envio real do provedor (sem ela: só grava e loga). */
function envioRealLigado(provedor, env = process.env) {
  if (provedor === 'META_CLOUD') return env.WHATSAPP_ENVIO_REAL === '1';
  if (provedor === 'BAILEYS') return env.BAILEYS_ENVIO_REAL === '1';
  return false;
}

/** Resultado do adapter ({ok, simulado}) -> status guardado da mensagem. */
function statusDoEnvio(r) {
  if (!r?.ok) return 'FALHOU';
  return r.simulado ? 'SIMULADA' : 'ENVIADA';
}

/** Origem de um envio do negócio (mensagemTenant) pelo tipo. */
function origemDoTipo(tipo) {
  if (tipo === 'lembrete') return 'LEMBRETE';
  if (tipo === 'campanha') return 'CAMPANHA';
  return 'SISTEMA';
}

/** Situação da conversa para a lista. */
function situacao(conversa, agora = new Date()) {
  if (pausaAtiva(conversa, agora)) return 'EQUIPE';
  if (conversa?.ultimaMensagemOrigem === 'CONTATO') return 'AGUARDANDO';
  return 'BOT';
}

/** where do Prisma para a lista (sempre preso ao negócio). */
function filtroLista({ clienteId, busca, filtro, agora = new Date() }) {
  const where = { clienteId };
  const e = [];
  const termo = typeof busca === 'string' ? busca.trim().slice(0, 60) : '';
  if (termo) {
    const d = digitos(termo);
    const ou = [{ nomeContato: { contains: termo, mode: 'insensitive' } }];
    if (d.length >= 3) ou.push({ telefone: { contains: d } });
    e.push({ OR: ou });
  }
  const pausada = { botPausado: true, OR: [{ botPausadoAte: null }, { botPausadoAte: { gt: agora } }] };
  if (filtro === 'nao-lidas') e.push({ naoLidas: { gt: 0 } });
  if (filtro === 'aguardando') e.push({ ultimaMensagemOrigem: 'CONTATO' }, { NOT: pausada });
  if (filtro === 'equipe') e.push(pausada);
  if (filtro === 'bot') e.push({ NOT: pausada });
  if (e.length) where.AND = e;
  return where;
}

/**
 * Quem pode ver as conversas do negócio (tempo real e lista): dono e
 * administrador sempre; vendedor só com CRM > visualizar. Módulo CRM liberado.
 * @param {{ perfil: string, clienteId?: string, permissoes?: object }} usuario  do BANCO
 * @param {{ modulosLiberados?: object, status?: string }} cliente
 */
function podeVerConversas(usuario, cliente) {
  if (!usuario?.clienteId || !cliente || cliente.status !== 'ACTIVE') return false;
  if (cliente.modulosLiberados?.CRM !== true) return false;
  if (usuario.perfil === 'CLIENT' || usuario.perfil === 'ADMINISTRADOR') return true;
  if (usuario.perfil === 'VENDEDOR') return usuario.permissoes?.CRM?.visualizar === true;
  return false;
}

/**
 * Canal conectado do negócio — mesma regra da tela "Bots e conexão":
 * oficial = META_CLOUD com número, credencial e verify token; QR Code =
 * BAILEYS com a sessão CONECTADO.
 */
function canalConectado(bots) {
  for (const b of bots || []) {
    const provedor = b.provedorCanal || 'META_CLOUD';
    if (provedor === 'META_CLOUD' && b.identificadorCanal && b.credencialCanalId && b.verifyTokenCanal) {
      return { conectado: true, provedor, botId: b.id, numero: b.telefone || null };
    }
    if (provedor === 'BAILEYS' && b.statusConexaoBaileys === 'CONECTADO') {
      return { conectado: true, provedor, botId: b.id, numero: b.baileysNumeroConectado || null };
    }
  }
  return { conectado: false, provedor: null, botId: null, numero: null };
}

/** "2026-11-26" -> "qui, 26/11" (sem fuso: a data é a do texto). */
function rotuloDia(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== +m[3]) return null;
  const dias = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  return `${dias[d.getUTCDay()]}, ${m[3]}/${m[2]}`;
}

/** Minutos do dia -> "HH:MM". */
function horaDeMinutos(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Texto pronto dos horários livres pra mandar no WhatsApp. */
function textoHorarios(rotulo, porProfissional) {
  const linhas = porProfissional.filter((p) => p.horarios.length).map((p) => `• ${p.nome}: ${p.horarios.join(' · ')}`);
  if (!linhas.length) return null;
  return `Horários livres ${rotulo}:\n${linhas.join('\n')}\nMe fala qual prefere que eu já reservo.`;
}

function lerTamanhoPagina(valor) {
  const n = Number.parseInt(valor, 10);
  if (!Number.isInteger(n) || n <= 0) return TAM_PAGINA_PADRAO;
  return Math.min(n, TAM_PAGINA_MAX);
}

/** Cursor de data (ISO) válido ou null. */
function lerCursorData(valor) {
  if (typeof valor !== 'string' || !valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = {
  TAM_MAX_TEXTO,
  HORAS_PAUSA_PADRAO,
  HORAS_PAUSA_MAX,
  ORIGENS,
  FILTROS,
  digitos,
  chaveTelefone,
  pausaAtiva,
  lerPausa,
  pausaAoResponder,
  validarTexto,
  textoParaGuardar,
  dentroDaJanela,
  janelaAte,
  envioRealLigado,
  statusDoEnvio,
  origemDoTipo,
  situacao,
  filtroLista,
  podeVerConversas,
  canalConectado,
  rotuloDia,
  horaDeMinutos,
  textoHorarios,
  lerTamanhoPagina,
  lerCursorData,
};
