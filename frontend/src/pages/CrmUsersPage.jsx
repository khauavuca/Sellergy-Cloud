import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Users, Plus, Edit2, Trash2, MoreHorizontal, Crown, BadgeCheck,
  ShieldAlert, Sparkles, ArrowLeft, UserCog, Clock, Briefcase, Send, HandCoins,
} from 'lucide-react';
import api from '../services/api';
import catalogoService from '../services/catalogoService';
import { useAuthStore } from '../store/auth.store';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import {
  Card, Button, IconButton, Input, Badge, Avatar, Switch,
  EmptyState, SearchBar, Dropdown, DropdownItem, DropdownDivider, useToast,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, BarraFerramentas, AbasPilula,
} from '../components/ui';
import Modal from '../components/Modal';
import ConvitesEquipe, { AvisosConvites, LinhasConvites } from '../components/equipe/ConvitesEquipe';
import { useConvitesEquipe } from '../components/equipe/useConvitesEquipe';
import {
  MODULOS_TENANT, MODULOS_COLABORADOR, acoesDoModulo, temEscopo, ESCOPOS, permissoesVazias, permissoesCompletas, moduloLiberado
} from '../constants/permissoes';

// Tipos de usuario da equipe. Especialista so aparece em segmento de servico
// (proxy: modulo AGENDA liberado) e, ao ser criado, gera Usuario + Especialista
// numa transacao no backend (doc erp-pivo §6.1).
const PERFIL_INFO = {
  ADMINISTRADOR: { label: 'Administrador', icon: Crown, variant: 'info', desc: 'Acesso total dentro do sistema' },
  VENDEDOR: { label: 'Vendedor', icon: BadgeCheck, variant: 'neutral', desc: 'Permissões ajustadas pessoa a pessoa' },
  ESPECIALISTA: { label: 'Especialista', icon: UserCog, variant: 'success', desc: 'Atende e é agendável; vê a própria agenda' },
};

// Nomes dos modulos com acento, so pra exibir nesta tela.
const NOME_MODULO = {
  BOTS: 'Bots e automação',
  WHATSAPP_BAILEYS: 'WhatsApp por QR Code',
  CRM: 'CRM e leads',
  AGENDA: 'Agenda',
  CATALOGO: 'Catálogo de serviços',
  ESTOQUE: 'Estoque',
  FINANCEIRO: 'Financeiro e caixa',
  VENDAS: 'Vendas',
  PAGAMENTOS: 'Pagamentos',
  FISCAL: 'Notas fiscais',
  ALERTAS: 'Alertas',
  RELATORIOS: 'Relatórios',
  USUARIOS: 'Convidar e mudar a equipe',
};
const nomeModulo = (m) => NOME_MODULO[m.id] || m.nome;

const th = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const td = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDataLonga = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

// --- Jornada do especialista (reaproveitado da antiga tela de Especialistas) ---
const DIAS = [
  { n: 1, label: 'Segunda' }, { n: 2, label: 'Terça' }, { n: 3, label: 'Quarta' },
  { n: 4, label: 'Quinta' }, { n: 5, label: 'Sexta' }, { n: 6, label: 'Sábado' }, { n: 7, label: 'Domingo' },
];
function jornadaPadrao() {
  const j = {};
  for (const d of DIAS) j[d.n] = { ativo: d.n <= 5, inicio: '08:00', fim: '18:00' };
  return j;
}
function jornadaDoEspecialista(jornada) {
  const base = jornadaPadrao();
  if (jornada && typeof jornada === 'object') {
    for (const d of DIAS) {
      const intervalos = jornada[String(d.n)];
      if (Array.isArray(intervalos) && intervalos[0]) {
        base[d.n] = { ativo: true, inicio: intervalos[0].inicio || '08:00', fim: intervalos[0].fim || '18:00' };
      } else if (intervalos !== undefined) {
        base[d.n] = { ...base[d.n], ativo: false };
      }
    }
  }
  return base;
}
function montarJornadaJson(jornadaState) {
  const out = {};
  for (const d of DIAS) {
    const v = jornadaState[d.n];
    out[String(d.n)] = (v?.ativo && v.inicio && v.fim && v.fim > v.inicio) ? [{ inicio: v.inicio, fim: v.fim }] : [];
  }
  return out;
}

/** Resumo da agenda propria: { curto, longo } (curto vai na tabela). */
function resumoAgenda(u) {
  const esp = u.especialista;
  if (!esp) return { curto: 'Não', longo: 'Não atende na agenda', tem: false };
  if (esp.ativo === false) return { curto: 'Pausada', longo: 'Pausada (não recebe agendamentos)', tem: true };
  if (!esp.jornada) return { curto: 'Sim · expediente da loja', longo: 'Sim · expediente da loja', tem: true };
  const ativos = DIAS
    .map((d) => (Array.isArray(esp.jornada[String(d.n)]) ? esp.jornada[String(d.n)][0] : null))
    .filter(Boolean);
  if (!ativos.length) return { curto: 'Sim · sem horário', longo: 'Sim · nenhum dia com horário', tem: true };
  const mesmo = ativos.every((i) => i.inicio === ativos[0].inicio && i.fim === ativos[0].fim);
  const faixa = mesmo ? `${ativos[0].inicio} às ${ativos[0].fim}` : 'horário por dia';
  return {
    curto: `Sim · ${faixa}`,
    longo: `${ativos.length} ${ativos.length === 1 ? 'dia' : 'dias'} · ${faixa}`,
    tem: true,
  };
}

