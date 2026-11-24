// /app/hoje — o dia da dona. No computador: números do dia + 3 colunas
// (atendimento agora / a seguir / Cobrar rápido · agenda do dia · avisos).
// No celular: os mesmos blocos em abas Hoje / Agenda / Cobrar (Pix na hora).
// Mockup: layout/project/Hoje.dc.html. Backend: /hoje e /agenda/:id/concluir.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Loader2, RefreshCw, Copy, CheckCircle2, Delete, QrCode, Bell } from 'lucide-react';
import api from '../services/api';
import { iniciais } from '../components/agenda/agendaUtils';
import { Pagina, FaixaNumeros, Numero, Painel, AbasPilula, Badge, Button, useToast } from '../components/ui';

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtHora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDia = (d) => {
  const t = new Date(d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const fmtFalta = (min) => {
  if (min <= 0) return 'agora';
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `em ${h} h ${m} min` : `em ${h} h`;
};
const erroDe = (e, padrao) => e?.response?.data?.erro || padrao;

const VARIANTE_STATUS = { CONFIRMED: 'success', PENDING: 'warning', COMPLETED: 'neutral' };

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'apagar'];
const INTERVALO_RESUMO = 60 * 1000;
const INTERVALO_PIX = 4000;
const PIX_DESISTE_MS = 20 * 60 * 1000;
// Valores em dinheiro encolhem um pouco no celular pra não cortar.
const VALOR_COMPACTO = 'max-sm:[&>div:nth-child(2)]:text-lg';

function CobrarRapido({ pagamentoConfigurado, aoMudar }) { // aoMudar = recarrega o resumo do dia
  const toast = useToast();
  const [centavos, setCentavos] = useState('');
  const [pix, setPix] = useState(null);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState(null);
  const acompanhando = useRef(null); // id do Pix que esta sendo acompanhado

  useEffect(() => () => { acompanhando.current = null; }, []);

  // Consulta leve a cada poucos segundos ate pagar, expirar ou desistir.
  const acompanhar = useCallback(async (id) => {
    acompanhando.current = id;
    const inicio = Date.now();
    while (acompanhando.current === id && Date.now() - inicio < PIX_DESISTE_MS) {
      await new Promise((ok) => { setTimeout(ok, INTERVALO_PIX); });
      if (acompanhando.current !== id) return;
      if (document.hidden) continue;
      try {
        const r = await api.get(`/hoje/cobrancas/${id}`);
        if (acompanhando.current !== id) return;
        setPix((p) => (p && p.id === id ? { ...p, ...r.data } : p));
        if (r.data.status === 'PAGO') { aoMudar?.(); return; }
        if (r.data.status !== 'PENDENTE') return;
      } catch { /* rede oscilou: tenta no proximo ciclo */ }
    }
  }, [aoMudar]);

  const teclar = (t) => {
    if (pix) return;
    setErro(null);
    setCentavos((v) => (t === 'apagar' ? v.slice(0, -1) : `${v}${t}`.replace(/^0+/, '').slice(0, 7)));
  };

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    try {
      const r = await api.post('/hoje/cobrar', { centavos: Number(centavos) });
      setPix(r.data);
      aoMudar?.(); // atualiza o "A receber"
      acompanhar(r.data.id);
    } catch (e) {
      setErro(erroDe(e, 'Não foi possível gerar o Pix.'));
    } finally {
      setGerando(false);
    }
  };

  const nova = () => { acompanhando.current = null; setPix(null); setCentavos(''); setErro(null); };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(pix.qrCode);
      toast.success('Código Pix copiado.');
    } catch {
      toast.error('Não foi possível copiar. Segure o código e copie.');
    }
  };

  const valor = Number(centavos || 0) / 100;

  if (!pagamentoConfigurado) {
    return (
      <Painel titulo="Cobrar rápido" subtitulo="Pix na hora, com QR Code">
        <p className="m-0 text-[13px] text-[var(--text-secondary)]">Pra gerar Pix na hora, ative o recebimento por Pix uma vez.</p>
        <Link to="/app/pagamentos" className="mt-3 inline-flex items-center justify-center h-10 px-4 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-sm font-semibold">
          Ativar Pix
        </Link>
      </Painel>
    );
  }

  return (
    <Painel titulo="Cobrar rápido" subtitulo="Pix na hora, com QR Code">
      <p className="m-0 text-center text-3xl font-bold tabular-nums text-[var(--text-main)]" aria-live="polite">{fmtBRL(valor)}</p>

      {!pix && (
        <>
          <div className="grid grid-cols-3 gap-2 mt-3" role="group" aria-label="Teclado do valor">
            {TECLAS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => teclar(t)}
                aria-label={t === 'apagar' ? 'Apagar último número' : t}
                className="min-h-14 lg:min-h-11 rounded-lg bg-[var(--bg-subtle)] text-lg font-semibold text-[var(--text-main)] hover:bg-[var(--border-main)] active:scale-[0.98] grid place-items-center"
              >
                {t === 'apagar' ? <Delete size={20} aria-hidden /> : t}
              </button>
            ))}
          </div>
          {erro && <p role="alert" className="m-0 text-[13px] text-[var(--danger-text)] mt-3">{erro}</p>}
          <Button fullWidth className="mt-3 max-lg:h-12" icon={QrCode} loading={gerando} disabled={valor < 1} onClick={gerar}>
            Gerar Pix
          </Button>
        </>
      )}

      {pix && pix.status === 'PAGO' && (
        <div className="mt-4 text-center" role="status">
          <CheckCircle2 size={40} className="mx-auto text-[var(--success-text)]" aria-hidden />
          <p className="m-0 mt-2 text-base font-semibold text-[var(--text-main)]">Pago às {fmtHora(pix.pagoEm || new Date())}</p>
          <p className="m-0 text-[13px] text-[var(--text-muted)]">Entrada lançada no caixa de hoje.</p>
          <Button fullWidth className="mt-3" onClick={nova}>Nova cobrança</Button>
        </div>
      )}

      {pix && pix.status !== 'PAGO' && (
        <div className="mt-3 space-y-3">
          {pix.qrCodeBase64 && (
            <img
              src={pix.qrCodeBase64.startsWith('data:') ? pix.qrCodeBase64 : `data:image/png;base64,${pix.qrCodeBase64}`}
              alt={`QR Code do Pix de ${fmtBRL(pix.valor)}`}
              className="mx-auto w-52 h-52 rounded-lg bg-white p-2"
              onError={(e) => { e.currentTarget.hidden = true; }}
            />
          )}
          {pix.qrCode && (
            <div>
              <label htmlFor="pix-copia" className="text-xs font-semibold text-[var(--text-secondary)]">Pix copia e cola</label>
              <textarea id="pix-copia" readOnly value={pix.qrCode} rows={3} className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-subtle)] text-[var(--text-main)] p-2 text-xs break-all" />
              <Button variant="secondary" fullWidth icon={Copy} onClick={copiar}>Copiar código</Button>
            </div>
          )}
          {pix.status === 'PENDENTE' ? (
            <p className="m-0 flex items-center justify-center gap-2 text-[13px] text-[var(--text-muted)]" role="status">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Esperando o pagamento…
            </p>
          ) : (
            <p className="m-0 text-[13px] text-center text-[var(--warning-text)]" role="status">Este Pix {pix.status === 'EXPIRADO' ? 'expirou' : 'foi cancelado'}.</p>
          )}
          <Button variant="ghost" fullWidth onClick={nova}>{pix.status === 'PENDENTE' ? 'Digitar outro valor' : 'Nova cobrança'}</Button>
        </div>
      )}
    </Painel>
  );
}

