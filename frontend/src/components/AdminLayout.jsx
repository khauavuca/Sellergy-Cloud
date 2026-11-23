import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, ShieldCheck, Bot, Bell, BarChart3,
  Settings, Sparkles, CreditCard, LifeBuoy, Activity, Megaphone, Gauge, Tags, ScrollText
} from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuthStore } from '../store/auth.store';
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
      { to: '/admin/bots', label: 'Bots', icon: Bot, acao: null },
      { to: '/admin/alertas', label: 'Alertas', icon: Bell, acao: null },
      { to: '/admin/relatorios', label: 'Relatorios', icon: BarChart3, acao: null },
      { to: '/admin/suporte', label: 'Suporte', icon: LifeBuoy, acao: 'suporte.ver' },
      { to: '/admin/comunicados', label: 'Comunicados', icon: Megaphone, acao: 'comunicados.ver' },
      { to: '/admin/saude', label: 'Saúde do sistema', icon: Activity, acao: 'saude.ver' },
    ],
  },
  {
    titulo: 'Sistema',
    items: [
      { to: '/admin/equipe', label: 'Equipe e auditoria', icon: ScrollText, acao: 'equipe.gerenciar' },
      { to: '/admin/usuarios', label: 'Usuários', icon: Users, acao: null },
      { to: '/admin/configuracoes', label: 'Configuracoes', icon: Settings, acao: null },
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
  '/admin/bots': { titulo: 'Bots', breadcrumb: 'Operacao' },
  '/admin/campanhas': { titulo: 'Campanhas', breadcrumb: 'Operacao' },
  '/admin/alertas': { titulo: 'Alertas', breadcrumb: 'Operacao' },
  '/admin/relatorios': { titulo: 'Relatorios', breadcrumb: 'Operacao' },
  '/admin/usuarios': { titulo: 'Equipe', breadcrumb: 'Sistema' },
  '/admin/configuracoes': { titulo: 'Configuracoes', breadcrumb: 'Sistema' },
  '/admin/_design': { titulo: 'Design system', breadcrumb: 'Sistema' },
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
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const secoes = secoesDoPapel(user);

  const meta = TITULOS[location.pathname] || resolveDinamico(location.pathname);

  return (
    <div className="min-h-screen bg-[var(--bg-app)]">
      <Sidebar
        sections={secoes}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-[var(--bg-overlay)] backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="lg:pl-20 min-h-screen flex flex-col">
        <Topbar
          titulo={meta.titulo}
          breadcrumb={meta.breadcrumb}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          <div className="max-w-[1400px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function resolveDinamico(path) {
  if (path.startsWith('/admin/clientes/')) return { titulo: 'Detalhes do cliente', breadcrumb: 'Clientes' };
  if (path.match(/^\/admin\/bots\/[^/]+\/canal$/)) return { titulo: 'Canal do bot', breadcrumb: 'Bots' };
  return { titulo: 'Sellergy Cloud', breadcrumb: 'Admin' };
}
