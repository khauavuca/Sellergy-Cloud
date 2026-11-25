import { useState, useMemo, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Kanban, Calendar, Package, Box,
  DollarSign, MessageCircle, Send, Bot, Settings, BarChart3, UserCog,
  CreditCard, Receipt, RotateCcw, Sun, ClipboardList, Wallet, Ticket, Percent
} from 'lucide-react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { linkAjuda } from '../utils/ajuda';
import AssinaturaBanner from './conta/AssinaturaBanner';
import FaixaSuporte from './suporte/FaixaSuporte';
import FaixaComunicado from './suporte/FaixaComunicado';
import BotaoAjuda from './suporte/BotaoAjuda';
import { useAuthStore } from '../store/auth.store';
import { AcaoTopoContext } from '../hooks/useAcaoTopo';
import { useUiStore } from '../store/ui.store';
import { moduloLiberado } from '../constants/permissoes';
import api from '../services/api';

// Mapeamento dos itens da sidebar para os modulos do tenant.
// Itens cujo modulo nao foi liberado pelo admin sao escondidos.
const NAV_OPERACAO = [
  { to: '/app/dashboard', label: 'Início', icon: LayoutDashboard, modulo: null },
  { to: '/app/hoje', label: 'Hoje', icon: Sun, modulo: null },
  { to: '/app/crm', label: 'Clientes', icon: Kanban, modulo: 'CRM' },
  { to: '/app/agenda', label: 'Agenda', icon: Calendar, modulo: 'AGENDA' },
  { to: '/app/vendas', label: 'Vendas', icon: ShoppingBag, modulo: 'VENDAS' },
  { to: '/app/pedidos', label: 'Pedidos', icon: ClipboardList, modulo: 'VENDAS' },
  { to: '/app/pacotes', label: 'Pacotes', icon: Ticket, modulo: 'AGENDA' },
  { to: '/app/devolucoes', label: 'Devoluções', icon: RotateCcw, modulo: 'VENDAS' },
  { to: '/app/catalogo', label: 'Serviços', icon: Package, modulo: 'CATALOGO' },
  {
    to: '/app/estoque',
    label: 'Estoque',
    icon: Box,
    modulo: 'ESTOQUE',
    subItems: [
      { to: '/app/estoque/visao-geral', label: 'Visão geral' },
      { to: '/app/estoque/produtos', label: 'Produtos' },
      { to: '/app/estoque/movimentacoes', label: 'Movimentações' },
      { to: '/app/estoque/reposicao', label: 'Reposição' },
      { to: '/app/estoque/categorias', label: 'Categorias' },
      { to: '/app/estoque/fornecedores', label: 'Fornecedores' },
      { to: '/app/estoque/notas', label: 'Entrada de nota' },
    ],
  },
];

const NAV_GESTAO = [
  {
    to: '/app/financeiro',
    label: 'Financeiro',
    icon: DollarSign,
    modulo: 'FINANCEIRO',
    subItems: [
      { to: '/app/financeiro/lancamentos', label: 'Lançamentos' },
      { to: '/app/financeiro/caixa', label: 'Caixa' },
      { to: '/app/financeiro/contas-pagar', label: 'Contas a pagar' },
      { to: '/app/financeiro/categorias', label: 'Categorias' },
    ],
  },
  { to: '/app/pagamentos', label: 'Pagamentos', icon: CreditCard, modulo: 'PAGAMENTOS' },
  { to: '/app/recebimentos', label: 'Conta de recebimento', icon: Wallet, modulo: 'PAGAMENTOS' },
  { to: '/app/comissoes', label: 'Comissões', icon: Percent, modulo: 'FINANCEIRO' },
  { to: '/app/fiscal', label: 'Fiscal', icon: Receipt, modulo: 'FISCAL' },
  {
    to: '/app/relatorios',
    label: 'Relatórios',
    icon: BarChart3,
    modulo: 'RELATORIOS',
    subItems: [
      { to: '/app/relatorios/visao-executiva', label: 'Visão executiva' },
      { to: '/app/relatorios/mensais', label: 'Fechamento mensal' },
      { to: '/app/relatorios/crm', label: 'CRM' },
      { to: '/app/relatorios/financeiro', label: 'Financeiro' },
      { to: '/app/relatorios/caixa', label: 'Caixa' },
      { to: '/app/relatorios/vendas', label: 'Vendas' },
      { to: '/app/relatorios/estoque', label: 'Estoque & CMV' },
      { to: '/app/relatorios/bots', label: 'Bots / IA' },
    ],
  },
];