/** Cartão do horário que já começou e ainda não foi concluído. */
function EmAtendimento({ horario, concluindo, aoConcluir }) {
  return (
    <Painel
      titulo="Em atendimento"
      acoes={<Badge variant="success">começou {fmtHora(horario.inicio)}</Badge>}
      className="border-[var(--primary)]! shadow-[0_0_0_3px_var(--primary-soft)]"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span aria-hidden="true" className="w-11 h-11 rounded-full grid place-items-center flex-shrink-0 bg-[var(--primary-soft)] text-[var(--primary)] font-bold text-sm">
          {iniciais(horario.cliente)}
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-bold text-[var(--text-main)] [overflow-wrap:anywhere]">{horario.cliente}</div>
          <div className="text-xs font-medium text-[var(--text-muted)]">{horario.rotuloStatus}</div>
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-[var(--bg-subtle)] px-3 py-2.5 text-[13px] text-[var(--text-secondary)] space-y-1.5">
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <span>Serviço</span>
          <span className="font-semibold text-[var(--text-main)] [overflow-wrap:anywhere]">{horario.servico || 'Não informado'}</span>
        </div>
        {horario.profissional && (
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
            <span>Com</span>
            <span className="font-semibold text-[var(--text-main)]">{horario.profissional}</span>
          </div>
        )}
      </div>
      <Button fullWidth className="mt-3 max-lg:h-12" icon={CheckCircle2} loading={concluindo} onClick={() => aoConcluir(horario)}>
        Concluir e cobrar
      </Button>
      <p className="m-0 mt-2 text-xs text-[var(--text-muted)]">Marca como feito e lança a venda do serviço no caixa.</p>
    </Painel>
  );
}

