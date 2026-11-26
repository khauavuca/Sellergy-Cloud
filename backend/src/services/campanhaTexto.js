// Texto da campanha por cliente: troca os campos entre colchetes pelos dados
// de cada um e monta o que vai junto (botao e aviso de SAIR). PURO — quem
// chama busca os dados (campanhaService.js).
//
// Canal QR Code (WhatsApp Web): sai o texto pronto, com o link do botao e a
// linha "responda SAIR" no fim.
// Canal oficial (Meta): o texto que chega e o do modelo aprovado. Cada campo
// entre colchetes vira um parametro do corpo ({{1}}, {{2}}...) na ordem em
// que aparece; o botao e o "nao quero receber" vem do proprio modelo.

const CAMPOS = [
  { chave: 'nome', padrao: /\[nome\]|\{\{\s*nome\s*\}\}/gi, reserva: 'cliente' },
  { chave: 'ultimoServico', padrao: /\[[uú]ltimo servi[cç]o\]/gi, reserva: 'seu atendimento' },
  { chave: 'profissional', padrao: /\[profissional\]/gi, reserva: 'nossa equipe' },
  { chave: 'cupom', padrao: /\[cupom\]/gi, reserva: '' },
  { chave: 'link', padrao: /\[link de agendamento\]/gi, reserva: '' },
];

// Um so regex com todos, pra achar a ordem de aparicao (parametros da Meta).
const TODOS = new RegExp(CAMPOS.map((c) => c.padrao.source).join('|'), 'gi');

const BOTOES = new Set(['MARCAR_HORARIO', 'FALAR']);
const RODAPE_SAIR = 'Pra não receber mais mensagens assim, responda SAIR.';

function campoDe(trecho) {
  return CAMPOS.find((c) => new RegExp(`^(?:${c.padrao.source})$`, 'i').test(trecho));
}

function valorDe(campo, dados) {
  const v = String(dados?.[campo.chave] ?? '').trim();
  return v || campo.reserva;
}

/** Quais dados o texto usa (pra so buscar o necessario). */
function camposUsados(mensagem) {
  const usados = new Set();
  for (const trecho of String(mensagem || '').match(TODOS) || []) {
    const c = campoDe(trecho);
    if (c) usados.add(c.chave);
  }
  return usados;
}

/** Troca os campos pelo dado do cliente (ou um texto reserva). */
function preencherTexto(mensagem, dados) {
  return String(mensagem || '').replace(TODOS, (trecho) => {
    const c = campoDe(trecho);
    return c ? valorDe(c, dados) : trecho;
  });
}

/** Texto final do canal QR Code: corpo + link do botao + aviso de SAIR. */
function textoQrCode(mensagem, dados, botao) {
  const partes = [preencherTexto(mensagem, dados).trim()];
  if (botao === 'MARCAR_HORARIO' && dados?.link) partes.push(`Marcar horário: ${dados.link}`);
  partes.push(RODAPE_SAIR);
  return partes.join('\n\n');
}

/** Parametros do corpo do modelo da Meta, na ordem dos campos no texto. */
function componentesMeta(mensagem, dados) {
  const trechos = String(mensagem || '').match(TODOS) || [];
  if (!trechos.length) return undefined;
  const parametros = trechos.map((t) => {
    const c = campoDe(t);
    // A Meta recusa parametro vazio.
    return { type: 'text', text: (c && valorDe(c, dados)) || '-' };
  });
  return [{ type: 'body', parameters: parametros }];
}

module.exports = { camposUsados, preencherTexto, textoQrCode, componentesMeta, BOTOES, RODAPE_SAIR };
