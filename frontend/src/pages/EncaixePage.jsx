// /app/agenda/encaixe — fila de encaixe (frente A da fase 2).
// Vaga em destaque, "Oferecer pra fila", status de cada pessoa, automatico
// e historico do mes. Regra no backend: src/agenda/encaixe.js.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CalendarClock, Clock, Loader2, Plus, Send, UserMinus, Users, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '../services/api';
import { Badge, Button, Card, EmptyState, Input, Select, Switch, useToast } from '../components/ui';
import Modal from '../components/Modal';
import { formatarTelefoneBR } from '../utils/formatTelefone';

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function diaTexto(d) {
  const data = new Date(d);
  const hoje = new Date();
  const amanha = new Date(); amanha.setDate(hoje.getDate() + 1);
  if (data.toDateString() === hoje.toDateString()) return 'hoje';
  if (data.toDateString() === amanha.toDateString()) return 'amanhã';
  return data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
}
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const STATUS_FILA = {
  AGUARDANDO: { label: 'Na fila', variant: 'neutral' },
  OFERTADO: { label: 'Oferta enviada', variant: 'warning' },
  AGENDADO: { label: 'Encaixada', variant: 'success' },
};
const RESPOSTA = {
  ACEITOU: { label: 'Aceitou', variant: 'success' },
  RECUSOU: { label: 'Não pode', variant: 'neutral' },
  TARDE_DEMAIS: { label: 'Chegou tarde', variant: 'neutral' },
};

function quandoTexto(f) {
  const partes = [];
  if (Array.isArray(f.diasSemana) && f.diasSemana.length) partes.push(f.diasSemana.map((d) => DIAS[d]).join(', '));
  else partes.push('qualquer dia');
  if (f.horaInicio || f.horaFim) partes.push(`${f.horaInicio || 'abertura'}–${f.horaFim || 'fechamento'}`);
  if (f.ate) partes.push(`até ${new Date(f.ate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`);
  return partes.join(' · ');
}

