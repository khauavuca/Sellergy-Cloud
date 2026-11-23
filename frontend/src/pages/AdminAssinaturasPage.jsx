import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Ban, CalendarPlus, CheckCircle2, CreditCard, FileText, Hourglass, PlayCircle,
  RefreshCw, TrendingDown, UserPlus, Users, Wallet, XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { Badge, Button, Drawer, EmptyState, KpiCard, SearchBar, Select, useToast } from '../components/ui';
import ConfirmarAcao from '../components/conta/ConfirmarAcao';
import {
  CICLO, FORMA_PAGAMENTO, NOME_PLANO, STATUS_ASSINATURA, STATUS_FATURA, brl, competencia, dataCurta,
} from '../components/conta/rotulosAssinatura';

const FILTROS = [
  { valor: 'TODOS', rotulo: 'Todos' },
  { valor: 'TRIAL', rotulo: 'Em teste' },
  { valor: 'ATIVA', rotulo: 'Ativas' },
  { valor: 'ATRASADA', rotulo: 'Atrasadas' },
  { valor: 'SUSPENSA', rotulo: 'Suspensas' },
  { valor: 'CANCELADA', rotulo: 'Canceladas' },
];

const nomePlano = (codigo, planos) => planos.find((p) => p.codigo === codigo)?.nome || NOME_PLANO[codigo] || codigo || '—';
const emAberto = (c) => (c.faturasAssinatura || []).reduce((t, f) => t + Number(f.valor || 0), 0);
const temVencida = (c) => (c.faturasAssinatura || []).some((f) => f.status === 'VENCIDA');

function marco(c) {
  if (c.statusAssinatura === 'TRIAL') {
    const dias = c.situacao?.diasRestantesTrial;
    return { rotulo: 'Teste até', valor: dataCurta(c.trialAte), extra: dias ? `${dias} dia(s)` : dias === 0 ? 'vencido' : null };
  }
  if (c.statusAssinatura === 'CANCELADA') return { rotulo: 'Cancelada em', valor: dataCurta(c.canceladoEm) };
  return { rotulo: 'Próxima cobrança', valor: dataCurta(c.proximaCobrancaEm) };
}

