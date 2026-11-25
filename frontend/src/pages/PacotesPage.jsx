// /app/pacotes — pacotes de sessoes (frente A da fase 2).
// Modelos (o que se vende), venda (caixa ou Pix parcelado) e clientes com
// pacote (saldo, pagamento, validade). Regra no backend: src/agenda/pacotes.js.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Package, Loader2, AlertCircle, Edit2, ShoppingBag, Send, XCircle, Lock, RefreshCw, Search, CalendarPlus } from 'lucide-react';
import api from '../services/api';
import {
  Badge, Button, Card, EmptyState, Input, Select, useToast,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, BarraFerramentas, AbasPilula,
} from '../components/ui';
import Modal from '../components/Modal';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import { formatarTelefoneBR } from '../utils/formatTelefone';
import { formatarCpfCnpj, erroCpfCnpj, limparCpfCnpj } from '../utils/cpfCnpj';

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (d) => new Date(d).toLocaleDateString('pt-BR');
const STATUS = {
  ATIVO: { label: 'Ativo', variant: 'success' },
  ACABOU: { label: 'Acabou', variant: 'neutral' },
  VENCIDO: { label: 'Vencido', variant: 'warning' },
  CANCELADO: { label: 'Cancelado', variant: 'danger' },
};
const DIA_MS = 86400000;

function textoValidade(dias) {
  if (dias % 30 === 0) return `${dias / 30} ${dias / 30 === 1 ? 'mês' : 'meses'}`;
  return `${dias} dias`;
}

const diasAte = (data, agora) => Math.ceil((new Date(data).getTime() - agora) / DIA_MS);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Situação mostrada na tabela: pacote ativo perto do fim vira "Acabando".
function situacao(c) {
  if (c.status === 'ATIVO' && c.acabando) return { label: 'Acabando', variant: 'warning' };
  return STATUS[c.status] || { label: c.status, variant: 'neutral' };
}

function textoPagamento(c) {
  if (c.parcelasPagas >= c.parcelas) return `Pago${c.parcelas > 1 ? ` (${c.parcelas}×)` : ''}`;
  return `${c.parcelasPagas} de ${c.parcelas} parcela(s)${c.cobrancaPendente ? ` · ${fmtBRL(c.cobrancaPendente.valor)} em aberto` : ''}`;
}

function textoValidadeCliente(c, agora) {
  const d = diasAte(c.validoAte, agora);
  if (d < 0) return `venceu ${fmtData(c.validoAte)}`;
  return `${fmtData(c.validoAte)}${d <= 30 && c.status === 'ATIVO' ? ` · ${plural(d, 'dia', 'dias')}` : ''}`;
}

/** Barra "usadas/total" da coluna Sessões. */
function BarraSessoes({ c }) {
  const pct = c.sessoesTotal > 0 ? Math.round((c.sessoesUsadas / c.sessoesTotal) * 100) : 0;
  const cor = c.status !== 'ATIVO' ? 'bg-[var(--text-muted)]' : c.acabando ? 'bg-[var(--warning)]' : 'bg-[var(--primary)]';
  return (
    <div className="flex items-center gap-2">
      <span className="tabular-nums w-10 text-[var(--text-main)]">{c.sessoesUsadas}/{c.sessoesTotal}</span>
      <span className="h-1.5 w-20 rounded-full bg-[var(--bg-subtle)] overflow-hidden" aria-hidden="true">
        <span className={`block h-full rounded-full ${cor}`} style={{ width: `${pct}%` }} />
      </span>
      {c.reservados > 0 && <span className="text-xs text-[var(--text-muted)]">{c.reservados} marcada(s)</span>}
    </div>
  );
}

