// /admin/uso — quanto cada cliente usa, custa e paga (frente D da fase 2).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calculator, FileText, MessageCircle, Plus, RefreshCw, Trash2, TrendingUp, Wallet } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { Badge, Button, EmptyState, Input, KpiCard, Select, useToast } from '../components/ui';
import { brl } from '../components/conta/rotulosAssinatura';
import { Carregando, ErroCarregar, SemPermissao } from '../components/suporte/EstadosAdmin';
import { erroDaApi, usePapelAdmin } from '../components/suporte/papelAdmin';
import ChaveIAPlataforma from '../components/admin/ChaveIAPlataforma';

const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function opcoesDeMes() {
  const agora = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const valor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { value: valor, label: `${NOME_MES[d.getMonth()]} de ${d.getFullYear()}${i === 0 ? ' (atual)' : ''}` };
  });
}

const pct = (v) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const num = (v) => Number(v || 0).toLocaleString('pt-BR');
const NOME_LIMITE = { lembretesMes: 'lembretes no mês', notasMes: 'notas fiscais no mês', usuarios: 'usuários' };

function BadgeMargem({ linha }) {
  if (linha.paga <= 0) return <span className="text-[var(--text-muted)]">—</span>;
  const variante = linha.prejuizo ? 'danger' : linha.margemPct < 50 ? 'warning' : 'success';
  return <Badge variant={variante} size="sm">{pct(linha.margemPct)}</Badge>;
}

function textoPaga(linha) {
  if (linha.paga > 0) return brl(linha.paga);
  if (linha.statusAssinatura === 'TRIAL') return 'teste';
  return '—';
}

