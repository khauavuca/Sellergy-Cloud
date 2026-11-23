// /app/recebimentos — frente B da fase 2.
// Conta de recebimento do negocio (subconta Asaas aberta pelo Sellergy):
// assistente de 3 passos -> em analise -> ativa (saldo, a liberar, extrato,
// taxas, saque pra chave Pix). A chave da conta fica no servidor.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, Loader2, AlertCircle, CheckCircle2, Clock, RotateCw, ExternalLink, Search, ArrowDownToLine, XCircle, Info,
} from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import Modal from '../components/Modal';
import { Badge, Button, Card, Input, Select, useToast } from '../components/ui';
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

const formVazio = () => ({
  negocio: { cnpj: '', razaoSocial: '', nomeFantasia: '', tipoEmpresa: 'LIMITED', email: '', telefone: '', faturamentoMensal: '', cep: '', endereco: '', numero: '', complemento: '', bairro: '' },
  responsavel: { nome: '', cpf: '', dataNascimento: '', celular: '' },
  repasse: { prazo: 'PADRAO', tipoChavePix: 'CNPJ', chavePix: '' },
});

function Erro({ texto, onTentar }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 p-4 rounded-xl bg-[var(--danger-soft)] text-sm text-[var(--danger-text)]">
      <AlertCircle size={16} /> {texto}
      {onTentar && <Button variant="secondary" icon={RotateCw} className="ml-auto min-h-11" onClick={onTentar}>Tentar de novo</Button>}
    </div>
  );
}

