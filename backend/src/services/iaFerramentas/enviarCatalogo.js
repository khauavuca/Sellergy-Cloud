// Ferramenta CATALOGO — a IA usa quando o cliente final pede pra ver o
// catalogo/produtos/o que a loja vende. Monta o PDF (layout configurado pelo
// tenant em ConfiguracaoCatalogo), sobe pro MinIO e manda como documento no
// WhatsApp — diferente das outras ferramentas, esta tem efeito colateral de
// ENVIO direto (documento nao cabe dentro do texto de resposta da IA).
//
// Reuso do PDF: a chave no bucket e fixa por tenant e o objeto guarda, nos
// metadados, uma "versao" derivada de tudo que entra no PDF (produtos,
// variacoes, configuracao, nome do negocio). Se a versao no bucket bate com a
// atual, o Chromium nem sobe — so assina a URL e envia. Na pratica o PDF so e
// regerado quando o catalogo muda, nao a cada pedido.

const crypto = require('crypto');
const prisma = require('../../prisma');
const { resolverPrecoVenda } = require('../../produto');
const { montarHtml, renderizarPdf } = require('../catalogoPdf');
const { upload, urlAssinada, assinarSeFor, metadadosObjeto } = require('../../storage/minio');
const { enviarDocumento } = require('../whatsappCloud');

const chave = 'CATALOGO';
const META_VERSAO = 'catalogo-versao'; // chave de metadado S3 (minusculas)

/**
 * Decide se um produto deve aparecer no catalogo, dada a configuracao do
 * tenant. Funcao pura — separada do fetch/Puppeteer/upload pra poder testar a
 * regra sem I/O. Servico nao controla estoque (sempre visivel); FISICO com
 * estoque zerado some quando ocultarSemEstoque esta ligado (padrao).
 * @param {{tipo:string, variacoes:Array<{estoqueAtual:number}>}} produto
 * @param {Object|null} config
 */
function produtoVisivelNoCatalogo(produto, config) {
  const ocultarSemEstoque = config?.ocultarSemEstoque !== false;
  if (!ocultarSemEstoque) return true;
  if (produto.tipo !== 'FISICO') return true;
  return (produto.variacoes[0]?.estoqueAtual ?? 0) > 0;
}

/**
 * Impressao digital do catalogo: muda se qualquer produto/variacao/config/nome
 * do negocio mudar (todos tem @updatedAt), ou se a lista de produtos mudar.
 * Funcao pura — testavel sem banco.
 * @param {{cliente:Object|null, produtos:Array, config:Object|null}} p
 * @returns {string}
 */
function versaoDoCatalogo({ cliente, produtos, config }) {
  const datas = [cliente?.atualizadoEm, config?.atualizadoEm];
  for (const p of produtos) {
    datas.push(p.atualizadoEm);
    for (const v of p.variacoes || []) datas.push(v.atualizadoEm);
  }
  const maisRecente = datas
    .filter(Boolean)
    .reduce((maior, d) => Math.max(maior, new Date(d).getTime()), 0);
  const ids = produtos.map((p) => p.id).sort().join(',');
  return crypto.createHash('sha1').update(`${ids}|${maisRecente}`).digest('hex').slice(0, 16);
}

