import { useState, useEffect, useMemo } from 'react';
import { Plus, ChevronLeft, ChevronRight, Users, Link2, CalendarCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import {
  Button, Select, Badge, useToast, ColunasPagina, Painel, LinhaInfo,
} from '../components/ui';
import { useAuthStore } from '../store/auth.store';
import { useResumoConta } from '../components/conta/useResumoConta';
import GradeHorarios from '../components/agenda/GradeHorarios';
import PainelHorario from '../components/agenda/PainelHorario';
import ModalAgendamento from '../components/agenda/ModalAgendamento';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import {
  STATUS_LABELS, coresPorStatus, fmtBRL, fmtHora, inicioDaSemana, intervaloDaVisao,
} from '../components/agenda/agendaUtils';

const VISOES = [
  { valor: 'dia', rotulo: 'Dia' },
  { valor: 'semana', rotulo: 'Semana' },
  { valor: 'mes', rotulo: 'Mês' },
  { valor: 'lista', rotulo: 'Lista' },
];
const NOMES_DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const btnBarra = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] font-semibold text-[var(--text-main)] hover:bg-[var(--bg-subtle)] transition-colors';

export default function AgendaPage() {
  const toast = useToast();
  const [view, setView] = useState('dia');
  const [dataAtual, setDataAtual] = useState(new Date());
  const [variacoes, setVariacoes] = useState([]);
  const [especialistas, setEspecialistas] = useState([]);
  const [modal, setModal] = useState({ open: false, data: null, inicial: null });
  const [selId, setSelId] = useState(null);
  const [filtroEspecialista, setFiltroEspecialista] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  // Recarregar = mudar a versão; carregando = resultado ainda não é da chave atual.
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

  // Link público de agendamento (mesma regra do "Primeiros passos" do Início).
  const { resumo } = useResumoConta();
  const slug = resumo?.configuracoes?.slugPublico;
  const linkAgendamento = resumo?.plano?.recursos?.linkAgendamento && slug && resumo?.negocio?.segmento !== 'PRODUTO'
    ? `${window.location.origin}/agendar/${slug}`
    : null;
  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(linkAgendamento);
      toast.success('Link de agendamento copiado. Cole na bio do Instagram e no WhatsApp.');
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  };

  useEffect(() => {
    let vivo = true;
    // IMPORTANTE: a janela [inicio, fim] é calculada no fuso LOCAL do navegador
    // e vai pro backend em ISO (já em UTC). Assim o backend não precisa saber o
    // fuso do cliente (evita agendamento das 09:00 BRT aparecer no dia seguinte
    // quando o servidor roda em UTC).
    const { inicio, fim } = intervaloDaVisao(view, dataAtual);
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
    // Especialistas ativos — colunas da visão Dia, filtro e fallback do seletor
    // na edição (quando não há serviço re-selecionado).
    api.get('/especialistas')
      .then((r) => setEspecialistas((r.data || []).filter((e) => e.ativo)))
      .catch(() => setEspecialistas([]));
  }, []);

  // O horário selecionado vem sempre da lista mais recente (após recarregar,
  // mostra o status atualizado; se saiu do período, a seleção some).
  const selecionado = selId ? agendamentos.find((a) => a.id === selId) || null : null;

  const abrirNovo = (inicial = null) => setModal({ open: true, data: null, inicial });
  const fecharModal = () => setModal({ open: false, data: null, inicial: null });
  useAcaoTopo(<Button size="sm" icon={Plus} onClick={() => abrirNovo()}>Novo agendamento</Button>, []);

  const handleSalvar = async (dados) => {
    try {
      if (dados.id) {
        await api.put(`/agenda/${dados.id}`, dados);
        toast.success('Agendamento atualizado');
      } else {
        const r = await api.post('/agenda', dados);
        if (r.data?.sinal) {
          toast.success(`Agendamento criado. Sinal de ${fmtBRL(r.data.sinal.valor)} enviado por Pix; vence às ${fmtHora(r.data.sinal.expiraEm)}.`);
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
        if (r.data?.id) setSelId(r.data.id);
      }
      fecharModal();
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao salvar');
    }
  };

  const handleExcluir = async (ag) => {
    if (!confirm(`Excluir agendamento de ${ag.nomeCliente}?`)) return;
    try {
      await api.delete(`/agenda/${ag.id}`);
      toast.success('Agendamento excluído');
      setSelId(null);
      carregar();
    } catch {
      toast.error('Erro ao excluir');
    }
  };

  const handleMudarStatus = async (ag, status) => {
    try {
      await api.patch(`/agenda/${ag.id}/status`, { status });
      toast.success(`Marcado como ${STATUS_LABELS[status]?.label?.toLowerCase()}`);
      carregar();
    } catch {
      toast.error('Erro ao mudar status');
    }
  };

  // Concluir = fecha o ciclo serviço→venda. Diferente de só mudar status:
  // marca COMPLETED E lança a venda do serviço no caixa (endpoint /concluir).
  const handleConcluir = async (ag) => {
    try {
      const r = await api.patch(`/agenda/${ag.id}/concluir`, {});
      const v = r.data?.venda;
      const extras = [];
      if (r.data?.pacote) extras.push(`sessão ${r.data.pacote.sessoesUsadas} de ${r.data.pacote.sessoesTotal} do pacote`);
      if (r.data?.sinalAbatido > 0) extras.push(`sinal de ${fmtBRL(r.data.sinalAbatido)} já descontado`);
      toast.success(
        (v
          ? `Atendimento concluído · Venda #${v.numero}${v.valor > 0 ? ` (${fmtBRL(v.valor)})` : ''}`
          : 'Atendimento concluído') + (extras.length ? ` · ${extras.join(' · ')}` : '')
      );
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao concluir o atendimento');
    }
  };

  const navegar = (dir) => {
    const nova = new Date(dataAtual);
    if (view === 'dia') nova.setDate(nova.getDate() + dir);
    else if (view === 'semana' || view === 'lista') nova.setDate(nova.getDate() + dir * 7);
    else nova.setMonth(nova.getMonth() + dir);
    setDataAtual(nova);
  };

  const irHoje = () => setDataAtual(new Date());
  const abrirDia = (d) => { setDataAtual(d); setView('dia'); };

  const fmtData = (() => {
    if (view === 'dia') {
      return dataAtual.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (view === 'semana' || view === 'lista') {
      const ini = inicioDaSemana(dataAtual);
      const f = new Date(ini);
      f.setDate(ini.getDate() + 6);
      const mesmoMes = ini.getMonth() === f.getMonth();
      return mesmoMes
        ? `${ini.getDate()} a ${f.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}`
        : `${ini.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} a ${f.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`;
    }
    return dataAtual.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  })();
  const rotuloPeriodo = { dia: 'dia', semana: 'semana', lista: 'semana', mes: 'mês' }[view];

  // Status filtra no cliente — assim o resumo continua refletindo o período
  // inteiro, independente do filtro de status selecionado.
  const agendamentosFiltrados = filtroStatus
    ? agendamentos.filter((a) => a.status === filtroStatus)
    : agendamentos;
  const stats = {
    agendados: agendamentos.length,
    pendentes: agendamentos.filter((a) => a.status === 'PENDING').length,
    confirmados: agendamentos.filter((a) => a.status === 'CONFIRMED').length,
    concluidos: agendamentos.filter((a) => a.status === 'COMPLETED').length,
    cancelados: agendamentos.filter((a) => a.status === 'CANCELED').length,
    sinalPendente: agendamentos.filter((a) => a.sinalStatus === 'PENDENTE').length,
    pacote: agendamentos.filter((a) => a.pacote).length,
  };

  const especialistasVisiveis = filtroEspecialista ? especialistas.filter((e) => e.id === filtroEspecialista) : especialistas;
  const selecionar = (ag) => setSelId((atual) => (atual === ag.id ? null : ag.id));

  const lateral = (
    <>
      {selecionado ? (
        <PainelHorario
          ag={selecionado}
          onFechar={() => setSelId(null)}
          onEditar={() => setModal({ open: true, data: selecionado, inicial: null })}
          onExcluir={() => handleExcluir(selecionado)}
          onStatus={(s) => handleMudarStatus(selecionado, s)}
          onConcluir={() => handleConcluir(selecionado)}
        />
      ) : (
        <ProximosHorarios agendamentos={agendamentosFiltrados} carregando={carregando} onSelecionar={selecionar} />
      )}

      {/* Resumo do período — só contagens (faturamento é dado do Financeiro). */}
      <Painel id="resumo-periodo" titulo={`Resumo do ${rotuloPeriodo}`} semPadding>
        <LinhaInfo rotulo="Agendados" valor={carregando ? '…' : stats.agendados} forte />
        <LinhaInfo rotulo="Confirmados" valor={carregando ? '…' : stats.confirmados} />
        <LinhaInfo rotulo="Pendentes" valor={carregando ? '…' : stats.pendentes} />
        <LinhaInfo rotulo="Concluídos" valor={carregando ? '…' : stats.concluidos} />
        <LinhaInfo rotulo="Cancelados" valor={carregando ? '…' : stats.cancelados} />
        {stats.sinalPendente > 0 && <LinhaInfo rotulo="Sinal Pix pendente" valor={stats.sinalPendente} />}
        {stats.pacote > 0 && <LinhaInfo rotulo="Usando pacote" valor={stats.pacote} />}
      </Painel>
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Barra de navegação: data, visões, profissionais e ações */}
      <div className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2.5 flex flex-wrap items-center gap-2">
        <button type="button" className={`${btnBarra} w-9 px-0`} onClick={() => navegar(-1)} aria-label={`${rotuloPeriodo === 'mês' ? 'Mês anterior' : rotuloPeriodo === 'dia' ? 'Dia anterior' : 'Semana anterior'}`}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button type="button" className={btnBarra} onClick={irHoje}>Hoje</button>
        <button type="button" className={`${btnBarra} w-9 px-0`} onClick={() => navegar(1)} aria-label={`${rotuloPeriodo === 'mês' ? 'Próximo mês' : rotuloPeriodo === 'dia' ? 'Próximo dia' : 'Próxima semana'}`}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <strong className="mx-1.5 text-[15px] text-[var(--text-main)] first-letter:uppercase" aria-live="polite">{fmtData}</strong>

        <div role="group" aria-label="Visão" className="inline-flex rounded-lg border border-[var(--border-main)] overflow-hidden bg-[var(--bg-card)]">
          {VISOES.map((v) => {
            const ativa = view === v.valor;
            return (
              <button
                key={v.valor}
                type="button"
                aria-pressed={ativa}
                onClick={() => setView(v.valor)}
                className={`h-9 px-3 text-[13px] font-medium transition-colors ${ativa ? 'bg-[var(--text-main)] text-[var(--bg-card)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'}`}
              >
                {v.rotulo}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {podeFiltrarEspecialista && (
            <Select
              size="sm"
              aria-label="Filtrar por profissional"
              value={filtroEspecialista}
              onChange={(e) => setFiltroEspecialista(e.target.value)}
              placeholder="Todos os profissionais"
              options={especialistas.map((e) => ({ value: e.id, label: e.nome }))}
              fullWidth={false}
              className="w-52 rounded-lg"
            />
          )}
          <Select
            size="sm"
            aria-label="Filtrar por status"
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            placeholder="Todos os status"
            options={Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v.label }))}
            fullWidth={false}
            className="w-40 rounded-lg"
          />
          <Link to="/app/agenda/encaixe" className={btnBarra}>
            <Users size={15} aria-hidden="true" /> Fila de encaixe
          </Link>
          {linkAgendamento && (
            <button type="button" className={btnBarra} onClick={copiarLink} title={linkAgendamento}>
              <Link2 size={15} aria-hidden="true" /> Link de agendamento
            </button>
          )}
        </div>
      </div>

      <ColunasPagina lateral={lateral}>
        <section className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] min-w-0 overflow-hidden" aria-label={`Agenda: visão ${VISOES.find((v) => v.valor === view)?.rotulo}`} aria-busy={carregando}>
          {carregando ? (
            <div className="text-center py-16 text-[var(--text-muted)] text-[13px]">Carregando…</div>
          ) : view === 'dia' ? (
            <GradeHorarios
              colunas={colunasDia(agendamentosFiltrados, especialistasVisiveis, dataAtual)}
              selecionadoId={selId}
              onSelecionar={selecionar}
              onHorarioLivre={abrirNovo}
              larguraMinColuna={150}
            />
          ) : view === 'semana' ? (
            <GradeHorarios
              colunas={colunasSemana(agendamentosFiltrados, dataAtual)}
              selecionadoId={selId}
              onSelecionar={selecionar}
              onHorarioLivre={abrirNovo}
            />
          ) : view === 'mes' ? (
            <ViewMes agendamentos={agendamentosFiltrados} dataReferencia={dataAtual} selecionadoId={selId} onSelecionar={selecionar} onAbrirDia={abrirDia} />
          ) : (
            <ViewLista agendamentos={agendamentosFiltrados} selecionadoId={selId} onSelecionar={selecionar} />
          )}
        </section>
      </ColunasPagina>

      <ModalAgendamento
        isOpen={modal.open}
        onClose={fecharModal}
        ag={modal.data}
        inicial={modal.inicial}
        variacoes={variacoes}
        especialistas={especialistas}
        onSalvar={handleSalvar}
      />
    </div>
  );
}

