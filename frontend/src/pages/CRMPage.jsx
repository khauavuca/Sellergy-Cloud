import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Edit2, Trash2, Mail, ArrowRight, ArrowLeft,
  LayoutGrid, List, Settings, Lock, MessageCircle, Phone
} from 'lucide-react';
import api from '../services/api';
import {
  Button, IconButton, Input, Textarea, Select, Badge, Avatar,
  EmptyState, SearchBar, useToast, Switch, Combobox,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, BarraFerramentas, AbasPilula
} from '../components/ui';
import Modal from '../components/Modal';
import { formatarTelefoneBR } from '../utils/formatTelefone';
import { formatarCpf, limparCpf } from '../utils/formatCpf';
import { useAuthStore } from '../store/auth.store';

// Quem pode mexer na estrutura do funil. VENDEDOR nao entra — decisao
// estrutural do CRM e do dono/administrador da conta.
function podeConfigurarEtapas(perfil) {
  return perfil === 'CLIENT' || perfil === 'ADMINISTRADOR' || perfil === 'ADMIN';
}

const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const PRIORIDADES = [
  { value: 'LOW', label: 'Baixa' },
  { value: 'MEDIUM', label: 'Média' },
  { value: 'HIGH', label: 'Alta' },
];
const ROTULO_PRIORIDADE = { HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa' };
const COR_PRIORIDADE = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' };

const SLUGS_ETAPA_FECHADA = new Set(['fechado-ganho', 'fechado-perdido']);
const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_PARADO = 60;
const POR_PAGINA = 25;
// Kanban mostra os mais recentes de uma vez (a busca acha o resto).
const LIMITE_KANBAN = 200;

// Preco efetivo da variacao (regra: usar preco-catalogo se ativado).
// Espelha resolverPrecoVenda no backend pra UI calcular total localmente.
function precoEfetivoVariacao(v) {
  if (!v) return 0;
  return Number(v.preco) || 0;
}

// Ultimo sinal de vida do lead: ultimo contato registrado ou a ultima
// atualizacao do cadastro, o que for mais recente.
function ultimaAtividade(lead) {
  const datas = [lead.ultimoContato, lead.atualizadoEm, lead.criadoEm]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t));
  return datas.length ? Math.max(...datas) : null;
}

function formatarAniversario(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function formatarDataCurta(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return 'hoje';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: d.getFullYear() === hoje.getFullYear() ? undefined : '2-digit' });
}

function soDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

function linkWhatsApp(telefone) {
  const d = soDigitos(telefone);
  if (!d) return null;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
}

// Situacao do lead usada na tabela, nas abas e na ficha.
function situacaoDoLead(lead, etapa, agora) {
  if (etapa?.slug === 'fechado-ganho') return { chave: 'ganho', rotulo: 'Ganho', variant: 'success' };
  if (etapa?.slug === 'fechado-perdido') return { chave: 'perdido', rotulo: 'Perdido', variant: 'danger' };
  if (etapa?.slug === 'em-pausa') return { chave: 'pausa', rotulo: 'Em pausa', variant: 'neutral' };
  const ultima = ultimaAtividade(lead);
  if (ultima && agora - ultima > DIAS_PARADO * DIA_MS) return { chave: 'parado', rotulo: 'Parado', variant: 'warning' };
  const criado = lead.criadoEm ? new Date(lead.criadoEm).getTime() : null;
  if (criado && agora - criado <= 7 * DIA_MS) return { chave: 'novo', rotulo: 'Novo', variant: 'info' };
  return { chave: 'aberto', rotulo: 'Em aberto', variant: 'neutral' };
}

