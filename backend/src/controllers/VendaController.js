const porTelefone = require('../clientesFinais/porTelefone');
const prisma = require('../prisma');
const { helpers: caixaHelpers } = require('./CaixaController');
const { criarVenda, ErroVenda, centavos } = require('../services/vendaService');
const { gerarComissaoVenda, estornarComissaoVenda } = require('../agenda/comissoes');
const { obterOuAbrirSessaoCaixa } = require('../services/caixaAutomatico');
const { lockClienteAdvisory } = require('../utils/locks');
const { validarCpf } = require('../utils/validacaoFiscal');
const { buscarCupom, validarCupom } = require('../services/cupomService');
const { paraNumero, lerDinheiro, lerInteiro } = require('../utils/numero');
const { resolverPrecoVenda } = require('../produto');

// Limites sanitarios de entrada — defesa em profundidade contra valores
// absurdos/negativos (fat-finger ou abuso). Preco negativo viraria receita
// negativa; payload gigante viraria DoS/storage. OWASP: validacao de entrada.
const MAX_ITENS_VENDA = 100;
const MAX_QUANTIDADE_ITEM = 10000;
const MAX_VALOR_UNITARIO = 1000000; // R$ 1 milhao por unidade — teto de sanidade
const MAX_OBSERVACOES = 500;
const MAX_MOTIVO_CANCELAMENTO = 500;
const MAX_NOME_CLIENTE_FINAL = 120;
const MAX_PARCELAS = 24;
// Prazo maximo de um aluguel/devolucao a partir de hoje.
const MAX_DIAS_DEVOLUCAO = 730;
// Teto de seguranca da listagem — evita findMany ilimitado em tenant grande.
const LIMITE_LISTAGEM_PADRAO = 1000;
const LIMITE_LISTAGEM_MAX = 2000;
const DIA_MS = 24 * 60 * 60 * 1000;

// Formas de pagamento aceitas na venda (as mesmas da tela "Registrar venda").
// Os apelidos CARTAO_* vem de outras telas (pacotes) e viram o nome curto.
const METODOS_PAGAMENTO = ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'BOLETO', 'TRANSFERENCIA'];
const APELIDOS_METODO = { CARTAO_CREDITO: 'CREDITO', CARTAO_DEBITO: 'DEBITO' };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (v) => typeof v === 'string' && RE_UUID.test(v);

/**
 * Forma de pagamento: vazio = nao informado (null); senao, so as conhecidas.
 * PURA. @returns {{valor:string|null}|{erro:string}}
 */
function normalizarMetodoPagamento(metodo) {
  if (metodo === undefined || metodo === null || metodo === '') return { valor: null };
  if (typeof metodo !== 'string') return { erro: 'Forma de pagamento inválida.' };
  const m = metodo.trim().toUpperCase();
  if (!m) return { valor: null };
  const final = APELIDOS_METODO[m] || m;
  if (!METODOS_PAGAMENTO.includes(final)) {
    return { erro: 'Forma de pagamento inválida. Use Pix, Dinheiro, Débito, Crédito, Boleto ou Transferência.' };
  }
  return { valor: final };
}

/**
 * Parcelas (so anotacao no credito): vazio = 1; inteiro de 1 a 24.
 * Fora do credito sempre vira 1. PURA.
 */
function lerParcelas(parcelas, metodo) {
  if (parcelas === undefined || parcelas === null || parcelas === '') return { valor: 1 };
  const r = lerInteiro(parcelas, { min: 1, max: MAX_PARCELAS });
  if (!r.ok) return { erro: `Parcelas inválidas: use de 1 a ${MAX_PARCELAS}.` };
  return { valor: metodo === 'CREDITO' ? r.valor : 1 };
}

/**
 * Quem pode vender abaixo do preco do catalogo (desconto manual):
 *   - dono da conta (CLIENT), ADMINISTRADOR e ADMIN do sistema: sempre;
 *   - VENDEDOR: so com a permissao VENDAS.desconto = true.
 * Cupom continua valendo pra todos (criar cupom e so do papel privilegiado,
 * ver routes/campanhas.routes.js). PURA.
 */
