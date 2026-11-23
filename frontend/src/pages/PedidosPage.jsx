// /app/pedidos — frente B da fase 2.
// Quadro dos pedidos da loja online e das vendas pelo WhatsApp (Novos,
// Aguardando pagamento, Pago · separar, Entregue), detalhe com as acoes,
// "Vender pelo WhatsApp" e a aba "Loja online" (ligar/configurar/link).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, MessageCircle, Lock, AlertCircle, Loader2, RotateCw } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { Button, Drawer, EmptyState, Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui';
import { usePermissao, useEhAdminOuDono } from '../hooks/usePermissao';
import PedidoDetalhe from '../components/pedidos/PedidoDetalhe';
import LojaOnlineConfig from '../components/pedidos/LojaOnlineConfig';
import VenderWhatsappModal from '../components/pedidos/VenderWhatsappModal';
import { fmtBRL, fmtQuando, resumoItens, ORIGEM_PEDIDO, erroDaApi } from '../components/pedidos/util';

const COLUNAS = [
  { status: 'NOVO', titulo: 'Novos' },
  { status: 'AGUARDANDO_PAGAMENTO', titulo: 'Aguardando pagamento' },
  { status: 'PAGO', titulo: 'Pago · separar' },
  { status: 'ENTREGUE', titulo: 'Entregue' },
];
const ATUALIZAR_MS = 30000;

function useTelaLarga() {
  const consulta = '(min-width: 1024px)';
  const [larga, setLarga] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(consulta).matches : true));
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const aoMudar = () => setLarga(mq.matches);
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);
  return larga;
}

