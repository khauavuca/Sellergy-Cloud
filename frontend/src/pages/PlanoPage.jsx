import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, FileText, Lock, PauseCircle, RefreshCw, XCircle } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/auth.store';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import {
  Badge, Button, ColunasPagina, EmptyState, FaixaNumeros, LinhaInfo, Numero, Pagina, Painel, useToast,
} from '../components/ui';
import { useResumoConta } from '../components/conta/useResumoConta';
import ModalPlanos from '../components/conta/ModalPlanos';
import ConfirmarAcao from '../components/conta/ConfirmarAcao';
import FaixaAssinatura from '../components/plano/FaixaAssinatura';
import CartoesPlanos from '../components/plano/CartoesPlanos';
import { anualTotal, num, situacaoFaturas, temLimite } from '../components/plano/planoUtil';
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

const th = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const td = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';
const linkPagar = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-xs font-semibold hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2';

/** Uma linha de uso: rótulo, "X de Y" e barra (só quando há número de uso). */
function LinhaUso({ rotulo, usado, limite, nota }) {
  const comBarra = usado !== undefined && temLimite(limite) && Number(limite) > 0;
  const pct = comBarra ? Math.min(100, (Number(usado) / Number(limite)) * 100) : 0;
  const cheio = comBarra && pct >= 100;
  let valor = temLimite(limite) ? `até ${num(limite)}` : 'ilimitado';
  if (usado !== undefined) valor = temLimite(limite) ? `${num(usado)} de ${num(limite)}` : `${num(usado)} · sem limite`;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px] text-[var(--text-secondary)]">
        <span>{rotulo}</span>
        <strong className={cheio ? 'text-[var(--danger-text)] tabular-nums' : 'text-[var(--text-main)] tabular-nums'}>{valor}</strong>
      </div>
      {comBarra && (
        <div className="h-2 rounded bg-[var(--bg-subtle)] mt-1.5" aria-hidden="true">
          <div
            className={cheio ? 'h-2 rounded bg-[var(--danger)]' : pct >= 80 ? 'h-2 rounded bg-[var(--warning)]' : 'h-2 rounded bg-[var(--primary)]'}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {nota && <div className={`mt-1.5 text-xs ${cheio ? 'text-[var(--danger-text)] font-semibold' : 'text-[var(--text-muted)]'}`}>{nota}</div>}
    </div>
  );
}

