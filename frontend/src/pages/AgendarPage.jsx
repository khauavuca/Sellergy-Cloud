import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Calendar, Clock, User, CheckCircle2, AlertCircle, Loader2, Bell, Copy } from 'lucide-react';
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

// Situacao de cada dia na faixa (vem de /publico/agenda/:slug/dias).
const COR_DIA = { livre: '#1E9E5A', poucos: '#E0A11B', lotado: '#C2410C' };
const NOME_DIA = { livre: 'livre', poucos: 'poucos horários', lotado: 'lotado', fechado: 'fechado' };
const QUALQUER = 'qualquer';

function Escolha({ ativo, onClick, children, className, disabled = false, ariaLabel }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:opacity-60',
        ativo ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)] bg-[var(--bg-card)] hover:bg-[var(--bg-subtle)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

// "Me avise se vagar": entra na fila de encaixe do negocio.
function AviseSeVagar({ slug, variacaoId, especialistaId, dia }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [soEsseDia, setSoEsseDia] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState(null);
  const [erro, setErro] = useState(null);

  if (feito) {
    return <p role="status" className="text-sm text-[var(--success-text)] bg-[var(--success-soft)] rounded-xl px-3 py-2.5">{feito}</p>;
  }
  if (!aberto) {
    return (
      <Button variant="secondary" fullWidth className="min-h-[44px]" icon={Bell} onClick={() => setAberto(true)}>
        Me avise se vagar um horário
      </Button>
    );
  }
  const enviar = async (e) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await api.post(`/publico/agenda/${slug}/fila`, { variacaoId, especialistaId, dia, soEsseDia, nome, telefone });
      setFeito(r.data.mensagem);
    } catch (err) {
      setErro(err.response?.data?.erro || 'Não foi possível entrar na fila. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <form onSubmit={enviar} className="space-y-3 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">Se alguém desmarcar, você recebe o horário no WhatsApp. Quem responder primeiro fica com ele.</p>
      {erro && <p role="alert" className="text-sm text-[var(--danger-text)]">{erro}</p>}
      <Input label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" required />
      <Input label="WhatsApp" type="tel" placeholder="(11) 98888-7777" value={telefone} onChange={(e) => setTelefone(e.target.value)} autoComplete="tel" required />
      <label className="flex items-center gap-3 min-h-[44px] text-sm text-[var(--text-main)] cursor-pointer">
        <input type="checkbox" className="w-5 h-5" checked={soEsseDia} onChange={(e) => setSoEsseDia(e.target.checked)} />
        Só neste dia (senão, qualquer dia nas próximas 2 semanas)
      </label>
      <Button type="submit" variant="primary" fullWidth size="lg" loading={enviando}>Entrar na fila</Button>
    </form>
  );
}

// Depois de agendar com sinal: QR do Pix e acompanhamento do pagamento.
function TelaSinal({ slug, confirmado }) {
  const [sinal, setSinal] = useState(confirmado.sinal);
  const [copiado, setCopiado] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const ag = confirmado.agendamento;

  useEffect(() => {
    if (sinal.status !== 'PENDENTE') return undefined;
    const t = setInterval(() => {
      setAgora(Date.now());
      api.get(`/publico/agenda/${slug}/sinal/${sinal.token}`)
        .then((r) => setSinal((s) => ({ ...s, ...r.data, qrImagem: r.data.qrImagem || s.qrImagem, token: s.token })))
        .catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [slug, sinal.status, sinal.token]);

  const restanteMs = new Date(sinal.expiraEm).getTime() - agora;
  const restante = restanteMs > 0 ? `${Math.floor(restanteMs / 3600000)} h ${Math.floor((restanteMs % 3600000) / 60000)} min` : null;
  const quando = `${new Date(ag.data).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })} às ${hora(ag.data)}`;
  const copiar = () => navigator.clipboard?.writeText(sinal.qrCode).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2500); });

  if (sinal.status === 'PAGO') {
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--bg-app)] px-4">
        <div className="text-center max-w-sm space-y-2">
          <CheckCircle2 size={40} className="mx-auto text-[var(--success)]" />
          <h1 className="text-xl font-semibold text-[var(--text-main)]">Horário garantido</h1>
          <p className="text-sm text-[var(--text-secondary)]">Recebemos {fmtBRL(sinal.valor)}. {ag.servico}, {quando}.</p>
          {sinal.restante > 0 && <p className="text-sm text-[var(--text-secondary)]">No atendimento você paga {fmtBRL(sinal.restante)}.</p>}
        </div>
      </div>
    );
  }
  if (sinal.status !== 'PENDENTE') {
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--bg-app)] px-4">
        <div className="text-center max-w-sm space-y-2">
          <AlertCircle size={36} className="mx-auto text-[var(--text-muted)]" />
          <h1 className="text-xl font-semibold text-[var(--text-main)]">O prazo do sinal acabou</h1>
          <p className="text-sm text-[var(--text-secondary)]">O horário voltou pra agenda. Se ainda quiser, é só marcar de novo.</p>
          <Button variant="primary" className="min-h-[44px]" onClick={() => window.location.reload()}>Marcar de novo</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[var(--bg-app)] px-4 py-8">
      <div className="max-w-sm mx-auto space-y-5 text-center">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-main)]">Sinal do horário</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">{ag.servico} · {quando}</p>
        </div>
        <div className="text-3xl font-bold tabular-nums text-[var(--text-main)]">{fmtBRL(sinal.valor)}</div>
        <p className="text-sm text-[var(--text-secondary)]">Desconta do total de {fmtBRL(ag.preco)}. {restante ? `Vence em ${restante}.` : 'Vencendo agora.'}</p>
        {sinal.qrImagem && <img src={sinal.qrImagem} alt="QR Code do Pix do sinal" className="mx-auto w-60 h-60 rounded-xl border border-[var(--border-main)] bg-white p-2" />}
        {sinal.qrCode && (
          <div className="space-y-2">
            <label htmlFor="pix-copia" className="sr-only">Pix copia e cola</label>
            <textarea id="pix-copia" readOnly value={sinal.qrCode} rows={3} className="w-full text-xs rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] p-2 font-mono" />
            <Button variant="primary" size="lg" fullWidth icon={Copy} onClick={copiar}>{copiado ? 'Código copiado' : 'Copiar código Pix'}</Button>
          </div>
        )}
        <p className="text-xs text-[var(--text-muted)]">Abra o app do seu banco, escolha Pix copia e cola. A confirmação chega aqui e no seu WhatsApp sozinha.</p>
        <p className="flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]" role="status"><Loader2 size={12} className="animate-spin" /> Esperando o pagamento</p>
      </div>
    </div>
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
  const [statusDias, setStatusDias] = useState({}); // { 'AAAA-MM-DD': 'livre'|'poucos'|'lotado'|'fechado' }

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

  // Situacao dos 14 dias pro servico + profissional escolhidos. Se o dia
  // escolhido estiver fechado, pula pro primeiro dia com horario.
  useEffect(() => {
    if (!variacaoId || !especialistaId) return;
    let vivo = true;
    api.get(`/publico/agenda/${slug}/dias`, { params: { variacaoId, especialistaId } })
      .then((r) => {
        if (!vivo) return;
        const mapa = Object.fromEntries((r.data.dias || []).map((d) => [d.dia, d.status]));
        setStatusDias(mapa);
        if (['fechado', 'lotado'].includes(mapa[dia])) {
          const melhor = (r.data.dias || []).find((d) => d.status === 'livre' || d.status === 'poucos');
          if (melhor && melhor.dia !== dia) { setInicio(null); setHorarios([]); setCarregandoHorarios(true); setDia(melhor.dia); }
        }
      })
      .catch(() => { if (vivo) setStatusDias({}); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- so ao trocar servico/profissional
  }, [slug, variacaoId, especialistaId]);

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
    if (confirmado.sinal) return <TelaSinal slug={slug} confirmado={confirmado} />;
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--bg-app)] px-4">
        <div className="text-center max-w-sm">
          <CheckCircle2 size={40} className="mx-auto text-[var(--success)]" />
          <h1 className="text-xl font-semibold text-[var(--text-main)] mt-3">Horário reservado</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-2">
            {confirmado.agendamento.servico} · {new Date(confirmado.agendamento.data).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })} às {hora(confirmado.agendamento.data)}
          </p>
          {confirmado.pacote && (
            <p className="text-sm text-[var(--text-secondary)] mt-2">
              Usando seu pacote {confirmado.pacote.nome}. {confirmado.pacote.restantes > 0 ? `Depois deste, sobram ${confirmado.pacote.restantes} sessão(ões).` : 'Esta é a última sessão do pacote.'}
            </p>
          )}
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
              <Escolha ativo={especialistaId === QUALQUER} onClick={() => { recomecarHorario(); setEspecialistaId(QUALQUER); }} className="flex items-center gap-2">
                <User size={14} className="text-[var(--text-muted)]" />
                <span className="text-sm font-medium text-[var(--text-main)]">Qualquer profissional</span>
              </Escolha>
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
              {dias.map((d) => {
                const st = statusDias[d.iso];
                return (
                  <Escolha
                    key={d.iso}
                    ativo={dia === d.iso}
                    disabled={st === 'fechado'}
                    ariaLabel={`${d.semana} ${d.dia}${st ? `: ${NOME_DIA[st]}` : ''}`}
                    onClick={() => { if (d.iso !== dia) { recomecarHorario(); setDia(d.iso); } }}
                    className="flex-shrink-0 w-16 text-center"
                  >
                    <span className="block text-xs text-[var(--text-muted)] capitalize">{d.semana}</span>
                    <span className={clsx('block text-sm font-semibold text-[var(--text-main)]', st === 'fechado' && 'line-through')}>{d.dia}</span>
                    <span className="block mx-auto mt-1 w-1.5 h-1.5 rounded-full" style={{ background: COR_DIA[st] || 'transparent' }} aria-hidden="true" />
                  </Escolha>
                );
              })}
            </div>
            {Object.keys(statusDias).length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]" aria-hidden="true">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: COR_DIA.livre }} />Livre</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: COR_DIA.poucos }} />Poucos horários</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: COR_DIA.lotado }} />Lotado</span>
                <span className="inline-flex items-center gap-1"><span className="line-through">12</span>Fechado</span>
              </div>
            )}
            {carregandoHorarios ? (
              <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" />
            ) : horarios.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-muted)]">
                  {statusDias[dia] === 'fechado' ? 'Fechado neste dia. Escolha outro.' : 'Sem horários livres neste dia. Tente outro.'}
                </p>
                {statusDias[dia] !== 'fechado' && <AviseSeVagar slug={slug} variacaoId={variacaoId} especialistaId={especialistaId} dia={dia} />}
              </div>
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
