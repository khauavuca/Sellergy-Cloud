// /app/recebimentos — frente B da fase 2.
// Conta de recebimento do negocio (subconta Asaas aberta pelo Sellergy):
// assistente de 3 passos -> em analise -> ativa (saldo, a liberar, extrato,
// taxas, saque pra chave Pix). A chave da conta fica no servidor.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, Loader2, AlertCircle, CheckCircle2, Clock, RotateCw, ExternalLink, Search, ArrowDownToLine, XCircle, Info,
} from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import Modal from '../components/Modal';
import {
  Badge, Button, Input, Select, useToast,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, BarraFerramentas, AbasPilula,
} from '../components/ui';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import { useAuthStore } from '../store/auth.store';
import {
  fmtBRL, mascaraCnpj, mascaraCpf, mascaraTelefone, mascaraCep, erroDaApi,
} from '../components/pedidos/util';

const PASSOS = ['Dados do negócio', 'Quem responde', 'Repasse'];
const TIPOS_EMPRESA = [
  { value: 'MEI', label: 'MEI' },
  { value: 'LIMITED', label: 'Limitada (LTDA) ou SLU' },
  { value: 'INDIVIDUAL', label: 'Empresário individual (EI)' },
  { value: 'ASSOCIATION', label: 'Associação' },
];
const TIPOS_CHAVE = [
  { value: 'CNPJ', label: 'CNPJ' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'PHONE', label: 'Celular' },
  { value: 'EVP', label: 'Chave aleatória' },
];
const PRAZOS = [
  { value: 'PADRAO', titulo: 'Pix na hora, cartão em 30 dias', descricao: 'O mais comum. Sem taxa de antecipação.' },
  { value: 'ANTECIPADO', titulo: 'Cartão antecipado automaticamente', descricao: 'O cartão cai antes, com a taxa de antecipação do Asaas.' },
];
const STATUS = {
  RASCUNHO: { rotulo: 'Não enviada', variante: 'neutral' },
  EM_ANALISE: { rotulo: 'Em análise', variante: 'warning' },
  ATIVA: { rotulo: 'Ativa · Pix e cartão liberados', variante: 'success' },
  RECUSADA: { rotulo: 'Recusada', variante: 'danger' },
};
const CAMPOS_POR_PASSO = { negocio: 0, responsavel: 1, repasse: 2 };

// Tipos de movimentação do extrato do Asaas (/financialTransactions).
function tipoDoExtrato(t) {
  const tipo = String(t.tipo || '').toUpperCase();
  if (tipo.includes('FEE')) return { rotulo: tipo.startsWith('TRANSFER') ? 'Taxa de saque' : 'Taxa', variante: 'neutral', grupo: 'taxas' };
  if (tipo.startsWith('TRANSFER')) return { rotulo: 'Saque', variante: 'info', grupo: 'saques' };
  if (tipo.includes('REFUND') || tipo.includes('REVERSAL') || tipo.includes('CHARGEBACK')) return { rotulo: 'Estorno', variante: 'warning', grupo: 'saidas' };
  if (tipo.includes('PAYMENT') && t.valor >= 0) return { rotulo: 'Recebimento', variante: 'success', grupo: 'entradas' };
  return t.valor >= 0
    ? { rotulo: 'Entrada', variante: 'success', grupo: 'entradas' }
    : { rotulo: 'Saída', variante: 'neutral', grupo: 'saidas' };
}

const fmtTaxa = (l) => [l.percentual !== null ? `${String(l.percentual).replace('.', ',')}%` : null, l.fixo ? fmtBRL(l.fixo) : null].filter(Boolean).join(' + ') || 'Grátis';
const paraNumero = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const valorEmTexto = (v) => (v ? v.toFixed(2).replace('.', ',') : '');

const TH = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const TD = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';

const formVazio = () => ({
  negocio: { cnpj: '', razaoSocial: '', nomeFantasia: '', tipoEmpresa: 'LIMITED', email: '', telefone: '', faturamentoMensal: '', cep: '', endereco: '', numero: '', complemento: '', bairro: '' },
  responsavel: { nome: '', cpf: '', dataNascimento: '', celular: '' },
  repasse: { prazo: 'PADRAO', tipoChavePix: 'CNPJ', chavePix: '' },
});

function Erro({ texto, onTentar }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-[10px] bg-[var(--danger-soft)] text-[13px] text-[var(--danger-text)]">
      <AlertCircle size={16} aria-hidden="true" /> {texto}
      {onTentar && <Button variant="secondary" size="sm" icon={RotateCw} className="ml-auto" onClick={onTentar}>Tentar de novo</Button>}
    </div>
  );
}

function Carregando() {
  return <div className="py-16 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;
}

