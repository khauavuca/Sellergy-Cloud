// /pedido/:token — acompanhamento do pedido pelo cliente (link do WhatsApp).
// Mostra o Pix (QR + copia e cola) enquanto espera o pagamento e atualiza
// sozinho a cada 15 s ate o pagamento cair.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, Package, XCircle, Loader2, Copy, ExternalLink, Store, Bike } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { Button } from '../components/ui';
import { fmtBRL, fmtQuando, copiarTexto } from '../components/pedidos/util';

const INTERVALO_MS = 15000;

const PASSOS = [
  { status: 'NOVO', titulo: 'Pedido recebido' },
  { status: 'AGUARDANDO_PAGAMENTO', titulo: 'Esperando o pagamento' },
  { status: 'PAGO', titulo: 'Pago · separando' },
  { status: 'ENTREGUE', titulo: 'Entregue' },
];

export default function PedidoPublicoPage() {
  const { token } = useParams();
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [naoAchou, setNaoAchou] = useState(false);
  const [erroRede, setErroRede] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(() => api.get(`/publico/loja/pedido/${token}`)
    .then((r) => { setDados(r.data); setErroRede(false); })
    .catch((e) => (e.response?.status === 404 ? setNaoAchou(true) : setErroRede(true)))
    .finally(() => setCarregando(false)), [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const esperando = dados?.pedido?.status === 'NOVO' || dados?.pedido?.status === 'AGUARDANDO_PAGAMENTO';
  useEffect(() => {
    if (!esperando) return undefined;
    const t = setInterval(carregar, INTERVALO_MS);
    return () => clearInterval(t);
  }, [esperando, carregar]);

  const copiar = async () => {
    if (await copiarTexto(dados.pagamento.pixCopiaECola)) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    }
  };

  if (carregando) {
    return <div className="min-h-screen grid place-items-center bg-[var(--bg-app)]"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;
  }
  if (naoAchou || !dados) {
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--bg-app)] px-4">
        <div className="text-center max-w-sm">
          <Package className="mx-auto text-[var(--text-muted)]" />
          <h1 className="text-lg font-semibold text-[var(--text-main)] mt-3">{erroRede ? 'Não conseguimos abrir o pedido' : 'Pedido não encontrado'}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{erroRede ? 'Confira sua internet e tente de novo.' : 'Confira o link que chegou no seu WhatsApp.'}</p>
          {erroRede && <Button className="mt-4 min-h-11" onClick={carregar}>Tentar de novo</Button>}
        </div>
      </div>
    );
  }

  const { negocio, pedido, pagamento } = dados;
  const cancelado = pedido.status === 'CANCELADO';
  const indiceAtual = PASSOS.findIndex((p) => p.status === pedido.status);

  return (
    <div className="min-h-screen bg-[var(--bg-app)]">
      <div className="max-w-xl mx-auto px-4 py-8 space-y-5">
        <header className="flex items-center gap-3">
          {negocio.logo && <img src={negocio.logo} alt="" className="w-11 h-11 rounded-xl object-cover" />}
          <div>
            <p className="text-sm text-[var(--text-muted)]">{negocio.nome}</p>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-main)]">Pedido #{pedido.numero}</h1>
          </div>
        </header>

        {cancelado ? (
          <div role="status" className="flex items-start gap-3 p-4 rounded-2xl bg-[var(--danger-soft)]">
            <XCircle className="text-[var(--danger)] shrink-0" />
            <div>
              <p className="font-semibold text-[var(--danger-text)]">Pedido cancelado</p>
              <p className="text-sm text-[var(--danger-text)]">Se ainda quiser, é só fazer um pedido novo ou chamar a loja no WhatsApp.</p>
            </div>
          </div>
        ) : (
          <ol className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4 space-y-3" aria-label="Andamento do pedido">
            {PASSOS.map((p, i) => {
              const feito = i < indiceAtual || pedido.status === 'ENTREGUE';
              const atual = i === indiceAtual && pedido.status !== 'ENTREGUE';
              const titulo = p.status === 'ENTREGUE' && pedido.entrega === 'RETIRADA' ? 'Retirado' : p.titulo;
              return (
                <li key={p.status} className="flex items-center gap-3" aria-current={atual ? 'step' : undefined}>
                  {feito ? <CheckCircle2 size={20} className="text-[var(--success)] shrink-0" />
                    : atual ? <Clock size={20} className="text-[var(--warning)] shrink-0" />
                      : <span className="w-5 h-5 rounded-full border-2 border-[var(--border-strong)] shrink-0" aria-hidden="true" />}
                  <span className={clsx('text-sm', feito || atual ? 'font-semibold text-[var(--text-main)]' : 'text-[var(--text-muted)]')}>{titulo}</span>
                  {p.status === 'NOVO' && <span className="ml-auto text-xs text-[var(--text-muted)]">{fmtQuando(pedido.criadoEm)}</span>}
                  {p.status === 'PAGO' && pedido.pagoEm && <span className="ml-auto text-xs text-[var(--text-muted)]">{fmtQuando(pedido.pagoEm)}</span>}
                  {p.status === 'ENTREGUE' && pedido.entregueEm && <span className="ml-auto text-xs text-[var(--text-muted)]">{fmtQuando(pedido.entregueEm)}</span>}
                </li>
              );
            })}
          </ol>
        )}

        {pedido.status === 'NOVO' && (
          <p className="text-sm text-[var(--text-secondary)]">Oi, {pedido.primeiroNome}! A loja está conferindo seu pedido e manda o Pix no seu WhatsApp. Esta página atualiza sozinha.</p>
        )}

        {pagamento && (
          <section className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4 space-y-3">
            <h2 className="text-base font-semibold text-[var(--text-main)]">Pague {fmtBRL(pedido.total)}</h2>
            {pagamento.qrCodeImagem && (
              <img src={pagamento.qrCodeImagem} alt="QR Code do Pix" className="w-56 h-56 mx-auto rounded-lg bg-white p-2" />
            )}
            {pagamento.pixCopiaECola && (
              <>
                <p className="text-xs text-[var(--text-muted)] text-center">Abra o app do banco, escolha Pix e leia o QR, ou copie o código.</p>
                <Button variant="primary" size="lg" fullWidth icon={Copy} onClick={copiar}>{copiado ? 'Copiado!' : 'Copiar Pix copia e cola'}</Button>
              </>
            )}
            {pagamento.link && (
              <a href={pagamento.link} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 min-h-11 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-main)] bg-[var(--bg-card)]">
                <ExternalLink size={16} /> {pagamento.pixCopiaECola ? 'Pagar de outro jeito' : 'Abrir página de pagamento'}
              </a>
            )}
            <p className="text-xs text-[var(--text-muted)] text-center" role="status">Assim que o pagamento cair, esta página muda sozinha.</p>
          </section>
        )}

        {pedido.status === 'PAGO' && (
          <p className="text-sm text-[var(--text-secondary)]">Pagamento confirmado! {pedido.entrega === 'ENTREGA' ? 'Já estamos separando para a entrega.' : 'Avisamos no WhatsApp quando puder retirar.'}</p>
        )}

        <section className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)]">
          <ul>
            {pedido.itens.map((i, idx) => (
              <li key={idx} className="flex justify-between gap-3 px-4 py-3 border-t border-[var(--border-subtle)] first:border-t-0 text-sm">
                <span className="text-[var(--text-main)]">{i.quantidade}× {i.nome}</span>
                <span className="tabular-nums text-[var(--text-secondary)]">{fmtBRL(i.subtotal)}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3 border-t border-[var(--border-main)] space-y-1 text-sm">
            <div className="flex items-center gap-2 text-[var(--text-secondary)]">
              {pedido.entrega === 'ENTREGA' ? <Bike size={14} /> : <Store size={14} />}
              <span className="flex-1">{pedido.entrega === 'ENTREGA' ? `Entrega${pedido.endereco ? ` · ${pedido.endereco}` : ''}` : 'Retirar no local'}</span>
              <span className="tabular-nums">{fmtBRL(pedido.frete)}</span>
            </div>
            <div className="flex justify-between font-semibold text-base text-[var(--text-main)] pt-1"><span>Total</span><span className="tabular-nums">{fmtBRL(pedido.total)}</span></div>
          </div>
        </section>

        {negocio.slug && (
          <Link to={`/loja/${negocio.slug}`} className="block text-center text-sm font-semibold text-[var(--text-secondary)] min-h-11 leading-[44px]">Voltar à loja</Link>
        )}
      </div>
    </div>
  );
}