function Kpi({ rotulo, valor, detalhe }) {
  return (
    <Card padding="md">
      <p className="text-xs text-[var(--text-muted)]">{rotulo}</p>
      <p className="text-2xl font-semibold tabular-nums text-[var(--text-main)] mt-1">{valor}</p>
      {detalhe && <p className="text-xs text-[var(--text-muted)] mt-1">{detalhe}</p>}
    </Card>
  );
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
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card padding="lg">
        <ol className="flex flex-wrap gap-2 mb-5" aria-label="Passos">
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
              <Button variant="secondary" icon={Search} className="min-h-11 mb-[1px]" loading={buscandoCnpj} disabled={n.cnpj.replace(/\D/g, '').length !== 14} onClick={buscarCnpj}>Buscar na Receita</Button>
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
                <label key={o.value} className={clsx('flex gap-3 p-3 rounded-xl border cursor-pointer min-h-11', p.prazo === o.value ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)]')}>
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

        <div className="flex flex-wrap justify-between gap-2 mt-6">
          <Button variant="ghost" className="min-h-11" disabled={passo === 0 || enviando} onClick={() => setPasso((x) => x - 1)}>Voltar</Button>
          {passo < 2
            ? <Button className="min-h-11" onClick={() => setPasso((x) => x + 1)}>Continuar</Button>
            : <Button className="min-h-11" loading={enviando} onClick={enviar}>Enviar para análise</Button>}
        </div>
      </Card>

      <Card padding="md" className="self-start">
        <h2 className="text-sm font-semibold text-[var(--text-main)]">Por que usar a conta do Sellergy</h2>
        <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
          {['Pix e cartão na mesma tela da venda', 'Pagamento confirma sozinho e baixa o estoque', 'Link de pagamento no WhatsApp para pedidos', 'Sem maquininha alugada'].map((t) => (
            <li key={t} className="flex gap-2"><CheckCircle2 size={16} className="text-[var(--success)] shrink-0 mt-0.5" />{t}</li>
          ))}
        </ul>
        <p className="text-xs text-[var(--text-muted)] mt-4">A conta é aberta no Asaas, instituição de pagamento autorizada pelo Banco Central. Já tem Mercado Pago ou Asaas? Dá pra continuar usando em <Link to="/app/pagamentos" className="underline">Pagamentos</Link>.</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------
// Conta ativa
// ---------------------------------------------------------------------
function ContaAtiva({ conta, onMudou }) {
  const toast = useToast();
  const [fin, setFin] = useState(null);
  const [erro, setErro] = useState(null);
  const [offset, setOffset] = useState(0);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [saque, setSaque] = useState(null);
  const [enviandoSaque, setEnviandoSaque] = useState(false);
  const [repasse, setRepasse] = useState(null);
  const [salvandoRepasse, setSalvandoRepasse] = useState(false);

  const carregar = useCallback(() => api.get('/conta-recebimento/financeiro')
    .then((r) => { setFin(r.data); setOffset(0); setErro(null); })
    .catch((e) => setErro(erroDaApi(e, 'Não foi possível carregar o saldo.'))), []);

  useEffect(() => {
    carregar();
  }, [carregar]);

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
    const valor = Number(String(saque).replace(/\./g, '').replace(',', '.'));
    if (!(valor >= 1)) { toast.error('Informe um valor a partir de R$ 1,00.'); return; }
    setEnviandoSaque(true);
    try {
      const r = await api.post('/conta-recebimento/saque', { valor });
      toast.success(`Saque de ${fmtBRL(r.data.valor)} pedido. ${r.data.status === 'DONE' ? 'Já caiu.' : 'Cai na sua chave Pix em instantes.'}`);
      setSaque(null);
      carregar();
    } catch (err) {
      toast.error(erroDaApi(err, 'Não foi possível sacar.'));
    } finally {
      setEnviandoSaque(false);
    }
  };

  const salvarRepasse = async (e) => {
    e.preventDefault();
    setSalvandoRepasse(true);
    try {
      await api.put('/conta-recebimento/repasse', repasse);
      toast.success('Repasse atualizado.');
      setRepasse(null);
      onMudou();
    } catch (err) {
      toast.error(erroDaApi(err, 'Não foi possível salvar.'));
    } finally {
      setSalvandoRepasse(false);
    }
  };

  const rep = conta.dados?.repasse || {};
  const tipoChave = TIPOS_CHAVE.find((t) => t.value === rep.tipoChavePix)?.label || rep.tipoChavePix;
  const prazo = PRAZOS.find((o) => o.value === conta.prazoRepasse) || PRAZOS[0];

  if (erro) return <Erro texto={erro} onTentar={carregar} />;
  if (!fin) return <div className="py-16 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Kpi rotulo="Disponível pra sacar" valor={fin.saldo === null ? '—' : fmtBRL(fin.saldo)} detalhe={fin.saldo === null ? 'Não deu pra carregar agora.' : `Saque pra chave ${tipoChave}`} />
        <Kpi rotulo="A liberar (cartão)" valor={fin.aLiberar === null ? '—' : fmtBRL(fin.aLiberar)} detalhe={prazo.titulo} />
        <Card padding="md" className="flex flex-col justify-between gap-3">
          <p className="text-xs text-[var(--text-muted)]">Mandar pro seu banco</p>
          <Button size="lg" icon={ArrowDownToLine} disabled={!fin.saldo || fin.saldo < 1} onClick={() => setSaque(fin.saldo ? String(fin.saldo.toFixed(2)).replace('.', ',') : '')}>Sacar agora</Button>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card padding="none" className="overflow-hidden">
          <h2 className="px-5 pt-4 pb-2 text-base font-semibold text-[var(--text-main)]">Extrato</h2>
          {!fin.extrato ? (
            <p className="px-5 pb-5 text-sm text-[var(--text-muted)]">Não deu pra carregar o extrato agora.</p>
          ) : fin.extrato.itens.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-[var(--text-muted)]">Nenhuma movimentação ainda. Os pagamentos aparecem aqui assim que caem.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--text-muted)]">
                    <th className="px-5 py-2 font-semibold">Quando</th>
                    <th className="px-5 py-2 font-semibold">O quê</th>
                    <th className="px-5 py-2 font-semibold text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {fin.extrato.itens.map((t) => (
                    <tr key={t.id} className="border-t border-[var(--border-subtle)]">
                      <td className="px-5 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">{t.data ? new Date(`${t.data}T12:00:00`).toLocaleDateString('pt-BR') : ''}</td>
                      <td className="px-5 py-2.5 text-[var(--text-main)]">{t.descricao}</td>
                      <td className={clsx('px-5 py-2.5 text-right tabular-nums whitespace-nowrap', t.valor < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--success-text)]')}>{fmtBRL(t.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {fin.extrato?.temMais && (
            <div className="px-5 py-3 border-t border-[var(--border-subtle)]">
              <Button variant="secondary" className="min-h-11" loading={carregandoMais} onClick={maisExtrato}>Carregar mais</Button>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card padding="md">
            <h2 className="text-base font-semibold text-[var(--text-main)]">Suas taxas</h2>
            {!fin.taxas || fin.taxas.linhas.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] mt-2">Não deu pra carregar as taxas agora.</p>
            ) : (
              <ul className="mt-2">
                {fin.taxas.linhas.map((l) => (
                  <li key={l.forma} className="flex justify-between py-2 border-t border-[var(--border-subtle)] first:border-t-0 text-sm">
                    <span className="text-[var(--text-secondary)]">{l.forma}</span>
                    <span className="tabular-nums text-[var(--text-main)]">
                      {[l.percentual !== null ? `${String(l.percentual).replace('.', ',')}%` : null, l.fixo ? fmtBRL(l.fixo) : null].filter(Boolean).join(' + ') || 'Grátis'}
                    </span>
                  </li>
                ))}
                {fin.taxas.saque !== null && (
                  <li className="flex justify-between py-2 border-t border-[var(--border-subtle)] text-sm">
                    <span className="text-[var(--text-secondary)]">Saque por Pix</span>
                    <span className="tabular-nums text-[var(--text-main)]">{fin.taxas.saque ? fmtBRL(fin.taxas.saque) : 'Grátis'}</span>
                  </li>
                )}
              </ul>
            )}
          </Card>

          <Card padding="md">
            <h2 className="text-base font-semibold text-[var(--text-main)]">Repasse</h2>
            <dl className="mt-2 text-sm space-y-1.5">
              <div><dt className="text-xs text-[var(--text-muted)]">Prazo</dt><dd className="text-[var(--text-main)]">{prazo.titulo}</dd></div>
              <div><dt className="text-xs text-[var(--text-muted)]">Chave Pix ({tipoChave})</dt><dd className="text-[var(--text-main)] break-all">{rep.chavePix || '—'}</dd></div>
            </dl>
            <Button variant="secondary" className="min-h-11 mt-3" onClick={() => setRepasse({ prazo: conta.prazoRepasse || 'PADRAO', tipoChavePix: rep.tipoChavePix || 'CNPJ', chavePix: rep.chavePix || '' })}>Alterar</Button>
          </Card>
        </div>
      </div>

      <Modal isOpen={saque !== null} onClose={() => !enviandoSaque && setSaque(null)} title="Sacar para o seu banco" size="sm">
        <form onSubmit={sacar} className="space-y-4">
          <Input label="Valor (R$)" aria-label="Valor do saque em reais" inputMode="decimal" value={saque || ''} onChange={(e) => setSaque(e.target.value)} hint={`Disponível: ${fmtBRL(fin.saldo)}`} />
          <p className="text-sm text-[var(--text-secondary)]">Vai para a chave Pix {tipoChave}: <b className="break-all">{rep.chavePix}</b></p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="min-h-11" onClick={() => setSaque(null)} disabled={enviandoSaque}>Voltar</Button>
            <Button type="submit" className="min-h-11" loading={enviandoSaque}>Confirmar saque</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={repasse !== null} onClose={() => !salvandoRepasse && setRepasse(null)} title="Alterar repasse" size="md">
        {repasse && (
          <form onSubmit={salvarRepasse} className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-[var(--text-main)] mb-2">Prazo</legend>
              {PRAZOS.map((o) => (
                <label key={o.value} className={clsx('flex gap-3 p-3 rounded-xl border cursor-pointer min-h-11', repasse.prazo === o.value ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)]')}>
                  <input type="radio" name="prazo-alt" checked={repasse.prazo === o.value} onChange={() => setRepasse({ ...repasse, prazo: o.value })} className="mt-1" />
                  <span><span className="block text-sm font-semibold text-[var(--text-main)]">{o.titulo}</span><span className="block text-xs text-[var(--text-muted)]">{o.descricao}</span></span>
                </label>
              ))}
            </fieldset>
            <Select label="Tipo da chave Pix" aria-label="Tipo da chave Pix" value={repasse.tipoChavePix} onChange={(e) => setRepasse({ ...repasse, tipoChavePix: e.target.value })} options={TIPOS_CHAVE} placeholder="" />
            <Input label="Chave Pix" aria-label="Chave Pix" value={repasse.chavePix} onChange={(e) => setRepasse({ ...repasse, chavePix: e.target.value })} hint="No nome do mesmo CNPJ da conta." />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" className="min-h-11" onClick={() => setRepasse(null)} disabled={salvandoRepasse}>Voltar</Button>
              <Button type="submit" className="min-h-11" loading={salvandoRepasse}>Salvar</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
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
  if (!estado) return <div className="py-16 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;

  const { conta, pagamento, automaticaDisponivel } = estado;
  const st = conta ? STATUS[conta.status] : null;
  const enviada = conta && conta.status !== 'RASCUNHO';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-[var(--text-muted)]">Financeiro</p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Conta de recebimento</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{enviada ? 'Onde caem o Pix e o cartão das suas vendas.' : 'Abra em poucos minutos. Não precisa abrir conta em banco nem alugar maquininha.'}</p>
        </div>
        {st && enviada && <Badge variant={st.variante} size="lg">{st.rotulo}</Badge>}
      </div>

      {!enviada && !automaticaDisponivel && (
        <Card padding="lg">
          <div className="flex gap-3">
            <Info className="text-[var(--text-muted)] shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-[var(--text-main)]">A abertura automática de conta está desligada no momento</h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Enquanto isso, você pode receber Pix e cartão conectando uma conta que já tem no Mercado Pago ou no Asaas. Os pagamentos confirmam sozinhos do mesmo jeito.</p>
              <p className="text-sm text-[var(--text-secondary)] mt-2">
                {pagamento?.ativo ? `Hoje você recebe por: ${pagamento.provedor === 'MERCADO_PAGO' ? 'Mercado Pago' : pagamento.provedor === 'ASAAS' ? 'Asaas' : 'Pagar.me'}.` : 'Hoje nenhuma forma de receber está conectada.'}
              </p>
              <Link to="/app/pagamentos" className="inline-flex items-center gap-2 mt-4 min-h-11 px-4 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-sm font-semibold">
                Conectar Mercado Pago ou Asaas <ExternalLink size={14} />
              </Link>
            </div>
          </div>
        </Card>
      )}

      {!enviada && automaticaDisponivel && (
        conta?.abrindo
          ? <Card padding="lg"><p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><Loader2 size={16} className="animate-spin" />Estamos abrindo sua conta. Atualize a página em instantes.</p></Card>
          : <Assistente inicial={conta?.dados} sugestoes={estado.sugestoes} erroAnterior={conta?.motivoRecusa ? `O Asaas não aceitou da última vez: ${conta.motivoRecusa}` : null} onAberta={() => { toast.success('Dados enviados para análise.'); carregar(); }} />
      )}

      {conta?.status === 'EM_ANALISE' && (
        <Card padding="lg">
          <div className="flex gap-3">
            <Clock className="text-[var(--warning)] shrink-0" />
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-[var(--text-main)]">Recebemos seus dados</h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1">O Asaas está analisando a conta de {conta.dados?.negocio?.razaoSocial}. Avisamos aqui e no WhatsApp quando liberar.</p>
              {pagamento?.usaContaSellergy
                ? <p className="text-sm text-[var(--text-secondary)] mt-1">Os pedidos e cobranças já saem por esta conta.</p>
                : pagamento?.ativo && <p className="text-sm text-[var(--text-secondary)] mt-1">Até liberar, você continua recebendo pela conta que já está conectada em Pagamentos.</p>}
              {documentos && documentos.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-[var(--text-main)]">Falta enviar</h3>
                  <ul className="mt-2 space-y-2">
                    {documentos.map((d, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="flex-1 min-w-0 text-[var(--text-secondary)]">{d.titulo}{d.descricao ? ` — ${d.descricao}` : ''}</span>
                        {d.link && <a href={d.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-11 px-3 rounded-lg border border-[var(--border-strong)] font-semibold text-[var(--text-main)]">Enviar pelo celular <ExternalLink size={14} /></a>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {documentos && documentos.length === 0 && <p className="text-sm text-[var(--text-muted)] mt-3">Nenhum documento pendente. Agora é só esperar a análise.</p>}
              <Button variant="secondary" icon={RotateCw} className="min-h-11 mt-4" loading={atualizando} onClick={atualizarStatus}>Atualizar status</Button>
            </div>
          </div>
        </Card>
      )}

      {conta?.status === 'RECUSADA' && (
        <Card padding="lg">
          <div className="flex gap-3">
            <XCircle className="text-[var(--danger)] shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-[var(--text-main)]">A conta não foi aprovada</h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1">{conta.motivoRecusa}</p>
              <p className="text-sm text-[var(--text-secondary)] mt-2">Fale com o suporte para revisar os dados. Enquanto isso, dá pra receber conectando o Mercado Pago ou o Asaas em <Link to="/app/pagamentos" className="underline font-semibold">Pagamentos</Link>.</p>
              <Button variant="secondary" icon={RotateCw} className="min-h-11 mt-4" loading={atualizando} onClick={atualizarStatus}>Consultar de novo</Button>
            </div>
          </div>
        </Card>
      )}

      {conta?.status === 'ATIVA' && <ContaAtiva conta={conta} onMudou={carregar} />}

      {enviada && (
        <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><Wallet size={14} />Conta no Asaas em nome de {conta.dados?.negocio?.razaoSocial} · CNPJ {mascaraCnpj(conta.dados?.negocio?.cnpj)}</p>
      )}
    </div>
  );
}