function PorQueUsar() {
  return (
    <Painel titulo="Por que usar a conta do Sellergy">
      <ul className="space-y-2 text-[13px] text-[var(--text-secondary)]">
        {['Pix e cartão na mesma tela da venda', 'Pagamento confirma sozinho e baixa o estoque', 'Link de pagamento no WhatsApp para pedidos', 'Sem maquininha alugada'].map((t) => (
          <li key={t} className="flex gap-2"><CheckCircle2 size={16} aria-hidden="true" className="text-[var(--success)] shrink-0 mt-0.5" />{t}</li>
        ))}
      </ul>
      <p className="text-xs text-[var(--text-muted)] mt-3">A conta é aberta no Asaas, instituição de pagamento autorizada pelo Banco Central. Já tem Mercado Pago ou Asaas? Dá pra continuar usando em <Link to="/app/pagamentos" className="underline">Pagamentos</Link>.</p>
    </Painel>
  );
}

function nomeProvedor(p) {
  return p === 'MERCADO_PAGO' ? 'Mercado Pago' : p === 'ASAAS' ? 'Asaas' : 'Pagar.me';
}

// ---------------------------------------------------------------------
// Assistente
// ---------------------------------------------------------------------
function Assistente({ inicial, sugestoes, erroAnterior, onAberta }) {
  const toast = useToast();
  const [passo, setPasso] = useState(0);
  const [form, setForm] = useState(() => {
    const f = formVazio();
    if (inicial) {
      Object.assign(f.negocio, Object.fromEntries(Object.entries(inicial.negocio || {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)])));
      f.negocio.cnpj = mascaraCnpj(f.negocio.cnpj);
      f.negocio.telefone = mascaraTelefone(f.negocio.telefone);
      f.negocio.cep = mascaraCep(f.negocio.cep);
      f.responsavel.nome = inicial.responsavel?.nome || '';
      Object.assign(f.repasse, { prazo: inicial.repasse?.prazo || 'PADRAO', tipoChavePix: inicial.repasse?.tipoChavePix || 'CNPJ', chavePix: inicial.repasse?.chavePix || '' });
    } else if (sugestoes) {
      f.negocio.cnpj = sugestoes.cnpj ? mascaraCnpj(sugestoes.cnpj) : '';
      f.negocio.email = sugestoes.email || '';
      f.negocio.telefone = sugestoes.telefone ? mascaraTelefone(sugestoes.telefone) : '';
    }
    return f;
  });
  const [campos, setCampos] = useState([]);
  const [erro, setErro] = useState(erroAnterior || null);
  const [enviando, setEnviando] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);

  const set = (grupo, campo) => (e) => {
    let v = e.target.value;
    if (campo === 'cnpj') v = mascaraCnpj(v);
    if (campo === 'cpf') v = mascaraCpf(v);
    if (campo === 'telefone' || campo === 'celular') v = mascaraTelefone(v);
    if (campo === 'cep') v = mascaraCep(v);
    setForm((f) => ({ ...f, [grupo]: { ...f[grupo], [campo]: v } }));
  };
  const erroDe = (nome, msg) => (campos.includes(nome) ? msg : undefined);

  const buscarCnpj = async () => {
    setBuscandoCnpj(true);
    try {
      const r = await api.get(`/conta-recebimento/cnpj/${form.negocio.cnpj.replace(/\D/g, '')}`);
      const d = r.data;
      setForm((f) => ({
        ...f,
        negocio: {
          ...f.negocio,
          razaoSocial: d.razaoSocial || f.negocio.razaoSocial,
          nomeFantasia: d.nomeFantasia || f.negocio.nomeFantasia,
          tipoEmpresa: d.tipoEmpresa || f.negocio.tipoEmpresa,
          cep: d.cep ? mascaraCep(d.cep) : f.negocio.cep,
          endereco: d.endereco || f.negocio.endereco,
          numero: d.numero || f.negocio.numero,
          complemento: d.complemento || f.negocio.complemento,
          bairro: d.bairro || f.negocio.bairro,
        },
      }));
      toast.success(d.situacao && d.situacao !== 'ATIVA' ? `Dados preenchidos. Situação na Receita: ${d.situacao}.` : 'Dados preenchidos pela Receita. Confira e siga.');
    } catch (e) {
      toast.error(erroDaApi(e, 'Não achamos esse CNPJ agora. Preencha os dados.'));
    } finally {
      setBuscandoCnpj(false);
    }
  };

  const enviar = async () => {
    setErro(null);
    setCampos([]);
    setEnviando(true);
    try {
      const n = form.negocio;
      await api.post('/conta-recebimento', {
        negocio: { ...n, faturamentoMensal: Number(String(n.faturamentoMensal).replace(/\./g, '').replace(',', '.')) },
        responsavel: form.responsavel,
        repasse: form.repasse,
      });
      onAberta();
    } catch (e) {
      const c = e.response?.data?.campos || [];
      setCampos(c);
      setErro(erroDaApi(e, 'Não foi possível enviar. Tente de novo.'));
      if (c.length) setPasso(Math.min(...c.map((x) => CAMPOS_POR_PASSO[x.split('.')[0]] ?? 2)));
    } finally {
      setEnviando(false);
    }
  };

  const n = form.negocio;
  const r = form.responsavel;
  const p = form.repasse;

  return (
    <ColunasPagina lateral={<PorQueUsar />}>
      <Painel titulo="Abrir a conta de recebimento" subtitulo={`Passo ${passo + 1} de ${PASSOS.length} · ${PASSOS[passo]}`}>
        <ol className="flex flex-wrap gap-2 mb-4" aria-label="Passos">
          {PASSOS.map((t, i) => (
            <li key={t} aria-current={i === passo ? 'step' : undefined} className={clsx('flex items-center gap-2 text-sm font-semibold px-2 py-1 rounded-full', i === passo ? 'text-[var(--text-main)] bg-[var(--bg-subtle)]' : i < passo ? 'text-[var(--success-text)]' : 'text-[var(--text-muted)]')}>
              <span className={clsx('w-6 h-6 rounded-full grid place-items-center text-xs', i === passo ? 'bg-[var(--primary)] text-[var(--text-on-primary)]' : i < passo ? 'bg-[var(--success-soft)]' : 'bg-[var(--bg-subtle)]')}>{i < passo ? '✓' : i + 1}</span>
              {t}
            </li>
          ))}
        </ol>

        {passo === 0 && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2 flex gap-2 items-end">
              <div className="flex-1"><Input label="CNPJ" aria-label="CNPJ" inputMode="numeric" value={n.cnpj} onChange={set('negocio', 'cnpj')} error={erroDe('negocio.cnpj', 'CNPJ inválido.')} /></div>
              <Button variant="secondary" icon={Search} className="h-11 mb-[1px]" loading={buscandoCnpj} disabled={n.cnpj.replace(/\D/g, '').length !== 14} onClick={buscarCnpj}>Buscar na Receita</Button>
            </div>
            <div className="sm:col-span-2"><Input label="Razão social" aria-label="Razão social" value={n.razaoSocial} onChange={set('negocio', 'razaoSocial')} error={erroDe('negocio.razaoSocial', 'Informe a razão social.')} /></div>
            <Input label="Nome do negócio (opcional)" aria-label="Nome do negócio" value={n.nomeFantasia} onChange={set('negocio', 'nomeFantasia')} />
            <Select label="Tipo de empresa" aria-label="Tipo de empresa" value={n.tipoEmpresa} onChange={set('negocio', 'tipoEmpresa')} options={TIPOS_EMPRESA} placeholder="" error={erroDe('negocio.tipoEmpresa', 'Escolha o tipo.')} />
            <Input label="E-mail do financeiro" aria-label="E-mail do financeiro" type="email" value={n.email} onChange={set('negocio', 'email')} error={erroDe('negocio.email', 'E-mail inválido.')} hint="Vira o login da conta no Asaas." />
            <Input label="Telefone" aria-label="Telefone do negócio" type="tel" value={n.telefone} onChange={set('negocio', 'telefone')} error={erroDe('negocio.telefone', 'Telefone com DDD.')} />
            <Input label="Faturamento por mês (R$)" aria-label="Faturamento por mês em reais" inputMode="decimal" value={n.faturamentoMensal} onChange={set('negocio', 'faturamentoMensal')} error={erroDe('negocio.faturamentoMensal', 'Informe uma estimativa.')} hint="Uma estimativa; o Asaas pede." />
            <Input label="CEP" aria-label="CEP" inputMode="numeric" value={n.cep} onChange={set('negocio', 'cep')} error={erroDe('negocio.cep', 'CEP com 8 números.')} />
            <div className="sm:col-span-2"><Input label="Endereço" aria-label="Endereço" value={n.endereco} onChange={set('negocio', 'endereco')} error={erroDe('negocio.endereco', 'Informe a rua.')} /></div>
            <Input label="Número" aria-label="Número" value={n.numero} onChange={set('negocio', 'numero')} error={erroDe('negocio.numero', 'Informe o número.')} />
            <Input label="Complemento (opcional)" aria-label="Complemento" value={n.complemento} onChange={set('negocio', 'complemento')} />
            <Input label="Bairro" aria-label="Bairro" value={n.bairro} onChange={set('negocio', 'bairro')} error={erroDe('negocio.bairro', 'Informe o bairro.')} />
          </div>
        )}

        {passo === 1 && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><Input label="Nome completo do responsável" aria-label="Nome completo do responsável" value={r.nome} onChange={set('responsavel', 'nome')} error={erroDe('responsavel.nome', 'Nome e sobrenome.')} /></div>
            <Input label="CPF" aria-label="CPF do responsável" inputMode="numeric" value={r.cpf} onChange={set('responsavel', 'cpf')} error={erroDe('responsavel.cpf', 'CPF inválido.')} />
            <Input label="Data de nascimento" aria-label="Data de nascimento" type="date" value={r.dataNascimento} onChange={set('responsavel', 'dataNascimento')} error={erroDe('responsavel.dataNascimento', 'Precisa ter 18 anos ou mais.')} />
            <Input label="Celular" aria-label="Celular do responsável" type="tel" value={r.celular} onChange={set('responsavel', 'celular')} error={erroDe('responsavel.celular', 'Celular com DDD.')} />
            <p className="sm:col-span-2 text-xs text-[var(--text-muted)] flex gap-1.5"><Info size={14} className="shrink-0 mt-0.5" />Depois do envio, o Asaas pode pedir foto do documento e uma selfie. O link aparece aqui nesta tela.</p>
          </div>
        )}

        {passo === 2 && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-[var(--text-main)] mb-2">Quando o dinheiro fica disponível</legend>
              {PRAZOS.map((o) => (
                <label key={o.value} className={clsx('flex gap-3 p-3 rounded-[10px] border cursor-pointer min-h-11', p.prazo === o.value ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)]')}>
                  <input type="radio" name="prazo" value={o.value} checked={p.prazo === o.value} onChange={set('repasse', 'prazo')} className="mt-1" />
                  <span><span className="block text-sm font-semibold text-[var(--text-main)]">{o.titulo}</span><span className="block text-xs text-[var(--text-muted)]">{o.descricao}</span></span>
                </label>
              ))}
            </fieldset>
            <div className="grid sm:grid-cols-3 gap-3">
              <Select label="Tipo da chave Pix" aria-label="Tipo da chave Pix" value={p.tipoChavePix} onChange={set('repasse', 'tipoChavePix')} options={TIPOS_CHAVE} placeholder="" />
              <div className="sm:col-span-2"><Input label="Chave Pix pra receber os saques" aria-label="Chave Pix para receber os saques" value={p.chavePix} onChange={set('repasse', 'chavePix')} error={erroDe('repasse.chavePix', 'Confira a chave.')} hint="A conta do banco tem que estar no nome do mesmo CNPJ." /></div>
            </div>
          </div>
        )}

        {erro && <div className="mt-4"><Erro texto={erro} /></div>}

        <div className="flex flex-wrap justify-between gap-2 mt-5 pt-4 border-t border-[var(--border-subtle)]">
          <Button variant="ghost" disabled={passo === 0 || enviando} onClick={() => setPasso((x) => x - 1)}>Voltar</Button>
          {passo < 2
            ? <Button onClick={() => setPasso((x) => x + 1)}>Continuar</Button>
            : <Button loading={enviando} onClick={enviar}>Enviar para análise</Button>}
        </div>
      </Painel>
    </ColunasPagina>
  );
}

