import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Calendar, Clock, User, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { Button, Input } from '../components/ui';

// Pagina PUBLICA (sem login): o cliente final escolhe servico, profissional,
// dia e horario, e agenda com nome + WhatsApp. Endereco: /agendar/<slug>.

const DIAS_VISIVEIS = 14;
const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const isoDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function proximosDias() {
  const hoje = new Date();
  return Array.from({ length: DIAS_VISIVEIS }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + i);
    return {
      iso: isoDia(d),
      semana: i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
      dia: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    };
  });
}

function Escolha({ ativo, onClick, children, className }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={clsx(
        'rounded-xl border px-3 py-2.5 text-left transition-colors',
        ativo ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)] bg-[var(--bg-card)] hover:bg-[var(--bg-subtle)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

function Etapa({ numero, titulo, children }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--text-main)]">
        <span className="text-[var(--text-muted)] mr-1.5">{numero}.</span>{titulo}
      </h2>
      {children}
    </section>
  );
}

export default function AgendarPage() {
  const { slug } = useParams();
  const dias = useMemo(() => proximosDias(), []);
  const [carregando, setCarregando] = useState(true);
  const [indisponivel, setIndisponivel] = useState(false);
  const [dados, setDados] = useState(null);
  const [variacaoId, setVariacaoId] = useState(null);
  const [especialistaId, setEspecialistaId] = useState(null);
  const [dia, setDia] = useState(dias[0].iso);
  const [horarios, setHorarios] = useState([]);
  const [carregandoHorarios, setCarregandoHorarios] = useState(false);
  const [inicio, setInicio] = useState(null);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [confirmado, setConfirmado] = useState(null);

  useEffect(() => {
    api.get(`/publico/agenda/${slug}`)
      .then((r) => setDados(r.data))
      .catch(() => setIndisponivel(true))
      .finally(() => setCarregando(false));
  }, [slug]);

  const servicoDaVariacao = dados?.servicos.find((s) => s.variacoes.some((v) => v.id === variacaoId)) || null;
  const variacao = servicoDaVariacao?.variacoes.find((v) => v.id === variacaoId) || null;

  // Mudou servico/profissional/dia: zera o horario escolhido e mostra o
  // carregando (nos handlers, pra nao fazer setState sincrono no efeito).
  const recomecarHorario = () => { setInicio(null); setHorarios([]); setCarregandoHorarios(true); };

  useEffect(() => {
    if (!variacaoId || !especialistaId || !dia) return;
    api.get(`/publico/agenda/${slug}/horarios`, { params: { variacaoId, especialistaId, data: dia } })
      .then((r) => setHorarios(r.data.horarios || []))
      .catch(() => setHorarios([]))
      .finally(() => setCarregandoHorarios(false));
  }, [slug, variacaoId, especialistaId, dia]);

  const escolherVariacao = (servico, v) => {
    recomecarHorario();
    setVariacaoId(v.id);
    setEspecialistaId(servico.profissionais.length === 1 ? servico.profissionais[0].id : null);
  };

  const agendar = async (e) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await api.post(`/publico/agenda/${slug}/agendamentos`, { variacaoId, especialistaId, inicio, nome, telefone });
      setConfirmado(r.data);
    } catch (err) {
      setErro(err.response?.data?.erro || 'Não foi possível agendar. Tente de novo.');
      if (err.response?.data?.codigo === 'HORARIO_OCUPADO') {
        setHorarios((hs) => hs.filter((h) => h.inicio !== inicio));
        setInicio(null);
      }
    } finally {
      setEnviando(false);
    }
  };

  if (carregando) {
    return <div className="min-h-screen grid place-items-center bg-[var(--bg-app)]"><Loader2 className="animate-spin text-[var(--text-muted)]" /></div>;
  }

  if (indisponivel || !dados) {
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--bg-app)] px-4">
        <div className="text-center max-w-sm">
          <Calendar className="mx-auto text-[var(--text-muted)]" />
          <h1 className="text-lg font-semibold text-[var(--text-main)] mt-3">Agenda online indisponível</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Fale com o estabelecimento pelo WhatsApp para marcar seu horário.</p>
        </div>
      </div>
    );
  }

  if (confirmado) {
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--bg-app)] px-4">
        <div className="text-center max-w-sm">
          <CheckCircle2 size={40} className="mx-auto text-[var(--success)]" />
          <h1 className="text-xl font-semibold text-[var(--text-main)] mt-3">Horário reservado</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-2">
            {confirmado.agendamento.servico} · {new Date(confirmado.agendamento.data).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })} às {hora(confirmado.agendamento.data)}
          </p>
          <p className="text-sm text-[var(--text-muted)] mt-3">{confirmado.mensagem}</p>
        </div>
      </div>
    );
  }

  const servico = servicoDaVariacao;

  return (
    <div className="min-h-screen bg-[var(--bg-app)]">
      <div className="max-w-xl mx-auto px-4 py-8 space-y-8">
        <header className="flex items-center gap-3">
          {dados.negocio.logo && <img src={dados.negocio.logo} alt="" className="w-11 h-11 rounded-xl object-cover" />}
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-main)]">{dados.negocio.nome}</h1>
            <p className="text-sm text-[var(--text-muted)]">Agende seu horário</p>
          </div>
        </header>

        {dados.servicos.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">Nenhum serviço disponível para agendamento online no momento.</p>
        )}

        {dados.servicos.length > 0 && (
          <Etapa numero={1} titulo="Escolha o serviço">
            <div className="grid gap-2">
              {dados.servicos.flatMap((s) => s.variacoes.map((v) => (
                <Escolha key={v.id} ativo={variacaoId === v.id} onClick={() => escolherVariacao(s, v)} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold text-[var(--text-main)]">{s.nome}{s.variacoes.length > 1 ? ` · ${v.nome}` : ''}</span>
                    <span className="flex items-center gap-1 text-xs text-[var(--text-muted)] mt-0.5"><Clock size={12} />{v.duracaoMin} min</span>
                  </span>
                  <span className="text-sm font-semibold text-[var(--text-main)] tabular-nums">{fmtBRL(v.preco)}</span>
                </Escolha>
              )))}
            </div>
          </Etapa>
        )}

        {servico && servico.profissionais.length > 1 && (
          <Etapa numero={2} titulo="Com quem?">
            <div className="flex flex-wrap gap-2">
              {servico.profissionais.map((p) => (
                <Escolha key={p.id} ativo={especialistaId === p.id} onClick={() => { recomecarHorario(); setEspecialistaId(p.id); }} className="flex items-center gap-2">
                  <User size={14} className="text-[var(--text-muted)]" />
                  <span className="text-sm font-medium text-[var(--text-main)]">{p.nome}</span>
                </Escolha>
              ))}
            </div>
          </Etapa>
        )}

        {variacao && especialistaId && (
          <Etapa numero={servico.profissionais.length > 1 ? 3 : 2} titulo="Dia e horário">
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {dias.map((d) => (
                <Escolha key={d.iso} ativo={dia === d.iso} onClick={() => { if (d.iso !== dia) { recomecarHorario(); setDia(d.iso); } }} className="flex-shrink-0 w-16 text-center">
                  <span className="block text-xs text-[var(--text-muted)] capitalize">{d.semana}</span>
                  <span className="block text-sm font-semibold text-[var(--text-main)]">{d.dia}</span>
                </Escolha>
              ))}
            </div>
            {carregandoHorarios ? (
              <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" />
            ) : horarios.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Sem horários livres neste dia. Tente outro.</p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {horarios.map((h) => (
                  <Escolha key={h.inicio} ativo={inicio === h.inicio} onClick={() => setInicio(h.inicio)} className="text-center">
                    <span className="text-sm font-semibold text-[var(--text-main)] tabular-nums">{hora(h.inicio)}</span>
                  </Escolha>
                ))}
              </div>
            )}
          </Etapa>
        )}

        {inicio && (
          <form onSubmit={agendar} className="space-y-4 border-t border-[var(--border-main)] pt-6">
            <h2 className="text-sm font-semibold text-[var(--text-main)]">Seus dados</h2>
            {erro && (
              <div role="alert" className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[var(--danger-soft)]">
                <AlertCircle size={16} className="text-[var(--danger)] mt-0.5" />
                <p className="text-sm text-[var(--danger-text)]">{erro}</p>
              </div>
            )}
            <Input label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" required />
            <Input label="WhatsApp" type="tel" placeholder="(11) 98888-7777" value={telefone} onChange={(e) => setTelefone(e.target.value)} autoComplete="tel" hint="Você recebe o lembrete do horário por aqui." required />
            <Button type="submit" variant="primary" size="lg" fullWidth loading={enviando}>
              Confirmar {hora(inicio)}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
