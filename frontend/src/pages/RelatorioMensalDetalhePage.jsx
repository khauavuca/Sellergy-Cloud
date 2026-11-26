// Página de detalhe do snapshot mensal. Lê o JSON salvo no backend e
// renderiza um resumo executivo: financeiro, caixa, vendas, CRM
// (layout novo: faixa de números + principal + coluna lateral).

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import {
  Badge, Button, BotaoExportar,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo,
} from '../components/ui';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import relatorioMensalService from '../services/relatorioMensalService';

const NOMES_MES = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v) => Number(v ?? 0).toLocaleString('pt-BR');
const fmtPct = (v) => `${Number(v ?? 0).toFixed(1)}%`;

const TH = 'text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const TD = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';

export default function RelatorioMensalDetalhePage() {
  const { periodo } = useParams(); // formato "YYYY-MM"
  const navigate = useNavigate();
  const [dados, setDados] = useState(null);
  const [erroBusca, setErro] = useState(null);
  const [buscando, setCarregando] = useState(true);

  // Parse seguro do segmento da URL.
  const [anoStr, mesStr] = (periodo || '').split('-');
  const ano = parseInt(anoStr, 10);
  const mes = parseInt(mesStr, 10);
  const periodoValido = Number.isInteger(ano) && Number.isInteger(mes) && mes >= 1 && mes <= 12;

  // Endereço inválido não busca nada: o erro e o "carregando" são derivados
  // do período em vez de setados de forma síncrona dentro do efeito.
  const erro = periodoValido ? erroBusca : 'Endereço inválido.';
  const carregando = periodoValido && buscando;

  useEffect(() => {
    if (!periodoValido) return;
    relatorioMensalService.detalhe(ano, mes)
      .then((r) => setDados(r))
      .catch((e) => setErro(e?.response?.data?.error || 'Não foi possível carregar este relatório.'))
      .finally(() => setCarregando(false));
  }, [ano, mes, periodoValido]);

  const snap = dados?.dados || {};
  const fin = snap.financeiro || {};
  const cx = snap.caixa || {};
  const vd = snap.vendas || {};
  const crm = snap.crm || {};

  const montarDados = () => ({
    nome: `relatorio-mensal-${ano}-${String(mes).padStart(2, '0')}`,
    titulo: `Fechamento de ${NOMES_MES[mes]} de ${ano}`,
    secoes: [
      {
        titulo: 'Financeiro',
        colunas: [{ chave: 'item', label: 'Item' }, { chave: 'valor', label: 'Valor' }],
        linhas: [
          { item: 'Total que entrou', valor: fmtBRL(fin.receitaBruta) },
          { item: 'Total que saiu', valor: fmtBRL(fin.despesasTotais) },
          { item: 'Despesas variáveis', valor: fmtBRL(fin.despesasVariaveis) },
          { item: 'Despesas fixas', valor: fmtBRL(fin.despesasFixas) },
          { item: 'Lucro do período', valor: fmtBRL(fin.lucroLiquido) },
          { item: 'Margem de lucro', valor: fmtPct(fin.margemLiquida) },
        ],
      },
      {
        titulo: 'Caixa',
        colunas: [{ chave: 'item', label: 'Item' }, { chave: 'valor', label: 'Valor' }],
        linhas: [
          { item: 'Sessões fechadas', valor: fmtNum(cx.sessoesFechadas) },
          { item: 'Retiradas', valor: fmtBRL(cx.totalSangrias) },
          { item: 'Entradas', valor: fmtBRL(cx.totalSuprimentos) },
          { item: 'Diferença acumulada', valor: fmtBRL(cx.diferencaAcumulada) },
        ],
      },
      {
        titulo: 'Vendas',
        colunas: [{ chave: 'item', label: 'Item' }, { chave: 'valor', label: 'Valor' }],
        linhas: [
          { item: 'Total de vendas', valor: fmtNum(vd.total) },
          { item: 'Faturamento', valor: fmtBRL(vd.faturamento) },
          { item: 'Ticket médio', valor: fmtBRL(vd.ticketMedio) },
        ],
      },
      {
        titulo: 'Top produtos',
        colunas: [
          { chave: 'nome', label: 'Produto' },
          { chave: 'quantidade', label: 'Quantidade', valor: (p) => fmtNum(p.quantidade) },
          { chave: 'receita', label: 'Receita', valor: (p) => fmtBRL(p.receita) },
        ],
        linhas: vd.topProdutos || [],
      },
      {
        titulo: 'Clientes',
        colunas: [{ chave: 'item', label: 'Item' }, { chave: 'valor', label: 'Valor' }],
        linhas: [
          { item: 'Novos clientes cadastrados', valor: fmtNum(crm.leadsCriados) },
        ],
      },
    ],
  });

  // Exportar vai pro topo da tela. O ref guarda o montarDados mais recente
  // (o hook tem que rodar antes dos retornos antecipados abaixo).
  const refMontar = useRef(montarDados);
  useEffect(() => { refMontar.current = montarDados; });
  const montar = useCallback(() => refMontar.current(), []);
  const pronto = !!dados && !erro;
  useAcaoTopo(pronto ? <BotaoExportar montarDados={montar} /> : null, [pronto, montar]);

  const voltar = (
    <div>
      <Button variant="ghost" icon={ArrowLeft} size="sm" onClick={() => navigate('/app/relatorios/mensais')}>
        Voltar pro fechamento mensal
      </Button>
    </div>
  );

  if (carregando) {
    return (
      <Pagina>
        {voltar}
        <FaixaNumeros min={200}>
          {[0, 1, 2, 3].map((i) => <Numero key={i} rotulo="Carregando…" carregando destaque={i === 0} />)}
        </FaixaNumeros>
      </Pagina>
    );
  }

  if (erro || !dados) {
    return (
      <Pagina>
        {voltar}
        <Painel>
          <div className="text-[13px] text-center py-6 text-[var(--text-secondary)]">
            <AlertCircle size={20} className="mx-auto text-[var(--text-muted)] mb-2" aria-hidden="true" />
            <div className="font-semibold text-[var(--text-main)]">{erro || 'Sem dados'}</div>
            <div className="text-[var(--text-muted)] mt-1">
              Este mês ainda não tem fechamento gerado. Você pode disparar manualmente em <Link to="/app/relatorios/mensais" className="text-[var(--primary)] font-semibold hover:underline">Fechamento mensal</Link>.
            </div>
          </div>
        </Painel>
      </Pagina>
    );
  }

  const top = Array.isArray(vd.topProdutos) ? vd.topProdutos : [];
  const dif = Number(cx.diferencaAcumulada || 0);

  return (
    <Pagina>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {voltar}
          <h2 className="m-0 text-base font-bold tracking-tight text-[var(--text-main)]">
            Fechamento de {NOMES_MES[mes]} de {ano}
          </h2>
        </div>
        <span className="text-xs text-[var(--text-muted)]">
          Fechado em {new Date(dados.geradoEm).toLocaleDateString('pt-BR')}
          {dados.geradoPor === 'CRON' ? ' · automático' : ' · gerado manualmente'}
        </span>
      </div>

      <FaixaNumeros min={200}>
        <Numero destaque rotulo={<span title="Soma de todas as receitas pagas no período.">Total que entrou</span>}
          valor={fmtBRL(fin.receitaBruta)}
          detalhe={`${fmtNum(fin.totalLancamentos)} lançamento(s) pagos`} />
        <Numero rotulo="Total que saiu" valor={fmtBRL(fin.despesasTotais)}
          detalhe={`Variáveis ${fmtBRL(fin.despesasVariaveis)} · Fixas ${fmtBRL(fin.despesasFixas)}`} />
        <Numero rotulo={<span title="Receitas menos despesas. É o que sobrou no bolso depois de pagar tudo.">Lucro do período</span>}
          valor={fmtBRL(fin.lucroLiquido)}
          tom={Number(fin.lucroLiquido) < 0 ? 'perigo' : 'sucesso'}
          detalhe={`Margem ${fmtPct(fin.margemLiquida)}`} />
        <Numero rotulo="Vendas" valor={fmtNum(vd.total)}
          detalhe={`Ticket médio ${fmtBRL(vd.ticketMedio)}`} />
      </FaixaNumeros>

      <ColunasPagina
        lateral={(
          <>
            <Painel titulo="Situação" acoes={<Badge variant="neutral">Snapshot imutável</Badge>} semPadding>
              <LinhaInfo rotulo="Fechado em" valor={new Date(dados.geradoEm).toLocaleDateString('pt-BR')} />
              <LinhaInfo rotulo="Como foi gerado" valor={dados.geradoPor === 'CRON' ? 'Automático' : 'Manual'} />
            </Painel>
            <Painel titulo="Caixa" semPadding>
              <LinhaInfo rotulo="Sessões fechadas" valor={fmtNum(cx.sessoesFechadas)} />
              <LinhaInfo rotulo="Retiradas" valor={fmtBRL(cx.totalSangrias)} />
              <LinhaInfo rotulo="Entradas no caixa" valor={fmtBRL(cx.totalSuprimentos)} />
              <LinhaInfo rotulo="Diferença acumulada">
                <span className={`font-bold tabular-nums ${dif > 0 ? 'text-[var(--success-text)]' : dif < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--text-main)]'}`}>
                  {fmtBRL(dif)}
                </span>
              </LinhaInfo>
            </Painel>
            <Painel titulo="Clientes" semPadding>
              <LinhaInfo rotulo="Clientes novos cadastrados" valor={fmtNum(crm.leadsCriados)} />
            </Painel>
          </>
        )}
      >
        <Painel titulo="Resultado do mês" subtitulo="Só o que foi pago no mês" semPadding>
          <LinhaInfo rotulo="Total que entrou" valor={fmtBRL(fin.receitaBruta)} />
          <LinhaInfo rotulo="Despesas variáveis" valor={`− ${fmtBRL(fin.despesasVariaveis)}`} />
          <LinhaInfo rotulo="Despesas fixas" valor={`− ${fmtBRL(fin.despesasFixas)}`} />
          <LinhaInfo rotulo="Lucro do período" forte valor={fmtBRL(fin.lucroLiquido)} />
          <LinhaInfo rotulo="Margem de lucro" valor={fmtPct(fin.margemLiquida)} />
          <LinhaInfo rotulo="Faturamento em vendas" valor={fmtBRL(vd.faturamento)} />
        </Painel>

        <Painel titulo="O que mais vendeu no mês" subtitulo="Os que mais geraram receita" semPadding corpoClassName="overflow-x-auto">
          {top.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-[var(--text-muted)]">Nenhum produto vendido neste mês.</div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={`${TH} text-left w-10`}>#</th>
                  <th className={`${TH} text-left`}>Produto</th>
                  <th className={`${TH} text-right`}>Qtd</th>
                  <th className={`${TH} text-right`}>Receita</th>
                </tr>
              </thead>
              <tbody>
                {top.map((p, i) => (
                  <tr key={i}>
                    <td className={`${TD} text-[var(--text-muted)]`}>{i + 1}</td>
                    <td className={`${TD} font-semibold text-[var(--text-main)]`}>{p.nome}</td>
                    <td className={`${TD} text-right tabular-nums`}>{fmtNum(p.quantidade)}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>{fmtBRL(p.receita)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Painel>
      </ColunasPagina>
    </Pagina>
  );
}
