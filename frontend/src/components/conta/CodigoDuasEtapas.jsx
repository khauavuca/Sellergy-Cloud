import { useState } from 'react';
import { AlertCircle, Copy, KeyRound, LogOut, ShieldCheck, ShieldOff } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../store/auth.store';
import { Badge, Button, Input, Painel, useToast } from '../ui';

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

// Linha "opção" do cartão: título + descrição à esquerda, ação à direita.
function Opcao({ titulo, descricao, acao }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="min-w-0 flex-1">
        <strong className="block text-sm font-semibold text-[var(--text-main)]">{titulo}</strong>
        <span className="block mt-0.5 text-[13px] text-[var(--text-muted)]">{descricao}</span>
      </div>
      {acao && <div className="flex-shrink-0">{acao}</div>}
    </div>
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
  const [desligando, setDesligando] = useState(false);

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
      setDesligando(false);
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

  const rotuloBadge = ativo
    ? <Badge variant="success" size="sm" icon={ShieldCheck}>Ativo</Badge>
    : <Badge variant="neutral" size="sm">Desligado</Badge>;

  return (
    <Painel
      id="codigo-2-etapas"
      titulo="Código em 2 etapas"
      subtitulo="Pede um código de 6 dígitos do app autenticador a cada login."
      acoes={rotuloBadge}
      semPadding
    >
      {erro && (
        <div role="alert" className="mx-4 mt-3.5 flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-[var(--danger-soft)]">
          <AlertCircle size={16} className="text-[var(--danger)] flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="m-0 text-[13px] text-[var(--danger-text)] font-medium">{erro}</p>
        </div>
      )}

      {precisaEntrarDeNovo && (
        <Opcao
          titulo="Entre de novo com o código"
          descricao="O código já está ativo, mas esta sessão começou sem ele. Saia e entre de novo usando o código do app para liberar o painel."
          acao={<Button variant="primary" size="sm" icon={LogOut} onClick={sair}>Sair e entrar de novo</Button>}
        />
      )}

      {!ativo && !config && (
        <Opcao
          titulo="App autenticador"
          descricao="Google Authenticator, Microsoft Authenticator, Authy ou outro no seu celular."
          acao={(
            <Button variant="primary" size="sm" icon={KeyRound} loading={carregando} onClick={comecar}>
              Ativar código em 2 etapas
            </Button>
          )}
        />
      )}

      {!ativo && config && (
        <form onSubmit={ativar} className="p-4 space-y-4">
          <ol className="m-0 list-decimal pl-5 space-y-1 text-[13px] text-[var(--text-secondary)]">
            <li>No app autenticador, adicione uma conta e leia o QR Code abaixo.</li>
            <li>Se não der para ler, digite a chave manualmente.</li>
            <li>Digite o código de 6 dígitos que o app mostrar.</li>
          </ol>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <img
              src={config.qrCode}
              alt="QR Code para cadastrar o Sellergy Cloud no app autenticador"
              width={160}
              height={160}
              className="w-40 h-40 rounded-[10px] border border-[var(--border-main)] bg-white p-2"
            />
            <div className="flex-1 min-w-0 space-y-3">
              <div className="space-y-1.5">
                <p className="m-0 text-xs font-semibold text-[var(--text-secondary)]">Chave para digitar no app</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 break-all px-3 py-2 rounded-lg bg-[var(--bg-subtle)] text-[13px] font-mono text-[var(--text-main)] select-all">
                    {config.segredo}
                  </code>
                  <Button variant="secondary" size="sm" icon={Copy} onClick={copiar} aria-label="Copiar chave">
                    Copiar
                  </Button>
                </div>
              </div>
              <CampoCodigo id="codigo-ativar-2fa" value={codigo} onChange={setCodigo} />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => { setConfig(null); setErro(''); }}>Cancelar</Button>
            <Button type="submit" variant="primary" loading={carregando} disabled={codigo.length !== 6}>
              Confirmar e ativar
            </Button>
          </div>
        </form>
      )}

      {ativo && !precisaEntrarDeNovo && (
        <Opcao titulo="App autenticador" descricao="O login pede o código do app além da senha." />
      )}

      {ativo && !precisaEntrarDeNovo && obrigatorio && (
        <Opcao
          titulo="Desativar o código"
          descricao="Para o administrador do sistema o código em 2 etapas é obrigatório e não pode ser desligado."
        />
      )}

      {ativo && !precisaEntrarDeNovo && !obrigatorio && !desligando && (
        <Opcao
          titulo="Desativar o código"
          descricao="Sua conta fica protegida só pela senha."
          acao={(
            <Button variant="secondary" size="sm" icon={ShieldOff} onClick={() => { setDesligando(true); setErro(''); }}>
              Desativar
            </Button>
          )}
        />
      )}

      {ativo && !precisaEntrarDeNovo && !obrigatorio && desligando && (
        <form onSubmit={desativar} className="p-4 space-y-4">
          <p className="m-0 text-[13px] text-[var(--text-secondary)]">
            Para desligar, confirme sua senha e um código do app. Sem o código, sua conta fica protegida só pela senha.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Senha atual"
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
            <CampoCodigo id="codigo-desativar-2fa" value={codigo} onChange={setCodigo} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => { setDesligando(false); setSenha(''); setCodigo(''); setErro(''); }}>Cancelar</Button>
            <Button type="submit" variant="danger-soft" icon={ShieldOff} loading={carregando} disabled={codigo.length !== 6 || !senha}>
              Desativar código em 2 etapas
            </Button>
          </div>
        </form>
      )}
    </Painel>
  );
}
