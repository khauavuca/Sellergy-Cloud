import { useState, useEffect, useMemo } from 'react';
import {
  Plus, ChevronLeft, ChevronRight, Calendar, Clock, Phone, Edit2, Trash2,
  CheckCircle2, XCircle, Sparkles, Lock, History, Users, Package, QrCode
} from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import {
  Card, Button, IconButton, Input, Textarea, Select, Badge,
  Drawer, useToast, Tabs, TabsList, TabsTrigger, Combobox
} from '../components/ui';
import Modal from '../components/Modal';
import { formatarTelefoneBR } from '../utils/formatTelefone';
import { useAuthStore } from '../store/auth.store';

const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_LABELS = {
  PENDING: { label: 'Pendente', variant: 'warning' },
  CONFIRMED: { label: 'Confirmado', variant: 'success' },
  CANCELED: { label: 'Cancelado', variant: 'danger' },
  COMPLETED: { label: 'Concluido', variant: 'info' },
};

// Cores por status. soft = fundo do card/pill; text = cor do texto; solid = barra
// lateral mais saturada. Mantemos consistente com o sistema de design (mesmas
// vars usadas em Badge). CANCELED tambem ganha line-through pra reforcar visual.
const STATUS_CORES = {
  PENDING:   { soft: 'var(--warning-soft)', text: 'var(--warning-text)', solid: 'var(--warning)' },
  CONFIRMED: { soft: 'var(--success-soft)', text: 'var(--success-text)', solid: 'var(--success)' },
  CANCELED:  { soft: 'var(--danger-soft)',  text: 'var(--danger-text)',  solid: 'var(--danger)'  },
  COMPLETED: { soft: 'var(--info-soft)',    text: 'var(--info-text)',    solid: 'var(--info)'    },
};
const coresPorStatus = (s) => STATUS_CORES[s] || STATUS_CORES.PENDING;

// Regra de imutabilidade (espelha o backend em agenda.routes.js):
// agendamento passado + status != PENDING fica travado pra editar/excluir.
// PENDING passado continua editavel pra usuario poder atualizar o status
// retroativamente (ex: marcar como Concluido). Assim que atualiza, trava.
function ehAgendamentoImutavel(ag) {
  if (!ag) return false;
  if (ag.status === 'PENDING') return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return new Date(ag.data) < hoje;
}

