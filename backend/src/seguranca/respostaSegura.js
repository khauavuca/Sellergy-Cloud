// =====================================================================
// RESPOSTA SEGURA: nenhum erro interno vaza para o cliente.
// =====================================================================
// 1. `mensagemPadronizada`: toda resposta de erro (4xx/5xx) passa a ter
//    `erro` E `error` com o mesmo texto. Parte da API usa um nome e parte o
//    outro; as telas leem `erro`. Assim a mensagem certa sempre chega.
// 2. Em respostas 5xx a mensagem é trocada por um texto genérico. O texto
//    original (Prisma, caminho de arquivo, código) vai só para o log.
// 3. `tratadorFinal`: erro não tratado (inclusive CORS e JSON quebrado)
//    vira JSON, nunca a página HTML do Express com a pilha.
// =====================================================================

const MENSAGEM_500 = 'Não foi possível concluir agora. Tente de novo em instantes.';

/** Texto de erro de uma resposta, venha em `erro`, `error` ou `message`. PURA. */
function textoDoErro(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null;
  const t = corpo.erro ?? corpo.error ?? corpo.message;
  return typeof t === 'string' ? t : null;
}

/** Monta o corpo final de um erro. PURA (testável). */
function corpoDeErro(status, corpo) {
  if (status < 400 || !corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return corpo;
  const texto = textoDoErro(corpo);
  if (status >= 500) {
    // Nunca devolve o texto interno; mantém só campos seguros conhecidos.
    const seguro = { erro: MENSAGEM_500, error: MENSAGEM_500 };
    if (typeof corpo.codigo === 'string') seguro.codigo = corpo.codigo;
    return seguro;
  }
  if (texto == null) return corpo;
  const saida = { ...corpo, erro: texto, error: texto };
  delete saida.message;
  delete saida.stack;
  return saida;
}

function mensagemPadronizada(req, res, next) {
  const jsonOriginal = res.json.bind(res);
  res.json = (corpo) => {
    const status = res.statusCode || 200;
    if (status >= 500) {
      const texto = textoDoErro(corpo);
      if (texto) console.error(`[erro ${status}] ${req.method} ${req.originalUrl}: ${texto.slice(0, 2000)}`);
    }
    return jsonOriginal(corpoDeErro(status, corpo));
  };
  next();
}

// eslint-disable-next-line no-unused-vars
function tratadorFinal(err, req, res, next) {
  if (res.headersSent) return undefined;
  const msg = String(err?.message || err || '');
  if (/CORS/i.test(msg)) return res.status(403).json({ erro: 'Origem não permitida.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Corpo da requisição inválido (JSON mal formado).' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ erro: 'Dados grandes demais.' });
  console.error(`[erro nao tratado] ${req.method} ${req.originalUrl}:`, err);
  return res.status(500).json({ erro: MENSAGEM_500 });
}

module.exports = { mensagemPadronizada, tratadorFinal, corpoDeErro, textoDoErro, MENSAGEM_500 };
