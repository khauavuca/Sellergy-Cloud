import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  Box, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, TrendingUp,
  Plus, Edit2, Trash2, MoreHorizontal, Tag, Image as ImageIcon, ArrowLeftRight,
  HelpCircle,
} from 'lucide-react';
import api from '../services/api';
import {
  Button, IconButton, Input, Textarea, Select, Badge,
  EmptyState, useToast,
  Dropdown, DropdownItem, DropdownDivider, UploadImagem,
  Tooltip, Switch,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, BarraFerramentas,
} from '../components/ui';
import Modal from '../components/Modal';
import catalogoService from '../services/catalogoService';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import { AbasEstoque, BuscaEstoque } from '../components/estoque/NavEstoque';
import LateralEstoque from '../components/estoque/LateralEstoque';

// Abas da tela (slug da URL). A navegação entre elas fica nas pílulas do
// topo do painel principal (AbasEstoque) e no menu lateral.
const ABAS_VALIDAS = ['visao-geral', 'produtos', 'movimentacoes', 'reposicao', 'categorias'];

const PLACEHOLDER_BUSCA = {
  produtos: 'Buscar produto, variação, SKU...',
  movimentacoes: 'Buscar por produto ou observação...',
  reposicao: 'Buscar produto pra repor...',
  categorias: 'Buscar categoria...',
};

const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v) => Number(v ?? 0).toLocaleString('pt-BR');

const TIPO_MOV_LABELS = {
  COMPRA_FORNECEDOR: { label: 'Compra', variant: 'info', sentido: 'in' },
  VENDA: { label: 'Venda', variant: 'success', sentido: 'out' },
  AJUSTE: { label: 'Ajuste', variant: 'warning', sentido: 'in' },
  DEVOLUCAO: { label: 'Devolução', variant: 'neutral', sentido: 'in' },
  RESERVA: { label: 'Reserva', variant: 'neutral', sentido: 'out' },
};

const TH = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const TD = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';

const ehVariacaoPadrao = (nome) => !nome || nome === 'Padrão' || nome === 'Padrao';

// Situação da variação a partir do estoque atual x mínimo (mesma regra do
// "abaixo do mínimo" do backend: atual < mínimo).
function situacaoEstoque(v) {
  const qtd = v.estoqueAtual || 0;
  const min = v.estoqueMinimo || 0;
  if (min > 0 && qtd < min) return { rotulo: 'Repor', variant: 'danger', cor: 'var(--danger)' };
  if (qtd <= 0) return { rotulo: 'Zerado', variant: 'danger', cor: 'var(--danger)' };
  if (min > 0 && qtd === min) return { rotulo: 'No mínimo', variant: 'warning', cor: 'var(--warning)' };
  return { rotulo: 'Ok', variant: 'success', cor: 'var(--success)' };
}

// Barra de nível: cheia em 2x o mínimo (ou no ideal, quando não há mínimo).
function NivelEstoque({ v, situacao }) {
  const qtd = v.estoqueAtual || 0;
  const min = v.estoqueMinimo || 0;
  const base = min > 0 ? min * 2 : (v.estoqueIdeal > 0 ? v.estoqueIdeal : Math.max(qtd, 1));
  const pct = Math.max(0, Math.min(100, Math.round((qtd / base) * 100)));
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-subtle)]" aria-hidden="true">
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: situacao.cor }} />
      </div>
      <span className="font-semibold tabular-nums text-right min-w-[44px] text-[var(--text-main)]">
        {fmtNum(qtd)} un.
      </span>
    </div>
  );
}

function Miniatura({ url }) {
  return url ? (
    <img src={url} alt="" className="w-8 h-8 rounded-md object-contain flex-shrink-0 bg-[var(--bg-subtle)]" />
  ) : (
    <div className="w-8 h-8 rounded-md bg-[var(--bg-subtle)] flex items-center justify-center flex-shrink-0 text-[var(--text-muted)]">
      <ImageIcon size={14} aria-hidden="true" />
    </div>
  );
}

