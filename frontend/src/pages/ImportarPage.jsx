// /app/importar — importar planilha de clientes, produtos ou servicos.
// Frente C da fase 2. Prototipo: sellergy-prototipo/project/Importar.dc.html.
//
// Passos: Arquivo -> Colunas -> Revisao -> Pronto. A planilha e lida aqui no
// navegador (utils/lerPlanilha) e vai pro servidor ja mapeada; quem valida,
// acha duplicado e grava e o servidor (rotas /importacao).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  Upload, FileSpreadsheet, Download, CheckCircle2, AlertTriangle, Undo2, Loader2, ArrowLeft, ArrowRight, RefreshCw,
} from 'lucide-react';
import api from '../services/api';
import { Button, Badge, useToast } from '../components/ui';
import ConfirmarAcao from '../components/conta/ConfirmarAcao';
import { lerPlanilha, baixarModelo, LIMITE_LINHAS } from '../utils/lerPlanilha';

const TIPOS = [
  { id: 'CLIENTES', rotulo: 'Clientes', nome: 'clientes', um: 'cliente', rota: '/app/crm', verTexto: 'Ver clientes' },
  { id: 'PRODUTOS', rotulo: 'Produtos', nome: 'produtos', um: 'produto', rota: '/app/catalogo', verTexto: 'Ver produtos' },
  { id: 'SERVICOS', rotulo: 'Serviços', nome: 'serviços', um: 'serviço', rota: '/app/catalogo', verTexto: 'Ver serviços' },
];

const MODELOS = {
  CLIENTES: [['Nome', 'Celular', 'E-mail', 'CPF', 'Nascimento', 'Observações'], ['Paula Rocha', '(11) 99812-4410', 'paula@email.com', '', '22/04/1990', 'pele sensível']],
  PRODUTOS: [['Nome', 'Preço', 'Custo', 'Estoque', 'Código de barras', 'Categoria'], ['Sérum vitamina C', '89,90', '40,00', '12', '7891234567890', 'Dermocosméticos']],
  SERVICOS: [['Serviço', 'Preço', 'Duração (min)', 'Categoria'], ['Limpeza de pele', '150,00', '60', 'Facial']],
};

const PASSOS = ['Arquivo', 'Colunas', 'Revisão', 'Pronto'];
const CORPO = { headers: { 'Content-Type': 'application/vnd.sellergy.importacao+json' } };
const POR_PAGINA = 30;

const erroDe = (e, padrao) => e?.response?.data?.erro || padrao;
const fmtData = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Passos({ atual }) {
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Passos da importação">
      {PASSOS.map((t, i) => {
        const n = i + 1;
        const feito = n < atual;
        const on = n === atual;
        return (
          <li
            key={t}
            aria-current={on ? 'step' : undefined}
            className={clsx(
              'flex items-center gap-2 text-sm font-semibold rounded-full pl-1.5 pr-3 py-1.5 border',
              on ? 'bg-[var(--bg-card)] border-[var(--border-main)] text-[var(--text-main)]'
                : feito ? 'border-transparent text-[var(--success-text)]' : 'border-transparent text-[var(--text-muted)]',
            )}
          >
            <span className={clsx(
              'w-6 h-6 rounded-full grid place-items-center text-xs',
              on ? 'bg-[var(--primary)] text-[var(--text-on-primary)]' : feito ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'bg-[var(--bg-subtle)]',
            )}
            >
              {feito ? '✓' : n}
            </span>
            {t}
          </li>
        );
      })}
    </ol>
  );
}

function Kpi({ rotulo, valor, tom }) {
  return (
    <div className="rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4">
      <p className="text-xs text-[var(--text-muted)]">{rotulo}</p>
      <p className={clsx('mt-1.5 text-2xl font-bold tabular-nums', tom)}>{valor.toLocaleString('pt-BR')}</p>
    </div>
  );
}

