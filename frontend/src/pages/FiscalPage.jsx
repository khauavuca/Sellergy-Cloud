import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, RefreshCw, Download, Lock, Trash2, FileSpreadsheet, Pencil, Settings,
  AlertTriangle, Ban, FileCode2, Search,
} from 'lucide-react';
import {
  Button, Badge, EmptyState, Input, Select, Drawer, Textarea, useToast, LabelAjuda,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, BarraFerramentas, AbasPilula,
} from '../components/ui';
import Modal from '../components/Modal';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import fiscalService from '../services/fiscalService';
import credenciaisService from '../services/credenciaisService';
import catalogoService from '../services/catalogoService';

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ITEM_EMIT = { variacaoId: '', quantidade: '1', ncm: '', cfop: '', cest: '' };
const DEST_VAZIO = { nome: '', documento: '', email: '', uf: '', municipio: '' };

// Emissores suportados + o tipo de credencial exigido (espelha
// backend/src/adapters/fiscal/index.js).
const PROVEDORES = [
  { id: 'FOCUS_NFE', nome: 'Focus NFe', tipoCredencial: 'FOCUS_NFE_KEY' },
  { id: 'NUVEM_FISCAL', nome: 'Nuvem Fiscal', tipoCredencial: 'NUVEM_FISCAL_KEY' },
];
const TIPO_POR_PROVEDOR = Object.fromEntries(PROVEDORES.map((p) => [p.id, p.tipoCredencial]));
const NOME_PROVEDOR = Object.fromEntries(PROVEDORES.map((p) => [p.id, p.nome]));

const STATUS_VARIANT = {
  PENDENTE: 'warning', PROCESSANDO: 'warning', EMITIDA: 'success',
  ERRO: 'danger', CANCELADA: 'neutral',
};
const STATUS_ROTULO = {
  PENDENTE: 'Pendente', PROCESSANDO: 'Processando', EMITIDA: 'Autorizada',
  ERRO: 'Rejeitada', CANCELADA: 'Cancelada',
};
const TIPO_ROTULO = { NFCE: 'NFC-e', NFSE: 'NFS-e' };

const FILTROS = [
  { valor: 'todas', rotulo: 'Todas', casa: () => true },
  { valor: 'ERRO', rotulo: 'Rejeitadas', casa: (d) => d.status === 'ERRO' },
  { valor: 'NFSE', rotulo: 'Serviço (NFS-e)', casa: (d) => d.tipo === 'NFSE' },
  { valor: 'NFCE', rotulo: 'Produto (NFC-e)', casa: (d) => d.tipo === 'NFCE' },
  { valor: 'CANCELADA', rotulo: 'Canceladas', casa: (d) => d.status === 'CANCELADA' },
];

const PERIODOS = [
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: '7d', rotulo: 'Últimos 7 dias' },
  { valor: 'mesPassado', rotulo: 'Mês passado' },
  { valor: 'tudo', rotulo: 'Tudo' },
];

const mesmoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const mesmoMes = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

function noPeriodo(d, periodo, agora) {
  if (periodo === 'tudo') return true;
  const dt = d.criadoEm ? new Date(d.criadoEm) : null;
  if (!dt) return false;
  if (periodo === 'hoje') return mesmoDia(dt, agora);
  if (periodo === '7d') return agora - dt <= 7 * 86400000;
  if (periodo === 'mesPassado') return mesmoMes(dt, new Date(agora.getFullYear(), agora.getMonth() - 1, 1));
  return mesmoMes(dt, agora);
}

