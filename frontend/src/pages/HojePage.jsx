// /app/hoje — o celular da dona: 3 numeros do dia, horarios, avisos e
// "Cobrar rapido" (Pix na hora). Frente C da fase 2.
// Prototipo: sellergy-prototipo/project/AppDono.dc.html. Backend: /hoje.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Loader2, RefreshCw, Copy, CheckCircle2, Delete, QrCode, Bell, CalendarDays } from 'lucide-react';
import api from '../services/api';
import { Button, useToast } from '../components/ui';

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtHora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDia = (d) => {
  const t = new Date(d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const erroDe = (e, padrao) => e?.response?.data?.erro || padrao;

const COR_STATUS = {
  CONFIRMED: 'bg-[var(--success-soft)] text-[var(--success-text)]',
  COMPLETED: 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]',
  PENDING: 'bg-[var(--warning-soft)] text-[var(--warning-text)]',
};

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'apagar'];
const INTERVALO_RESUMO = 60 * 1000;
const INTERVALO_PIX = 4000;
const PIX_DESISTE_MS = 20 * 60 * 1000;

function Numero({ rotulo, valor, detalhe, grande }) {
  return (
    <div className={clsx('rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4', grande && 'col-span-2 lg:col-span-1')}>
      <p className="text-xs text-[var(--text-muted)]">{rotulo}</p>
      <p className={clsx('mt-1 font-bold tabular-nums text-[var(--text-main)]', grande ? 'text-3xl' : 'text-xl')}>{valor}</p>
      {detalhe && <p className="text-xs text-[var(--text-muted)] mt-1">{detalhe}</p>}
    </div>
  );
}

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
      <div className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5">
        <h2 className="text-base font-semibold text-[var(--text-main)]">Cobrar rápido</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-2">Pra gerar Pix na hora, ative o recebimento por Pix uma vez.</p>
        <Link to="/app/pagamentos" className="mt-4 inline-flex items-center justify-center min-h-11 px-4 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-sm font-semibold">
          Ativar Pix
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4 sm:p-5">
      <h2 className="text-base font-semibold text-[var(--text-main)]">Cobrar rápido</h2>
      <p className="text-center text-4xl font-bold tabular-nums text-[var(--text-main)] mt-4" aria-live="polite">{fmtBRL(valor)}</p>

      {!pix && (
        <>
          <div className="grid grid-cols-3 gap-2 mt-4" role="group" aria-label="Teclado do valor">
            {TECLAS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => teclar(t)}
                aria-label={t === 'apagar' ? 'Apagar último número' : t}
                className="min-h-14 rounded-xl bg-[var(--bg-subtle)] text-xl font-semibold text-[var(--text-main)] hover:bg-[var(--border-main)] active:scale-[0.98] grid place-items-center"
              >
                {t === 'apagar' ? <Delete size={22} aria-hidden /> : t}
              </button>
            ))}
          </div>
          {erro && <p role="alert" className="text-sm text-[var(--danger-text)] mt-3">{erro}</p>}
          <Button size="lg" fullWidth className="mt-4" icon={QrCode} loading={gerando} disabled={valor < 1} onClick={gerar}>
            Gerar Pix
          </Button>
        </>
      )}

      {pix && pix.status === 'PAGO' && (
        <div className="mt-5 text-center" role="status">
          <CheckCircle2 size={48} className="mx-auto text-[var(--success-text)]" aria-hidden />
          <p className="mt-2 text-lg font-semibold text-[var(--text-main)]">Pago às {fmtHora(pix.pagoEm || new Date())}</p>
          <p className="text-sm text-[var(--text-muted)]">Entrada lançada no caixa de hoje.</p>
          <Button size="lg" fullWidth className="mt-4" onClick={nova}>Nova cobrança</Button>
        </div>
      )}

      {pix && pix.status !== 'PAGO' && (
        <div className="mt-4 space-y-3">
          {pix.qrCodeBase64 && (
            <img
              src={pix.qrCodeBase64.startsWith('data:') ? pix.qrCodeBase64 : `data:image/png;base64,${pix.qrCodeBase64}`}
              alt={`QR Code do Pix de ${fmtBRL(pix.valor)}`}
              className="mx-auto w-56 h-56 rounded-lg bg-white p-2"
              onError={(e) => { e.currentTarget.hidden = true; }}
            />
          )}
          {pix.qrCode && (
            <div>
              <label htmlFor="pix-copia" className="text-xs font-semibold text-[var(--text-secondary)]">Pix copia e cola</label>
              <textarea id="pix-copia" readOnly value={pix.qrCode} rows={3} className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-subtle)] p-2 text-xs break-all" />
              <Button variant="secondary" size="lg" fullWidth icon={Copy} onClick={copiar}>Copiar código</Button>
            </div>
          )}
          {pix.status === 'PENDENTE' ? (
            <p className="flex items-center justify-center gap-2 text-sm text-[var(--text-muted)]" role="status">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Esperando o pagamento…
            </p>
          ) : (
            <p className="text-sm text-center text-[var(--warning-text)]" role="status">Este Pix {pix.status === 'EXPIRADO' ? 'expirou' : 'foi cancelado'}.</p>
          )}
          <Button size="lg" variant="ghost" fullWidth onClick={nova}>{pix.status === 'PENDENTE' ? 'Digitar outro valor' : 'Nova cobrança'}</Button>
        </div>
      )}
    </div>
  );
}

