const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { SEGREDO_JWT } = require('../middlewares/auth.middleware');
const { definirSessao, garantirCsrf, limparSessao } = require('../utils/sessaoCookie');
const { validarCadastro, criarContaComTeste } = require('../onboarding/cadastro');
const totp = require('../seguranca/totp');
const acessoAdmin = require('../seguranca/acessoAdmin');

const roteador = express.Router();

// Limitador agressivo para login: protege contra brute force.
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // 10 tentativas por IP por janela
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Tente novamente em alguns minutos.' }
});

// Limitador do cadastro proprio: evita criacao de contas em massa.
const limitadorCadastro = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de cadastro. Tente novamente mais tarde.' }
});

// Cadastro proprio: cria o NEGOCIO (com 14 dias de teste) e o dono, e ja
// entra logado. Substitui o antigo /registrar, que criava um usuario solto
// com o perfil padrao do schema (ADMIN) — qualquer um virava admin do
// sistema. Ver src/onboarding/cadastro.js.
roteador.post('/cadastro', limitadorCadastro, async (req, res) => {
  try {
    const { erro, campos, dados } = validarCadastro(req.body);
    if (erro) return res.status(422).json({ erro, campos });

    const { usuario } = await criarContaComTeste(dados);
    const token = jwt.sign(
      { id: usuario.id, perfil: usuario.perfil, clienteId: usuario.clienteId },
      SEGREDO_JWT,
      { expiresIn: '7d' }
    );
    const csrfToken = definirSessao(res, token);
    const corpo = await montarUsuarioDaSessao(usuario);
    res.status(201).json({ usuario: corpo, csrfToken });
  } catch (erro) {
    if (erro.codigo === 'EMAIL_EM_USO') return res.status(400).json({ erro: erro.message, campos: ['email'], codigo: erro.codigo });
    console.error('[auth/cadastro]', erro);
    res.status(500).json({ erro: 'Erro ao criar a conta. Tente de novo.' });
  }
});

// O antigo registro aberto foi desligado de proposito (criava ADMIN).
roteador.post('/registrar', (req, res) => {
  res.status(410).json({ erro: 'Rota desativada. Use /autenticacao/cadastro.', codigo: 'ROTA_DESATIVADA' });
});

// Mesmo corpo de usuario que o /login devolve.
async function montarUsuarioDaSessao(usuario) {
  let modulosLiberados = null;
  let branding = null;
  let segmento = null;
  if (usuario.clienteId) {
    const cliente = await prisma.cliente.findUnique({
      where: { id: usuario.clienteId },
      select: { modulosLiberados: true, segmento: true, brandLogo: true, brandNome: true }
    });
    modulosLiberados = cliente?.modulosLiberados || {};
    segmento = cliente?.segmento || null;
    branding = { logo: cliente?.brandLogo || null, nome: cliente?.brandNome || null };
  }
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    clienteId: usuario.clienteId || null,
    deveTrocarSenha: usuario.deveTrocarSenha === true,
    foto: usuario.foto || null,
    modulosLiberados,
    segmento,
    branding,
  };
}

// Monta a sessao (cookie httpOnly) e a resposta de login. `mfa` marca que o
// usuario passou pelo segundo fator — exigido pro ADMIN quando
// ADMIN_2FA_OBRIGATORIO=true (ver auth.middleware).
async function responderSessao(res, usuario, { mfa = false, status = 200 } = {}) {
  // Equipe Sellergy com o acesso desativado pelo dono (Equipe e auditoria).
  if (usuario.perfil === 'ADMIN' && usuario.papelAdmin === 'DESATIVADO') {
    return res.status(403).json({ erro: 'Seu acesso ao painel foi desativado.', codigo: 'ADMIN_DESATIVADO' });
  }
  const token = jwt.sign(
    { id: usuario.id, perfil: usuario.perfil, clienteId: usuario.clienteId, mfa },
    SEGREDO_JWT,
    { expiresIn: usuario.perfil === 'ADMIN' ? '12h' : '7d' }
  );

  let modulosLiberados = null;
  let branding = null;
  let segmento = null;
  if (usuario.clienteId) {
    const cliente = await prisma.cliente.findUnique({
      where: { id: usuario.clienteId },
      select: { modulosLiberados: true, segmento: true, brandLogo: true, brandNome: true }
    });
    modulosLiberados = cliente?.modulosLiberados || {};
    segmento = cliente?.segmento || null;
    branding = { logo: cliente?.brandLogo || null, nome: cliente?.brandNome || null };
  }

  // O token vai para um cookie httpOnly e NAO volta no corpo: assim ele fica
  // fora do alcance do JavaScript e um XSS nao consegue roubar a sessao.
  // No lugar dele devolvemos o segredo de CSRF, que o front guarda em memoria.
  const csrfToken = definirSessao(res, token);

  res.status(status).json({
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      clienteId: usuario.clienteId || null,
      deveTrocarSenha: usuario.deveTrocarSenha === true,
      foto: usuario.foto || null,
      totpAtivo: usuario.totpAtivo === true,
      modulosLiberados,
      segmento,
      branding,
    },
    csrfToken
  });
}

