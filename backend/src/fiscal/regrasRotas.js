// Regras puras das rotas fiscais (routes/fiscal.routes.js), separadas para teste.

const { validarCnpj, validarUf, normalizarTributacao } = require('../utils/validacaoFiscal');

const AMBIENTES = ['HOMOLOGACAO', 'PRODUCAO'];
const CAMPOS_EMITENTE = [
  'inscricaoMunicipal', 'razaoSocial', 'nomeFantasia', 'cnae',
  'emailEmitente', 'telefoneEmitente',
  'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'cep',
];
const CAMPOS_TEXTO = ['regime', 'cnpj', 'inscricao', 'csc', 'serie', ...CAMPOS_EMITENTE];

// ---------------------------------------------------------------------------
// PUT /fiscal/config — so o que veio no corpo muda
// ---------------------------------------------------------------------------

/**
 * Monta o `data` do upsert a partir do corpo. Campo ausente = nao mexe;
 * string vazia/null = limpa. `ativo` so muda se vier no corpo (nunca liga
 * sozinho). PRODUCAO so com o assistente concluido (`prontoParaProducao`).
 *
 * @param {Object} corpo
 * @param {Object} ctx
 * @param {Object|null} ctx.atual            config atual (null = vai criar)
 * @param {string[]} ctx.provedores          emissores aceitos
 * @param {boolean} ctx.prontoParaProducao   assistente sem pendencias
 * @returns {{ erro: string, status?: number } | { dados: Object }}
 */
function montarAtualizacaoConfig(corpo = {}, { atual = null, provedores = [], prontoParaProducao = false } = {}) {
  const tem = (k) => Object.prototype.hasOwnProperty.call(corpo, k) && corpo[k] !== undefined;
  const dados = {};

  if (tem('provedor')) {
    if (!provedores.includes(corpo.provedor)) return { erro: `Emissor invalido. Use: ${provedores.join(', ')}.` };
    dados.provedor = corpo.provedor;
  } else if (!atual) {
    return { erro: `Escolha o emissor. Use: ${provedores.join(', ')}.` };
  }

  if (tem('ambiente')) {
    const amb = String(corpo.ambiente).toUpperCase();
    if (!AMBIENTES.includes(amb)) return { erro: `Ambiente invalido. Use: ${AMBIENTES.join(', ')}.` };
    if (amb === 'PRODUCAO' && atual?.ambiente !== 'PRODUCAO' && !prontoParaProducao) {
      return {
        status: 422,
        erro: 'Para emitir em produção, conclua o assistente "Ativar nota fiscal" (empresa, certificado, configuração e emissor).',
      };
    }
    dados.ambiente = amb;
  } else if (!atual) {
    dados.ambiente = 'HOMOLOGACAO';
  }

  if (tem('cnpj') && corpo.cnpj && !validarCnpj(corpo.cnpj)) return { erro: 'CNPJ do emitente invalido.' };
  if (tem('uf') && corpo.uf && !validarUf(corpo.uf)) return { erro: 'UF invalida.' };

  for (const k of CAMPOS_TEXTO) {
    if (!tem(k)) continue;
    const v = corpo[k] === null ? '' : String(corpo[k]).trim().slice(0, 200);
    dados[k] = v || null;
  }
  if (dados.cnpj) dados.cnpj = dados.cnpj.replace(/\D/g, '');
  if (dados.uf) dados.uf = dados.uf.toUpperCase();

  if (tem('credencialId')) dados.credencialId = corpo.credencialId || null;
  // A referencia do certificado so nasce no assistente (upload do .pfx). Aqui
  // da para limpar, nunca para escrever uma referencia "na mao".
  if (tem('certificadoRef')) {
    if (corpo.certificadoRef) return { status: 422, erro: 'O certificado é enviado pelo assistente "Ativar nota fiscal", não por aqui.' };
    dados.certificadoRef = null;
  }

  if (tem('ativo')) {
    if (typeof corpo.ativo !== 'boolean') return { erro: 'ativo deve ser true ou false.' };
    dados.ativo = corpo.ativo;
  } else if (!atual) {
    dados.ativo = false; // nasce desligado: liga no "Ativar" do assistente
  }

  if (tem('tributacao')) {
    const t = normalizarTributacao(corpo.tributacao);
    if (t.erro) return { erro: t.erro, campos: t.campos };
    dados.tributacao = t.dados;
  }
  return { dados };
}

// ---------------------------------------------------------------------------
// POST /fiscal/documentos/:id/cancelar — justificativa e prazo
// ---------------------------------------------------------------------------

const MIN_JUSTIFICATIVA = 15;
const MAX_JUSTIFICATIVA = 255;
// Prazo tipico da SEFAZ para cancelar NFC-e (alguns estados aceitam mais,
// como "cancelamento extemporaneo"). NFS-e: cada prefeitura tem o seu.
const PRAZO_NFCE_MIN = 30;

/**
 * @returns {{ erro: string, status: number, codigo?: string } | { motivo: string, aviso: string|null }}
 */
function avaliarCancelamento({ tipo, emitidoEm, motivo, confirmarForaDoPrazo = false, agora = new Date() }) {
  const texto = String(motivo || '').trim().replace(/\s+/g, ' ');
  if (texto.length < MIN_JUSTIFICATIVA) {
    return { status: 400, codigo: 'JUSTIFICATIVA_CURTA', erro: `Escreva o motivo do cancelamento com pelo menos ${MIN_JUSTIFICATIVA} caracteres (exigência da SEFAZ/prefeitura).` };
  }
  if (texto.length > MAX_JUSTIFICATIVA) {
    return { status: 400, codigo: 'JUSTIFICATIVA_LONGA', erro: `O motivo do cancelamento pode ter no máximo ${MAX_JUSTIFICATIVA} caracteres.` };
  }
  const minutos = emitidoEm ? (agora.getTime() - new Date(emitidoEm).getTime()) / 60000 : 0;
  if (tipo === 'NFCE' && minutos > PRAZO_NFCE_MIN) {
    const aviso = `Esta NFC-e foi emitida há ${Math.floor(minutos)} minutos. O prazo comum da SEFAZ para cancelar é de ${PRAZO_NFCE_MIN} minutos; o cancelamento pode ser recusado (alguns estados aceitam fora do prazo com multa).`;
    if (!confirmarForaDoPrazo) return { status: 409, codigo: 'FORA_DO_PRAZO', erro: `${aviso} Para tentar mesmo assim, confirme o cancelamento fora do prazo.` };
    return { motivo: texto, aviso };
  }
  if (tipo === 'NFSE' && minutos > 24 * 60) {
    return { motivo: texto, aviso: 'O prazo para cancelar NFS-e depende da prefeitura (muitas aceitam só no mesmo mês ou em poucos dias). Se o emissor recusar, o cancelamento terá que ser pedido na prefeitura.' };
  }
  return { motivo: texto, aviso: null };
}

module.exports = {
  AMBIENTES, CAMPOS_EMITENTE, MIN_JUSTIFICATIVA, PRAZO_NFCE_MIN,
  montarAtualizacaoConfig, avaliarCancelamento,
};
