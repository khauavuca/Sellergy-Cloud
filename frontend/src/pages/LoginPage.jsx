import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Mail, ArrowRight, AlertCircle, Sparkles, CreditCard, Users, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';
import { Button, Input } from '../components/ui';
import SellergyLogo from '../components/SellergyLogo';
import EtapaCodigo from '../components/auth/EtapaCodigo';

/**
 * Login do administrador do sistema. Layout split: lado esquerdo formulario,
 * lado direito apresentacao limpa com gradiente off-white.
 */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [params] = useSearchParams();
  const suporteEncerrado = params.get('suporte') === 'encerrado';
  const { login, error, isLoading, isAuthenticated, user, logout, desafio2fa, confirmar2fa, cancelar2fa } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated && user) {
      if (user.perfil === 'ADMIN') {
        navigate('/admin/dashboard');
      } else if (['CLIENT', 'ADMINISTRADOR', 'VENDEDOR'].includes(user.perfil)) {
        // Se um usuario de tenant entrou aqui por engano, desloga.
        logout();
      }
    }
  }, [isAuthenticated, user, navigate, logout]);

  // Tela interna: pede pros buscadores nao indexarem.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await login(email, senha);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-app)] flex">
      {/* Lado esquerdo - formulario */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <Link to="/" className="inline-flex items-center gap-2.5 mb-12 group">
            <SellergyLogo size={36} />
            <span className="text-base font-semibold tracking-tight text-[var(--text-main)]">
              Sellergy Cloud
            </span>
          </Link>

          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">
              Entrar no painel admin
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1.5">
              Acesso restrito a administradores do sistema.
            </p>
          </div>

          {desafio2fa ? (
            <EtapaCodigo erro={error} carregando={isLoading} onConfirmar={confirmar2fa} onVoltar={cancelar2fa} />
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {suporteEncerrado && !error && (
                <p role="status" className="px-3.5 py-3 rounded-xl bg-[var(--bg-subtle)] text-sm text-[var(--text-secondary)]">
                  Sessão de suporte encerrada. Entre de novo com sua senha e o código.
                </p>
              )}
              {error && (
                <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--danger-soft)] border border-[var(--danger-soft)]">
                  <AlertCircle size={16} className="text-[var(--danger)] flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-[var(--danger-text)] font-medium">{error}</p>
                </div>
              )}
  
              <Input
                label="E-mail"
                type="email"
                icon={Mail}
                placeholder="seuemail@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
  
              <Input
                label="Senha"
                type="password"
                placeholder="Digite sua senha"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
                required
              />
  
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={isLoading}
                icon={ArrowRight}
                iconPosition="right"
              >
                Entrar
              </Button>
            </form>
          )}

          <div className="mt-8 text-center">
            <Link
              to="/app/login"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors font-medium"
            >
              Não é administrador? Acesse o portal do cliente
            </Link>
          </div>
        </div>
      </div>

      {/* Lado direito - hero (so desktop) */}
      <div className="hidden lg:flex w-1/2 bg-[var(--bg-subtle)] relative overflow-hidden">
        {/* Decorativo */}
        <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full bg-[var(--accent-soft)]/40" />
        <div className="absolute -bottom-32 -left-20 w-[500px] h-[500px] rounded-full bg-[var(--primary-soft)]" />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <Sparkles size={12} className="text-[var(--accent)]" />
            Painel administrativo
          </div>

          <div>
            <h2 className="text-3xl xl:text-4xl font-semibold tracking-tight text-[var(--text-main)] leading-tight max-w-md">
              O painel de quem cuida do Sellergy Cloud.
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mt-4 max-w-sm leading-relaxed">
              Acompanhe as assinaturas, os clientes e a cobrança: quem está em teste, quem pagou e quem precisa de atenção.
            </p>
          </div>

          <ul className="flex flex-col gap-2 text-sm text-[var(--text-secondary)]">
            <li className="flex items-center gap-2"><CreditCard size={16} className="text-[var(--accent)]" aria-hidden="true" />Assinaturas e faturas</li>
            <li className="flex items-center gap-2"><Users size={16} className="text-[var(--accent)]" aria-hidden="true" />Clientes e permissões</li>
            <li className="flex items-center gap-2"><ShieldCheck size={16} className="text-[var(--accent)]" aria-hidden="true" />Entrada com código em 2 etapas</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