// VISÃO DIA — uma coluna por profissional; + "Sem profissional" se houver
// agendamento sem vínculo; 1 coluna genérica se não houver especialista.
function colunasDia(agendamentos, especialistas, data) {
  const hoje = new Date(data).toDateString() === new Date().toDateString();
  const cols = especialistas.map((e) => ({
    chave: e.id, titulo: e.nome, especialistaId: e.id, data, hoje,
    agendamentos: agendamentos.filter((a) => a.especialistaId === e.id),
  }));
  const conhecidos = new Set(especialistas.map((e) => e.id));
  // Agendamentos de profissional fora da lista (ex.: inativo) também aparecem.
  const outros = agendamentos.filter((a) => a.especialistaId && !conhecidos.has(a.especialistaId));
  const porOutro = {};
  outros.forEach((a) => { (porOutro[a.especialistaId] = porOutro[a.especialistaId] || []).push(a); });
  Object.entries(porOutro).forEach(([id, ags]) => cols.push({
    chave: id, titulo: ags[0].especialista?.nome || 'Profissional', especialistaId: id, data, hoje, agendamentos: ags,
  }));
  const sem = agendamentos.filter((a) => !a.especialistaId);
  if (sem.length) cols.push({ chave: 'sem', titulo: 'Sem profissional', data, hoje, agendamentos: sem });
  if (cols.length === 0) cols.push({ chave: 'todos', titulo: 'Agendamentos', data, hoje, agendamentos });
  return cols;
}

