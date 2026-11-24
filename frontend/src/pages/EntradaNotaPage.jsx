import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Receipt, Plus, Trash2, FileText, Package, FileUp, AlertTriangle } from 'lucide-react';
import {
  Button, EmptyState, Input, Select, Textarea, Drawer, useToast, LabelAjuda,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, BarraFerramentas,
} from '../components/ui';
import notaCompraService from '../services/notaCompraService';
import fornecedorService from '../services/fornecedorService';
import catalogoService from '../services/catalogoService';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import { AbasEstoque } from '../components/estoque/NavEstoque';
import LateralEstoque from '../components/estoque/LateralEstoque';

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');

const TH = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const TD = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';

const ITEM_VAZIO = { variacaoId: '', quantidade: '', custoUnitario: '' };

function normalizarTexto(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

// Casa um item da NF-e com UMA variação do estoque. Só sugere quando o
// casamento é único e confiável (código = SKU, ou nome igual/contido);
// ambíguo ou sem match -> deixa em branco pro usuário escolher.
function casarVariacao(item, indice) {
  const cod = normalizarTexto(item.codigo);
  if (cod) {
    const porSku = indice.filter((v) => v.sku && normalizarTexto(v.sku) === cod);
    if (porSku.length === 1) return porSku[0].value;
  }
  const desc = normalizarTexto(item.descricao);
  if (desc.length >= 3) {
    const exato = indice.filter(
      (v) => normalizarTexto(v.label) === desc || normalizarTexto(v.nomeProduto) === desc,
    );
    if (exato.length === 1) return exato[0].value;
    const contido = indice.filter(
      (v) => normalizarTexto(v.label).includes(desc) || normalizarTexto(v.nomeProduto).includes(desc),
    );
    if (contido.length === 1) return contido[0].value;
  }
  return '';
}

export default function EntradaNotaPage() {
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [notas, setNotas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [drawerAberto, setDrawerAberto] = useState(false);
  // XML que chegou da lateral (solto aqui ou em outra tela do Estoque):
  // a entrada abre já lendo o arquivo.
  const [xmlInicial, setXmlInicial] = useState(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      const lista = await notaCompraService.listar();
      setNotas(Array.isArray(lista) ? lista : []);
    } catch {
      toast.error('Falha ao carregar as notas de compra.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carrega uma vez ao montar
  }, []);

  const abrirComXml = (file) => {
    setXmlInicial(file || null);
    setDrawerAberto(true);
  };

  // XML solto na lateral de outra tela do Estoque chega pelo state da rota.
  const xmlDaRota = location.state?.xml;
  useEffect(() => {
    if (!(xmlDaRota instanceof File)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- abre a entrada com o XML recebido
    abrirComXml(xmlDaRota);
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage ao arquivo recebido
  }, [xmlDaRota]);

  const fecharDrawer = () => {
    setDrawerAberto(false);
    setXmlInicial(null);
  };

  const resumo = useMemo(() => {
    const agora = new Date();
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    let total = 0;
    let itens = 0;
    let qtdMes = 0;
    let totalMes = 0;
    notas.forEach((n) => {
      const v = Number(n.valorTotal) || 0;
      total += v;
      itens += n._count?.movimentacoes ?? 0;
      const d = new Date(n.emitidaEm || n.criadoEm);
      if (d >= inicioMes) { qtdMes += 1; totalMes += v; }
    });
    return { total, itens, qtdMes, totalMes };
  }, [notas]);

  useAcaoTopo(
    <Button size="sm" icon={Plus} onClick={() => abrirComXml(null)}>Nova entrada</Button>,
    []
  );

  return (
    <Pagina>
      <FaixaNumeros min={190}>
        <Numero
          rotulo="Notas lançadas"
          valor={notas.length}
          carregando={carregando}
        />
        <Numero
          rotulo="Total em compras"
          valor={fmtBRL(resumo.total)}
          detalhe="soma de todas as notas"
          carregando={carregando}
        />
        <Numero
          rotulo="Compras no mês"
          valor={fmtBRL(resumo.totalMes)}
          detalhe={`${resumo.qtdMes} ${resumo.qtdMes === 1 ? 'nota' : 'notas'}`}
          carregando={carregando}
        />
        <Numero
          rotulo="Itens lançados"
          valor={resumo.itens}
          detalhe="linhas de produto nas notas"
          carregando={carregando}
        />
      </FaixaNumeros>

      <ColunasPagina
        lateral={
          <LateralEstoque
            notas={carregando ? null : notas}
            onXml={abrirComXml}
          />
        }
      >
        <Painel semPadding>
          <BarraFerramentas>
            <AbasEstoque ativa="notas" />
            <span className="ml-auto text-xs font-medium text-[var(--text-muted)]">
              {notas.length} {notas.length === 1 ? 'nota lançada' : 'notas lançadas'}
            </span>
          </BarraFerramentas>

          {carregando ? (
            <div className="text-[13px] text-[var(--text-muted)] py-12 text-center">Carregando...</div>
          ) : notas.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nenhuma nota lançada"
              description="Lance as compras que entraram: o estoque soma, o custo médio do produto é atualizado (o preço recalcula com o seu lucro) e a despesa de compra vai para o financeiro."
              action={
                <Button variant="primary" size="sm" icon={Plus} onClick={() => abrirComXml(null)}>
                  Nova entrada
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={TH}>Data</th>
                    <th className={TH}>Fornecedor</th>
                    <th className={TH}>Nota</th>
                    <th className={`${TH} text-right`}>Itens</th>
                    <th className={`${TH} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {notas.map((n) => (
                    <tr key={n.id} className="hover:bg-[var(--bg-subtle)]">
                      <td className={`${TD} tabular-nums text-[var(--text-secondary)] whitespace-nowrap`}>
                        {fmtData(n.emitidaEm || n.criadoEm)}
                      </td>
                      <td className={`${TD} font-semibold text-[var(--text-main)]`}>{n.fornecedor?.nome || 'Sem fornecedor'}</td>
                      <td className={`${TD} text-[var(--text-secondary)]`}>{n.numero || '—'}</td>
                      <td className={`${TD} text-right text-[var(--text-secondary)] tabular-nums`}>{n._count?.movimentacoes ?? 0}</td>
                      <td className={`${TD} text-right font-semibold text-[var(--text-main)] tabular-nums whitespace-nowrap`}>{fmtBRL(n.valorTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Painel>
      </ColunasPagina>

      <NovaNotaDrawer
        aberto={drawerAberto}
        xmlInicial={xmlInicial}
        onClose={fecharDrawer}
        aoSalvar={() => { carregar(); fecharDrawer(); }}
      />
    </Pagina>
  );
}

// ---------------------------------------------------------------------------
// Drawer: nova entrada de nota
// ---------------------------------------------------------------------------
function NovaNotaDrawer({ aberto, xmlInicial, onClose, aoSalvar }) {
  const toast = useToast();
  const [fornecedores, setFornecedores] = useState([]);
  const [variacoes, setVariacoes] = useState([]); // físico, achatado: { value, label, sku, nomeProduto }
  const [form, setForm] = useState({ fornecedorId: '', numero: '', emitidaEm: '', observacoes: '', pago: true });
  const [itens, setItens] = useState([{ ...ITEM_VAZIO }]);
  const [salvando, setSalvando] = useState(false);
  const [importandoXml, setImportandoXml] = useState(false);
  const [avisoFornecedor, setAvisoFornecedor] = useState(null);

  const setItem = (i, k, val) => setItens((arr) => arr.map((it, idx) => (idx === i ? { ...it, [k]: val } : it)));
  const addItem = () => setItens((arr) => [...arr, { ...ITEM_VAZIO }]);
  const removeItem = (i) => setItens((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));

  // Lê o XML da NF-e e preenche o formulário (sem gravar). O usuário ainda liga
  // cada item da nota a um produto seu e confirma.
  const importarXml = async (file, indice = variacoes) => {
    if (!file) return;
    setImportandoXml(true);
    try {
      const r = await notaCompraService.importarXml(file);
      setForm((f) => ({
        ...f,
        numero: r.numero || f.numero,
        emitidaEm: r.emitidaEm ? String(r.emitidaEm).slice(0, 10) : f.emitidaEm,
        fornecedorId: r.fornecedor?.id || '',
      }));
      const itensXml = (r.itens || []).map((it) => ({
        variacaoId: casarVariacao(it, indice), // auto-casa pelo código/nome
        quantidade: it.quantidade ? String(it.quantidade) : '',
        custoUnitario: it.custoUnitario != null ? String(it.custoUnitario) : '',
        descricaoXml: it.descricao || it.codigo || '',
      }));
      setItens(itensXml.length ? itensXml : [{ ...ITEM_VAZIO }]);
      setAvisoFornecedor(
        !r.fornecedor && r.fornecedorXml?.cnpj
          ? `Fornecedor da nota não cadastrado: ${r.fornecedorXml.nome || 'sem nome'} (CNPJ ${r.fornecedorXml.cnpj}).`
          : null,
      );
      const total = itensXml.length;
      const casados = itensXml.filter((x) => x.variacaoId).length;
      if (casados === total) {
        toast.success(`XML lido: ${total} ${total === 1 ? 'item ligado' : 'itens ligados'} automaticamente. Confira e confirme.`);
      } else {
        toast.success(`XML lido: ${casados}/${total} itens ligados automaticamente. Escolha o produto dos demais.`);
      }
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao ler o XML.');
    } finally {
      setImportandoXml(false);
    }
  };

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    (async () => {
      const [fs, prods] = await Promise.all([
        fornecedorService.listar({ ativo: 'true' }).catch(() => []),
        catalogoService.listar().catch(() => []),
      ]);
      if (!vivo) return;
      setFornecedores(Array.isArray(fs) ? fs : []);
      const flat = [];
      (Array.isArray(prods) ? prods : [])
        .filter((p) => p.tipo === 'FISICO')
        .forEach((p) => (p.variacoes || []).forEach((v) => {
          const ehPadrao = !v.nome || v.nome === 'Padrão' || v.nome === 'Padrao';
          flat.push({
            value: v.id,
            label: ehPadrao ? p.nome : `${p.nome} — ${v.nome}`,
            sku: v.sku || '',
            nomeProduto: p.nome,
          });
        }));
      setVariacoes(flat);
      setForm({ fornecedorId: '', numero: '', emitidaEm: '', observacoes: '', pago: true });
      setItens([{ ...ITEM_VAZIO }]);
      setAvisoFornecedor(null);
      // XML trazido da lateral: lê já com a lista de produtos carregada.
      if (xmlInicial) importarXml(xmlInicial, flat);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega só ao abrir (ou com um XML novo)
  }, [aberto, xmlInicial]);

  const total = useMemo(
    () => itens.reduce((s, it) => s + (parseFloat(it.quantidade) || 0) * (parseFloat(it.custoUnitario) || 0), 0),
    [itens],
  );

  const semProdutos = variacoes.length === 0;

  const salvar = async () => {
    const validos = itens.filter(
      (it) => it.variacaoId && parseFloat(it.quantidade) > 0 && it.custoUnitario !== '' && Number(it.custoUnitario) >= 0,
    );
    if (validos.length === 0) {
      return toast.error('Adicione ao menos um item com produto, quantidade e custo.');
    }
    setSalvando(true);
    try {
      await notaCompraService.criar({
        fornecedorId: form.fornecedorId || undefined,
        numero: form.numero || undefined,
        emitidaEm: form.emitidaEm || undefined,
        observacoes: form.observacoes || undefined,
        pago: form.pago,
        itens: validos.map((it) => ({
          variacaoId: it.variacaoId,
          quantidade: parseInt(it.quantidade, 10),
          custoUnitario: parseFloat(it.custoUnitario),
        })),
      });
      toast.success('Entrada registrada. Estoque e custos atualizados.');
      aoSalvar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao registrar a nota.');
    } finally {
      setSalvando(false);
    }
  };

  const opcoesFornecedor = [
    { value: '', label: 'Sem fornecedor' },
    ...fornecedores.map((f) => ({ value: f.id, label: f.nome })),
  ];
  const opcoesVariacao = [{ value: '', label: 'Selecione o produto...' }, ...variacoes];

  return (
    <Drawer
      isOpen={aberto}
      onClose={onClose}
      size="xl"
      title="Nova entrada de nota"
      description="Lance os produtos que entraram. Estoque e custo médio são atualizados ao salvar."
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-[var(--text-secondary)]">
            Total da nota: <strong className="text-[var(--text-main)] tabular-nums">{fmtBRL(total)}</strong>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={salvar} loading={salvando} disabled={semProdutos}>
              Registrar entrada
            </Button>
          </div>
        </div>
      }
    >
      {semProdutos ? (
        <EmptyState
          icon={Package}
          title="Nenhum produto físico cadastrado"
          description="A entrada de nota lança a compra de produtos do estoque. Cadastre um produto antes."
          action={
            <Link to="/app/estoque/produtos" onClick={onClose}>
              <Button variant="primary" size="sm">Ir para Produtos</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-5">
          {/* Importar XML da NF-e (preenche os itens pra conferência) */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] min-w-0">
              <FileUp size={16} className="text-[var(--text-muted)] flex-shrink-0" />
              <span>Tem o XML da NF-e? Importe e nós preenchemos os itens.</span>
            </div>
            <label className={`inline-flex items-center gap-2 h-8 px-3 text-xs font-semibold rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-subtle)] cursor-pointer flex-shrink-0 ${importandoXml ? 'opacity-60 pointer-events-none' : ''}`}>
              <FileUp size={14} />
              {importandoXml ? 'Lendo...' : 'Importar XML'}
              <input
                type="file"
                accept=".xml,text/xml,application/xml"
                className="hidden"
                disabled={importandoXml}
                onChange={(e) => { importarXml(e.target.files?.[0]); e.target.value = ''; }}
              />
            </label>
          </div>

          {avisoFornecedor && (
            <div className="flex items-start gap-2 rounded-xl bg-[var(--warning-soft)] text-[var(--warning-text)] border border-[var(--border-main)] p-3 text-xs">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                {avisoFornecedor}{' '}
                <Link to="/app/estoque/fornecedores" onClick={onClose} className="underline font-semibold">
                  Cadastrar fornecedor
                </Link>
              </span>
            </div>
          )}

          {/* Cabeçalho da nota */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label={<LabelAjuda texto="Fornecedor" ajuda="De quem você comprou. Opcional, mas ajuda nos relatórios." />}
              value={form.fornecedorId}
              onChange={(e) => setForm({ ...form, fornecedorId: e.target.value })}
              options={opcoesFornecedor}
              placeholder=""
            />
            <Input
              label={<LabelAjuda texto="Número da nota" ajuda="O número impresso na nota do fornecedor. Opcional." />}
              value={form.numero}
              onChange={(e) => setForm({ ...form, numero: e.target.value })}
            />
            <Input
              type="date"
              label={<LabelAjuda texto="Data da nota" ajuda="Quando a compra foi feita. Sem isso, usamos a data de hoje." />}
              value={form.emitidaEm}
              onChange={(e) => setForm({ ...form, emitidaEm: e.target.value })}
            />
            <label className="flex items-end pb-2.5">
              <span className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.pago}
                  onChange={(e) => setForm({ ...form, pago: e.target.checked })}
                />
                Já paguei esta nota
              </span>
            </label>
          </div>

          {/* Itens */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">Itens da nota</span>
              <Button variant="ghost" size="sm" icon={Plus} onClick={addItem}>Adicionar item</Button>
            </div>

            <div className="space-y-2">
              {/* Cabeçalho da grade (apenas em telas largas) */}
              <div className="hidden md:grid grid-cols-12 gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <div className="col-span-6">Produto</div>
                <div className="col-span-2">Qtd.</div>
                <div className="col-span-2">Custo un.</div>
                <div className="col-span-2 text-right pr-9">Subtotal</div>
              </div>

              {itens.map((it, i) => {
                const sub = (parseFloat(it.quantidade) || 0) * (parseFloat(it.custoUnitario) || 0);
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-12 md:col-span-6">
                      <Select
                        value={it.variacaoId}
                        onChange={(e) => setItem(i, 'variacaoId', e.target.value)}
                        options={opcoesVariacao}
                        placeholder=""
                      />
                      {it.descricaoXml && !it.variacaoId && (
                        <div className="mt-1 text-[11px] text-[var(--text-muted)] truncate" title={it.descricaoXml}>
                          NF-e: {it.descricaoXml}
                        </div>
                      )}
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Qtd."
                        value={it.quantidade}
                        onChange={(e) => setItem(i, 'quantidade', e.target.value)}
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0,00"
                        value={it.custoUnitario}
                        onChange={(e) => setItem(i, 'custoUnitario', e.target.value)}
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2 flex items-center justify-end gap-1">
                      <span className="text-sm tabular-nums text-[var(--text-secondary)]">{fmtBRL(sub)}</span>
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        disabled={itens.length === 1}
                        title="Remover item"
                        aria-label="Remover item"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--bg-subtle)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Textarea
            label={<LabelAjuda texto="Observações" ajuda="Anotações internas sobre esta entrada. Opcional." />}
            value={form.observacoes}
            onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            rows={2}
          />

          <div className="flex items-start gap-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-main)] p-3 text-xs text-[var(--text-muted)]">
            <FileText size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              Ao salvar: o estoque de cada item aumenta, o custo médio é recalculado (o preço de venda
              acompanha mantendo o seu lucro) e uma despesa <strong>“Compra de mercadorias”</strong> é
              lançada no financeiro{form.pago ? ' como paga' : ' como conta a pagar'}.
            </span>
          </div>
        </div>
      )}
    </Drawer>
  );
}
