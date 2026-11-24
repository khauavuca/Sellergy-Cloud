import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import clsx from 'clsx';
import api from '../../services/api';
import notaCompraService from '../../services/notaCompraService';
import { Painel, LinhaInfo, Badge, Button } from '../ui';

const fmtData = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—');
const ehPadrao = (nome) => !nome || nome === 'Padrão' || nome === 'Padrao';

/**
 * Coluna da direita das telas de Estoque: "Repor agora" + "Entrada de mercadoria".
 *
 * reposicao / notas: quando a página já carregou, passe aqui; sem eles, o
 *   componente busca sozinho (mesmos endpoints da tela de Estoque).
 * onRepor(item): abre a movimentação de compra já preenchida (opcional).
 * onXml(file): trata o XML na própria página (Notas). Sem ele, o XML solto
 *   aqui leva para a tela de Notas, que abre a entrada já lendo o arquivo.
 * carregandoXml: mostra "Lendo..." na área de soltar.
 */
export default function LateralEstoque({ reposicao, notas, onRepor, onXml, carregandoXml = false }) {
  const navigate = useNavigate();
  const [reposicaoLocal, setReposicaoLocal] = useState(null);
  const [notasLocal, setNotasLocal] = useState(null);
  const [arrastando, setArrastando] = useState(false);

  const precisaReposicao = reposicao === undefined;
  const precisaNotas = notas === undefined;

  useEffect(() => {
    if (!precisaReposicao) return undefined;
    let vivo = true;
    api.get('/estoque/reposicao')
      .then((r) => { if (vivo) setReposicaoLocal(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (vivo) setReposicaoLocal([]); });
    return () => { vivo = false; };
  }, [precisaReposicao]);

  useEffect(() => {
    if (!precisaNotas) return undefined;
    let vivo = true;
    notaCompraService.listar()
      .then((l) => { if (vivo) setNotasLocal(Array.isArray(l) ? l : []); })
      .catch(() => { if (vivo) setNotasLocal([]); });
    return () => { vivo = false; };
  }, [precisaNotas]);

  const listaRepor = precisaReposicao ? reposicaoLocal : reposicao;
  const listaNotas = precisaNotas ? notasLocal : notas;
  const ultimaNota = listaNotas?.[0];

  // Itens abaixo do mínimo primeiro (urgência ALTA), depois os abaixo do ideal.
  const ordenados = (listaRepor || []).slice().sort((a, b) => (a.urgencia === 'ALTA' ? 0 : 1) - (b.urgencia === 'ALTA' ? 0 : 1));
  const visiveis = ordenados.slice(0, 5);

  const receberXml = (file) => {
    if (!file) return;
    if (onXml) onXml(file);
    else navigate('/app/estoque/notas', { state: { xml: file } });
  };

  return (
    <>
      <Painel
        titulo="Repor agora"
        acoes={listaRepor && listaRepor.length > 0 && (
          <Badge variant="warning" size="sm">
            {listaRepor.length} {listaRepor.length === 1 ? 'item' : 'itens'}
          </Badge>
        )}
        semPadding
      >
        {listaRepor === null ? (
          <div className="px-4 py-4 space-y-2" aria-hidden="true">
            <div className="h-4 rounded bg-[var(--bg-subtle)] animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-[var(--bg-subtle)] animate-pulse" />
          </div>
        ) : visiveis.length === 0 ? (
          <p className="m-0 px-4 py-4 text-[13px] text-[var(--text-muted)]">Tudo acima do mínimo. Nada para repor.</p>
        ) : (
          visiveis.map((r) => (
            <LinhaInfo
              key={r.id}
              rotulo={
                <span className="text-[var(--text-main)] font-medium">
                  {r.produto}{!ehPadrao(r.variacao) && <span className="text-[var(--text-muted)] font-normal"> · {r.variacao}</span>}
                </span>
              }
            >
              <span className={clsx('text-xs tabular-nums', r.urgencia === 'ALTA' ? 'text-[var(--danger-text)] font-semibold' : 'text-[var(--text-muted)]')}>
                {r.estoqueAtual} de {r.estoqueMinimo || r.estoqueIdeal || 0}
              </span>
              {onRepor && (
                <button
                  type="button"
                  onClick={() => onRepor(r)}
                  aria-label={`Repor ${r.produto}`}
                  className="text-xs font-semibold text-[var(--primary)] hover:underline"
                >
                  Repor
                </button>
              )}
            </LinhaInfo>
          ))
        )}
        {listaRepor && listaRepor.length > 0 && (
          <div className="p-3 border-t border-[var(--border-subtle)]">
            <Button variant="secondary" size="sm" fullWidth onClick={() => navigate('/app/estoque/reposicao')}>
              {listaRepor.length > visiveis.length ? `Ver os ${listaRepor.length} itens da reposição` : 'Ver fila de reposição'}
            </Button>
          </div>
        )}
      </Painel>

      <Painel titulo="Entrada de mercadoria" semPadding>
        <div className="p-3">
          <label
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastando(false);
              receberXml(e.dataTransfer.files?.[0]);
            }}
            className={clsx(
              'block rounded-[10px] border border-dashed px-4 py-5 text-center cursor-pointer transition-colors focus-within:border-[var(--primary)]',
              arrastando ? 'border-[var(--primary)] bg-[var(--success-soft)]' : 'border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]',
              carregandoXml && 'opacity-60 pointer-events-none'
            )}
          >
            <FileUp size={18} aria-hidden="true" className="mx-auto mb-1.5 text-[var(--text-muted)]" />
            <strong className="block text-[13px] text-[var(--text-main)] mb-1">
              {carregandoXml ? 'Lendo o XML...' : 'Solte o XML da nota aqui'}
            </strong>
            <span className="block text-xs text-[var(--text-muted)]">
              ou clique para escolher. Os itens são ligados aos seus produtos com custo e fornecedor; você confere antes de salvar.
            </span>
            <input
              type="file"
              accept=".xml,text/xml,application/xml"
              className="sr-only"
              disabled={carregandoXml}
              onChange={(e) => { receberXml(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
        </div>
        {ultimaNota ? (
          <LinhaInfo
            className="border-t border-[var(--border-subtle)]"
            rotulo={`Última: ${ultimaNota.fornecedor?.nome || 'Sem fornecedor'}`}
          >
            <span className="text-xs text-[var(--text-muted)] tabular-nums">
              {fmtData(ultimaNota.emitidaEm || ultimaNota.criadoEm)} · {ultimaNota._count?.movimentacoes ?? 0}{' '}
              {(ultimaNota._count?.movimentacoes ?? 0) === 1 ? 'item' : 'itens'}
            </span>
          </LinhaInfo>
        ) : listaNotas && (
          <p className="m-0 px-4 py-3 border-t border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">Nenhuma nota lançada ainda.</p>
        )}
      </Painel>
    </>
  );
}
