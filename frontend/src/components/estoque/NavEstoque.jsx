import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { AbasPilula } from '../ui';

// Abas do Estoque (pílulas no topo do painel principal, como no mockup).
// Cada aba é uma rota: as abas internas da EstoquePage e as páginas
// de Fornecedores e Notas de entrada.
const ABAS_ESTOQUE = [
  { valor: 'visao-geral', rotulo: 'Visão geral' },
  { valor: 'produtos', rotulo: 'Produtos' },
  { valor: 'movimentacoes', rotulo: 'Movimentações' },
  { valor: 'reposicao', rotulo: 'Reposição' },
  { valor: 'categorias', rotulo: 'Categorias' },
  { valor: 'fornecedores', rotulo: 'Fornecedores' },
  { valor: 'notas', rotulo: 'Notas de entrada' },
];

/**
 * ativa: slug da aba atual. qtds: { reposicao: 3, ... } (contador opcional por aba).
 */
export function AbasEstoque({ ativa, qtds = {} }) {
  const navigate = useNavigate();
  return (
    <AbasPilula
      rotulo="Seções do estoque"
      abas={ABAS_ESTOQUE.map((a) => ({ ...a, qtd: qtds[a.valor] || null }))}
      valor={ativa}
      onChange={(v) => navigate(`/app/estoque/${v}`)}
    />
  );
}

/** Campo de busca compacto para a BarraFerramentas. */
export function BuscaEstoque({ value, onChange, placeholder, rotulo }) {
  return (
    <label className="relative flex-1 min-w-[180px] max-w-[280px] ml-auto">
      <span className="sr-only">{rotulo || placeholder}</span>
      <Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--primary)]"
      />
    </label>
  );
}
