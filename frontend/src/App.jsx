import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { useAuthStore } from './store/auth.store';
import { useUiStore } from './store/ui.store';
import { ToastProvider } from './components/ui';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const ClientLoginPage = lazy(() => import('./pages/ClientLoginPage'));
import LandingPage from './pages/LandingPage';
import AvisoCookies from './components/legal/AvisoCookies';
const TrocaSenhaPage = lazy(() => import('./pages/TrocaSenhaPage'));
const CadastroPage = lazy(() => import('./pages/CadastroPage'));
const AgendarPage = lazy(() => import('./pages/AgendarPage'));
const ConfirmarPage = lazy(() => import('./pages/ConfirmarPage'));

const AdminLayout = lazy(() => import('./components/AdminLayout'));
const ClientLayout = lazy(() => import('./components/ClientLayout'));

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ClientDashboardPage = lazy(() => import('./pages/ClientDashboardPage'));
const DesignShowcasePage = lazy(() => import('./pages/DesignShowcasePage'));

// Paginas reais do cliente (Pacote 3) - jaa rodando.
// Cliente
const CRMPage = lazy(() => import('./pages/CRMPage'));
const AgendaPage = lazy(() => import('./pages/AgendaPage'));
const VendasPage = lazy(() => import('./pages/VendasPage'));
const DevolucoesPage = lazy(() => import('./pages/DevolucoesPage'));
const CatalogoPage = lazy(() => import('./pages/CatalogoPage'));
const EstoquePage = lazy(() => import('./pages/EstoquePage'));
const FornecedoresPage = lazy(() => import('./pages/FornecedoresPage'));
const EntradaNotaPage = lazy(() => import('./pages/EntradaNotaPage'));
const FinanceiroPage = lazy(() => import('./pages/FinanceiroPage'));
const CrmUsersPage = lazy(() => import('./pages/CrmUsersPage'));
const ConfiguracoesPage = lazy(() => import('./pages/ConfiguracoesPage'));
const PerfilPage = lazy(() => import('./pages/PerfilPage'));
const PagamentosPage = lazy(() => import('./pages/PagamentosPage'));
const FiscalPage = lazy(() => import('./pages/FiscalPage'));
const PlanoPage = lazy(() => import('./pages/PlanoPage'));

// Admin
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const AdminPermissoesClientePage = lazy(() => import('./pages/AdminPermissoesClientePage'));
const BotsPage = lazy(() => import('./pages/BotsPage'));
const BotCanalPage = lazy(() => import('./pages/BotCanalPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const RelatoriosPage = lazy(() => import('./pages/RelatoriosPage'));
const RelatorioMensalDetalhePage = lazy(() => import('./pages/RelatorioMensalDetalhePage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const ConfiguracoesAdminPage = lazy(() => import('./pages/ConfiguracoesAdminPage'));
const CampanhasPage = lazy(() => import('./pages/CampanhasPage'));
const BotsClientePage = lazy(() => import('./pages/BotsClientePage'));
const AdminAssinaturasPage = lazy(() => import('./pages/AdminAssinaturasPage'));
const TermosPage = lazy(() => import('./pages/TermosPage'));
const PrivacidadePage = lazy(() => import('./pages/PrivacidadePage'));
// Fase 2
const EncaixePage = lazy(() => import('./pages/EncaixePage'));
const PacotesPage = lazy(() => import('./pages/PacotesPage'));
const ComissoesPage = lazy(() => import('./pages/ComissoesPage'));
const EncaixeRespostaPage = lazy(() => import('./pages/EncaixeRespostaPage'));
const PedidosPage = lazy(() => import('./pages/PedidosPage'));
const RecebimentosPage = lazy(() => import('./pages/RecebimentosPage'));
const LojaPage = lazy(() => import('./pages/LojaPage'));
const PedidoPublicoPage = lazy(() => import('./pages/PedidoPublicoPage'));
const ImportarPage = lazy(() => import('./pages/ImportarPage'));
const AssistenteFiscalPage = lazy(() => import('./pages/AssistenteFiscalPage'));
const HojePage = lazy(() => import('./pages/HojePage'));
const ConvitePage = lazy(() => import('./pages/ConvitePage'));
const AdminSuportePage = lazy(() => import('./pages/AdminSuportePage'));
const AdminSaudePage = lazy(() => import('./pages/AdminSaudePage'));
const AdminComunicadosPage = lazy(() => import('./pages/AdminComunicadosPage'));
const AdminUsoPage = lazy(() => import('./pages/AdminUsoPage'));
const AdminEquipePage = lazy(() => import('./pages/AdminEquipePage'));
const AdminPlanosPage = lazy(() => import('./pages/AdminPlanosPage'));

// Bots do tenant: tela real BotsClientePage (conexao + FAQ), Frente 4.
// `RelatoriosClientePlaceholder` removido — agora usa RelatoriosPage real.

// Cada tela vira um arquivo separado (carrega so quando abre): a landing
// nao baixa o app inteiro.
function CarregandoPagina() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-app)]" role="status" aria-live="polite">
      <div className="w-7 h-7 border-2 border-[var(--border-strong)] border-t-[var(--text-main)] rounded-full animate-spin" />
      <span className="sr-only">Carregando</span>
    </div>
  );
}