function ListaSimples({ itens, icone: Icone, cor }) {
  return (
    <ul className="m-0 p-0 list-none">
      {itens.map((t) => (
        <li key={t} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0 text-[13px] text-[var(--text-secondary)]">
          <Icone size={15} className={`flex-shrink-0 ${cor}`} aria-hidden="true" />
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </ul>
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
  const [planos, setPlanos] = useState([]);
  const [diasDeTeste, setDiasDeTeste] = useState(null);
  const [carregandoPlanos, setCarregandoPlanos] = useState(true);
  const [erroPlanos, setErroPlanos] = useState(false);
  const [anual, setAnual] = useState(null);

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

  const carregarPlanos = useCallback(() => {
    return api.get('/publico/planos')
      .then((r) => {
        setPlanos(Array.isArray(r.data?.planos) ? r.data.planos : []);
        setDiasDeTeste(Number(r.data?.diasDeTeste) || null);
        setErroPlanos(false);
      })
      .catch(() => setErroPlanos(true))
      .finally(() => setCarregandoPlanos(false));
  }, []);

  useEffect(() => { carregarFaturas(); }, [carregarFaturas]);
  useEffect(() => { carregarPlanos(); }, [carregarPlanos]);

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
  const podeTrocar = Boolean(ehDono && a && ['TRIAL', 'ATIVA', 'ATRASADA', 'CANCELADA'].includes(a.status));
  const podeCancelar = Boolean(ehDono && a && ['TRIAL', 'ATIVA', 'ATRASADA'].includes(a.status));
  const rotuloEscolher = a && (a.status === 'TRIAL' || a.status === 'CANCELADA') ? 'Escolher plano' : 'Trocar plano';

  useAcaoTopo(
    podeTrocar ? <Button size="sm" icon={RefreshCw} onClick={() => setModalPlanos(true)}>{rotuloEscolher}</Button> : null,
    [podeTrocar, rotuloEscolher]
  );

  const pend = situacaoFaturas(faturas);
  const emAtraso = a && (a.aviso === 'PAGAMENTO_ATRASADO' || a.aviso === 'CONTA_SUSPENSA');
  const contaTravada = a && a.somenteLeitura;
  const cicloAnual = anual ?? a?.ciclo === 'ANUAL';
  const planoEfetivo = resumo?.plano;
  const planoContratado = planos.find((p) => p.codigo === a?.planoContratado?.codigo);
  const proxima = pend.abertas.length
    ? [...pend.abertas].sort((x, y) => new Date(x.vencimento) - new Date(y.vencimento))[0]
    : null;
  const mesAtual = new Date().toLocaleDateString('pt-BR', { month: 'long' });
  const faturaDestaque = (emAtraso || contaTravada) ? pend.pagarPrimeiro : null;
  const pagavel = (f) => f?.linkPagamento && (f.status === 'ABERTA' || f.status === 'VENCIDA');

  let valorPlano = null;
  if (planoContratado && a?.ciclo) {
    valorPlano = a.ciclo === 'ANUAL'
      ? `${brl(anualTotal(planoContratado))} por ano`
      : `${brl(planoContratado.precoMensal)} por mês`;
  }

  const lateral = !a ? (
    <Painel titulo="Resumo da assinatura">
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-5 rounded bg-[var(--bg-subtle)] animate-pulse" />)}
      </div>
    </Painel>
  ) : (
    <>
      {faturaDestaque && (
        <Painel
          titulo="Fatura em aberto"
          acoes={<Badge variant={(STATUS_FATURA[faturaDestaque.status] || {}).variante || 'neutral'} size="sm">{(STATUS_FATURA[faturaDestaque.status] || {}).rotulo || faturaDestaque.status}</Badge>}
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <div>
              <div className="text-[22px] font-bold text-[var(--text-main)] tabular-nums">{brl(faturaDestaque.valor)}</div>
              <div className="text-xs text-[var(--text-muted)] first-letter:uppercase">
                {competencia(faturaDestaque.competencia)} · vence em {dataCurta(faturaDestaque.vencimento)}
              </div>
            </div>
            {pagavel(faturaDestaque) ? (
              <a
                href={faturaDestaque.linkPagamento}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-sm font-semibold hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              >
                Pagar a fatura
                <ExternalLink size={14} aria-hidden="true" />
                <span className="sr-only">(abre em nova aba)</span>
              </a>
            ) : (
              <p className="m-0 text-xs text-[var(--text-muted)]">O link de pagamento ainda não foi gerado para esta fatura.</p>
            )}
            <span className="text-xs text-[var(--text-muted)]">Libera assim que o pagamento cair. Não precisa mandar comprovante.</span>
          </div>
        </Painel>
      )}

      <Painel titulo="Resumo da assinatura" acoes={<Badge variant={status.variante} size="sm">{status.rotulo}</Badge>} semPadding>
        <LinhaInfo rotulo="Plano" valor={a.status === 'TRIAL' && planoEfetivo?.nome ? `${planoEfetivo.nome} (teste)` : a.planoContratado?.nome || '—'} />
        <LinhaInfo rotulo="Situação" valor={`${status.rotulo}${a.somenteLeitura ? ' · só consulta' : ''}`} />
        <LinhaInfo rotulo="Período" valor={CICLO[a.ciclo] || '—'} />
        {a.status === 'TRIAL' && <LinhaInfo rotulo="Teste até" valor={dataCurta(a.trialAte)} />}
        {a.canceladoEm && <LinhaInfo rotulo="Cancelada em" valor={dataCurta(a.canceladoEm)} />}
        {proxima && <LinhaInfo rotulo={a.status === 'TRIAL' ? 'Primeira cobrança' : 'Próxima cobrança'} valor={dataCurta(proxima.vencimento)} />}
        {proxima
          ? <LinhaInfo rotulo="Valor" valor={brl(proxima.valor)} forte />
          : valorPlano && a.status !== 'TRIAL' && <LinhaInfo rotulo="Valor" valor={valorPlano} forte />}
        {a.status !== 'TRIAL' && !a.canceladoEm && (
          <LinhaInfo rotulo="Cobrança automática" valor={a.assinaturaAutomaticaAtiva ? 'Ligada' : 'Não'} />
        )}
      </Painel>

      <Painel
        titulo="Forma de pagamento"
        acoes={podeTrocar ? <Button variant="secondary" size="sm" onClick={() => setModalPlanos(true)}>Trocar</Button> : null}
        semPadding
      >
        <LinhaInfo rotulo="Como você paga" valor={FORMA_PAGAMENTO[a.formaPagamento] || '—'} />
        {a.cobrancaAutomatica && (
          <LinhaInfo rotulo="CPF ou CNPJ de quem paga" valor={a.temDocumento ? 'Cadastrado' : 'Falta informar'} />
        )}
        <div className="flex gap-2 px-4 py-2.5 text-xs text-[var(--text-muted)]">
          <Lock size={14} className="flex-shrink-0 mt-px" aria-hidden="true" />
          <span>O pagamento é feito na página segura do Asaas. O Sellergy não vê nem guarda o número do cartão.</span>
        </div>
      </Painel>

      <section aria-label="Cancelamento" className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] p-4 flex flex-col gap-2 text-[13px] text-[var(--text-secondary)]">
        <strong className="text-sm text-[var(--text-main)]">Só o dono troca ou cancela o plano</strong>
        <span>Cancelando, a conta fica só para consulta e exportação por 60 dias. Nada é apagado.</span>
        {podeCancelar && (
          <Button variant="secondary" size="sm" icon={XCircle} className="self-start mt-1" onClick={() => setConfirmarCancelar(true)}>
            Cancelar assinatura
          </Button>
        )}
      </section>
    </>
  );

  return (
    <Pagina>
      {!a ? (
        <div className="h-[76px] rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] animate-pulse" aria-busy="true" />
      ) : (
        <FaixaAssinatura
          assinatura={a}
          status={status}
          nomePlanoEfetivo={planoEfetivo?.nome}
          diasDeTeste={diasDeTeste}
          textoPasso={proximoPasso(a, faturas)}
          pendencias={pend}
          podeTrocar={podeTrocar}
          onEscolherPlano={() => setModalPlanos(true)}
        />
      )}

      {emAtraso && (
        <FaixaNumeros min={170}>
          <Numero
            rotulo="Dias em atraso"
            valor={pend.diasAtraso ?? '—'}
            tom={a.aviso === 'CONTA_SUSPENSA' ? 'perigo' : 'alerta'}
            carregando={carregandoFaturas && faturas.length === 0}
          />
          <Numero
            rotulo={a.aviso === 'CONTA_SUSPENSA' ? 'Só consulta desde' : 'Vira só consulta em'}
            valor={pend.viraConsultaEm ? dataCurta(pend.viraConsultaEm) : '—'}
            carregando={carregandoFaturas && faturas.length === 0}
          />
          <Numero
            rotulo="Valor vencido"
            valor={brl(pend.valorVencido)}
            tom="perigo"
            carregando={carregandoFaturas && faturas.length === 0}
          />
          <Numero
            rotulo="Faturas vencidas"
            valor={pend.vencidas.length}
            carregando={carregandoFaturas && faturas.length === 0}
          />
        </FaixaNumeros>
      )}

      <ColunasPagina lateral={lateral}>
        {contaTravada && (
          <div className="flex flex-wrap gap-4 items-stretch">
            <Painel titulo="Continua funcionando" acoes={<Badge variant="success" size="sm">Ativo</Badge>} semPadding className="flex-[1_1_280px]">
              <ListaSimples
                icone={CheckCircle2}
                cor="text-[var(--success)]"
                itens={['Entrar e consultar tudo', 'Clientes, histórico e relatórios', 'Exportar seus dados', 'Acesso da equipe']}
              />
            </Painel>
            <Painel titulo={a.aviso === 'CONTA_CANCELADA' ? 'Pausado até escolher um plano' : 'Pausado até o pagamento'} acoes={<Badge variant="danger" size="sm">Pausado</Badge>} semPadding className="flex-[1_1_280px]">
              <ListaSimples
                icone={PauseCircle}
                cor="text-[var(--danger-text)]"
                itens={['Registrar vendas', 'Criar e mudar agendamentos', 'Cadastrar e editar']}
              />
            </Painel>
          </div>
        )}

        {a && (
          <Painel
            titulo={`Uso do plano ${planoEfetivo?.nome || a.planoContratado?.nome || ''}`.trim()}
            subtitulo="Limites do plano que vale agora"
          >
            <div className="grid gap-x-6 gap-y-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {resumo?.uso && (
                <LinhaUso
                  rotulo={`Lembretes de WhatsApp em ${mesAtual}`}
                  usado={Number(resumo.uso.lembretesNoMes || 0)}
                  limite={resumo.uso.lembretesLimite}
                  nota="Zera todo dia 1º"
                />
              )}
              {resumo?.uso && planoEfetivo?.recursos?.notaFiscal && (
                <LinhaUso
                  rotulo={`Notas fiscais em ${mesAtual}`}
                  usado={Number(resumo.uso.notasNoMes || 0)}
                  limite={resumo.uso.notasLimite}
                  nota="NFC-e e NFS-e emitidas · zera todo dia 1º"
                />
              )}
              {planoEfetivo?.limites && (
                <>
                  <LinhaUso rotulo="Usuários" limite={planoEfetivo.limites.usuarios} nota="Pessoas com acesso ao sistema" />
                  <LinhaUso rotulo="Profissionais na agenda" limite={planoEfetivo.limites.profissionais} nota="Quem atende na agenda" />
                </>
              )}
            </div>
          </Painel>
        )}

        <CartoesPlanos
          planos={planos}
          carregando={carregandoPlanos}
          erro={erroPlanos}
          onTentarDeNovo={() => { setCarregandoPlanos(true); carregarPlanos(); }}
          anual={cicloAnual}
          onMudarCiclo={setAnual}
          assinatura={a}
          podeTrocar={podeTrocar}
          onAssinar={() => setModalPlanos(true)}
        />

        <Painel titulo="Faturas" subtitulo="As últimas cobranças da sua assinatura" semPadding>
          {carregandoFaturas && faturas.length === 0 ? (
            <div className="space-y-2 p-4" aria-busy="true">
              {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />)}
            </div>
          ) : erroFaturas ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-[13px] text-[var(--danger-text)]">
              Não foi possível carregar as faturas.
              <Button variant="secondary" size="sm" onClick={() => { setCarregandoFaturas(true); carregarFaturas(); }}>Tentar de novo</Button>
            </div>
          ) : faturas.length === 0 ? (
            <EmptyState icon={FileText} title="Nenhuma fatura ainda" description="Quando você escolher um plano, as faturas aparecem aqui." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <caption className="sr-only">Faturas da assinatura</caption>
                <thead>
                  <tr>
                    <th scope="col" className={th}>Referência</th>
                    <th scope="col" className={th}>Vencimento</th>
                    <th scope="col" className={`${th} text-right`}>Valor</th>
                    <th scope="col" className={th}>Situação</th>
                    <th scope="col" className={th}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {faturas.map((f) => {
                    const st = STATUS_FATURA[f.status] || { rotulo: f.status, variante: 'neutral' };
                    return (
                      <tr key={f.id}>
                        <td className={`${td} font-medium text-[var(--text-main)] whitespace-nowrap first-letter:uppercase`}>{competencia(f.competencia)}</td>
                        <td className={`${td} tabular-nums whitespace-nowrap`}>{dataCurta(f.vencimento)}</td>
                        <td className={`${td} tabular-nums text-right whitespace-nowrap`}>{brl(f.valor)}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          <Badge variant={st.variante} size="sm">{st.rotulo}</Badge>
                          {f.pagaEm && <span className="ml-2 text-xs text-[var(--text-muted)]">em {dataCurta(f.pagaEm)}</span>}
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          {pagavel(f) ? (
                            <a href={f.linkPagamento} target="_blank" rel="noopener noreferrer" className={linkPagar}>
                              Pagar
                              <ExternalLink size={12} aria-hidden="true" />
                              <span className="sr-only">fatura de {competencia(f.competencia)} (abre em nova aba)</span>
                            </a>
                          ) : (
                            <span className="text-xs text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Painel>

      </ColunasPagina>

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
    </Pagina>
  );
}
