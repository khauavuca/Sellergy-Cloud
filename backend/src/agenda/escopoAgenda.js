// Escopo da AGENDA ("todos" ou "so os proprios"), num lugar so pra agenda,
// fila de encaixe e pacotes usarem a MESMA regra.
//   ADMIN do sistema, dono (CLIENT) e ADMINISTRADOR: veem tudo.
//   Demais (VENDEDOR / profissional com login): escopo das permissoes do
//   usuario lidas do BANCO (nao do login, que pode estar velho). PROPRIAS =
//   so o especialista vinculado a ele; sem especialista, nada.

const prisma = require('../prisma');
const { ehAdmin, escopoDoUsuario } = require('../middlewares/permissoes.middleware');

const SEM_ESPECIALISTA = '__sem_especialista__';

/**
 * @returns {Promise<null | string>} null = ve tudo; senao o id do especialista
 *   do usuario (ou SEM_ESPECIALISTA, que nao casa com nada).
 */
async function especialistaDoEscopo(req) {
  const u = req.usuario;
  if (!u || ehAdmin(u) || u.perfil === 'CLIENT' || u.perfil === 'ADMINISTRADOR') return null;
  if (req._escopoAgenda !== undefined) return req._escopoAgenda;
  const dados = await prisma.usuario.findUnique({
    where: { id: u.id },
    select: { permissoes: true, especialista: { select: { id: true } } },
  });
  const escopo = escopoDoUsuario(u, dados?.permissoes || {}, 'AGENDA');
  const valor = escopo === 'TODAS' ? null : (dados?.especialista?.id || SEM_ESPECIALISTA);
  req._escopoAgenda = valor;
  return valor;
}

/** Filtro Prisma do agendamento conforme o escopo ({} quando ve tudo). */
async function escopoAgendaWhere(req) {
  const esp = await especialistaDoEscopo(req);
  return esp ? { especialistaId: esp } : {};
}

module.exports = { especialistaDoEscopo, escopoAgendaWhere, SEM_ESPECIALISTA };