function podeDarDesconto(usuario, permissoes) {
  const perfil = usuario?.perfil;
  if (perfil === 'ADMIN' || perfil === 'CLIENT' || perfil === 'ADMINISTRADOR') return true;
  return permissoes?.VENDAS?.desconto === true;
}

// Valida/normaliza os dados do cliente final digitados na hora da venda —
// usado quando o item exige devolucao e ainda nao ha um Lead selecionado no
// combobox. CPF normalizado pra so-digitos (mesmo padrao de crm.routes.js),
// e validado de verdade (digito verificador) porque o Lead e criado
// automaticamente, sem revisao humana como no CRM.
function validarClienteFinal({ nome, telefone, cpf } = {}) {
  const nomeSan = typeof nome === 'string' ? nome.trim().slice(0, MAX_NOME_CLIENTE_FINAL) : '';
  const telefoneSan = typeof telefone === 'string' ? telefone.replace(/\D/g, '') : '';
  const cpfSan = typeof cpf === 'string' ? cpf.replace(/\D/g, '') : '';

  if (!nomeSan) return { erro: 'Informe o nome do cliente.', campo: 'clienteFinal.nome' };
  if (telefoneSan.length < 10 || telefoneSan.length > 11) {
    return { erro: 'Telefone invalido — use DDD + numero (10 ou 11 digitos).', campo: 'clienteFinal.telefone' };
  }
  if (!validarCpf(cpfSan)) return { erro: 'CPF do cliente invalido.', campo: 'clienteFinal.cpf' };

  return { nome: nomeSan, telefone: telefoneSan, cpf: cpfSan };
}

/**
 * Le uma data "AAAA-MM-DD" (com ou sem hora) sem deixar o JS "consertar"
 * 31/02 para 03/03. Ano fora de 1900..2100 e recusado. PURA.
 * @returns {Date|null}
 */
function lerDataEstrita(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  const m = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (ano < 1900 || ano > 2100 || mes < 1 || mes > 12 || dia < 1) return null;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia > ultimoDia) return null;
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Resolve a data de devolucao de 1 item: usa a data explicita (se veio), ou o
// prazo padrao do produto (agora + diasParaDevolucaoPadrao dias). Sem nenhum
// dos dois, exige que o usuario informe manualmente. `agora` injetavel pra
// teste determinístico.
function resolverDataDevolucao({ dataDevolucaoInput, diasParaDevolucaoPadrao, nomeProduto, agora = new Date() }) {
  if (dataDevolucaoInput) {
    const d = lerDataEstrita(dataDevolucaoInput);
    if (!d) return { erro: `Data de devolucao invalida pra ${nomeProduto}.` };
    if (d.getTime() <= agora.getTime()) return { erro: `Data de devolucao de ${nomeProduto} precisa ser no futuro.` };
    if (d.getTime() > agora.getTime() + MAX_DIAS_DEVOLUCAO * DIA_MS) {
      return { erro: `Data de devolucao de ${nomeProduto} longe demais (máximo ${MAX_DIAS_DEVOLUCAO} dias).` };
    }
    return { data: d };
  }
  if (diasParaDevolucaoPadrao) {
    return { data: new Date(agora.getTime() + diasParaDevolucaoPadrao * DIA_MS) };
  }
  return { erro: `Informe a data de devolucao de ${nomeProduto}.` };
}

/**
 * Quanto devolver ao estoque ao cancelar: o saldo liquido das movimentacoes
 * da venda por variacao (VENDA negativa + DEVOLUCAO ja feitas). Devolucao de
 * aluguel ja concluida ou estorno anterior nao devolvem de novo. PURA.
 * @returns {Array<{variacaoId:string, quantidade:number, fisico:boolean}>}
 */
function calcularEstornoEstoque(movimentacoes) {
  const saldo = new Map();
  for (const m of movimentacoes || []) {
    const atual = saldo.get(m.variacaoId) || { soma: 0, fisico: false };
    atual.soma += Number(m.quantidade) || 0;
    if (m.variacao?.produto?.tipo === 'FISICO') atual.fisico = true;
    saldo.set(m.variacaoId, atual);
  }
  const estornos = [];
  for (const [variacaoId, { soma, fisico }] of saldo) {
    if (soma < 0) estornos.push({ variacaoId, quantidade: -soma, fisico });
  }
  return estornos;
}

