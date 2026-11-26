const prisma = require('../prisma');
const { chaveDeUrl } = require('../storage/minio');
const { calcularPreco } = require('../produto');
const { paraNumero, lerDinheiro, lerInteiro } = require('../utils/numero');
const { servicoBase } = require('../agenda/utilAgenda');

// Limites sensatos do cadastro.
const NOME_MAX = 120;
const DESCRICAO_MAX = 2000;
const PRECO_MAX = 1_000_000;
const ESTOQUE_MAX = 1_000_000;
const DURACAO_MIN = 5;
const DURACAO_MAX = 720; // 12 h
const TIPOS = ['FISICO', 'SERVICO'];
const VISIBILIDADES = ['ATIVO', 'PAUSADO', 'ARQUIVADO'];
const LUCRO_TIPOS = ['VALOR', 'PERCENTUAL'];
const MAX_VARIACOES = 50;

/**
 * Valida que a URL de imagem foi gerada por nosso storage e pertence a este
 * tenant. Aceita null/empty (campo opcional). Retorna null se OK, ou string
 * com motivo de rejeicao.
 */
function validarImagemUrlDoTenant(imagemUrl, clienteId) {
  if (imagemUrl === null || imagemUrl === undefined || imagemUrl === '') return null;
  if (typeof imagemUrl !== 'string') return 'imagemUrl invalida.';
  const key = chaveDeUrl(imagemUrl);
  if (!key) return 'URL nao reconhecida pelo storage.';
  if (!key.startsWith(`produtos/${clienteId}/`)) return 'imagemUrl nao pertence a este tenant.';
  return null;
}

// Valida que os especialistas pertencem ao tenant. Retorna os ids validos.
async function validarEspecialistas(clienteId, ids) {
  if (!Array.isArray(ids)) return [];
  const limpos = ids.filter((x) => typeof x === 'string');
  if (limpos.length === 0) return [];
  const esps = await prisma.especialista.findMany({
    where: { id: { in: limpos }, clienteId },
    select: { id: true },
  });
  return esps.map((e) => e.id);
}

const vazio = (v) => v === undefined || v === null || v === '';

function lerTextoCampo(valor, { max, obrigatorio = false }) {
  if (vazio(valor)) return obrigatorio ? { erro: 'obrigatorio' } : { valor: null };
  if (typeof valor !== 'string') return { erro: 'tipo' };
  const t = valor.trim();
  if (!t) return obrigatorio ? { erro: 'obrigatorio' } : { valor: null };
  if (t.length > max) return { erro: 'tamanho' };
  return { valor: t };
}

/**
 * Le o corpo de uma variacao SO com os campos permitidos (nunca id,
 * produtoId, criadoEm...). Funcao pura — testavel sem banco.
 *   parcial=true  -> edicao (so o que veio); `atual` = variacao no banco.
 * Preco: com lucroTipo/lucroValor, sai de custo + lucro; com preco explicito
 * (sem lucro), vale o preco e o lucro vira (preco - custo) em R$.
 * @returns {{ data: object } | { erro: string, campos: string[] }}
 */
