// /app/agenda/encaixe — fila de encaixe (frente A da fase 2).
// Layout: numeros no topo, horarios que vagaram + fila em tabela e, na
// lateral, oferta automatica, resultado do mes e como funciona.
// Regra no backend: src/agenda/encaixe.js.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CalendarClock, CalendarDays, Clock, Loader2, Plus, Send, Users, X } from 'lucide-react';
import api from '../services/api';
import {
  Badge, Button, EmptyState, Input, Select, Switch, useToast,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, BarraFerramentas,
} from '../components/ui';
import Modal from '../components/Modal';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
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

// Dias e horarios que a pessoa pode (a validade vai em coluna propria).
function diasHorarios(f) {
  const partes = [];
  if (Array.isArray(f.diasSemana) && f.diasSemana.length) partes.push(f.diasSemana.map((d) => DIAS[d]).join(', '));
  else partes.push('Qualquer dia');
  if (f.horaInicio || f.horaFim) partes.push(`${f.horaInicio || 'abertura'}–${f.horaFim || 'fechamento'}`);
  return partes.join(' · ');
}

// Rotulo curto do dia pra caixinha de horario: "Hoje", "Amanhã" ou "qua 26/11".
function diaCurto(d) {
  const t = diaTexto(d);
  if (t === 'hoje') return 'Hoje';
  if (t === 'amanhã') return 'Amanhã';
  const data = new Date(d);
  return `${DIAS[data.getDay()]} ${data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}

function iniciais(nome = '') {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}

// "hoje", "ontem", "3 dias", "2 semanas"
function haQuanto(d) {
  if (!d) return '—';
  const dias = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 14) return `${dias} dias`;
  return `${Math.floor(dias / 7)} semanas`;
}

// Telefone guardado so com digitos (pode vir com 55 na frente).
function telefoneTela(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return formatarTelefoneBR(d) || '—';
}

// competencia "YYYY-MM" -> "novembro"
function nomeMes(competencia) {
  if (!competencia) return 'este mês';
  const [a, m] = competencia.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
}

export default function EncaixePage() {
  const toast = useToast();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [acao, setAcao] = useState(null);
  const [modalFila, setModalFila] = useState(false);
  const [filtroServico, setFiltroServico] = useState('');
  const [filtroProf, setFiltroProf] = useState('');
  const carregou = !!dados;
  useAcaoTopo(
    carregou ? <Button size="sm" icon={Plus} onClick={() => setModalFila(true)}>Pôr cliente na fila</Button> : null,
    [carregou]
  );

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
      <Painel>
        <div role="alert" className="flex items-start gap-3">
          <AlertCircle size={18} className="text-[var(--danger)] mt-0.5" aria-hidden="true" />
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-main)]">{erro}</p>
            <Button variant="secondary" size="sm" onClick={() => { setCarregando(true); carregar(); }}>Tentar de novo</Button>
          </div>
        </div>
      </Painel>
    );
  }

  const vagas = dados.vagas || [];
  const filaAtiva = (dados.fila || []).filter((f) => f.status !== 'AGENDADO');
  const encaixadas = (dados.fila || []).filter((f) => f.status === 'AGENDADO');
  const mes = dados.mes || { vagas: 0, ofertadas: 0, preenchidas: 0, valorRecuperado: 0 };

  // Numeros do topo: tudo do que o GET /encaixe ja devolve.
  const vagasAbertas = vagas.filter((v) => v.status !== 'PREENCHIDA');
  const vagasHoje = vagasAbertas.filter((v) => diaTexto(v.data) === 'hoje').length;
  const esperandoVoce = vagas.filter((v) => v.status === 'VAGA' || v.status === 'EXPIRADA').length;
  const comOferta = filaAtiva.filter((f) => f.status === 'OFERTADO').length;

  // Filtros da tabela (opcoes saem da propria fila). A posicao e a da fila inteira.
  const posicao = new Map(filaAtiva.map((f, i) => [f.id, i + 1]));
  const servicosFila = [...new Set(filaAtiva.map((f) => f.servico || SEM_SERVICO))];
  const profsFila = [...new Set(filaAtiva.map((f) => f.profissional || SEM_PROF))];
  const filaVisivel = filaAtiva.filter((f) =>
    (!filtroServico || (f.servico || SEM_SERVICO) === filtroServico)
    && (!filtroProf || (f.profissional || SEM_PROF) === filtroProf));

  return (
    <Pagina>
      <FaixaNumeros>
        <Numero
          rotulo="Na fila"
          valor={filaAtiva.length}
          detalhe={comOferta ? `${comOferta} com oferta enviada` : 'esperando vaga'}
        />
        <Numero
          rotulo="Vagas abertas"
          valor={vagasAbertas.length}
          tom={esperandoVoce ? 'alerta' : 'neutro'}
          detalhe={esperandoVoce ? `${esperandoVoce} esperando você oferecer` : `${vagasHoje} hoje`}
          tomDetalhe={esperandoVoce ? 'alerta' : 'neutro'}
        />
        <Numero
          rotulo="Preenchidas no mês"
          valor={`${mes.preenchidas} de ${mes.vagas}`}
          progresso={mes.vagas ? (mes.preenchidas / mes.vagas) * 100 : 0}
        />
        <Numero
          rotulo="Recuperado no mês"
          valor={fmtBRL(mes.valorRecuperado)}
          detalhe="que seriam perdidos"
          destaque
        />
      </FaixaNumeros>

      <ColunasPagina
        lateral={
          <>
            <Painel
              titulo="Oferta automática"
              acoes={<Badge variant={dados.automatico ? 'success' : 'neutral'}>{dados.automatico ? 'Ligada' : 'Desligada'}</Badge>}
              semPadding
            >
              <div className="flex items-start gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[var(--text-main)]">Oferecer sozinho, sem me perguntar</div>
                  <p className="m-0 mt-0.5 text-xs text-[var(--text-muted)]">Só para vagas com mais de 2 h de antecedência. A oferta vence em 30 min.</p>
                </div>
                <Switch checked={!!dados.automatico} onChange={mudarAutomatico} ariaLabel="Oferecer vagas pra fila sozinho" />
              </div>
              <LinhaInfo rotulo="Mandar pra quantas por vez" valor="até 3 pessoas" />
              <LinhaInfo rotulo="Ninguém respondeu a tempo" valor="avisa você" />
            </Painel>

            <Painel titulo="Resultado do mês" acoes={<span className="text-xs text-[var(--text-muted)]">{nomeMes(mes.competencia)}</span>} semPadding>
              {mes.vagas === 0 ? (
                <p className="m-0 px-4 py-3 text-[13px] text-[var(--text-muted)]">Nenhum horário vagou ainda este mês.</p>
              ) : (
                <div className="flex flex-col gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
                  <BarraResultado rotulo="Preenchidas pela fila" valor={mes.preenchidas} total={mes.vagas} />
                  <BarraResultado rotulo="Ainda esperando oferta" valor={Math.max(0, mes.vagas - mes.ofertadas)} total={mes.vagas} />
                </div>
              )}
              <LinhaInfo rotulo="Horários que vagaram" valor={mes.vagas} />
              <LinhaInfo rotulo="Que seriam perdidos" valor={fmtBRL(mes.valorRecuperado)} forte />
            </Painel>

            <Painel titulo="Como funciona" semPadding>
              <ol className="m-0 list-none flex flex-col gap-2.5 px-4 pt-3 pb-3.5 text-[13px] text-[var(--text-secondary)]">
                {PASSOS.map((p, i) => (
                  <li key={p} className="flex items-start gap-2.5 leading-snug">
                    <span aria-hidden="true" className="grid place-items-center w-[22px] h-[22px] rounded-full flex-shrink-0 bg-[var(--primary-soft)] text-[var(--text-main)] text-xs font-bold">{i + 1}</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ol>
            </Painel>
          </>
        }
      >
        <Painel
          titulo="Horários que vagaram"
          subtitulo="Próximos horários liberados e os preenchidos nos últimos 2 dias"
          acoes={
            <Link to="/app/agenda" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--primary)] hover:underline">
              <CalendarDays size={14} aria-hidden="true" /> Abrir agenda
            </Link>
          }
          semPadding
        >
          {vagas.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nenhum horário vago agora"
              description="Quando alguém cancelar ou remarcar, a vaga aparece aqui com quem da fila serve pra ela."
            />
          ) : (
            <ul className="m-0 p-0 list-none">
              {vagas.map((v) => (
                <LinhaVaga key={v.id} vaga={v} acao={acao} onOfertar={() => ofertar(v)} onDescartar={() => descartar(v)} />
              ))}
            </ul>
          )}
        </Painel>

        <Painel
          titulo={`Fila de espera (${filaAtiva.length})`}
          subtitulo="Ordem: quem entrou primeiro"
          semPadding
        >
          {filaAtiva.length > 0 && (
            <BarraFerramentas>
              <FiltroSelect rotulo="Serviço" valor={filtroServico} onChange={setFiltroServico} opcoes={servicosFila} vazio="Todos" />
              <FiltroSelect rotulo="Profissional" valor={filtroProf} onChange={setFiltroProf} opcoes={profsFila} vazio="Todos" />
              {(filtroServico || filtroProf) && (
                <Button variant="ghost" size="sm" onClick={() => { setFiltroServico(''); setFiltroProf(''); }}>Limpar filtros</Button>
              )}
            </BarraFerramentas>
          )}
          {filaAtiva.length === 0 ? (
            <div className="px-4 py-8 text-[13px] text-center text-[var(--text-muted)]">
              Ninguém esperando. Quando um horário estiver cheio, ponha a cliente na fila — ou ela mesma entra pelo link de agendamento.
            </div>
          ) : filaVisivel.length === 0 ? (
            <div className="px-4 py-8 text-[13px] text-center text-[var(--text-muted)]">Ninguém na fila com esses filtros.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    {['#', 'Cliente', 'Quer', 'Com quem', 'Dias e horários', 'Vale até', 'Na fila há', 'Situação'].map((h) => (
                      <th key={h} scope="col" className={TH}>{h}</th>
                    ))}
                    <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filaVisivel.map((f) => (
                    <tr key={f.id} className="align-middle">
                      <td className={`${TD} tabular-nums font-semibold text-[var(--text-muted)]`}>{posicao.get(f.id)}º</td>
                      <td className={TD}>
                        <div className="flex items-center gap-2.5 min-w-[180px]">
                          <span aria-hidden="true" className="grid place-items-center w-[30px] h-[30px] rounded-full flex-shrink-0 bg-[var(--primary-soft)] text-[var(--text-main)] text-[11px] font-bold">{iniciais(f.nome)}</span>
                          <div className="min-w-0">
                            <div className="font-semibold text-[var(--text-main)]">{f.nome}</div>
                            <div className="text-xs text-[var(--text-muted)] whitespace-nowrap">{telefoneTela(f.telefone)}</div>
                          </div>
                        </div>
                      </td>
                      <td className={TD}>
                        <div className="text-[var(--text-main)]">{f.servico || SEM_SERVICO}</div>
                        {f.preferencia && <div className="text-xs text-[var(--text-muted)] max-w-[220px] [overflow-wrap:anywhere]">{f.preferencia}</div>}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>{f.profissional || SEM_PROF}</td>
                      <td className={TD}>{diasHorarios(f)}</td>
                      <td className={`${TD} whitespace-nowrap tabular-nums`}>{f.ate ? new Date(f.ate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : 'sem prazo'}</td>
                      <td className={`${TD} whitespace-nowrap`}>{haQuanto(f.criadoEm)}</td>
                      <td className={TD}>
                        <div className="flex flex-col items-start gap-0.5">
                          <Badge variant={STATUS_FILA[f.status]?.variant || 'neutral'}>{STATUS_FILA[f.status]?.label || f.status}</Badge>
                          {f.ultimaResposta === 'RECUSOU' && f.status === 'AGUARDANDO' && <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">recusou a última</span>}
                        </div>
                      </td>
                      <td className={`${TD} text-right`}>
                        <button
                          type="button"
                          onClick={() => tirarDaFila(f)}
                          aria-label={`Tirar ${f.nome} da fila`}
                          title="Tirar da fila"
                          className="inline-grid place-items-center w-9 h-9 rounded-lg border border-[var(--border-main)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)]"
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {encaixadas.length > 0 && (
            <div className="px-4 py-2.5 border-t border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
              Encaixadas nos últimos 7 dias: {encaixadas.map((f) => f.nome).join(', ')}
            </div>
          )}
        </Painel>
      </ColunasPagina>

      <ModalFila isOpen={modalFila} onClose={() => setModalFila(false)} onSalvo={() => { setModalFila(false); carregar(); }} />
    </Pagina>
  );
}

const TH = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const TD = 'px-4 py-2.5 border-b border-[var(--border-subtle)] text-[var(--text-secondary)]';
const SEM_SERVICO = 'Qualquer serviço';
const SEM_PROF = 'Qualquer profissional';
const PASSOS = [
  'Cliente pede um horário que está cheio, pela recepção ou pelo link.',
  'Entra na fila com o serviço e os dias que pode.',
  'Quando alguém remarca ou cancela, o sistema avisa e acha quem serve.',
  'A oferta vai no WhatsApp; a primeira que tocar em “Quero” fica.',
];

function FiltroSelect({ rotulo, valor, onChange, opcoes, vazio }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
      {rotulo}
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 px-2.5 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[13px] font-medium text-[var(--text-main)] focus:outline-none focus:border-[var(--primary)]"
      >
        <option value="">{vazio}</option>
        {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function BarraResultado({ rotulo, valor, total }) {
  const pct = total ? Math.round((valor / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-[13px] text-[var(--text-secondary)]">
        <span>{rotulo}</span>
        <strong className="text-[var(--text-main)] tabular-nums">{valor}</strong>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--bg-subtle)] mt-1.5" aria-hidden="true">
        <div className="h-1.5 rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const SITUACAO_VAGA = {
  VAGA: { label: 'Horário vago', variant: 'danger' },
  EXPIRADA: { label: 'Ninguém aceitou a tempo', variant: 'neutral' },
  ABERTA: { label: 'Esperando resposta', variant: 'warning' },
  PREENCHIDA: { label: 'Preenchido', variant: 'success' },
};

function LinhaVaga({ vaga, acao, onOfertar, onDescartar }) {
  const sit = SITUACAO_VAGA[vaga.status] || SITUACAO_VAGA.VAGA;
  const cabecalho = [vaga.servico || 'Horário', vaga.profissional, `${vaga.duracao} min`].filter(Boolean).join(' · ');
  const n = vaga.candidatos?.total || 0;
  const podeOferecer = vaga.status === 'VAGA' || vaga.status === 'EXPIRADA';

  let motivo = vaga.origem ? `${vaga.origem.nome} liberou esse horário.` : 'Horário liberado na agenda.';
  let detalhe;
  if (vaga.status === 'PREENCHIDA') {
    motivo = `${vaga.novoAgendamento?.nome || 'Uma cliente da fila'} ficou com o horário e já está confirmada na agenda.`;
    detalhe = 'Quem também recebeu a oferta foi avisado que continua na fila.';
  } else if (vaga.status === 'ABERTA') {
    detalhe = `Oferta enviada${vaga.automatica ? ' sozinha' : ''} pra ${vaga.envios.length} pessoa(s). Quem tocar em “Quero” primeiro fica. Vence às ${hora(vaga.expiraEm)}.`;
  } else if (n === 0) {
    detalhe = vaga.envios.length ? 'Todas as pessoas que servem já receberam a oferta.' : 'Ninguém da fila serve pra esse horário agora.';
  } else {
    detalhe = `${n} pessoa(s) da fila ${n === 1 ? 'serve' : 'servem'} pra esse horário${vaga.candidatos.primeiros.length ? `: ${vaga.candidatos.primeiros.join(', ')}${n > 3 ? '…' : ''}` : ''}.`;
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-4 py-3.5 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="w-16 flex-shrink-0 text-center py-2 rounded-lg bg-[var(--bg-subtle)]">
        <div className="text-xs font-medium text-[var(--text-muted)] capitalize">{diaCurto(vaga.data)}</div>
        <div className="text-[15px] font-bold tabular-nums text-[var(--text-main)]">{hora(vaga.data)}</div>
      </div>
      <div className="flex-1 min-w-[220px]">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-[13px] font-semibold text-[var(--text-main)]">{cabecalho}</strong>
          <Badge variant={sit.variant}>{sit.label}</Badge>
        </div>
        <div className="text-xs text-[var(--text-muted)] mt-0.5">{motivo}</div>
        <div className="text-[13px] text-[var(--text-secondary)] mt-0.5">{detalhe}</div>
        {vaga.status === 'ABERTA' && vaga.envios.length > 0 && (
          <ul className="m-0 mt-2 p-0 list-none flex flex-wrap gap-1.5" aria-label="Respostas da oferta">
            {vaga.envios.map((e) => (
              <li key={e.id} className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1 rounded-full border border-[var(--border-main)] text-xs text-[var(--text-main)]">
                {e.nome}
                <Badge size="sm" variant={e.resposta ? RESPOSTA[e.resposta]?.variant : 'warning'}>
                  {e.resposta ? RESPOSTA[e.resposta]?.label : 'Sem resposta'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {podeOferecer && (
          <>
            <Button variant="secondary" size="sm" loading={acao === `descartar-${vaga.id}`} onClick={onDescartar}>Não oferecer</Button>
            <Button variant="primary" size="sm" icon={Send} disabled={n === 0} loading={acao === `ofertar-${vaga.id}`} onClick={onOfertar}>
              Oferecer pra fila{n > 0 ? ` (${Math.min(n, 3)})` : ''}
            </Button>
          </>
        )}
        {vaga.status === 'ABERTA' && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--warning-text)]">
            <Clock size={14} aria-hidden="true" /> até {hora(vaga.expiraEm)}
          </span>
        )}
        {vaga.status === 'PREENCHIDA' && (
          <Link to="/app/agenda" className="inline-flex items-center h-8 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-subtle)]">
            Ver na agenda
          </Link>
        )}
      </div>
    </li>
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
