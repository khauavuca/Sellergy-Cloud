// =====================================================================
// PAPEIS DA EQUIPE SELLERGY (painel admin) — fonte unica da matriz.
// =====================================================================
// Usuario.perfil === 'ADMIN' e alguem da equipe Sellergy. O papel fica em
// Usuario.papelAdmin:
//   null / 'DONO'  -> dono: tudo
//   'SUPORTE'      -> ver clientes e uso, entrar como suporte, responder chamados
//   'FINANCEIRO'   -> ver clientes e uso, cobranca, baixa, desconto, mudar plano
//   'DESATIVADO'   -> acesso cortado (login e sessoes abertas barrados)
//
// A matriz espelha o prototipo (AdminEquipe): "Suspender e cancelar" e
// "Precos, regua e equipe" sao so do dono.
//
// Duas camadas aplicam isto:
//   1. auth.middleware: papel diferente de DONO so ESCREVE (POST/PUT/...)
//      nos prefixos de PREFIXOS_ESCRITA — protege as rotas antigas do admin
//      (clientes, bots, credenciais, usuarios) que so checam perfil ADMIN.
//   2. permissoes.middleware#requerPapelAdmin(acao): checagem fina por rota.
// =====================================================================

const DONO = 'DONO';
const SUPORTE = 'SUPORTE';
const FINANCEIRO = 'FINANCEIRO';
const DESATIVADO = 'DESATIVADO';

const PAPEIS = Object.freeze([DONO, SUPORTE, FINANCEIRO]);

const TODOS = Object.freeze([DONO, SUPORTE, FINANCEIRO]);

const MATRIZ = Object.freeze({
  // Ver clientes e uso (tudo que e leitura no painel)
  'painel.ver': TODOS,
  'clientes.ver': TODOS,
  'uso.ver': TODOS,
  'saude.ver': TODOS,
  'comunicados.ver': TODOS,
  'suporte.ver': TODOS,
  // Entrar como suporte (so leitura) e responder chamados
  'suporte.entrar': [DONO, SUPORTE],
  'suporte.responder': [DONO, SUPORTE],
  // Dar baixa, desconto e mudar plano
  'cobranca.baixa': [DONO, FINANCEIRO],
  'cobranca.desconto': [DONO, FINANCEIRO],
  'cobranca.estenderTeste': [DONO, FINANCEIRO],
  'plano.mudar': [DONO, FINANCEIRO],
  // Suspender e cancelar
  'conta.suspender': [DONO],
  'conta.cancelar': [DONO],
  'conta.reativar': [DONO],
  // Precos, regua e equipe
  'precos.editar': [DONO],
  'cupons.editar': [DONO],
  'custos.editar': [DONO],
  'comunicados.enviar': [DONO],
  'equipe.gerenciar': [DONO],
  'auditoria.ver': [DONO],
});

const ACOES = Object.freeze(Object.keys(MATRIZ));

// Onde cada papel (alem do DONO) pode mandar POST/PUT/PATCH/DELETE. O resto
// das rotas de escrita fica so pro dono, mesmo as antigas.
const PREFIXOS_ESCRITA = Object.freeze({
  [SUPORTE]: Object.freeze(['/admin/suporte', '/autenticacao/']),
  [FINANCEIRO]: Object.freeze(['/admin/assinaturas', '/autenticacao/']),
});

/** Papel efetivo de um usuario do banco (null vira DONO). */
function papelDe(papelAdmin) {
  if (papelAdmin === null || papelAdmin === undefined || papelAdmin === '' || papelAdmin === DONO) return DONO;
  if (papelAdmin === SUPORTE || papelAdmin === FINANCEIRO || papelAdmin === DESATIVADO) return papelAdmin;
  // Valor desconhecido no banco: trata como sem acesso (falha fechada).
  return DESATIVADO;
}

/** Valor que vai pro banco (DONO e gravado como null). */
function papelParaBanco(papel) {
  return papel === DONO ? null : papel;
}

function papelPode(papel, acao) {
  const permitidos = MATRIZ[acao];
  if (!permitidos) throw new Error(`Acao de papel desconhecida: ${acao}`);
  return permitidos.includes(papelDe(papel));
}

/** Escrita fora das rotas liberadas pro papel? (camada 1). */
function escritaLiberadaPara(papel, caminho) {
  const p = papelDe(papel);
  if (p === DONO) return true;
  if (p === DESATIVADO) return false;
  const prefixos = PREFIXOS_ESCRITA[p] || [];
  return prefixos.some((pre) => caminho === pre || caminho.startsWith(pre.endsWith('/') ? pre : `${pre}/`));
}

/** Lista de acoes liberadas — vai pro front esconder o que nao pode. */
function acoesDoPapel(papel) {
  return ACOES.filter((a) => papelPode(papel, a));
}

module.exports = {
  DONO,
  SUPORTE,
  FINANCEIRO,
  DESATIVADO,
  PAPEIS,
  MATRIZ,
  ACOES,
  PREFIXOS_ESCRITA,
  papelDe,
  papelParaBanco,
  papelPode,
  escritaLiberadaPara,
  acoesDoPapel,
};
