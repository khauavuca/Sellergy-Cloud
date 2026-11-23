import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button } from '../ui';

/**
 * Segunda etapa do login: codigo de 6 digitos do app autenticador.
 * O estado (desafio, erro, carregando) vive no auth.store.
 */
export default function EtapaCodigo({ erro, carregando, onConfirmar, onVoltar }) {
  const [codigo, setCodigo] = useState('');
  const ref = useRef(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const enviar = (e) => {
    e.preventDefault();
    if (codigo.length === 6) onConfirmar(codigo);
  };

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <div className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-[var(--bg-subtle)]">
        <ShieldCheck size={18} className="text-[var(--success)] flex-shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-[var(--text-secondary)]">
          Sua conta usa código em 2 etapas. Abra o app autenticador no celular e digite o código de 6 dígitos.
        </p>
      </div>

      {erro && (
        <div role="alert" className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--danger-soft)]">
          <AlertCircle size={16} className="text-[var(--danger)] flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-[var(--danger-text)] font-medium">{erro}</p>
        </div>
      )}

      <div>
        <label htmlFor="codigo-2fa" className="block text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">
          Código de 6 dígitos
        </label>
        <input
          ref={ref}
          id="codigo-2fa"
          name="codigo"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-invalid={erro ? true : undefined}
          className="w-full h-12 px-4 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-main)] text-center text-xl font-semibold tracking-[0.5em] tabular-nums focus:outline-none focus:border-[var(--primary)] focus:shadow-[var(--shadow-focus)]"
          placeholder="000000"
        />
      </div>

      <Button type="submit" variant="primary" size="lg" fullWidth loading={carregando} disabled={codigo.length !== 6}>
        Confirmar e entrar
      </Button>
      <Button type="button" variant="ghost" size="lg" fullWidth icon={ArrowLeft} onClick={onVoltar}>
        Voltar
      </Button>
    </form>
  );
}
