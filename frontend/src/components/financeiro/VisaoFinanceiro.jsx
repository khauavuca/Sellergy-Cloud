// Blocos da visão do mês na tela Financeiro: faixa de números, gráfico
// "entrou e saiu" e a coluna lateral (próximos 7 dias, resultado, atalhos).
// Tudo calculado a partir dos lançamentos que a página já busca.
import { Link } from 'react-router-dom';
import { FaixaNumeros, Numero, Painel, LinhaInfo, Badge } from '../ui';
import { fmtBRL, diasAte, rotuloDia, tomVencimento, filtrarProximos7 } from './dadosFinanceiro';

export function FaixaFinanceiro({ resumo, despesasPendentes, carregando }) {
  const entrou = resumo?.totalReceitas || 0;
  const saiu = resumo?.totalDespesas || 0;
  const sobra = entrou - saiu;
  const aPagar = despesasPendentes.reduce((s, l) => s + (Number(l.valor) || 0), 0);
  const atrasadas = despesasPendentes.filter((l) => diasAte(l.dataVencimento) < 0).length;
  const em7 = despesasPendentes.filter((l) => {
    const d = diasAte(l.dataVencimento);
    return d >= 0 && d <= 7;
  }).length;
  const pct = entrou > 0 ? Math.round((sobra / entrou) * 100) : null;

  let detalheAPagar = 'nada em aberto neste mês';
  if (despesasPendentes.length > 0) {
    const partes = [];
    if (atrasadas) partes.push(`${atrasadas} ${atrasadas === 1 ? 'atrasada' : 'atrasadas'}`);
    partes.push(`${em7} ${em7 === 1 ? 'vence' : 'vencem'} em 7 dias`);
    detalheAPagar = partes.join(' · ');
  }

  return (
    <FaixaNumeros>
      <Numero
        rotulo="Entrou no mês"
        valor={fmtBRL(entrou)}
        detalhe="receitas já recebidas"
        tom="sucesso"
        carregando={carregando}
      />
      <Numero
        rotulo="A receber"
        valor={fmtBRL(resumo?.aReceber || 0)}
        detalhe="receitas pendentes no mês"
        carregando={carregando}
      />
      <Numero
        rotulo="Contas a pagar"
        valor={fmtBRL(aPagar)}
        detalhe={detalheAPagar}
        tom={aPagar > 0 ? 'alerta' : 'neutro'}
        tomDetalhe={atrasadas ? 'perigo' : 'neutro'}
        carregando={carregando}
      />
      <Numero
        rotulo="Sobra no mês"
        valor={fmtBRL(sobra)}
        detalhe={pct === null ? 'nada recebido ainda' : `${pct}% do que entrou`}
        destaque
        carregando={carregando}
      />
    </FaixaNumeros>
  );
}

export function GraficoEntrouSaiu({ semanas }) {
  const max = Math.max(1, ...semanas.flatMap((s) => [s.entrou, s.saiu]));
  const vazio = semanas.every((s) => s.entrou === 0 && s.saiu === 0);
  return (
    <Painel
      titulo="Entrou e saiu, semana a semana"
      subtitulo="Lançamentos pagos do mês, pelo vencimento"
      acoes={
        <div className="flex items-center gap-3 text-xs font-medium text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--success)]" aria-hidden="true" />Entrou</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--danger)]" aria-hidden="true" />Saiu</span>
        </div>
      }
    >
      {vazio ? (
        <p className="m-0 py-8 text-center text-[13px] text-[var(--text-muted)]">Nenhum lançamento pago neste mês ainda.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex items-end gap-4 h-[150px]">
          {semanas.map((s) => (
            <li
              key={s.nome}
              className="flex-1 min-w-0 flex flex-col items-center gap-2"
              aria-label={`${s.nome}: entrou ${fmtBRL(s.entrou)}, saiu ${fmtBRL(s.saiu)}`}
            >
              <div className="flex items-end justify-center gap-1.5 h-[120px] w-full" aria-hidden="true">
                <div
                  className="w-full max-w-[28px] rounded-t-[4px] bg-[var(--success)]"
                  style={{ height: `${Math.max(2, Math.round((s.entrou / max) * 120))}px` }}
                  title={`Entrou ${fmtBRL(s.entrou)}`}
                />
                <div
                  className="w-full max-w-[28px] rounded-t-[4px] bg-[var(--danger)] opacity-80"
                  style={{ height: `${Math.max(2, Math.round((s.saiu / max) * 120))}px` }}
                  title={`Saiu ${fmtBRL(s.saiu)}`}
                />
              </div>
              <span className="text-xs font-medium text-[var(--text-muted)] truncate">{s.nome}</span>
            </li>
          ))}
        </ul>
      )}
    </Painel>
  );
}