/** O que a pessoa pode ver e mexer, a partir das permissoes salvas. */
function modulosDaPessoa(u, modulosLiberados) {
  const liberados = MODULOS_TENANT.filter((m) => moduloLiberado(modulosLiberados, m.id));
  if (u.perfil === 'ADMINISTRADOR') {
    const pode = liberados.filter((m) => m.id !== 'USUARIOS').map(nomeModulo);
    if (liberados.some((m) => m.id === 'USUARIOS')) pode.push('Equipe (menos o dono)');
    return { pode, naoPode: ['Plano e cobrança'] };
  }
  const pode = [];
  const naoPode = [];
  for (const m of liberados.filter((x) => MODULOS_COLABORADOR.some((c) => c.id === x.id))) {
    const p = u.permissoes?.[m.id] || {};
    const algum = acoesDoModulo(m.id).some((a) => p[a.id] === true);
    if (!algum) { naoPode.push(nomeModulo(m)); continue; }
    pode.push(temEscopo(m.id) && (p.escopo || 'PROPRIAS') === 'PROPRIAS' ? `${nomeModulo(m)} (só a sua)` : nomeModulo(m));
  }
  return { pode, naoPode };
}

export default function CrmUsersPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const usuarioLogado = useAuthStore((s) => s.user);
  const ehDono = usuarioLogado?.perfil === 'CLIENT';
  const ehAdministrador = usuarioLogado?.perfil === 'ADMINISTRADOR';
  const podeGerenciar = ehDono || ehAdministrador;
  const modulosLiberados = useMemo(() => usuarioLogado?.modulosLiberados || {}, [usuarioLogado]);
  const agendaLiberada = moduloLiberado(modulosLiberados, 'AGENDA');
  const financeiroLiberado = moduloLiberado(modulosLiberados, 'FINANCEIRO');

  const [usuarios, setUsuarios] = useState([]);
  const [servicos, setServicos] = useState([]);
  const [comissoes, setComissoes] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [aba, setAba] = useState('todos');
  const [selId, setSelId] = useState(null);
  const [modal, setModal] = useState({ open: false, data: null });
  const [convidar, setConvidar] = useState(false);

  const convites = useConvitesEquipe(podeGerenciar);

  const carregar = async () => {
    try {
      const [r, listaCatalogo, com] = await Promise.all([
        api.get('/crm/usuarios'),
        catalogoService.listar().catch(() => []),
        // Fechamento do mes (comissao de cada profissional). So com Financeiro.
        financeiroLiberado ? api.get('/comissoes').then((x) => x.data).catch(() => null) : Promise.resolve(null),
      ]);
      setUsuarios(r.data || []);
      const produtos = Array.isArray(listaCatalogo) ? listaCatalogo : [];
      setServicos(produtos.filter((p) => p.tipo === 'SERVICO'));
      setComissoes(com);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    if (podeGerenciar) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeGerenciar]);

  useAcaoTopo(
    podeGerenciar ? <Button size="sm" icon={Send} onClick={() => setConvidar(true)}>Convidar pessoa</Button> : null,
    [podeGerenciar]
  );

  // Comissao do mes por especialista (id do Especialista ligado ao usuario).
  const comissaoPorEsp = useMemo(() => {
    const m = new Map();
    for (const p of comissoes?.pessoas || []) m.set(p.id, p);
    return m;
  }, [comissoes]);
  const nomeServico = useMemo(() => new Map(servicos.map((s) => [s.id, s.nome])), [servicos]);

  const q = busca.trim().toLowerCase();
  const casa = (x) => !q || x.nome?.toLowerCase().includes(q) || x.email?.toLowerCase().includes(q);

  const contagem = useMemo(() => ({
    todos: usuarios.length,
    senha: usuarios.filter((u) => u.deveTrocarSenha).length,
    pausados: usuarios.filter((u) => u.especialista && u.especialista.ativo === false).length,
    agenda: usuarios.filter((u) => u.especialista && u.especialista.ativo !== false).length,
  }), [usuarios]);

  const filtrados = usuarios.filter((u) => {
    if (!casa(u)) return false;
    if (aba === 'senha') return u.deveTrocarSenha;
    if (aba === 'pausados') return u.especialista && u.especialista.ativo === false;
    return true;
  });
  const convitesFiltrados = convites.convites.filter(casa);
  const convitesPendentes = convites.convites.filter((c) => c.situacao === 'PENDENTE').length;

  const abas = [
    { valor: 'todos', rotulo: 'Todos', qtd: contagem.todos },
    { valor: 'convites', rotulo: 'Convites', qtd: convites.convites.length },
    ...(contagem.senha > 0 || aba === 'senha' ? [{ valor: 'senha', rotulo: 'Senha pendente', qtd: contagem.senha }] : []),
    ...(contagem.pausados > 0 || aba === 'pausados' ? [{ valor: 'pausados', rotulo: 'Fora da agenda', qtd: contagem.pausados }] : []),
  ];

  const sel = usuarios.find((u) => u.id === selId) || filtrados[0] || null;

  const handleSalvar = async (dados) => {
    try {
      if (dados.id) {
        await api.put(`/crm/usuarios/${dados.id}`, dados);
        toast.success('Usuário atualizado');
      } else {
        await api.post('/crm/usuarios', dados);
        toast.success('Usuário criado');
      }
      setModal({ open: false, data: null });
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao salvar');
    }
  };

  const handleExcluir = async (u) => {
    if (!confirm(`Excluir o usuário "${u.nome}"?`)) return;
    try {
      await api.delete(`/crm/usuarios/${u.id}`);
      toast.success('Usuário excluído');
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao excluir');
    }
  };

  if (!podeGerenciar) {
    return (
      <Card padding="lg">
        <EmptyState
          icon={ShieldAlert}
          title="Acesso restrito"
          description="Apenas o dono da conta ou um Administrador pode gerenciar a equipe."
        />
      </Card>
    );
  }

  const vagas = convites.vagas;

  return (
    <Pagina>
      <Link to="/app/configuracoes" className="self-start text-xs text-[var(--text-muted)] inline-flex items-center gap-1 hover:text-[var(--text-main)]">
        <ArrowLeft size={12} aria-hidden="true" /> Voltar para configurações
      </Link>

      <FaixaNumeros>
        <Numero
          rotulo="Usuários do plano"
          carregando={!convites.carregado && !convites.erro}
          valor={vagas ? (vagas.maximo ? `${vagas.usuarios} de ${vagas.maximo}` : vagas.usuarios) : '—'}
          detalhe={vagas ? (vagas.maximo ? (vagas.convitesPendentes === 1 ? '+1 lugar reservado por convite' : vagas.convitesPendentes > 1 ? `+${vagas.convitesPendentes} lugares reservados por convite` : 'Contando a dona da conta') : 'Sem limite no plano') : 'Contando a dona da conta'}
          progresso={vagas?.maximo ? ((vagas.usuarios + vagas.convitesPendentes) / vagas.maximo) * 100 : undefined}
          tom={vagas?.maximo && vagas.usuarios + vagas.convitesPendentes >= vagas.maximo ? 'alerta' : 'neutro'}
        />
        {agendaLiberada && (
          <Numero
            rotulo="Profissionais na agenda"
            carregando={carregando}
            valor={contagem.agenda}
            detalhe={contagem.pausados ? `${contagem.pausados} fora da agenda` : 'Com login na equipe'}
          />
        )}
        <Numero
          rotulo="Convites pendentes"
          carregando={!convites.carregado && !convites.erro}
          valor={convitesPendentes}
          tom={convitesPendentes > 0 ? 'alerta' : 'neutro'}
          detalhe={convitesPendentes > 0 ? 'Ver convites' : 'Nenhum esperando resposta'}
          onClick={() => setAba('convites')}
        />
        {comissoes && (
          <Numero
            rotulo="Comissões no mês"
            icone={HandCoins}
            valor={brl(comissoes.totais?.total)}
            detalhe={`${comissoes.mes} · a pagar ${brl(comissoes.totais?.aPagar)}`}
            onClick={() => navigate('/app/comissoes')}
          />
        )}
        <Numero
          rotulo="Senha pendente"
          carregando={carregando}
          valor={contagem.senha}
          tom={contagem.senha > 0 ? 'alerta' : 'neutro'}
          detalhe={contagem.senha > 0 ? 'Ainda não trocaram a senha inicial' : 'Todos já trocaram a senha inicial'}
          onClick={contagem.senha > 0 ? () => setAba('senha') : undefined}
        />
      </FaixaNumeros>

      <ColunasPagina
        lateral={(
          <DetalhePessoa
            u={sel}
            carregando={carregando}
            comissao={sel?.especialista ? comissaoPorEsp.get(sel.especialista.id) : null}
            temComissoes={!!comissoes}
            mesComissao={comissoes?.mes}
            nomeServico={nomeServico}
            modulosLiberados={modulosLiberados}
            onEditar={() => setModal({ open: true, data: sel })}
            onExcluir={() => handleExcluir(sel)}
          />
        )}
      >
        <Painel as="section" semPadding className="overflow-hidden">
          <BarraFerramentas>
            <AbasPilula abas={abas} valor={aba} onChange={setAba} rotulo="Filtrar equipe" />
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <label className="w-60 max-w-full">
                <span className="sr-only">Buscar por nome ou e-mail</span>
                <SearchBar size="sm" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou e-mail..." />
              </label>
              <Button variant="secondary" size="sm" icon={Plus} onClick={() => setModal({ open: true, data: null })}>
                Cadastrar usuário
              </Button>
            </div>
          </BarraFerramentas>

          {aba === 'convites' ? (
            convites.erro || convitesFiltrados.length === 0 ? (
              convites.erro ? (
                <AvisosConvites {...convites} />
              ) : (
                <EmptyState
                  icon={Send}
                  title={convites.convites.length === 0 ? 'Nenhum convite em aberto' : 'Nenhum convite encontrado'}
                  description={convites.convites.length === 0 ? 'Convide alguém pelo WhatsApp: a pessoa cria a própria senha e já entra.' : 'Tente outra busca.'}
                  action={convites.convites.length === 0 && (
                    <Button icon={Send} onClick={() => setConvidar(true)}>Convidar pessoa</Button>
                  )}
                />
              )
            ) : (
              <TabelaPessoas>
                <LinhasConvites {...convites} convites={convitesFiltrados} td={td} />
              </TabelaPessoas>
            )
          ) : carregando ? (
            <div className="text-center py-12 text-[var(--text-muted)] text-sm">Carregando...</div>
          ) : filtrados.length === 0 ? (
            <EmptyState
              icon={Users}
              title={usuarios.length === 0 ? 'Nenhum colaborador' : 'Nenhum usuário encontrado'}
              description={usuarios.length === 0 ? 'Convide ou cadastre o primeiro membro da equipe.' : 'Tente outra busca ou outro filtro.'}
              action={usuarios.length === 0 && (
                <Button variant="primary" icon={Plus} onClick={() => setModal({ open: true, data: null })}>
                  Cadastrar usuário
                </Button>
              )}
            />
          ) : (
            <TabelaPessoas>
              {filtrados.map((u) => {
                const info = PERFIL_INFO[u.tipo] || PERFIL_INFO[u.perfil] || { label: u.perfil, icon: Users, variant: 'neutral' };
                const Icone = info.icon;
                const ativo = sel?.id === u.id;
                const com = u.especialista ? comissaoPorEsp.get(u.especialista.id) : null;
                const agenda = resumoAgenda(u);
                return (
                  <tr key={u.id} className={ativo ? 'bg-[var(--success-soft)]' : 'hover:bg-[var(--bg-subtle)]'}>
                    <td className={td}>
                      <button
                        type="button"
                        onClick={() => setSelId(u.id)}
                        aria-pressed={ativo}
                        className="flex items-center gap-2.5 text-left min-w-0 bg-transparent border-0 p-0 cursor-pointer"
                      >
                        <Avatar name={u.nome} size="sm" />
                        <span className="min-w-0">
                          <span className="block font-semibold text-[var(--text-main)] truncate">{u.nome}</span>
                          <span className="block text-xs text-[var(--text-muted)] truncate">{u.email}</span>
                        </span>
                      </button>
                    </td>
                    <td className={td}>
                      <Badge variant={info.variant} size="sm" icon={Icone}>{info.label}</Badge>
                    </td>
                    <td className={`${td} whitespace-nowrap text-[var(--text-secondary)]`}>{com?.regra?.texto || '—'}</td>
                    <td className={`${td} whitespace-nowrap ${agenda.tem ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'}`}>{agenda.curto}</td>
                    <td className={`${td} whitespace-nowrap text-[var(--text-secondary)]`}>{fmtDataLonga(u.criadoEm)}</td>
                    <td className={td}>
                      {u.deveTrocarSenha
                        ? <Badge variant="warning" size="sm">Senha pendente</Badge>
                        : <Badge variant="success" size="sm">Ativo</Badge>}
                    </td>
                    <td className={`${td} text-right`}>
                      <Dropdown trigger={<IconButton icon={MoreHorizontal} variant="ghost" size="sm" ariaLabel={`Ações de ${u.nome}`} />}>
                        <DropdownItem icon={Edit2} onClick={() => setModal({ open: true, data: u })}>Editar</DropdownItem>
                        <DropdownDivider />
                        <DropdownItem icon={Trash2} variant="danger" onClick={() => handleExcluir(u)}>Excluir</DropdownItem>
                      </Dropdown>
                    </td>
                  </tr>
                );
              })}
            </TabelaPessoas>
          )}

          {aba !== 'convites' && <AvisosConvites {...convites} />}
        </Painel>

        <TabelaPapeis modulosLiberados={modulosLiberados} agendaLiberada={agendaLiberada} />
      </ColunasPagina>

      <ConvitesEquipe
        aberto={convidar}
        setAberto={setConvidar}
        ehDono={ehDono}
        temAgenda={usuarioLogado?.modulosLiberados?.AGENDA === true}
        onMudou={convites.carregar}
      />

      <ModalUsuario
        isOpen={modal.open}
        onClose={() => setModal({ open: false, data: null })}
        usuario={modal.data}
        ehDono={ehDono}
        modulosLiberados={modulosLiberados}
        servicos={servicos}
        onSalvar={handleSalvar}
      />
    </Pagina>
  );
}

