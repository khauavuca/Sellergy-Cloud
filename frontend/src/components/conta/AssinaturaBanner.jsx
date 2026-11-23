import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, AlertTriangle, Lock } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui';
import { useAuthStore } from '../../store/auth.store';
import { useResumoConta } from './useResumoConta';
import ModalPlanos from './ModalPlanos';

// Faixa no topo do app: dias de teste restantes, atraso, conta limitada.
// "Escolher plano" abre os 3 planos; "Ver meu plano" leva para /app/plano.

const TEXTO = {
  TRIAL_ACABANDO: (s) => `Seu teste grátis acaba em ${s.diasRestantesTrial} dia(s).`,
  TRIAL_VENCIDO: () => 'Seu teste grátis terminou. Seus dados estão salvos — escolha um plano para voltar a registrar.',
  PAGAMENTO_ATRASADO: () => 'Sua mensalidade está em atraso. Regularize para não ter a conta limitada.',
  CONTA_SUSPENSA: () => 'Conta em modo somente leitura por pendência na mensalidade.',
  CONTA_CANCELADA: () => 'Assinatura cancelada. Você ainda consulta seus dados.',
};

export default function AssinaturaBanner() {
  const { resumo, recarregar } = useResumoConta();
  const user = useAuthStore((s) => s.user);
  const [aberto, setAberto] = useState(false);
  const a = resumo?.assinatura;
  if (!a) return null;

  const emTeste = a.status === 'TRIAL' && !a.aviso;
  if (!emTeste && !a.aviso) return null;

  const critico = a.somenteLeitura || a.aviso === 'PAGAMENTO_ATRASADO';
  const Icone = a.somenteLeitura ? Lock : critico ? AlertTriangle : Sparkles;
  const texto = emTeste ? `Teste grátis: faltam ${a.diasRestantesTrial} dias com tudo liberado.` : TEXTO[a.aviso]?.(a);
  const podeAssinar = user?.perfil === 'CLIENT' && ['TRIAL', 'ATIVA', 'ATRASADA', 'CANCELADA'].includes(a.status);

  return (
    <>
      <div
        role={critico ? 'alert' : 'status'}
        className={clsx(
          'mb-5 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl px-4 py-3 text-sm',
          critico ? 'bg-[var(--danger-soft)] text-[var(--danger-text)]' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]',
        )}
      >
        <Icone size={16} className="flex-shrink-0" aria-hidden="true" />
        <p className="flex-1">{texto}</p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/app/plano"
            className="inline-flex items-center justify-center min-h-11 px-3 rounded-lg font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            Ver meu plano
          </Link>
          {podeAssinar && (
            <Button className="min-h-11" variant={critico ? 'primary' : 'secondary'} onClick={() => setAberto(true)}>Escolher plano</Button>
          )}
        </div>
      </div>
      <ModalPlanos isOpen={aberto} onClose={() => setAberto(false)} assinatura={a} onAssinado={recarregar} />
    </>
  );
}
