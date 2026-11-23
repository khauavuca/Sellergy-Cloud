// Convites da equipe (tela Usuarios & Equipe). Frente C da fase 2.
// A dona convida; a pessoa recebe o link pelo WhatsApp do negocio, cria a
// senha em /convite/<token> e ja entra. Backend: /convites.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Send, X, RefreshCw, MessageCircle } from 'lucide-react';
import api from '../../services/api';
import { Button, Input, Badge, useToast } from '../ui';
import Modal from '../Modal';

const VAZIO = { nome: '', email: '', telefone: '', perfil: 'VENDEDOR', especialistaId: '' };
const MOTIVO_WHATSAPP = {
  SEM_WHATSAPP: 'O WhatsApp do negócio ainda não está conectado. Copie o link e mande pelo seu WhatsApp.',
  SEM_TELEFONE: 'Sem celular pra mandar. Copie o link.',
  FALHA: 'Não conseguimos mandar pelo WhatsApp agora. Copie o link e mande pelo seu WhatsApp.',
};
const fmtData = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtCel = (t) => {
  const d = String(t || '').replace(/^55/, '');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : t;
};

async function copiarTexto(texto, toast) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success('Link copiado.');
  } catch {
    toast.error('Não foi possível copiar. Selecione o link e copie.');
  }
}

