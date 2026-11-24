import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, ShieldCheck, CreditCard, LifeBuoy, Activity, Megaphone, Gauge, Tags, ScrollText
} from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuthStore } from '../store/auth.store';
import { useUiStore } from '../store/ui.store';
import { AcaoTopoContext } from '../hooks/useAcaoTopo';
import Topbar from './Topbar';

const SECTIONS = [
  {
    titulo: 'Geral',
    items: [
      { to: '/admin/dashboard', label: 'Visão geral', icon: LayoutDashboard, acao: 'painel.ver' },
    ],
  },
  {
    titulo: 'Clientes',
    items: [
      { to: '/admin/clientes', label: 'Lista de clientes', icon: Users, acao: null },
      { to: '/admin/clientes/permissoes', label: 'Permissoes', icon: ShieldCheck, acao: null },
      { to: '/admin/assinaturas', label: 'Assinaturas', icon: CreditCard, acao: 'clientes.ver' },
      { to: '/admin/planos', label: 'Planos e preços', icon: Tags, acao: 'precos.editar' },
      { to: '/admin/uso', label: 'Uso e custos', icon: Gauge, acao: 'uso.ver' },
    ],
  },
  {
    titulo: 'Operacao',
    items: [
      { to: '/admin/suporte', label: 'Suporte', icon: LifeBuoy, acao: 'suporte.ver' },
      { to: '/admin/comunicados', label: 'Comunicados', icon: Megaphone, acao: 'comunicados.ver' },
      { to: '/admin/saude', label: 'Saúde do sistema', icon: Activity, acao: 'saude.ver' },
    ],
  },
  {
    titulo: 'Sistema',
    items: [
      { to: '/admin/equipe', label: 'Equipe e auditoria', icon: ScrollText, acao: 'equipe.gerenciar' },
    ],
  },
];

const TITULOS = {
  '/admin/dashboard': { titulo: 'Visão geral', breadcrumb: 'Painel' },
  '/admin/clientes': { titulo: 'Clientes', breadcrumb: 'Gestao' },
  '/admin/clientes/permissoes': { titulo: 'Permissoes por cliente', breadcrumb: 'Gestao · Clientes' },
  '/admin/assinaturas': { titulo: 'Assinaturas', breadcrumb: 'Gestão · Clientes' },
  '/admin/planos': { titulo: 'Planos e preços', breadcrumb: 'Gestão · Clientes' },
  '/admin/uso': { titulo: 'Uso e custos', breadcrumb: 'Gestão · Clientes' },
  '/admin/suporte': { titulo: 'Suporte', breadcrumb: 'Operação' },
  '/admin/comunicados': { titulo: 'Comunicados', breadcrumb: 'Operação' },
  '/admin/saude': { titulo: 'Saúde do sistema', breadcrumb: 'Operação' },
  '/admin/equipe': { titulo: 'Equipe e auditoria', breadcrumb: 'Sistema' },
  '/admin/configuracoes/perfil': { titulo: 'Meu perfil', breadcrumb: 'Sistema' },
};

// Esconde do menu o que o papel nao pode (Suporte, Financeiro). acao null =
// telas antigas do admin, so pro Dono. Quem barra de verdade e a API.
function secoesDoPapel(user) {
  const acoes = Array.isArray(user?.acoesAdmin) ? user.acoesAdmin : null;
  const dono = !user?.papelAdmin || user.papelAdmin === 'DONO';
  if (dono || !acoes) return SECTIONS;
  return SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => i.acao && acoes.includes(i.acao)) }))
    .filter((s) => s.items.length > 0);
}

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [acaoTopo, setAcaoTopo] = useState(null);
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const secoes = secoesDoPapel(user);
  const menuAberto = useUiStore((s) => s.menuAberto);
  const alternarMenu = useUiStore((s) => s.alternarMenu);
  const atalhos = secoes.flatMap((sec) => sec.items.map((i) => ({ to: i.to, label: i.label, grupo: sec.titulo })));

  const meta = TITULOS[location.pathname] || resolveDinamico(location.pathname);

  return (
    <div className="min-h-screen bg-[var(--bg-app)]">
      <Sidebar
        sections={secoes}
        aberto={menuAberto}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onToggle={alternarMenu}
        subtitulo="Painel Sellergy"
      />

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-[var(--bg-overlay)] backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`min-h-screen flex flex-col transition-[padding] duration-200 ease-out ${menuAberto ? 'lg:pl-[240px]' : 'lg:pl-[68px]'}`}>
        <Topbar
          titulo={meta.titulo}
          breadcrumb={meta.breadcrumb}
          onMenuClick={() => setSidebarOpen(true)}
          onToggleMenu={alternarMenu}
          atalhos={atalhos}
          actions={acaoTopo}
        />
        <main className="flex-1 min-w-0 px-4 sm:px-6 py-5">
          <AcaoTopoContext.Provider value={setAcaoTopo}>
            <Outlet />
          </AcaoTopoContext.Provider>
        </main>
      </div>
    </div>
  );
}

function resolveDinamico(path) {
  if (path.startsWith('/admin/clientes/')) return { titulo: 'Detalhes do cliente', breadcrumb: 'Clientes' };
  return { titulo: 'Sellergy Cloud', breadcrumb: 'Admin' };
}
