// Decide entre atendimento com IA (DeepSeek) e o motor de FAQ existente
// (botRouter, menu fixo), conforme bot.iaAtiva. Quando responde com IA,
// registra o consumo de tokens do mes (ConsumoIA) pro relatorio de excedente
// e o consumo do dia da plataforma (teto global). Antes de chamar a IA passa
// pelas travas de custo de services/iaLimites.js; fechou alguma, responde
// pelo menu de perguntas.
//
// Nunca lanca: falha da IA (chave ausente, provedor fora do ar, timeout) cai
// numa mensagem de erro tratada — o webhook do WhatsApp nao pode quebrar
// porque a DeepSeek ficou indisponivel.
//
// LIMITACAO CONHECIDA: sem memoria de conversa — cada mensagem e enviada
// isolada (so o prompt de sistema + a mensagem atual), sem historico do que
// foi dito antes. O model `Conversa` foi removido no pivo ERP-first e
// reconstruir estado-por-conversa e um trabalho a parte (store persistente +
// janela de contexto) — fora do escopo desta rodada. O parametro `historico`
// existe pra quando isso for construido, sem precisar mexer aqui de novo.

const prisma = require('../prisma');
const { montarResposta } = require('./botRouter');
const { criarProvedorIA } = require('../adapters/ia');
const { carregarCredencialPlataforma } = require('../credenciais');
const { ferramentasDoBot } = require('./iaFerramentas');
const { verificarDisponibilidadeIA, registrarConsumoGlobal } = require('./iaLimites');

const TIPO_CREDENCIAL_IA = 'DEEPSEEK_KEY';
const MENSAGEM_INDISPONIVEL = 'Atendimento indisponivel no momento. Tente novamente em instantes.';
// Teto de chamadas de ferramenta por mensagem — evita loop infinito (e custo
// infinito) se o modelo insistir em chamar ferramenta sem nunca concluir.
const MAX_ITERACOES_FERRAMENTAS = 4;

// 'fixture' por padrao (nao bate na rede) — precisa de IA_MODO=live pra
// chamar a DeepSeek de verdade. Mesmo padrao de go-live dos outros adapters
// (FISCAL_LIVE, WHATSAPP_ENVIO_REAL): nunca liga sozinho.
function modoIA() {
  return process.env.IA_MODO === 'live' ? 'live' : 'fixture';
}

function periodoAtual() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Matematica pura do excedente — separada do acesso ao banco pra ser
 * testavel sem precisar de um Prisma/DB real (mesmo padrao dos outros
 * testes deste projeto: logica em funcao pura, I/O fica em volta dela).
 * @param {{totalTokens:number, tokensIncluidosMes:number, precoPorMilCentavos:number}} p
 * @returns {{tokensExcedentes:number, valorExcedenteCentavos:number}}
 */
function calcularExcedente({ totalTokens, tokensIncluidosMes, precoPorMilCentavos }) {
  const tokensExcedentes = Math.max(0, totalTokens - tokensIncluidosMes);
  const valorExcedenteCentavos = Math.round((tokensExcedentes / 1000) * precoPorMilCentavos);
  return { tokensExcedentes, valorExcedenteCentavos };
}

/**
 * Soma o consumo do mes e recalcula o excedente. O incremento e ATOMICO no
 * banco (`increment`): duas mensagens chegando juntas nao perdem tokens (o
 * "le, soma e grava" antigo perdia). O excedente e gravado com condicao
 * (`tokensUsados` = total que ESTA chamada viu): se outra chamada somou
 * depois, ela grava o excedente dela, que e o mais novo.
 * Best-effort: quem chama nao deve deixar uma falha aqui derrubar a resposta
 * ja enviada ao cliente.
 */
async function registrarConsumo({ clienteId, botId, tokensUsados, tokensIncluidosMes, precoPorMilCentavos }) {
  if (!tokensUsados) return;
  const periodo = periodoAtual();
  const linha = await prisma.consumoIA.upsert({
    where: { botId_periodo: { botId, periodo } },
    create: { clienteId, botId, periodo, tokensUsados },
    update: { tokensUsados: { increment: tokensUsados } },
  });
  const { tokensExcedentes, valorExcedenteCentavos } = calcularExcedente({
    totalTokens: linha.tokensUsados, tokensIncluidosMes, precoPorMilCentavos,
  });
  if (tokensExcedentes !== linha.tokensExcedentes || valorExcedenteCentavos !== linha.valorExcedenteCentavos) {
    await prisma.consumoIA.updateMany({
      where: { id: linha.id, tokensUsados: linha.tokensUsados },
      data: { tokensExcedentes, valorExcedenteCentavos },
    });
  }
}

/**
 * Loop de tool calling: chama a IA; se ela pedir ferramenta(s), executa cada
 * uma e devolve o resultado (role: 'tool'); repete ate vir uma resposta final
 * de texto ou estourar o teto de iteracoes.
 *
 * `chamarIA` e `executarFerramenta` sao injetados de proposito — testavel sem
 * precisar de Prisma nem da DeepSeek de verdade (mesmo padrao dos outros
 * testes deste projeto: logica em funcao pura/injetada, I/O fica em volta).
 *
 * @param {{mensagens:Array, chamarIA:(historico:Array)=>Promise<Object>, executarFerramenta:(nome:string,argumentos:Object)=>Promise<Object>}} p
 * @returns {Promise<{texto:string, tokensTotal:number, limiteAtingido?:boolean}>}
 */
