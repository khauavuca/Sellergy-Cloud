// Detalhe de um pedido no /app/pedidos, com as acoes de cada passo.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Wallet, XCircle, Truck, Store, RotateCw, Copy, Loader2, AlertCircle, CheckCircle2, MessageCircle } from 'lucide-react';
import api from '../../services/api';
import { Badge, Button, Select, useToast } from '../ui';
import ConfirmarAcao from '../conta/ConfirmarAcao';
import { fmtBRL, fmtQuando, STATUS_PEDIDO, ORIGEM_PEDIDO, mascaraTelefone, erroDaApi, copiarTexto } from './util';

const METODOS = [
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'PIX', label: 'Pix (direto na conta)' },
  { value: 'DEBITO', label: 'Cartão de débito' },
  { value: 'CREDITO', label: 'Cartão de crédito' },
];

export default function PedidoDetalhe({ pedidoId, podeEditar, onMudou }) {
  const toast = useToast();
  const [pedido, setPedido] = useState(null);
  const [erro, setErro] = useState(null);
  const [acao, setAcao] = useState(null);
  const [modal, setModal] = useState(null);
  const [metodo, setMetodo] = useState('DINHEIRO');

  const carregar = () => api.get(`/pedidos/${pedidoId}`)
    .then((r) => { setPedido(r.data); setErro(null); })
    .catch((e) => setErro(erroDaApi(e, 'Não foi possível abrir o pedido.')));

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega so quando troca o pedido
  }, [pedidoId]);

  const executar = async (nome, rota, corpo, sucesso) => {
    setAcao(nome);
    try {
      const r = await api.post(`/pedidos/${pedidoId}/${rota}`, corpo || {});
      if (r.data?.whatsapp && r.data.whatsapp.ok === false) {
        toast.error('Cobrança criada, mas o WhatsApp não mandou agora. Copie o link e envie.');
      } else if (sucesso) {
        toast.success(sucesso);
      }
      await carregar();
      onMudou?.();
      return true;
    } catch (e) {
      toast.error(erroDaApi(e));
      await carregar();
      onMudou?.();
      return false;
    } finally {
      setAcao(null);
    }
  };

  if (erro) {
    return <div role="alert" className="flex items-start gap-2 p-4 text-sm text-[var(--danger-text)]"><AlertCircle size={16} className="mt-0.5" />{erro}</div>;
  }
  if (!pedido) return <div className="p-10 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;

  const st = STATUS_PEDIDO[pedido.status] || STATUS_PEDIDO.NOVO;
  const telDigitos = String(pedido.telefone || '').replace(/\D/g, '');
  const wa = telDigitos ? `https://wa.me/${telDigitos.length <= 11 ? `55${telDigitos}` : telDigitos}` : null;
  const historico = [
    { quando: pedido.criadoEm, texto: `Pedido ${pedido.origem === 'CATALOGO' ? 'feito na loja online' : 'montado pelo WhatsApp'}` },
    pedido.cobranca ? { quando: pedido.cobranca.criadoEm, texto: `Cobrança ${pedido.cobranca.metodo === 'PIX' ? 'Pix' : 'por link'} enviada` } : null,
    pedido.pagoEm ? { quando: pedido.pagoEm, texto: pedido.venda ? `Pago${pedido.venda.metodoPagamento ? ` (${pedido.venda.metodoPagamento.toLowerCase()})` : ''} · venda #${pedido.venda.numero}` : 'Pago' } : null,
    pedido.entregueEm ? { quando: pedido.entregueEm, texto: pedido.entrega === 'ENTREGA' ? 'Saiu pra entrega' : 'Retirado' } : null,
    pedido.canceladoEm ? { quando: pedido.canceladoEm, texto: 'Cancelado' } : null,
  ].filter(Boolean);
  const ocupado = Boolean(acao);

  return (
    <div className="p-5 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-[var(--text-main)]">Pedido #{pedido.numero}</h2>
        <Badge variant={st.variante}>{st.rotulo}</Badge>
      </div>
      <p className="text-sm text-[var(--text-secondary)] -mt-3">
        {pedido.nomeCliente} · {mascaraTelefone(pedido.telefone)} · {ORIGEM_PEDIDO[pedido.origem] || pedido.origem}
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 underline min-h-11 align-middle"><MessageCircle size={14} />Conversar</a>}
      </p>

      <div className="rounded-xl border border-[var(--border-main)]">
        <ul>
          {(pedido.itens || []).map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3 px-4 py-2.5 border-t border-[var(--border-subtle)] first:border-t-0 text-sm">
              <span className="text-[var(--text-main)]">{i.quantidade}× {i.nome}</span>
              <span className="tabular-nums text-[var(--text-secondary)]">{fmtBRL(i.subtotal)}</span>
            </li>
          ))}
        </ul>
        <div className="px-4 py-2.5 border-t border-[var(--border-main)] text-sm space-y-1">
          <div className="flex justify-between text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5">{pedido.entrega === 'ENTREGA' ? <Truck size={14} /> : <Store size={14} />}{pedido.entrega === 'ENTREGA' ? `Entrega${pedido.endereco ? ` · ${pedido.endereco}` : ''}` : 'Retira no local'}</span>
            <span className="tabular-nums">{fmtBRL(pedido.frete)}</span>
          </div>
          <div className="flex justify-between font-semibold text-[var(--text-main)]"><span>Total</span><span className="tabular-nums">{fmtBRL(pedido.total)}</span></div>
        </div>
      </div>

      {pedido.observacao && <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap"><b className="text-[var(--text-main)]">Observação:</b> {pedido.observacao}</p>}

      <ol className="space-y-1.5 text-sm" aria-label="Histórico">
        {historico.map((h, i) => (
          <li key={i} className="flex gap-2 text-[var(--text-secondary)]"><span className="tabular-nums text-[var(--text-muted)] shrink-0">{fmtQuando(h.quando)}</span><span>· {h.texto}</span></li>
        ))}
      </ol>

      {podeEditar && (
        <div className="flex flex-col gap-2">
          {pedido.status === 'NOVO' && (
            <>
              <Button size="lg" icon={Send} loading={acao === 'aceitar'} disabled={ocupado} onClick={() => executar('aceitar', 'aceitar', null, 'Pix enviado no WhatsApp do cliente.')}>Aceitar e mandar Pix no WhatsApp</Button>
              <Button variant="secondary" icon={Wallet} disabled={ocupado} className="min-h-11" onClick={() => setModal('pago')}>Marcar como pago</Button>
              <Button variant="danger-soft" icon={XCircle} disabled={ocupado} className="min-h-11" onClick={() => setModal('cancelar')}>Recusar pedido</Button>
            </>
          )}
          {pedido.status === 'AGUARDANDO_PAGAMENTO' && (
            <>
              <p className="text-sm text-[var(--text-muted)]">Esperando o cliente pagar. Quando o pagamento cair, o pedido vai sozinho para "Pago · separar".</p>
              <Button variant="secondary" icon={RotateCw} loading={acao === 'reenviar'} disabled={ocupado} className="min-h-11" onClick={() => executar('reenviar', 'reenviar', null, 'Cobrança reenviada.')}>Reenviar cobrança</Button>
              <Button variant="secondary" icon={Copy} className="min-h-11" onClick={async () => (await copiarTexto(pedido.linkPublico)) && toast.success('Link copiado.')}>Copiar link do pedido</Button>
              <Button variant="secondary" icon={Wallet} disabled={ocupado} className="min-h-11" onClick={() => setModal('pago')}>Marcar como pago</Button>
              <Button variant="danger-soft" icon={XCircle} disabled={ocupado} className="min-h-11" onClick={() => setModal('cancelar')}>Cancelar pedido</Button>
            </>
          )}
          {pedido.status === 'PAGO' && (
            <Button size="lg" icon={pedido.entrega === 'ENTREGA' ? Truck : Store} loading={acao === 'entregar'} disabled={ocupado} onClick={() => executar('entregar', 'entregar', null, 'Cliente avisado.')}>
              {pedido.entrega === 'ENTREGA' ? 'Saiu pra entrega e avisar cliente' : 'Marcar como retirado'}
            </Button>
          )}
        </div>
      )}

      {pedido.venda && (
        <p className="flex items-start gap-2 text-sm text-[var(--success-text)] bg-[var(--success-soft)] rounded-xl p-3">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>Venda #{pedido.venda.numero} lançada no caixa e estoque baixado. <Link to="/app/vendas" className="underline font-semibold">Ver vendas</Link></span>
        </p>
      )}

      <ConfirmarAcao
        isOpen={modal === 'pago'}
        onClose={() => setModal(null)}
        titulo={`Marcar o pedido #${pedido.numero} como pago`}
        rotuloConfirmar="Confirmar pagamento"
        variante="primary"
        onConfirmar={async () => {
          const ok = await executar('pago', 'pago', { metodoPagamento: metodo }, 'Pago! Venda lançada e estoque baixado.');
          if (ok) setModal(null);
          return ok;
        }}
      >
        <p className="text-sm text-[var(--text-secondary)] mb-3">Use quando o cliente pagou fora do link (dinheiro na retirada, por exemplo). A venda entra no caixa e o estoque baixa.</p>
        <Select label="Como pagou" aria-label="Como pagou" value={metodo} onChange={(e) => setMetodo(e.target.value)} options={METODOS} placeholder="" />
      </ConfirmarAcao>

      <ConfirmarAcao
        isOpen={modal === 'cancelar'}
        onClose={() => setModal(null)}
        titulo={pedido.status === 'NOVO' ? `Recusar o pedido #${pedido.numero}` : `Cancelar o pedido #${pedido.numero}`}
        rotuloConfirmar={pedido.status === 'NOVO' ? 'Recusar pedido' : 'Cancelar pedido'}
        pedirMotivo
        rotuloMotivo="Motivo (vai na mensagem pro cliente)"
        onConfirmar={async (motivo) => {
          const ok = await executar('cancelar', 'cancelar', { motivo }, 'Pedido cancelado e cliente avisado.');
          if (ok) setModal(null);
          return ok;
        }}
      >
        <p className="text-sm text-[var(--text-secondary)]">O estoque não muda (só baixa quando o pedido é pago).</p>
      </ConfirmarAcao>
    </div>
  );
}
