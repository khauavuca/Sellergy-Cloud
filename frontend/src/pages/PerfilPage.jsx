import { useContext, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  User, Mail, Lock, Save, AlertCircle, CheckCircle2, ShieldCheck,
  Upload, Trash2, ArrowLeft, ShieldAlert
} from 'lucide-react';
import api from '../services/api';
import { reduzirImagem } from '../utils/reduzirImagem';
import { useAuthStore } from '../store/auth.store';
import {
  Avatar, Button, Input, Badge, useToast, Pagina, ColunasPagina, Painel
} from '../components/ui';
import CodigoDuasEtapas from '../components/conta/CodigoDuasEtapas';
import LateralPerfil from '../components/conta/LateralPerfil';
import { usePerfilNegocio } from '../components/conta/usePerfilNegocio';
import { AcaoTopoContext, useAcaoTopo } from '../hooks/useAcaoTopo';

const MAX_FOTO_SIZE = 10 * 1024 * 1024; // arquivo escolhido; e reduzido antes de enviar
const ID_FORM_DADOS = 'perfil-dados-pessoais';
const PERFIL_LABEL = {
  ADMIN: 'Administrador do sistema',
  CLIENT: 'Dono da conta',
  ADMINISTRADOR: 'Administrador do CRM',
  VENDEDOR: 'Vendedor',
};

