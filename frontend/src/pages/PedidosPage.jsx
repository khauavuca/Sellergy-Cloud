// /app/pedidos — frente B da fase 2.
// Quadro dos pedidos da loja online e das vendas pelo WhatsApp (Novos,
// Aguardando pagamento, Pago · separar), entregues e cancelados numa tabela
// embaixo, detalhe com as acoes na coluna da direita, "Vender pelo WhatsApp"
// e a aba "Loja online" (ligar/configurar/link).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, MessageCircle, Lock, AlertCircle, Loader2, RotateCw, Truck, Store, RefreshCw, ExternalLink, MousePointerClick } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import {
  Badge, Button, Drawer, EmptyState,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, BarraFerramentas, AbasPilula,
} from '../components/ui';
import { usePermissao, useEhAdminOuDono } from '../hooks/usePermissao';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import PedidoDetalhe from '../components/pedidos/PedidoDetalhe';
import LojaOnlineConfig from '../components/pedidos/LojaOnlineConfig';
import VenderWhatsappModal from '../components/pedidos/VenderWhatsappModal';
import { fmtBRL, fmtQuando, resumoItens, ORIGEM_PEDIDO, erroDaApi } from '../components/pedidos/util';

const COLUNAS = [
  { status: 'NOVO', titulo: 'Novos', dica: 'Aceite pra mandar o Pix', cor: 'var(--info)' },
  { status: 'AGUARDANDO_PAGAMENTO', titulo: 'Aguardando pagamento', dica: 'Anda sozinho quando o pagamento cair', cor: 'var(--warning)' },
  { status: 'PAGO', titulo: 'Pago · separar', dica: 'Estoque já baixado', cor: 'var(--success)' },
];
const ORIGEM_VARIANTE = { CATALOGO: 'info', WHATSAPP: 'success', BALCAO: 'neutral' };
const ATUALIZAR_MS = 30000;

const ehHoje = (iso) => Boolean(iso) && new Date(iso).toDateString() === new Date().toDateString();

