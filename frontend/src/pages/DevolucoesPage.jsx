import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, Package, Phone, ExternalLink, Check, AlertTriangle, Search, Bell } from 'lucide-react';
import {
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, BarraFerramentas, AbasPilula,
  Badge, Button, EmptyState, useToast,
} from '../components/ui';
import devolucaoService from '../services/devolucaoService';

const FILTROS = [
  { valor: 'pendente', label: 'Pendentes' },
  { valor: 'atrasada', label: 'Atrasadas' },
  { valor: 'concluida', label: 'Devolvidas' },
];

const DIA_MS = 24 * 60 * 60 * 1000;

function fmtData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtDataHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function estaAtrasada(d) {
  return !d.devolvidoEm && new Date(d.dataDevolucao).getTime() < Date.now();
}

// Dias de calendário entre hoje e a data (negativo = já passou).
function diasAte(iso) {
  const alvo = new Date(iso);
  alvo.setHours(0, 0, 0, 0);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo - hoje) / DIA_MS);
}

function textoPrazo(d) {
  if (d.devolvidoEm) return `Devolvido em ${fmtData(d.devolvidoEm)}`;
  const n = diasAte(d.dataDevolucao);
  if (n < 0) return `Atrasada há ${-n} dia${n === -1 ? '' : 's'}`;
  if (n === 0) return 'Vence hoje';
  if (n === 1) return 'Vence amanhã';
  return `Vence em ${n} dias`;
}

function nomeItem(d) {
  return d.variacao?.produto?.nome || 'Produto';
}

function situacao(d) {
  if (d.devolvidoEm) return { texto: 'Devolvido', variant: 'success' };
  if (estaAtrasada(d)) return { texto: 'Atrasada', variant: 'danger' };
  if (diasAte(d.dataDevolucao) <= 1) return { texto: 'Vence logo', variant: 'warning' };
  return { texto: 'No prazo', variant: 'neutral' };
}