const ProtectedRoute = ({ children }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // Sem sessao vai sempre pro login do cliente: o do admin nao aparece pra
  // quem so tentou abrir uma tela interna.
  if (!isAuthenticated) return <Navigate to="/app/login" replace />;
  return children;
};

const TrocaSenhaGate = ({ children }) => {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  if (user?.deveTrocarSenha && location.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />;
  }
  return children;
};

const AdminOnly = ({ children }) => {
  const user = useAuthStore((s) => s.user);
  if (user?.perfil !== 'ADMIN') return <Navigate to="/app/dashboard" replace />;
  return children;
};

// ADMIN_2FA_OBRIGATORIO ligado e sessao sem o segundo fator: o admin so usa a
// tela do perfil (onde ativa o codigo). A API barra o resto com 403 tambem.
const ROTA_PERFIL_ADMIN = '/admin/configuracoes/perfil';
const Admin2faGate = ({ children }) => {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const exige = user?.perfil === 'ADMIN' && user?.admin2faObrigatorio === true && user?.mfa !== true;
  if (exige && location.pathname !== ROTA_PERFIL_ADMIN) {
    return <Navigate to={`${ROTA_PERFIL_ADMIN}?aviso=2fa`} replace />;
  }
  return children;
};

const TenantOnly = ({ children }) => {
  const user = useAuthStore((s) => s.user);
  if (user?.perfil === 'ADMIN') return <Navigate to="/admin/dashboard" replace />;
  return children;
};