function fmtQuando(iso, agora) {
  if (!iso) return '—';
  const dt = new Date(iso);
  const hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (mesmoDia(dt, agora)) return `Hoje, ${hora}`;
  const ontem = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1);
  if (mesmoDia(dt, ontem)) return `Ontem, ${hora}`;
  const data = dt.toLocaleDateString('pt-BR', dt.getFullYear() === agora.getFullYear()
    ? { day: '2-digit', month: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${data}, ${hora}`;
}

const nomeNota = (d) => `${TIPO_ROTULO[d.tipo] || d.tipo}${d.numero ? ` nº ${d.numero}` : ''}`;
const rotuloVenda = (d) => (d.vendaId ? `Venda #${d.vendaId.slice(0, 6).toUpperCase()}` : 'Avulsa');

const CLS_CAMPO = 'h-9 px-2.5 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[13px] font-medium text-[var(--text-main)] focus:outline-none focus:border-[var(--primary)] focus:shadow-[var(--shadow-focus)]';

export default function FiscalPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [agora] = useState(() => new Date());
  const [credenciais, setCredenciais] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [drawerAberto, setDrawerAberto] = useState(false);
  // Dados pra pré-preencher o drawer ao refazer uma nota rejeitada.
  const [inicialEmissao, setInicialEmissao] = useState(null);
  const [configAtiva, setConfigAtiva] = useState(false);
  // Dados do assistente (certificado, emissão automática, numeração).
  const [extrasConfig, setExtrasConfig] = useState(null);
  // Config ja feita: mostra so um resumo na lateral, com "Editar emissor" pra
  // abrir o formulario inteiro. Sem config ainda: formulario ja vem aberto.
  const [editandoConfig, setEditandoConfig] = useState(false);
  const [filtro, setFiltro] = useState('todas');
  const [periodo, setPeriodo] = useState('mes');
  const [busca, setBusca] = useState('');
  const [selId, setSelId] = useState(null);
  const [cancelando, setCancelando] = useState(null); // documento em cancelamento
  const [motivo, setMotivo] = useState('');
  const [enviandoCancel, setEnviandoCancel] = useState(false);
  const [sincronizando, setSincronizando] = useState(null);
  const [form, setForm] = useState({
    provedor: '', credencialId: '', ambiente: 'HOMOLOGACAO',
    cnpj: '', regime: '', inscricao: '', csc: '', serie: '', ativo: true,
    // Dados do emitente
    razaoSocial: '', nomeFantasia: '', inscricaoMunicipal: '', cnae: '',
    emailEmitente: '', telefoneEmitente: '',
    logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '', cep: '',
  });

  // Helper pros muitos campos de texto: {...campo('razaoSocial')}.
  const campo = (k) => ({ value: form[k], onChange: (e) => setForm((f) => ({ ...f, [k]: e.target.value })) });

  const carregar = async () => {
    setCarregando(true);
    try {
      const [cfg, creds, docs] = await Promise.all([
        fiscalService.obterConfig().catch(() => null),
        credenciaisService.listar().catch(() => []),
        fiscalService.listarDocumentos().catch(() => []),
      ]);
      setCredenciais(creds || []);
      setDocumentos(docs || []);
      setConfigAtiva(!!(cfg?.provedor && cfg?.ativo));
      if (cfg) {
        setExtrasConfig({
          certificadoValidoAte: cfg.certificadoValidoAte || null,
          certificadoTitular: cfg.certificadoTitular || null,
          emitirAutomatico: !!cfg.emitirAutomatico,
          proximoNumero: cfg.proximoNumero ?? null,
        });
        setForm((f) => ({
          ...f,
          provedor: cfg.provedor || '',
          credencialId: cfg.credencialId || '',
          ambiente: cfg.ambiente || 'HOMOLOGACAO',
          cnpj: cfg.cnpj || '',
          regime: cfg.regime || '',
          inscricao: cfg.inscricao || '',
          csc: cfg.csc || '',
          serie: cfg.serie || '',
          ativo: cfg.ativo ?? true,
          razaoSocial: cfg.razaoSocial || '',
          nomeFantasia: cfg.nomeFantasia || '',
          inscricaoMunicipal: cfg.inscricaoMunicipal || '',
          cnae: cfg.cnae || '',
          emailEmitente: cfg.emailEmitente || '',
          telefoneEmitente: cfg.telefoneEmitente || '',
          logradouro: cfg.logradouro || '',
          numero: cfg.numero || '',
          complemento: cfg.complemento || '',
          bairro: cfg.bairro || '',
          municipio: cfg.municipio || '',
          uf: cfg.uf || '',
          cep: cfg.cep || '',
        }));
      }
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    carregar();
  }, []);

  const abrirEmissao = (inicial = null) => {
    setInicialEmissao(inicial);
    setDrawerAberto(true);
  };

  useAcaoTopo(
    <Button
      size="sm"
      icon={Plus}
      onClick={() => abrirEmissao()}
      disabled={!configAtiva}
      title={!configAtiva ? 'Salve a configuração (emissor + ativo) antes de emitir' : undefined}
    >
      Emitir nota
    </Button>,
    [configAtiva],
  );

  const credenciaisDoProvedor = form.provedor
    ? credenciais.filter((c) => c.tipo === TIPO_POR_PROVEDOR[form.provedor])
    : [];

  const nomeProvedorAtual = NOME_PROVEDOR[form.provedor] || form.provedor;
  const nomeAmbiente = form.ambiente === 'PRODUCAO' ? 'Produção' : 'Homologação';
  const nomeMes = agora.toLocaleDateString('pt-BR', { month: 'long' });

  const stats = useMemo(() => {
    const doMes = documentos.filter((d) => d.status === 'EMITIDA' && d.criadoEm && mesmoMes(new Date(d.criadoEm), agora));
    const soma = (lista) => lista.reduce((acc, d) => acc + (d.valorTotal || 0), 0);
    const nfse = doMes.filter((d) => d.tipo === 'NFSE');
    const nfce = doMes.filter((d) => d.tipo === 'NFCE');
    return {
      emitidasMes: doMes.length,
      nfseMes: nfse.length,
      nfceMes: nfce.length,
      valorNfse: soma(nfse),
      valorNfce: soma(nfce),
      comErro: documentos.filter((d) => d.status === 'ERRO').length,
      faturadoMes: soma(doMes),
    };
  }, [documentos, agora]);

  // Lista: período + busca primeiro (contagem das abas), depois a aba.
  const doPeriodo = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return documentos.filter((d) => {
      if (!noPeriodo(d, periodo, agora)) return false;
      if (!termo) return true;
      return [d.destNome, d.destDocumento, d.numero, d.chave]
        .some((v) => v && String(v).toLowerCase().includes(termo));
    });
  }, [documentos, periodo, busca, agora]);

  const abas = FILTROS.map((f) => ({ valor: f.valor, rotulo: f.rotulo, qtd: doPeriodo.filter(f.casa).length }));
  const casaFiltro = (FILTROS.find((f) => f.valor === filtro) || FILTROS[0]).casa;
  const visiveis = doPeriodo.filter(casaFiltro);

  // Nota no detalhe: a clicada; sem clique, a primeira rejeitada (precisa de
  // atenção) ou a primeira da lista.
  const selecionado = documentos.find((d) => d.id === selId)
    || visiveis.find((d) => d.status === 'ERRO')
    || visiveis[0]
    || null;

  const certificado = useMemo(() => {
    const ate = extrasConfig?.certificadoValidoAte ? new Date(extrasConfig.certificadoValidoAte) : null;
    if (!ate || Number.isNaN(ate.getTime())) return null;
    const dias = Math.ceil((ate - agora) / 86400000);
    return { ate, dias };
  }, [extrasConfig, agora]);

  const salvarConfig = async () => {
    if (!form.provedor) return toast.error('Escolha um emissor.');
    setSalvando(true);
    try {
      const salvo = await fiscalService.salvarConfig(form);
      setConfigAtiva(!!(salvo?.provedor && salvo?.ativo));
      setEditandoConfig(false);
      toast.success('Configuração fiscal salva.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao salvar configuração.');
    } finally {
      setSalvando(false);
    }
  };

  const sincronizar = async (id) => {
    setSincronizando(id);
    try {
      const atualizado = await fiscalService.sincronizar(id);
      setDocumentos((lista) => lista.map((d) => (d.id === id ? { ...d, ...atualizado } : d)));
      toast.success('Situação atualizada.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao consultar a situação.');
    } finally {
      setSincronizando(null);
    }
  };

  const confirmarCancelamento = async () => {
    if (!cancelando) return;
    if (motivo.trim().length < 15) return toast.error('Escreva o motivo com pelo menos 15 caracteres.');
    setEnviandoCancel(true);
    try {
      const atualizado = await fiscalService.cancelar(cancelando.id, motivo.trim());
      setDocumentos((lista) => lista.map((d) => (d.id === cancelando.id ? { ...d, ...atualizado } : d)));
      toast.success('Pedido de cancelamento enviado.');
      setCancelando(null);
      setMotivo('');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao cancelar a nota.');
    } finally {
      setEnviandoCancel(false);
    }
  };

  // Exporta os itens da nota em CSV (busca o detalhe pra ter os itens).
  // Neutraliza injeção de fórmula: célula iniciada com = + - @ ganha aspa.
  const exportarCsv = async (doc) => {
    try {
      const completo = await fiscalService.obterDocumento(doc.id);
      const itens = completo.itens || [];
      const safe = (c) => {
        let s = String(c ?? '');
        if (/^[=+\-@]/.test(s)) s = `'${s}`;
        return s.replace(/"/g, '""');
      };
      const linhas = [['descricao', 'quantidade', 'valor_unitario', 'valor_total']];
      itens.forEach((it) => linhas.push([it.descricao, it.quantidade, it.valorUnitario, it.valorTotal]));
      if (!itens.length) linhas.push(['(nota por valor, sem itens)', '', '', completo.valorTotal ?? '']);
      const csv = linhas.map((l) => l.map((c) => `"${safe(c)}"`).join(';')).join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nota-${doc.numero || doc.id.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Falha ao exportar CSV.');
    }
  };

  const aoEmitir = (novo) => {
    setDocumentos((lista) => [novo, ...lista]);
    setSelId(novo?.id || null);
    setDrawerAberto(false);
  };

  const refazerRejeitada = (d) => abrirEmissao({
    tipo: d.tipo,
    dest: {
      nome: d.destNome || '', documento: d.destDocumento || '', email: d.destEmail || '',
      uf: d.destUf || '', municipio: d.destMunicipio || '',
    },
  });

  const mostrarFormConfig = !configAtiva || editandoConfig;

  // --- Números do topo ---
  let numCertificado;
  if (carregando) {
    numCertificado = { valor: '—', detalhe: '' };
  } else if (!certificado) {
    numCertificado = { valor: 'Não enviado', detalhe: 'envie pelo assistente da nota', tom: 'alerta', onClick: () => navigate('/app/fiscal/ativar') };
  } else {
    const ate = certificado.ate.toLocaleDateString('pt-BR');
    const titular = extrasConfig?.certificadoTitular ? ` · ${extrasConfig.certificadoTitular}` : '';
    if (certificado.dias < 0) {
      numCertificado = { valor: 'Vencido', detalhe: `venceu em ${ate}${titular}`, tom: 'perigo', onClick: () => navigate('/app/fiscal/ativar') };
    } else {
      numCertificado = {
        valor: certificado.dias === 0 ? 'Vence hoje' : `Vence em ${certificado.dias} ${certificado.dias === 1 ? 'dia' : 'dias'}`,
        detalhe: `válido até ${ate}${titular}`,
        tom: certificado.dias <= 30 ? 'alerta' : 'neutro',
      };
    }
  }

  const totalTipos = stats.valorNfse + stats.valorNfce;

  return (
    <Pagina>
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 flex-1 min-w-[240px] text-[13px] text-[var(--text-muted)]">
          NFS-e e NFC-e emitidas{nomeProvedorAtual ? ` pelo ${nomeProvedorAtual}` : ''}, com situação e arquivos.
          A emissão real depende do certificado e do ambiente.
        </p>
        <Link
          to="/app/fiscal/ativar"
          className="h-9 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] font-semibold text-[var(--text-main)] inline-flex items-center gap-1.5 hover:bg-[var(--bg-subtle)]"
        >
          <Settings size={15} aria-hidden="true" />
          {form.ambiente === 'PRODUCAO' && configAtiva ? 'Rever nota passo a passo' : 'Ativar nota passo a passo'}
        </Link>
      </div>

      <FaixaNumeros>
        <Numero
          rotulo={`Emitidas em ${nomeMes}`}
          valor={`${stats.emitidasMes} ${stats.emitidasMes === 1 ? 'nota' : 'notas'}`}
          detalhe={`${stats.nfseMes} NFS-e · ${stats.nfceMes} NFC-e`}
          carregando={carregando}
        />
        <Numero
          rotulo="Rejeitadas"
          valor={stats.comErro}
          detalhe={stats.comErro ? 'precisa de você' : 'tudo certo por aqui'}
          tom={stats.comErro ? 'perigo' : 'neutro'}
          tomDetalhe={stats.comErro ? 'perigo' : 'sucesso'}
          carregando={carregando}
          onClick={stats.comErro ? () => { setFiltro('ERRO'); setPeriodo('tudo'); setSelId(null); } : undefined}
        />
        <Numero
          rotulo="Valor em notas"
          valor={fmtBRL(stats.faturadoMes)}
          detalhe={`notas autorizadas em ${nomeMes}`}
          carregando={carregando}
        />
        <Numero
          rotulo="Certificado digital A1"
          valor={numCertificado.valor}
          detalhe={numCertificado.detalhe}
          tom={numCertificado.tom}
          tomDetalhe={numCertificado.tom === 'perigo' ? 'perigo' : 'neutro'}
          carregando={carregando}
          onClick={numCertificado.onClick}
        />
      </FaixaNumeros>

      <ColunasPagina
        lateral={(
          <>
            <DetalheNota
              doc={selecionado}
              carregando={carregando}
              agora={agora}
              emissor={nomeProvedorAtual ? `${nomeProvedorAtual} · ${nomeAmbiente}` : '—'}
              sincronizando={sincronizando === selecionado?.id}
              onSincronizar={sincronizar}
              onExportarCsv={exportarCsv}
              onCancelar={(d) => { setMotivo(''); setCancelando(d); }}
              onRefazer={refazerRejeitada}
              podeEmitir={configAtiva}
            />

            {configAtiva && (
              <Painel
                titulo="Como a nota sai"
                acoes={<Link to="/app/fiscal/ativar" className="text-[13px] font-semibold text-[var(--primary)] hover:underline">Alterar</Link>}
                semPadding
              >
                <LinhaInfo rotulo="Emitir sozinho em toda venda paga">
                  <Badge variant={extrasConfig?.emitirAutomatico ? 'success' : 'neutral'} size="sm">
                    {extrasConfig?.emitirAutomatico ? 'Ligado' : 'Desligado'}
                  </Badge>
                </LinhaInfo>
                <LinhaInfo rotulo="Emissor · ambiente" valor={`${nomeProvedorAtual} · ${nomeAmbiente}`} />
                <LinhaInfo rotulo="Série" valor={form.serie || '—'} />
                <LinhaInfo rotulo="Próximo número" valor={extrasConfig?.proximoNumero ?? '—'} />
                <LinhaInfo rotulo={form.razaoSocial || 'Razão social não preenchida'} valor={form.cnpj || undefined} />
                <div className="px-4 py-3">
                  <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditandoConfig(true)} disabled={editandoConfig}>
                    Editar emissor
                  </Button>
                </div>
              </Painel>
            )}
          </>
        )}
      >
        {mostrarFormConfig && !carregando && (
          <Painel
            titulo="Emissor fiscal"
            subtitulo={(
              <span className="inline-flex items-center gap-1.5">
                <Lock size={11} aria-hidden="true" /> A nota é emitida via API de terceiro; a chave fica cifrada no cofre.
              </span>
            )}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Select
                label="Emissor"
                value={form.provedor}
                onChange={(e) => setForm({ ...form, provedor: e.target.value, credencialId: '' })}
                options={[
                  { value: '', label: 'Selecione...' },
                  ...PROVEDORES.map((p) => ({ value: p.id, label: p.nome })),
                ]}
              />
              <Select
                label="Credencial (do cofre)"
                value={form.credencialId}
                onChange={(e) => setForm({ ...form, credencialId: e.target.value })}
                disabled={!form.provedor}
                options={[
                  { value: '', label: credenciaisDoProvedor.length ? 'Selecione...' : 'Nenhuma credencial compatível' },
                  ...credenciaisDoProvedor.map((c) => ({ value: c.id, label: c.nome })),
                ]}
              />
              <Select
                label="Ambiente"
                value={form.ambiente}
                onChange={(e) => setForm({ ...form, ambiente: e.target.value })}
                options={[
                  { value: 'HOMOLOGACAO', label: 'Homologação (teste)' },
                  { value: 'PRODUCAO', label: 'Produção' },
                ]}
              />
              <Input label="CNPJ" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
              <Input label="Regime tributário" value={form.regime} onChange={(e) => setForm({ ...form, regime: e.target.value })} placeholder="Simples / Presumido / Real" />
              <Input label="Inscrição estadual/municipal" value={form.inscricao} onChange={(e) => setForm({ ...form, inscricao: e.target.value })} />
              <Input label="CSC (NFC-e)" value={form.csc} onChange={(e) => setForm({ ...form, csc: e.target.value })} />
              <Input label="Série" value={form.serie} onChange={(e) => setForm({ ...form, serie: e.target.value })} placeholder="1" />
            </div>

            {form.provedor && credenciaisDoProvedor.length === 0 && (
              <p className="text-xs text-[var(--text-muted)] mt-3">
                Este emissor ainda não tem integração configurada na sua conta.
                Fale com o administrador para ativar.
              </p>
            )}

            {/* Dados da empresa (emitente) — aparecem na nota */}
            <div className="border-t border-[var(--border-subtle)] mt-5 pt-4">
              <h3 className="m-0 text-[13px] font-bold text-[var(--text-main)]">Dados da empresa (emitente)</h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 mb-3">
                Aparecem na nota emitida. Exigidos só na emissão real — pode preencher aos poucos.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Input label="Razão social" {...campo('razaoSocial')} />
                <Input label="Nome fantasia" {...campo('nomeFantasia')} />
                <Input label="Inscrição municipal" {...campo('inscricaoMunicipal')} />
                <Input label={<LabelAjuda texto="CNAE" ajuda="Código da atividade econômica principal da empresa." />} {...campo('cnae')} />
                <Input label="E-mail" type="email" {...campo('emailEmitente')} />
                <Input label="Telefone" {...campo('telefoneEmitente')} />
              </div>

              <h3 className="m-0 mt-4 mb-2 text-[13px] font-bold text-[var(--text-main)]">Endereço</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="sm:col-span-2"><Input label="Logradouro" {...campo('logradouro')} /></div>
                <Input label="Número" {...campo('numero')} />
                <Input label="Complemento" {...campo('complemento')} />
                <Input label="Bairro" {...campo('bairro')} />
                <Input label="Município" {...campo('municipio')} />
                <Input label="UF" maxLength={2} {...campo('uf')} />
                <Input label="CEP" {...campo('cep')} />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-[var(--border-subtle)]">
              <label className="inline-flex items-center gap-2 text-[13px] text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
                Ativo
              </label>
              <div className="flex items-center gap-2">
                {configAtiva && (
                  <Button variant="secondary" size="sm" onClick={() => setEditandoConfig(false)}>Cancelar</Button>
                )}
                <Button variant="primary" size="sm" onClick={salvarConfig} loading={salvando} disabled={!form.provedor}>
                  Salvar configuração
                </Button>
              </div>
            </div>
          </Painel>
        )}

        <section aria-label="Lista de notas fiscais" className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] min-w-0">
          <BarraFerramentas>
            <AbasPilula abas={abas} valor={filtro} onChange={(v) => { setFiltro(v); setSelId(null); }} rotulo="Filtrar notas" />
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                Período
                <select className={CLS_CAMPO} value={periodo} onChange={(e) => { setPeriodo(e.target.value); setSelId(null); }}>
                  {PERIODOS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                <span className="sr-only">Buscar</span>
                <span className="relative">
                  <Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    type="search"
                    className={`${CLS_CAMPO} pl-8 w-56`}
                    placeholder="Cliente, número ou chave"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                </span>
              </label>
            </div>
          </BarraFerramentas>

          {carregando ? (
            <div className="text-[13px] text-[var(--text-muted)] py-8 text-center">Carregando...</div>
          ) : visiveis.length === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title={documentos.length === 0 ? 'Nenhuma nota ainda' : 'Nenhuma nota neste filtro'}
              description={documentos.length === 0
                ? 'Emita a primeira NFC-e ou NFS-e para acompanhar aqui.'
                : 'Troque o período, a aba ou a busca para ver outras notas.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    {['Número', 'Tipo', 'Cliente', 'Venda', 'Emitida'].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">{h}</th>
                    ))}
                    <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Valor</th>
                    <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((d) => {
                    const ativo = selecionado?.id === d.id;
                    const td = 'px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap';
                    return (
                      <tr key={d.id} className={ativo ? 'bg-[var(--primary-soft)]' : 'hover:bg-[var(--bg-subtle)]'}>
                        <td className={td}>
                          <button
                            type="button"
                            onClick={() => setSelId(d.id)}
                            aria-label={`Ver ${nomeNota(d)}`}
                            aria-pressed={ativo}
                            className="font-bold text-[var(--primary)] underline underline-offset-2 hover:text-[var(--primary-hover)]"
                          >
                            {d.numero || 'sem número'}
                          </button>
                        </td>
                        <td className={`${td} text-[var(--text-secondary)]`}>{TIPO_ROTULO[d.tipo] || d.tipo}</td>
                        <td className={`${td} text-[var(--text-main)]`}>{d.destNome || 'Consumidor'}</td>
                        <td className={`${td} text-[var(--text-muted)]`}>{rotuloVenda(d)}</td>
                        <td className={`${td} text-[var(--text-secondary)]`}>{fmtQuando(d.criadoEm, agora)}</td>
                        <td className={`${td} text-right font-semibold tabular-nums text-[var(--text-main)]`}>{d.valorTotal != null ? fmtBRL(d.valorTotal) : '—'}</td>
                        <td className={td}><Badge variant={STATUS_VARIANT[d.status] || 'neutral'} size="sm">{STATUS_ROTULO[d.status] || d.status}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!carregando && documentos.length > 0 && (
            <div className="px-4 py-2.5 text-xs text-[var(--text-muted)]">
              Mostrando {visiveis.length} de {documentos.length} {documentos.length === 1 ? 'nota' : 'notas'}
              {documentos.length >= 100 ? ' (as 100 mais recentes)' : ''}
            </div>
          )}
        </section>

        {!carregando && totalTipos > 0 && (
          <Painel titulo="Por tipo de nota" acoes={<span className="text-xs text-[var(--text-muted)]">{nomeMes} · autorizadas</span>}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                ['NFS-e · serviços (prefeitura)', stats.valorNfse, stats.nfseMes],
                ['NFC-e · produtos (SEFAZ)', stats.valorNfce, stats.nfceMes],
              ].map(([rotulo, valor, qtd]) => (
                <div key={rotulo}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                    <span className="text-[var(--text-secondary)]">{rotulo}</span>
                    <strong className="tabular-nums text-[var(--text-main)]">{fmtBRL(valor)}</strong>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--bg-subtle)] mt-2" aria-hidden="true">
                    <div className="h-1.5 rounded-full bg-[var(--primary)]" style={{ width: `${(valor / totalTipos) * 100}%` }} />
                  </div>
                  <div className="text-xs text-[var(--text-muted)] mt-1">{qtd} {qtd === 1 ? 'nota' : 'notas'}</div>
                </div>
              ))}
            </div>
          </Painel>
        )}
      </ColunasPagina>

      <EmitirDrawer
        aberto={drawerAberto}
        inicial={inicialEmissao}
        onClose={() => setDrawerAberto(false)}
        onEmitido={aoEmitir}
      />

      <Modal
        isOpen={!!cancelando}
        onClose={() => !enviandoCancel && setCancelando(null)}
        title={cancelando ? `Cancelar ${nomeNota(cancelando)}` : 'Cancelar nota'}
        description="O cancelamento vai para a prefeitura/SEFAZ e não pode ser desfeito."
        size="sm"
      >
        <div className="px-6 py-5 space-y-4">
          <Textarea
            label="Motivo do cancelamento"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            maxLength={255}
            placeholder="Ex.: venda desfeita a pedido da cliente"
          />
          <p className="m-0 text-xs text-[var(--text-muted)]">
            Mínimo de 15 caracteres. O prazo para cancelar depende do tipo de nota e da prefeitura/SEFAZ.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCancelando(null)} disabled={enviandoCancel}>Voltar</Button>
            <Button variant="danger" size="sm" icon={Ban} onClick={confirmarCancelamento} loading={enviandoCancel} disabled={motivo.trim().length < 15}>
              Cancelar nota
            </Button>
          </div>
        </div>
      </Modal>
    </Pagina>
  );
}

