import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  Sun, Moon, Upload, ImageIcon, Trash2, Save, Building2, AlertCircle, Clock, Bell,
  Users, CreditCard, LayoutGrid, CalendarDays, BellRing, Link2, MessageCircle,
  BookOpen, RotateCcw, Receipt, FileUp, Palette, ArrowUpRight
} from 'lucide-react';
import api from '../services/api';
import { reduzirImagem } from '../utils/reduzirImagem';
import notificacaoService from '../services/notificacaoService';
import catalogoService from '../services/catalogoService';
import devolucaoService from '../services/devolucaoService';
import SellergyLogo from '../components/SellergyLogo';
import { useAuthStore } from '../store/auth.store';
import { useUiStore } from '../store/ui.store';
import { useResumoConta } from '../components/conta/useResumoConta';
import ProntidaoNegocio from '../components/configuracoes/ProntidaoNegocio';
import {
  BlocoLembretes, BlocoLinkAgendamento, PreviaLembrete, LinhaOpcao
} from '../components/configuracoes/BlocosAtendimento';
import {
  Button, Input, Select, Badge, useToast, Switch, Pagina, Painel
} from '../components/ui';

const MAX_LOGO_SIZE = 10 * 1024 * 1024; // arquivo escolhido; e reduzido antes de enviar

/**
 * Configurações do CLIENTE — central de ajustes.
 *
 * Menu de seções à esquerda (dentro do conteúdo), agrupado em Negócio,
 * Atendimento, Vendas e Sistema. Cada seção abre o seu formulário no meio;
 * itens que são outra tela (Equipe, Meu plano, WhatsApp e bot, Nota fiscal,
 * Importar) são links. A seção aberta fica na URL (?secao=horario).
 * Coluna da direita: "seu negócio está X% pronto" (checklist do Início) e
 * uma dica da seção.
 *
 * IMPORTANTE: a edição da identidade visual (logo + nome) é diferente
 * de "Meu perfil" (foto + dados pessoais).
 */