export default function App() {
  const { checkAuth, isCheckingAuth } = useAuthStore();
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [theme]);

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-app)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-7 h-7 border-2 border-[var(--border-strong)] border-t-[var(--text-main)] rounded-full animate-spin" />
          <p className="text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider">
            Carregando
          </p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={<CarregandoPagina />}>
        <Routes>
          {/* Publicas */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/admin/login" element={<LoginPage isAdmin />} />
          <Route path="/app/login" element={<ClientLoginPage />} />
          <Route path="/cadastro" element={<CadastroPage />} />
          {/* Publicas, sem login: agendamento pelo link e confirmacao do lembrete */}
          <Route path="/agendar/:slug" element={<AgendarPage />} />
          <Route path="/confirmar/:token" element={<ConfirmarPage />} />
          <Route path="/termos" element={<TermosPage />} />
          <Route path="/privacidade" element={<PrivacidadePage />} />
          <Route path="/encaixe/:token" element={<EncaixeRespostaPage />} />
          <Route path="/loja/:slug" element={<LojaPage />} />
          <Route path="/pedido/:token" element={<PedidoPublicoPage />} />
          <Route path="/convite/:token" element={<ConvitePage />} />
          <Route path="/login" element={<Navigate to="/app/login" replace />} />

          {/* Troca de senha (autenticado, mas fora dos layouts) */}
          <Route
            path="/trocar-senha"
            element={
              <ProtectedRoute>
                <TrocaSenhaPage />
              </ProtectedRoute>
            }
          />

          {/* ECOSSISTEMA ADMIN */}
          <Route
            element={
              <ProtectedRoute>
                <TrocaSenhaGate>
                  <AdminOnly>
                    <Admin2faGate>
                      <AdminLayout />
                    </Admin2faGate>
                  </AdminOnly>
                </TrocaSenhaGate>
              </ProtectedRoute>
            }
          >
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/admin/dashboard" element={<DashboardPage />} />
            <Route path="/admin/clientes" element={<ClientsPage />} />
            <Route path="/admin/clientes/permissoes" element={<AdminPermissoesClientePage />} />
            <Route path="/admin/clientes/:id" element={<ClientsPage />} />
            <Route path="/admin/assinaturas" element={<AdminAssinaturasPage />} />
            <Route path="/admin/suporte" element={<AdminSuportePage />} />
            <Route path="/admin/saude" element={<AdminSaudePage />} />
            <Route path="/admin/comunicados" element={<AdminComunicadosPage />} />
            <Route path="/admin/uso" element={<AdminUsoPage />} />
            <Route path="/admin/equipe" element={<AdminEquipePage />} />
            <Route path="/admin/planos" element={<AdminPlanosPage />} />
            <Route path="/admin/bots" element={<BotsPage />} />
            <Route path="/admin/bots/:botId/canal" element={<BotCanalPage />} />
            <Route path="/admin/alertas" element={<AlertsPage />} />
            <Route path="/admin/relatorios" element={<ReportsPage />} />
            <Route path="/admin/usuarios" element={<UsersPage />} />
            <Route path="/admin/configuracoes" element={<ConfiguracoesAdminPage />} />
            <Route path="/admin/configuracoes/perfil" element={<PerfilPage />} />
            <Route path="/admin/_design" element={<DesignShowcasePage />} />
          </Route>

          {/* ECOSSISTEMA CLIENTE */}
          <Route
            element={
              <ProtectedRoute>
                <TrocaSenhaGate>
                  <TenantOnly>
                    <ClientLayout />
                  </TenantOnly>
                </TrocaSenhaGate>
              </ProtectedRoute>
            }
          >
            <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
            <Route path="/app/dashboard" element={<ClientDashboardPage />} />
            <Route path="/app/crm" element={<CRMPage />} />
            <Route path="/app/agenda" element={<AgendaPage />} />
            <Route path="/app/vendas" element={<VendasPage />} />
            <Route path="/app/devolucoes" element={<DevolucoesPage />} />
            <Route path="/app/catalogo" element={<CatalogoPage />} />
            <Route path="/app/estoque" element={<Navigate to="/app/estoque/visao-geral" replace />} />
            {/* Rotas especificas precisam vir ANTES do catch-all :aba. */}
            <Route path="/app/estoque/fornecedores" element={<FornecedoresPage />} />
            <Route path="/app/estoque/notas" element={<EntradaNotaPage />} />
            <Route path="/app/estoque/:aba" element={<EstoquePage />} />
            <Route path="/app/financeiro" element={<Navigate to="/app/financeiro/lancamentos" replace />} />
            <Route path="/app/financeiro/:aba" element={<FinanceiroPage />} />
            <Route path="/app/relatorios" element={<Navigate to="/app/relatorios/visao-executiva" replace />} />
            {/* Detalhe do snapshot mensal — rota mais específica precisa vir ANTES da :aba. */}
            <Route path="/app/relatorios/mensais/:periodo" element={<RelatorioMensalDetalhePage />} />
            <Route path="/app/relatorios/:aba" element={<RelatoriosPage />} />
            <Route path="/app/bots" element={<BotsClientePage />} />
            <Route path="/app/campanhas" element={<CampanhasPage />} />
            <Route path="/app/pagamentos" element={<PagamentosPage />} />
            <Route path="/app/fiscal" element={<FiscalPage />} />
            <Route path="/app/usuarios" element={<CrmUsersPage />} />
            <Route path="/app/configuracoes" element={<ConfiguracoesPage />} />
            <Route path="/app/plano" element={<PlanoPage />} />
            <Route path="/app/agenda/encaixe" element={<EncaixePage />} />
            <Route path="/app/pacotes" element={<PacotesPage />} />
            <Route path="/app/comissoes" element={<ComissoesPage />} />
            <Route path="/app/pedidos" element={<PedidosPage />} />
            <Route path="/app/recebimentos" element={<RecebimentosPage />} />
            <Route path="/app/importar" element={<ImportarPage />} />
            <Route path="/app/fiscal/ativar" element={<AssistenteFiscalPage />} />
            <Route path="/app/hoje" element={<HojePage />} />
            <Route path="/app/configuracoes/perfil" element={<PerfilPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        <AvisoCookies />
      </BrowserRouter>
    </ToastProvider>
  );
}