function lerVariacao(body, { parcial = false, atual = null, prefixo = '' } = {}) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!b) return { erro: 'Variação inválida.', campos: [prefixo || 'variacao'] };
  const data = {};
  const erros = [];
  const falha = (campo, msg) => erros.push({ campo: `${prefixo}${campo}`, msg });

  if (!parcial || b.nome !== undefined) {
    const r = lerTextoCampo(b.nome, { max: NOME_MAX, obrigatorio: !parcial });
    if (r.erro) falha('nome', r.erro === 'tamanho' ? `Nome da variação com no máximo ${NOME_MAX} caracteres.` : 'Informe o nome da variação.');
    else if (r.valor !== null) data.nome = r.valor;
    else if (parcial) falha('nome', 'Informe o nome da variação.');
  }
  if (b.sku !== undefined) {
    const r = lerTextoCampo(b.sku, { max: 60 });
    if (r.erro) falha('sku', 'SKU inválido (até 60 caracteres).'); else data.sku = r.valor;
  }
  if (b.localizacao !== undefined) {
    const r = lerTextoCampo(b.localizacao, { max: NOME_MAX });
    if (r.erro) falha('localizacao', 'Localização inválida.'); else data.localizacao = r.valor;
  }
  if (b.duracaoMin !== undefined) {
    if (vazio(b.duracaoMin)) data.duracaoMin = null;
    else {
      const r = lerInteiro(b.duracaoMin, { min: DURACAO_MIN, max: DURACAO_MAX });
      if (!r.ok) falha('duracaoMin', `Duração inválida: use de ${DURACAO_MIN} a ${DURACAO_MAX} minutos.`); else data.duracaoMin = r.valor;
    }
  }
  for (const campo of ['estoqueAtual', 'estoqueMinimo', 'estoqueIdeal']) {
    if (b[campo] === undefined) continue;
    if (vazio(b[campo])) { data[campo] = 0; continue; }
    const r = lerInteiro(b[campo], { min: 0, max: ESTOQUE_MAX });
    if (!r.ok) falha(campo, 'Quantidade inválida: use um número inteiro a partir de zero.'); else data[campo] = r.valor;
  }

  // ---- preco / custo / lucro ----
  let custo = null;
  if (b.precoCusto !== undefined) {
    if (vazio(b.precoCusto)) custo = 0;
    else {
      const r = lerDinheiro(b.precoCusto, { min: 0, max: PRECO_MAX });
      if (!r.ok) falha('precoCusto', `Custo: ${r.erro}`); else custo = r.valor;
    }
  }
  let lucroTipo = null;
  if (b.lucroTipo !== undefined && !vazio(b.lucroTipo)) {
    if (!LUCRO_TIPOS.includes(b.lucroTipo)) falha('lucroTipo', 'Tipo de lucro inválido.'); else lucroTipo = b.lucroTipo;
  }
  let lucroValor = null;
  if (b.lucroValor !== undefined) {
    const n = vazio(b.lucroValor) ? 0 : paraNumero(b.lucroValor);
    if (!Number.isFinite(n) || Math.abs(n) > PRECO_MAX) falha('lucroValor', 'Lucro inválido.');
    else lucroValor = Math.round(n * 100) / 100;
  }
  let precoExplicito = null;
  if (b.preco !== undefined) {
    if (vazio(b.preco)) precoExplicito = 0;
    else {
      const r = lerDinheiro(b.preco, { min: 0, max: PRECO_MAX });
      if (!r.ok) falha('preco', `Preço: ${r.erro}`); else precoExplicito = r.valor;
    }
  }

  if (!erros.length) {
    const custoEf = custo ?? atual?.precoCusto ?? 0;
    const usaLucro = lucroTipo !== null || lucroValor !== null;
    if (custo !== null) data.precoCusto = custo;
    if (usaLucro) {
      const tipo = lucroTipo ?? atual?.lucroTipo ?? 'VALOR';
      const valor = lucroValor ?? atual?.lucroValor ?? 0;
      data.lucroTipo = tipo;
      data.lucroValor = valor;
      data.preco = calcularPreco(custoEf, tipo, valor);
    } else if (precoExplicito !== null) {
      data.preco = precoExplicito;
      if (custo !== null || atual) {
        data.lucroTipo = 'VALOR';
        data.lucroValor = Math.round((precoExplicito - custoEf) * 100) / 100;
      }
    } else if (custo !== null && atual) {
      data.preco = calcularPreco(custoEf, atual.lucroTipo, atual.lucroValor);
    } else if (!parcial) {
      data.preco = 0;
    }
    if (data.preco !== undefined && (!Number.isFinite(data.preco) || data.preco < 0 || data.preco > PRECO_MAX)) {
      falha('preco', `O preço de venda precisa ficar entre R$ 0 e R$ ${PRECO_MAX.toLocaleString('pt-BR')}.`);
    }
  }

  if (erros.length) return { erro: erros.length === 1 ? erros[0].msg : 'Confira os campos destacados.', campos: erros.map((e) => e.campo) };
  return { data };
}

