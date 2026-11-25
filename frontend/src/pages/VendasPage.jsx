import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShoppingBag, Plus, Package, Ban, Trash2, Wallet, Minus, Search, Undo2,
  MoreVertical, UserPlus, ExternalLink, ChevronLeft, ChevronRight, X, MessageCircle,
  QrCode, Banknote, CreditCard, Receipt, ArrowLeftRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import vendaService from '../services/vendaService';
import {
  Button, IconButton, Input, Textarea, Select, Badge,
  EmptyState, Drawer, useToast, Combobox, Dropdown, DropdownItem, DropdownDivider,
  BotaoExportar, Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, BarraFerramentas,
} from '../components/ui';
import Modal from '../components/Modal';
import { useAcaoTopo } from '../hooks/useAcaoTopo';

const STATUS_BADGE = {
  COMPLETED: { variant: 'success', label: 'Concluída' },
  PENDING: { variant: 'warning', label: 'Pendente' },
  CANCELLED: { variant: 'danger', label: 'Cancelada' },
  REFUNDED: { variant: 'neutral', label: 'Reembolsada' },
};

// Nome amigavel dos metodos de pagamento gravados na venda. Metodo
// desconhecido (ex.: vindo do bot) aparece como veio.
const METODO_LABEL = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  DEBITO: 'Cartão de débito',
  CREDITO: 'Cartão de crédito',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferência',
};
const nomeMetodo = (m) => (m ? METODO_LABEL[m] || m : '—');

// Cor da barra por forma de pagamento (so variaveis do tema).
const COR_METODO = {
  PIX: 'var(--primary)',
  DINHEIRO: 'var(--warning)',
  DEBITO: 'var(--info)',
  CREDITO: 'var(--info-text)',
  BOLETO: 'var(--text-muted)',
  TRANSFERENCIA: 'var(--success)',
};

const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Venda que conta como dinheiro vendido (cancelada e reembolsada ficam fora).
const vendaValida = (v) => v.status !== 'CANCELLED' && v.status !== 'REFUNDED';
const ehPix = (v) => String(v.metodoPagamento || '').toUpperCase().includes('PIX');
const pixAguardando = (v) => v.status === 'PENDING' && ehPix(v);

const mesmoDia = (a, b) => a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