export default function HojePage() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [atualizando, setAtualizando] = useState(false);
  const [aba, setAba] = useState('hoje');

  const carregar = useCallback(async () => {
    try {
      const r = await api.get('/hoje');
      setDados(r.data);
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

  const agenda = dados.agenda;
  const ABAS = [['hoje', 'Hoje'], ...(agenda ? [['agenda', 'Agenda']] : []), ['cobrar', 'Cobrar']];

  const blocoAvisos = (
    <section className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)]">
      <h2 className="px-4 py-3 text-base font-semibold text-[var(--text-main)] flex items-center gap-2"><Bell size={16} aria-hidden /> Avisos</h2>
      {dados.avisos.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-[var(--text-muted)]">Nenhum aviso por enquanto.</p>
      ) : (
        <ul className="divide-y divide-[var(--border-main)] border-t border-[var(--border-main)]">
          {dados.avisos.map((a) => {
            const conteudo = (
              <>
                <span className="flex-1 min-w-0">
                  <span className={clsx('block text-sm', a.lida ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-main)]')}>{a.titulo}</span>
                  <span className="block text-xs text-[var(--text-muted)] truncate">{a.mensagem}</span>
                </span>
                <span className="text-xs text-[var(--text-muted)] tabular-nums">{fmtHora(a.criadoEm)}</span>
              </>
            );
            return (
              <li key={a.id}>
                {a.link
                  ? <Link to={a.link} className="flex items-center gap-3 px-4 py-3 min-h-11 hover:bg-[var(--bg-subtle)]">{conteudo}</Link>
                  : <div className="flex items-center gap-3 px-4 py-3">{conteudo}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const blocoAgenda = agenda && (
    <section className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)]">
      <h2 className="px-4 py-3 text-base font-semibold text-[var(--text-main)] flex items-center gap-2">
        <CalendarDays size={16} aria-hidden /> {fmtDia(dados.data)} · {agenda.total} {agenda.total === 1 ? 'horário' : 'horários'}
      </h2>
      {agenda.horarios.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-[var(--text-muted)]">Nenhum horário marcado hoje. <Link to="/app/agenda" className="font-semibold underline">Abrir agenda</Link></p>
      ) : (
        <ul className="divide-y divide-[var(--border-main)] border-t border-[var(--border-main)]">
          {agenda.horarios.map((h) => (
            <li key={h.id} className={clsx('flex items-center gap-3 px-4 py-3', h.passou && h.status !== 'PENDING' && 'opacity-60')}>
              <span className="w-12 text-sm font-semibold tabular-nums text-[var(--text-main)]">{fmtHora(h.inicio)}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-[var(--text-main)] truncate">{h.cliente}</span>
                <span className="block text-xs text-[var(--text-muted)] truncate">{[h.servico, h.profissional].filter(Boolean).join(' · ') || 'Sem serviço informado'}</span>
              </span>
              <span className={clsx('text-xs font-semibold rounded-full px-2.5 py-1 whitespace-nowrap', COR_STATUS[h.status] || COR_STATUS.COMPLETED)}>{h.rotuloStatus}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Hoje</h1>
          <p className="text-sm text-[var(--text-muted)]">{fmtDia(dados.data)}</p>
        </div>
        <Button variant="ghost" size="lg" icon={RefreshCw} loading={atualizando} onClick={() => { setAtualizando(true); carregar(); }} aria-label="Atualizar">
          <span className="hidden sm:inline">Atualizar</span>
        </Button>
      </div>
      {erro && <p role="alert" className="text-sm text-[var(--danger-text)]">{erro} Mostrando os últimos dados.</p>}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Numero grande rotulo="Vendeu hoje" valor={fmtBRL(dados.vendeu.valor)} detalhe={`${dados.vendeu.quantidade} ${dados.vendeu.quantidade === 1 ? 'venda' : 'vendas'}`} />
        <Numero rotulo="A receber" valor={fmtBRL(dados.aReceber.valor)} detalhe={dados.aReceber.quantidade ? `${dados.aReceber.quantidade} Pix/links em aberto` : 'Nada em aberto'} />
        <Numero rotulo="Saldo do caixa" valor={dados.caixa.aberto ? fmtBRL(dados.caixa.saldo) : 'Fechado'} detalhe={dados.caixa.aberto ? `Aberto às ${fmtHora(dados.caixa.abertoEm)}` : 'Abre sozinho na 1ª venda'} />
      </div>

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

      <div className="grid lg:grid-cols-[1fr_22rem] gap-4 items-start">
        <div className="space-y-4">
          <div className={clsx(aba !== 'hoje' && 'hidden lg:block')}>{blocoAvisos}</div>
          {agenda && <div className={clsx(aba !== 'agenda' && 'hidden lg:block')}>{blocoAgenda}</div>}
        </div>
        <div className={clsx(aba !== 'cobrar' && 'hidden lg:block', 'lg:sticky lg:top-4')}>
          <CobrarRapido pagamentoConfigurado={dados.pagamentoConfigurado} aoMudar={carregar} />
        </div>
      </div>
    </div>
  );
}
