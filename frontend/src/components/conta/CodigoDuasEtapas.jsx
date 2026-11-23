import { useState } from 'react';
import { AlertCircle, Copy, KeyRound, LogOut, ShieldCheck, ShieldOff } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../store/auth.store';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, Input, useToast } from '../ui';

const somenteDigitos = (v) => v.replace(/\D/g, '').slice(0, 6);

function CampoCodigo({ id, value, onChange, error }) {
  return (
    <Input
      id={id}
      label="Código de 6 dígitos do app"
      aria-label="Código de 6 dígitos do app"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      placeholder="000000"
      value={value}
      onChange={(e) => onChange(somenteDigitos(e.target.value))}
      error={error}
      required
    />
  );
}

/**
 * Cartao "Código em 2 etapas" do Meu perfil (admin e cliente).
 *   desligado -> configurar (QR + segredo) -> ativar com o codigo
 *   ligado    -> desativar com senha + codigo
 */
export default function CodigoDuasEtapas() {
  const toast = useToast();
  const { user, refreshUser, entrarComSessao, logout } = useAuthStore();
  const [config, setConfig] = useState(null); // { segredo, otpauth, qrCode }
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const ativo = user?.totpAtivo === true;
  const obrigatorio = user?.perfil === 'ADMIN' && user?.admin2faObrigatorio === true;
  // 2FA ligado, mas a sessao atual nao passou pelo codigo (entrou antes de ligar
  // ou por outro caminho): so saindo e entrando de novo a sessao ganha o mfa.
  const precisaEntrarDeNovo = ativo && obrigatorio && user?.mfa !== true;

  const comecar = async () => {
    setErro('');
    setCarregando(true);
    try {
      const r = await api.post('/autenticacao/2fa/configurar');
      setConfig(r.data);
      setCodigo('');
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível começar agora. Tente de novo.');
    } finally {
      setCarregando(false);
    }
  };

  const ativar = async (e) => {
    e.preventDefault();
    if (codigo.length !== 6) return;
    setErro('');
    setCarregando(true);
    try {
      const r = await api.post('/autenticacao/2fa/ativar', { codigo });
      await entrarComSessao(r.data);
      setConfig(null);
      setCodigo('');
      toast.success('Código em 2 etapas ativado.');
    } catch (e2) {
      setErro(e2.response?.data?.erro || 'Código incorreto. Confira o horário do celular e tente de novo.');
    } finally {
      setCarregando(false);
    }
  };

  const desativar = async (e) => {
    e.preventDefault();
    if (codigo.length !== 6 || !senha) return;
    setErro('');
    setCarregando(true);
    try {
      await api.post('/autenticacao/2fa/desativar', { senha, codigo });
      setSenha('');
      setCodigo('');
      await refreshUser();
      toast.success('Código em 2 etapas desativado.');
    } catch (e2) {
      setErro(e2.response?.data?.erro || 'Senha ou código incorretos.');
    } finally {
      setCarregando(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(config.segredo);
      toast.success('Chave copiada.');
    } catch {
      toast.error('Não deu para copiar. Selecione a chave e copie manualmente.');
    }
  };

  const sair = async () => {
    const destino = user?.perfil === 'ADMIN' ? '/admin/login' : '/app/login';
    await logout();
    window.location.assign(destino);
  };

  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle>Código em 2 etapas</CardTitle>
            {ativo
              ? <Badge variant="success" size="sm" icon={ShieldCheck}>Ativo</Badge>
              : <Badge variant="neutral" size="sm">Desligado</Badge>}
          </div>
          <CardDescription>
            Além da senha, o login pede um código de 6 dígitos de um app autenticador no celular
            (Google Authenticator, Microsoft Authenticator, Authy ou outro).
          </CardDescription>
        </div>
      </CardHeader>

      {erro && (
        <div role="alert" className="mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--danger-soft)]">
          <AlertCircle size={16} className="text-[var(--danger)] flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-[var(--danger-text)] font-medium">{erro}</p>
        </div>
      )}

      {precisaEntrarDeNovo && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">
            O código já está ativo, mas esta sessão começou sem ele. Saia e entre de novo usando o código do app para liberar o painel.
          </p>
          <Button variant="primary" icon={LogOut} className="min-h-11" onClick={sair}>Sair e entrar de novo</Button>
        </div>
      )}

      {!ativo && !config && (
        <Button variant="primary" icon={KeyRound} className="min-h-11" loading={carregando} onClick={comecar}>
          Ativar código em 2 etapas
        </Button>
      )}

      {!ativo && config && (
        <form onSubmit={ativar} className="space-y-4">
          <ol className="list-decimal pl-5 space-y-1.5 text-sm text-[var(--text-secondary)]">
            <li>No app autenticador, adicione uma conta e leia o QR Code abaixo.</li>
            <li>Se não der para ler, digite a chave manualmente.</li>
            <li>Digite o código de 6 dígitos que o app mostrar.</li>
          </ol>
          <div className="flex flex-col sm:flex-row gap-5 items-start">
            <img
              src={config.qrCode}
              alt="QR Code para cadastrar o Sellergy Cloud no app autenticador"
              width={176}
              height={176}
              className="w-44 h-44 rounded-xl border border-[var(--border-main)] bg-white p-2"
            />
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">Chave para digitar no app</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 break-all px-3 py-2.5 rounded-lg bg-[var(--bg-subtle)] text-sm font-mono text-[var(--text-main)] select-all">
                  {config.segredo}
                </code>
                <Button variant="secondary" icon={Copy} className="min-h-11" onClick={copiar} aria-label="Copiar chave">
                  Copiar
                </Button>
              </div>
            </div>
          </div>
          <CampoCodigo id="codigo-ativar-2fa" value={codigo} onChange={setCodigo} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" className="min-h-11" onClick={() => { setConfig(null); setErro(''); }}>Cancelar</Button>
            <Button type="submit" variant="primary" className="min-h-11" loading={carregando} disabled={codigo.length !== 6}>
              Confirmar e ativar
            </Button>
          </div>
        </form>
      )}

      {ativo && !precisaEntrarDeNovo && (
        obrigatorio ? (
          <p className="text-sm text-[var(--text-secondary)]">
            Para o administrador do sistema o código em 2 etapas é obrigatório e não pode ser desligado.
          </p>
        ) : (
          <form onSubmit={desativar} className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              Para desligar, confirme sua senha e um código do app. Sem o código, sua conta fica protegida só pela senha.
            </p>
            <Input
              label="Senha atual"
              aria-label="Senha atual"
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
            <CampoCodigo id="codigo-desativar-2fa" value={codigo} onChange={setCodigo} />
            <div className="flex justify-end">
              <Button type="submit" variant="danger-soft" icon={ShieldOff} className="min-h-11" loading={carregando} disabled={codigo.length !== 6 || !senha}>
                Desativar código em 2 etapas
              </Button>
            </div>
          </form>
        )
      )}
    </Card>
  );
}