async function processarComFerramentas({ mensagens, chamarIA, executarFerramenta }) {
  const historico = [...mensagens];
  let tokensTotal = 0;

  for (let iteracao = 0; iteracao < MAX_ITERACOES_FERRAMENTAS; iteracao++) {
    const resp = await chamarIA(historico);
    tokensTotal += resp.tokensTotal || 0;

    if (!resp.toolCalls || resp.toolCalls.length === 0) {
      return { texto: resp.texto, tokensTotal };
    }

    // Reconstroi a mensagem do assistente pedindo a(s) ferramenta(s) — a API
    // exige essa mensagem no historico antes das respostas role:'tool'.
    historico.push({
      role: 'assistant',
      content: resp.texto || null,
      tool_calls: resp.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.nome, arguments: JSON.stringify(tc.argumentos) },
      })),
    });

    for (const tc of resp.toolCalls) {
      let resultado;
      try {
        resultado = await executarFerramenta(tc.nome, tc.argumentos);
      } catch (erro) {
        // Erro da ferramenta vira resultado pra IA (ela reformula a resposta
        // pro cliente), nunca derruba o atendimento inteiro.
        resultado = { erro: erro?.message || 'Falha ao executar a acao.' };
      }
      historico.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(resultado) });
    }
  }

  // Estourou o teto sem resposta final — corta o loop. Melhor um "nao
  // consegui" tratado do que rodar (e cobrar tokens) pra sempre.
  return {
    texto: 'Nao consegui concluir essa solicitacao agora. Um atendente vai te ajudar em breve.',
    tokensTotal,
    limiteAtingido: true,
  };
}

// FAQs do cliente pro menu sem IA — quem chama so carrega quando o bot NAO e
// de IA; se a IA ficar indisponivel (cota/teto/limite), busca aqui.
async function faqsParaMenu(bot, faqs) {
  if (Array.isArray(faqs) && faqs.length > 0) return faqs;
  return prisma.faq.findMany({ where: { clienteId: bot.clienteId, ativo: true }, orderBy: { ordem: 'asc' } })
    .catch(() => []);
}

/**
 * Decide a resposta pra uma mensagem recebida.
 * @param {{bot:Object, texto:string, faqs:Array, de?:string, historico?:Array, canalContexto?:{phoneNumberId?:string, token?:string, telefoneCliente?:string}}} p
 * `canalContexto` e repassado pras ferramentas que precisam enviar midia
 * direto (ex.: CATALOGO manda o PDF como documento) — nao serve pra nada no
 * modo FAQ, so quando iaAtiva.
 * @returns {Promise<{texto:string, encaminhar?:boolean, origem:'IA'|'MENU', iaIndisponivel?:string}>}
 */
async function montarRespostaBot({ bot, texto, faqs, de = null, historico = [], canalContexto = {} }) {
  if (!bot.iaAtiva) {
    return { ...montarResposta({ texto, faqs }), origem: 'MENU' };
  }

  // Travas de custo: teto global do dia, cota do cliente, limite por contato.
  // Qualquer uma fechada -> menu de perguntas sem IA (nunca fica mudo).
  const periodo = periodoAtual();
  const disponibilidade = await verificarDisponibilidadeIA({ bot, de: de || canalContexto.telefoneCliente, periodo });
  if (!disponibilidade.liberado) {
    const menu = montarResposta({ texto, faqs: await faqsParaMenu(bot, faqs) });
    return { ...menu, origem: 'MENU', iaIndisponivel: disponibilidade.motivo };
  }

  try {
    const credencialIA = await carregarCredencialPlataforma(TIPO_CREDENCIAL_IA);
    if (!credencialIA) {
      console.error('[iaRouter] bot com iaAtiva=true mas sem credencial de IA de plataforma cadastrada');
      return { texto: MENSAGEM_INDISPONIVEL, origem: 'IA' };
    }

    const provedor = criarProvedorIA('DEEPSEEK', { credencial: credencialIA, modo: modoIA() });
    const mensagens = [
      ...(bot.iaPromptSistema ? [{ role: 'system', content: bot.iaPromptSistema }] : []),
      ...historico,
      { role: 'user', content: texto },
    ];

    const { tools, executar } = ferramentasDoBot(bot.acoesPermitidas);
    const contexto = { clienteId: bot.clienteId, botId: bot.id, ...canalContexto };

    const resultado = await processarComFerramentas({
      mensagens,
      chamarIA: (historicoAtual) => provedor.responder({ mensagens: historicoAtual, modelo: bot.iaModelo, tools }),
      executarFerramenta: (nome, argumentos) => executar(nome, argumentos, contexto),
    });

    // Best-effort: registrar consumo nao pode atrasar nem quebrar a resposta.
    registrarConsumo({
      clienteId: bot.clienteId,
      botId: bot.id,
      tokensUsados: resultado.tokensTotal,
      tokensIncluidosMes: bot.iaTokensIncluidosMes,
      precoPorMilCentavos: bot.iaPrecoPorMilTokensExcedenteCentavos,
    }).catch((e) => console.error('[iaRouter] falha ao registrar consumo', e?.message));
    registrarConsumoGlobal(resultado.tokensTotal)
      .catch((e) => console.error('[iaRouter] falha ao registrar consumo global', e?.message));

    return { texto: resultado.texto || 'Desculpe, nao consegui gerar uma resposta agora.', origem: 'IA' };
  } catch (erro) {
    console.error('[iaRouter] falha na chamada de IA', erro?.message);
    return { texto: MENSAGEM_INDISPONIVEL, origem: 'IA' };
  }
}

module.exports = { montarRespostaBot, processarComFerramentas, registrarConsumo, calcularExcedente, periodoAtual };
