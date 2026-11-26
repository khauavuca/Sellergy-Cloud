// Validacao das variaveis de ambiente no boot.
//
// Em PRODUCAO (NODE_ENV=production) o processo NAO sobe se algum segredo
// estiver ausente, curto (< 32 caracteres), com cara de valor de exemplo
// (TROQUE_AQUI, changeme...) ou com pouca variedade de caracteres
// ("aaaaaaaa..."). Subir com segredo fraco e pior que nao subir: um
// JWT_SECRET adivinhavel deixa qualquer um forjar sessao de admin.
//
// Fora de producao so devolve os problemas (o chamador decide se avisa).
//
// Uso (primeira coisa depois do dotenv, em src/index.js e src/worker.js):
//   require('./seguranca/validarAmbiente').garantirAmbienteSeguro();

const TAMANHO_MINIMO = 32;

// Trechos que denunciam valor copiado do .env.example / documentacao.
const MARCAS_DE_EXEMPLO = [
  'troque', 'trocar', 'exemplo', 'example', 'changeme', 'change_me', 'change-me',
  'mesmo_valor', 'seu_', 'sua_', 'your_', 'placeholder', 'preencha', 'xxxxx',
  'secret', 'segredo', 'senha', 'password', 'minioadmin', 'sellergy123', 'dev_',
];

/**
 * Regras por variavel.
 *  - obrigatoria: precisa existir em producao.
 *  - minimo: tamanho minimo em caracteres.
 *  - base64Bytes: precisa decodificar (base64) pra exatamente N bytes.
 *  - obrigatoriaSe: vira obrigatoria quando a funcao devolver true.
 */
const SEGREDOS = [
  // Assina os tokens de sessao (auth.middleware).
  { nome: 'JWT_SECRET', obrigatoria: true, minimo: TAMANHO_MINIMO },
  // Chave mestra dos cofres (mensagens, credenciais de integracao) — cripto/cofre.js.
  { nome: 'MENSAGENS_MASTER_KEY', obrigatoria: true, base64Bytes: 32 },
  // Acesso ao MinIO (storage/minio.js).
  { nome: 'MINIO_SECRET_KEY', obrigatoria: true, minimo: TAMANHO_MINIMO },
  // Cobranca da propria plataforma (Asaas) — so quando configurada.
  { nome: 'ASAAS_PLATAFORMA_API_KEY', obrigatoria: false, minimo: TAMANHO_MINIMO },
  {
    nome: 'ASAAS_PLATAFORMA_WEBHOOK_TOKEN',
    obrigatoria: false,
    minimo: TAMANHO_MINIMO,
    // Com a chave da API ligada, o webhook sem token aceitaria aviso de
    // pagamento forjado: vira obrigatorio.
    obrigatoriaSe: (env) => Boolean(env.ASAAS_PLATAFORMA_API_KEY),
  },
];

function pareceExemplo(valor) {
  const v = String(valor).toLowerCase();
  // Chaves do Asaas comecam com "$aact_" e podem conter qualquer coisa depois;
  // ainda assim "troque"/"exemplo" denunciam copia do .env.example.
  return MARCAS_DE_EXEMPLO.some((marca) => v.includes(marca));
}

function poucaVariedade(valor) {
  return new Set(String(valor)).size < 8;
}

function senhaDaUrl(url) {
  try {
    const u = new URL(url);
    return u.password ? decodeURIComponent(u.password) : '';
  } catch {
    return null;
  }
}

/**
 * Lista os problemas do ambiente. Nao lanca.
 * @param {Object} [env=process.env]
 * @returns {{erros: string[], avisos: string[]}}
 */
