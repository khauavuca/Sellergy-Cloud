// Carrega .env de duas localizacoes (sem sobrescrever):
//   1) CWD — caminho que cobre `cd backend; npm run dev` se houver um .env aqui
//   2) raiz do projeto — onde o .env real vive em dev local
// Em producao (Docker) as vars ja vem do `env_file` do compose; ambas sao no-op.
const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
// Em producao nao sobe com segredo fraco, faltando ou valor de exemplo.
require('./seguranca/validarAmbiente').garantirAmbienteSeguro();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const rotasAutenticacao = require('./routes/auth.routes');
const rotasClientes = require('./routes/clientes.routes');
const rotasBots = require('./routes/bots.routes');
const rotasAlertas = require('./routes/alertas.routes');
const rotasCRM = require('./routes/crm.routes');
const rotasCredenciais = require('./routes/credenciais.routes');
const rotasBotVariables = require('./routes/bot-variables.routes');
const rotasUsuarios = require('./routes/usuarios.routes');
const rotasAgenda = require('./routes/agenda.routes');
const rotasEspecialistas = require('./routes/especialistas.routes');
const rotasCatalogo = require('./routes/catalogo.routes');
const rotasEstoque = require('./routes/estoque.routes');
const rotasFornecedores = require('./routes/fornecedores.routes');
const rotasNotasCompra = require('./routes/notas-compra.routes');
const rotasAdminCredenciais = require('./routes/admin-credenciais.routes');
const rotasAdminCredencialIA = require('./routes/admin-credencial-ia.routes');
const rotasFinanceiro = require('./routes/financeiro.routes');
const rotasContasPagar = require('./routes/contas-pagar.routes');
const rotasNotificacoes = require('./routes/notificacoes.routes');
const rotasRelatoriosMensais = require('./routes/relatorios-mensais.routes');
const rotasVendas = require('./routes/vendas.routes');
const rotasDevolucoes = require('./routes/devolucoes.routes');
const rotasCmv = require('./routes/cmv.routes');
const rotasRelatorios = require('./routes/relatorios.routes');
const rotasCampanhas = require('./routes/campanhas.routes');
const rotasPagamentos = require('./routes/pagamentos.routes');
const rotasFiscal = require('./routes/fiscal.routes');
const rotasWebhooks = require('./routes/webhooks.routes');
const rotasFaq = require('./routes/faq.routes');
const rotasWebhooksWhatsapp = require('./routes/webhooksWhatsapp.routes');
const CrmUsuariosController = require('./controllers/CrmUsuariosController');
const middlewareAutenticacao = require('./middlewares/auth.middleware');
const { SEGREDO_JWT } = require('./middlewares/auth.middleware');
const { limitadorApi } = require('./middlewares/rateLimit.middleware');
const middlewareCsrf = require('./middlewares/csrf.middleware');
const { nomeSessao, lerCookie } = require('./utils/sessaoCookie');
const { ehAdmin } = require('./middlewares/permissoes.middleware');
const prisma = require('./prisma');

// Origens permitidas por CORS. Em desenvolvimento, libera localhost.
// Em producao, exige a variavel CORS_ORIGINS (lista separada por virgula).
const origensPermitidas = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map((origem) => origem.trim())
  .filter(Boolean);

const opcoesCors = {
  origin: (origem, callback) => {
    // Requisicoes sem origem (ex.: curl, mobile, server-to-server) sao permitidas.
    if (!origem) return callback(null, true);
    if (origensPermitidas.includes(origem)) return callback(null, true);
    return callback(new Error(`Origem nao permitida pelo CORS: ${origem}`));
  },
  credentials: true,
};

const app = express();
// A API so recebe trafego pelo tunel do Cloudflare (cloudflared no host ou na
// rede do Docker) e pela propria maquina. Confia no X-Forwarded-For SO quando o
// salto vem de loopback/rede interna: antes ('trust proxy' 1) qualquer um que
// mandasse um X-Forwarded-For falso zerava o limite de tentativas de login.
// O IP real do visitante pelo tunel e lido em seguranca/ipCliente.js.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
const servidor = http.createServer(app);
const io = new Server(servidor, {
  cors: opcoesCors,
});

