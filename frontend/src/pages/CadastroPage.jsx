import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, ArrowRight, AlertCircle, Store, Stethoscope, Layers, Check } from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '../store/auth.store';
import { Button, Input } from '../components/ui';
import SellergyLogo from '../components/SellergyLogo';

const SEGMENTOS = [
  { valor: 'SERVICO', titulo: 'Clínica ou serviço', descricao: 'Estética, fisioterapia, psicologia, salão', icone: Stethoscope },
  { valor: 'PRODUTO', titulo: 'Loja', descricao: 'Balcão, WhatsApp e Instagram', icone: Store },
  { valor: 'HIBRIDO', titulo: 'Os dois', descricao: 'Atende com hora marcada e vende produto', icone: Layers },
];

const VANTAGENS = [
  'Lembrete e confirmação de horário pelo WhatsApp',
  'Vendas, caixa e estoque no mesmo lugar',
  'Pix e link de pagamento',
  'Preço fixo por negócio, sem cobrar por profissional',
];

/** Cadastro proprio com 14 dias de teste gratis (plano Profissional). */
export default function CadastroPage() {
  const navigate = useNavigate();
  const { cadastrar, isLoading } = useAuthStore();
  const [form, setForm] = useState({ nomeNegocio: '', nomeResponsavel: '', email: '', telefone: '', senha: '', segmento: 'SERVICO' });
  const [erro, setErro] = useState(null);
  const [camposComErro, setCamposComErro] = useState([]);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  const temErro = (campo) => camposComErro.includes(campo);

  const enviar = async (e) => {
    e.preventDefault();
    setErro(null);
    setCamposComErro([]);
    const r = await cadastrar(form);
    if (r.ok) {
      navigate('/app/dashboard', { replace: true });
      return;
    }
    setErro(r.erro);
    setCamposComErro(r.campos);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-app)] flex">
      <div className="hidden lg:flex w-5/12 bg-[var(--bg-subtle)] relative overflow-hidden">
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <SellergyLogo size={36} />
            <span className="text-base font-semibold tracking-tight text-[var(--text-main)]">Sellergy Cloud</span>
          </Link>
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-[var(--text-main)] leading-tight max-w-md">
              Saia do caderno. Venda, agende e receba pelo WhatsApp.
            </h2>
            <ul className="mt-8 space-y-3">
              {VANTAGENS.map((v) => (
                <li key={v} className="flex items-start gap-2.5 text-sm text-[var(--text-secondary)]">
                  <Check size={16} className="text-[var(--success)] mt-0.5 flex-shrink-0" />
                  {v}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-[var(--text-muted)]">14 dias grátis · sem cartão de crédito</p>
        </div>
      </div>

      <div className="w-full lg:w-7/12 flex items-center justify-center px-4 sm:px-6 py-10">
        <div className="w-full max-w-md">
          <Link to="/" className="lg:hidden inline-flex items-center gap-2.5 mb-8">
            <SellergyLogo size={32} />
            <span className="text-base font-semibold tracking-tight text-[var(--text-main)]">Sellergy Cloud</span>
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Comece seu teste grátis</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1.5">14 dias com tudo liberado. Sem cartão.</p>

          <form onSubmit={enviar} className="space-y-4 mt-8" noValidate>
            {erro && (
              <div role="alert" className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--danger-soft)]">
                <AlertCircle size={16} className="text-[var(--danger)] flex-shrink-0 mt-0.5" />
                <p className="text-sm text-[var(--danger-text)] font-medium">{erro}</p>
              </div>
            )}

            <fieldset>
              <legend className="text-sm font-medium text-[var(--text-main)] mb-2">Seu negócio é</legend>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {SEGMENTOS.map(({ valor, titulo, descricao, icone: Icone }) => {
                  const ativo = form.segmento === valor;
                  return (
                    <button
                      key={valor}
                      type="button"
                      aria-pressed={ativo}
                      onClick={() => setForm((f) => ({ ...f, segmento: valor }))}
                      className={clsx(
                        'text-left rounded-xl border p-3 transition-colors',
                        ativo ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)] hover:bg-[var(--bg-subtle)]',
                      )}
                    >
                      <Icone size={18} className="text-[var(--text-main)]" />
                      <div className="text-sm font-semibold text-[var(--text-main)] mt-2">{titulo}</div>
                      <div className="text-xs text-[var(--text-muted)] mt-0.5">{descricao}</div>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <Input label="Nome do negócio" value={form.nomeNegocio} onChange={set('nomeNegocio')} error={temErro('nomeNegocio') ? 'Informe o nome do negócio' : undefined} required />
            <Input label="Seu nome" value={form.nomeResponsavel} onChange={set('nomeResponsavel')} autoComplete="name" error={temErro('nomeResponsavel') ? 'Informe seu nome' : undefined} required />
            <Input label="E-mail" type="email" icon={Mail} value={form.email} onChange={set('email')} autoComplete="email" error={temErro('email') ? 'Confira o e-mail' : undefined} required />
            <Input label="WhatsApp (opcional)" type="tel" placeholder="(11) 98888-7777" value={form.telefone} onChange={set('telefone')} autoComplete="tel" error={temErro('telefone') ? 'Confira o número com DDD' : undefined} />
            <Input label="Crie uma senha" type="password" value={form.senha} onChange={set('senha')} autoComplete="new-password" error={temErro('senha') ? 'Use pelo menos 8 caracteres' : undefined} required />

            <Button type="submit" variant="primary" size="lg" fullWidth loading={isLoading} icon={ArrowRight} iconPosition="right">
              Criar conta e começar
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
            Já tem conta? <Link to="/app/login" className="font-semibold text-[var(--text-main)] hover:underline">Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