// Valida temDevolucao/diasParaDevolucaoPadrao dado o tipo EFETIVO do produto
// (do body em criar; do body ou do banco em atualizar, se o tipo nao mudou
// nesta mesma requisicao). Funcao pura — testavel sem I/O. SERVICO nao tem
// parametrizacao de devolucao (nao faz sentido "devolver" um corte de cabelo).
function validarCamposDevolucao({ tipoEfetivo, temDevolucao, diasParaDevolucaoPadrao }) {
  const data = {};
  if (temDevolucao !== undefined) {
    if (typeof temDevolucao !== 'boolean') return { erro: 'temDevolucao deve ser true ou false.', campo: 'temDevolucao' };
    if (temDevolucao && tipoEfetivo === 'SERVICO') {
      return { erro: 'Servico nao tem parametrizacao de devolucao.', campo: 'temDevolucao' };
    }
    data.temDevolucao = temDevolucao;
  }
  if (diasParaDevolucaoPadrao !== undefined) {
    if (diasParaDevolucaoPadrao === null || diasParaDevolucaoPadrao === '') {
      data.diasParaDevolucaoPadrao = null;
    } else {
      const r = lerInteiro(diasParaDevolucaoPadrao, { min: 1, max: 3650 });
      if (!r.ok) {
        return { erro: 'diasParaDevolucaoPadrao deve ser um inteiro maior que zero.', campo: 'diasParaDevolucaoPadrao' };
      }
      data.diasParaDevolucaoPadrao = r.valor;
    }
  }
  return { data };
}

/**
 * Campos do produto (nome, descricao, tipo, visibilidade) — pura.
 * @returns {{ data } | { erro, campos }}
 */
function lerCamposProduto(body, { parcial = false } = {}) {
  const data = {};
  const erros = [];
  if (!parcial || body.nome !== undefined) {
    const r = lerTextoCampo(body.nome, { max: NOME_MAX, obrigatorio: true });
    if (r.erro) erros.push({ campo: 'nome', msg: r.erro === 'tamanho' ? `O nome pode ter no máximo ${NOME_MAX} caracteres.` : 'Informe o nome.' });
    else data.nome = r.valor;
  }
  if (body.descricao !== undefined) {
    const r = lerTextoCampo(body.descricao, { max: DESCRICAO_MAX });
    if (r.erro) erros.push({ campo: 'descricao', msg: `A descrição pode ter no máximo ${DESCRICAO_MAX} caracteres.` });
    else data.descricao = r.valor;
  }
  if (!parcial || body.tipo !== undefined) {
    const tipo = vazio(body.tipo) && !parcial ? 'FISICO' : body.tipo;
    if (!TIPOS.includes(tipo)) erros.push({ campo: 'tipo', msg: 'Tipo inválido.' }); else data.tipo = tipo;
  }
  if (!parcial || body.visibilidade !== undefined) {
    const vis = vazio(body.visibilidade) && !parcial ? 'ATIVO' : body.visibilidade;
    if (!VISIBILIDADES.includes(vis)) erros.push({ campo: 'visibilidade', msg: 'Visibilidade inválida.' }); else data.visibilidade = vis;
  }
  if (erros.length) return { erro: erros.length === 1 ? erros[0].msg : 'Confira os campos destacados.', campos: erros.map((e) => e.campo) };
  return { data };
}

// Include padrao dos especialistas vinculados (M:N via EspecialistaServico).
const INCLUDE_ESPECIALISTAS = {
  especialistas: { select: { especialista: { select: { id: true, nome: true, ativo: true } } } },
};