const NAV_AUTOMACAO = [
  // So aparece com numero conectado (oficial configurado ou QR Code CONECTADO).
  { to: '/app/whatsapp', label: 'WhatsApp', icon: MessageCircle, modulo: 'CRM', precisaWhatsapp: true },
  { to: '/app/bots', label: 'Bots', icon: Bot, modulo: 'BOTS' },
  { to: '/app/campanhas', label: 'Campanhas', icon: Send, modulo: 'CRM' },
];

// Conta (Meu plano, Equipe, Importar, Configurações) fica no menu do avatar,
// no topo. Aqui ficam só os atalhos que a busca do topo também encontra.
const ATALHOS_CONTA = [
  { to: '/app/plano', label: 'Meu plano', grupo: 'Conta', perfis: ['CLIENT', 'ADMINISTRADOR'] },
  { to: '/app/importar', label: 'Importar planilha', grupo: 'Conta', perfis: ['CLIENT', 'ADMINISTRADOR'] },
  { to: '/app/usuarios', label: 'Equipe', grupo: 'Conta', perfis: ['CLIENT', 'ADMINISTRADOR'] },
  { to: '/app/configuracoes', label: 'Configurações', grupo: 'Conta' },
  { to: '/app/configuracoes/perfil', label: 'Meu perfil', grupo: 'Conta' },
  { to: '/app/agenda/encaixe', label: 'Lista de espera (encaixe)', grupo: 'Agenda', modulo: 'AGENDA' },
  { to: '/app/fiscal/ativar', label: 'Configurar nota fiscal', grupo: 'Fiscal', modulo: 'FISCAL' },
];