// ---------------------------------------------------------------------
// Painel de custos
// ---------------------------------------------------------------------
function PainelCustos({ custos, podeEditar, onSalvou }) {
  const toast = useToast();
  // O pai troca a `key` quando os custos salvos mudam: o formulario renasce.
  const [form, setForm] = useState(() => ({
    mensagemOficial: String(custos.mensagemOficial ?? 0),
    mensagemQr: String(custos.mensagemQr ?? 0),
    nota: String(custos.nota ?? 0),
    fixos: (custos.fixos || []).map((f) => ({ nome: f.nome, valor: String(f.valor) })),
  }));
  const [salvando, setSalvando] = useState(false);
  const [campos, setCampos] = useState([]);

  const numero = (v) => Number(String(v).replace(',', '.'));

  const salvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const corpo = {
        mensagemOficial: numero(form.mensagemOficial),
        mensagemQr: numero(form.mensagemQr),
        nota: numero(form.nota),
        fixos: form.fixos.map((f) => ({ nome: f.nome.trim(), valor: numero(f.valor) })),
      };
      const r = await api.put('/admin/uso/custos', corpo);
      toast.success('Custos salvos.');
      setCampos([]);
      onSalvou(r.data);
    } catch (err) {
      setCampos(err.response?.data?.campos || []);
      toast.error(erroDaApi(err, 'Não foi possível salvar os custos.'));
    } finally {
      setSalvando(false);
    }
  };

  const mudarFixo = (i, campo, valor) => setForm((f) => ({ ...f, fixos: f.fixos.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)) }));

  if (!podeEditar) {
    return (
      <div className="space-y-3 text-sm">
        <dl className="space-y-2">
          {[['Mensagem pelo canal oficial', custos.mensagemOficial], ['Mensagem pelo QR Code', custos.mensagemQr], ['Nota fiscal emitida', custos.nota]].map(([t, v]) => (
            <div key={t} className="flex justify-between gap-3">
              <dt className="text-[var(--text-secondary)]">{t}</dt>
              <dd className="tabular-nums font-medium text-[var(--text-main)]">{brl(v)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] pt-2">Custos fixos por mês</p>
        {custos.fixos.length === 0 ? (
          <p className="text-[var(--text-muted)]">Nenhum custo fixo cadastrado.</p>
        ) : (
          <ul className="space-y-1.5">
            {custos.fixos.map((f) => (
              <li key={f.nome} className="flex justify-between gap-3"><span className="text-[var(--text-secondary)]">{f.nome}</span><span className="tabular-nums font-medium">{brl(f.valor)}</span></li>
            ))}
          </ul>
        )}
        <p className="text-xs text-[var(--text-muted)]">Só o dono da conta Sellergy edita os custos.</p>
      </div>
    );
  }

  return (
    <form onSubmit={salvar} className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">Preço por unidade, em reais. Use ponto ou vírgula para os centavos.</p>
      <Input label="Mensagem pelo canal oficial (Meta)" aria-label="Custo por mensagem pelo canal oficial" inputMode="decimal"
        value={form.mensagemOficial} error={campos.includes('mensagemOficial') ? 'Valor inválido' : undefined}
        onChange={(e) => setForm({ ...form, mensagemOficial: e.target.value })} />
      <Input label="Mensagem pelo QR Code" aria-label="Custo por mensagem pelo QR Code" inputMode="decimal"
        value={form.mensagemQr} error={campos.includes('mensagemQr') ? 'Valor inválido' : undefined}
        onChange={(e) => setForm({ ...form, mensagemQr: e.target.value })} />
      <Input label="Nota fiscal emitida" aria-label="Custo por nota fiscal" inputMode="decimal"
        value={form.nota} error={campos.includes('nota') ? 'Valor inválido' : undefined}
        onChange={(e) => setForm({ ...form, nota: e.target.value })} />

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Custos fixos por mês</p>
        {form.fixos.length === 0 && <p className="text-sm text-[var(--text-muted)]">Nenhum ainda. Ex.: servidor, domínio, e-mail.</p>}
        {form.fixos.map((f, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <Input aria-label={`Nome do custo fixo ${i + 1}`} placeholder="Nome" value={f.nome}
                error={campos.includes(`fixos.${i}.nome`) ? 'Dê um nome' : undefined}
                onChange={(e) => mudarFixo(i, 'nome', e.target.value)} />
            </div>
            <div className="w-28">
              <Input aria-label={`Valor mensal do custo fixo ${i + 1}`} placeholder="0,00" inputMode="decimal" value={f.valor}
                error={campos.includes(`fixos.${i}.valor`) ? 'Inválido' : undefined}
                onChange={(e) => mudarFixo(i, 'valor', e.target.value)} />
            </div>
            <button
              type="button"
              aria-label={`Remover custo fixo ${f.nome || i + 1}`}
              onClick={() => setForm((x) => ({ ...x, fixos: x.fixos.filter((_, j) => j !== i) }))}
              className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
        <Button type="button" variant="ghost" className="min-h-11" icon={Plus} disabled={form.fixos.length >= 30}
          onClick={() => setForm((x) => ({ ...x, fixos: [...x.fixos, { nome: '', valor: '' }] }))}>
          Adicionar custo fixo
        </Button>
      </div>
      <Button type="submit" className="min-h-11" fullWidth loading={salvando}>Salvar custos</Button>
    </form>
  );
}

// ---------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------
export default function AdminUsoPage() {
  const { pode } = usePapelAdmin();
  const meses = useMemo(() => opcoesDeMes(), []);
  const [mes, setMes] = useState(meses[0].value);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [semAcesso, setSemAcesso] = useState(false);

  // O estado ja nasce carregando; quem troca o mes ou clica Atualizar liga antes.
  const carregar = useCallback(() => api.get('/admin/uso', { params: { mes } })
      .then((r) => { setDados(r.data); setErro(''); })
      .catch((e) => {
        if (e.response?.status === 403) setSemAcesso(true);
        setErro(erroDaApi(e, 'Não foi possível calcular o uso.'));
      })
      .finally(() => setCarregando(false)), [mes]);

  useEffect(() => { carregar(); }, [carregar]);

  if (semAcesso) return <SemPermissao />;

  const totais = dados?.totais;
  const custos = dados?.custos;
  const custosZerados = custos && !custos.mensagemOficial && !custos.mensagemQr && !custos.nota && !(custos.fixos || []).length;
  const linhas = dados?.linhas || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Uso e custos</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Quanto cada cliente usa, quanto custa e quanto paga.</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="w-60">
            <Select label="Mês" aria-label="Mês do relatório" placeholder="" options={meses} value={mes} onChange={(e) => { setCarregando(true); setMes(e.target.value); }} />
          </div>
          <Button variant="secondary" className="min-h-11" icon={RefreshCw} loading={carregando} onClick={() => { setCarregando(true); carregar(); }}>Atualizar</Button>
        </div>
      </div>

      {erro && <ErroCarregar texto={erro} onTentar={() => { setCarregando(true); carregar(); }} />}

      {custosZerados && (
        <div role="status" className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-[var(--warning-soft)] text-sm text-[var(--warning-text)]">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          Os custos estão todos zerados. Preencha os custos para ver a margem real.
        </div>
      )}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Wallet} color="success" label="Receita do mês" carregando={!totais} valor={totais ? brl(totais.receita) : null}
          subvalor={totais ? 'assinaturas ativas e atrasadas' : null} info="Plano anual entra dividido por 12. Teste, suspensa e cancelada não contam." />
        <KpiCard icon={Calculator} color="danger" label="Custo do mês" carregando={!totais} valor={totais ? brl(totais.custoTotal) : null}
          subvalor={totais ? `${brl(totais.custoVariavel)} por uso + ${brl(totais.custoFixo)} fixo` : null} />
        <KpiCard icon={TrendingUp} color={totais && totais.margemBruta < 0 ? 'danger' : 'accent'} label="Margem bruta" carregando={!totais}
          valor={totais ? brl(totais.margemBruta) : null} subvalor={totais ? pct(totais.margemBrutaPct) : null} />
        <KpiCard icon={MessageCircle} color="info" label="Mensagens e notas" carregando={!totais}
          valor={totais ? num(totais.mensagens) : null}
          subvalor={totais ? `${num(totais.notas)} nota(s) · ${totais.acimaDoLimite} acima do limite` : null} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="uso-por-cliente" className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border-main)]">
            <h2 id="uso-por-cliente" className="text-sm font-semibold text-[var(--text-main)]">Por cliente</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Ordenado por custo. Em vermelho: custa mais do que paga.</p>
          </div>
          {carregando && !dados ? (
            <div className="p-4"><Carregando linhas={5} /></div>
          ) : linhas.length === 0 ? (
            <EmptyState icon={FileText} title="Nenhum cliente neste mês" description="Quando houver negócios cadastrados, o uso aparece aqui." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Uso e custo por cliente</caption>
                <thead className="bg-[var(--bg-subtle)]">
                  <tr className="text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    <th scope="col" className="px-4 py-3 font-semibold">Negócio</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">Msgs WhatsApp</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">Notas</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">Custo</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">Paga</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.clienteId} className={clsx('border-t border-[var(--border-main)]', l.prejuizo && 'bg-[var(--danger-soft)]/40')}>
                      <td className="px-4 py-3 align-top">
                        <p className="font-semibold text-[var(--text-main)]">{l.nome}</p>
                        <p className="text-xs text-[var(--text-muted)]">{l.planoNome} · {l.canal === 'OFICIAL' ? 'canal oficial' : 'QR Code'}</p>
                        {l.acimaDoLimite.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {l.acimaDoLimite.map((a) => (
                              <Badge key={a.limite} variant="warning" size="sm">
                                Acima do limite: {num(a.uso)} de {num(a.maximo)} {NOME_LIMITE[a.limite] || a.limite}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right align-top tabular-nums">
                        <span className="font-medium text-[var(--text-main)]">{num(l.mensagens.total)}</span>
                        <span className="block text-xs text-[var(--text-muted)]">
                          {num(l.mensagens.lembretes)} lembr. · {num(l.mensagens.campanhas)} camp. · {num(l.mensagens.encaixe)} encaixe · {num(l.mensagens.pedidos)} ped.
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right align-top tabular-nums">{num(l.notas)}</td>
                      <td className={clsx('px-4 py-3 text-right align-top tabular-nums font-medium', l.prejuizo ? 'text-[var(--danger)]' : 'text-[var(--text-main)]')}>{brl(l.custo)}</td>
                      <td className="px-4 py-3 text-right align-top tabular-nums">{textoPaga(l)}</td>
                      <td className="px-4 py-3 text-right align-top"><BadgeMargem linha={l} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside aria-labelledby="custos-titulo" className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4 space-y-3 h-fit">
          <h2 id="custos-titulo" className="text-sm font-semibold text-[var(--text-main)]">Custos fixos e por uso</h2>
          {custos ? (
            <PainelCustos
              key={JSON.stringify(custos)}
              custos={custos}
              podeEditar={pode('custos.editar')}
              onSalvou={() => { setCarregando(true); carregar(); }}
            />
          ) : erro ? (
            <p className="text-sm text-[var(--text-muted)]">Custos indisponíveis.</p>
          ) : (
            <Carregando linhas={3} />
          )}
          <div className="pt-3 mt-1 border-t border-[var(--border-main)]">
            <h2 className="text-sm font-semibold text-[var(--text-main)] mb-2">IA dos bots</h2>
            <ChaveIAPlataforma />
            <p className="text-xs text-[var(--text-muted)] mt-2">Para ligar a IA de um cliente: Clientes, menu do cliente, IA do bot.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