roteador.post('/login', limitadorLogin, async (req, res) => {
  try {
    const { email, senha } = req.body || {};

    if (!email || !senha || typeof email !== 'string' || typeof senha !== 'string') {
      return res.status(400).json({ erro: 'E-mail e senha sao obrigatorios' });
    }

    const usuario = await prisma.usuario.findUnique({ where: { email } });
    const ehAdmin = usuario?.perfil === 'ADMIN';

    if (ehAdmin) {
      const resta = await acessoAdmin.segundosBloqueado(usuario.id);
      if (resta) return res.status(429).json({ erro: acessoAdmin.mensagemBloqueio(resta) });
    }

    // Mantem tempo de resposta similar entre "usuario inexistente" e "senha errada"
    // para nao expor enumeracao de usuarios via timing.
    const hashComparacao = usuario?.senha || '$2a$12$invalidplaceholderhashinvalidplaceholderhashinvalida';
    const senhaValida = await bcrypt.compare(senha, hashComparacao);

    // Conta ADMIN fora do site do painel recebe a mesma resposta de senha
    // errada e conta como erro: quem tenta pelo site do cliente nao descobre nada.
    const origemRecusada = ehAdmin && !acessoAdmin.origemLiberada(req.get('origin'));
    if (!usuario || !senhaValida || origemRecusada) {
      if (ehAdmin) {
        const travou = await acessoAdmin.registrarFalha(usuario.id);
        acessoAdmin.auditar(req, usuario, travou ? 'ADMIN_LOGIN_BLOQUEADO' : 'ADMIN_LOGIN_FALHOU', {
          motivo: !senhaValida ? 'senha' : 'origem',
        });
      }
      return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
    }

    // Segundo fator: a senha so libera um "desafio" de 5 minutos; a sessao
    // sai em /login/2fa com o codigo do app autenticador.
    if (usuario.totpAtivo) {
      const desafio = jwt.sign({ id: usuario.id, etapa: '2fa' }, SEGREDO_JWT, { expiresIn: '5m' });
      return res.json({ precisa2fa: true, desafio });
    }

    if (ehAdmin) {
      await acessoAdmin.limparFalhas(usuario.id);
      acessoAdmin.auditar(req, usuario, 'ADMIN_LOGIN', { mfa: false });
    }
    await responderSessao(res, usuario, { mfa: false });
  } catch (erro) {
    console.error('[auth/login]', erro);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
});

// Segunda etapa do login com 2FA.
roteador.post('/login/2fa', limitadorLogin, async (req, res) => {
  try {
    const { desafio, codigo } = req.body || {};
    let dados;
    try {
      dados = jwt.verify(String(desafio || ''), SEGREDO_JWT);
    } catch {
      return res.status(401).json({ erro: 'O tempo para digitar o código acabou. Entre de novo.' });
    }
    if (dados.etapa !== '2fa') return res.status(401).json({ erro: 'Desafio invalido.' });

    const usuario = await prisma.usuario.findUnique({ where: { id: dados.id } });
    if (!usuario?.totpAtivo || !usuario.totpSegredoCifrado) return res.status(401).json({ erro: 'Desafio invalido.' });

    const ehAdmin = usuario.perfil === 'ADMIN';
    if (ehAdmin) {
      const resta = await acessoAdmin.segundosBloqueado(usuario.id);
      if (resta) return res.status(429).json({ erro: acessoAdmin.mensagemBloqueio(resta) });
      if (!acessoAdmin.origemLiberada(req.get('origin'))) return res.status(401).json({ erro: 'Desafio invalido.' });
    }

    if (!(await conferirCodigoTotp(usuario, codigo))) {
      if (ehAdmin) {
        const travou = await acessoAdmin.registrarFalha(usuario.id);
        acessoAdmin.auditar(req, usuario, travou ? 'ADMIN_LOGIN_BLOQUEADO' : 'ADMIN_LOGIN_FALHOU', { motivo: 'codigo' });
      }
      return res.status(401).json({ erro: 'Código incorreto.' });
    }
    if (ehAdmin) {
      await acessoAdmin.limparFalhas(usuario.id);
      acessoAdmin.auditar(req, usuario, 'ADMIN_LOGIN', { mfa: true });
    }
    await responderSessao(res, usuario, { mfa: true });
  } catch (erro) {
    console.error('[auth/login/2fa]', erro);
    res.status(500).json({ erro: 'Erro ao conferir o código' });
  }
});

// ---------- 2FA: configurar / ativar / desativar ----------

let redisTotp = null;
function obterRedisTotp() {
  if (!redisTotp) {
    const IORedis = require('ioredis');
    redisTotp = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 2 });
    redisTotp.on('error', () => {});
  }
  return redisTotp;
}