// Achata o produto pra UI: especialistas como [{ id, nome, ativo }].
function formatarProduto(p) {
  if (!p) return p;
  return {
    ...p,
    especialistas: Array.isArray(p.especialistas)
      ? p.especialistas.map((es) => es.especialista).filter(Boolean)
      : [],
  };
}

const negado = (res) => res.status(403).json({ error: 'Acesso negado: ID do cliente ausente.' });
const idValido = (id) => typeof id === 'string' && id.length > 0 && id.length <= 64;

/**
 * O que ainda usa este servico: horarios futuros (pelo nome), pacotes com
 * cliente ativa e fila de espera. Usado pra avisar antes de excluir.
 */
async function usoDoServico(produto) {
  const agora = new Date();
  const base = servicoBase(produto.nome);
  const [futuros, pacotesAtivos, fila] = await Promise.all([
    prisma.agendamento.findMany({
      where: { clienteId: produto.clienteId, data: { gte: agora }, status: { in: ['PENDING', 'CONFIRMED'] }, servico: { startsWith: produto.nome } },
      select: { servico: true },
    }),
    prisma.pacoteCliente.count({ where: { clienteId: produto.clienteId, status: 'ATIVO', modelo: { produtoId: produto.id } } }),
    prisma.listaEspera.count({ where: { clienteId: produto.clienteId, produtoId: produto.id, status: { in: ['AGUARDANDO', 'OFERTADO'] } } }),
  ]);
  return { agendamentosFuturos: futuros.filter((a) => servicoBase(a.servico) === base).length, pacotesAtivos, fila };
}

