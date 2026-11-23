// /admin/dashboard — Visao geral do dono do Sellergy (frente D da fase 2).
// Numeros reais: GET /admin/assinaturas/resumo (MRR, pagantes, testes,
// cancelamento) + GET /admin/assinaturas/visao-geral (receita por mes, funil,
// conversao do teste e "Precisa de voce").
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Hourglass, Percent, RefreshCw, TrendingDown, Users, Wallet,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import clsx from 'clsx';
import api from '../services/api';
import { Button, KpiCard } from '../components/ui';
import { brl } from '../components/conta/rotulosAssinatura';
import { Carregando, ErroCarregar, SemPermissao } from '../components/suporte/EstadosAdmin';
import { usePapelAdmin } from '../components/suporte/papelAdmin';

const NIVEL = {
  alto: 'bg-[var(--danger)]',
  medio: 'bg-[var(--warning)]',
  baixo: 'bg-[var(--success)]',
};

const pct = (v) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('pt-BR')}%`);

function nomeDoMes(mes) {
  if (!mes) return '';
  const [a, m] = mes.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function TooltipReceita({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-[var(--text-main)]">{p.rotulo}</p>
      <p className="text-[var(--text-secondary)] tabular-nums">{brl(p.valor)} · {p.faturas} fatura(s)</p>
    </div>
  );
}

function Funil({ funil }) {
  const etapas = [
    { rotulo: 'Criaram conta', valor: funil.cadastros, nota: 'cadastros no mês' },
    { rotulo: 'Ativaram', valor: funil.ativaram, nota: '1ª venda ou 1º agendamento' },
    { rotulo: 'Pagaram', valor: funil.pagaram, nota: 'ao menos 1 mensalidade paga' },
  ];
  const base = funil.cadastros || 0;
  return (
    <ol className="space-y-4">
      {etapas.map((e) => {
        const largura = base ? Math.max(4, Math.round((e.valor / base) * 100)) : 0;
        return (
          <li key={e.rotulo}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--text-main)]">{e.rotulo}</span>
              <span className="text-sm tabular-nums text-[var(--text-main)]">
                {e.valor}{base ? <span className="text-[var(--text-muted)]"> · {Math.round((e.valor / base) * 100)}%</span> : null}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden" aria-hidden="true">
              <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${largura}%` }} />
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{e.nota}</p>
          </li>
        );
      })}
    </ol>
  );
}

