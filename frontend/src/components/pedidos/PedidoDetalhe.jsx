// Detalhe de um pedido no /app/pedidos, com as acoes de cada passo.
// Vai na coluna da direita (tela larga) ou na gaveta (tela estreita).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Wallet, XCircle, Truck, Store, RotateCw, Copy, Loader2, AlertCircle, CheckCircle2, MessageCircle, X } from 'lucide-react';
import clsx from 'clsx';
import api from '../../services/api';
import { Badge, Button, IconButton, Select, useToast } from '../ui';
import ConfirmarAcao from '../conta/ConfirmarAcao';
import { fmtBRL, fmtQuando, STATUS_PEDIDO, mascaraTelefone, erroDaApi, copiarTexto } from './util';

const METODOS = [
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'PIX', label: 'Pix (direto na conta)' },
  { value: 'DEBITO', label: 'Cartão de débito' },
  { value: 'CREDITO', label: 'Cartão de crédito' },
];
const ROTULO_METODO = { DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Cartão de débito', CREDITO: 'Cartão de crédito' };
const ORIGEM_LONGA = { CATALOGO: 'Pela loja online', WHATSAPP: 'Venda pelo WhatsApp', BALCAO: 'No balcão' };
const ORIGEM_HIST = { CATALOGO: 'feito na loja online', WHATSAPP: 'montado pelo WhatsApp', BALCAO: 'lançado no balcão' };
const PROXIMO_PASSO = {
  NOVO: 'Aceitar o pedido',
  AGUARDANDO_PAGAMENTO: 'Esperar o pagamento cair',
  PAGO: 'Separar e entregar (ou aguardar a retirada)',
};

const iniciais = (nome) => String(nome || '').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

function Linha({ rotulo, valor, forte = false, muted = false }) {
  return (
    <div className={clsx('flex flex-wrap justify-between gap-x-3 gap-y-1 px-4 py-2 border-b border-[var(--border-subtle)] text-[13px]', forte ? 'font-bold text-[var(--text-main)]' : 'text-[var(--text-secondary)]')}>
      <span className={clsx('min-w-0 [overflow-wrap:anywhere]', muted && 'text-[var(--text-muted)]')}>{rotulo}</span>
      <span className={clsx('tabular-nums', !forte && 'font-semibold text-[var(--text-main)]')}>{valor}</span>
    </div>
  );
}

export default function PedidoDetalhe({ pedidoId, podeEditar, onMudou, onFechar }) {
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

  const botaoFechar = onFechar && (
    <IconButton icon={X} size="sm" ariaLabel="Fechar pedido" onClick={onFechar} />
  );

  if (erro) {
    return (
      <div className="flex items-start gap-2 p-4">
        <div role="alert" className="flex-1 flex items-start gap-2 text-sm text-[var(--danger-text)]"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{erro}</div>
        {botaoFechar}
      </div>
    );
  }
  if (!pedido) return <div className="p-10 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;

  const st = STATUS_PEDIDO[pedido.status] || STATUS_PEDIDO.NOVO;
  const telDigitos = String(pedido.telefone || '').replace(/\D/g, '');
  const wa = telDigitos ? `https://wa.me/${telDigitos.length <= 11 ? `55${telDigitos}` : telDigitos}` : null;
  const historico = [
    { quando: pedido.criadoEm, texto: `Pedido ${ORIGEM_HIST[pedido.origem] || 'criado'}`, cor: 'var(--info)' },
    pedido.cobranca ? { quando: pedido.cobranca.criadoEm, texto: `Cobrança ${pedido.cobranca.metodo === 'PIX' ? 'Pix' : 'por link'} enviada`, cor: 'var(--warning)' } : null,
    pedido.pagoEm ? { quando: pedido.pagoEm, texto: pedido.venda ? `Pago${pedido.venda.metodoPagamento ? ` (${pedido.venda.metodoPagamento.toLowerCase()})` : ''} · venda #${pedido.venda.numero}` : 'Pago', cor: 'var(--success)' } : null,
    pedido.entregueEm ? { quando: pedido.entregueEm, texto: pedido.entrega === 'ENTREGA' ? 'Saiu pra entrega' : 'Retirado', cor: 'var(--text-secondary)' } : null,
    pedido.canceladoEm ? { quando: pedido.canceladoEm, texto: 'Cancelado', cor: 'var(--danger)' } : null,
    PROXIMO_PASSO[pedido.status] ? { quando: null, texto: PROXIMO_PASSO[pedido.status], pendente: true } : null,
  ].filter(Boolean);
  const comoPagou = pedido.venda?.metodoPagamento
    ? ROTULO_METODO[pedido.venda.metodoPagamento] || pedido.venda.metodoPagamento.toLowerCase()
    : pedido.cobranca
      ? `${pedido.cobranca.metodo === 'PIX' ? 'Pix' : 'Link de pagamento'} · enviado ${fmtQuando(pedido.cobranca.criadoEm)}`
      : pedido.status === 'CANCELADO' ? 'Não pago' : 'Cobrança ainda não enviada';
  const ocupado = Boolean(acao);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3.5 border-b border-[var(--border-subtle)]">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-bold tracking-tight text-[var(--text-main)]">Pedido #{pedido.numero}</h2>
          <p className="m-0 mt-0.5 text-xs text-[var(--text-muted)]">{ORIGEM_LONGA[pedido.origem] || pedido.origem} · {fmtQuando(pedido.criadoEm)}</p>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant={st.variante}>{st.rotulo}</Badge>
          {botaoFechar}
        </div>
      </div>

      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border-subtle)]">
        <span className="w-[38px] h-[38px] rounded-full grid place-items-center shrink-0 bg-[var(--success-soft)] text-[var(--success-text)] text-[13px] font-bold" aria-hidden="true">{iniciais(pedido.nomeCliente)}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-[var(--text-main)] truncate">{pedido.nomeCliente}</div>
          <div className="text-xs text-[var(--text-muted)]">{mascaraTelefone(pedido.telefone)}</div>
        </div>
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] font-semibold text-[var(--text-main)] hover:bg-[var(--bg-subtle)] shrink-0"
          >
            <MessageCircle size={14} aria-hidden="true" />Conversar
          </a>
        )}
      </div>

      <div className="px-4 pt-3 pb-1 text-xs font-medium text-[var(--text-muted)]">Itens</div>
      <ul className="m-0 p-0 list-none">
        {(pedido.itens || []).map((i, idx) => (
          <li key={idx}><Linha rotulo={`${i.quantidade}× ${i.nome}`} valor={fmtBRL(i.subtotal)} /></li>
        ))}
      </ul>
      <Linha
        muted
        rotulo={(
          <span className="inline-flex items-center gap-1.5">
            {pedido.entrega === 'ENTREGA' ? <Truck size={14} aria-hidden="true" /> : <Store size={14} aria-hidden="true" />}
            {pedido.entrega === 'ENTREGA' ? `Entrega${pedido.endereco ? ` · ${pedido.endereco}` : ''}` : 'Retira no local'}
          </span>
        )}
        valor={fmtBRL(pedido.frete)}
      />
      <Linha forte rotulo="Total" valor={fmtBRL(pedido.total)} />
      <Linha muted rotulo="Como pagou" valor={<span className="font-medium">{comoPagou}</span>} />

      {pedido.observacao && (
        <p className="mx-4 mt-3 mb-0 px-3 py-2.5 rounded-lg bg-[var(--bg-subtle)] text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap">
          <b className="text-[var(--text-main)]">Observação:</b> {pedido.observacao}
        </p>
      )}

      <div className="px-4 pt-3 pb-1 text-xs font-medium text-[var(--text-muted)]">Histórico</div>
      <ol className="m-0 px-4 pb-3 list-none" aria-label="Histórico">
        {historico.map((h, i) => (
          <li key={i} className="relative flex gap-2.5 pb-2.5 last:pb-0 text-[13px]">
            {i < historico.length - 1 && <span className="absolute left-[4px] top-3.5 bottom-0 w-px bg-[var(--border-main)]" aria-hidden="true" />}
            <span
              className={clsx('relative mt-1 w-[9px] h-[9px] rounded-full shrink-0', h.pendente && 'border border-[var(--border-strong)] bg-[var(--bg-card)]')}
              style={h.pendente ? undefined : { background: h.cor }}
              aria-hidden="true"
            />
            <span className="w-[86px] shrink-0 text-xs tabular-nums text-[var(--text-muted)] pt-px">{h.pendente ? 'Próximo' : fmtQuando(h.quando)}</span>
            <span className={clsx('min-w-0', h.pendente ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]')}>{h.texto}</span>
          </li>
        ))}
      </ol>

      {(podeEditar && ['NOVO', 'AGUARDANDO_PAGAMENTO', 'PAGO'].includes(pedido.status)) || pedido.venda ? (
        <div className="flex flex-col gap-2 p-4 border-t border-[var(--border-subtle)]">
          {podeEditar && pedido.status === 'NOVO' && (
            <>
              <Button fullWidth icon={Send} loading={acao === 'aceitar'} disabled={ocupado} onClick={() => executar('aceitar', 'aceitar', null, 'Pix enviado no WhatsApp do cliente.')}>Aceitar e mandar Pix no WhatsApp</Button>
              <Button fullWidth variant="secondary" icon={Wallet} disabled={ocupado} onClick={() => setModal('pago')}>Marcar como pago</Button>
              <Button fullWidth variant="danger-soft" icon={XCircle} disabled={ocupado} onClick={() => setModal('cancelar')}>Recusar pedido</Button>
            </>
          )}
          {podeEditar && pedido.status === 'AGUARDANDO_PAGAMENTO' && (
            <>
              <p className="m-0 text-xs text-[var(--text-muted)]">Esperando o cliente pagar. Quando o pagamento cair, o pedido vai sozinho para “Pago · separar”.</p>
              <Button fullWidth icon={Wallet} disabled={ocupado} onClick={() => setModal('pago')}>Marcar como pago</Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" icon={RotateCw} loading={acao === 'reenviar'} disabled={ocupado} onClick={() => executar('reenviar', 'reenviar', null, 'Cobrança reenviada.')}>Reenviar cobrança</Button>
                <Button variant="secondary" size="sm" icon={Copy} onClick={async () => (await copiarTexto(pedido.linkPublico)) && toast.success('Link copiado.')}>Copiar link</Button>
              </div>
              <Button fullWidth variant="danger-soft" icon={XCircle} disabled={ocupado} onClick={() => setModal('cancelar')}>Cancelar pedido</Button>
            </>
          )}
          {podeEditar && pedido.status === 'PAGO' && (
            <Button fullWidth icon={pedido.entrega === 'ENTREGA' ? Truck : Store} loading={acao === 'entregar'} disabled={ocupado} onClick={() => executar('entregar', 'entregar', null, 'Cliente avisado.')}>
              {pedido.entrega === 'ENTREGA' ? 'Saiu pra entrega e avisar cliente' : 'Marcar como retirado'}
            </Button>
          )}
          {pedido.venda && (
            <p className="m-0 flex items-start gap-2 text-[13px] text-[var(--success-text)] bg-[var(--success-soft)] rounded-lg p-3">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>Venda #{pedido.venda.numero} lançada no caixa e estoque baixado. <Link to="/app/vendas" className="underline font-semibold">Ver vendas</Link></span>
            </p>
          )}
        </div>
      ) : null}

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
