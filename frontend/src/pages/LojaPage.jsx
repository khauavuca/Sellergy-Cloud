// /loja/:slug — catalogo online publico (sem login). Frente B da fase 2.
// O cliente monta a sacola e manda o pedido; o preco que vale e o do
// servidor (o navegador so manda produto + quantidade).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ShoppingBag, Plus, Minus, Store, Bike, AlertCircle, Loader2, ArrowLeft, ImageOff } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { Button, Input, Textarea } from '../components/ui';
import { fmtBRL, mascaraTelefone, mascaraCpf, erroDaApi } from '../components/pedidos/util';

const chaveSacola = (slug) => `loja:${slug}:sacola`;

function lerSacola(slug) {
  try {
    const bruto = sessionStorage.getItem(chaveSacola(slug));
    const obj = bruto ? JSON.parse(bruto) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function Qtd({ valor, onMenos, onMais, max, nome }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={onMenos} aria-label={`Tirar um ${nome}`} className="w-11 h-11 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] grid place-items-center text-[var(--text-main)]">
        <Minus size={16} />
      </button>
      <span className="w-8 text-center text-sm font-semibold tabular-nums text-[var(--text-main)]" aria-live="polite">{valor}</span>
      <button type="button" onClick={onMais} disabled={valor >= max} aria-label={`Mais um ${nome}`} className="w-11 h-11 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] grid place-items-center text-[var(--text-main)] disabled:opacity-40">
        <Plus size={16} />
      </button>
    </div>
  );
}

export default function LojaPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [carregando, setCarregando] = useState(true);
  const [indisponivel, setIndisponivel] = useState(false);
  const [erroCarga, setErroCarga] = useState(false);
  const [loja, setLoja] = useState(null);
  const [categoria, setCategoria] = useState('');
  const [sacola, setSacola] = useState(() => lerSacola(slug));
  const [tela, setTela] = useState('loja');
  const [entrega, setEntrega] = useState('RETIRADA');
  const [form, setForm] = useState({ nome: '', telefone: '', cpf: '', endereco: '', observacao: '' });
  const [campos, setCampos] = useState([]);
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.get(`/publico/loja/${slug}`)
      .then((r) => {
        setLoja(r.data);
        setEntrega(r.data.entrega.aceitaRetirada ? 'RETIRADA' : 'ENTREGA');
      })
      .catch((e) => (e.response?.status === 404 ? setIndisponivel(true) : setErroCarga(true)))
      .finally(() => setCarregando(false));
  }, [slug]);

  useEffect(() => {
    try { sessionStorage.setItem(chaveSacola(slug), JSON.stringify(sacola)); } catch { /* sem storage: segue sem lembrar */ }
  }, [slug, sacola]);

  // Mapa variacaoId -> { variacao, produto } so com o que ainda esta na vitrine.
  const indice = useMemo(() => {
    const m = new Map();
    for (const p of loja?.produtos || []) for (const v of p.variacoes) m.set(v.id, { v, p });
    return m;
  }, [loja]);

  const linhas = Object.entries(sacola)
    .map(([id, q]) => ({ id, q, item: indice.get(id) }))
    .filter((l) => l.item && l.q > 0);
  const qtdItens = linhas.reduce((t, l) => t + l.q, 0);
  const subtotal = linhas.reduce((t, l) => t + l.q * l.item.v.preco, 0);
  const frete = entrega === 'ENTREGA' ? Number(loja?.entrega.freteEntrega || 0) : 0;
  const total = subtotal + frete;
  const minimo = loja?.entrega.pedidoMinimo || 0;
  const faltaMinimo = minimo > 0 && subtotal < minimo ? minimo - subtotal : 0;

  const definirQtd = (id, q, max) => {
    setSacola((s) => {
      const nova = { ...s };
      const limitado = Math.max(0, Math.min(q, max ?? 99));
      if (limitado <= 0) delete nova[id];
      else nova[id] = limitado;
      return nova;
    });
  };

  const visiveis = (loja?.produtos || []).filter((p) => !categoria || p.categoria === categoria);

  const enviar = async (e) => {
    e.preventDefault();
    setErro(null);
    setCampos([]);
    setEnviando(true);
    try {
      const r = await api.post(`/publico/loja/${slug}/pedidos`, {
        itens: linhas.map((l) => ({ variacaoId: l.id, quantidade: l.q })),
        entrega,
        endereco: entrega === 'ENTREGA' ? form.endereco : undefined,
        nome: form.nome,
        telefone: form.telefone,
        cpf: loja.pedeCpf ? form.cpf : undefined,
        observacao: form.observacao || undefined,
      });
      try { sessionStorage.removeItem(chaveSacola(slug)); } catch { /* ok */ }
      navigate(`/pedido/${r.data.token}`);
    } catch (err) {
      setErro(erroDaApi(err, 'Não foi possível enviar o pedido. Tente de novo.'));
      setCampos(err.response?.data?.campos || []);
      // Estoque mudou: ajusta a sacola pro que ainda tem.
      for (const s of err.response?.data?.semEstoque || []) definirQtd(s.variacaoId, s.disponivel, s.disponivel);
    } finally {
      setEnviando(false);
    }
  };

  if (carregando) {
    return <div className="min-h-screen grid place-items-center bg-[var(--bg-app)]"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;
  }

  if (indisponivel || erroCarga || !loja) {
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--bg-app)] px-4">
        <div className="text-center max-w-sm">
          <Store className="mx-auto text-[var(--text-muted)]" />
          <h1 className="text-lg font-semibold text-[var(--text-main)] mt-3">{erroCarga ? 'Não conseguimos abrir a loja' : 'Loja indisponível'}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {erroCarga ? 'Confira sua internet e tente de novo.' : 'Esta loja não está recebendo pedidos online agora. Fale com o estabelecimento pelo WhatsApp.'}
          </p>
          {erroCarga && <Button className="mt-4 min-h-11" onClick={() => window.location.reload()}>Tentar de novo</Button>}
        </div>
      </div>
    );
  }

  const { negocio } = loja;
  const textoEntrega = [
    loja.entrega.aceitaRetirada ? 'Retire no local' : null,
    loja.entrega.aceitaEntrega ? `receba em casa${loja.entrega.freteEntrega ? ` (${fmtBRL(loja.entrega.freteEntrega)})` : ''}` : null,
  ].filter(Boolean).join(' ou ');

  return (
    <div className="min-h-screen bg-[var(--bg-app)] pb-28">
      <div className="max-w-3xl mx-auto px-4 pt-6">
        <header className="flex items-center gap-3">
          {negocio.logo
            ? <img src={negocio.logo} alt="" className="w-12 h-12 rounded-xl object-cover" />
            : <div className="w-12 h-12 rounded-xl grid place-items-center bg-[var(--primary)] text-[var(--text-on-primary)] font-bold" aria-hidden="true">{negocio.nome.slice(0, 2).toUpperCase()}</div>}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-main)] truncate">{negocio.nome}</h1>
            <p className="text-sm text-[var(--text-muted)] first-letter:uppercase">{textoEntrega}</p>
          </div>
        </header>

        {tela === 'loja' && (
          <>
            {loja.categorias.length > 1 && (
              <nav aria-label="Categorias" className="flex gap-2 overflow-x-auto mt-5 pb-1 -mx-4 px-4">
                {['', ...loja.categorias].map((c) => (
                  <button
                    key={c || 'tudo'}
                    type="button"
                    aria-pressed={categoria === c}
                    onClick={() => setCategoria(c)}
                    className={clsx(
                      'shrink-0 min-h-11 px-4 rounded-full border text-sm font-semibold',
                      categoria === c ? 'bg-[var(--primary)] text-[var(--text-on-primary)] border-[var(--primary)]' : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-strong)]',
                    )}
                  >
                    {c || 'Tudo'}
                  </button>
                ))}
              </nav>
            )}

            {visiveis.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] mt-10 text-center">Nenhum produto disponível agora.</p>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                {visiveis.map((p) => (
                  <li key={p.id} className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] overflow-hidden flex flex-col">
                    {p.imagemUrl
                      ? <img src={p.imagemUrl} alt={p.nome} loading="lazy" className="aspect-square w-full object-cover bg-[var(--bg-subtle)]" />
                      : <div className="aspect-square w-full grid place-items-center bg-[var(--bg-subtle)] text-[var(--text-muted)]" aria-hidden="true"><ImageOff size={22} /></div>}
                    <div className="p-3 flex flex-col gap-2 flex-1">
                      <div>
                        <p className="text-xs text-[var(--text-muted)]">{p.categoria}</p>
                        <h2 className="text-sm font-semibold text-[var(--text-main)] leading-snug">{p.nome}</h2>
                        {p.descricao && <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">{p.descricao}</p>}
                      </div>
                      <div className="mt-auto space-y-2">
                        {p.variacoes.map((v) => {
                          const q = sacola[v.id] || 0;
                          const rotulo = p.variacoes.length > 1 ? v.rotulo : null;
                          return (
                            <div key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                              <span className="min-w-0">
                                {rotulo && <span className="block text-xs text-[var(--text-secondary)] truncate">{rotulo}</span>}
                                <span className="block text-sm font-semibold tabular-nums text-[var(--text-main)]">{fmtBRL(v.preco)}</span>
                              </span>
                              {!v.disponivel ? (
                                <span className="text-xs font-semibold text-[var(--text-muted)]">Esgotado</span>
                              ) : q > 0 ? (
                                <Qtd valor={q} max={v.maximo} nome={v.nome} onMenos={() => definirQtd(v.id, q - 1, v.maximo)} onMais={() => definirQtd(v.id, q + 1, v.maximo)} />
                              ) : (
                                <button type="button" onClick={() => definirQtd(v.id, 1, v.maximo)} aria-label={`Pôr ${v.nome} na sacola`} className="w-11 h-11 shrink-0 rounded-lg grid place-items-center bg-[var(--primary)] text-[var(--text-on-primary)]">
                                  <Plus size={18} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tela === 'sacola' && (
          <form onSubmit={enviar} className="mt-5 space-y-5" noValidate>
            <button type="button" onClick={() => setTela('loja')} className="inline-flex items-center gap-1 min-h-11 text-sm font-semibold text-[var(--text-secondary)]">
              <ArrowLeft size={16} /> Continuar comprando
            </button>
            <section className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)]">
              <h2 className="px-4 pt-4 text-base font-semibold text-[var(--text-main)]">Sua sacola</h2>
              {linhas.length === 0 ? (
                <p className="p-4 text-sm text-[var(--text-muted)]">A sacola está vazia.</p>
              ) : (
                <ul>
                  {linhas.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 px-4 py-3 border-t border-[var(--border-subtle)] first:border-t-0">
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-[var(--text-main)]">{l.item.v.nome}</span>
                        <span className="block text-xs text-[var(--text-muted)] tabular-nums">{fmtBRL(l.item.v.preco * l.q)}</span>
                      </span>
                      <Qtd valor={l.q} max={l.item.v.maximo} nome={l.item.v.nome} onMenos={() => definirQtd(l.id, l.q - 1, l.item.v.maximo)} onMais={() => definirQtd(l.id, l.q + 1, l.item.v.maximo)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-[var(--text-main)] mb-2">Como quer receber?</legend>
              {loja.entrega.aceitaRetirada && (
                <label className={clsx('flex items-center gap-3 p-3 min-h-11 rounded-xl border cursor-pointer', entrega === 'RETIRADA' ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)] bg-[var(--bg-card)]')}>
                  <input type="radio" name="entrega" value="RETIRADA" checked={entrega === 'RETIRADA'} onChange={() => setEntrega('RETIRADA')} />
                  <Store size={16} className="text-[var(--text-muted)]" />
                  <span className="text-sm text-[var(--text-main)]">Retirar no local · grátis</span>
                </label>
              )}
              {loja.entrega.aceitaEntrega && (
                <label className={clsx('flex items-center gap-3 p-3 min-h-11 rounded-xl border cursor-pointer', entrega === 'ENTREGA' ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)] bg-[var(--bg-card)]')}>
                  <input type="radio" name="entrega" value="ENTREGA" checked={entrega === 'ENTREGA'} onChange={() => setEntrega('ENTREGA')} />
                  <Bike size={16} className="text-[var(--text-muted)]" />
                  <span className="text-sm text-[var(--text-main)]">Entrega · {loja.entrega.freteEntrega ? fmtBRL(loja.entrega.freteEntrega) : 'grátis'}</span>
                </label>
              )}
            </fieldset>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-[var(--text-main)]">Seus dados</h2>
              <Input label="Nome" aria-label="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoComplete="name" error={campos.includes('nome') ? 'Digite seu nome.' : undefined} required />
              <Input label="WhatsApp" aria-label="WhatsApp" type="tel" inputMode="tel" placeholder="(11) 98888-7777" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: mascaraTelefone(e.target.value) })} autoComplete="tel" hint="O Pix e as novidades do pedido chegam por aqui." error={campos.includes('telefone') ? 'Confira o número com DDD.' : undefined} required />
              {loja.pedeCpf && (
                <Input label="CPF" aria-label="CPF" inputMode="numeric" placeholder="000.000.000-00" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: mascaraCpf(e.target.value) })} hint="Pedido pelo banco para gerar o Pix no seu nome." error={campos.includes('cpf') ? 'CPF inválido.' : undefined} required />
              )}
              {entrega === 'ENTREGA' && (
                <Input label="Endereço de entrega" aria-label="Endereço de entrega" placeholder="Rua, número, bairro" value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} autoComplete="street-address" error={campos.includes('endereco') ? 'Informe rua, número e bairro.' : undefined} required />
              )}
              <Textarea label="Observação (opcional)" aria-label="Observação" rows={2} maxLength={300} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
            </section>

            <section className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4 space-y-1.5 text-sm">
              <div className="flex justify-between text-[var(--text-secondary)]"><span>Produtos</span><span className="tabular-nums">{fmtBRL(subtotal)}</span></div>
              {entrega === 'ENTREGA' && <div className="flex justify-between text-[var(--text-secondary)]"><span>Entrega</span><span className="tabular-nums">{fmtBRL(frete)}</span></div>}
              <div className="flex justify-between font-semibold text-[var(--text-main)] text-base pt-1"><span>Total</span><span className="tabular-nums">{fmtBRL(total)}</span></div>
              {faltaMinimo > 0 && <p className="text-xs text-[var(--warning-text)]">O pedido mínimo é {fmtBRL(minimo)}. Faltam {fmtBRL(faltaMinimo)}.</p>}
            </section>

            {erro && (
              <div role="alert" className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[var(--danger-soft)]">
                <AlertCircle size={16} className="text-[var(--danger)] mt-0.5 shrink-0" />
                <p className="text-sm text-[var(--danger-text)]">{erro}</p>
              </div>
            )}
            <p className="text-xs text-[var(--text-muted)]">O pedido chega para {negocio.nome}. Eles conferem e mandam o Pix no seu WhatsApp.</p>
            <Button type="submit" size="lg" fullWidth loading={enviando} disabled={linhas.length === 0 || faltaMinimo > 0}>
              Enviar pedido · {fmtBRL(total)}
            </Button>
          </form>
        )}
      </div>

      {tela === 'loja' && (
        <div className="fixed bottom-0 inset-x-0 p-3 bg-[var(--bg-app)] border-t border-[var(--border-main)]">
          <div className="max-w-3xl mx-auto">
            {qtdItens > 0 ? (
              <Button size="lg" fullWidth icon={ShoppingBag} onClick={() => { setTela('sacola'); window.scrollTo(0, 0); }}>
                Ver sacola · {qtdItens} {qtdItens === 1 ? 'item' : 'itens'} · {fmtBRL(subtotal)}
              </Button>
            ) : (
              <p className="text-center text-sm text-[var(--text-muted)] py-3">Toque no + para montar o pedido</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
