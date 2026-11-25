import { useEffect, useState } from 'react';
import { CircleCheck, KeyRound, Trash2 } from 'lucide-react';
import { Badge, Button, Input, useToast } from '../ui';
import adminCredencialIAService from '../../services/adminCredencialIAService';

const dataCurta = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '');

/**
 * Chave da DeepSeek da plataforma (uma só, da Sellergy, vale pra todos os
 * clientes). Sem ela, bot com IA ligada responde "indisponível".
 * `onMudou(configurada)` avisa quem usa (ex.: o modal de IA do bot).
 */
export default function ChaveIAPlataforma({ onMudou }) {
  const toast = useToast();
  const [chave, setChave] = useState(undefined); // undefined = carregando, null = sem chave
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    adminCredencialIAService.obter()
      .then((c) => { if (vivo) { setChave(c); onMudou?.(!!c); } })
      .catch(() => { if (vivo) setChave(null); });
    return () => { vivo = false; };
  }, [onMudou]);

  const salvar = async (e) => {
    e.preventDefault();
    if (!valor.trim()) return toast.error('Cole a chave da DeepSeek.');
    setSalvando(true);
    try {
      const c = await adminCredencialIAService.salvar({ apiKey: valor.trim() });
      setChave(c);
      onMudou?.(true);
      setValor('');
      setEditando(false);
      toast.success('Chave da IA salva.');
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível salvar a chave.');
    } finally {
      setSalvando(false);
    }
  };

  const remover = async () => {
    if (!confirm('Remover a chave da IA? Todos os bots com IA passam a responder "indisponível" até cadastrar outra.')) return;
    try {
      await adminCredencialIAService.remover();
      setChave(null);
      onMudou?.(false);
      toast.success('Chave removida.');
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível remover a chave.');
    }
  };

  if (chave === undefined) {
    return <div className="h-10 rounded-lg bg-[var(--bg-subtle)] animate-pulse" aria-label="Carregando" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound size={16} aria-hidden="true" className="text-[var(--text-muted)]" />
        <span className="text-sm font-medium text-[var(--text-main)] flex-1 min-w-0">Chave da DeepSeek</span>
        {chave
          ? <Badge variant="success" size="sm" icon={CircleCheck}>Configurada</Badge>
          : <Badge variant="warning" size="sm">Não configurada</Badge>}
      </div>
      <p className="m-0 text-xs text-[var(--text-muted)]">
        {chave
          ? `Uma chave só para todos os clientes. Atualizada em ${dataCurta(chave.atualizadoEm || chave.criadoEm)}. A chave não aparece de novo depois de salva.`
          : 'Uma chave só para todos os clientes. Sem ela, bot com IA ligada responde que está indisponível.'}
      </p>
      {editando || !chave ? (
        <form onSubmit={salvar} className="flex flex-col gap-2">
          <Input
            type="password"
            label="Chave (API key)"
            placeholder="sk-..."
            autoComplete="off"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
          <div className="flex gap-2 justify-end">
            {chave && <Button type="button" variant="secondary" size="sm" onClick={() => { setEditando(false); setValor(''); }}>Cancelar</Button>}
            <Button type="submit" variant="primary" size="sm" loading={salvando}>Salvar chave</Button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditando(true)}>Trocar chave</Button>
          <Button variant="danger-soft" size="sm" icon={Trash2} onClick={remover}>Remover</Button>
        </div>
      )}
    </div>
  );
}