export default function DashboardPage() {
  const { pode } = usePapelAdmin();
  const [resumo, setResumo] = useState(null);
  const [visao, setVisao] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(() => Promise.all([
    api.get('/admin/assinaturas/resumo'),
    api.get('/admin/assinaturas/visao-geral'),
  ])
    .then(([r, v]) => { setResumo(r.data); setVisao(v.data); setErro(''); })
    .catch((e) => setErro(e.response?.data?.erro || 'Não foi possível carregar a visão geral.'))
    .finally(() => setCarregando(false)), []);

  useEffect(() => { carregar(); }, [carregar]);

  if (!pode('painel.ver')) return <SemPermissao />;

  const receita = visao?.receitaPorMes || [];
  const temReceita = receita.some((m) => m.valor > 0);
  const conv = visao?.conversaoTeste;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Visão geral</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {visao ? `${nomeDoMes(visao.funil.mes)} · assinaturas do Sellergy` : 'Assinaturas, testes e o que precisa de você.'}
          </p>
        </div>
        <Button variant="secondary" className="min-h-11" icon={RefreshCw} loading={carregando} onClick={() => { setCarregando(true); carregar(); }}>
          Atualizar
        </Button>
      </div>

      {erro && <ErroCarregar texto={erro} onTentar={() => { setCarregando(true); carregar(); }} />}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard icon={Wallet} color="success" label="Receita mensal (MRR)" carregando={!resumo}
          valor={resumo ? brl(resumo.mrr) : null}
          subvalor={resumo ? `${brl(resumo.recebidoNoMes)} recebido no mês` : null}
          info="Soma das assinaturas ativas e atrasadas; plano anual entra dividido por 12." />
        <KpiCard icon={Users} color="info" label="Pagantes" carregando={!resumo}
          valor={resumo ? String(resumo.pagantes) : null}
          subvalor={resumo && resumo.pagantes ? `ticket médio ${brl(resumo.mrr / resumo.pagantes)}` : null} />
        <KpiCard icon={Hourglass} color="accent" label="Em teste" carregando={!resumo}
          valor={resumo ? String(resumo.emTeste) : null}
          subvalor={resumo ? `${resumo.cadastrosNoMes} cadastro(s) no mês` : null} />
        <KpiCard icon={Percent} color="neutral" label="Conversão do teste" carregando={!visao}
          valor={conv ? pct(conv.pct) : null}
          subvalor={conv ? `${conv.viraramPagantes} de ${conv.encerrados} testes encerrados (90 dias)` : null}
          info="Quem terminou o teste grátis nos últimos 90 dias e virou pagante, dividido por todos que terminaram o teste nesse período." />
        <KpiCard icon={TrendingDown} color="danger" label="Cancelamento no mês" carregando={!resumo}
          valor={resumo ? pct(resumo.cancelamentoPct) : null}
          subvalor={resumo ? `${resumo.canceladosNoMes} cancelado(s) no mês` : null} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-labelledby="titulo-receita" className="lg:col-span-2 rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="titulo-receita" className="text-base font-semibold text-[var(--text-main)]">Receita por mês</h2>
            <span className="text-xs text-[var(--text-muted)]">mensalidades pagas, últimos 6 meses</span>
          </div>
          <div className="mt-4">
            {!visao ? (
              <Carregando linhas={4} />
            ) : !temReceita ? (
              <p className="py-12 text-center text-sm text-[var(--text-muted)]">Nenhuma mensalidade paga nos últimos 6 meses.</p>
            ) : (
              <div role="img" aria-label={`Receita por mês: ${receita.map((m) => `${m.rotulo} ${brl(m.valor)}`).join(', ')}`}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={receita} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-main)" />
                    <XAxis dataKey="rotulo" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={70}
                      tickFormatter={(v) => `R$ ${Number(v).toLocaleString('pt-BR')}`} />
                    <Tooltip content={<TooltipReceita />} cursor={{ fill: 'var(--bg-subtle)' }} />
                    <Bar dataKey="valor" name="Receita" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="titulo-funil" className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5">
          <h2 id="titulo-funil" className="text-base font-semibold text-[var(--text-main)]">
            Funil de {visao ? nomeDoMes(visao.funil.mes).split(' ')[0] : 'do mês'}
          </h2>
          <div className="mt-4">
            {!visao ? <Carregando linhas={3} /> : visao.funil.cadastros === 0
              ? <p className="py-8 text-center text-sm text-[var(--text-muted)]">Nenhum cadastro novo neste mês ainda.</p>
              : <Funil funil={visao.funil} />}
          </div>
        </section>
      </div>

      <section aria-labelledby="titulo-precisa" className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5">
        <h2 id="titulo-precisa" className="text-base font-semibold text-[var(--text-main)]">Precisa de você</h2>
        <div className="mt-3">
          {!visao ? (
            <Carregando linhas={3} />
          ) : visao.precisaDeVoce.length === 0 ? (
            <p className="py-6 text-sm text-[var(--text-muted)]">Tudo em dia. Nada pedindo a sua atenção agora.</p>
          ) : (
            <ul className="divide-y divide-[var(--border-main)]">
              {visao.precisaDeVoce.map((item, i) => (
                <li key={`${item.tipo}-${i}`} className="flex flex-wrap items-center gap-3 py-3">
                  <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', NIVEL[item.nivel] || NIVEL.medio)} aria-hidden="true" />
                  <span className="flex-1 min-w-[200px] text-sm text-[var(--text-main)]">
                    {item.nivel === 'alto' && <AlertTriangle size={14} className="inline mr-1 text-[var(--danger)]" aria-label="Urgente" />}
                    {item.texto}
                  </span>
                  <Link
                    to={item.link}
                    className="inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                  >
                    {item.acao} <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
