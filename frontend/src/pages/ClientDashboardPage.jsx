import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, Calendar, ArrowUpRight, Clock, Smartphone, CheckCircle2 } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/auth.store';
import { Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, Badge, EmptyState } from '../components/ui';
import { moduloLiberado } from '../constants/permissoes';
import InicioChecklist from '../components/conta/InicioChecklist';

const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCurto = (v) => `R$ ${Math.round(Number(v || 0)).toLocaleString('pt-BR')}`;
const horaDe = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Status de venda -> rotulo + variante de badge (sobrio: semantico, sem accent).
const STATUS_VENDA = {
  COMPLETED: { rotulo: 'Concluída', variant: 'success' },
  PENDING: { rotulo: 'Pendente', variant: 'warning' },
  CANCELLED: { rotulo: 'Cancelada', variant: 'danger' },
  REFUNDED: { rotulo: 'Estornada', variant: 'neutral' },
};

const STATUS_AGENDA = {
  PENDING: { rotulo: 'Aguardando', variant: 'warning' },
  CONFIRMED: { rotulo: 'Confirmado', variant: 'success' },
  COMPLETED: { rotulo: 'Atendido', variant: 'neutral' },
  CANCELED: { rotulo: 'Cancelado', variant: 'danger' },
};

const FORMA_PAGAMENTO = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  CREDITO: 'Cartão de crédito',
  DEBITO: 'Cartão de débito',
  BOLETO: 'Boleto',
};

const linkSutil = 'text-[13px] font-semibold text-[var(--primary)] hover:text-[var(--primary-hover)] inline-flex items-center gap-1';