export function PainelProximos7({ pendentes }) {
  const lista = filtrarProximos7(pendentes);
  const total = lista.reduce((s, l) => s + (Number(l.valor) || 0), 0);
  const mostrar = lista.slice(0, 6);
  return (
    <Painel
      titulo="Próximos 7 dias"
      subtitulo="Despesas em aberto, com as atrasadas"
      acoes={lista.length > 0 ? <Badge variant={lista.some((l) => diasAte(l.dataVencimento) < 0) ? 'danger' : 'warning'}>{fmtBRL(total)}</Badge> : null}
      semPadding
    >
      {lista.length === 0 ? (
        <p className="m-0 px-4 py-4 text-[13px] text-[var(--text-muted)]">Nenhuma despesa vencendo nos próximos 7 dias.</p>
      ) : (
        <>
          {mostrar.map((l) => (
            <LinhaInfo
              key={l.id}
              rotulo={
                <span className="inline-flex items-center gap-2 min-w-0">
                  <Badge variant={tomVencimento(l.dataVencimento)} size="sm">{rotuloDia(l.dataVencimento)}</Badge>
                  <span className="truncate">{l.descricao}</span>
                </span>
              }
              valor={fmtBRL(l.valor)}
            />
          ))}
          {lista.length > mostrar.length && (
            <LinhaInfo rotulo={<span className="text-[var(--text-muted)]">e mais {lista.length - mostrar.length}</span>} />
          )}
        </>
      )}
    </Painel>
  );
}

export function PainelResultadoMes({ resumo, categoriasDespesa }) {
  const entrou = resumo?.totalReceitas || 0;
  const saiu = resumo?.totalDespesas || 0;
  const sobra = entrou - saiu;
  return (
    <Painel
      titulo="Resultado do mês"
      acoes={
        <Link
          to="/app/relatorios"
          className="h-8 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-xs font-semibold text-[var(--text-main)] inline-flex items-center hover:bg-[var(--bg-subtle)]"
        >
          Relatórios
        </Link>
      }
      semPadding
    >
      <LinhaInfo rotulo="Entrou" valor={fmtBRL(entrou)} forte />
      {categoriasDespesa.length === 0 ? (
        <LinhaInfo rotulo="Despesas pagas" valor={saiu > 0 ? `− ${fmtBRL(saiu)}` : fmtBRL(0)} />
      ) : (
        categoriasDespesa.map((c) => (
          <LinhaInfo key={c.nome} rotulo={c.nome} valor={`− ${fmtBRL(c.valor)}`} />
        ))
      )}
      <LinhaInfo
        rotulo={<strong className="text-[var(--text-main)]">Sobra</strong>}
        valor={<span className={sobra < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--success-text)]'}>{fmtBRL(sobra)}</span>}
        forte
        className="bg-[var(--bg-subtle)]"
      />
    </Painel>
  );
}

const ATALHOS = [
  { to: '/app/financeiro/caixa', rotulo: 'Caixa' },
  { to: '/app/financeiro/contas-pagar', rotulo: 'Contas a pagar' },
  { to: '/app/financeiro/categorias', rotulo: 'Categorias' },
  { to: '/app/comissoes', rotulo: 'Comissões' },
  { to: '/app/recebimentos', rotulo: 'Recebimentos' },
  { to: '/app/relatorios', rotulo: 'Relatórios' },
];

export function PainelAtalhos({ atual }) {
  return (
    <Painel titulo="Atalhos">
      <div className="flex flex-wrap gap-2">
        {ATALHOS.filter((a) => a.to !== atual).map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="h-8 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] font-semibold text-[var(--text-main)] inline-flex items-center hover:bg-[var(--bg-subtle)]"
          >
            {a.rotulo}
          </Link>
        ))}
      </div>
    </Painel>
  );
}
