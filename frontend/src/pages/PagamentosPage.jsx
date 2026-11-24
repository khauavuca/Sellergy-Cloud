import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Plus, RefreshCw, QrCode, Link as LinkIcon, Lock, Copy, ExternalLink } from 'lucide-react';
import {
  Button, Badge, EmptyState, Input, Select, Drawer, useToast, BotaoExportar,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, BarraFerramentas, AbasPilula,
} from '../components/ui';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import { copiarTexto } from '../components/pedidos/util';
import pagamentosService from '../services/pagamentosService';
import credenciaisService from '../services/credenciaisService';

// Provedores suportados + o tipo de credencial que cada um exige (espelha
// backend/src/adapters/pagamento/index.js).
const PROVEDORES = [
  { id: 'MERCADO_PAGO', nome: 'Mercado Pago', tipoCredencial: 'MERCADO_PAGO_KEY' },
  { id: 'ASAAS', nome: 'Asaas', tipoCredencial: 'ASAAS_KEY' },
  { id: 'PAGARME', nome: 'Pagar.me', tipoCredencial: 'PAGARME_KEY' },
];
const TIPO_POR_PROVEDOR = Object.fromEntries(PROVEDORES.map((p) => [p.id, p.tipoCredencial]));
const NOME_PROVEDOR = Object.fromEntries(PROVEDORES.map((p) => [p.id, p.nome]));

// Situação: rótulo, cor do Badge e grupo da aba (espelha o mockup).
const STATUS = {
  PENDENTE: { rotulo: 'Aguardando', variant: 'warning', grupo: 'pend' },
  PAGO: { rotulo: 'Pago', variant: 'success', grupo: 'pago' },
  EXPIRADO: { rotulo: 'Vencida', variant: 'danger', grupo: 'venc' },
  CANCELADO: { rotulo: 'Cancelada', variant: 'neutral', grupo: 'venc' },
  ESTORNADO: { rotulo: 'Estornada', variant: 'neutral', grupo: 'venc' },
};

const OBS_STATUS = {
  PENDENTE: 'Quando o provedor confirmar o pagamento, a situação muda aqui. Use "Atualizar situação" para consultar agora.',
  PAGO: 'Pagamento confirmado pelo provedor.',
  EXPIRADO: 'Venceu sem pagamento. Para cobrar de novo, gere uma nova cobrança com o mesmo valor.',
  CANCELADO: 'Cobrança cancelada não pode ser paga. Gere uma nova se precisar.',
  ESTORNADO: 'Valor devolvido ao cliente. Nada mais a fazer aqui.',
};

const ORIGENS = {
  AGENDAMENTO: 'Sinal de agendamento',
  PEDIDO: 'Pedido',
  VENDA: 'Venda',
  PACOTE: 'Pacote',
  AVULSA: 'Avulsa',
};

const METODOS = { PIX: 'Pix', LINK: 'Link', CARTAO: 'Cartão', RECORRENCIA: 'Recorrência' };

