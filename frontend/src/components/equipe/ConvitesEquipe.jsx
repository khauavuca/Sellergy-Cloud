// Convites da equipe (tela Equipe). Frente C da fase 2.
// A dona convida; a pessoa recebe o link pelo WhatsApp do negocio, cria a
// senha em /convite/<token> e ja entra. Backend: /convites.
//
// - useConvitesEquipe (arquivo ao lado): carrega a lista + vagas do plano, reenviar e cancelar
//   (a pagina usa os numeros na faixa do topo e na aba "Convites").
// - AvisosConvites: faixa "fulano ainda nao aceitou..." embaixo da tabela.
// - LinhasConvites: linhas <tr> da aba "Convites" da tabela de pessoas.
// - default (ConvitesEquipe): modal "Convidar pra equipe".

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Send, X, RefreshCw, MessageCircle } from 'lucide-react';
import api from '../../services/api';
import { Button, Input, Badge, Avatar, useToast } from '../ui';
import Modal from '../Modal';
import { MOTIVO_WHATSAPP, copiarTexto } from './useConvitesEquipe';

const VAZIO = { nome: '', email: '', telefone: '', perfil: 'VENDEDOR', especialistaId: '' };
const fmtData = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtDataHora = (d) => {
  const dt = new Date(d);
  return `${dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};
const fmtCel = (t) => {
  const d = String(t || '').replace(/^55/, '');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : t;
};
const diasAte = (d) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000));

/** Faixa de aviso de cada convite em aberto (embaixo da tabela de pessoas). */
export function AvisosConvites({ convites, erro, ocupado, carregar, reenviar, cancelar }) {
  if (erro) {
    return (
      <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 border-t border-[var(--border-subtle)] text-[13px] text-[var(--danger-text)]">
        <span className="flex-1 min-w-0">{erro}</span>
        <Button size="sm" variant="secondary" icon={RefreshCw} onClick={carregar}>Tentar de novo</Button>
      </div>
    );
  }
  if (!convites.length) return null;
  return (
    <ul className="m-0 p-0 list-none">
      {convites.map((c) => {
        const pendente = c.situacao === 'PENDENTE';
        const contato = c.telefone ? fmtCel(c.telefone) : c.email;
        const dias = diasAte(c.expiraEm);
        return (
          <li
            key={c.id}
            className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--warning-soft)] text-[13px] text-[var(--text-main)]"
          >
            <MessageCircle size={16} aria-hidden="true" className="flex-shrink-0 text-[var(--warning-text)]" />
            <span className="flex-1 min-w-[14rem] [overflow-wrap:anywhere]">
              <strong>{c.nome}</strong>{' '}
              {pendente
                ? <>ainda não aceitou o convite mandado em {fmtDataHora(c.criadoEm)} para {contato}. {dias === 0 ? 'O link vence hoje.' : `O link vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}.`}</>
                : <>não aceitou o convite mandado para {contato} e o link venceu em {fmtData(c.expiraEm)}.</>}
            </span>
            <Button size="sm" variant="secondary" icon={Send} loading={ocupado === c.id} onClick={() => reenviar(c)}>Reenviar</Button>
            <Button size="sm" variant="secondary" icon={X} disabled={ocupado === c.id} onClick={() => cancelar(c)}>Cancelar convite</Button>
          </li>
        );
      })}
    </ul>
  );
}

/** Linhas da aba "Convites" (mesmas colunas da tabela de pessoas). */
export function LinhasConvites({ convites, ocupado, reenviar, cancelar, td }) {
  return convites.map((c) => {
    const pendente = c.situacao === 'PENDENTE';
    return (
      <tr key={c.id}>
        <td className={td}>
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar name={c.nome} size="sm" variant="neutral" />
            <span className="min-w-0">
              <span className="block font-semibold text-[var(--text-main)] truncate">{c.nome}</span>
              <span className="block text-xs text-[var(--text-muted)] truncate">{c.telefone ? fmtCel(c.telefone) : c.email}</span>
            </span>
          </div>
        </td>
        <td className={td}>
          <Badge size="sm" variant={c.perfil === 'ADMINISTRADOR' ? 'info' : 'neutral'}>
            {c.perfil === 'ADMINISTRADOR' ? 'Administrador' : 'Equipe'}
          </Badge>
        </td>
        <td className={`${td} text-[var(--text-muted)]`}>—</td>
        <td className={`${td} text-[var(--text-secondary)] whitespace-nowrap`}>{c.especialistaId ? 'Sim, ligada a uma profissional' : '—'}</td>
        <td className={`${td} text-[var(--text-secondary)] whitespace-nowrap`}>Convidada em {fmtData(c.criadoEm)}</td>
        <td className={td}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge size="sm" variant={pendente ? 'warning' : 'neutral'}>
              {pendente ? `Esperando · vence ${fmtData(c.expiraEm)}` : 'Venceu'}
            </Badge>
            <Button size="sm" variant="ghost" icon={Send} loading={ocupado === c.id} onClick={() => reenviar(c)}>Reenviar</Button>
            <Button size="sm" variant="ghost" icon={X} disabled={ocupado === c.id} onClick={() => cancelar(c)}>Cancelar</Button>
          </div>
        </td>
        <td className={td} />
      </tr>
    );
  });
}

/** Modal "Convidar pra equipe". */
export default function ConvitesEquipe({ aberto, setAberto, ehDono, temAgenda, onMudou }) {
  const toast = useToast();
  const [especialistas, setEspecialistas] = useState([]);
  const [form, setForm] = useState(VAZIO);
  const [camposErro, setCamposErro] = useState([]);
  const [erroForm, setErroForm] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(null); // { convite, link, whatsapp }

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

  return (
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
  );
}