// "14:32" hoje, "ontem 14:32", ou "12/11 14:32".
function quando(dataIso) {
  const d = new Date(dataIso);
  if (Number.isNaN(d.getTime())) return '—';
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hoje = new Date();
  if (mesmoDia(d, hoje)) return hora;
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  if (mesmoDia(d, ontem)) return `ontem ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

// Itens vendidos em texto curto (nome dos produtos), ou a descricao.
function textoItens(v) {
  const nomes = (v.movimentacoesEstoque || [])
    .map((m) => m.variacao?.produto?.nome || m.variacao?.nome)
    .filter(Boolean);
  if (nomes.length) return [...new Set(nomes)].join(', ');
  return v.descricao || '—';
}

// Mascaras leves — truncam pro tamanho real do documento/telefone enquanto o
// usuario digita, em vez de deixar colar/digitar qualquer quantidade de
// digitos e so descobrir que ta errado ao tentar salvar.
function formatarCpf(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatarTelefone(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// Select compacto com rotulo ao lado (faixa de filtros do mockup).
function FiltroSelect({ rotulo, value, onChange, opcoes }) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
      {rotulo}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 pl-2.5 pr-7 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[13px] font-medium text-[var(--text-main)] focus:outline-none focus:border-[var(--primary)]"
      >
        {opcoes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

const SEM_VENDEDOR = '__sem__';

export default function VendasPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [vendas, setVendas] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [leads, setLeads] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [profissionais, setProfissionais] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [modal, setModal] = useState({ open: false });
  const [drawer, setDrawer] = useState({ open: false, venda: null });
  // Modal de cancelamento — motivo obrigatorio (backend exige >= 5 chars).
  const [modalCancelar, setModalCancelar] = useState({ open: false, venda: null });
  // Modal de "caixa fechado" — aparece quando backend rejeita venda manual
  // (codigo CAIXA_FECHADO). Tem botao que leva direto pra tela do caixa.
  const [modalCaixaFechado, setModalCaixaFechado] = useState(false);
  // Vincular cliente a venda existente (retroativo). Util quando a venda foi
  // feita sem identificar o cliente e dps a equipe descobre quem era.
  const [modalVincularLead, setModalVincularLead] = useState({ open: false, venda: null });

  // Filtros + paginacao client-side (50 por pagina cobre uso real).
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroMetodo, setFiltroMetodo] = useState('');
  // Vendedor: '' (todos), id da profissional, ou SEM_VENDEDOR.
  const [filtroVendedor, setFiltroVendedor] = useState('');
  // Periodo: '' (todos), 'hoje', '7d', 'mes' (mes corrente), 'mes-passado', '30d'.
  const [filtroPeriodo, setFiltroPeriodo] = useState('');
  // A pagina volta pra 1 quando algum filtro muda (derivado, sem efeito).
  const chaveFiltros = `${busca}|${filtroStatus}|${filtroMetodo}|${filtroVendedor}|${filtroPeriodo}`;
  const [paginacao, setPaginacao] = useState({ chave: chaveFiltros, pagina: 1 });
  const pagina = paginacao.chave === chaveFiltros ? paginacao.pagina : 1;
  const setPagina = (valor) => setPaginacao({ chave: chaveFiltros, pagina: typeof valor === 'function' ? valor(pagina) : valor });
  const POR_PAGINA = 50;

  // Busca tudo sem setState sincrono (o estado ja nasce carregando); o
  // "carregar" das acoes liga o carregando antes de buscar de novo.
  const buscarDados = useCallback(() => Promise.all([
    api.get('/vendas').catch(() => ({ data: [] })),
    api.get('/catalogo').catch(() => ({ data: [] })),
    api.get('/crm/leads').catch(() => ({ data: [] })),
    api.get('/financeiro/categorias').catch(() => ({ data: [] })),
    api.get('/especialistas').catch(() => ({ data: [] })),
  ]).then(([v, p, l, c, esp]) => {
    setVendas(v.data || []);
    setProdutos(p.data || []);
    setLeads(l.data || []);
    setCategorias(c.data || []);
    const listaEsp = Array.isArray(esp.data) ? esp.data : (esp.data?.especialistas || []);
    setProfissionais(listaEsp.filter((x) => x.ativo !== false));
  }).finally(() => setCarregando(false)), []);

  const carregar = () => {
    setCarregando(true);
    return buscarDados();
  };

  useEffect(() => { buscarDados(); }, [buscarDados]);

  const variacoes = useMemo(() => {
    const out = [];
    produtos.forEach((p) => {
      (p.variacoes || []).forEach((v) => out.push({ ...v, produto: p }));
    });
    return out;
  }, [produtos]);

  // id da profissional -> nome (coluna Vendedor e bloco "Por vendedor").
  const nomeProfissional = useMemo(
    () => new Map(profissionais.map((p) => [p.id, p.nome])),
    [profissionais]
  );
  const nomeVendedor = (v) => {
    if (!v.especialistaId) return null;
    return nomeProfissional.get(v.especialistaId) || 'Profissional inativa';
  };

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const agora = new Date();
    const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const inicio7d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 6);
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const inicioMesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
    const fimMesPassado = new Date(agora.getFullYear(), agora.getMonth(), 0, 23, 59, 59);
    const inicio30d = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);

    return vendas.filter((v) => {
      if (q) {
        const matchTexto =
          v.descricao?.toLowerCase().includes(q) ||
          v.lead?.nome?.toLowerCase().includes(q) ||
          String(v.numero ?? '').includes(q);
        if (!matchTexto) return false;
      }
      if (filtroStatus && v.status !== filtroStatus) return false;
      if (filtroMetodo && v.metodoPagamento !== filtroMetodo) return false;
      if (filtroVendedor === SEM_VENDEDOR && v.especialistaId) return false;
      if (filtroVendedor && filtroVendedor !== SEM_VENDEDOR && v.especialistaId !== filtroVendedor) return false;
      if (filtroPeriodo) {
        const d = new Date(v.criadoEm);
        if (filtroPeriodo === 'hoje' && d < inicioHoje) return false;
        if (filtroPeriodo === '7d' && d < inicio7d) return false;
        if (filtroPeriodo === 'mes' && d < inicioMes) return false;
        if (filtroPeriodo === 'mes-passado' && (d < inicioMesPassado || d > fimMesPassado)) return false;
        if (filtroPeriodo === '30d' && d < inicio30d) return false;
      }
      return true;
    });
  }, [vendas, busca, filtroStatus, filtroMetodo, filtroVendedor, filtroPeriodo]);

  // Paginacao client-side. Suficiente pra ate ~5k vendas — alem disso vale
  // mover pra server-side com query params.
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const paginadas = useMemo(
    () => filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA),
    [filtradas, pagina]
  );

  // Lista de metodos de pagamento que aparecem no filtro (so os que existem
  // nas vendas atuais — evita opcoes "fantasma" no select).
  const metodosDisponiveis = useMemo(() => {
    const set = new Set();
    vendas.forEach((v) => { if (v.metodoPagamento) set.add(v.metodoPagamento); });
    return [...set];
  }, [vendas]);

  const temFiltroAtivo = !!(busca || filtroStatus || filtroMetodo || filtroVendedor || filtroPeriodo);
  const limparFiltros = () => {
    setBusca('');
    setFiltroStatus('');
    setFiltroMetodo('');
    setFiltroVendedor('');
    setFiltroPeriodo('');
  };

  const handleRegistrar = async (dados) => {
    try {
      await api.post('/vendas', dados);
      toast.success('Venda registrada');
      setModal({ open: false });
      carregar();
    } catch (e) {
      // Caixa fechado: abre modal de aviso com link pro caixa em vez do toast
      // generico — pra usuario nao se confundir.
      if (e.response?.data?.codigo === 'CAIXA_FECHADO') {
        setModalCaixaFechado(true);
        return;
      }
      toast.error(e.response?.data?.error || 'Erro ao registrar venda');
    }
  };

  // Abre modal de cancelamento (motivo obrigatorio).
  const handleAbrirCancelar = (venda) => {
    if (!venda) return;
    if (venda.status === 'CANCELLED') {
      toast.info('Venda já está cancelada.');
      return;
    }
    setModalCancelar({ open: true, venda });
  };

  // Vincula um lead (cliente) a venda. leadId=null = desvinculo.
  // Backend propaga pros lancamentos financeiros pra manter consistencia.
  const handleVincularLead = async (leadId) => {
    const venda = modalVincularLead.venda;
    if (!venda) return;
    try {
      await vendaService.vincularLead(venda.id, leadId);
      toast.success(leadId ? 'Cliente vinculado à venda.' : 'Cliente desvinculado.');
      setModalVincularLead({ open: false, venda: null });
      setDrawer({ open: false, venda: null });
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao vincular cliente.');
    }
  };

  // Confirma o cancelamento — motivo ja validado no modal (min 5 chars).
  // Backend tambem valida e retorna 422 se vier curto.
  const handleConfirmarCancelar = async (motivo) => {
    const venda = modalCancelar.venda;
    if (!venda) return;
    try {
      await vendaService.cancelar(venda.id, motivo);
      toast.success('Venda cancelada. Estoque estornado e lançamento financeiro cancelado.');
      setModalCancelar({ open: false, venda: null });
      setDrawer({ open: false, venda: null });
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao cancelar venda.');
    }
  };

  // Numeros do topo e da coluna lateral — tudo derivado de /vendas.
  const resumo = useMemo(() => {
    const agora = new Date();
    const doMes = (v) => {
      const d = new Date(v.criadoEm);
      return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
    };
    const validas = vendas.filter(vendaValida);
    const hoje = validas.filter((v) => mesmoDia(new Date(v.criadoEm), agora));
    const mes = validas.filter(doMes);
    const soma = (lista) => lista.reduce((acc, v) => acc + Number(v.valor || 0), 0);

    // Por forma de pagamento (hoje), maior primeiro.
    const porMetodoMap = new Map();
    hoje.forEach((v) => {
      const m = v.metodoPagamento || '';
      porMetodoMap.set(m, (porMetodoMap.get(m) || 0) + Number(v.valor || 0));
    });
    const totalHoje = soma(hoje);
    const porMetodo = [...porMetodoMap.entries()]
      .map(([metodo, valor]) => ({ metodo, valor, pct: totalHoje > 0 ? (valor / totalHoje) * 100 : 0 }))
      .sort((a, b) => b.valor - a.valor);

    // Por vendedor (mes), maior primeiro.
    const porVendedorMap = new Map();
    mes.forEach((v) => {
      const chave = v.especialistaId || SEM_VENDEDOR;
      const atual = porVendedorMap.get(chave) || { qtd: 0, valor: 0 };
      porVendedorMap.set(chave, { qtd: atual.qtd + 1, valor: atual.valor + Number(v.valor || 0) });
    });
    const porVendedor = [...porVendedorMap.entries()]
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => b.valor - a.valor);

    const totalMes = soma(mes);
    return {
      totalHoje,
      qtdHoje: hoje.length,
      totalMes,
      ticketMedio: mes.length ? totalMes / mes.length : 0,
      qtdMes: mes.length,
      porMetodo,
      porVendedor,
      pix: vendas.filter(pixAguardando),
    };
  }, [vendas]);

  const montarExportacao = () => ({
    nome: `vendas-${new Date().toISOString().slice(0, 10)}`,
    titulo: 'Vendas',
    filtrosAtivos: [
      busca && `Busca: ${busca}`,
      filtroStatus && `Situação: ${STATUS_BADGE[filtroStatus]?.label || filtroStatus}`,
      filtroMetodo && `Pagamento: ${nomeMetodo(filtroMetodo)}`,
      filtroVendedor && `Vendedor: ${filtroVendedor === SEM_VENDEDOR ? 'Sem vendedor' : nomeProfissional.get(filtroVendedor) || ''}`,
    ].filter(Boolean),
    secoes: [{
      titulo: 'Vendas',
      colunas: [
        { chave: 'numero', label: 'Nº' },
        { chave: 'data', label: 'Data' },
        { chave: 'cliente', label: 'Cliente' },
        { chave: 'itens', label: 'Itens' },
        { chave: 'vendedor', label: 'Vendedor' },
        { chave: 'pagamento', label: 'Pagamento' },
        { chave: 'valor', label: 'Total' },
        { chave: 'situacao', label: 'Situação' },
      ],
      linhas: filtradas.map((v) => ({
        numero: v.numero ?? '',
        data: new Date(v.criadoEm).toLocaleString('pt-BR'),
        cliente: v.lead?.nome || '',
        itens: textoItens(v),
        vendedor: nomeVendedor(v) || '',
        pagamento: nomeMetodo(v.metodoPagamento),
        valor: Number(v.valor || 0),
        situacao: STATUS_BADGE[v.status]?.label || v.status || '',
      })),
    }],
  });

  const abrirNovaVenda = () => setModal({ open: true });
  useAcaoTopo(<Button size="sm" icon={Plus} onClick={abrirNovaVenda}>Registrar venda</Button>, []);

  const lateral = (
    <>
      <Painel titulo="Por forma de pagamento" acoes={<span className="text-xs font-medium text-[var(--text-muted)]">hoje</span>}>
        {carregando ? (
          <div className="h-16 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />
        ) : resumo.porMetodo.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--text-muted)]">Nenhuma venda hoje ainda.</p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col gap-3 text-[13px]">
            {resumo.porMetodo.map((m) => (
              <li key={m.metodo || 'sem'}>
                <div className="flex justify-between gap-2 text-[var(--text-secondary)]">
                  <span>{m.metodo ? nomeMetodo(m.metodo) : 'Não informado'}</span>
                  <strong className="text-[var(--text-main)] tabular-nums">{fmtBRL(m.valor)}</strong>
                </div>
                <div className="h-2 rounded bg-[var(--bg-subtle)] mt-1.5" aria-hidden="true">
                  <div
                    className="h-2 rounded"
                    style={{ width: `${Math.max(2, m.pct)}%`, background: COR_METODO[m.metodo] || 'var(--text-muted)' }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Painel>

      <Painel titulo="Por vendedor" acoes={<span className="text-xs font-medium text-[var(--text-muted)]">mês</span>} semPadding>
        {carregando ? (
          <div className="m-4 h-12 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />
        ) : resumo.porVendedor.length === 0 ? (
          <p className="m-0 px-4 py-3.5 text-[13px] text-[var(--text-muted)]">Nenhuma venda no mês ainda.</p>
        ) : (
          resumo.porVendedor.map((p) => (
            <LinhaInfo
              key={p.id}
              rotulo={p.id === SEM_VENDEDOR ? 'Sem vendedor informado' : nomeProfissional.get(p.id) || 'Profissional inativa'}
            >
              <span className="text-xs text-[var(--text-muted)] tabular-nums">{p.qtd} {p.qtd === 1 ? 'venda' : 'vendas'}</span>
              <span className="font-semibold text-[var(--text-main)] tabular-nums">{fmtBRL(p.valor)}</span>
            </LinhaInfo>
          ))
        )}
      </Painel>

      <Painel
        titulo="Pix aguardando"
        acoes={resumo.pix.length > 0 ? <Badge variant="warning" size="sm">{resumo.pix.length}</Badge> : null}
        semPadding
      >
        {carregando ? (
          <div className="m-4 h-12 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />
        ) : resumo.pix.length === 0 ? (
          <p className="m-0 px-4 py-3.5 text-[13px] text-[var(--text-muted)]">Nenhum Pix aguardando pagamento.</p>
        ) : (
          resumo.pix.slice(0, 6).map((v) => (
            <LinhaInfo key={v.id} rotulo={`${v.lead?.nome || 'Sem cliente'} · #${v.numero ?? v.id.slice(0, 6)}`}>
              <span className="font-semibold text-[var(--text-main)] tabular-nums">{fmtBRL(v.valor)}</span>
              <Button variant="secondary" size="sm" onClick={() => setDrawer({ open: true, venda: v })}>
                Ver
              </Button>
            </LinhaInfo>
          ))
        )}
      </Painel>
    </>
  );

  return (
    <Pagina>
      <FaixaNumeros min={170}>
        <Numero rotulo="Vendido hoje" valor={fmtBRL(resumo.totalHoje)} carregando={carregando} />
        <Numero rotulo="Vendas hoje" valor={resumo.qtdHoje} carregando={carregando} />
        <Numero rotulo="No mês" valor={fmtBRL(resumo.totalMes)} detalhe={`${resumo.qtdMes} ${resumo.qtdMes === 1 ? 'venda' : 'vendas'}`} carregando={carregando} />
        <Numero rotulo="Ticket médio" valor={fmtBRL(resumo.ticketMedio)} detalhe="no mês" carregando={carregando} />
        <Numero
          rotulo="Pix aguardando"
          valor={resumo.pix.length}
          tom={resumo.pix.length > 0 ? 'alerta' : 'neutro'}
          carregando={carregando}
          onClick={resumo.pix.length > 0 ? () => setFiltroStatus('PENDING') : undefined}
        />
      </FaixaNumeros>

      <ColunasPagina lateral={lateral}>
        <Painel semPadding>
          <BarraFerramentas>
            <label className="relative flex-1 min-w-[180px] max-w-[280px]">
              <span className="sr-only">Buscar venda por descrição, cliente ou número</span>
              <Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar descrição, cliente ou nº"
                className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--primary)]"
              />
            </label>
            <FiltroSelect
              rotulo="Período"
              value={filtroPeriodo}
              onChange={setFiltroPeriodo}
              opcoes={[
                { value: '', label: 'Qualquer' },
                { value: 'hoje', label: 'Hoje' },
                { value: '7d', label: '7 dias' },
                { value: 'mes', label: 'Este mês' },
                { value: 'mes-passado', label: 'Mês passado' },
                { value: '30d', label: 'Últimos 30 dias' },
              ]}
            />
            {metodosDisponiveis.length > 0 && (
              <FiltroSelect
                rotulo="Pagamento"
                value={filtroMetodo}
                onChange={setFiltroMetodo}
                opcoes={[
                  { value: '', label: 'Todos' },
                  ...metodosDisponiveis.map((m) => ({ value: m, label: nomeMetodo(m) })),
                ]}
              />
            )}
            {profissionais.length > 0 && (
              <FiltroSelect
                rotulo="Vendedor"
                value={filtroVendedor}
                onChange={setFiltroVendedor}
                opcoes={[
                  { value: '', label: 'Todos' },
                  ...profissionais.map((p) => ({ value: p.id, label: p.nome })),
                  { value: SEM_VENDEDOR, label: 'Sem vendedor' },
                ]}
              />
            )}
            <FiltroSelect
              rotulo="Situação"
              value={filtroStatus}
              onChange={setFiltroStatus}
              opcoes={[
                { value: '', label: 'Todas' },
                { value: 'COMPLETED', label: 'Concluídas' },
                { value: 'PENDING', label: 'Pendentes' },
                { value: 'CANCELLED', label: 'Canceladas' },
                { value: 'REFUNDED', label: 'Reembolsadas' },
              ]}
            />
            {temFiltroAtivo && (
              <Button variant="ghost" size="sm" icon={X} onClick={limparFiltros}>
                Limpar
              </Button>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" icon={Undo2} onClick={() => navigate('/app/devolucoes')}>
                Devolução
              </Button>
              <BotaoExportar montarDados={montarExportacao} desabilitado={filtradas.length === 0} />
              {/* Atalho da fase 2: monta o pedido e manda o link de pagamento (tela de Pedidos). */}
              <Button variant="secondary" size="sm" icon={MessageCircle} onClick={() => navigate('/app/pedidos?novo=whatsapp')}>
                Vender pelo WhatsApp
              </Button>
            </div>
          </BarraFerramentas>

          {carregando ? (
            <div className="text-center py-12 text-[var(--text-muted)] text-[13px]">Carregando vendas…</div>
          ) : filtradas.length === 0 ? (
            temFiltroAtivo ? (
              <EmptyState
                icon={Search}
                title="Nenhuma venda com esses filtros"
                description="Troque o período, a forma de pagamento ou o vendedor."
                action={<Button variant="secondary" icon={X} onClick={limparFiltros}>Limpar filtros</Button>}
              />
            ) : (
              <EmptyState
                icon={ShoppingBag}
                title="Nenhuma venda"
                description="Registre sua primeira venda. O sistema vai dar baixa no estoque e gerar o lançamento financeiro automaticamente."
                action={<Button variant="primary" icon={Plus} onClick={abrirNovaVenda}>Registrar venda</Button>}
              />
            )
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      {['Nº', 'Quando', 'Cliente', 'Itens', 'Vendedor', 'Pagamento'].map((t) => (
                        <th key={t} className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">{t}</th>
                      ))}
                      <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Total</th>
                      <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Situação</th>
                      <th className="w-10 bg-[var(--bg-subtle)] border-b border-[var(--border-main)]"><span className="sr-only">Ações</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginadas.map((v) => {
                      const cancelada = v.status === 'CANCELLED';
                      const cfgStatus = pixAguardando(v)
                        ? { variant: 'warning', label: 'Aguardando Pix' }
                        : STATUS_BADGE[v.status] || { variant: 'neutral', label: v.status || '—' };
                      const vendedor = nomeVendedor(v);
                      const td = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';
                      return (
                        <tr
                          key={v.id}
                          onClick={() => setDrawer({ open: true, venda: v })}
                          className={`hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors ${cancelada ? 'opacity-60' : ''}`}
                        >
                          <td className={`${td} whitespace-nowrap`}>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setDrawer({ open: true, venda: v }); }}
                              className="font-semibold text-[var(--text-main)] hover:underline tabular-nums"
                              aria-label={`Abrir venda ${v.numero ?? v.id.slice(0, 6)}`}
                            >
                              #{v.numero ?? v.id.slice(0, 6)}
                            </button>
                          </td>
                          <td className={`${td} whitespace-nowrap text-[var(--text-secondary)] tabular-nums`}>{quando(v.criadoEm)}</td>
                          <td className={`${td} whitespace-nowrap`}>
                            {v.lead?.nome ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); navigate(`/app/crm?lead=${v.leadId}`); }}
                                className="inline-flex items-center gap-1 text-[var(--text-main)] hover:underline font-medium"
                              >
                                {v.lead.nome}
                                <ExternalLink size={11} aria-hidden="true" className="text-[var(--text-muted)]" />
                              </button>
                            ) : <span className="text-[var(--text-muted)]">Balcão</span>}
                          </td>
                          <td className={`${td} max-w-[260px]`}>
                            <div className={`truncate ${cancelada ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`} title={textoItens(v)}>
                              {textoItens(v)}
                            </div>
                          </td>
                          <td className={`${td} whitespace-nowrap text-[var(--text-secondary)]`}>{vendedor || '—'}</td>
                          <td className={`${td} whitespace-nowrap text-[var(--text-secondary)]`}>{nomeMetodo(v.metodoPagamento)}</td>
                          <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums ${cancelada ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-main)]'}`}>
                            {fmtBRL(v.valor)}
                          </td>
                          <td className={`${td} whitespace-nowrap`}>
                            <Badge variant={cfgStatus.variant} size="sm">{cfgStatus.label}</Badge>
                          </td>
                          <td className={`${td} px-2`} onClick={(e) => e.stopPropagation()}>
                            <Dropdown
                              trigger={
                                <button
                                  type="button"
                                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)] transition-colors"
                                  aria-label={`Ações da venda ${v.numero ?? v.id.slice(0, 6)}`}
                                >
                                  <MoreVertical size={16} strokeWidth={1.75} />
                                </button>
                              }
                            >
                              <DropdownItem
                                icon={UserPlus}
                                onClick={() => setModalVincularLead({ open: true, venda: v })}
                              >
                                {v.lead ? 'Trocar cliente' : 'Vincular cliente'}
                              </DropdownItem>
                              {v.lead && (
                                <DropdownItem
                                  icon={ExternalLink}
                                  onClick={() => navigate(`/app/crm?lead=${v.leadId}`)}
                                >
                                  Ver no CRM
                                </DropdownItem>
                              )}
                              {!cancelada && (
                                <>
                                  <DropdownDivider />
                                  <DropdownItem
                                    icon={Ban}
                                    variant="danger"
                                    onClick={() => handleAbrirCancelar(v)}
                                  >
                                    Cancelar venda
                                  </DropdownItem>
                                </>
                              )}
                            </Dropdown>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Rodape: contagem + paginacao (setas so com mais de 1 pagina). */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="text-xs text-[var(--text-muted)]">
                  {totalPaginas > 1
                    ? `Mostrando ${(pagina - 1) * POR_PAGINA + 1}–${Math.min(pagina * POR_PAGINA, filtradas.length)} de ${filtradas.length}`
                    : `${filtradas.length} ${filtradas.length === 1 ? 'venda' : 'vendas'}`}
                </div>
                {totalPaginas > 1 && (
                  <div className="flex items-center gap-1">
                    <IconButton
                      icon={ChevronLeft}
                      variant="ghost"
                      size="sm"
                      onClick={() => setPagina((p) => Math.max(1, p - 1))}
                      disabled={pagina === 1}
                      ariaLabel="Página anterior"
                    />
                    <div className="text-xs font-semibold tabular-nums px-3">
                      {pagina} / {totalPaginas}
                    </div>
                    <IconButton
                      icon={ChevronRight}
                      variant="ghost"
                      size="sm"
                      onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                      disabled={pagina === totalPaginas}
                      ariaLabel="Próxima página"
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </Painel>
      </ColunasPagina>

      {/* Modal de registrar venda */}
      <ModalVenda
        key={modal.open ? 'venda-aberta' : 'venda-fechada'}
        isOpen={modal.open}
        onClose={() => setModal({ open: false })}
        variacoes={variacoes}
        leads={leads}
        categorias={categorias}
        profissionais={profissionais}
        onSalvar={handleRegistrar}
      />

      {/* Drawer detalhes */}
      <DrawerVenda
        isOpen={drawer.open}
        onClose={() => setDrawer({ open: false, venda: null })}
        venda={drawer.venda}
        vendedor={drawer.venda ? nomeVendedor(drawer.venda) : null}
        onCancelar={handleAbrirCancelar}
        onVincularLead={(v) => setModalVincularLead({ open: true, venda: v })}
        onIrParaCRM={(leadId) => navigate(`/app/crm?lead=${leadId}`)}
      />

      {/* Modal de cancelamento — motivo obrigatorio (preserva auditoria) */}
      <ModalCancelarVenda
        key={modalCancelar.open ? `cancelar-${modalCancelar.venda?.id}` : 'cancelar-fechado'}
        isOpen={modalCancelar.open}
        onClose={() => setModalCancelar({ open: false, venda: null })}
        venda={modalCancelar.venda}
        onConfirmar={handleConfirmarCancelar}
      />

      {/* Aviso amigavel quando tenta registrar venda sem caixa aberto */}
      <ModalCaixaFechado
        isOpen={modalCaixaFechado}
        onClose={() => setModalCaixaFechado(false)}
        onIrParaCaixa={() => {
          setModalCaixaFechado(false);
          setModal({ open: false });
          navigate('/app/financeiro/caixa');
        }}
      />

      {/* Modal de vinculo retroativo de cliente */}
      <ModalVincularLead
        key={modalVincularLead.open ? `vincular-${modalVincularLead.venda?.id}` : 'vincular-fechado'}
        isOpen={modalVincularLead.open}
        onClose={() => setModalVincularLead({ open: false, venda: null })}
        venda={modalVincularLead.venda}
        leads={leads}
        onConfirmar={handleVincularLead}
      />
    </Pagina>
  );
}