export default function EstoquePage() {
  const toast = useToast();
  const { aba: abaUrl } = useParams();
  const navigate = useNavigate();
  const aba = ABAS_VALIDAS.includes(abaUrl) ? abaUrl : 'visao-geral';
  const [carregado, setCarregado] = useState(false);
  const [stats, setStats] = useState(null);
  const [movimentacoes, setMovimentacoes] = useState([]);
  const [reposicao, setReposicao] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [busca, setBusca] = useState('');

  const [modalMov, setModalMov] = useState({ open: false });
  // ?novo=produto (atalho do "Registrar venda" sem produto) ja abre o cadastro.
  const [searchParams] = useSearchParams();
  const [modalProduto, setModalProduto] = useState(() => ({ open: searchParams.get('novo') === 'produto', data: null }));
  const [modalEditarVar, setModalEditarVar] = useState({ open: false, variacao: null });
  const [modalCategoria, setModalCategoria] = useState({ open: false, data: null });

  // A busca so faz setState na resposta (sem setState sincrono no efeito).
  const carregar = useCallback(() => Promise.all([
    api.get('/estoque/dashboard').catch(() => ({ data: null })),
    api.get('/estoque/movimentacoes').catch(() => ({ data: [] })),
    api.get('/estoque/reposicao').catch(() => ({ data: [] })),
    api.get('/catalogo').catch(() => ({ data: [] })),
    api.get('/financeiro/categorias?uso=PRODUTO').catch(() => ({ data: [] })),
  ]).then(([s, m, r, p, c]) => {
    setStats(s.data);
    setMovimentacoes(m.data || []);
    setReposicao(r.data || []);
    // Estoque so lista produtos FISICOS. Servicos sao gerenciados no Catalogo.
    // Filtro local pra blindar contra dados legados/criados por outras vias
    // (ex: bot) — backend continua retornando tudo do tenant.
    setProdutos((p.data || []).filter((prod) => prod.tipo === 'FISICO'));
    setCategorias(c.data || []);
    setCarregado(true);
  }), []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Botão principal no topo (um por aba).
  useAcaoTopo(
    aba === 'movimentacoes' || aba === 'reposicao' ? (
      <Button size="sm" icon={Plus} onClick={() => setModalMov({ open: true })}>Nova movimentação</Button>
    ) : aba === 'categorias' ? (
      <Button size="sm" icon={Plus} onClick={() => setModalCategoria({ open: true, data: null })}>Nova categoria</Button>
    ) : (
      <Button size="sm" icon={Plus} onClick={() => setModalProduto({ open: true, data: null })}>Novo produto</Button>
    ),
    [aba]
  );

  // Categorias do estoque = categorias financeiras de tipo RECEITA (produtos vendidos viram receita)
  const categoriasProdutos = useMemo(
    () => categorias.filter((c) => c.tipo === 'RECEITA'),
    [categorias]
  );

  const variacoesFlat = useMemo(() => {
    const out = [];
    produtos.forEach((p) => {
      (p.variacoes || []).forEach((v) => out.push({ ...v, produto: p }));
    });
    return out;
  }, [produtos]);

  const variacoesFiltered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return variacoesFlat;
    return variacoesFlat.filter(
      (v) => v.nome?.toLowerCase().includes(q) ||
             v.produto?.nome?.toLowerCase().includes(q) ||
             v.sku?.toLowerCase().includes(q)
    );
  }, [variacoesFlat, busca]);

  // Filtros das outras abas — todas usam o mesmo `busca` (campo na barra do painel).
  const movimentacoesFiltered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return movimentacoes;
    return movimentacoes.filter((m) =>
      m.variacao?.produto?.nome?.toLowerCase().includes(q) ||
      m.variacao?.nome?.toLowerCase().includes(q) ||
      m.observacao?.toLowerCase().includes(q)
    );
  }, [movimentacoes, busca]);

  const reposicaoFiltered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return reposicao;
    return reposicao.filter((r) =>
      r.produto?.toLowerCase().includes(q) ||
      r.variacao?.toLowerCase().includes(q)
    );
  }, [reposicao, busca]);

  const categoriasFiltered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return categoriasProdutos;
    return categoriasProdutos.filter((c) => c.nome?.toLowerCase().includes(q));
  }, [categoriasProdutos, busca]);

  // Entradas e saídas do mês corrente (soma das quantidades das movimentações).
  const resumoMes = useMemo(() => {
    const agora = new Date();
    const inicio = new Date(agora.getFullYear(), agora.getMonth(), 1);
    let saidas = 0;
    let entradas = 0;
    movimentacoes.forEach((m) => {
      if (new Date(m.data) < inicio) return;
      const q = Number(m.quantidade) || 0;
      if (q < 0) saidas += -q;
      else entradas += q;
    });
    return { saidas, entradas };
  }, [movimentacoes]);

  const abrirReposicao = (r) => setModalMov({
    open: true,
    variacaoIdInicial: r.variacaoId || r.id,
    quantidadeInicial: r.necessidade,
    tipoInicial: 'COMPRA_FORNECEDOR',
  });

  const handleMovimentar = async (dados) => {
    try {
      await api.post('/estoque/movimentar', dados);
      toast.success('Movimentação registrada');
      setModalMov({ open: false });
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao movimentar');
    }
  };

  const handleSalvarProduto = async (dados) => {
    try {
      // Cria produto + variacao em sequencia (uma chamada de catalogo POST com variacoes inline)
      await api.post('/catalogo', dados);
      toast.success('Produto criado');
      setModalProduto({ open: false, data: null });
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao criar produto');
    }
  };

  const handleSalvarCategoria = async (dados) => {
    try {
      if (dados.id) {
        await api.patch(`/financeiro/categorias/${dados.id}`, dados);
        toast.success('Categoria atualizada');
      } else {
        await api.post('/financeiro/categorias', { ...dados, tipo: 'RECEITA', uso: 'PRODUTO' });
        toast.success('Categoria criada');
      }
      setModalCategoria({ open: false, data: null });
      carregar();
    } catch {
      toast.error('Erro ao salvar categoria');
    }
  };

  const handleExcluirCategoria = async (c) => {
    if (!confirm(`Excluir categoria "${c.nome}"?`)) return;
    try {
      await api.delete(`/financeiro/categorias/${c.id}`);
      toast.success('Categoria excluída');
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao excluir');
    }
  };

  const abaixoMin = stats?.itensAbaixoMinimo ?? 0;
  const ruptura = stats?.indiceRuptura ?? 0;

  return (
    <Pagina>
      <FaixaNumeros min={190}>
        <Numero
          rotulo="Valor em estoque (custo)"
          valor={fmtBRL(stats?.valorTotalInventario)}
          detalhe={`${fmtNum(variacoesFlat.length)} ${variacoesFlat.length === 1 ? 'item físico' : 'itens físicos'}`}
          carregando={!carregado}
        />
        <Numero
          rotulo="Abaixo do mínimo"
          valor={fmtNum(abaixoMin)}
          tom={abaixoMin > 0 ? 'perigo' : 'neutro'}
          detalhe={`${fmtNum(reposicao.length)} na fila de reposição`}
          carregando={!carregado}
          onClick={aba !== 'reposicao' ? () => navigate('/app/estoque/reposicao') : undefined}
        />
        <Numero
          rotulo="Saídas no mês"
          valor={`${fmtNum(resumoMes.saidas)} un.`}
          detalhe={`${fmtNum(resumoMes.entradas)} un. de entrada`}
          carregando={!carregado}
          onClick={aba !== 'movimentacoes' ? () => navigate('/app/estoque/movimentacoes') : undefined}
        />
        <Numero
          rotulo="Índice de ruptura"
          valor={`${String(ruptura).replace('.', ',')}%`}
          tom={ruptura > 5 ? 'alerta' : 'neutro'}
          detalhe="itens com estoque zerado"
          carregando={!carregado}
        />
      </FaixaNumeros>

      <ColunasPagina
        lateral={
          <LateralEstoque
            reposicao={carregado ? reposicao : null}
            onRepor={abrirReposicao}
          />
        }
      >
        <Painel semPadding>
          <BarraFerramentas>
            <AbasEstoque ativa={aba} qtds={{ reposicao: reposicao.length }} />
            {aba !== 'visao-geral' && (
              <BuscaEstoque value={busca} onChange={setBusca} placeholder={PLACEHOLDER_BUSCA[aba]} />
            )}
          </BarraFerramentas>

          {/* Visão geral */}
          {aba === 'visao-geral' && (
            <>
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--border-subtle)]">
                <h2 className="m-0 text-sm font-bold text-[var(--text-main)] tracking-tight">Movimentações recentes</h2>
                {movimentacoes.length > 0 && (
                  <Link to="/app/estoque/movimentacoes" className="text-xs font-semibold text-[var(--primary)] hover:underline">
                    Ver todas
                  </Link>
                )}
              </div>
              {movimentacoes.length === 0 ? (
                <EmptyState icon={TrendingUp} title="Nenhuma movimentação" description="Registre entradas e saídas." />
              ) : (
                <ListaMovimentacoes movimentacoes={movimentacoes.slice(0, 10)} />
              )}
            </>
          )}

          {/* Produtos */}
          {aba === 'produtos' && (
            variacoesFiltered.length === 0 ? (
              <EmptyState
                icon={Box}
                title={busca ? 'Nenhum produto encontrado' : 'Nenhum produto'}
                description={busca ? 'Tente outro termo.' : 'Cadastre seus produtos pra controlar estoque.'}
                action={!busca && <Button variant="primary" size="sm" icon={Plus} onClick={() => setModalProduto({ open: true, data: null })}>Novo produto</Button>}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      <th className={TH}>Produto</th>
                      <th className={TH}>Categoria</th>
                      <th className={TH}>Estoque</th>
                      <th className={`${TH} text-right`}>Custo</th>
                      <th className={`${TH} text-right`}>Venda</th>
                      <th className={`${TH} text-right`}>Lucro</th>
                      <th className={`${TH} text-right`}>Valor total</th>
                      <th className={TH}>Situação</th>
                      <th className={TH}><span className="sr-only">Ações</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {variacoesFiltered.map((v) => {
                      const cat = categorias.find((c) => c.id === v.produto?.categoriaId);
                      const situacao = situacaoEstoque(v);
                      return (
                        <tr key={v.id} className="hover:bg-[var(--bg-subtle)]">
                          <td className={TD}>
                            <div className="flex items-center gap-2.5 min-w-[180px]">
                              <Miniatura url={v.imagemUrl || v.produto?.imagemUrl} />
                              <div className="min-w-0">
                                <div className="font-semibold text-[var(--text-main)] truncate">{v.produto?.nome}</div>
                                {(!ehVariacaoPadrao(v.nome) || v.sku) && (
                                  <div className="text-xs text-[var(--text-muted)] truncate">
                                    {!ehVariacaoPadrao(v.nome) && v.nome}
                                    {!ehVariacaoPadrao(v.nome) && v.sku && ' · '}
                                    {v.sku && `SKU ${v.sku}`}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className={`${TD} text-[var(--text-secondary)] whitespace-nowrap`}>{cat ? cat.nome : '—'}</td>
                          <td className={TD}><NivelEstoque v={v} situacao={situacao} /></td>
                          <td className={`${TD} text-right tabular-nums text-[var(--text-secondary)] whitespace-nowrap`}>{fmtBRL(v.precoCusto)}</td>
                          <td className={`${TD} text-right tabular-nums text-[var(--text-main)] whitespace-nowrap`}>{fmtBRL(v.preco)}</td>
                          <td className={`${TD} text-right tabular-nums text-[var(--success-text)] whitespace-nowrap`}>{fmtBRL((v.preco || 0) - (v.precoCusto || 0))}</td>
                          <td className={`${TD} text-right tabular-nums font-semibold text-[var(--text-main)] whitespace-nowrap`}>{fmtBRL(v.estoqueAtual * (v.precoCusto || 0))}</td>
                          <td className={TD}><Badge variant={situacao.variant} size="sm">{situacao.rotulo}</Badge></td>
                          <td className={`${TD} text-right`}>
                            <Dropdown trigger={<IconButton icon={MoreHorizontal} size="sm" variant="ghost" ariaLabel={`Ações de ${v.produto?.nome}`} />} align="right">
                              <DropdownItem
                                icon={ArrowLeftRight}
                                onClick={() => setModalMov({ open: true, variacaoIdInicial: v.id })}
                              >
                                Nova movimentação
                              </DropdownItem>
                              <DropdownItem
                                icon={Edit2}
                                onClick={() => setModalEditarVar({ open: true, variacao: v })}
                              >
                                Editar produto
                              </DropdownItem>
                              {cat && (
                                <>
                                  <DropdownDivider />
                                  <DropdownItem
                                    icon={Tag}
                                    onClick={() => {
                                      setBusca(cat.nome);
                                      navigate('/app/estoque/categorias');
                                    }}
                                  >
                                    Ver categoria
                                  </DropdownItem>
                                </>
                              )}
                            </Dropdown>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Movimentações */}
          {aba === 'movimentacoes' && (
            movimentacoesFiltered.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title={busca ? 'Nenhuma movimentação encontrada' : 'Nenhuma movimentação'}
                description={busca ? 'Tente outro termo.' : 'Registre entradas e saídas pra rastrear o estoque.'}
                action={!busca && (
                  <Button variant="primary" size="sm" icon={Plus} onClick={() => setModalMov({ open: true })}>
                    Nova movimentação
                  </Button>
                )}
              />
            ) : (
              <ListaMovimentacoes
                movimentacoes={movimentacoesFiltered}
                onVerProduto={(nome) => {
                  // Link cruzado: leva pra aba Produtos ja filtrando pelo nome.
                  setBusca(nome);
                  navigate('/app/estoque/produtos');
                }}
              />
            )
          )}

          {/* Reposição */}
          {aba === 'reposicao' && (
            reposicaoFiltered.length === 0 ? (
              <EmptyState
                icon={AlertTriangle}
                title={busca ? 'Nenhum produto encontrado' : 'Nada para repor'}
                description={busca ? 'Tente outro termo.' : 'Tudo acima do mínimo. Você está em dia.'}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      <th className={TH}>Produto / Variação</th>
                      <th className={`${TH} text-right`}>Atual</th>
                      <th className={`${TH} text-right`}>Mínimo</th>
                      <th className={`${TH} text-right`}>Ideal</th>
                      <th className={`${TH} text-right`}>Repor</th>
                      <th className={TH}>Urgência</th>
                      <th className={TH}><span className="sr-only">Ações</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {reposicaoFiltered.map((r) => (
                      <tr key={r.id} className="hover:bg-[var(--bg-subtle)]">
                        <td className={TD}>
                          <div className="flex items-center gap-2.5 min-w-[180px]">
                            <Miniatura url={r.imagemUrl} />
                            <div className="min-w-0">
                              <div className="font-semibold text-[var(--text-main)] truncate">{r.produto}</div>
                              {!ehVariacaoPadrao(r.variacao) && <div className="text-xs text-[var(--text-muted)] truncate">{r.variacao}</div>}
                            </div>
                          </div>
                        </td>
                        <td className={`${TD} text-right font-semibold tabular-nums text-[var(--danger-text)]`}>{r.estoqueAtual}</td>
                        <td className={`${TD} text-right tabular-nums text-[var(--text-muted)]`}>{r.estoqueMinimo || 0}</td>
                        <td className={`${TD} text-right tabular-nums text-[var(--text-muted)]`}>{r.estoqueIdeal || 0}</td>
                        <td className={`${TD} text-right font-semibold tabular-nums text-[var(--text-main)]`}>{r.necessidade}</td>
                        <td className={TD}>
                          <Badge variant={r.urgencia === 'ALTA' ? 'danger' : 'warning'} size="sm">
                            {r.urgencia === 'ALTA' ? 'Alta' : 'Média'}
                          </Badge>
                        </td>
                        <td className={TD}>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="primary" size="sm" icon={ArrowDownToLine} onClick={() => abrirReposicao(r)}>
                              Repor
                            </Button>
                            <Dropdown trigger={<IconButton icon={MoreHorizontal} variant="ghost" size="sm" ariaLabel={`Mais ações de ${r.produto}`} />} align="right">
                              <DropdownItem
                                icon={Box}
                                onClick={() => {
                                  setBusca(r.produto);
                                  navigate('/app/estoque/produtos');
                                }}
                              >
                                Ver produto
                              </DropdownItem>
                            </Dropdown>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Categorias */}
          {aba === 'categorias' && (
            categoriasFiltered.length === 0 ? (
              <EmptyState
                icon={Tag}
                title={busca ? 'Nenhuma categoria encontrada' : 'Nenhuma categoria'}
                description={
                  busca
                    ? 'Tente outro termo.'
                    : 'Categorias agrupam seus produtos (ex: Bebidas, Roupas, Cabelo). Vincule cada produto a uma categoria pra organizar relatórios e CMV.'
                }
                action={!busca && (
                  <Button variant="primary" size="sm" icon={Plus} onClick={() => setModalCategoria({ open: true, data: null })}>
                    Criar primeira categoria
                  </Button>
                )}
              />
            ) : (
              <div>
                {categoriasFiltered.map((c) => {
                  const qtdVariacoes = variacoesFlat.filter((v) => v.produto?.categoriaId === c.id).length;
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-subtle)]">
                      <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)] flex items-center justify-center flex-shrink-0">
                        <Tag size={14} strokeWidth={1.75} aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-[var(--text-main)] truncate">{c.nome}</div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {qtdVariacoes} {qtdVariacoes === 1 ? 'variação vinculada' : 'variações vinculadas'}
                        </div>
                      </div>
                      <Dropdown trigger={<IconButton icon={MoreHorizontal} variant="ghost" size="sm" ariaLabel={`Ações da categoria ${c.nome}`} />} align="right">
                        <DropdownItem icon={Edit2} onClick={() => setModalCategoria({ open: true, data: c })}>Editar</DropdownItem>
                        <DropdownDivider />
                        <DropdownItem icon={Trash2} variant="danger" onClick={() => handleExcluirCategoria(c)}>Excluir</DropdownItem>
                      </Dropdown>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </Painel>
      </ColunasPagina>

      <ModalMovimentacao
        key={modalMov.open ? 'mov-aberto' : 'mov-fechado'}
        isOpen={modalMov.open}
        onClose={() => setModalMov({ open: false })}
        variacoes={variacoesFlat}
        onSalvar={handleMovimentar}
        variacaoIdInicial={modalMov.variacaoIdInicial}
        quantidadeInicial={modalMov.quantidadeInicial}
        tipoInicial={modalMov.tipoInicial}
      />
      <ModalEditarVariacao
        key={modalEditarVar.open ? `editar-var-${modalEditarVar.variacao?.id ?? ''}` : 'editar-var-fechado'}
        isOpen={modalEditarVar.open}
        onClose={() => setModalEditarVar({ open: false, variacao: null })}
        variacao={modalEditarVar.variacao}
        onSucesso={() => {
          carregar();
          setModalEditarVar({ open: false, variacao: null });
        }}
      />
      <ModalProduto
        key={modalProduto.open ? 'produto-aberto' : 'produto-fechado'}
        isOpen={modalProduto.open}
        onClose={() => setModalProduto({ open: false, data: null })}
        categorias={categoriasProdutos}
        onSalvar={handleSalvarProduto}
      />
      <ModalCategoria
        key={modalCategoria.open ? `categoria-${modalCategoria.data?.id ?? 'nova'}` : 'categoria-fechada'}
        isOpen={modalCategoria.open}
        onClose={() => setModalCategoria({ open: false, data: null })}
        cat={modalCategoria.data}
        onSalvar={handleSalvarCategoria}
      />
    </Pagina>
  );
}

// Limpa o motivo gravado em movimentacoes antigas que tinham UUID no texto.
// Pra registros novos o backend ja grava com `Venda #<numero>` (humano).
// Aqui usamos o `m.venda.numero` quando disponivel pra ter consistencia
// mesmo em movimentacoes antigas (que tem UUID gravado no motivo).
function formatarMotivoMov(m) {
  if (m.vendaId) {
    const numero = m.venda?.numero;
    const sufixo = numero ? ` #${numero}` : '';
    if (m.tipo === 'DEVOLUCAO') return `Cancelamento da venda${sufixo}`;
    if (m.tipo === 'VENDA') return `Venda${sufixo}`;
  }
  if (!m.motivo) return 'Sem motivo';
  // Remove UUID se vier no texto (formato "Venda #abc-123-..." ou similar).
  return m.motivo.replace(/#[a-f0-9-]{20,}/gi, '').replace(/\s+—\s*$/, '').trim() || 'Sem motivo';
}

// onVerProduto: callback que filtra a aba Produtos pelo nome (link cruzado).
// Quando nao passado, o 3 pontinhos nao aparece (uso na Visao geral).
function ListaMovimentacoes({ movimentacoes, onVerProduto }) {
  return (
    <div>
      {movimentacoes.map((m) => {
        const tipo = TIPO_MOV_LABELS[m.tipo] || { label: m.tipo, variant: 'neutral', sentido: 'in' };
        const Icon = tipo.sentido === 'in' ? ArrowDownToLine : ArrowUpFromLine;
        const imagemUrl = m.variacao?.imagemUrl || m.variacao?.produto?.imagemUrl;
        const motivoLimpo = formatarMotivoMov(m);
        const nomeProduto = m.variacao?.produto?.nome;
        return (
          <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-subtle)]">
            <Miniatura url={imagemUrl} />
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
              tipo.sentido === 'in' ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'bg-[var(--danger-soft)] text-[var(--danger-text)]'
            }`}>
              <Icon size={13} strokeWidth={2} aria-label={tipo.sentido === 'in' ? 'Entrada' : 'Saída'} />
            </div>
            <div className="flex-1 min-w-[160px]">
              <div className="text-[13px] font-semibold text-[var(--text-main)] truncate">
                {nomeProduto}{!ehVariacaoPadrao(m.variacao?.nome) && ` · ${m.variacao?.nome}`}
              </div>
              <div className="text-xs text-[var(--text-muted)] truncate">
                {motivoLimpo} · {new Date(m.data).toLocaleString('pt-BR')}
              </div>
            </div>
            <Badge variant={tipo.variant} size="sm">{tipo.label}</Badge>
            <div className={`text-sm font-bold tabular-nums w-14 text-right ${
              m.quantidade > 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]'
            }`}>
              {m.quantidade > 0 ? '+' : ''}{m.quantidade}
            </div>
            {/* 3 pontinhos so quando habilitado (aba Movimentacoes — nao em Visao geral) */}
            {onVerProduto && nomeProduto && (
              <Dropdown trigger={<IconButton icon={MoreHorizontal} variant="ghost" size="sm" ariaLabel={`Ações de ${nomeProduto}`} />} align="right">
                <DropdownItem
                  icon={Box}
                  onClick={() => onVerProduto(nomeProduto)}
                >
                  Ver no produto
                </DropdownItem>
              </Dropdown>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Tipos de movimentacao expostos no UI. `direcao` controla se a quantidade
// vai virar positiva (entrada) ou negativa (saida) no submit.
// AJUSTE_POSITIVO/NEGATIVO sao "atalhos" do mesmo tipo AJUSTE no backend —
// a direcao e definida pela quantidade gravada (positiva ou negativa).
// Venda NAO e lancada por aqui: vai pela tela de Vendas (caixa, numero, cupom).
const TIPOS_MOVIMENTACAO = [
  { value: 'COMPRA_FORNECEDOR', label: 'Compra de fornecedor', sentido: 'in', sublabel: 'entrada', icone: '📦', tipoBackend: 'COMPRA_FORNECEDOR' },
  { value: 'DEVOLUCAO',          label: 'Devolução do cliente', sentido: 'in', sublabel: 'entrada', icone: '↩️', tipoBackend: 'DEVOLUCAO' },
  { value: 'AJUSTE_POSITIVO',    label: 'Ajuste para mais', sentido: 'in', sublabel: 'corrigir contagem', icone: '➕', tipoBackend: 'AJUSTE' },
  { value: 'AJUSTE_NEGATIVO',    label: 'Ajuste para menos', sentido: 'out', sublabel: 'corrigir contagem (perda/quebra)', icone: '➖', tipoBackend: 'AJUSTE' },
  { value: 'RESERVA',            label: 'Reserva', sentido: 'out', sublabel: 'separar pra cliente', icone: '🔒', tipoBackend: 'RESERVA' },
];

const fmtBRL2 = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function ModalMovimentacao({ isOpen, onClose, variacoes, onSalvar, variacaoIdInicial, quantidadeInicial, tipoInicial }) {
  // O pai troca a `key` a cada abertura, entao o form nasce com os valores
  // iniciais da abertura (em vez de um efeito que resetava ao abrir).
  const [form, setForm] = useState(() => ({
    variacaoId: variacaoIdInicial || '',
    // Quando vem de 'Repor agora' na Reposicao, ja chega prefilado como
    // COMPRA_FORNECEDOR + quantidade sugerida.
    tipo: tipoInicial || 'COMPRA_FORNECEDOR',
    quantidade: quantidadeInicial && quantidadeInicial > 0 ? quantidadeInicial : 1,
    motivo: '', precoCusto: '', precoVenda: ''
  }));

  const variacaoSel = variacoes.find((v) => v.id === form.variacaoId);
  const tipoCfg = TIPOS_MOVIMENTACAO.find((t) => t.value === form.tipo);
  const ehSaida = tipoCfg?.sentido === 'out';
  const ehCompra = form.tipo === 'COMPRA_FORNECEDOR';
  const maxQtd = ehSaida && variacaoSel ? variacaoSel.estoqueAtual : null;

  const qtdNum = Math.max(0, parseInt(form.quantidade, 10) || 0);
  const estoqueAtual = variacaoSel?.estoqueAtual ?? 0;
  const estoqueMinimo = variacaoSel?.estoqueMinimo ?? 0;
  const estoqueDepois = variacaoSel
    ? (ehSaida ? estoqueAtual - qtdNum : estoqueAtual + qtdNum)
    : null;
  const valorTotalCompra = (ehCompra && form.precoCusto && qtdNum > 0)
    ? qtdNum * parseFloat(form.precoCusto)
    : null;

  const [salvando, setSalvando] = useState(false);
  const estoqueAtualBaixo = variacaoSel && variacaoSel.produto?.tipo === 'FISICO' && estoqueAtual <= estoqueMinimo;
  const estoqueDepoisBaixo = variacaoSel && variacaoSel.produto?.tipo === 'FISICO' && estoqueDepois !== null && estoqueDepois <= estoqueMinimo;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (salvando) return;
    if (!form.variacaoId) { alert('Selecione um produto'); return; }
    if (!tipoCfg) { alert('Tipo invalido'); return; }

    let quantidade = Number(String(form.quantidade).replace(',', '.'));
    if (!Number.isInteger(quantidade) || quantidade < 1) {
      alert('Quantidade deve ser um número inteiro maior que zero');
      return;
    }

    if (ehSaida) {
      if (maxQtd !== null && quantidade > maxQtd) {
        alert(`Estoque insuficiente. Disponivel: ${maxQtd}`);
        return;
      }
      quantidade = -Math.abs(quantidade);
    } else {
      quantidade = Math.abs(quantidade);
    }

    // Trava o botao enquanto salva (clique duplo nao lanca 2 vezes).
    setSalvando(true);
    try {
      await onSalvar({
        variacaoId: form.variacaoId,
        tipo: tipoCfg.tipoBackend, // mapeia AJUSTE_POSITIVO/NEGATIVO -> AJUSTE
        quantidade,
        motivo: form.motivo,
        precoCusto: form.precoCusto || undefined,
        precoVenda: form.precoVenda || undefined,
      });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar movimentação" description="Compra, devolução, reserva ou ajuste manual. Venda é pela tela de Vendas." size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Produto"
          value={form.variacaoId}
          onChange={(e) => setForm({ ...form, variacaoId: e.target.value })}
          placeholder="Selecione um produto..."
          options={variacoes.map((v) => ({
            value: v.id,
            label: `${v.produto?.nome}${v.nome && v.nome !== 'Padrão' && v.nome !== 'Padrao' ? ' · ' + v.nome : ''} (${v.estoqueAtual} em estoque)`
          }))}
          required
        />

        {/* Card de detalhes do produto selecionado */}
        {variacaoSel && (
          <CardProdutoSelecionado
            variacao={variacaoSel}
            estoqueBaixo={estoqueAtualBaixo}
          />
        )}

        <Select
          label="O que aconteceu?"
          value={form.tipo}
          onChange={(e) => setForm({ ...form, tipo: e.target.value })}
          options={TIPOS_MOVIMENTACAO.map((t) => ({
            value: t.value,
            label: `${t.icone} ${t.label} — ${t.sublabel}`,
          }))}
          placeholder=""
        />

        <Input
          label="Quantidade"
          type="number"
          min="1"
          max={maxQtd ?? undefined}
          value={form.quantidade}
          onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
          required
          hint={ehSaida && maxQtd !== null ? `Disponível em estoque: ${maxQtd}` : undefined}
        />

        {/* Preview do impacto */}
        {variacaoSel && qtdNum > 0 && variacaoSel.produto?.tipo === 'FISICO' && (
          <div className={`text-xs px-3 py-2.5 rounded-xl border ${
            estoqueDepoisBaixo
              ? 'bg-[var(--warning-soft)] border-[var(--warning)]/30 text-[var(--warning)]'
              : ehSaida
                ? 'bg-[var(--bg-subtle)] border-[var(--border-main)] text-[var(--text-secondary)]'
                : 'bg-[var(--success-soft)] border-[var(--success)]/30 text-[var(--success)]'
          }`}>
            <strong>Estoque após esta movimentação:</strong>{' '}
            <span className="font-bold tabular-nums">{estoqueDepois}</span> unidades
            {estoqueDepoisBaixo && (
              <span className="ml-2 opacity-80">⚠ abaixo do estoque mínimo ({estoqueMinimo})</span>
            )}
            {valorTotalCompra !== null && (
              <span className="block mt-1">
                <strong>Valor total da compra:</strong> {fmtBRL2(valorTotalCompra)}
              </span>
            )}
          </div>
        )}

        {ehCompra && (
          <div className="border border-[var(--border-main)] rounded-xl p-4 bg-[var(--bg-subtle)]/40 space-y-3">
            <div className="text-xs font-semibold text-[var(--text-secondary)]">
              Atualizar preços (opcional)
            </div>
            <div className="text-[11px] text-[var(--text-muted)] -mt-2">
              Se preencher, atualiza o preço do produto pra próximas vendas/compras.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Novo preço de custo"
                type="number"
                step="0.01"
                min="0"
                value={form.precoCusto}
                onChange={(e) => setForm({ ...form, precoCusto: e.target.value })}
                placeholder={variacaoSel?.precoCusto ? `Atual: ${fmtBRL2(variacaoSel.precoCusto)}` : 'R$ 0,00'}
              />
              <Input
                label="Novo preço de venda"
                type="number"
                step="0.01"
                min="0"
                value={form.precoVenda}
                onChange={(e) => setForm({ ...form, precoVenda: e.target.value })}
                placeholder={variacaoSel?.preco ? `Atual: ${fmtBRL2(variacaoSel.preco)}` : 'R$ 0,00'}
              />
            </div>
          </div>
        )}

        <Textarea
          label="Motivo / observação"
          value={form.motivo}
          onChange={(e) => setForm({ ...form, motivo: e.target.value })}
          rows={2}
          placeholder={
            form.tipo === 'AJUSTE_NEGATIVO' ? 'Ex.: 2 unidades quebradas no manuseio' :
            form.tipo === 'AJUSTE_POSITIVO' ? 'Ex.: contagem física revelou 3 unidades a mais' :
            form.tipo === 'DEVOLUCAO' ? 'Ex.: cliente devolveu por defeito' :
            form.tipo === 'RESERVA' ? 'Ex.: separado pra Maria, retira sexta' :
            'Opcional'
          }
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">Cancelar</Button>
          <Button variant="primary" type="submit" disabled={salvando}>{salvando ? 'Registrando...' : 'Registrar'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// Modal de edicao rapida da variacao (foto, preco, custo, estoque, sku).
// Usa PUT /catalogo/variacoes/:id ja existente. Imagem usa o endpoint
// definitivo (variacao ja existe). Categoria/tipo do produto pai nao
// sao editaveis aqui — pra isso o cliente vai na tela de Catalogo.
// Calcula o preco de venda a partir do custo + lucro. VALOR = R$ fixo somado ao
// custo; PERCENTUAL = % sobre o custo. Em sync com o backend (CatalogoController).
function calcularPrecoVenda(custo, lucroTipo, lucroValor) {
  const c = parseFloat(custo) || 0;
  const l = parseFloat(lucroValor) || 0;
  const bruto = lucroTipo === 'PERCENTUAL' ? c * (1 + l / 100) : c + l;
  return Math.round(bruto * 100) / 100;
}

// Rotulo de campo com a explicacao escondida num icone de ajuda (?) logo ao
// lado do texto. Mantem o formulario limpo: a dica aparece no tooltip, nao
// embaixo do campo. Passe o retorno na prop `label` do Input (e remova o `hint`).
function rotuloAjuda(texto, ajuda) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{texto}</span>
      {ajuda && (
        <Tooltip content={ajuda} position="top">
          <HelpCircle
            size={15}
            strokeWidth={2}
            className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-help"
          />
        </Tooltip>
      )}
    </span>
  );
}

// Bloco de precificacao: o usuario digita o CUSTO e o LUCRO (R$ ou %), e o
// PRECO DE VENDA aparece calculado (custo + lucro). Quando o custo mudar (nota),
// o lucro fica e o preco recalcula sozinho. Usado nos forms de criar e editar.
function CampoCustoLucro({ form, setForm }) {
  const lucroTipo = form.lucroTipo === 'PERCENTUAL' ? 'PERCENTUAL' : 'VALOR';
  const preco = calcularPrecoVenda(form.precoCusto, lucroTipo, form.lucroValor);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Input
        size="lg"
        label={rotuloAjuda('Quanto você pagou (R$)', 'O custo de cada unidade — o quanto você gastou pra comprar ou produzir.')}
        type="number"
        step="0.01"
        min="0"
        value={form.precoCusto}
        onChange={(e) => setForm({ ...form, precoCusto: e.target.value })}
      />
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-secondary)] mb-1.5">
          <span>Seu lucro</span>
          <Tooltip content="Quanto você ganha em cima do custo. Escolha R$ (valor fixo) ou % do custo." position="top">
            <HelpCircle size={15} strokeWidth={2} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-help" />
          </Tooltip>
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.lucroValor ?? ''}
            onChange={(e) => setForm({ ...form, lucroValor: e.target.value })}
            className="flex-1 min-w-0 h-12 px-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-main)] text-[var(--text-main)] focus:outline-none focus:border-[var(--border-strong)]"
          />
          <div className="flex rounded-lg border border-[var(--border-main)] overflow-hidden flex-shrink-0">
            {['VALOR', 'PERCENTUAL'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm({ ...form, lucroTipo: t })}
                className={`px-3.5 text-sm font-medium transition-colors ${lucroTipo === t ? 'bg-[var(--primary)] text-[var(--text-on-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'}`}
              >
                {t === 'VALOR' ? 'R$' : '%'}
              </button>
            ))}
          </div>
        </div>      </div>
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-secondary)] mb-1.5">
          <span>Preço de venda</span>
          <Tooltip content="Custo + lucro. É o valor que o cliente paga. Calculado automaticamente." position="top">
            <HelpCircle size={15} strokeWidth={2} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-help" />
          </Tooltip>
        </label>
        <div className="h-12 px-4 flex items-center rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-main)] text-[var(--text-main)] font-semibold tabular-nums">
          {preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
        </div>      </div>
    </div>
  );
}

// Aluguel/devolucao — so faz sentido pra produto fisico (Estoque cadastra so
// FISICO, entao nao precisa checar tipo aqui). Quando ligado, a venda desse
// produto exige data de devolucao + cliente identificado.
function BlocoDevolucao({ form, setForm }) {
  return (
    <div className="border-t border-[var(--border-main)] pt-5">
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">
          {rotuloAjuda('Este produto é alugado?', 'Ative quando o cliente leva o produto emprestado e precisa devolver depois — o sistema vai pedir a data de devolução na venda e avisar quando ela chegar perto.')}
        </label>
        <Switch
          checked={form.temDevolucao}
          onChange={(v) => setForm({ ...form, temDevolucao: v, diasParaDevolucaoPadrao: v ? form.diasParaDevolucaoPadrao : '' })}
          ariaLabel="Este produto é alugado"
        />
      </div>
      {form.temDevolucao && (
        <div className="mt-3 max-w-xs">
          <Input
            label={rotuloAjuda('Prazo padrão (dias)', 'Quantos dias depois da venda o produto costuma voltar. Sugestão pro funcionário — ele pode ajustar a data exata em cada venda. Deixe em branco pra sempre escolher a data na hora.')}
            type="number"
            min="1"
            value={form.diasParaDevolucaoPadrao}
            onChange={(e) => setForm({ ...form, diasParaDevolucaoPadrao: e.target.value })}
            placeholder="Ex: 3"
          />
        </div>
      )}
    </div>
  );
}

function ModalEditarVariacao({ isOpen, onClose, variacao, onSucesso }) {
  const toast = useToast();
  // O pai troca a `key` a cada abertura, entao o form nasce da variacao atual
  // (em vez de um efeito que hidratava ao abrir).
  const [form, setForm] = useState(() => (isOpen && variacao
    ? {
      nome: variacao.nome || '',
      sku: variacao.sku || '',
      preco: variacao.preco ?? 0,
      precoCusto: variacao.precoCusto ?? 0,
      lucroTipo: variacao.lucroTipo || 'VALOR',
      lucroValor: variacao.lucroValor ?? 0,
      estoqueAtual: variacao.estoqueAtual ?? 0,
      estoqueMinimo: variacao.estoqueMinimo ?? 0,
      estoqueIdeal: variacao.estoqueIdeal ?? 0,
      // Fallback visual pra imagem do produto quando a variacao nao tem
      // imagem propria (mesma logica da tabela). Upload novo sobrescreve
      // na variacao; o produto fica intacto.
      imagemUrl: variacao.imagemUrl || variacao.produto?.imagemUrl || '',
      temDevolucao: variacao.produto?.temDevolucao ?? false,
      diasParaDevolucaoPadrao: variacao.produto?.diasParaDevolucaoPadrao ?? '',
    }
    : {
      nome: '', sku: '', preco: 0, precoCusto: 0, lucroTipo: 'VALOR', lucroValor: 0,
      estoqueAtual: 0, estoqueMinimo: 0, estoqueIdeal: 0,
      imagemUrl: '', temDevolucao: false, diasParaDevolucaoPadrao: '',
    }));
  const [salvando, setSalvando] = useState(false);

  if (!variacao) return null;

  const handleUploadImagem = async (file) => {
    const url = await catalogoService.uploadImagemVariacao(variacao.id, file);
    setForm((prev) => ({ ...prev, imagemUrl: url }));
  };

  const handleRemoverImagem = async () => {
    await catalogoService.removerImagemVariacao(variacao.id);
    setForm((prev) => ({ ...prev, imagemUrl: '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await Promise.all([
        api.put(`/catalogo/variacoes/${variacao.id}`, {
          nome: form.nome,
          sku: form.sku || null,
          precoCusto: parseFloat(form.precoCusto) || 0,
          lucroTipo: form.lucroTipo || 'VALOR',
          lucroValor: parseFloat(form.lucroValor) || 0,
          preco: calcularPrecoVenda(form.precoCusto, form.lucroTipo, form.lucroValor),
          estoqueAtual: parseInt(form.estoqueAtual, 10) || 0,
          estoqueMinimo: parseInt(form.estoqueMinimo, 10) || 0,
          estoqueIdeal: parseInt(form.estoqueIdeal, 10) || 0,
        }),
        // Aluguel/devolucao vive no produto (nao na variacao) — atualiza em
        // paralelo via a mesma rota do Catalogo.
        catalogoService.atualizar(variacao.produtoId, {
          temDevolucao: form.temDevolucao,
          diasParaDevolucaoPadrao: form.temDevolucao && form.diasParaDevolucaoPadrao !== ''
            ? parseInt(form.diasParaDevolucaoPadrao, 10) || null
            : null,
        }),
      ]);
      toast.success?.('Produto atualizado.');
      onSucesso?.();
    } catch (err) {
      toast.error?.(err?.response?.data?.error || 'Erro ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Editar produto" description={variacao.produto?.nome} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-4">
          <UploadImagem
            imagemUrl={form.imagemUrl || null}
            onUpload={handleUploadImagem}
            onRemover={handleRemoverImagem}
            tamanho="md"
          />
          <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label={rotuloAjuda('Versão / Modelo', "Deixe 'Padrão' se o produto não tem versões.")}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              required
            />
            <Input
              label="Código interno (SKU)"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder="Opcional"
            />
          </div>
        </div>

        <CampoCustoLucro form={form} setForm={setForm} />

        {/* Estoque so lida com FISICO — campos de quantidade sempre visiveis,
            sem condicional. Duracao (servicos) e cadastrada no Catalogo. */}
        <div className="grid grid-cols-3 gap-3">
          <Input
            label={rotuloAjuda('Estoque atual', 'A quantidade que está disponível na loja agora.')}
            type="number"
            min="0"
            value={form.estoqueAtual}
            onChange={(e) => setForm({ ...form, estoqueAtual: e.target.value })}
          />
          <Input
            label={rotuloAjuda('Estoque mínimo', 'Quando chegar nessa quantidade, o sistema avisa que está acabando.')}
            type="number"
            min="0"
            value={form.estoqueMinimo}
            onChange={(e) => setForm({ ...form, estoqueMinimo: e.target.value })}
          />
          <Input
            label={rotuloAjuda('Estoque ideal', 'Quando precisar repor, é essa quantidade que você compra.')}
            type="number"
            min="0"
            value={form.estoqueIdeal}
            onChange={(e) => setForm({ ...form, estoqueIdeal: e.target.value })}
          />
        </div>

        <BlocoDevolucao form={form} setForm={setForm} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">Cancelar</Button>
          <Button variant="primary" type="submit" loading={salvando}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

function CardProdutoSelecionado({ variacao, estoqueBaixo }) {
  const ehVariacaoPadrao = !variacao.nome || variacao.nome === 'Padrão' || variacao.nome === 'Padrao';
  const ehFisico = variacao.produto?.tipo === 'FISICO';
  const imagemUrl = variacao.imagemUrl || variacao.produto?.imagemUrl;

  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl border border-[var(--border-main)] bg-[var(--bg-subtle)]/30">
      {imagemUrl ? (
        <img
          src={imagemUrl}
          alt=""
          className="w-14 h-14 rounded-xl object-cover border border-[var(--border-main)] flex-shrink-0"
        />
      ) : (
        <div className="w-14 h-14 rounded-xl bg-[var(--bg-card)] border border-[var(--border-main)] flex items-center justify-center flex-shrink-0 text-[var(--text-muted)]">
          <Box size={20} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-[var(--text-main)] truncate">
          {variacao.produto?.nome}
          {!ehVariacaoPadrao && <span className="text-[var(--text-muted)] font-medium"> · {variacao.nome}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-muted)] mt-0.5">
          {variacao.produto?.categoria?.nome && (
            <span>{variacao.produto.categoria.nome}</span>
          )}
          <span>Venda: <strong className="text-[var(--text-main)]">{fmtBRL2(variacao.preco)}</strong></span>
          {variacao.precoCusto > 0 && (
            <span>Custo: {fmtBRL2(variacao.precoCusto)}</span>
          )}
        </div>
      </div>
      {ehFisico && (
        <div className={`text-right flex-shrink-0 ${estoqueBaixo ? 'text-[var(--warning)]' : 'text-[var(--text-main)]'}`}>
          <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Estoque</div>
          <div className="text-lg font-black tabular-nums leading-none mt-0.5">{variacao.estoqueAtual}</div>
          {estoqueBaixo && (
            <div className="text-[9px] uppercase tracking-wider mt-0.5">⚠ baixo</div>
          )}
        </div>
      )}
    </div>
  );
}

function ModalProduto({ isOpen, onClose, categorias, onSalvar }) {
  // O pai troca a `key` a cada abertura, entao o form nasce limpo com os
  // mesmos valores que o antigo efeito "ao abrir" aplicava.
  const [form, setForm] = useState({
    nome: '', descricao: '', categoriaId: '', tipo: 'FISICO', imagemUrl: '',
    nomeVariacao: 'Padrao', sku: '', preco: 0, precoCusto: 0, lucroTipo: 'VALOR', lucroValor: 0,
    estoqueAtual: 0, estoqueMinimo: 0, estoqueIdeal: 0, duracaoMin: '',
    temDevolucao: false, diasParaDevolucaoPadrao: '',
  });
  const [tempsParaLimpar, setTempsParaLimpar] = useState([]);

  const handleClose = () => {
    for (const url of tempsParaLimpar) catalogoService.removerImagemTemp(url);
    setTempsParaLimpar([]);
    onClose();
  };

  // Uma unica foto no cadastro (a do produto) — a variacao "Padrao" herda ela
  // automaticamente na exibicao (ver fallback em CardProdutoSelecionado e no
  // modal de edicao). So versoes diferentes do MESMO produto (cor, tamanho)
  // ganham foto propria depois, editando a variacao.
  const handleUploadProduto = async (file) => {
    const url = await catalogoService.uploadImagemTemp(file);
    setTempsParaLimpar((prev) => [...prev, url]);
    setForm((prev) => ({ ...prev, imagemUrl: url }));
  };

  const handleRemoverImagemProduto = async () => {
    if (form.imagemUrl) {
      await catalogoService.removerImagemTemp(form.imagemUrl);
      setTempsParaLimpar((prev) => prev.filter((u) => u !== form.imagemUrl));
    }
    setForm((prev) => ({ ...prev, imagemUrl: '' }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.categoriaId) {
      alert('Selecione uma categoria. Se ainda não tem nenhuma, use o link no topo do modal pra cadastrar.');
      return;
    }

    // Estoque cadastra SO produtos fisicos. Servicos sao no Catalogo.
    // Forcar tipo=FISICO no payload pra blindar mesmo que algo no estado mude.
    onSalvar({
      nome: form.nome,
      descricao: form.descricao,
      categoriaId: form.categoriaId,
      tipo: 'FISICO',
      visibilidade: 'ATIVO',
      imagemUrl: form.imagemUrl || null,
      temDevolucao: form.temDevolucao,
      diasParaDevolucaoPadrao: form.temDevolucao && form.diasParaDevolucaoPadrao !== ''
        ? parseInt(form.diasParaDevolucaoPadrao, 10) || null
        : null,
      variacoes: [{
        nome: form.nomeVariacao || 'Padrao',
        sku: form.sku || null,
        precoCusto: parseFloat(form.precoCusto) || 0,
        lucroTipo: form.lucroTipo || 'VALOR',
        lucroValor: parseFloat(form.lucroValor) || 0,
        preco: calcularPrecoVenda(form.precoCusto, form.lucroTipo, form.lucroValor),
        estoqueAtual: parseInt(form.estoqueAtual) || 0,
        estoqueMinimo: parseInt(form.estoqueMinimo) || 0,
        estoqueIdeal: parseInt(form.estoqueIdeal) || 0,
        // Sem foto propria — herda a do produto acima (fallback ja existente).
        imagemUrl: null,
      }],
    });
    setTempsParaLimpar([]);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Novo produto" description="Cadastre o produto com nome, foto, preço e quantidade — tudo em uma tela." size="2xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Banner amigavel quando nao tem categoria cadastrada — com link direto
            pra tela de cadastro. Encurta a rota (1 click vs ter que voltar). */}
        {categorias.length === 0 && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-[var(--warning-soft)] text-[var(--warning-text)]">
            <Tag size={18} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
            <div className="text-sm leading-relaxed flex-1">
              <strong>Você ainda não tem nenhuma categoria.</strong> Cadastre uma antes pra organizar seus produtos.{' '}
              <Link
                to="/app/estoque/categorias"
                onClick={handleClose}
                className="font-semibold underline hover:no-underline"
              >
                Cadastrar categoria agora →
              </Link>
            </div>
          </div>
        )}

        <div className="flex items-start gap-4">
          <div>
            <label className="block text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">
              Foto do produto
            </label>
            <UploadImagem
              imagemUrl={form.imagemUrl || null}
              onUpload={handleUploadProduto}
              onRemover={handleRemoverImagemProduto}
              tamanho="md"
            />
          </div>
          <div className="flex-1 min-w-0 space-y-4">
            <Input
              size="lg"
              label="Nome do produto"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              required
              autoFocus
            />
            <Select
              size="lg"
              label="Categoria"
              value={form.categoriaId}
              onChange={(e) => setForm({ ...form, categoriaId: e.target.value })}
              placeholder="Selecione..."
              options={categorias.map((c) => ({ value: c.id, label: c.nome }))}
              required
              disabled={categorias.length === 0}
              hint={categorias.length === 0 ? 'Cadastre uma categoria primeiro (link no banner acima).' : null}
            />
          </div>
        </div>

        <Textarea
          size="lg"
          label="Descrição (opcional)"
          value={form.descricao}
          onChange={(e) => setForm({ ...form, descricao: e.target.value })}
          rows={2}
        />

        {/* Sem seletor de Tipo: Estoque cadastra so produtos fisicos.
            Servicos sao cadastrados no Catalogo. */}

        <BlocoDevolucao form={form} setForm={setForm} />

        <div className="border-t border-[var(--border-main)] pt-5">
          <div className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-4">Preço e quantidade</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Input
              size="lg"
              label={rotuloAjuda('Tem cor/tamanho diferente?', "Ex.: 'Tamanho M', 'Cor azul'. Se o produto vem em uma versão só, deixe 'Padrão'. Dá pra dar uma foto própria pra cada versão depois, editando o produto.")}
              value={form.nomeVariacao}
              onChange={(e) => setForm({ ...form, nomeVariacao: e.target.value })}
              required
            />
            <Input
              size="lg"
              label={rotuloAjuda('Código do produto', 'Um apelido seu pra achar rápido (também chamado de SKU). Opcional.')}
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
            />
          </div>

          <CampoCustoLucro form={form} setForm={setForm} />

          {/* Estoque so cadastra produtos fisicos — campos de quantidade
              sempre visiveis. Servicos com duracao vao pro Catalogo. */}
          <div className="grid grid-cols-3 gap-4 mt-4">
            <Input
              size="lg"
              label={rotuloAjuda('Quanto tem hoje?', 'A quantidade que está disponível na loja agora.')}
              type="number"
              min="0"
              value={form.estoqueAtual}
              onChange={(e) => setForm({ ...form, estoqueAtual: e.target.value })}
            />
            <Input
              size="lg"
              label={rotuloAjuda('Avisar quando tiver', 'Quando chegar nessa quantidade, o sistema avisa que está acabando.')}
              type="number"
              min="0"
              value={form.estoqueMinimo}
              onChange={(e) => setForm({ ...form, estoqueMinimo: e.target.value })}
            />
            <Input
              size="lg"
              label={rotuloAjuda('Quanto comprar quando acabar', 'Quando precisar repor, é essa quantidade que você compra.')}
              type="number"
              min="0"
              value={form.estoqueIdeal}
              onChange={(e) => setForm({ ...form, estoqueIdeal: e.target.value })}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose} type="button">Cancelar</Button>
          <Button variant="primary" type="submit">Criar produto</Button>
        </div>
      </form>
    </Modal>
  );
}

function ModalCategoria({ isOpen, onClose, cat, onSalvar }) {
  // O pai troca a `key` a cada abertura, entao o nome nasce da categoria atual.
  const [nome, setNome] = useState(() => (cat ? cat.nome : ''));

  const handleSubmit = (e) => {
    e.preventDefault();
    onSalvar({ id: cat?.id, nome });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={cat ? 'Editar categoria' : 'Nova categoria de produto'} description="Agrupa seus produtos para organizar relatorios e CMV." size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: Bebidas, Roupas, Cabelo, Equipamentos..."
          required
          autoFocus
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">Cancelar</Button>
          <Button variant="primary" type="submit">{cat ? 'Salvar' : 'Criar'}</Button>
        </div>
      </form>
    </Modal>
  );
}
