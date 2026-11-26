import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Package, Edit2, Trash2, MoreHorizontal, Tag,
} from 'lucide-react';
import api from '../services/api';
import {
  Button, IconButton, Select, Badge,
  EmptyState, SearchBar, Dropdown, DropdownItem, DropdownDivider, useToast,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, BarraFerramentas,
} from '../components/ui';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import FormServico, { ModalServico } from '../components/catalogo/FormServico';
import { VISIBILIDADES } from '../components/catalogo/constantes';
import { ModalCategoriaServico, ModalVariacao } from '../components/catalogo/ModaisCatalogo';
import PainelPacotes from '../components/catalogo/PainelPacotes';
import { useAuthStore } from '../store/auth.store';

const msgErro = (e, padrao) => e?.response?.data?.erro || e?.response?.data?.error || padrao;

const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// Catalogo cadastra so servicos. Constante TIPOS removida — filtro de tipo
// nao faz mais sentido na UI.

const th = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const td = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';

function fmtDuracao(min) {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

// Duracao: a da variacao padrao (1a), como o formulario usa.
const duracaoDe = (p) => p.variacoes?.[0]?.duracaoMin ?? null;

// Preco: o menor entre as variacoes ("a partir de" quando ha mais de uma).
function precoDe(p) {
  const precos = (p.variacoes || []).map((v) => Number(v.preco)).filter((n) => Number.isFinite(n));
  if (precos.length === 0) return null;
  return { valor: Math.min(...precos), varios: new Set(precos).size > 1 };
}

function textoSinal(p) {
  const s = p.sinalPercentual;
  if (s === null || s === undefined || s === '') return 'Padrão';
  if (Number(s) === 0) return 'Não cobra';
  return `${Number(s)}%`;
}

const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0];

function BadgeLink({ visibilidade }) {
  if (visibilidade === 'ATIVO') return <Badge variant="success" size="sm">Aparece</Badge>;
  if (visibilidade === 'PAUSADO') return <Badge variant="warning" size="sm">Pausado</Badge>;
  return <Badge variant="neutral" size="sm">{VISIBILIDADES.find((v) => v.value === visibilidade)?.label || visibilidade}</Badge>;
}