export default function ConfiguracoesPage() {
  const toast = useToast();
  const { user, refreshUser } = useAuthStore();
  const { theme, setTheme, menuAberto, alternarMenu } = useUiStore();
  const { resumo, recarregar } = useResumoConta();
  const [params, setParams] = useSearchParams();

  const podeEditarOperacao = user?.perfil === 'CLIENT' || user?.perfil === 'ADMINISTRADOR';
  const podeVerCatalogo = !!user?.modulosLiberados?.CATALOGO;
  const temAgenda = !!user?.modulosLiberados?.AGENDA;
  const vendeSoProduto = resumo?.negocio?.segmento === 'PRODUTO';

  // Monta o menu (só com o que esta conta tem).
  const grupos = [
    {
      titulo: 'Negócio',
      itens: [
        { id: 'negocio', rotulo: 'Dados e marca', icone: Building2 },
        { id: 'horario', rotulo: 'Horário de funcionamento', icone: Clock, pendente: podeEditarOperacao && !user?.horarioFuncionamento },
        { href: '/app/usuarios', rotulo: 'Equipe e permissões', icone: Users },
        { href: '/app/plano', rotulo: 'Meu plano', icone: CreditCard },
        { id: 'modulos', rotulo: 'Módulos liberados', icone: LayoutGrid },
      ],
    },
    {
      titulo: 'Atendimento',
      itens: [
        temAgenda && { id: 'agenda', rotulo: 'Agenda e sinal', icone: CalendarDays },
        temAgenda && { id: 'lembretes', rotulo: 'Lembretes', icone: BellRing },
        temAgenda && !vendeSoProduto && { id: 'link', rotulo: 'Link de agendamento', icone: Link2 },
        { href: '/app/bots', rotulo: 'WhatsApp e bot', icone: MessageCircle },
      ].filter(Boolean),
    },
    {
      titulo: 'Vendas',
      itens: [
        { id: 'catalogo', rotulo: 'Catálogo', icone: BookOpen },
        { id: 'devolucao', rotulo: 'Devoluções e aluguel', icone: RotateCcw },
        { href: '/app/fiscal/ativar', rotulo: 'Nota fiscal', icone: Receipt },
        { href: '/app/importar', rotulo: 'Importar planilha', icone: FileUp },
      ],
    },
    {
      titulo: 'Sistema',
      itens: [
        { id: 'notificacoes', rotulo: 'Notificações', icone: Bell },
        { id: 'aparencia', rotulo: 'Aparência', icone: Palette },
      ],
    },
  ];

  const secoesValidas = grupos.flatMap((g) => g.itens.filter((i) => i.id).map((i) => i.id));
  const pedida = params.get('secao');
  const secao = secoesValidas.includes(pedida) ? pedida : 'negocio';
  const abrir = (id) => setParams((p) => { const n = new URLSearchParams(p); n.set('secao', id); return n; }, { replace: true });

  const ajuda = AJUDA[secao];

  return (
    <Pagina>
      <div className="flex flex-wrap gap-4 items-start">
        <MenuSecoes grupos={grupos} secao={secao} onAbrir={abrir} />

        <div className="min-w-0 flex flex-col gap-4" style={{ flex: '999 1 520px' }}>
          {secao === 'negocio' && (
            user?.perfil === 'CLIENT' ? (
              <BlocoBranding key={JSON.stringify(user?.branding || null)} user={user} refreshUser={refreshUser} toast={toast} />
            ) : (
              <AvisoPainel titulo="Marca">Apenas o dono da conta pode personalizar a marca da plataforma.</AvisoPainel>
            )
          )}

          {secao === 'horario' && (
            podeEditarOperacao ? (
              <BlocoHorarioFuncionamento key={JSON.stringify(user?.horarioFuncionamento || null)} user={user} refreshUser={refreshUser} toast={toast} />
            ) : (
              <AvisoPainel titulo="Horário de funcionamento">Apenas o dono da conta ou administradores podem alterar o horário de funcionamento.</AvisoPainel>
            )
          )}

          {secao === 'modulos' && <BlocoModulos modulos={user?.modulosLiberados} />}

          {secao === 'agenda' && (
            podeEditarOperacao ? (
              <BlocoAgendaSinal toast={toast} />
            ) : (
              <AvisoPainel titulo="Agenda e sinal">Apenas o dono da conta ou administradores podem alterar as regras da agenda.</AvisoPainel>
            )
          )}

          {secao === 'lembretes' && (
            resumo ? (
              <BlocoLembretes
                key={JSON.stringify(resumo.configuracoes?.lembrete || null)}
                resumo={resumo}
                recarregar={recarregar}
                podeEditar={podeEditarOperacao}
                toast={toast}
              />
            ) : <CarregandoPainel titulo="Lembretes automáticos" />
          )}

          {secao === 'link' && (
            !resumo ? (
              <CarregandoPainel titulo="Link de agendamento" />
            ) : resumo.plano?.recursos?.linkAgendamento ? (
              <BlocoLinkAgendamento
                key={resumo.configuracoes?.slugPublico || ''}
                resumo={resumo}
                recarregar={recarregar}
                podeEditar={podeEditarOperacao}
                toast={toast}
              />
            ) : (
              <AvisoPainel titulo="Link de agendamento">
                Seu plano não inclui o link de agendamento.{' '}
                <Link to="/app/plano" className="font-semibold text-[var(--primary)] underline">Ver planos</Link>
              </AvisoPainel>
            )
          )}

          {secao === 'catalogo' && (
            podeVerCatalogo ? (
              <BlocoCatalogo toast={toast} />
            ) : (
              <AvisoPainel titulo="Catálogo">O módulo de Catálogo não está liberado para sua conta. Fale com o administrador.</AvisoPainel>
            )
          )}

          {secao === 'devolucao' && (
            podeEditarOperacao ? (
              <BlocoDevolucao toast={toast} />
            ) : (
              <AvisoPainel titulo="Devoluções e aluguel">Apenas o dono da conta ou administradores podem alterar o aviso de devolução.</AvisoPainel>
            )
          )}

          {secao === 'notificacoes' && <BlocoNotificacoes toast={toast} />}

          {secao === 'aparencia' && (
            <BlocoTema theme={theme} setTheme={setTheme} menuAberto={menuAberto} alternarMenu={alternarMenu} />
          )}
        </div>

        <aside aria-label="Andamento e ajuda" className="min-w-0 flex flex-col gap-4" style={{ flex: '1 1 280px' }}>
          <ProntidaoNegocio inicio={resumo?.inicio} carregando={!resumo} />
          {secao === 'lembretes' && resumo?.plano?.recursos?.lembretesWhatsapp && (
            <PreviaLembrete nomeNegocio={resumo?.negocio?.nome} />
          )}
          {ajuda && (
            <Painel titulo={ajuda.titulo}>
              <p className="m-0 text-[13px] leading-relaxed text-[var(--text-secondary)]">{ajuda.texto}</p>
            </Painel>
          )}
        </aside>
      </div>
    </Pagina>
  );
}

