// Pagina de relatorios consolidados do tenant.
// Estrutura (layout novo): barra de periodo + seletor de relatorio no topo,
// faixa de numeros, conteudo principal + coluna lateral. Cada aba e um
// componente que recebe o intervalo e busca seus dados.
//
// Filosofia do filtro de periodo:
//   - Default: ultimos 30 dias. Presets rapidos + custom.
//   - GLOBAL: vale pra todas as abas — quando troca, todas refazem queries.
//   - O botao "Exportar" de cada aba vai pro topo da tela (useAcaoTopo).

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import relatorioMensalService from '../services/relatorioMensalService';
import {
  TrendingDown, Package, AlertCircle, Image as ImageIcon, Calendar,
  Clock, Phone, Mail, Sparkles, Wrench, CheckCircle2, XCircle, HelpCircle, X, RefreshCw, ChevronRight,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, BarChart, Bar,
} from 'recharts';
import api from '../services/api';
import {
  Badge, Input, Button,
  Tooltip as InfoTooltip,
  FiltroRapido, Combobox, BotaoExportar,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, AbasPilula,
} from '../components/ui';

const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v) => `${Number(v ?? 0).toFixed(1)}%`;
const fmtNum = (v) => Number(v ?? 0).toLocaleString('pt-BR');
const fmtDelta = (d) => (d === null || d === undefined ? null : `${d > 0 ? '+' : ''}${Number(d).toFixed(1)}% que o período anterior`);
const tomDelta = (d) => (d === null || d === undefined ? 'neutro' : d >= 0 ? 'sucesso' : 'perigo');

const PRESETS = [
  { value: 'hoje', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: '90d', label: 'Últimos 90 dias' },
  { value: 'mes_atual', label: 'Este mês' },
  { value: 'mes_anterior', label: 'Mês passado' },
  { value: 'custom', label: 'Personalizado' },
];

function calcularIntervalo(preset, customInicio, customFim) {
  const fim = new Date();
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  fim.setHours(23, 59, 59, 999);

  switch (preset) {
    case 'hoje':
      return { inicio, fim };
    case '7d':
      inicio.setDate(inicio.getDate() - 6);
      return { inicio, fim };
    case '30d':
      inicio.setDate(inicio.getDate() - 29);
      return { inicio, fim };
    case '90d':
      inicio.setDate(inicio.getDate() - 89);
      return { inicio, fim };
    case 'mes_atual':
      return {
        inicio: new Date(fim.getFullYear(), fim.getMonth(), 1, 0, 0, 0),
        fim,
      };
    case 'mes_anterior': {
      const ini = new Date(fim.getFullYear(), fim.getMonth() - 1, 1, 0, 0, 0);
      const f = new Date(fim.getFullYear(), fim.getMonth(), 0, 23, 59, 59, 999);
      return { inicio: ini, fim: f };
    }
    case 'custom':
      return {
        inicio: customInicio ? new Date(customInicio + 'T00:00:00') : inicio,
        fim: customFim ? new Date(customFim + 'T23:59:59') : fim,
      };
    default:
      return { inicio, fim };
  }
}

// Mapeia o slug da URL pro componente da aba e seus metadados.
// A ordem aqui é a mesma do menu lateral (vira o seletor "Relatório").
const ABAS = {
  'visao-executiva': {
    titulo: 'Visão executiva',
    descricao: 'Visão consolidada do que está acontecendo no seu negócio.',
    Componente: AbaVisaoExecutiva,
  },
  'mensais': {
    titulo: 'Fechamento mensal',
    descricao: 'Histórico dos meses fechados. Snapshots gerados automaticamente todo dia 7 ou disparados manualmente.',
    Componente: AbaMensais,
    semPeriodo: true,
  },
  'crm': {
    titulo: 'CRM',
    descricao: 'Funil, origem dos leads, tempo médio por etapa e quem está parado.',
    Componente: AbaCRM,
  },
  'financeiro': {
    titulo: 'Financeiro',
    descricao: 'Resultado do período, fluxo de caixa, cobranças vencidas e detalhamento por categoria.',
    Componente: AbaFinanceiro,
  },
  'caixa': {
    titulo: 'Caixa',
    descricao: 'Sessões fechadas, retiradas, entradas e auditoria de diferenças de saldo.',
    Componente: AbaCaixa,
  },
  'vendas': {
    titulo: 'Vendas',
    descricao: 'Por canal, quando você vende mais, categoria e ranking de lucratividade.',
    Componente: AbaVendas,
  },
  'estoque': {
    titulo: 'Estoque & CMV',
    descricao: 'Valor parado, produtos por importância, margem por produto e estoque sem giro.',
    Componente: AbaEstoque,
  },
  'bots': {
    titulo: 'Bots / IA',
    descricao: 'Mensagens, ferramentas usadas, custo de IA e atendimentos bem-sucedidos.',
    Componente: AbaBots,
  },
};

const TH = 'text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const TD = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';
const classeCampo = 'h-9 px-2.5 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[13px] font-medium text-[var(--text-main)] focus:outline-none focus:border-[var(--primary)]';