// Autenticacao do Socket.IO via JWT no handshake.
io.use((socket, next) => {
  // Mesma ordem do middleware HTTP: cookie httpOnly primeiro (navegador),
  // depois as formas explicitas usadas por clientes fora do navegador.
  const token = lerCookie(socket.handshake, nomeSessao(socket.handshake))
    || socket.handshake?.auth?.token
    || socket.handshake?.headers?.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    return next(new Error('Token nao fornecido'));
  }

  try {
    const dados = jwt.verify(token, SEGREDO_JWT);
    // So token de sessao (o desafio do 2FA nao abre o tempo real).
    if (!dados?.id || !dados?.perfil || dados.etapa) return next(new Error('Token invalido'));
    // Sessao de suporte (so leitura) nao abre o tempo real: ali ha eventos que escrevem.
    if (dados.suporte) return next(new Error('Sessao de suporte nao usa o tempo real'));
    socket.usuario = dados;
    return next();
  } catch (erro) {
    return next(new Error('Token invalido ou expirado'));
  }
});

// Erros sempre com `erro` e sem detalhe interno no 5xx (seguranca/respostaSegura.js).
const { mensagemPadronizada, tratadorFinal } = require('./seguranca/respostaSegura');
app.use(mensagemPadronizada);
app.use(helmet());
app.use(cors(opcoesCors));

// Captura o corpo cru (rawBody) junto do parse JSON — necessario pros webhooks
// de PSP que validam assinatura HMAC sobre o payload original (Frente 2).
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Defesa contra CSRF — obrigatoria porque a sessao vive em cookie e o navegador
// o envia sozinho. Registrado no nivel do app para que nenhuma rota nova nasca
// desprotegida por esquecimento. Detalhes e isencoes no proprio middleware.
app.use(middlewareCsrf);

// Imagens — intercepta `res.json` e troca `imagemUrl` por URL assinada
// (bucket privado + pre-signed URL). Plugado APOS o parser e ANTES das
// rotas autenticadas pra cobrir todas elas.
const imagensAssinadasMiddleware = require('./middlewares/imagensAssinadas.middleware');
app.use(imagensAssinadasMiddleware);

// Injecao do Socket.io nas requisicoes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Rate limiting geral da API — defesa contra flood/DoS nos endpoints (agregacoes
// caras rodavam sem teto). Webhooks e /saude ficam de fora (ver o middleware).
app.use(limitadorApi);

// Rotas Base
app.use('/autenticacao', rotasAutenticacao);
app.use('/usuarios', rotasUsuarios);

// Gerenciamento de Usuarios do Cliente (CRM)
const routerCrmUsuarios = express.Router();
routerCrmUsuarios.use(middlewareAutenticacao);
routerCrmUsuarios.get('/', (req, res) => CrmUsuariosController.listar(req, res));
routerCrmUsuarios.post('/', (req, res) => CrmUsuariosController.criar(req, res));
routerCrmUsuarios.put('/:id', (req, res) => CrmUsuariosController.atualizar(req, res));
routerCrmUsuarios.delete('/:id', (req, res) => CrmUsuariosController.excluir(req, res));
app.use('/crm/usuarios', routerCrmUsuarios);