function TabelaPessoas({ children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <th className={th}>Pessoa</th>
            <th className={th}>Papel</th>
            <th className={th}>Comissão</th>
            <th className={th}>Agenda própria</th>
            <th className={th}>Na equipe desde</th>
            <th className={th}>Situação</th>
            <th className={th}><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Matriz "o que cada papel pode fazer", tirada do catalogo de modulos. */
function TabelaPapeis({ modulosLiberados, agendaLiberada }) {
  const SIM = { t: 'Sim', c: 'text-[var(--success-text)] font-semibold' };
  const NAO = { t: 'Não', c: 'text-[var(--text-muted)]' };
  const parc = (t) => ({ t, c: 'text-[var(--warning-text)] font-semibold' });
  const linhas = MODULOS_TENANT
    .filter((m) => moduloLiberado(modulosLiberados, m.id))
    .map((m) => {
      const delegavel = MODULOS_COLABORADOR.some((c) => c.id === m.id);
      const colab = delegavel ? parc('Se liberado') : NAO;
      return {
        id: m.id,
        nome: nomeModulo(m),
        dono: SIM,
        admin: m.id === 'USUARIOS' ? parc('Menos o dono') : SIM,
        vendedor: colab,
        especialista: m.id === 'AGENDA' ? parc('A sua (ou mais, se liberado)') : colab,
      };
    });
  linhas.push({ id: 'PLANO', nome: 'Plano e cobrança', dono: SIM, admin: NAO, vendedor: NAO, especialista: NAO });

  return (
    <Painel
      id="papeis"
      titulo="O que cada papel pode fazer"
      subtitulo="Vendedor e especialista têm permissões ajustadas pessoa a pessoa. O dono da conta não pode ser editado nem excluído por ninguém da equipe."
      semPadding
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className={th}>Permissão</th>
              <th className={th}>Dono</th>
              <th className={th}>Administrador</th>
              <th className={th}>Vendedor</th>
              {agendaLiberada && <th className={th}>Especialista</th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id}>
                <td className={`${td} text-[var(--text-main)]`}>{l.nome}</td>
                <td className={`${td} whitespace-nowrap ${l.dono.c}`}>{l.dono.t}</td>
                <td className={`${td} whitespace-nowrap ${l.admin.c}`}>{l.admin.t}</td>
                <td className={`${td} whitespace-nowrap ${l.vendedor.c}`}>{l.vendedor.t}</td>
                {agendaLiberada && <td className={`${td} whitespace-nowrap ${l.especialista.c}`}>{l.especialista.t}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Painel>
  );
}

/** Coluna da direita: detalhe da pessoa escolhida na tabela. */
function DetalhePessoa({ u, carregando, comissao, temComissoes, mesComissao, nomeServico, modulosLiberados, onEditar, onExcluir }) {
  if (carregando) {
    return (
      <Painel titulo="Detalhe da pessoa">
        <div className="h-24 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />
      </Painel>
    );
  }
  if (!u) {
    return (
      <Painel titulo="Detalhe da pessoa">
        <p className="m-0 text-[13px] text-[var(--text-muted)]">Escolha alguém na tabela para ver o papel, a agenda e o que a pessoa pode fazer.</p>
      </Painel>
    );
  }

  const info = PERFIL_INFO[u.tipo] || PERFIL_INFO[u.perfil] || { label: u.perfil, variant: 'neutral' };
  const agenda = resumoAgenda(u);
  const { pode, naoPode } = modulosDaPessoa(u, modulosLiberados);
  const servicosNomes = (u.especialista?.servicosIds || []).map((id) => nomeServico.get(id)).filter(Boolean);

  return (
    <Painel as="div" semPadding className="overflow-hidden" id="detalhe-pessoa">
      <h2 className="sr-only">Detalhe da pessoa</h2>
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)]">
        <Avatar name={u.nome} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[var(--text-main)] truncate">{u.nome}</div>
          <div className="text-xs text-[var(--text-muted)] truncate">{u.email}</div>
        </div>
        {u.deveTrocarSenha
          ? <Badge variant="warning" size="sm">Senha pendente</Badge>
          : <Badge variant="success" size="sm">Ativo</Badge>}
      </div>

      {u.especialista && temComissoes && (
        <div className="grid grid-cols-3 border-b border-[var(--border-subtle)]">
          {[
            ['Atendimentos', comissao ? comissao.atendimentos : 0],
            ['Serviços', brl(comissao?.baseServicos)],
            ['Comissão', brl(comissao?.total)],
          ].map(([rot, val], i) => (
            <div key={rot} className={`px-3 py-3 min-w-0 ${i > 0 ? 'border-l border-[var(--border-subtle)]' : ''}`}>
              <div className="text-xs font-medium text-[var(--text-muted)] truncate">{rot}</div>
              <div className="text-[15px] font-bold text-[var(--text-main)] tabular-nums truncate">{val}</div>
            </div>
          ))}
          <div className="col-span-3 px-4 pb-2.5 -mt-1 text-[11px] text-[var(--text-muted)]">Fechamento de {mesComissao}</div>
        </div>
      )}

      <LinhaInfo rotulo="Papel"><Badge variant={info.variant} size="sm">{info.label}</Badge></LinhaInfo>
      {u.especialista && (
        <LinhaInfo rotulo="Comissão" valor={comissao?.regra?.texto || (temComissoes ? 'Sem regra de comissão' : '—')} />
      )}
      <LinhaInfo rotulo="Agenda própria" valor={agenda.longo} />
      {u.especialista && (
        <LinhaInfo rotulo="Serviços que atende" valor={servicosNomes.length ? servicosNomes.join(', ') : 'Nenhum vinculado'} />
      )}
      <LinhaInfo rotulo="Na equipe desde" valor={fmtDataLonga(u.criadoEm)} />
      <LinhaInfo rotulo="Senha" valor={u.deveTrocarSenha ? 'Ainda não trocou a inicial' : 'Definida pela pessoa'} />

      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="text-xs font-medium text-[var(--text-muted)] mb-2">Pode ver e mexer em</div>
        {pode.length === 0 && naoPode.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--text-muted)]">Nenhum módulo liberado.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {pode.map((t) => <Badge key={`p-${t}`} variant="success" size="md">{t}</Badge>)}
            {naoPode.map((t) => (
              <Badge key={`n-${t}`} variant="neutral" size="md" className="line-through decoration-1">
                <span className="sr-only">Sem acesso: </span>{t}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-4">
        <Button icon={Edit2} onClick={onEditar}>Editar papel e permissões</Button>
        {u.especialista && temComissoes && (
          <Link
            to="/app/comissoes"
            className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-subtle)]"
          >
            <HandCoins size={16} aria-hidden="true" /> Ajustar comissão
          </Link>
        )}
        <Button variant="danger-soft" icon={Trash2} onClick={onExcluir}>Excluir usuário</Button>
      </div>
    </Painel>
  );
}

function ModalUsuario({ isOpen, onClose, usuario, ehDono, modulosLiberados, servicos, onSalvar }) {
  const editando = !!usuario;
  const agendaLiberada = moduloLiberado(modulosLiberados, 'AGENDA');

  const [erroForm, setErroForm] = useState('');
  const [form, setForm] = useState({
    nome: '', email: '', senha: '', tipo: 'VENDEDOR', permissoes: permissoesVazias(),
    // campos de especialista
    servicosIds: [], usaExpedienteLoja: true, jornada: jornadaPadrao(), espAtivo: true,
  });

  useEffect(() => {
    if (usuario) {
      const tipo = usuario.tipo || (usuario.perfil === 'ADMINISTRADOR' ? 'ADMINISTRADOR' : 'VENDEDOR');
      const esp = usuario.especialista;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza o form com o usuario ao abrir
      setForm({
        ...usuario,
        senha: '',
        tipo,
        permissoes: usuario.perfil === 'ADMINISTRADOR'
          ? permissoesCompletas()
          : { ...permissoesVazias(), ...(usuario.permissoes || {}) },
        servicosIds: Array.isArray(esp?.servicosIds) ? esp.servicosIds : [],
        usaExpedienteLoja: !esp?.jornada,
        jornada: jornadaDoEspecialista(esp?.jornada),
        espAtivo: esp ? esp.ativo !== false : true,
      });
    } else {
      setForm({
        nome: '', email: '', senha: '', tipo: 'VENDEDOR', permissoes: permissoesVazias(),
        servicosIds: [], usaExpedienteLoja: true, jornada: jornadaPadrao(), espAtivo: true,
      });
    }
  }, [usuario, isOpen]);

  // Especialista so e selecionavel em segmento de servico, e nao se converte um
  // usuario existente em especialista (so na criacao). Editando um especialista,
  // o tipo fica travado.
  const editandoEspecialista = editando && (usuario?.tipo === 'ESPECIALISTA');
  const tiposDisponiveis = editandoEspecialista
    ? ['ESPECIALISTA']
    : ['ADMINISTRADOR', 'VENDEDOR', ...((!editando && agendaLiberada) ? ['ESPECIALISTA'] : [])];

  const escolherTipo = (tipo) => {
    setForm((f) => ({
      ...f,
      tipo,
      permissoes: tipo === 'ADMINISTRADOR' ? permissoesCompletas() : permissoesVazias(),
    }));
  };

  const togglePermissao = (modulo, acao) => {
    setForm({ ...form, permissoes: { ...form.permissoes, [modulo]: { ...form.permissoes[modulo], [acao]: !form.permissoes[modulo]?.[acao] } } });
  };
  const marcarTodoModulo = (modulo, valor) => {
    const atual = form.permissoes[modulo] || {};
    const novo = {};
    for (const acao of acoesDoModulo(modulo)) novo[acao.id] = valor;
    if (temEscopo(modulo)) novo.escopo = atual.escopo || 'PROPRIAS';
    setForm({ ...form, permissoes: { ...form.permissoes, [modulo]: novo } });
  };
  const definirEscopo = (modulo, valor) => {
    setForm({ ...form, permissoes: { ...form.permissoes, [modulo]: { ...form.permissoes[modulo], escopo: valor } } });
  };
  const toggleServico = (id) => {
    setForm((f) => ({ ...f, servicosIds: f.servicosIds.includes(id) ? f.servicosIds.filter((x) => x !== id) : [...f.servicosIds, id] }));
  };
  const setDia = (n, patch) => {
    setForm((f) => ({ ...f, jornada: { ...f.jornada, [n]: { ...f.jornada[n], ...patch } } }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!usuario && !form.senha) {
      setErroForm('A senha inicial é obrigatória para um novo usuário.');
      return;
    }
    if (form.senha && (form.senha.length < 8 || !form.senha.trim())) {
      setErroForm('A senha precisa de pelo menos 8 caracteres (não pode ser só espaços).');
      return;
    }
    setErroForm('');
    const payload = { nome: form.nome, email: form.email };
    if (form.senha) payload.senha = form.senha;
    if (form.id) payload.id = form.id;

    if (form.tipo === 'ESPECIALISTA') {
      // Backend cria/atualiza Usuario + Especialista e garante a agenda-propria.
      payload.especialista = {
        servicosIds: form.servicosIds,
        jornada: form.usaExpedienteLoja ? null : montarJornadaJson(form.jornada),
        ativo: form.espAtivo,
      };
    } else {
      payload.perfil = form.tipo;
      if (form.tipo === 'VENDEDOR') payload.permissoes = form.permissoes;
    }
    onSalvar(payload);
  };

  const ehVendedor = form.tipo === 'VENDEDOR';
  const ehEspecialista = form.tipo === 'ESPECIALISTA';
  const modulosDisponiveis = MODULOS_COLABORADOR.filter((m) => moduloLiberado(modulosLiberados, m.id));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={usuario ? 'Editar usuário' : 'Cadastrar usuário'}
      description="Defina o tipo e o que ele pode fazer."
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Dados basicos */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input label="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required autoFocus />
          <Input label="E-mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <Input
            label={usuario ? 'Nova senha (opcional)' : 'Senha inicial'}
            type="password"
            value={form.senha}
            onChange={(e) => setForm({ ...form, senha: e.target.value })}
            placeholder={usuario ? 'Deixe em branco para manter' : 'Mínimo de 8 caracteres'}
            minLength={8}
            hint={!usuario ? 'A pessoa vai trocar a senha no primeiro login' : 'Ao redefinir, a pessoa sai de todos os aparelhos e troca a senha no próximo acesso.'}
          />
        </div>
        {erroForm && (
          <div role="alert" className="text-[13px] text-[var(--danger-text)]">{erroForm}</div>
        )}

        {/* Tipo */}
        <div>
          <label className="block text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-2">
            Tipo de usuário
          </label>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {tiposDisponiveis.map((key) => {
              const info = PERFIL_INFO[key];
              const Icone = info.icon;
              const ativo = form.tipo === key;
              const desabilitado = !ehDono && key === 'ADMINISTRADOR';
              return (
                <button
                  type="button"
                  key={key}
                  disabled={desabilitado}
                  onClick={() => !desabilitado && escolherTipo(key)}
                  className={`text-left p-4 rounded-xl border-2 transition-colors ${
                    ativo ? 'border-[var(--accent)] bg-[var(--accent-soft)]/50' : 'border-[var(--border-main)] hover:border-[var(--text-muted)]'
                  } ${desabilitado ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icone size={16} className={ativo ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'} />
                    <span className="text-sm font-semibold text-[var(--text-main)]">{info.label}</span>
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">{info.desc}</div>
                  {desabilitado && (
                    <div className="text-[11px] text-[var(--warning)] mt-1 font-semibold">Apenas o dono pode criar</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Campos do Especialista */}
        {ehEspecialista && (
          <div className="space-y-4 border border-[var(--border-main)] rounded-xl p-4">
            <label className="flex items-center gap-3">
              <Switch checked={form.espAtivo} onChange={(v) => setForm({ ...form, espAtivo: v })} />
              <span className="text-sm font-medium text-[var(--text-main)]">Ativo (pode receber agendamentos)</span>
            </label>

            <div>
              <label className="block text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-2 inline-flex items-center gap-1.5">
                <Briefcase size={12} /> Serviços que executa
              </label>
              {servicos.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">Nenhum serviço no catálogo ainda. Cadastre serviços para vincular.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {servicos.map((s) => {
                    const marcado = form.servicosIds.includes(s.id);
                    return (
                      <label key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                        marcado ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-main)]'
                      }`}>
                        <input type="checkbox" checked={marcado} onChange={() => toggleServico(s.id)} className="rounded" />
                        {s.nome}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="flex items-center gap-3 mb-2">
                <Switch checked={form.usaExpedienteLoja} onChange={(v) => setForm({ ...form, usaExpedienteLoja: v })} />
                <span className="text-sm font-medium text-[var(--text-main)] inline-flex items-center gap-1.5">
                  <Clock size={14} /> Usar o expediente da loja
                </span>
              </label>
              {!form.usaExpedienteLoja && (
                <div className="space-y-1.5 border border-[var(--border-main)] rounded-xl p-3">
                  {DIAS.map((d) => {
                    const v = form.jornada[d.n];
                    return (
                      <div key={d.n} className="flex items-center gap-3">
                        <label className="flex items-center gap-2 w-32 flex-shrink-0">
                          <input type="checkbox" checked={v.ativo} onChange={(ev) => setDia(d.n, { ativo: ev.target.checked })} className="rounded" />
                          <span className="text-sm text-[var(--text-main)]">{d.label}</span>
                        </label>
                        <input type="time" value={v.inicio} disabled={!v.ativo} onChange={(ev) => setDia(d.n, { inicio: ev.target.value })}
                          className="bg-[var(--bg-app)] border border-[var(--border-main)] rounded-lg px-2 py-1 text-sm text-[var(--text-main)] disabled:opacity-40" />
                        <span className="text-[var(--text-muted)] text-sm">até</span>
                        <input type="time" value={v.fim} disabled={!v.ativo} onChange={(ev) => setDia(d.n, { fim: ev.target.value })}
                          className="bg-[var(--bg-app)] border border-[var(--border-main)] rounded-lg px-2 py-1 text-sm text-[var(--text-main)] disabled:opacity-40" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              O especialista entra com acesso à plataforma e vê a própria agenda. Senha inicial trocada no primeiro login.
            </p>
          </div>
        )}

        {/* Permissoes (Vendedor) */}
        {ehVendedor && modulosDisponiveis.length > 0 && (
          <div>
            <label className="block text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-2">
              Permissões por módulo
            </label>
            <div className="space-y-2">
              {modulosDisponiveis.map((modulo) => {
                const Icone = modulo.icone;
                const permModulo = form.permissoes[modulo.id] || {};
                const acoes = acoesDoModulo(modulo.id);
                const total = acoes.filter((a) => permModulo[a.id] === true).length;
                return (
                  <div key={modulo.id} className="border border-[var(--border-main)] rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Icone size={14} className="text-[var(--text-secondary)]" />
                        <span className="text-sm font-semibold text-[var(--text-main)] tracking-tight">{nomeModulo(modulo)}</span>
                        <Badge variant="neutral" size="sm">{total}/{acoes.length}</Badge>
                      </div>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => marcarTodoModulo(modulo.id, true)} className="text-[10px] font-bold uppercase tracking-tight text-[var(--accent)] hover:underline">Tudo</button>
                        <span className="text-[var(--text-muted)]">·</span>
                        <button type="button" onClick={() => marcarTodoModulo(modulo.id, false)} className="text-[10px] font-bold uppercase tracking-tight text-[var(--text-muted)] hover:underline">Limpar</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {acoes.map((acao) => {
                        const marcado = permModulo[acao.id] === true;
                        return (
                          <label key={acao.id} title={acao.descricao}
                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-xs font-medium transition-colors ${
                              marcado ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-main)]'
                            }`}>
                            <input type="checkbox" checked={marcado} onChange={() => togglePermissao(modulo.id, acao.id)} className="rounded" />
                            {acao.nome}
                          </label>
                        );
                      })}
                    </div>
                    {temEscopo(modulo.id) && (
                      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-[var(--text-secondary)]">Pode ver:</span>
                        {ESCOPOS.map((esc) => {
                          const ativo = (permModulo.escopo || 'PROPRIAS') === esc.id;
                          return (
                            <button type="button" key={esc.id} title={esc.descricao} onClick={() => definirEscopo(modulo.id, esc.id)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                ativo ? 'bg-[var(--accent)] text-[var(--text-on-primary)]' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-main)]'
                              }`}>
                              {esc.nome}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {form.tipo === 'ADMINISTRADOR' && (
          <div className="bg-[var(--accent-soft)] border border-[var(--accent-border)] rounded-xl p-3 text-xs text-[var(--accent-text)] flex items-start gap-2">
            <Sparkles size={14} className="flex-shrink-0 mt-0.5" />
            O Administrador tem acesso a todos os módulos liberados na conta. Não pode mexer no dono da conta.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-main)]">
          <Button variant="secondary" onClick={onClose} type="button">Cancelar</Button>
          <Button variant="primary" type="submit">{usuario ? 'Salvar' : 'Criar usuário'}</Button>
        </div>
      </form>
    </Modal>
  );
}
