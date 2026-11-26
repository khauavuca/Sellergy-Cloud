import { useNavigate } from 'react-router-dom';
import { User, Settings, LogOut, Sun, Moon, ChevronDown, Users, BadgeCheck, Upload } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';
import { useUiStore } from '../store/ui.store';
import { Avatar, Dropdown, DropdownItem, DropdownDivider, DropdownLabel } from './ui';

/**
 * Avatar + dropdown no canto superior direito.
 * Usado tanto pelo AdminLayout quanto pelo ClientLayout.
 */
export default function UserMenu() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useUiStore();

  // Recarrega direto na tela de login certa. Com navigate() a sessao some
  // antes da troca de rota e a protecao das telas redirecionava por conta propria.
  const handleLogout = async () => {
    const destino = user?.perfil === 'ADMIN' ? '/admin/login' : '/app/login';
    await logout();
    window.location.assign(destino);
  };

  const ehAdmin = user?.perfil === 'ADMIN';
  // Dono e administrador do negocio veem os atalhos da conta.
  const donoOuAdmin = ['CLIENT', 'ADMINISTRADOR'].includes(user?.perfil);
  const rotaConfig = '/app/configuracoes';
  const rotaPerfil = ehAdmin ? '/admin/configuracoes/perfil' : '/app/configuracoes/perfil';

  const tagPerfil = {
    ADMIN: 'Administrador do sistema',
    CLIENT: 'Dono da conta',
    ADMINISTRADOR: 'Administrador',
    VENDEDOR: 'Vendedor',
  }[user?.perfil] || '';

  return (
    <Dropdown
      align="right"
      trigger={
        <button className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl hover:bg-[var(--bg-subtle)] transition-colors">
          <Avatar name={user?.nome || user?.name} src={user?.foto} size="sm" />
          <div className="hidden md:block text-left">
            <div className="text-sm font-semibold text-[var(--text-main)] leading-tight tracking-tight">
              {user?.nome || user?.name || 'Usuario'}
            </div>
            <div className="text-[11px] text-[var(--text-muted)] leading-tight">
              {tagPerfil}
            </div>
          </div>
          <ChevronDown size={14} className="text-[var(--text-muted)]" />
        </button>
      }
    >
      <DropdownLabel>{user?.email}</DropdownLabel>
      <DropdownItem icon={User} onClick={() => navigate(rotaPerfil)}>
        Meu perfil
      </DropdownItem>
      {!ehAdmin && (
        <DropdownItem icon={Settings} onClick={() => navigate(rotaConfig)}>
          Configurações
        </DropdownItem>
      )}
      {donoOuAdmin && (
        <>
          <DropdownItem icon={Users} onClick={() => navigate('/app/usuarios')}>
            Equipe
          </DropdownItem>
          <DropdownItem icon={BadgeCheck} onClick={() => navigate('/app/plano')}>
            Meu plano
          </DropdownItem>
          <DropdownItem icon={Upload} onClick={() => navigate('/app/importar')}>
            Importar planilha
          </DropdownItem>
        </>
      )}
      <DropdownDivider />
      <DropdownItem
        icon={theme === 'dark' ? Sun : Moon}
        onClick={toggleTheme}
      >
        {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
      </DropdownItem>
      <DropdownDivider />
      <DropdownItem icon={LogOut} variant="danger" onClick={handleLogout}>
        Sair
      </DropdownItem>
    </Dropdown>
  );
}