// Dica da coluna direita, por seção.
const AJUDA = {
  negocio: { titulo: 'Onde isso aparece', texto: 'O nome e a logo substituem "Sellergy Cloud" no menu lateral que você e a sua equipe veem. Sua foto e seus dados pessoais ficam em Meu perfil.' },
  horario: { titulo: 'Pra que serve', texto: 'Define quando a loja está aberta. O bot do WhatsApp atende 24 h; o caixa automático do bot fecha e reabre às 00:01 todos os dias.' },
  modulos: { titulo: 'Quem libera', texto: 'Os módulos são liberados pelo administrador conforme o seu plano. Pra trocar de plano, abra Meu plano.' },
  agenda: { titulo: 'Por que cobrar sinal', texto: 'Quem paga sinal falta menos. Sem pagamento dentro do prazo, o horário volta pra agenda, e a fila de encaixe pode ocupar o horário que vagou.' },
  lembretes: { titulo: 'Por onde sai', texto: 'Pelo WhatsApp conectado em WhatsApp e bot: no oficial, com o modelo aprovado e botões; no número por QR, em texto com 1 e 2. Cada lembrete enviado conta na cota mensal do plano.' },
  link: { titulo: 'Onde divulgar', texto: 'Coloque o link na bio do Instagram, no status do WhatsApp e na resposta automática. A cliente escolhe o serviço, o dia e o horário sozinha.' },
  catalogo: { titulo: 'Como funciona', texto: 'O bot do WhatsApp manda esse PDF quando a cliente pede o catálogo. Ele usa os produtos, preços e estoque cadastrados.' },
  devolucao: { titulo: 'Quando usar', texto: 'Só vale pros produtos marcados como alugado no Estoque. A lista das devoluções pendentes fica na tela Devoluções.' },
  notificacoes: { titulo: 'Só pra você', texto: 'Essas escolhas valem pro seu usuário e controlam o que aparece no sino do topo. Cada pessoa da equipe escolhe as suas.' },
  aparencia: { titulo: 'Só neste aparelho', texto: 'Tema e menu recolhido ficam salvos neste navegador.' },
};