function responderErroVenda(res, e) {
  return res.status(e.status || 422).json({
    erro: e.message,
    ...(e.codigo ? { codigo: e.codigo } : {}),
    ...(e.campos ? { campos: e.campos } : {}),
  });
}

class VendaController {

  async registrarVenda(req, res) {
    const { clienteId } = req.usuario;
    if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: ID do cliente ausente.' });

    // Aceita 2 formatos no body pra retrocompatibilidade:
    //   NOVO: { itens: [{ variacaoId, quantidade, valorUnitario? }], ... }
    //   LEGACY: { variacaoId, quantidade, valorTotal, ... } — 1 item
    // Se valorUnitario vier vazio, resolve pela regra do catalogo.
    const {
      leadId,
      // Dados do cliente final digitados na hora ({nome, telefone, cpf}) —
      // usado quando o carrinho tem item com devolucao e ainda nao ha um
      // Lead selecionado. Vira (ou reaproveita) um Lead de verdade.
      clienteFinal,
      itens: itensInput,
      variacaoId,           // legacy
      quantidade,           // legacy
      valorTotal,           // legacy
      metodoPagamento,
      observacoes,
      cupomCodigo,
      // categoriaId no body e IGNORADO — categoria vem do produto de cada item.
      // 'parcelas' e METADATA (anotada na descricao), nao gera lancamentos.
      parcelas,
      // Quem vendeu (profissional), pra comissao de produto. Opcional.
      especialistaId: especialistaIdInput,
    } = req.body || {};

    // Normaliza itens: legacy -> [{ ... }]; novo -> usa direto.
    let itens = [];
    if (Array.isArray(itensInput) && itensInput.length > 0) {
      itens = itensInput;
    } else if (variacaoId && quantidade) {
      const q = paraNumero(quantidade);
      const vt = paraNumero(valorTotal);
      itens = [{ variacaoId, quantidade, valorUnitario: Number.isFinite(vt) && Number.isFinite(q) && q > 0 ? vt / q : null }];
    } else {
      return res.status(400).json({
        erro: 'Informe pelo menos 1 item: { itens: [{ variacaoId, quantidade }] }',
        campos: ['itens'],
      });
    }

    if (itens.length > MAX_ITENS_VENDA) {
      return res.status(422).json({ erro: `Venda com itens demais (máximo ${MAX_ITENS_VENDA}).`, campos: ['itens'] });
    }

    // Sanitiza campos de texto livre (bounds de tamanho).
    const observacoesSan = typeof observacoes === 'string' ? observacoes.trim().slice(0, MAX_OBSERVACOES) : '';
    const metodo = normalizarMetodoPagamento(metodoPagamento);
    if (metodo.erro) return res.status(422).json({ erro: metodo.erro, campos: ['metodoPagamento'] });
    const metodoPagamentoSan = metodo.valor;
    const parc = lerParcelas(parcelas, metodoPagamentoSan);
    if (parc.erro) return res.status(422).json({ erro: parc.erro, campos: ['parcelas'] });

    // Cada item precisa de um variacaoId valido (texto no formato de id).
    if (itens.some((i) => !i || typeof i !== 'object' || !i.variacaoId)) {
      return res.status(400).json({ erro: 'Cada item precisa de variacaoId.', campos: ['itens'] });
    }
    if (itens.some((i) => !ehUuid(i.variacaoId))) {
      return res.status(404).json({ erro: 'Produto da venda não encontrado.', campos: ['itens'] });
    }
    const variacaoIds = [...new Set(itens.map((i) => i.variacaoId))];

    if (leadId !== undefined && leadId !== null && leadId !== '' && !ehUuid(leadId)) {
      return res.status(404).json({ erro: 'Cliente não encontrado.', campos: ['leadId'] });
    }

    try {
      const variacoesDb = await prisma.variacaoProduto.findMany({
        where: { id: { in: variacaoIds }, produto: { clienteId } },
        include: { produto: true },
      });
      const mapaVariacao = new Map(variacoesDb.map((v) => [v.id, v]));

      // Valida cada item (existe + quantidade inteira + preco). A conferencia
      // de estoque aqui e so pra mensagem rapida; a garantia de verdade e a
      // baixa condicional dentro da transacao (vendaService).
      const itensValidados = [];
      const qtdPorVariacao = new Map();
      let algumItemPrecisaDevolucao = false;
      let temDescontoManual = false;
      for (const item of itens) {
        const v = mapaVariacao.get(item.variacaoId);
        if (!v) {
          return res.status(404).json({ erro: 'Produto da venda não encontrado.', campos: ['itens'] });
        }
        const q = lerInteiro(item.quantidade, { min: 1, max: MAX_QUANTIDADE_ITEM });
        if (!q.ok) {
          return res.status(422).json({ erro: `Quantidade inválida pra ${v.produto.nome}: use um número inteiro de 1 a ${MAX_QUANTIDADE_ITEM}.`, campos: ['quantidade'] });
        }
        const qtd = q.valor;
        const somaQtd = (qtdPorVariacao.get(v.id) || 0) + qtd;
        qtdPorVariacao.set(v.id, somaQtd);
        if (v.produto.tipo === 'FISICO' && v.estoqueAtual < somaQtd) {
          return res.status(422).json({
            erro: `Estoque insuficiente em ${v.produto.nome} (${v.nome}). Disponível: ${v.estoqueAtual}, solicitado: ${somaQtd}.`,
            disponivel: v.estoqueAtual,
            codigo: 'ESTOQUE_INSUFICIENTE',
          });
        }

        // Preco: valorUnitario explicito (sobrescrita manual) ou o do catalogo.
        const precoCatalogo = resolverPrecoVenda(v);
        let precoUnit = precoCatalogo;
        if (item.valorUnitario !== undefined && item.valorUnitario !== null && item.valorUnitario !== '') {
          const p = lerDinheiro(item.valorUnitario, { min: 0, max: MAX_VALOR_UNITARIO });
          if (!p.ok) {
            return res.status(422).json({ erro: `Preço inválido pra ${v.produto.nome}: ${p.erro}`, campos: ['valorUnitario'] });
          }
          precoUnit = p.valor;
          if (precoUnit < centavos(precoCatalogo)) temDescontoManual = true;
        }
        // Preço não pode ser negativo (viraria receita negativa) nem absurdo.
        if (!Number.isFinite(precoUnit) || precoUnit < 0 || precoUnit > MAX_VALOR_UNITARIO) {
          return res.status(422).json({ erro: `Preço inválido pra ${v.produto.nome} — não pode ser negativo.`, campos: ['valorUnitario'] });
        }

        // Aluguel/devolucao: produto marcado exige uma data de devolucao (a
        // explicita do item, ou o prazo padrao do produto) e, mais adiante,
        // um cliente identificado (leadId ou clienteFinal).
        let dataDevolucao;
        if (v.produto.temDevolucao) {
          algumItemPrecisaDevolucao = true;
          const { erro: erroData, data: dataResolvida } = resolverDataDevolucao({
            dataDevolucaoInput: item.dataDevolucao,
            diasParaDevolucaoPadrao: v.produto.diasParaDevolucaoPadrao,
            nomeProduto: `${v.produto.nome} (${v.nome})`,
          });
          if (erroData) return res.status(422).json({ erro: erroData, campos: ['dataDevolucao'] });
          dataDevolucao = dataResolvida;
        }

        itensValidados.push({
          variacao: v, quantidade: qtd, precoUnitario: precoUnit, subtotal: centavos(precoUnit * qtd),
          ...(dataDevolucao ? { dataDevolucao } : {}),
        });
      }

      // Desconto manual (preco abaixo do catalogo) so com permissao.
      if (temDescontoManual) {
        let permissoes = null;
        if (!podeDarDesconto(req.usuario, null) && req.usuario.id) {
          const u = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { permissoes: true } });
          permissoes = u?.permissoes || null;
        }
        if (!podeDarDesconto(req.usuario, permissoes)) {
          return res.status(403).json({
            erro: 'Você não tem permissão para vender abaixo do preço do catálogo. Peça ao dono da conta a permissão de desconto ou use um cupom.',
            codigo: 'SEM_PERMISSAO_DESCONTO',
            campos: ['valorUnitario'],
          });
        }
      }