export default function RelatoriosPage() {
  const { aba } = useParams();
  const navigate = useNavigate();
  const slug = ABAS[aba] ? aba : 'visao-executiva';
  const config = ABAS[slug];
  const [preset, setPreset] = useState('30d');
  const [customInicio, setCustomInicio] = useState('');
  const [customFim, setCustomFim] = useState('');

  // Periodo personalizado invertido (inicio depois do fim): avisa e usa as
  // datas na ordem certa, em vez de mandar um periodo impossivel.
  const periodoInvertido = preset === 'custom' && !!customInicio && !!customFim && customInicio > customFim;
  const intervalo = useMemo(
    () => (periodoInvertido
      ? calcularIntervalo(preset, customFim, customInicio)
      : calcularIntervalo(preset, customInicio, customFim)),
    [preset, customInicio, customFim, periodoInvertido]
  );

  const Componente = config.Componente;

  return (
    <Pagina>
      {/* Barra do topo: período (global) + qual relatório ver. Os filtros
          específicos de cada aba ficam no painel de filtros da própria aba. */}
      <div className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-2" data-no-print>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {!config.semPeriodo && (
            <>
              <span className="text-xs font-medium text-[var(--text-muted)] px-1">Período</span>
              <AbasPilula
                rotulo="Período do relatório"
                abas={PRESETS.map((p) => ({ valor: p.value, rotulo: p.label }))}
                valor={preset}
                onChange={setPreset}
              />
              {preset === 'custom' && (
                <div className="flex items-center gap-1.5">
                  <label className="sr-only" htmlFor="rel-ini">Data inicial</label>
                  <input id="rel-ini" type="date" value={customInicio} onChange={(e) => setCustomInicio(e.target.value)} className={classeCampo} />
                  <span className="text-xs text-[var(--text-muted)]">até</span>
                  <label className="sr-only" htmlFor="rel-fim">Data final</label>
                  <input id="rel-fim" type="date" value={customFim} onChange={(e) => setCustomFim(e.target.value)} className={classeCampo} />
                </div>
              )}
            </>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
              Relatório
              <select
                value={slug}
                onChange={(e) => navigate(`/app/relatorios/${e.target.value}`)}
                className={classeCampo}
              >
                {Object.entries(ABAS).map(([k, a]) => (
                  <option key={k} value={k}>{a.titulo}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1.5 text-xs text-[var(--text-muted)]">
          {!config.semPeriodo && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar size={12} aria-hidden="true" />
              {intervalo.inicio.toLocaleDateString('pt-BR')} até {intervalo.fim.toLocaleDateString('pt-BR')}
            </span>
          )}
          <span>{config.descricao}</span>
        </div>
        {periodoInvertido && (
          <p role="alert" className="m-0 px-1 pt-1.5 text-xs font-medium text-[var(--warning-text)]">
            A data inicial era depois da final — mostrando de {intervalo.inicio.toLocaleDateString('pt-BR')} até {intervalo.fim.toLocaleDateString('pt-BR')}.
          </p>
        )}
      </div>

      <Componente intervalo={intervalo} />
    </Pagina>
  );
}

// Coloca o "Exportar" da aba no topo da tela (botão principal do Topbar).
// Guarda o montarDados mais recente num ref, pra exportar sempre o que está
// na tela (filtros incluídos) sem recriar o botão a cada render.
function useExportarNoTopo(montarDados, dados) {
  const ref = useRef(montarDados);
  useEffect(() => { ref.current = montarDados; });
  const montar = useCallback(() => ref.current(), []);
  const pronto = !!dados;
  useAcaoTopo(<BotaoExportar montarDados={montar} desabilitado={!pronto} />, [pronto, montar]);
}

// Rótulo de número com explicação ao passar o mouse (title nativo, que não
// é cortado pelo truncate do cartão).
function rotuloInfo(texto, info) {
  if (!info) return texto;
  return <span title={info} className="cursor-help">{texto}</span>;
}

// Painel de filtros da aba: filtros rápidos/campos + rodapé com contador,
// chips removíveis e "Limpar tudo" (mesmo comportamento do BarraFiltros).
function PainelFiltros({ children, contador, filtrosAtivos = [], onLimparTudo }) {
  const ativos = filtrosAtivos.filter(Boolean);
  return (
    <section aria-label="Filtros do relatório" className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] px-4 py-3 flex flex-col gap-3" data-no-print>
      {children}
      {(contador || ativos.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[var(--border-subtle)]">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {contador && <span className="text-xs font-semibold text-[var(--text-secondary)] mr-2">{contador}</span>}
            {ativos.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={f.onRemover}
                aria-label={`Remover filtro ${f.rotulo}`}
                className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold bg-[var(--accent-soft)] text-[var(--accent-text)] hover:opacity-80 transition-opacity"
              >
                {f.rotulo}
                <X size={11} strokeWidth={2.5} aria-hidden="true" />
              </button>
            ))}
          </div>
          {ativos.length > 0 && onLimparTudo && (
            <button
              type="button"
              onClick={onLimparTudo}
              className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--danger-text)] hover:underline"
            >
              Limpar tudo
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// Lista "rótulo ... valor" com barrinha proporcional (ex.: "Como pagaram").
function ListaBarras({ itens, carregando, vazio = 'Sem dados no período.', cor = 'var(--primary)' }) {
  if (carregando && !itens) return <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Calculando…</div>;
  if (!itens || itens.length === 0) return <div className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">{vazio}</div>;
  const total = itens.reduce((a, i) => a + (Number(i.valor) || 0), 0);
  return (
    <div className="px-4 py-3.5 flex flex-col gap-3 text-[13px]">
      {itens.map((i) => {
        const pct = total > 0 ? ((Number(i.valor) || 0) / total) * 100 : 0;
        return (
          <div key={i.chave}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 [overflow-wrap:anywhere] text-[var(--text-secondary)]">
                {i.rotulo}
                {i.extra && <span className="ml-1.5 text-xs text-[var(--text-muted)]">{i.extra}</span>}
              </span>
              <span className="flex-shrink-0 tabular-nums">
                <strong className="text-[var(--text-main)]">{i.valorTexto ?? fmtPct(pct)}</strong>
                {i.valorTexto && <span className="ml-1.5 text-xs text-[var(--text-muted)]">{fmtPct(pct)}</span>}
              </span>
            </div>
            <div className="h-2 rounded bg-[var(--bg-subtle)] mt-1.5" aria-hidden="true">
              <div className="h-2 rounded" style={{ width: `${pct}%`, backgroundColor: i.cor || cor }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Gráfico de barras do faturamento (mesmo desenho do mockup): agrupa a
// receita paga por dia, semana ou mês conforme o tamanho do período e
// destaca a melhor barra.
function agruparFaturamento(fluxo, intervalo) {
  if (!fluxo || fluxo.length === 0) return { unidade: 'dia', barras: [] };
  const dias = Math.round((intervalo.fim - intervalo.inicio) / 86400000) + 1;
  const unidade = dias <= 14 ? 'dia' : dias <= 92 ? 'semana' : 'mês';
  const grupos = new Map();
  for (const f of fluxo) {
    const [a, m, d] = f.data.split('-').map(Number);
    const dt = new Date(a, m - 1, d);
    let chave;
    let rotulo;
    if (unidade === 'dia') {
      chave = f.data;
      rotulo = dias <= 7 ? dt.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') : `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
    } else if (unidade === 'semana') {
      const ini = new Date(dt);
      ini.setDate(dt.getDate() - dt.getDay());
      chave = ini.toISOString().slice(0, 10);
      rotulo = `${String(ini.getDate()).padStart(2, '0')}/${String(ini.getMonth() + 1).padStart(2, '0')}`;
    } else {
      chave = `${a}-${m}`;
      rotulo = dt.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    }
    const g = grupos.get(chave) || { chave, rotulo, valor: 0 };
    g.valor += Number(f.receita) || 0;
    grupos.set(chave, g);
  }
  return { unidade, barras: [...grupos.values()].sort((x, y) => (x.chave < y.chave ? -1 : 1)) };
}

function GraficoBarrasFaturamento({ barras, carregando }) {
  if (carregando && !barras) return <div className="px-4 py-12 text-center text-[13px] text-[var(--text-muted)]">Calculando…</div>;
  if (!barras || barras.length === 0 || barras.every((b) => b.valor === 0)) {
    return <div className="px-4 py-12 text-center text-[13px] text-[var(--text-muted)]">Sem faturamento no período.</div>;
  }
  const max = Math.max(...barras.map((b) => b.valor));
  const compacto = barras.length > 12;
  return (
    <div className="overflow-x-auto">
      <div
        className="px-4 pt-4 pb-3 flex items-end gap-2 h-[200px]"
        style={{ minWidth: compacto ? `${barras.length * 34}px` : undefined }}
        role="img"
        aria-label={`Faturamento: ${barras.map((b) => `${b.rotulo} ${fmtBRL(b.valor)}`).join(', ')}`}
      >
        {barras.map((b) => {
          const melhor = b.valor === max;
          return (
            <div key={b.chave} className="flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1.5" title={`${b.rotulo}: ${fmtBRL(b.valor)}`}>
              {!compacto && (
                <span className="text-[11px] font-semibold text-[var(--text-secondary)] whitespace-nowrap tabular-nums">
                  {Number(b.valor).toLocaleString('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL' })}
                </span>
              )}
              <div
                className="w-[70%] max-w-16 rounded-t"
                style={{
                  height: `${Math.max(4, Math.round((b.valor / max) * 140))}px`,
                  backgroundColor: melhor ? 'var(--primary)' : 'color-mix(in srgb, var(--primary) 45%, transparent)',
                }}
              />
              <span className="text-[11px] font-medium text-[var(--text-muted)] whitespace-nowrap">{b.rotulo}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LegendaFaturamento({ unidade }) {
  return (
    <div className="flex gap-3 text-xs font-medium text-[var(--text-muted)]">
      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--primary)]" aria-hidden="true" /> Melhor {unidade}</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 45%, transparent)' }} aria-hidden="true" /> Demais</span>
    </div>
  );
}

const CORES_PAGAMENTO = ['var(--primary)', 'var(--info)', 'var(--warning)', 'var(--accent)', 'var(--success)', 'var(--danger)'];
const NOMES_METODO = {
  PIX: 'Pix', CREDITO: 'Cartão de crédito', DEBITO: 'Cartão de débito', DINHEIRO: 'Dinheiro',
  BOLETO: 'Boleto', TRANSFERENCIA: 'Transferência', CARTAO: 'Cartão',
};
const itensPagamento = (porMetodo) => porMetodo?.map((m, i) => ({
  chave: m.metodo,
  rotulo: NOMES_METODO[m.metodo] || m.metodo,
  extra: `${fmtNum(m.qtd)}×`,
  valor: m.valor,
  valorTexto: fmtBRL(m.valor),
  cor: CORES_PAGAMENTO[i % CORES_PAGAMENTO.length],
}));

// ============================================================
// ABA: Visao Executiva
// ============================================================
// Além do /relatorios/visao-executiva, puxa (em paralelo e sem travar a
// tela se falhar) o /relatorios/financeiro — pro gráfico de faturamento e
// "Como pagaram" — e o /relatorios/crm — pro "Dinheiro na mesa".
function AbaVisaoExecutiva({ intervalo }) {
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [fin, setFin] = useState(null);
  const [crm, setCrm] = useState(null);
  const navigate = useNavigate();

  // Periodo/filtros mudaram: liga o carregando e limpa o erro ja no render
  // (guardando a chave da busca) em vez de setState sincrono no efeito.
  const tIni = intervalo.inicio.getTime();
  const tFim = intervalo.fim.getTime();
  const chaveBusca = `${tIni}|${tFim}`;
  const [chaveBuscaAnterior, setChaveBuscaAnterior] = useState(null);
  if (chaveBuscaAnterior !== chaveBusca) {
    setChaveBuscaAnterior(chaveBusca);
    setCarregando(true);
    setErro(null);
  }

  useEffect(() => {
    let ativo = true;
    const params = {
      inicio: new Date(tIni).toISOString(),
      fim: new Date(tFim).toISOString(),
    };
    api.get('/relatorios/visao-executiva', { params })
      .then((r) => { if (ativo) setDados(r.data); })
      .catch((e) => { if (ativo) setErro(e?.response?.data?.error || 'Erro ao carregar.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    api.get('/relatorios/financeiro', { params })
      .then((r) => { if (ativo) setFin(r.data); })
      .catch(() => { if (ativo) setFin(null); });
    api.get('/relatorios/crm', { params })
      .then((r) => { if (ativo) setCrm(r.data); })
      .catch(() => { if (ativo) setCrm(null); });
    return () => { ativo = false; };
  }, [tIni, tFim]);

  const montarDados = () => ({
    nome: 'relatorio-visao-executiva',
    titulo: 'Relatório · Visão executiva',
    secoes: [
      {
        titulo: 'Resumo',
        colunas: [
          { chave: 'indicador', label: 'Indicador' },
          { chave: 'valor', label: 'Valor' },
        ],
        linhas: dados ? [
          { indicador: 'Faturamento', valor: fmtBRL(dados.faturamento.valor) },
          { indicador: 'Lucro líquido', valor: fmtBRL(dados.lucroLiquido.valor) },
          { indicador: 'Margem líquida', valor: fmtPct(dados.lucroLiquido.margem) },
          { indicador: 'CMV', valor: fmtBRL(dados.cmv.valor) },
          { indicador: 'Vendas no período', valor: fmtNum(dados.vendas.total) },
          { indicador: 'Ticket médio', valor: fmtBRL(dados.vendas.ticketMedio) },
          { indicador: 'Novos clientes', valor: fmtNum(dados.leads.criados) },
          { indicador: 'Atrasado a receber', valor: fmtBRL(dados.caixa.emRisco) },
          { indicador: 'Saldo do período', valor: fmtBRL(dados.caixa.saldoPeriodo) },
        ] : [],
      },
      {
        titulo: 'Top produtos vendidos',
        colunas: [
          { chave: 'nome', label: 'Produto' },
          { chave: 'quantidade', label: 'Quantidade', valor: (p) => fmtNum(p.quantidade) },
          { chave: 'valor', label: 'Receita', valor: (p) => fmtBRL(p.valor) },
        ],
        linhas: dados?.topProdutos || [],
      },
    ],
  });
  useExportarNoTopo(montarDados, dados);

  const { unidade, barras } = useMemo(() => agruparFaturamento(fin?.fluxoDiario, intervalo), [fin, intervalo]);
  const parados = crm?.leadsParados || [];
  const valorParados = parados.reduce((a, l) => a + (Number(l.valor) || 0), 0);
  const emRisco = dados?.caixa.emRisco || 0;
  const valorFunil = crm?.totais?.valorTotalFunil || 0;
  const totalNaMesa = emRisco + valorFunil;

  return (
    <>
      {erro && <ErroBox mensagem={erro} />}

      <FaixaNumeros min={200}>
        <Numero destaque rotulo="Faturamento" valor={fmtBRL(dados?.faturamento.valor)}
          detalhe={fmtDelta(dados?.faturamento.delta)} carregando={carregando} />
        <Numero rotulo={rotuloInfo('Ticket médio', 'Quanto cada cliente gasta em média por venda.')}
          valor={fmtBRL(dados?.vendas.ticketMedio)}
          detalhe={dados ? `${fmtNum(dados.vendas.total)} venda(s) no período` : null} carregando={carregando} />
        <Numero rotulo={rotuloInfo('Lucro líquido', 'Quanto sobrou depois de pagar tudo (vendas menos despesas).')}
          valor={fmtBRL(dados?.lucroLiquido.valor)}
          tom={dados?.lucroLiquido.valor < 0 ? 'perigo' : 'neutro'}
          detalhe={dados ? `Margem ${fmtPct(dados.lucroLiquido.margem)}` : null} carregando={carregando} />
        <Numero rotulo={rotuloInfo('Clientes novos', 'Pessoas que entraram no funil no período.')}
          valor={fmtNum(dados?.leads.criados)}
          detalhe={fmtDelta(dados?.leads.delta)} tomDetalhe={tomDelta(dados?.leads.delta)} carregando={carregando} />
      </FaixaNumeros>

      <ColunasPagina
        lateral={(
          <>
            <Painel
              titulo="Dinheiro na mesa"
              acoes={totalNaMesa > 0 ? <Badge variant="warning">{fmtBRL(totalNaMesa)} possíveis</Badge> : null}
              semPadding
            >
              <p className="m-0 px-4 pt-3 text-xs text-[var(--text-muted)]">O que o sistema achou pra você vender ou receber.</p>
              <ItemMesa
                titulo={`${fmtNum(dados?.caixa.emRiscoQtd)} cobrança(s) vencida(s)`}
                etiqueta={<Badge variant={emRisco > 0 ? 'danger' : 'success'}>{emRisco > 0 ? fmtBRL(emRisco) : 'Tudo em dia'}</Badge>}
                texto={emRisco > 0 ? 'Clientes que já deviam ter pago. Vale cobrar antes que esfrie.' : 'Nenhuma cobrança vencida até agora.'}
                acao={<Button size="sm" variant="secondary" onClick={() => navigate('/app/relatorios/financeiro')}>Ver dívidas</Button>}
              />
              {crm && (
                <ItemMesa
                  titulo={`${fmtNum(parados.length)} cliente(s) sem contato`}
                  etiqueta={<Badge variant={parados.length > 0 ? 'warning' : 'success'}>7+ dias</Badge>}
                  texto={parados.length > 0
                    ? `Parados no funil${valorParados > 0 ? `, somando ${fmtBRL(valorParados)} em potencial` : ''}. Chame antes que esfriem.`
                    : 'Todo mundo do funil teve contato recente.'}
                  acao={<Button size="sm" variant="secondary" onClick={() => navigate('/app/relatorios/crm')}>Ver quem chamar</Button>}
                />
              )}
              {crm && (
                <ItemMesa
                  ultimo
                  titulo={`${fmtNum(crm.totais?.leadsAbertos)} em negociação`}
                  etiqueta={<Badge variant="info">{fmtBRL(valorFunil)}</Badge>}
                  texto="Valor potencial do que está no funil agora. Fechar uma parte já faz diferença no mês."
                />
              )}
            </Painel>

            <Painel titulo="Como pagaram" subtitulo="Recebimentos pagos no período" semPadding>
              <ListaBarras itens={itensPagamento(fin?.porMetodo)} carregando={!fin && carregando} vazio="Sem recebimentos no período." />
            </Painel>

            <Painel titulo="Resumo do período" semPadding>
              <LinhaInfo rotulo="Custo dos produtos (CMV)" valor={dados ? `${fmtBRL(dados.cmv.valor)} · ${fmtPct(dados.cmv.percentual)}` : '—'} />
              <LinhaInfo rotulo="Lucro bruto" valor={dados ? fmtBRL(dados.cmv.lucroBruto) : '—'} />
              <LinhaInfo rotulo="Margem bruta" valor={dados?.faturamento.valor > 0 ? fmtPct((dados.cmv.lucroBruto / dados.faturamento.valor) * 100) : '—'} />
              <LinhaInfo rotulo="Total recebido" valor={dados ? fmtBRL(dados.caixa.receitaPaga) : '—'} />
              <LinhaInfo rotulo="Total pago" valor={dados ? fmtBRL(dados.caixa.despesaPaga) : '—'} />
              <LinhaInfo rotulo="Saldo do período" forte valor={dados ? fmtBRL(dados.caixa.saldoPeriodo) : '—'} />
            </Painel>
          </>
        )}
      >
        <Painel titulo={`Faturamento por ${unidade}`} acoes={<LegendaFaturamento unidade={unidade} />} semPadding>
          <GraficoBarrasFaturamento barras={fin ? barras : null} carregando={carregando || !fin} />
        </Painel>

        <Painel
          titulo="O que mais vende"
          acoes={dados ? <span className="text-xs text-[var(--text-muted)]">{dados.topProdutos.length} produto(s) no período</span> : null}
          semPadding
          corpoClassName="overflow-x-auto"
        >
          <TabelaTopProdutos
            itens={dados?.topProdutos}
            carregando={carregando}
            colunas={[
              { label: 'Qtd', valor: (p) => fmtNum(p.quantidade), align: 'right' },
              { label: 'Total', valor: (p) => fmtBRL(p.valor), align: 'right', destaque: 'success' },
            ]}
          />
        </Painel>
      </ColunasPagina>
    </>
  );
}

function ItemMesa({ titulo, etiqueta, texto, acao, ultimo = false }) {
  return (
    <div className={`px-4 py-3.5 flex flex-col gap-1.5 ${ultimo ? '' : 'border-b border-[var(--border-subtle)]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm text-[var(--text-main)]">{titulo}</strong>
        {etiqueta}
      </div>
      <span className="text-[13px] text-[var(--text-secondary)] [overflow-wrap:anywhere]">{texto}</span>
      {acao && <div>{acao}</div>}
    </div>
  );
}


// ============================================================
// ABA: CRM
// ============================================================
function AbaCRM({ intervalo }) {
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [etapas, setEtapas] = useState([]);
  const [filtros, setFiltros] = useState({ etapaId: '', origem: '', filtroRapido: '' });

  // Carrega lista de etapas pro select.
  useEffect(() => {
    let ativo = true;
    api.get('/crm/stages').then((r) => {
      if (ativo) setEtapas(Array.isArray(r.data) ? r.data : []);
    }).catch(() => { if (ativo) setEtapas([]); });
    return () => { ativo = false; };
  }, []);

  // Periodo/filtros mudaram: liga o carregando e limpa o erro ja no render
  // (guardando a chave da busca) em vez de setState sincrono no efeito.
  const tIni = intervalo.inicio.getTime();
  const tFim = intervalo.fim.getTime();
  const chaveBusca = `${tIni}|${tFim}|${filtros.etapaId}|${filtros.origem}`;
  const [chaveBuscaAnterior, setChaveBuscaAnterior] = useState(null);
  if (chaveBuscaAnterior !== chaveBusca) {
    setChaveBuscaAnterior(chaveBusca);
    setCarregando(true);
    setErro(null);
  }

  useEffect(() => {
    let ativo = true;
    api.get('/relatorios/crm', {
      params: {
        inicio: new Date(tIni).toISOString(),
        fim: new Date(tFim).toISOString(),
        ...(filtros.etapaId ? { etapaId: filtros.etapaId } : {}),
        ...(filtros.origem ? { origem: filtros.origem } : {}),
      },
    })
      .then((r) => { if (ativo) setDados(r.data); })
      .catch((e) => { if (ativo) setErro(e?.response?.data?.error || 'Erro ao carregar.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [tIni, tFim, filtros.etapaId, filtros.origem]);

  // Filtros rápidos do CRM: cada um responde a uma pergunta de negócio.
  // "Última etapa" = etapa final do funil (geralmente "Fechado"/"Convertido").
  // Quando o filtro é orientado a etapa, setamos `etapaId`; quando é por
  // origem (ex.: "Vindos do bot"), setamos `origem`.
  const ultimaEtapa = etapas[etapas.length - 1];
  const aplicarRapido = (chave) => {
    const presets = {
      'vindos-bot':     { etapaId: '', origem: 'AI' },
      'manuais':        { etapaId: '', origem: 'Manual' },
      'leads-quentes':  { etapaId: ultimaEtapa?.id || '', origem: '' },
    };
    if (!chave || !presets[chave]) {
      setFiltros({ etapaId: '', origem: '', filtroRapido: '' });
      return;
    }
    setFiltros({ ...presets[chave], filtroRapido: chave });
  };

  const mudarEtapa = (id) => setFiltros((f) => ({ ...f, etapaId: id || '', filtroRapido: '' }));
  const mudarOrigem = (origem) => setFiltros((f) => ({ ...f, origem: origem || '', filtroRapido: '' }));
  const limparTudo = () => setFiltros({ etapaId: '', origem: '', filtroRapido: '' });

  const etapaSelecionada = etapas.find((e) => e.id === filtros.etapaId);
  const filtrosAtivos = [
    filtros.filtroRapido && {
      rotulo: { 'vindos-bot': 'Vindos do bot', 'manuais': 'Cadastrados manualmente', 'leads-quentes': 'Leads quentes' }[filtros.filtroRapido],
      onRemover: () => aplicarRapido(null),
    },
    !filtros.filtroRapido && etapaSelecionada && {
      rotulo: `Etapa: ${etapaSelecionada.nome}`,
      onRemover: () => mudarEtapa(''),
    },
    !filtros.filtroRapido && filtros.origem && {
      rotulo: `Origem: ${filtros.origem}`,
      onRemover: () => mudarOrigem(''),
    },
  ].filter(Boolean);

  const contadorTotal = dados?.totais?.leadsAbertos;
  const contador = contadorTotal !== undefined ? `${contadorTotal} cliente(s) em negociação` : null;

  const montarDados = () => ({
    nome: 'relatorio-crm',
    titulo: 'Relatório · Clientes',
    filtrosAtivos: filtrosAtivos.map((f) => f.rotulo),
    secoes: [
      {
        titulo: 'Resumo',
        colunas: [{ chave: 'indicador', label: 'Indicador' }, { chave: 'valor', label: 'Valor' }],
        linhas: dados ? [
          { indicador: 'Clientes em negociação', valor: fmtNum(dados.totais.leadsAbertos) },
          { indicador: 'Valor potencial em vendas', valor: fmtBRL(dados.totais.valorTotalFunil) },
          { indicador: 'Novos clientes no período', valor: fmtNum(dados.totais.criadosPeriodo) },
          { indicador: 'Conversões no período', valor: fmtNum(dados.totais.conversoesPeriodo) },
        ] : [],
      },
      {
        titulo: 'Funil de conversão',
        colunas: [
          { chave: 'nome', label: 'Etapa' },
          { chave: 'leads', label: 'Clientes' },
          { chave: 'valor', label: 'Valor potencial', valor: (e) => fmtBRL(e.valor) },
        ],
        linhas: dados?.funil || [],
      },
      {
        titulo: 'Clientes sem contato',
        colunas: [
          { chave: 'nome', label: 'Nome' },
          { chave: 'etapa', label: 'Etapa' },
          { chave: 'diasParado', label: 'Dias sem contato' },
        ],
        linhas: dados?.leadsParados || [],
      },
      {
        titulo: 'De onde vieram os clientes',
        colunas: [
          { chave: 'origem', label: 'Origem' },
          { chave: 'qtd', label: 'Quantidade' },
        ],
        linhas: dados?.origens || [],
      },
    ],
  });

  useExportarNoTopo(montarDados, dados);

  return (
    <>
      {erro && <ErroBox mensagem={erro} />}

      <PainelFiltros
        contador={contador}
        filtrosAtivos={filtrosAtivos}
        onLimparTudo={limparTudo}
      >
        <FiltroRapido
          ativo={filtros.filtroRapido}
          onChange={aplicarRapido}
          opcoes={[
            { chave: 'vindos-bot', label: 'Vindos do bot' },
            { chave: 'manuais', label: 'Cadastrados manualmente' },
            { chave: 'leads-quentes', label: 'Leads quentes (etapa final)' },
          ]}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Combobox
            size="sm"
            label="Filtrar por etapa do funil"
            value={filtros.etapaId}
            onChange={(id) => mudarEtapa(id)}
            placeholder="Todas as etapas"
            options={etapas.map((e) => ({ value: e.id, label: e.nome }))}
            clearable
          />
          <Input
            size="sm"
            label="De onde veio o cliente"
            value={filtros.origem}
            onChange={(e) => mudarOrigem(e.target.value)}
            placeholder="Ex.: WhatsApp, Instagram, indicação..."
          />
        </div>
      </PainelFiltros>

      <FaixaNumeros min={200}>
        <Numero destaque rotulo="Clientes em negociação"
          valor={fmtNum(dados?.totais.leadsAbertos)}
          detalhe={dados ? `Potencial ${fmtBRL(dados.totais.valorTotalFunil)}` : null}
          carregando={carregando} />
        <Numero rotulo="Novos clientes no período"
          valor={fmtNum(dados?.totais.criadosPeriodo)} carregando={carregando} />
        <Numero rotulo={rotuloInfo('Vendas fechadas', 'Clientes que viraram venda no período.')}
          valor={fmtNum(dados?.totais.conversoesPeriodo)}
          detalhe={dados?.totais.taxaConversao !== null && dados?.totais.taxaConversao !== undefined
            ? `Taxa ${fmtPct(dados.totais.taxaConversao)}` : null}
          tomDetalhe="sucesso"
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Sem contato há 7+ dias', 'Clientes parados no funil que precisam de atenção.')}
          valor={fmtNum(dados?.leadsParados.length)}
          tom={dados?.leadsParados.length > 0 ? 'alerta' : 'neutro'}
          detalhe="Sem contato recente"
          carregando={carregando} />
      </FaixaNumeros>

      <ColunasPagina
        lateral={(
          <>
            <Painel titulo="Origem dos leads" subtitulo="No período selecionado" semPadding corpoClassName="overflow-x-auto">
              <TabelaOrigens origens={dados?.origens} carregando={carregando} />
            </Painel>
            <Painel titulo="Tempo médio por etapa" subtitulo="Baseado nos últimos 60 dias" semPadding corpoClassName="overflow-x-auto">
              <TabelaTempoEtapas tempos={dados?.tempoMedioPorEtapa} carregando={carregando} />
            </Painel>
          </>
        )}
      >
        <Painel titulo="Funil de conversão" subtitulo="Leads atualmente em cada etapa do CRM (independente do período)" semPadding>
          <FunilEtapas funil={dados?.funil} carregando={carregando} />
        </Painel>

        <Painel
          titulo={<TituloSecao titulo="Clientes sem contato" info="Clientes parados no funil há vários dias. Vale dar uma atenção pra não esfriar." />}
          subtitulo="Sem contato registrado há mais de 7 dias — chame eles"
          semPadding
          corpoClassName="overflow-x-auto"
        >
          <TabelaLeadsParados leads={dados?.leadsParados} carregando={carregando} />
        </Painel>

        <Painel
          titulo="Top produtos no funil"
          subtitulo="Produtos com mais interesse de leads (não convertidos)"
          acoes={dados ? <Badge variant="neutral">{dados.topProdutosNoFunil.length}</Badge> : null}
          semPadding
          corpoClassName="overflow-x-auto"
        >
          <TabelaTopProdutos
            itens={dados?.topProdutosNoFunil}
            carregando={carregando}
            mensagemVazia="Nenhum produto vinculado a leads ainda."
            colunas={[
              { label: 'Leads interessados', valor: (p) => fmtNum(p.leads), align: 'right' },
              { label: 'Qtd. total', valor: (p) => fmtNum(p.quantidadeTotal), align: 'right' },
              { label: 'Valor potencial', valor: (p) => fmtBRL(p.valorPotencial), align: 'right', destaque: 'success' },
            ]}
          />
        </Painel>
      </ColunasPagina>
    </>
  );
}

// ============================================================
// ABA: Financeiro
// ============================================================
function AbaFinanceiro({ intervalo }) {
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [categorias, setCategorias] = useState([]);
  const [filtros, setFiltros] = useState({ categoriaId: '', tipo: '', subTipo: '', filtroRapido: '' });

  useEffect(() => {
    let ativo = true;
    api.get('/financeiro/categorias').then((r) => {
      if (ativo) setCategorias(Array.isArray(r.data) ? r.data : []);
    }).catch(() => { if (ativo) setCategorias([]); });
    return () => { ativo = false; };
  }, []);

  // Periodo/filtros mudaram: liga o carregando e limpa o erro ja no render
  // (guardando a chave da busca) em vez de setState sincrono no efeito.
  const tIni = intervalo.inicio.getTime();
  const tFim = intervalo.fim.getTime();
  const chaveBusca = `${tIni}|${tFim}|${filtros.categoriaId}|${filtros.tipo}|${filtros.subTipo}`;
  const [chaveBuscaAnterior, setChaveBuscaAnterior] = useState(null);
  if (chaveBuscaAnterior !== chaveBusca) {
    setChaveBuscaAnterior(chaveBusca);
    setCarregando(true);
    setErro(null);
  }

  useEffect(() => {
    let ativo = true;
    api.get('/relatorios/financeiro', {
      params: {
        inicio: new Date(tIni).toISOString(),
        fim: new Date(tFim).toISOString(),
        ...(filtros.categoriaId ? { categoriaId: filtros.categoriaId } : {}),
        ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
        ...(filtros.subTipo ? { subTipo: filtros.subTipo } : {}),
      },
    })
      .then((r) => { if (ativo) setDados(r.data); })
      .catch((e) => { if (ativo) setErro(e?.response?.data?.error || 'Erro ao carregar.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [tIni, tFim, filtros.categoriaId, filtros.tipo, filtros.subTipo]);

  // Filtros rápidos: aplicam combinações pré-configuradas. Setam o flag
  // `filtroRapido` para marcar a pílula ativa visualmente.
  const aplicarRapido = (chave) => {
    const presets = {
      'recebidos':           { categoriaId: '', tipo: 'RECEITA', subTipo: '' },
      'despesas-todas':      { categoriaId: '', tipo: 'DESPESA', subTipo: '' },
      'despesas-fixas':      { categoriaId: '', tipo: 'DESPESA', subTipo: 'FIXA' },
      'despesas-variaveis':  { categoriaId: '', tipo: 'DESPESA', subTipo: 'VARIAVEL' },
    };
    if (!chave || !presets[chave]) {
      setFiltros({ categoriaId: '', tipo: '', subTipo: '', filtroRapido: '' });
      return;
    }
    setFiltros({ ...presets[chave], filtroRapido: chave });
  };

  const mudarCategoria = (id) => setFiltros((f) => ({ ...f, categoriaId: id || '', filtroRapido: '' }));
  const mudarTipo = (tipo) => setFiltros((f) => ({ ...f, tipo: tipo || '', subTipo: '', filtroRapido: '' }));
  const limparTudo = () => setFiltros({ categoriaId: '', tipo: '', subTipo: '', filtroRapido: '' });

  const categoriaSelecionada = categorias.find((c) => c.id === filtros.categoriaId);
  const filtrosAtivos = [
    filtros.filtroRapido && {
      rotulo: { 'recebidos': 'Recebimentos', 'despesas-todas': 'Despesas', 'despesas-fixas': 'Despesas fixas', 'despesas-variaveis': 'Despesas variáveis' }[filtros.filtroRapido],
      onRemover: () => aplicarRapido(null),
    },
    !filtros.filtroRapido && filtros.tipo && {
      rotulo: filtros.tipo === 'RECEITA' ? 'Apenas receitas' : 'Apenas despesas',
      onRemover: () => mudarTipo(''),
    },
    categoriaSelecionada && {
      rotulo: `Categoria: ${categoriaSelecionada.nome}`,
      onRemover: () => mudarCategoria(''),
    },
  ].filter(Boolean);

  const totalLancamentos = dados?.totalLancamentos ?? dados?.lancamentos?.length;
  const contador = totalLancamentos !== undefined ? `${totalLancamentos} lançamento(s)` : null;

  const montarDados = () => ({
    nome: 'relatorio-financeiro',
    titulo: 'Relatório · Financeiro',
    filtrosAtivos: filtrosAtivos.map((f) => f.rotulo),
    secoes: [
      {
        titulo: 'Resumo do resultado',
        colunas: [{ chave: 'item', label: 'Item' }, { chave: 'valor', label: 'Valor' }],
        linhas: dados ? [
          { item: 'Total que entrou', valor: fmtBRL(dados.dre.receitaBruta) },
          { item: 'Custos variáveis', valor: fmtBRL(dados.dre.despesasVariaveis) },
          { item: 'Sobra antes das despesas fixas', valor: fmtBRL(dados.dre.receitaBruta - dados.dre.despesasVariaveis) },
          { item: 'Despesas fixas', valor: fmtBRL(dados.dre.despesasFixas) },
          { item: 'Lucro do período', valor: fmtBRL(dados.dre.resultadoLiquido) },
          { item: 'Margem de lucro', valor: fmtPct(dados.dre.margemLiquida) },
        ] : [],
      },
      {
        titulo: 'Receitas por categoria',
        colunas: [
          { chave: 'categoria', label: 'Categoria' },
          { chave: 'valor', label: 'Valor', valor: (l) => fmtBRL(l.valor) },
        ],
        linhas: dados?.receitasPorCategoria || [],
      },
      {
        titulo: 'Despesas por categoria',
        colunas: [
          { chave: 'categoria', label: 'Categoria' },
          { chave: 'valor', label: 'Valor', valor: (l) => fmtBRL(l.valor) },
        ],
        linhas: dados?.despesasPorCategoria || [],
      },
      {
        titulo: 'Dívidas por tempo de atraso',
        colunas: [
          { chave: 'descricao', label: 'Descrição' },
          { chave: 'lead', label: 'Cliente', valor: (i) => i.lead?.nome || '—' },
          { chave: 'valor', label: 'Valor', valor: (i) => fmtBRL(i.valor) },
          { chave: 'dataVencimento', label: 'Venceu em', valor: (i) => new Date(i.dataVencimento).toLocaleDateString('pt-BR') },
        ],
        linhas: dados?.receitasPendentesVencidas || [],
      },
    ],
  });

  useExportarNoTopo(montarDados, dados);

  return (
    <>
      {erro && <ErroBox mensagem={erro} />}

      <PainelFiltros
        contador={contador}
        filtrosAtivos={filtrosAtivos}
        onLimparTudo={limparTudo}
      >
        <FiltroRapido
          ativo={filtros.filtroRapido}
          onChange={aplicarRapido}
          opcoes={[
            { chave: 'recebidos', label: 'Recebimentos do período' },
            { chave: 'despesas-todas', label: 'Todas as despesas' },
            { chave: 'despesas-fixas', label: 'Despesas fixas' },
            { chave: 'despesas-variaveis', label: 'Despesas variáveis' },
          ]}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Combobox
            size="sm"
            label="Filtrar por categoria"
            value={filtros.categoriaId}
            onChange={(id) => mudarCategoria(id)}
            placeholder="Todas as categorias"
            options={categorias.map((c) => ({
              value: c.id,
              label: c.nome,
              sublabel: c.tipo === 'RECEITA' ? 'Receita' : `Despesa${c.subTipo ? ` · ${c.subTipo === 'FIXA' ? 'Fixa' : 'Variável'}` : ''}`,
            }))}
            clearable
          />
          {!filtros.filtroRapido && (
            <div className="flex items-end gap-1.5">
              <span className="text-xs text-[var(--text-muted)] mr-1 pb-2">Tipo:</span>
              <AbasPilula
                rotulo="Tipo de lançamento"
                abas={[{ valor: 'RECEITA', rotulo: 'Receitas' }, { valor: 'DESPESA', rotulo: 'Despesas' }]}
                valor={filtros.tipo}
                onChange={(t) => mudarTipo(filtros.tipo === t ? '' : t)}
              />
            </div>
          )}
        </div>
      </PainelFiltros>

      <FaixaNumeros min={200}>
        <Numero destaque rotulo={rotuloInfo('Lucro do período', 'Receita menos despesa no período (resultado líquido).')}
          valor={fmtBRL(dados?.dre.resultadoLiquido)}
          detalhe={dados ? `Margem ${fmtPct(dados.dre.margemLiquida)}` : null}
          carregando={carregando} />
        <Numero rotulo="Total recebido"
          valor={fmtBRL(dados?.dre.receitaBruta)}
          detalhe={contador}
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Atrasado a receber', 'Cobranças que venceram e o cliente ainda não pagou.')}
          valor={fmtBRL(dados?.kpis.saldoEmRisco)}
          tom={dados?.kpis.saldoEmRisco > 0 ? 'perigo' : 'neutro'}
          detalhe={dados ? `${dados.kpis.saldoEmRiscoQtd} título(s)` : null}
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Taxa de recebimento', '% das cobranças que foram pagas em dia.')}
          valor={dados ? fmtPct(dados.kpis.indiceEficacia) : '—'}
          detalhe={dados ? `Previsão recuperar ${fmtBRL(dados.kpis.previsaoRecuperacao)}` : null}
          carregando={carregando} />
      </FaixaNumeros>

      <ColunasPagina
        lateral={(
          <>
            <Painel titulo="Como pagaram" subtitulo="Recebimentos por método · só o que foi pago" semPadding>
              <ListaBarras itens={itensPagamento(dados?.porMetodo)} carregando={carregando} vazio="Sem recebimentos no período." />
            </Painel>
            <Painel titulo="Receitas por categoria" semPadding>
              <TabelaCategorias itens={dados?.porCategoriaReceita} cor="success" carregando={carregando} />
            </Painel>
            <Painel titulo="Despesas por categoria" semPadding>
              <TabelaCategorias itens={dados?.porCategoriaDespesa} cor="danger" carregando={carregando} />
            </Painel>
          </>
        )}
      >
        <Painel titulo="Fluxo de caixa diário" subtitulo="Dia a dia: o que entrou, o que saiu e como ficou o saldo" semPadding>
          <GraficoFluxoCaixa fluxo={dados?.fluxoDiario} carregando={carregando} />
        </Painel>

        <Painel
          titulo={<TituloSecao titulo="Resumo do resultado" info="DRE (Demonstrativo do Resultado) — mostra quanto entrou, quanto saiu e quanto sobrou de lucro no período." />}
          subtitulo="Só o que foi pago no período"
          semPadding
        >
          <BlocoDRE dre={dados?.dre} carregando={carregando} />
        </Painel>

        <Painel
          titulo={<TituloSecao titulo="Dívidas por tempo de atraso" info="Agrupa cobranças vencidas pelo tempo que estão paradas (até 30 dias, 30-60, 60-90, mais de 90)." />}
          subtitulo="Receitas pendentes vencidas, separadas por tempo de atraso"
          semPadding
        >
          <BlocoAging aging={dados?.aging} carregando={carregando} />
        </Painel>
      </ColunasPagina>
    </>
  );
}

// ============================================================
// ABA: Estoque & CMV
// ============================================================
function AbaEstoque({ intervalo }) {
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [categorias, setCategorias] = useState([]);
  const [filtros, setFiltros] = useState({ categoriaId: '' });

  useEffect(() => {
    let ativo = true;
    api.get('/financeiro/categorias').then((r) => {
      if (ativo) setCategorias(Array.isArray(r.data) ? r.data : []);
    }).catch(() => { if (ativo) setCategorias([]); });
    return () => { ativo = false; };
  }, []);

  // Periodo/filtros mudaram: liga o carregando e limpa o erro ja no render
  // (guardando a chave da busca) em vez de setState sincrono no efeito.
  const tIni = intervalo.inicio.getTime();
  const tFim = intervalo.fim.getTime();
  const chaveBusca = `${tIni}|${tFim}|${filtros.categoriaId}`;
  const [chaveBuscaAnterior, setChaveBuscaAnterior] = useState(null);
  if (chaveBuscaAnterior !== chaveBusca) {
    setChaveBuscaAnterior(chaveBusca);
    setCarregando(true);
    setErro(null);
  }

  useEffect(() => {
    let ativo = true;
    api.get('/relatorios/estoque', {
      params: {
        inicio: new Date(tIni).toISOString(),
        fim: new Date(tFim).toISOString(),
        ...(filtros.categoriaId ? { categoriaId: filtros.categoriaId } : {}),
      },
    })
      .then((r) => { if (ativo) setDados(r.data); })
      .catch((e) => { if (ativo) setErro(e?.response?.data?.error || 'Erro ao carregar.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [tIni, tFim, filtros.categoriaId]);

  const montarDados = () => ({
    nome: 'relatorio-estoque',
    titulo: 'Relatório · Estoque & CMV',
    secoes: [
      {
        titulo: 'Resumo',
        colunas: [{ chave: 'indicador', label: 'Indicador' }, { chave: 'valor', label: 'Valor' }],
        linhas: dados ? [
          { indicador: 'Valor do estoque', valor: fmtBRL(dados.kpis.patrimonioImobilizado) },
          { indicador: 'Produtos físicos', valor: fmtNum(dados.kpis.totalFisicos) },
          { indicador: 'Índice de ruptura', valor: fmtPct(dados.kpis.indiceRuptura) },
          { indicador: 'Itens abaixo do mínimo', valor: fmtNum(dados.kpis.abaixoMinimo) },
        ] : [],
      },
      {
        titulo: 'Lista de reposição',
        colunas: [
          { chave: 'nome', label: 'Produto' },
          { chave: 'estoqueAtual', label: 'Atual' },
          { chave: 'estoqueMinimo', label: 'Mínimo' },
          { chave: 'sugestao', label: 'Comprar', valor: (i) => fmtNum(i.sugestao) },
        ],
        linhas: dados?.reposicao || [],
      },
      {
        titulo: 'Produtos por importância (Curva ABC)',
        colunas: [
          { chave: 'classe', label: 'Classe' },
          { chave: 'nome', label: 'Produto' },
          { chave: 'receita', label: 'Receita', valor: (i) => fmtBRL(i.receita) },
        ],
        linhas: dados?.curvaABC || [],
      },
      {
        titulo: 'Margem por produto',
        colunas: [
          { chave: 'nome', label: 'Produto' },
          { chave: 'precoCusto', label: 'Custo', valor: (i) => fmtBRL(i.precoCusto) },
          { chave: 'preco', label: 'Venda', valor: (i) => fmtBRL(i.preco) },
          { chave: 'margemAbsoluta', label: 'Margem R$', valor: (i) => fmtBRL(i.margemAbsoluta) },
          { chave: 'margemPercentual', label: 'Margem %', valor: (i) => fmtPct(i.margemPercentual) },
        ],
        linhas: dados?.margemPorProduto || [],
      },
      {
        titulo: 'Estoque parado (sem giro)',
        colunas: [
          { chave: 'nome', label: 'Produto' },
          { chave: 'estoqueAtual', label: 'Estoque' },
          { chave: 'diasSemMovimento', label: 'Dias sem giro' },
        ],
        linhas: dados?.estoqueParado || [],
      },
    ],
  });
  useExportarNoTopo(montarDados, dados);

  const resumoABC = dados?.resumoABC;
  const totalABC = resumoABC ? ['A', 'B', 'C'].reduce((a, c) => a + (resumoABC[c]?.receita || 0), 0) : 0;
  const capitalParado = (dados?.estoqueParado || []).reduce((a, i) => a + (Number(i.valorParado) || 0), 0);

  return (
    <>
      {erro && <ErroBox mensagem={erro} />}

      <PainelFiltros
        contador={dados?.kpis?.totalFisicos !== undefined ? `${dados.kpis.totalFisicos} produto(s) físico(s)` : null}
        filtrosAtivos={[
          (() => {
            const c = categorias.find((x) => x.id === filtros.categoriaId);
            return c && { rotulo: `Categoria: ${c.nome}`, onRemover: () => setFiltros({ categoriaId: '' }) };
          })(),
        ].filter(Boolean)}
        onLimparTudo={() => setFiltros({ categoriaId: '' })}
      >
        <div className="max-w-md">
          <Combobox
            size="sm"
            label="Filtrar por categoria"
            value={filtros.categoriaId}
            onChange={(id) => setFiltros({ categoriaId: id || '' })}
            placeholder="Todas as categorias"
            options={categorias.map((c) => ({ value: c.id, label: c.nome }))}
            clearable
          />
        </div>
      </PainelFiltros>

      <FaixaNumeros min={200}>
        <Numero destaque rotulo={rotuloInfo('Valor do estoque', 'Quanto vale tudo que você tem parado em estoque (pelo preço de custo).')}
          valor={fmtBRL(dados?.kpis.patrimonioImobilizado)}
          detalhe={dados ? `${dados.kpis.totalFisicos} produtos físicos` : null}
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Lucro se vender tudo', 'Quanto você ganharia vendendo todo o estoque pelo preço de venda.')}
          valor={fmtBRL(dados?.kpis.lucroPotencial)}
          tom="sucesso"
          detalhe={dados ? `Se vender tudo: ${fmtBRL(dados.kpis.valorVarejo)}` : null}
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Produtos pra repor', 'Produtos com estoque abaixo do mínimo configurado.')}
          valor={fmtNum(dados?.kpis.itensAbaixoMinimo)}
          tom={dados?.kpis.itensAbaixoMinimo > 0 ? 'alerta' : 'neutro'}
          detalhe={dados ? `${dados.kpis.itensZerados} zerados` : null}
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('% sem estoque', 'Quantos produtos estão zerados (sem unidades disponíveis pra venda).')}
          valor={dados ? fmtPct(dados.kpis.indiceRuptura) : '—'}
          tom={dados?.kpis.indiceRuptura > 10 ? 'perigo' : 'neutro'}
          detalhe="% itens zerados"
          carregando={carregando} />
      </FaixaNumeros>

      <ColunasPagina
        lateral={(
          <>
            <Painel
              titulo={<TituloSecao titulo="Produtos por importância" info="Curva ABC: A = produtos que trazem ~80% da sua receita (campeões); B = médios (15%); C = vendem pouco (5%)." />}
              subtitulo="Receita do período por classe"
              semPadding
            >
              {resumoABC ? ['A', 'B', 'C'].map((c) => {
                const r = resumoABC[c] || { qtd: 0, receita: 0 };
                return (
                  <LinhaInfo
                    key={c}
                    rotulo={(
                      <span className="inline-flex items-center gap-2">
                        <SeloClasse classe={c} />
                        {r.qtd} produto{r.qtd === 1 ? '' : 's'}
                        <span className="text-xs text-[var(--text-muted)]">{fmtPct(totalABC > 0 ? (r.receita / totalABC) * 100 : 0)} da receita</span>
                      </span>
                    )}
                    valor={fmtBRL(r.receita)}
                  />
                );
              }) : <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">{carregando ? 'Calculando…' : 'Sem vendas no período.'}</div>}
            </Painel>
            <Painel titulo="Resumo do estoque" semPadding>
              <LinhaInfo rotulo="Produtos físicos" valor={dados ? fmtNum(dados.kpis.totalFisicos) : '—'} />
              <LinhaInfo rotulo="Itens zerados" valor={dados ? fmtNum(dados.kpis.itensZerados) : '—'} />
              <LinhaInfo rotulo="Valor de venda do estoque" valor={dados ? fmtBRL(dados.kpis.valorVarejo) : '—'} />
              <LinhaInfo rotulo="Custo pra repor o que falta" valor={dados ? fmtBRL(dados.custoTotalReposicao) : '—'} />
              <LinhaInfo rotulo="Capital travado em estoque parado" forte valor={dados ? fmtBRL(capitalParado) : '—'} />
            </Painel>
          </>
        )}
      >
        {dados?.reposicao && dados.reposicao.length > 0 && (
          <Painel
            titulo="Lista de reposição"
            subtitulo={`Comprar: ${fmtBRL(dados.custoTotalReposicao)} (${dados.reposicao.length} produto${dados.reposicao.length === 1 ? '' : 's'})`}
            acoes={<Badge variant="warning">Atenção</Badge>}
            semPadding
            corpoClassName="overflow-x-auto"
          >
            <TabelaReposicao itens={dados.reposicao} />
          </Painel>
        )}

        <Painel titulo="Movimento de inventário" subtitulo="Quantos produtos entraram e saíram do estoque por dia" semPadding>
          <GraficoMovimentoInventario movimento={dados?.movimentoDiario} carregando={carregando} />
        </Painel>

        <Painel titulo="Curva ABC" subtitulo="Produtos ordenados pela receita que trazem" semPadding corpoClassName="overflow-x-auto">
          <BlocoCurvaABC curva={dados?.curvaABC} carregando={carregando} />
        </Painel>

        <Painel titulo="Margem por produto" subtitulo="Os 50 produtos com a melhor margem de lucro" semPadding corpoClassName="overflow-x-auto">
          <TabelaMargem itens={dados?.margemPorVariacao} carregando={carregando} />
        </Painel>

        <Painel titulo="Estoque parado" subtitulo="Produtos sem movimentação há mais de 60 dias" semPadding corpoClassName="overflow-x-auto">
          <TabelaEstoqueParado itens={dados?.estoqueParado} carregando={carregando} />
        </Painel>
      </ColunasPagina>
    </>
  );
}

// ====== Componentes da aba Estoque ======
function TabelaReposicao({ itens }) {
  const corUrgencia = {
    CRITICO: 'var(--danger)',
    ALTA: 'var(--warning)',
    MEDIA: 'var(--accent)',
  };
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap w-14"></th>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Produto</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Atual / Mín</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Comprar</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Custo estimado</th>
          <th className="text-center text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Urgência</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((r) => (
          <tr key={r.variacaoId} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <td className="px-4 py-2.5">
              {r.imagemUrl ? (
                <img src={r.imagemUrl} alt="" className="w-10 h-10 object-contain" />
              ) : (
                <div className="w-10 h-10 rounded-md bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)]">
                  <ImageIcon size={16} />
                </div>
              )}
            </td>
            <td className="px-4 py-2.5">
              <div className="font-semibold text-[var(--text-main)]">{r.nome}</div>
              {r.variacao && <div className="text-[11px] text-[var(--text-muted)]">{r.variacao}</div>}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums">
              <span className={r.estoqueAtual <= 0 ? 'text-[var(--danger-text)] font-bold' : 'text-[var(--text-main)]'}>
                {r.estoqueAtual}
              </span>
              <span className="text-[var(--text-muted)]"> / {r.estoqueMinimo}</span>
            </td>
            <td className="px-4 py-2.5 text-right font-bold tabular-nums">
              +{fmtNum(r.necessidade)}
            </td>
            <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[var(--text-main)]">
              {fmtBRL(r.custoReposicao)}
            </td>
            <td className="px-4 py-2.5 text-center">
              <span
                className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: `color-mix(in srgb, ${corUrgencia[r.urgencia]} 15%, transparent)`,
                  color: corUrgencia[r.urgencia],
                }}
              >
                {r.urgencia}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GraficoMovimentoInventario({ movimento, carregando }) {
  if (carregando && !movimento) return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!movimento || movimento.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Sem movimentações no período.</div>;
  }
  const dadosGrafico = movimento.map((m) => ({
    ...m,
    label: m.data.split('-').slice(1).reverse().join('/'),
  }));

  return (
    <div className="px-4 py-4">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={dadosGrafico}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-main)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-main)', borderRadius: 8 }}
            formatter={(v, name) => [fmtNum(v) + ' un.', name]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="entradas" name="Entradas" fill="var(--success)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="saidas" name="Saídas" fill="var(--danger)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const COR_CLASSE = { A: 'var(--success)', B: 'var(--accent)', C: 'var(--text-muted)' };

function SeloClasse({ classe }) {
  return (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-black text-[var(--text-on-primary)] flex-shrink-0"
      style={{ backgroundColor: COR_CLASSE[classe] }}
    >
      {classe}
    </span>
  );
}

// Tabela da curva ABC (o resumo por classe fica na coluna lateral).
function BlocoCurvaABC({ curva, carregando }) {
  if (carregando && !curva) return <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Calculando…</div>;
  if (!curva || curva.length === 0) {
    return <div className="px-4 py-12 text-center text-[13px] text-[var(--text-muted)]">Sem vendas no período.</div>;
  }
  return (
    <>
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <th className={`${TH} text-center w-12`}>Classe</th>
            <th className={`${TH} text-left`}>Produto</th>
            <th className={`${TH} text-right`}>Receita</th>
            <th className={`${TH} text-right`}>Acumulado</th>
          </tr>
        </thead>
        <tbody>
          {curva.slice(0, 30).map((p) => (
            <tr key={p.variacaoId} className="border-b border-[var(--border-subtle)] last:border-b-0">
              <td className="px-4 py-2.5 text-center"><SeloClasse classe={p.classe} /></td>
              <td className="px-4 py-2.5">
                <div className="font-semibold text-[var(--text-main)]">{p.nome}</div>
                {p.variacao && <div className="text-xs text-[var(--text-muted)]">{p.variacao}</div>}
              </td>
              <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmtBRL(p.receita)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-muted)]">{fmtPct(p.pctAcumulado)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {curva.length > 30 && (
        <div className="px-4 py-2 text-xs text-center text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
          +{curva.length - 30} produtos a mais (não exibidos)
        </div>
      )}
    </>
  );
}

function TabelaMargem({ itens, carregando }) {
  if (carregando && !itens) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!itens || itens.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Cadastre produtos pra ver margens.</div>;
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap w-14"></th>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Produto</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Custo</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Venda</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Margem</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">%</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((p) => (
          <tr key={p.variacaoId} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <td className="px-4 py-2.5">
              {p.imagemUrl ? (
                <img src={p.imagemUrl} alt="" className="w-10 h-10 object-contain" />
              ) : (
                <div className="w-10 h-10 rounded-md bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)]">
                  <ImageIcon size={16} />
                </div>
              )}
            </td>
            <td className="px-4 py-2.5">
              <div className="font-semibold text-[var(--text-main)]">{p.nome}</div>
              <div className="text-[11px] text-[var(--text-muted)]">
                {p.variacao && <span className="mr-2">{p.variacao}</span>}
                <span>{p.categoria}</span>
              </div>
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">{fmtBRL(p.precoCusto)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-main)]">{fmtBRL(p.preco)}</td>
            <td className="px-4 py-2.5 text-right font-bold tabular-nums text-[var(--success-text)]">{fmtBRL(p.margemAbsoluta)}</td>
            <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${
              p.margemPercentual < 20 ? 'text-[var(--warning-text)]' :
              p.margemPercentual >= 50 ? 'text-[var(--success-text)]' :
              'text-[var(--text-main)]'
            }`}>
              {fmtPct(p.margemPercentual)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TabelaEstoqueParado({ itens, carregando }) {
  if (carregando && !itens) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!itens || itens.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">🎉 Nenhum produto parado!</div>;
  }
  const valorTotal = itens.reduce((acc, i) => acc + i.valorParado, 0);
  return (
    <>
      <div className="px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] flex items-baseline justify-between text-xs">
        <span className="text-[var(--text-muted)]">Capital travado em estoque parado:</span>
        <span className="font-bold tabular-nums text-[var(--warning-text)]">{fmtBRL(valorTotal)}</span>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap w-14"></th>
            <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Produto</th>
            <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Estoque</th>
            <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Capital travado</th>
            <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Tempo parado</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((p) => (
            <tr key={p.variacaoId} className="border-b border-[var(--border-subtle)] last:border-b-0">
              <td className="px-4 py-2.5">
                {p.imagemUrl ? (
                  <img src={p.imagemUrl} alt="" className="w-10 h-10 object-contain" />
                ) : (
                  <div className="w-10 h-10 rounded-md bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)]">
                    <ImageIcon size={16} />
                  </div>
                )}
              </td>
              <td className="px-4 py-2.5">
                <div className="font-semibold text-[var(--text-main)]">{p.nome}</div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {p.variacao && <span className="mr-2">{p.variacao}</span>}
                  <span>{p.categoria}</span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtNum(p.estoqueAtual)}</td>
              <td className="px-4 py-2.5 text-right font-bold tabular-nums text-[var(--warning-text)]">{fmtBRL(p.valorParado)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {p.diasParado === null ? (
                  <span className="text-[var(--danger-text)] font-bold">Nunca movimentado</span>
                ) : (
                  <span className={p.diasParado > 180 ? 'text-[var(--danger-text)] font-bold' : 'text-[var(--text-secondary)]'}>
                    {p.diasParado} dias
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ============================================================
// ABA: Vendas
// ============================================================
function AbaVendas({ intervalo }) {
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [filtros, setFiltros] = useState({ origem: '', metodoPagamento: '', filtroRapido: '' });

  // Periodo/filtros mudaram: liga o carregando e limpa o erro ja no render
  // (guardando a chave da busca) em vez de setState sincrono no efeito.
  const tIni = intervalo.inicio.getTime();
  const tFim = intervalo.fim.getTime();
  const chaveBusca = `${tIni}|${tFim}|${filtros.origem}|${filtros.metodoPagamento}`;
  const [chaveBuscaAnterior, setChaveBuscaAnterior] = useState(null);
  if (chaveBuscaAnterior !== chaveBusca) {
    setChaveBuscaAnterior(chaveBusca);
    setCarregando(true);
    setErro(null);
  }

  useEffect(() => {
    let ativo = true;
    api.get('/relatorios/vendas', {
      params: {
        inicio: new Date(tIni).toISOString(),
        fim: new Date(tFim).toISOString(),
        ...(filtros.origem ? { origem: filtros.origem } : {}),
        ...(filtros.metodoPagamento ? { metodoPagamento: filtros.metodoPagamento } : {}),
      },
    })
      .then((r) => { if (ativo) setDados(r.data); })
      .catch((e) => { if (ativo) setErro(e?.response?.data?.error || 'Erro ao carregar.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [tIni, tFim, filtros.origem, filtros.metodoPagamento]);

  // Filtros rápidos das vendas — perguntas de negócio que o lojista faz.
  const aplicarRapido = (chave) => {
    const presets = {
      'via-bot':     { origem: 'AI', metodoPagamento: '' },
      'presenciais': { origem: 'Manual', metodoPagamento: '' },
      'cartao':      { origem: '', metodoPagamento: 'CREDITO' },
      'pix':         { origem: '', metodoPagamento: 'PIX' },
    };
    if (!chave || !presets[chave]) {
      setFiltros({ origem: '', metodoPagamento: '', filtroRapido: '' });
      return;
    }
    setFiltros({ ...presets[chave], filtroRapido: chave });
  };

  const mudarOrigem = (origem) => setFiltros((f) => ({ ...f, origem: origem || '', filtroRapido: '' }));
  const mudarMetodo = (m) => setFiltros((f) => ({ ...f, metodoPagamento: m || '', filtroRapido: '' }));
  const limparTudo = () => setFiltros({ origem: '', metodoPagamento: '', filtroRapido: '' });

  const filtrosAtivos = [
    filtros.filtroRapido && {
      rotulo: {
        'via-bot': 'Vendas via bot',
        'presenciais': 'Vendas presenciais',
        'cartao': 'Pagamento em cartão',
        'pix': 'Pagamento em PIX',
      }[filtros.filtroRapido],
      onRemover: () => aplicarRapido(null),
    },
    !filtros.filtroRapido && filtros.origem && { rotulo: `De onde veio: ${filtros.origem}`, onRemover: () => mudarOrigem('') },
    !filtros.filtroRapido && filtros.metodoPagamento && { rotulo: `Pagamento: ${filtros.metodoPagamento}`, onRemover: () => mudarMetodo('') },
  ].filter(Boolean);

  const contador = dados?.totais?.totalVendas !== undefined
    ? `${dados.totais.totalVendas} venda(s)`
    : null;

  const montarDados = () => ({
    nome: 'relatorio-vendas',
    titulo: 'Relatório · Vendas',
    filtrosAtivos: filtrosAtivos.map((f) => f.rotulo),
    secoes: [
      {
        titulo: 'Resumo',
        colunas: [{ chave: 'indicador', label: 'Indicador' }, { chave: 'valor', label: 'Valor' }],
        linhas: dados ? [
          { indicador: 'Total de vendas', valor: fmtNum(dados.totais.totalVendas) },
          { indicador: 'Faturamento', valor: fmtBRL(dados.totais.faturamentoTotal) },
          { indicador: 'Ticket médio', valor: fmtBRL(dados.totais.ticketMedio) },
          { indicador: 'Lucro bruto', valor: fmtBRL(dados.totais.lucroTotal) },
          { indicador: 'Margem média', valor: fmtPct(dados.totais.margemMedia) },
        ] : [],
      },
      {
        titulo: 'Vendas por canal',
        colunas: [
          { chave: 'origem', label: 'Canal' },
          { chave: 'qtd', label: 'Quantidade' },
          { chave: 'valor', label: 'Receita', valor: (c) => fmtBRL(c.valor) },
          { chave: 'lucro', label: 'Lucro', valor: (c) => fmtBRL(c.lucro) },
        ],
        linhas: dados?.porCanal || [],
      },
      {
        titulo: 'Vendas por categoria',
        colunas: [
          { chave: 'categoria', label: 'Categoria' },
          { chave: 'qtd', label: 'Quantidade' },
          { chave: 'receita', label: 'Receita', valor: (c) => fmtBRL(c.receita) },
          { chave: 'lucro', label: 'Lucro', valor: (c) => fmtBRL(c.lucro) },
          { chave: 'margem', label: 'Margem', valor: (c) => fmtPct(c.margem) },
        ],
        linhas: dados?.porCategoria || [],
      },
      {
        titulo: 'Vendas mais lucrativas',
        colunas: [
          { chave: 'descricao', label: 'Venda' },
          { chave: 'valor', label: 'Valor', valor: (v) => fmtBRL(v.valor) },
          { chave: 'lucro', label: 'Lucro', valor: (v) => fmtBRL(v.lucro) },
        ],
        linhas: dados?.topLucro || [],
      },
    ],
  });

  useExportarNoTopo(montarDados, dados);

  return (
    <>
      {erro && <ErroBox mensagem={erro} />}

      <PainelFiltros
        contador={contador}
        filtrosAtivos={filtrosAtivos}
        onLimparTudo={limparTudo}
      >
        <FiltroRapido
          ativo={filtros.filtroRapido}
          onChange={aplicarRapido}
          opcoes={[
            { chave: 'via-bot', label: 'Vendas via bot' },
            { chave: 'presenciais', label: 'Vendas presenciais' },
            { chave: 'cartao', label: 'Pagamento em cartão' },
            { chave: 'pix', label: 'Pagamento em PIX' },
          ]}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            size="sm"
            label="De onde veio o cliente"
            value={filtros.origem}
            onChange={(e) => mudarOrigem(e.target.value)}
            placeholder="Ex.: WhatsApp, Instagram, indicação..."
          />
          <Input
            size="sm"
            label="Como foi pago"
            value={filtros.metodoPagamento}
            onChange={(e) => mudarMetodo(e.target.value)}
            placeholder="Ex.: PIX, Cartão, Dinheiro..."
          />
        </div>
      </PainelFiltros>

      <FaixaNumeros min={200}>
        <Numero destaque rotulo="Faturamento"
          valor={fmtBRL(dados?.kpis.valorTotal)}
          detalhe={dados ? `${fmtNum(dados.kpis.totalVendas)} venda(s) no período` : null}
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Ticket médio', 'Quanto cada cliente gasta em média por venda.')}
          valor={fmtBRL(dados?.kpis.ticketMedio)}
          detalhe="por venda"
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Lucro bruto', 'Vendas menos o custo dos produtos (não inclui despesas fixas).')}
          valor={fmtBRL(dados?.kpis.lucroBruto)}
          detalhe={dados ? `Margem ${fmtPct(dados.kpis.margemBruta)}` : null}
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Clientes que compraram', '% dos novos clientes do período que viraram venda.')}
          valor={dados?.kpis.taxaConversao !== null && dados?.kpis.taxaConversao !== undefined
            ? fmtPct(dados.kpis.taxaConversao) : '—'}
          detalhe={dados ? `${dados.kpis.vendasComLead} de ${dados.kpis.leadsCriadosPeriodo} leads` : null}
          carregando={carregando} />
      </FaixaNumeros>

      <ColunasPagina
        lateral={(
          <>
            <Painel titulo="Vendas por canal" subtitulo="De onde veio o cliente de cada venda" semPadding>
              <TabelaPorCanal porCanal={dados?.porCanal} carregando={carregando} />
            </Painel>
            <Painel titulo="Como pagaram" subtitulo="Por método de pagamento" semPadding>
              <ListaBarras itens={itensPagamento(dados?.porMetodo)} carregando={carregando} vazio="Sem recebimentos no período." />
            </Painel>
          </>
        )}
      >
        <Painel
          titulo={<TituloSecao titulo="Quando você vende mais" info="Dias da semana e horários com mais movimento. Útil pra ajustar agenda, equipe e estoque." />}
          subtitulo="Cor mais forte = mais vendas naquele horário"
          semPadding
        >
          <Heatmap sazonalidade={dados?.sazonalidade} carregando={carregando} />
        </Painel>

        <Painel titulo="Vendas por categoria" subtitulo="Receita, custo, lucro e margem de cada categoria" semPadding corpoClassName="overflow-x-auto">
          <TabelaCategoriasVendas itens={dados?.porCategoria} carregando={carregando} />
        </Painel>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <Painel titulo="Vendas mais lucrativas" subtitulo="As 10 vendas que mais lucraram" semPadding corpoClassName="overflow-x-auto">
            <TabelaTopVendas itens={dados?.top10MaisLucrativas} carregando={carregando} corLucro="success" />
          </Painel>
          <Painel titulo="Vendas com menor lucro" subtitulo="As 10 com menor lucro — avalie se o preço está certo" semPadding corpoClassName="overflow-x-auto">
            <TabelaTopVendas itens={dados?.top10MenosLucrativas} carregando={carregando} corLucro="warning" />
          </Painel>
        </div>
      </ColunasPagina>
    </>
  );
}

// ====== Componentes da aba Vendas ======
function TabelaPorCanal({ porCanal, carregando }) {
  if (carregando && !porCanal) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!porCanal || porCanal.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Nenhuma venda no período.</div>;
  }
  const totalValor = porCanal.reduce((acc, c) => acc + c.valor, 0);
  return (
    <div className="px-4 py-4 space-y-3">
      {porCanal.map((c) => {
        const pct = totalValor > 0 ? (c.valor / totalValor) * 100 : 0;
        return (
          <div key={c.origem} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-[var(--text-main)]">{c.origem}</span>
                <span className="text-[var(--text-muted)]">{c.qtd} venda{c.qtd === 1 ? '' : 's'}</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-[var(--text-muted)] tabular-nums">{fmtPct(pct)}</span>
                <span className="font-bold tabular-nums text-[var(--text-main)]">{fmtBRL(c.valor)}</span>
                <span className="text-[var(--success-text)] tabular-nums text-[11px]">+{fmtBRL(c.lucro)}</span>
              </div>
            </div>
            <div className="h-1.5 bg-[var(--bg-subtle)] rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const DIAS_SEMANA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

function Heatmap({ sazonalidade, carregando }) {
  if (carregando && !sazonalidade) return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!sazonalidade || sazonalidade.celulas.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Sem vendas no período.</div>;
  }
  const max = sazonalidade.maxValor;
  if (max === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Sem vendas no período.</div>;
  }

  // Agrupa em matriz 7x24
  const matriz = Array.from({ length: 7 }, () => Array(24).fill(null));
  for (const c of sazonalidade.celulas) matriz[c.diaSemana][c.hora] = c;

  return (
    <div className="px-4 py-4 overflow-x-auto">
      <div className="min-w-[720px]">
        {/* Cabecalho de horas */}
        <div className="flex gap-0.5 ml-10 mb-1">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="flex-1 text-center text-[9px] text-[var(--text-muted)] font-semibold tabular-nums">
              {h.toString().padStart(2, '0')}
            </div>
          ))}
        </div>
        {matriz.map((linha, d) => (
          <div key={d} className="flex items-center gap-0.5 mb-0.5">
            <div className="w-9 text-xs text-[var(--text-muted)] font-bold uppercase">{DIAS_SEMANA[d]}</div>
            {linha.map((cel, h) => {
              const intensidade = cel.valor > 0 ? cel.valor / max : 0;
              const opacidade = intensidade === 0 ? 0 : Math.max(0.15, intensidade);
              return (
                <div
                  key={h}
                  className="flex-1 h-7 rounded relative group cursor-help"
                  style={{
                    backgroundColor: cel.valor === 0
                      ? 'var(--bg-subtle)'
                      : `color-mix(in srgb, var(--accent) ${opacidade * 100}%, transparent)`,
                    border: cel.valor === 0 ? '1px solid var(--border-subtle)' : 'none',
                  }}
                  title={`${DIAS_SEMANA[d]} ${h.toString().padStart(2, '0')}h: ${cel.qtd} venda(s) · ${fmtBRL(cel.valor)}`}
                >
                  {cel.qtd > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-[var(--text-on-primary)] tabular-nums">
                      {cel.qtd}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {/* Legenda */}
        <div className="flex items-center justify-end gap-2 mt-3 text-xs text-[var(--text-muted)]">
          <span>Menos</span>
          {[0.15, 0.3, 0.5, 0.7, 0.9].map((op) => (
            <div
              key={op}
              className="w-4 h-3 rounded"
              style={{ backgroundColor: `color-mix(in srgb, var(--accent) ${op * 100}%, transparent)` }}
            />
          ))}
          <span>Mais</span>
        </div>
      </div>
    </div>
  );
}

function TabelaCategoriasVendas({ itens, carregando }) {
  if (carregando && !itens) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!itens || itens.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Nenhuma venda no período.</div>;
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Categoria</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Qtd</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Receita</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">CMV</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Lucro</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Margem</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((c) => (
          <tr key={c.categoria} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <td className="px-4 py-2.5 font-semibold text-[var(--text-main)]">{c.categoria}</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(c.qtd)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-main)]">{fmtBRL(c.valor)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">{fmtBRL(c.custo)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums font-bold text-[var(--success-text)]">{fmtBRL(c.lucro)}</td>
            <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${
              c.margem < 20 ? 'text-[var(--warning-text)]' : 'text-[var(--text-main)]'
            }`}>{fmtPct(c.margem)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TabelaTopVendas({ itens, carregando, corLucro = 'success' }) {
  if (carregando && !itens) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!itens || itens.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Sem dados.</div>;
  }
  const corLucroVar = corLucro === 'warning' ? 'var(--warning)' : 'var(--success)';
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Venda</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Valor</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Lucro</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((v) => (
          <tr key={v.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <td className="py-2.5 px-4">
              <div className="font-semibold text-[var(--text-main)] truncate max-w-[200px]">{v.descricao}</div>
              <div className="text-xs text-[var(--text-muted)]">{new Date(v.data).toLocaleDateString('pt-BR')}</div>
            </td>
            <td className="py-2.5 px-4 text-right tabular-nums">{fmtBRL(v.valor)}</td>
            <td className="py-2.5 px-4 text-right tabular-nums">
              <div className="font-bold" style={{ color: corLucroVar }}>{fmtBRL(v.lucro)}</div>
              <div className="text-xs text-[var(--text-muted)]">{fmtPct(v.margem)}</div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ====== Componentes da aba Financeiro ======
function BlocoDRE({ dre, carregando }) {
  if (carregando && !dre) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!dre) return null;

  // Labels coloquiais (sem sinais matematicos "(−)" "(=)" — tooltip explica a
  // operacao). Sinal negativo aparece so no valor (em vermelho). Linhas de
  // destaque (Sobra / Lucro) ficam em negrito. Divisorias separam cada linha.
  const linhas = [
    {
      label: 'Total que entrou',
      valor: dre.receitaBruta,
      cor: 'success',
      sublabel: 'Vendas pagas no período',
      info: 'Soma de todas as receitas pagas no período (Receita bruta).',
    },
    {
      label: 'Custos variáveis',
      valor: -dre.despesasVariaveis,
      cor: 'danger',
      sublabel: 'Impostos, taxas de cartão, comissão e similares',
      info: 'Despesas que sobem ou descem conforme o volume de vendas. Inclui categorias marcadas com "venda" ou "imposto".',
    },
    {
      label: 'Sobra antes das despesas fixas',
      valor: dre.receitaBruta - dre.despesasVariaveis,
      cor: 'neutral',
      destaque: true,
      info: 'Quanto sobra das vendas depois de descontar os custos variáveis. Esse valor precisa cobrir as despesas fixas (aluguel, salário, etc) pra você ter lucro. Termo contábil: Margem de contribuição.',
    },
    {
      label: 'Despesas fixas',
      valor: -dre.despesasFixas,
      cor: 'danger',
      sublabel: 'Aluguel, salário, internet, contas que pagam todo mês',
    },
    {
      label: 'Lucro do período',
      valor: dre.resultadoLiquido,
      cor: dre.resultadoLiquido >= 0 ? 'success' : 'danger',
      destaque: true,
      info: 'O que efetivamente sobrou no bolso depois de pagar tudo (custos variáveis e despesas fixas). Termo contábil: Resultado líquido.',
    },
  ];

  return (
    <div className="px-4 py-2 divide-y divide-[var(--border-main)]">
      {linhas.map((l) => (
        <div
          key={l.label}
          className="flex items-start justify-between gap-3 py-3"
        >
          <div className="flex-1 min-w-0">
            {/* Padrao uniforme — todos labels com mesmo peso/cor. O destaque
                das linhas-chave (Sobra / Lucro) vem pela cor forte do VALOR
                (verde/vermelho), nao pelo negrito do label. */}
            <div className="text-sm flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
              {l.label}
              {l.info && (
                <InfoTooltip content={l.info}>
                  <HelpCircle size={13} strokeWidth={2} className="text-[var(--text-muted)] opacity-70 hover:opacity-100 cursor-help" />
                </InfoTooltip>
              )}
            </div>
            {l.sublabel && (
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{l.sublabel}</div>
            )}
          </div>
          {/* Valor sempre text-lg font-bold tabular-nums + leading-none pra
              ficar alinhado horizontalmente com o label (sem o sublabel
              empurrar visualmente). */}
          <div className={`text-lg font-bold tabular-nums leading-none flex-shrink-0 ${
            l.cor === 'success' ? 'text-[var(--success-text)]' :
            l.cor === 'danger' ? 'text-[var(--danger-text)]' :
            'text-[var(--text-main)]'
          }`}>
            {l.valor < 0 ? '−' : ''}{fmtBRL(Math.abs(l.valor))}
          </div>
        </div>
      ))}
      <div className="text-xs text-[var(--text-muted)] py-3 flex items-center gap-1.5">
        <span>Margem de lucro do período: <strong className="text-[var(--text-main)]">{fmtPct(dre.margemLiquida)}</strong></span>
        <InfoTooltip content="A cada R$ 100 que entram, quantos sobram de lucro depois de pagar tudo. Termo contábil: Margem líquida.">
          <HelpCircle size={12} strokeWidth={2} className="text-[var(--text-muted)] opacity-70 hover:opacity-100 cursor-help" />
        </InfoTooltip>
      </div>
    </div>
  );
}

function GraficoFluxoCaixa({ fluxo, carregando }) {
  if (carregando && !fluxo) return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!fluxo || fluxo.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Sem movimentações no período.</div>;
  }
  // Reformata a data pra DD/MM (mais legivel no eixo)
  const dadosGrafico = fluxo.map((f) => ({
    ...f,
    label: f.data.split('-').slice(1).reverse().join('/'),
  }));

  return (
    <div className="px-4 py-4">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={dadosGrafico}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-main)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            tickFormatter={(v) => Number(v).toLocaleString('pt-BR', { notation: 'compact' })}
          />
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-main)', borderRadius: 8 }}
            formatter={(v, name) => [fmtBRL(v), name]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="receita" stroke="var(--success)" name="Receita" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="despesa" stroke="var(--danger)" name="Despesa" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="saldoAcumulado" stroke="var(--accent)" name="Saldo acumulado" strokeWidth={2} strokeDasharray="5 5" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BlocoAging({ aging, carregando }) {
  if (carregando && !aging) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!aging) return null;
  const total = aging.reduce((acc, a) => acc + a.valor, 0);
  if (total === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">🎉 Nenhum vencido. Tudo em dia!</div>;
  }

  const CORES = ['var(--warning)', 'var(--accent)', 'var(--danger)', 'var(--danger)'];

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Grafico de barras das 4 faixas */}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={aging}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-main)" />
          <XAxis dataKey="faixa" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            tickFormatter={(v) => Number(v).toLocaleString('pt-BR', { notation: 'compact' })}
          />
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-main)', borderRadius: 8 }}
            formatter={(v) => [fmtBRL(v), 'Valor']}
          />
          <Bar dataKey="valor" radius={[6, 6, 0, 0]}>
            {aging.map((_, i) => (
              <Bar key={i} fill={CORES[i]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Detalhamento por faixa (top 5 itens de cada) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {aging.map((bucket, idx) => (
          bucket.qtd > 0 && (
            <div key={bucket.faixa} className="border border-[var(--border-main)] rounded-[10px] overflow-hidden">
              <div className="px-3 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-[var(--text-main)]">{bucket.faixa}</div>
                  <div className="text-xs text-[var(--text-muted)]">{bucket.qtd} título(s)</div>
                </div>
                <div className="text-sm font-bold tabular-nums" style={{ color: CORES[idx] }}>
                  {fmtBRL(bucket.valor)}
                </div>
              </div>
              <div className="divide-y divide-[var(--border-subtle)]">
                {bucket.itens.map((item) => (
                  <div key={item.id} className="px-3 py-2 flex items-baseline justify-between gap-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[var(--text-main)] truncate">{item.descricao}</div>
                      {item.lead && <div className="text-xs text-[var(--text-muted)] truncate">{item.lead}</div>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-bold tabular-nums">{fmtBRL(item.valor)}</div>
                      <div className="text-xs text-[var(--text-muted)]">{item.diasAtraso}d atraso</div>
                    </div>
                  </div>
                ))}
                {bucket.qtd > bucket.itens.length && (
                  <div className="px-3 py-1.5 text-xs text-[var(--text-muted)] text-center">
                    +{bucket.qtd - bucket.itens.length} a mais
                  </div>
                )}
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
}

function TabelaCategorias({ itens, cor = 'success', carregando }) {
  if (carregando && !itens) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!itens || itens.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Nenhum lançamento no período.</div>;
  }
  const total = itens.reduce((acc, i) => acc + i.valor, 0);
  const corHex = cor === 'success' ? 'var(--success)' : 'var(--danger)';
  return (
    <div className="px-4 py-4 space-y-2">
      {itens.map((c) => {
        const pct = total > 0 ? (c.valor / total) * 100 : 0;
        return (
          <div key={c.categoria} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <div className="truncate">
                <span className="font-semibold text-[var(--text-main)]">{c.categoria}</span>
                <span className="ml-2 text-[var(--text-muted)]">{c.qtd} lanç.</span>
              </div>
              <div className="flex-shrink-0">
                <span className="font-bold tabular-nums" style={{ color: corHex }}>{fmtBRL(c.valor)}</span>
                <span className="ml-2 text-[var(--text-muted)] tabular-nums">{fmtPct(pct)}</span>
              </div>
            </div>
            <div className="h-1.5 bg-[var(--bg-subtle)] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: corHex }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// COMPONENTES — funil
// ============================================================
function FunilEtapas({ funil, carregando }) {
  if (carregando && !funil) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!funil || funil.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Crie etapas no CRM pra ver o funil.</div>;
  }
  // Etapa com mais leads = base (largura 100%). Outras proporcionais.
  const max = Math.max(1, ...funil.map((e) => e.leads));

  return (
    <div className="px-4 py-4 space-y-2.5">
      {funil.map((e, idx) => {
        const pct = (e.leads / max) * 100;
        const corBg = e.cor || 'var(--accent)';
        return (
          <div key={e.etapaId} className="flex items-center gap-3">
            <div className="w-32 flex-shrink-0">
              <div className="text-sm font-semibold text-[var(--text-main)] truncate">{e.nome}</div>
              {idx < funil.length - 1 && e.taxaAvanco !== undefined && (
                <div className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <TrendingDown size={9} /> {fmtPct(e.taxaAvanco)} segue adiante
                </div>
              )}
            </div>
            <div className="flex-1 relative h-9 bg-[var(--bg-subtle)] rounded-lg overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-lg transition-all flex items-center px-3"
                style={{
                  width: `${Math.max(pct, e.leads > 0 ? 8 : 0)}%`,
                  backgroundColor: corBg,
                  opacity: 0.85,
                }}
              >
                <span className="text-xs font-bold text-[var(--text-on-primary)] drop-shadow tabular-nums">{e.leads}</span>
              </div>
            </div>
            <div className="w-32 flex-shrink-0 text-right">
              <div className="text-sm font-bold text-[var(--text-main)] tabular-nums">{fmtBRL(e.valor)}</div>
              <div className="text-xs text-[var(--text-muted)]">potencial em vendas</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TabelaOrigens({ origens, carregando }) {
  if (carregando && !origens) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!origens || origens.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Nenhum lead no período.</div>;
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Origem</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Leads</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Conversões</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Taxa</th>
        </tr>
      </thead>
      <tbody>
        {origens.map((o) => (
          <tr key={o.origem} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <td className="px-4 py-2.5 font-semibold text-[var(--text-main)]">{o.origem}</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(o.leads)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-[var(--success-text)]">{fmtNum(o.conversoes)}</td>
            <td className="px-4 py-2.5 text-right font-bold tabular-nums">
              {o.taxaConversao !== null ? fmtPct(o.taxaConversao) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TabelaTempoEtapas({ tempos, carregando }) {
  if (carregando && !tempos) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!tempos || tempos.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Sem movimentações suficientes ainda.</div>;
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Etapa</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Tempo médio</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Amostra</th>
        </tr>
      </thead>
      <tbody>
        {tempos.map((t) => (
          <tr key={t.etapa} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <td className="px-4 py-2.5 font-semibold text-[var(--text-main)]">{t.etapa}</td>
            <td className="px-4 py-2.5 text-right tabular-nums font-bold">
              <Clock size={11} className="inline mr-1 -mt-0.5 text-[var(--text-muted)]" />
              {t.diasMedio.toFixed(1)} dias
            </td>
            <td className="px-4 py-2.5 text-right text-xs text-[var(--text-muted)] tabular-nums">{t.amostra} leads</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TabelaLeadsParados({ leads, carregando }) {
  if (carregando && !leads) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!leads || leads.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Tudo em dia! Nenhum lead parado.</div>;
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Lead</th>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Etapa</th>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Origem</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Sem contato</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Valor</th>
        </tr>
      </thead>
      <tbody>
        {leads.map((l) => (
          <tr key={l.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <td className="px-4 py-2.5">
              <div className="text-sm font-semibold text-[var(--text-main)]">{l.nome}</div>
              <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
                {l.telefone && <span className="flex items-center gap-1"><Phone size={10} />{l.telefone}</span>}
                {l.email && <span className="flex items-center gap-1"><Mail size={10} />{l.email}</span>}
              </div>
            </td>
            <td className="px-4 py-2.5 text-xs">
              <Badge variant="neutral">{l.etapa}</Badge>
            </td>
            <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{l.origem}</td>
            <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${
              l.diasParado > 30 ? 'text-[var(--danger-text)]' :
              l.diasParado > 14 ? 'text-[var(--warning-text)]' :
              'text-[var(--text-secondary)]'
            }`}>
              {l.diasParado} dia{l.diasParado === 1 ? '' : 's'}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(l.valor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================
// COMPONENTES — compartilhados
// ============================================================
function TabelaTopProdutos({ itens, carregando, colunas, mensagemVazia = 'Nenhuma venda no período.' }) {
  if (carregando && !itens) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!itens || itens.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <Package className="mx-auto mb-2 text-[var(--text-muted)] opacity-50" size={32} />
        <div className="text-sm text-[var(--text-muted)]">{mensagemVazia}</div>
      </div>
    );
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap w-14"></th>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Produto</th>
          {colunas.map((c) => (
            <th key={c.label} className={`text-${c.align || 'right'} text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap`}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {itens.map((p, idx) => (
          <tr key={p.variacaoId} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <td className="px-4 py-2.5">
              {p.imagemUrl ? (
                <img src={p.imagemUrl} alt="" className="w-10 h-10 object-contain" />
              ) : (
                <div className="w-10 h-10 rounded-md bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)]">
                  <ImageIcon size={16} />
                </div>
              )}
            </td>
            <td className="px-4 py-2.5">
              <div className="text-sm font-semibold text-[var(--text-main)] tracking-tight">
                <span className="text-[var(--text-muted)] mr-2">#{idx + 1}</span>
                {p.nome}
                {p.variacao && <span className="text-[var(--text-muted)] font-medium"> · {p.variacao}</span>}
              </div>
            </td>
            {colunas.map((c) => (
              <td key={c.label} className={`px-4 py-2.5 text-${c.align || 'right'} tabular-nums ${
                c.destaque === 'success' ? 'font-bold text-[var(--success-text)]' : 'text-[var(--text-main)]'
              }`}>{c.valor(p)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================
// ABA: Bots / IA
// ============================================================
function AbaBots({ intervalo }) {
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [bots, setBots] = useState([]);
  const [filtros, setFiltros] = useState({ botId: '', canal: '' });

  useEffect(() => {
    let ativo = true;
    api.get('/bots').then((r) => {
      if (ativo) setBots(Array.isArray(r.data) ? r.data : []);
    }).catch(() => { if (ativo) setBots([]); });
    return () => { ativo = false; };
  }, []);

  // Periodo/filtros mudaram: liga o carregando e limpa o erro ja no render
  // (guardando a chave da busca) em vez de setState sincrono no efeito.
  const tIni = intervalo.inicio.getTime();
  const tFim = intervalo.fim.getTime();
  const chaveBusca = `${tIni}|${tFim}|${filtros.botId}|${filtros.canal}`;
  const [chaveBuscaAnterior, setChaveBuscaAnterior] = useState(null);
  if (chaveBuscaAnterior !== chaveBusca) {
    setChaveBuscaAnterior(chaveBusca);
    setCarregando(true);
    setErro(null);
  }

  useEffect(() => {
    let ativo = true;
    api.get('/relatorios/bots', {
      params: {
        inicio: new Date(tIni).toISOString(),
        fim: new Date(tFim).toISOString(),
        ...(filtros.botId ? { botId: filtros.botId } : {}),
        ...(filtros.canal ? { canal: filtros.canal } : {}),
      },
    })
      .then((r) => { if (ativo) setDados(r.data); })
      .catch((e) => { if (ativo) setErro(e?.response?.data?.error || 'Erro ao carregar.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [tIni, tFim, filtros.botId, filtros.canal]);

  const fmtMs = (ms) => {
    if (!ms || ms < 1000) return `${ms || 0}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const montarDados = () => ({
    nome: 'relatorio-bots',
    titulo: 'Relatório · Bots / IA',
    secoes: [
      {
        titulo: 'Resumo',
        colunas: [{ chave: 'indicador', label: 'Indicador' }, { chave: 'valor', label: 'Valor' }],
        linhas: dados ? [
          { indicador: 'Total de atendimentos', valor: fmtNum(dados.kpis.totalExecucoes) },
          { indicador: 'Mensagens trocadas', valor: fmtNum(dados.kpis.totalMensagens) },
          { indicador: 'Taxa de sucesso', valor: fmtPct(dados.kpis.taxaSucesso) },
          { indicador: 'Tempo médio de atendimento', valor: fmtMs(dados.kpis.duracaoMediaMs) },
          { indicador: 'Custo total de IA', valor: fmtBRL(dados.kpis.custoTotalIa) },
        ] : [],
      },
      {
        titulo: 'Por canal',
        colunas: [
          { chave: 'canal', label: 'Canal' },
          { chave: 'recebidas', label: 'Recebidas' },
          { chave: 'enviadas', label: 'Enviadas' },
        ],
        linhas: dados?.porCanal || [],
      },
      {
        titulo: 'Ferramentas usadas pelo bot',
        colunas: [
          { chave: 'tool', label: 'Ação' },
          { chave: 'qtd', label: 'Chamadas' },
          { chave: 'duracaoMediaMs', label: 'Tempo médio', valor: (t) => fmtMs(t.duracaoMediaMs) },
        ],
        linhas: dados?.toolsUsadas || [],
      },
      {
        titulo: 'Uso de IA por modelo',
        colunas: [
          { chave: 'modelo', label: 'Modelo' },
          { chave: 'chamadas', label: 'Chamadas' },
          { chave: 'tokensEntrada', label: 'Tokens entrada' },
          { chave: 'tokensSaida', label: 'Tokens saída' },
          { chave: 'custo', label: 'Custo', valor: (m) => fmtBRL(m.custo) },
        ],
        linhas: dados?.porModelo || [],
      },
    ],
  });
  useExportarNoTopo(montarDados, dados);

  return (
    <>
      {erro && <ErroBox mensagem={erro} />}

      <PainelFiltros
        contador={dados?.kpis?.totalExecucoes !== undefined ? `${dados.kpis.totalExecucoes} atendimento(s)` : null}
        filtrosAtivos={[
          (() => {
            const b = bots.find((x) => x.id === filtros.botId);
            return b && { rotulo: `Bot: ${b.nome}`, onRemover: () => setFiltros((f) => ({ ...f, botId: '' })) };
          })(),
          filtros.canal && {
            rotulo: `Canal: ${{ WHATSAPP: 'WhatsApp' }[filtros.canal] || filtros.canal}`,
            onRemover: () => setFiltros((f) => ({ ...f, canal: '' })),
          },
        ].filter(Boolean)}
        onLimparTudo={() => setFiltros({ botId: '', canal: '' })}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Combobox
            size="sm"
            label="Filtrar por bot"
            value={filtros.botId}
            onChange={(id) => setFiltros((f) => ({ ...f, botId: id || '' }))}
            placeholder="Todos os bots"
            options={bots.map((b) => ({ value: b.id, label: b.nome, sublabel: b.canal }))}
            clearable
          />
          <Combobox
            size="sm"
            label="Filtrar por canal"
            value={filtros.canal}
            onChange={(c) => setFiltros((f) => ({ ...f, canal: c || '' }))}
            placeholder="Todos os canais"
            options={[
              { value: 'WHATSAPP', label: 'WhatsApp' },
            ]}
            clearable
          />
        </div>
      </PainelFiltros>

      <FaixaNumeros min={200}>
        <Numero destaque rotulo="Mensagens trocadas"
          valor={fmtNum(dados?.kpis.totalMsgs)}
          detalhe={dados ? `${fmtNum(dados.kpis.msgsEntrada)} entrada · ${fmtNum(dados.kpis.msgsSaida)} saída` : null}
          carregando={carregando} />
        <Numero rotulo="Conversas ativas"
          valor={fmtNum(dados?.kpis.conversasAtivas)}
          detalhe={dados ? `${dados.kpis.conversasComLead} vinculadas a lead` : null}
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Atendimentos do bot', 'Quantas vezes o bot atendeu um cliente de ponta a ponta.')}
          valor={fmtNum(dados?.kpis.totalExec)}
          detalhe={dados && dados.kpis.taxaSucesso !== null
            ? `${fmtPct(dados.kpis.taxaSucesso)} de sucesso` : null}
          tomDetalhe="sucesso"
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Uso de IA', 'Total consumido em chamadas pra inteligência artificial — impacta o custo do bot.')}
          valor={fmtNum(dados?.kpis.tokensTotal)}
          detalhe={dados ? `${fmtNum(dados.kpis.chamadasIA)} chamada(s) ao LLM` : null}
          carregando={carregando} />
      </FaixaNumeros>

      <ColunasPagina
        lateral={(
          <>
            <Painel
              titulo={<TituloSecao titulo="Atendimentos bem-sucedidos" info="Quantos atendimentos do bot terminaram sem erro vs. falharam ou foram interrompidos." />}
              subtitulo={dados ? `Tempo médio de cada atendimento: ${fmtMs(dados.kpis.duracaoMediaMs)}` : '—'}
              semPadding
            >
              <BlocoStatusExec
                status={dados?.execucoes.status}
                modo={dados?.execucoes.modo}
                carregando={carregando}
              />
            </Painel>
            <Painel titulo="Por canal" subtitulo="Volume de mensagens por canal" semPadding corpoClassName="overflow-x-auto">
              <TabelaCanaisBot porCanal={dados?.porCanal} carregando={carregando} />
            </Painel>
          </>
        )}
      >
        <Painel titulo="Mensagens por dia" subtitulo="Mensagens recebidas e enviadas pelo bot, dia a dia" semPadding>
          <GraficoMensagensPorDia mensagens={dados?.mensagensPorDia} carregando={carregando} />
        </Painel>

        <Painel
          titulo="Ferramentas usadas pelo bot"
          subtitulo="Ações que o bot executou durante os atendimentos (criar cliente, enviar mensagem, etc.)"
          semPadding
          corpoClassName="overflow-x-auto"
        >
          <TabelaToolsUsadas itens={dados?.toolsUsadas} carregando={carregando} fmtMs={fmtMs} />
        </Painel>

        <Painel titulo="Uso de IA por modelo" subtitulo="Quanto cada modelo de IA foi usado (referência pra calcular custo)" semPadding corpoClassName="overflow-x-auto">
          <TabelaModelosIA itens={dados?.ia.porModelo} carregando={carregando} />
        </Painel>

        <Painel titulo="Top conversas mais ativas" subtitulo="Maior volume total de mensagens" semPadding corpoClassName="overflow-x-auto">
          <TabelaTopConversas itens={dados?.topConversas} carregando={carregando} />
        </Painel>
      </ColunasPagina>
    </>
  );
}

// ====== Componentes da aba Bots ======
function GraficoMensagensPorDia({ mensagens, carregando }) {
  if (carregando && !mensagens) return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!mensagens || mensagens.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Sem mensagens no período.</div>;
  }
  const dadosGrafico = mensagens.map((m) => ({
    ...m,
    label: m.data.split('-').slice(1).reverse().join('/'),
  }));
  return (
    <div className="px-4 py-4">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={dadosGrafico}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-main)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-main)', borderRadius: 8 }}
            formatter={(v, name) => [`${v} msg`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="entrada" stroke="var(--info)" name="Recebidas" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="saida" stroke="var(--accent)" name="Enviadas" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================
// ABA: Caixa — sessoes, retiradas, entradas, divergencias
// ============================================================
function AbaCaixa({ intervalo }) {
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [filtros, setFiltros] = useState({ origem: '', comDivergencia: '', filtroRapido: '' });

  // Periodo/filtros mudaram: liga o carregando e limpa o erro ja no render
  // (guardando a chave da busca) em vez de setState sincrono no efeito.
  const tIni = intervalo.inicio.getTime();
  const tFim = intervalo.fim.getTime();
  const chaveBusca = `${tIni}|${tFim}|${filtros.origem}|${filtros.comDivergencia}`;
  const [chaveBuscaAnterior, setChaveBuscaAnterior] = useState(null);
  if (chaveBuscaAnterior !== chaveBusca) {
    setChaveBuscaAnterior(chaveBusca);
    setCarregando(true);
    setErro(null);
  }

  useEffect(() => {
    let ativo = true;
    api.get('/relatorios/caixa', {
      params: {
        inicio: new Date(tIni).toISOString(),
        fim: new Date(tFim).toISOString(),
        ...(filtros.origem ? { origem: filtros.origem } : {}),
        ...(filtros.comDivergencia ? { comDivergencia: filtros.comDivergencia } : {}),
      },
    })
      .then((r) => { if (ativo) setDados(r.data); })
      .catch((e) => { if (ativo) setErro(e?.response?.data?.error || 'Erro ao carregar.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [tIni, tFim, filtros.origem, filtros.comDivergencia]);

  const fmtTempo = (ms) => {
    if (!ms || ms === 0) return '—';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h === 0) return `${m}min`;
    return `${h}h ${m}min`;
  };

  // Filtros rápidos da aba Caixa — perguntas de auditoria do dia a dia.
  const aplicarRapido = (chave) => {
    const presets = {
      'apenas-bot':         { origem: 'AUTO_BOT', comDivergencia: '' },
      'apenas-manuais':     { origem: 'MANUAL', comDivergencia: '' },
      'com-divergencia':    { origem: '', comDivergencia: 'true' },
    };
    if (!chave || !presets[chave]) {
      setFiltros({ origem: '', comDivergencia: '', filtroRapido: '' });
      return;
    }
    setFiltros({ ...presets[chave], filtroRapido: chave });
  };

  const limparTudo = () => setFiltros({ origem: '', comDivergencia: '', filtroRapido: '' });

  const filtrosAtivos = [
    filtros.filtroRapido && {
      rotulo: {
        'apenas-bot': 'Apenas automáticas (bot)',
        'apenas-manuais': 'Apenas manuais',
        'com-divergencia': 'Com diferença de saldo',
      }[filtros.filtroRapido],
      onRemover: () => aplicarRapido(null),
    },
  ].filter(Boolean);

  const contador = dados?.kpis?.totalSessoes !== undefined
    ? `${dados.kpis.totalSessoes} sessão(ões) fechada(s)`
    : null;

  const montarDados = () => ({
    nome: 'relatorio-caixa',
    titulo: 'Relatório · Caixa',
    filtrosAtivos: filtrosAtivos.map((f) => f.rotulo),
    secoes: [
      {
        titulo: 'Resumo',
        colunas: [{ chave: 'indicador', label: 'Indicador' }, { chave: 'valor', label: 'Valor' }],
        linhas: dados ? [
          { indicador: 'Sessões fechadas', valor: fmtNum(dados.kpis.totalSessoes) },
          { indicador: 'Vendas em dinheiro', valor: fmtBRL(dados.kpis.vendasDinheiro.valor) },
          { indicador: 'Saldo médio ao fechar', valor: fmtBRL(dados.kpis.saldoMedioDiario) },
          { indicador: 'Total de retiradas', valor: fmtBRL(dados.kpis.totalSangrias) },
          { indicador: 'Total de entradas', valor: fmtBRL(dados.kpis.totalSuprimentos) },
          { indicador: 'Diferença acumulada', valor: fmtBRL(dados.kpis.diferencaAcumulada) },
          { indicador: 'Tempo médio aberto', valor: fmtTempo(dados.kpis.tempoMedioMs) },
        ] : [],
      },
      {
        titulo: 'Sessões fechadas',
        colunas: [
          { chave: 'fechadaEm', label: 'Fechada em', valor: (s) => new Date(s.fechadaEm).toLocaleString('pt-BR') },
          { chave: 'origem', label: 'Origem' },
          { chave: 'fundoCaixa', label: 'Fundo', valor: (s) => fmtBRL(s.fundoCaixa) },
          { chave: 'saldoEsperado', label: 'Esperado', valor: (s) => fmtBRL(s.saldoEsperado) },
          { chave: 'saldoReal', label: 'Real', valor: (s) => fmtBRL(s.saldoReal) },
          { chave: 'diferenca', label: 'Diferença', valor: (s) => fmtBRL(s.diferenca) },
          { chave: 'usuarioFechouNome', label: 'Fechou' },
        ],
        linhas: dados?.sessoes || [],
      },
      {
        titulo: 'Motivos de retirada',
        colunas: [
          { chave: 'motivo', label: 'Motivo' },
          { chave: 'valor', label: 'Total', valor: (m) => fmtBRL(m.valor) },
        ],
        linhas: dados?.topMotivosSangria || [],
      },
      {
        titulo: 'Motivos de entrada no caixa',
        colunas: [
          { chave: 'motivo', label: 'Motivo' },
          { chave: 'valor', label: 'Total', valor: (m) => fmtBRL(m.valor) },
        ],
        linhas: dados?.topMotivosSuprimento || [],
      },
    ],
  });

  useExportarNoTopo(montarDados, dados);

  const dif = dados?.kpis.diferencaAcumulada || 0;

  return (
    <>
      {erro && <ErroBox mensagem={erro} />}

      <PainelFiltros
        contador={contador}
        filtrosAtivos={filtrosAtivos}
        onLimparTudo={limparTudo}
      >
        <FiltroRapido
          ativo={filtros.filtroRapido}
          onChange={aplicarRapido}
          opcoes={[
            { chave: 'apenas-bot', label: 'Apenas automáticas (bot)' },
            { chave: 'apenas-manuais', label: 'Apenas manuais' },
            { chave: 'com-divergencia', label: 'Com diferença de saldo' },
          ]}
        />
      </PainelFiltros>

      <FaixaNumeros min={200}>
        <Numero destaque rotulo={rotuloInfo('Vendas em dinheiro', 'Soma das vendas pagas em dinheiro vivo no período (não inclui PIX, cartão, etc.).')}
          valor={fmtBRL(dados?.kpis.vendasDinheiro.valor)}
          detalhe={dados ? `${dados.kpis.vendasDinheiro.qtd} venda(s)` : null}
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Sessões fechadas', 'Quantas vezes o caixa foi fechado no período (manual ou pelo cron automático às 00:01).')}
          valor={fmtNum(dados?.kpis.totalSessoes)}
          detalhe={dados?.kpis.sessoesComDivergencia > 0 ? `${dados.kpis.sessoesComDivergencia} com divergência` : 'Tudo bate'}
          tomDetalhe={dados?.kpis.sessoesComDivergencia > 0 ? 'alerta' : 'sucesso'}
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Saldo médio ao fechar', 'Em média, quanto sobrava no caixa físico em cada fechamento.')}
          valor={fmtBRL(dados?.kpis.saldoMedioDiario)}
          carregando={carregando} />
        <Numero rotulo={rotuloInfo('Diferença acumulada', 'Soma de todas as diferenças (real − esperado). Positivo = sobrou dinheiro no caixa; negativo = faltou.')}
          valor={fmtBRL(dados?.kpis.diferencaAcumulada)}
          tom={dif > 0 ? 'sucesso' : dif < 0 ? 'perigo' : 'neutro'}
          detalhe={dados ? (dif >= 0 ? 'Sobra (dinheiro a mais)' : 'Falta (dinheiro a menos)') : null}
          carregando={carregando} />
      </FaixaNumeros>

      <ColunasPagina
        lateral={(
          <>
            <Painel titulo="Movimento do caixa" semPadding>
              <LinhaInfo
                rotulo={<span title="Total tirado do caixa físico no período (ex.: depósito no banco).">Retiradas{dados ? ` · ${dados.kpis.qtdSangrias}` : ''}</span>}
                valor={dados ? fmtBRL(dados.kpis.totalSangrias) : '—'}
              />
              <LinhaInfo
                rotulo={<span title="Total colocado no caixa físico manualmente no período (ex.: troco extra).">Entradas{dados ? ` · ${dados.kpis.qtdSuprimentos}` : ''}</span>}
                valor={dados ? fmtBRL(dados.kpis.totalSuprimentos) : '—'}
              />
              <LinhaInfo
                rotulo={<span title="Quanto tempo, em média, cada sessão ficou aberta entre abertura e fechamento.">Tempo médio aberto</span>}
                valor={dados ? fmtTempo(dados.kpis.tempoMedioMs) : '—'}
              />
            </Painel>
            <Painel titulo="Principais motivos de retirada" subtitulo="Onde o dinheiro saiu do caixa" semPadding>
              <TabelaMotivosCaixa itens={dados?.topMotivosSangria} carregando={carregando} cor="danger" />
            </Painel>
            <Painel titulo="Principais motivos de entrada" subtitulo="Por que o dinheiro foi reforçado" semPadding>
              <TabelaMotivosCaixa itens={dados?.topMotivosSuprimento} carregando={carregando} cor="success" />
            </Painel>
          </>
        )}
      >
        <Painel titulo="Sessões fechadas" subtitulo="Histórico do período (mais recentes primeiro)" semPadding corpoClassName="overflow-x-auto">
          <TabelaSessoesCaixa sessoes={dados?.sessoes} carregando={carregando} />
        </Painel>

        {dados?.divergencias?.length > 0 && (
          <Painel
            titulo={<TituloSecao titulo="Sessões com divergência" info="Sessões que fecharam com diferença entre o saldo esperado (calculado pelo sistema) e o saldo real (contado fisicamente). Vale investigar." />}
            subtitulo="Saldo contado diferente do esperado"
            acoes={<Badge variant="warning">{dados.divergencias.length} sessão(ões)</Badge>}
            semPadding
          >
            <TabelaDivergencias divergencias={dados.divergencias} />
          </Painel>
        )}
      </ColunasPagina>
    </>
  );
}

function TabelaSessoesCaixa({ sessoes, carregando }) {
  if (carregando && !sessoes) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!sessoes || sessoes.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Nenhuma sessão fechada no período.</div>;
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Fechada em</th>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Origem</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Fundo</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Esperado</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Real</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Diferença</th>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Fechou</th>
        </tr>
      </thead>
      <tbody>
        {sessoes.map((s) => {
          const dif = Number(s.diferenca || 0);
          return (
            <tr key={s.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
              <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">
                {s.fechadaEm ? new Date(s.fechadaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
              </td>
              <td className="px-4 py-2.5 text-xs">
                <Badge variant={s.origem === 'AUTO_BOT' ? 'info' : 'neutral'}>
                  {s.origem === 'AUTO_BOT' ? 'Automático (bot)' : 'Manual'}
                </Badge>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">{fmtBRL(s.fundoCaixa)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-main)]">{fmtBRL(s.saldoEsperado)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[var(--text-main)]">{fmtBRL(s.saldoReal)}</td>
              <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${
                dif > 0 ? 'text-[var(--success-text)]' : dif < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--text-muted)]'
              }`}>
                {dif > 0 ? '+' : ''}{fmtBRL(dif)}
              </td>
              <td className="px-4 py-2.5 text-xs text-[var(--text-muted)]">{s.usuarioFechouNome || '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TabelaDivergencias({ divergencias }) {
  return (
    <div className="px-4 py-3 space-y-2">
      {divergencias.map((d) => {
        const dif = Number(d.diferenca || 0);
        return (
          <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[var(--bg-subtle)]">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--text-main)]">
                {new Date(d.fechadaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </div>
              <div className="text-[11px] text-[var(--text-muted)]">
                Esperado {fmtBRL(d.saldoEsperado)} · Real {fmtBRL(d.saldoReal)}
                {d.usuarioFechouNome && ` · fechado por ${d.usuarioFechouNome}`}
              </div>
            </div>
            <div className={`text-sm font-bold tabular-nums flex-shrink-0 ${
              dif > 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]'
            }`}>
              {dif > 0 ? '+' : ''}{fmtBRL(dif)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TabelaMotivosCaixa({ itens, carregando, cor }) {
  if (carregando && !itens) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!itens || itens.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Nenhum motivo registrado.</div>;
  }
  const total = itens.reduce((acc, i) => acc + i.valor, 0);
  return (
    <div className="px-4 py-3 space-y-2">
      {itens.map((i) => {
        const pct = total > 0 ? (i.valor / total) * 100 : 0;
        return (
          <div key={i.motivo} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-[var(--text-main)] truncate">{i.motivo}</span>
              <span className={`font-bold tabular-nums flex-shrink-0 ${cor === 'danger' ? 'text-[var(--danger-text)]' : 'text-[var(--success-text)]'}`}>
                {fmtBRL(i.valor)}
              </span>
            </div>
            <div className="h-1.5 bg-[var(--bg-subtle)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, backgroundColor: cor === 'danger' ? 'var(--danger)' : 'var(--success)' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TabelaCanaisBot({ porCanal, carregando }) {
  if (carregando && !porCanal) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!porCanal || porCanal.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Sem mensagens.</div>;
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Canal</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Recebidas</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Enviadas</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Total</th>
        </tr>
      </thead>
      <tbody>
        {porCanal.map((c) => (
          <tr key={c.canal} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <td className="px-4 py-2.5 font-semibold text-[var(--text-main)]">{c.canal}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-[var(--info-text)]">{fmtNum(c.entrada)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-[var(--accent)]">{fmtNum(c.saida)}</td>
            <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmtNum(c.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BlocoStatusExec({ status, modo, carregando }) {
  if (carregando && !status) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!status) return null;

  const total = Object.values(status).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Nenhuma execução no período.</div>;
  }

  const corStatus = {
    SUCESSO: 'var(--success)',
    ERRO: 'var(--danger)',
    EM_EXECUCAO: 'var(--info)',
    PENDENTE: 'var(--text-muted)',
    CANCELADA: 'var(--warning)',
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">Como terminaram</div>
        <div className="space-y-1.5">
          {Object.entries(status).filter(([, v]) => v > 0).map(([k, v]) => {
            const pct = (v / total) * 100;
            return (
              <div key={k} className="space-y-0.5">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-semibold text-[var(--text-main)]">{k}</span>
                  <span className="tabular-nums">
                    <span className="font-bold" style={{ color: corStatus[k] }}>{v}</span>
                    <span className="text-[var(--text-muted)] ml-2">{fmtPct(pct)}</span>
                  </span>
                </div>
                <div className="h-1.5 bg-[var(--bg-subtle)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: corStatus[k] }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
          <span>Como o bot foi acionado</span>
          <InfoTooltip content="Se o atendimento foi disparado pelo cliente, por outro fluxo, ou automaticamente.">
            <HelpCircle size={11} strokeWidth={2} className="text-[var(--text-muted)] opacity-70 hover:opacity-100 cursor-help" />
          </InfoTooltip>
        </div>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(modo).filter(([, v]) => v > 0).map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-subtle)] text-xs">
              <span className="font-semibold text-[var(--text-main)]">{k}</span>
              <span className="font-bold tabular-nums text-[var(--accent)]">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabelaToolsUsadas({ itens, carregando, fmtMs }) {
  if (carregando && !itens) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!itens || itens.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Nenhuma ferramenta usada no período.</div>;
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Ferramenta</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Chamadas</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Sucesso</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Erros</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Taxa</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Tempo médio</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((t) => (
          <tr key={t.tool} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Wrench size={14} className="text-[var(--text-muted)]" />
                <span className="text-sm font-semibold text-[var(--text-main)] font-mono">{t.tool}</span>
              </div>
            </td>
            <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmtNum(t.total)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-[var(--success-text)]">{fmtNum(t.sucesso)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-[var(--danger-text)]">{fmtNum(t.erro)}</td>
            <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${
              t.taxaSucesso < 80 ? 'text-[var(--warning-text)]' : 'text-[var(--success-text)]'
            }`}>{fmtPct(t.taxaSucesso)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-muted)]">{fmtMs(t.duracaoMediaMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TabelaModelosIA({ itens, carregando }) {
  if (carregando && !itens) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!itens || itens.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Nenhuma chamada de IA no período.</div>;
  }
  const totalTokens = itens.reduce((a, m) => a + m.tokens, 0);
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Modelo</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Chamadas</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Tokens</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">% do total</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((m) => {
          const pct = totalTokens > 0 ? (m.tokens / totalTokens) * 100 : 0;
          return (
            <tr key={m.modelo} className="border-b border-[var(--border-subtle)] last:border-b-0">
              <td className="px-4 py-2.5 font-semibold text-[var(--text-main)] font-mono">
                <Sparkles size={12} className="inline mr-2 -mt-0.5 text-[var(--accent)]" />
                {m.modelo}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(m.chamadas)}</td>
              <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmtNum(m.tokens)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-muted)]">{fmtPct(pct)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TabelaTopConversas({ itens, carregando }) {
  if (carregando && !itens) return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Calculando…</div>;
  if (!itens || itens.length === 0) {
    return <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Nenhuma conversa no período.</div>;
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Canal</th>
          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Identificador</th>
          <th className="text-center text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Lead?</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Mensagens</th>
          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Última</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((c, idx) => (
          <tr key={c.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <td className="px-4 py-2.5">
              <Badge variant="neutral">{c.canal}</Badge>
            </td>
            <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">
              <span className="text-[var(--text-muted)] mr-2">#{idx + 1}</span>
              {c.identificador}
            </td>
            <td className="px-4 py-2.5 text-center">
              {c.temLead
                ? <CheckCircle2 size={14} className="inline text-[var(--success-text)]" />
                : <XCircle size={14} className="inline text-[var(--text-muted)]" />}
            </td>
            <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmtNum(c.mensagens)}</td>
            <td className="px-4 py-2.5 text-right text-xs tabular-nums text-[var(--text-muted)]">
              {c.ultimaMsg ? new Date(c.ultimaMsg).toLocaleString('pt-BR') : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Título de seção com explicação opcional (usado dentro do h2 do Painel,
// por isso só spans).
function TituloSecao({ titulo, info }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{titulo}</span>
      {info && (
        <InfoTooltip content={info}>
          <HelpCircle size={13} strokeWidth={2} aria-label={info} className="text-[var(--text-muted)] opacity-70 hover:opacity-100 cursor-help" />
        </InfoTooltip>
      )}
    </span>
  );
}

function ErroBox({ mensagem }) {
  return (
    <div role="alert" className="flex items-center gap-2 rounded-[10px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-4 py-2.5 text-[13px] font-medium text-[var(--danger-text)]">
      <AlertCircle size={16} aria-hidden="true" />
      <span>{mensagem}</span>
    </div>
  );
}

// ============================================================
// ABA: Fechamento mensal — lista snapshots persistidos
// ============================================================
function AbaMensais() {
  const navigate = useNavigate();
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState(null);
  const { user } = useAuthStore();

  const podeGerar = user?.perfil === 'CLIENT' || user?.perfil === 'ADMINISTRADOR';

  // Busca sem setState sincrono (o estado ja nasce carregando e sem erro);
  // o "carregar" das acoes liga o carregando e limpa o erro antes.
  const buscarMensais = useCallback(() => relatorioMensalService.listar()
    .then(setItens)
    .catch(() => setErro('Não foi possível carregar os relatórios mensais.'))
    .finally(() => setCarregando(false)), []);

  useEffect(() => {
    buscarMensais();
  }, [buscarMensais]);

  const carregar = () => {
    setCarregando(true);
    setErro(null);
    buscarMensais();
  };

  const onGerarAnterior = async () => {
    setGerando(true);
    try {
      await relatorioMensalService.gerar();
      carregar();
    } catch (e) {
      setErro(e?.response?.data?.error || 'Não foi possível gerar agora.');
    } finally {
      setGerando(false);
    }
  };

  useAcaoTopo(
    podeGerar ? (
      <Button size="sm" icon={RefreshCw} onClick={onGerarAnterior} loading={gerando} disabled={gerando}>
        {gerando ? 'Gerando…' : 'Gerar mês anterior agora'}
      </Button>
    ) : null,
    [podeGerar, gerando]
  );

  const ultimo = itens.reduce((m, r) => (!m || r.ano * 12 + r.mes > m.ano * 12 + m.mes ? r : m), null);
  const automaticos = itens.filter((r) => r.geradoPor === 'CRON').length;

  return (
    <>
      {erro && <ErroBox mensagem={erro} />}

      <FaixaNumeros min={200}>
        <Numero destaque rotulo="Meses fechados" valor={fmtNum(itens.length)}
          detalhe={itens.length === 0 && !carregando ? 'Nenhum mês fechado ainda' : 'disponíveis pra consulta'} carregando={carregando} />
        <Numero rotulo="Último fechamento" valor={ultimo ? `${NOMES_MES_BR[ultimo.mes]}/${ultimo.ano}` : '—'}
          detalhe={ultimo ? `Gerado em ${new Date(ultimo.geradoEm).toLocaleDateString('pt-BR')}` : null} carregando={carregando} />
        <Numero rotulo="Gerados automaticamente" valor={fmtNum(automaticos)} detalhe="todo dia 7" carregando={carregando} />
        <Numero rotulo="Gerados manualmente" valor={fmtNum(itens.length - automaticos)} carregando={carregando} />
      </FaixaNumeros>

      <ColunasPagina
        lateral={(
          <Painel titulo="Como funciona" semPadding>
            <LinhaInfo rotulo="Fechamento automático" valor="todo dia 7" />
            <LinhaInfo rotulo="O que entra" valor="financeiro, caixa, vendas e clientes" />
            <LinhaInfo rotulo="Depois de gerado" valor="não muda (snapshot)" />
            <p className="m-0 px-4 py-3 text-xs text-[var(--text-muted)]">
              {podeGerar
                ? 'Precisa antes do dia 7? Use "Gerar mês anterior agora" no topo da tela.'
                : 'Só o dono da conta ou um administrador pode gerar um fechamento manualmente.'}
            </p>
          </Painel>
        )}
      >
        <Painel
          titulo="Meses fechados"
          subtitulo={itens.length === 0 && !carregando ? 'Nenhum mês fechado ainda.' : `${itens.length} mês(es) disponível(is)`}
          semPadding
          corpoClassName="overflow-x-auto"
        >
          {carregando ? (
            <div className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Carregando…</div>
          ) : itens.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-[var(--text-secondary)]">
              <div className="font-semibold text-[var(--text-main)]">Sem relatórios mensais por aqui</div>
              <div className="mt-1 text-[var(--text-muted)]">
                O sistema gera automaticamente no dia 7 de cada mês. Você também pode gerar manualmente quando quiser.
              </div>
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={`${TH} text-left`}>Mês</th>
                  <th className={`${TH} text-left`}>Gerado em</th>
                  <th className={`${TH} text-left`}>Como</th>
                  <th className={`${TH} text-right`}><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {itens.map((r) => {
                  const destino = `/app/relatorios/mensais/${r.ano}-${String(r.mes).padStart(2, '0')}`;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => navigate(destino)}
                      className="cursor-pointer hover:bg-[var(--bg-subtle)]"
                    >
                      <td className={`${TD} font-semibold text-[var(--text-main)]`}>{NOMES_MES_BR[r.mes]} de {r.ano}</td>
                      <td className={`${TD} text-[var(--text-secondary)] tabular-nums`}>{new Date(r.geradoEm).toLocaleDateString('pt-BR')}</td>
                      <td className={TD}>
                        <Badge variant={r.geradoPor === 'CRON' ? 'info' : 'neutral'}>{r.geradoPor === 'CRON' ? 'Automático' : 'Manual'}</Badge>
                      </td>
                      <td className={`${TD} text-right`}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigate(destino); }}
                          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--primary)] hover:underline"
                        >
                          Ver fechamento <ChevronRight size={14} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Painel>
      </ColunasPagina>
    </>
  );
}

const NOMES_MES_BR = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