// ---------------------------------------------------------------------
// Conta ativa
// ---------------------------------------------------------------------
const FILTROS = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'entradas', rotulo: 'Entradas' },
  { valor: 'taxas', rotulo: 'Taxas' },
  { valor: 'saques', rotulo: 'Saques' },
];

function ContaAtiva({ conta, st, onMudou }) {
  const toast = useToast();
  const [fin, setFin] = useState(null);
  const [erro, setErro] = useState(null);
  const [offset, setOffset] = useState(0);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [filtro, setFiltro] = useState('todos');
  const [valorSaque, setValorSaque] = useState(null); // null = usa o saldo todo
  const [enviandoSaque, setEnviandoSaque] = useState(false);
  const [repasse, setRepasse] = useState(null);
  const [salvandoRepasse, setSalvandoRepasse] = useState(false);
  // Trocar a chave Pix pede a senha (ou o codigo de 2 etapas, se ligado).
  const usuario = useAuthStore((st) => st.user);
  const com2Etapas = usuario?.totpAtivo === true;
  const [confirmacao, setConfirmacao] = useState('');
  const [erroConfirmacao, setErroConfirmacao] = useState(null);
  const campoSaque = useRef(null);

  const carregar = useCallback(() => api.get('/conta-recebimento/financeiro')
    .then((r) => { setFin(r.data); setOffset(0); setErro(null); })
    .catch((e) => setErro(erroDaApi(e, 'Não foi possível carregar o saldo.'))), []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const carregou = Boolean(fin);
  const podeSacar = Boolean(fin?.saldo && fin.saldo >= 1);
  useAcaoTopo(
    carregou ? (
      <Button
        size="sm"
        icon={ArrowDownToLine}
        disabled={!podeSacar}
        onClick={() => {
          campoSaque.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          campoSaque.current?.focus();
        }}
      >
        Sacar agora
      </Button>
    ) : null,
    [carregou, podeSacar],
  );

  const maisExtrato = async () => {
    setCarregandoMais(true);
    try {
      const prox = offset + 30;
      const r = await api.get('/conta-recebimento/financeiro', { params: { offset: prox } });
      setFin((f) => ({ ...f, extrato: { itens: [...(f.extrato?.itens || []), ...(r.data.extrato?.itens || [])], temMais: r.data.extrato?.temMais } }));
      setOffset(prox);
    } catch (e) {
      toast.error(erroDaApi(e));
    } finally {
      setCarregandoMais(false);
    }
  };

  const sacar = async (e) => {
    e.preventDefault();
    const valor = paraNumero(valorSaque ?? valorEmTexto(fin?.saldo));
    if (!(valor >= 1)) { toast.error('Informe um valor a partir de R$ 1,00.'); return; }
    setEnviandoSaque(true);
    try {
      const r = await api.post('/conta-recebimento/saque', { valor });
      toast.success(`Saque de ${fmtBRL(r.data.valor)} pedido. ${r.data.status === 'DONE' ? 'Já caiu.' : 'Cai na sua chave Pix em instantes.'}`);
      setValorSaque(null);
      carregar();
    } catch (err) {
      toast.error(erroDaApi(err, 'Não foi possível sacar.'));
    } finally {
      setEnviandoSaque(false);
    }
  };

  const salvarRepasse = async (e) => {
    e.preventDefault();
    if (trocouChave && !confirmacao.trim()) {
      setErroConfirmacao(com2Etapas ? 'Digite o código do app autenticador.' : 'Digite sua senha.');
      return;
    }
    setSalvandoRepasse(true);
    setErroConfirmacao(null);
    try {
      await api.put('/conta-recebimento/repasse', {
        ...repasse,
        ...(trocouChave ? (com2Etapas ? { codigo: confirmacao.trim() } : { senha: confirmacao }) : {}),
      });
      toast.success('Repasse atualizado.');
      setRepasse(null);
      setConfirmacao('');
      onMudou();
    } catch (err) {
      const d = err.response?.data;
      if (d?.codigo === 'CONFIRMACAO_INVALIDA' || d?.codigo === 'CONFIRMACAO_NECESSARIA') setErroConfirmacao(d.erro);
      toast.error(erroDaApi(err, 'Não foi possível salvar.'));
    } finally {
      setSalvandoRepasse(false);
    }
  };

  const itens = useMemo(() => (fin?.extrato?.itens || []).map((t) => ({ ...t, tipoInfo: tipoDoExtrato(t) })), [fin]);
  const contagem = useMemo(() => {
    const c = { todos: itens.length, entradas: 0, taxas: 0, saques: 0 };
    itens.forEach((t) => { if (c[t.tipoInfo.grupo] !== undefined) c[t.tipoInfo.grupo] += 1; });
    return c;
  }, [itens]);
  const visiveis = filtro === 'todos' ? itens : itens.filter((t) => t.tipoInfo.grupo === filtro);

  const rep = conta.dados?.repasse || {};
  const neg = conta.dados?.negocio || {};
  const trocouChave = Boolean(repasse) && (repasse.tipoChavePix !== (rep.tipoChavePix || 'CNPJ') || String(repasse.chavePix || '').trim() !== String(rep.chavePix || ''));
  const tipoChave = TIPOS_CHAVE.find((t) => t.value === rep.tipoChavePix)?.label || rep.tipoChavePix;
  const prazo = PRAZOS.find((o) => o.value === conta.prazoRepasse) || PRAZOS[0];

  if (erro) return <Erro texto={erro} onTentar={carregar} />;
  if (!fin) return <Carregando />;

  const taxaSaque = fin.taxas?.saque;
  const temTaxaSaque = taxaSaque !== null && taxaSaque !== undefined;

  const lateral = (
    <>
      <Painel
        titulo="Sacar pro seu banco"
        acoes={temTaxaSaque && <Badge variant={taxaSaque ? 'neutral' : 'success'}>{taxaSaque ? `taxa ${fmtBRL(taxaSaque)}` : 'sem custo'}</Badge>}
      >
        <form onSubmit={sacar} className="flex flex-col gap-3">
          <Input
            ref={campoSaque}
            size="sm"
            label="Quanto sacar (R$)"
            aria-label="Valor do saque em reais"
            inputMode="decimal"
            value={valorSaque ?? valorEmTexto(fin.saldo)}
            onChange={(e) => setValorSaque(e.target.value)}
            disabled={!podeSacar}
            hint={fin.saldo === null ? 'Não deu pra carregar o saldo agora.' : `Disponível: ${fmtBRL(fin.saldo)}`}
          />
          <p className="m-0 text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">
            Vai para a chave Pix {tipoChave}: <strong className="text-[var(--text-main)]">{rep.chavePix || '—'}</strong>
          </p>
          <Button type="submit" icon={ArrowDownToLine} loading={enviandoSaque} disabled={!podeSacar}>Confirmar saque</Button>
        </form>
      </Painel>

      <Painel titulo="Dados da conta" acoes={st && <Badge variant={st.variante}>Ativa</Badge>} semPadding>
        <LinhaInfo rotulo="Titular" valor={neg.razaoSocial || '—'} />
        <LinhaInfo rotulo="CNPJ" valor={neg.cnpj ? mascaraCnpj(neg.cnpj) : '—'} />
        {neg.nomeFantasia && <LinhaInfo rotulo="Nome do negócio" valor={neg.nomeFantasia} />}
        <LinhaInfo rotulo={`Chave Pix (${tipoChave || '—'})`} valor={<span className="break-all">{rep.chavePix || '—'}</span>} />
        <LinhaInfo rotulo="Prazo" valor={prazo.titulo}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRepasse({ prazo: conta.prazoRepasse || 'PADRAO', tipoChavePix: rep.tipoChavePix || 'CNPJ', chavePix: rep.chavePix || '' })}
          >
            Alterar
          </Button>
        </LinhaInfo>
        <p className="m-0 px-4 py-2.5 text-xs text-[var(--text-muted)] flex items-start gap-1.5">
          <Wallet size={14} aria-hidden="true" className="shrink-0 mt-0.5" />Conta no Asaas em nome da empresa.
        </p>
      </Painel>

      <Painel titulo="Suas taxas" semPadding>
        {!fin.taxas || fin.taxas.linhas.length === 0 ? (
          <p className="m-0 px-4 py-3 text-[13px] text-[var(--text-muted)]">Não deu pra carregar as taxas agora.</p>
        ) : (
          <>
            {fin.taxas.linhas.map((l) => <LinhaInfo key={l.forma} rotulo={l.forma} valor={fmtTaxa(l)} forte />)}
            {temTaxaSaque && <LinhaInfo rotulo="Saque por Pix" valor={taxaSaque ? fmtBRL(taxaSaque) : 'Grátis'} forte />}
          </>
        )}
      </Painel>
    </>
  );

  return (
    <Pagina>
      <FaixaNumeros>
        <Numero
          destaque
          rotulo="Disponível pra sacar"
          valor={fin.saldo === null ? '—' : fmtBRL(fin.saldo)}
          detalhe={fin.saldo === null ? 'Não deu pra carregar agora.' : `Saque pra chave ${tipoChave}`}
        />
        <Numero
          rotulo="A liberar (cartão)"
          valor={fin.aLiberar === null ? '—' : fmtBRL(fin.aLiberar)}
          detalhe={fin.aLiberar === null ? 'Não deu pra carregar agora.' : prazo.titulo}
        />
        <Numero
          rotulo="Saque por Pix"
          valor={temTaxaSaque ? (taxaSaque ? fmtBRL(taxaSaque) : 'Grátis') : '—'}
          detalhe="custo de cada saque"
        />
      </FaixaNumeros>

      <ColunasPagina lateral={lateral}>
        <Painel titulo="Extrato" subtitulo="Movimentações da conta, das mais novas para as mais antigas" semPadding>
          {!fin.extrato ? (
            <p className="m-0 px-4 py-4 text-[13px] text-[var(--text-muted)]">Não deu pra carregar o extrato agora.</p>
          ) : itens.length === 0 ? (
            <p className="m-0 px-4 py-4 text-[13px] text-[var(--text-muted)]">Nenhuma movimentação ainda. Os pagamentos aparecem aqui assim que caem.</p>
          ) : (
            <>
              <BarraFerramentas>
                <AbasPilula
                  rotulo="Filtrar extrato"
                  abas={FILTROS.map((f) => ({ ...f, qtd: contagem[f.valor] }))}
                  valor={filtro}
                  onChange={setFiltro}
                />
              </BarraFerramentas>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      <th className={TH}>Quando</th>
                      <th className={TH}>O quê</th>
                      <th className={TH}>Tipo</th>
                      <th className={clsx(TH, 'text-right')}>Valor</th>
                      <th className={clsx(TH, 'text-right')}>Saldo depois</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((t) => (
                      <tr key={t.id}>
                        <td className={clsx(TD, 'whitespace-nowrap text-[var(--text-secondary)]')}>{t.data ? new Date(`${t.data}T12:00:00`).toLocaleDateString('pt-BR') : ''}</td>
                        <td className={clsx(TD, 'text-[var(--text-main)]')}>{t.descricao}</td>
                        <td className={clsx(TD, 'whitespace-nowrap')}><Badge variant={t.tipoInfo.variante}>{t.tipoInfo.rotulo}</Badge></td>
                        <td className={clsx(TD, 'text-right tabular-nums whitespace-nowrap font-semibold', t.valor < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--success-text)]')}>{fmtBRL(t.valor)}</td>
                        <td className={clsx(TD, 'text-right tabular-nums whitespace-nowrap text-[var(--text-secondary)]')}>{t.saldo === null || t.saldo === undefined ? '—' : fmtBRL(t.saldo)}</td>
                      </tr>
                    ))}
                    {visiveis.length === 0 && (
                      <tr><td colSpan={5} className={clsx(TD, 'text-center text-[var(--text-muted)]')}>Nada desse tipo nas movimentações carregadas.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="text-xs text-[var(--text-muted)]">{visiveis.length} de {itens.length} movimentações carregadas</span>
                {fin.extrato.temMais && <Button variant="secondary" size="sm" loading={carregandoMais} onClick={maisExtrato}>Carregar mais</Button>}
              </div>
            </>
          )}
        </Painel>
      </ColunasPagina>

      <Modal isOpen={repasse !== null} onClose={() => { if (!salvandoRepasse) { setRepasse(null); setConfirmacao(''); setErroConfirmacao(null); } }} title="Alterar repasse" size="md">
        {repasse && (
          <form onSubmit={salvarRepasse} className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-[var(--text-main)] mb-2">Prazo</legend>
              {PRAZOS.map((o) => (
                <label key={o.value} className={clsx('flex gap-3 p-3 rounded-[10px] border cursor-pointer min-h-11', repasse.prazo === o.value ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)]')}>
                  <input type="radio" name="prazo-alt" checked={repasse.prazo === o.value} onChange={() => setRepasse({ ...repasse, prazo: o.value })} className="mt-1" />
                  <span><span className="block text-sm font-semibold text-[var(--text-main)]">{o.titulo}</span><span className="block text-xs text-[var(--text-muted)]">{o.descricao}</span></span>
                </label>
              ))}
            </fieldset>
            <Select label="Tipo da chave Pix" aria-label="Tipo da chave Pix" value={repasse.tipoChavePix} onChange={(e) => setRepasse({ ...repasse, tipoChavePix: e.target.value })} options={TIPOS_CHAVE} placeholder="" />
            <Input label="Chave Pix" aria-label="Chave Pix" value={repasse.chavePix} onChange={(e) => setRepasse({ ...repasse, chavePix: e.target.value })} hint="No nome do mesmo CNPJ da conta." />
            {trocouChave && (
              <Input
                label={com2Etapas ? 'Código do app autenticador' : 'Sua senha'}
                aria-label={com2Etapas ? 'Código do app autenticador' : 'Sua senha'}
                type={com2Etapas ? 'text' : 'password'}
                inputMode={com2Etapas ? 'numeric' : undefined}
                autoComplete={com2Etapas ? 'one-time-code' : 'current-password'}
                value={confirmacao}
                onChange={(e) => { setConfirmacao(e.target.value); setErroConfirmacao(null); }}
                error={erroConfirmacao}
                hint="A chave Pix é para onde vai o dinheiro dos saques. Confirme que é você."
              />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRepasse(null)} disabled={salvandoRepasse}>Voltar</Button>
              <Button type="submit" loading={salvandoRepasse}>Salvar</Button>
            </div>
          </form>
        )}
      </Modal>
    </Pagina>
  );
}

// ---------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------
export default function RecebimentosPage() {
  const toast = useToast();
  const [estado, setEstado] = useState(null);
  const [erro, setErro] = useState(null);
  const [documentos, setDocumentos] = useState(null);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(() => api.get('/conta-recebimento')
    .then((r) => { setEstado(r.data); setErro(null); })
    .catch((e) => setErro(erroDaApi(e, 'Não foi possível carregar a conta de recebimento.'))), []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const atualizarStatus = async () => {
    setAtualizando(true);
    try {
      const r = await api.post('/conta-recebimento/atualizar-status');
      setDocumentos(r.data.documentos || []);
      setEstado((e) => ({ ...e, conta: r.data.conta }));
      toast.success(r.data.conta.status === 'ATIVA' ? 'Conta liberada!' : 'Status atualizado.');
      if (r.data.conta.status === 'ATIVA') carregar();
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível consultar agora.'));
    } finally {
      setAtualizando(false);
    }
  };

  if (erro) return <Erro texto={erro} onTentar={carregar} />;
  if (!estado) return <Carregando />;

  const { conta, pagamento, automaticaDisponivel } = estado;
  const st = conta ? STATUS[conta.status] : null;
  const enviada = conta && conta.status !== 'RASCUNHO';

  if (conta?.status === 'ATIVA') return <ContaAtiva conta={conta} st={st} onMudou={carregar} />;

  const neg = conta?.dados?.negocio || {};

  // Lateral dos estados "em análise" e "recusada": dados enviados + como recebe hoje.
  const lateralEnviada = enviada && (
    <>
      <Painel titulo="Dados da conta" acoes={st && <Badge variant={st.variante}>{st.rotulo}</Badge>} semPadding>
        <LinhaInfo rotulo="Titular" valor={neg.razaoSocial || '—'} />
        <LinhaInfo rotulo="CNPJ" valor={neg.cnpj ? mascaraCnpj(neg.cnpj) : '—'} />
        <p className="m-0 px-4 py-2.5 text-xs text-[var(--text-muted)] flex items-start gap-1.5">
          <Wallet size={14} aria-hidden="true" className="shrink-0 mt-0.5" />Conta no Asaas em nome de {neg.razaoSocial} · CNPJ {mascaraCnpj(neg.cnpj)}
        </p>
      </Painel>
      <Painel titulo="Como você recebe hoje" semPadding>
        <LinhaInfo
          rotulo="Forma conectada"
          valor={pagamento?.usaContaSellergy ? 'Conta do Sellergy' : pagamento?.ativo ? nomeProvedor(pagamento.provedor) : 'Nenhuma'}
        />
        <p className="m-0 px-4 py-2.5 text-xs text-[var(--text-muted)]">Dá pra conectar Mercado Pago ou Asaas em <Link to="/app/pagamentos" className="underline">Pagamentos</Link>.</p>
      </Painel>
    </>
  );

  return (
    <Pagina>
      <p className="m-0 text-[13px] text-[var(--text-muted)]">
        {enviada ? 'Onde caem o Pix e o cartão das suas vendas.' : 'Abra em poucos minutos. Não precisa abrir conta em banco nem alugar maquininha.'}
      </p>

      {!enviada && !automaticaDisponivel && (
        <ColunasPagina lateral={<PorQueUsar />}>
          <Painel titulo="A abertura automática de conta está desligada no momento">
            <div className="flex gap-3">
              <Info aria-hidden="true" className="text-[var(--text-muted)] shrink-0" />
              <div className="text-[13px] text-[var(--text-secondary)]">
                <p className="m-0">Enquanto isso, você pode receber Pix e cartão conectando uma conta que já tem no Mercado Pago ou no Asaas. Os pagamentos confirmam sozinhos do mesmo jeito.</p>
                <p className="m-0 mt-2">
                  {pagamento?.ativo ? `Hoje você recebe por: ${nomeProvedor(pagamento.provedor)}.` : 'Hoje nenhuma forma de receber está conectada.'}
                </p>
                <Link to="/app/pagamentos" className="inline-flex items-center gap-2 mt-3 h-10 px-4 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-sm font-semibold">
                  Conectar Mercado Pago ou Asaas <ExternalLink size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </Painel>
        </ColunasPagina>
      )}

      {!enviada && automaticaDisponivel && (
        conta?.abrindo
          ? (
            <ColunasPagina lateral={<PorQueUsar />}>
              <Painel titulo="Abrindo sua conta">
                <p className="m-0 flex items-center gap-2 text-[13px] text-[var(--text-secondary)]"><Loader2 size={16} aria-hidden="true" className="animate-spin" />Estamos abrindo sua conta. Atualize a página em instantes.</p>
              </Painel>
            </ColunasPagina>
          )
          : <Assistente inicial={conta?.dados} sugestoes={estado.sugestoes} erroAnterior={conta?.motivoRecusa ? `O Asaas não aceitou da última vez: ${conta.motivoRecusa}` : null} onAberta={() => { toast.success('Dados enviados para análise.'); carregar(); }} />
      )}

      {conta?.status === 'EM_ANALISE' && (
        <ColunasPagina lateral={lateralEnviada}>
          <Painel
            titulo="Recebemos seus dados"
            subtitulo="Conta em análise no Asaas"
            acoes={<Button variant="secondary" size="sm" icon={RotateCw} loading={atualizando} onClick={atualizarStatus}>Atualizar status</Button>}
          >
            <div className="flex gap-3">
              <Clock aria-hidden="true" className="text-[var(--warning)] shrink-0" />
              <div className="flex-1 min-w-0 text-[13px] text-[var(--text-secondary)]">
                <p className="m-0">O Asaas está analisando a conta de {neg.razaoSocial}. Avisamos aqui e no WhatsApp quando liberar.</p>
                {pagamento?.usaContaSellergy
                  ? <p className="m-0 mt-1">Os pedidos e cobranças já saem por esta conta.</p>
                  : pagamento?.ativo && <p className="m-0 mt-1">Até liberar, você continua recebendo pela conta que já está conectada em Pagamentos.</p>}
                {documentos && documentos.length === 0 && <p className="m-0 mt-3 text-[var(--text-muted)]">Nenhum documento pendente. Agora é só esperar a análise.</p>}
              </div>
            </div>
          </Painel>
          {documentos && documentos.length > 0 && (
            <Painel titulo="Falta enviar" subtitulo="O Asaas pede estes documentos para liberar a conta" semPadding>
              {documentos.map((d, i) => (
                <LinhaInfo key={i} rotulo={`${d.titulo}${d.descricao ? ` — ${d.descricao}` : ''}`}>
                  {d.link && (
                    <a href={d.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[var(--border-strong)] text-xs font-semibold text-[var(--text-main)]">
                      Enviar pelo celular <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  )}
                </LinhaInfo>
              ))}
            </Painel>
          )}
        </ColunasPagina>
      )}

      {conta?.status === 'RECUSADA' && (
        <ColunasPagina lateral={lateralEnviada}>
          <Painel
            titulo="A conta não foi aprovada"
            acoes={<Button variant="secondary" size="sm" icon={RotateCw} loading={atualizando} onClick={atualizarStatus}>Consultar de novo</Button>}
          >
            <div className="flex gap-3">
              <XCircle aria-hidden="true" className="text-[var(--danger)] shrink-0" />
              <div className="text-[13px] text-[var(--text-secondary)]">
                <p className="m-0">{conta.motivoRecusa}</p>
                <p className="m-0 mt-2">Fale com o suporte para revisar os dados. Enquanto isso, dá pra receber conectando o Mercado Pago ou o Asaas em <Link to="/app/pagamentos" className="underline font-semibold">Pagamentos</Link>.</p>
              </div>
            </div>
          </Painel>
        </ColunasPagina>
      )}
    </Pagina>
  );
}