      // Cliente informado tem que ser deste negocio (404 se nao for).
      let leadIdEfetivo = null;
      if (leadId) {
        const lead = await prisma.lead.findFirst({ where: { id: leadId, clienteId }, select: { id: true } });
        if (!lead) return res.status(404).json({ erro: 'Cliente não encontrado.', campos: ['leadId'] });
        leadIdEfetivo = lead.id;
      }

      // Item com devolucao exige cliente identificado — ou um Lead ja
      // existente (leadId), ou os dados digitados na hora (clienteFinal),
      // que viram (ou reaproveitam) um Lead de verdade.
      if (algumItemPrecisaDevolucao && !leadIdEfetivo) {
        const { erro: erroClienteFinal, campo: campoClienteFinal, nome, telefone, cpf } = validarClienteFinal(clienteFinal);
        if (erroClienteFinal) {
          return res.status(422).json({
            erro: `Item com devolução precisa de um cliente identificado. ${erroClienteFinal}`,
            campos: [campoClienteFinal],
          });
        }
        let lead = cpf ? await prisma.lead.findFirst({ where: { clienteId, cpf } }) : null;
        if (!lead) ({ lead } = await porTelefone.acharOuCriarLead({ clienteId, telefone, nome, cpf, origem: 'VENDA' }));
        if (!lead) lead = await prisma.lead.create({ data: { clienteId, nome, telefone, cpf, origem: 'VENDA', valor: 0 } });
        leadIdEfetivo = lead.id;
      }

