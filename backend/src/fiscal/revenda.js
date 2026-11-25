// =====================================================================
// EMISSOR DA SELLERGY (revenda Focus NFe) — liga o assistente fiscal a conta
// de notas da Sellergy. O cliente so envia dados, certificado e CSC.
// =====================================================================
// Modos do emissor de um cliente:
//   SELLERGY -> a Sellergy tem a chave de revenda (Admin › Integracoes) e o
//               cliente nao tem chave propria: a empresa dele e cadastrada na
//               conta da Sellergy e a Focus devolve um token so dele.
//   PROPRIO  -> o cliente tem chave propria (cadastrada pelo admin).
//   NENHUM   -> nenhum dos dois: a tela pede pra falar com o suporte.
// =====================================================================

const prisma = require('../prisma');
const { carregarCredencialPlataforma, carregarCredencialDecifrada } = require('../credenciais');
const { cifrarPayload } = require('../cripto/cofreCredenciais');
const { montarEmpresaFocus, salvarEmpresaFocus } = require('../adapters/fiscal/focusRevenda');

// Marca da credencial criada pela revenda (nao foi o admin que colou).
const MARCA_REVENDA = 'revenda-sellergy';
const emissaoRealLigada = () => String(process.env.FISCAL_LIVE || '').toLowerCase() === 'true';

function erro(status, mensagem, codigo) {
  return Object.assign(new Error(mensagem), { status, codigo });
}

/** Regra pura: qual o modo do emissor. */
function modoEmissor({ credencialPropria, credencialRevenda, temChaveRevenda }) {
  if (credencialPropria) return 'PROPRIO';
  if (credencialRevenda || temChaveRevenda) return 'SELLERGY';
  return 'NENHUM';
}

async function chaveRevenda() {
  const c = await carregarCredencialPlataforma('FOCUS_NFE_KEY').catch(() => null);
  const token = c?.dados?.token;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

/** Credenciais fiscais do cliente separadas em "da revenda" e "proprias". */
async function credenciaisFiscais(clienteId) {
  const linhas = await prisma.credencial.findMany({
    where: { clienteId, tipo: { in: ['FOCUS_NFE_KEY', 'NUVEM_FISCAL_KEY'] } },
    select: { id: true, tipo: true, nome: true, descricao: true },
    orderBy: { criadoEm: 'asc' },
  });
  return {
    revenda: linhas.find((l) => l.tipo === 'FOCUS_NFE_KEY' && l.descricao === MARCA_REVENDA) || null,
    proprias: linhas.filter((l) => l.descricao !== MARCA_REVENDA),
  };
}

/**
 * Cadastra ou atualiza a empresa do cliente na conta de revenda e guarda o
 * token dela como credencial FOCUS_NFE_KEY do cliente (marcada como revenda).
 * Com FISCAL_LIVE desligado nao chama a Focus (simulado).
 * @returns {Promise<{ credencialId: string, simulado: boolean }>}
 */
async function sincronizarEmpresa({ clienteId, config, tipos, certificado = null, fetchFn }) {
  const master = await chaveRevenda();
  if (!master) throw erro(409, 'A emissão de notas pela Sellergy ainda não foi liberada. Fale com o suporte.', 'SEM_REVENDA');

  const { revenda } = await credenciaisFiscais(clienteId);
  const atual = revenda ? await carregarCredencialDecifrada({ credencialId: revenda.id, clienteId }).catch(() => null) : null;
  const cnpj = String(config.cnpj || '').replace(/\D/g, '');
  // CNPJ trocado: e outra empresa na Focus (o certificado e o cadastro sao por CNPJ).
  const dadosAtuais = atual?.dados && (!atual.dados.cnpj || atual.dados.cnpj === cnpj) ? atual.dados : {};

  let resultado;
  const simulado = !emissaoRealLigada();
  if (simulado) {
    resultado = {
      empresaId: dadosAtuais.empresaId || `simulado-${cnpj}`,
      tokenProducao: dadosAtuais.token || 'simulado',
      tokenHomologacao: dadosAtuais.tokenHomologacao || 'simulado',
    };
  } else {
    const corpo = montarEmpresaFocus(config, { tipos, certificado });
    const r = await salvarEmpresaFocus({ masterToken: master, empresaId: dadosAtuais.empresaId || null, corpo, ...(fetchFn ? { fetchFn } : {}) });
    if (!r.ok) throw erro(r.status >= 500 ? 502 : 422, r.erro, 'EMISSOR_RECUSOU');
    resultado = r;
  }

  const payload = {
    token: resultado.tokenProducao || dadosAtuais.token,
    tokenHomologacao: resultado.tokenHomologacao || dadosAtuais.tokenHomologacao || null,
    empresaId: resultado.empresaId || dadosAtuais.empresaId,
    cnpj,
  };
  if (!payload.token) throw erro(502, 'A empresa foi cadastrada no emissor, mas o acesso dela ainda não saiu. Tente de novo em alguns minutos.', 'SEM_TOKEN');
  const cifrado = cifrarPayload(clienteId, payload);
  const cifra = { dadosCifrados: cifrado.conteudoCifrado, iv: cifrado.iv, tag: cifrado.tag, versaoChave: cifrado.versaoChave };

  const credencialId = revenda
    ? (await prisma.credencial.update({ where: { id: revenda.id }, data: cifra, select: { id: true } })).id
    : (await prisma.credencial.create({
      data: { clienteId, nome: 'Focus NFe (Sellergy)', tipo: 'FOCUS_NFE_KEY', descricao: MARCA_REVENDA, ...cifra },
      select: { id: true },
    })).id;
  await prisma.configuracaoFiscal.update({ where: { clienteId }, data: { provedor: 'FOCUS_NFE', credencialId } });
  return { credencialId, simulado };
}

module.exports = { modoEmissor, chaveRevenda, credenciaisFiscais, sincronizarEmpresa, MARCA_REVENDA };