// Confere o codigo e queima o passo usado (o mesmo codigo nao entra 2 vezes).
async function conferirCodigoTotp(usuario, codigo) {
  const segredo = totp.decifrarSegredo(usuario.id, usuario.totpSegredoCifrado);
  const chave = `totp:ultimo:${usuario.id}`;
  const ultimo = Number(await obterRedisTotp().get(chave).catch(() => null)) || null;
  const passo = totp.verificarCodigo(segredo, codigo, { ultimoPassoUsado: ultimo });
  if (passo === null) return false;
  await obterRedisTotp().set(chave, String(passo), 'EX', 300).catch(() => {});
  return true;
}

roteador.post('/2fa/configurar', middlewareAutenticacao, limitadorLogin, async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { id: true, email: true, totpAtivo: true } });
    if (!usuario) return res.status(404).json({ erro: 'Usuario nao encontrado' });
    if (usuario.totpAtivo) return res.status(409).json({ erro: 'O código em 2 etapas já está ativo.' });
    const segredo = totp.gerarSegredo();
    await prisma.usuario.update({ where: { id: usuario.id }, data: { totpSegredoCifrado: totp.cifrarSegredo(usuario.id, segredo), totpAtivo: false } });
    const otpauth = totp.urlOtpauth({ segredo, conta: usuario.email, emissor: req.usuario.perfil === 'ADMIN' ? 'Sellergy Admin' : 'Sellergy' });
    const qrCode = await require('qrcode').toDataURL(otpauth);
    res.json({ segredo, otpauth, qrCode });
  } catch (erro) {
    console.error('[auth/2fa/configurar]', erro);
    res.status(500).json({ erro: 'Erro ao configurar o código em 2 etapas' });
  }
});

roteador.post('/2fa/ativar', middlewareAutenticacao, limitadorLogin, async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario?.totpSegredoCifrado) return res.status(400).json({ erro: 'Configure primeiro.' });
    if (!(await conferirCodigoTotp(usuario, req.body?.codigo))) {
      return res.status(422).json({ erro: 'Código incorreto. Confira o horário do celular e tente de novo.' });
    }
    const atualizado = await prisma.usuario.update({ where: { id: usuario.id }, data: { totpAtivo: true } });
    // Sessao nova ja marcada com o segundo fator.
    await responderSessao(res, atualizado, { mfa: true });
  } catch (erro) {
    console.error('[auth/2fa/ativar]', erro);
    res.status(500).json({ erro: 'Erro ao ativar o código em 2 etapas' });
  }
});

roteador.post('/2fa/desativar', middlewareAutenticacao, limitadorLogin, async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario?.totpAtivo) return res.status(400).json({ erro: 'O código em 2 etapas não está ativo.' });
    if (usuario.perfil === 'ADMIN' && process.env.ADMIN_2FA_OBRIGATORIO === 'true') {
      return res.status(403).json({ erro: 'Para o administrador o código em 2 etapas é obrigatório.' });
    }
    const senhaOk = await bcrypt.compare(String(req.body?.senha || ''), usuario.senha);
    if (!senhaOk || !(await conferirCodigoTotp(usuario, req.body?.codigo))) {
      return res.status(401).json({ erro: 'Senha ou código incorretos.' });
    }
    await prisma.usuario.update({ where: { id: usuario.id }, data: { totpAtivo: false, totpSegredoCifrado: null } });
    res.json({ ok: true });
  } catch (erro) {
    console.error('[auth/2fa/desativar]', erro);
    res.status(500).json({ erro: 'Erro ao desativar o código em 2 etapas' });
  }
});

