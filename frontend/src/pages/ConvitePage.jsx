// /convite/:token — aceitar convite da equipe e criar a senha. Frente C da fase 2.
// Prototipo: sellergy-prototipo/project/ConviteEquipe.dc.html.
// Pagina publica: a pessoa cria a senha e ja entra logada (mesma sessao do login).

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/auth.store';
import { Button, Input } from '../components/ui';
import SellergyLogo from '../components/SellergyLogo';
import AceiteTermos from '../components/legal/AceiteTermos';

function Caixa({ children }) {
  return (
    <div className="min-h-screen bg-[var(--bg-app)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

const TEXTO_PERFIL = {
  ADMINISTRADOR: 'Você vai ver e cuidar de tudo da conta, menos plano e assinatura.',
  VENDEDOR: 'Você vai ver a agenda, a ficha dos clientes e registrar vendas. Valores do caixa e da conta ficam com quem te convidou.',
};

export default function ConvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const entrarComSessao = useAuthStore((s) => s.entrarComSessao);
  const [convite, setConvite] = useState(null);
  const [erro, setErro] = useState(null);
  const [senha, setSenha] = useState('');
  const [erroSenha, setErroSenha] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [aceite, setAceite] = useState(false);
  const [erroAceite, setErroAceite] = useState(false);

  useEffect(() => {
    api.get(`/publico/convite/${encodeURIComponent(token)}`)
      .then((r) => setConvite(r.data))
      .catch((e) => setErro(e.response?.data?.erro || 'Não foi possível abrir o convite. Confira sua internet e tente de novo.'));
  }, [token]);

  const aceitar = async (e) => {
    e.preventDefault();
    setErroSenha(null);
    setErroAceite(false);
    if (!aceite) {
      setErroAceite(true);
      return;
    }
    if (senha.length < (convite?.senhaMinima || 8)) {
      setErroSenha(`Use pelo menos ${convite?.senhaMinima || 8} caracteres.`);
      return;
    }
    setEnviando(true);
    try {
      const r = await api.post(`/publico/convite/${encodeURIComponent(token)}`, { senha, aceiteTermos: aceite });
      await entrarComSessao(r.data);
      navigate('/app/dashboard', { replace: true });
    } catch (err) {
      const d = err.response?.data;
      if (d?.campos?.includes('aceiteTermos')) setErroAceite(true);
      else if (d?.campos?.includes('senha')) setErroSenha(d.erro);
      else setErro(d?.erro || 'Não foi possível criar seu acesso. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  if (erro) {
    return (
      <Caixa>
        <div className="text-center">
          <AlertCircle className="mx-auto text-[var(--text-muted)]" aria-hidden />
          <p role="alert" className="text-sm text-[var(--text-secondary)] mt-3">{erro}</p>
          <Link to="/app/login" className="inline-flex items-center justify-center min-h-11 mt-5 px-4 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-main)]">
            Ir para o login
          </Link>
        </div>
      </Caixa>
    );
  }
  if (!convite) {
    return <Caixa><Loader2 className="mx-auto animate-spin text-[var(--text-muted)]" aria-label="Carregando convite" /></Caixa>;
  }

  if (convite.situacao !== 'PENDENTE') {
    return (
      <Caixa>
        <div className="text-center">
          <SellergyLogo size={40} className="mx-auto" />
          <h1 className="text-xl font-semibold text-[var(--text-main)] mt-5">
            {convite.situacao === 'ACEITO' ? 'Este convite já foi usado' : 'Este convite venceu'}
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-2">
            {convite.situacao === 'ACEITO'
              ? 'Entre com seu e-mail e a senha que você criou.'
              : `Peça pra ${convite.convidadoPor || 'quem te convidou'} mandar de novo pelo Sellergy.`}
          </p>
          <Link to="/app/login" className="inline-flex items-center justify-center min-h-11 mt-5 px-5 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-sm font-semibold">
            Ir para o login
          </Link>
        </div>
      </Caixa>
    );
  }

  const primeiroNome = convite.nome.split(' ')[0];
  return (
    <Caixa>
      <SellergyLogo size={40} />
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)] mt-6">Oi, {primeiroNome}!</h1>
      <p className="text-sm text-[var(--text-secondary)] mt-2">
        {convite.convidadoPor || 'A equipe'} te convidou pra equipe {convite.negocio ? `da ${convite.negocio}` : ''} no Sellergy. Crie sua senha pra entrar.
      </p>

      <form onSubmit={aceitar} className="mt-6 space-y-4" noValidate>
        <div className="rounded-xl bg-[var(--bg-subtle)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          Você vai entrar com o e-mail <strong className="text-[var(--text-main)] break-all">{convite.email}</strong>
          {convite.telefone ? <> (celular {convite.telefone})</> : null}.
        </div>
        <Input
          label="Crie sua senha" aria-label="Crie sua senha"
          type="password"
          autoComplete="new-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          hint={erroSenha ? undefined : `Pelo menos ${convite.senhaMinima} caracteres.`}
          error={erroSenha || undefined}
          size="lg"
          required
        />
        <div className="rounded-xl border border-[var(--border-main)] px-4 py-3 text-sm">
          <p className="font-semibold text-[var(--text-main)]">O que você vai ver</p>
          <p className="text-[var(--text-secondary)] mt-1">
            {convite.especialista
              ? 'Sua agenda, a ficha dos seus clientes e suas vendas. Valores do caixa e da conta ficam com quem te convidou.'
              : TEXTO_PERFIL[convite.perfil] || TEXTO_PERFIL.VENDEDOR}
          </p>
        </div>
        <AceiteTermos marcado={aceite} onChange={setAceite} erro={erroAceite} />
        <Button type="submit" size="lg" fullWidth loading={enviando} icon={ArrowRight} iconPosition="right">Entrar</Button>
      </form>
    </Caixa>
  );
}
