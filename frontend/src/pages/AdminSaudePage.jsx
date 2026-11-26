// /admin/saude — saude do sistema medida na hora (frente D da fase 2).
// Atualiza sozinha a cada 30 s (pausa com a aba escondida).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { Button } from '../components/ui';
import { SemPermissao, ErroCarregar, Carregando } from '../components/suporte/EstadosAdmin';
import { usePapelAdmin, erroDaApi, dataHora } from '../components/suporte/papelAdmin';

const INTERVALO_MS = 30_000;

const COR = {
  ok: 'bg-[var(--success)]',
  atencao: 'bg-[var(--warning)]',
  erro: 'bg-[var(--danger)]',
  neutro: 'bg-[var(--border-strong)]',
};
const ROTULO_ESTADO = { ok: 'Funcionando', atencao: 'Atenção', erro: 'Com erro', neutro: 'Sem dados' };

const num = (v) => Number(v || 0).toLocaleString('pt-BR');

function duracao(seg) {
  const s = Number(seg || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

function CartaoServico({ titulo, estado, children }) {
  return (
    <div className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4">
      <div className="flex items-center gap-2">
        <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', COR[estado])} aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[var(--text-main)]">{titulo}</h3>
        <span className="sr-only">{ROTULO_ESTADO[estado]}</span>
      </div>
      <div className="mt-2 text-sm text-[var(--text-secondary)]">{children}</div>
    </div>
  );
}

function Barra({ pct }) {
  const v = Math.max(0, Math.min(100, Number(pct || 0)));
  return (
    <div className="h-2 rounded-full bg-[var(--bg-subtle)] overflow-hidden" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx('h-full rounded-full', v >= 85 ? 'bg-[var(--danger)]' : v >= 70 ? 'bg-[var(--warning)]' : 'bg-[var(--success)]')} style={{ width: `${v}%` }} />
    </div>
  );
}

function Linha({ rotulo, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-[var(--text-secondary)]">{rotulo}</span>
      <span className="font-medium text-[var(--text-main)] tabular-nums text-right">{children}</span>
    </div>
  );
}

export default function AdminSaudePage() {
  const { pode } = usePapelAdmin();
  const permitido = pode('saude.ver');
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [agora, setAgora] = useState(() => Date.now());
  const emCurso = useRef(false);

  const carregar = useCallback(() => {
    if (emCurso.current) return Promise.resolve();
    emCurso.current = true;
    return api.get('/admin/saude')
      .then((r) => { setDados({ ...r.data, recebidoEm: Date.now() }); setErro(''); })
      .catch((e) => setErro(erroDaApi(e, 'Não foi possível medir a saúde do sistema.')))
      .finally(() => { emCurso.current = false; setCarregando(false); });
  }, []);

  useEffect(() => {
    if (!permitido) return undefined;
    carregar();
    const timer = setInterval(() => {
      if (!document.hidden) carregar();
    }, INTERVALO_MS);
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    const aoVoltar = () => { if (!document.hidden) carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      clearInterval(timer);
      clearInterval(relogio);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [carregar, permitido]);

  if (!permitido) return <SemPermissao />;

  const ha = dados ? Math.max(0, Math.round((agora - dados.recebidoEm) / 1000)) : null;
  const s = dados;
  const qr = s?.whatsapp?.qrCode;
  const oficial = s?.whatsapp?.oficial;
  const notas = s?.notasRejeitadas;
  const sistema = s?.recursos?.sistema;
  const processo = s?.recursos?.processo;
  const falhas = (s?.filas || []).flatMap((f) => (f.falhasRecentes || []).map((x) => ({ ...x, fila: f.rotulo })))
    .sort((a, b) => new Date(b.em || 0) - new Date(a.em || 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Saúde do sistema</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1" aria-live="polite">
            {ha === null ? 'Medindo agora…' : `Atualizado há ${ha} s · atualiza sozinho a cada 30 s`}
          </p>
        </div>
        <Button variant="secondary" className="min-h-11" icon={RefreshCw} loading={carregando} onClick={() => { setCarregando(true); carregar(); }}>
          Atualizar
        </Button>
      </div>

      {erro && <ErroCarregar texto={erro} onTentar={carregar} />}

      {!s && !erro && <Carregando linhas={4} />}

      {s && (
        <>
          {s.alertas?.length > 0 && (
            <div role="alert" className="rounded-xl bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning-text)]">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} aria-hidden="true" /> Precisa de atenção</p>
              <ul className="mt-1.5 list-disc pl-6 space-y-0.5">
                {s.alertas.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
          )}

          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
            <CartaoServico titulo="Banco de dados" estado={s.postgres?.ok ? 'ok' : 'erro'}>
              {s.postgres?.ok ? `Respondendo em ${num(s.postgres.latenciaMs)} ms` : `Sem resposta: ${s.postgres?.erro || 'falhou'}`}
            </CartaoServico>
            <CartaoServico titulo="Redis e filas" estado={s.redis?.ok ? 'ok' : 'erro'}>
              {s.redis?.ok ? `Respondendo em ${num(s.redis.latenciaMs)} ms` : `Sem resposta: ${s.redis?.erro || 'falhou'}`}
            </CartaoServico>
            <CartaoServico
              titulo="WhatsApp por QR Code"
              estado={!qr ? 'neutro' : qr.desconectados ? 'atencao' : 'ok'}
            >
              {!qr ? 'Sem dados' : qr.total === 0 ? 'Nenhum número conectado por QR Code' : (
                <>
                  {num(qr.conectados)} conectado(s) de {num(qr.total)}
                  <span className="block text-xs text-[var(--text-muted)]">
                    {num(qr.desconectados)} desconectado(s) · {num(qr.aguardandoQr)} esperando QR · {num(qr.conectando)} conectando
                  </span>
                </>
              )}
            </CartaoServico>
            <CartaoServico titulo="WhatsApp oficial" estado={!oficial ? 'neutro' : oficial.comErro ? 'atencao' : 'ok'}>
              {!oficial ? 'Sem dados' : oficial.total === 0 ? 'Nenhum número no canal oficial' : `${num(oficial.total)} número(s) · ${num(oficial.comErro)} com erro`}
            </CartaoServico>
            <CartaoServico titulo="Notas fiscais (24 h)" estado={!notas ? 'neutro' : notas.total ? 'atencao' : 'ok'}>
              {!notas ? 'Sem dados' : notas.total ? `${num(notas.total)} nota(s) com erro` : 'Nenhuma nota com erro'}
            </CartaoServico>
          </div>

          <div className="grid gap-4 grid-cols-1 xl:grid-cols-3">
            <section aria-labelledby="saude-servidor" className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 space-y-3">
              <h2 id="saude-servidor" className="text-base font-semibold text-[var(--text-main)]">Servidor</h2>
              {sistema && (
                <>
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-[var(--text-secondary)]">Memória da máquina</span>
                      <strong className="tabular-nums text-[var(--text-main)]">{Number(sistema.memoriaUsadaPct).toLocaleString('pt-BR')}%</strong>
                    </div>
                    <Barra pct={sistema.memoriaUsadaPct} />
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {num(sistema.memoriaLivreMb)} MB livres de {num(sistema.memoriaTotalMb)} MB
                    </p>
                  </div>
                  <Linha rotulo="Carga (1 / 5 / 15 min)">{(sistema.carga || []).map((c) => Number(c).toLocaleString('pt-BR')).join(' / ')}</Linha>
                  <p className="text-xs text-[var(--text-muted)] -mt-1">No Windows a carga aparece 0 (o sistema não informa).</p>
                  <Linha rotulo="Núcleos">{num(sistema.nucleos)}</Linha>
                  <Linha rotulo="Máquina ligada há">{duracao(sistema.uptimeSeg)}</Linha>
                  <Linha rotulo="Sistema">{sistema.plataforma}</Linha>
                </>
              )}
              {processo && (
                <>
                  <Linha rotulo="API no ar há">{duracao(processo.uptimeSeg)}</Linha>
                  <Linha rotulo="Memória da API">{num(processo.rssMb)} MB (heap {num(processo.heapUsadoMb)} MB)</Linha>
                </>
              )}
            </section>

            <section aria-labelledby="saude-filas" className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 xl:col-span-2">
              <h2 id="saude-filas" className="text-base font-semibold text-[var(--text-main)]">Filas</h2>
              {!s.redis?.ok ? (
                <p className="text-sm text-[var(--danger-text)] mt-3">Sem o Redis não dá pra ler as filas.</p>
              ) : (s.filas || []).length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] mt-3">Nenhuma fila encontrada.</p>
              ) : (
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Tarefas por fila</caption>
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                        <th scope="col" className="py-2 pr-3 font-semibold">Fila</th>
                        <th scope="col" className="py-2 px-2 font-semibold text-right">Aguardando</th>
                        <th scope="col" className="py-2 px-2 font-semibold text-right">Rodando</th>
                        <th scope="col" className="py-2 px-2 font-semibold text-right">Agendadas</th>
                        <th scope="col" className="py-2 px-2 font-semibold text-right">Falhas</th>
                        <th scope="col" className="py-2 pl-2 font-semibold text-right">Concluídas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.filas.map((f) => (
                        <tr key={f.nome} className="border-t border-[var(--border-main)]">
                          <th scope="row" className="py-2 pr-3 text-left font-medium text-[var(--text-main)]">
                            {f.rotulo}
                            <span className="block text-xs font-normal text-[var(--text-muted)]">{f.nome}</span>
                          </th>
                          {f.erro ? (
                            <td colSpan={5} className="py-2 text-right text-[var(--danger-text)]">{f.erro}</td>
                          ) : (
                            <>
                              <td className="py-2 px-2 text-right tabular-nums">{num(f.contagem?.waiting)}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{num(f.contagem?.active)}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{num(f.contagem?.delayed)}</td>
                              <td className={clsx('py-2 px-2 text-right tabular-nums', f.contagem?.failed ? 'text-[var(--danger)] font-semibold' : '')}>{num(f.contagem?.failed)}</td>
                              <td className="py-2 pl-2 text-right tabular-nums">{num(f.contagem?.completed)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            <section aria-labelledby="saude-falhas" className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5">
              <h2 id="saude-falhas" className="text-base font-semibold text-[var(--text-main)]">Falhas recentes nas filas</h2>
              {falhas.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] mt-3">Nenhuma falha registrada.</p>
              ) : (
                <ul className="mt-3 divide-y divide-[var(--border-main)]">
                  {falhas.slice(0, 15).map((f) => (
                    <li key={`${f.fila}-${f.id}`} className="py-2.5">
                      <p className="text-sm font-medium text-[var(--text-main)]">{f.fila}</p>
                      <p className="text-sm text-[var(--text-secondary)] break-words">{f.motivo}</p>
                      <p className="text-xs text-[var(--text-muted)]">{dataHora(f.em)} · {num(f.tentativas)} tentativa(s)</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="saude-notas" className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5">
              <h2 id="saude-notas" className="text-base font-semibold text-[var(--text-main)]">Notas com erro nas últimas 24 h</h2>
              {!notas || notas.ultimas.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] mt-3">Nenhuma nota com erro.</p>
              ) : (
                <ul className="mt-3 divide-y divide-[var(--border-main)]">
                  {notas.ultimas.map((n) => (
                    <li key={n.id} className="py-2.5">
                      <p className="text-sm font-medium text-[var(--text-main)]">{n.cliente || 'Negócio'} · {n.tipo}</p>
                      <p className="text-sm text-[var(--text-secondary)] break-words">{n.motivo}</p>
                      <p className="text-xs text-[var(--text-muted)]">{dataHora(n.em)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            Versão do app: {s.versao?.app || '—'} · Node {s.versao?.node || '—'} · medido em {dataHora(s.geradoEm)}
          </p>
        </>
      )}
    </div>
  );
}