// Limite que a API devolve por listagem (backend: take 100).
const LIMITE_API = 100;

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const mesmoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "hoje 14:32", "ontem 18:20" ou "22/11 09:30". */
function fmtQuando(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (mesmoDia(d, hoje)) return `hoje ${hhmm(d)}`;
  if (mesmoDia(d, ontem)) return `ontem ${hhmm(d)}`;
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${dia} ${hhmm(d)}`;
}

const noMesAtual = (valor, agora) => {
  if (!valor) return false;
  const d = new Date(valor);
  return d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth();
};

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export default function PagamentosPage() {
  const toast = useToast();
  const [credenciais, setCredenciais] = useState([]);
  const [cobrancas, setCobrancas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({ provedor: '', credencialId: '', ativo: true });
  const [drawerAberto, setDrawerAberto] = useState(false);
  const [configAtiva, setConfigAtiva] = useState(false);
  const [provedorSalvo, setProvedorSalvo] = useState('');
  const [aba, setAba] = useState('todas');
  const [origem, setOrigem] = useState('');
  const [selId, setSelId] = useState(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      const [cfg, creds, cobs] = await Promise.all([
        pagamentosService.obterConfig().catch(() => null),
        credenciaisService.listar().catch(() => []),
        pagamentosService.listarCobrancas().catch(() => []),
      ]);
      setCredenciais(creds);
      setCobrancas(cobs);
      setConfigAtiva(!!(cfg?.provedor && cfg?.ativo));
      setProvedorSalvo(cfg?.provedor || '');
      setForm({
        provedor: cfg?.provedor || '',
        credencialId: cfg?.credencialId || '',
        ativo: cfg?.ativo ?? true,
      });
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    carregar();
  }, []);

  useAcaoTopo(
    <Button
      size="sm"
      icon={Plus}
      onClick={() => setDrawerAberto(true)}
      disabled={!configAtiva}
      title={!configAtiva ? 'Salve a configuração (provedor + ativo) antes de cobrar' : undefined}
    >
      Nova cobrança
    </Button>,
    [configAtiva]
  );

  // Credenciais compatíveis com o provedor escolhido (pelo tipo).
  const credenciaisDoProvedor = form.provedor
    ? credenciais.filter((c) => c.tipo === TIPO_POR_PROVEDOR[form.provedor])
    : [];

  const salvarConfig = async () => {
    if (!form.provedor) return toast.error('Escolha um provedor.');
    setSalvando(true);
    try {
      const salvo = await pagamentosService.salvarConfig(form);
      setConfigAtiva(!!(salvo?.provedor && salvo?.ativo));
      setProvedorSalvo(salvo?.provedor || form.provedor);
      toast.success('Configuração de pagamento salva.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao salvar configuração.');
    } finally {
      setSalvando(false);
    }
  };

  const sincronizar = async (id) => {
    try {
      const atualizada = await pagamentosService.sincronizar(id);
      setCobrancas((lista) => lista.map((c) => (c.id === id ? { ...c, ...atualizada } : c)));
      toast.success('Situação atualizada.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao sincronizar.');
    }
  };

  const aoCriarCobranca = (nova) => {
    setCobrancas((lista) => [nova, ...lista]);
    setAba('todas');
    setOrigem('');
    setSelId(nova.id);
    setDrawerAberto(false);
  };

  // --- Números do topo (calculados das cobranças carregadas) ---
  const numeros = useMemo(() => {
    const agora = new Date();
    const semanaAtras = agora.getTime() - 7 * 24 * 60 * 60 * 1000;
    const soma = (lista) => lista.reduce((s, c) => s + Number(c.valor || 0), 0);

    const pagasMes = cobrancas.filter((c) => c.status === 'PAGO' && noMesAtual(c.pagoEm || c.atualizadoEm, agora));
    const pendentes = cobrancas.filter((c) => c.status === 'PENDENTE');
    const vencidas = cobrancas.filter((c) => c.status === 'EXPIRADO');
    const vencidasSemana = vencidas.filter((c) => {
      const t = new Date(c.vencimento || c.atualizadoEm).getTime();
      return Number.isFinite(t) && t >= semanaAtras;
    });
    const estornadasMes = cobrancas.filter((c) => c.status === 'ESTORNADO' && noMesAtual(c.atualizadoEm, agora));
    const pagasComHora = cobrancas.filter((c) => c.status === 'PAGO' && c.pagoEm && c.criadoEm);
    const rapidas = pagasComHora.filter((c) => new Date(c.pagoEm) - new Date(c.criadoEm) <= 10 * 60 * 1000);

    return {
      mes: agora.toLocaleDateString('pt-BR', { month: 'long' }),
      recebido: soma(pagasMes), qtdPagasMes: pagasMes.length,
      aguardando: soma(pendentes), qtdPendentes: pendentes.length,
      vencido: soma(vencidas), qtdVencidasSemana: vencidasSemana.length,
      estornado: soma(estornadasMes), qtdEstornadas: estornadasMes.length,
      pctRapido: pagasComHora.length ? Math.round((rapidas.length / pagasComHora.length) * 100) : null,
      qtdPagasComHora: pagasComHora.length,
    };
  }, [cobrancas]);

  // --- Filtros da tabela ---
  const daOrigem = useMemo(
    () => (origem ? cobrancas.filter((c) => c.origem === origem) : cobrancas),
    [cobrancas, origem]
  );
  const contagem = useMemo(() => {
    const qtd = { todas: daOrigem.length, pend: 0, pago: 0, venc: 0 };
    daOrigem.forEach((c) => {
      const g = STATUS[c.status]?.grupo;
      if (g) qtd[g] += 1;
    });
    return qtd;
  }, [daOrigem]);
  const visiveis = useMemo(
    () => (aba === 'todas' ? daOrigem : daOrigem.filter((c) => STATUS[c.status]?.grupo === aba)),
    [daOrigem, aba]
  );

  const selecionada = visiveis.find((c) => c.id === selId) || visiveis[0] || null;

  const abas = [
    { valor: 'todas', rotulo: 'Todas', qtd: contagem.todas },
    { valor: 'pend', rotulo: 'Aguardando', qtd: contagem.pend },
    { valor: 'pago', rotulo: 'Pagas', qtd: contagem.pago },
    { valor: 'venc', rotulo: 'Vencidas e estornadas', qtd: contagem.venc },
  ];

  const montarDados = () => ({
    nome: 'cobrancas',
    titulo: 'Cobranças',
    periodo: '',
    filtrosAtivos: [
      aba !== 'todas' && `Situação: ${abas.find((a) => a.valor === aba)?.rotulo}`,
      origem && `Origem: ${ORIGENS[origem]}`,
    ].filter(Boolean),
    secoes: [{
      titulo: 'Cobranças',
      colunas: [
        { chave: 'criada', label: 'Criada' },
        { chave: 'origem', label: 'Origem' },
        { chave: 'metodo', label: 'Método' },
        { chave: 'valor', label: 'Valor' },
        { chave: 'situacao', label: 'Situação' },
        { chave: 'vence', label: 'Vence' },
        { chave: 'pago', label: 'Pago em' },
      ],
      linhas: visiveis.map((c) => ({
        criada: fmtQuando(c.criadoEm),
        origem: `${ORIGENS[c.origem] || c.origem}${c.refId ? ` (${c.refId})` : ''}`,
        metodo: METODOS[c.metodo] || c.metodo,
        valor: Number(c.valor || 0),
        situacao: STATUS[c.status]?.rotulo || c.status,
        vence: c.vencimento ? fmtQuando(c.vencimento) : '',
        pago: c.pagoEm ? fmtQuando(c.pagoEm) : '',
      })),
    }],
  });

  const nomeProvedor = provedorSalvo ? NOME_PROVEDOR[provedorSalvo] || provedorSalvo : null;

  return (
    <Pagina>
      <FaixaNumeros>
        <Numero
          rotulo={`Recebido em ${numeros.mes}`}
          valor={fmtBRL(numeros.recebido)}
          detalhe={plural(numeros.qtdPagasMes, 'cobrança paga', 'cobranças pagas')}
          tomDetalhe={numeros.qtdPagasMes ? 'sucesso' : 'neutro'}
          carregando={carregando}
        />
        <Numero
          rotulo="Aguardando pagamento"
          valor={fmtBRL(numeros.aguardando)}
          tom={numeros.qtdPendentes ? 'alerta' : 'neutro'}
          detalhe={plural(numeros.qtdPendentes, 'cobrança em aberto', 'cobranças em aberto')}
          carregando={carregando}
          onClick={() => setAba('pend')}
        />
        <Numero
          rotulo="Vencidas sem pagar"
          valor={fmtBRL(numeros.vencido)}
          tom={numeros.vencido ? 'perigo' : 'neutro'}
          detalhe={`${plural(numeros.qtdVencidasSemana, 'expirou', 'expiraram')} esta semana`}
          tomDetalhe={numeros.qtdVencidasSemana ? 'perigo' : 'neutro'}
          carregando={carregando}
          onClick={() => setAba('venc')}
        />
        <Numero
          rotulo="Pago em até 10 min"
          valor={numeros.pctRapido == null ? '—' : `${numeros.pctRapido}%`}
          detalhe={numeros.qtdPagasComHora
            ? `de ${plural(numeros.qtdPagasComHora, 'cobrança paga', 'cobranças pagas')}`
            : 'Nenhuma cobrança paga ainda'}
          carregando={carregando}
        />
        <Numero
          rotulo="Estornado no mês"
          valor={fmtBRL(numeros.estornado)}
          detalhe={plural(numeros.qtdEstornadas, 'cobrança', 'cobranças')}
          carregando={carregando}
        />
      </FaixaNumeros>

      <ColunasPagina
        lateral={
          <>
            <DetalheCobranca cobranca={selecionada} carregando={carregando} onSincronizar={sincronizar} />
            <LinhaDoTempo cobranca={selecionada} />
            <ProvedorConfig
              form={form}
              setForm={setForm}
              credenciaisDoProvedor={credenciaisDoProvedor}
              salvando={salvando}
              configAtiva={configAtiva}
              onSalvar={salvarConfig}
            />
          </>
        }
      >
        <Painel semPadding>
          <BarraFerramentas>
            <AbasPilula abas={abas} valor={aba} onChange={setAba} rotulo="Situação da cobrança" />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label htmlFor="filtro-origem" className="text-xs font-medium text-[var(--text-muted)]">Origem</label>
              <div className="w-48">
                <Select
                  id="filtro-origem"
                  size="sm"
                  value={origem}
                  onChange={(e) => setOrigem(e.target.value)}
                  placeholder="Todas"
                  options={Object.entries(ORIGENS).map(([value, label]) => ({ value, label }))}
                />
              </div>
              <BotaoExportar montarDados={montarDados} desabilitado={!visiveis.length} />
            </div>
          </BarraFerramentas>

          {carregando ? (
            <div className="text-[13px] text-[var(--text-muted)] py-10 text-center">Carregando cobranças...</div>
          ) : cobrancas.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="Nenhuma cobrança ainda"
              description={configAtiva
                ? 'Gere a primeira cobrança Pix ou link de pagamento para o seu cliente.'
                : 'Configure o provedor de pagamento ao lado para gerar a primeira cobrança.'}
            />
          ) : visiveis.length === 0 ? (
            <div className="text-[13px] text-[var(--text-muted)] py-10 text-center">Nenhuma cobrança com esse filtro.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    {['Criada', 'Origem', 'Método', 'Valor', 'Situação', 'Vence'].map((t) => (
                      <th
                        key={t}
                        className={`${t === 'Valor' ? 'text-right' : 'text-left'} text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap`}
                      >
                        {t}
                      </th>
                    ))}
                    <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">
                      Detalhe
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((c) => {
                    const ativa = selecionada?.id === c.id;
                    const st = STATUS[c.status];
                    const td = `px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap ${ativa ? 'bg-[var(--primary-soft)]' : ''}`;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelId(c.id)}
                        className="cursor-pointer hover:bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
                      >
                        <td className={td}>{fmtQuando(c.criadoEm)}</td>
                        <td className={td}>
                          <span className="text-[var(--text-main)] font-medium">{ORIGENS[c.origem] || c.origem}</span>
                          {c.refId && <span className="text-xs text-[var(--text-muted)] ml-1.5">#{String(c.refId).slice(0, 8)}</span>}
                        </td>
                        <td className={td}>{METODOS[c.metodo] || c.metodo}</td>
                        <td className={`${td} text-right font-semibold text-[var(--text-main)] tabular-nums`}>{fmtBRL(c.valor)}</td>
                        <td className={td}>
                          <Badge variant={st?.variant || 'neutral'} size="sm">{st?.rotulo || c.status}</Badge>
                        </td>
                        <td className={td}>{c.vencimento ? fmtQuando(c.vencimento) : '—'}</td>
                        <td className={`${td} text-right`}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelId(c.id); }}
                            aria-label={`Ver cobrança de ${fmtBRL(c.valor)} criada ${fmtQuando(c.criadoEm)}`}
                            aria-pressed={ativa}
                            className="font-semibold text-[var(--primary)] underline hover:no-underline"
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!carregando && cobrancas.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-[var(--text-muted)]">
              <span>
                {visiveis.length} de {plural(cobrancas.length, 'cobrança', 'cobranças')}
                {cobrancas.length >= LIMITE_API ? ' (as mais recentes)' : ''}
              </span>
              <span>
                {nomeProvedor
                  ? `Provedor: ${nomeProvedor}${configAtiva ? '' : ' (inativo)'}`
                  : 'Provedor não configurado'}
              </span>
            </div>
          )}
        </Painel>
      </ColunasPagina>

      <NovaCobrancaDrawer
        aberto={drawerAberto}
        onClose={() => setDrawerAberto(false)}
        onCriada={aoCriarCobranca}
      />
    </Pagina>
  );
}

// --- Coluna direita: detalhe da cobrança selecionada ---
function DetalheCobranca({ cobranca: c, carregando, onSincronizar }) {
  const toast = useToast();
  const [sincronizando, setSincronizando] = useState(false);

  if (carregando) {
    return (
      <Painel titulo="Detalhe da cobrança">
        <div className="h-20 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />
      </Painel>
    );
  }
  if (!c) {
    return (
      <Painel titulo="Detalhe da cobrança">
        <p className="m-0 text-[13px] text-[var(--text-muted)]">Escolha uma cobrança na tabela para ver o Pix, o link e a situação.</p>
      </Painel>
    );
  }

  const st = STATUS[c.status];
  const Icone = c.metodo === 'PIX' ? QrCode : LinkIcon;
  const travada = c.status === 'PAGO' || c.status === 'ESTORNADO';

  const copiar = async (texto, oque) => {
    if (await copiarTexto(texto)) toast.success(`${oque} copiado.`);
    else toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
  };

  const atualizar = async () => {
    setSincronizando(true);
    try {
      await onSincronizar(c.id);
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <Painel
      titulo={fmtBRL(c.valor)}
      subtitulo={`${METODOS[c.metodo] || c.metodo} · ${ORIGENS[c.origem] || c.origem}${c.refId ? ` · ref. ${String(c.refId).slice(0, 8)}` : ''}`}
      acoes={<Badge variant={st?.variant || 'neutral'} size="sm">{st?.rotulo || c.status}</Badge>}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-[10px] bg-[var(--primary-soft)] text-[var(--primary)] flex items-center justify-center flex-shrink-0" aria-hidden="true">
          <Icone size={18} />
        </div>
        <div className="min-w-0 text-xs text-[var(--text-muted)] space-y-0.5">
          <div>Criada {fmtQuando(c.criadoEm)}{c.vencimento ? ` · vence ${fmtQuando(c.vencimento)}` : ''}</div>
          {c.pagoEm && <div className="text-[var(--success-text)] font-semibold">Pago {fmtQuando(c.pagoEm)}</div>}
          <div>Provedor: {NOME_PROVEDOR[c.provedor] || c.provedor}</div>
        </div>
      </div>

      {c.qrCode && (
        <div className="mt-4">
          <label htmlFor="pix-copia-cola" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Pix copia e cola</label>
          <div className="flex gap-2">
            <input
              id="pix-copia-cola"
              readOnly
              value={c.qrCode}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] text-xs font-mono text-[var(--text-main)]"
            />
            <Button variant="secondary" size="sm" icon={Copy} className="h-9" onClick={() => copiar(c.qrCode, 'Pix copia e cola')}>
              Copiar
            </Button>
          </div>
        </div>
      )}

      {c.linkUrl && (
        <div className="mt-3">
          <label htmlFor="link-pagamento" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Link de pagamento</label>
          <div className="flex gap-2">
            <input
              id="link-pagamento"
              readOnly
              value={c.linkUrl}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] text-xs text-[var(--text-main)]"
            />
            <Button variant="secondary" size="sm" icon={Copy} className="h-9" onClick={() => copiar(c.linkUrl, 'Link')}>
              Copiar
            </Button>
            <a
              href={c.linkUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Abrir link de pagamento em nova aba"
              className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] flex-shrink-0"
            >
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      )}

      {!c.qrCode && !c.linkUrl && (
        <p className="m-0 mt-4 text-xs text-[var(--text-muted)]">O provedor não devolveu Pix nem link para esta cobrança.</p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={atualizar} loading={sincronizando} disabled={travada} className="h-9">
          Atualizar situação
        </Button>
        <p className="m-0 text-xs text-[var(--text-muted)]">{OBS_STATUS[c.status]}</p>
      </div>
    </Painel>
  );
}

// --- Coluna direita: linha do tempo (só com as datas que a cobrança tem) ---
function LinhaDoTempo({ cobranca: c }) {
  if (!c) return null;
  const eventos = [{ texto: 'Cobrança criada', quando: c.criadoEm, cor: 'var(--text-muted)' }];
  if (c.pagoEm) eventos.push({ texto: 'Pago e confirmado pelo provedor', quando: c.pagoEm, cor: 'var(--success-text)' });
  if (c.status === 'PENDENTE' && c.vencimento) eventos.push({ texto: 'Vence', quando: c.vencimento, cor: 'var(--warning-text)' });
  if (c.status === 'EXPIRADO') eventos.push({ texto: 'Venceu sem pagamento', quando: c.vencimento || c.atualizadoEm, cor: 'var(--danger-text)' });
  if (c.status === 'CANCELADO') eventos.push({ texto: 'Cancelada', quando: c.atualizadoEm, cor: 'var(--text-secondary)' });
  if (c.status === 'ESTORNADO') eventos.push({ texto: 'Estornada', quando: c.atualizadoEm, cor: 'var(--danger-text)' });

  return (
    <Painel titulo="Linha do tempo" semPadding>
      <ol className="m-0 p-0 list-none">
        {eventos.map((e) => (
          <li key={e.texto}>
            <LinhaInfo
              rotulo={
                <span className="inline-flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.cor }} aria-hidden="true" />
                  <span className="text-[var(--text-main)]">{e.texto}</span>
                </span>
              }
            >
              <span className="text-xs text-[var(--text-muted)]">{fmtQuando(e.quando)}</span>
            </LinhaInfo>
          </li>
        ))}
      </ol>
    </Painel>
  );
}

// --- Coluna direita: configuração do provedor (PSP) ---
function ProvedorConfig({ form, setForm, credenciaisDoProvedor, salvando, configAtiva, onSalvar }) {
  return (
    <Painel
      titulo="Provedor de pagamento"
      subtitulo={configAtiva ? 'Ativo: cobranças liberadas' : 'Inativo: salve provedor e ative para cobrar'}
      acoes={<Link to="/app/configuracoes" className="text-xs font-semibold text-[var(--primary)] hover:underline">Configurações</Link>}
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Provedor"
          size="sm"
          aria-label="Provedor"
          value={form.provedor}
          onChange={(e) => setForm({ ...form, provedor: e.target.value, credencialId: '' })}
          placeholder="Selecione..."
          options={PROVEDORES.map((p) => ({ value: p.id, label: p.nome }))}
        />
        <Select
          label="Credencial (do cofre)"
          size="sm"
          aria-label="Credencial (do cofre)"
          value={form.credencialId}
          onChange={(e) => setForm({ ...form, credencialId: e.target.value })}
          disabled={!form.provedor}
          placeholder={credenciaisDoProvedor.length ? 'Selecione...' : 'Nenhuma credencial compatível'}
          options={credenciaisDoProvedor.map((c) => ({ value: c.id, label: c.nome }))}
        />

        {form.provedor && credenciaisDoProvedor.length === 0 && (
          <p className="m-0 text-xs text-[var(--text-muted)]">
            Este provedor ainda não tem integração configurada na sua conta. Fale com o administrador para ativar.
          </p>
        )}

        <p className="m-0 text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
          <Lock size={11} aria-hidden="true" /> A chave de API fica cifrada no cofre e só é usada no momento da cobrança.
        </p>

        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-[13px] text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
            />
            Ativo
          </label>
          <Button variant="primary" size="sm" onClick={onSalvar} loading={salvando} disabled={!form.provedor} className="h-9">
            Salvar configuração
          </Button>
        </div>
      </div>
    </Painel>
  );
}

// --- Drawer "Nova cobrança" ---
function NovaCobrancaDrawer({ aberto, onClose, onCriada }) {
  const toast = useToast();
  const [form, setForm] = useState({ valor: '', metodo: 'PIX', descricao: '', origem: 'AVULSA', refId: '' });
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const fechar = () => {
    setForm({ valor: '', metodo: 'PIX', descricao: '', origem: 'AVULSA', refId: '' });
    setResultado(null);
    onClose();
  };

  const criar = async () => {
    const valorNum = Number(form.valor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) return toast.error('Informe um valor válido.');
    setEnviando(true);
    try {
      const nova = await pagamentosService.criarCobranca({
        valor: valorNum,
        metodo: form.metodo,
        descricao: form.descricao || undefined,
        origem: form.origem,
        refId: form.refId || undefined,
      });
      setResultado(nova);
      onCriada(nova);
      toast.success('Cobrança criada.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao criar cobrança.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Drawer isOpen={aberto} onClose={fechar} title="Nova cobrança" description="Gera um Pix ou link de pagamento.">
      {resultado ? (
        <div className="space-y-4">
          <Badge variant="success" size="sm">{STATUS[resultado.status]?.rotulo || resultado.status}</Badge>
          {resultado.qrCode && (
            <div>
              <label htmlFor="nova-pix-copia-cola" className="block text-xs text-[var(--text-muted)] mb-1">Pix copia e cola</label>
              <textarea
                id="nova-pix-copia-cola"
                readOnly
                value={resultado.qrCode}
                className="w-full text-xs font-mono p-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-main)] text-[var(--text-main)]"
                rows={3}
                onFocus={(e) => e.target.select()}
              />
            </div>
          )}
          {resultado.linkUrl && (
            <a href={resultado.linkUrl} target="_blank" rel="noreferrer" className="text-sm text-[var(--primary)] underline break-all">
              {resultado.linkUrl}
            </a>
          )}
          <Button variant="secondary" onClick={fechar}>Fechar</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Input
            label="Valor (R$)"
            type="number"
            value={form.valor}
            onChange={(e) => setForm({ ...form, valor: e.target.value })}
            placeholder="0,00"
          />
          <Select
            label="Método"
            aria-label="Método"
            value={form.metodo}
            onChange={(e) => setForm({ ...form, metodo: e.target.value })}
            placeholder={null}
            options={[{ value: 'PIX', label: 'Pix (QR + copia e cola)' }, { value: 'LINK', label: 'Link de pagamento' }]}
          />
          <Input
            label="Descrição"
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            placeholder="Ex.: Consulta, Pedido #123"
          />
          <Button variant="primary" onClick={criar} loading={enviando} className="w-full">
            Gerar cobrança
          </Button>
        </div>
      )}
    </Drawer>
  );
}