app.use('/clientes', rotasClientes);
app.use('/bots', rotasBots);
app.use('/alertas', rotasAlertas);
app.use('/crm', rotasCRM);
app.use('/credenciais', rotasCredenciais);
app.use('/bot-variables', rotasBotVariables);
app.use('/agenda', rotasAgenda);
app.use('/especialistas', rotasEspecialistas);
app.use('/catalogo', rotasCatalogo);
app.use('/estoque', rotasEstoque);
app.use('/fornecedores', rotasFornecedores);
app.use('/notas-compra', rotasNotasCompra);
// Admin gerencia as integracoes (credenciais) de cada cliente — rota segura, admin-only.
// Com a API do painel num endereco proprio (API_PAINEL_HOSTS), as rotas de
// admin nem existem no endereco do site.
{
  const { hostsPainel } = require('./seguranca/acessoAdmin');
  app.use('/admin', (req, res, next) => {
    const hosts = hostsPainel();
    if (hosts.length && !hosts.includes(String(req.hostname || '').toLowerCase())) return res.status(404).json({ erro: 'Rota não encontrada' });
    return next();
  });
}
app.use('/admin/clientes', rotasAdminCredenciais);
// Credencial de IA da PLATAFORMA (uma so, da Sellergy) — rota separada da
// acima porque nao pertence a nenhum cliente.
app.use('/admin/plataforma', rotasAdminCredencialIA);
app.use('/financeiro', rotasFinanceiro);
app.use('/contas-pagar', rotasContasPagar);
app.use('/notificacoes', rotasNotificacoes);
app.use('/relatorios-mensais', rotasRelatoriosMensais);
app.use('/vendas', rotasVendas);
app.use('/devolucoes', rotasDevolucoes);
app.use('/relatorios', rotasRelatorios);
app.use('/campanhas', rotasCampanhas);
app.use('/faq', rotasFaq);
app.use('/pagamentos', rotasPagamentos);
app.use('/fiscal', rotasFiscal);
// Fase 1: conta (plano, assinatura, assistente de inicio) e rotas publicas
// (agendamento pelo link, confirmacao do lembrete, planos da landing).
app.use('/conta', require('./routes/conta.routes'));
// Fase 2 (rotas publicas mais especificas antes de /publico).
app.use('/publico/encaixe', require('./routes/publicoEncaixe.routes'));
app.use('/publico/loja', require('./routes/publicoCatalogo.routes'));
app.use('/publico/convite', require('./routes/publicoConvite.routes'));
app.use('/publico', require('./routes/publico.routes'));
app.use('/encaixe', require('./routes/encaixe.routes'));
app.use('/pacotes', require('./routes/pacotes.routes'));
app.use('/comissoes', require('./routes/comissoes.routes'));
app.use('/pedidos', require('./routes/pedidos.routes'));
app.use('/conta-recebimento', require('./routes/contaRecebimento.routes'));
app.use('/importacao', require('./routes/importacao.routes'));
app.use('/convites', require('./routes/convites.routes'));
app.use('/hoje', require('./routes/hoje.routes'));
app.use('/suporte', require('./routes/suporte.routes'));
app.use('/comunicados', require('./routes/comunicados.routes'));
// Caixa de entrada do WhatsApp (tela /app/whatsapp).
app.use('/conversas', require('./routes/conversas.routes'));
app.use('/admin/suporte', require('./routes/adminSuporte.routes'));
app.use('/admin/saude', require('./routes/adminSaude.routes'));
app.use('/admin/comunicados', require('./routes/adminComunicados.routes'));
app.use('/admin/uso', require('./routes/adminUso.routes'));
app.use('/admin/equipe', require('./routes/adminEquipe.routes'));
app.use('/admin/planos', require('./routes/adminPlanos.routes'));
app.use('/admin/assinaturas', require('./routes/assinaturas.routes'));

// Webhooks externos — SEM autenticacao de usuario (o chamador e o provedor/Meta;
// a autenticidade vem da assinatura/verify token validada no handler).
app.use('/webhooks', rotasWebhooks);          // pagamento (Frente 2)
app.use('/webhooks', rotasWebhooksWhatsapp);  // whatsapp (Frente 4)

// Rota de Teste de Saude (Health Check)
app.get('/saude', (req, res) => {
  res.json({ status: 'ok', data: new Date() });
});

// Ultimo da cadeia: erro nao tratado (CORS, JSON quebrado, excecao) vira JSON seguro.
app.use(tratadorFinal);