// Encerra a sessao apagando os cookies. Passou a ser obrigatorio no servidor:
// com o token em cookie httpOnly, o front nao tem como remove-lo sozinho.
// Sem autenticacao de proposito — a rota so apaga os cookies de quem chamou, e
// exigir sessao valida impediria a limpeza justamente no caso em que ela mais
// importa (cookie corrompido ou token vencido).
roteador.post('/logout', (req, res) => {
  limparSessao(res);
  res.json({ mensagem: 'Sessao encerrada.' });
});

roteador.get('/perfil', middlewareAutenticacao, async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.usuario.id },
      select: {
        id: true,
        nome: true,
        email: true,
        perfil: true,
        clienteId: true,
        deveTrocarSenha: true,
        permissoes: true,
        foto: true,
        totpAtivo: true,
        papelAdmin: true,
      }
    });
    if (!usuario) return res.status(404).json({ erro: 'Usuario nao encontrado' });
    // Papel na equipe Sellergy (so ADMIN) e sessao de suporte (frente D).
    const { papelDe, acoesDoPapel } = require('../seguranca/papeis');
    const papelAdmin = usuario.perfil === 'ADMIN' ? papelDe(usuario.papelAdmin) : null;
    const extrasAdmin = usuario.perfil === 'ADMIN'
      ? { papelAdmin, acoesAdmin: acoesDoPapel(papelAdmin), exige2faIndividual: usuario.permissoes?.exige2fa === true }
      : { papelAdmin: null };
    delete usuario.papelAdmin;

    // Carrega modulos liberados, segmento, branding e horario do tenant.
    let modulosLiberados = null;
    let branding = null;
    let horarioFuncionamento = null;
    let segmento = null;
    if (usuario.clienteId) {
      const cliente = await prisma.cliente.findUnique({
        where: { id: usuario.clienteId },
        select: { modulosLiberados: true, segmento: true, status: true, brandLogo: true, brandNome: true, horarioFuncionamento: true }
      });
      modulosLiberados = cliente?.modulosLiberados || {};
      segmento = cliente?.segmento || null;
      branding = { logo: cliente?.brandLogo || null, nome: cliente?.brandNome || null };
      horarioFuncionamento = cliente?.horarioFuncionamento || null;
    }

    res.json({
      ...usuario,
      clienteId: usuario.clienteId || null,
      modulosLiberados,
      segmento,
      branding,
      horarioFuncionamento,
      ...extrasAdmin,
      suporte: req.usuario.suporte || null,
      mfa: req.usuario.mfa === true,
      admin2faObrigatorio: process.env.ADMIN_2FA_OBRIGATORIO === 'true' || extrasAdmin.exige2faIndividual === true,
      // Reentrega o segredo de CSRF: o front guarda so em memoria, entao a cada
      // recarga da pagina ele precisa receber o valor de novo por aqui.
      csrfToken: req.sessaoPorCookie ? garantirCsrf(req, res) : null,
    });
  } catch (erro) {
    console.error('[auth/perfil]', erro);
    res.status(500).json({ erro: 'Erro ao buscar perfil' });
  }
});

// Permite ao usuario logado trocar a propria senha.
// Tambem zera a flag deveTrocarSenha.
roteador.post('/trocar-senha', middlewareAutenticacao, async (req, res) => {
  try {
    const { senhaAtual, novaSenha } = req.body;

    if (!senhaAtual || !novaSenha) {
      return res.status(400).json({ erro: 'senhaAtual e novaSenha sao obrigatorias.' });
    }

    if (typeof novaSenha !== 'string' || novaSenha.length < 6) {
      return res.status(400).json({ erro: 'A nova senha deve ter ao menos 6 caracteres.' });
    }

    if (senhaAtual === novaSenha) {
      return res.status(400).json({ erro: 'A nova senha deve ser diferente da atual.' });
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) return res.status(404).json({ erro: 'Usuario nao encontrado.' });

    const senhaConfere = await bcrypt.compare(senhaAtual, usuario.senha);
    if (!senhaConfere) {
      return res.status(401).json({ erro: 'Senha atual incorreta.' });
    }

    const novaHash = await bcrypt.hash(novaSenha, 12);

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        senha: novaHash,
        deveTrocarSenha: false,
      }
    });

    res.json({ mensagem: 'Senha atualizada com sucesso.' });
  } catch (erro) {
    console.error('[auth/trocar-senha]', erro);
    res.status(500).json({ erro: 'Erro ao trocar senha.' });
  }
});

