// /app/importar — importar planilha de clientes, produtos ou serviços.
// Frente C da fase 2. Layout: layout/project/Importar.dc.html.
//
// Passos: Arquivo -> Colunas -> Revisão -> Pronto. A planilha é lida aqui no
// navegador (utils/lerPlanilha) e vai pro servidor já mapeada; quem valida,
// acha duplicado e grava é o servidor (rotas /importacao).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  Upload, FileSpreadsheet, Download, CheckCircle2, AlertTriangle, Undo2, Loader2, ArrowLeft, ArrowRight, RefreshCw, Check,
} from 'lucide-react';
import api from '../services/api';
import {
  Button, Badge, useToast, Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, BarraFerramentas, AbasPilula,
} from '../components/ui';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
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

// Dicas da coluna lateral, por tipo (só o que o servidor de fato faz).
const DICAS = {
  CLIENTES: [
    'Celular com DDD, ex.: (11) 99812-4410.',
    'Mesmo celular em duas linhas vira uma ficha só.',
    'Datas no formato 22/04/1990.',
  ],
  PRODUTOS: [
    'Preço e custo com vírgula, ex.: 89,90.',
    'Produto com o mesmo nome ou SKU junta com o que já existe.',
  ],
  SERVICOS: [
    'Preço com vírgula, ex.: 150,00.',
    'Duração em minutos, ex.: 60.',
    'Serviço novo fica com todas as profissionais ativas.',
  ],
};

const PASSOS = ['Arquivo', 'Colunas', 'Revisão', 'Pronto'];
const CORPO = { headers: { 'Content-Type': 'application/vnd.sellergy.importacao+json' } };
const POR_PAGINA = 30;
const TH = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const TD = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';
const LINHA = 'flex flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0 text-[13px] text-[var(--text-secondary)]';
const CAMPO = 'h-8 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] px-2 text-[13px] text-[var(--text-main)]';

const erroDe = (e, padrao) => e?.response?.data?.erro || padrao;
const fmtData = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