// --- Detalhe da nota selecionada (coluna da direita) ---
function DetalheNota({ doc, carregando, agora, emissor, sincronizando, onSincronizar, onExportarCsv, onCancelar, onRefazer, podeEmitir }) {
  if (carregando) {
    return (
      <Painel titulo="Detalhe da nota">
        <div className="h-24 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />
      </Painel>
    );
  }
  if (!doc) {
    return (
      <Painel titulo="Detalhe da nota">
        <p className="m-0 text-[13px] text-[var(--text-muted)]">Escolha uma nota na lista para ver os detalhes, baixar os arquivos ou cancelar.</p>
      </Painel>
    );
  }

  const rejeitada = doc.status === 'ERRO';
  const terminal = doc.status === 'EMITIDA' || doc.status === 'CANCELADA';
  const clsLinkBotao = 'h-8 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-xs font-semibold text-[var(--text-main)] inline-flex items-center justify-center gap-1.5 hover:bg-[var(--bg-subtle)]';

  return (
    <Painel
      titulo={nomeNota(doc)}
      acoes={<Badge variant={STATUS_VARIANT[doc.status] || 'neutral'} size="sm">{STATUS_ROTULO[doc.status] || doc.status}</Badge>}
      semPadding
    >
      <div className="px-4 pt-3 pb-2 text-[13px] text-[var(--text-secondary)]">
        {doc.destNome || 'Consumidor'} · {rotuloVenda(doc)}
      </div>

      {rejeitada && (
        <div className="mx-4 mb-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2.5 text-[13px] text-[var(--danger-text)]">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <strong className="block">A nota foi recusada.</strong>
              {doc.mensagemErro || 'O emissor não informou o motivo.'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2.5">
            <Button size="sm" icon={RefreshCw} onClick={() => onRefazer(doc)} disabled={!podeEmitir}>
              Corrigir e emitir de novo
            </Button>
          </div>
          <p className="m-0 mt-2 text-xs">Abre a emissão com o destinatário desta nota já preenchido, para você corrigir os dados.</p>
        </div>
      )}

      <LinhaInfo rotulo="Valor" valor={doc.valorTotal != null ? fmtBRL(doc.valorTotal) : '—'} forte />
      <LinhaInfo rotulo="Emitida" valor={fmtQuando(doc.criadoEm, agora)} />
      {doc.destDocumento && <LinhaInfo rotulo="CPF/CNPJ do cliente" valor={doc.destDocumento} />}
      {doc.baseValor && <LinhaInfo rotulo="Valor da nota" valor={doc.baseValor === 'CUSTO' ? 'Preço de custo' : 'Preço de venda'} />}
      <LinhaInfo rotulo="Chave de acesso">
        <span className="w-full text-xs font-mono text-[var(--text-main)] [overflow-wrap:anywhere]">{doc.chave || '—'}</span>
      </LinhaInfo>
      <LinhaInfo rotulo="Emissor · ambiente" valor={emissor} />

      <div className="grid grid-cols-2 gap-2 px-4 py-3">
        {doc.urlPdf ? (
          <a href={doc.urlPdf} target="_blank" rel="noreferrer" className={clsLinkBotao}>
            <Download size={14} aria-hidden="true" /> Baixar PDF
          </a>
        ) : (
          <Button variant="secondary" size="sm" icon={Download} disabled title="PDF ainda não disponível">Baixar PDF</Button>
        )}
        {doc.urlXml ? (
          <a href={doc.urlXml} target="_blank" rel="noreferrer" className={clsLinkBotao}>
            <FileCode2 size={14} aria-hidden="true" /> Baixar XML
          </a>
        ) : (
          <Button variant="secondary" size="sm" icon={FileCode2} disabled title="XML ainda não disponível">Baixar XML</Button>
        )}
        <Button variant="secondary" size="sm" icon={FileSpreadsheet} onClick={() => onExportarCsv(doc)}>Itens em CSV</Button>
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          onClick={() => onSincronizar(doc.id)}
          loading={sincronizando}
          disabled={terminal}
          title={terminal ? 'Situação final, nada a consultar' : 'Consulta a situação no emissor'}
        >
          Sincronizar
        </Button>
        {doc.status === 'EMITIDA' && (
          <Button variant="danger-soft" size="sm" icon={Ban} onClick={() => onCancelar(doc)} className="col-span-2">
            Cancelar nota
          </Button>
        )}
      </div>
    </Painel>
  );
}

// --- Drawer "Emitir nota" (por produtos, com toggle venda/custo) ---
function EmitirDrawer({ aberto, inicial, onClose, onEmitido }) {
  const toast = useToast();
  const [variacoes, setVariacoes] = useState([]); // { value, label, preco, precoCusto }
  const [form, setForm] = useState({ tipo: 'NFCE', base: 'VENDA', descricao: '', fiscalOn: false, dest: { ...DEST_VAZIO } });
  const [itens, setItens] = useState([{ ...ITEM_EMIT }]);
  const [enviando, setEnviando] = useState(false);
  const setDest = (k, val) => setForm((f) => ({ ...f, dest: { ...f.dest, [k]: val } }));

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    (async () => {
      const prods = await catalogoService.listar().catch(() => []);
      if (!vivo) return;
      const flat = [];
      (Array.isArray(prods) ? prods : []).forEach((p) => (p.variacoes || []).forEach((v) => {
        const ehPadrao = !v.nome || v.nome === 'Padrão' || v.nome === 'Padrao';
        flat.push({
          value: v.id,
          label: ehPadrao ? p.nome : `${p.nome} — ${v.nome}`,
          preco: Number(v.preco || 0),
          precoCusto: Number(v.precoCusto || 0),
        });
      }));
      setVariacoes(flat);
      // inicial: refazer nota rejeitada (mesmo tipo e destinatario ja preenchidos).
      setForm({ tipo: inicial?.tipo || 'NFCE', base: 'VENDA', descricao: '', fiscalOn: false, dest: { ...DEST_VAZIO, ...(inicial?.dest || {}) } });
      setItens([{ ...ITEM_EMIT }]);
    })();
    return () => { vivo = false; };
  }, [aberto, inicial]);

  const mapaVar = useMemo(() => Object.fromEntries(variacoes.map((v) => [v.value, v])), [variacoes]);
  const unitDe = (variacaoId) => {
    const v = mapaVar[variacaoId];
    if (!v) return 0;
    return form.base === 'CUSTO' ? v.precoCusto : v.preco;
  };

  const setItem = (i, k, val) => setItens((arr) => arr.map((it, idx) => (idx === i ? { ...it, [k]: val } : it)));
  const addItem = () => setItens((arr) => [...arr, { ...ITEM_EMIT }]);
  const removeItem = (i) => setItens((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));

  const total = useMemo(
    () => itens.reduce((s, it) => s + unitDe(it.variacaoId) * (parseFloat(it.quantidade) || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itens, form.base, mapaVar],
  );

  const emitir = async () => {
    const validos = itens.filter((it) => it.variacaoId && parseFloat(it.quantidade) > 0);
    if (validos.length === 0) return toast.error('Selecione ao menos um produto com quantidade.');
    if (total <= 0) return toast.error('O total ficou zero. No modo Custo, produtos sem custo ficam em R$ 0 — use Venda.');
    setEnviando(true);
    try {
      const d = form.dest;
      const temDest = d.nome || d.documento || d.email || d.uf || d.municipio;
      const novo = await fiscalService.emitir({
        tipo: form.tipo,
        baseValor: form.base,
        descricao: form.descricao || undefined,
        itens: validos.map((it) => ({
          variacaoId: it.variacaoId,
          quantidade: parseInt(it.quantidade, 10),
          ncm: it.ncm || undefined,
          cfop: it.cfop || undefined,
          cest: it.cest || undefined,
        })),
        destinatario: temDest ? d : undefined,
      });
      onEmitido(novo);
      toast.success('Nota enviada para emissão.');
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao emitir.');
    } finally {
      setEnviando(false);
    }
  };

  const opcoes = [{ value: '', label: 'Selecione o produto...' }, ...variacoes];

  return (
    <Drawer
      isOpen={aberto}
      onClose={onClose}
      size="xl"
      title="Emitir nota"
      description="Selecione os produtos; o valor unitário sai travado do catálogo."
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-[var(--text-secondary)]">
            Total: <strong className="text-[var(--text-main)] tabular-nums">{fmtBRL(total)}</strong>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={emitir} loading={enviando}>Emitir</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Tipo"
            value={form.tipo}
            onChange={(e) => setForm({ ...form, tipo: e.target.value })}
            options={[{ value: 'NFCE', label: 'NFC-e (loja/varejo)' }, { value: 'NFSE', label: 'NFS-e (serviço)' }]}
          />
          <div>
            <label className="block text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">
              <LabelAjuda texto="Valor que sai na nota" ajuda="Venda = preço de revenda. Custo = preço de compra (ex.: remessa/transferência)." />
            </label>
            <div className="flex rounded-lg border border-[var(--border-main)] overflow-hidden h-11">
              {[['VENDA', 'Preço de venda'], ['CUSTO', 'Preço de custo']].map(([val, lab]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setForm({ ...form, base: val })}
                  className={`flex-1 text-sm font-medium transition-colors ${form.base === val ? 'bg-[var(--primary)] text-[var(--text-on-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'}`}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">Produtos</span>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" checked={form.fiscalOn} onChange={(e) => setForm({ ...form, fiscalOn: e.target.checked })} />
                Dados fiscais (NCM/CFOP)
              </label>
              <Button variant="ghost" size="sm" icon={Plus} onClick={addItem}>Adicionar</Button>
            </div>
          </div>
          <div className="space-y-2">
            {itens.map((it, i) => {
              const unit = unitDe(it.variacaoId);
              const sub = unit * (parseFloat(it.quantidade) || 0);
              return (
                <div key={i} className="space-y-1">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-12 md:col-span-6">
                      <Select value={it.variacaoId} onChange={(e) => setItem(i, 'variacaoId', e.target.value)} options={opcoes} placeholder="" />
                    </div>
                    <div className="col-span-3 md:col-span-2">
                      <Input type="number" min="1" step="1" placeholder="Qtd." value={it.quantidade} onChange={(e) => setItem(i, 'quantidade', e.target.value)} />
                    </div>
                    <div className="col-span-3 md:col-span-2 text-xs text-[var(--text-muted)] tabular-nums">
                      {it.variacaoId ? `un. ${fmtBRL(unit)}` : ''}
                    </div>
                    <div className="col-span-6 md:col-span-2 flex items-center justify-end gap-1">
                      <span className="text-sm tabular-nums text-[var(--text-secondary)]">{fmtBRL(sub)}</span>
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        disabled={itens.length === 1}
                        title="Remover"
                        aria-label="Remover produto"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--bg-subtle)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  {form.fiscalOn && (
                    <div className="grid grid-cols-3 gap-2">
                      <Input size="sm" placeholder="NCM (8 díg.)" value={it.ncm} onChange={(e) => setItem(i, 'ncm', e.target.value)} inputMode="numeric" />
                      <Input size="sm" placeholder="CFOP (4 díg.)" value={it.cfop} onChange={(e) => setItem(i, 'cfop', e.target.value)} inputMode="numeric" />
                      <Input size="sm" placeholder="CEST (7 díg., opcional)" value={it.cest} onChange={(e) => setItem(i, 'cest', e.target.value)} inputMode="numeric" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Destinatario — opcional em teste; obrigatorio na emissao real (gate de producao) */}
        <div className="rounded-xl border border-[var(--border-main)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
            Destinatário (quem recebe a nota)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Nome / Razão social" value={form.dest.nome} onChange={(e) => setDest('nome', e.target.value)} />
            <Input label={<LabelAjuda texto="CNPJ / CPF" ajuda="Só os números. Validamos o dígito verificador." />} value={form.dest.documento} onChange={(e) => setDest('documento', e.target.value)} inputMode="numeric" />
            <Input label="E-mail" type="email" value={form.dest.email} onChange={(e) => setDest('email', e.target.value)} />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><Input label="Município" value={form.dest.municipio} onChange={(e) => setDest('municipio', e.target.value)} /></div>
              <Input label="UF" maxLength={2} value={form.dest.uf} onChange={(e) => setDest('uf', e.target.value)} />
            </div>
          </div>
        </div>

        <Input label="Descrição (opcional)" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />

        <div className="flex items-start gap-2 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-main)] p-3 text-xs text-[var(--text-muted)]">
          <Lock size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            O valor unitário vem travado do catálogo ({form.base === 'CUSTO' ? 'preço de custo' : 'preço de venda'}).
            A emissão roda em modo de teste (sem SEFAZ) por enquanto.
          </span>
        </div>
      </div>
    </Drawer>
  );
}