export default function PerfilPage() {
  const toast = useToast();
  const fileInput = useRef(null);
  const { user, refreshUser } = useAuthStore();
  const ehAdmin = user?.perfil === 'ADMIN';
  // Admin barrado por ADMIN_2FA_OBRIGATORIO (rota bloqueada ou 403 da API).
  const exige2fa = ehAdmin && user?.admin2faObrigatorio === true && user?.mfa !== true;
  // O layout do lojista tem o botão do topo; o do admin não.
  const temAcaoTopo = !!useContext(AcaoTopoContext);
  // Agenda e números do mês: só pra quem é de um negócio.
  const negocio = usePerfilNegocio(user);

  const [dados, setDados] = useState(() => ({ nome: user?.nome || '', email: user?.email || '', foto: user?.foto || '' }));
  // Trocar o e-mail de acesso pede a senha atual (a API recusa sem ela).
  const [senhaEmail, setSenhaEmail] = useState('');
  // Quando o usuario muda no store (refreshUser), recarrega o formulario
  // durante o render, sem efeito (evita render em cascata).
  const [userDoFormulario, setUserDoFormulario] = useState(user);
  if (user !== userDoFormulario) {
    setUserDoFormulario(user);
    if (user) setDados({ nome: user.nome || '', email: user.email || '', foto: user.foto || '' });
  }
  const [salvandoDados, setSalvandoDados] = useState(false);

  const [senha, setSenha] = useState({ atual: '', nova: '', confirmar: '' });
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [erroSenha, setErroSenha] = useState('');

  const handleUploadFoto = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Apenas imagens.');
      return;
    }
    if (file.size > MAX_FOTO_SIZE) {
      toast.error('Imagem muito grande. Máximo 10 MB.');
      return;
    }
    // Reduz pra 256 px antes de enviar (a API aceita ate ~300 KB).
    reduzirImagem(file, { lado: 256 })
      .then((foto) => setDados((d) => ({ ...d, foto })))
      .catch((err) => toast.error(err.message));
  };

  const handleRemoverFoto = () => {
    setDados((d) => ({ ...d, foto: '' }));
  };

  const handleSalvarDados = async (e) => {
    e.preventDefault();
    setSalvandoDados(true);
    try {
      const emailMudou = dados.email.trim().toLowerCase() !== String(user?.email || '').toLowerCase();
      if (emailMudou && !senhaEmail) {
        toast.error('Para trocar o e-mail, digite a sua senha atual.');
        return;
      }
      await api.put('/autenticacao/perfil', { ...dados, ...(emailMudou ? { senhaAtual: senhaEmail } : {}) });
      setSenhaEmail('');
      await refreshUser();
      toast.success('Perfil atualizado');
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Erro ao salvar');
    } finally {
      setSalvandoDados(false);
    }
  };

  const validacoesSenha = [
    { label: 'Pelo menos 8 caracteres', ok: senha.nova.length >= 8 && senha.nova.trim().length > 0 },
    { label: 'Diferente da senha atual', ok: senha.nova.length > 0 && senha.nova !== senha.atual },
    { label: 'Confirmação confere', ok: senha.nova.length > 0 && senha.nova === senha.confirmar },
  ];
  const senhaOk = validacoesSenha.every((v) => v.ok) && senha.atual.length > 0;

  const handleTrocarSenha = async (e) => {
    e.preventDefault();
    setErroSenha('');
    if (!senhaOk) return;
    setSalvandoSenha(true);
    try {
      await api.post('/autenticacao/trocar-senha', { senhaAtual: senha.atual, novaSenha: senha.nova });
      setSenha({ atual: '', nova: '', confirmar: '' });
      toast.success('Senha atualizada');
      await refreshUser();
    } catch (err) {
      setErroSenha(err.response?.data?.erro || 'Erro ao trocar senha.');
    } finally {
      setSalvandoSenha(false);
    }
  };

  const papel = PERFIL_LABEL[user?.perfil] || user?.perfil;
  const fotoPendente = (dados.foto || '') !== (user?.foto || '');

  // Botão "Salvar" no topo (layout do lojista): envia o formulário de dados
  // pessoais pelo atributo form, mesmo estando fora dele no DOM.
  useAcaoTopo(
    <Button size="sm" type="submit" form={ID_FORM_DADOS} icon={Save} loading={salvandoDados}>Salvar</Button>,
    [salvandoDados]
  );

  // Lateral só pra quem é do negócio e tem acesso à agenda; senão o
  // conteúdo ocupa a largura toda.
  const temLateral = negocio.ativo && (negocio.carregando || negocio.especialista !== undefined);
  const lateral = temLateral ? (
    <LateralPerfil
      carregando={negocio.carregando}
      especialista={negocio.especialista}
      mes={negocio.mes}
      horarioLoja={user?.horarioFuncionamento}
    />
  ) : null;

  return (
    <Pagina>
      <Link
        to={ehAdmin ? '/admin/configuracoes' : '/app/configuracoes'}
        className="self-start text-xs text-[var(--text-muted)] inline-flex items-center gap-1 hover:text-[var(--text-main)]"
      >
        <ArrowLeft size={12} aria-hidden="true" /> Configurações
      </Link>

      {exige2fa && (
        <div role="alert" className="flex items-start gap-3 px-4 py-3 rounded-[10px] bg-[var(--warning-soft)] text-[var(--warning-text)]">
          <ShieldAlert size={18} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-[13px]">
            <p className="m-0 font-semibold">Ative o código em 2 etapas para usar o painel admin.</p>
            <p className="m-0 mt-0.5">
              Por segurança, o administrador do sistema só acessa as outras telas depois de ligar o código do app autenticador.
              Configure abaixo; leva um minuto.
            </p>
          </div>
        </div>
      )}

      {exige2fa && <CodigoDuasEtapas />}

      {/* Cabeçalho: foto, nome, e-mail e papel */}
      <section
        aria-label="Seu perfil"
        className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] px-4 py-4 flex flex-wrap items-center gap-4"
      >
        <Avatar name={dados.nome || user?.nome} src={dados.foto || undefined} size="xl" />
        <div className="flex-1 min-w-[200px]">
          <h2 className="m-0 text-lg font-bold tracking-tight text-[var(--text-main)] [overflow-wrap:anywhere]">{user?.nome}</h2>
          <p className="m-0 mt-0.5 text-[13px] text-[var(--text-muted)] [overflow-wrap:anywhere]">{user?.email}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="success" size="sm" icon={ShieldCheck}>{papel}</Badge>
            {negocio.especialista && <Badge variant="info" size="sm">Profissional na agenda</Badge>}
            {user?.totpAtivo
              ? <Badge variant="success" size="sm">2 etapas ativo</Badge>
              : <Badge variant="neutral" size="sm">2 etapas desligado</Badge>}
          </div>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1.5">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Escolher foto do perfil"
              onChange={handleUploadFoto}
            />
            <Button variant="secondary" size="sm" icon={Upload} onClick={() => fileInput.current?.click()}>
              Trocar foto
            </Button>
            {dados.foto && (
              <Button variant="secondary" size="sm" icon={Trash2} onClick={handleRemoverFoto}>
                Remover foto
              </Button>
            )}
          </div>
          {fotoPendente && (
            <span role="status" className="text-xs font-medium text-[var(--warning-text)]">
              Clique em Salvar para aplicar a foto.
            </span>
          )}
        </div>
      </section>

      <ColunasPagina lateral={lateral}>
        {/* Dados pessoais */}
        <Painel
          id="dados-pessoais"
          titulo="Dados pessoais"
          subtitulo="Sua foto, nome e e-mail de acesso. Diferente do logo da empresa."
          semPadding
        >
          <form id={ID_FORM_DADOS} onSubmit={handleSalvarDados}>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Nome"
                icon={User}
                autoComplete="name"
                value={dados.nome}
                onChange={(e) => setDados({ ...dados, nome: e.target.value })}
                required
              />
              <Input
                label="E-mail de acesso"
                type="email"
                icon={Mail}
                autoComplete="email"
                hint="É o e-mail que você usa para entrar."
                value={dados.email}
                onChange={(e) => setDados({ ...dados, email: e.target.value })}
                required
              />
              {dados.email.trim().toLowerCase() !== String(user?.email || '').toLowerCase() && (
                <Input
                  label="Senha atual (para trocar o e-mail)"
                  type="password"
                  autoComplete="current-password"
                  value={senhaEmail}
                  onChange={(e) => setSenhaEmail(e.target.value)}
                  required
                />
              )}
            </div>
            {!temAcaoTopo && (
              <div className="flex justify-end px-4 py-3 border-t border-[var(--border-subtle)]">
                <Button type="submit" variant="primary" icon={Save} loading={salvandoDados}>
                  Salvar alterações
                </Button>
              </div>
            )}
          </form>
        </Painel>

        {/* Trocar senha */}
        <Painel id="trocar-senha" titulo="Senha" subtitulo="Mantenha sua senha forte e atualizada." semPadding>
          <form onSubmit={handleTrocarSenha} className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Senha atual"
              type="password"
              autoComplete="current-password"
              value={senha.atual}
              onChange={(e) => setSenha({ ...senha, atual: e.target.value })}
              required
            />
            <div className="hidden md:block" aria-hidden="true" />
            <Input
              label="Nova senha"
              type="password"
              autoComplete="new-password"
              value={senha.nova}
              onChange={(e) => setSenha({ ...senha, nova: e.target.value })}
              required
            />
            <Input
              label="Repita a nova senha"
              type="password"
              autoComplete="new-password"
              value={senha.confirmar}
              onChange={(e) => setSenha({ ...senha, confirmar: e.target.value })}
              required
            />

            <ul className="md:col-span-2 m-0 p-0 list-none flex flex-wrap gap-x-5 gap-y-1.5">
              {validacoesSenha.map((v) => (
                <li key={v.label} className="flex items-center gap-1.5 text-xs">
                  <CheckCircle2
                    size={14}
                    aria-hidden="true"
                    className={v.ok ? 'text-[var(--success)]' : 'text-[var(--text-muted)] opacity-40'}
                    strokeWidth={2}
                  />
                  <span className={v.ok ? 'text-[var(--text-main)] font-medium' : 'text-[var(--text-muted)]'}>
                    {v.label}
                  </span>
                </li>
              ))}
            </ul>

            {erroSenha && (
              <div role="alert" className="md:col-span-2 flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-[var(--danger-soft)]">
                <AlertCircle size={16} className="text-[var(--danger)] flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p className="m-0 text-[13px] text-[var(--danger-text)] font-medium">{erroSenha}</p>
              </div>
            )}

            <div className="md:col-span-2">
              <Button type="submit" variant="primary" icon={Lock} loading={salvandoSenha} disabled={!senhaOk}>
                Trocar senha
              </Button>
            </div>
          </form>
        </Painel>

        {!exige2fa && <CodigoDuasEtapas />}
      </ColunasPagina>
    </Pagina>
  );
}