export default function PedidosPage() {
  const [params, setParams] = useSearchParams();
  const [aba, setAba] = useState(params.get('aba') === 'loja' ? 'loja' : 'pedidos');
  const [pedidos, setPedidos] = useState([]);
  const [diasHistorico, setDiasHistorico] = useState(7);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [semPlano, setSemPlano] = useState(false);
  const [selecionado, setSelecionado] = useState(null);
  const [verCancelados, setVerCancelados] = useState(false);
  const [modalWhats, setModalWhats] = useState(params.get('novo') === 'whatsapp');
  const [pedeCpf, setPedeCpf] = useState(false);
  const larga = useTelaLarga();
  const podeCriar = usePermissao('VENDAS', 'criar');
  const podeEditar = usePermissao('VENDAS', 'editar');
  const ehDono = useEhAdminOuDono();

  const carregar = useCallback(() => api.get('/pedidos')
    .then((r) => { setPedidos(r.data.pedidos); setDiasHistorico(r.data.diasHistorico); setErro(null); })
    .catch((e) => {
      if (e.response?.data?.codigo === 'PLANO_SEM_RECURSO') setSemPlano(true);
      else setErro(erroDaApi(e, 'Não foi possível carregar os pedidos.'));
    })
    .finally(() => setCarregando(false)), []);

  useEffect(() => {
    carregar();
    api.get('/pedidos/loja').then((r) => setPedeCpf(r.data.provedorPagamento === 'ASAAS')).catch(() => {});
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

  const porColuna = useMemo(() => {
    const m = Object.fromEntries(COLUNAS.map((c) => [c.status, []]));
    for (const p of pedidos) if (m[p.status]) m[p.status].push(p);
    return m;
  }, [pedidos]);
  const cancelados = pedidos.filter((p) => p.status === 'CANCELADO');

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

  const cartao = (p) => (
    <li key={p.id}>
      <button
        type="button"
        onClick={() => setSelecionado(p.id)}
        aria-pressed={selecionado === p.id}
        className={clsx(
          'w-full text-left rounded-xl border bg-[var(--bg-card)] p-3 min-h-11 transition-colors',
          selecionado === p.id ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : 'border-[var(--border-main)] hover:border-[var(--border-strong)]',
        )}
      >
        <span className="flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-[var(--text-main)] truncate">#{p.numero} · {p.nomeCliente}</span>
          <span className="text-xs text-[var(--text-muted)] shrink-0">{fmtQuando(p.criadoEm)}</span>
        </span>
        <span className="block text-xs text-[var(--text-secondary)] mt-1 truncate">{resumoItens(p.itens)}</span>
        <span className="flex items-center justify-between mt-2">
          <span className="text-sm font-semibold tabular-nums text-[var(--text-main)]">{fmtBRL(p.total)}</span>
          <span className="text-xs text-[var(--text-muted)]">{ORIGEM_PEDIDO[p.origem] || p.origem}</span>
        </span>
      </button>
    </li>
  );

  const detalhe = selecionado && (
    <PedidoDetalhe key={selecionado} pedidoId={selecionado} podeEditar={podeEditar} onMudou={carregar} />
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Pedidos</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Da loja online e das vendas pelo WhatsApp</p>
        </div>
        {podeCriar && (
          <Button icon={MessageCircle} className="min-h-11" onClick={() => setModalWhats(true)}>Vender pelo WhatsApp</Button>
        )}
      </div>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
          <TabsTrigger value="loja">Loja online</TabsTrigger>
        </TabsList>

        <TabsContent value="pedidos" className="pt-4">
          {carregando ? (
            <div className="py-16 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>
          ) : erro ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 p-4 rounded-xl bg-[var(--danger-soft)] text-sm text-[var(--danger-text)]">
              <AlertCircle size={16} /> {erro}
              <Button variant="secondary" icon={RotateCw} className="ml-auto min-h-11" onClick={() => { setCarregando(true); carregar(); }}>Tentar de novo</Button>
            </div>
          ) : pedidos.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Nenhum pedido ainda"
              description="Ligue a loja online na aba ao lado e mande o link pros clientes, ou monte um pedido em “Vender pelo WhatsApp”."
              action={<Button variant="secondary" className="min-h-11" onClick={() => setAba('loja')}>Configurar loja online</Button>}
            />
          ) : (
            <div className={clsx('grid gap-4', selecionado && larga && 'lg:grid-cols-[1fr_420px]')}>
              <div className="space-y-4 min-w-0">
                <div className="flex flex-wrap gap-3">
                  {COLUNAS.map((c) => (
                    <section key={c.status} aria-label={c.titulo} className="flex-1 basis-56 min-w-0 rounded-2xl bg-[var(--bg-subtle)] p-2.5">
                      <h2 className="flex items-center justify-between px-1 pb-2 text-sm font-semibold text-[var(--text-main)]">
                        {c.titulo}
                        <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">{porColuna[c.status].length}</span>
                      </h2>
                      {porColuna[c.status].length === 0
                        ? <p className="px-1 pb-2 text-xs text-[var(--text-muted)]">Nada aqui.</p>
                        : <ul className="space-y-2">{porColuna[c.status].map(cartao)}</ul>}
                    </section>
                  ))}
                </div>
                <p className="text-xs text-[var(--text-muted)]">Entregues e cancelados ficam aqui por {diasHistorico} dias. Pedido sem pagamento é cancelado sozinho depois de 24 horas.</p>
                {cancelados.length > 0 && (
                  <div>
                    <button type="button" className="min-h-11 text-sm font-semibold text-[var(--text-secondary)] underline" aria-expanded={verCancelados} onClick={() => setVerCancelados((v) => !v)}>
                      {verCancelados ? 'Esconder' : 'Ver'} cancelados ({cancelados.length})
                    </button>
                    {verCancelados && <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">{cancelados.map(cartao)}</ul>}
                  </div>
                )}
              </div>
              {selecionado && larga && (
                <aside className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] self-start lg:sticky lg:top-4">
                  <div className="flex justify-end px-3 pt-2">
                    <button type="button" className="min-h-11 px-3 text-sm text-[var(--text-muted)]" onClick={() => setSelecionado(null)}>Fechar</button>
                  </div>
                  {detalhe}
                </aside>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="loja" className="pt-4">
          <LojaOnlineConfig podeEditar={ehDono} />
        </TabsContent>
      </Tabs>

      {!larga && (
        <Drawer isOpen={Boolean(selecionado)} onClose={() => setSelecionado(null)} title="Pedido">
          {detalhe}
        </Drawer>
      )}

      <VenderWhatsappModal
        isOpen={modalWhats}
        onClose={() => setModalWhats(false)}
        onCriado={(p) => { carregar(); if (p?.id) setSelecionado(p.id); }}
        pedeCpf={pedeCpf}
      />
    </div>
  );
}