function iniciais(nome) {
  if (!nome) return '?';
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

const TH = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const TD = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';

export default function DevolucoesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState('pendente');
  const [devolucoes, setDevolucoes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [concluindo, setConcluindo] = useState(null); // id em processamento
  const [busca, setBusca] = useState('');
  const [selecionadoId, setSelecionadoId] = useState(null);

  const carregar = async (status) => {
    setCarregando(true);
    try {
      const r = await devolucaoService.listar(status);
      setDevolucoes(r || []);
    } catch {
      toast.error('Não foi possível carregar as devoluções.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on filtro change
    carregar(filtro);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carregar só depende do filtro
  }, [filtro]);

  // Números do topo sempre olham pendentes+atrasadas e devolvidas
  // (independente do filtro selecionado na lista) — panorama geral de 1 olhada.
  const [pendentesTodas, setPendentesTodas] = useState([]);
  const [concluidasTodas, setConcluidasTodas] = useState([]);
  const [carregandoResumo, setCarregandoResumo] = useState(true);
  useEffect(() => {
    Promise.all([
      devolucaoService.listar('pendente').catch(() => null),
      devolucaoService.listar('concluida').catch(() => null),
    ]).then(([pend, conc]) => {
      if (pend) setPendentesTodas(pend);
      if (conc) setConcluidasTodas(conc);
      setCarregandoResumo(false);
    });
  }, [devolucoes]);

  // Quantos dias antes o sistema avisa o cliente (configurado em Configurações).
  const [diasAviso, setDiasAviso] = useState(null);
  useEffect(() => {
    devolucaoService.obterConfig()
      .then((c) => setDiasAviso(c?.diasAvisoDevolucao ?? null))
      .catch(() => {});
  }, []);

  const resumo = useMemo(() => {
    const atrasadas = pendentesTodas.filter(estaAtrasada).length;
    const prox7 = pendentesTodas.filter((d) => {
      const n = diasAte(d.dataDevolucao);
      return n >= 0 && n <= 7;
    }).length;
    const agora = new Date();
    const devolvidasMes = concluidasTodas.filter((d) => {
      const dt = new Date(d.devolvidoEm);
      return dt.getMonth() === agora.getMonth() && dt.getFullYear() === agora.getFullYear();
    }).length;
    const avisadas = pendentesTodas.filter((d) => d.lembreteEnviadoEm).length;
    return { pendentes: pendentesTodas.length, atrasadas, prox7, devolvidasMes, avisadas };
  }, [pendentesTodas, concluidasTodas]);

  const handleConcluir = async (d) => {
    const nomeProduto = `${d.variacao?.produto?.nome || 'produto'} (${d.variacao?.nome || ''})`;
    if (!window.confirm(`Confirmar que "${nomeProduto}" foi devolvido por ${d.lead?.nome || 'o cliente'}?`)) return;
    setConcluindo(d.id);
    try {
      await devolucaoService.concluir(d.id);
      toast.success('Devolução concluída. Estoque atualizado.');
      carregar(filtro);
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao concluir devolução.');
    } finally {
      setConcluindo(null);
    }
  };

  const listaOrdenada = useMemo(
    () => [...devolucoes].sort((a, b) => new Date(a.dataDevolucao) - new Date(b.dataDevolucao)),
    [devolucoes]
  );

  const listaFiltrada = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return listaOrdenada;
    return listaOrdenada.filter((d) =>
      [d.lead?.nome, d.lead?.telefone, d.variacao?.produto?.nome, d.variacao?.nome, d.venda?.numero != null ? `#${d.venda.numero}` : '']
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t))
    );
  }, [listaOrdenada, busca]);

  const selecionado = listaFiltrada.find((d) => d.id === selecionadoId) || listaFiltrada[0] || null;

  // Próximas a vencer (sempre das pendentes), pra lateral.
  const proximas = useMemo(
    () => [...pendentesTodas]
      .sort((a, b) => new Date(a.dataDevolucao) - new Date(b.dataDevolucao))
      .slice(0, 5),
    [pendentesTodas]
  );

  const abrirNaLista = (d) => {
    const alvo = estaAtrasada(d) && filtro === 'atrasada' ? 'atrasada' : 'pendente';
    setBusca('');
    setSelecionadoId(d.id);
    if (filtro !== alvo) setFiltro(alvo);
  };

  const qtdAba = { pendente: resumo.pendentes, atrasada: resumo.atrasadas, concluida: concluidasTodas.length };

  const lateral = (
    <>
      <Painel
        titulo={selecionado ? nomeItem(selecionado) : 'Aluguel selecionado'}
        subtitulo={selecionado ? `${selecionado.variacao?.nome || ''}${selecionado.venda?.numero != null ? ` · venda #${selecionado.venda.numero}` : ''}` : undefined}
        acoes={selecionado ? <Badge variant={situacao(selecionado).variant} size="sm">{situacao(selecionado).texto}</Badge> : null}
        semPadding
      >
        {!selecionado ? (
          <p className="m-0 px-4 py-6 text-[13px] text-[var(--text-muted)] text-center">
            Escolha um item da lista pra ver os detalhes.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
              <span
                aria-hidden="true"
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold bg-[var(--primary-soft)] text-[var(--primary)]"
              >
                {iniciais(selecionado.lead?.nome)}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[var(--text-main)] truncate">
                  {selecionado.lead?.nome || 'Cliente não identificado'}
                </div>
                {selecionado.lead?.telefone && (
                  <div className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1">
                    <Phone size={11} aria-hidden="true" /> {selecionado.lead.telefone}
                  </div>
                )}
              </div>
            </div>
            <div className="px-4 pt-3 pb-1 text-xs font-medium text-[var(--text-muted)]">Item alugado</div>
            <LinhaInfo rotulo={`${selecionado.quantidade ?? 1}× ${nomeItem(selecionado)}${selecionado.variacao?.nome ? ` · ${selecionado.variacao.nome}` : ''}`} />
            <div className="px-4 pt-3 pb-1 text-xs font-medium text-[var(--text-muted)]">Prazo e estoque</div>
            <LinhaInfo rotulo="Devolução prevista" valor={fmtData(selecionado.dataDevolucao)} />
            <LinhaInfo rotulo="Situação" valor={textoPrazo(selecionado)} />
            <LinhaInfo
              rotulo="Aviso ao cliente"
              valor={selecionado.lembreteEnviadoEm ? `Enviado ${fmtDataHora(selecionado.lembreteEnviadoEm)}` : 'Ainda não enviado'}
            />
            <LinhaInfo
              rotulo="Estoque"
              valor={
                selecionado.variacao?.produto?.tipo === 'FISICO'
                  ? selecionado.devolvidoEm
                    ? `+${selecionado.quantidade ?? 1} devolvido ao estoque`
                    : `Volta +${selecionado.quantidade ?? 1} ao devolver`
                  : 'Não se aplica'
              }
            />
            <LinhaInfo rotulo="Registrado em" valor={fmtData(selecionado.criadoEm)} />
            <div className="flex flex-col gap-2 p-4">
              {!selecionado.devolvidoEm && (
                <Button
                  icon={Check}
                  onClick={() => handleConcluir(selecionado)}
                  loading={concluindo === selecionado.id}
                  className="w-full"
                >
                  Marcar devolvido
                </Button>
              )}
              <Button variant="secondary" size="sm" icon={ExternalLink} onClick={() => navigate('/app/vendas')} className="w-full">
                Ver venda{selecionado.venda?.numero != null ? ` #${selecionado.venda.numero}` : ''}
              </Button>
            </div>
          </>
        )}
      </Painel>

      <Painel
        titulo="Próximas a vencer"
        acoes={resumo.atrasadas > 0 ? (
          <Badge variant="danger" size="sm">{resumo.atrasadas} atrasada{resumo.atrasadas === 1 ? '' : 's'}</Badge>
        ) : null}
        semPadding
      >
        {proximas.length === 0 ? (
          <p className="m-0 px-4 py-5 text-[13px] text-[var(--text-muted)] text-center">Nenhum aluguel pendente.</p>
        ) : (
          <ul className="m-0 p-0 list-none">
            {proximas.map((d) => {
              const atrasada = estaAtrasada(d);
              return (
                <li key={d.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                  <button
                    type="button"
                    onClick={() => abrirNaLista(d)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-[var(--bg-subtle)] transition-colors"
                  >
                    <span
                      aria-hidden="true"
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        atrasada ? 'bg-[var(--danger-soft)] text-[var(--danger-text)]' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <Package size={15} strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-[var(--text-main)] truncate">{nomeItem(d)}</span>
                      <span className={`block text-xs truncate ${atrasada ? 'text-[var(--danger-text)] font-semibold' : 'text-[var(--text-muted)]'}`}>
                        {d.lead?.nome || 'Cliente não identificado'} · {textoPrazo(d)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="m-0 px-4 py-2.5 text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)] inline-flex items-center gap-1.5 w-full">
          <Bell size={12} aria-hidden="true" className="flex-shrink-0" />
          {diasAviso == null
            ? 'O sistema avisa o cliente antes da data de devolução.'
            : diasAviso === 0
              ? 'O sistema avisa o cliente no dia da devolução.'
              : `O sistema avisa o cliente ${diasAviso} dia${diasAviso === 1 ? '' : 's'} antes da data.`}
        </p>
      </Painel>
    </>
  );

  return (
    <Pagina>
      <p className="m-0 -mb-1 text-[13px] text-[var(--text-muted)]">
        Itens alugados que precisam voltar pra loja. O sistema avisa o cliente e gera alerta por aqui quando a data se aproxima.
      </p>

      <FaixaNumeros>
        <Numero
          rotulo="Pendentes"
          valor={resumo.pendentes}
          detalhe={`${resumo.avisadas} já avisado${resumo.avisadas === 1 ? '' : 's'}`}
          icone={RotateCcw}
          carregando={carregandoResumo}
          destaque
          onClick={() => setFiltro('pendente')}
        />
        <Numero
          rotulo="Atrasadas"
          valor={resumo.atrasadas}
          tom={resumo.atrasadas > 0 ? 'perigo' : 'neutro'}
          detalhe={resumo.atrasadas > 0 ? 'Data de devolução já passou' : 'Nenhuma atrasada'}
          icone={AlertTriangle}
          carregando={carregandoResumo}
          onClick={() => setFiltro('atrasada')}
        />
        <Numero
          rotulo="Vencem em 7 dias"
          valor={resumo.prox7}
          tom={resumo.prox7 > 0 ? 'alerta' : 'neutro'}
          detalhe="Incluindo hoje"
          carregando={carregandoResumo}
        />
        <Numero
          rotulo="Devolvidas no mês"
          valor={resumo.devolvidasMes}
          tom={resumo.devolvidasMes > 0 ? 'sucesso' : 'neutro'}
          detalhe={`${concluidasTodas.length} no total`}
          carregando={carregandoResumo}
          onClick={() => setFiltro('concluida')}
        />
      </FaixaNumeros>

      <ColunasPagina lateral={lateral}>
        <Painel semPadding>
          <BarraFerramentas>
            <AbasPilula
              rotulo="Situação da devolução"
              abas={FILTROS.map((f) => ({ valor: f.valor, rotulo: f.label, qtd: carregandoResumo ? null : qtdAba[f.valor] }))}
              valor={filtro}
              onChange={setFiltro}
            />
            <label className="ml-auto relative flex items-center min-w-[200px] flex-1 sm:flex-none sm:w-64">
              <span className="sr-only">Buscar por cliente, item ou venda</span>
              <Search size={14} aria-hidden="true" className="absolute left-2.5 text-[var(--text-muted)] pointer-events-none" />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Cliente, item ou venda"
                className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--primary)]"
              />
            </label>
          </BarraFerramentas>

          {carregando ? (
            <div className="text-center py-12 text-[var(--text-muted)] text-[13px]">Carregando...</div>
          ) : listaFiltrada.length === 0 ? (
            <EmptyState
              icon={RotateCcw}
              title={
                busca.trim()
                  ? 'Nada encontrado com essa busca'
                  : filtro === 'concluida'
                    ? 'Nenhuma devolução concluída ainda'
                    : 'Nenhuma devolução por aqui'
              }
              description={
                busca.trim()
                  ? 'Tente outro nome, item ou número de venda.'
                  : filtro === 'concluida'
                    ? 'Itens marcados como devolvidos aparecem aqui.'
                    : 'Vendas de produtos marcados como "alugado" (em Estoque) aparecem aqui até voltarem.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <caption className="sr-only">
                  {FILTROS.find((f) => f.valor === filtro)?.label}: {listaFiltrada.length} item(ns)
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>Item</th>
                    <th scope="col" className={TH}>Cliente</th>
                    <th scope="col" className={TH}>Venda</th>
                    <th scope="col" className={`${TH} text-right`}>Qtd</th>
                    <th scope="col" className={TH}>{filtro === 'concluida' ? 'Devolvido em' : 'Devolução em'}</th>
                    <th scope="col" className={TH}>Aviso</th>
                    <th scope="col" className={TH}>Situação</th>
                    <th scope="col" className={TH}><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {listaFiltrada.map((d) => {
                    const sel = selecionado?.id === d.id;
                    const st = situacao(d);
                    const concluida = !!d.devolvidoEm;
                    const tdSel = sel ? 'bg-[var(--primary-soft)]' : '';
                    return (
                      <tr key={d.id} className="text-[var(--text-secondary)]">
                        <td className={`${TD} ${tdSel}`}>
                          <button
                            type="button"
                            onClick={() => setSelecionadoId(d.id)}
                            className="text-left font-semibold text-[var(--text-main)] hover:text-[var(--primary)] hover:underline"
                          >
                            {nomeItem(d)}
                          </button>
                          {d.variacao?.nome && <span className="text-[var(--text-muted)]"> · {d.variacao.nome}</span>}
                        </td>
                        <td className={`${TD} ${tdSel} whitespace-nowrap`}>{d.lead?.nome || 'Cliente não identificado'}</td>
                        <td className={`${TD} ${tdSel} whitespace-nowrap`}>
                          <button
                            type="button"
                            onClick={() => navigate('/app/vendas')}
                            className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
                            aria-label={`Ver venda #${d.venda?.numero ?? ''}`}
                          >
                            #{d.venda?.numero} <ExternalLink size={11} aria-hidden="true" />
                          </button>
                        </td>
                        <td className={`${TD} ${tdSel} text-right tabular-nums`}>{d.quantidade ?? 1}</td>
                        <td className={`${TD} ${tdSel} whitespace-nowrap tabular-nums`}>
                          <span className="text-[var(--text-main)] font-medium">{fmtData(concluida ? d.devolvidoEm : d.dataDevolucao)}</span>
                          {!concluida && (
                            <span className={`block text-xs ${estaAtrasada(d) ? 'text-[var(--danger-text)] font-semibold' : 'text-[var(--text-muted)]'}`}>
                              {textoPrazo(d)}
                            </span>
                          )}
                        </td>
                        <td className={`${TD} ${tdSel} whitespace-nowrap text-xs`}>
                          {d.lembreteEnviadoEm ? `Enviado ${fmtData(d.lembreteEnviadoEm)}` : <span className="text-[var(--text-muted)]">—</span>}
                        </td>
                        <td className={`${TD} ${tdSel}`}>
                          <Badge variant={st.variant} size="sm">{st.texto}</Badge>
                        </td>
                        <td className={`${TD} ${tdSel} text-right whitespace-nowrap`}>
                          {!concluida && (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={Check}
                              onClick={() => handleConcluir(d)}
                              loading={concluindo === d.id}
                            >
                              Marcar devolvido
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="m-0 px-4 py-2.5 text-xs text-[var(--text-muted)]">
            Ao marcar como devolvido, produto físico volta pro estoque na hora.
          </p>
        </Painel>
      </ColunasPagina>
    </Pagina>
  );
}
