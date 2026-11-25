// /app/comissoes — comissoes da equipe (frente A da fase 2).
// Fechamento do mes por profissional, regra de cada uma, vale, pagar (com
// saida no financeiro e recibo no WhatsApp). Regra: src/agenda/comissoes.js.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, AlertCircle, Percent, Wallet, Pencil, Undo2, HandCoins } from 'lucide-react';
import api from '../services/api';
import {
  Badge, Button, EmptyState, IconButton, Input, useToast,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo,
} from '../components/ui';
import Modal from '../components/Modal';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import { formatarTelefoneBR } from '../utils/formatTelefone';

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const iniciais = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const num = (v) => Number(String(v ?? '').replace(',', '.'));
const primeiroNome = (n) => String(n || '').split(' ')[0];
const dataCurta = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

function competenciaAtual() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}
function somarMes(comp, delta) {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function nomeCompetencia(comp) {
  const [a, m] = comp.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const SITUACAO = {
  A_PAGAR: { label: 'A pagar', variant: 'warning' },
  PAGA: { label: 'Pago', variant: 'success' },
  SEM_MOVIMENTO: { label: 'Sem atendimento', variant: 'neutral' },
};

const th = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const td = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';

export default function ComissoesPage() {
  const toast = useToast();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [selId, setSelId] = useState(null);
  const [modal, setModal] = useState(null); // 'pagar' | 'vale' | 'regra'

  // Recarregar = mudar a versao (setState so nos callbacks da promessa).
  const [versao, setVersao] = useState(0);
  const carregar = useCallback(() => { setCarregando(true); setVersao((v) => v + 1); }, []);
  const mudarMes = (fn) => { setCarregando(true); setCompetencia(fn); };

  useEffect(() => {
    let vivo = true;
    api.get('/comissoes', { params: { competencia } })
      .then((r) => {
        if (!vivo) return;
        setDados(r.data);
        setErro(null);
        setSelId((atual) => (r.data.pessoas.some((p) => p.id === atual) ? atual : r.data.pessoas.find((p) => p.situacao !== 'SEM_MOVIMENTO')?.id || r.data.pessoas[0]?.id || null));
      })
      .catch((e) => { if (vivo) setErro(e.response?.data?.erro || 'Não foi possível carregar as comissões.'); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [competencia, versao]);

  const desfazer = async (item) => {
    if (!confirm('Desfazer este lançamento?')) return;
    try {
      await api.delete(`/comissoes/${item.id}`);
      toast.success('Desfeito.');
      carregar();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível desfazer.');
    }
  };

  const mesAtual = competenciaAtual();
  const ehMesAtual = competencia === mesAtual;
  const sel = dados?.pessoas.find((p) => p.id === selId) || null;
  const fechar = () => setModal(null);
  const depois = () => { setModal(null); carregar(); };

  // Ultimos 24 meses no seletor (+ o mes escolhido, se for mais antigo).
  const meses = useMemo(() => {
    const lista = Array.from({ length: 24 }, (_, i) => somarMes(mesAtual, -i));
    if (!lista.includes(competencia)) lista.push(competencia);
    return lista;
  }, [mesAtual, competencia]);

  const maiorTotal = useMemo(() => Math.max(0, ...(dados?.pessoas || []).map((p) => p.total)), [dados]);
  const valesDoMes = useMemo(() => (dados?.pessoas || []).flatMap((p) => p.vales.map((v) => ({ ...v, pessoa: p.nome }))), [dados]);
  const totalVales = valesDoMes.reduce((s, v) => s + Math.abs(v.valor), 0);

  useAcaoTopo(
    <Button size="sm" icon={HandCoins} disabled={!sel} onClick={() => setModal('vale')}>Lançar vale</Button>,
    [sel?.id]
  );

  const seletorMes = (
    <div className="flex items-center gap-1">
      <IconButton icon={ChevronLeft} size="sm" variant="secondary" ariaLabel="Mês anterior" onClick={() => mudarMes((c) => somarMes(c, -1))} />
      <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
        Mês
        <select
          value={competencia}
          onChange={(e) => mudarMes(e.target.value)}
          className="h-9 px-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] font-medium text-[var(--text-main)]"
        >
          {meses.map((m) => <option key={m} value={m}>{nomeCompetencia(m)}</option>)}
        </select>
      </label>
      <IconButton icon={ChevronRight} size="sm" variant="secondary" ariaLabel="Próximo mês" disabled={ehMesAtual} onClick={() => mudarMes((c) => somarMes(c, 1))} />
      {!ehMesAtual && <Button variant="ghost" size="sm" onClick={() => mudarMes(mesAtual)}>Mês atual</Button>}
    </div>
  );

  if (carregando && !dados) {
    return <div className="py-16 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;
  }

  if (erro) {
    return (
      <Painel>
        <div role="alert" className="flex items-start gap-3">
          <AlertCircle size={18} className="text-[var(--danger)] mt-0.5" aria-hidden="true" />
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-main)]">{erro}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => carregar()}>Tentar de novo</Button>
              {!ehMesAtual && <Button variant="ghost" size="sm" onClick={() => mudarMes(mesAtual)}>Voltar ao mês atual</Button>}
            </div>
          </div>
        </div>
      </Painel>
    );
  }

  if (dados.pessoas.length === 0) {
    return (
      <Painel titulo="Equipe" acoes={seletorMes}>
        <EmptyState icon={Percent} title="Nenhum profissional cadastrado" description="Cadastre a equipe em Configurações › Equipe. A comissão é calculada sozinha em cada atendimento concluído." />
      </Painel>
    );
  }

  const { totais } = dados;

  const lateral = sel && (
    <>
      <Painel
        titulo={(
          <span className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-full grid place-items-center text-xs font-bold bg-[var(--accent-soft)] text-[var(--accent-text)] flex-shrink-0" aria-hidden="true">{iniciais(sel.nome)}</span>
            <span className="min-w-0">
              <span className="block truncate">{sel.nome}</span>
              <span className="block text-xs font-normal text-[var(--text-muted)] truncate">{sel.regra.texto}</span>
            </span>
          </span>
        )}
        acoes={<Button variant="secondary" size="sm" icon={Pencil} onClick={() => setModal('regra')}>Regra</Button>}
        semPadding
      >
        {sel.linhas.length === 0 && sel.vales.length === 0 && sel.ajustes.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-[var(--text-muted)]">Nenhum atendimento concluído por {primeiroNome(sel.nome)} em {dados.mes}.</p>
        ) : (
          <>
            {sel.linhas.map((l) => (
              <LinhaInfo
                key={l.titulo}
                rotulo={<>{l.quantidade}× {l.titulo}<span className="block text-xs text-[var(--text-muted)]">base {fmtBRL(l.base)}</span></>}
                valor={fmtBRL(l.valor)}
              />
            ))}
            {[...sel.vales, ...sel.ajustes].map((v) => (
              <LinhaInfo
                key={v.id}
                rotulo={<>(−) {v.descricao}<span className="block text-xs text-[var(--text-muted)]">{dataCurta(v.criadoEm)}</span></>}
              >
                {v.status === 'A_PAGAR' && <IconButton icon={Undo2} size="sm" ariaLabel={`Desfazer ${v.descricao}`} onClick={() => desfazer(v)} />}
                <span className="font-semibold tabular-nums text-[var(--danger-text)]">{fmtBRL(v.valor)}</span>
              </LinhaInfo>
            ))}
            <LinhaInfo
              className="bg-[var(--success-soft)]"
              rotulo={<span className="font-bold text-[var(--text-main)]">{sel.aPagar !== 0 ? 'A receber' : 'Total do mês'}</span>}
            >
              <strong className="text-lg tabular-nums text-[var(--success-text)]">{fmtBRL(sel.aPagar !== 0 ? sel.aPagar : sel.total)}</strong>
            </LinhaInfo>
            {sel.pago !== 0 && sel.aPagar !== 0 && <LinhaInfo rotulo="Já pago neste mês" valor={fmtBRL(sel.pago)} />}
          </>
        )}
        <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex flex-col gap-2">
          {sel.situacao === 'PAGA' && (
            <p className="text-[13px] text-[var(--success-text)] bg-[var(--success-soft)] rounded-lg px-3 py-2">Comissão de {dados.mes} paga.</p>
          )}
          {sel.aPagar !== 0 && (
            <Button variant="primary" icon={Wallet} fullWidth onClick={() => setModal('pagar')}>
              {sel.aPagar > 0 ? `Pagar ${fmtBRL(sel.aPagar)} e mandar recibo` : 'Fechar o mês (saldo negativo)'}
            </Button>
          )}
          <Button variant="secondary" fullWidth onClick={() => setModal('vale')}>Lançar vale</Button>
          {sel.aPagar !== 0 && (
            <p className="text-xs text-[var(--text-muted)]">Pode lançar a saída no Financeiro e mandar o recibo no WhatsApp de {primeiroNome(sel.nome)}.</p>
          )}
        </div>
      </Painel>

      <Painel
        titulo="Vales do mês"
        acoes={valesDoMes.length > 0 && <Badge variant="warning" size="sm">{fmtBRL(totalVales)}</Badge>}
        semPadding
      >
        {valesDoMes.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-[var(--text-muted)]">Nenhum vale lançado em {dados.mes}.</p>
        ) : valesDoMes.map((v) => (
          <LinhaInfo
            key={v.id}
            rotulo={<>{v.pessoa}<span className="block text-xs text-[var(--text-muted)]">{dataCurta(v.criadoEm)} · {v.descricao}</span></>}
            valor={fmtBRL(Math.abs(v.valor))}
          />
        ))}
      </Painel>

      <Painel titulo="Como é calculado" semPadding>
        <LinhaInfo rotulo="A regra de cada pessoa fica no botão Regra. Mudar a regra não recalcula o que já foi lançado." />
        <LinhaInfo rotulo="A comissão de produto entra sozinha quando a venda no caixa informa quem vendeu (campo “Quem vendeu” em Vendas, ou a própria profissional logada)." />
      </Painel>
    </>
  );

  return (
    <Pagina>
      <FaixaNumeros min={200}>
        <Numero
          rotulo="Total de comissões"
          valor={fmtBRL(totais.total)}
          detalhe={totais.pctDoFaturamento != null ? `${String(totais.pctDoFaturamento).replace('.', ',')}% do faturamento de serviços` : 'Sem atendimentos concluídos'}
          carregando={carregando}
        />
        <Numero
          rotulo={ehMesAtual ? 'Já pago neste mês' : `Já pago em ${dados.mes}`}
          valor={fmtBRL(totais.pago)}
          tom="sucesso"
          detalhe={`${totais.pessoasPagas} de ${totais.pessoasComMovimento} pessoa(s)`}
          carregando={carregando}
        />
        <Numero
          rotulo="Falta pagar"
          valor={fmtBRL(totais.aPagar)}
          destaque
          detalhe="Calculado sozinho em cada atendimento concluído"
          carregando={carregando}
        />
      </FaixaNumeros>

      <ColunasPagina lateral={lateral}>
        <Painel titulo="Equipe" subtitulo={`Comissões de ${dados.mes}`} acoes={seletorMes} semPadding>
          <ul aria-busy={carregando}>
            {dados.pessoas.map((p) => {
              const ativa = p.id === selId;
              const pct = maiorTotal > 0 ? Math.max(0, Math.round((p.total / maiorTotal) * 100)) : 0;
              return (
                <li key={p.id}>
                  <button
                    type="button" aria-pressed={ativa} onClick={() => setSelId(p.id)}
                    className={`w-full flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left border-b border-[var(--border-subtle)] border-l-[3px] ${ativa ? 'bg-[var(--success-soft)] border-l-[var(--primary)]' : 'border-l-transparent hover:bg-[var(--bg-subtle)]'}`}
                  >
                    <span className="w-9 h-9 rounded-full grid place-items-center text-xs font-bold bg-[var(--accent-soft)] text-[var(--accent-text)] flex-shrink-0" aria-hidden="true">{iniciais(p.nome)}</span>
                    <span className="flex-1 min-w-[160px]">
                      <span className="block text-[13px] font-semibold text-[var(--text-main)] truncate">{p.nome}</span>
                      <span className="block text-xs text-[var(--text-muted)] truncate">{p.regra.texto}</span>
                      <span className="block h-1.5 rounded-full bg-[var(--bg-subtle)] mt-1.5" aria-hidden="true">
                        <span className="block h-1.5 rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span className="text-right w-[110px]">
                      <span className="block text-xs text-[var(--text-muted)]">{p.atendimentos} atendimento{p.atendimentos === 1 ? '' : 's'}</span>
                      <span className="block text-[15px] font-bold tabular-nums text-[var(--text-main)]">{fmtBRL(p.total)}</span>
                    </span>
                    <Badge variant={SITUACAO[p.situacao].variant} size="sm">{SITUACAO[p.situacao].label}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="px-4 py-2.5 text-xs text-[var(--text-muted)]">
            A base é o preço cheio do serviço (o sinal não diminui a comissão). Atendimento de pacote conta o valor de uma sessão.
          </p>
        </Painel>

        {sel && <TabelaLancamentos pessoa={sel} competencia={competencia} versao={versao} />}
      </ColunasPagina>

      {sel && modal === 'pagar' && <ModalPagar pessoa={sel} competencia={competencia} mes={dados.mes} onClose={fechar} onPago={depois} />}
      {sel && modal === 'vale' && <ModalVale pessoa={sel} competencia={competencia} onClose={fechar} onSalvo={depois} />}
      {sel && modal === 'regra' && <ModalRegra pessoa={sel} onClose={fechar} onSalvo={depois} />}
    </Pagina>
  );
}


function ModalPagar({ pessoa, competencia, mes, onClose, onPago }) {
  const toast = useToast();
  const [lancar, setLancar] = useState(true);
  const [recibo, setRecibo] = useState(true);
  const [telefone, setTelefone] = useState(pessoa.telefone ? formatarTelefoneBR(pessoa.telefone) : '');
  const [metodo, setMetodo] = useState('PIX');
  const [salvando, setSalvando] = useState(false);

  const pagar = async (e) => {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    try {
      const r = await api.post('/comissoes/pagar', {
        especialistaId: pessoa.id, competencia, lancarFinanceiro: lancar, enviarRecibo: recibo,
        telefone: recibo && telefone ? telefone : undefined, metodoPagamento: metodo,
      });
      const partes = [r.data.saldoLevado ? `Mês de ${mes} fechado.` : `Comissão de ${fmtBRL(r.data.total)} paga.`];
      if (r.data.saldoLevado) partes.push(r.data.saldoLevado.mensagem);
      if (r.data.lancamentoId) partes.push('Saída lançada no financeiro.');
      if (r.data.recibo?.enviado) partes.push(`Recibo enviado pro WhatsApp de ${pessoa.nome.split(' ')[0]}.`);
      if (r.data.recibo && !r.data.recibo.enviado) partes.push(r.data.recibo.motivo);
      toast.success(partes.join(' '));
      onPago();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível pagar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Pagar ${pessoa.nome.split(' ')[0]}`} description={`${fmtBRL(pessoa.aPagar)} de ${mes}`}>
      <form onSubmit={pagar} className="space-y-4">
        {pessoa.aPagar < 0 && (
          <p role="note" className="m-0 p-3 rounded-xl bg-[var(--warning-soft)] text-[var(--warning-text)] text-xs leading-relaxed">
            Os vales passaram a comissão em {fmtBRL(Math.abs(pessoa.aPagar))}. Ao confirmar, nada é pago agora e esse valor fica para descontar no mês seguinte.
          </p>
        )}
        <fieldset>
          <legend className="text-sm font-medium text-[var(--text-secondary)] mb-2">Pago como</legend>
          <div className="flex flex-wrap gap-2">
            {[['PIX', 'Pix'], ['DINHEIRO', 'Dinheiro'], ['TRANSFERENCIA', 'Transferência']].map(([v, l]) => (
              <button key={v} type="button" aria-pressed={metodo === v} onClick={() => setMetodo(v)} className={`min-h-[44px] px-4 rounded-full border text-sm font-medium ${metodo === v ? 'bg-[var(--primary)] text-[var(--text-on-primary)] border-[var(--primary)]' : 'border-[var(--border-strong)] text-[var(--text-secondary)]'}`}>{l}</button>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
          <input type="checkbox" checked={lancar} onChange={(e) => setLancar(e.target.checked)} className="mt-1 w-5 h-5" />
          <span className="text-sm text-[var(--text-main)]">Lançar a saída no financeiro<span className="block text-xs text-[var(--text-muted)]">Despesa paga hoje, “Comissão {pessoa.nome}”.</span></span>
        </label>
        <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
          <input type="checkbox" checked={recibo} onChange={(e) => setRecibo(e.target.checked)} className="mt-1 w-5 h-5" />
          <span className="text-sm text-[var(--text-main)]">Mandar o recibo no WhatsApp dela<span className="block text-xs text-[var(--text-muted)]">Com o detalhe de cada serviço e dos vales.</span></span>
        </label>
        {recibo && (
          <Input label="WhatsApp da profissional" inputMode="tel" maxLength={15} placeholder="(11) 98888-7777" value={telefone} onChange={(e) => setTelefone(formatarTelefoneBR(e.target.value))} hint={pessoa.telefone ? 'Do cadastro da equipe.' : 'Não está no cadastro: informe aqui.'} />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" className="min-h-[44px]" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" className="min-h-[44px]" loading={salvando}>Confirmar pagamento</Button>
        </div>
      </form>
    </Modal>
  );
}

function ModalVale({ pessoa, competencia, onClose, onSalvo }) {
  const toast = useToast();
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroValor, setErroValor] = useState(null);

  const salvar = async (e) => {
    e.preventDefault();
    if (!(num(valor) > 0)) { setErroValor('Informe um valor maior que zero'); return; }
    setSalvando(true);
    try {
      await api.post('/comissoes/vale', { especialistaId: pessoa.id, valor: num(valor), descricao: descricao || undefined, competencia });
      toast.success(`Vale de ${fmtBRL(num(valor))} lançado pra ${pessoa.nome.split(' ')[0]}.`);
      onSalvo();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível lançar o vale.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Lançar vale" description={`Adiantamento pra ${pessoa.nome}. Desconta da comissão do mês.`}>
      <form onSubmit={salvar} className="space-y-4">
        <Input label="Valor (R$)" inputMode="decimal" value={valor} onChange={(e) => { setValor(e.target.value); setErroValor(null); }} error={erroValor} required />
        <Input label="Descrição (opcional)" placeholder="Ex.: Vale adiantado" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={120} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" className="min-h-[44px]" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" className="min-h-[44px]" loading={salvando}>Lançar vale</Button>
        </div>
      </form>
    </Modal>
  );
}

function ModalRegra({ pessoa, onClose, onSalvo }) {
  const toast = useToast();
  const r = pessoa.regra;
  const [form, setForm] = useState({
    comissaoServicoPct: r.comissaoServicoPct ?? '', comissaoProdutoPct: r.comissaoProdutoPct ?? '', comissaoFixa: r.comissaoFixa ?? '',
  });
  const [erros, setErros] = useState([]);
  const [salvando, setSalvando] = useState(false);

  const salvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    setErros([]);
    const corpo = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : num(v)]));
    try {
      await api.put(`/especialistas/${pessoa.id}`, corpo);
      toast.success('Regra salva. Vale para os próximos atendimentos concluídos.');
      onSalvo();
    } catch (err) {
      setErros(err.response?.data?.campos || []);
      toast.error(err.response?.data?.erro || 'Não foi possível salvar a regra.');
    } finally {
      setSalvando(false);
    }
  };
  const erro = (c) => (erros.includes(c) ? 'Confira este campo' : undefined);

  return (
    <Modal isOpen onClose={onClose} title={`Regra de comissão: ${pessoa.nome}`} description="Use um ou mais. Vazio = não conta.">
      <form onSubmit={salvar} className="space-y-4">
        <Input label="% dos serviços que ela atende" inputMode="decimal" value={form.comissaoServicoPct} onChange={(e) => setForm({ ...form, comissaoServicoPct: e.target.value })} error={erro('comissaoServicoPct')} />
        <Input label="Valor fixo por atendimento (R$)" inputMode="decimal" value={form.comissaoFixa} onChange={(e) => setForm({ ...form, comissaoFixa: e.target.value })} error={erro('comissaoFixa')} />
        <Input label="% dos produtos que ela vende" inputMode="decimal" value={form.comissaoProdutoPct} onChange={(e) => setForm({ ...form, comissaoProdutoPct: e.target.value })} error={erro('comissaoProdutoPct')} hint="Vale para vendas no caixa em que ela aparece como quem vendeu." />
        <p className="text-xs text-[var(--text-muted)]">Mudar a regra não recalcula o que já foi lançado.</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" className="min-h-[44px]" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" className="min-h-[44px]" loading={salvando}>Salvar regra</Button>
        </div>
      </form>
    </Modal>
  );
}


const TIPO = { ATENDIMENTO: 'Atendimento', PRODUTO: 'Produto', VALE: 'Vale', AJUSTE: 'Estorno' };
const STATUS_ITEM = { A_PAGAR: { l: 'A pagar', v: 'warning' }, PAGA: { l: 'Pago', v: 'success' }, CANCELADA: { l: 'Cancelada', v: 'neutral' } };

// Cada lançamento da pessoa escolhida no mês (atendimentos, produtos, vales e estornos).
function TabelaLancamentos({ pessoa, competencia, versao }) {
  const chave = `${pessoa.id}|${competencia}|${versao}`;
  const [resultado, setResultado] = useState({ chave: null, itens: null, erro: null });

  useEffect(() => {
    let vivo = true;
    api.get(`/comissoes/${pessoa.id}/detalhe`, { params: { competencia } })
      .then((r) => { if (vivo) setResultado({ chave, itens: r.data, erro: null }); })
      .catch((e) => { if (vivo) setResultado({ chave, itens: null, erro: e.response?.data?.erro || 'Não foi possível carregar.' }); });
    return () => { vivo = false; };
  }, [chave, pessoa.id, competencia]);

  const pronto = resultado.chave === chave;
  const { itens, erro } = pronto ? resultado : { itens: null, erro: null };

  return (
    <Painel
      titulo={`Atendimentos de ${primeiroNome(pessoa.nome)} no mês`}
      acoes={<span className="text-xs text-[var(--text-muted)]">{pessoa.atendimentos} atendimento{pessoa.atendimentos === 1 ? '' : 's'}</span>}
      semPadding
    >
      {erro ? (
        <p role="alert" className="px-4 py-3 text-[13px] text-[var(--danger-text)]">{erro}</p>
      ) : !itens ? (
        <div className="py-8 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>
      ) : itens.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-[var(--text-muted)]">Nada lançado neste mês.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={th}>Data</th>
                <th className={th}>Cliente</th>
                <th className={th}>Serviço ou produto</th>
                <th className={`${th} text-right`}>Base</th>
                <th className={`${th} text-right`}>Comissão</th>
                <th className={th}>Situação</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id}>
                  <td className={`${td} whitespace-nowrap text-[var(--text-secondary)]`}>{dataCurta(i.atendimento?.data || i.criadoEm)}</td>
                  <td className={`${td} text-[var(--text-main)]`}>{i.atendimento?.cliente || '—'}</td>
                  <td className={`${td} text-[var(--text-main)]`}>
                    {i.tipo === 'ATENDIMENTO' ? i.descricao : `${TIPO[i.tipo]}: ${i.descricao}`}
                  </td>
                  <td className={`${td} text-right tabular-nums whitespace-nowrap text-[var(--text-secondary)]`}>{i.base ? fmtBRL(i.base) : '—'}</td>
                  <td className={`${td} text-right tabular-nums whitespace-nowrap font-semibold ${i.status === 'CANCELADA' ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-main)]'}`}>{fmtBRL(i.valor)}</td>
                  <td className={td}><Badge variant={STATUS_ITEM[i.status]?.v} size="sm">{STATUS_ITEM[i.status]?.l}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Painel>
  );
}