export default function CRMPage() {
  const toast = useToast();
  const { user } = useAuthStore();
  const podeConfigurar = podeConfigurarEtapas(user?.perfil);
  const [searchParams, setSearchParams] = useSearchParams();

  const [stages, setStages] = useState([]);
  // Pagina atual vinda do servidor (busca, aba, etapa e paginacao no backend:
  // negocio com milhares de clientes nao baixa tudo de uma vez).
  const [resposta, setResposta] = useState({ itens: [], total: 0, totalPaginas: 1, contagens: {}, numeros: {} });
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [view, setView] = useState('lista');
  const [aba, setAba] = useState('todos');
  const [filtroEtapa, setFiltroEtapa] = useState('');
  const [pagina, setPagina] = useState(0);
  const [selecionadoId, setSelecionadoId] = useState(null);
  const [leadAvulso, setLeadAvulso] = useState(null); // aberto por link direto
  const [versao, setVersao] = useState(0);
  const fichaRef = useRef(null);
  // "Agora" fixo por montagem: as contas de parado/novo/aniversario nao
  // precisam andar sozinhas enquanto a tela esta aberta.
  const [agora] = useState(() => Date.now());

  const [modalLead, setModalLead] = useState({ open: false, data: null });
  const [modalCatalogoEtapas, setModalCatalogoEtapas] = useState(false);

  // Busca digitada so vai pro servidor depois de uma pausa.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    let ativo = true;
    const params = new URLSearchParams({
      pagina: String(pagina + 1),
      limite: String(view === 'kanban' ? LIMITE_KANBAN : POR_PAGINA),
      aba,
    });
    if (buscaAplicada) params.set('busca', buscaAplicada);
    if (filtroEtapa) params.set('etapaId', filtroEtapa);
    Promise.all([
      api.get('/crm/stages').catch(() => ({ data: [] })),
      api.get(`/crm/leads?${params.toString()}`).catch(() => null),
    ]).then(([s, l]) => {
      if (!ativo) return;
      setStages(s.data || []);
      if (l?.data && Array.isArray(l.data.itens)) setResposta(l.data);
      else if (l === null) toast.error('Não foi possível carregar os clientes. Tente de novo.');
    }).finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, view, aba, buscaAplicada, filtroEtapa, versao]);

  const leads = resposta.itens;
  const carregar = () => { setCarregando(true); setVersao((v) => v + 1); };

  const selecionarLead = (lead) => {
    setSelecionadoId(lead.id);
    // Em tela estreita a ficha desce pra baixo da lista: leva o usuario ate ela.
    if (typeof window !== 'undefined' && window.innerWidth < 1100) {
      requestAnimationFrame(() => fichaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  // Link direto `?lead=<id>` (vindo de Vendas, Financeiro etc.): busca o lead
  // no servidor (ele pode nao estar na pagina atual) e limpa o parametro.
  const leadIdDeepLink = searchParams.get('lead');
  useEffect(() => {
    if (!leadIdDeepLink) return;
    api.get(`/crm/leads/${leadIdDeepLink}`)
      .then((r) => { setLeadAvulso(r.data); setSelecionadoId(r.data.id); })
      .catch(() => toast.error('Cliente não encontrado.'))
      .finally(() => {
        const next = new URLSearchParams(searchParams);
        next.delete('lead');
        setSearchParams(next, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadIdDeepLink]);

  const stagesPorId = useMemo(() => {
    const m = {};
    stages.forEach((s) => { m[s.id] = s; });
    return m;
  }, [stages]);

  const leadSelecionado = leads.find((l) => l.id === selecionadoId)
    || (leadAvulso && leadAvulso.id === selecionadoId ? leadAvulso : null)
    || leads[0] || null;

  // Situacao calculada uma vez por lead (os da pagina + o aberto por link).
  const situacoes = useMemo(() => {
    const m = {};
    [...leads, ...(leadAvulso ? [leadAvulso] : [])].forEach((l) => { m[l.id] = situacaoDoLead(l, stagesPorId[l.etapaId] || l.etapa, agora); });
    return m;
  }, [leads, leadAvulso, stagesPorId, agora]);

  // Faixa de numeros: calculada no servidor sobre o negocio inteiro.
  const numeros = {
    emAberto: resposta.numeros?.emAberto ?? 0,
    valorAberto: resposta.numeros?.valorAberto ?? 0,
    novosMes: resposta.numeros?.novosMes ?? 0,
    parados: resposta.numeros?.parados ?? 0,
    aniversariantes: resposta.numeros?.aniversariantes ?? 0,
    ganhos: resposta.numeros?.ganhos ?? 0,
    total: resposta.numeros?.total ?? 0,
  };

  const abas = [
    { valor: 'todos', rotulo: 'Todos' },
    { valor: 'aberto', rotulo: 'Em aberto' },
    { valor: 'ganho', rotulo: 'Ganhos' },
    { valor: 'parado', rotulo: 'Parados' },
    { valor: 'aniversario', rotulo: 'Aniversário' },
  ].map((a) => ({ ...a, qtd: resposta.contagens?.[a.valor] ?? 0 }));

  const leadsPorEtapa = useMemo(() => {
    const map = {};
    stages.forEach((s) => { map[s.id] = []; });
    map['_sem_etapa'] = [];
    leads.forEach((l) => {
      if (l.etapaId && map[l.etapaId]) map[l.etapaId].push(l);
      else map['_sem_etapa'].push(l);
    });
    return map;
  }, [stages, leads]);

  const totalPaginas = Math.max(1, resposta.totalPaginas || 1);
  const paginaAtual = Math.min(pagina, totalPaginas - 1);

  const trocarAba = (v) => { setAba(v); setPagina(0); };

  const avisarDuplicados = (r) => {
    for (const a of r?.data?.avisos || []) toast.warning(a.mensagem);
  };

  const handleSalvarLead = async (dados) => {
    try {
      if (dados.id) {
        const r = await api.put(`/crm/leads/${dados.id}`, dados);
        toast.success('Cliente atualizado');
        avisarDuplicados(r);
        if (leadAvulso?.id === dados.id) setLeadAvulso(r.data);
      } else {
        const r = await api.post('/crm/leads', dados);
        toast.success('Cliente cadastrado');
        avisarDuplicados(r);
        if (r?.data?.id) { setSelecionadoId(r.data.id); setLeadAvulso(r.data); }
      }
      setModalLead({ open: false, data: null });
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || e.response?.data?.error || 'Não foi possível salvar. Confira os campos.');
    }
  };

  const handleExcluirLead = async (lead) => {
    if (!confirm(`Excluir o cliente "${lead.nome}"?`)) return;
    try {
      await api.delete(`/crm/leads/${lead.id}`);
      toast.success('Cliente excluído');
      setSelecionadoId(null);
      setLeadAvulso(null);
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || e.response?.data?.error || 'Erro ao excluir');
    }
  };

  // Mover manda so a etapa (nao reenvia o cadastro inteiro).
  const handleMoverLead = async (lead, etapaId) => {
    try {
      const r = await api.put(`/crm/leads/${lead.id}`, { etapaId });
      toast.success('Cliente movido');
      if (leadAvulso?.id === lead.id) setLeadAvulso(r.data);
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao mover');
    }
  };

  // Habilita etapa do catalogo. Idempotente no backend (upsert).
  const handleHabilitarEtapa = async (slug) => {
    try {
      await api.post(`/crm/stages/catalogo/${slug}`);
      toast.success('Etapa ligada');
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao ligar a etapa');
    }
  };

  // Desliga. Bloqueia (409) se houver clientes na etapa — toast explicativo.
  const handleDesabilitarEtapa = async (slug) => {
    try {
      await api.delete(`/crm/stages/catalogo/${slug}`);
      toast.success('Etapa desligada');
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao desligar a etapa');
    }
  };

  const stagesOrdenadas = [...stages].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const carregandoInicial = carregando && leads.length === 0 && stages.length === 0;
  const crmVazio = !carregando && numeros.total === 0 && !buscaAplicada && !filtroEtapa;

  const botoesTopo = (
    <>
      {/* So dono/administrador pode configurar etapas do funil */}
      {podeConfigurar && (
        <Button variant="secondary" size="sm" icon={Settings} onClick={() => setModalCatalogoEtapas(true)}>
          Configurar etapas
        </Button>
      )}
      <Button variant="primary" size="sm" icon={Plus} onClick={() => setModalLead({ open: true, data: null })}>
        Novo cliente
      </Button>
    </>
  );

  return (
    <Pagina>
      <FaixaNumeros>
        <Numero
          rotulo="Leads no funil"
          valor={numeros.emAberto}
          detalhe={`${numeros.total} no total · ${numeros.ganhos} ganhos`}
          carregando={carregandoInicial}
          onClick={() => trocarAba('aberto')}
        />
        <Numero
          rotulo="Novos no mês"
          valor={numeros.novosMes}
          detalhe="cadastrados desde o dia 1º"
          carregando={carregandoInicial}
        />
        <Numero
          rotulo={`Parados há ${DIAS_PARADO}+ dias`}
          valor={numeros.parados}
          tom={numeros.parados > 0 ? 'alerta' : 'neutro'}
          detalhe="sem contato nem atualização"
          carregando={carregandoInicial}
          onClick={() => trocarAba('parado')}
        />
        <Numero
          rotulo="Aniversariantes da semana"
          valor={numeros.aniversariantes}
          detalhe="próximos 7 dias"
          carregando={carregandoInicial}
          onClick={() => trocarAba('aniversario')}
        />
        <Numero
          rotulo="Valor em negociação"
          valor={fmtBRL(numeros.valorAberto)}
          detalhe="soma dos leads em aberto"
          destaque
          carregando={carregandoInicial}
        />
      </FaixaNumeros>

      {crmVazio ? (
        <Painel>
          <EmptyState
            icon={LayoutGrid}
            title="Nenhum cliente ainda"
            description="Cadastre o primeiro cliente ou importe a sua planilha. O funil de etapas é opcional: dá pra usar só a lista de clientes."

            action={
              <div className="flex gap-2 justify-center">
                <Button variant="primary" icon={Plus} onClick={() => setModalLead({ open: true, data: null })}>
                  Cadastrar primeiro cliente
                </Button>
              </div>
            }
          />
        </Painel>
      ) : (
        <ColunasPagina
          larguraLateral={340}
          lateral={
            <div ref={fichaRef} className="scroll-mt-4">
              <FichaLead
                key={leadSelecionado?.id || 'nenhum'}
                lead={leadSelecionado}
                stages={stagesOrdenadas}
                etapa={leadSelecionado ? stagesPorId[leadSelecionado.etapaId] || leadSelecionado.etapa : null}
                situacao={leadSelecionado ? situacoes[leadSelecionado.id] : null}
                agora={agora}
                carregando={carregandoInicial}
                onEditar={() => setModalLead({ open: true, data: leadSelecionado })}
                onExcluir={() => handleExcluirLead(leadSelecionado)}
                onMover={(etapaId) => handleMoverLead(leadSelecionado, etapaId)}
              />
            </div>
          }
        >
          <Painel semPadding as="section" className="overflow-hidden">
            <BarraFerramentas>
              <AbasPilula abas={abas} valor={aba} onChange={trocarAba} rotulo="Segmento de leads" />
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div role="tablist" aria-label="Modo de exibição" className="flex rounded-lg border border-[var(--border-main)] p-0.5">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === 'lista'}
                    onClick={() => setView('lista')}
                    className={`h-8 px-2.5 rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors ${view === 'lista' ? 'bg-[var(--bg-subtle)] text-[var(--text-main)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
                  >
                    <List size={14} aria-hidden="true" /> Tabela
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === 'kanban'}
                    onClick={() => setView('kanban')}
                    className={`h-8 px-2.5 rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors ${view === 'kanban' ? 'bg-[var(--bg-subtle)] text-[var(--text-main)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
                  >
                    <LayoutGrid size={14} aria-hidden="true" /> Kanban
                  </button>
                </div>
                {botoesTopo}
              </div>
            </BarraFerramentas>
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-[var(--border-subtle)]">
              <div className="flex-1 min-w-[220px] max-w-md">
                <SearchBar
                  value={busca}
                  onChange={(e) => { setBusca(e.target.value); setPagina(0); }}
                  placeholder="Buscar por nome, telefone, e-mail ou tag..."
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
                Etapa
                <select
                  value={filtroEtapa}
                  onChange={(e) => { setFiltroEtapa(e.target.value); setPagina(0); }}
                  className="h-9 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 text-[13px] font-medium text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)]"
                >
                  <option value="">Todas</option>
                  {stagesOrdenadas.map((s) => (<option key={s.id} value={s.id}>{s.nome}</option>))}
                  <option value="_sem_etapa">Sem etapa</option>
                </select>
              </label>
            </div>

            {carregandoInicial ? (
              <div className="text-center py-12 text-[var(--text-muted)] text-[13px]">Carregando...</div>
            ) : view === 'kanban' ? (
              <>
              {resposta.total > leads.length && (
                <div className="px-3 pt-2 text-xs text-[var(--text-muted)]">
                  Mostrando os {leads.length} mais recentes de {resposta.total}. Use a busca ou o filtro de etapa para achar os outros.
                </div>
              )}
              <KanbanView
                stages={stagesOrdenadas}
                leadsPorEtapa={leadsPorEtapa}
                selecionadoId={leadSelecionado?.id}
                onSelecionarLead={selecionarLead}
                onConfigurarEtapas={podeConfigurar ? () => setModalCatalogoEtapas(true) : null}
                onMoverLead={handleMoverLead}
              />
              </>
            ) : (
              <TabelaLeads
                leads={leads}
                total={resposta.total}
                pagina={paginaAtual}
                totalPaginas={totalPaginas}
                onPagina={setPagina}
                stagesPorId={stagesPorId}
                situacoes={situacoes}
                selecionadoId={leadSelecionado?.id}
                onSelecionarLead={selecionarLead}
              />
            )}
          </Painel>
        </ColunasPagina>
      )}

      <ModalLead
        key={modalLead.open ? `lead-${modalLead.data?.id ?? 'novo'}` : 'lead-fechado'}
        isOpen={modalLead.open}
        onClose={() => setModalLead({ open: false, data: null })}
        lead={modalLead.data}
        stages={stagesOrdenadas}
        onSalvar={handleSalvarLead}
      />

      <ModalCatalogoEtapas
        key={modalCatalogoEtapas ? 'catalogo-etapas-aberto' : 'catalogo-etapas-fechado'}
        isOpen={modalCatalogoEtapas}
        onClose={() => setModalCatalogoEtapas(false)}
        onHabilitar={handleHabilitarEtapa}
        onDesabilitar={handleDesabilitarEtapa}
      />
    </Pagina>
  );
}

function KanbanView({ stages, leadsPorEtapa, selecionadoId, onSelecionarLead, onConfigurarEtapas, onMoverLead }) {
  const semEtapa = leadsPorEtapa['_sem_etapa'] || [];

  return (
    <div className="overflow-x-auto custom-scrollbar p-3">
      <div className="flex gap-3 min-w-max">
        {semEtapa.length > 0 && (
          <KanbanColumn
            stage={{ id: '_sem_etapa', nome: 'Sem etapa', cor: null }}
            leads={semEtapa}
            stages={stages}
            selecionadoId={selecionadoId}
            onSelecionarLead={onSelecionarLead}
            onMoverLead={onMoverLead}
            isSemEtapa
          />
        )}
        {stages.map((stage) => (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            leads={leadsPorEtapa[stage.id] || []}
            stages={stages}
            selecionadoId={selecionadoId}
            onSelecionarLead={onSelecionarLead}
            onMoverLead={onMoverLead}
          />
        ))}
        {/* Coluna 'fantasma' pra habilitar mais etapas. So aparece pra quem pode configurar. */}
        {onConfigurarEtapas && (
          <button
            onClick={onConfigurarEtapas}
            className="w-64 flex-shrink-0 rounded-[10px] border border-dashed border-[var(--border-main)] hover:border-[var(--text-muted)] hover:bg-[var(--bg-subtle)] transition-colors flex flex-col items-center justify-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-main)] py-12"
            type="button"
          >
            <Settings size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="text-[13px] font-medium">Configurar etapas</span>
          </button>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({ stage, leads, stages, selecionadoId, onSelecionarLead, onMoverLead, isSemEtapa }) {
  const totalValor = leads.reduce((acc, l) => acc + Number(l.valor || 0), 0);

  return (
    <div className="w-64 flex-shrink-0 flex flex-col">
      <div className="flex items-center justify-between gap-2 px-1 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {stage.cor && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: stage.cor }} aria-hidden="true" />}
          <span className="text-[13px] font-semibold tracking-tight text-[var(--text-main)] truncate">{stage.nome}</span>
          <Badge variant="neutral" size="sm">{leads.length}</Badge>
        </div>
        {totalValor > 0 && (
          <span className="text-xs text-[var(--text-muted)] tabular-nums flex-shrink-0">{fmtBRL(totalValor)}</span>
        )}
      </div>

      <div className="rounded-[10px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] p-2 flex-1 min-h-[200px] space-y-2">
        {leads.length === 0 ? (
          <div className="text-center py-8 text-xs text-[var(--text-muted)]">Vazio</div>
        ) : (
          leads.map((lead) => (
            <KanbanCard
              key={lead.id}
              lead={lead}
              stages={stages}
              currentStageId={isSemEtapa ? null : stage.id}
              selecionado={lead.id === selecionadoId}
              onClick={() => onSelecionarLead(lead)}
              onMover={onMoverLead}
            />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanCard({ lead, stages, currentStageId, selecionado, onClick, onMover }) {
  const tags = lead.tags?.split(',').map((t) => t.trim()).filter(Boolean) || [];
  const idx = stages.findIndex((s) => s.id === currentStageId);
  // Lead fechado (ganho ou perdido) nao tem mais acao de mover — a etapa e
  // final; reabertura so acontece automaticamente (novo contato/devolucao
  // proxima), nunca manual.
  const etapaFechada = idx >= 0 && SLUGS_ETAPA_FECHADA.has(stages[idx].slug);
  const proxima = !etapaFechada && idx >= 0 && idx < stages.length - 1 ? stages[idx + 1] : null;
  const anterior = !etapaFechada && idx > 0 ? stages[idx - 1] : null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selecionado}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={`rounded-lg bg-[var(--bg-card)] border p-2.5 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${selecionado ? 'border-[var(--primary)]' : 'border-[var(--border-main)] hover:border-[var(--text-muted)]'}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Avatar name={lead.nome} size="sm" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--text-main)] tracking-tight truncate">{lead.nome}</div>
            {lead.telefone && <div className="text-[11px] text-[var(--text-muted)] truncate">{lead.telefone}</div>}
          </div>
        </div>
        {lead.prioridade && (
          <Badge variant={COR_PRIORIDADE[lead.prioridade] || 'neutral'} size="sm">
            {ROTULO_PRIORIDADE[lead.prioridade] || lead.prioridade}
          </Badge>
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {tags.slice(0, 3).map((t, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] font-medium">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-1.5">
        {lead.valor > 0 ? (
          <span className="text-xs font-semibold text-[var(--text-main)] tabular-nums">{fmtBRL(lead.valor)}</span>
        ) : <span />}
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {etapaFechada ? (
            <span title="Lead fechado — não pode ser movido manualmente." className="p-1 text-[var(--text-muted)]">
              <Lock size={12} aria-label="Lead fechado" />
            </span>
          ) : (
            <>
              {anterior && (
                <button
                  type="button"
                  title={`Mover para ${anterior.nome}`}
                  aria-label={`Mover ${lead.nome} para ${anterior.nome}`}
                  onClick={() => onMover(lead, anterior.id)}
                  className="p-1 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  <ArrowLeft size={12} aria-hidden="true" />
                </button>
              )}
              {proxima && (
                <button
                  type="button"
                  title={`Mover para ${proxima.nome}`}
                  aria-label={`Mover ${lead.nome} para ${proxima.nome}`}
                  onClick={() => onMover(lead, proxima.id)}
                  className="p-1 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  <ArrowRight size={12} aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const TH = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const TD = 'px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap';

function TabelaLeads({ leads, total, pagina, totalPaginas, onPagina, stagesPorId, situacoes, selecionadoId, onSelecionarLead }) {
  if (total === 0) {
    return (
      <div className="py-6">
        <EmptyState icon={List} title="Nenhum lead encontrado" description="Tente ajustar a busca, a aba ou a etapa, ou crie um novo lead." />
      </div>
    );
  }
  const inicio = pagina * POR_PAGINA + 1;
  const fim = pagina * POR_PAGINA + leads.length;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Cliente</th>
              <th className={TH}>WhatsApp</th>
              <th className={TH}>Etapa</th>
              <th className={TH}>Último contato</th>
              <th className={TH}>Prioridade</th>
              <th className={`${TH} text-right`}>Valor</th>
              <th className={TH}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const etapa = stagesPorId[l.etapaId] || l.etapa;
              const sit = situacoes[l.id];
              const ativo = l.id === selecionadoId;
              return (
                <tr
                  key={l.id}
                  onClick={() => onSelecionarLead(l)}
                  className={`cursor-pointer transition-colors ${ativo ? 'bg-[var(--success-soft)]' : 'hover:bg-[var(--bg-subtle)]'}`}
                >
                  <td className={TD}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelecionarLead(l); }}
                      aria-current={ativo ? 'true' : undefined}
                      className="flex items-center gap-2.5 text-left font-semibold text-[var(--text-main)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded"
                    >
                      <Avatar name={l.nome} size="sm" />
                      <span className="truncate max-w-[220px]">{l.nome}</span>
                    </button>
                  </td>
                  <td className={`${TD} text-[var(--text-secondary)] tabular-nums`}>{l.telefone || '—'}</td>
                  <td className={TD}>
                    {etapa ? (
                      <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                        {etapa.cor && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: etapa.cor }} aria-hidden="true" />}
                        {etapa.nome}
                      </span>
                    ) : <span className="text-[var(--text-muted)]">Sem etapa</span>}
                  </td>
                  <td className={`${TD} text-[var(--text-secondary)]`}>{formatarDataCurta(ultimaAtividade(l))}</td>
                  <td className={TD}>
                    {l.prioridade ? (
                      <Badge variant={COR_PRIORIDADE[l.prioridade] || 'neutral'} size="sm">{ROTULO_PRIORIDADE[l.prioridade] || l.prioridade}</Badge>
                    ) : '—'}
                  </td>
                  <td className={`${TD} text-right font-semibold text-[var(--text-main)] tabular-nums`}>{l.valor > 0 ? fmtBRL(l.valor) : '—'}</td>
                  <td className={TD}>{sit && <Badge variant={sit.variant} size="sm">{sit.rotulo}</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs font-medium text-[var(--text-muted)]">
        <span>Mostrando {inicio}–{fim} de {total}</span>
        {totalPaginas > 1 && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => onPagina(pagina - 1)} disabled={pagina === 0}>Anterior</Button>
            <Button variant="secondary" size="sm" onClick={() => onPagina(pagina + 1)} disabled={pagina >= totalPaginas - 1}>Próxima</Button>
          </div>
        )}
      </div>
    </>
  );
}

// =====================================================================
// MODAL DE LEAD
// =====================================================================
// Cadastra/edita lead. NAO tem mais campo 'Valor estimado' — o valor do
// lead e calculado pelo backend somando os produtos/servicos vinculados.
// Aqui o usuario seleciona 1 ou mais variacoes do catalogo, e o total
// aparece automaticamente.
//
// Tons: linguagem coloquial, perguntas. Campos agrupados em 3 secoes:
//   1. Quem e o cliente
//   2. O que ele quer comprar (com tabela de itens)
//   3. Contexto (etapa, urgencia, origem, etiquetas)
function ModalLead({ isOpen, onClose, lead, stages, onSalvar }) {
  const toast = useToast();
  // O pai troca a `key` a cada abertura, entao form e itens nascem hidratados
  // do lead atual (em vez de um efeito que resetava ao abrir).
  const [form, setForm] = useState(() => (lead
    ? {
      nome: lead.nome || '',
      telefone: lead.telefone || '',
      email: lead.email || '',
      // CPF vem do backend so com digitos — aplicar mascara aqui.
      cpf: lead.cpf ? formatarCpf(lead.cpf) : '',
      // Data nasc vem em ISO — pegar so YYYY-MM-DD pro input type=date.
      dataNascimento: lead.dataNascimento ? new Date(lead.dataNascimento).toISOString().slice(0, 10) : '',
      etapaId: lead.etapaId || '',
      tags: lead.tags || '',
      prioridade: lead.prioridade || 'MEDIUM',
      origem: lead.origem || 'MANUAL',
      observacoes: lead.observacoes || '',
    }
    : {
      nome: '', telefone: '', email: '', cpf: '', dataNascimento: '',
      // Cliente novo ja entra na primeira etapa ligada do funil (se houver).
      etapaId: stages[0]?.id || '', tags: '', prioridade: 'MEDIUM', origem: 'MANUAL', observacoes: '',
    }));
  // Itens selecionados: [{ variacaoId, quantidade, observacao, _v: { ...variacao+produto } }].
  // O _v fica em memoria so pra UI calcular total/exibir; backend recebe sem ele.
  // Mapeia LeadVariacao -> formato local de itens.
  const [itens, setItens] = useState(() => (lead
    ? (lead.variacoes || []).map((lv) => ({
      variacaoId: lv.variacao?.id || lv.variacaoId,
      quantidade: lv.quantidade || 1,
      observacao: lv.observacao || '',
      _v: lv.variacao || null,
    }))
    : []));
  const [catalogo, setCatalogo] = useState([]);
  // Ja nasce carregando quando o modal monta aberto.
  const [carregandoCatalogo, setCarregandoCatalogo] = useState(isOpen);

  // Carrega catalogo (uma unica vez por abertura) — flatten produto > variacoes.
  useEffect(() => {
    if (!isOpen) return;
    api.get('/catalogo')
      .then((r) => {
        const flat = [];
        (r.data || []).forEach((p) => {
          (p.variacoes || []).forEach((v) => flat.push({ ...v, produto: p }));
        });
        setCatalogo(flat);
      })
      .catch(() => setCatalogo([]))
      .finally(() => setCarregandoCatalogo(false));
  }, [isOpen]);

  const adicionarItem = (variacaoId) => {
    if (!variacaoId) return;
    const v = catalogo.find((x) => x.id === variacaoId);
    if (!v) return;
    // Se ja tem, incrementa qtd em vez de duplicar (mesma regra do backend).
    setItens((prev) => {
      const idx = prev.findIndex((i) => i.variacaoId === variacaoId);
      if (idx >= 0) {
        const novo = [...prev];
        novo[idx] = { ...novo[idx], quantidade: novo[idx].quantidade + 1 };
        return novo;
      }
      return [...prev, { variacaoId, quantidade: 1, observacao: '', _v: v }];
    });
  };

  const mudarQuantidade = (variacaoId, qtd) => {
    const q = Math.max(1, parseInt(qtd, 10) || 1);
    setItens((prev) => prev.map((i) => (i.variacaoId === variacaoId ? { ...i, quantidade: q } : i)));
  };

  const removerItem = (variacaoId) => {
    setItens((prev) => prev.filter((i) => i.variacaoId !== variacaoId));
  };

  const total = useMemo(
    () => itens.reduce((acc, i) => acc + precoEfetivoVariacao(i._v) * i.quantidade, 0),
    [itens]
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.nome.trim()) { toast.error('Coloque o nome do cliente'); return; }
    if (form.cpf && limparCpf(form.cpf).length !== 11) { toast.error('CPF incompleto: são 11 números.'); return; }
    onSalvar({
      ...form,
      // CPF: manda so digitos pro backend. Vazio = null (limpa o campo).
      cpf: limparCpf(form.cpf) || null,
      // Data nascimento: '' do input type=date vira null pro backend.
      dataNascimento: form.dataNascimento || null,
      // Sem etapa = null (cliente fora do funil e permitido).
      etapaId: form.etapaId || null,
      // Backend recalcula 'valor' pela soma dos itens — nao mandamos mais.
      variacoes: itens.map((i) => ({
        variacaoId: i.variacaoId,
        quantidade: i.quantidade,
        observacao: i.observacao || null,
      })),
      ...(lead?.id ? { id: lead.id } : {}),
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={lead ? 'Editar cliente' : 'Novo cliente'} description="Cadastre quem é o cliente e o que ele quer comprar." size="2xl">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Secao 1: Quem e */}
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-4">Quem é o cliente</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              size="lg"
              label="Nome"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex.: Maria Silva"
              required
              autoFocus
            />
            <Input
              size="lg"
              label="Telefone"
              value={form.telefone}
              onChange={(e) => setForm({ ...form, telefone: formatarTelefoneBR(e.target.value) })}
              placeholder="(11) 99999-9999"
              maxLength={15}
              inputMode="tel"
            />
            <Input
              size="lg"
              label="E-mail"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="cliente@email.com"
            />
            <Input
              size="lg"
              label="CPF"
              value={form.cpf}
              onChange={(e) => setForm({ ...form, cpf: formatarCpf(e.target.value) })}
              placeholder="000.000.000-00"
              maxLength={14}
              inputMode="numeric"
            />
            <Input
              size="lg"
              label="Data de nascimento"
              type="date"
              value={form.dataNascimento}
              onChange={(e) => setForm({ ...form, dataNascimento: e.target.value })}
              hint="Pra parabéns automático e segmentação por idade."
            />
          </div>
        </div>

        {/* Secao 2: O que ele quer comprar (substitui Valor estimado) */}
        <div className="border-t border-[var(--border-main)] pt-5">
          <div className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-4">O que ele quer comprar</div>

          <Combobox
            size="lg"
            label="Adicionar produto/serviço do catálogo"
            value=""
            onChange={(id) => { if (id) adicionarItem(id); }}
            options={catalogo
              .filter((v) => !itens.some((i) => i.variacaoId === v.id))
              .map((v) => ({
                value: v.id,
                label: `${v.produto?.nome} - ${v.nome}`,
                sublabel: [
                  precoEfetivoVariacao(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                  v.produto?.tipo === 'FISICO' ? `${v.estoqueAtual} em estoque` : null,
                  v.produto?.tipo === 'SERVICO' && v.duracaoMin ? `${v.duracaoMin}min` : null,
                ].filter(Boolean).join(' · '),
              }))}
            placeholder={carregandoCatalogo ? 'Carregando...' : 'Buscar produto ou serviço'}
            clearable
            hint="Pode adicionar vários. O total é calculado automaticamente."
          />

          {/* Lista de itens selecionados */}
          {itens.length > 0 && (
            <div className="mt-3 space-y-2">
              {itens.map((item) => {
                const v = item._v;
                const ehServico = v?.produto?.tipo === 'SERVICO';
                const precoUnit = precoEfetivoVariacao(v);
                return (
                  <div key={item.variacaoId} className="flex items-center gap-3 p-3 border border-[var(--border-main)] bg-[var(--bg-card)]">
                    {/* Info do item (cresce e trunca) */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[var(--text-main)] truncate">
                        {v?.produto?.nome} <span className="text-[var(--text-muted)] font-normal">{v?.nome}</span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-2">
                        <span>{fmtBRL(precoUnit)} cada</span>
                        {ehServico && v?.duracaoMin && (
                          <><span>·</span><span>{v.duracaoMin}min</span></>
                        )}
                      </div>
                    </div>

                    {/* Stepper de quantidade — input nativo compacto, sem o
                        wrapper w-full do componente <Input> */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => mudarQuantidade(item.variacaoId, item.quantidade - 1)}
                        className="w-7 h-9 border border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] text-sm font-semibold transition-colors"
                        aria-label="Diminuir quantidade"
                        disabled={item.quantidade <= 1}
                      >−</button>
                      <input
                        type="number"
                        min={1}
                        value={item.quantidade}
                        onChange={(e) => mudarQuantidade(item.variacaoId, e.target.value)}
                        className="w-12 h-9 text-center text-sm font-semibold tabular-nums border border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)]"
                        aria-label="Quantidade"
                      />
                      <button
                        type="button"
                        onClick={() => mudarQuantidade(item.variacaoId, item.quantidade + 1)}
                        className="w-7 h-9 border border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] text-sm font-semibold transition-colors"
                        aria-label="Aumentar quantidade"
                      >+</button>
                    </div>

                    {/* Subtotal alinhado a direita */}
                    <div className="text-sm font-semibold text-[var(--text-main)] tabular-nums w-24 text-right flex-shrink-0">
                      {fmtBRL(precoUnit * item.quantidade)}
                    </div>

                    <IconButton
                      icon={Trash2}
                      variant="ghost"
                      size="sm"
                      onClick={() => removerItem(item.variacaoId)}
                      ariaLabel="Remover item"
                    />
                  </div>
                );
              })}

              {/* Total agregado */}
              <div className="flex items-center justify-between px-3 py-2.5 border border-[var(--border-main)] bg-[var(--bg-subtle)] text-[var(--text-main)] font-semibold">
                <span className="text-sm">Total estimado</span>
                <span className="text-base tabular-nums">{fmtBRL(total)}</span>
              </div>
            </div>
          )}
          {itens.length === 0 && (
            <div className="text-sm text-[var(--text-muted)] italic mt-3">
              Nenhum item adicionado ainda. O lead pode ser salvo sem produto, mas é mais fácil acompanhar quando você sabe o que ele quer.
            </div>
          )}
        </div>

        {/* Secao 3: Contexto */}
        <div className="border-t border-[var(--border-main)] pt-5">
          <div className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-4">Contexto da venda</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              size="lg"
              label="Em qual etapa está?"
              value={form.etapaId || ''}
              onChange={(e) => setForm({ ...form, etapaId: e.target.value })}
              placeholder="Sem etapa"
              options={stages.map((s) => ({ value: s.id, label: s.nome }))}
              hint={stages.length === 0 ? 'Opcional: o funil de etapas pode ser ligado depois em "Configurar etapas".' : null}
            />
            <Select
              size="lg"
              label="Urgência"
              value={form.prioridade}
              onChange={(e) => setForm({ ...form, prioridade: e.target.value })}
              options={PRIORIDADES}
              placeholder=""
            />
            <Input
              size="lg"
              label="Etiquetas (separadas por vírgula)"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="cliente vip, lead quente, indicação"
              hint="Palavras-chave pra filtrar depois."
            />
          </div>
          <Textarea
            size="lg"
            label="Anotações"
            value={form.observacoes}
            onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            rows={3}
            maxLength={2000}
            placeholder="O que você sabe sobre esse cliente: necessidades, prazo, restrições..."
            className="mt-4"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">Cancelar</Button>
          <Button variant="primary" type="submit">{lead ? 'Salvar' : 'Cadastrar cliente'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// =====================================================================
// MODAL DE CATALOGO DE ETAPAS
// =====================================================================
// Lista as 8 etapas pre-definidas com um toggle pra habilitar/desabilitar.
// Substitui o antigo modal de nome livre — o tenant nao inventa etapa,
// escolhe de um catalogo curado.
//
// Permissao: o botao que abre esse modal so aparece pra CLIENT/ADMINISTRADOR
// (controlado em CRMPage via podeConfigurar). Backend tambem trava em
// requerPapelPrivilegiado, entao mesmo manipulando a chamada o vendedor
// recebe 403.
function ModalCatalogoEtapas({ isOpen, onClose, onHabilitar, onDesabilitar }) {
  const [catalogo, setCatalogo] = useState([]);
  // Ja nasce carregando quando monta aberto (o pai troca a `key` a cada abertura).
  const [carregando, setCarregando] = useState(isOpen);
  const [salvandoSlug, setSalvandoSlug] = useState(null);

  // Busca sem setState sincrono; o recarregar apos o toggle liga o carregando antes.
  const buscarCatalogo = useCallback(() => api.get('/crm/stages/catalogo')
    .then((r) => { setCatalogo(r.data || []); })
    .catch(() => { setCatalogo([]); })
    .finally(() => { setCarregando(false); }), []);

  const carregarCatalogo = () => {
    setCarregando(true);
    return buscarCatalogo();
  };

  useEffect(() => {
    if (isOpen) buscarCatalogo();
  }, [isOpen, buscarCatalogo]);

  const handleToggle = async (item, novoEstado) => {
    setSalvandoSlug(item.slug);
    try {
      if (novoEstado) {
        await onHabilitar(item.slug);
      } else {
        await onDesabilitar(item.slug);
      }
      await carregarCatalogo();
    } finally {
      setSalvandoSlug(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Configurar etapas do funil" description="Ligue só as etapas que você usa. O resto fica de fora para não poluir o quadro." size="md">
      <div className="space-y-2">
        {carregando ? (
          <div className="text-center py-8 text-sm text-[var(--text-muted)]">Carregando...</div>
        ) : (
          catalogo.map((item) => (
            <div key={item.slug} className="flex items-center gap-3 p-3 border border-[var(--border-main)] bg-[var(--bg-card)]">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.cor }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold tracking-tight text-[var(--text-main)]">{item.nome}</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">{item.descricao}</div>
              </div>
              <Switch
                checked={item.habilitada}
                disabled={salvandoSlug === item.slug}
                onChange={(v) => handleToggle(item, v)}
                ariaLabel={`${item.habilitada ? 'Desabilitar' : 'Habilitar'} etapa ${item.nome}`}
              />
            </div>
          ))
        )}

        <div className="flex items-start gap-2 p-3 border border-[var(--border-subtle)] bg-[var(--info-soft)] text-[var(--info-text)] mt-3">
          <Lock size={14} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <strong>Etapa com clientes não pode ser desligada.</strong> Mova os clientes dela para outra etapa primeiro.
          </div>
        </div>

        <div className="flex justify-end pt-3">
          <Button variant="primary" onClick={onClose}>Pronto</Button>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
// FICHA DO LEAD (coluna da direita)
// =====================================================================
// Substitui o antigo drawer: o lead escolhido na tabela/kanban aparece aqui,
// com numeros, dados, acoes (editar, WhatsApp, mover, excluir) e a linha do
// tempo (historico + nova observacao).
const TAG_HISTORICO = {
  OBSERVACAO: { rotulo: 'Nota', variant: 'neutral' },
  MOVIDO: { rotulo: 'Etapa', variant: 'info' },
  CRIADO: { rotulo: 'Criado', variant: 'success' },
  EDITADO: { rotulo: 'Editado', variant: 'neutral' },
};

function FichaLead({ lead, stages, etapa, situacao, agora, carregando, onEditar, onExcluir, onMover }) {
  const toast = useToast();
  const [historico, setHistorico] = useState([]);
  const [novaObs, setNovaObs] = useState('');
  const [carregandoObs, setCarregandoObs] = useState(false);

  const leadId = lead?.id;
  const versao = lead?.atualizadoEm;
  // Recarrega a linha do tempo quando o lead muda (o pai troca a `key`) ou
  // quando ele e atualizado (mover/editar gera registro no historico).
  useEffect(() => {
    if (!leadId) return;
    api.get(`/crm/leads/${leadId}/history`)
      .then((r) => setHistorico(r.data || []))
      .catch(() => setHistorico([]));
  }, [leadId, versao]);

  const adicionarObs = async () => {
    if (!novaObs.trim()) return;
    setCarregandoObs(true);
    try {
      await api.post(`/crm/leads/${lead.id}/history`, { observacoes: novaObs });
      const r = await api.get(`/crm/leads/${lead.id}/history`);
      setHistorico(r.data || []);
      setNovaObs('');
      toast.success('Observação adicionada');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao adicionar');
    } finally {
      setCarregandoObs(false);
    }
  };

  if (carregando) {
    return (
      <Painel titulo="Ficha do cliente">
        <div className="h-24 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />
      </Painel>
    );
  }

  if (!lead) {
    return (
      <Painel titulo="Ficha do cliente">
        <p className="m-0 text-[13px] text-[var(--text-muted)]">
          Escolha um lead na lista pra ver os dados, as ações e a linha do tempo.
        </p>
      </Painel>
    );
  }

  const etapaFechada = SLUGS_ETAPA_FECHADA.has(etapa?.slug);
  const whatsapp = linkWhatsApp(lead.telefone);
  const itens = lead.variacoes || [];
  const qtdItens = itens.reduce((acc, i) => acc + (Number(i.quantidade) || 1), 0);
  const diasNoFunil = lead.criadoEm ? Math.max(0, Math.floor((agora - new Date(lead.criadoEm).getTime()) / DIA_MS)) : null;
  const tags = lead.tags?.split(',').map((t) => t.trim()).filter(Boolean) || [];

  return (
    <section aria-label="Ficha do cliente" className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] min-w-0 overflow-hidden">
      {/* Cabecalho */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)]">
        <Avatar name={lead.nome} size="md" />
        <div className="flex-1 min-w-0">
          <h2 className="m-0 text-[15px] font-bold text-[var(--text-main)] tracking-tight truncate">{lead.nome}</h2>
          <div className="text-xs text-[var(--text-muted)] truncate">{lead.telefone || lead.email || 'Sem contato'}</div>
        </div>
        {situacao && <Badge variant={situacao.variant} size="md">{situacao.rotulo}</Badge>}
      </div>

      {/* Numeros */}
      <div className="grid grid-cols-3 border-b border-[var(--border-subtle)]">
        <div className="px-4 py-3 border-r border-[var(--border-subtle)] min-w-0">
          <div className="text-xs font-medium text-[var(--text-muted)]">Valor</div>
          <div className="text-[15px] font-bold text-[var(--text-main)] tabular-nums truncate">{lead.valor > 0 ? fmtBRL(lead.valor) : '—'}</div>
        </div>
        <div className="px-4 py-3 border-r border-[var(--border-subtle)] min-w-0">
          <div className="text-xs font-medium text-[var(--text-muted)]">Itens</div>
          <div className="text-[15px] font-bold text-[var(--text-main)] tabular-nums">{qtdItens}</div>
        </div>
        <div className="px-4 py-3 min-w-0">
          <div className="text-xs font-medium text-[var(--text-muted)]">No funil</div>
          <div className="text-[15px] font-bold text-[var(--text-main)] tabular-nums">{diasNoFunil == null ? '—' : `${diasNoFunil} ${diasNoFunil === 1 ? 'dia' : 'dias'}`}</div>
        </div>
      </div>

      {/* Dados */}
      <div>
        <LinhaInfo rotulo="Etapa" valor={etapa?.nome || 'Sem etapa'} />
        <LinhaInfo rotulo="Último contato" valor={formatarDataCurta(ultimaAtividade(lead))} />
        {lead.prioridade && <LinhaInfo rotulo="Prioridade" valor={ROTULO_PRIORIDADE[lead.prioridade] || lead.prioridade} />}
        {lead.email && (
          <LinhaInfo rotulo="E-mail">
            <a href={`mailto:${lead.email}`} className="font-semibold text-[var(--primary)] hover:underline [overflow-wrap:anywhere]">{lead.email}</a>
          </LinhaInfo>
        )}
        {lead.cpf && <LinhaInfo rotulo="CPF" valor={formatarCpf(lead.cpf)} />}
        {lead.dataNascimento && <LinhaInfo rotulo="Aniversário" valor={formatarAniversario(lead.dataNascimento)} />}
        {lead.origem && <LinhaInfo rotulo="Origem" valor={lead.origem === 'MANUAL' ? 'Cadastro manual' : lead.origem} />}
        {itens.length > 0 && (
          <div className="px-4 py-2.5 border-b border-[var(--border-subtle)]">
            <div className="text-xs font-medium text-[var(--text-muted)] mb-1.5">Quer comprar</div>
            <ul className="m-0 p-0 list-none space-y-1">
              {itens.map((i) => (
                <li key={i.id || i.variacaoId} className="flex justify-between gap-2 text-[13px] text-[var(--text-secondary)]">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {i.quantidade > 1 ? `${i.quantidade}× ` : ''}{i.variacao?.produto?.nome}{i.variacao?.nome ? ` · ${i.variacao.nome}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {tags.length > 0 && (
          <div className="px-4 py-2.5 border-b border-[var(--border-subtle)]">
            <div className="text-xs font-medium text-[var(--text-muted)] mb-1.5">Etiquetas</div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t, i) => (<Badge key={i} variant="neutral" size="sm">{t}</Badge>))}
            </div>
          </div>
        )}
        {lead.observacoes && (
          <div className="px-4 py-2.5 border-b border-[var(--border-subtle)]">
            <div className="text-xs font-medium text-[var(--text-muted)] mb-1">Anotações</div>
            <p className="m-0 text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">{lead.observacoes}</p>
          </div>
        )}
      </div>

      {/* Acoes */}
      <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
        <Button variant="primary" size="sm" icon={Edit2} onClick={onEditar}>Editar lead</Button>
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-subtle)] transition-colors"
          >
            <MessageCircle size={14} aria-hidden="true" /> WhatsApp
          </a>
        )}
        {lead.telefone && (
          <a
            href={`tel:${lead.telefone}`}
            aria-label={`Ligar para ${lead.nome}`}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-subtle)] transition-colors"
          >
            <Phone size={14} aria-hidden="true" />
          </a>
        )}
        {lead.email && (
          <a
            href={`mailto:${lead.email}`}
            aria-label={`Enviar e-mail para ${lead.nome}`}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-subtle)] transition-colors"
          >
            <Mail size={14} aria-hidden="true" />
          </a>
        )}
        <IconButton icon={Trash2} variant="ghost" size="sm" onClick={onExcluir} ariaLabel={`Excluir lead ${lead.nome}`} className="ml-auto text-[var(--danger-text)]" />
      </div>

      {/* Mover de etapa */}
      {stages.length > 0 && (
        <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
          {etapaFechada ? (
            <div className="flex items-start gap-2 text-xs text-[var(--text-muted)]">
              <Lock size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>Lead fechado — não pode ser movido manualmente. Reabre sozinho se o cliente entrar em contato de novo.</span>
            </div>
          ) : (
            <>
              <div className="text-xs font-medium text-[var(--text-muted)] mb-2">Mover para etapa</div>
              <div className="flex flex-wrap gap-1.5">
                {stages.map((s) => {
                  const atual = s.id === lead.etapaId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onMover(s.id)}
                      disabled={atual}
                      aria-pressed={atual}
                      className={`h-7 px-2.5 rounded-md text-xs font-semibold border transition-colors ${
                        atual
                          ? 'bg-[var(--primary)] text-[var(--text-on-primary)] border-[var(--primary)] cursor-default'
                          : 'border-[var(--border-main)] hover:bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {s.nome}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Linha do tempo */}
      <div className="px-4 py-3">
        <div className="text-xs font-medium text-[var(--text-muted)] mb-2">Linha do tempo ({historico.length})</div>
        <div className="space-y-2 mb-3">
          <Textarea
            value={novaObs}
            onChange={(e) => setNovaObs(e.target.value)}
            placeholder="Adicionar observação..."
            rows={2}
            maxLength={2000}
            aria-label="Nova observação"
          />
          <Button variant="secondary" size="sm" onClick={adicionarObs} loading={carregandoObs} disabled={!novaObs.trim()}>Adicionar</Button>
        </div>
        {historico.length === 0 ? (
          <div className="text-xs text-[var(--text-muted)] py-2">Sem registros ainda.</div>
        ) : (
          <ul className="m-0 p-0 list-none space-y-2.5">
            {historico.map((h) => {
              const tag = TAG_HISTORICO[h.acao] || { rotulo: h.acao ? h.acao.charAt(0) + h.acao.slice(1).toLowerCase().replace(/_/g, ' ') : 'Registro', variant: 'neutral' };
              return (
                <li key={h.id} className="flex gap-2 items-start">
                  <Badge variant={tag.variant} size="sm" className="flex-shrink-0">{tag.rotulo}</Badge>
                  <div className="min-w-0 text-[13px]">
                    {h.observacoes && <div className="text-[var(--text-secondary)] [overflow-wrap:anywhere]">{h.observacoes}</div>}
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{new Date(h.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
