// =====================================================================
// ABA CAIXA DO FINANCEIRO
// =====================================================================
// - Cabeçalho "Caixa de hoje" com situação, saldo esperado e ações
//   (retirada, entrada, pagar despesa, fechar) — ou "Abrir caixa".
// - Números por forma de pagamento (entradas pagas da sessão).
// - Movimentos da sessão (entradas + retiradas/entradas de dinheiro).
// - Conferência do saldo esperado.
// - Lateral: dados da sessão e últimos fechamentos.
// Detalhe da sessão vem de GET /financeiro/caixa/sessoes/:id (já existente).
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { Wallet, ArrowUpFromLine, ArrowDownToLine, DollarSign, Lock, History } from 'lucide-react';
import api from '../../services/api';
import {
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, BarraFerramentas, AbasPilula,
  Badge, Button, EmptyState,
} from '../ui';
import { fmtBRL, METODO_LABEL } from './dadosFinanceiro';

const ORDEM_FORMAS = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO'];
const TH = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const TD = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';

const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export default function CaixaTela({
  sessao, sessoesFechadas, podeCriar, podeEditar,
  onAbrir, onRetirada, onEntrada, onPagarDespesa, onFechar,
}) {
  const [detalhe, setDetalhe] = useState(null);
  const [aba, setAba] = useState('todos');
  const [verTodosFechamentos, setVerTodosFechamentos] = useState(false);

  // Recarrega o detalhe sempre que a página busca a sessão de novo
  // (depois de retirada, entrada, pagamento etc.).
  useEffect(() => {
    if (!sessao?.id) return;
    let ativo = true;
    api.get(`/financeiro/caixa/sessoes/${sessao.id}`)
      .then((r) => { if (ativo) setDetalhe(r.data?.sessao || null); })
      .catch(() => { if (ativo) setDetalhe({ id: sessao.id, lancamentos: [], movimentacoesSaldo: [], erro: true }); });
    return () => { ativo = false; };
  }, [sessao]);

  const det = detalhe && sessao && detalhe.id === sessao.id ? detalhe : null;

  const dados = useMemo(() => {
    const entradas = (det?.lancamentos || []).filter((l) => l.tipo === 'RECEITA' && l.status === 'PAGO');
    const movsSaldo = det?.movimentacoesSaldo || [];
    const porForma = new Map(ORDEM_FORMAS.map((f) => [f, { total: 0, qtd: 0 }]));
    entradas.forEach((l) => {
      const f = l.metodoPagamento || 'NAO_INFORMADO';
      if (!porForma.has(f)) porForma.set(f, { total: 0, qtd: 0 });
      const item = porForma.get(f);
      item.total += Number(l.valor) || 0;
      item.qtd += 1;
    });
    const totalEntradas = entradas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
    const suprimentos = movsSaldo.filter((m) => m.tipo === 'SUPRIMENTO').reduce((s, m) => s + m.valor, 0);
    const sangrias = movsSaldo.filter((m) => m.tipo === 'SANGRIA').reduce((s, m) => s + m.valor, 0);
    // Ajuste manual tem sinal (+ sobra / − falta) e entra no saldo esperado.
    const ajustes = movsSaldo.filter((m) => m.tipo === 'AJUSTE').reduce((s, m) => s + m.valor, 0);

    const movimentos = [
      ...entradas.map((l) => ({
        id: `l-${l.id}`,
        grupo: 'vendas',
        data: l.dataPagamento || l.criadoEm,
        oque: l.vendaId ? 'Venda' : 'Entrada',
        detalhe: l.descricao,
        quem: '—',
        forma: METODO_LABEL[l.metodoPagamento] || 'Não informada',
        valor: `+ ${fmtBRL(l.valor)}`,
        tom: 'text-[var(--text-main)]',
      })),
      ...movsSaldo.map((m) => ({
        id: `m-${m.id}`,
        grupo: 'gaveta',
        data: m.data,
        oque: m.tipo === 'SANGRIA' ? 'Retirada' : m.tipo === 'SUPRIMENTO' ? 'Entrada de dinheiro' : 'Ajuste',
        detalhe: m.motivo || '—',
        quem: m.usuarioNome || '—',
        forma: 'Dinheiro',
        valor: `${m.tipo === 'SANGRIA' || m.valor < 0 ? '−' : '+'} ${fmtBRL(Math.abs(m.valor))}`,
        tom: m.tipo === 'SANGRIA' || m.valor < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--success-text)]',
      })),
    ];
    if (sessao) {
      movimentos.push({
        id: 'abertura',
        grupo: 'gaveta',
        data: sessao.abertaEm,
        oque: sessao.origem === 'AUTO_BOT' ? 'Abertura automática' : 'Abertura',
        detalhe: 'Fundo de caixa (troco)',
        quem: sessao.usuarioAbriuNome || (sessao.origem === 'AUTO_BOT' ? 'Sistema' : '—'),
        forma: 'Dinheiro',
        valor: `+ ${fmtBRL(sessao.fundoCaixa || 0)}`,
        tom: 'text-[var(--success-text)]',
      });
    }
    movimentos.sort((a, b) => new Date(b.data) - new Date(a.data));

    return { porForma, totalEntradas, qtdEntradas: entradas.length, suprimentos, sangrias, ajustes, movimentos };
  }, [det, sessao]);

  const movimentosVisiveis = dados.movimentos.filter((m) => aba === 'todos' || m.grupo === aba);
  const fechamentos = verTodosFechamentos ? sessoesFechadas : sessoesFechadas.slice(0, 5);
  const saldoEsperado = sessao ? (sessao.saldoEsperado ?? sessao.fundoCaixa ?? 0) : 0;

  const lateral = (
    <>
      {sessao && (
        <Painel titulo="Sessão aberta" semPadding>
          <LinhaInfo rotulo="Aberta em" valor={new Date(sessao.abertaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} />
          <LinhaInfo rotulo="Responsável" valor={sessao.usuarioAbriuNome || (sessao.origem === 'AUTO_BOT' ? 'Sistema' : '—')} />
          <LinhaInfo rotulo="Origem" valor={sessao.origem === 'AUTO_BOT' ? 'Automática' : 'Manual'} />
          <LinhaInfo rotulo="Fundo de caixa" valor={fmtBRL(sessao.fundoCaixa || 0)} />
          {sessao.observacaoAbertura && (
            <LinhaInfo rotulo={<span className="text-[var(--text-muted)]">{sessao.observacaoAbertura}</span>} />
          )}
        </Painel>
      )}
      <Painel
        titulo="Últimos fechamentos"
        subtitulo={`${sessoesFechadas.length} ${sessoesFechadas.length === 1 ? 'sessão fechada' : 'sessões fechadas'}`}
        acoes={sessoesFechadas.length > 5 ? (
          <Button variant="ghost" size="sm" onClick={() => setVerTodosFechamentos((v) => !v)}>
            {verTodosFechamentos ? 'Ver menos' : 'Ver todos'}
          </Button>
        ) : null}
        semPadding
      >
        {sessoesFechadas.length === 0 ? (
          <EmptyState
            icon={History}
            title="Nenhuma sessão fechada ainda"
            description="O histórico aparece aqui quando você fechar a 1ª sessão."
          />
        ) : (
          fechamentos.map((s) => {
            const dif = s.diferenca ?? 0;
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0 text-[13px]">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[var(--text-main)]">
                    {new Date(s.abertaEm).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                    {s.origem === 'AUTO_BOT' && <span className="ml-1.5 text-xs font-medium text-[var(--text-muted)]">auto</span>}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] truncate">
                    {[s.usuarioFechouNome, s.fechadaEm && hora(s.fechadaEm)].filter(Boolean).join(' · ') || '—'}
                    {' · esperado '}{fmtBRL(s.saldoFinalEsperado ?? 0)}
                  </div>
                </div>
                <strong className="tabular-nums text-[var(--text-main)]">{fmtBRL(s.saldoFinalReal ?? 0)}</strong>
                <Badge variant={dif === 0 ? 'success' : dif > 0 ? 'info' : 'danger'} size="sm">
                  {dif === 0 ? 'sem diferença' : `${dif > 0 ? '+' : '−'} ${fmtBRL(Math.abs(dif))}`}
                </Badge>
              </div>
            );
          })
        )}
      </Painel>
    </>
  );

  return (
    <Pagina>
      {/* Cabeçalho do caixa */}
      <section
        aria-label="Situação do caixa"
        className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] px-4 py-3.5 flex flex-wrap items-center gap-4"
      >
        <div className={`w-11 h-11 rounded-[10px] flex items-center justify-center flex-shrink-0 ${sessao ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'}`}>
          <Wallet size={20} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-[220px]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[15px] font-bold text-[var(--text-main)] tracking-tight">Caixa de hoje</h2>
            <Badge variant={sessao ? 'success' : 'neutral'} size="sm">{sessao ? 'Aberto' : 'Fechado'}</Badge>
            {sessao?.origem === 'AUTO_BOT' && <Badge variant="neutral" size="sm">Abertura automática</Badge>}
          </div>
          <p className="m-0 mt-0.5 text-xs text-[var(--text-muted)]">
            {sessao ? (
              <>
                Aberto às {hora(sessao.abertaEm)} de {new Date(sessao.abertaEm).toLocaleDateString('pt-BR')}
                {' · fundo de caixa '}{fmtBRL(sessao.fundoCaixa || 0)}
                {sessao.usuarioAbriuNome && <> · responsável {sessao.usuarioAbriuNome}</>}
              </>
            ) : (
              'Abra o caixa pra começar a registrar vendas manuais. A abertura fica registrada com seu nome.'
            )}
          </p>
        </div>
        {sessao && (
          <div className="text-right">
            <div className="text-xs font-medium text-[var(--text-muted)]">Saldo esperado</div>
            <div className="text-[22px] font-bold tracking-tight tabular-nums text-[var(--text-main)]">{fmtBRL(saldoEsperado)}</div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!sessao && podeCriar && (
            <Button variant="primary" icon={Wallet} onClick={onAbrir}>Abrir caixa</Button>
          )}
          {sessao && podeEditar && (
            <>
              <Button variant="secondary" size="sm" icon={ArrowUpFromLine} title="Tirar dinheiro do caixa (ex.: depositar no banco)" onClick={onRetirada}>
                Retirada
              </Button>
              <Button variant="secondary" size="sm" icon={ArrowDownToLine} title="Colocar dinheiro no caixa (ex.: troco extra)" onClick={onEntrada}>
                Entrada
              </Button>
              <Button variant="secondary" size="sm" icon={DollarSign} title="Pagar uma despesa cadastrada (cria lançamento + retirada do caixa)" onClick={onPagarDespesa}>
                Pagar despesa
              </Button>
              <Button variant="primary" size="sm" icon={Lock} onClick={onFechar}>
                Fechar caixa
              </Button>
            </>
          )}
        </div>
      </section>

      {sessao && (
        <FaixaNumeros min={150}>
          {[...dados.porForma.entries()].map(([forma, v]) => (
            <Numero
              key={forma}
              rotulo={METODO_LABEL[forma] || 'Forma não informada'}
              valor={fmtBRL(v.total)}
              detalhe={v.qtd === 0 ? 'nenhuma entrada' : `${v.qtd} ${v.qtd === 1 ? 'entrada' : 'entradas'}`}
              carregando={!det}
            />
          ))}
          <Numero
            rotulo="Total que entrou"
            valor={fmtBRL(dados.totalEntradas)}
            detalhe={dados.qtdEntradas > 0
              ? `${dados.qtdEntradas} ${dados.qtdEntradas === 1 ? 'entrada' : 'entradas'} · média ${fmtBRL(dados.totalEntradas / dados.qtdEntradas)}`
              : 'nenhuma entrada ainda'}
            destaque
            carregando={!det}
          />
        </FaixaNumeros>
      )}

      <ColunasPagina lateral={lateral}>
        {sessao ? (
          <>
            <Painel semPadding>
              <BarraFerramentas>
                <AbasPilula
                  rotulo="Tipo de movimento"
                  abas={[
                    { valor: 'todos', rotulo: 'Todos' },
                    { valor: 'vendas', rotulo: 'Vendas e entradas' },
                    { valor: 'gaveta', rotulo: 'Retiradas e entradas de dinheiro' },
                  ]}
                  valor={aba}
                  onChange={setAba}
                />
                <span className="ml-auto text-xs font-medium text-[var(--text-muted)]">
                  {movimentosVisiveis.length} {movimentosVisiveis.length === 1 ? 'movimento' : 'movimentos'}
                </span>
              </BarraFerramentas>
              {!det ? (
                <p className="m-0 px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Carregando movimentos...</p>
              ) : det.erro ? (
                <p className="m-0 px-4 py-8 text-center text-[13px] text-[var(--danger-text)]">Não foi possível carregar os movimentos desta sessão.</p>
              ) : movimentosVisiveis.length === 0 ? (
                <p className="m-0 px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Nenhum movimento aqui ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr>
                        <th className={TH}>Hora</th>
                        <th className={TH}>O quê</th>
                        <th className={TH}>Detalhe</th>
                        <th className={TH}>Quem</th>
                        <th className={TH}>Forma</th>
                        <th className={`${TH} text-right`}>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movimentosVisiveis.map((m) => (
                        <tr key={m.id}>
                          <td className={`${TD} tabular-nums text-[var(--text-muted)] whitespace-nowrap`}>{hora(m.data)}</td>
                          <td className={`${TD} font-semibold text-[var(--text-main)] whitespace-nowrap`}>{m.oque}</td>
                          <td className={`${TD} text-[var(--text-secondary)]`}>{m.detalhe}</td>
                          <td className={`${TD} text-[var(--text-secondary)] whitespace-nowrap`}>{m.quem}</td>
                          <td className={TD}>
                            <Badge variant={m.forma === 'Dinheiro' ? 'warning' : m.forma === 'Pix' ? 'success' : 'info'} size="sm">{m.forma}</Badge>
                          </td>
                          <td className={`${TD} text-right font-semibold tabular-nums whitespace-nowrap ${m.tom}`}>{m.valor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Painel>

            <Painel
              titulo="Conferência do saldo"
              subtitulo="Como o sistema chega no saldo esperado. Na hora de fechar, você informa o valor contado."
            >
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                <ItemConferencia rotulo="Fundo de caixa" valor={fmtBRL(sessao.fundoCaixa || 0)} />
                <ItemConferencia rotulo="Entradas da sessão" valor={`+ ${fmtBRL(dados.totalEntradas)}`} />
                <ItemConferencia rotulo="Entradas de dinheiro" valor={`+ ${fmtBRL(dados.suprimentos)}`} />
                <ItemConferencia rotulo="Retiradas" valor={`− ${fmtBRL(dados.sangrias)}`} />
                {dados.ajustes !== 0 && (
                  <ItemConferencia rotulo="Ajustes" valor={`${dados.ajustes < 0 ? '−' : '+'} ${fmtBRL(Math.abs(dados.ajustes))}`} />
                )}
                <ItemConferencia rotulo="Saldo esperado" valor={fmtBRL(saldoEsperado)} forte />
              </div>
            </Painel>
          </>
        ) : (
          <Painel>
            <EmptyState
              icon={Wallet}
              title="Caixa fechado"
              description="Informe o fundo de caixa (dinheiro inicial pra troco) ao abrir. As vendas, retiradas e entradas da sessão aparecem aqui."
              action={podeCriar ? <Button variant="primary" icon={Wallet} onClick={onAbrir}>Abrir caixa</Button> : null}
            />
          </Painel>
        )}
      </ColunasPagina>
    </Pagina>
  );
}

function ItemConferencia({ rotulo, valor, forte = false }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 ${forte ? 'bg-[var(--success-soft)]' : 'bg-[var(--bg-subtle)]'}`}>
      <div className={`text-xs font-medium ${forte ? 'text-[var(--success-text)]' : 'text-[var(--text-muted)]'}`}>{rotulo}</div>
      <div className={`mt-0.5 text-[15px] font-bold tabular-nums ${forte ? 'text-[var(--success-text)]' : 'text-[var(--text-main)]'}`}>{valor}</div>
    </div>
  );
}
