// =====================================================================
// CADASTRO PROPRIO (self-service) — cria o negocio + o dono, com teste gratis.
// =====================================================================
// Substitui o antigo POST /autenticacao/registrar, que criava um usuario
// SOLTO com o perfil padrao do schema (ADMIN) — qualquer um na internet
// virava administrador do sistema. Aqui o usuario nasce sempre CLIENT e
// preso ao proprio Cliente.
//
// O admin continua podendo criar clientes pela tela dele (routes/clientes),
// que nascem ATIVA, sem teste.
// =====================================================================

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../prisma');
const { VERSAO_TERMOS, aceitouTermos } = require('../legal/versao');
const { modulosLiberadosPorSegmento } = require('../utils/modulosSegmento');
const { DIAS_DE_TRIAL } = require('../planos/catalogo');
const { DIA_MS } = require('../assinatura/situacao');

const SEGMENTOS_VALIDOS = ['SERVICO', 'PRODUTO', 'HIBRIDO'];
const SENHA_MINIMA = 8;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "Clínica Bem Estar!" -> "clinica-bem-estar" (so a-z, 0-9 e hifen, ate 40). */
function slugBase(texto) {
  const base = String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base || 'negocio';
}

/** Gera um slug livre: tenta o nome puro e, se ocupado, nome + sufixo curto. */
async function gerarSlugUnico(nome, client = prisma) {
  const base = slugBase(nome);
  const candidatos = [base, ...Array.from({ length: 5 }, () => `${base}-${crypto.randomBytes(2).toString('hex')}`)];
  for (const slug of candidatos) {
    const ocupado = await client.cliente.findUnique({ where: { slugPublico: slug }, select: { id: true } });
    if (!ocupado) return slug;
  }
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

/** Valida o corpo do cadastro. Retorna { erro, campos } ou { dados }. */
function validarCadastro(corpo = {}) {
  const nomeNegocio = typeof corpo.nomeNegocio === 'string' ? corpo.nomeNegocio.trim() : '';
  const nomeResponsavel = typeof corpo.nomeResponsavel === 'string' ? corpo.nomeResponsavel.trim() : '';
  const email = typeof corpo.email === 'string' ? corpo.email.trim().toLowerCase() : '';
  const senha = typeof corpo.senha === 'string' ? corpo.senha : '';
  const telefone = typeof corpo.telefone === 'string' ? corpo.telefone.replace(/\D/g, '') : '';
  const segmento = String(corpo.segmento || '').toUpperCase();

  const campos = [];
  if (nomeNegocio.length < 2 || nomeNegocio.length > 80) campos.push('nomeNegocio');
  if (nomeResponsavel.length < 2 || nomeResponsavel.length > 80) campos.push('nomeResponsavel');
  if (!EMAIL_RE.test(email) || email.length > 120) campos.push('email');
  if (senha.length < SENHA_MINIMA || senha.length > 128) campos.push('senha');
  // Letra no campo (ex.: o navegador preencheu com o e-mail) nao e telefone.
  const telefoneTemLetra = typeof corpo.telefone === 'string' && /[a-z@]/i.test(corpo.telefone);
  if (telefoneTemLetra || (telefone && (telefone.length < 10 || telefone.length > 13))) campos.push('telefone');
  if (!SEGMENTOS_VALIDOS.includes(segmento)) campos.push('segmento');
  if (!aceitouTermos(corpo)) campos.push('aceiteTermos');

  if (campos.length) {
    return {
      erro: campos.includes('senha')
        ? `Confira os campos destacados. A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`
        : campos.length === 1 && campos[0] === 'aceiteTermos'
          ? 'Para criar a conta, aceite os Termos de uso e a Política de privacidade.'
          : 'Confira os campos destacados.',
      campos,
    };
  }
  return { dados: { nomeNegocio, nomeResponsavel, email, senha, telefone: telefone || null, segmento } };
}

/**
 * Cria Cliente (TRIAL, plano Essencial contratado por padrao, mas usando o
 * Profissional durante o teste) + Usuario dono (CLIENT). Tudo numa transacao.
 * @returns {Promise<{ cliente, usuario }>}
 * @throws erro com status 400 e codigo EMAIL_EM_USO
 */
async function criarContaComTeste(dados, agora = new Date()) {
  const jaExiste = await prisma.usuario.findUnique({ where: { email: dados.email }, select: { id: true } });
  if (jaExiste) {
    throw Object.assign(new Error('Este e-mail já tem conta. Entre com ele ou use outro.'), { status: 400, codigo: 'EMAIL_EM_USO' });
  }

  const senhaHash = await bcrypt.hash(dados.senha, 12);
  const slugPublico = await gerarSlugUnico(dados.nomeNegocio);

  return prisma.$transaction(async (tx) => {
    const cliente = await tx.cliente.create({
      data: {
        nome: dados.nomeNegocio,
        email: dados.email,
        telefone: dados.telefone,
        segmento: dados.segmento,
        plano: 'BASIC',
        mensalidade: 0,
        modulosLiberados: modulosLiberadosPorSegmento(dados.segmento),
        statusAssinatura: 'TRIAL',
        trialAte: new Date(agora.getTime() + DIAS_DE_TRIAL * DIA_MS),
        slugPublico,
      },
    });
    const usuario = await tx.usuario.create({
      data: {
        nome: dados.nomeResponsavel,
        email: dados.email,
        senha: senhaHash,
        perfil: 'CLIENT', // explicito: o default do schema e ADMIN
        clienteId: cliente.id,
        deveTrocarSenha: false,
        termosAceitosEm: agora,
        versaoTermos: VERSAO_TERMOS,
      },
    });
    return { cliente, usuario };
  });
}

module.exports = { validarCadastro, criarContaComTeste, gerarSlugUnico, slugBase, SEGMENTOS_VALIDOS, SENHA_MINIMA };