function Passos({ atual, subtitulos, onIr }) {
  return (
    <nav aria-label="Passos da importação" className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)]">
      <ol className="flex flex-wrap">
        {PASSOS.map((t, i) => {
          const n = i + 1;
          const feito = n < atual;
          const on = n === atual;
          // Volta pra um passo já feito; depois de importar não tem volta.
          const podeIr = feito && atual < 4;
          return (
            <li key={t} className="flex-[1_1_150px] min-w-0">
              <button
                type="button"
                aria-current={on ? 'step' : undefined}
                disabled={!podeIr}
                onClick={() => onIr(n)}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-4 py-3 rounded-[10px] text-left text-[13px] font-semibold disabled:cursor-default',
                  on ? 'text-[var(--text-main)]' : feito ? 'text-[var(--success-text)]' : 'text-[var(--text-muted)]',
                  podeIr && 'hover:bg-[var(--bg-subtle)]',
                )}
              >
                <span
                  className={clsx(
                    'w-[26px] h-[26px] rounded-full grid place-items-center text-xs font-bold flex-shrink-0',
                    on ? 'bg-[var(--text-main)] text-[var(--bg-card)]'
                      : feito ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]',
                  )}
                >
                  {feito ? <Check size={14} aria-hidden="true" /> : n}
                </span>
                <span className="min-w-0">
                  <span className="block">{t}</span>
                  <span className="block truncate text-xs font-medium text-[var(--text-muted)]">{subtitulos[i]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
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

  const baixarModeloAtual = useCallback(
    () => baixarModelo(`modelo-${infoTipo.nome}.csv`, MODELOS[tipo][0], MODELOS[tipo][1]),
    [infoTipo.nome, tipo],
  );
  useAcaoTopo(
    <Button size="sm" variant="secondary" icon={Download} onClick={baixarModeloAtual}>Baixar modelo</Button>,
    [baixarModeloAtual],
  );

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
      const msg = e?.response ? erroDe(e, 'Não foi possível ler a planilha.') : (e?.message || 'Não foi possível ler a planilha.');
      setErroArquivo(msg);
      // Trocando o arquivo fora do passo 1, o aviso não teria onde aparecer.
      if (passo !== 1) toast.error(msg);
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
  const preenchidas = useMemo(() => {
    if (!planilha) return [];
    return planilha.cabecalhos.map((_, i) => planilha.linhas.filter((l) => String(l.valores[i] ?? '').trim()).length);
  }, [planilha]);
  const reconhecidas = planilha ? planilha.cabecalhos.filter((c) => mapa[c]).length : 0;
  const faltaObrigatorio = campos.filter((c) => c.obrigatorio && !Object.values(mapa).includes(c.campo));

  const escolherDestino = (coluna, campo) => {
    setMapa((m) => {
      const novo = { ...m };
      // Cada campo recebe uma coluna só: tira de quem tinha.
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
  const qtdPuladas = analise?.resumo?.pular || 0;

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

  // Volta por clique nos passos (só pra passos já feitos, antes de importar).
  const irPara = (n) => {
    if (n === 1) setPasso(1);
    else if (n === 2 && planilha) setPasso(2);
  };

  const subtitulos = [
    arquivoNome || 'escolha a planilha',
    'confira o destino',
    'resolva os problemas',
    `${infoTipo.nome} no sistema`,
  ];

  const ocupado = lendo || mapeando;

  // ------------------------------------------------------------ lateral
  const lateral = (
    <>
      <Painel titulo="Dicas">
        <ul className="-m-4">
          {DICAS[tipo].map((d) => (
            <li key={d} className={LINHA}>
              <Check size={16} className="flex-shrink-0 text-[var(--success-text)]" aria-hidden="true" />
              <span className="flex-1 min-w-0">{d}</span>
            </li>
          ))}
          <li className={LINHA}>
            <Check size={16} className="flex-shrink-0 text-[var(--success-text)]" aria-hidden="true" />
            <span className="flex-1 min-w-0">Até {fmt(LIMITE_LINHAS)} linhas por vez.</span>
          </li>
          <li className={LINHA}>
            <Check size={16} className="flex-shrink-0 text-[var(--success-text)]" aria-hidden="true" />
            <span className="flex-1 min-w-0">Vem de outro sistema? Exporte os {infoTipo.nome} lá e jogue aqui: a gente reconhece as colunas mais comuns.</span>
          </li>
        </ul>
      </Painel>

      <Painel titulo="Importações anteriores" semPadding>
        {erroHistorico ? (
          <div className="p-4 flex flex-wrap items-center gap-3 text-[13px] text-[var(--danger-text)]">
            <span className="flex-1 min-w-0">{erroHistorico}</span>
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={carregarHistorico}>Tentar de novo</Button>
          </div>
        ) : historico === null ? (
          <div className="p-4"><Loader2 className="animate-spin text-[var(--text-muted)]" size={18} aria-label="Carregando" /></div>
        ) : historico.length === 0 ? (
          <p className="p-4 text-[13px] text-[var(--text-muted)]">Nenhuma planilha importada ainda.</p>
        ) : (
          <ul>
            {historico.map((h) => (
              <li key={h.id} className={LINHA}>
                <div className="flex-1 min-w-[10rem]">
                  <p className="font-semibold text-[var(--text-main)] truncate">{h.arquivoNome}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {TIPOS.find((t) => t.id === h.tipo)?.rotulo} · {fmtData(h.criadoEm)} · {h.criados} novos · {h.juntados} juntados · {h.ignorados} de fora
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {h.status === 'DESFEITA' ? (
                    <Badge variant="neutral" size="sm">Desfeita</Badge>
                  ) : (
                    <>
                      <Badge variant="success" size="sm">Feita</Badge>
                      <Button size="sm" variant="secondary" icon={Undo2} onClick={() => setDesfazer(h)} disabled={!h.criados}>Desfazer</Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Painel>
    </>
  );

  return (
    <Pagina>
      <input
        ref={inputRef}
        id="arquivo-planilha"
        type="file"
        accept=".xlsx,.xls,.ods,.csv,.txt"
        className="sr-only"
        tabIndex={-1}
        aria-label={`Planilha de ${infoTipo.nome}`}
        onChange={(e) => escolherArquivo(e.target.files?.[0])}
      />

      <Passos atual={passo} subtitulos={subtitulos} onIr={irPara} />

      <ColunasPagina lateral={lateral}>
        {/* ---------------------------------------------- passo 1: arquivo */}
        {passo === 1 && (
          <Painel titulo="Escolha a planilha" subtitulo="Excel, CSV ou Google Planilhas (baixe como .xlsx ou .csv)" semPadding>
            <BarraFerramentas>
              <span className="text-xs font-medium text-[var(--text-muted)]">O que você vai importar</span>
              <AbasPilula
                rotulo="O que você vai importar"
                abas={TIPOS.map((t) => ({ valor: t.id, rotulo: t.rotulo }))}
                valor={tipo}
                onChange={trocarTipo}
              />
            </BarraFerramentas>
            <div className="p-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
                onDragLeave={() => setArrastando(false)}
                onDrop={(e) => { e.preventDefault(); setArrastando(false); escolherArquivo(e.dataTransfer.files?.[0]); }}
                className={clsx(
                  'rounded-[10px] border-2 border-dashed px-4 py-8 text-center transition-colors',
                  arrastando ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-strong)]',
                )}
              >
                {ocupado ? (
                  <div className="py-4">
                    <Loader2 className="mx-auto animate-spin text-[var(--text-muted)]" aria-hidden="true" />
                    <p className="mt-3 text-[13px] text-[var(--text-secondary)]">Lendo a planilha…</p>
                  </div>
                ) : (
                  <>
                    <FileSpreadsheet className="mx-auto text-[var(--text-muted)]" size={32} strokeWidth={1.5} aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold text-[var(--text-main)]">Arraste a planilha de {infoTipo.nome} aqui</p>
                    <p className="mt-1 text-[13px] text-[var(--text-muted)] max-w-lg mx-auto">
                      Pode vir do sistema antigo, do caderno passado a limpo ou dos contatos do celular.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <Button icon={Upload} onClick={() => inputRef.current?.click()}>Escolher arquivo</Button>
                      <Button variant="secondary" icon={Download} onClick={baixarModeloAtual}>Baixar modelo</Button>
                    </div>
                  </>
                )}
                {erroArquivo && (
                  <p role="alert" className="mt-4 inline-flex items-start gap-2 text-[13px] text-[var(--danger-text)] bg-[var(--danger-soft)] rounded-lg px-3 py-2">
                    <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />{erroArquivo}
                  </p>
                )}
              </div>
            </div>
          </Painel>
        )}

        {/* ------------------------------------- arquivo enviado (2 e 3) */}
        {(passo === 2 || passo === 3) && planilha && (
          <section aria-label="Arquivo enviado" className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] px-4 py-3.5 flex flex-wrap items-center gap-3">
            <span className="w-10 h-10 rounded-[10px] grid place-items-center bg-[var(--success-soft)] text-[var(--success-text)] flex-shrink-0">
              <FileSpreadsheet size={18} aria-hidden="true" />
            </span>
            <div className="flex-1 min-w-[12rem]">
              <p className="text-sm font-bold text-[var(--text-main)] truncate">{arquivoNome}</p>
              <p className="text-xs font-medium text-[var(--text-muted)]">
                {fmt(planilha.linhas.length)} linhas · {planilha.cabecalhos.length} colunas
              </p>
            </div>
            <Badge variant="info" size="md">{infoTipo.rotulo}</Badge>
            <Button size="sm" variant="secondary" icon={ocupado ? undefined : Upload} loading={ocupado} onClick={() => inputRef.current?.click()}>
              Trocar arquivo
            </Button>
          </section>
        )}

        {/* ---------------------------------------------- passo 2: colunas */}
        {passo === 2 && planilha && (
          <>
            <FaixaNumeros>
              <Numero rotulo="Linhas na planilha" valor={fmt(planilha.linhas.length)} detalhe={`até ${fmt(LIMITE_LINHAS)} por vez`} />
              <Numero
                rotulo="Colunas reconhecidas"
                valor={`${reconhecidas} de ${planilha.cabecalhos.length}`}
                detalhe="as outras ficam de fora"
                tom={reconhecidas ? 'sucesso' : 'alerta'}
              />
              <Numero
                rotulo="Falta escolher"
                valor={faltaObrigatorio.length}
                detalhe={faltaObrigatorio.length ? 'campo obrigatório sem coluna' : 'tudo certo pra seguir'}
                tom={faltaObrigatorio.length ? 'alerta' : 'sucesso'}
              />
            </FaixaNumeros>

            <Painel
              id="colunas"
              titulo="Colunas da planilha"
              acoes={(
                <Badge variant={reconhecidas ? 'success' : 'warning'} size="md">
                  Reconhecemos {reconhecidas} de {planilha.cabecalhos.length}
                </Badge>
              )}
              semPadding
            >
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      <th className={TH}>Coluna da planilha</th>
                      <th className={TH}>Exemplo</th>
                      <th className={TH}>Vai para</th>
                      <th className={TH}>Preenchidas</th>
                      <th className={TH}><span className="sr-only">Situação</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {planilha.cabecalhos.map((c, i) => (
                      <tr key={c}>
                        <td className={clsx(TD, 'font-semibold text-[var(--text-main)] whitespace-nowrap')}>{c}</td>
                        <td className={clsx(TD, 'text-[var(--text-secondary)] max-w-[14rem] truncate')}>{exemplo(c) || '—'}</td>
                        <td className={clsx(TD, 'py-2')}>
                          <label htmlFor={`destino-${i}`} className="sr-only">Para onde vai a coluna {c}</label>
                          <select
                            id={`destino-${i}`}
                            value={mapa[c] || ''}
                            onChange={(e) => escolherDestino(c, e.target.value)}
                            className={clsx(CAMPO, 'w-full min-w-[10rem]')}
                          >
                            <option value="">Não importar</option>
                            {campos.map((f) => <option key={f.campo} value={f.campo}>{f.rotulo}{f.obrigatorio ? ' *' : ''}</option>)}
                          </select>
                        </td>
                        <td className={clsx(TD, 'tabular-nums whitespace-nowrap text-[var(--text-secondary)]')}>
                          {fmt(preenchidas[i])} de {fmt(planilha.linhas.length)}
                        </td>
                        <td className={TD}>
                          {mapa[c]
                            ? <Badge variant="success" size="sm">Certo</Badge>
                            : <Badge variant="neutral" size="sm">Fica de fora</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {faltaObrigatorio.length > 0 && (
                <p role="alert" className="flex items-start gap-2 px-4 py-2.5 text-[13px] text-[var(--warning-text)] bg-[var(--warning-soft)] rounded-b-[10px]">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  Falta escolher a coluna de: {faltaObrigatorio.map((f) => f.rotulo).join(', ')}.
                </p>
              )}
            </Painel>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" icon={ArrowLeft} onClick={() => setPasso(1)}>Voltar</Button>
              <span className="flex-1 min-w-[12rem] text-xs text-[var(--text-muted)]">
                Dá pra desfazer a importação inteira depois, em Importações anteriores.
              </span>
              <Button icon={ArrowRight} iconPosition="right" disabled={faltaObrigatorio.length > 0} onClick={irParaRevisao}>
                Continuar para revisão
              </Button>
            </div>
          </>
        )}

        {/* ---------------------------------------------- passo 3: revisão */}
        {passo === 3 && (
          <>
            {erroAnalise && (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-[var(--danger-text)] bg-[var(--danger-soft)] rounded-[10px] px-4 py-3">
                <span className="flex-1 min-w-0">{erroAnalise}</span>
                <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => analisar(linhas)}>Tentar de novo</Button>
              </div>
            )}

            <div aria-live="polite">
              <FaixaNumeros>
                <Numero
                  rotulo={`Novos ${infoTipo.nome}`}
                  valor={fmt(prontos)}
                  detalhe="entram como cadastros novos"
                  tom="sucesso"
                  carregando={!analise}
                />
                <Numero
                  rotulo="Vamos juntar"
                  valor={fmt(qtdJuntar)}
                  detalhe="já existem ou repetem na planilha"
                  carregando={!analise}
                />
                <Numero
                  rotulo="Com problema"
                  valor={fmt(problemas.length)}
                  detalhe={problemas.length ? 'resolva ou pule antes de importar' : qtdPuladas ? `${fmt(qtdPuladas)} puladas` : 'nenhum'}
                  tom={problemas.length ? 'alerta' : 'neutro'}
                  carregando={!analise}
                />
              </FaixaNumeros>
            </div>

            {!analise ? (
              analisando && (
                <Painel>
                  <div className="py-6 text-center">
                    <Loader2 className="mx-auto animate-spin text-[var(--text-muted)]" aria-hidden="true" />
                    <p className="mt-3 text-[13px] text-[var(--text-secondary)]">Conferindo cada linha…</p>
                  </div>
                </Painel>
              )
            ) : (
              <>
                <Painel
                  id="problemas"
                  titulo="Precisam de atenção"
                  acoes={(
                    <>
                      {analisando && <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" aria-label="Conferindo" />}
                      <Badge variant={problemas.length ? 'warning' : 'success'} size="md">
                        {problemas.length ? `${fmt(problemas.length)} em aberto` : 'Tudo resolvido'}
                      </Badge>
                      {problemas.length > 0 && (
                        <Button size="sm" variant="secondary" onClick={pularTodosProblemas}>Pular todas</Button>
                      )}
                    </>
                  )}
                  semPadding
                >
                  {problemas.length === 0 ? (
                    <p className="px-4 py-3 text-[13px] text-[var(--text-muted)]">Nenhuma linha com problema. Pode importar.</p>
                  ) : (
                    <ul>
                      {problemas.slice(0, pagina * POR_PAGINA).map((r) => {
                        const original = linhas[r.indice] || {};
                        return (
                          <li key={r.indice} className={clsx(LINHA, 'items-start')}>
                            <Badge variant="neutral" size="sm" className="mt-0.5">linha {r.numero}</Badge>
                            <div className="flex-1 min-w-[14rem] space-y-1.5">
                              <strong className="block text-[var(--text-main)]">{original.nome || '(sem nome)'}</strong>
                              {r.problemas.map((p) => {
                                const chave = `${r.indice}-${p.campo}`;
                                const editando = edicoes[r.indice]?.[p.campo];
                                return (
                                  <div key={chave} className="flex flex-wrap items-center gap-2">
                                    <span className="flex-1 min-w-[10rem] text-xs text-[var(--warning-text)] [overflow-wrap:anywhere]">{p.mensagem}</span>
                                    {p.sugestao && (
                                      <Button size="sm" variant="secondary" onClick={() => aplicar(r.indice, { [p.campo]: p.sugestao.valor })}>
                                        {p.sugestao.texto}
                                      </Button>
                                    )}
                                    {editando === undefined ? (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setEdicoes((e) => ({ ...e, [r.indice]: { ...e[r.indice], [p.campo]: String(original[p.campo] ?? '') } }))}
                                      >
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
                                          className={clsx(CAMPO, 'flex-1 sm:w-56')}
                                        />
                                        <Button type="submit" size="sm">Salvar</Button>
                                      </form>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <Button size="sm" variant="secondary" onClick={() => aplicar(r.indice, { pular: true })}>Pular</Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {problemas.length > pagina * POR_PAGINA && (
                    <div className="p-2.5 border-t border-[var(--border-subtle)] text-center">
                      <Button size="sm" variant="ghost" onClick={() => setPagina((p) => p + 1)}>
                        Mostrar mais ({fmt(problemas.length - pagina * POR_PAGINA)})
                      </Button>
                    </div>
                  )}
                </Painel>

                {qtdJuntar > 0 && (
                  <section className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)]">
                    <button
                      type="button"
                      aria-expanded={verJuntar}
                      onClick={() => setVerJuntar((v) => !v)}
                      className="w-full px-4 py-3 text-left text-sm font-bold text-[var(--text-main)] rounded-[10px] hover:bg-[var(--bg-subtle)]"
                    >
                      {verJuntar ? 'Esconder' : 'Ver'} os {fmt(qtdJuntar)} que vamos juntar
                    </button>
                    {verJuntar && (
                      <ul className="border-t border-[var(--border-subtle)]">
                        {juntar.slice(0, 100).map((r) => (
                          <li key={r.indice} className={LINHA}>
                            <Badge variant="neutral" size="sm">linha {r.numero}</Badge>
                            <span className="flex-1 min-w-0">
                              {r.dados.nome}
                              {' → '}
                              {r.status === 'JUNTAR'
                                ? <>junta com a ficha de <strong className="text-[var(--text-main)]">{r.existente?.nome}</strong> (só completa o que está vazio)</>
                                : <>repete a linha {analise.linhas[r.duplicadaDe]?.numero}: junta as duas</>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="secondary" icon={ArrowLeft} onClick={() => setPasso(2)}>Voltar</Button>
                  <span className="flex-1 min-w-[12rem] text-xs text-[var(--text-muted)]">
                    {problemas.length > 0
                      ? 'As linhas que ainda precisam de atenção ficam de fora se você importar agora.'
                      : 'Dá pra desfazer a importação inteira depois, em Importações anteriores.'}
                  </span>
                  <Button loading={importando} disabled={analisando || (!prontos && !qtdJuntar)} onClick={importar}>
                    Importar {fmt(prontos)} {prontos === 1 ? infoTipo.um : infoTipo.nome}{qtdJuntar ? ` e juntar ${fmt(qtdJuntar)}` : ''}
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {/* ---------------------------------------------- passo 4: pronto */}
        {passo === 4 && resultado && (
          <>
            <FaixaNumeros>
              <Numero rotulo="Importados" valor={fmt(resultado.importacao.criados)} detalhe={`${infoTipo.nome} novos`} tom="sucesso" />
              <Numero rotulo="Juntados" valor={fmt(resultado.importacao.juntados)} detalhe="já existiam ou repetiam na planilha" />
              <Numero rotulo="Ficaram de fora" valor={fmt(resultado.importacao.ignorados)} detalhe="puladas ou com problema" />
            </FaixaNumeros>

            <Painel>
              <div className="py-4 text-center">
                <div className="mx-auto w-12 h-12 rounded-full grid place-items-center bg-[var(--success-soft)] text-[var(--success-text)]">
                  <CheckCircle2 size={24} aria-hidden="true" />
                </div>
                <h2 className="mt-3 text-lg font-bold text-[var(--text-main)]">
                  {resultado.importacao.status === 'DESFEITA'
                    ? 'Importação desfeita'
                    : `${fmt(resultado.importacao.criados)} ${resultado.importacao.criados === 1 ? `${infoTipo.um} importado` : `${infoTipo.nome} importados`}`}
                </h2>
                <p className="mt-1.5 text-[13px] text-[var(--text-secondary)] max-w-xl mx-auto">
                  {resultado.importacao.juntados
                    ? `${resultado.importacao.juntados} ${resultado.importacao.juntados === 1 ? 'juntado' : 'juntados'} com fichas que já existiam ou repetidas na planilha.`
                    : ''}
                  {resultado.importacao.ignorados
                    ? ` ${resultado.importacao.ignorados} ${resultado.importacao.ignorados === 1 ? 'ficou' : 'ficaram'} de fora.`
                    : ''}
                  {tipo === 'SERVICOS' ? ' Os serviços novos ficam com todas as profissionais ativas; ajuste no catálogo se precisar.' : ''}
                </p>
                {resultado.falha && (
                  <p role="alert" className="mt-3 text-[13px] text-[var(--warning-text)] bg-[var(--warning-soft)] rounded-lg px-3 py-2 inline-block">{resultado.falha.mensagem}</p>
                )}
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <Link
                    to={infoTipo.rota}
                    className="inline-flex items-center justify-center h-10 px-4 rounded-lg text-sm font-semibold bg-[var(--primary)] text-[var(--text-on-primary)] hover:bg-[var(--primary-hover)]"
                  >
                    {infoTipo.verTexto}
                  </Link>
                  <Button variant="secondary" onClick={recomecar}>Importar outra planilha</Button>
                  {resultado.importacao.status !== 'DESFEITA' && resultado.importacao.criados > 0 && (
                    <Button variant="ghost" icon={Undo2} onClick={() => setDesfazer(resultado.importacao)}>Desfazer importação</Button>
                  )}
                </div>
              </div>
            </Painel>
          </>
        )}
      </ColunasPagina>

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
    </Pagina>
  );
}