      // Venda comum com o telefone do cliente informado: liga ao cadastro dele
      // (ou cria) pela regra unica, pra aparecer na ficha e na conversa.
      if (!leadIdEfetivo && clienteFinal?.telefone) {
        const { lead } = await porTelefone.acharOuCriarLead({
          clienteId, telefone: clienteFinal.telefone, nome: clienteFinal.nome, cpf: clienteFinal.cpf, origem: 'VENDA',
        }).catch(() => ({ lead: null }));
        if (lead) leadIdEfetivo = lead.id;
      }

      const valorTotalCalculado = centavos(itensValidados.reduce((acc, i) => acc + i.subtotal, 0));

      // Cupom de desconto — opcional. Validado AQUI pra mensagem clara; o
      // consumo (condicional ao limite) acontece na transacao da venda.
      let cupomAplicado = null;
      if (cupomCodigo !== undefined && cupomCodigo !== null && cupomCodigo !== '') {
        if (typeof cupomCodigo !== 'string') {
          return res.status(422).json({ erro: 'Código de cupom inválido.', campos: ['cupomCodigo'] });
        }
        if (cupomCodigo.trim()) {
          const cupom = await buscarCupom(clienteId, cupomCodigo.slice(0, 60));
          const resultado = validarCupom({ cupom, valorTotal: valorTotalCalculado });
          if (!resultado.valido) {
            return res.status(422).json({ erro: resultado.motivo, campos: ['cupomCodigo'] });
          }
          cupomAplicado = { cupomId: cupom.id, valorComDesconto: resultado.valorComDesconto };
        }
      }