export default function EncaixePage() {
  const toast = useToast();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [acao, setAcao] = useState(null);
  const [modalFila, setModalFila] = useState(false);

  // Recarregar = mudar a versao (setState so nos callbacks da promessa).
  const [versao, setVersao] = useState(0);
  const carregar = useCallback(() => setVersao((v) => v + 1), []);
  useEffect(() => {
    let vivo = true;
    api.get('/encaixe')
      .then((r) => { if (vivo) { setDados(r.data); setErro(null); } })
      .catch((e) => { if (vivo) setErro(e.response?.data?.erro || 'Não foi possível carregar a fila de encaixe.'); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [versao]);

  // Enquanto tem oferta esperando resposta, atualiza sozinho.
  const temAberta = dados?.vagas?.some((v) => v.status === 'ABERTA');
  useEffect(() => {
    if (!temAberta) return undefined;
    const t = setInterval(carregar, 20000);
    return () => clearInterval(t);
  }, [temAberta, carregar]);

  const ofertar = async (vaga) => {
    setAcao(`ofertar-${vaga.id}`);
    try {
      const r = await api.post(`/encaixe/vagas/${vaga.id}/ofertar`);
      toast.success(`Oferta enviada pra ${r.data.enviados} pessoa(s). Vence às ${hora(r.data.expiraEm)}.`);
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível enviar a oferta.');
      carregar();
    } finally {
      setAcao(null);
    }
  };

  const descartar = async (vaga) => {
    if (!confirm('Não oferecer essa vaga pra fila?')) return;
    setAcao(`descartar-${vaga.id}`);
    try {
      await api.post(`/encaixe/vagas/${vaga.id}/descartar`);
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível descartar.');
    } finally {
      setAcao(null);
    }
  };

  const tirarDaFila = async (f) => {
    if (!confirm(`Tirar ${f.nome} da fila?`)) return;
    try {
      await api.patch(`/encaixe/fila/${f.id}`, { status: 'DESISTIU' });
      toast.success(`${f.nome} saiu da fila.`);
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível tirar da fila.');
    }
  };

  const mudarAutomatico = async (valor) => {
    setDados((d) => ({ ...d, automatico: valor }));
    try {
      await api.put('/agenda/config', { encaixeAutomatico: valor });
      toast.success(valor ? 'A fila recebe as vagas sozinha.' : 'Você decide quando oferecer.');
    } catch (e) {
      setDados((d) => ({ ...d, automatico: !valor }));
      toast.error(e.response?.data?.erro || 'Não foi possível salvar.');
    }
  };

  if (carregando) {
    return <div className="py-16 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;
  }
  if (erro && !dados) {
    return (
      <Card padding="lg">
        <div role="alert" className="flex items-start gap-3">
          <AlertCircle size={18} className="text-[var(--danger)] mt-0.5" />
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-main)]">{erro}</p>
            <Button variant="secondary" onClick={() => { setCarregando(true); carregar(); }}>Tentar de novo</Button>
          </div>
        </div>
      </Card>
    );
  }

  const vagas = dados.vagas || [];
  const filaAtiva = (dados.fila || []).filter((f) => f.status !== 'AGENDADO');
  const encaixadas = (dados.fila || []).filter((f) => f.status === 'AGENDADO');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/app/agenda" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-main)] min-h-[44px]">
          <ArrowLeft size={16} /> Agenda
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text-main)] flex-1">Fila de encaixe</h1>
        <Button variant="primary" icon={Plus} className="min-h-[44px]" onClick={() => setModalFila(true)}>Pôr cliente na fila</Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5 min-w-0">
          {vagas.length === 0 ? (
            <Card padding="lg">
              <EmptyState
                icon={CalendarClock}
                title="Nenhum horário vago agora"
                description="Quando alguém cancelar ou remarcar, a vaga aparece aqui com quem da fila serve pra ela."
              />
            </Card>
          ) : (
            vagas.map((v) => (
              <CardVaga key={v.id} vaga={v} acao={acao} onOfertar={() => ofertar(v)} onDescartar={() => descartar(v)} />
            ))
          )}

          <Card padding="none">
            <div className="flex flex-wrap items-center gap-2 px-5 py-4 border-b border-[var(--border-main)]">
              <h2 className="text-base font-semibold text-[var(--text-main)] flex-1">Na fila ({filaAtiva.length})</h2>
              <span className="text-xs text-[var(--text-muted)]">Ordem: quem entrou primeiro</span>
            </div>
            {filaAtiva.length === 0 ? (
              <div className="px-5 py-8 text-sm text-center text-[var(--text-muted)]">
                Ninguém esperando. Quando um horário estiver cheio, ponha a cliente na fila — ou ela mesma entra pelo link de agendamento.
              </div>
            ) : (
              <ul>
                {filaAtiva.map((f, i) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3 border-t border-[var(--border-main)] first:border-t-0">
                    <span className="w-7 text-sm font-semibold tabular-nums text-[var(--text-muted)]">{i + 1}º</span>
                    <div className="flex-1 min-w-[180px]">
                      <div className="text-sm font-semibold text-[var(--text-main)]">{f.nome}</div>
                      <div className="text-xs text-[var(--text-secondary)]">
                        {f.servico || 'Qualquer serviço'}{f.profissional ? ` com ${f.profissional}` : ''} · {quandoTexto(f)}
                      </div>
                      {f.preferencia && <div className="text-xs text-[var(--text-muted)] mt-0.5">{f.preferencia}</div>}
                    </div>
                    <Badge variant={STATUS_FILA[f.status]?.variant || 'neutral'}>{STATUS_FILA[f.status]?.label || f.status}</Badge>
                    {f.ultimaResposta === 'RECUSOU' && f.status === 'AGUARDANDO' && <span className="text-xs text-[var(--text-muted)]">recusou a última</span>}
                    <Button variant="ghost" size="sm" icon={UserMinus} className="min-h-[44px]" aria-label={`Tirar ${f.nome} da fila`} onClick={() => tirarDaFila(f)}>
                      Tirar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {encaixadas.length > 0 && (
              <div className="px-5 py-3 border-t border-[var(--border-main)] text-xs text-[var(--text-muted)]">
                Encaixadas nos últimos 7 dias: {encaixadas.map((f) => f.nome).join(', ')}
              </div>
            )}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card padding="lg">
            <h2 className="text-sm font-semibold text-[var(--text-main)] mb-3">Como a fila funciona</h2>
            <ol className="space-y-2.5 text-sm text-[var(--text-secondary)] list-decimal pl-5">
              <li>Cliente pede um horário que está cheio, pela recepção ou pelo link.</li>
              <li>Entra na fila com o serviço e os dias que pode.</li>
              <li>Quando alguém remarca ou cancela, o sistema avisa você e acha quem serve.</li>
              <li>Um toque manda a oferta no WhatsApp; o primeiro que aceitar fica.</li>
            </ol>
          </Card>

          <Card padding="lg">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--text-main)]">Oferecer sozinho, sem me perguntar</div>
                <p className="text-xs text-[var(--text-muted)] mt-1">Só para vagas com mais de 2 h de antecedência.</p>
              </div>
              <Switch checked={!!dados.automatico} onChange={mudarAutomatico} ariaLabel="Oferecer vagas pra fila sozinho" />
            </div>
          </Card>

          <Card padding="lg">
            <h2 className="text-sm font-semibold text-[var(--text-main)] mb-2">Este mês</h2>
            {dados.mes.vagas === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Nenhum horário vagou ainda este mês.</p>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">
                {dados.mes.vagas} horário(s) vago(s), {dados.mes.preenchidas} preenchido(s) pela fila.
                {dados.mes.valorRecuperado > 0 && <> <strong className="text-[var(--text-main)]">{fmtBRL(dados.mes.valorRecuperado)}</strong> que seriam perdidos.</>}
              </p>
            )}
          </Card>
        </aside>
      </div>

      <ModalFila isOpen={modalFila} onClose={() => setModalFila(false)} onSalvo={() => { setModalFila(false); carregar(); }} />
    </div>
  );
}