export default function AgendaPage() {
  const toast = useToast();
  const [view, setView] = useState('dia');
  const [dataAtual, setDataAtual] = useState(new Date());
  const [variacoes, setVariacoes] = useState([]);
  const [especialistas, setEspecialistas] = useState([]);
  const [modal, setModal] = useState({ open: false, data: null });
  const [drawer, setDrawer] = useState({ open: false, ag: null });
  const [filtroEspecialista, setFiltroEspecialista] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  // Recarregar = mudar a versao; carregando = resultado ainda nao e da chave atual.
  const [versao, setVersao] = useState(0);
  const [resultado, setResultado] = useState({ chave: null, itens: [] });
  const chave = `${view}|${dataAtual.toISOString()}|${filtroEspecialista}|${versao}`;
  const agendamentos = resultado.itens;
  const carregando = resultado.chave !== chave;
  const carregar = () => setVersao((v) => v + 1);

  const user = useAuthStore((s) => s.user);
  // Só gestor (CLIENT/ADMINISTRADOR) filtra por especialista; o especialista
  // com escopo próprio já vê só a agenda dele (o backend ignora o filtro).
  const podeFiltrarEspecialista = ['CLIENT', 'ADMINISTRADOR', 'ADMIN'].includes(user?.perfil);

  useEffect(() => {
    let vivo = true;
    // IMPORTANTE: calculamos a janela [inicio, fim] no fuso LOCAL do navegador
    // e mandamos pro backend em ISO (ja em UTC). Assim o backend nao precisa
    // saber o fuso do cliente nem manipular Date com setHours (que tem efeito
    // dependente do TZ do processo).
    //
    // Bug que isso corrige: agendamento criado pras 09:00 BRT (= 12:00Z)
    // aparecia no filtro do dia seguinte quando o servidor rodava em UTC
    // mas o cliente em BRT, porque a janela do backend era [00:00Z, 23:59Z]
    // do dia "string" e o setHours embaralhava ainda mais.
    let inicio, fim;
    if (view === 'dia') {
      inicio = new Date(dataAtual);
      inicio.setHours(0, 0, 0, 0);
      fim = new Date(dataAtual);
      fim.setHours(23, 59, 59, 999);
    } else if (view === 'semana') {
      // Domingo a sábado da semana que contém dataAtual.
      inicio = new Date(dataAtual);
      inicio.setDate(dataAtual.getDate() - dataAtual.getDay());
      inicio.setHours(0, 0, 0, 0);
      fim = new Date(inicio);
      fim.setDate(inicio.getDate() + 6);
      fim.setHours(23, 59, 59, 999);
    } else {
      inicio = new Date(dataAtual.getFullYear(), dataAtual.getMonth(), 1, 0, 0, 0, 0);
      fim = new Date(dataAtual.getFullYear(), dataAtual.getMonth() + 1, 0, 23, 59, 59, 999);
    }
    let url = `/agenda?inicio=${encodeURIComponent(inicio.toISOString())}&fim=${encodeURIComponent(fim.toISOString())}`;
    if (filtroEspecialista) url += `&especialistaId=${encodeURIComponent(filtroEspecialista)}`;
    api.get(url)
      .then((r) => { if (vivo) setResultado({ chave, itens: r.data || [] }); })
      .catch(() => { if (vivo) setResultado({ chave, itens: [] }); });
    return () => { vivo = false; };
  }, [chave, view, dataAtual, filtroEspecialista]);

  useEffect(() => {
    api.get('/catalogo')
      .then((r) => {
        const flat = [];
        (r.data || []).forEach((p) => {
          (p.variacoes || []).forEach((v) => flat.push({ ...v, produto: p }));
        });
        setVariacoes(flat);
      })
      .catch(() => setVariacoes([]));
    // Especialistas ativos — fallback do seletor na edição (quando não há serviço
    // re-selecionado, mostra todos pra manter/trocar o profissional).
    api.get('/especialistas')
      .then((r) => setEspecialistas((r.data || []).filter((e) => e.ativo)))
      .catch(() => setEspecialistas([]));
  }, []);

  const handleSalvar = async (dados) => {
    try {
      if (dados.id) {
        await api.put(`/agenda/${dados.id}`, dados);
        toast.success('Agendamento atualizado');
      } else {
        const r = await api.post('/agenda', dados);
        if (r.data?.sinal) {
          toast.success(`Agendamento criado. Sinal de ${fmtBRL(r.data.sinal.valor)} enviado por Pix; vence às ${new Date(r.data.sinal.expiraEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`);
        } else if (r.data?.sinalMotivo) {
          const motivos = {
            SEM_PAGAMENTO: 'sem sinal: o recebimento por Pix não está configurado em Pagamentos',
            MUITO_PERTO: 'sem sinal: o horário está muito perto pra esperar o Pix',
            SEM_SINAL: 'sem sinal: o valor ficou abaixo de R$ 1,00',
            FALHA_COBRANCA: 'sem sinal: não foi possível gerar o Pix agora',
          };
          toast.warning(`Agendamento criado ${motivos[r.data.sinalMotivo] || 'sem sinal'}.`);
        } else {
          toast.success(r.data?.pacoteClienteId ? 'Agendamento criado usando o pacote' : 'Agendamento criado');
        }
      }
      setModal({ open: false, data: null });
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao salvar');
    }
  };

  const handleExcluir = async (ag) => {
    if (!confirm(`Excluir agendamento de ${ag.nomeCliente}?`)) return;
    try {
      await api.delete(`/agenda/${ag.id}`);
      toast.success('Agendamento excluido');
      setDrawer({ open: false, ag: null });
      carregar();
    } catch {
      toast.error('Erro ao excluir');
    }
  };

  const handleMudarStatus = async (ag, status) => {
    try {
      await api.patch(`/agenda/${ag.id}/status`, { status });
      toast.success(`Marcado como ${STATUS_LABELS[status]?.label?.toLowerCase()}`);
      setDrawer({ open: false, ag: null });
      carregar();
    } catch {
      toast.error('Erro ao mudar status');
    }
  };

  // Concluir = fecha o ciclo serviço→venda. Diferente de só mudar status:
  // marca COMPLETED E lança a venda do serviço no caixa (endpoint /concluir).
  // Por isso a conclusão NÃO passa por handleMudarStatus.
  const handleConcluir = async (ag) => {
    try {
      const r = await api.patch(`/agenda/${ag.id}/concluir`, {});
      const v = r.data?.venda;
      const extras = [];
      if (r.data?.pacote) extras.push(`sessão ${r.data.pacote.sessoesUsadas} de ${r.data.pacote.sessoesTotal} do pacote`);
      if (r.data?.sinalAbatido > 0) extras.push(`sinal de ${fmtBRL(r.data.sinalAbatido)} já descontado`);
      toast.success(
        (v
          ? `Atendimento concluido · Venda #${v.numero}${v.valor > 0 ? ` (${fmtBRL(v.valor)})` : ''}`
          : 'Atendimento concluido') + (extras.length ? ` · ${extras.join(' · ')}` : '')
      );
      setDrawer({ open: false, ag: null });
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao concluir o atendimento');
    }
  };

  const navegar = (dir) => {
    const nova = new Date(dataAtual);
    if (view === 'dia') nova.setDate(nova.getDate() + dir);
    else if (view === 'semana') nova.setDate(nova.getDate() + dir * 7);
    else nova.setMonth(nova.getMonth() + dir);
    setDataAtual(nova);
  };

  const irHoje = () => setDataAtual(new Date());

  const fmtData = (() => {
    if (view === 'dia') {
      return dataAtual.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (view === 'semana') {
      const ini = new Date(dataAtual);
      ini.setDate(dataAtual.getDate() - dataAtual.getDay());
      const f = new Date(ini);
      f.setDate(ini.getDate() + 6);
      return `${ini.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} – ${f.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`;
    }
    return dataAtual.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  })();

  // Status filtra no cliente — assim a faixa de resumo continua refletindo o
  // período inteiro, independente do filtro de status selecionado.
  const agendamentosFiltrados = filtroStatus
    ? agendamentos.filter((a) => a.status === filtroStatus)
    : agendamentos;
  const stats = {
    agendados: agendamentos.length,
    concluidos: agendamentos.filter((a) => a.status === 'COMPLETED').length,
    cancelados: agendamentos.filter((a) => a.status === 'CANCELED').length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconButton icon={ChevronLeft} variant="secondary" size="md" onClick={() => navegar(-1)} ariaLabel="Anterior" />
          <Button variant="ghost" size="md" onClick={irHoje}>Hoje</Button>
          <IconButton icon={ChevronRight} variant="secondary" size="md" onClick={() => navegar(1)} ariaLabel="Proximo" />
          <div className="ml-2 text-base font-semibold tracking-tight text-[var(--text-main)] first-letter:uppercase">
            {fmtData}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/app/agenda/encaixe" className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-subtle)]">
            <Users size={16} /> Fila de encaixe
          </Link>
          <Tabs value={view} onValueChange={setView}>
            <TabsList variant="pills">
              <TabsTrigger value="dia" variant="pills">Dia</TabsTrigger>
              <TabsTrigger value="semana" variant="pills">Semana</TabsTrigger>
              <TabsTrigger value="mes" variant="pills">Mes</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="primary" icon={Plus} onClick={() => setModal({ open: true, data: null })}>
            Novo agendamento
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {podeFiltrarEspecialista && (
          <Select
            value={filtroEspecialista}
            onChange={(e) => setFiltroEspecialista(e.target.value)}
            placeholder="Todos os especialistas"
            options={especialistas.map((e) => ({ value: e.id, label: e.nome }))}
            fullWidth={false}
            className="w-56"
          />
        )}
        <Select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          placeholder="Todos os status"
          options={Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v.label }))}
          fullWidth={false}
          className="w-44"
        />
      </div>

      {/* Resumo do período — neutro, sem cor e sem faturamento (dado do Financeiro). */}
      <div className="grid grid-cols-3 gap-3">
        <ResumoCard label="Agendados" valor={stats.agendados} />
        <ResumoCard label="Concluidos" valor={stats.concluidos} />
        <ResumoCard label="Cancelados" valor={stats.cancelados} />
      </div>

      {/* Conteudo — a grade sempre aparece (mesmo vazia, mostra a estrutura). */}
      {carregando ? (
        <Card padding="lg">
          <div className="text-center py-12 text-[var(--text-muted)] text-sm">Carregando...</div>
        </Card>
      ) : view === 'dia' ? (
        <ViewDia
          agendamentos={agendamentosFiltrados}
          especialistas={filtroEspecialista ? especialistas.filter((e) => e.id === filtroEspecialista) : especialistas}
          onSelecionar={(ag) => setDrawer({ open: true, ag })}
          onNovo={() => setModal({ open: true, data: null })}
        />
      ) : view === 'semana' ? (
        <ViewSemana agendamentos={agendamentosFiltrados} dataReferencia={dataAtual} onSelecionar={(ag) => setDrawer({ open: true, ag })} />
      ) : (
        <ViewMes agendamentos={agendamentosFiltrados} dataReferencia={dataAtual} onSelecionar={(ag) => setDrawer({ open: true, ag })} />
      )}

      <ModalAgendamento
        isOpen={modal.open}
        onClose={() => setModal({ open: false, data: null })}
        ag={modal.data}
        variacoes={variacoes}
        especialistas={especialistas}
        onSalvar={handleSalvar}
      />

      <DrawerAg
        isOpen={drawer.open}
        onClose={() => setDrawer({ open: false, ag: null })}
        ag={drawer.ag}
        onEditar={() => {
          setModal({ open: true, data: drawer.ag });
          setDrawer({ open: false, ag: null });
        }}
        onExcluir={() => handleExcluir(drawer.ag)}
        onStatus={(s) => handleMudarStatus(drawer.ag, s)}
        onConcluir={() => handleConcluir(drawer.ag)}
      />
    </div>
  );
}