      // Sem caixa aberto: se o tenant usa caixa automatico (padrao), abre um
      // agora com o fundo do ultimo fechamento. Desligado, volta a exigir
      // abertura manual (409 com codigo pro front mostrar o aviso).
      let sessaoAberta = await caixaHelpers.buscarSessaoAberta(clienteId);
      if (!sessaoAberta) {
        const cfg = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { caixaAutomatico: true } });
        if (cfg?.caixaAutomatico) {
          sessaoAberta = await prisma.$transaction(async (tx) => {
            await lockClienteAdvisory(tx, clienteId);
            return (await obterOuAbrirSessaoCaixa(tx, clienteId)).sessao;
          });
        }
      }
      if (!sessaoAberta) {
        return res.status(409).json({
          erro: 'Abra o caixa antes de registrar a venda. Ele controla o saldo do dia e fica disponível em Financeiro · Caixa.',
          codigo: 'CAIXA_FECHADO',
        });
      }

      // Descricao resumida: nome do 1o item + "(+N itens)" se houver mais.
      // Anota parcelas quando >1 (metadata pra relatorio).
      const descPrincipal = itensValidados[0].variacao.produto.nome;
      const parcelasNum = parc.valor;
      const sufixoParcelas = parcelasNum > 1 ? ` · ${parcelasNum}x no cartão` : '';
      const descricaoVenda = observacoesSan
        ? `${observacoesSan}${sufixoParcelas}`
        : itensValidados.length === 1
          ? `${descPrincipal} (${itensValidados[0].variacao.nome}) x${itensValidados[0].quantidade}${sufixoParcelas}`
          : `${descPrincipal} +${itensValidados.length - 1} item(s)${sufixoParcelas}`;

      // Quem vendeu: o informado (se for profissional ativa do negocio) ou,
      // sem nada, a propria pessoa logada quando ela e uma profissional.
      let especialistaId = null;
      if (especialistaIdInput) {
        const esp = ehUuid(especialistaIdInput)
          ? await prisma.especialista.findFirst({ where: { id: especialistaIdInput, clienteId, ativo: true }, select: { id: true } })
          : null;
        if (!esp) return res.status(422).json({ erro: 'Profissional inválida para esta venda.', campos: ['especialistaId'] });
        especialistaId = esp.id;
      } else if (req.usuario.id) {
        const propria = await prisma.especialista.findFirst({ where: { usuarioId: req.usuario.id, clienteId, ativo: true }, select: { id: true } });
        especialistaId = propria?.id || null;
      }

      // Nucleo transacional (venda + baixa condicional de estoque + cupom +
      // lancamento) vive em services/vendaService.js.
      const resultado = await criarVenda({
        clienteId,
        sessaoCaixaId: sessaoAberta.id,
        itensValidados,
        leadId: leadIdEfetivo,
        metodoPagamento: metodoPagamentoSan,
        descricaoVenda,
        cupomAplicado,
        especialistaId,
        exigirEstoque: true,
      });

      if (especialistaId) {
        const fator = cupomAplicado && cupomAplicado.valorComDesconto !== undefined
          ? cupomAplicado.valorComDesconto / Math.max(0.01, valorTotalCalculado)
          : 1;
        await gerarComissaoVenda(prisma, {
          venda: resultado.venda,
          itens: itensValidados.map((i) => ({ tipo: i.variacao?.produto?.tipo, valor: centavos(i.subtotal * fator) })),
        }).catch((e) => console.error('[VendaController] comissao de produto', e?.message));
      }

      return res.status(201).json({ success: true, data: resultado });

    } catch (error) {
      if (error instanceof ErroVenda) return responderErroVenda(res, error);
      console.error('[VendaController]', error);
      return res.status(500).json({ erro: 'Erro ao processar a venda.' });
    }
  }

  /**
   * Cancela uma venda. Numa transacao so:
   *  1. marca CANCELLED com UPDATE condicional (so quem achar a venda ainda
   *     nao cancelada segue; cliques/pedidos paralelos viram "ja cancelada");
   *  2. encerra as devolucoes de aluguel ainda pendentes (canceladaEm);
   *  3. devolve ao estoque o saldo liquido da venda (nao devolve de novo o
   *     que ja voltou por devolucao concluida);
   *  4. cancela os lancamentos, devolve o uso do cupom e cancela o pedido de
   *     origem (se houver).
   * Body obrigatorio: { motivo: string (5..500) }.
   */
  async cancelarVenda(req, res) {
    const { clienteId, id: usuarioId } = req.usuario;
    if (!clienteId) {
      return res.status(403).json({ erro: 'Acesso negado: ID do cliente ausente.' });
    }

    const { id } = req.params;
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim().slice(0, MAX_MOTIVO_CANCELAMENTO) : '';

    // Motivo obrigatorio — preserva auditoria. Minimo 5 caracteres.
    if (motivo.length < 5) {
      return res.status(422).json({
        erro: 'Informe o motivo do cancelamento (mínimo 5 caracteres). Sem motivo, não tem como auditar depois.',
        campos: ['motivo'],
      });
    }
    if (!ehUuid(id)) return res.status(404).json({ erro: 'Venda não encontrada.' });

    try {
      const agora = new Date();

      const resultado = await prisma.$transaction(async (tx) => {
        // 1. Transicao atomica: so uma requisicao passa daqui.
        const marcou = await tx.venda.updateMany({
          where: { id, clienteId, status: { not: 'CANCELLED' } },
          data: {
            status: 'CANCELLED',
            dataCancelamento: agora,
            motivoCancelamento: motivo,
            canceladaPorId: usuarioId || null,
          },
        });
        if (marcou.count === 0) {
          const atual = await tx.venda.findFirst({ where: { id, clienteId } });
          if (!atual) throw new ErroVenda('Venda não encontrada.', { status: 404 });
          return { venda: atual, jaCancelada: true };
        }
        const venda = await tx.venda.findFirst({ where: { id, clienteId } });
        const textoMotivo = `Cancelamento da venda #${venda.numero} — ${motivo}`;

        // 2. Devolucoes pendentes deixam de existir (sem lembrete). Feito ANTES
        // de ler o estoque: se uma conclusao de devolucao estiver em curso, a
        // trava da linha faz este passo esperar e a leitura abaixo ja ve o
        // estoque que ela devolveu.
        await tx.devolucao.updateMany({
          where: { vendaId: id, clienteId, devolvidoEm: null, canceladaEm: null, lembreteEnviadoEm: null },
          data: { canceladaEm: agora, lembreteEnviadoEm: agora },
        });
        await tx.devolucao.updateMany({
          where: { vendaId: id, clienteId, devolvidoEm: null, canceladaEm: null },
          data: { canceladaEm: agora },
        });

        // 3. Estorno pelo saldo liquido das movimentacoes da venda.
        const movs = await tx.movimentacaoEstoque.findMany({
          where: { vendaId: id },
          select: { variacaoId: true, quantidade: true, variacao: { select: { produto: { select: { tipo: true } } } } },
        });
        for (const e of calcularEstornoEstoque(movs)) {
          await tx.movimentacaoEstoque.create({
            data: { variacaoId: e.variacaoId, tipo: 'DEVOLUCAO', quantidade: e.quantidade, motivo: textoMotivo.slice(0, 600), vendaId: id },
          });
          if (e.fisico) {
            await tx.variacaoProduto.update({
              where: { id: e.variacaoId },
              data: { estoqueAtual: { increment: e.quantidade } },
            });
          }
        }

        // 4a. Lancamentos financeiros vinculados.
        await tx.lancamentoFinanceiro.updateMany({
          where: { vendaId: id, clienteId, status: { not: 'CANCELADO' } },
          data: { status: 'CANCELADO', dataCancelamento: agora, motivoCancelamento: textoMotivo.slice(0, 600) },
        });

        // 4b. Cupom: venda cancelada nao gasta o uso.
        if (venda.cupomId) {
          await tx.cupom.updateMany({
            where: { id: venda.cupomId, clienteId, usosAtuais: { gt: 0 } },
            data: { usosAtuais: { decrement: 1 } },
          });
        }

        // 4c. Pedido de origem (loja online/WhatsApp) acompanha a venda.
        const pedidos = await tx.pedido.updateMany({
          where: { vendaId: id, clienteId, status: { not: 'CANCELADO' } },
          data: { status: 'CANCELADO', canceladoEm: agora },
        });

        return { venda, jaCancelada: false, pedidoCancelado: pedidos.count > 0 };
      });

      if (resultado.jaCancelada) {
        return res.status(200).json({ ok: true, ja_cancelada: true, venda: resultado.venda });
      }

      // Comissao de produto de quem vendeu: estorna (ou desconta, se ja paga).
      await estornarComissaoVenda(prisma, resultado.venda.id).catch((err) => console.error('[VendaController/cancelar] comissao', err?.message));

      return res.json({ ok: true, venda: resultado.venda, pedidoCancelado: resultado.pedidoCancelado });
    } catch (error) {
      if (error instanceof ErroVenda) return responderErroVenda(res, error);
      console.error('[VendaController/cancelar]', error);
      return res.status(500).json({ erro: 'Erro ao cancelar venda.' });
    }
  }

  /**
   * Vincula (ou desvincula) um lead a uma venda ja registrada. Util pra
   * quando a venda foi feita sem cliente identificado e dps o vendedor
   * descobre quem era — preserva auditoria no CRM. Venda cancelada nao muda.
   *
   * Body: { leadId: string | null }.
   */
  async vincularLead(req, res) {
    const { clienteId } = req.usuario;
    if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: ID do cliente ausente.' });

    const { id } = req.params;
    const { leadId } = req.body || {};
    if (!ehUuid(id)) return res.status(404).json({ erro: 'Venda nao encontrada.' });
    if (leadId !== null && leadId !== undefined && leadId !== '' && !ehUuid(leadId)) {
      return res.status(404).json({ erro: 'Cliente não encontrado.', campos: ['leadId'] });
    }

    try {
      const venda = await prisma.venda.findFirst({ where: { id, clienteId } });
      if (!venda) return res.status(404).json({ erro: 'Venda nao encontrada.' });
      if (venda.status === 'CANCELLED') {
        return res.status(409).json({ erro: 'Venda cancelada não pode ter o cliente alterado.', codigo: 'VENDA_CANCELADA' });
      }

      let leadValido = null;
      if (leadId) {
        leadValido = await prisma.lead.findFirst({
          where: { id: leadId, clienteId },
          select: { id: true, nome: true },
        });
        if (!leadValido) return res.status(404).json({ erro: 'Cliente não encontrado.', campos: ['leadId'] });
      }

      const atualizada = await prisma.$transaction(async (tx) => {
        const r = await tx.venda.updateMany({
          where: { id, clienteId, status: { not: 'CANCELLED' } },
          data: { leadId: leadValido?.id || null },
        });
        if (r.count === 0) throw new ErroVenda('Venda cancelada não pode ter o cliente alterado.', { status: 409, codigo: 'VENDA_CANCELADA' });
        // Propaga pros lancamentos pra consistencia em relatorios por cliente.
        await tx.lancamentoFinanceiro.updateMany({
          where: { vendaId: id, clienteId },
          data: { leadId: leadValido?.id || null },
        });
        return tx.venda.findFirst({ where: { id, clienteId }, include: { lead: true } });
      });

      return res.json({ ok: true, venda: atualizada });
    } catch (error) {
      if (error instanceof ErroVenda) return responderErroVenda(res, error);
      console.error('[VendaController/vincularLead]', error);
      return res.status(500).json({ erro: 'Erro ao vincular cliente.' });
    }
  }

  /**
   * Lista as vendas do cliente.
   */
  async listarVendas(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: ID do cliente ausente.' });
      // Teto de segurança: nunca carrega ilimitado. ?limite= permite paginar depois.
      const limiteBruto = parseInt(req.query.limite, 10);
      const take = Number.isFinite(limiteBruto) && limiteBruto > 0
        ? Math.min(limiteBruto, LIMITE_LISTAGEM_MAX)
        : LIMITE_LISTAGEM_PADRAO;
      const vendas = await prisma.venda.findMany({
        where: { clienteId },
        include: {
          lead: true,
          movimentacoesEstoque: {
            include: {
              variacao: {
                include: { produto: true }
              }
            }
          },
          lancamentosFinanceiros: true
        },
        orderBy: { criadoEm: 'desc' },
        take,
      });
      res.json(vendas);
    } catch (error) {
      console.error(error);
      res.status(500).json({ erro: 'Erro ao listar vendas.' });
    }
  }
}

const instancia = new VendaController();
// Expostas pra teste unitario das regras puras (sem I/O).
instancia.validarClienteFinal = validarClienteFinal;
instancia.resolverDataDevolucao = resolverDataDevolucao;
instancia.normalizarMetodoPagamento = normalizarMetodoPagamento;
instancia.lerParcelas = lerParcelas;
instancia.podeDarDesconto = podeDarDesconto;
instancia.lerDataEstrita = lerDataEstrita;
instancia.calcularEstornoEstoque = calcularEstornoEstoque;
module.exports = instancia;