function CardVaga({ vaga, acao, onOfertar, onDescartar }) {
  const titulo = `Vagou ${diaTexto(vaga.data)} às ${hora(vaga.data)}${vaga.profissional ? ` com ${vaga.profissional}` : ''} (${vaga.duracao} min)`;

  if (vaga.status === 'PREENCHIDA') {
    return (
      <Card padding="lg" className="border-[var(--success)]">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={20} className="text-[var(--success)] mt-0.5 flex-shrink-0" />
          <div className="flex-1 space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--success-text)]">Horário preenchido</div>
            <div className="text-base font-semibold text-[var(--text-main)]">
              {vaga.novoAgendamento?.nome || 'Uma cliente da fila'} ficou com {diaTexto(vaga.data)} às {hora(vaga.data)}{vaga.servico ? `, ${vaga.servico}` : ''}
            </div>
            <p className="text-sm text-[var(--text-secondary)]">Já está confirmada na agenda. Quem também recebeu a oferta foi avisado que continua na fila.</p>
            <Link to="/app/agenda" className="inline-flex items-center min-h-[44px] text-sm font-semibold text-[var(--primary)] hover:underline">Ver na agenda</Link>
          </div>
        </div>
      </Card>
    );
  }

  if (vaga.status === 'ABERTA') {
    return (
      <Card padding="lg" className="border-[var(--warning)]">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--warning-text)]">
            <Clock size={14} /> Esperando resposta
          </div>
          <div className="text-base font-semibold text-[var(--text-main)]">{titulo}</div>
          <p className="text-sm text-[var(--text-secondary)]">
            Oferta enviada{vaga.automatica ? ' sozinha' : ''} pra {vaga.envios.length} pessoa(s). Quem tocar em “Quero” primeiro fica com o horário. A oferta vence às {hora(vaga.expiraEm)}.
          </p>
          <ul className="divide-y divide-[var(--border-main)] border border-[var(--border-main)] rounded-xl">
            {vaga.envios.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex-1 text-sm text-[var(--text-main)]">{e.nome}</span>
                {e.resposta ? <Badge variant={RESPOSTA[e.resposta]?.variant}>{RESPOSTA[e.resposta]?.label}</Badge> : <Badge variant="warning">Sem resposta</Badge>}
              </li>
            ))}
          </ul>
        </div>
      </Card>
    );
  }

  // VAGA ou EXPIRADA (ninguem aceitou a tempo)
  const n = vaga.candidatos.total;
  return (
    <Card padding="lg" className="border-[var(--primary)]">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          <CalendarClock size={14} /> {vaga.status === 'EXPIRADA' ? 'Ninguém aceitou a tempo' : 'Horário vago'}
        </div>
        <div className="text-base font-semibold text-[var(--text-main)]">{titulo}</div>
        <p className="text-sm text-[var(--text-secondary)]">
          {vaga.origem ? `${vaga.origem.nome} liberou esse horário${vaga.servico ? ` (${vaga.servico})` : ''}. ` : ''}
          {n === 0
            ? (vaga.envios.length ? 'Todas as pessoas que servem já receberam a oferta.' : 'Ninguém da fila serve pra esse horário agora.')
            : `${n} pessoa(s) da fila ${n === 1 ? 'serve' : 'servem'} pra esse horário${vaga.candidatos.primeiros.length ? `: ${vaga.candidatos.primeiros.join(', ')}${n > 3 ? '…' : ''}` : ''}.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={Send} className="min-h-[44px]" disabled={n === 0} loading={acao === `ofertar-${vaga.id}`} onClick={onOfertar}>
            Oferecer pra fila{n > 0 ? ` (${Math.min(n, 3)})` : ''}
          </Button>
          <Button variant="ghost" className="min-h-[44px]" loading={acao === `descartar-${vaga.id}`} onClick={onDescartar}>Não oferecer</Button>
        </div>
      </div>
    </Card>
  );
}

const FORM_VAZIO = { nome: '', telefone: '', produtoId: '', especialistaId: '', diasSemana: [], horaInicio: '', horaFim: '', ate: '', preferencia: '' };

// Abre sempre com o formulario limpo: o conteudo so existe com o modal aberto.
function ModalFila(props) {
  if (!props.isOpen) return null;
  return <ModalFilaConteudo {...props} />;
}

function ModalFilaConteudo({ isOpen, onClose, onSalvo }) {
  const toast = useToast();
  const [form, setForm] = useState(FORM_VAZIO);
  const [servicos, setServicos] = useState([]);
  const [especialistas, setEspecialistas] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState([]);

  useEffect(() => {
    api.get('/catalogo').then((r) => setServicos((r.data || []).filter((p) => p.tipo === 'SERVICO'))).catch(() => setServicos([]));
    api.get('/especialistas').then((r) => setEspecialistas((r.data || []).filter((e) => e.ativo))).catch(() => setEspecialistas([]));
  }, []);

  const alternarDia = (d) => setForm((f) => ({ ...f, diasSemana: f.diasSemana.includes(d) ? f.diasSemana.filter((x) => x !== d) : [...f.diasSemana, d] }));

  const salvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    setErros([]);
    try {
      await api.post('/encaixe/fila', {
        ...form,
        produtoId: form.produtoId || null, especialistaId: form.especialistaId || null,
        horaInicio: form.horaInicio || null, horaFim: form.horaFim || null, ate: form.ate || null,
        diasSemana: form.diasSemana.length ? form.diasSemana : null,
      });
      toast.success(`${form.nome} entrou na fila.`);
      onSalvo();
    } catch (err) {
      setErros(err.response?.data?.campos || []);
      toast.error(err.response?.data?.erro || 'Não foi possível pôr na fila.');
    } finally {
      setSalvando(false);
    }
  };

  const servicoSel = servicos.find((s) => s.id === form.produtoId);
  const profs = servicoSel?.especialistas?.length ? servicoSel.especialistas : especialistas;
  const erro = (c) => (erros.includes(c) ? 'Confira este campo' : undefined);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pôr cliente na fila" description="Quando vagar um horário que serve pra ela, o sistema avisa." size="lg">
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} error={erro('nome')} required />
          <Input label="WhatsApp" inputMode="tel" placeholder="(11) 98888-7777" maxLength={15} value={form.telefone} onChange={(e) => setForm({ ...form, telefone: formatarTelefoneBR(e.target.value) })} error={erro('telefone')} required />
          <Select label="Serviço" value={form.produtoId} onChange={(e) => setForm({ ...form, produtoId: e.target.value, especialistaId: '' })} placeholder="Qualquer serviço" options={servicos.map((s) => ({ value: s.id, label: s.nome }))} />
          <Select label="Com quem" value={form.especialistaId} onChange={(e) => setForm({ ...form, especialistaId: e.target.value })} placeholder="Qualquer profissional" options={profs.map((p) => ({ value: p.id, label: p.nome }))} />
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-[var(--text-secondary)] mb-2">Dias que pode (nenhum marcado = qualquer dia)</legend>
          <div className="flex flex-wrap gap-2">
            {DIAS.map((d, i) => (
              <button
                key={d} type="button" aria-pressed={form.diasSemana.includes(i)} onClick={() => alternarDia(i)}
                className={`min-h-[44px] min-w-[52px] px-3 rounded-full border text-sm font-medium capitalize ${form.diasSemana.includes(i) ? 'bg-[var(--primary)] text-[var(--text-on-primary)] border-[var(--primary)]' : 'border-[var(--border-strong)] text-[var(--text-secondary)]'}`}
              >{d}</button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="A partir de" type="time" value={form.horaInicio} onChange={(e) => setForm({ ...form, horaInicio: e.target.value })} error={erro('horaInicio')} />
          <Input label="Até" type="time" value={form.horaFim} onChange={(e) => setForm({ ...form, horaFim: e.target.value })} error={erro('horaFim')} />
          <Input label="Vale até o dia" type="date" value={form.ate} onChange={(e) => setForm({ ...form, ate: e.target.value })} error={erro('ate')} hint="Vazio = sem prazo" />
        </div>
        <Input label="Observação" placeholder="Ex.: prefere depois do almoço" value={form.preferencia} onChange={(e) => setForm({ ...form, preferencia: e.target.value })} maxLength={200} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" className="min-h-[44px]" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" icon={Users} className="min-h-[44px]" loading={salvando}>Pôr na fila</Button>
        </div>
      </form>
    </Modal>
  );
}