io.on('connection', (socket) => {
  console.log('Novo cliente conectado:', socket.id, 'usuario:', socket.usuario?.id);

  // Sala do negocio (tenant): eventos de bot (bot_atualizado/criado/deletado)
  // vao so pra quem e do mesmo cliente — nunca io.emit global. Admin da
  // plataforma entra na sala "admins".
  if (ehAdmin(socket.usuario)) socket.join('admins');
  else if (socket.usuario?.clienteId) socket.join(`cliente:${socket.usuario.clienteId}`);

  // Sala por bot — usada SO pelo pareamento Baileys (QR code + status), que
  // precisa ficar restrito a quem e dono do bot. Transmitir um QR code
  // escaneavel pra qualquer sessao logada de
  // QUALQUER tenant seria uma falha real de isolamento — quem escanear
  // primeiro pareia. Por isso valida o dono do bot antes de entrar na sala.
  socket.on('join_bot', async (botId) => {
    try {
      if (typeof botId !== 'string' || !botId) return;
      const bot = await prisma.bot.findFirst({
        where: ehAdmin(socket.usuario) ? { id: botId } : { id: botId, clienteId: socket.usuario?.clienteId },
        select: { id: true },
      });
      if (bot) socket.join(`bot:${botId}`);
    } catch (e) {
      console.error('[socket join_bot]', e?.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Relay worker -> backend -> socket.io: o worker.js (processo separado, sem
// req.io) publica eventos de conexao Baileys (QR/status) no Redis; aqui a
// gente repassa pra sala do bot correspondente. Ver
// services/baileys/gerenciadorConexao.js (quem publica).
(function iniciarRelayBaileys() {
  const IORedis = require('ioredis');
  const assinante = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
  assinante.subscribe('baileys:eventos').catch((e) => console.error('[relay baileys] falha ao assinar canal', e?.message));
  assinante.on('message', (_canal, mensagem) => {
    try {
      const { botId, tipo, dados } = JSON.parse(mensagem);
      io.to(`bot:${botId}`).emit(tipo, dados);
    } catch (e) {
      console.error('[relay baileys] mensagem invalida', e?.message);
    }
  });
})();

// Tempo real da caixa de entrada do WhatsApp: sala conversas:<clienteId>
// (join validado no banco) + relay Redis dos eventos da API e do worker.
require('./conversas/tempoReal').ligarTempoReal(io);

// Rota que nao existe: JSON curto (sem a pagina padrao do Express).
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

// Erros que escaparam das rotas: resposta curta, sem stack trace nem caminho
// de arquivo (o Express em modo dev devolvia o erro inteiro em HTML).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (/Origem nao permitida pelo CORS/.test(err?.message || '')) return res.status(403).json({ erro: 'Origem não permitida.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Corpo da requisição inválido.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ erro: 'Requisição grande demais.' });
  const status = Number(err?.status || err?.statusCode);
  if (status >= 400 && status < 500) return res.status(status).json({ erro: 'Requisição inválida.' });
  console.error('[erro nao tratado]', req.method, req.originalUrl, err?.message || err);
  return res.status(500).json({ erro: 'Erro interno. Tente de novo em instantes.' });
});

const PORTA = process.env.BACKEND_PORT || 3333;

servidor.listen(PORTA, async () => {
  console.log(`Servidor rodando na porta ${PORTA}`);
  // Garante que o bucket de midias existe (privado — acesso via URL assinada).
  try {
    const { garantirBucket } = require('./storage/minio');
    const r = await garantirBucket();
    if (r.criado) console.log('[boot] Bucket de midias criado.');
  } catch (e) {
    console.error('[boot] Falha ao garantir bucket:', e?.message);
  }

  // Cron diario do caixa (00:01) — fecha sessoes AUTO_BOT e abre novas com
  // fundo = saldo final. Manual fica intocado.
  try {
    const { iniciar: iniciarCronCaixa } = require('./jobs/cronCaixaDiario');
    iniciarCronCaixa();
  } catch (e) {
    console.error('[boot] Falha ao inicializar cron diario do caixa:', e?.message);
  }

  // Cron mensal — dia 1 (aviso), dia 5 (aviso) e dia 7 (gera snapshot do
  // mês anterior + notifica que está pronto). Roda 03:00 BRT todo dia.
  try {
    const { iniciar: iniciarCronMensal } = require('./jobs/cronRelatorioMensal');
    iniciarCronMensal();
  } catch (e) {
    console.error('[boot] Falha ao inicializar cron mensal:', e?.message);
  }

  // Cron de aviso de devolução (aluguel) — roda 08:00 BRT todo dia. Alerta na
  // plataforma + tentativa de WhatsApp pro cliente final quando a data de
  // devolução se aproxima (ver Cliente.diasAvisoDevolucao).
  try {
    const { iniciar: iniciarCronDevolucoes } = require('./jobs/cronDevolucoes');
    iniciarCronDevolucoes();
  } catch (e) {
    console.error('[boot] Falha ao inicializar cron de devoluções:', e?.message);
  }

  // Campanhas agendadas: confere a cada minuto e dispara as que venceram.
  try {
    require('./jobs/cronCampanhasAgendadas').iniciar();
  } catch (e) {
    console.error('[boot] Falha ao inicializar campanhas agendadas:', e?.message);
  }

  // Suporte: apaga a conversa dos chamados resolvidos ha mais de 7 dias
  // (as fotos ja somem ao resolver). Ver suporte/anexos.js.
  try {
    require('./jobs/cronLimpezaSuporte').iniciar();
  } catch (e) {
    console.error('[boot] Falha ao inicializar limpeza do suporte:', e?.message);
  }
});

const { fecharFilas } = require('./filas');

async function encerrar(sinal) {
  console.log(`Sinal ${sinal} recebido, encerrando servidor...`);
  servidor.close(() => console.log('HTTP fechado.'));
  try {
    await fecharFilas();
  } catch (erro) {
    console.error('Erro ao fechar filas:', erro);
  }
  process.exit(0);
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