export default function ImportarPage() {
  const toast = useToast();
  const [params] = useSearchParams();
  const tipoInicial = TIPOS.find((t) => t.nome === params.get('tipo') || t.id === String(params.get('tipo') || '').toUpperCase())?.id || 'CLIENTES';

  const [passo, setPasso] = useState(1);
  const [tipo, setTipo] = useState(tipoInicial);
  const [arquivoNome, setArquivoNome] = useState('');
  const [planilha, setPlanilha] = useState(null); // { cabecalhos, linhas }
  const [lendo, setLendo] = useState(false);
  const [erroArquivo, setErroArquivo] = useState(null);
  const [arrastando, setArrastando] = useState(false);
  const [mapa, setMapa] = useState({});
  const [campos, setCampos] = useState([]);
  const [mapeando, setMapeando] = useState(false);
  const [linhas, setLinhas] = useState([]); // linhas mapeadas (o que vai pro servidor)
  const [analise, setAnalise] = useState(null);
  const [analisando, setAnalisando] = useState(false);
  const [erroAnalise, setErroAnalise] = useState(null);
  const [edicoes, setEdicoes] = useState({}); // { indice: { campo: valor } } enquanto digita
  const [pagina, setPagina] = useState(1);
  const [verJuntar, setVerJuntar] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [historico, setHistorico] = useState(null);
  const [erroHistorico, setErroHistorico] = useState(null);
  const [desfazer, setDesfazer] = useState(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  const infoTipo = TIPOS.find((t) => t.id === tipo);

  const carregarHistorico = useCallback(async () => {
    try {
      const r = await api.get('/importacao');
      setHistorico(r.data);
      setErroHistorico(null);
    } catch (e) {
      setErroHistorico(erroDe(e, 'Não foi possível carregar as importações.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao montar
    carregarHistorico();
  }, [carregarHistorico]);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // ------------------------------------------------------------ passo 1
  const escolherArquivo = async (arquivo) => {
    if (!arquivo) return;
    setErroArquivo(null);
    setLendo(true);
    try {
      const p = await lerPlanilha(arquivo);
      setPlanilha(p);
      setArquivoNome(arquivo.name);
      setMapeando(true);
      const r = await api.post('/importacao/mapear', { tipo, cabecalhos: p.cabecalhos });
      setMapa(r.data.mapeamento);
      setCampos(r.data.campos);
      setPasso(2);
    } catch (e) {
      setErroArquivo(e?.response ? erroDe(e, 'Não foi possível ler a planilha.') : (e?.message || 'Não foi possível ler a planilha.'));
    } finally {
      setLendo(false);
      setMapeando(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const trocarTipo = (novo) => {
    setTipo(novo);
    setPlanilha(null);
    setArquivoNome('');
    setErroArquivo(null);
  };

  // ------------------------------------------------------------ passo 2
  const exemplo = (coluna) => {
    const idx = planilha?.cabecalhos.indexOf(coluna) ?? -1;
    const linha = planilha?.linhas.find((l) => String(l.valores[idx] ?? '').trim());
    return linha ? String(linha.valores[idx]).slice(0, 40) : '';
  };
  const reconhecidas = planilha ? planilha.cabecalhos.filter((c) => mapa[c]).length : 0;
  const faltaObrigatorio = campos.filter((c) => c.obrigatorio && !Object.values(mapa).includes(c.campo));

  const escolherDestino = (coluna, campo) => {
    setMapa((m) => {
      const novo = { ...m };
      // Cada campo recebe uma coluna so: tira de quem tinha.
      if (campo) for (const k of Object.keys(novo)) if (novo[k] === campo) novo[k] = null;
      novo[coluna] = campo || null;
      return novo;
    });
  };

  const analisar = useCallback(async (lista) => {
    setAnalisando(true);
    setErroAnalise(null);
    try {
      const r = await api.post('/importacao/analisar', { tipo, linhas: lista }, CORPO);
      setAnalise(r.data);
    } catch (e) {
      setErroAnalise(erroDe(e, 'Não foi possível conferir a planilha. Tente de novo.'));
    } finally {
      setAnalisando(false);
    }
  }, [tipo]);

  const irParaRevisao = async () => {
    const idx = Object.fromEntries(planilha.cabecalhos.map((c, i) => [c, i]));
    const mapeadas = planilha.linhas.map((l) => {
      const obj = { _linha: l._linha };
      for (const [coluna, campo] of Object.entries(mapa)) {
        if (!campo) continue;
        const v = l.valores[idx[coluna]];
        obj[campo] = typeof v === 'number' ? v : String(v ?? '');
      }
      return obj;
    });
    setLinhas(mapeadas);
    setEdicoes({});
    setPagina(1);
    setAnalise(null);
    setPasso(3);
    await analisar(mapeadas);
  };

  // ------------------------------------------------------------ passo 3
  const reanalisarDepois = (lista) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => analisar(lista), 350);
  };

  const aplicar = (indice, mudanca) => {
    const lista = linhas.map((l, i) => (i === indice ? { ...l, ...mudanca } : l));
    setLinhas(lista);
    setEdicoes((e) => { const n = { ...e }; delete n[indice]; return n; });
    reanalisarDepois(lista);
  };

  const problemas = useMemo(() => (analise?.linhas || []).filter((l) => l.status === 'PROBLEMA'), [analise]);
  const juntar = useMemo(() => (analise?.linhas || []).filter((l) => l.status === 'JUNTAR' || l.status === 'DUPLICADA'), [analise]);
  const prontos = analise?.resumo?.novos || 0;
  const qtdJuntar = (analise?.resumo?.juntar || 0) + (analise?.resumo?.duplicadas || 0);

  const pularTodosProblemas = () => {
    const alvo = new Set(problemas.map((p) => p.indice));
    const lista = linhas.map((l, i) => (alvo.has(i) ? { ...l, pular: true } : l));
    setLinhas(lista);
    analisar(lista);
  };

  const importar = async () => {
    setImportando(true);
    try {
      const r = await api.post('/importacao', { tipo, arquivoNome, linhas }, CORPO);
      setResultado(r.data);
      setPasso(4);
      if (r.data.falha) toast.error(r.data.falha.mensagem);
      carregarHistorico();
    } catch (e) {
      toast.error(erroDe(e, 'Não foi possível importar.'));
    } finally {
      setImportando(false);
    }
  };

  const confirmarDesfazer = async () => {
    try {
      const r = await api.post(`/importacao/${desfazer.id}/desfazer`);
      const { apagados, mantidos } = r.data;
      toast.success(mantidos
        ? `${apagados} apagados. ${mantidos} ficaram porque já têm venda, agendamento ou pedido.`
        : `Importação desfeita: ${apagados} apagados.`);
      if (resultado?.importacao?.id === desfazer.id) setResultado((x) => ({ ...x, importacao: { ...x.importacao, status: 'DESFEITA' } }));
      carregarHistorico();
      return true;
    } catch (e) {
      toast.error(erroDe(e, 'Não foi possível desfazer.'));
      return false;
    }
  };

  const recomecar = () => {
    setPasso(1);
    setPlanilha(null);
    setArquivoNome('');
    setAnalise(null);
    setResultado(null);
    setLinhas([]);
  };

  const rotuloCampo = (c) => campos.find((x) => x.campo === c)?.rotulo || c;

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <Link to={infoTipo.rota} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]">{infoTipo.rotulo}</Link>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-main)] mt-1">Importar planilha</h1>
      </div>

      <Passos atual={passo} />

      {passo === 1 && (
        <section className="space-y-4">
          <div role="group" aria-label="O que você vai importar" className="flex flex-wrap gap-2">
            {TIPOS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tipo === t.id}
                onClick={() => trocarTipo(t.id)}
                className={clsx(
                  'min-h-11 px-4 rounded-full border text-sm font-medium',
                  tipo === t.id ? 'bg-[var(--primary)] border-[var(--primary)] text-[var(--text-on-primary)]' : 'bg-[var(--bg-card)] border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]',
                )}
              >
                {t.rotulo}
              </button>
            ))}
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastando(false); escolherArquivo(e.dataTransfer.files?.[0]); }}
            className={clsx(
              'rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center transition-colors',
              arrastando ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-strong)] bg-[var(--bg-card)]',
            )}
          >
            {lendo || mapeando ? (
              <div className="py-6"><Loader2 className="mx-auto animate-spin text-[var(--text-muted)]" aria-hidden /><p className="mt-3 text-sm text-[var(--text-secondary)]">Lendo a planilha…</p></div>
            ) : (
              <>
                <FileSpreadsheet className="mx-auto text-[var(--text-muted)]" size={36} strokeWidth={1.5} aria-hidden />
                <p className="mt-3 text-base font-semibold text-[var(--text-main)]">Arraste a planilha de {infoTipo.nome} aqui</p>
                <p className="mt-1 text-sm text-[var(--text-muted)] max-w-lg mx-auto">
                  Excel, CSV ou Google Planilhas (baixe como .xlsx ou .csv). Pode vir do sistema antigo, do caderno passado a limpo ou dos contatos do celular. Até {LIMITE_LINHAS.toLocaleString('pt-BR')} linhas por vez.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <input ref={inputRef} id="arquivo-planilha" type="file" accept=".xlsx,.xls,.ods,.csv,.txt" className="sr-only" onChange={(e) => escolherArquivo(e.target.files?.[0])} />
                  <Button size="lg" icon={Upload} onClick={() => inputRef.current?.click()}>Escolher arquivo</Button>
                  <Button
                    size="lg"
                    variant="secondary"
                    icon={Download}
                    onClick={() => baixarModelo(`modelo-${infoTipo.nome}.csv`, MODELOS[tipo][0], MODELOS[tipo][1])}
                  >
                    Baixar modelo
                  </Button>
                </div>
              </>
            )}
            {erroArquivo && (
              <p role="alert" className="mt-4 inline-flex items-start gap-2 text-sm text-[var(--danger-text)] bg-[var(--danger-soft)] rounded-lg px-3 py-2">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden />{erroArquivo}
              </p>
            )}
          </div>

          <p className="text-sm text-[var(--text-muted)]">
            Vem de outro sistema? Exporte os {infoTipo.nome} lá e jogue aqui: a gente reconhece as colunas mais comuns.
          </p>

          <section className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)]">
            <h2 className="px-4 sm:px-5 py-3 text-sm font-semibold text-[var(--text-main)] border-b border-[var(--border-main)]">Importações anteriores</h2>
            {erroHistorico ? (
              <div className="p-4 flex items-center gap-3 text-sm text-[var(--danger-text)]">
                {erroHistorico}
                <Button size="sm" variant="secondary" icon={RefreshCw} onClick={carregarHistorico}>Tentar de novo</Button>
              </div>
            ) : historico === null ? (
              <div className="p-4"><Loader2 className="animate-spin text-[var(--text-muted)]" size={18} aria-label="Carregando" /></div>
            ) : historico.length === 0 ? (
              <p className="p-4 text-sm text-[var(--text-muted)]">Nenhuma planilha importada ainda.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-main)]">
                {historico.map((h) => (
                  <li key={h.id} className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3 text-sm">
                    <div className="flex-1 min-w-[12rem]">
                      <p className="font-medium text-[var(--text-main)] truncate">{h.arquivoNome}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {TIPOS.find((t) => t.id === h.tipo)?.rotulo} · {fmtData(h.criadoEm)} · {h.criados} novos · {h.juntados} juntados · {h.ignorados} de fora
                      </p>
                    </div>
                    {h.status === 'DESFEITA'
                      ? <Badge variant="neutral" size="sm">Desfeita</Badge>
                      : <Button size="sm" variant="ghost" icon={Undo2} className="min-h-11" onClick={() => setDesfazer(h)} disabled={!h.criados}>Desfazer</Button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      )}

      {passo === 2 && planilha && (
        <section className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)]">
          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center gap-3 border-b border-[var(--border-main)]">
            <FileSpreadsheet size={18} className="text-[var(--text-muted)]" aria-hidden />
            <p className="flex-1 text-sm font-semibold text-[var(--text-main)] min-w-0 truncate">
              {arquivoNome} · {planilha.linhas.length.toLocaleString('pt-BR')} linhas
            </p>
            <Badge variant={reconhecidas ? 'success' : 'warning'} size="md">
              Reconhecemos {reconhecidas} de {planilha.cabecalhos.length} colunas
            </Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--text-muted)]">
                  <th className="px-4 sm:px-5 py-2.5 font-semibold">Coluna da planilha</th>
                  <th className="px-4 py-2.5 font-semibold hidden sm:table-cell">Exemplo</th>
                  <th className="px-4 sm:px-5 py-2.5 font-semibold">Vai para</th>
                </tr>
              </thead>
              <tbody>
                {planilha.cabecalhos.map((c, i) => (
                  <tr key={c} className="border-t border-[var(--border-main)]">
                    <td className="px-4 sm:px-5 py-2.5 font-medium text-[var(--text-main)]">
                      {c}
                      <span className="block sm:hidden text-xs text-[var(--text-muted)] font-normal truncate max-w-[10rem]">{exemplo(c)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] hidden sm:table-cell max-w-[16rem] truncate">{exemplo(c)}</td>
                    <td className="px-4 sm:px-5 py-2">
                      <select
                        id={`destino-${i}`}
                        aria-label={`Para onde vai a coluna ${c}`}
                        value={mapa[c] || ''}
                        onChange={(e) => escolherDestino(c, e.target.value)}
                        className="w-full min-h-11 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-main)]"
                      >
                        <option value="">Não importar</option>
                        {campos.map((f) => <option key={f.campo} value={f.campo}>{f.rotulo}{f.obrigatorio ? ' *' : ''}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {faltaObrigatorio.length > 0 && (
            <p role="alert" className="mx-4 sm:mx-5 mb-2 mt-3 text-sm text-[var(--warning-text)] bg-[var(--warning-soft)] rounded-lg px-3 py-2">
              Falta escolher a coluna de: {faltaObrigatorio.map((f) => f.rotulo).join(', ')}.
            </p>
          )}
          <div className="px-4 sm:px-5 py-4 flex flex-wrap justify-between gap-2 border-t border-[var(--border-main)]">
            <Button size="lg" variant="ghost" icon={ArrowLeft} onClick={() => setPasso(1)}>Voltar</Button>
            <Button size="lg" icon={ArrowRight} iconPosition="right" disabled={faltaObrigatorio.length > 0} onClick={irParaRevisao}>Continuar</Button>
          </div>
        </section>
      )}

      {passo === 3 && (
        <section className="space-y-4">
          {erroAnalise && (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-[var(--danger-text)] bg-[var(--danger-soft)] rounded-xl px-4 py-3">
              {erroAnalise}
              <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => analisar(linhas)}>Tentar de novo</Button>
            </div>
          )}
          {!analise ? (
            <div className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-8 text-center">
              {analisando && <><Loader2 className="mx-auto animate-spin text-[var(--text-muted)]" aria-hidden /><p className="mt-3 text-sm text-[var(--text-secondary)]">Conferindo cada linha…</p></>}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-live="polite">
                <Kpi rotulo="Prontos pra entrar" valor={prontos} tom="text-[var(--success-text)]" />
                <Kpi rotulo="Já existem (vamos juntar)" valor={qtdJuntar} />
                <Kpi rotulo="Precisam de atenção" valor={problemas.length} tom={problemas.length ? 'text-[var(--warning-text)]' : ''} />
              </div>

              {problemas.length > 0 && (
                <div className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)]">
                  <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-2 border-b border-[var(--border-main)]">
                    <h2 className="flex-1 text-sm font-semibold text-[var(--text-main)]">Precisam de atenção</h2>
                    {analisando && <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" aria-label="Conferindo" />}
                    <Button size="sm" variant="ghost" className="min-h-11" onClick={pularTodosProblemas}>Pular todas</Button>
                  </div>
                  <ul className="divide-y divide-[var(--border-main)]">
                    {problemas.slice(0, pagina * POR_PAGINA).map((r) => {
                      const original = linhas[r.indice] || {};
                      return (
                        <li key={r.indice} className="px-4 sm:px-5 py-3 space-y-2">
                          <p className="text-sm">
                            <span className="text-[var(--text-muted)]">linha {r.numero}</span>{' '}
                            <strong className="text-[var(--text-main)]">{original.nome || '(sem nome)'}</strong>
                          </p>
                          {r.problemas.map((p) => {
                            const chave = `${r.indice}-${p.campo}`;
                            const editando = edicoes[r.indice]?.[p.campo];
                            return (
                              <div key={chave} className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-[var(--warning-text)] flex-1 min-w-[12rem]">{p.mensagem}</span>
                                {p.sugestao && (
                                  <Button size="sm" variant="secondary" className="min-h-11" onClick={() => aplicar(r.indice, { [p.campo]: p.sugestao.valor })}>
                                    {p.sugestao.texto}
                                  </Button>
                                )}
                                {editando === undefined ? (
                                  <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setEdicoes((e) => ({ ...e, [r.indice]: { ...e[r.indice], [p.campo]: String(original[p.campo] ?? '') } }))}>
                                    Corrigir
                                  </Button>
                                ) : (
                                  <form
                                    className="flex gap-2 w-full sm:w-auto"
                                    onSubmit={(e) => { e.preventDefault(); aplicar(r.indice, { [p.campo]: editando }); }}
                                  >
                                    <label htmlFor={`corrigir-${chave}`} className="sr-only">{rotuloCampo(p.campo)} da linha {r.numero}</label>
                                    <input
                                      id={`corrigir-${chave}`}
                                      autoFocus
                                      value={editando}
                                      onChange={(e) => setEdicoes((x) => ({ ...x, [r.indice]: { ...x[r.indice], [p.campo]: e.target.value } }))}
                                      className="flex-1 sm:w-56 min-h-11 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] px-3 text-sm"
                                    />
                                    <Button type="submit" size="sm" className="min-h-11">Salvar</Button>
                                  </form>
                                )}
                              </div>
                            );
                          })}
                          <Button size="sm" variant="ghost" className="min-h-11" onClick={() => aplicar(r.indice, { pular: true })}>Pular esta linha</Button>
                        </li>
                      );
                    })}
                  </ul>
                  {problemas.length > pagina * POR_PAGINA && (
                    <div className="p-3 border-t border-[var(--border-main)] text-center">
                      <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setPagina((p) => p + 1)}>
                        Mostrar mais ({problemas.length - pagina * POR_PAGINA})
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {qtdJuntar > 0 && (
                <div className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)]">
                  <button
                    type="button"
                    aria-expanded={verJuntar}
                    onClick={() => setVerJuntar((v) => !v)}
                    className="w-full min-h-11 px-4 sm:px-5 py-3 text-left text-sm font-semibold text-[var(--text-main)]"
                  >
                    {verJuntar ? 'Esconder' : 'Ver'} os {qtdJuntar} que vamos juntar
                  </button>
                  {verJuntar && (
                    <ul className="divide-y divide-[var(--border-main)] border-t border-[var(--border-main)]">
                      {juntar.slice(0, 100).map((r) => (
                        <li key={r.indice} className="px-4 sm:px-5 py-2.5 text-sm text-[var(--text-secondary)]">
                          <span className="text-[var(--text-muted)]">linha {r.numero}</span> {r.dados.nome}
                          {' → '}
                          {r.status === 'JUNTAR'
                            ? <>junta com a ficha de <strong className="text-[var(--text-main)]">{r.existente?.nome}</strong> (só completa o que está vazio)</>
                            : <>repete a linha {analise.linhas[r.duplicadaDe]?.numero}: junta as duas</>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {problemas.length > 0 && (
                <p className="text-sm text-[var(--text-muted)]">As linhas que ainda precisam de atenção ficam de fora se você importar agora.</p>
              )}

              <div className="flex flex-wrap justify-between gap-2">
                <Button size="lg" variant="ghost" icon={ArrowLeft} onClick={() => setPasso(2)}>Voltar</Button>
                <Button size="lg" loading={importando} disabled={analisando || (!prontos && !qtdJuntar)} onClick={importar}>
                  Importar {prontos.toLocaleString('pt-BR')} {prontos === 1 ? infoTipo.um : infoTipo.nome}{qtdJuntar ? ` e juntar ${qtdJuntar}` : ''}
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {passo === 4 && resultado && (
        <section className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-6 sm:p-8 text-center">
          <div className="mx-auto w-16 h-16 rounded-full grid place-items-center bg-[var(--success-soft)] text-[var(--success-text)]">
            <CheckCircle2 size={32} aria-hidden />
          </div>
          <h2 className="mt-4 text-xl font-semibold text-[var(--text-main)]">
            {resultado.importacao.status === 'DESFEITA'
              ? 'Importação desfeita'
              : `${resultado.importacao.criados.toLocaleString('pt-BR')} ${resultado.importacao.criados === 1 ? `${infoTipo.um} importado` : `${infoTipo.nome} importados`}`}
          </h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {resultado.importacao.juntados
              ? `${resultado.importacao.juntados} ${resultado.importacao.juntados === 1 ? 'juntado' : 'juntados'} com fichas que já existiam ou repetidas na planilha.`
              : ''}
            {resultado.importacao.ignorados
              ? ` ${resultado.importacao.ignorados} ${resultado.importacao.ignorados === 1 ? 'ficou' : 'ficaram'} de fora.`
              : ''}
            {tipo === 'SERVICOS' ? ' Os serviços novos ficam com todas as profissionais ativas; ajuste no catálogo se precisar.' : ''}
          </p>
          {resultado.falha && (
            <p role="alert" className="mt-3 text-sm text-[var(--warning-text)] bg-[var(--warning-soft)] rounded-lg px-3 py-2 inline-block">{resultado.falha.mensagem}</p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link to={infoTipo.rota} className="inline-flex items-center justify-center min-h-12 px-6 rounded-lg font-semibold bg-[var(--primary)] text-[var(--text-on-primary)] hover:bg-[var(--primary-hover)]">
              {infoTipo.verTexto}
            </Link>
            <Button size="lg" variant="secondary" onClick={recomecar}>Importar outra planilha</Button>
            {resultado.importacao.status !== 'DESFEITA' && resultado.importacao.criados > 0 && (
              <Button size="lg" variant="ghost" icon={Undo2} onClick={() => setDesfazer(resultado.importacao)}>Desfazer importação</Button>
            )}
          </div>
        </section>
      )}

      <ConfirmarAcao
        isOpen={Boolean(desfazer)}
        onClose={() => setDesfazer(null)}
        titulo="Desfazer importação?"
        rotuloConfirmar="Desfazer"
        onConfirmar={confirmarDesfazer}
      >
        <p className="text-sm text-[var(--text-secondary)]">
          Apagamos os {desfazer?.criados} cadastros que esta planilha criou. Quem já tem venda, agendamento ou pedido fica.
          As fichas que foram juntadas continuam como estão.
        </p>
      </ConfirmarAcao>
    </div>
  );
}
