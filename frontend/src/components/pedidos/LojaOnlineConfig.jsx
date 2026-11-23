// Aba "Loja online" do /app/pedidos: liga/desliga, entrega, frete, minimo e link.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, ExternalLink, Loader2, AlertCircle, Store } from 'lucide-react';
import api from '../../services/api';
import clsx from 'clsx';
import { Button, Card, Input, useToast } from '../ui';
import { erroDaApi, copiarTexto } from './util';

// Interruptor com area de toque de 44 px (o Switch do design system tem 24 px).
function Interruptor({ checked, onChange, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="min-w-11 min-h-11 grid place-items-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className={clsx('relative w-11 h-6 rounded-full transition-colors', checked ? 'bg-[var(--primary)]' : 'bg-[var(--border-strong)]')}>
        <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform', checked && 'translate-x-5')} />
      </span>
    </button>
  );
}

function Linha({ titulo, descricao, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-t border-[var(--border-subtle)] first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--text-main)]">{titulo}</p>
        {descricao && <p className="text-xs text-[var(--text-muted)] mt-0.5">{descricao}</p>}
      </div>
      {children}
    </div>
  );
}

export default function LojaOnlineConfig({ podeEditar }) {
  const toast = useToast();
  const [loja, setLoja] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({ freteEntrega: '', pedidoMinimo: '' });
  const [slug, setSlug] = useState('');
  const [salvandoSlug, setSalvandoSlug] = useState(false);

  const aplicar = useCallback((dados) => {
    setLoja(dados);
    setForm({
      freteEntrega: dados.freteEntrega === null || dados.freteEntrega === undefined ? '' : String(dados.freteEntrega).replace('.', ','),
      pedidoMinimo: dados.pedidoMinimo === null || dados.pedidoMinimo === undefined ? '' : String(dados.pedidoMinimo).replace('.', ','),
    });
  }, []);

  const carregar = useCallback(() => api.get('/pedidos/loja')
    .then((r) => { aplicar(r.data); setErro(null); })
    .catch((e) => setErro(erroDaApi(e, 'Não foi possível carregar a loja online.'))), [aplicar]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const salvar = async (mudanca) => {
    setSalvando(true);
    try {
      const r = await api.put('/pedidos/loja', mudanca);
      aplicar(r.data);
      toast.success('Loja online atualizada.');
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível salvar.'));
    } finally {
      setSalvando(false);
    }
  };

  const valor = (t) => (t.trim() === '' ? null : Number(t.replace(/\./g, '').replace(',', '.')));

  const salvarValores = (e) => {
    e.preventDefault();
    const frete = valor(form.freteEntrega);
    const minimo = valor(form.pedidoMinimo);
    if ((frete !== null && !(frete >= 0)) || (minimo !== null && !(minimo >= 0))) {
      toast.error('Use só números, como 12,00.');
      return;
    }
    salvar({ freteEntrega: frete, pedidoMinimo: minimo });
  };

  const salvarSlug = async (e) => {
    e.preventDefault();
    setSalvandoSlug(true);
    try {
      await api.put('/conta/configuracoes', { slugPublico: slug });
      await carregar();
      toast.success('Endereço salvo.');
    } catch (err) {
      toast.error(erroDaApi(err, 'Não foi possível salvar o endereço.'));
    } finally {
      setSalvandoSlug(false);
    }
  };

  const copiar = async () => {
    if (await copiarTexto(loja.link)) toast.success('Link copiado.');
    else toast.error('Não deu pra copiar. Selecione o link e copie.');
  };

  if (erro) {
    return (
      <div role="alert" className="flex items-start gap-2 p-4 rounded-xl bg-[var(--danger-soft)] text-sm text-[var(--danger-text)]">
        <AlertCircle size={16} className="mt-0.5 shrink-0" /> {erro}
        <button type="button" className="ml-auto underline min-h-11" onClick={carregar}>Tentar de novo</button>
      </div>
    );
  }
  if (!loja) return <div className="py-10 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;

  const desabilitado = !podeEditar || salvando;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card padding="md">
        <div className="flex items-start gap-3">
          <Store size={20} className="text-[var(--text-muted)] mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-main)]">Sua loja na internet</h2>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">Os clientes escolhem os produtos e o pedido cai aqui. Só aparece o que está ativo e tem estoque.</p>
          </div>
        </div>

        <div className="mt-4">
          <Linha titulo={loja.online ? 'Loja no ar' : 'Loja fora do ar'} descricao={loja.online ? 'Recebendo pedidos.' : 'Ninguém consegue abrir o link.'}>
            <Interruptor checked={loja.online} onChange={(v) => salvar({ online: v })} disabled={desabilitado} ariaLabel="Loja no ar" />
          </Linha>
          <Linha titulo="Retirada no local" descricao="O cliente busca e paga antes ou na hora.">
            <Interruptor checked={loja.aceitaRetirada} onChange={(v) => salvar({ aceitaRetirada: v })} disabled={desabilitado} ariaLabel="Aceita retirada" />
          </Linha>
          <Linha titulo="Entrega" descricao="Você leva até o cliente (motoboy, Correios...).">
            <Interruptor checked={loja.aceitaEntrega} onChange={(v) => salvar({ aceitaEntrega: v })} disabled={desabilitado} ariaLabel="Faz entrega" />
          </Linha>
        </div>

        <form onSubmit={salvarValores} className="grid sm:grid-cols-2 gap-3 mt-4">
          <Input label="Frete da entrega (R$)" aria-label="Frete da entrega em reais" inputMode="decimal" placeholder="0,00" value={form.freteEntrega} onChange={(e) => setForm({ ...form, freteEntrega: e.target.value })} disabled={!podeEditar || !loja.aceitaEntrega} hint="Valor fixo por pedido." />
          <Input label="Pedido mínimo (R$)" aria-label="Pedido mínimo em reais" inputMode="decimal" placeholder="Sem mínimo" value={form.pedidoMinimo} onChange={(e) => setForm({ ...form, pedidoMinimo: e.target.value })} disabled={!podeEditar} hint="Conta só os produtos." />
          {podeEditar && <div className="sm:col-span-2"><Button type="submit" variant="secondary" loading={salvando} className="min-h-11">Salvar valores</Button></div>}
        </form>
        {!podeEditar && <p className="text-xs text-[var(--text-muted)] mt-3">Só o dono ou um administrador muda a loja.</p>}
      </Card>

      <Card padding="md">
        <h2 className="text-base font-semibold text-[var(--text-main)]">Link da loja</h2>
        {loja.link ? (
          <>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">Mande no WhatsApp, ponha na bio do Instagram ou no status.</p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input readOnly value={loja.link} aria-label="Link da loja" onFocus={(e) => e.target.select()} className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] text-sm text-[var(--text-main)]" />
              <Button icon={Copy} onClick={copiar} className="min-h-11">Copiar</Button>
              <a href={loja.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-main)]">
                <ExternalLink size={16} /> Abrir
              </a>
            </div>
            {!loja.online && <p className="text-xs text-[var(--warning-text)] mt-2">A loja está fora do ar: o link mostra "Loja indisponível".</p>}
          </>
        ) : (
          <form onSubmit={salvarSlug} className="mt-3 space-y-3">
            <p className="text-sm text-[var(--text-muted)]">Escolha o endereço da sua loja (letras, números e hífen).</p>
            <Input label="Endereço" aria-label="Endereço da loja" placeholder="minha-loja" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} disabled={!podeEditar} />
            {podeEditar && <Button type="submit" loading={salvandoSlug} disabled={slug.trim().length < 3} className="min-h-11">Salvar endereço</Button>}
          </form>
        )}

        <div className="mt-5 pt-4 border-t border-[var(--border-subtle)]">
          <h3 className="text-sm font-semibold text-[var(--text-main)]">Como o cliente paga</h3>
          {loja.pagamentoConectado ? (
            <p className="text-sm text-[var(--text-muted)] mt-1">Quando você aceita o pedido, o Pix sai pela sua conta conectada e o pedido anda sozinho quando o pagamento cai.</p>
          ) : (
            <p className="text-sm text-[var(--warning-text)] mt-1">
              Nenhuma forma de receber conectada. Abra a <Link to="/app/recebimentos" className="underline font-semibold">Conta de recebimento</Link> ou conecte em <Link to="/app/pagamentos" className="underline font-semibold">Pagamentos</Link>. Sem isso, só dá pra marcar como pago na mão.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
