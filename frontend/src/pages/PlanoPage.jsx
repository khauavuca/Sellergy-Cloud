import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, ExternalLink, FileText, RefreshCw, XCircle } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/auth.store';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, EmptyState, useToast } from '../components/ui';
import { useResumoConta } from '../components/conta/useResumoConta';
import ModalPlanos from '../components/conta/ModalPlanos';
import ConfirmarAcao from '../components/conta/ConfirmarAcao';
import {
  CICLO, FORMA_PAGAMENTO, STATUS_ASSINATURA, STATUS_FATURA, brl, competencia, dataCurta,
} from '../components/conta/rotulosAssinatura';

function proximoPasso(a, faturas) {
  const pendente = faturas.find((f) => f.status === 'VENCIDA') || faturas.find((f) => f.status === 'ABERTA');
  switch (a.aviso || a.status) {
    case 'TRIAL_VENCIDO':
      return 'Seu teste terminou. Escolha um plano para voltar a registrar vendas e agendamentos. Nada foi apagado.';
    case 'TRIAL_ACABANDO':
    case 'TRIAL':
      return `Seu teste vai até ${dataCurta(a.trialAte)}. Escolha um plano antes disso para não ficar só com consulta. Se assinar agora, a primeira cobrança só vence no fim do teste.`;
    case 'PAGAMENTO_ATRASADO':
      return 'Há uma fatura vencida. Pague para não ter a conta limitada.';
    case 'CONTA_SUSPENSA':
      return 'A conta está só para consulta por causa de uma fatura em atraso. Assim que o pagamento cair, tudo volta a funcionar.';
    case 'CONTA_CANCELADA':
      return 'A assinatura foi cancelada. A conta fica disponível para consulta e exportação por 60 dias. Para voltar, escolha um plano.';
    default:
      return pendente
        ? `Próxima fatura: ${brl(pendente.valor)}, vence em ${dataCurta(pendente.vencimento)}.`
        : 'Tudo em dia. Nenhuma fatura em aberto.';
  }
}

function Linha({ rotulo, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{rotulo}</dt>
      <dd className="text-sm font-medium text-[var(--text-main)]">{children}</dd>
    </div>
  );
}