class CatalogoController {
  async listar(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return negado(res);
      const { buscar, categoriaId, tipo, visibilidade } = req.query;

      const onde = {
        clienteId,
        nome: typeof buscar === 'string' && buscar ? { contains: buscar.slice(0, 120), mode: 'insensitive' } : undefined,
        categoriaId: typeof categoriaId === 'string' && categoriaId ? categoriaId : undefined,
        tipo: TIPOS.includes(tipo) ? tipo : undefined,
        visibilidade: VISIBILIDADES.includes(visibilidade) ? visibilidade : undefined,
      };

      const produtos = await prisma.produto.findMany({
        where: onde,
        include: { variacoes: { orderBy: { criadoEm: 'asc' } }, categoria: true, ...INCLUDE_ESPECIALISTAS },
        orderBy: { nome: 'asc' }
      });
      res.json(produtos.map(formatarProduto));
    } catch (error) {
      console.error('[catalogo/listar]', error);
      res.status(500).json({ error: 'Erro ao listar catálogo' });
    }
  }

  async criar(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return negado(res);
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const { variacoes, categoriaId, imagemUrl, duracaoMin, preco, especialistasIds, temDevolucao, diasParaDevolucaoPadrao } = body;

      const campos = lerCamposProduto(body);
      if (campos.erro) return res.status(422).json({ error: campos.erro, campos: campos.campos });
      const { tipo } = campos.data;

      const { data: dadosDevolucao, erro: erroDevolucao, campo: campoDevolucao } = validarCamposDevolucao({
        tipoEfetivo: tipo, temDevolucao, diasParaDevolucaoPadrao,
      });
      if (erroDevolucao) return res.status(422).json({ error: erroDevolucao, campos: [campoDevolucao] });

      // Categoria financeira (obrigatoria conforme regra de negocio), do mesmo negocio.
      if (!categoriaId) {
        return res.status(422).json({ error: tipo === 'SERVICO' ? 'Escolha a categoria do serviço.' : 'Escolha a categoria do produto.', campos: ['categoriaId'] });
      }
      if (typeof categoriaId !== 'string') return res.status(422).json({ error: 'Categoria inválida.', campos: ['categoriaId'] });
      const categoriaExiste = await prisma.categoriaFinanceira.findFirst({ where: { id: categoriaId, clienteId }, select: { id: true } });
      if (!categoriaExiste) return res.status(404).json({ error: 'Categoria não encontrada.', campos: ['categoriaId'] });

      // Serviço só existe ligado a quem o executa: exige ao menos 1 especialista
      // (a agenda usa esse vínculo pra reservar o horário do profissional).
      const especialistasValidos = await validarEspecialistas(clienteId, especialistasIds);
      if (tipo === 'SERVICO' && especialistasValidos.length === 0) {
        return res.status(422).json({ error: 'Escolha quem atende este serviço.', campos: ['especialistasIds'] });
      }

      // Imagens: produto e CADA variacao. Nao deixa usar URL de outro negocio.
      const motivoProduto = validarImagemUrlDoTenant(imagemUrl, clienteId);
      if (motivoProduto) return res.status(422).json({ error: motivoProduto, campos: ['imagemUrl'] });

      if (variacoes !== undefined && variacoes !== null && !Array.isArray(variacoes)) {
        return res.status(422).json({ error: 'variacoes deve ser uma lista.', campos: ['variacoes'] });
      }
      const brutas = Array.isArray(variacoes) ? variacoes : [];
      if (brutas.length > MAX_VARIACOES) return res.status(422).json({ error: `No máximo ${MAX_VARIACOES} variações.`, campos: ['variacoes'] });
      const variacoesLidas = [];
      for (let i = 0; i < brutas.length; i++) {
        const lida = lerVariacao(brutas[i], { prefixo: `variacoes[${i}].` });
        if (lida.erro) return res.status(422).json({ error: `Variação ${i + 1}: ${lida.erro}`, campos: lida.campos });
        const motivoVar = validarImagemUrlDoTenant(brutas[i]?.imagemUrl, clienteId);
        if (motivoVar) return res.status(422).json({ error: `Variação ${i + 1}: ${motivoVar}`, campos: [`variacoes[${i}].imagemUrl`] });
        variacoesLidas.push({ ...lida.data, imagemUrl: brutas[i]?.imagemUrl || null });
      }

      // Atalho do Catalogo: preco/duracao no nivel do produto criam a variacao
      // "Padrao" (so SERVICO, e so quando nao vieram variacoes explicitas).
      if (tipo === 'SERVICO' && variacoesLidas.length === 0 && (!vazio(duracaoMin) || !vazio(preco))) {
        const lida = lerVariacao({ nome: 'Padrão', preco: vazio(preco) ? 0 : preco, duracaoMin: vazio(duracaoMin) ? null : duracaoMin });
        if (lida.erro) return res.status(422).json({ error: lida.erro, campos: lida.campos });
        variacoesLidas.push(lida.data);
      }

      const produto = await prisma.produto.create({
        data: {
          clienteId,
          categoriaId,
          ...campos.data,
          imagemUrl: imagemUrl || null,
          ...dadosDevolucao,
          variacoes: variacoesLidas.length > 0 ? { create: variacoesLidas } : undefined,
          especialistas: especialistasValidos.length > 0 ? {
            create: especialistasValidos.map((especialistaId) => ({ especialistaId }))
          } : undefined
        },
        include: { variacoes: true, ...INCLUDE_ESPECIALISTAS }
      });

      res.status(201).json(formatarProduto(produto));
    } catch (error) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'Já existe uma variação com esse SKU.', campos: ['sku'] });
      console.error('[catalogo/criar]', error);
      res.status(500).json({ error: 'Erro ao criar produto' });
    }
  }

  async buscarPorId(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      if (!clienteId) return negado(res);
      if (!idValido(id)) return res.status(404).json({ error: 'Produto não encontrado' });

      const produto = await prisma.produto.findFirst({
        where: { id, clienteId },
        include: { variacoes: { orderBy: { criadoEm: 'asc' } }, ...INCLUDE_ESPECIALISTAS }
      });

      if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });
      res.json(formatarProduto(produto));
    } catch (error) {
      console.error('[catalogo/buscar]', error);
      res.status(500).json({ error: 'Erro ao buscar produto' });
    }
  }

  async atualizar(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      if (!clienteId) return negado(res);
      if (!idValido(id)) return res.status(404).json({ error: 'Produto não encontrado' });
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const { categoriaId, imagemUrl, duracaoMin, preco, especialistasIds, temDevolucao, diasParaDevolucaoPadrao } = body;

      const atual = await prisma.produto.findFirst({
        where: { id, clienteId },
        select: { id: true, tipo: true, variacoes: { orderBy: { criadoEm: 'asc' }, select: { id: true, precoCusto: true, lucroTipo: true, lucroValor: true } } },
      });
      if (!atual) return res.status(404).json({ error: 'Produto não encontrado' });

      const campos = lerCamposProduto(body, { parcial: true });
      if (campos.erro) return res.status(422).json({ error: campos.erro, campos: campos.campos });
      const dadosUpdate = { ...campos.data };
      const tipoEfetivo = dadosUpdate.tipo || atual.tipo;

      if (categoriaId !== undefined) {
        if (vazio(categoriaId)) return res.status(422).json({ error: 'Escolha a categoria.', campos: ['categoriaId'] });
        if (typeof categoriaId !== 'string') return res.status(422).json({ error: 'Categoria inválida.', campos: ['categoriaId'] });
        const cat = await prisma.categoriaFinanceira.findFirst({ where: { id: categoriaId, clienteId }, select: { id: true } });
        if (!cat) return res.status(404).json({ error: 'Categoria não encontrada.', campos: ['categoriaId'] });
        dadosUpdate.categoriaId = categoriaId;
      }
      if (imagemUrl !== undefined) {
        const motivo = validarImagemUrlDoTenant(imagemUrl, clienteId);
        if (motivo) return res.status(422).json({ error: motivo, campos: ['imagemUrl'] });
        dadosUpdate.imagemUrl = imagemUrl || null;
      }

      const { data: dadosDevolucao, erro: erroDevolucao, campo: campoDevolucao } = validarCamposDevolucao({
        tipoEfetivo, temDevolucao, diasParaDevolucaoPadrao,
      });
      if (erroDevolucao) return res.status(422).json({ error: erroDevolucao, campos: [campoDevolucao] });
      Object.assign(dadosUpdate, dadosDevolucao);

      // duracaoMin/preco do formulario do servico: vao pra 1a variacao (cria
      // a "Padrão" se ainda nao tem nenhuma).
      let dadosVariacao = null;
      if (tipoEfetivo === 'SERVICO' && (duracaoMin !== undefined || preco !== undefined)) {
        const parcialVar = {};
        if (duracaoMin !== undefined) parcialVar.duracaoMin = duracaoMin;
        if (preco !== undefined && !vazio(preco)) parcialVar.preco = preco;
        const lida = lerVariacao(parcialVar, { parcial: true, atual: atual.variacoes[0] || null });
        if (lida.erro) return res.status(422).json({ error: lida.erro, campos: lida.campos });
        dadosVariacao = lida.data;
      }

      let validos = null;
      if (especialistasIds !== undefined) {
        validos = await validarEspecialistas(clienteId, especialistasIds);
        if (tipoEfetivo === 'SERVICO' && validos.length === 0) {
          return res.status(422).json({ error: 'Escolha quem atende este serviço.', campos: ['especialistasIds'] });
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.produto.update({ where: { id: atual.id }, data: dadosUpdate });
        if (dadosVariacao && Object.keys(dadosVariacao).length) {
          if (atual.variacoes.length === 0) {
            await tx.variacaoProduto.create({ data: { produtoId: atual.id, nome: 'Padrão', preco: 0, ...dadosVariacao } });
          } else {
            await tx.variacaoProduto.update({ where: { id: atual.variacoes[0].id }, data: dadosVariacao });
          }
        }
        if (validos) {
          await tx.especialistaServico.deleteMany({ where: { produtoId: atual.id } });
          if (validos.length) await tx.especialistaServico.createMany({ data: validos.map((eid) => ({ especialistaId: eid, produtoId: atual.id })) });
        }
      });

      const produtoAtualizado = await prisma.produto.findFirst({
        where: { id: atual.id, clienteId },
        include: { variacoes: { orderBy: { criadoEm: 'asc' } }, ...INCLUDE_ESPECIALISTAS },
      });
      res.json(formatarProduto(produtoAtualizado));
    } catch (error) {
      console.error('[catalogo/atualizar]', error);
      res.status(500).json({ error: 'Erro ao atualizar produto' });
    }
  }

  async excluir(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      if (!clienteId) return negado(res);
      if (!idValido(id)) return res.status(404).json({ error: 'Produto não encontrado' });

      const produto = await prisma.produto.findFirst({ where: { id, clienteId }, select: { id: true, clienteId: true, nome: true, tipo: true } });
      if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });

      const movimentacoes = await prisma.movimentacaoEstoque.count({ where: { variacao: { produtoId: id } } });
      if (movimentacoes > 0) {
        return res.status(422).json({
          error: 'Não é possível excluir um produto que possui movimentações de estoque registradas.'
        });
      }

      // Servico em uso: avisa (horarios marcados, pacotes, fila) e so exclui
      // quando a tela confirmar (?confirmar=1). Pacote com cliente ativa bloqueia.
      if (produto.tipo === 'SERVICO') {
        const uso = await usoDoServico(produto);
        if (uso.pacotesAtivos > 0) {
          return res.status(409).json({
            error: `Este serviço tem ${uso.pacotesAtivos} pacote(s) de cliente em uso. Arquive o serviço em vez de excluir.`,
            codigo: 'SERVICO_EM_USO', uso,
          });
        }
        if ((uso.agendamentosFuturos > 0 || uso.fila > 0) && req.query.confirmar !== '1') {
          const partes = [];
          if (uso.agendamentosFuturos) partes.push(`${uso.agendamentosFuturos} horário(s) marcado(s)`);
          if (uso.fila) partes.push(`${uso.fila} pessoa(s) na fila de espera`);
          return res.status(409).json({
            error: `Este serviço tem ${partes.join(' e ')}. Os horários continuam na agenda, mas o serviço some do catálogo e do link. Confirme para excluir mesmo assim.`,
            codigo: 'CONFIRMAR_EXCLUSAO', uso,
          });
        }
      }

      const r = await prisma.produto.deleteMany({ where: { id, clienteId } });
      if (!r.count) return res.status(404).json({ error: 'Produto não encontrado' });

      res.json({ message: 'Produto excluído com sucesso' });
    } catch (error) {
      if (error?.code === 'P2003') {
        return res.status(409).json({ error: 'Este item já foi usado (venda, aluguel ou nota) e não pode ser excluído. Arquive em vez de excluir.' });
      }
      console.error('[catalogo/excluir]', error);
      res.status(500).json({ error: 'Erro ao excluir produto' });
    }
  }

  // CRUD de Variações Individual — sempre com o negocio do usuario.
  async criarVariacao(req, res) {
    try {
      const { produtoId } = req.params;
      const { clienteId } = req.usuario;
      if (!clienteId) return negado(res);
      if (!idValido(produtoId)) return res.status(404).json({ error: 'Produto não encontrado' });

      const produto = await prisma.produto.findFirst({ where: { id: produtoId, clienteId }, select: { id: true } });
      if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });

      const lida = lerVariacao(req.body);
      if (lida.erro) return res.status(422).json({ error: lida.erro, campos: lida.campos });
      const motivo = validarImagemUrlDoTenant(req.body?.imagemUrl, clienteId);
      if (motivo) return res.status(422).json({ error: motivo, campos: ['imagemUrl'] });

      const total = await prisma.variacaoProduto.count({ where: { produtoId: produto.id } });
      if (total >= MAX_VARIACOES) return res.status(422).json({ error: `No máximo ${MAX_VARIACOES} variações por item.` });

      const variacao = await prisma.variacaoProduto.create({
        data: { ...lida.data, imagemUrl: req.body?.imagemUrl || null, produtoId: produto.id }
      });
      res.status(201).json(variacao);
    } catch (error) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'Já existe uma variação com esse SKU.', campos: ['sku'] });
      console.error('[catalogo/criarVariacao]', error);
      res.status(500).json({ error: 'Erro ao criar variação' });
    }
  }

  async editarVariacao(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      if (!clienteId) return negado(res);
      if (!idValido(id)) return res.status(404).json({ error: 'Variação não encontrada' });

      const variacao = await prisma.variacaoProduto.findFirst({
        where: { id, produto: { clienteId } },
        select: { id: true, precoCusto: true, lucroTipo: true, lucroValor: true },
      });
      if (!variacao) return res.status(404).json({ error: 'Variação não encontrada' });

      // So os campos permitidos: id, produtoId e afins sao ignorados.
      const lida = lerVariacao(req.body, { parcial: true, atual: variacao });
      if (lida.erro) return res.status(422).json({ error: lida.erro, campos: lida.campos });
      const data = { ...lida.data };
      if (req.body?.imagemUrl !== undefined) {
        const motivo = validarImagemUrlDoTenant(req.body.imagemUrl, clienteId);
        if (motivo) return res.status(422).json({ error: motivo, campos: ['imagemUrl'] });
        data.imagemUrl = req.body.imagemUrl || null;
      }

      // Escrita condicional pelo negocio (nao basta ter lido antes).
      const r = await prisma.variacaoProduto.updateMany({ where: { id, produto: { clienteId } }, data });
      if (!r.count) return res.status(404).json({ error: 'Variação não encontrada' });
      const atualizada = await prisma.variacaoProduto.findFirst({ where: { id, produto: { clienteId } } });
      res.json(atualizada);
    } catch (error) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'Já existe uma variação com esse SKU.', campos: ['sku'] });
      console.error('[catalogo/editarVariacao]', error);
      res.status(500).json({ error: 'Erro ao editar variação' });
    }
  }

  async excluirVariacao(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      if (!clienteId) return negado(res);
      if (!idValido(id)) return res.status(404).json({ error: 'Variação não encontrada' });

      // Isolamento: so acha (e so apaga) variacao de produto deste negocio.
      const variacao = await prisma.variacaoProduto.findFirst({ where: { id, produto: { clienteId } }, select: { id: true } });
      if (!variacao) return res.status(404).json({ error: 'Variação não encontrada' });

      const movimentacoes = await prisma.movimentacaoEstoque.count({ where: { variacaoId: id } });
      if (movimentacoes > 0) {
        return res.status(422).json({ error: 'Variação possui movimentações e não pode ser excluída.' });
      }

      const r = await prisma.variacaoProduto.deleteMany({ where: { id, produto: { clienteId } } });
      if (!r.count) return res.status(404).json({ error: 'Variação não encontrada' });
      res.json({ message: 'Variação excluída' });
    } catch (error) {
      if (error?.code === 'P2003') return res.status(409).json({ error: 'Esta variação já foi usada e não pode ser excluída.' });
      console.error('[catalogo/excluirVariacao]', error);
      res.status(500).json({ error: 'Erro ao excluir variação' });
    }
  }
}

const instancia = new CatalogoController();
// Expostas a parte pra teste unitario das regras puras (sem I/O).
instancia.validarCamposDevolucao = validarCamposDevolucao;
instancia.lerVariacao = lerVariacao;
instancia.lerCamposProduto = lerCamposProduto;
module.exports = instancia;