// Helper: retorna o preco de venda da variacao
function precoEfetivoVariacao(v) {
  if (!v) return 0;
  return v.preco || 0;
}

function ModalVenda({ isOpen, onClose, variacoes, leads, categorias, profissionais = [], onSalvar }) {
  const navigate = useNavigate();
  // Trava o botao enquanto a venda e gravada (clique duplo nao vende 2 vezes).
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    metodoPagamento: 'PIX', observacoes: '', leadId: '', cupomCodigo: '', especialistaId: '',
    // 'parcelas' e metadata: anota na descricao mas nao gera lancamentos
    // separados. Operadora do cartao paga o lojista o valor cheio.
    parcelas: 1,
  });
  // Itens: [{ variacaoId, quantidade, _v: variacao }]. _v fica em memoria
  // pra UI calcular total/estoque/preco sem ir ao backend.
  const [itens, setItens] = useState([]);
  // Data de devolucao por item alugado: { [variacaoId]: 'AAAA-MM-DD' }.
  const [datasDevolucao, setDatasDevolucao] = useState({});
  // Cliente final (nome/telefone/cpf) — so usado quando ha item com devolucao
  // e nenhum cliente do CRM foi selecionado no combobox abaixo.
  const [clienteFinal, setClienteFinal] = useState({ nome: '', telefone: '', cpf: '' });

  // Mapa categoriaId -> nome pra exibir inline em cada item da venda.
  // Categoria vem do produto, nao precisa mais de campo global.
  const mapaCategorias = useMemo(
    () => new Map(categorias.map((c) => [c.id, c.nome])),
    [categorias]
  );

  // Adiciona item e ja sugere categoria do produto (respeitando tipo RECEITA).
  // Se ja tem categoria selecionada, nao sobrescreve.
  const adicionarItem = (variacaoId) => {
    if (!variacaoId) return;
    const v = variacoes.find((x) => x.id === variacaoId);
    if (!v) return;
    setItens((prev) => {
      const idx = prev.findIndex((i) => i.variacaoId === variacaoId);
      if (idx >= 0) {
        // Ja existe: incrementa quantidade (respeitando estoque se fisico).
        const novo = [...prev];
        const novaQtd = novo[idx].quantidade + 1;
        if (v.produto?.tipo === 'FISICO' && novaQtd > v.estoqueAtual) {
          alert(`Estoque insuficiente. Disponivel: ${v.estoqueAtual}`);
          return prev;
        }
        novo[idx] = { ...novo[idx], quantidade: novaQtd };
        return novo;
      }
      return [...prev, { variacaoId, quantidade: 1, _v: v }];
    });
    // Sem auto-preencher categoria global — categoria agora vem do proprio
    // produto (mostrada inline) e o backend gera 1 lancamento por categoria.

    // Item alugavel: sugere a data de devolucao pelo prazo padrao do produto
    // (funcionario ainda pode ajustar). Sem prazo padrao, fica em branco —
    // ele escolhe na hora.
    if (v.produto?.temDevolucao && v.produto?.diasParaDevolucaoPadrao) {
      setDatasDevolucao((prev) => {
        if (prev[variacaoId]) return prev;
        const d = new Date();
        d.setDate(d.getDate() + v.produto.diasParaDevolucaoPadrao);
        return { ...prev, [variacaoId]: d.toISOString().slice(0, 10) };
      });
    }
  };

  const mudarQuantidade = (variacaoId, novaQtd) => {
    const q = Math.max(1, parseInt(novaQtd, 10) || 1);
    setItens((prev) => prev.map((i) => {
      if (i.variacaoId !== variacaoId) return i;
      if (i._v?.produto?.tipo === 'FISICO' && q > i._v.estoqueAtual) {
        alert(`Estoque insuficiente. Disponivel: ${i._v.estoqueAtual}`);
        return i;
      }
      return { ...i, quantidade: q };
    }));
  };

  const removerItem = (variacaoId) => {
    setItens((prev) => prev.filter((i) => i.variacaoId !== variacaoId));
    setDatasDevolucao((prev) => {
      if (!(variacaoId in prev)) return prev;
      const novo = { ...prev };
      delete novo[variacaoId];
      return novo;
    });
  };

  const valorTotal = useMemo(
    () => itens.reduce((acc, i) => acc + precoEfetivoVariacao(i._v) * i.quantidade, 0),
    [itens]
  );

  // Itens que exigem devolucao — precisam de data + cliente identificado.
  const itensComDevolucao = useMemo(
    () => itens.filter((i) => i._v?.produto?.temDevolucao),
    [itens]
  );
  const precisaClienteFinal = itensComDevolucao.length > 0 && !form.leadId;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (salvando) return;
    if (itens.length === 0) { alert('Adicione pelo menos 1 produto.'); return; }

    if (itensComDevolucao.length > 0) {
      const semData = itensComDevolucao.find((i) => !datasDevolucao[i.variacaoId]);
      if (semData) {
        alert(`Informe a data de devolução de ${semData._v.produto.nome} (${semData._v.nome}).`);
        return;
      }
      if (precisaClienteFinal && (!clienteFinal.nome.trim() || !clienteFinal.telefone.trim() || !clienteFinal.cpf.trim())) {
        alert('Item com devolução precisa de um cliente identificado: selecione um cliente do CRM ou preencha nome, telefone e CPF.');
        return;
      }
    }

    setSalvando(true);
    try {
      await onSalvar(montarDados());
    } finally {
      setSalvando(false);
    }
  };

  const montarDados = () => ({
      itens: itens.map((i) => ({
        variacaoId: i.variacaoId,
        quantidade: i.quantidade,
        ...(datasDevolucao[i.variacaoId] ? { dataDevolucao: datasDevolucao[i.variacaoId] } : {}),
      })),
      metodoPagamento: form.metodoPagamento,
      observacoes: form.observacoes,
      leadId: form.leadId || undefined,
      cupomCodigo: form.cupomCodigo.trim() || undefined,
      especialistaId: form.especialistaId || undefined,
      ...(precisaClienteFinal ? { clienteFinal } : {}),
      // categoriaId NAO vai mais — backend agrupa por categoria do produto.
      // Parcelas so faz sentido pra credito — backend ignora se outro metodo.
      parcelas: form.metodoPagamento === 'CREDITO' ? (parseInt(form.parcelas, 10) || 1) : 1,
  });

  // Parcelas so aparece quando metodo e cartao de credito.
  const mostraParcelas = form.metodoPagamento === 'CREDITO';


  const qtdUnidades = itens.reduce((acc, i) => acc + i.quantidade, 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Registrar venda"
      description="Dá baixa no estoque e gera o lançamento financeiro automaticamente."
      size="2xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-start">
        {/* Coluna esquerda: produtos, cliente e detalhes */}
        <div className="min-w-0 flex flex-col gap-4" style={{ flex: '999 1 420px' }}>
          {/* Selecao de produtos — combobox alimenta a lista abaixo */}
          <Combobox
            label="Produtos da venda"
            value=""
            onChange={(id) => { if (id) adicionarItem(id); }}
            placeholder="Buscar produto pra adicionar..."
            options={variacoes
              .filter((v) => !itens.some((i) => i.variacaoId === v.id))
              .map((v) => ({
                value: v.id,
                label: `${v.produto?.nome} - ${v.nome}`,
                sublabel: `${fmtBRL(precoEfetivoVariacao(v))}${v.produto?.tipo === 'FISICO' ? ` · ${v.estoqueAtual} em estoque` : ''}`,
              }))}
            clearable
            hint={itens.length === 0 ? 'Comece adicionando o 1º produto.' : 'Pode adicionar quantos produtos quiser.'}
          />
          {variacoes.length === 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-dashed border-[var(--border-main)] bg-[var(--bg-subtle)] px-4 py-3">
              <span className="text-[13px] text-[var(--text-secondary)]">
                Nenhum produto cadastrado ainda. Cadastre o primeiro para poder vender.
              </span>
              <Button
                type="button"
                variant="primary"
                size="sm"
                icon={Plus}
                onClick={() => { onClose(); navigate('/app/estoque/produtos?novo=produto'); }}
              >
                Cadastrar produto
              </Button>
            </div>
          )}

          {/* Carrinho */}
          <div className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)]">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)]">
              <span className="text-sm font-bold text-[var(--text-main)]">Itens</span>
              <span className="text-xs text-[var(--text-muted)] tabular-nums">
                {qtdUnidades} {qtdUnidades === 1 ? 'item' : 'itens'}
              </span>
            </div>
            {itens.length === 0 ? (
              <p className="m-0 px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">
                Carrinho vazio. Busque um produto acima pra começar.
              </p>
            ) : (
              itens.map((item) => {
                const v = item._v;
                const precoUnit = precoEfetivoVariacao(v);
                // Categoria do produto — exibida inline (badge) pra deixar
                // claro pro usuario que cada item leva a categoria propria
                // (1 lancamento financeiro por categoria).
                const catNome = mapaCategorias.get(v?.produto?.categoriaId);
                const alugavel = !!v?.produto?.temDevolucao;
                const nomeItem = `${v?.produto?.nome || ''} ${v?.nome || ''}`.trim();
                return (
                  <div key={item.variacaoId} className="border-b border-[var(--border-subtle)] last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                      <Package size={16} strokeWidth={1.75} aria-hidden="true" className="text-[var(--text-muted)] flex-shrink-0" />
                      <div className="flex-1 min-w-[140px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[13px] font-semibold text-[var(--text-main)]">
                            {v?.produto?.nome} <span className="text-[var(--text-muted)] font-normal">{v?.nome}</span>
                          </span>
                          {catNome
                            ? <Badge variant="neutral" size="sm">{catNome}</Badge>
                            : <Badge variant="warning" size="sm">Sem categoria</Badge>}
                          {alugavel && <Badge variant="accent" size="sm">Aluguel</Badge>}
                        </div>
                        <div className="text-xs text-[var(--text-muted)] tabular-nums">
                          {fmtBRL(precoUnit)} cada
                          {v?.produto?.tipo === 'FISICO' && ` · ${v.estoqueAtual} em estoque`}
                        </div>
                      </div>

                      {/* Stepper de quantidade */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => mudarQuantidade(item.variacaoId, item.quantidade - 1)}
                          className="w-7 h-7 grid place-items-center rounded-md border border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-subtle)] disabled:opacity-40 transition-colors"
                          disabled={item.quantidade <= 1}
                          aria-label={`Diminuir ${nomeItem}`}
                        >
                          <Minus size={14} aria-hidden="true" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={item.quantidade}
                          onChange={(e) => mudarQuantidade(item.variacaoId, e.target.value)}
                          className="w-11 h-7 text-center text-[13px] font-bold tabular-nums rounded-md border border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-main)] focus:outline-none focus:border-[var(--primary)]"
                          aria-label={`Quantidade de ${nomeItem}`}
                        />
                        <button
                          type="button"
                          onClick={() => mudarQuantidade(item.variacaoId, item.quantidade + 1)}
                          className="w-7 h-7 grid place-items-center rounded-md border border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-subtle)] transition-colors"
                          aria-label={`Aumentar ${nomeItem}`}
                        >
                          <Plus size={14} aria-hidden="true" />
                        </button>
                      </div>

                      <div className="text-[13px] font-bold text-[var(--text-main)] tabular-nums w-24 text-right flex-shrink-0">
                        {fmtBRL(precoUnit * item.quantidade)}
                      </div>

                      <IconButton
                        icon={Trash2}
                        variant="ghost"
                        size="sm"
                        onClick={() => removerItem(item.variacaoId)}
                        ariaLabel={`Remover ${nomeItem}`}
                      />
                    </div>

                    {/* Item alugavel: exige data de devolucao. Prazo padrao do
                        produto ja vem sugerido (ver adicionarItem); funcionario
                        pode ajustar. */}
                    {alugavel && (
                      <div className="flex items-center gap-2 px-4 pb-3 pt-2 border-t border-[var(--border-subtle)] bg-[var(--warning-soft)]">
                        <Input
                          size="sm"
                          type="date"
                          label="Devolução em"
                          value={datasDevolucao[item.variacaoId] || ''}
                          onChange={(e) => setDatasDevolucao((prev) => ({ ...prev, [item.variacaoId]: e.target.value }))}
                          required
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Lead vinculado */}
          <Combobox
            label={itensComDevolucao.length > 0 ? 'Cliente' : 'Cliente (opcional)'}
            value={form.leadId}
            onChange={(id) => setForm({ ...form, leadId: id })}
            placeholder="Sem cliente vinculado"
            options={leads.map((l) => ({ value: l.id, label: l.nome, sublabel: l.telefone || l.email }))}
            clearable
            hint={
              itensComDevolucao.length > 0
                ? 'Item com devolução precisa de um cliente identificado. Selecione um já cadastrado, ou preencha os dados abaixo.'
                : 'Vincule a venda a um cliente pra ficar no histórico do CRM.'
            }
          />

          {/* Dados do cliente final digitados na hora — so aparece quando ha
              item com devolucao e nenhum cliente do CRM foi selecionado acima.
              O backend cria (ou reaproveita, por cpf/telefone) um Lead de
              verdade a partir desses dados. */}
          {precisaClienteFinal && (
            <div className="p-3 rounded-[10px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] space-y-3">
              <div className="text-xs font-semibold text-[var(--warning-text)]">
                Quem está alugando? Precisamos pra avisar sobre a devolução.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  size="sm"
                  label="Nome"
                  value={clienteFinal.nome}
                  onChange={(e) => setClienteFinal({ ...clienteFinal, nome: e.target.value })}
                  maxLength={120}
                  required
                />
                <Input
                  size="sm"
                  label="Telefone"
                  value={clienteFinal.telefone}
                  onChange={(e) => setClienteFinal({ ...clienteFinal, telefone: formatarTelefone(e.target.value) })}
                  placeholder="(11) 99999-9999"
                  maxLength={15}
                  required
                />
                <Input
                  size="sm"
                  label="CPF"
                  value={clienteFinal.cpf}
                  onChange={(e) => setClienteFinal({ ...clienteFinal, cpf: formatarCpf(e.target.value) })}
                  placeholder="000.000.000-00"
                  maxLength={14}
                  required
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Cupom de desconto (opcional)"
              value={form.cupomCodigo}
              onChange={(e) => setForm({ ...form, cupomCodigo: e.target.value.toUpperCase() })}
              placeholder="Ex: VOLTA10"
              hint="O desconto é aplicado e validado ao registrar a venda."
            />

            {profissionais.length > 0 && (
              <Select
                label="Quem vendeu (opcional)"
                value={form.especialistaId}
                onChange={(e) => setForm({ ...form, especialistaId: e.target.value })}
                placeholder=""
                hint="Conta na comissão de produto da profissional. Em branco: quem está logado, se for profissional."
                options={[{ value: '', label: 'Não informar' }, ...profissionais.map((p) => ({ value: p.id, label: p.nome }))]}
              />
            )}
          </div>

          <Textarea
            label="Observações"
            value={form.observacoes}
            onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            rows={2}
            placeholder="Anotações sobre a venda (opcional)"
          />
        </div>

        {/* Coluna direita: total, forma de pagamento e finalizar (estilo PDV) */}
        <aside
          className="min-w-0 rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] flex flex-col"
          style={{ flex: '1 1 300px' }}
          aria-label="Resumo e pagamento"
        >
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex flex-col gap-2">
            <div className="flex justify-between text-[13px] text-[var(--text-secondary)]">
              <span>Subtotal</span>
              <span className="tabular-nums">{fmtBRL(valorTotal)}</span>
            </div>
            {form.cupomCodigo.trim() && (
              <div className="flex justify-between text-[13px] text-[var(--text-secondary)]">
                <span>Cupom {form.cupomCodigo.trim()}</span>
                <span>desconto ao registrar</span>
              </div>
            )}
            <div className="flex justify-between items-baseline">
              <span className="text-[15px] font-bold text-[var(--text-main)]">Total</span>
              <span className="text-[28px] font-bold text-[var(--text-main)] tabular-nums">{fmtBRL(valorTotal)}</span>
            </div>
          </div>

          {/* Pagamento + parcelas (so credito) — categoria saiu daqui, ela vem
              de cada item (mostrada inline na lista ao lado). Backend agrupa por
              categoria e cria 1 lancamento financeiro por categoria. */}
          <div className="px-4 py-3 flex flex-col gap-2.5">
            <div className="text-xs font-medium text-[var(--text-muted)]" id="rotulo-forma-pagamento">Como foi pago?</div>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-labelledby="rotulo-forma-pagamento">
              {FORMAS_PAGAMENTO.map((f) => {
                const ativa = form.metodoPagamento === f.value;
                const Icone = f.icone;
                return (
                  <button
                    key={f.value}
                    type="button"
                    aria-pressed={ativa}
                    onClick={() => setForm({ ...form, metodoPagamento: f.value, parcelas: 1 })}
                    className={`flex flex-col items-center justify-center gap-1 h-14 px-1 rounded-lg text-xs font-semibold text-center leading-tight transition-colors ${
                      ativa
                        ? 'border-2 border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--text-main)]'
                        : 'border border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    <Icone size={16} aria-hidden="true" />
                    {f.label}
                  </button>
                );
              })}
            </div>

            {/* Parcelas — so visivel quando metodo e cartao de credito.
                Metadata: backend nao gera lancamentos separados (operadora paga
                o lojista o valor cheio). Aparece como nota no relatorio. */}
            {mostraParcelas && (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2.5">
                <Select
                  size="sm"
                  label="Em quantas vezes?"
                  value={String(form.parcelas)}
                  onChange={(e) => setForm({ ...form, parcelas: parseInt(e.target.value, 10) || 1 })}
                  options={Array.from({ length: 12 }, (_, i) => {
                    const n = i + 1;
                    const valorParcela = valorTotal / n;
                    return {
                      value: String(n),
                      label: n === 1 ? '1x à vista' : `${n}x de ${fmtBRL(valorParcela)}`,
                    };
                  })}
                  placeholder=""
                  hint="A operadora paga o valor cheio em ~30 dias."
                />
              </div>
            )}

            <Button variant="primary" type="submit" size="lg" fullWidth disabled={itens.length === 0 || salvando}>
              {salvando ? 'Registrando...' : itens.length === 0 ? 'Adicione um item' : `Registrar venda · ${fmtBRL(valorTotal)}`}
            </Button>
            <Button variant="secondary" onClick={onClose} type="button" fullWidth disabled={salvando}>Cancelar</Button>
          </div>
        </aside>
      </form>
    </Modal>
  );
}

const FORMAS_PAGAMENTO = [
  { value: 'PIX', label: 'Pix', icone: QrCode },
  { value: 'DINHEIRO', label: 'Dinheiro', icone: Banknote },
  { value: 'DEBITO', label: 'Débito', icone: CreditCard },
  { value: 'CREDITO', label: 'Crédito', icone: CreditCard },
  { value: 'BOLETO', label: 'Boleto', icone: Receipt },
  { value: 'TRANSFERENCIA', label: 'Transferência', icone: ArrowLeftRight },
];

function DrawerVenda({ isOpen, onClose, venda, vendedor, onCancelar, onVincularLead, onIrParaCRM }) {
  if (!venda) return null;

  const cancelada = venda.status === 'CANCELLED';
  const cfgStatus = pixAguardando(venda)
    ? { variant: 'warning', label: 'Aguardando Pix' }
    : STATUS_BADGE[venda.status] || { variant: 'neutral', label: venda.status || '—' };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Venda #${venda.numero ?? venda.id.slice(0, 6)} · ${fmtBRL(venda.valor)}`}
      description={venda.descricao}
      size="md"
      footer={
        <div className="flex justify-between items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={UserPlus}
            onClick={() => onVincularLead?.(venda)}
          >
            {venda.lead ? 'Trocar cliente' : 'Vincular cliente'}
          </Button>
          {!cancelada && onCancelar ? (
            <Button
              variant="danger-soft"
              icon={Ban}
              size="sm"
              onClick={() => onCancelar(venda)}
            >
              Cancelar venda
            </Button>
          ) : <span />}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className={`text-[28px] font-bold tracking-tight tabular-nums ${cancelada ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-main)]'}`}>
              {fmtBRL(venda.valor)}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {new Date(venda.criadoEm).toLocaleString('pt-BR')}
            </div>
          </div>
          <Badge variant={cfgStatus.variant} size="sm">{cfgStatus.label}</Badge>
        </div>

        {cancelada && (
          <div className="rounded-[10px] bg-[var(--danger-soft)] p-3 text-[var(--danger-text)]">
            <div className="text-xs font-bold mb-1">Cancelada</div>
            {venda.dataCancelamento && (
              <div className="text-xs">
                em {new Date(venda.dataCancelamento).toLocaleString('pt-BR')}
              </div>
            )}
            {venda.motivoCancelamento && (
              <div className="text-xs mt-1 italic">
                "{venda.motivoCancelamento}"
              </div>
            )}
          </div>
        )}

        <div className="rounded-[10px] border border-[var(--border-main)]">
          <LinhaInfo rotulo="Pagamento" valor={nomeMetodo(venda.metodoPagamento)} />
          <LinhaInfo rotulo="Situação" valor={cfgStatus.label} />
          <LinhaInfo rotulo="Cliente">
            {venda.lead ? (
              <button
                type="button"
                onClick={() => onIrParaCRM?.(venda.leadId)}
                className="font-semibold text-[var(--text-main)] hover:underline inline-flex items-center gap-1"
              >
                {venda.lead.nome}
                <ExternalLink size={11} aria-hidden="true" className="text-[var(--text-muted)]" />
              </button>
            ) : (
              <span className="font-semibold text-[var(--text-muted)]">Balcão</span>
            )}
          </LinhaInfo>
          <LinhaInfo rotulo="Vendedor" valor={vendedor || '—'} />
          {venda.valorAntesDesconto != null && venda.valorAntesDesconto !== venda.valor && (
            <LinhaInfo rotulo="Antes do desconto" valor={fmtBRL(venda.valorAntesDesconto)} />
          )}
        </div>

        {venda.movimentacoesEstoque?.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-[var(--text-muted)] mb-1.5">Itens vendidos</div>
            <div className="rounded-[10px] border border-[var(--border-main)]">
              {venda.movimentacoesEstoque.map((m) => (
                <LinhaInfo
                  key={m.id}
                  rotulo={`${m.variacao?.produto?.nome || ''} · ${m.variacao?.nome || ''}`}
                  valor={`${Math.abs(m.quantidade)} un.`}
                />
              ))}
            </div>
          </div>
        )}

        {venda.lancamentosFinanceiros?.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-[var(--text-muted)] mb-1.5">Lançamento financeiro</div>
            <div className="rounded-[10px] border border-[var(--border-main)]">
              {venda.lancamentosFinanceiros.map((l) => (
                <LinhaInfo key={l.id} rotulo={l.descricao}>
                  <Badge variant="success" size="sm">{l.status}</Badge>
                </LinhaInfo>
              ))}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

// =====================================================================
// MODAL "CAIXA FECHADO"
// =====================================================================
// Backend rejeita venda manual sem caixa aberto (codigo CAIXA_FECHADO).
// Em vez de toast generico, mostra dialogo amigavel com 1 click pra abrir
// caixa diretamente — UX reduz friccao.
function ModalCaixaFechado({ isOpen, onClose, onIrParaCaixa }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Abra o caixa antes" description="Pra registrar uma venda manual, o caixa precisa estar aberto." size="md">
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-[10px] bg-[var(--warning-soft)] text-[var(--warning-text)]">
          <Wallet size={16} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <strong>Por que isso?</strong> O caixa registra o saldo do dia (fundo + vendas + retiradas + entradas). Sem ele, não dá para controlar o que entra e sai do caixa físico.
          </div>
        </div>

        <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
          Clique abaixo pra ir direto à tela do Caixa. Lá você informa o fundo de caixa (dinheiro inicial pro troco) e já pode voltar e registrar a venda.
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button variant="primary" icon={Wallet} onClick={onIrParaCaixa}>Abrir caixa agora</Button>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
// MODAL DE CANCELAMENTO DE VENDA
// =====================================================================
// Motivo OBRIGATORIO (min 5 chars) — preserva auditoria. Sem rastro, qualquer
// um cancela venda sem responsabilidade. Backend tambem valida (422).
//
// Avisa o usuario do impacto: estorno de estoque + cancelamento de lancamento
// financeiro. Tudo numa transacao no backend, mas a UI deixa claro.
function ModalCancelarVenda({ isOpen, onClose, venda, onConfirmar }) {
  // Estado limpo a cada abertura: o pai troca a `key` do modal.
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);

  if (!venda) return null;

  const motivoValido = motivo.trim().length >= 5;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!motivoValido) return;
    setSalvando(true);
    try {
      await onConfirmar(motivo.trim());
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Cancelar venda · ${fmtBRL(venda.valor)}`}
      description={`Venda #${venda.numero ?? venda.id?.slice(0, 8)}${venda.descricao ? ` — ${venda.descricao}` : ''}`}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-[10px] bg-[var(--warning-soft)] text-[var(--warning-text)]">
          <Ban size={16} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <strong>Atenção:</strong> ao cancelar, o sistema vai:
            <ul className="list-disc list-inside mt-1 space-y-0.5 opacity-90">
              <li>Estornar a quantidade vendida pro estoque</li>
              <li>Cancelar o lançamento financeiro vinculado</li>
              <li>Marcar a venda como CANCELADA (não apaga — fica no histórico)</li>
            </ul>
          </div>
        </div>

        <Textarea
          size="lg"
          label="Por que está cancelando?"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          placeholder="Ex.: Cliente desistiu, produto enviado errado, duplicidade..."
          autoFocus
          required
          hint={
            motivo.length === 0
              ? 'Obrigatório. Mínimo 5 caracteres.'
              : motivo.trim().length < 5
                ? `Faltam ${5 - motivo.trim().length} caractere(s).`
                : '✓ Motivo válido'
          }
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose} disabled={salvando}>Voltar</Button>
          <Button variant="danger" type="submit" icon={Ban} disabled={!motivoValido || salvando}>
            {salvando ? 'Cancelando...' : 'Confirmar cancelamento'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// =====================================================================
// MODAL DE VINCULO DE CLIENTE (retroativo)
// =====================================================================
// Combobox pra escolher o lead. Suporta desvinculo (botao "Remover cliente"
// quando a venda ja tem um vinculado). Backend propaga pros lancamentos
// financeiros vinculados pra manter consistencia de relatorios.
function ModalVincularLead({ isOpen, onClose, venda, leads, onConfirmar }) {
  // Estado limpo a cada abertura: o pai troca a `key` do modal.
  const [leadId, setLeadId] = useState(venda?.leadId || '');
  const [salvando, setSalvando] = useState(false);

  if (!venda) return null;

  const jaTemLead = !!venda.leadId;

  const handleConfirmar = async (idEscolhido) => {
    if (salvando) return;
    setSalvando(true);
    try {
      await onConfirmar(idEscolhido || null);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={jaTemLead ? 'Trocar cliente da venda' : 'Vincular cliente à venda'}
      description={`Venda #${venda.numero ?? venda.id?.slice(0, 8)} · ${fmtBRL(venda.valor)}`}
      size="md"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-[10px] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
          <UserPlus size={16} strokeWidth={2} className="flex-shrink-0 mt-0.5 text-[var(--text-muted)]" />
          <div className="text-xs leading-relaxed">
            Vincular um cliente preserva auditoria no CRM e propaga pro
            lançamento financeiro da venda. Útil quando a venda foi feita
            sem identificar o cliente.
          </div>
        </div>

        <Combobox
          size="lg"
          label="Cliente"
          value={leadId}
          onChange={(id) => setLeadId(id)}
          placeholder="Buscar por nome ou telefone..."
          options={leads.map((l) => ({ value: l.id, label: l.nome, sublabel: l.telefone || l.email }))}
          clearable
        />

        <div className="flex justify-between gap-2 pt-2">
          {jaTemLead ? (
            <Button
              variant="danger-soft"
              size="sm"
              type="button"
              onClick={() => handleConfirmar(null)}
              disabled={salvando}
            >
              Remover cliente
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={salvando}>Cancelar</Button>
            <Button
              variant="primary"
              icon={UserPlus}
              onClick={() => handleConfirmar(leadId)}
              disabled={!leadId || leadId === venda.leadId || salvando}
            >
              {salvando ? 'Salvando...' : 'Vincular'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
