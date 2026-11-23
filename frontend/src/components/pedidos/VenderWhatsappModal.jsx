// "Vender pelo WhatsApp": monta o pedido na mao (cliente + produtos) e manda
// o link de pagamento no WhatsApp do cliente. O total final e o do servidor.
import { useEffect, useRef, useState } from 'react';
import { Search, Plus, Minus, Trash2, Send, CheckCircle2, Copy, AlertCircle, UserRound, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import api from '../../services/api';
import Modal from '../Modal';
import { Button, Input, useToast } from '../ui';
import { fmtBRL, mascaraTelefone, mascaraCpf, erroDaApi, copiarTexto } from './util';

const VAZIO = { leadId: null, nome: '', telefone: '', cpf: '', entrega: 'RETIRADA', endereco: '', frete: '' };

export default function VenderWhatsappModal({ isOpen, onClose, onCriado, pedeCpf }) {
  const toast = useToast();
  const [form, setForm] = useState(VAZIO);
  const [itens, setItens] = useState([]);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [clientes, setClientes] = useState([]);
  const [buscaProduto, setBuscaProduto] = useState('');
  const [produtos, setProdutos] = useState([]);
  const [carregandoProdutos, setCarregandoProdutos] = useState(false);
  const [erro, setErro] = useState(null);
  const [campos, setCampos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState(null);
  const temporizador = useRef(null);

  const fechar = () => {
    setForm(VAZIO); setItens([]); setBuscaCliente(''); setClientes([]); setBuscaProduto('');
    setErro(null); setCampos([]); setFeito(null);
    onClose();
  };

  // Busca de produtos (com atraso curto pra nao bater a cada tecla).
  useEffect(() => {
    if (!isOpen) return undefined;
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => {
      setCarregandoProdutos(true);
      api.get('/pedidos/produtos', { params: { busca: buscaProduto || undefined } })
        .then((r) => setProdutos(r.data))
        .catch(() => setProdutos([]))
        .finally(() => setCarregandoProdutos(false));
    }, 250);
    return () => clearTimeout(temporizador.current);
  }, [isOpen, buscaProduto]);

  useEffect(() => {
    if (!isOpen || buscaCliente.trim().length < 2 || form.leadId) return undefined;
    const t = setTimeout(() => {
      api.get('/pedidos/clientes', { params: { busca: buscaCliente } })
        .then((r) => setClientes(r.data))
        .catch(() => setClientes([]));
    }, 250);
    return () => clearTimeout(t);
  }, [isOpen, buscaCliente, form.leadId]);

  const escolherCliente = (c) => {
    setForm((f) => ({ ...f, leadId: c.id, nome: c.nome, telefone: mascaraTelefone(c.telefone || ''), cpf: '' }));
    setClientes([]);
    setBuscaCliente('');
  };

  const adicionar = (p) => {
    setItens((lista) => {
      const ja = lista.find((i) => i.variacaoId === p.variacaoId);
      if (ja) return lista.map((i) => (i.variacaoId === p.variacaoId ? { ...i, quantidade: Math.min(i.quantidade + 1, 99) } : i));
      return [...lista, { ...p, quantidade: 1 }];
    });
  };
  const mudarQtd = (id, q) => setItens((lista) => (q <= 0 ? lista.filter((i) => i.variacaoId !== id) : lista.map((i) => (i.variacaoId === id ? { ...i, quantidade: Math.min(q, 99) } : i))));

  const subtotal = itens.reduce((t, i) => t + i.preco * i.quantidade, 0);
  const freteNum = form.entrega === 'ENTREGA' && form.frete.trim() ? Number(form.frete.replace(',', '.')) || 0 : 0;
  const primeiro = (form.nome || '').trim().split(/\s+/)[0];

  const enviar = async (e) => {
    e.preventDefault();
    setErro(null);
    setCampos([]);
    setEnviando(true);
    try {
      const r = await api.post('/pedidos', {
        leadId: form.leadId || undefined,
        nome: form.nome,
        telefone: form.telefone,
        cpf: form.cpf || undefined,
        itens: itens.map((i) => ({ variacaoId: i.variacaoId, quantidade: i.quantidade })),
        entrega: form.entrega,
        endereco: form.entrega === 'ENTREGA' ? form.endereco : undefined,
        frete: form.entrega === 'ENTREGA' && form.frete.trim() ? freteNum : undefined,
      });
      setFeito(r.data);
      onCriado?.(r.data.pedido);
    } catch (err) {
      setErro(erroDaApi(err, 'Não foi possível criar o pedido.'));
      setCampos(err.response?.data?.campos || []);
      if (err.response?.data?.pedidoId) onCriado?.(null);
    } finally {
      setEnviando(false);
    }
  };

  const copiarLink = async () => {
    if (await copiarTexto(feito.link)) toast.success('Link copiado.');
  };

  return (
    <Modal isOpen={isOpen} onClose={fechar} title="Vender pelo WhatsApp" description="Monte o pedido e mande o link de pagamento. Quando o cliente pagar, o pedido anda sozinho e o estoque baixa." size="lg">
      {feito ? (
        <div className="space-y-4 text-center py-2">
          <CheckCircle2 size={40} className="mx-auto text-[var(--success)]" />
          <p className="text-base text-[var(--text-main)]">
            {feito.whatsapp?.ok === false ? 'Pedido criado' : 'Enviado'}. O pedido <b>#{feito.pedido.numero}</b> entrou em <b>Aguardando pagamento</b>.
          </p>
          {feito.whatsapp?.ok === false && (
            <p className="text-sm text-[var(--warning-text)]">O WhatsApp não mandou a mensagem agora. Copie o link e envie você mesmo.</p>
          )}
          <div className="text-left rounded-xl bg-[var(--bg-subtle)] p-3 text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">{feito.mensagem}</div>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button variant="secondary" icon={Copy} onClick={copiarLink} className="min-h-11">Copiar link do pedido</Button>
            <Button onClick={fechar} className="min-h-11">Ok</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={enviar} className="space-y-5" noValidate>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-main)]">Cliente</h3>
            {form.leadId ? (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border-main)]">
                <UserRound size={18} className="text-[var(--text-muted)]" />
                <span className="flex-1 min-w-0 text-sm text-[var(--text-main)]">{form.nome} · {form.telefone || 'sem telefone'}</span>
                <button type="button" className="min-h-11 px-2 text-sm font-semibold text-[var(--text-secondary)] underline" onClick={() => setForm({ ...VAZIO, entrega: form.entrega, endereco: form.endereco, frete: form.frete })}>Trocar</button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Input icon={Search} aria-label="Buscar cliente cadastrado" placeholder="Buscar cliente cadastrado (nome ou telefone)" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} />
                  {clientes.length > 0 && buscaCliente.trim().length >= 2 && (
                    <ul className="absolute z-10 mt-1 w-full rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] shadow-[var(--shadow-md)] max-h-56 overflow-auto">
                      {clientes.map((c) => (
                        <li key={c.id}>
                          <button type="button" onClick={() => escolherCliente(c)} className="w-full text-left px-3 min-h-11 text-sm hover:bg-[var(--bg-subtle)] text-[var(--text-main)]">
                            {c.nome} <span className="text-[var(--text-muted)]">· {c.telefone || 'sem telefone'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Input label="Nome" aria-label="Nome do cliente" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} error={campos.includes('nome') ? 'Digite o nome.' : undefined} />
                  <Input label="WhatsApp" aria-label="WhatsApp do cliente" type="tel" inputMode="tel" placeholder="(11) 98888-7777" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: mascaraTelefone(e.target.value) })} error={campos.includes('telefone') ? 'Confira o número com DDD.' : undefined} />
                </div>
              </>
            )}
            {pedeCpf && (
              <Input label="CPF do cliente" aria-label="CPF do cliente" inputMode="numeric" placeholder={form.leadId ? 'Deixe vazio se já está no cadastro' : '000.000.000-00'} value={form.cpf} onChange={(e) => setForm({ ...form, cpf: mascaraCpf(e.target.value) })} hint="O Asaas pede o CPF de quem paga." error={campos.includes('cpf') ? 'CPF inválido ou faltando.' : undefined} />
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-main)]">Produtos</h3>
            <Input icon={Search} aria-label="Buscar produto" placeholder="Buscar produto" value={buscaProduto} onChange={(e) => setBuscaProduto(e.target.value)} />
            <div className="max-h-44 overflow-auto rounded-xl border border-[var(--border-main)]">
              {carregandoProdutos ? (
                <div className="p-4 grid place-items-center"><Loader2 size={18} className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>
              ) : produtos.length === 0 ? (
                <p className="p-3 text-sm text-[var(--text-muted)]">Nenhum produto ativo encontrado.</p>
              ) : (
                <ul>
                  {produtos.map((p) => (
                    <li key={p.variacaoId} className="flex items-center gap-3 px-3 py-1.5 border-t border-[var(--border-subtle)] first:border-t-0">
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-[var(--text-main)] truncate">{p.nome}</span>
                        <span className={clsx('block text-xs tabular-nums', p.estoque > 0 ? 'text-[var(--text-muted)]' : 'text-[var(--danger-text)]')}>{fmtBRL(p.preco)} · {p.estoque > 0 ? `${p.estoque} em estoque` : 'sem estoque'}</span>
                      </span>
                      <button type="button" onClick={() => adicionar(p)} disabled={p.estoque <= 0} aria-label={`Adicionar ${p.nome}`} className="w-11 h-11 rounded-lg grid place-items-center bg-[var(--primary)] text-[var(--text-on-primary)] disabled:opacity-30">
                        <Plus size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {itens.length > 0 && (
              <ul className="rounded-xl border border-[var(--border-main)]">
                {itens.map((i) => (
                  <li key={i.variacaoId} className="flex items-center gap-2 px-3 py-2 border-t border-[var(--border-subtle)] first:border-t-0">
                    <span className="flex-1 min-w-0 text-sm text-[var(--text-main)] truncate">{i.nome}</span>
                    <button type="button" aria-label={`Tirar um ${i.nome}`} onClick={() => mudarQtd(i.variacaoId, i.quantidade - 1)} className="w-11 h-11 rounded-lg border border-[var(--border-strong)] grid place-items-center">{i.quantidade === 1 ? <Trash2 size={14} /> : <Minus size={14} />}</button>
                    <span className="w-6 text-center text-sm font-semibold tabular-nums">{i.quantidade}</span>
                    <button type="button" aria-label={`Mais um ${i.nome}`} onClick={() => mudarQtd(i.variacaoId, i.quantidade + 1)} disabled={i.quantidade >= i.estoque} className="w-11 h-11 rounded-lg border border-[var(--border-strong)] grid place-items-center disabled:opacity-30"><Plus size={14} /></button>
                    <span className="w-24 text-right text-sm tabular-nums text-[var(--text-secondary)]">{fmtBRL(i.preco * i.quantidade)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Entrega">
              {[['RETIRADA', 'Retira no local'], ['ENTREGA', 'Entrega']].map(([v, t]) => (
                <button key={v} type="button" role="radio" aria-checked={form.entrega === v} onClick={() => setForm({ ...form, entrega: v })}
                  className={clsx('min-h-11 px-4 rounded-full border text-sm font-semibold', form.entrega === v ? 'bg-[var(--primary)] text-[var(--text-on-primary)] border-[var(--primary)]' : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-strong)]')}>
                  {t}
                </button>
              ))}
            </div>
            {form.entrega === 'ENTREGA' && (
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2"><Input label="Endereço" aria-label="Endereço de entrega" placeholder="Rua, número, bairro" value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} error={campos.includes('endereco') ? 'Informe rua, número e bairro.' : undefined} /></div>
                <Input label="Frete (R$)" aria-label="Frete em reais" inputMode="decimal" placeholder="Padrão da loja" value={form.frete} onChange={(e) => setForm({ ...form, frete: e.target.value })} />
              </div>
            )}
          </section>

          <div className="flex items-center justify-between text-base font-semibold text-[var(--text-main)]">
            <span>Total</span>
            <span className="tabular-nums">{fmtBRL(subtotal + freteNum)}{form.entrega === 'ENTREGA' && !form.frete.trim() ? ' + frete' : ''}</span>
          </div>

          {erro && (
            <div role="alert" className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[var(--danger-soft)]">
              <AlertCircle size={16} className="text-[var(--danger)] mt-0.5 shrink-0" />
              <p className="text-sm text-[var(--danger-text)]">{erro}</p>
            </div>
          )}

          <Button type="submit" size="lg" fullWidth icon={Send} loading={enviando} disabled={itens.length === 0 || !form.nome.trim() || form.telefone.replace(/\D/g, '').length < 10}>
            {primeiro ? `Enviar no WhatsApp de ${primeiro}` : 'Enviar no WhatsApp'}
          </Button>
        </form>
      )}
    </Modal>
  );
}