export default function ConvitesEquipe({ aberto, setAberto, ehDono, temAgenda, onMudou }) {
  const toast = useToast();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [especialistas, setEspecialistas] = useState([]);
  const [form, setForm] = useState(VAZIO);
  const [camposErro, setCamposErro] = useState([]);
  const [erroForm, setErroForm] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(null); // { convite, link, whatsapp }
  const [ocupado, setOcupado] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const r = await api.get('/convites');
      setDados(r.data);
      setErro(null);
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível carregar os convites.');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao montar
    carregar();
  }, [carregar]);

  // Profissionais da agenda ainda sem login (pra ligar o convite a uma delas).
  useEffect(() => {
    if (!aberto || !temAgenda) return;
    api.get('/convites/especialistas').then((r) => setEspecialistas(r.data)).catch(() => setEspecialistas([]));
  }, [aberto, temAgenda]);

  // Fecha limpando o formulario: a proxima abertura comeca do zero.
  const fechar = () => {
    setAberto(false);
    setForm(VAZIO);
    setCamposErro([]);
    setErroForm(null);
    setEnviado(null);
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const erroCampo = (k, msg) => (camposErro.includes(k) ? msg : undefined);

  const convidar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setCamposErro([]);
    setErroForm(null);
    try {
      const r = await api.post('/convites', { ...form, especialistaId: form.especialistaId || undefined });
      setEnviado(r.data);
      carregar();
      onMudou?.();
    } catch (err) {
      const d = err.response?.data;
      setCamposErro(d?.campos || []);
      setErroForm(d?.codigo === 'LIMITE_DO_PLANO'
        ? <>{d.erro} <Link to="/app/plano" className="font-semibold underline">Ver planos</Link></>
        : d?.erro || 'Não foi possível criar o convite.');
    } finally {
      setEnviando(false);
    }
  };

  const reenviar = async (c) => {
    setOcupado(c.id);
    try {
      const r = await api.post(`/convites/${c.id}/reenviar`);
      if (r.data.whatsapp?.enviado) toast.success(`Convite reenviado pro WhatsApp de ${c.nome.split(' ')[0]}.`);
      else {
        await copiarTexto(r.data.link, toast);
        toast.error(MOTIVO_WHATSAPP[r.data.whatsapp?.motivo] || MOTIVO_WHATSAPP.FALHA);
      }
      carregar();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível reenviar.');
    } finally {
      setOcupado(null);
    }
  };

  const cancelar = async (c) => {
    setOcupado(c.id);
    try {
      await api.delete(`/convites/${c.id}`);
      toast.success('Convite cancelado. O link parou de funcionar.');
      carregar();
      onMudou?.();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível cancelar.');
    } finally {
      setOcupado(null);
    }
  };

  const vagas = dados?.vagas;
  const convites = dados?.convites || [];

  return (
    <>
      {(erro || convites.length > 0) && (
        <section className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)]">
          <div className="px-5 py-3 flex flex-wrap items-center gap-2 border-b border-[var(--border-main)]">
            <h2 className="flex-1 text-sm font-semibold text-[var(--text-main)]">Convites enviados</h2>
            {vagas?.maximo && (
              <span className="text-xs text-[var(--text-muted)]">
                {vagas.usuarios + vagas.convitesPendentes} de {vagas.maximo} lugares do plano em uso
              </span>
            )}
          </div>
          {erro ? (
            <div className="p-4 flex items-center gap-3 text-sm text-[var(--danger-text)]">
              {erro}<Button size="sm" variant="secondary" icon={RefreshCw} onClick={carregar}>Tentar de novo</Button>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-main)]">
              {convites.map((c) => (
                <li key={c.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[12rem]">
                    <p className="text-sm font-semibold text-[var(--text-main)]">
                      {c.nome}{' '}
                      <Badge size="sm" variant={c.situacao === 'PENDENTE' ? 'warning' : 'neutral'}>
                        {c.situacao === 'PENDENTE' ? `Esperando · vence ${fmtData(c.expiraEm)}` : 'Venceu'}
                      </Badge>
                    </p>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {c.perfil === 'ADMINISTRADOR' ? 'Administrador' : 'Equipe'} · {c.email}{c.telefone ? ` · ${fmtCel(c.telefone)}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" className="min-h-11" icon={Send} loading={ocupado === c.id} onClick={() => reenviar(c)}>Reenviar</Button>
                    <Button size="sm" variant="ghost" className="min-h-11" icon={X} disabled={ocupado === c.id} onClick={() => cancelar(c)}>Cancelar</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Modal isOpen={aberto} onClose={fechar} title={enviado ? 'Convite criado' : 'Convidar pra equipe'} size="md">
        {enviado ? (
          <div className="space-y-4">
            {enviado.whatsapp?.enviado ? (
              <p className="flex items-start gap-2 text-sm text-[var(--success-text)] bg-[var(--success-soft)] rounded-lg px-3 py-2">
                <MessageCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden />
                Mandamos o convite pro WhatsApp de {enviado.convite.nome.split(' ')[0]}. Se não chegar, copie o link abaixo.
              </p>
            ) : (
              <p className="text-sm text-[var(--warning-text)] bg-[var(--warning-soft)] rounded-lg px-3 py-2">
                {MOTIVO_WHATSAPP[enviado.whatsapp?.motivo] || MOTIVO_WHATSAPP.FALHA}
              </p>
            )}
            <div>
              <label htmlFor="link-convite" className="text-xs font-semibold text-[var(--text-secondary)]">Link do convite (vale 7 dias)</label>
              <div className="mt-1 flex gap-2">
                <input id="link-convite" readOnly value={enviado.link} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 min-h-11 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3 text-sm" />
                <Button className="min-h-11" icon={Copy} onClick={() => copiarTexto(enviado.link, toast)}>Copiar</Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="lg" variant="secondary" onClick={fechar}>Fechar</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={convidar} className="space-y-4" noValidate>
            {erroForm && <p role="alert" className="text-sm text-[var(--danger-text)] bg-[var(--danger-soft)] rounded-lg px-3 py-2">{erroForm}</p>}
            <Input label="Nome" aria-label="Nome" value={form.nome} onChange={set('nome')} autoComplete="off" error={erroCampo('nome', 'Informe o nome')} required />
            <Input label="Celular (WhatsApp)" aria-label="Celular (WhatsApp)" type="tel" placeholder="(11) 98888-7777" value={form.telefone} onChange={set('telefone')} error={erroCampo('telefone', 'Confira o celular com DDD')} required />
            <Input label="E-mail (vai ser o login)" aria-label="E-mail (vai ser o login)" type="email" value={form.email} onChange={set('email')} error={erroCampo('email', 'Confira o e-mail')} required />
            <fieldset>
              <legend className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5">O que a pessoa faz</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  ['VENDEDOR', 'Equipe', 'Agenda, clientes e vendas. Não vê o caixa nem os valores da conta.'],
                  ...(ehDono ? [['ADMINISTRADOR', 'Administrador', 'Cuida de tudo da conta, menos o plano.']] : []),
                ].map(([v, t, d]) => (
                  <label key={v} className={`flex gap-3 items-start rounded-xl border p-3 cursor-pointer min-h-11 ${form.perfil === v ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)]'}`}>
                    <input type="radio" name="perfil" value={v} checked={form.perfil === v} onChange={set('perfil')} className="mt-1" />
                    <span><span className="block text-sm font-semibold text-[var(--text-main)]">{t}</span><span className="block text-xs text-[var(--text-muted)]">{d}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {temAgenda && form.perfil === 'VENDEDOR' && especialistas.length > 0 && (
              <div>
                <label htmlFor="convite-esp" className="text-xs font-semibold text-[var(--text-secondary)]">Ela atende na agenda? (opcional)</label>
                <select id="convite-esp" value={form.especialistaId} onChange={set('especialistaId')} className="mt-1 w-full min-h-11 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] px-3 text-sm">
                  <option value="">Não, só usa o sistema</option>
                  {especialistas.map((e) => <option key={e.id} value={e.id}>Sim, é {e.nome}</option>)}
                </select>
                <p className="text-xs text-[var(--text-muted)] mt-1">Ligando a uma profissional, ela vê só a própria agenda.</p>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button size="lg" variant="secondary" onClick={fechar}>Cancelar</Button>
              <Button size="lg" type="submit" icon={Send} loading={enviando}>Mandar convite</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