function Dado({ rotulo, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{rotulo}</dt>
      <dd className="text-sm font-medium text-[var(--text-main)] mt-0.5 break-words">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------
// Painel lateral do cliente
// ---------------------------------------------------------------------
function PainelCliente({ cliente, planos, onFechar, onMudou }) {
  const toast = useToast();
  const [faturas, setFaturas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [novoPlano, setNovoPlano] = useState(cliente.plano);
  const [estendendo, setEstendendo] = useState(false);
  const [confirmacao, setConfirmacao] = useState(null);

  const carregarFaturas = useCallback(() => {
    return api.get(`/admin/assinaturas/${cliente.id}/faturas`)
      .then((r) => { setFaturas(Array.isArray(r.data) ? r.data : []); setErro(false); })
      .catch(() => setErro(true))
      .finally(() => setCarregando(false));
  }, [cliente.id]);

  useEffect(() => { carregarFaturas(); }, [carregarFaturas]);

  // Executa a acao, avisa e recarrega lista + faturas. Devolve true/false
  // para o ConfirmarAcao saber se fecha.
  const executar = async (fn, sucesso, falha) => {
    try {
      await fn();
      toast.success(sucesso);
      await Promise.all([onMudou(), carregarFaturas()]);
      return true;
    } catch (e) {
      toast.error(e.response?.data?.erro || falha);
      return false;
    }
  };

  const estenderTeste = async () => {
    setEstendendo(true);
    await executar(
      () => api.post(`/admin/assinaturas/${cliente.id}/estender-teste`, { dias: 7 }),
      'Teste estendido em 7 dias.',
      'Não foi possível estender o teste.',
    );
    setEstendendo(false);
  };

  const st = STATUS_ASSINATURA[cliente.statusAssinatura] || { rotulo: cliente.statusAssinatura, variante: 'neutral' };
  const podeSuspender = ['TRIAL', 'ATIVA', 'ATRASADA'].includes(cliente.statusAssinatura);
  const podeReativar = ['SUSPENSA', 'CANCELADA'].includes(cliente.statusAssinatura);
  const opcoesPlano = (planos.length ? planos : Object.entries(NOME_PLANO).map(([codigo, nome]) => ({ codigo, nome })))
    .map((p) => ({ value: p.codigo, label: p.precoMensal ? `${p.nome} · ${brl(p.precoMensal)}/mês` : p.nome }));

  return (
    <>
    <Drawer
      isOpen
      onClose={onFechar}
      fecharAoClicarFora
      size="lg"
      title={cliente.nome}
      description={cliente.email || undefined}
    >
      <div className="space-y-6">
        <section aria-labelledby="painel-assinatura" className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 id="painel-assinatura" className="text-sm font-semibold text-[var(--text-main)]">Assinatura</h4>
            <Badge variant={st.variante} size="sm">{st.rotulo}</Badge>
            {cliente.situacao?.somenteLeitura && <Badge variant="danger" size="sm">Só consulta</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-4">
            <Dado rotulo="Plano">{nomePlano(cliente.plano, planos)}</Dado>
            <Dado rotulo="Mensalidade">{cliente.mensalidade ? brl(cliente.mensalidade) : '—'}</Dado>
            <Dado rotulo="Ciclo · forma">
              {CICLO[cliente.cicloAssinatura] || '—'} · {FORMA_PAGAMENTO[cliente.formaPagamento] || '—'}
            </Dado>
            <Dado rotulo={marco(cliente).rotulo}>{marco(cliente).valor}</Dado>
            <Dado rotulo="Cliente desde">{dataCurta(cliente.criadoEm)}</Dado>
            <Dado rotulo="Cobrança no Asaas">{cliente.asaasAssinaturaId ? 'Automática' : 'Manual'}</Dado>
            {cliente.telefone && <Dado rotulo="Telefone">{cliente.telefone}</Dado>}
            {cliente.motivoCancelamento && <Dado rotulo="Motivo do cancelamento">{cliente.motivoCancelamento}</Dado>}
          </dl>
        </section>

        <section aria-labelledby="painel-faturas" className="space-y-3">
          <h4 id="painel-faturas" className="text-sm font-semibold text-[var(--text-main)]">Faturas</h4>
          {carregando && faturas.length === 0 ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1].map((i) => <div key={i} className="h-14 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />)}
            </div>
          ) : erro ? (
            <div role="alert" className="flex items-center gap-3 text-sm text-[var(--danger-text)]">
              Não foi possível carregar as faturas.
              <Button variant="secondary" className="min-h-11" onClick={() => { setCarregando(true); carregarFaturas(); }}>Tentar de novo</Button>
            </div>
          ) : faturas.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nenhuma fatura gerada.</p>
          ) : (
            <ul className="divide-y divide-[var(--border-main)] border border-[var(--border-main)] rounded-xl">
              {faturas.map((f) => {
                const sf = STATUS_FATURA[f.status] || { rotulo: f.status, variante: 'neutral' };
                const pendente = f.status === 'ABERTA' || f.status === 'VENCIDA';
                return (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-[140px]">
                      <p className="text-sm font-medium text-[var(--text-main)] capitalize">
                        {competencia(f.competencia)} · <span className="tabular-nums">{brl(f.valor)}</span>
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        Vence {dataCurta(f.vencimento)}{f.pagaEm ? ` · paga em ${dataCurta(f.pagaEm)}` : ''}
                        {f.formaPagamento ? ` · ${FORMA_PAGAMENTO[f.formaPagamento] || f.formaPagamento}` : ''}
                      </p>
                    </div>
                    <Badge variant={sf.variante} size="sm">{sf.rotulo}</Badge>
                    {pendente && (
                      <Button
                        variant="secondary"
                        className="min-h-11"
                        icon={CheckCircle2}
                        onClick={() => setConfirmacao({
                          titulo: 'Dar baixa manual na fatura?',
                          texto: `Marca a fatura de ${competencia(f.competencia)} (${brl(f.valor)}) como paga e recalcula a situação do cliente. Use só quando o pagamento entrou por fora do Asaas.`,
                          rotulo: 'Dar baixa',
                          variante: 'primary',
                          acao: () => executar(
                            () => api.post(`/admin/assinaturas/faturas/${f.id}/pagar`),
                            'Baixa registrada.',
                            'Não foi possível dar baixa.',
                          ),
                        })}
                      >
                        Dar baixa
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="painel-acoes" className="space-y-4">
          <h4 id="painel-acoes" className="text-sm font-semibold text-[var(--text-main)]">Ações</h4>

          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <div className="flex-1">
              <Select
                label="Mudar plano"
                aria-label="Novo plano"
                placeholder=""
                options={opcoesPlano}
                value={novoPlano}
                onChange={(e) => setNovoPlano(e.target.value)}
              />
            </div>
            <Button
              variant="secondary"
              className="min-h-11"
              disabled={!novoPlano || novoPlano === cliente.plano}
              onClick={() => setConfirmacao({
                titulo: 'Mudar o plano?',
                texto: `${cliente.nome} passa de ${nomePlano(cliente.plano, planos)} para ${nomePlano(novoPlano, planos)}. Os limites e recursos mudam na hora.`,
                rotulo: 'Confirmar mudança',
                variante: 'primary',
                acao: () => executar(
                  () => api.put(`/admin/assinaturas/${cliente.id}`, { plano: novoPlano }),
                  'Plano alterado.',
                  'Não foi possível mudar o plano.',
                ),
              })}
            >
              Salvar plano
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {cliente.statusAssinatura === 'TRIAL' && (
              <Button variant="secondary" className="min-h-11" icon={CalendarPlus} loading={estendendo} onClick={estenderTeste}>
                Estender teste em 7 dias
              </Button>
            )}
            {podeReativar && (
              <Button
                variant="secondary"
                className="min-h-11"
                icon={PlayCircle}
                onClick={() => setConfirmacao({
                  titulo: 'Reativar a conta?',
                  texto: 'A conta volta para Ativa e o cliente pode registrar de novo. Confira antes se há fatura em aberto.',
                  rotulo: 'Reativar conta',
                  variante: 'primary',
                  acao: () => executar(
                    () => api.post(`/admin/assinaturas/${cliente.id}/reativar`),
                    'Conta reativada.',
                    'Não foi possível reativar.',
                  ),
                })}
              >
                Reativar conta
              </Button>
            )}
            {podeSuspender && (
              <Button
                variant="danger-soft"
                className="min-h-11"
                icon={Ban}
                onClick={() => setConfirmacao({
                  titulo: 'Suspender a conta?',
                  texto: 'A conta fica só para consulta: o cliente entra e vê tudo, mas não registra vendas nem agendamentos até ser reativada. Nada é apagado.',
                  rotulo: 'Suspender agora',
                  variante: 'danger',
                  acao: () => executar(
                    () => api.post(`/admin/assinaturas/${cliente.id}/suspender`),
                    'Conta suspensa.',
                    'Não foi possível suspender.',
                  ),
                })}
              >
                Suspender
              </Button>
            )}
            {cliente.statusAssinatura !== 'CANCELADA' && (
              <Button
                variant="danger-soft"
                className="min-h-11"
                icon={XCircle}
                onClick={() => setConfirmacao({
                  titulo: 'Cancelar a assinatura?',
                  texto: 'A conta fica só para consulta e exportação por 60 dias. Nada é apagado.',
                  rotulo: 'Cancelar assinatura',
                  variante: 'danger',
                  pedirMotivo: true,
                  acao: (motivo) => executar(
                    () => api.post(`/admin/assinaturas/${cliente.id}/cancelar`, { motivo }),
                    'Assinatura cancelada.',
                    'Não foi possível cancelar.',
                  ),
                })}
              >
                Cancelar assinatura
              </Button>
            )}
          </div>
        </section>
      </div>
    </Drawer>

      <ConfirmarAcao
        isOpen={Boolean(confirmacao)}
        onClose={() => setConfirmacao(null)}
        titulo={confirmacao?.titulo}
        rotuloConfirmar={confirmacao?.rotulo}
        variante={confirmacao?.variante}
        pedirMotivo={confirmacao?.pedirMotivo}
        motivoObrigatorio={confirmacao?.pedirMotivo}
        rotuloMotivo="Motivo (vai para a auditoria)"
        onConfirmar={(motivo) => confirmacao?.acao(motivo)}
      >
        <p>{confirmacao?.texto}</p>
      </ConfirmarAcao>
    </>
  );
}

// ---------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------
export default function AdminAssinaturasPage() {
  const [clientes, setClientes] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [planos, setPlanos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('TODOS');
  const [busca, setBusca] = useState('');
  const [selecionadoId, setSelecionadoId] = useState(null);

  // O estado ja nasce carregando; o botao Atualizar liga o carregando antes.
  const carregar = useCallback(() => Promise.all([
    api.get('/admin/assinaturas'),
    api.get('/admin/assinaturas/resumo'),
  ])
    .then(([lista, r]) => {
      setClientes(Array.isArray(lista.data) ? lista.data : []);
      setResumo(r.data);
      setErro('');
    })
    .catch((e) => setErro(e.response?.data?.erro || 'Não foi possível carregar as assinaturas.'))
    .finally(() => setCarregando(false)), []);

  useEffect(() => {
    carregar();
    api.get('/publico/planos').then((r) => setPlanos(r.data?.planos || [])).catch(() => {});
  }, [carregar]);

  const contagem = useMemo(() => {
    const c = { TODOS: clientes.length };
    clientes.forEach((x) => { c[x.statusAssinatura] = (c[x.statusAssinatura] || 0) + 1; });
    return c;
  }, [clientes]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return clientes.filter((c) => (filtro === 'TODOS' || c.statusAssinatura === filtro)
      && (!termo || [c.nome, c.email, c.telefone].some((v) => String(v || '').toLowerCase().includes(termo))));
  }, [clientes, filtro, busca]);

  const selecionado = clientes.find((c) => c.id === selecionadoId) || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Assinaturas</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Quem está em teste, quem paga e quem precisa de atenção.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {resumo && (
            <Badge variant={resumo.cobrancaAutomatica ? 'success' : 'warning'}>
              {resumo.cobrancaAutomatica ? 'Cobrança automática ligada (Asaas)' : 'Cobrança manual: dê baixa nas faturas'}
            </Badge>
          )}
          <Button variant="secondary" className="min-h-11" icon={RefreshCw} loading={carregando} onClick={() => { setCarregando(true); carregar(); }}>
            Atualizar
          </Button>
        </div>
      </div>

      {erro && (
        <div role="alert" className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-[var(--danger-soft)] text-sm text-[var(--danger-text)]">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          {erro}
        </div>
      )}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Wallet} color="success" label="Receita mensal (MRR)" carregando={!resumo} valor={resumo ? brl(resumo.mrr) : null}
          subvalor={resumo ? `${resumo.pagantes} pagante(s)` : null} info="Soma das assinaturas ativas e atrasadas; plano anual entra dividido por 12." />
        <KpiCard icon={Hourglass} color="info" label="Em teste" carregando={!resumo} valor={resumo ? String(resumo.emTeste) : null}
          subvalor={resumo ? `${resumo.cadastrosNoMes} cadastro(s) no mês` : null} />
        <KpiCard icon={AlertTriangle} color="warning" label="Atrasadas" carregando={!resumo} valor={resumo ? String(resumo.atrasadas) : null}
          subvalor={resumo ? `${resumo.suspensas} suspensa(s)` : null} />
        <KpiCard icon={TrendingDown} color="danger" label="Cancelamento no mês" carregando={!resumo}
          valor={resumo ? `${Number(resumo.cancelamentoPct).toLocaleString('pt-BR')}%` : null}
          subvalor={resumo ? `${resumo.canceladosNoMes} cancelado(s) no mês · ${resumo.canceladas} no total` : null} />
        <KpiCard icon={CheckCircle2} color="success" label="Recebido no mês" carregando={!resumo} valor={resumo ? brl(resumo.recebidoNoMes) : null} />
        <KpiCard icon={FileText} color="danger" label="Vencido" carregando={!resumo} valor={resumo ? brl(resumo.vencidoTotal) : null}
          subvalor={resumo ? `${resumo.faturasVencidas} fatura(s) vencida(s)` : null} />
        <KpiCard icon={Users} color="neutral" label="Pagantes" carregando={!resumo} valor={resumo ? String(resumo.pagantes) : null} />
        <KpiCard icon={UserPlus} color="accent" label="Cadastros no mês" carregando={!resumo} valor={resumo ? String(resumo.cadastrosNoMes) : null} />
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
        <div role="group" aria-label="Filtrar por situação" className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              aria-pressed={filtro === f.valor}
              onClick={() => setFiltro(f.valor)}
              className={clsx(
                'min-h-11 px-3.5 rounded-lg text-sm font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
                filtro === f.valor
                  ? 'bg-[var(--primary)] text-[var(--text-on-primary)] border-[var(--primary)]'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-main)] hover:text-[var(--text-main)]',
              )}
            >
              {f.rotulo} <span className="tabular-nums opacity-70">{contagem[f.valor] || 0}</span>
            </button>
          ))}
        </div>
        <div className="w-full lg:w-72">
          <SearchBar value={busca} onChange={(e) => setBusca(e.target.value)} onClear={() => setBusca('')} placeholder="Buscar por nome, e-mail ou telefone" />
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] overflow-hidden">
        {carregando && clientes.length === 0 ? (
          <div className="p-4 space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />)}
          </div>
        ) : visiveis.length === 0 ? (
          <EmptyState icon={CreditCard} title="Nenhuma assinatura aqui" description={busca || filtro !== 'TODOS' ? 'Mude o filtro ou a busca.' : 'Quando alguém se cadastrar, aparece nesta lista.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Assinaturas dos clientes</caption>
              <thead className="bg-[var(--bg-subtle)]">
                <tr className="text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  <th scope="col" className="px-4 py-3 font-semibold">Negócio</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Plano</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Situação</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Ciclo · forma</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Data-chave</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-right">Em aberto</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((c) => {
                  const st = STATUS_ASSINATURA[c.statusAssinatura] || { rotulo: c.statusAssinatura, variante: 'neutral' };
                  const m = marco(c);
                  const aberto = emAberto(c);
                  return (
                    <tr key={c.id} className="border-t border-[var(--border-main)] hover:bg-[var(--bg-subtle)]/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[var(--text-main)]">{c.nome}</p>
                        <p className="text-xs text-[var(--text-muted)]">{c.email || c.telefone || '—'}</p>
                      </td>
                      <td className="px-4 py-3">{nomePlano(c.plano, planos)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={st.variante} size="sm">{st.rotulo}</Badge>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">
                        {CICLO[c.cicloAssinatura] || '—'} · {FORMA_PAGAMENTO[c.formaPagamento] || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="block text-xs text-[var(--text-muted)]">{m.rotulo}</span>
                        <span className="tabular-nums">{m.valor}</span>
                        {m.extra && <span className="text-xs text-[var(--text-muted)]"> · {m.extra}</span>}
                      </td>
                      <td className={clsx('px-4 py-3 text-right tabular-nums font-medium', temVencida(c) ? 'text-[var(--danger)]' : 'text-[var(--text-main)]')}>
                        {aberto ? brl(aberto) : '—'}
                        {temVencida(c) && <span className="block text-xs font-semibold">vencida</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" className="min-h-11" onClick={() => setSelecionadoId(c.id)}>
                          Abrir<span className="sr-only"> {c.nome}</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selecionado && (
        <PainelCliente
          key={selecionado.id}
          cliente={selecionado}
          planos={planos}
          onFechar={() => setSelecionadoId(null)}
          onMudou={carregar}
        />
      )}
    </div>
  );
}