function fmtDuracao(min) {
  if (min == null) return '—';
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}min` : `${h}h`;
  return `${Math.round(h / 24)} dias`;
}

// Coluna da direita fixa so quando cabe ao lado do quadro; abaixo disso o
// detalhe abre na gaveta.
function useTelaLarga() {
  const consulta = '(min-width: 1280px)';
  const [larga, setLarga] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(consulta).matches : true));
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const aoMudar = () => setLarga(mq.matches);
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);
  return larga;
}

const classeCampo = 'h-9 px-2.5 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[13px] font-medium text-[var(--text-main)]';

export default function PedidosPage() {
  const [params, setParams] = useSearchParams();
  const [aba, setAba] = useState(params.get('aba') === 'loja' ? 'loja' : 'pedidos');
  const [pedidos, setPedidos] = useState([]);
  const [diasHistorico, setDiasHistorico] = useState(7);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [semPlano, setSemPlano] = useState(false);
  const [selecionado, setSelecionado] = useState(null);
  const [modalWhats, setModalWhats] = useState(params.get('novo') === 'whatsapp');
  const [pedeCpf, setPedeCpf] = useState(false);
  const [linkLoja, setLinkLoja] = useState(null);
  const [filtroOrigem, setFiltroOrigem] = useState('');
  const [filtroEntrega, setFiltroEntrega] = useState('');
  const larga = useTelaLarga();
  const podeCriar = usePermissao('VENDAS', 'criar');
  const podeEditar = usePermissao('VENDAS', 'editar');
  const ehDono = useEhAdminOuDono();
  const mostrarVenderWhats = podeCriar && !semPlano;
  useAcaoTopo(
    mostrarVenderWhats ? <Button size="sm" icon={MessageCircle} onClick={() => setModalWhats(true)}>Vender pelo WhatsApp</Button> : null,
    [mostrarVenderWhats]
  );

  const carregar = useCallback(() => api.get('/pedidos')
    .then((r) => { setPedidos(r.data.pedidos); setDiasHistorico(r.data.diasHistorico); setErro(null); })
    .catch((e) => {
      if (e.response?.data?.codigo === 'PLANO_SEM_RECURSO') setSemPlano(true);
      else setErro(erroDaApi(e, 'Não foi possível carregar os pedidos.'));
    })
    .finally(() => setCarregando(false)), []);

  useEffect(() => {
    carregar();
    api.get('/pedidos/loja').then((r) => {
      setPedeCpf(r.data.provedorPagamento === 'ASAAS');
      setLinkLoja(r.data.online && r.data.link ? r.data.link : null);
    }).catch(() => {});
    const t = setInterval(carregar, ATUALIZAR_MS);
    return () => clearInterval(t);
  }, [carregar]);

  // Tira o ?novo=whatsapp da URL depois de abrir (pra nao reabrir no F5).
  useEffect(() => {
    if (params.get('novo')) {
      const p = new URLSearchParams(params);
      p.delete('novo');
      setParams(p, { replace: true });
    }
  }, [params, setParams]);

  // Numeros do topo: sempre sobre a lista inteira (sem os filtros).
  const numeros = useMemo(() => {
    const hojeFeitos = pedidos.filter((p) => ehHoje(p.criadoEm) && p.status !== 'CANCELADO');
    const pagosHoje = pedidos.filter((p) => ehHoje(p.pagoEm) && (p.status === 'PAGO' || p.status === 'ENTREGUE'));
    const aguardando = pedidos.filter((p) => p.status === 'AGUARDANDO_PAGAMENTO');
    const separar = pedidos.filter((p) => p.status === 'PAGO');
    const entregues = pedidos.filter((p) => p.status === 'ENTREGUE' && p.entregueEm && p.criadoEm);
    const soma = (lista) => lista.reduce((s, p) => s + Number(p.total || 0), 0);
    const mediaMin = entregues.length
      ? entregues.reduce((s, p) => s + (new Date(p.entregueEm) - new Date(p.criadoEm)), 0) / entregues.length / 60000
      : null;
    return {
      hoje: hojeFeitos.length,
      faturado: soma(pagosHoje),
      qtdPagosHoje: pagosHoje.length,
      aguardando: soma(aguardando),
      qtdAguardando: aguardando.length,
      separar: separar.length,
      valorSeparar: soma(separar),
      mediaMin,
      qtdEntregues: entregues.length,
    };
  }, [pedidos]);

  const filtrados = useMemo(() => pedidos.filter((p) =>
    (!filtroOrigem || p.origem === filtroOrigem) && (!filtroEntrega || p.entrega === filtroEntrega)), [pedidos, filtroOrigem, filtroEntrega]);

  const porColuna = useMemo(() => {
    const m = Object.fromEntries(COLUNAS.map((c) => [c.status, []]));
    for (const p of filtrados) if (m[p.status]) m[p.status].push(p);
    return m;
  }, [filtrados]);

  const historico = useMemo(() => filtrados
    .filter((p) => p.status === 'ENTREGUE' || p.status === 'CANCELADO')
    .map((p) => ({ ...p, quandoFim: p.status === 'ENTREGUE' ? p.entregueEm : p.canceladoEm }))
    .sort((a, b) => new Date(b.quandoFim || 0) - new Date(a.quandoFim || 0)), [filtrados]);

  if (semPlano) {
    return (
      <EmptyState
        icon={Lock}
        title="Pedidos e loja online não estão no seu plano"
        description="Com o plano Profissional você tem uma loja na internet, recebe pedidos e vende pelo WhatsApp com Pix que confirma sozinho."
        action={<Link to="/app/plano" className="inline-flex items-center min-h-11 px-4 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-sm font-semibold">Ver planos</Link>}
      />
    );
  }

  const entregaCurta = (p) => (
    <span className="inline-flex items-center gap-1.5">
      {p.entrega === 'ENTREGA' ? <Truck size={14} aria-hidden="true" /> : <Store size={14} aria-hidden="true" />}
      {p.entrega === 'ENTREGA' ? 'Entrega' : 'Retirada'}
    </span>
  );

  const cartao = (p) => (
    <li key={p.id}>
      <button
        type="button"
        onClick={() => setSelecionado(p.id)}
        aria-pressed={selecionado === p.id}
        className={clsx(
          'w-full text-left rounded-lg border bg-[var(--bg-card)] p-2.5 text-[13px] transition-colors',
          selecionado === p.id ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : 'border-[var(--border-main)] hover:border-[var(--border-strong)]',
        )}
      >
        <span className="flex items-baseline gap-1.5">
          <strong className="flex-1 min-w-0 font-semibold text-[var(--text-main)] truncate">#{p.numero} · {p.nomeCliente}</strong>
          <span className="text-xs text-[var(--text-muted)] shrink-0">{fmtQuando(p.criadoEm)}</span>
        </span>
        <span className="block text-xs text-[var(--text-muted)] mt-1 truncate">{resumoItens(p.itens)}</span>
        <span className="flex items-center gap-1.5 mt-2">
          <strong className="flex-1 font-semibold tabular-nums text-[var(--text-main)]">{fmtBRL(p.total)}</strong>
          <Badge variant={ORIGEM_VARIANTE[p.origem] || 'neutral'} size="sm">{ORIGEM_PEDIDO[p.origem] || p.origem}</Badge>
        </span>
        <span className="flex mt-1.5 text-xs text-[var(--text-secondary)]">{entregaCurta(p)}</span>
      </button>
    </li>
  );

  const detalhe = (comFechar) => selecionado && (
    <PedidoDetalhe
      key={selecionado}
      pedidoId={selecionado}
      podeEditar={podeEditar}
      onMudou={carregar}
      onFechar={comFechar ? () => setSelecionado(null) : undefined}
    />
  );

  const lateral = aba === 'pedidos' && larga && !carregando && !erro && pedidos.length > 0 && (
    selecionado ? (
      <section aria-label="Pedido selecionado" className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] min-w-0">
        {detalhe(true)}
      </section>
    ) : (
      <Painel titulo="Pedido selecionado">
        <div className="flex flex-col items-center text-center gap-2 py-6 text-[13px] text-[var(--text-muted)]">
          <MousePointerClick size={20} aria-hidden="true" />
          Clique num pedido pra ver os itens, o histórico e as ações.
        </div>
      </Painel>
    )
  );

  let conteudo;
  if (aba === 'loja') {
    conteudo = <LojaOnlineConfig podeEditar={ehDono} />;
  } else if (carregando) {
    conteudo = <div className="py-16 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;
  } else if (erro) {
    conteudo = (
      <div role="alert" className="flex flex-wrap items-center gap-2 p-4 rounded-[10px] bg-[var(--danger-soft)] text-sm text-[var(--danger-text)]">
        <AlertCircle size={16} aria-hidden="true" /> {erro}
        <Button variant="secondary" icon={RotateCw} className="ml-auto" onClick={() => { setCarregando(true); carregar(); }}>Tentar de novo</Button>
      </div>
    );
  } else if (pedidos.length === 0) {
    conteudo = (
      <EmptyState
        icon={ClipboardList}
        title="Nenhum pedido ainda"
        description="Ligue a loja online na aba ao lado e mande o link pros clientes, ou monte um pedido em “Vender pelo WhatsApp”."
        action={<Button variant="secondary" onClick={() => setAba('loja')}>Configurar loja online</Button>}
      />
    );
  } else {
    conteudo = (
      <>
        <div className="flex flex-wrap gap-2.5">
          {COLUNAS.map((c) => (
            <section key={c.status} aria-label={c.titulo} className="flex flex-col gap-2 flex-[1_1_200px] min-w-0 rounded-[10px] bg-[var(--bg-subtle)] p-2 lg:min-h-[420px]">
              <div className="flex items-center gap-2 px-1 pt-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.cor }} aria-hidden="true" />
                <h2 className="flex-1 m-0 text-[13px] font-bold text-[var(--text-main)]">{c.titulo}</h2>
                <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-[var(--bg-card)] text-xs font-semibold tabular-nums text-[var(--text-secondary)]">{porColuna[c.status].length}</span>
              </div>
              <p className="m-0 px-1 text-xs text-[var(--text-muted)]">{c.dica}</p>
              {porColuna[c.status].length === 0
                ? <p className="m-0 px-1 py-2 text-xs text-[var(--text-muted)]">Nada aqui.</p>
                : <ul className="flex flex-col gap-2">{porColuna[c.status].map(cartao)}</ul>}
            </section>
          ))}
        </div>

        <Painel
          titulo="Entregues e cancelados"
          subtitulo={`Ficam aqui por ${diasHistorico} dias. Pedido sem pagamento é cancelado sozinho depois de 24 horas.`}
          semPadding
        >
          {historico.length === 0 ? (
            <p className="m-0 px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Nenhum pedido entregue ou cancelado nos últimos {diasHistorico} dias.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    {['Nº', 'Cliente', 'Itens', 'Origem', 'Entrega'].map((t) => (
                      <th key={t} className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">{t}</th>
                    ))}
                    <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Total</th>
                    <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => setSelecionado(p.id)}
                      className={clsx('cursor-pointer text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]', selecionado === p.id && 'bg-[var(--bg-subtle)]')}
                    >
                      <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelecionado(p.id); }}
                          aria-label={`Abrir pedido ${p.numero}`}
                          className="font-semibold text-[var(--text-main)] hover:underline"
                        >#{p.numero}</button>
                      </td>
                      <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap text-[var(--text-main)]">{p.nomeCliente}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] max-w-[280px] truncate">{resumoItens(p.itens)}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap">{ORIGEM_PEDIDO[p.origem] || p.origem}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap">{entregaCurta(p)}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap text-right font-semibold tabular-nums text-[var(--text-main)]">{fmtBRL(p.total)}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap">
                        {p.status === 'ENTREGUE'
                          ? <Badge variant="neutral">Entregue {fmtQuando(p.quandoFim)}</Badge>
                          : <Badge variant="danger">Cancelado {fmtQuando(p.quandoFim)}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Painel>
      </>
    );
  }

  return (
    <Pagina>
      <FaixaNumeros min={170}>
        <Numero rotulo="Pedidos hoje" valor={numeros.hoje} detalhe="Sem contar cancelados" carregando={carregando} />
        <Numero rotulo="Faturado em pedidos hoje" valor={fmtBRL(numeros.faturado)} detalhe={`${numeros.qtdPagosHoje} ${numeros.qtdPagosHoje === 1 ? 'pedido pago' : 'pedidos pagos'}`} carregando={carregando} />
        <Numero
          rotulo="Aguardando pagamento"
          valor={fmtBRL(numeros.aguardando)}
          tom={numeros.qtdAguardando ? 'alerta' : 'neutro'}
          detalhe={`${numeros.qtdAguardando} ${numeros.qtdAguardando === 1 ? 'pedido' : 'pedidos'}`}
          carregando={carregando}
        />
        <Numero rotulo="Pra separar" valor={numeros.separar} detalhe={fmtBRL(numeros.valorSeparar)} carregando={carregando} />
        <Numero
          rotulo="Tempo médio até entregar"
          valor={fmtDuracao(numeros.mediaMin)}
          detalhe={numeros.qtdEntregues ? `${numeros.qtdEntregues} entregues em ${diasHistorico} dias` : `Sem entregas em ${diasHistorico} dias`}
          carregando={carregando}
        />
      </FaixaNumeros>

      <div className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)]">
        <BarraFerramentas className="border-b-0">
          <AbasPilula
            rotulo="Seção"
            valor={aba}
            onChange={setAba}
            abas={[{ valor: 'pedidos', rotulo: 'Pedidos' }, { valor: 'loja', rotulo: 'Loja online' }]}
          />
          {aba === 'pedidos' && (
            <>
              <label className="flex items-center gap-1.5 ml-1 text-xs font-medium text-[var(--text-muted)]">
                Origem
                <select className={classeCampo} value={filtroOrigem} onChange={(e) => setFiltroOrigem(e.target.value)}>
                  <option value="">Todas</option>
                  {Object.entries(ORIGEM_PEDIDO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                Entrega
                <select className={classeCampo} value={filtroEntrega} onChange={(e) => setFiltroEntrega(e.target.value)}>
                  <option value="">Todas</option>
                  <option value="RETIRADA">Retirada</option>
                  <option value="ENTREGA">Entrega</option>
                </select>
              </label>
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                <RefreshCw size={13} aria-hidden="true" /> Atualiza sozinho a cada 30 s
              </span>
              {linkLoja && (
                <a href={linkLoja} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--primary)] hover:underline">
                  Abrir minha loja <ExternalLink size={13} aria-hidden="true" />
                </a>
              )}
            </>
          )}
        </BarraFerramentas>
      </div>

      <ColunasPagina lateral={lateral || undefined}>
        {conteudo}
      </ColunasPagina>

      {!larga && (
        <Drawer isOpen={Boolean(selecionado)} onClose={() => setSelecionado(null)} title="Pedido">
          {detalhe(false)}
        </Drawer>
      )}

      <VenderWhatsappModal
        isOpen={modalWhats}
        onClose={() => setModalWhats(false)}
        onCriado={(p) => { carregar(); if (p?.id) setSelecionado(p.id); }}
        pedeCpf={pedeCpf}
      />
    </Pagina>
  );
}