const TITULOS = {
  '/app/dashboard': { titulo: 'Início', breadcrumb: 'Painel' },
  '/app/crm': { titulo: 'Clientes', breadcrumb: 'Atendimento' },
  '/app/agenda': { titulo: 'Agenda', breadcrumb: 'Operação' },
  '/app/vendas': { titulo: 'Vendas', breadcrumb: 'Operação' },
  '/app/devolucoes': { titulo: 'Devoluções', breadcrumb: 'Operação' },
  '/app/catalogo': { titulo: 'Serviços', breadcrumb: 'Operação' },
  '/app/estoque': { titulo: 'Estoque', breadcrumb: 'Produtos' },
  '/app/estoque/visao-geral': { titulo: 'Estoque · Visão geral', breadcrumb: 'Estoque · Produtos' },
  '/app/estoque/produtos': { titulo: 'Estoque · Produtos', breadcrumb: 'Estoque · Produtos' },
  '/app/estoque/movimentacoes': { titulo: 'Estoque · Movimentações', breadcrumb: 'Estoque · Produtos' },
  '/app/estoque/reposicao': { titulo: 'Estoque · Reposição', breadcrumb: 'Estoque · Produtos' },
  '/app/estoque/categorias': { titulo: 'Estoque · Categorias', breadcrumb: 'Estoque · Produtos' },
  '/app/estoque/fornecedores': { titulo: 'Estoque · Fornecedores', breadcrumb: 'Estoque · Compras' },
  '/app/estoque/notas': { titulo: 'Estoque · Entrada de nota', breadcrumb: 'Estoque · Compras' },
  '/app/financeiro': { titulo: 'Financeiro', breadcrumb: 'Gestão' },
  '/app/financeiro/lancamentos': { titulo: 'Financeiro · Lançamentos', breadcrumb: 'Gestão' },
  '/app/financeiro/caixa': { titulo: 'Financeiro · Caixa', breadcrumb: 'Gestão' },
  '/app/financeiro/contas-pagar': { titulo: 'Financeiro · Contas a pagar', breadcrumb: 'Gestão' },
  '/app/financeiro/categorias': { titulo: 'Financeiro · Categorias', breadcrumb: 'Gestão' },
  '/app/pagamentos': { titulo: 'Pagamentos', breadcrumb: 'Gestão' },
  '/app/fiscal': { titulo: 'Fiscal', breadcrumb: 'Gestão' },
  '/app/relatorios': { titulo: 'Relatórios', breadcrumb: 'Gestão' },
  '/app/relatorios/visao-executiva': { titulo: 'Relatório · Visão executiva', breadcrumb: 'Relatórios · Gestão' },
  '/app/relatorios/mensais': { titulo: 'Fechamento mensal', breadcrumb: 'Relatórios · Gestão' },
  '/app/relatorios/crm': { titulo: 'Relatório · CRM', breadcrumb: 'Relatórios · Gestão' },
  '/app/relatorios/financeiro': { titulo: 'Relatório · Financeiro', breadcrumb: 'Relatórios · Gestão' },
  '/app/relatorios/caixa': { titulo: 'Relatório · Caixa', breadcrumb: 'Relatórios · Gestão' },
  '/app/relatorios/vendas': { titulo: 'Relatório · Vendas', breadcrumb: 'Relatórios · Gestão' },
  '/app/relatorios/estoque': { titulo: 'Relatório · Estoque & CMV', breadcrumb: 'Relatórios · Gestão' },
  '/app/relatorios/bots': { titulo: 'Relatório · Bots / IA', breadcrumb: 'Relatórios · Gestão' },
  '/app/bots': { titulo: 'Bots', breadcrumb: 'Automação' },
  '/app/whatsapp': { titulo: 'WhatsApp', breadcrumb: 'Automação' },
  '/app/campanhas': { titulo: 'Campanhas', breadcrumb: 'Automação' },
  '/app/campanhas/nova': { titulo: 'Nova campanha', breadcrumb: 'Automação · Campanhas' },
  '/app/usuarios': { titulo: 'Equipe', breadcrumb: 'Conta' },
  '/app/configuracoes': { titulo: 'Configurações', breadcrumb: 'Conta' },
  '/app/plano': { titulo: 'Meu plano', breadcrumb: 'Conta' },
  '/app/hoje': { titulo: 'Hoje', breadcrumb: 'Operação' },
  '/app/pedidos': { titulo: 'Pedidos', breadcrumb: 'Operação' },
  '/app/pacotes': { titulo: 'Pacotes', breadcrumb: 'Operação' },
  '/app/agenda/encaixe': { titulo: 'Lista de espera', breadcrumb: 'Operação · Agenda' },
  '/app/recebimentos': { titulo: 'Conta de recebimento', breadcrumb: 'Gestão' },
  '/app/comissoes': { titulo: 'Comissões', breadcrumb: 'Gestão' },
  '/app/fiscal/ativar': { titulo: 'Configurar nota fiscal', breadcrumb: 'Gestão · Fiscal' },
  '/app/importar': { titulo: 'Importar planilha', breadcrumb: 'Conta' },
  '/app/configuracoes/perfil': { titulo: 'Meu perfil', breadcrumb: 'Conta' },
};