// VISÃO SEMANA — 7 colunas (dom–sáb), mesma janela que vai pro backend.
function colunasSemana(agendamentos, dataReferencia) {
  const ini = inicioDaSemana(dataReferencia);
  const hojeStr = new Date().toDateString();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ini);
    d.setDate(ini.getDate() + i);
    const k = d.toDateString();
    return {
      chave: k,
      subtitulo: NOMES_DIA[d.getDay()],
      titulo: String(d.getDate()),
      data: d,
      hoje: k === hojeStr,
      agendamentos: agendamentos.filter((a) => new Date(a.data).toDateString() === k),
    };
  });
}

function ViewMes({ agendamentos, dataReferencia, selecionadoId, onSelecionar, onAbrirDia }) {
  const porDia = useMemo(() => {
    const map = {};
    agendamentos.forEach((ag) => {
      const dia = new Date(ag.data).getDate();
      (map[dia] = map[dia] || []).push(ag);
    });
    Object.values(map).forEach((l) => l.sort((a, b) => new Date(a.data) - new Date(b.data)));
    return map;
  }, [agendamentos]);

  const ano = dataReferencia.getFullYear();
  const mes = dataReferencia.getMonth();
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
  const dias = [];
  for (let i = 0; i < primeiroDiaSemana; i++) dias.push(null);
  for (let i = 1; i <= totalDias; i++) dias.push(i);
  while (dias.length % 7) dias.push(null);
  const hoje = new Date();

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-7 min-w-[700px]">
        {NOMES_DIA.map((s) => (
          <div key={s} className="text-center py-2 text-xs font-semibold text-[var(--text-muted)] bg-[var(--bg-subtle)] border-b border-[var(--border-main)]">
            {s}
          </div>
        ))}
        {dias.map((dia, i) => {
          const ags = dia ? (porDia[dia] || []) : [];
          const ehHoje = dia && hoje.getDate() === dia && hoje.getMonth() === mes && hoje.getFullYear() === ano;
          return (
            <div
              key={i}
              className={`min-h-[118px] p-1.5 border-b border-[var(--border-subtle)] ${i % 7 ? 'border-l' : ''} border-l-[var(--border-subtle)] ${dia ? '' : 'bg-[var(--bg-subtle)]/50'}`}
            >
              {dia && (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <button
                      type="button"
                      onClick={() => onAbrirDia(new Date(ano, mes, dia))}
                      aria-label={`Abrir o dia ${dia} na visão Dia`}
                      className={`h-6 min-w-6 px-1.5 rounded-md text-[13px] font-bold tabular-nums hover:bg-[var(--bg-subtle)] ${ehHoje ? 'bg-[var(--primary)] text-[var(--text-on-primary)] hover:bg-[var(--primary-hover)]' : 'text-[var(--text-main)]'}`}
                    >
                      {dia}
                    </button>
                    {ags.length > 0 && <span className="text-[11px] text-[var(--text-muted)] tabular-nums">{ags.length}</span>}
                  </div>
                  <div className="flex flex-col gap-1">
                    {ags.slice(0, 3).map((ag) => {
                      const cores = coresPorStatus(ag.status);
                      return (
                        <button
                          key={ag.id}
                          type="button"
                          onClick={() => onSelecionar(ag)}
                          aria-pressed={ag.id === selecionadoId}
                          className={`w-full text-left px-1.5 py-1 rounded text-[11px] truncate hover:brightness-95 ${ag.status === 'CANCELED' ? 'line-through' : ''}`}
                          style={{
                            backgroundColor: cores.soft,
                            color: cores.text,
                            borderLeft: `2px solid ${cores.solid}`,
                            boxShadow: ag.id === selecionadoId ? '0 0 0 2px var(--primary)' : 'none',
                          }}
                          title={`${ag.nomeCliente}${ag.servico ? ` · ${ag.servico}` : ''} · ${ag.duracao}min`}
                        >
                          <span className="font-bold tabular-nums">{fmtHora(ag.data)}</span> {ag.nomeCliente}
                        </button>
                      );
                    })}
                    {ags.length > 3 && (
                      <button type="button" onClick={() => onAbrirDia(new Date(ano, mes, dia))} className="text-left text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] px-1.5">
                        +{ags.length - 3} mais
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// VISÃO LISTA — os atendimentos da semana em tabela.
function ViewLista({ agendamentos, selecionadoId, onSelecionar }) {
  const ordenados = [...agendamentos].sort((a, b) => new Date(a.data) - new Date(b.data));
  if (ordenados.length === 0) {
    return <div className="text-center py-16 text-[13px] text-[var(--text-muted)]">Nenhum agendamento nesta semana.</div>;
  }
  const th = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
  const td = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <th className={th}>Quando</th>
            <th className={th}>Cliente</th>
            <th className={th}>Serviço</th>
            <th className={th}>Profissional</th>
            <th className={`${th} text-right`}>Valor</th>
            <th className={th}>Situação</th>
          </tr>
        </thead>
        <tbody>
          {ordenados.map((ag) => {
            const d = new Date(ag.data);
            const st = STATUS_LABELS[ag.status] || { label: ag.status, variant: 'neutral' };
            const sel = ag.id === selecionadoId;
            return (
              <tr key={ag.id} className={sel ? 'bg-[var(--primary-soft)]' : 'hover:bg-[var(--bg-subtle)]'}>
                <td className={`${td} whitespace-nowrap tabular-nums`}>
                  <span className="text-[var(--text-muted)]">{NOMES_DIA[d.getDay()]} {d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>{' '}
                  <strong className="text-[var(--text-main)]">{fmtHora(d)}</strong>
                </td>
                <td className={td}>
                  <button
                    type="button"
                    onClick={() => onSelecionar(ag)}
                    aria-pressed={sel}
                    className={`font-semibold text-[var(--text-main)] hover:underline text-left ${ag.status === 'CANCELED' ? 'line-through' : ''}`}
                  >
                    {ag.nomeCliente}
                  </button>
                  {ag.telefoneCliente && <div className="text-xs text-[var(--text-muted)]">{ag.telefoneCliente}</div>}
                </td>
                <td className={`${td} text-[var(--text-secondary)]`}>
                  {ag.servico || '—'}
                  {ag.pacote && <div className="text-xs text-[var(--text-muted)]">Pacote · {ag.pacote.sessoesUsadas} de {ag.pacote.sessoesTotal}</div>}
                </td>
                <td className={`${td} text-[var(--text-secondary)] whitespace-nowrap`}>{ag.especialista?.nome || '—'}</td>
                <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{ag.preco > 0 ? fmtBRL(ag.preco) : '—'}</td>
                <td className={td}>
                  <span className="flex flex-wrap gap-1">
                    <Badge variant={st.variant} size="sm">{st.label}</Badge>
                    {ag.sinalStatus === 'PENDENTE' && <Badge variant="warning" size="sm">Sinal pendente</Badge>}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Sem horário selecionado: os próximos atendimentos em aberto do período.
function ProximosHorarios({ agendamentos, carregando, onSelecionar }) {
  const agora = new Date().getTime();
  const proximos = agendamentos
    .filter((a) => (a.status === 'PENDING' || a.status === 'CONFIRMED') && new Date(a.data).getTime() + (Number(a.duracao) || 0) * 60000 >= agora)
    .sort((a, b) => new Date(a.data) - new Date(b.data))
    .slice(0, 6);
  return (
    <Painel id="proximos-horarios" titulo="Próximos horários" subtitulo="Clique num horário da agenda para ver detalhes e ações" semPadding>
      {carregando ? (
        <div className="px-4 py-3 text-xs text-[var(--text-muted)]">Carregando…</div>
      ) : proximos.length === 0 ? (
        <div className="px-4 py-6 flex flex-col items-center gap-2 text-center text-[13px] text-[var(--text-muted)]">
          <CalendarCheck size={20} aria-hidden="true" />
          Nenhum horário em aberto daqui pra frente neste período.
        </div>
      ) : (
        <ul className="m-0 p-0 list-none">
          {proximos.map((a) => {
            const d = new Date(a.data);
            const st = STATUS_LABELS[a.status];
            const ehHoje = d.toDateString() === new Date().toDateString();
            return (
              <li key={a.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                <button type="button" onClick={() => onSelecionar(a)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg-subtle)]">
                  <span className="w-12 flex-shrink-0 tabular-nums">
                    <strong className="block text-[13px] text-[var(--text-main)]">{fmtHora(d)}</strong>
                    <span className="block text-[11px] text-[var(--text-muted)]">{ehHoje ? 'hoje' : `${NOMES_DIA[d.getDay()]} ${d.getDate()}`}</span>
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-[var(--text-main)] truncate">{a.nomeCliente}</span>
                    <span className="block text-xs text-[var(--text-muted)] truncate">{[a.servico, a.especialista?.nome].filter(Boolean).join(' · ') || '—'}</span>
                  </span>
                  <Badge variant={st.variant} size="sm">{st.label}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Painel>
  );
}