export default function CatalogoPage() {
  const toast = useToast();
  const usuario = useAuthStore((s) => s.user);
  const [produtos, setProdutos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [especialistas, setEspecialistas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  // filtroTipo removido — Catalogo cadastra so servicos.
  const [filtroVis, setFiltroVis] = useState('');
  const [filtroCat, setFiltroCat] = useState('');

  const [modalProduto, setModalProduto] = useState({ open: false, data: null });
  const [modalVariacao, setModalVariacao] = useState({ open: false, data: null, produtoId: null });
  const [modalCatServico, setModalCatServico] = useState(false);

  // Servico aberto no editor da coluna da direita (substitui o antigo drawer).
  const [selId, setSelId] = useState(null);
  // Muda a cada recarga: remonta o formulario do editor com os dados novos.
  const [versao, setVersao] = useState(0);
  const [salvoId, setSalvoId] = useState(null);
  const editorRef = useRef(null);

  // Pacotes (so leitura aqui; a gestao fica na tela Pacotes).
  const [pacModelos, setPacModelos] = useState([]);
  const [pacClientes, setPacClientes] = useState([]);
  const [pacCarregando, setPacCarregando] = useState(true);
  const [pacSemPlano, setPacSemPlano] = useState(false);
  const [pacErro, setPacErro] = useState(null);

  // Carga inicial (promessas direto no efeito; setState so nos callbacks).
  useEffect(() => {
    api.get('/catalogo')
      .then((r) => setProdutos((r.data || []).filter((p) => p.tipo === 'SERVICO')))
      .catch(() => setProdutos([]))
      .finally(() => setCarregando(false));
    api.get('/financeiro/categorias?uso=SERVICO').then((r) => setCategorias(r.data || [])).catch(() => setCategorias([]));
    // Especialistas ativos pra vincular ao servico (a agenda reserva o horario deles).
    api.get('/especialistas').then((r) => setEspecialistas((r.data || []).filter((e) => e.ativo))).catch(() => setEspecialistas([]));
    // Pacotes: mesmos endpoints da tela Pacotes. Sem o recurso no plano, o
    // bloco mostra o aviso em vez de numero.
    Promise.all([
      api.get('/pacotes/modelos'),
      api.get('/pacotes/clientes', { params: { filtro: 'ativos' } }),
    ])
      .then(([m, c]) => { setPacModelos(m.data || []); setPacClientes(c.data || []); })
      .catch((e) => {
        if (e.response?.data?.codigo === 'PLANO_SEM_RECURSO') setPacSemPlano(true);
        else setPacErro(e.response?.data?.erro || 'Não foi possível carregar os pacotes.');
      })
      .finally(() => setPacCarregando(false));
  }, []);

  const carregar = async () => {
    setCarregando(true);
    try {
      const r = await api.get('/catalogo');
      // Catalogo so lista servicos. Produtos fisicos sao no Estoque.
      // Filtro local pra blindar contra dados legados/criados por outras vias.
      setProdutos((r.data || []).filter((p) => p.tipo === 'SERVICO'));
      setVersao((v) => v + 1);
    } catch {
      setProdutos([]);
    } finally {
      setCarregando(false);
    }
  };

  const carregarCategorias = async () => {
    try {
      // Só categorias de uso SERVICO aparecem no cadastro de serviço.
      const r = await api.get('/financeiro/categorias?uso=SERVICO');
      setCategorias(r.data || []);
    } catch {
      setCategorias([]);
    }
  };

  // Cria categoria contextual de serviço (uso=SERVICO automático; sem dropdown).
  const handleSalvarCategoriaServico = async (nome) => {
    try {
      await api.post('/financeiro/categorias', { nome, tipo: 'RECEITA', uso: 'SERVICO' });
      toast.success('Categoria de serviço criada');
      setModalCatServico(false);
      carregarCategorias();
    } catch (e) {
      toast.error(msgErro(e, 'Erro ao criar categoria'));
    }
  };

  // Atalho de primeiro uso dentro do formulario do servico: cria a categoria
  // (mesmo endpoint de "Categoria de serviço") e ja devolve pra selecionar.
  // Erro sobe pro formulario, que mostra no campo.
  const criarCategoriaRapida = async (nome) => {
    const r = await api.post('/financeiro/categorias', { nome, tipo: 'RECEITA', uso: 'SERVICO' });
    await carregarCategorias();
    toast.success('Categoria criada');
    return r.data;
  };

  // "Eu mesmo atendo": cadastra o dono como profissional (ligado ao login dele).
  const euMesmoAtendo = async () => {
    const r = await api.post('/especialistas', { nome: usuario?.nome || 'Eu', usuarioId: usuario?.id });
    setEspecialistas((lista) => [...lista, r.data]);
    toast.success('Pronto: você aparece como profissional na agenda.');
    return r.data;
  };

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      if (q && !p.nome?.toLowerCase().includes(q) && !p.descricao?.toLowerCase().includes(q)) return false;
      if (filtroVis && p.visibilidade !== filtroVis) return false;
      if (filtroCat && p.categoriaId !== filtroCat) return false;
      return true;
    });
  }, [produtos, busca, filtroVis, filtroCat]);

  // Selecionado: o escolhido (se ainda existe) ou o 1o da lista filtrada.
  const selecionado = useMemo(
    () => produtos.find((p) => p.id === selId) || filtrados[0] || null,
    [produtos, filtrados, selId]
  );

  const numeros = useMemo(() => {
    const total = produtos.length;
    const ativos = produtos.filter((p) => p.visibilidade === 'ATIVO');
    const pausados = produtos.filter((p) => p.visibilidade === 'PAUSADO').length;
    const arquivados = produtos.filter((p) => p.visibilidade === 'ARQUIVADO').length;
    const precos = ativos.map(precoDe).filter((x) => x && x.valor > 0).map((x) => x.valor);
    const precoMedio = precos.length ? precos.reduce((a, b) => a + b, 0) / precos.length : null;
    const semProf = ativos.filter((p) => !p.especialistas || p.especialistas.length === 0).length;
    return { total, ativos: ativos.length, pausados, arquivados, precoMedio, semProf };
  }, [produtos]);

  const pacotesAVenda = pacModelos.filter((m) => m.ativo);
  const pacotesAtivos = pacotesAVenda.reduce((s, m) => s + (Number(m.clientesAtivas) || 0), 0);

  const abrirNovo = () => setModalProduto({ open: true, data: null });
  useAcaoTopo(<Button size="sm" icon={Plus} onClick={abrirNovo}>Novo serviço</Button>, []);

  const escolher = (p) => {
    setSelId(p.id);
    setSalvoId(null);
    // Tela estreita: o editor fica embaixo da lista; leva a pessoa ate ele.
    if (typeof window !== 'undefined' && window.innerWidth < 1100) {
      requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  // Erro sobe pro formulario, que mostra no proprio campo.
  const handleSalvar = async (dados) => {
    let produtoId = dados.id;
    if (dados.id) {
      await api.put(`/catalogo/${dados.id}`, dados);
    } else {
      const r = await api.post('/catalogo', dados);
      produtoId = r.data?.id;
    }
    // Sinal por servico (fase 2): salvo a parte, na rota da agenda.
    if (produtoId && dados.sinalAlterado) {
      try {
        await api.put(`/agenda/servicos/${produtoId}/sinal`, { sinalPercentual: dados.sinalPercentual === '' ? null : Number(dados.sinalPercentual) });
      } catch (e) {
        toast.error(e.response?.data?.erro || 'Serviço salvo, mas o sinal não foi salvo.');
      }
    }
    toast.success(dados.id ? 'Serviço atualizado' : 'Serviço criado');
    setModalProduto({ open: false, data: null });
    if (produtoId) { setSelId(produtoId); setSalvoId(produtoId); }
    carregar();
  };

  const handleExcluir = async (p, confirmado = false) => {
    if (!confirmado && !confirm(`Excluir serviço "${p.nome}"?`)) return;
    try {
      await api.delete(`/catalogo/${p.id}`, { params: confirmado ? { confirmar: 1 } : undefined });
      toast.success('Serviço excluído');
      if (selId === p.id) setSelId(null);
      carregar();
    } catch (e) {
      // Servico com horario marcado ou fila: o servidor avisa e pede confirmacao.
      if (!confirmado && e.response?.data?.codigo === 'CONFIRMAR_EXCLUSAO') {
        if (confirm(msgErro(e, 'Este serviço está em uso. Excluir mesmo assim?'))) handleExcluir(p, true);
        return;
      }
      toast.error(msgErro(e, 'Não foi possível excluir'));
    }
  };

  const handleSalvarVariacao = async (dados) => {
    try {
      if (dados.id) {
        await api.put(`/catalogo/variacoes/${dados.id}`, dados);
        toast.success('Variação atualizada');
      } else {
        await api.post(`/catalogo/${modalVariacao.produtoId}/variacoes`, dados);
        toast.success('Variação criada');
      }
      setModalVariacao({ open: false, data: null, produtoId: null });
      carregar();
    } catch (e) {
      toast.error(msgErro(e, 'Erro ao salvar variação'));
    }
  };

  const handleExcluirVariacao = async (v) => {
    if (!confirm(`Excluir variação "${v.nome}"?`)) return;
    try {
      await api.delete(`/catalogo/variacoes/${v.id}`);
      toast.success('Variação excluída');
      carregar();
    } catch (e) {
      toast.error(msgErro(e, 'Erro ao excluir'));
    }
  };

  const nomeCategoria = (id) => categorias.find((c) => c.id === id)?.nome;

  const lateral = selecionado ? (
    <div ref={editorRef} className="flex flex-col gap-4 scroll-mt-4">
      <Painel
        titulo="Editar serviço"
        subtitulo={[selecionado.categoria?.nome || nomeCategoria(selecionado.categoriaId), `${selecionado.variacoes?.length || 0} variação(ões)`].filter(Boolean).join(' · ')}
        acoes={salvoId === selecionado.id
          ? <Badge variant="success" size="sm">Salvo</Badge>
          : <Badge variant="neutral" size="sm">Sem alterações salvas</Badge>}
      >
        <FormServico
          key={`${selecionado.id}-${versao}`}
          compacto
          produto={selecionado}
          categorias={categorias}
          especialistas={especialistas}
          onSalvar={handleSalvar}
          onCriarCategoria={criarCategoriaRapida}
          onEuAtendo={euMesmoAtendo}
          onExcluir={() => handleExcluir(selecionado)}
          onAlterou={() => { if (salvoId) setSalvoId(null); }}
        />
      </Painel>

      <Painel
        titulo="Preço e variações"
        subtitulo="O preço e o custo ficam em cada variação."
        acoes={<Button variant="secondary" size="sm" icon={Plus} onClick={() => setModalVariacao({ open: true, data: null, produtoId: selecionado.id })}>Adicionar</Button>}
        semPadding
      >
        {!selecionado.variacoes || selecionado.variacoes.length === 0 ? (
          <p className="m-0 px-4 py-4 text-[13px] text-[var(--text-muted)]">Sem variações. Adicione uma pra definir o preço.</p>
        ) : (
          selecionado.variacoes.map((v) => (
            <div key={v.id} className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0 text-[13px]">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[var(--text-main)] [overflow-wrap:anywhere]">{v.nome}</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {[fmtDuracao(v.duracaoMin), Number(v.precoCusto) > 0 ? `custo ${fmtBRL(v.precoCusto)}` : null, v.sku ? `SKU ${v.sku}` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="font-semibold tabular-nums text-[var(--text-main)] whitespace-nowrap">{fmtBRL(v.preco)}</span>
              <Dropdown trigger={<IconButton icon={MoreHorizontal} variant="ghost" size="sm" ariaLabel={`Ações da variação ${v.nome}`} />}>
                <DropdownItem icon={Edit2} onClick={() => setModalVariacao({ open: true, data: v, produtoId: selecionado.id })}>Editar</DropdownItem>
                <DropdownDivider />
                <DropdownItem icon={Trash2} variant="danger" onClick={() => handleExcluirVariacao(v)}>Excluir</DropdownItem>
              </Dropdown>
            </div>
          ))
        )}
      </Painel>
    </div>
  ) : !carregando && (
    <Painel titulo="Editar serviço">
      <p className="m-0 text-[13px] text-[var(--text-muted)]">Escolha um serviço na lista pra editar aqui.</p>
    </Painel>
  );

  return (
    <Pagina>
      <FaixaNumeros>
        <Numero
          rotulo="Serviços ativos"
          valor={numeros.ativos}
          detalhe={`de ${numeros.total} cadastrado(s)${numeros.pausados ? ` · ${numeros.pausados} pausado(s)` : ''}${numeros.arquivados ? ` · ${numeros.arquivados} arquivado(s)` : ''}`}
          carregando={carregando}
        />
        <Numero
          rotulo="No link de agendamento"
          valor={`${numeros.ativos} de ${numeros.total}`}
          progresso={numeros.total ? (numeros.ativos * 100) / numeros.total : 0}
          carregando={carregando}
          onClick={() => setFiltroVis('ATIVO')}
        />
        <Numero
          rotulo="Preço médio"
          valor={numeros.precoMedio == null ? '—' : fmtBRL(numeros.precoMedio)}
          detalhe="dos serviços ativos"
          carregando={carregando}
        />
        <Numero
          rotulo="Sem profissional"
          valor={numeros.semProf}
          tom={numeros.semProf > 0 ? 'alerta' : 'neutro'}
          detalhe={numeros.semProf > 0 ? 'a agenda não consegue marcar' : 'todos têm quem faz'}
          carregando={carregando}
        />
        {!pacSemPlano && !pacErro && (
          <Numero
            rotulo="Pacotes ativos"
            valor={pacotesAtivos}
            detalhe={`${pacotesAVenda.length} pacote(s) à venda`}
            carregando={pacCarregando}
          />
        )}
      </FaixaNumeros>

      <ColunasPagina lateral={lateral} larguraLateral={340}>
        <Painel semPadding>
          <h2 className="sr-only">Lista de serviços</h2>
          <BarraFerramentas>
            <div className="flex-1 min-w-[200px] max-w-sm">
              <SearchBar value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar serviço" />
            </div>
            <Select
              aria-label="Categoria"
              value={filtroCat}
              onChange={(e) => setFiltroCat(e.target.value)}
              placeholder="Toda categoria"
              options={categorias.map((c) => ({ value: c.id, label: c.nome }))}
              fullWidth={false}
              className="w-44"
            />
            <Select
              aria-label="Visibilidade"
              value={filtroVis}
              onChange={(e) => setFiltroVis(e.target.value)}
              placeholder="Toda visibilidade"
              options={VISIBILIDADES}
              fullWidth={false}
              className="w-44"
            />
            <div className="ml-auto">
              <Button variant="secondary" size="sm" icon={Tag} onClick={() => setModalCatServico(true)}>
                Categoria de serviço
              </Button>
            </div>
          </BarraFerramentas>

          {carregando && produtos.length === 0 ? (
            <div className="p-4 space-y-2" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 rounded-md bg-[var(--bg-subtle)] animate-pulse" />)}
            </div>
          ) : filtrados.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Nenhum serviço"
              description={produtos.length === 0 ? 'Cadastre seu primeiro serviço. Produtos físicos com estoque ficam em Estoque.' : 'Nenhum serviço bate com os filtros.'}
              action={produtos.length === 0 && (
                <Button variant="primary" icon={Plus} onClick={abrirNovo}>
                  Cadastrar serviço
                </Button>
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>Serviço</th>
                    <th className={th}>Duração</th>
                    <th className={th.replace("text-left", "text-right")}>Preço</th>
                    <th className={th}>Profissionais</th>
                    <th className={th}>Sinal</th>
                    <th className={th}>No link</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((p) => {
                    const sel = selecionado?.id === p.id;
                    const preco = precoDe(p);
                    const profs = (p.especialistas || []).map((e) => primeiroNome(e.nome)).filter(Boolean);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => escolher(p)}
                        className={`cursor-pointer transition-colors ${sel ? 'bg-[var(--primary-soft)]' : 'hover:bg-[var(--bg-subtle)]'}`}
                      >
                        <td className={td}>
                          <button
                            type="button"
                            aria-current={sel ? 'true' : undefined}
                            onClick={(e) => { e.stopPropagation(); escolher(p); }}
                            className="p-0 bg-transparent border-0 text-left font-semibold text-[var(--text-main)] hover:text-[var(--primary)] hover:underline cursor-pointer"
                          >
                            {p.nome}
                          </button>
                          <div className="text-xs text-[var(--text-muted)] line-clamp-1">
                            {p.categoria?.nome || nomeCategoria(p.categoriaId) || p.descricao || ''}
                          </div>
                        </td>
                        <td className={`${td} whitespace-nowrap text-[var(--text-secondary)]`}>{fmtDuracao(duracaoDe(p))}</td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums font-semibold text-[var(--text-main)]`}>
                          {preco == null ? '—' : <>{preco.varios && <span className="text-xs font-normal text-[var(--text-muted)]">a partir de </span>}{fmtBRL(preco.valor)}</>}
                        </td>
                        <td className={`${td} text-[var(--text-secondary)]`}>
                          {profs.length ? profs.join(', ') : <Badge variant="warning" size="sm">Ninguém</Badge>}
                        </td>
                        <td className={`${td} whitespace-nowrap text-[var(--text-secondary)]`}>{textoSinal(p)}</td>
                        <td className={`${td} whitespace-nowrap`}><BadgeLink visibilidade={p.visibilidade} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Painel>

        <PainelPacotes
          modelos={pacModelos}
          clientes={pacClientes}
          carregando={pacCarregando}
          semPlano={pacSemPlano}
          erro={pacErro}
        />
      </ColunasPagina>

      {/* Modal Produto (novo serviço). Editar e excluir ficam no editor da direita. */}
      <ModalServico
        isOpen={modalProduto.open}
        onClose={() => setModalProduto({ open: false, data: null })}
        produto={modalProduto.data}
        categorias={categorias}
        especialistas={especialistas}
        onSalvar={handleSalvar}
        onCriarCategoria={criarCategoriaRapida}
        onEuAtendo={euMesmoAtendo}
      />

      <ModalCategoriaServico
        isOpen={modalCatServico}
        onClose={() => setModalCatServico(false)}
        onSalvar={handleSalvarCategoriaServico}
      />

      {/* Modal Variacao — Catalogo so lida com servicos, sem condicional de tipo. */}
      <ModalVariacao
        isOpen={modalVariacao.open}
        onClose={() => setModalVariacao({ open: false, data: null, produtoId: null })}
        variacao={modalVariacao.data}
        onSalvar={handleSalvarVariacao}
      />
    </Pagina>
  );
}
