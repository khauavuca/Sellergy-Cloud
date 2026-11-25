// "Tudo deste cliente" na ficha do CRM: a conversa do WhatsApp, os horarios,
// as vendas, os pedidos, os pacotes e as cobrancas ligados a ele (o vinculo e
// pelo telefone, regra em backend/src/clientesFinais/porTelefone.js).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CreditCard, MessageCircle, Package, ShoppingBag, Ticket } from 'lucide-react';
import api from '../../services/api';

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataCurta = (v) => (v ? new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
const diaHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

const STATUS_AG = { PENDING: 'pendente', CONFIRMED: 'confirmado', COMPLETED: 'concluído', CANCELLED: 'cancelado', NO_SHOW: 'faltou' };
const STATUS_COB = { PENDENTE: 'aguardando', PAGO: 'pago', CANCELADO: 'cancelado', EXPIRADO: 'expirado' };

function Bloco({ icone: Icone, titulo, children, acao }) {
  return (
    <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
      <div className="flex items-center gap-2 mb-1.5">
        <Icone size={14} className="text-[var(--text-muted)]" aria-hidden="true" />
        <span className="text-xs font-semibold text-[var(--text-muted)] flex-1">{titulo}</span>
        {acao}
      </div>
      {children}
    </div>
  );
}

function Linha({ esquerda, direita, sub }) {
  return (
    <li className="flex justify-between gap-2 text-[13px] py-0.5">
      <span className="min-w-0 truncate text-[var(--text-secondary)]">{esquerda}{sub ? <span className="text-[var(--text-muted)]"> · {sub}</span> : null}</span>
      <span className="shrink-0 font-semibold text-[var(--text-main)] tabular-nums">{direita}</span>
    </li>
  );
}

export default function VinculosCliente({ lead }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(false);
  const leadId = lead?.id;
  const versao = lead?.atualizadoEm;

  useEffect(() => {
    if (!leadId) return undefined;
    let vivo = true;
    api.get(`/crm/leads/${leadId}/vinculos`)
      .then((r) => { if (vivo) { setDados(r.data); setErro(false); } })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [leadId, versao]);

  if (erro) return null;
  if (!dados) return <div className="px-4 py-3 border-b border-[var(--border-subtle)]"><div className="h-14 rounded-lg bg-[var(--bg-subtle)] animate-pulse" /></div>;

  const agendar = `/app/agenda?${new URLSearchParams({ novo: '1', leadId: lead.id, nome: lead.nome || '', telefone: lead.telefone || '' })}`;
  const linkAcao = 'text-xs font-semibold text-[var(--primary)] hover:underline';

  return (
    <div aria-label="Tudo deste cliente">
      <div className="grid grid-cols-2 border-b border-[var(--border-subtle)]">
        <div className="px-4 py-2.5 border-r border-[var(--border-subtle)]">
          <div className="text-xs text-[var(--text-muted)]">Já gastou</div>
          <div className="text-[15px] font-bold text-[var(--text-main)] tabular-nums">{brl(dados.totalGasto)}</div>
        </div>
        <div className="px-4 py-2.5">
          <div className="text-xs text-[var(--text-muted)]">Compras</div>
          <div className="text-[15px] font-bold text-[var(--text-main)] tabular-nums">{dados.qtdVendas}</div>
        </div>
      </div>

      <Bloco icone={MessageCircle} titulo="WhatsApp"
        acao={dados.conversa ? <Link to={`/app/whatsapp?c=${dados.conversa.id}`} className={linkAcao}>Abrir conversa</Link> : null}>
        {dados.conversa ? (
          <p className="m-0 text-[13px] text-[var(--text-secondary)] truncate">
            {dados.conversa.naoLidas > 0 && <b className="text-[var(--primary)]">{dados.conversa.naoLidas} nova{dados.conversa.naoLidas > 1 ? 's' : ''} · </b>}
            {dados.conversa.ultimaMensagemTexto || 'Sem mensagens'}
            <span className="text-[var(--text-muted)]"> · {diaHora(dados.conversa.ultimaMensagemEm)}</span>
          </p>
        ) : <p className="m-0 text-[13px] text-[var(--text-muted)]">Ainda não conversou pelo WhatsApp.</p>}
      </Bloco>

      <Bloco icone={CalendarDays} titulo="Horários" acao={<Link to={agendar} className={linkAcao}>Agendar</Link>}>
        {dados.proximos.length + dados.passados.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--text-muted)]">Nenhum horário ainda.</p>
        ) : (
          <ul className="m-0 p-0 list-none">
            {dados.proximos.map((a) => <Linha key={a.id} esquerda={diaHora(a.data)} sub={[a.servico, STATUS_AG[a.status]].filter(Boolean).join(' · ')} direita="próximo" />)}
            {dados.passados.slice(0, 3).map((a) => <Linha key={a.id} esquerda={dataCurta(a.data)} sub={[a.servico, STATUS_AG[a.status]].filter(Boolean).join(' · ')} direita={a.preco ? brl(a.preco) : ''} />)}
          </ul>
        )}
      </Bloco>

      {dados.vendas.length > 0 && (
        <Bloco icone={ShoppingBag} titulo="Vendas">
          <ul className="m-0 p-0 list-none">
            {dados.vendas.map((v) => <Linha key={v.id} esquerda={`#${v.numero}`} sub={dataCurta(v.data)} direita={brl(v.valor)} />)}
          </ul>
        </Bloco>
      )}

      {dados.pedidos.length > 0 && (
        <Bloco icone={Package} titulo="Pedidos">
          <ul className="m-0 p-0 list-none">
            {dados.pedidos.map((p) => <Linha key={p.id} esquerda={`#${p.numero}`} sub={`${dataCurta(p.criadoEm)} · ${String(p.status).toLowerCase().replace(/_/g, ' ')}`} direita={brl(p.total)} />)}
          </ul>
        </Bloco>
      )}

      {dados.pacotes.length > 0 && (
        <Bloco icone={Ticket} titulo="Pacotes">
          <ul className="m-0 p-0 list-none">
            {dados.pacotes.map((p) => <Linha key={p.id} esquerda={`${p.sessoesUsadas}/${p.sessoesTotal} sessões`} sub={`até ${dataCurta(p.validoAte)}`} direita={String(p.status).toLowerCase()} />)}
          </ul>
        </Bloco>
      )}

      {dados.cobrancas.length > 0 && (
        <Bloco icone={CreditCard} titulo="Cobranças">
          <ul className="m-0 p-0 list-none">
            {dados.cobrancas.map((c) => <Linha key={c.id} esquerda={`${c.metodo === 'LINK' ? 'Link' : 'Pix'} · ${dataCurta(c.criadoEm)}`} sub={STATUS_COB[c.status] || c.status} direita={brl(c.valor)} />)}
          </ul>
        </Bloco>
      )}
    </div>
  );
}