function verificarAmbiente(env = process.env) {
  const erros = [];
  const avisos = [];

  for (const regra of SEGREDOS) {
    const valor = env[regra.nome];
    const obrigatoria = regra.obrigatoria || (regra.obrigatoriaSe && regra.obrigatoriaSe(env));
    if (valor === undefined || valor === '') {
      if (obrigatoria) erros.push(`${regra.nome} ausente.`);
      continue;
    }
    if (pareceExemplo(valor)) {
      erros.push(`${regra.nome} esta com valor de exemplo. Gere um novo (openssl rand -hex 32).`);
      continue;
    }
    if (regra.base64Bytes) {
      const bytes = /^[A-Za-z0-9+/]+={0,2}$/.test(valor) ? Buffer.from(valor, 'base64').length : 0;
      if (bytes !== regra.base64Bytes) {
        erros.push(`${regra.nome} precisa ser ${regra.base64Bytes} bytes em base64 (openssl rand -base64 32).`);
        continue;
      }
    }
    if (regra.minimo && valor.length < regra.minimo) {
      erros.push(`${regra.nome} curto demais (${valor.length} caracteres; minimo ${regra.minimo}).`);
      continue;
    }
    if (poucaVariedade(valor)) {
      erros.push(`${regra.nome} tem pouca variedade de caracteres (parece digitado a mao).`);
    }
  }

  // Senhas embutidas nas URLs de conexao.
  const senhaBanco = env.DATABASE_URL ? senhaDaUrl(env.DATABASE_URL) : null;
  if (!env.DATABASE_URL) {
    erros.push('DATABASE_URL ausente.');
  } else if (senhaBanco !== null && (senhaBanco.length < 16 || pareceExemplo(senhaBanco))) {
    erros.push('Senha do Postgres (DB_PASSWORD/DATABASE_URL) fraca ou de exemplo (minimo 16; use openssl rand -hex 32).');
  }

  if (!env.REDIS_URL) {
    erros.push('REDIS_URL ausente (em producao o Redis tem senha: redis://:SENHA@redis:6379).');
  } else {
    const senhaRedis = senhaDaUrl(env.REDIS_URL);
    if (!senhaRedis) {
      erros.push('REDIS_URL sem senha. Use redis://:SENHA@redis:6379 (REDIS_PASSWORD no .env).');
    } else if (senhaRedis.length < 16 || pareceExemplo(senhaRedis)) {
      erros.push('Senha do Redis (REDIS_PASSWORD) fraca ou de exemplo (minimo 16; use openssl rand -hex 32).');
    }
  }

  // Valores enumerados.
  const ambienteAsaas = env.ASAAS_PLATAFORMA_AMBIENTE;
  if (ambienteAsaas && !['sandbox', 'producao'].includes(ambienteAsaas)) {
    erros.push('ASAAS_PLATAFORMA_AMBIENTE deve ser "sandbox" ou "producao".');
  }
  // Interruptores: o codigo compara com um valor EXATO (=== '1' / === 'true').
  // Qualquer outra grafia ("sim", "TRUE", "1 ") deixaria a funcao desligada
  // sem ninguem perceber, entao barramos aqui.
  const INTERRUPTORES = {
    BAILEYS_ENVIO_REAL: ['0', '1'], // adapters/whatsapp/baileys.js
    WHATSAPP_ENVIO_REAL: ['0', '1'], // services/whatsappCloud.js
    ADMIN_2FA_OBRIGATORIO: ['true', 'false'], // middlewares/auth.middleware.js
  };
  for (const [flag, aceitos] of Object.entries(INTERRUPTORES)) {
    if (env[flag] !== undefined && env[flag] !== '' && !aceitos.includes(env[flag])) {
      erros.push(`${flag} deve ser ${aceitos.join(' ou ')}.`);
    }
  }

  // PLATAFORMA_CLIENTE_ID: id (cuid/uuid) do negocio do proprio Sellergy.
  if (env.PLATAFORMA_CLIENTE_ID && !/^[A-Za-z0-9_-]{8,64}$/.test(env.PLATAFORMA_CLIENTE_ID)) {
    erros.push('PLATAFORMA_CLIENTE_ID com formato invalido (esperado o id do Cliente).');
  }

  // Configuracao que nao derruba o boot, mas enfraquece a producao.
  const origens = String(env.CORS_ORIGINS || '');
  if (!origens) {
    avisos.push('CORS_ORIGINS vazio.');
  } else if (origens.includes('*') || /localhost|127\.0\.0\.1|http:\/\//.test(origens)) {
    erros.push('CORS_ORIGINS em producao nao pode ter "*", localhost ou http:// (so https://seu-dominio).');
  }
  if (env.COOKIE_SECURE !== undefined && env.COOKIE_SECURE !== 'true') {
    avisos.push('COOKIE_SECURE deveria ser true em producao (cookie de sessao so por HTTPS).');
  }
  if (String(env.COOKIE_SAMESITE || '').toLowerCase() === 'none') {
    avisos.push('COOKIE_SAMESITE=none abre espaco pra CSRF; front e API no mesmo site usam lax.');
  }
  if (ambienteAsaas === 'sandbox') {
    avisos.push('ASAAS_PLATAFORMA_AMBIENTE=sandbox em producao: cobrancas nao sao reais.');
  }
  if (env.ADMIN_2FA_OBRIGATORIO !== 'true') {
    avisos.push('ADMIN_2FA_OBRIGATORIO desligado: admins entram so com senha.');
  }

  return { erros, avisos };
}

/**
 * Em producao: lanca Error com todos os problemas (o processo nao sobe).
 * Fora de producao: so imprime avisos (nao atrapalha o dev).
 * Nunca imprime o VALOR de nenhuma variavel.
 * @param {{env?: Object, logger?: {warn: Function}}} [opcoes]
 * @returns {{erros: string[], avisos: string[]}}
 */
function garantirAmbienteSeguro({ env = process.env, logger = console } = {}) {
  const producao = env.NODE_ENV === 'production';
  const resultado = verificarAmbiente(env);

  if (producao && resultado.erros.length) {
    const erro = new Error(
      `Ambiente de producao inseguro — corrija o .env antes de subir:\n - ${resultado.erros.join('\n - ')}`,
    );
    erro.code = 'AMBIENTE_INSEGURO';
    erro.problemas = resultado.erros;
    throw erro;
  }
  if (producao) {
    for (const aviso of resultado.avisos) logger.warn(`[ambiente] ${aviso}`);
  }
  return resultado;
}

module.exports = {
  garantirAmbienteSeguro,
  verificarAmbiente,
  TAMANHO_MINIMO,
};