export default function ClientLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [acaoTopo, setAcaoTopo] = useState(null);
  const menuAberto = useUiStore((s) => s.menuAberto);
  const alternarMenu = useUiStore((s) => s.alternarMenu);
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const modulosLiberados = user?.modulosLiberados;
  const perfil = user?.perfil;
  const crmLiberado = moduloLiberado(modulosLiberados || {}, 'CRM');

  // WhatsApp conectado + nao lidas (item "WhatsApp" do menu). Rele ao navegar.
  const [whatsapp, setWhatsapp] = useState(null);
  useEffect(() => {
    if (!crmLiberado || perfil === 'ADMIN') return;
    api.get('/conversas/canal').then((r) => setWhatsapp(r.data)).catch(() => setWhatsapp(null));
  }, [crmLiberado, perfil, location.pathname]);

  // Filtra os itens conforme os modulos liberados pelo admin para este tenant.
  const sections = useMemo(() => {
    const liberados = modulosLiberados || {};
    const filtra = (arr) => arr.filter((item) => !item.modulo || moduloLiberado(liberados, item.modulo));
    const operacao = filtra(NAV_OPERACAO);
    const gestao = filtra(NAV_GESTAO);
    const automacao = NAV_AUTOMACAO
      .filter((item) => moduloLiberado(liberados, item.modulo))
      .filter((item) => !item.precisaWhatsapp || whatsapp?.conectado)
      .map((item) => (item.precisaWhatsapp ? { ...item, badge: whatsapp?.naoLidas || 0 } : item));

    const result = [];
    if (operacao.length) result.push({ titulo: 'Operação', items: operacao });
    if (gestao.length) result.push({ titulo: 'Gestão', items: gestao });
    if (automacao.length) result.push({ titulo: 'Automação', items: automacao });
    return result;
  }, [modulosLiberados, whatsapp]);

  // Tudo que a busca do topo encontra: itens do menu, sub-itens e atalhos da conta.
  const atalhos = useMemo(() => {
    const lista = [];
    sections.forEach((sec) => sec.items.forEach((item) => {
      if (item.subItems) item.subItems.forEach((s) => lista.push({ to: s.to, label: `${item.label} · ${s.label}`, grupo: sec.titulo }));
      else lista.push({ to: item.to, label: item.label, grupo: sec.titulo });
    }));
    const liberados = modulosLiberados || {};
    ATALHOS_CONTA.forEach((a) => {
      if (a.perfis && !a.perfis.includes(perfil)) return;
      if (a.modulo && !moduloLiberado(liberados, a.modulo)) return;
      lista.push(a);
    });
    return lista;
  }, [sections, modulosLiberados, perfil]);

  const meta = TITULOS[location.pathname] || { titulo: 'Sellergy Cloud', breadcrumb: '' };

  return (
    <div className="min-h-screen bg-[var(--bg-app)]">
      <Sidebar
        sections={sections}
        aberto={menuAberto}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onToggle={alternarMenu}
        branding={user?.branding}
      />

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-[var(--bg-overlay)] backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* O conteudo anda junto com a largura do menu: nada fica coberto. */}
      <div className={`min-h-screen flex flex-col transition-[padding] duration-200 ease-out ${menuAberto ? 'lg:pl-[240px]' : 'lg:pl-[68px]'}`}>
        <Topbar
          titulo={meta.titulo}
          breadcrumb={meta.breadcrumb}
          onMenuClick={() => setSidebarOpen(true)}
          onToggleMenu={alternarMenu}
          atalhos={atalhos}
          actions={acaoTopo}
          ajuda={linkAjuda(location.pathname)}
        />
        <main className="flex-1 min-w-0 px-4 sm:px-6 pt-5 pb-24">
          {/* Full-width: o conteudo ocupa toda a largura disponivel. Paginas
              com formulario (Configuracoes, PerfilPage, CrmUsersPage) tem
              max-w proprio e continuam centradas — listas/tabelas/dashboards
              esticam pra aproveitar a tela inteira. */}
          <FaixaSuporte />
          <FaixaComunicado />
          <AssinaturaBanner />
          <AcaoTopoContext.Provider value={setAcaoTopo}>
            <Outlet />
          </AcaoTopoContext.Provider>
          <BotaoAjuda />
        </main>
      </div>
    </div>
  );
}
