// /app/comissoes — comissoes da equipe (frente A da fase 2).
// Fechamento do mes por profissional, regra de cada uma, vale, pagar (com
// saida no financeiro e recibo no WhatsApp). Regra: src/agenda/comissoes.js.
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, AlertCircle, Percent, Wallet, Settings2, ListChecks, Undo2, Clock } from 'lucide-react';
import api from '../services/api';
import { Badge, Button, Card, EmptyState, IconButton, Input, KpiCard, useToast } from '../components/ui';
import Modal from '../components/Modal';
import { formatarTelefoneBR } from '../utils/formatTelefone';

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const iniciais = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const num = (v) => Number(String(v ?? '').replace(',', '.'));

function competenciaAtual() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}
function somarMes(comp, delta) {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const SITUACAO = {
  A_PAGAR: { label: 'A pagar', variant: 'warning' },
  PAGA: { label: 'Pago', variant: 'success' },
  SEM_MOVIMENTO: { label: 'Sem atendimento', variant: 'neutral' },
};

export default function ComissoesPage() {
  const toast = useToast();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [selId, setSelId] = useState(null);
  const [modal, setModal] = useState(null); // 'pagar' | 'vale' | 'regra' | 'detalhe'

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

  const ehMesAtual = competencia === competenciaAtual();
  const sel = dados?.pessoas.find((p) => p.id === selId) || null;
  const fechar = () => setModal(null);
  const depois = () => { setModal(null); carregar(); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton icon={ChevronLeft} variant="secondary" ariaLabel="Mês anterior" className="min-h-[44px] min-w-[44px]" onClick={() => mudarMes((c) => somarMes(c, -1))} />
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text-main)] px-1">Comissões de {dados?.mes || '…'}</h1>
        <IconButton icon={ChevronRight} variant="secondary" ariaLabel="Próximo mês" className="min-h-[44px] min-w-[44px]" disabled={ehMesAtual} onClick={() => mudarMes((c) => somarMes(c, 1))} />
        {!ehMesAtual && <Button variant="ghost" className="min-h-[44px]" onClick={() => mudarMes(competenciaAtual())}>Mês atual</Button>}
      </div>

      {carregando && !dados ? (
        <div className="py-16 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>
      ) : erro ? (
        <Card padding="lg">
          <div role="alert" className="flex items-start gap-3">
            <AlertCircle size={18} className="text-[var(--danger)] mt-0.5" />
            <div className="space-y-3">
              <p className="text-sm text-[var(--text-main)]">{erro}</p>
              <Button variant="secondary" onClick={() => carregar()}>Tentar de novo</Button>
            </div>
          </div>
        </Card>
      ) : dados.pessoas.length === 0 ? (
        <Card padding="lg">
          <EmptyState icon={Percent} title="Nenhum profissional cadastrado" description="Cadastre a equipe em Configurações › Equipe. A comissão é calculada sozinha em cada atendimento concluído." />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard icon={Percent} label="Total de comissões" valor={fmtBRL(dados.totais.total)} subvalor={dados.totais.pctDoFaturamento != null ? `${String(dados.totais.pctDoFaturamento).replace('.', ',')}% do faturamento de serviços` : 'Sem atendimentos concluídos'} />
            <KpiCard icon={Wallet} label="Já pago" color="success" valor={fmtBRL(dados.totais.pago)} subvalor={`${dados.totais.pessoasPagas} de ${dados.totais.pessoasComMovimento} pessoa(s)`} />
            <KpiCard icon={Clock} label="Falta pagar" color="warning" valor={fmtBRL(dados.totais.aPagar)} />
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Card padding="none">
              <div className="px-5 py-3 text-xs text-[var(--text-muted)] border-b border-[var(--border-main)]">Calculado sozinho em cada atendimento concluído</div>
              <ul>
                {dados.pessoas.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button" aria-pressed={p.id === selId} onClick={() => setSelId(p.id)}
                      className={`w-full flex items-center gap-3 px-5 py-3 text-left border-t border-[var(--border-main)] first:border-t-0 min-h-[56px] ${p.id === selId ? 'bg-[var(--bg-subtle)]' : 'hover:bg-[var(--bg-subtle)]'}`}
                    >
                      <span className="w-9 h-9 rounded-full grid place-items-center text-xs font-bold bg-[var(--accent-soft)] text-[var(--accent-text)] flex-shrink-0">{iniciais(p.nome)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-[var(--text-main)] truncate">{p.nome}</span>
                        <span className="block text-xs text-[var(--text-muted)] truncate">{p.regra.texto}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold tabular-nums text-[var(--text-main)]">{fmtBRL(p.total)}</span>
                        <Badge variant={SITUACAO[p.situacao].variant} size="sm">{SITUACAO[p.situacao].label}</Badge>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>

            {sel && (
              <Card padding="lg">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="w-10 h-10 rounded-full grid place-items-center text-sm font-bold bg-[var(--accent-soft)] text-[var(--accent-text)]">{iniciais(sel.nome)}</span>
                    <div className="flex-1">
                      <h2 className="text-base font-semibold text-[var(--text-main)]">{sel.nome}</h2>
                      <p className="text-xs text-[var(--text-muted)]">{sel.regra.texto}</p>
                    </div>
                    <Button variant="ghost" size="sm" icon={Settings2} className="min-h-[44px]" onClick={() => setModal('regra')}>Regra</Button>
                  </div>

                  {sel.linhas.length === 0 && sel.vales.length === 0 && sel.ajustes.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">Nenhum atendimento concluído por {sel.nome.split(' ')[0]} neste mês.</p>
                  ) : (
                    <div className="text-sm">
                      {sel.linhas.map((l) => (
                        <div key={l.titulo} className="flex items-center gap-3 py-2 border-b border-[var(--border-main)]">
                          <span className="flex-1 text-[var(--text-main)]">{l.quantidade}× {l.titulo}</span>
                          <span className="text-[var(--text-muted)] tabular-nums">{fmtBRL(l.base)}</span>
                          <strong className="w-24 text-right tabular-nums">{fmtBRL(l.valor)}</strong>
                        </div>
                      ))}
                      {[...sel.vales, ...sel.ajustes].map((v) => (
                        <div key={v.id} className="flex items-center gap-3 py-2 border-b border-[var(--border-main)] text-[var(--text-secondary)]">
                          <span className="flex-1">(−) {v.descricao}</span>
                          {v.status === 'A_PAGAR' && <IconButton icon={Undo2} ariaLabel={`Desfazer ${v.descricao}`} className="min-h-[44px] min-w-[44px]" onClick={() => desfazer(v)} />}
                          <strong className="w-24 text-right tabular-nums">{fmtBRL(v.valor)}</strong>
                        </div>
                      ))}
                      <div className="flex items-center gap-3 pt-3">
                        <span className="flex-1 font-semibold text-[var(--text-main)]">{sel.aPagar !== 0 ? 'A receber' : 'Total do mês'}</span>
                        <strong className="text-lg tabular-nums text-[var(--text-main)]">{fmtBRL(sel.aPagar !== 0 ? sel.aPagar : sel.total)}</strong>
                      </div>
                      {sel.pago !== 0 && sel.aPagar !== 0 && <p className="text-xs text-[var(--text-muted)] mt-1">Já pago neste mês: {fmtBRL(sel.pago)}</p>}
                    </div>
                  )}

                  {sel.situacao === 'PAGA' && (
                    <p className="text-sm text-[var(--success-text)] bg-[var(--success-soft)] rounded-xl p-3">Comissão de {dados.mes} paga.</p>
                  )}

                  <div className="grid gap-2">
                    {sel.aPagar !== 0 && (
                      <Button variant="primary" icon={Wallet} className="min-h-[44px]" fullWidth onClick={() => setModal('pagar')}>
                        {sel.aPagar > 0 ? `Pagar ${fmtBRL(sel.aPagar)} e mandar recibo` : 'Fechar o mês (saldo negativo)'}
                      </Button>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" className="min-h-[44px]" onClick={() => setModal('vale')}>Lançar vale</Button>
                      <Button variant="secondary" icon={ListChecks} className="min-h-[44px]" onClick={() => setModal('detalhe')}>Cada atendimento</Button>
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            A regra de cada pessoa fica no botão “Regra”. A base é o preço cheio do serviço (o sinal não diminui a comissão); atendimento de pacote conta o valor de uma sessão.
            A comissão de produto entra sozinha quando a venda no caixa informa quem vendeu (campo "Quem vendeu" em Vendas, ou a própria profissional logada).
          </p>
        </>
      )}

      {sel && modal === 'pagar' && <ModalPagar pessoa={sel} competencia={competencia} mes={dados.mes} onClose={fechar} onPago={depois} />}
      {sel && modal === 'vale' && <ModalVale pessoa={sel} competencia={competencia} onClose={fechar} onSalvo={depois} />}
      {sel && modal === 'regra' && <ModalRegra pessoa={sel} onClose={fechar} onSalvo={depois} />}
      {sel && modal === 'detalhe' && <ModalDetalhe pessoa={sel} competencia={competencia} onClose={fechar} />}
    </div>
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
    setSalvando(true);
    try {
      const r = await api.post('/comissoes/pagar', {
        especialistaId: pessoa.id, competencia, lancarFinanceiro: lancar, enviarRecibo: recibo,
        telefone: recibo && telefone ? telefone : undefined, metodoPagamento: metodo,
      });
      const partes = [`Comissão de ${fmtBRL(r.data.total)} paga.`];
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

function ModalDetalhe({ pessoa, competencia, onClose }) {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState(null);
  useEffect(() => {
    api.get(`/comissoes/${pessoa.id}/detalhe`, { params: { competencia } })
      .then((r) => setItens(r.data))
      .catch((e) => setErro(e.response?.data?.erro || 'Não foi possível carregar.'));
  }, [pessoa.id, competencia]);

  return (
    <Modal isOpen onClose={onClose} title={`Lançamentos de ${pessoa.nome}`} size="lg">
      {erro ? <p role="alert" className="text-sm text-[var(--danger-text)]">{erro}</p>
        : !itens ? <div className="py-8 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>
          : itens.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Nada lançado neste mês.</p>
            : (
              <ul className="divide-y divide-[var(--border-main)] text-sm">
                {itens.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="flex-1 min-w-[160px]">
                      <span className="block text-[var(--text-main)]">{TIPO[i.tipo]}: {i.descricao}</span>
                      <span className="block text-xs text-[var(--text-muted)]">
                        {i.atendimento ? `${i.atendimento.cliente} · ${new Date(i.atendimento.data).toLocaleDateString('pt-BR')}` : new Date(i.criadoEm).toLocaleDateString('pt-BR')}
                        {i.base ? ` · base ${fmtBRL(i.base)}` : ''}
                      </span>
                    </span>
                    <Badge variant={STATUS_ITEM[i.status]?.v} size="sm">{STATUS_ITEM[i.status]?.l}</Badge>
                    <strong className={`w-24 text-right tabular-nums ${i.status === 'CANCELADA' ? 'line-through text-[var(--text-muted)]' : ''}`}>{fmtBRL(i.valor)}</strong>
                  </li>
                ))}
              </ul>
            )}
    </Modal>
  );
}