export default function PacotesPage() {
  const toast = useToast();
  const [modelos, setModelos] = useState([]);
  const [ativosLista, setAtivosLista] = useState([]);
  const [encerradosLista, setEncerradosLista] = useState([]);
  const [agora, setAgora] = useState(0);
  const [filtro, setFiltro] = useState('ativos');
  const [filtroModelo, setFiltroModelo] = useState('');
  const [busca, setBusca] = useState('');
  const [selId, setSelId] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoClientes, setCarregandoClientes] = useState(true);
  const [erro, setErro] = useState(null);
  const [semPlano, setSemPlano] = useState(false);
  const [modalModelo, setModalModelo] = useState({ open: false, modelo: null });
  const [modalVender, setModalVender] = useState({ open: false, modelo: null, cliente: null });
  const [config, setConfig] = useState(null);

  // Recarregar = mudar a versao (setState so nos callbacks das promessas).
  const [versaoModelos, setVersaoModelos] = useState(0);
  const [versaoClientes, setVersaoClientes] = useState(0);
  const carregarModelos = useCallback(() => setVersaoModelos((v) => v + 1), []);
  const carregarClientes = useCallback(() => { setCarregandoClientes(true); setVersaoClientes((v) => v + 1); }, []);

  useEffect(() => {
    let vivo = true;
    api.get('/pacotes/modelos')
      .then((r) => { if (vivo) { setModelos(r.data || []); setErro(null); } })
      .catch((e) => {
        if (!vivo) return;
        if (e.response?.data?.codigo === 'PLANO_SEM_RECURSO') setSemPlano(true);
        else setErro(e.response?.data?.erro || 'Não foi possível carregar os pacotes.');
      })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [versaoModelos]);

  useEffect(() => {
    api.get('/agenda/config').then((r) => setConfig(r.data)).catch(() => setConfig(null));
  }, []);

  // Busca ativos e encerrados de uma vez: as abas (Ativos, Acabando,
  // Encerrados, Todos), os contadores e os números do topo saem dessas listas.
  useEffect(() => {
    let vivo = true;
    Promise.all([
      api.get('/pacotes/clientes', { params: { filtro: 'ativos' } }),
      api.get('/pacotes/clientes', { params: { filtro: 'encerrados' } }),
    ])
      .then(([a, e]) => {
        if (!vivo) return;
        setAtivosLista(a.data || []);
        setEncerradosLista(e.data || []);
        setAgora(Date.now());
      })
      .catch((e) => {
        if (!vivo) return;
        if (e.response?.data?.codigo !== 'PLANO_SEM_RECURSO') toast.error(e.response?.data?.erro || 'Não foi possível carregar as clientes com pacote.');
        setAtivosLista([]);
        setEncerradosLista([]);
      })
      .finally(() => { if (vivo) setCarregandoClientes(false); });
    return () => { vivo = false; };
  }, [versaoClientes, toast]);

  const recarregarTudo = () => { carregarModelos(); carregarClientes(); };

  const mostrarNovoPacote = !carregando && !semPlano && !erro;
  useAcaoTopo(
    mostrarNovoPacote ? <Button size="sm" icon={Plus} onClick={() => setModalModelo({ open: true, modelo: null })}>Novo pacote</Button> : null,
    [mostrarNovoPacote]
  );

  const desativar = async (m) => {
    if (!confirm(`Parar de vender "${m.nome}"? Quem já comprou continua usando.`)) return;
    try {
      await api.delete(`/pacotes/modelos/${m.id}`);
      toast.success('Pacote desativado.');
      carregarModelos();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível desativar.');
    }
  };

  const reativar = async (m) => {
    try {
      await api.put(`/pacotes/modelos/${m.id}`, { ativo: true });
      toast.success('Pacote voltou a ser vendido.');
      carregarModelos();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível reativar.');
    }
  };

  const reenviarPix = async (c) => {
    try {
      const r = await api.post(`/pacotes/clientes/${c.id}/reenviar-pix`);
      toast.success(r.data.mensagem);
      carregarClientes();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível enviar o Pix.');
    }
  };

  const cancelar = async (c) => {
    if (!confirm(`Cancelar o pacote de ${c.cliente.nome}? As sessões que sobraram deixam de valer e as cobranças em aberto são canceladas.`)) return;
    try {
      await api.post(`/pacotes/clientes/${c.id}/cancelar`);
      toast.success('Pacote cancelado.');
      recarregarTudo();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível cancelar.');
    }
  };

  if (carregando) return <div className="py-16 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;

  if (semPlano) {
    return (
      <Card padding="lg">
        <EmptyState
          icon={Lock}
          title="Pacotes de sessões estão no plano Profissional"
          description="Venda pacotes, controle o saldo de cada cliente e desconte a sessão sozinho ao concluir o atendimento."
          action={<Link to="/app/plano"><Button variant="primary" className="min-h-[44px]">Ver planos</Button></Link>}
        />
      </Card>
    );
  }

  if (erro) {
    return (
      <Card padding="lg">
        <div role="alert" className="flex items-start gap-3">
          <AlertCircle size={18} className="text-[var(--danger)] mt-0.5" />
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-main)]">{erro}</p>
            <Button variant="secondary" onClick={() => { setCarregando(true); setErro(null); carregarModelos(); }}>Tentar de novo</Button>
          </div>
        </div>
      </Card>
    );
  }

  const ativos = modelos.filter((m) => m.ativo);
  const inativos = modelos.filter((m) => !m.ativo);
  const modeloAtivoDe = (c) => modelos.find((m) => m.id === c.modeloId && m.ativo);
  const abrirNovoModelo = () => setModalModelo({ open: true, modelo: null });
  const renovar = (c) => setModalVender({ open: true, modelo: modeloAtivoDe(c), cliente: c.cliente });

  // Listas por aba
  const acabandoLista = ativosLista.filter((c) => c.acabando);
  const todosLista = [...ativosLista, ...encerradosLista];
  const porAba = { ativos: ativosLista, acabando: acabandoLista, encerrados: encerradosLista, todos: todosLista };
  const daAba = porAba[filtro] || ativosLista;
  const termo = busca.trim().toLowerCase();
  const digitosBusca = termo.replace(/\D/g, '');
  const linhas = daAba
    .filter((c) => !filtroModelo || c.modeloId === filtroModelo)
    .filter((c) => !termo
      || c.cliente.nome.toLowerCase().includes(termo)
      || (digitosBusca && String(c.cliente.telefone || '').replace(/\D/g, '').includes(digitosBusca)));
  const sel = todosLista.find((c) => c.id === selId) || linhas[0] || null;

  // Números do topo (tudo calculado das listas carregadas)
  const sessoesARealizar = ativosLista.reduce((s, c) => s + (c.saldo || 0), 0);
  const sessoesMarcadas = ativosLista.reduce((s, c) => s + (c.reservados || 0), 0);
  const inicioMes = new Date(agora || 0);
  inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
  const vendidosMes = todosLista.filter((c) => c.status !== 'CANCELADO' && new Date(c.criadoEm).getTime() >= inicioMes.getTime());
  const valorVendidoMes = vendidosMes.reduce((s, c) => s + Number(c.valor || 0), 0);
  const vencem30 = ativosLista.filter((c) => c.saldo > 0 && diasAte(c.validoAte, agora) <= 30).length;

  const abas = [
    { valor: 'ativos', rotulo: 'Ativos', qtd: ativosLista.length },
    { valor: 'acabando', rotulo: 'Acabando', qtd: acabandoLista.length },
    { valor: 'encerrados', rotulo: 'Encerrados', qtd: encerradosLista.length },
    { valor: 'todos', rotulo: 'Todos', qtd: todosLista.length },
  ];
  const textoVazio = filtroModelo || termo
    ? 'Nenhuma cliente encontrada com esse filtro.'
    : filtro === 'acabando' ? 'Nenhum pacote acabando (2 sessões ou menos, ou vencendo em 30 dias).'
      : filtro === 'encerrados' ? 'Nenhum pacote encerrado.'
        : filtro === 'todos' ? 'Nenhuma cliente com pacote ainda.' : 'Nenhuma cliente com pacote ativo.';

  const lateral = (
    <>
      <DetalhePacote
        c={sel} agora={agora} modelo={sel ? modelos.find((m) => m.id === sel.modeloId) : null}
        podeRenovar={!!sel && (sel.acabando || sel.status !== 'ATIVO') && sel.status !== 'CANCELADO' && !!modeloAtivoDe(sel)}
        onRenovar={renovar} onPix={reenviarPix} onCancelar={cancelar}
      />

      <Painel
        titulo="Pacotes acabando"
        acoes={<Badge variant="warning">{acabandoLista.length}</Badge>}
        semPadding
      >
        {carregandoClientes ? (
          <div className="py-6 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>
        ) : acabandoLista.length === 0 ? (
          <p className="m-0 px-4 py-4 text-[13px] text-[var(--text-muted)]">Nenhum pacote acabando agora.</p>
        ) : (
          <>
            {acabandoLista.slice(0, 6).map((c) => {
              const d = diasAte(c.validoAte, agora);
              const motivo = [`resta${c.saldo === 1 ? '' : 'm'} ${plural(c.saldo, 'sessão', 'sessões')}`, d <= 30 ? `vence em ${plural(d, 'dia', 'dias')}` : null].filter(Boolean).join(' · ');
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b border-[var(--border-subtle)] text-[13px]">
                  <span className="flex-1 min-w-0">
                    <button type="button" onClick={() => setSelId(c.id)} className="block font-semibold text-[var(--text-main)] hover:text-[var(--primary)] hover:underline text-left">{c.cliente.nome}</button>
                    <span className="block text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">{c.pacote} · {motivo}</span>
                  </span>
                  {modeloAtivoDe(c) && (
                    <Button variant="secondary" size="sm" onClick={() => renovar(c)}>Oferecer renovação</Button>
                  )}
                </div>
              );
            })}
            <p className="m-0 px-4 py-2.5 text-xs text-[var(--text-muted)]">A renovação vende o mesmo pacote de novo, no caixa ou por Pix no WhatsApp.</p>
          </>
        )}
      </Painel>

      <Painel
        titulo="Pacotes à venda"
        semPadding
      >
        {modelos.length === 0 ? (
          <p className="m-0 px-4 py-4 text-[13px] text-[var(--text-muted)]">Nenhum pacote criado ainda.</p>
        ) : (
          [...ativos, ...inativos].map((m) => (
            <div key={m.id} className={`px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0 text-[13px] ${m.ativo ? '' : 'opacity-75'}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex-1 min-w-0 font-semibold text-[var(--text-main)] [overflow-wrap:anywhere]">{m.nome}</span>
                {m.ativo ? (
                  <>
                    <span className="text-xs text-[var(--text-muted)]">{textoValidade(m.validadeDias)}</span>
                    <strong className="tabular-nums text-[var(--text-main)]">{fmtBRL(m.preco)}</strong>
                  </>
                ) : <Badge variant="neutral" size="sm">Fora de venda</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">
                {m.servico} · {m.sessoes} sessões · {fmtBRL(m.valorSessao)} a sessão
                {m.precoAvulso && m.precoAvulso * m.sessoes > m.preco ? ` · economia de ${fmtBRL(m.precoAvulso * m.sessoes - m.preco)}` : ''}
                {m.intervaloMinDias ? ` · intervalo mínimo ${m.intervaloMinDias} dias` : ''}
                {` · ${m.clientesAtivas} cliente(s) ativa(s)`}
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {m.ativo && <Button variant="primary" size="sm" icon={ShoppingBag} onClick={() => setModalVender({ open: true, modelo: m, cliente: null })}>Vender</Button>}
                <Button variant="ghost" size="sm" icon={Edit2} onClick={() => setModalModelo({ open: true, modelo: m })} aria-label={`Editar ${m.nome}`}>Editar</Button>
                {m.ativo
                  ? <Button variant="ghost" size="sm" onClick={() => desativar(m)}>Parar de vender</Button>
                  : <Button variant="ghost" size="sm" onClick={() => reativar(m)}>Voltar a vender</Button>}
              </div>
            </div>
          ))
        )}
      </Painel>
    </>
  );

  return (
    <Pagina>
      <FaixaNumeros min={170}>
        <Numero rotulo="Pacotes ativos" valor={ativosLista.length} carregando={carregandoClientes} onClick={() => setFiltro('ativos')} />
        <Numero rotulo="Vendidos no mês" valor={fmtBRL(valorVendidoMes)} detalhe={plural(vendidosMes.length, 'pacote', 'pacotes')} carregando={carregandoClientes} />
        <Numero rotulo="Sessões a realizar" valor={sessoesARealizar} detalhe={`${sessoesMarcadas} já marcada(s) na agenda`} carregando={carregandoClientes} />
        <Numero rotulo="Acabando" valor={acabandoLista.length} detalhe="poucas sessões ou perto de vencer" tom="alerta" carregando={carregandoClientes} onClick={() => setFiltro('acabando')} />
        <Numero rotulo="Vencem em 30 dias" valor={vencem30} detalhe="com sessões sobrando" tom="perigo" carregando={carregandoClientes} />
      </FaixaNumeros>

      <ColunasPagina lateral={lateral}>
        {modelos.length === 0 && (
          <Card padding="lg">
            <EmptyState
              icon={Package}
              title="Nenhum pacote criado"
              description="Crie um pacote (ex.: 10 sessões de drenagem) e venda pra suas clientes. Cada atendimento concluído desconta uma sessão."
              action={<Button variant="primary" icon={Plus} className="min-h-[44px]" onClick={abrirNovoModelo}>Criar pacote</Button>}
            />
          </Card>
        )}

        <Painel semPadding as="section" className="overflow-hidden">
          <h2 className="sr-only">Clientes com pacote</h2>
          <BarraFerramentas>
            <AbasPilula abas={abas} valor={filtro} onChange={setFiltro} rotulo="Situação" />
            <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
              Pacote
              <select
                value={filtroModelo} onChange={(e) => setFiltroModelo(e.target.value)}
                className="h-9 px-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] font-medium text-[var(--text-main)]"
              >
                <option value="">Todos</option>
                {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </label>
            <div className="relative ml-auto min-w-[200px] flex-1 max-w-xs">
              <Search size={16} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <label htmlFor="filtra-cli-pacote" className="sr-only">Filtrar clientes</label>
              <input
                id="filtra-cli-pacote" type="search" placeholder="Filtrar clientes" value={busca} onChange={(e) => setBusca(e.target.value)}
                className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)]"
              />
            </div>
          </BarraFerramentas>

          {carregandoClientes ? (
            <div className="py-10 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>
          ) : linhas.length === 0 ? (
            <div className="px-4 py-8 text-[13px] text-center text-[var(--text-muted)]">{textoVazio}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    {['Cliente', 'Pacote', 'Sessões', 'Validade', 'Pagamento', 'Valor', 'Situação'].map((t) => (
                      <th key={t} className={`text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap ${t === 'Valor' ? 'text-right' : 'text-left'}`}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((c) => {
                    const ativa = sel?.id === c.id;
                    const st = situacao(c);
                    const d = diasAte(c.validoAte, agora);
                    const td = `px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap ${ativa ? 'bg-[var(--primary-soft)]' : ''}`;
                    return (
                      <tr key={c.id}>
                        <td className={td}>
                          <button type="button" onClick={() => setSelId(c.id)} className="font-semibold text-[var(--text-main)] hover:text-[var(--primary)] hover:underline text-left" aria-label={`Ver pacote de ${c.cliente.nome}`}>{c.cliente.nome}</button>
                        </td>
                        <td className={`${td} text-[var(--text-secondary)]`}>{c.pacote}</td>
                        <td className={td}><BarraSessoes c={c} /></td>
                        <td className={`${td} tabular-nums ${c.status === 'ATIVO' && d <= 30 ? 'text-[var(--danger-text)] font-semibold' : 'text-[var(--text-secondary)]'}`}>{textoValidadeCliente(c, agora)}</td>
                        <td className={`${td} text-[var(--text-secondary)]`}>{textoPagamento(c)}</td>
                        <td className={`${td} text-right tabular-nums text-[var(--text-main)]`}>{fmtBRL(c.valor)}</td>
                        <td className={td}><Badge variant={st.variant} size="sm">{st.label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-[var(--text-muted)]">
            <span>Cada atendimento concluído na agenda desconta uma sessão sozinho.</span>
            {!carregandoClientes && <span>Mostrando {linhas.length} de {daAba.length}</span>}
          </div>
        </Painel>
      </ColunasPagina>

      <ModalModelo
        isOpen={modalModelo.open} modelo={modalModelo.modelo}
        onClose={() => setModalModelo({ open: false, modelo: null })}
        onSalvo={() => { setModalModelo({ open: false, modelo: null }); carregarModelos(); }}
      />
      <ModalVender
        isOpen={modalVender.open} modelo={modalVender.modelo} cliente={modalVender.cliente}
        pagamentoConfigurado={!!config?.pagamentoConfigurado}
        exigeCpf={!!config?.pagamentoExigeCpf}
        onClose={() => setModalVender({ open: false, modelo: null, cliente: null })}
        onVendido={() => { setModalVender({ open: false, modelo: null, cliente: null }); recarregarTudo(); }}
      />
    </Pagina>
  );
}

/** Coluna da direita: o pacote da cliente selecionada na tabela. */
function DetalhePacote({ c, agora, modelo, podeRenovar, onRenovar, onPix, onCancelar }) {
  if (!c) {
    return (
      <Painel titulo="Pacote selecionado">
        <p className="m-0 text-[13px] text-[var(--text-muted)]">Escolha uma cliente na tabela pra ver o saldo, a validade e as ações do pacote.</p>
      </Painel>
    );
  }
  const st = situacao(c);
  const d = diasAte(c.validoAte, agora);
  const livres = c.saldo - (c.reservados || 0);
  return (
    <Painel
      titulo={c.cliente.nome}
      subtitulo={c.cliente.telefone ? formatarTelefoneBR(c.cliente.telefone) : undefined}
      acoes={<Badge variant={st.variant}>{st.label}</Badge>}
      semPadding
    >
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="text-sm font-semibold text-[var(--text-main)]">{c.pacote}</div>
        <div className="text-xs text-[var(--text-muted)] mt-0.5">Restam {c.saldo} de {c.sessoesTotal} sessões</div>
        <div className="flex flex-wrap gap-1.5 mt-2.5" role="img" aria-label={`${c.sessoesUsadas} de ${c.sessoesTotal} sessões usadas`}>
          {Array.from({ length: c.sessoesTotal }, (_, n) => (
            <span
              key={n}
              className={`w-[18px] h-[18px] rounded-full border-2 border-[var(--primary)] ${n < c.sessoesUsadas ? 'bg-[var(--primary)]' : 'bg-[var(--bg-card)]'}`}
            />
          ))}
        </div>
      </div>
      <LinhaInfo rotulo="Vendido em" valor={fmtData(c.criadoEm)} />
      <LinhaInfo rotulo="Validade" valor={d < 0 ? `Venceu em ${fmtData(c.validoAte)}` : `${fmtData(c.validoAte)} (${plural(d, 'dia', 'dias')})`} />
      {modelo?.intervaloMinDias ? <LinhaInfo rotulo="Intervalo mínimo" valor={`${modelo.intervaloMinDias} dias entre sessões`} /> : null}
      <LinhaInfo rotulo="Pagamento" valor={`${textoPagamento(c)} · ${fmtBRL(c.valor)}`} />
      <LinhaInfo rotulo="Marcadas na agenda" valor={plural(c.reservados || 0, 'sessão', 'sessões')} />

      <div className="px-4 py-3 flex flex-col gap-2">
        {c.status === 'ATIVO' && livres > 0 && (
          <Link
            to="/app/agenda"
            className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] hover:bg-[var(--primary-hover)] text-sm font-semibold"
          >
            <CalendarPlus size={16} aria-hidden="true" /> Agendar próxima sessão
          </Link>
        )}
        <div className="flex flex-wrap gap-2">
          {podeRenovar && <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => onRenovar(c)}>Renovar</Button>}
          {c.status === 'ATIVO' && c.parcelasPagas < c.parcelas && (
            <Button variant="secondary" size="sm" icon={Send} onClick={() => onPix(c)}>Mandar Pix</Button>
          )}
          {c.status === 'ATIVO' && (
            <Button variant="danger-soft" size="sm" icon={XCircle} aria-label={`Cancelar pacote de ${c.cliente.nome}`} onClick={() => onCancelar(c)}>Cancelar pacote</Button>
          )}
        </div>
      </div>
    </Painel>
  );
}

// Abre sempre com estado novo: o conteudo remonta a cada abertura (key).
function ModalModelo(props) {
  if (!props.isOpen) return null;
  return <ModalModeloConteudo key={props.modelo?.id || 'novo'} {...props} />;
}

function ModalModeloConteudo({ isOpen, modelo, onClose, onSalvo }) {
  const toast = useToast();
  const [servicos, setServicos] = useState([]);
  const [form, setForm] = useState(() => (modelo
    ? { nome: modelo.nome, produtoId: modelo.produtoId || '', sessoes: String(modelo.sessoes), preco: String(modelo.preco), validadeDias: String(modelo.validadeDias), intervaloMinDias: modelo.intervaloMinDias ? String(modelo.intervaloMinDias) : '' }
    : { nome: '', produtoId: '', sessoes: '10', preco: '', validadeDias: '180', intervaloMinDias: '' }));
  const [erros, setErros] = useState([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.get('/catalogo').then((r) => setServicos((r.data || []).filter((p) => p.tipo === 'SERVICO'))).catch(() => setServicos([]));
  }, []);

  const salvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    setErros([]);
    const corpo = {
      nome: form.nome, produtoId: form.produtoId, sessoes: Number(form.sessoes), preco: Number(String(form.preco).replace(',', '.')),
      validadeDias: Number(form.validadeDias), intervaloMinDias: form.intervaloMinDias ? Number(form.intervaloMinDias) : null,
    };
    try {
      if (modelo) await api.put(`/pacotes/modelos/${modelo.id}`, corpo);
      else await api.post('/pacotes/modelos', corpo);
      toast.success(modelo ? 'Pacote atualizado.' : 'Pacote criado.');
      onSalvo();
    } catch (err) {
      setErros(err.response?.data?.campos || []);
      toast.error(err.response?.data?.erro || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const erro = (c) => (erros.includes(c) ? 'Confira este campo' : undefined);
  const porSessao = Number(form.sessoes) > 0 && Number(String(form.preco).replace(',', '.')) > 0
    ? Number(String(form.preco).replace(',', '.')) / Number(form.sessoes) : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modelo ? 'Editar pacote' : 'Novo pacote'} description={modelo ? 'Mudanças valem pra próximas vendas; quem já comprou mantém o que comprou.' : 'O que você vai vender: serviço, quantas sessões, preço e validade.'} size="lg">
      <form onSubmit={salvar} className="space-y-4">
        <Input label="Nome do pacote" placeholder="Ex.: Drenagem 10 sessões" value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} error={erro('nome')} required />
        <Select label="Serviço" value={form.produtoId || ''} onChange={(e) => setForm({ ...form, produtoId: e.target.value })} placeholder={servicos.length ? 'Escolha o serviço' : 'Cadastre um serviço no Catálogo antes'} options={servicos.map((s) => ({ value: s.id, label: s.nome }))} error={erro('produtoId')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Sessões" type="number" min={2} max={100} value={form.sessoes || ''} onChange={(e) => setForm({ ...form, sessoes: e.target.value })} error={erro('sessoes')} required />
          <Input label="Preço do pacote (R$)" inputMode="decimal" value={form.preco || ''} onChange={(e) => setForm({ ...form, preco: e.target.value })} error={erro('preco')} hint={porSessao ? `Sai ${fmtBRL(porSessao)} a sessão` : undefined} required />
          <Input label="Validade (dias)" type="number" min={7} max={1095} value={form.validadeDias || ''} onChange={(e) => setForm({ ...form, validadeDias: e.target.value })} error={erro('validadeDias')} required />
          <Input label="Intervalo mínimo entre sessões (dias)" type="number" min={0} max={180} value={form.intervaloMinDias || ''} onChange={(e) => setForm({ ...form, intervaloMinDias: e.target.value })} error={erro('intervaloMinDias')} hint="Vazio = sem intervalo" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" className="min-h-[44px]" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" className="min-h-[44px]" loading={salvando}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

// Abre sempre com estado novo: o conteudo so existe com o modal aberto.
function ModalVender(props) {
  if (!props.isOpen || !props.modelo) return null;
  return <ModalVenderConteudo {...props} />;
}

function ModalVenderConteudo({ isOpen, modelo, cliente, pagamentoConfigurado, exigeCpf = false, onClose, onVendido }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({ nome: cliente?.nome || '', telefone: cliente?.telefone ? formatarTelefoneBR(cliente.telefone) : '', forma: 'CAIXA', metodoPagamento: 'PIX', parcelas: '1', cpfCnpj: '' }));
  const [erros, setErros] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [pix, setPix] = useState(null);

  // Asaas pede CPF/CNPJ de quem paga o Pix. Opcional na tela: se a cliente ja
  // tem CPF na ficha, o servidor usa esse; sem nenhum, volta pedindo o campo.
  const pedeCpf = form.forma === 'PIX' && exigeCpf;
  const vender = async (e) => {
    e.preventDefault();
    if (pedeCpf && erroCpfCnpj(form.cpfCnpj, false)) {
      setErros(['cpfCnpj']);
      return;
    }
    setSalvando(true);
    setErros([]);
    try {
      const r = await api.post('/pacotes/vender', {
        modeloId: modelo.id, nome: form.nome, telefone: form.telefone, forma: form.forma,
        metodoPagamento: form.forma === 'CAIXA' ? form.metodoPagamento : undefined,
        parcelas: form.forma === 'PIX' ? Number(form.parcelas) : 1,
        cpfCnpj: pedeCpf && form.cpfCnpj ? limparCpfCnpj(form.cpfCnpj) : undefined,
      });
      if (r.data.venda) {
        toast.success(`Pacote vendido · Venda #${r.data.venda.numero} (${fmtBRL(r.data.venda.valor)}) no caixa.`);
        onVendido();
      } else {
        toast.success(r.data.mensagem);
        setPix(r.data.cobranca);
      }
    } catch (err) {
      setErros(err.response?.data?.campos || []);
      toast.error(err.response?.data?.erro || 'Não foi possível vender.');
    } finally {
      setSalvando(false);
    }
  };

  const erro = (c) => (erros.includes(c) ? 'Confira este campo' : undefined);
  const parcela = Number(form.parcelas) > 0 ? modelo.preco / Number(form.parcelas) : modelo.preco;

  if (pix) {
    return (
      <Modal isOpen={isOpen} onClose={onVendido} title="Pix gerado" description={`${modelo.nome} · ${form.nome}`}>
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">A cliente recebeu o Pix de {fmtBRL(pix.valor)} no WhatsApp. Quando pagar, o sistema registra sozinho{Number(form.parcelas) > 1 ? ' e gera a próxima parcela' : ''}.</p>
          {pix.qrCode && (
            <div>
              <label htmlFor="pix-pacote" className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Pix copia e cola</label>
              <textarea id="pix-pacote" readOnly value={pix.qrCode} rows={3} className="w-full text-xs rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] p-2 font-mono" />
              <Button variant="secondary" className="min-h-[44px] mt-2" onClick={() => navigator.clipboard?.writeText(pix.qrCode).then(() => toast.success('Código copiado.'))}>Copiar código</Button>
            </div>
          )}
          <div className="flex justify-end"><Button variant="primary" className="min-h-[44px]" onClick={onVendido}>Pronto</Button></div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Vender ${modelo.nome}`} description={`${modelo.sessoes} sessões de ${modelo.servico} · ${fmtBRL(modelo.preco)} · validade ${textoValidade(modelo.validadeDias)}`} size="lg">
      <form onSubmit={vender} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome da cliente" value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} error={erro('nome')} required />
          <Input label="WhatsApp" inputMode="tel" maxLength={15} placeholder="(11) 98888-7777" value={form.telefone || ''} onChange={(e) => setForm({ ...form, telefone: formatarTelefoneBR(e.target.value) })} error={erro('telefone')} hint="Se já é cliente, o sistema acha pelo número." required />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-[var(--text-secondary)] mb-1">Como ela paga</legend>
          {[['CAIXA', 'Agora, no caixa', 'Lança a venda no caixa do dia (dinheiro, cartão ou Pix na maquininha).'], ['PIX', 'Pix pelo WhatsApp', 'Gera o Pix e manda pra cliente. Dá pra parcelar: uma cobrança por mês.']].map(([v, t, d]) => (
            <label key={v} className={`flex gap-3 items-start p-3 rounded-xl border cursor-pointer min-h-[44px] ${form.forma === v ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)]'} ${v === 'PIX' && !pagamentoConfigurado ? 'opacity-60 cursor-not-allowed' : ''}`}>
              <input type="radio" name="forma" value={v} checked={form.forma === v} disabled={v === 'PIX' && !pagamentoConfigurado} onChange={() => setForm({ ...form, forma: v })} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold text-[var(--text-main)]">{t}</span>
                <span className="block text-xs text-[var(--text-muted)]">{v === 'PIX' && !pagamentoConfigurado ? 'Configure o recebimento em Pagamentos para cobrar por Pix.' : d}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {form.forma === 'CAIXA' ? (
          <Select label="Forma de pagamento" value={form.metodoPagamento} onChange={(e) => setForm({ ...form, metodoPagamento: e.target.value })} placeholder="" options={[{ value: 'PIX', label: 'Pix' }, { value: 'DINHEIRO', label: 'Dinheiro' }, { value: 'CARTAO_CREDITO', label: 'Cartão de crédito' }, { value: 'CARTAO_DEBITO', label: 'Cartão de débito' }]} error={erro('metodoPagamento')} />
        ) : (
          <Select label="Parcelas" value={form.parcelas} onChange={(e) => setForm({ ...form, parcelas: e.target.value })} placeholder="" options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? `À vista (${fmtBRL(modelo.preco)})` : `${i + 1}× de ${fmtBRL(modelo.preco / (i + 1))}` }))} error={erro('parcelas')} hint={Number(form.parcelas) > 1 ? `A 1ª parcela (${fmtBRL(parcela)}) sai agora; as outras, uma por mês, depois que a anterior é paga.` : undefined} />
        )}
        {pedeCpf && (
          <Input
            label="CPF ou CNPJ de quem paga"
            inputMode="numeric"
            value={form.cpfCnpj}
            onChange={(e) => setForm({ ...form, cpfCnpj: formatarCpfCnpj(e.target.value) })}
            placeholder="000.000.000-00"
            error={erros.includes('cpfCnpj') ? (erroCpfCnpj(form.cpfCnpj, true) || 'Confira este campo') : undefined}
            hint="O Asaas pede esse dado. Se a cliente já tem CPF na ficha, pode deixar em branco."
          />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" className="min-h-[44px]" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" className="min-h-[44px]" loading={salvando}>{form.forma === 'PIX' ? 'Gerar Pix' : `Registrar venda de ${fmtBRL(modelo.preco)}`}</Button>
        </div>
      </form>
    </Modal>
  );
}
