import { Link } from 'react-router-dom';

/**
 * Caixa "li e aceito" dos Termos e da Politica (obrigatoria no cadastro e no
 * convite). Os links abrem em nova aba pra nao perder o que foi digitado.
 */
export default function AceiteTermos({ marcado, onChange, erro }) {
  return (
    <div>
      <label className="flex items-start gap-3 min-h-11 py-2 cursor-pointer text-sm text-[var(--text-secondary)] leading-relaxed">
        <input
          type="checkbox"
          checked={marcado}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={erro ? 'true' : undefined}
          aria-describedby={erro ? 'erro-aceite-termos' : undefined}
          className="mt-0.5 w-5 h-5 shrink-0 accent-[var(--primary)] cursor-pointer"
        />
        <span>
          Li e aceito os{' '}
          <Link to="/termos" target="_blank" rel="noopener" className="font-semibold text-[var(--primary)] underline underline-offset-2">Termos de uso</Link>
          {' '}e a{' '}
          <Link to="/privacidade" target="_blank" rel="noopener" className="font-semibold text-[var(--primary)] underline underline-offset-2">Política de privacidade</Link>.
        </span>
      </label>
      {erro && (
        <p id="erro-aceite-termos" role="alert" className="m-0 text-xs font-medium text-[var(--danger-text)]">
          Para continuar, marque que aceita os Termos e a Política.
        </p>
      )}
    </div>
  );
}