// Card de resumo do período — propositalmente neutro (sem cor), no padrão sóbrio.
function ResumoCard({ label, valor }) {
  return (
    <div className="bg-[var(--bg-subtle)] rounded-xl p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="text-2xl font-semibold tracking-tight mt-1 tabular-nums text-[var(--text-main)]">{valor}</div>
    </div>
  );
}

// Bloco de agendamento usado nas grades (Dia/Semana). Cor pelo status.
function BlocoAgendamento({ ag, onSelecionar }) {
  const cores = coresPorStatus(ag.status);
  const ehCancelado = ag.status === 'CANCELED';
  const data = new Date(ag.data);
  return (
    <button
      onClick={() => onSelecionar(ag)}
      className={`w-full text-left rounded-md px-2 py-1.5 mb-1 hover:opacity-80 transition-opacity ${ehCancelado ? 'line-through' : ''}`}
      style={{ backgroundColor: cores.soft, color: cores.text }}
      title={`${ag.nomeCliente}${ag.servico ? ' · ' + ag.servico : ''}`}
    >
      <div className="text-[11px] font-bold tabular-nums">
        {data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="text-xs font-semibold truncate">{ag.nomeCliente}</div>
      {ag.servico && <div className="text-[11px] truncate opacity-80">{ag.servico}</div>}
      {ag.pacote && <div className="text-[11px] truncate opacity-80">Pacote · {ag.pacote.sessoesUsadas} de {ag.pacote.sessoesTotal}</div>}
      {ag.sinalStatus === 'PENDENTE' && <div className="text-[11px] truncate font-semibold">Sinal pendente</div>}
    </button>
  );
}

// VISÃO DIA — uma coluna por profissional, linhas por hora. Os "buracos" entre
// atendimentos ficam à mostra (hover revela "livre"). Padrão de clínica/salão.
function ViewDia({ agendamentos, especialistas = [], onSelecionar, onNovo }) {
  // Colunas: 1 por especialista ativo; + "Sem profissional" se houver
  // agendamento sem vínculo; fallback pra 1 coluna se não houver especialista.
  const semEspecialista = agendamentos.some((a) => !a.especialistaId);
  let colunas = especialistas.map((e) => ({ id: e.id, nome: e.nome }));
  if (semEspecialista) colunas.push({ id: null, nome: 'Sem profissional' });
  if (colunas.length === 0) colunas = [{ id: null, nome: 'Agendamentos' }];

  // Faixa de horas: do 1º ao último atendimento do dia (default 8h–18h).
  const horas = useMemo(() => {
    let min = 8;
    let max = 18;
    agendamentos.forEach((a) => {
      const h = new Date(a.data).getHours();
      if (h < min) min = h;
      if (h + 1 > max) max = h + 1;
    });
    const arr = [];
    for (let h = min; h <= max; h++) arr.push(h);
    return arr;
  }, [agendamentos]);

  // Índice [especialista]_[hora] -> agendamentos.
  const porCelula = useMemo(() => {
    const m = {};
    agendamentos.forEach((a) => {
      const h = new Date(a.data).getHours();
      const k = `${a.especialistaId || 'null'}_${h}`;
      (m[k] = m[k] || []).push(a);
    });
    return m;
  }, [agendamentos]);

  return (
    <div className="rounded-xl border border-[var(--border-main)] overflow-hidden bg-[var(--bg-card)]">
      <div className="overflow-x-auto">
        <div style={{ minWidth: `${56 + colunas.length * 150}px` }}>
          <div className="flex bg-[var(--bg-subtle)] border-b border-[var(--border-main)]">
            <div className="w-14 flex-shrink-0" />
            {colunas.map((c) => (
              <div key={c.id || 'null'} className="flex-1 min-w-[150px] py-2.5 px-2 text-center text-sm font-semibold text-[var(--text-main)] border-l border-[var(--border-main)] truncate">
                {c.nome}
              </div>
            ))}
          </div>
          {horas.map((h) => (
            <div key={h} className="flex border-b border-[var(--border-subtle)]">
              <div className="w-14 flex-shrink-0 pt-1.5 px-1 text-center text-[11px] text-[var(--text-muted)] tabular-nums">
                {String(h).padStart(2, '0')}:00
              </div>
              {colunas.map((c) => {
                const ags = (porCelula[`${c.id || 'null'}_${h}`] || []).sort((a, b) => new Date(a.data) - new Date(b.data));
                return (
                  <div key={c.id || 'null'} className="flex-1 min-w-[150px] min-h-[56px] border-l border-[var(--border-subtle)] p-1">
                    {ags.length === 0 ? (
                      <button
                        onClick={onNovo}
                        className="w-full h-full min-h-[48px] rounded-md text-[11px] text-[var(--text-muted)] opacity-0 hover:opacity-100 hover:bg-[var(--bg-subtle)] transition-opacity flex items-center justify-center gap-1"
                      >
                        <Plus size={12} /> livre
                      </button>
                    ) : (
                      ags.map((ag) => <BlocoAgendamento key={ag.id} ag={ag} onSelecionar={onSelecionar} />)
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// VISÃO SEMANA — 7 colunas (dom–sáb), cada dia com seus atendimentos em chips.
function ViewSemana({ agendamentos, dataReferencia, onSelecionar }) {
  const inicioSemana = useMemo(() => {
    const d = new Date(dataReferencia);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }, [dataReferencia]);
  const dias = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const d = new Date(inicioSemana);
      d.setDate(inicioSemana.getDate() + i);
      return d;
    }),
    [inicioSemana]
  );
  const porDia = useMemo(() => {
    const m = {};
    agendamentos.forEach((a) => {
      const k = new Date(a.data).toDateString();
      (m[k] = m[k] || []).push(a);
    });
    return m;
  }, [agendamentos]);
  const hojeStr = new Date().toDateString();
  const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

  return (
    <div className="grid grid-cols-7 gap-2">
      {dias.map((d, i) => {
        const ags = (porDia[d.toDateString()] || []).sort((a, b) => new Date(a.data) - new Date(b.data));
        const ehHoje = d.toDateString() === hojeStr;
        return (
          <div key={i} className="border border-[var(--border-main)] rounded-lg overflow-hidden min-h-[160px]">
            <div className="flex items-center justify-between px-2 py-1.5 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)]">
              <span className={`text-xs font-semibold ${ehHoje ? 'text-[var(--accent)]' : 'text-[var(--text-main)]'}`}>{nomes[d.getDay()]} {d.getDate()}</span>
              {ags.length > 0 && <span className="text-[11px] text-[var(--text-muted)]">{ags.length}</span>}
            </div>
            <div className="p-1.5">
              {ags.length === 0 ? (
                <div className="text-center text-[11px] text-[var(--text-muted)] py-6">livre</div>
              ) : (
                ags.map((ag) => <BlocoAgendamento key={ag.id} ag={ag} onSelecionar={onSelecionar} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ViewMes({ agendamentos, dataReferencia, onSelecionar }) {
  // Agrupa por dia
  const porDia = useMemo(() => {
    const map = {};
    agendamentos.forEach((ag) => {
      const dia = new Date(ag.data).getDate();
      if (!map[dia]) map[dia] = [];
      map[dia].push(ag);
    });
    return map;
  }, [agendamentos]);

  const totalDias = new Date(dataReferencia.getFullYear(), dataReferencia.getMonth() + 1, 0).getDate();
  const primeiroDiaSemana = new Date(dataReferencia.getFullYear(), dataReferencia.getMonth(), 1).getDay();
  const dias = [];
  for (let i = 0; i < primeiroDiaSemana; i++) dias.push(null);
  for (let i = 1; i <= totalDias; i++) dias.push(i);

  const semanas = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

  return (
    <Card padding="md">
      <div className="grid grid-cols-7 gap-px bg-[var(--border-main)] rounded-xl overflow-hidden">
        {semanas.map((s) => (
          <div key={s} className="bg-[var(--bg-subtle)] text-center py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {s}
          </div>
        ))}
        {dias.map((dia, i) => {
          const ags = dia ? (porDia[dia] || []) : [];
          const hoje = new Date();
          const ehHoje = dia &&
            hoje.getDate() === dia &&
            hoje.getMonth() === dataReferencia.getMonth() &&
            hoje.getFullYear() === dataReferencia.getFullYear();

          return (
            <div
              key={i}
              className={`bg-[var(--bg-card)] min-h-[180px] p-2.5 ${dia ? '' : 'opacity-40'}`}
            >
              {dia && (
                <>
                  <div className={`text-base font-semibold mb-2 ${ehHoje ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
                    {dia}
                  </div>
                  <div className="space-y-1.5">
                    {ags.slice(0, 4).map((ag) => {
                      const cores = coresPorStatus(ag.status);
                      const ehCancelado = ag.status === 'CANCELED';
                      const data = new Date(ag.data);
                      return (
                        <button
                          key={ag.id}
                          onClick={() => onSelecionar(ag)}
                          className={`w-full text-left px-2 py-1.5 rounded-md hover:opacity-80 transition-opacity border-l-2 ${ehCancelado ? 'line-through' : ''}`}
                          style={{
                            backgroundColor: cores.soft,
                            color: cores.text,
                            borderLeftColor: cores.solid,
                          }}
                          title={`${ag.nomeCliente}${ag.servico ? ' · ' + ag.servico : ''} · ${ag.duracao}min`}
                        >
                          <div className="flex items-center gap-1.5 text-[11px] font-bold tabular-nums opacity-90">
                            <span>{data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                            <span className="opacity-60">·</span>
                            <span>{ag.duracao}min</span>
                          </div>
                          <div className="text-xs font-semibold truncate mt-0.5">{ag.nomeCliente}</div>
                          {ag.servico && (
                            <div className="text-[11px] truncate opacity-80">{ag.servico}</div>
                          )}
                        </button>
                      );
                    })}
                    {ags.length > 4 && (
                      <div className="text-xs text-[var(--text-muted)] px-2 font-medium">+{ags.length - 4} mais</div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// Helper: retorna o preco de venda da variacao
function precoEfetivoVariacao(v) {
  if (!v) return 0;
  return v.preco || 0;
}

function formInicialAgendamento(ag) {
  if (ag) {
    const d = new Date(ag.data);
    return {
      ...ag,
      data: d.toISOString().split('T')[0],
      hora: d.toTimeString().slice(0, 5),
      preco: ag.preco || 0,
      variacaoId: '', // edição mantém o serviço já gravado; não re-liga variação
      especialistaId: ag.especialistaId || '',
      observacoes: ag.observacoes || '',
    };
  }
  const agora = new Date();
  return {
    nomeCliente: '', telefoneCliente: '',
    data: agora.toISOString().split('T')[0],
    hora: '09:00',
    duracao: 30, variacaoId: '', servico: '', preco: 0, especialistaId: '',
    observacoes: '', status: 'PENDING', origem: 'MANUAL',
  };
}

// Abre sempre com estado novo: o conteudo remonta a cada abertura (key).
function ModalAgendamento(props) {
  if (!props.isOpen) return null;
  return <ModalAgendamentoConteudo key={props.ag?.id || 'novo'} {...props} />;
}

function ModalAgendamentoConteudo({ isOpen, onClose, ag, variacoes = [], especialistas = [], onSalvar }) {
  // Agenda é orientada ao SERVIÇO: escolhe pela busca e tudo (valor, duração,
  // especialista) vem do cadastro do serviço. Sem campos livres.
  const [form, setForm] = useState(() => formInicialAgendamento(ag));

  // Só serviços entram na agenda (produtos são vendidos, não agendados).
  const servicosVariacoes = useMemo(
    () => variacoes.filter((v) => v.produto?.tipo === 'SERVICO'),
    [variacoes]
  );

  const variacaoSel = variacoes.find((v) => v.id === form.variacaoId);

  // Fase 2: pacote ativo da cliente e sinal do servico (so no agendamento novo).
  const [pre, setPre] = useState(null);
  const [usarPacote, setUsarPacote] = useState(true);
  const [cobrarSinal, setCobrarSinal] = useState(true);
  const telDigitos = (form.telefoneCliente || '').replace(/\D/g, '');
  const produtoIdSel = variacaoSel?.produto?.id || '';
  useEffect(() => {
    if (!isOpen || ag) return undefined;
    if (!produtoIdSel && telDigitos.length < 10) return undefined;
    let cancelado = false;
    const t = setTimeout(() => {
      api.get('/agenda/pre-agendamento', { params: { telefone: telDigitos.length >= 10 ? telDigitos : undefined, produtoId: produtoIdSel || undefined, preco: form.preco || 0 } })
        .then((r) => { if (!cancelado) setPre(r.data); })
        .catch(() => { if (!cancelado) setPre(null); });
    }, 350);
    return () => { cancelado = true; clearTimeout(t); };
  }, [isOpen, ag, telDigitos, produtoIdSel, form.preco]);
  const pacoteDoServico = (pre?.pacotes || []).find((p) => p.produtoId === produtoIdSel && p.livres > 0) || null;
  const outrosPacotes = (pre?.pacotes || []).filter((p) => p !== pacoteDoServico);
  const vaiUsarPacote = !!pacoteDoServico && usarPacote;
  const sinalInfo = pre?.sinal && produtoIdSel && pre.sinal.valor > 0 ? pre.sinal : null;

  // Especialistas do seletor: os do serviço escolhido; sem serviço re-selecionado
  // (edição), cai pra lista geral pra manter/trocar o profissional.
  const especialistasDoServico = variacaoSel?.produto?.especialistas || [];
  const opcoesEspecialista = especialistasDoServico.length > 0 ? especialistasDoServico : especialistas;

  // Ao escolher o serviço, tudo vem do cadastro: nome, preço, duração e os
  // especialistas. Se o serviço tem só 1 especialista, já seleciona.
  const handleSelectVariacao = (id) => {
    if (id) {
      const v = variacoes.find((x) => x.id === id);
      if (v) {
        const esps = v.produto?.especialistas || [];
        setForm((f) => ({
          ...f,
          variacaoId: id,
          servico: `${v.produto?.nome} - ${v.nome}`,
          preco: precoEfetivoVariacao(v),
          duracao: v.duracaoMin || f.duracao,
          especialistaId: esps.length === 1 ? esps[0].id : '',
        }));
      }
    } else {
      setForm((f) => ({ ...f, variacaoId: '', servico: '', preco: 0, especialistaId: '' }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.servico) {
      alert('Escolha um serviço.');
      return;
    }
    if (!form.especialistaId) {
      alert('Escolha o especialista que vai atender.');
      return;
    }
    const dataCompleta = new Date(`${form.data}T${form.hora}`);
    onSalvar({
      ...form,
      data: dataCompleta.toISOString(),
      duracao: parseInt(form.duracao) || 30,
      preco: parseFloat(form.preco) || 0,
      especialistaId: form.especialistaId || null,
      ...(ag ? {} : {
        produtoId: produtoIdSel || null,
        pacoteClienteId: vaiUsarPacote ? pacoteDoServico.id : null,
        cobrarSinal: !vaiUsarPacote && !!sinalInfo?.pagamentoConfigurado && cobrarSinal,
      }),
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={ag ? 'Editar agendamento' : 'Novo agendamento'} description={ag ? null : 'Marque um atendimento com cliente, data, hora e serviço.'} size="2xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            size="lg"
            label="Nome do cliente"
            value={form.nomeCliente}
            onChange={(e) => setForm({ ...form, nomeCliente: e.target.value })}
            required
          />
          <Input
            size="lg"
            label="Telefone"
            value={form.telefoneCliente}
            onChange={(e) => setForm({ ...form, telefoneCliente: formatarTelefoneBR(e.target.value) })}
            placeholder="(11) 99999-9999"
            maxLength={15}
            inputMode="tel"
          />
          <Input size="lg" label="Data" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} required />
          <Input size="lg" label="Hora" type="time" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} required />
        </div>

        {/* Serviço — fonte da verdade. Escolhe pela busca; valor, duração e os
            especialistas vêm do cadastro. Sem campos livres. */}
        <div className="border border-[var(--border-main)] rounded-xl p-5 space-y-4 bg-[var(--bg-subtle)]/40">
          <div className="text-base font-semibold text-[var(--text-main)]">Serviço</div>

          <Combobox
            size="lg"
            label="Buscar serviço do catálogo"
            value={form.variacaoId}
            onChange={handleSelectVariacao}
            options={servicosVariacoes.map((v) => ({
              value: v.id,
              label: `${v.produto?.nome} - ${v.nome}`,
              sublabel: [
                precoEfetivoVariacao(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                v.duracaoMin ? `${v.duracaoMin}min` : null,
              ].filter(Boolean).join(' · '),
            }))}
            placeholder={servicosVariacoes.length === 0 ? 'Nenhum serviço cadastrado' : 'Selecione um serviço'}
            clearable
          />

          {/* Resumo do serviço escolhido (valor + duração, do cadastro) */}
          {form.servico && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {!form.variacaoId && <span className="text-[var(--text-secondary)] font-medium">{form.servico}</span>}
              <span className="text-[var(--text-main)] font-semibold tabular-nums">{fmtBRL(form.preco)}</span>
              <span className="text-[var(--text-muted)]">· {form.duracao}min</span>
            </div>
          )}

          {/* Especialista — vem do serviço; obrigatório. */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Especialista que vai atender</label>
            {opcoesEspecialista.length === 0 ? (
              <div className="text-sm text-[var(--text-muted)]">Escolha um serviço para ver os especialistas.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {opcoesEspecialista.map((esp) => {
                  const sel = form.especialistaId === esp.id;
                  return (
                    <button
                      type="button"
                      key={esp.id}
                      onClick={() => setForm({ ...form, especialistaId: esp.id })}
                      className={`px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
                        sel
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                          : 'border-[var(--border-main)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                      }`}
                    >
                      {esp.nome}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Fase 2: pacote da cliente e sinal por Pix (so no agendamento novo). */}
        {!ag && (pacoteDoServico || outrosPacotes.length > 0 || sinalInfo) && (
          <div className="border border-[var(--border-main)] rounded-xl p-5 space-y-4">
            <div className="text-base font-semibold text-[var(--text-main)]">Pacote e sinal</div>
            {pacoteDoServico && (
              <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
                <input type="checkbox" className="mt-1 w-5 h-5" checked={usarPacote} onChange={(e) => setUsarPacote(e.target.checked)} />
                <span className="text-sm">
                  <span className="flex items-center gap-1.5 font-semibold text-[var(--text-main)]"><Package size={14} /> Usar o pacote {pacoteDoServico.nome}</span>
                  <span className="block text-[var(--text-secondary)]">
                    {pacoteDoServico.sessoesUsadas} de {pacoteDoServico.sessoesTotal} sessões usadas{pacoteDoServico.reservados ? `, ${pacoteDoServico.reservados} já marcada(s)` : ''}. Ao concluir, desconta 1 sessão e não cobra.
                  </span>
                </span>
              </label>
            )}
            {outrosPacotes.length > 0 && (
              <p className="text-xs text-[var(--text-muted)]">
                Tem pacote ativo: {outrosPacotes.map((p) => `${p.nome} (${p.saldo} de ${p.sessoesTotal} restantes)`).join('; ')}.
              </p>
            )}
            {sinalInfo && !vaiUsarPacote && (sinalInfo.pagamentoConfigurado ? (
              <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
                <input type="checkbox" className="mt-1 w-5 h-5" checked={cobrarSinal} onChange={(e) => setCobrarSinal(e.target.checked)} />
                <span className="text-sm">
                  <span className="flex items-center gap-1.5 font-semibold text-[var(--text-main)]"><QrCode size={14} /> Cobrar sinal por Pix</span>
                  <span className="block text-[var(--text-secondary)]">
                    {sinalInfo.pct}% do valor ({fmtBRL(sinalInfo.valor)}). A cliente recebe o Pix no WhatsApp; o horário só fica confirmado depois do pagamento e volta pra agenda se não pagar em {sinalInfo.prazoHoras} h. O sinal desconta do total ao concluir.
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">
                Este serviço pede sinal de {sinalInfo.pct}% ({fmtBRL(sinalInfo.valor)}), mas o recebimento por Pix não está configurado. O horário será marcado sem sinal. Configure em <Link to="/app/pagamentos" className="font-semibold underline">Pagamentos</Link>.
              </p>
            ))}
          </div>
        )}

        {/* Status (a duração vem do serviço e não é editada aqui). */}
        <Select
          size="lg"
          label="Status"
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
          placeholder=""
          options={Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v.label }))}
        />

        <Textarea size="lg" label="Observações" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={2} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">Cancelar</Button>
          <Button variant="primary" type="submit">{ag ? 'Salvar' : 'Criar agendamento'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DrawerAg({ isOpen, onClose, ag, onEditar, onExcluir, onStatus, onConcluir }) {
  // Historico do agendamento aberto; enquanto o carregado for de outro, mostra carregando.
  const [hist, setHist] = useState({ id: null, itens: [] });
  const agId = isOpen ? ag?.id : null;
  useEffect(() => {
    if (!agId) return undefined;
    let vivo = true;
    api.get(`/agenda/${agId}/historico`)
      .then((r) => { if (vivo) setHist({ id: agId, itens: r.data || [] }); })
      .catch(() => { if (vivo) setHist({ id: agId, itens: [] }); });
    return () => { vivo = false; };
  }, [agId]);
  const historico = hist.id === agId ? hist.itens : [];
  const carregandoHist = !!agId && hist.id !== agId;

  if (!ag) return null;
  const status = STATUS_LABELS[ag.status] || { label: ag.status, variant: 'neutral' };
  const data = new Date(ag.data);
  const travado = ehAgendamentoImutavel(ag);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={ag.servico || 'Agendamento'}
      description={ag.nomeCliente}
      size="md"
      footer={
        <div className="flex justify-between gap-2">
          <Button variant="danger-soft" icon={Trash2} onClick={onExcluir} disabled={travado}>Excluir</Button>
          <Button variant="primary" icon={Edit2} onClick={onEditar} disabled={travado}>Editar</Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Banner de aviso quando o agendamento esta travado pra preservar historico */}
        {travado && (
          <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--info-soft)] text-[var(--info-text)]">
            <Lock size={16} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <strong>Agendamento travado.</strong> Itens passados com status atualizado ficam imutaveis pra preservar o historico. Edicao e exclusao bloqueadas.
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center flex-shrink-0">
            <Calendar size={20} strokeWidth={1.75} />
          </div>
          <div className="flex-1">
            <div className="text-base font-semibold tracking-tight text-[var(--text-main)]">
              {data.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Clock size={12} className="text-[var(--text-muted)]" />
              <span className="text-sm text-[var(--text-secondary)] tabular-nums">
                {data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ({ag.duracao}min)
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={status.variant}>{status.label}</Badge>
          {ag.origem === 'AI' && <Badge variant="accent" icon={Sparkles}>Agendado pelo bot</Badge>}
          {travado && <Badge variant="info" icon={Lock}>Imutavel</Badge>}
          {ag.preco > 0 && (
            <span className="text-sm font-semibold text-[var(--text-main)] ml-auto tabular-nums">{fmtBRL(ag.preco)}</span>
          )}
        </div>

        {(ag.sinalStatus || ag.pacote) && (
          <div className="space-y-2">
            {ag.sinalStatus && (
              <div className="flex items-center gap-2 text-sm">
                <QrCode size={14} className="text-[var(--text-muted)]" />
                <span className="text-[var(--text-secondary)]">Sinal de {fmtBRL(ag.sinalValor)}</span>
                <Badge variant={{ PAGO: 'success', PENDENTE: 'warning' }[ag.sinalStatus] || 'neutral'} size="sm">
                  {{ PAGO: 'Pago', PENDENTE: `Pendente até ${ag.sinalExpiraEm ? new Date(ag.sinalExpiraEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}`, EXPIRADO: 'Não pago no prazo', CANCELADO: 'Cancelado', DEVOLVIDO: 'Devolvido' }[ag.sinalStatus] || ag.sinalStatus}
                </Badge>
              </div>
            )}
            {ag.pacote && (
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <Package size={14} className="text-[var(--text-muted)]" />
                Pacote {ag.pacote.nome}: {ag.pacote.sessoesUsadas} de {ag.pacote.sessoesTotal} sessões usadas
              </div>
            )}
          </div>
        )}

        {ag.telefoneCliente && (
          <a href={`tel:${ag.telefoneCliente}`} className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[var(--border-main)] hover:bg-[var(--bg-subtle)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-main)] transition-colors">
            <Phone size={14} /> {ag.telefoneCliente}
          </a>
        )}

        {ag.observacoes && (
          <div>
            <div className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-2">Observacoes</div>
            <div className="text-sm text-[var(--text-secondary)] leading-relaxed bg-[var(--bg-subtle)] rounded-xl p-3">{ag.observacoes}</div>
          </div>
        )}

        {/* Desfecho do atendimento — só enquanto está em aberto (PENDING/CONFIRMED)
            e não travado. "Concluir" gera a venda do serviço; "Não compareceu"
            cancela sem gerar venda (no v1; o fluxo de reembolso é fase 2). */}
        {!travado && (ag.status === 'PENDING' || ag.status === 'CONFIRMED') && (
          <div className="border border-[var(--border-main)] rounded-xl p-4 bg-[var(--bg-subtle)]/40">
            <div className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1">Desfecho do atendimento</div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mb-3">
              Concluir marca como feito e lanca a venda do servico
              {ag.pacote
                ? ' (desconta 1 sessao do pacote, sem cobrar)'
                : ag.sinalStatus === 'PAGO'
                  ? ` (${fmtBRL(Math.max(0, (ag.preco || 0) - (ag.sinalValor || 0)))}, ja descontado o sinal)`
                  : ag.preco > 0 ? ` (${fmtBRL(ag.preco)})` : ''} no caixa. "Nao compareceu" cancela sem gerar venda.
            </p>
            <div className="grid grid-cols-1 gap-2">
              <Button variant="primary" size="sm" icon={CheckCircle2} onClick={onConcluir}>
                Concluir e gerar venda
              </Button>
              <Button variant="danger-soft" size="sm" icon={XCircle} onClick={() => onStatus('CANCELED')}>
                Nao compareceu
              </Button>
            </div>
          </div>
        )}

        {/* Concluído: confirma o desfecho e a venda gerada. O controle de status
            manual fica travado (a venda já existe; reverter exige o fluxo de
            cancelamento/estorno da venda, em Vendas). */}
        {ag.status === 'COMPLETED' && (
          <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--success-soft)] text-[var(--success-text)]">
            <CheckCircle2 size={16} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <strong>Atendimento concluido.</strong> A venda do servico foi lancada no caixa. Para reverter, cancele a venda em Vendas.
            </div>
          </div>
        )}

        {/* Controle manual de status (correções administrativas). Travado quando
            o item está imutável OU já concluído (tem venda vinculada). */}
        <div>
          <div className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-2">Mudar status</div>
          <div className="grid grid-cols-3 gap-2">
            <Button variant={ag.status === 'CONFIRMED' ? 'primary' : 'secondary'} size="sm" icon={CheckCircle2} onClick={() => onStatus('CONFIRMED')} disabled={travado || ag.status === 'COMPLETED'}>Confirmar</Button>
            <Button variant={ag.status === 'PENDING' ? 'primary' : 'secondary'} size="sm" onClick={() => onStatus('PENDING')} disabled={travado || ag.status === 'COMPLETED'}>Pendente</Button>
            <Button variant={ag.status === 'CANCELED' ? 'danger' : 'secondary'} size="sm" icon={XCircle} onClick={() => onStatus('CANCELED')} disabled={travado || ag.status === 'COMPLETED'}>Cancelar</Button>
          </div>
        </div>

        {/* Historico de alteracoes — sempre visivel, ate em itens travados */}
        <HistoricoAgendamento itens={historico} carregando={carregandoHist} />
      </div>
    </Drawer>
  );
}

// =====================================================================
// HISTORICO DE ALTERACOES
// =====================================================================
// Renderiza a timeline de mudancas (CRIADO, EDITADO, STATUS_MUDADO, EXCLUIDO)
// com diff campo a campo. Usuario que fez aparece se nao for acao do bot.
function HistoricoAgendamento({ itens, carregando }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <History size={14} className="text-[var(--text-muted)]" />
        <div className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
          Historico de alteracoes
        </div>
      </div>
      {carregando ? (
        <div className="text-xs text-[var(--text-muted)] italic py-2">Carregando...</div>
      ) : itens.length === 0 ? (
        <div className="text-xs text-[var(--text-muted)] italic py-2">Sem alteracoes registradas.</div>
      ) : (
        <div className="space-y-2">
          {itens.map((h) => (
            <ItemHistorico key={h.id} item={h} />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemHistorico({ item }) {
  const data = new Date(item.criadoEm);
  const cfg = ACAO_CFG[item.acao] || { label: item.acao, cor: 'neutral' };
  const quemFez = item.usuarioNome || (item.origem === 'AI' ? 'Bot' : 'Sistema');

  return (
    <div className="border border-[var(--border-subtle)] rounded-lg p-2.5 bg-[var(--bg-card)]">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Badge variant={cfg.cor} size="sm">{cfg.label}</Badge>
          <span className="text-[11px] text-[var(--text-secondary)] font-medium">{quemFez}</span>
        </div>
        <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
          {data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}{' '}
          {data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {item.alteracoes && <DiffAlteracoes alteracoes={item.alteracoes} />}
    </div>
  );
}

const ACAO_CFG = {
  CRIADO:        { label: 'Criado',         cor: 'success' },
  EDITADO:       { label: 'Editado',        cor: 'info' },
  STATUS_MUDADO: { label: 'Mudou status',   cor: 'warning' },
  EXCLUIDO:      { label: 'Excluido',       cor: 'danger' },
};

const CAMPOS_LABEL = {
  nomeCliente: 'Nome', telefoneCliente: 'Telefone', data: 'Data/hora',
  duracao: 'Duracao', servico: 'Servico', preco: 'Preco',
  observacoes: 'Obs.', status: 'Status',
};

function fmtValor(campo, v) {
  if (v == null || v === '') return '—';
  if (campo === 'data') return new Date(v).toLocaleString('pt-BR');
  if (campo === 'preco') return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (campo === 'status') return STATUS_LABELS[v]?.label || v;
  return String(v);
}

function DiffAlteracoes({ alteracoes }) {
  // Snapshot (CRIADO/EXCLUIDO): so mostra os valores, sem de→para
  if (alteracoes.snapshot) {
    const snap = alteracoes.snapshot;
    return (
      <div className="text-[11px] text-[var(--text-secondary)] space-y-0.5 mt-1">
        {Object.entries(snap)
          .filter(([_, v]) => v != null && v !== '')
          .slice(0, 4)
          .map(([campo, v]) => (
            <div key={campo}>
              <span className="text-[var(--text-muted)]">{CAMPOS_LABEL[campo] || campo}:</span>{' '}
              <span className="font-medium">{fmtValor(campo, v)}</span>
            </div>
          ))}
      </div>
    );
  }
  // Diff (EDITADO/STATUS_MUDADO)
  return (
    <div className="text-[11px] space-y-0.5 mt-1">
      {Object.entries(alteracoes).map(([campo, { de, para }]) => (
        <div key={campo}>
          <span className="text-[var(--text-muted)]">{CAMPOS_LABEL[campo] || campo}:</span>{' '}
          <span className="text-[var(--text-secondary)] line-through opacity-70">{fmtValor(campo, de)}</span>
          {' → '}
          <span className="font-semibold text-[var(--text-main)]">{fmtValor(campo, para)}</span>
        </div>
      ))}
    </div>
  );
}