// Atualiza dados pessoais do usuario logado (nome, email, foto).
// Nao permite mudar perfil/permissoes/clienteId (proteger contra escalada).
roteador.put('/perfil', middlewareAutenticacao, async (req, res) => {
  try {
    const { nome, email, foto } = req.body;
    const dataUpdate = {};
    if (nome !== undefined) dataUpdate.nome = nome;
    if (email !== undefined) dataUpdate.email = email;
    if (foto !== undefined) dataUpdate.foto = foto || null;

    const usuario = await prisma.usuario.update({
      where: { id: req.usuario.id },
      data: dataUpdate,
      select: { id: true, nome: true, email: true, perfil: true, foto: true, clienteId: true }
    });

    res.json(usuario);
  } catch (erro) {
    console.error('[auth/perfil-put]', erro);
    if (erro.code === 'P2002') {
      return res.status(400).json({ erro: 'Este e-mail ja esta em uso.' });
    }
    res.status(500).json({ erro: 'Erro ao atualizar perfil.' });
  }
});

// Atualiza branding (logo + nome customizado) do tenant do usuario logado.
// Apenas CLIENT (dono da conta) pode atualizar branding.
roteador.put('/branding', middlewareAutenticacao, async (req, res) => {
  try {
    if (req.usuario.perfil !== 'CLIENT') {
      return res.status(403).json({ erro: 'Apenas o dono da conta pode alterar a marca.' });
    }
    if (!req.usuario.clienteId) {
      return res.status(400).json({ erro: 'Usuario sem tenant.' });
    }

    const { brandLogo, brandNome } = req.body;
    const cliente = await prisma.cliente.update({
      where: { id: req.usuario.clienteId },
      data: {
        brandLogo: brandLogo === undefined ? undefined : (brandLogo || null),
        brandNome: brandNome === undefined ? undefined : (brandNome || null),
      },
      select: { id: true, brandLogo: true, brandNome: true }
    });

    res.json({ logo: cliente.brandLogo, nome: cliente.brandNome });
  } catch (erro) {
    console.error('[auth/branding]', erro);
    res.status(500).json({ erro: 'Erro ao atualizar marca.' });
  }
});

// Atualiza horario de funcionamento do tenant (usado pelo cron diario do
// caixa e por outras automacoes). So CLIENT (dono) pode editar.
// Formato esperado: { abertura: 'HH:MM', fechamento: 'HH:MM', dias: [0-6] }
roteador.put('/horario-funcionamento', middlewareAutenticacao, async (req, res) => {
  try {
    if (req.usuario.perfil !== 'CLIENT' && req.usuario.perfil !== 'ADMINISTRADOR') {
      return res.status(403).json({ erro: 'Apenas o dono da conta ou administradores podem alterar o horario.' });
    }
    if (!req.usuario.clienteId) {
      return res.status(400).json({ erro: 'Usuario sem tenant.' });
    }

    const { abertura, fechamento, dias } = req.body;
    // Valida formato HH:MM (basico — front ja restringe via type="time").
    const ehHora = (h) => typeof h === 'string' && /^\d{1,2}:\d{2}$/.test(h);
    if (abertura && !ehHora(abertura)) return res.status(422).json({ erro: 'abertura invalida (use HH:MM)' });
    if (fechamento && !ehHora(fechamento)) return res.status(422).json({ erro: 'fechamento invalido (use HH:MM)' });

    // dias = array de 0-6 (0=domingo, 6=sabado). Default = seg-sab.
    let diasValidos = [1, 2, 3, 4, 5, 6];
    if (Array.isArray(dias)) {
      diasValidos = dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    }

    const horarioFuncionamento = {
      abertura: abertura || '08:00',
      fechamento: fechamento || '18:00',
      dias: diasValidos,
    };

    const cliente = await prisma.cliente.update({
      where: { id: req.usuario.clienteId },
      data: { horarioFuncionamento },
      select: { id: true, horarioFuncionamento: true },
    });

    res.json({ horarioFuncionamento: cliente.horarioFuncionamento });
  } catch (erro) {
    console.error('[auth/horario-funcionamento]', erro);
    res.status(500).json({ erro: 'Erro ao atualizar horario.' });
  }
});

module.exports = roteador;
// Usado tambem pelo aceite de convite (routes/publicoConvite.routes.js).
module.exports.responderSessao = responderSessao;