export default function HojePage() {
  const toast = useToast();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [atualizando, setAtualizando] = useState(false);
  const [aba, setAba] = useState('hoje');
  const [agora, setAgora] = useState(() => Date.now());
  const [filtroProf, setFiltroProf] = useState('todos');
  const [concluindo, setConcluindo] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const r = await api.get('/hoje');
      setDados(r.data);
      setAgora(Date.now());
      setErro(null);
    } catch (e) {
      setErro(erroDe(e, 'Não foi possível carregar o resumo de hoje.'));
    } finally {
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao montar
    carregar();
    const id = setInterval(() => { if (!document.hidden) carregar(); }, INTERVALO_RESUMO);
    return () => clearInterval(id);
  }, [carregar]);

  // Concluir = fecha o ciclo serviço→venda (mesmo endpoint da Agenda).
  const concluir = async (h) => {
    setConcluindo(h.id);
    try {
      const r = await api.patch(`/agenda/${h.id}/concluir`, {});
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
      toast.error(erroDe(e, 'Não foi possível concluir o atendimento.'));
    } finally {
      setConcluindo(null);
    }
  };

  const agenda = dados?.agenda || null;
  const horarios = useMemo(() => agenda?.horarios || [], [agenda]);

  // Por profissional, o último horário que já começou; se ainda não foi
  // concluído, está em atendimento.
  const emAtendimento = useMemo(() => {
    const ultimoPorProf = new Map();
    horarios.forEach((h) => { if (h.passou) ultimoPorProf.set(h.profissional || '', h); });
    return [...ultimoPorProf.values()]
      .filter((h) => h.status !== 'COMPLETED')
      .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  }, [horarios]);
  const idsAgora = useMemo(() => new Set(emAtendimento.map((h) => h.id)), [emAtendimento]);

  const futuros = horarios.filter((h) => !h.passou && h.status !== 'COMPLETED');
  const proximo = futuros[0] || null;
  const atendidos = horarios.filter((h) => h.status === 'COMPLETED').length;

  const profissionais = useMemo(
    () => [...new Set(horarios.map((h) => h.profissional).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [horarios]
  );
  const filtroValido = filtroProf === 'todos' || profissionais.includes(filtroProf) ? filtroProf : 'todos';
  const horariosVisiveis = filtroValido === 'todos' ? horarios : horarios.filter((h) => h.profissional === filtroValido);

  if (!dados) {
    return (
      <div className="p-6 text-center">
        {erro ? (
          <>
            <p role="alert" className="text-sm text-[var(--danger-text)]">{erro}</p>
            <Button className="mt-4" variant="secondary" icon={RefreshCw} onClick={() => carregar()}>Tentar de novo</Button>
          </>
        ) : <Loader2 className="mx-auto animate-spin text-[var(--text-muted)]" aria-label="Carregando" />}
      </div>
    );
  }

  const ABAS = [['hoje', 'Hoje'], ...(agenda ? [['agenda', 'Agenda']] : []), ['cobrar', 'Cobrar']];
  const naAba = (id) => aba !== id && 'hidden lg:flex';

  const minutosProximo = proximo ? Math.max(0, Math.round((new Date(proximo.inicio).getTime() - agora) / 60000)) : 0;

  const blocoAvisos = (
    <Painel
      titulo={<span className="inline-flex items-center gap-2"><Bell size={14} aria-hidden /> Avisos</span>}
      acoes={dados.avisos.some((a) => !a.lida) ? <Badge variant="info">{dados.avisos.filter((a) => !a.lida).length} novos</Badge> : null}
      semPadding
    >
      {dados.avisos.length === 0 ? (
        <p className="m-0 px-4 py-3 text-[13px] text-[var(--text-muted)]">Nenhum aviso por enquanto.</p>
      ) : (
        <ul className="m-0 p-0 list-none">
          {dados.avisos.map((a) => {
            const conteudo = (
              <>
                <span className="flex-1 min-w-0">
                  <span className={clsx('block text-[13px] [overflow-wrap:anywhere]', a.lida ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-main)]')}>{a.titulo}</span>
                  <span className="block text-xs text-[var(--text-muted)] truncate">{a.mensagem}</span>
                </span>
                <span className="text-xs text-[var(--text-muted)] tabular-nums flex-shrink-0">{fmtHora(a.criadoEm)}</span>
              </>
            );
            return (
              <li key={a.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                {a.link
                  ? <Link to={a.link} className="flex items-center gap-3 px-4 py-3 min-h-11 hover:bg-[var(--bg-subtle)]">{conteudo}</Link>
                  : <div className="flex items-center gap-3 px-4 py-3">{conteudo}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </Painel>
  );

  const blocoAgenda = agenda && (
    <Painel
      titulo="Agenda do dia"
      subtitulo={`${fmtDia(dados.data)} · ${agenda.total} ${agenda.total === 1 ? 'horário' : 'horários'}`}
      acoes={profissionais.length > 1 ? (
        <AbasPilula
          rotulo="Filtrar por profissional"
          valor={filtroValido}
          onChange={setFiltroProf}
          abas={[{ valor: 'todos', rotulo: 'Todos' }, ...profissionais.map((p) => ({ valor: p, rotulo: p }))]}
        />
      ) : null}
      semPadding
    >
      {horariosVisiveis.length === 0 ? (
        <p className="m-0 px-4 py-3 text-[13px] text-[var(--text-muted)]">
          Nenhum horário marcado hoje. <Link to="/app/agenda" className="font-semibold underline">Abrir agenda</Link>
        </p>
      ) : (
        <ul className="m-0 p-0 list-none">
          {horariosVisiveis.map((h) => {
            const ehAgora = idsAgora.has(h.id);
            const feito = h.status === 'COMPLETED';
            return (
              <li
                key={h.id}
                className={clsx(
                  'grid grid-cols-[56px_1fr_auto] gap-3 items-center px-4 py-3 border-b border-[var(--border-subtle)] last:border-b-0 text-[13px]',
                  ehAgora && 'bg-[var(--primary-soft)]'
                )}
              >
                <span className={clsx('font-bold tabular-nums', feito ? 'text-[var(--text-muted)]' : 'text-[var(--text-main)]')}>{fmtHora(h.inicio)}</span>
                <span className="min-w-0">
                  <span className={clsx('block font-semibold [overflow-wrap:anywhere]', feito ? 'text-[var(--text-secondary)]' : 'text-[var(--text-main)]')}>{h.cliente}</span>
                  <span className="block text-xs text-[var(--text-muted)] truncate">{[h.servico, h.profissional].filter(Boolean).join(' · ') || 'Sem serviço informado'}</span>
                </span>
                {ehAgora
                  ? <Badge variant="success">Agora</Badge>
                  : <Badge variant={VARIANTE_STATUS[h.status] || 'neutral'}>{h.rotuloStatus}</Badge>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="px-4 py-2.5 border-t border-[var(--border-subtle)]">
        <Link to="/app/agenda" className="text-[13px] font-semibold text-[var(--primary)] hover:underline">Abrir agenda completa</Link>
      </div>
    </Painel>
  );

  return (
    <Pagina>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[13px] text-[var(--text-muted)]">{fmtDia(dados.data)}</p>
        <Button variant="ghost" size="sm" icon={RefreshCw} loading={atualizando} onClick={() => { setAtualizando(true); carregar(); }} aria-label="Atualizar">
          <span className="hidden sm:inline">Atualizar</span>
        </Button>
      </div>
      {erro && <p role="alert" className="m-0 text-[13px] text-[var(--danger-text)]">{erro} Mostrando os últimos dados.</p>}

      <FaixaNumeros min={150}>
        <Numero
          destaque
          className="max-sm:col-span-2"
          rotulo="Vendeu hoje"
          valor={fmtBRL(dados.vendeu.valor)}
          detalhe={`${dados.vendeu.quantidade} ${dados.vendeu.quantidade === 1 ? 'venda' : 'vendas'}`}
        />
        <Numero
          className={VALOR_COMPACTO}
          rotulo="A receber"
          valor={fmtBRL(dados.aReceber.valor)}
          tom={dados.aReceber.quantidade ? 'alerta' : 'neutro'}
          detalhe={dados.aReceber.quantidade ? `${dados.aReceber.quantidade} Pix/links em aberto` : 'Nada em aberto'}
        />
        <Numero
          className={VALOR_COMPACTO}
          rotulo="Saldo do caixa"
          valor={dados.caixa.aberto ? fmtBRL(dados.caixa.saldo) : 'Fechado'}
          detalhe={dados.caixa.aberto ? `Aberto às ${fmtHora(dados.caixa.abertoEm)}` : 'Abre sozinho na 1ª venda'}
        />
        {agenda && (
          <Numero
            rotulo="Atendidos"
            valor={atendidos}
            tom="sucesso"
            detalhe={`de ${agenda.total} ${agenda.total === 1 ? 'horário' : 'horários'}`}
          />
        )}
        {agenda && (
          <Numero
            rotulo="Faltam"
            valor={futuros.length}
            detalhe={proximo ? `Próximo às ${fmtHora(proximo.inicio)}` : 'Nenhum outro hoje'}
          />
        )}
      </FaixaNumeros>

      <div role="tablist" aria-label="Seções" className="lg:hidden grid gap-1 p-1 rounded-xl bg-[var(--bg-subtle)]" style={{ gridTemplateColumns: `repeat(${ABAS.length}, 1fr)` }}>
        {ABAS.map(([id, t]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            onClick={() => setAba(id)}
            className={clsx('min-h-11 rounded-lg text-sm font-semibold', aba === id ? 'bg-[var(--bg-card)] text-[var(--text-main)] shadow-sm' : 'text-[var(--text-secondary)]')}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 items-start">
        {/* Coluna 1: atendimento agora, a seguir e Cobrar rápido */}
        <section aria-label="Atendimento agora" className={clsx('min-w-0 flex flex-col gap-4', aba === 'agenda' && 'hidden lg:flex')} style={{ flex: '1 1 340px' }}>
          {agenda && (
            <div className={clsx('flex flex-col gap-4', naAba('hoje'))}>
              {emAtendimento.map((h) => (
                <EmAtendimento key={h.id} horario={h} concluindo={concluindo === h.id} aoConcluir={concluir} />
              ))}
              <Painel titulo="A seguir" acoes={proximo ? <span className="text-xs font-medium text-[var(--text-muted)]">{fmtFalta(minutosProximo)}</span> : null}>
                {proximo ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[var(--text-main)] [overflow-wrap:anywhere]">{fmtHora(proximo.inicio)} · {proximo.cliente}</div>
                      <div className="text-xs font-medium text-[var(--text-muted)]">
                        {[proximo.servico, proximo.profissional && `com ${proximo.profissional}`].filter(Boolean).join(' ') || 'Sem serviço informado'}
                      </div>
                    </div>
                    <Badge variant={VARIANTE_STATUS[proximo.status] || 'neutral'}>{proximo.rotuloStatus}</Badge>
                  </div>
                ) : (
                  <p className="m-0 text-[13px] text-[var(--text-muted)]">Nenhum outro horário hoje.</p>
                )}
              </Painel>
            </div>
          )}
          <div className={clsx('flex flex-col', naAba('cobrar'))}>
            <CobrarRapido pagamentoConfigurado={dados.pagamentoConfigurado} aoMudar={carregar} />
          </div>
        </section>

        {/* Coluna 2: agenda do dia em lista */}
        {agenda && (
          <div className={clsx('min-w-0 flex flex-col', naAba('agenda'))} style={{ flex: '2 1 420px' }}>
            {blocoAgenda}
          </div>
        )}

        {/* Coluna 3: avisos */}
        <div className={clsx('min-w-0 flex flex-col gap-4', naAba('hoje'))} style={{ flex: '1 1 300px' }}>
          {blocoAvisos}
        </div>
      </div>
    </Pagina>
  );
}