function MenuSecoes({ grupos, secao, onAbrir }) {
  const base = 'w-full flex items-center gap-2.5 h-10 px-3 rounded-lg text-sm text-left transition-colors';
  return (
    <nav
      aria-label="Seções das configurações"
      className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] px-2 pt-1.5 pb-2.5 min-w-[200px]"
      style={{ flex: '0 1 240px' }}
    >
      {grupos.map((g) => (
        <div key={g.titulo}>
          <div className="px-3 pt-3.5 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">{g.titulo}</div>
          <ul className="m-0 p-0 list-none">
            {g.itens.map((n) => {
              const Icone = n.icone;
              if (n.href) {
                return (
                  <li key={n.href}>
                    <Link to={n.href} className={clsx(base, 'font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)]')}>
                      <Icone size={16} aria-hidden="true" className="flex-shrink-0" />
                      <span className="flex-1 min-w-0 truncate">{n.rotulo}</span>
                      <ArrowUpRight size={14} aria-hidden="true" className="flex-shrink-0 text-[var(--text-muted)]" />
                    </Link>
                  </li>
                );
              }
              const ativa = n.id === secao;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onAbrir(n.id)}
                    aria-current={ativa ? 'page' : undefined}
                    className={clsx(
                      base,
                      ativa
                        ? 'bg-[var(--primary-soft)] text-[var(--primary)] font-bold'
                        : 'font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)]'
                    )}
                  >
                    <Icone size={16} aria-hidden="true" className="flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{n.rotulo}</span>
                    {n.pendente && (
                      <>
                        <span className="w-2 h-2 rounded-full bg-[var(--warning)] flex-shrink-0" aria-hidden="true" />
                        <span className="sr-only">(pendente)</span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function AvisoPainel({ titulo, children }) {
  return (
    <Painel titulo={titulo}>
      <div className="flex items-start gap-3">
        <AlertCircle size={16} className="text-[var(--text-muted)] flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-[13px] text-[var(--text-muted)]">{children}</div>
      </div>
    </Painel>
  );
}

function CarregandoPainel({ titulo }) {
  return (
    <Painel titulo={titulo}>
      <div className="text-[13px] text-[var(--text-muted)] py-4 text-center">Carregando…</div>
    </Painel>
  );
}

/** Rótulo de grupo de campos dentro de um Painel. */
function RotuloGrupo({ children }) {
  return <div className="text-xs font-medium text-[var(--text-muted)] mb-2">{children}</div>;
}

/** Cartão de escolha (modelo, tema): borda verde quando escolhido. */
function Escolha({ ativo, onClick, titulo, descricao, icone: Icone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={clsx(
        'p-3.5 rounded-[10px] border text-left transition-colors bg-[var(--bg-card)]',
        ativo
          ? 'border-[var(--primary)] ring-2 ring-[var(--primary-soft)]'
          : 'border-[var(--border-main)] hover:border-[var(--border-strong)]'
      )}
    >
      {Icone && <Icone size={16} aria-hidden="true" className={clsx('mb-1.5', ativo ? 'text-[var(--primary)]' : 'text-[var(--text-secondary)]')} />}
      <div className="text-sm font-semibold text-[var(--text-main)]">{titulo}</div>
      <div className="text-[13px] text-[var(--text-muted)] mt-1 leading-relaxed">{descricao}</div>
    </button>
  );
}

function BlocoModulos({ modulos }) {
  const lista = Object.entries(modulos || {});
  return (
    <Painel
      titulo="Módulos do plano"
      subtitulo="Módulos liberados pelo administrador para sua conta."
      acoes={<Link to="/app/plano" className="text-[13px] font-semibold text-[var(--primary)] hover:underline">Ver meu plano</Link>}
    >
      {lista.length === 0 ? (
        <div className="text-[13px] text-[var(--text-muted)] text-center py-4">Nenhum módulo configurado. Fale com o suporte.</div>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          {lista.map(([modulo, liberado]) => (
            <div
              key={modulo}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)]"
            >
              <span className="text-xs font-semibold text-[var(--text-main)] tracking-tight truncate">{modulo}</span>
              <Badge variant={liberado ? 'success' : 'neutral'} size="sm">
                {liberado ? 'Liberado' : 'Bloqueado'}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Painel>
  );
}

function BlocoTema({ theme, setTheme, menuAberto, alternarMenu }) {
  return (
    <Painel titulo="Aparência" subtitulo="Vale só pra este aparelho." semPadding>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 border-b border-[var(--border-subtle)]">
        <Escolha ativo={theme === 'light'} onClick={() => setTheme('light')} icone={Sun} titulo="Claro" descricao="Fundo claro, ideal de dia." />
        <Escolha ativo={theme === 'dark'} onClick={() => setTheme('dark')} icone={Moon} titulo="Escuro" descricao="Cansa menos a vista à noite." />
      </div>
      <LinhaOpcao titulo="Menu lateral recolhido" descricao="Mais espaço pra agenda e tabelas. Você também abre e fecha o menu pelo botão dele.">
        <Switch checked={!menuAberto} onChange={() => alternarMenu()} ariaLabel="Menu lateral recolhido" />
      </LinhaOpcao>
    </Painel>
  );
}

function BlocoBranding({ user, refreshUser, toast }) {
  const fileInput = useRef(null);
  const [logo, setLogo] = useState(user?.branding?.logo || '');
  const [nome, setNome] = useState(user?.branding?.nome || '');
  const [salvando, setSalvando] = useState(false);

  // Recarrega do usuario pela key no pai (sem efeito sincronizando estado).
  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Apenas arquivos de imagem.');
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      toast.error('Imagem muito grande. Máximo 10 MB.');
      return;
    }
    // Reduz pra 512 px (PNG mantem a transparencia do logo); a API aceita ate ~300 KB.
    reduzirImagem(file, { lado: 512, png: file.type === 'image/png' })
      .then(setLogo)
      .catch((err) => toast.error(err.message));
  };

  const handleSalvar = async () => {
    setSalvando(true);
    try {
      await api.put('/autenticacao/branding', { brandLogo: logo || null, brandNome: nome || null });
      await refreshUser();
      toast.success('Marca atualizada');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  const handleRemoverLogo = () => {
    setLogo('');
  };

  return (
    <Painel titulo="Marca" subtitulo="Logo e nome que sua equipe vê no menu lateral.">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-16 h-16 rounded-[10px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-subtle)] flex items-center justify-center overflow-hidden flex-shrink-0">
            {logo ? (
              <img src={logo} alt="Logo atual" className="w-full h-full object-cover" />
            ) : (
              <ImageIcon size={24} className="text-[var(--text-muted)]" strokeWidth={1.5} aria-hidden="true" />
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
            aria-label="Arquivo da logo"
          />
          <Button variant="secondary" size="sm" icon={Upload} onClick={() => fileInput.current?.click()}>
            {logo ? 'Trocar logo' : 'Enviar logo'}
          </Button>
          {logo && (
            <Button variant="ghost" size="sm" icon={Trash2} onClick={handleRemoverLogo}>
              Remover
            </Button>
          )}
          <span className="text-xs text-[var(--text-muted)]">Imagem quadrada, até 1 MB.</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <Input
            label="Nome exibido no menu"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex: Boutique Bella, Barbearia do João"
            hint="Substitui 'Sellergy Cloud' no menu lateral. Deixe em branco para usar o padrão."
          />

          <div>
            <RotuloGrupo>Pré-visualização</RotuloGrupo>
            <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-subtle)] px-3 py-2.5">
              {logo ? (
                <div className="w-8 h-8 rounded-lg bg-[var(--primary)] flex items-center justify-center overflow-hidden flex-shrink-0">
                  <img src={logo} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <SellergyLogo size={32} className="flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--text-main)] truncate">{nome || 'Sellergy Cloud'}</div>
                <div className="text-[11px] text-[var(--text-muted)]">Plataforma</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" icon={Save} onClick={handleSalvar} loading={salvando}>
            Salvar marca
          </Button>
        </div>
      </div>
    </Painel>
  );
}

// Configura o horario de funcionamento da loja. Usado pelo cron diario do
// caixa (00:01) e por outras automacoes. Persiste em Cliente.horarioFuncionamento.
const DIAS_SEMANA = [
  { valor: 0, label: 'Dom', completo: 'Domingo' },
  { valor: 1, label: 'Seg', completo: 'Segunda' },
  { valor: 2, label: 'Ter', completo: 'Terça' },
  { valor: 3, label: 'Qua', completo: 'Quarta' },
  { valor: 4, label: 'Qui', completo: 'Quinta' },
  { valor: 5, label: 'Sex', completo: 'Sexta' },
  { valor: 6, label: 'Sab', completo: 'Sábado' },
];

function BlocoHorarioFuncionamento({ user, refreshUser, toast }) {
  const horarioAtual = user?.horarioFuncionamento || {};
  const [abertura, setAbertura] = useState(horarioAtual.abertura || '08:00');
  const [fechamento, setFechamento] = useState(horarioAtual.fechamento || '18:00');
  const [dias, setDias] = useState(
    Array.isArray(horarioAtual.dias) ? horarioAtual.dias : [1, 2, 3, 4, 5, 6]
  );
  const [salvando, setSalvando] = useState(false);

  // Recarrega do usuario pela key no pai (sem efeito sincronizando estado).
  const toggleDia = (valor) => {
    setDias((atual) =>
      atual.includes(valor) ? atual.filter((d) => d !== valor) : [...atual, valor].sort()
    );
  };

  const handleSalvar = async () => {
    if (dias.length === 0) {
      toast.error('Selecione ao menos um dia de funcionamento.');
      return;
    }
    if (abertura >= fechamento) {
      toast.error('Horário de fechamento deve ser depois da abertura.');
      return;
    }
    setSalvando(true);
    try {
      await api.put('/autenticacao/horario-funcionamento', { abertura, fechamento, dias });
      await refreshUser();
      toast.success('Horário atualizado');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Painel
      titulo="Horário de funcionamento"
      subtitulo="Quando a loja está aberta. Vale o mesmo horário pra todos os dias abertos."
      acoes={!user?.horarioFuncionamento ? <Badge variant="warning" size="sm">Ainda não salvo</Badge> : null}
      semPadding
    >
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-[var(--border-subtle)]">
        <Input
          label="Abre"
          type="time"
          value={abertura}
          onChange={(e) => setAbertura(e.target.value)}
        />
        <Input
          label="Fecha"
          type="time"
          value={fechamento}
          onChange={(e) => setFechamento(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 items-center px-4 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)]">
        <span>Dia</span><span>Aberto</span><span>Horário</span>
      </div>
      <ul className="m-0 p-0 list-none">
        {DIAS_SEMANA.map((dia) => {
          const ativo = dias.includes(dia.valor);
          return (
            <li key={dia.valor} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 items-center px-4 py-2.5 border-b border-[var(--border-subtle)] text-[13px]">
              <strong className="font-semibold text-[var(--text-main)]">{dia.completo}</strong>
              <Switch
                checked={ativo}
                onChange={() => toggleDia(dia.valor)}
                ariaLabel={`${dia.completo} ${ativo ? 'aberto' : 'fechado'}`}
              />
              <span className={clsx('tabular-nums', ativo ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]')}>
                {ativo ? `${abertura} às ${fechamento}` : 'Fechado'}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="p-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-[240px]">
          <Clock size={14} className="text-[var(--text-muted)] flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="m-0 text-xs text-[var(--text-muted)] leading-relaxed">
            O caixa automático do bot (vendas via WhatsApp) é fechado e reaberto todos os
            dias às 00:01, com o fundo igual ao saldo final do dia anterior. O caixa manual
            só é tocado pelo usuário.
          </p>
        </div>
        <Button variant="primary" icon={Save} onClick={handleSalvar} loading={salvando}>
          Salvar horário
        </Button>
      </div>
    </Painel>
  );
}

// =====================================================================
// Catalogo — layout do PDF gerado pelo bot (ver services/catalogoPdf.js e
// a ferramenta CATALOGO em iaFerramentas). Persiste em ConfiguracaoCatalogo,
// 1 registro por tenant.
// =====================================================================
const REGEX_COR_HEX = /^#[0-9a-fA-F]{6}$/;

const TEMPLATES_CATALOGO = [
  { valor: 'FOTOS_GRANDES', titulo: 'Fotos grandes', descricao: 'Uma foto por linha. Bom pra poucos produtos com apelo visual.' },
  { valor: 'LISTA_COMPACTA', titulo: 'Lista compacta', descricao: 'Vários itens por página. Ideal pra catálogos com muitos produtos.' },
  { valor: 'MINIMALISTA', titulo: 'Minimalista', descricao: 'Só nome e preço, sem foto. Rápido de gerar e ler.' },
];

const CONFIG_CATALOGO_PADRAO = {
  template: 'FOTOS_GRANDES',
  corDestaque: '#2563EB',
  agruparPor: 'CATEGORIA',
  mostrarPreco: true,
  mostrarFoto: true,
  mostrarDescricao: true,
  ocultarSemEstoque: true,
};

function BlocoCatalogo({ toast }) {
  const [config, setConfig] = useState(CONFIG_CATALOGO_PADRAO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    catalogoService.obterConfig()
      .then((r) => setConfig(r ? { ...CONFIG_CATALOGO_PADRAO, ...r } : CONFIG_CATALOGO_PADRAO))
      .catch(() => toast.error('Não foi possível carregar a configuração do catálogo.'))
      .finally(() => setCarregando(false));
  }, [toast]);

  const handleSalvar = async () => {
    setSalvando(true);
    try {
      const atualizado = await catalogoService.salvarConfig({
        template: config.template,
        corDestaque: config.corDestaque,
        agruparPor: config.agruparPor,
        mostrarPreco: config.mostrarPreco,
        mostrarFoto: config.mostrarFoto,
        mostrarDescricao: config.mostrarDescricao,
        ocultarSemEstoque: config.ocultarSemEstoque,
      });
      setConfig({ ...CONFIG_CATALOGO_PADRAO, ...atualizado });
      toast.success('Layout do catálogo atualizado.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return <CarregandoPainel titulo="Catálogo pra enviar no WhatsApp" />;
  }

  const corValida = REGEX_COR_HEX.test(config.corDestaque) ? config.corDestaque : '#2563EB';
  const minimalista = config.template === 'MINIMALISTA';

  return (
    <>
      <Painel
        titulo="Catálogo pra enviar no WhatsApp"
        subtitulo="Como o catálogo em PDF que o bot envia é organizado e exibido pro cliente final."
        semPadding
      >
        <div className="p-4 flex flex-col gap-4 border-b border-[var(--border-subtle)]">
          <div>
            <RotuloGrupo>Modelo</RotuloGrupo>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {TEMPLATES_CATALOGO.map((t) => (
                <Escolha
                  key={t.valor}
                  ativo={config.template === t.valor}
                  onClick={() => setConfig((c) => ({ ...c, template: t.valor }))}
                  titulo={t.titulo}
                  descricao={t.descricao}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="cor-destaque-catalogo" className="block text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">
                Cor de destaque
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={corValida}
                  onChange={(e) => setConfig((c) => ({ ...c, corDestaque: e.target.value }))}
                  className="w-10 h-10 rounded-lg border border-[var(--border-main)] cursor-pointer bg-transparent flex-shrink-0"
                  aria-label="Escolher cor de destaque do catálogo"
                />
                <Input
                  id="cor-destaque-catalogo"
                  value={config.corDestaque}
                  onChange={(e) => setConfig((c) => ({ ...c, corDestaque: e.target.value }))}
                  placeholder="#2563EB"
                />
              </div>
            </div>

            <Select
              label="Agrupar produtos por"
              value={config.agruparPor}
              onChange={(e) => setConfig((c) => ({ ...c, agruparPor: e.target.value }))}
              options={[
                { value: 'CATEGORIA', label: 'Categoria' },
                { value: 'NENHUM', label: 'Sem agrupamento' },
              ]}
            />
          </div>
        </div>

        <div className="px-4 pt-3 text-xs font-medium text-[var(--text-muted)]">O que aparece no catálogo</div>
        <LinhaOpcao titulo="Preço" descricao="Mostra o valor de cada produto.">
          <Switch checked={config.mostrarPreco} onChange={(v) => setConfig((c) => ({ ...c, mostrarPreco: v }))} ariaLabel="Mostrar preço" />
        </LinhaOpcao>
        <LinhaOpcao
          titulo="Foto"
          descricao={minimalista ? 'O modelo Minimalista nunca mostra foto, mesmo com esta opção ligada.' : 'Mostra a imagem cadastrada do produto.'}
          desativada={minimalista}
        >
          <Switch checked={config.mostrarFoto} disabled={minimalista} onChange={(v) => setConfig((c) => ({ ...c, mostrarFoto: v }))} ariaLabel="Mostrar foto" />
        </LinhaOpcao>
        <LinhaOpcao
          titulo="Descrição"
          descricao={minimalista ? 'O modelo Minimalista nunca mostra descrição, mesmo com esta opção ligada.' : 'Mostra o texto de descrição do produto, quando existir.'}
          desativada={minimalista}
        >
          <Switch checked={config.mostrarDescricao} disabled={minimalista} onChange={(v) => setConfig((c) => ({ ...c, mostrarDescricao: v }))} ariaLabel="Mostrar descrição" />
        </LinhaOpcao>

        <div className="px-4 pt-3 text-xs font-medium text-[var(--text-muted)] border-t border-[var(--border-subtle)]">Regras do catálogo</div>
        <LinhaOpcao
          titulo="Esconder itens sem estoque"
          descricao="Produtos físicos com estoque zerado não aparecem no catálogo enviado pelo bot. Serviços não são afetados (não controlam estoque)."
        >
          <Switch checked={config.ocultarSemEstoque} onChange={(v) => setConfig((c) => ({ ...c, ocultarSemEstoque: v }))} ariaLabel="Esconder itens sem estoque" />
        </LinhaOpcao>

        <div className="p-4 flex justify-end border-t border-[var(--border-subtle)]">
          <Button variant="primary" icon={Save} onClick={handleSalvar} loading={salvando}>
            Salvar layout
          </Button>
        </div>
      </Painel>

      <Painel titulo="Pré-visualização" subtitulo="Como fica a primeira página do PDF.">
        <div className="rounded-[10px] border border-[var(--border-main)] overflow-hidden bg-white max-w-[420px]">
          <div className="p-3" style={{ borderBottom: `3px solid ${corValida}` }}>
            <div className="text-xs font-bold" style={{ color: corValida }}>Sua Loja</div>
          </div>
          <div className="p-3 space-y-2">
            {!minimalista && config.agruparPor === 'CATEGORIA' && (
              <div className="text-[10px] font-bold uppercase text-gray-500">Categoria exemplo</div>
            )}
            <div className={`flex gap-2 ${config.template === 'LISTA_COMPACTA' ? 'items-center' : 'items-start'}`}>
              {config.mostrarFoto && !minimalista && (
                <div className={`bg-gray-200 rounded flex-shrink-0 ${config.template === 'FOTOS_GRANDES' ? 'w-16 h-16' : 'w-8 h-8'}`} />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold text-gray-800">Produto exemplo</div>
                {config.mostrarDescricao && !minimalista && (
                  <div className="text-[10px] text-gray-500">Descrição curta do produto</div>
                )}
                {config.mostrarPreco && (
                  <div className="text-[10px] font-bold text-gray-700 mt-0.5">R$ 49,90</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Painel>
    </>
  );
}

// =====================================================================
// Devolucao — aviso de aluguel prestes a vencer (bot + alerta na plataforma).
// So o "quantos dias antes" mora aqui; o "este produto e alugado" fica no
// cadastro do produto (Estoque), e a lista de devolucoes pendentes tem tela
// propria (app/devolucoes).
// =====================================================================
function BlocoDevolucao({ toast }) {
  const [dias, setDias] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    devolucaoService.obterConfig()
      .then((r) => setDias(r?.diasAvisoDevolucao ?? 1))
      .catch(() => toast.error('Não foi possível carregar a configuração de devolução.'))
      .finally(() => setCarregando(false));
  }, [toast]);

  const handleSalvar = async () => {
    setSalvando(true);
    try {
      const r = await devolucaoService.salvarConfig({ diasAvisoDevolucao: parseInt(dias, 10) || 0 });
      setDias(r.diasAvisoDevolucao);
      toast.success('Configuração de devolução salva.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return <CarregandoPainel titulo="Devoluções e aluguel" />;
  }

  return (
    <Painel
      titulo="Devoluções e aluguel"
      subtitulo='Produtos marcados como "alugado" no Estoque avisam o cliente e geram alerta aqui quando a devolução se aproxima.'
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-[220px]">
          <Input
            label="Avisar quantos dias antes"
            type="number"
            min="0"
            max="30"
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            hint="0 = avisa só no próprio dia da devolução."
          />
        </div>
        <Button variant="primary" icon={Save} onClick={handleSalvar} loading={salvando}>
          Salvar
        </Button>
      </div>
    </Painel>
  );
}

// Agenda (fase 2): sinal por Pix padrao e fila de encaixe automatica.
function BlocoAgendaSinal({ toast }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [pct, setPct] = useState('');
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.get('/agenda/config')
      .then((r) => { setConfig(r.data); setPct(String(r.data.sinalPadraoPct || 0)); })
      .catch((e) => setErro(e.response?.data?.erro || 'Não foi possível carregar as configurações da agenda.'));
  }, []);

  const salvar = async (dados) => {
    setSalvando(true);
    try {
      const r = await api.put('/agenda/config', dados);
      setConfig((c) => ({ ...c, ...r.data }));
      setPct(String(r.data.sinalPadraoPct || 0));
      toast.success('Configuração da agenda salva.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Painel
      titulo="Agenda e sinal"
      subtitulo="Sinal por Pix reduz falta. A fila de encaixe preenche horário que vagou."
      semPadding
    >
      {erro ? (
        <p role="alert" className="m-0 p-4 text-[13px] text-[var(--danger-text)]">{erro}</p>
      ) : !config ? (
        <p className="m-0 p-4 text-[13px] text-[var(--text-muted)]">Carregando…</p>
      ) : (
        <>
          <div className="p-4 flex flex-col gap-4 border-b border-[var(--border-subtle)]">
            {!config.pagamentoConfigurado && (
              <div className="flex items-start gap-3 p-3 rounded-[10px] bg-[var(--warning-soft)] text-[var(--warning-text)]">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-[13px]">
                  O recebimento por Pix ainda não está configurado, então nenhum sinal é cobrado (os horários são marcados normalmente).{' '}
                  <button type="button" className="font-semibold underline min-h-[44px]" onClick={() => navigate('/app/pagamentos')}>Configurar em Pagamentos</button>
                </div>
              </div>
            )}
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(pct);
                if (!Number.isInteger(n) || n < 0 || n > 100) { toast.error('Use um número inteiro de 0 a 100.'); return; }
                salvar({ sinalPadraoPct: n });
              }}
            >
              <div className="w-full max-w-[220px]">
                <Input label="Sinal padrão (% do preço)" type="number" min={0} max={100} step={1} value={pct} onChange={(e) => setPct(e.target.value)} hint="0 = não cobra" />
              </div>
              <Button type="submit" variant="primary" className="min-h-[44px]" loading={salvando}>Salvar sinal</Button>
            </form>
            <p className="m-0 text-xs text-[var(--text-muted)] leading-relaxed">
              Vale pra todos os serviços, menos os que têm sinal próprio (Catálogo › editar serviço). A cliente tem {config.prazoSinalHoras} h pra pagar (nunca depois do horário); sem pagamento, o horário volta pra agenda. O sinal desconta do total no atendimento.
            </p>
          </div>
          <LinhaOpcao
            titulo="Oferecer horário vago pra fila sozinho"
            descricao="Quando alguém cancela ou remarca com mais de 2 h de antecedência, a oferta vai pras 3 primeiras da fila sem perguntar."
          >
            <Switch checked={!!config.encaixeAutomatico} disabled={salvando} onChange={(v) => salvar({ encaixeAutomatico: v })} ariaLabel="Oferecer horário vago pra fila sozinho" />
          </LinhaOpcao>
        </>
      )}
    </Painel>
  );
}

// =====================================================================
// Notificações — opt-in por tipo
// =====================================================================
// Lista todos os tipos disponíveis com switch. Toggle salva direto no
// backend (PUT /notificacoes/preferencias/:tipo). Sem botão "Salvar"
// porque cada mudança é independente.

const ROTULOS_NOTIFICACAO = {
  LEMBRETE_FECHAMENTO_MES: {
    titulo: 'Lembrete do fechamento do mês',
    descricao: 'Avisos para você lançar suas despesas e fechar as vendas antes do dia 7.',
  },
  RELATORIO_MENSAL_PRONTO: {
    titulo: 'Relatório mensal pronto',
    descricao: 'Mostra quando o relatório de fechamento do mês anterior está disponível.',
  },
  CAIXA_AUTO_FECHADO: {
    titulo: 'Caixa automático fechado',
    descricao: 'Confirma quando o sistema fecha sozinho o caixa do bot (à meia-noite).',
  },
  CAIXA_DIVERGENCIA: {
    titulo: 'Divergência no fechamento do caixa',
    descricao: 'Alerta quando o saldo contado é diferente do saldo esperado.',
  },
  CONTA_PAGAR_VENCENDO: {
    titulo: 'Conta a pagar vencendo',
    descricao: 'Lembrete dos dias antes do vencimento das contas cadastradas.',
  },
  DEVOLUCAO_PROXIMA: {
    titulo: 'Devolução de aluguel próxima',
    descricao: 'Avisa quando um produto alugado está perto (ou passou) da data de devolução.',
  },
  GENERICA: {
    titulo: 'Avisos diversos',
    descricao: 'Mensagens gerais que não se encaixam nas outras categorias.',
  },
};

function BlocoNotificacoes({ toast }) {
  const [preferencias, setPreferencias] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState({}); // mapa tipo -> bool

  useEffect(() => {
    notificacaoService.listarPreferencias()
      .then((r) => setPreferencias(r || []))
      .catch(() => toast.error('Não foi possível carregar as preferências.'))
      .finally(() => setCarregando(false));
  }, [toast]);

  const handleToggle = async (tipo, novoValor) => {
    setSalvando((s) => ({ ...s, [tipo]: true }));
    // Otimista: atualiza UI antes da resposta.
    setPreferencias((arr) => arr.map((p) => p.tipo === tipo ? { ...p, ativa: novoValor } : p));
    try {
      await notificacaoService.atualizarPreferencia(tipo, novoValor);
    } catch {
      // Reverte se der erro.
      setPreferencias((arr) => arr.map((p) => p.tipo === tipo ? { ...p, ativa: !novoValor } : p));
      toast.error('Não foi possível salvar essa preferência.');
    } finally {
      setSalvando((s) => ({ ...s, [tipo]: false }));
    }
  };

  return (
    <Painel
      titulo="Notificações pra você"
      subtitulo="Escolha quais avisos aparecem no sino do topo. Você pode mudar quando quiser."
      semPadding
    >
      {carregando ? (
        <div className="text-[13px] text-[var(--text-muted)] py-6 text-center">Carregando…</div>
      ) : preferencias.length === 0 ? (
        <div className="text-[13px] text-[var(--text-muted)] py-6 text-center">Nenhum tipo de aviso disponível.</div>
      ) : (
        preferencias.map((p) => {
          const cfg = ROTULOS_NOTIFICACAO[p.tipo] || { titulo: p.tipo, descricao: '' };
          return (
            <LinhaOpcao key={p.tipo} titulo={cfg.titulo} descricao={cfg.descricao}>
              <Switch
                checked={p.ativa}
                disabled={!!salvando[p.tipo]}
                onChange={(v) => handleToggle(p.tipo, v)}
                ariaLabel={cfg.titulo}
              />
            </LinhaOpcao>
          );
        })
      )}
    </Painel>
  );
}