const definicao = {
  type: 'function',
  function: {
    name: 'enviar_catalogo',
    description: 'Monta e envia o catalogo completo de produtos/servicos em PDF pro cliente. Use quando o cliente pedir pra ver o catalogo, os produtos, os precos, ou "o que voces vendem/fazem".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

/**
 * @param {Object} _argumentos sem parametros — o catalogo e sempre o completo
 * @param {{clienteId:string, botId:string, phoneNumberId:string, token:string, telefoneCliente:string}} contexto
 */
async function executar(_argumentos, { clienteId, phoneNumberId, token, telefoneCliente }) {
  if (!phoneNumberId || !token || !telefoneCliente) {
    // Contexto de envio ausente (ex.: chamado fora de um webhook real, como
    // em testes) — nao tenta enviar, devolve erro tratavel.
    return { erro: 'Nao foi possivel enviar o catalogo — canal de envio indisponivel.' };
  }

  const [cliente, produtos, config] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, atualizadoEm: true } }),
    prisma.produto.findMany({
      where: { clienteId, visibilidade: 'ATIVO' },
      include: { variacoes: { orderBy: { criadoEm: 'asc' }, take: 1 }, categoria: { select: { nome: true } } },
      orderBy: { nome: 'asc' },
    }),
    prisma.configuracaoCatalogo.findUnique({ where: { clienteId } }),
  ]);

  if (produtos.length === 0) {
    return { erro: 'O catalogo ainda nao tem nenhum produto ativo cadastrado.' };
  }

  const produtosNoCatalogo = produtos
    .filter((p) => p.variacoes.length > 0) // sem variacao nao tem preco — nao entra no PDF
    .filter((p) => produtoVisivelNoCatalogo(p, config));

  if (produtosNoCatalogo.length === 0) {
    return { erro: 'Nenhum produto disponivel para o catalogo no momento (todos sem estoque).' };
  }

  // Nome fixo (sempre sobrescreve) — o catalogo e "o atual", nao precisa
  // historico de versoes antigas ocupando o bucket.
  const key = `catalogos/${clienteId}/catalogo.pdf`;
  const versao = versaoDoCatalogo({ cliente, produtos, config });

  let reutilizado = false;
  try {
    const existente = await metadadosObjeto(key);
    reutilizado = existente?.metadata?.[META_VERSAO] === versao;
  } catch (erro) {
    // HEAD falhou (MinIO instavel) — segue e regera; pior caso e um Chromium a mais.
    console.warn('[ferramenta:enviarCatalogo] nao conseguiu checar PDF existente:', erro?.message || erro);
  }

  if (!reutilizado) {
    // O bucket e privado: a URL canonica gravada no produto da 403 pro
    // Chromium. Assina cada imagem antes de montar o HTML.
    const produtosParaHtml = await Promise.all(produtosNoCatalogo.map(async (p) => ({
      nome: p.nome,
      descricao: p.descricao,
      imagemUrl: await assinarSeFor(p.imagemUrl),
      categoriaNome: p.categoria?.nome || null,
      preco: resolverPrecoVenda(p.variacoes[0]),
    })));

    const html = montarHtml({ nomeNegocio: cliente?.nome, produtos: produtosParaHtml, config });

    let pdfBuffer;
    try {
      pdfBuffer = await renderizarPdf(html);
    } catch (erro) {
      console.error('[ferramenta:enviarCatalogo] falha ao renderizar PDF', erro?.message || erro);
      return { erro: 'Nao foi possivel gerar o catalogo agora. Tente novamente em instantes.' };
    }

    await upload({
      key, body: pdfBuffer, contentType: 'application/pdf',
      cacheControl: 'private, max-age=0, must-revalidate',
      metadata: { [META_VERSAO]: versao },
    });
  }

  const link = await urlAssinada(key, { expiraEm: 60 * 60 }); // 1h — tempo de sobra pro WhatsApp buscar o arquivo

  const resultadoEnvio = await enviarDocumento({
    phoneNumberId, token, para: telefoneCliente, link, filename: 'catalogo.pdf', caption: cliente?.nome ? `Catalogo — ${cliente.nome}` : 'Catalogo',
  });

  if (!resultadoEnvio.ok) {
    return { erro: 'O catalogo foi gerado mas nao foi possivel enviar pelo WhatsApp agora.' };
  }

  return { sucesso: true, totalProdutos: produtosNoCatalogo.length, reutilizado };
}

module.exports = { chave, definicao, executar, produtoVisivelNoCatalogo, versaoDoCatalogo };