export default function PlanoPage() {
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const { resumo, recarregar } = useResumoConta();
  const [faturas, setFaturas] = useState([]);
  const [carregandoFaturas, setCarregandoFaturas] = useState(true);
  const [erroFaturas, setErroFaturas] = useState(false);
  const [modalPlanos, setModalPlanos] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);

  const ehDono = user?.perfil === 'CLIENT';
  const a = resumo?.assinatura;

  // Sem setState sincrono aqui: o efeito inicial chama direto (o estado ja
  // nasce carregando) e o "Tentar de novo" liga o carregando antes.
  const carregarFaturas = useCallback(() => {
    return api.get('/conta/faturas')
      .then((r) => { setFaturas(Array.isArray(r.data) ? r.data : []); setErroFaturas(false); })
      .catch(() => setErroFaturas(true))
      .finally(() => setCarregandoFaturas(false));
  }, []);

  useEffect(() => { carregarFaturas(); }, [carregarFaturas]);

  const aposAssinar = () => {
    recarregar();
    carregarFaturas();
  };

  const cancelar = async (motivo) => {
    try {
      await api.post('/conta/cancelar', { motivo: motivo || undefined });
      toast.success('Assinatura cancelada. Seus dados continuam disponíveis para consulta.');
      recarregar();
      carregarFaturas();
      return true;
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível cancelar agora.');
      return false;
    }
  };

  const status = a ? STATUS_ASSINATURA[a.status] || { rotulo: a.status, variante: 'neutral' } : null;
  const podeTrocar = ehDono && a && ['TRIAL', 'ATIVA', 'ATRASADA', 'CANCELADA'].includes(a.status);
  const podeCancelar = ehDono && a && ['TRIAL', 'ATIVA', 'ATRASADA'].includes(a.status);
  const critico = a && (a.somenteLeitura || a.aviso === 'PAGAMENTO_ATRASADO');

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Meu plano</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">Plano, situação da assinatura e faturas.</p>
      </div>

      <Card padding="lg">
        {!a ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-6 w-40 rounded bg-[var(--bg-subtle)] animate-pulse" />
            <div className="h-4 w-64 rounded bg-[var(--bg-subtle)] animate-pulse" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-semibold tracking-tight text-[var(--text-main)]">
                    Plano {a.planoContratado?.nome || '—'}
                  </h2>
                  <Badge variant={status.variante}>{status.rotulo}</Badge>
                </div>
                {a.status === 'TRIAL' && resumo?.plano?.nome && (
                  <p className="text-sm text-[var(--text-muted)] mt-1">
                    Durante o teste você usa tudo do {resumo.plano.nome}.
                  </p>
                )}
              </div>
              {(podeTrocar || podeCancelar) && (
                <div className="flex flex-wrap gap-2">
                  {podeTrocar && (
                    <Button variant="primary" className="min-h-11" icon={RefreshCw} onClick={() => setModalPlanos(true)}>
                      {a.status === 'TRIAL' || a.status === 'CANCELADA' ? 'Escolher plano' : 'Trocar plano'}
                    </Button>
                  )}
                  {podeCancelar && (
                    <Button variant="ghost" className="min-h-11" icon={XCircle} onClick={() => setConfirmarCancelar(true)}>
                      Cancelar assinatura
                    </Button>
                  )}
                </div>
              )}
            </div>

            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Linha rotulo="Situação">{status.rotulo}{a.somenteLeitura ? ' · só consulta' : ''}</Linha>
              <Linha rotulo="Cobrança">{CICLO[a.ciclo] || '—'}</Linha>
              <Linha rotulo="Forma de pagamento">{FORMA_PAGAMENTO[a.formaPagamento] || '—'}</Linha>
              {a.status === 'TRIAL'
                ? <Linha rotulo="Teste até">{dataCurta(a.trialAte)}</Linha>
                : a.canceladoEm
                  ? <Linha rotulo="Cancelada em">{dataCurta(a.canceladoEm)}</Linha>
                  : <Linha rotulo="Cobrança automática">{a.assinaturaAutomaticaAtiva ? 'Ligada' : 'Não'}</Linha>}
            </dl>

            {resumo?.uso && (
              <p className="text-sm text-[var(--text-secondary)]">
                Lembretes de WhatsApp este mês: <strong className="tabular-nums">{Number(resumo.uso.lembretesNoMes || 0).toLocaleString('pt-BR')}</strong>
                {resumo.uso.lembretesLimite !== null && resumo.uso.lembretesLimite !== undefined && Number.isFinite(Number(resumo.uso.lembretesLimite))
                  ? <> de <span className="tabular-nums">{Number(resumo.uso.lembretesLimite).toLocaleString('pt-BR')}</span></>
                  : null}
              </p>
            )}

            <div
              className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${critico ? 'bg-[var(--danger-soft)] text-[var(--danger-text)]' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'}`}
            >
              {critico
                ? <AlertCircle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                : <ArrowRight size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />}
              <p><span className="font-semibold">Próximo passo: </span>{proximoPasso(a, faturas)}</p>
            </div>

            {!ehDono && (
              <p className="text-xs text-[var(--text-muted)]">Só o dono da conta pode trocar ou cancelar o plano.</p>
            )}
          </div>
        )}
      </Card>

      <Card padding="lg">
        <CardHeader>
          <div>
            <CardTitle>Faturas</CardTitle>
            <CardDescription>As últimas cobranças da sua assinatura.</CardDescription>
          </div>
        </CardHeader>

        {carregandoFaturas && faturas.length === 0 ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />)}
          </div>
        ) : erroFaturas ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-[var(--danger-text)]">
            Não foi possível carregar as faturas.
            <Button variant="secondary" className="min-h-11" onClick={() => { setCarregandoFaturas(true); carregarFaturas(); }}>Tentar de novo</Button>
          </div>
        ) : faturas.length === 0 ? (
          <EmptyState icon={FileText} title="Nenhuma fatura ainda" description="Quando você escolher um plano, as faturas aparecem aqui." />
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <caption className="sr-only">Faturas da assinatura</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  <th scope="col" className="px-2 py-2 font-semibold">Referência</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Valor</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Vencimento</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Situação</th>
                  <th scope="col" className="px-2 py-2 font-semibold"><span className="sr-only">Ação</span></th>
                </tr>
              </thead>
              <tbody>
                {faturas.map((f) => {
                  const st = STATUS_FATURA[f.status] || { rotulo: f.status, variante: 'neutral' };
                  const pagavel = f.linkPagamento && (f.status === 'ABERTA' || f.status === 'VENCIDA');
                  return (
                    <tr key={f.id} className="border-t border-[var(--border-main)]">
                      <td className="px-2 py-3 font-medium text-[var(--text-main)] capitalize">{competencia(f.competencia)}</td>
                      <td className="px-2 py-3 tabular-nums">{brl(f.valor)}</td>
                      <td className="px-2 py-3 tabular-nums">{dataCurta(f.vencimento)}</td>
                      <td className="px-2 py-3">
                        <Badge variant={st.variante} size="sm">{st.rotulo}</Badge>
                        {f.pagaEm && <span className="block text-xs text-[var(--text-muted)] mt-1">em {dataCurta(f.pagaEm)}</span>}
                      </td>
                      <td className="px-2 py-3 text-right">
                        {pagavel && (
                          <a
                            href={f.linkPagamento}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-sm font-semibold hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                          >
                            Pagar
                            <ExternalLink size={14} aria-hidden="true" />
                            <span className="sr-only">fatura de {competencia(f.competencia)} (abre em nova aba)</span>
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {a && (
        <ModalPlanos isOpen={modalPlanos} onClose={() => setModalPlanos(false)} assinatura={a} onAssinado={aposAssinar} />
      )}

      <ConfirmarAcao
        isOpen={confirmarCancelar}
        onClose={() => setConfirmarCancelar(false)}
        titulo="Cancelar assinatura?"
        rotuloConfirmar="Cancelar assinatura"
        pedirMotivo
        rotuloMotivo="Conte o motivo para a gente melhorar"
        onConfirmar={cancelar}
      >
        <p>Nada é apagado. Depois de cancelar, a conta fica só para consulta e exportação por 60 dias.</p>
        <p>Nesse período você não registra vendas nem agendamentos. Para voltar, é só escolher um plano.</p>
      </ConfirmarAcao>
    </div>
  );
}