function inicioDoDia(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// "terça passada", "sábado passado".
function diaSemanaPassada() {
  const dia = new Date().toLocaleDateString('pt-BR', { weekday: 'long' }).split('-')[0];
  const masculino = dia === 'sábado' || dia === 'domingo';
  return `${dia} ${masculino ? 'passado' : 'passada'}`;
}

function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Visao geral do tenant — painel de GESTAO (pos-pivo ERP-first).
 * Usa so dados reais: vendas, agendamentos de hoje, leads, o resumo de
 * /hoje (caixa e Pix a receber, so dona/ADMINISTRADOR) e a fila de
 * reposicao do estoque. Sem metricas de "bot/inbox" (produto antigo).
 */
export default function ClientDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const modulos = user?.modulosLiberados || {};
  const privilegiado = user?.perfil === 'CLIENT' || user?.perfil === 'ADMINISTRADOR';

  const [vendas, setVendas] = useState([]);
  const [leads, setLeads] = useState([]);
  const [agendamentos, setAgendamentos] = useState([]);
  const [resumoHoje, setResumoHoje] = useState(null);
  const [reposicao, setReposicao] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const carregar = async () => {
      const promises = [];
      if (moduloLiberado(modulos, 'VENDAS')) {
        promises.push(api.get('/vendas').then((r) => setVendas(r.data || [])).catch(() => setVendas([])));
      }
      if (moduloLiberado(modulos, 'CRM')) {
        promises.push(api.get('/crm/leads').then((r) => setLeads(r.data || [])).catch(() => setLeads([])));
      }
      if (moduloLiberado(modulos, 'AGENDA')) {
        const hoje = new Date().toISOString().split('T')[0];
        promises.push(api.get(`/agenda?date=${hoje}`).then((r) => setAgendamentos(r.data || [])).catch(() => setAgendamentos([])));
      }
      if (privilegiado) {
        promises.push(api.get('/hoje').then((r) => setResumoHoje(r.data || null)).catch(() => setResumoHoje(null)));
      }
      if (moduloLiberado(modulos, 'ESTOQUE')) {
        promises.push(api.get('/estoque/reposicao').then((r) => setReposicao(Array.isArray(r.data) ? r.data : [])).catch(() => setReposicao([])));
      }
      await Promise.all(promises);
      setCarregando(false);
    };
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const m = useMemo(() => {
    const hoje = inicioDoDia();
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

    const validas = vendas.filter((v) => v.status !== 'CANCELLED');
    const noIntervalo = (v, de, ate) => {
      const d = new Date(v.data);
      return d >= de && d < ate;
    };
    const soma = (lista) => lista.reduce((acc, v) => acc + Number(v.valor || 0), 0);

    const vendasHoje = validas.filter((v) => noIntervalo(v, hoje, amanha));
    const totalHoje = soma(vendasHoje);
    const ticket = vendasHoje.length ? totalHoje / vendasHoje.length : 0;

    // Mesmo dia da semana passada (comparacao do "Vendido hoje").
    const semanaPassada = new Date(hoje);
    semanaPassada.setDate(semanaPassada.getDate() - 7);
    const fimSemanaPassada = new Date(semanaPassada);
    fimSemanaPassada.setDate(fimSemanaPassada.getDate() + 1);
    const totalSemanaPassada = soma(validas.filter((v) => noIntervalo(v, semanaPassada, fimSemanaPassada)));
    const variacao = totalSemanaPassada > 0 ? Math.round(((totalHoje - totalSemanaPassada) / totalSemanaPassada) * 100) : null;

    const vendasMes = validas.filter((v) => noIntervalo(v, inicioMes, amanha));
    const ticketMes = vendasMes.length ? soma(vendasMes) / vendasMes.length : 0;

    // Ultimos 7 dias (hoje por ultimo).
    const semana = [];
    for (let i = 6; i >= 0; i -= 1) {
      const de = new Date(hoje);
      de.setDate(de.getDate() - i);
      const ate = new Date(de);
      ate.setDate(ate.getDate() + 1);
      const dia = de.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
      semana.push({ chave: de.toISOString(), dia: dia.charAt(0).toUpperCase() + dia.slice(1), valor: soma(validas.filter((v) => noIntervalo(v, de, ate))), hoje: i === 0 });
    }
    const totalSemana = semana.reduce((acc, d) => acc + d.valor, 0);
    const maxSemana = Math.max(...semana.map((d) => d.valor), 0);

    // Vendas de hoje por forma de pagamento.
    const porForma = new Map();
    for (const v of vendasHoje) {
      const chave = v.metodoPagamento || '';
      porForma.set(chave, (porForma.get(chave) || 0) + Number(v.valor || 0));
    }
    const formas = [...porForma.entries()]
      .map(([chave, valor]) => ({ chave, rotulo: chave ? FORMA_PAGAMENTO[chave] || chave : 'Sem forma informada', valor }))
      .sort((a, b) => b.valor - a.valor);

    // Mais vendidos no mes: produtos (saidas de estoque da venda) e servicos
    // (venda nascida de agendamento atendido, descricao = servico).
    const contagem = new Map();
    const somar = (nome, qtd) => {
      if (!nome) return;
      contagem.set(nome, (contagem.get(nome) || 0) + qtd);
    };
    for (const v of vendasMes) {
      const movs = Array.isArray(v.movimentacoesEstoque) ? v.movimentacoesEstoque : [];
      for (const mov of movs) {
        const nome = mov.variacao?.produto?.nome;
        somar(nome, Math.abs(Number(mov.quantidade) || 0));
      }
      if (v.agendamentoId && movs.length === 0) somar(v.descricao, 1);
    }
    const maisVendidos = [...contagem.entries()]
      .filter(([, qtd]) => qtd > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([nome, qtd]) => ({ nome, qtd }));

    const recentes = [...vendas].sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 5);

    const agendaAtiva = agendamentos.filter((a) => a.status !== 'CANCELED');
    const agendaDoDia = [...agendaAtiva].sort((a, b) => new Date(a.data) - new Date(b.data));
    const agendAtendidos = agendaAtiva.filter((a) => a.status === 'COMPLETED').length;
    const agendPendentes = agendaAtiva.filter((a) => a.status === 'PENDING').length;
    const sinaisPendentes = agendaAtiva.filter((a) => a.sinalStatus === 'PENDENTE').length;
    const agora = new Date().getTime();
    const proximos = agendaDoDia.filter((a) => a.status !== 'COMPLETED' && new Date(a.data).getTime() >= agora - 30 * 60 * 1000);

    const abaixoMinimo = reposicao.filter((r) => r.urgencia === 'ALTA');

    return {
      totalHoje, qtdHoje: vendasHoje.length, ticket, ticketMes, variacao,
      semana, totalSemana, maxSemana, formas, maisVendidos, recentes,
      agendaDoDia, proximos, agendHoje: agendaAtiva.length, agendAtendidos, agendPendentes, sinaisPendentes,
      totalLeads: leads.length, abaixoMinimo,
    };
  }, [vendas, agendamentos, leads, reposicao]);

  const temVendas = moduloLiberado(modulos, 'VENDAS');
  const temAgenda = moduloLiberado(modulos, 'AGENDA');
  const temCrm = moduloLiberado(modulos, 'CRM');
  const primeiroNome = (user?.nome || user?.name || '').split(' ')[0];

  const aReceber = resumoHoje?.aReceber;
  const caixa = resumoHoje?.caixa;

  // "Precisa da sua atencao": so o que da pra contar com dado real.
  const atencao = [];
  if (temAgenda && m.agendPendentes > 0) {
    atencao.push({ chave: 'agenda', tag: 'Agenda', variant: 'warning', texto: `${plural(m.agendPendentes, 'horário', 'horários')} de hoje sem confirmação`, link: '/app/agenda' });
  }
  if (temAgenda && m.sinaisPendentes > 0) {
    atencao.push({ chave: 'sinal', tag: 'Sinal', variant: 'danger', texto: `${plural(m.sinaisPendentes, 'sinal', 'sinais')} por Pix ainda não ${m.sinaisPendentes === 1 ? 'pago' : 'pagos'} hoje`, link: '/app/agenda' });
  }
  if (aReceber?.quantidade > 0) {
    atencao.push({ chave: 'pix', tag: 'Pix', variant: 'danger', texto: `${plural(aReceber.quantidade, 'Pix pendente', 'Pix pendentes')} · ${fmtBRL(aReceber.valor)}`, link: '/app/recebimentos' });
  }
  if (m.abaixoMinimo.length > 0) {
    const primeiro = m.abaixoMinimo[0];
    const nome = [primeiro.produto, primeiro.variacao].filter(Boolean).join(' ');
    atencao.push({
      chave: 'estoque', tag: 'Estoque', variant: 'info',
      texto: m.abaixoMinimo.length === 1 ? `${nome} abaixo do mínimo` : `${nome} e mais ${m.abaixoMinimo.length - 1} abaixo do mínimo`,
      link: '/app/estoque/reposicao',
    });
  }
  if (privilegiado && caixa && !caixa.aberto && temVendas) {
    atencao.push({ chave: 'caixa', tag: 'Caixa', variant: 'warning', texto: 'Caixa fechado: abra para registrar vendas', link: '/app/financeiro/caixa' });
  }

  const resumoAgenda = temAgenda
    ? m.agendHoje === 0
      ? 'Nenhum atendimento marcado para hoje.'
      : `${plural(m.agendHoje, 'atendimento marcado', 'atendimentos marcados')} hoje${m.agendPendentes ? `, ${m.agendPendentes} aguardando confirmação` : ''}.`
    : 'Como está o seu negócio hoje.';

  const lateral = (
    <>
      <InicioChecklist />

      {privilegiado && (temVendas || caixa) && (
        <Painel
          titulo="Caixa de hoje"
          id="caixa-hoje"
          semPadding
          acoes={caixa ? (
            caixa.aberto
              ? <Badge variant="success" size="sm">{caixa.abertoEm ? `Aberto ${horaDe(caixa.abertoEm)}` : 'Aberto'}</Badge>
              : <Badge variant="neutral" size="sm">Fechado</Badge>
          ) : null}
        >
          {m.formas.length === 0 ? (
            <p className="m-0 px-4 py-3 text-[13px] text-[var(--text-muted)]">Nenhuma venda registrada hoje.</p>
          ) : (
            m.formas.map((f) => <LinhaInfo key={f.chave || 'sem'} rotulo={f.rotulo} valor={fmtBRL(f.valor)} />)
          )}
          {caixa?.aberto && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-subtle)] rounded-b-[10px] text-[13px]">
              <span className="flex-1 font-semibold text-[var(--text-main)]">Saldo em caixa</span>
              <strong className="text-[15px] tabular-nums text-[var(--text-main)]">{fmtBRL(caixa.saldo)}</strong>
            </div>
          )}
        </Painel>
      )}

      <Painel
        titulo="Precisa da sua atenção"
        id="atencao"
        semPadding
        acoes={atencao.length > 0 ? <Badge variant="danger" size="sm">{atencao.length}</Badge> : null}
      >
        {carregando ? (
          <div className="px-4 py-3"><div className="h-4 w-40 rounded bg-[var(--bg-subtle)] animate-pulse" /></div>
        ) : atencao.length === 0 ? (
          <p className="m-0 px-4 py-3 text-[13px] text-[var(--text-muted)] inline-flex items-center gap-2">
            <CheckCircle2 size={15} className="text-[var(--success)]" aria-hidden="true" /> Tudo em dia por aqui.
          </p>
        ) : (
          <ul className="m-0 p-0 list-none">
            {atencao.map((a) => (
              <li key={a.chave} className="border-b border-[var(--border-subtle)] last:border-b-0">
                <Link to={a.link} className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]">
                  <Badge variant={a.variant} size="sm">{a.tag}</Badge>
                  <span className="flex-1 min-w-0 [overflow-wrap:anywhere]">{a.texto}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Painel>

      {temVendas && (
        <Painel titulo="Mais vendidos no mês" id="mais-vendidos" semPadding>
          {m.maisVendidos.length === 0 ? (
            <p className="m-0 px-4 py-3 text-[13px] text-[var(--text-muted)]">Ainda sem vendas de produto ou serviço neste mês.</p>
          ) : (
            m.maisVendidos.map((item) => (
              <LinhaInfo key={item.nome} rotulo={item.nome}>
                <span className="text-xs font-medium text-[var(--text-muted)] tabular-nums">{item.qtd}</span>
              </LinhaInfo>
            ))
          )}
        </Painel>
      )}
    </>
  );

  return (
    <Pagina>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-bold tracking-tight text-[var(--text-main)]">
            {saudacao()}{primeiroNome ? `, ${primeiroNome}` : ''}
          </h1>
          <p className="m-0 mt-1 text-sm text-[var(--text-muted)]">{resumoAgenda}</p>
        </div>
        {privilegiado && (
          <Link
            to="/app/hoje"
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
            title="Números do dia, horários e Pix na hora"
          >
            <Smartphone size={15} aria-hidden="true" />
            Hoje no celular
          </Link>
        )}
      </div>

      {(temVendas || temAgenda || temCrm || aReceber) && (
        <FaixaNumeros>
          {temVendas && (
            <Numero
              rotulo="Vendido hoje"
              valor={fmtBRL(m.totalHoje)}
              carregando={carregando}
              detalhe={m.variacao === null
                ? plural(m.qtdHoje, 'venda', 'vendas')
                : `${m.variacao >= 0 ? '+' : ''}${m.variacao}% que ${diaSemanaPassada()}`}
              tomDetalhe={m.variacao === null ? 'neutro' : m.variacao >= 0 ? 'sucesso' : 'perigo'}
            />
          )}
          {temAgenda && (
            <Numero
              rotulo="Atendimentos"
              valor={`${m.agendAtendidos} de ${m.agendHoje}`}
              carregando={carregando}
              progresso={m.agendHoje ? (m.agendAtendidos / m.agendHoje) * 100 : 0}
            />
          )}
          {temVendas && (
            <Numero
              rotulo="Ticket médio"
              valor={fmtBRL(m.ticket)}
              carregando={carregando}
              detalhe={`Mês: ${fmtBRL(m.ticketMes)}`}
            />
          )}
          {aReceber && (
            <Numero
              rotulo="A receber"
              valor={fmtBRL(aReceber.valor)}
              detalhe={aReceber.quantidade ? plural(aReceber.quantidade, 'Pix pendente', 'Pix pendentes') : 'Nenhum Pix pendente'}
              tomDetalhe={aReceber.quantidade ? 'perigo' : 'neutro'}
            />
          )}
          {temCrm && (
            <Numero rotulo="Leads no funil" valor={m.totalLeads} carregando={carregando} detalhe="em aberto" />
          )}
        </FaixaNumeros>
      )}

      <ColunasPagina lateral={lateral}>
        {temVendas && (
          <Painel
            titulo="Vendas da semana"
            id="vendas-semana"
            acoes={<span className="text-xs font-medium text-[var(--text-muted)]">Total {fmtBRL(m.totalSemana)}</span>}
            semPadding
          >
            <div
              className="grid grid-cols-7 gap-2 sm:gap-3.5 items-end h-[190px] px-4 pt-4 pb-3"
              role="img"
              aria-label={`Vendas dos últimos 7 dias: ${m.semana.map((d) => `${d.dia} ${fmtBRL(d.valor)}`).join(', ')}`}
            >
              {m.semana.map((d) => (
                <div key={d.chave} className="flex flex-col items-center justify-end gap-1.5 h-full min-w-0">
                  <span className="text-[11px] font-semibold text-[var(--text-muted)] truncate max-w-full tabular-nums">
                    {d.valor ? fmtCurto(d.valor) : '—'}
                  </span>
                  <div
                    className="w-full max-w-14 rounded-t-md rounded-b-sm"
                    style={{
                      height: `${Math.max(4, m.maxSemana ? Math.round((d.valor / m.maxSemana) * 130) : 4)}px`,
                      background: d.hoje ? 'var(--primary)' : 'var(--primary-soft)',
                    }}
                  />
                  <span className={d.hoje ? 'text-xs font-semibold text-[var(--text-main)]' : 'text-xs text-[var(--text-secondary)]'}>{d.dia}</span>
                </div>
              ))}
            </div>
          </Painel>
        )}

        {temAgenda && (
          <Painel
            titulo="Próximos horários"
            id="proximos-horarios"
            semPadding
            acoes={<Link to="/app/agenda" className={linkSutil}>Abrir agenda</Link>}
          >
            {m.proximos.length === 0 ? (
              <EmptyState
                icon={Clock}
                title={m.agendHoje === 0 ? 'Dia livre' : 'Sem mais horários hoje'}
                description={m.agendHoje === 0 ? 'Nenhum agendamento para hoje.' : 'Os atendimentos de hoje já passaram.'}
                className="py-10"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      {['Hora', 'Cliente', 'Serviço', 'Profissional', 'Valor', 'Situação'].map((t) => (
                        <th key={t} scope="col" className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.proximos.map((a) => {
                      const st = a.sinalStatus === 'PAGO' && a.status !== 'COMPLETED'
                        ? { rotulo: 'Sinal pago', variant: 'info' }
                        : STATUS_AGENDA[a.status] || { rotulo: a.status, variant: 'neutral' };
                      const cell = 'px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap';
                      return (
                        <tr key={a.id}>
                          <td className={`${cell} font-bold text-[var(--text-main)] tabular-nums`}>{horaDe(a.data)}</td>
                          <td className={`${cell} text-[var(--text-main)]`}>{a.nomeCliente || a.lead?.nome || 'Cliente'}</td>
                          <td className={`${cell} text-[var(--text-secondary)]`}>{a.servico || 'Atendimento'}</td>
                          <td className={`${cell} text-[var(--text-secondary)]`}>{a.especialista?.nome || '—'}</td>
                          <td className={`${cell} text-[var(--text-secondary)] tabular-nums`}>{a.preco != null ? fmtBRL(a.preco) : '—'}</td>
                          <td className={cell}><Badge variant={st.variant} size="sm">{st.rotulo}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Painel>
        )}

        {temVendas && (
          <Painel
            titulo="Vendas recentes"
            id="vendas-recentes"
            semPadding
            acoes={<Link to="/app/vendas" className={linkSutil}>Ver vendas <ArrowUpRight size={13} aria-hidden="true" /></Link>}
          >
            {m.recentes.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="Nenhuma venda ainda" description="As vendas registradas aparecem aqui." className="py-10" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      {['Venda', 'Descrição', 'Hora', 'Valor', 'Situação'].map((t) => (
                        <th key={t} scope="col" className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.recentes.map((v) => {
                      const st = STATUS_VENDA[v.status] || { rotulo: v.status, variant: 'neutral' };
                      const cell = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';
                      return (
                        <tr key={v.id}>
                          <td className={`${cell} font-semibold text-[var(--text-main)] whitespace-nowrap`}>{v.numero ? `#${v.numero}` : '—'}</td>
                          <td className={`${cell} text-[var(--text-secondary)] max-w-[280px] truncate`}>{v.descricao || FORMA_PAGAMENTO[v.metodoPagamento] || v.metodoPagamento || '—'}</td>
                          <td className={`${cell} text-[var(--text-secondary)] whitespace-nowrap tabular-nums`}>{horaDe(v.data)}</td>
                          <td className={`${cell} font-semibold text-[var(--text-main)] whitespace-nowrap tabular-nums`}>{fmtBRL(v.valor)}</td>
                          <td className={`${cell} whitespace-nowrap`}><Badge variant={st.variant} size="sm">{st.rotulo}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Painel>
        )}

        {!temVendas && !temAgenda && (
          <Painel titulo="Seu negócio">
            <EmptyState icon={Calendar} title="Nada para mostrar ainda" description="Ative Vendas ou Agenda no seu plano para acompanhar o dia aqui." className="py-10" />
          </Painel>
        )}
      </ColunasPagina>
    </Pagina>
  );
}
