// /app/pacotes — pacotes de sessoes (frente A da fase 2).
// Modelos (o que se vende), venda (caixa ou Pix parcelado) e clientes com
// pacote (saldo, pagamento, validade). Regra no backend: src/agenda/pacotes.js.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Package, Loader2, AlertCircle, Edit2, ShoppingBag, Send, XCircle, Lock, RefreshCw } from 'lucide-react';
import api from '../services/api';
import { Badge, Button, Card, EmptyState, Input, Select, useToast } from '../components/ui';
import Modal from '../components/Modal';
import { formatarTelefoneBR } from '../utils/formatTelefone';

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (d) => new Date(d).toLocaleDateString('pt-BR');
const STATUS = {
  ATIVO: { label: 'Ativo', variant: 'success' },
  ACABOU: { label: 'Acabou', variant: 'neutral' },
  VENCIDO: { label: 'Vencido', variant: 'warning' },
  CANCELADO: { label: 'Cancelado', variant: 'danger' },
};

function textoValidade(dias) {
  if (dias % 30 === 0) return `${dias / 30} ${dias / 30 === 1 ? 'mês' : 'meses'}`;
  return `${dias} dias`;
}

export default function PacotesPage() {
  const toast = useToast();
  const [modelos, setModelos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [filtro, setFiltro] = useState('ativos');
  const [carregando, setCarregando] = useState(true);
  const [carregandoClientes, setCarregandoClientes] = useState(true);
  const [erro, setErro] = useState(null);
  const [semPlano, setSemPlano] = useState(false);
  const [modalModelo, setModalModelo] = useState({ open: false, modelo: null });
  const [modalVender, setModalVender] = useState({ open: false, modelo: null, cliente: null });
  const [config, setConfig] = useState(null);

  // Recarregar = mudar a versao (setState so nos callbacks das promessas).
  const [versaoModelos, setVersaoModelos] = useState(0);
  const [versaoClientes, setVersaoClientes] = useState(0);
  const carregarModelos = useCallback(() => setVersaoModelos((v) => v + 1), []);
  const carregarClientes = useCallback(() => { setCarregandoClientes(true); setVersaoClientes((v) => v + 1); }, []);
  const mudarFiltro = (f) => { if (f !== filtro) { setCarregandoClientes(true); setFiltro(f); } };

  useEffect(() => {
    let vivo = true;
    api.get('/pacotes/modelos')
      .then((r) => { if (vivo) { setModelos(r.data || []); setErro(null); } })
      .catch((e) => {
        if (!vivo) return;
        if (e.response?.data?.codigo === 'PLANO_SEM_RECURSO') setSemPlano(true);
        else setErro(e.response?.data?.erro || 'Não foi possível carregar os pacotes.');
      })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [versaoModelos]);

  useEffect(() => {
    api.get('/agenda/config').then((r) => setConfig(r.data)).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    let vivo = true;
    api.get('/pacotes/clientes', { params: { filtro } })
      .then((r) => { if (vivo) setClientes(r.data || []); })
      .catch((e) => {
        if (!vivo) return;
        if (e.response?.data?.codigo !== 'PLANO_SEM_RECURSO') toast.error(e.response?.data?.erro || 'Não foi possível carregar as clientes com pacote.');
        setClientes([]);
      })
      .finally(() => { if (vivo) setCarregandoClientes(false); });
    return () => { vivo = false; };
  }, [filtro, versaoClientes, toast]);

  const recarregarTudo = () => { carregarModelos(); carregarClientes(); };

  const desativar = async (m) => {
    if (!confirm(`Parar de vender "${m.nome}"? Quem já comprou continua usando.`)) return;
    try {
      await api.delete(`/pacotes/modelos/${m.id}`);
      toast.success('Pacote desativado.');
      carregarModelos();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível desativar.');
    }
  };

  const reativar = async (m) => {
    try {
      await api.put(`/pacotes/modelos/${m.id}`, { ativo: true });
      toast.success('Pacote voltou a ser vendido.');
      carregarModelos();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível reativar.');
    }
  };

  const reenviarPix = async (c) => {
    try {
      const r = await api.post(`/pacotes/clientes/${c.id}/reenviar-pix`);
      toast.success(r.data.mensagem);
      carregarClientes();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível enviar o Pix.');
    }
  };

  const cancelar = async (c) => {
    if (!confirm(`Cancelar o pacote de ${c.cliente.nome}? As sessões que sobraram deixam de valer e as cobranças em aberto são canceladas.`)) return;
    try {
      await api.post(`/pacotes/clientes/${c.id}/cancelar`);
      toast.success('Pacote cancelado.');
      recarregarTudo();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível cancelar.');
    }
  };

  if (carregando) return <div className="py-16 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;

  if (semPlano) {
    return (
      <Card padding="lg">
        <EmptyState
          icon={Lock}
          title="Pacotes de sessões estão no plano Profissional"
          description="Venda pacotes, controle o saldo de cada cliente e desconte a sessão sozinho ao concluir o atendimento."
          action={<Link to="/app/plano"><Button variant="primary" className="min-h-[44px]">Ver planos</Button></Link>}
        />
      </Card>
    );
  }

  if (erro) {
    return (
      <Card padding="lg">
        <div role="alert" className="flex items-start gap-3">
          <AlertCircle size={18} className="text-[var(--danger)] mt-0.5" />
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-main)]">{erro}</p>
            <Button variant="secondary" onClick={() => { setCarregando(true); setErro(null); carregarModelos(); }}>Tentar de novo</Button>
          </div>
        </div>
      </Card>
    );
  }

  const ativos = modelos.filter((m) => m.ativo);
  const inativos = modelos.filter((m) => !m.ativo);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text-main)] flex-1">Pacotes de sessões</h1>
        <Button variant="primary" icon={Plus} className="min-h-[44px]" onClick={() => setModalModelo({ open: true, modelo: null })}>Novo pacote</Button>
      </div>

      {modelos.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={Package}
            title="Nenhum pacote criado"
            description="Crie um pacote (ex.: 10 sessões de drenagem) e venda pra suas clientes. Cada atendimento concluído desconta uma sessão."
            action={<Button variant="primary" icon={Plus} className="min-h-[44px]" onClick={() => setModalModelo({ open: true, modelo: null })}>Criar pacote</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[...ativos, ...inativos].map((m) => (
            <Card key={m.id} padding="lg" className={m.ativo ? '' : 'opacity-70'}>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="text-base font-semibold text-[var(--text-main)]">{m.nome}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {m.servico} · validade {textoValidade(m.validadeDias)}{m.intervaloMinDias ? ` · intervalo mínimo ${m.intervaloMinDias} dias` : ''}
                    </div>
                  </div>
                  {!m.ativo && <Badge variant="neutral">Fora de venda</Badge>}
                </div>
                <div className="text-xl font-semibold tabular-nums text-[var(--text-main)]">{fmtBRL(m.preco)}</div>
                <div className="text-sm text-[var(--text-secondary)]">
                  {m.sessoes} sessões · sai {fmtBRL(m.valorSessao)} a sessão
                  {m.precoAvulso && m.precoAvulso * m.sessoes > m.preco ? ` (economia de ${fmtBRL(m.precoAvulso * m.sessoes - m.preco)})` : ''}
                </div>
                <div className="text-xs text-[var(--text-muted)]">{m.clientesAtivas} cliente(s) com pacote ativo</div>
                <div className="flex flex-wrap gap-2 pt-2">
                  {m.ativo && <Button variant="primary" icon={ShoppingBag} className="min-h-[44px]" onClick={() => setModalVender({ open: true, modelo: m, cliente: null })}>Vender</Button>}
                  <Button variant="secondary" icon={Edit2} className="min-h-[44px]" onClick={() => setModalModelo({ open: true, modelo: m })}>Editar</Button>
                  {m.ativo
                    ? <Button variant="ghost" className="min-h-[44px]" onClick={() => desativar(m)}>Parar de vender</Button>
                    : <Button variant="ghost" className="min-h-[44px]" onClick={() => reativar(m)}>Voltar a vender</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card padding="none">
        <div className="flex flex-wrap items-center gap-2 px-5 py-4 border-b border-[var(--border-main)]">
          <h2 className="text-base font-semibold text-[var(--text-main)] flex-1">Clientes com pacote</h2>
          <div className="flex gap-1.5" role="group" aria-label="Filtrar clientes">
            {[['ativos', 'Ativos'], ['acabando', 'Acabando'], ['encerrados', 'Encerrados']].map(([v, l]) => (
              <button
                key={v} type="button" aria-pressed={filtro === v} onClick={() => mudarFiltro(v)}
                className={`min-h-[44px] px-4 rounded-full border text-sm font-medium ${filtro === v ? 'bg-[var(--primary)] text-[var(--text-on-primary)] border-[var(--primary)]' : 'border-[var(--border-strong)] text-[var(--text-secondary)]'}`}
              >{l}</button>
            ))}
          </div>
        </div>
        {carregandoClientes ? (
          <div className="py-10 grid place-items-center"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>
        ) : clientes.length === 0 ? (
          <div className="px-5 py-8 text-sm text-center text-[var(--text-muted)]">
            {filtro === 'acabando' ? 'Nenhum pacote acabando (2 sessões ou menos, ou vencendo em 30 dias).' : filtro === 'encerrados' ? 'Nenhum pacote encerrado.' : 'Nenhuma cliente com pacote ativo.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--text-muted)]">
                  <th className="px-5 py-2 font-semibold">Cliente</th>
                  <th className="px-3 py-2 font-semibold">Pacote</th>
                  <th className="px-3 py-2 font-semibold">Sessões</th>
                  <th className="px-3 py-2 font-semibold">Pagamento</th>
                  <th className="px-3 py-2 font-semibold">Validade</th>
                  <th className="px-5 py-2"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.id} className="border-t border-[var(--border-main)] align-top">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-[var(--text-main)]">{c.cliente.nome}</div>
                      {c.cliente.telefone && <div className="text-xs text-[var(--text-muted)]">{formatarTelefoneBR(c.cliente.telefone)}</div>}
                    </td>
                    <td className="px-3 py-3 text-[var(--text-secondary)]">{c.pacote}</td>
                    <td className="px-3 py-3">
                      <div className="tabular-nums text-[var(--text-main)]">{c.sessoesUsadas} de {c.sessoesTotal} usadas</div>
                      <div className="text-xs text-[var(--text-muted)]">{c.saldo} restante(s){c.reservados ? ` · ${c.reservados} marcada(s)` : ''}</div>
                      {c.acabando && <Badge variant="warning" size="sm">Acabando</Badge>}
                    </td>
                    <td className="px-3 py-3 text-[var(--text-secondary)]">
                      {c.parcelasPagas >= c.parcelas
                        ? <span>Pago{c.parcelas > 1 ? ` (${c.parcelas}×)` : ''}</span>
                        : <span>{c.parcelasPagas} de {c.parcelas} parcela(s){c.cobrancaPendente ? ` · ${fmtBRL(c.cobrancaPendente.valor)} em aberto` : ''}</span>}
                      <div className="text-xs text-[var(--text-muted)]">{fmtBRL(c.valor)}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-[var(--text-secondary)]">{fmtData(c.validoAte)}</div>
                      <Badge variant={STATUS[c.status]?.variant} size="sm">{STATUS[c.status]?.label || c.status}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {c.status === 'ATIVO' && c.parcelasPagas < c.parcelas && (
                          <Button variant="ghost" size="sm" icon={Send} className="min-h-[44px]" onClick={() => reenviarPix(c)}>Mandar Pix</Button>
                        )}
                        {(c.acabando || c.status !== 'ATIVO') && c.status !== 'CANCELADO' && modelos.find((m) => m.id === c.modeloId && m.ativo) && (
                          <Button variant="ghost" size="sm" icon={RefreshCw} className="min-h-[44px]" onClick={() => setModalVender({ open: true, modelo: modelos.find((m) => m.id === c.modeloId), cliente: c.cliente })}>Renovar</Button>
                        )}
                        {c.status === 'ATIVO' && (
                          <Button variant="ghost" size="sm" icon={XCircle} className="min-h-[44px]" aria-label={`Cancelar pacote de ${c.cliente.nome}`} onClick={() => cancelar(c)}>Cancelar</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ModalModelo
        isOpen={modalModelo.open} modelo={modalModelo.modelo}
        onClose={() => setModalModelo({ open: false, modelo: null })}
        onSalvo={() => { setModalModelo({ open: false, modelo: null }); carregarModelos(); }}
      />
      <ModalVender
        isOpen={modalVender.open} modelo={modalVender.modelo} cliente={modalVender.cliente}
        pagamentoConfigurado={!!config?.pagamentoConfigurado}
        onClose={() => setModalVender({ open: false, modelo: null, cliente: null })}
        onVendido={() => { setModalVender({ open: false, modelo: null, cliente: null }); recarregarTudo(); }}
      />
    </div>
  );
}

// Abre sempre com estado novo: o conteudo remonta a cada abertura (key).
function ModalModelo(props) {
  if (!props.isOpen) return null;
  return <ModalModeloConteudo key={props.modelo?.id || 'novo'} {...props} />;
}

function ModalModeloConteudo({ isOpen, modelo, onClose, onSalvo }) {
  const toast = useToast();
  const [servicos, setServicos] = useState([]);
  const [form, setForm] = useState(() => (modelo
    ? { nome: modelo.nome, produtoId: modelo.produtoId || '', sessoes: String(modelo.sessoes), preco: String(modelo.preco), validadeDias: String(modelo.validadeDias), intervaloMinDias: modelo.intervaloMinDias ? String(modelo.intervaloMinDias) : '' }
    : { nome: '', produtoId: '', sessoes: '10', preco: '', validadeDias: '180', intervaloMinDias: '' }));
  const [erros, setErros] = useState([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.get('/catalogo').then((r) => setServicos((r.data || []).filter((p) => p.tipo === 'SERVICO'))).catch(() => setServicos([]));
  }, []);

  const salvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    setErros([]);
    const corpo = {
      nome: form.nome, produtoId: form.produtoId, sessoes: Number(form.sessoes), preco: Number(String(form.preco).replace(',', '.')),
      validadeDias: Number(form.validadeDias), intervaloMinDias: form.intervaloMinDias ? Number(form.intervaloMinDias) : null,
    };
    try {
      if (modelo) await api.put(`/pacotes/modelos/${modelo.id}`, corpo);
      else await api.post('/pacotes/modelos', corpo);
      toast.success(modelo ? 'Pacote atualizado.' : 'Pacote criado.');
      onSalvo();
    } catch (err) {
      setErros(err.response?.data?.campos || []);
      toast.error(err.response?.data?.erro || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const erro = (c) => (erros.includes(c) ? 'Confira este campo' : undefined);
  const porSessao = Number(form.sessoes) > 0 && Number(String(form.preco).replace(',', '.')) > 0
    ? Number(String(form.preco).replace(',', '.')) / Number(form.sessoes) : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modelo ? 'Editar pacote' : 'Novo pacote'} description={modelo ? 'Mudanças valem pra próximas vendas; quem já comprou mantém o que comprou.' : 'O que você vai vender: serviço, quantas sessões, preço e validade.'} size="lg">
      <form onSubmit={salvar} className="space-y-4">
        <Input label="Nome do pacote" placeholder="Ex.: Drenagem 10 sessões" value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} error={erro('nome')} required />
        <Select label="Serviço" value={form.produtoId || ''} onChange={(e) => setForm({ ...form, produtoId: e.target.value })} placeholder={servicos.length ? 'Escolha o serviço' : 'Cadastre um serviço no Catálogo antes'} options={servicos.map((s) => ({ value: s.id, label: s.nome }))} error={erro('produtoId')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Sessões" type="number" min={2} max={100} value={form.sessoes || ''} onChange={(e) => setForm({ ...form, sessoes: e.target.value })} error={erro('sessoes')} required />
          <Input label="Preço do pacote (R$)" inputMode="decimal" value={form.preco || ''} onChange={(e) => setForm({ ...form, preco: e.target.value })} error={erro('preco')} hint={porSessao ? `Sai ${fmtBRL(porSessao)} a sessão` : undefined} required />
          <Input label="Validade (dias)" type="number" min={7} max={1095} value={form.validadeDias || ''} onChange={(e) => setForm({ ...form, validadeDias: e.target.value })} error={erro('validadeDias')} required />
          <Input label="Intervalo mínimo entre sessões (dias)" type="number" min={0} max={180} value={form.intervaloMinDias || ''} onChange={(e) => setForm({ ...form, intervaloMinDias: e.target.value })} error={erro('intervaloMinDias')} hint="Vazio = sem intervalo" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" className="min-h-[44px]" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" className="min-h-[44px]" loading={salvando}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

// Abre sempre com estado novo: o conteudo so existe com o modal aberto.
function ModalVender(props) {
  if (!props.isOpen || !props.modelo) return null;
  return <ModalVenderConteudo {...props} />;
}

function ModalVenderConteudo({ isOpen, modelo, cliente, pagamentoConfigurado, onClose, onVendido }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({ nome: cliente?.nome || '', telefone: cliente?.telefone ? formatarTelefoneBR(cliente.telefone) : '', forma: 'CAIXA', metodoPagamento: 'PIX', parcelas: '1' }));
  const [erros, setErros] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [pix, setPix] = useState(null);

  const vender = async (e) => {
    e.preventDefault();
    setSalvando(true);
    setErros([]);
    try {
      const r = await api.post('/pacotes/vender', {
        modeloId: modelo.id, nome: form.nome, telefone: form.telefone, forma: form.forma,
        metodoPagamento: form.forma === 'CAIXA' ? form.metodoPagamento : undefined,
        parcelas: form.forma === 'PIX' ? Number(form.parcelas) : 1,
      });
      if (r.data.venda) {
        toast.success(`Pacote vendido · Venda #${r.data.venda.numero} (${fmtBRL(r.data.venda.valor)}) no caixa.`);
        onVendido();
      } else {
        toast.success(r.data.mensagem);
        setPix(r.data.cobranca);
      }
    } catch (err) {
      setErros(err.response?.data?.campos || []);
      toast.error(err.response?.data?.erro || 'Não foi possível vender.');
    } finally {
      setSalvando(false);
    }
  };

  const erro = (c) => (erros.includes(c) ? 'Confira este campo' : undefined);
  const parcela = Number(form.parcelas) > 0 ? modelo.preco / Number(form.parcelas) : modelo.preco;

  if (pix) {
    return (
      <Modal isOpen={isOpen} onClose={onVendido} title="Pix gerado" description={`${modelo.nome} · ${form.nome}`}>
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">A cliente recebeu o Pix de {fmtBRL(pix.valor)} no WhatsApp. Quando pagar, o sistema registra sozinho{Number(form.parcelas) > 1 ? ' e gera a próxima parcela' : ''}.</p>
          {pix.qrCode && (
            <div>
              <label htmlFor="pix-pacote" className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Pix copia e cola</label>
              <textarea id="pix-pacote" readOnly value={pix.qrCode} rows={3} className="w-full text-xs rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] p-2 font-mono" />
              <Button variant="secondary" className="min-h-[44px] mt-2" onClick={() => navigator.clipboard?.writeText(pix.qrCode).then(() => toast.success('Código copiado.'))}>Copiar código</Button>
            </div>
          )}
          <div className="flex justify-end"><Button variant="primary" className="min-h-[44px]" onClick={onVendido}>Pronto</Button></div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Vender ${modelo.nome}`} description={`${modelo.sessoes} sessões de ${modelo.servico} · ${fmtBRL(modelo.preco)} · validade ${textoValidade(modelo.validadeDias)}`} size="lg">
      <form onSubmit={vender} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome da cliente" value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} error={erro('nome')} required />
          <Input label="WhatsApp" inputMode="tel" maxLength={15} placeholder="(11) 98888-7777" value={form.telefone || ''} onChange={(e) => setForm({ ...form, telefone: formatarTelefoneBR(e.target.value) })} error={erro('telefone')} hint="Se já é cliente, o sistema acha pelo número." required />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-[var(--text-secondary)] mb-1">Como ela paga</legend>
          {[['CAIXA', 'Agora, no caixa', 'Lança a venda no caixa do dia (dinheiro, cartão ou Pix na maquininha).'], ['PIX', 'Pix pelo WhatsApp', 'Gera o Pix e manda pra cliente. Dá pra parcelar: uma cobrança por mês.']].map(([v, t, d]) => (
            <label key={v} className={`flex gap-3 items-start p-3 rounded-xl border cursor-pointer min-h-[44px] ${form.forma === v ? 'border-[var(--primary)] bg-[var(--bg-subtle)]' : 'border-[var(--border-main)]'} ${v === 'PIX' && !pagamentoConfigurado ? 'opacity-60 cursor-not-allowed' : ''}`}>
              <input type="radio" name="forma" value={v} checked={form.forma === v} disabled={v === 'PIX' && !pagamentoConfigurado} onChange={() => setForm({ ...form, forma: v })} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold text-[var(--text-main)]">{t}</span>
                <span className="block text-xs text-[var(--text-muted)]">{v === 'PIX' && !pagamentoConfigurado ? 'Configure o recebimento em Pagamentos para cobrar por Pix.' : d}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {form.forma === 'CAIXA' ? (
          <Select label="Forma de pagamento" value={form.metodoPagamento} onChange={(e) => setForm({ ...form, metodoPagamento: e.target.value })} placeholder="" options={[{ value: 'PIX', label: 'Pix' }, { value: 'DINHEIRO', label: 'Dinheiro' }, { value: 'CARTAO_CREDITO', label: 'Cartão de crédito' }, { value: 'CARTAO_DEBITO', label: 'Cartão de débito' }]} error={erro('metodoPagamento')} />
        ) : (
          <Select label="Parcelas" value={form.parcelas} onChange={(e) => setForm({ ...form, parcelas: e.target.value })} placeholder="" options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? `À vista (${fmtBRL(modelo.preco)})` : `${i + 1}× de ${fmtBRL(modelo.preco / (i + 1))}` }))} error={erro('parcelas')} hint={Number(form.parcelas) > 1 ? `A 1ª parcela (${fmtBRL(parcela)}) sai agora; as outras, uma por mês, depois que a anterior é paga.` : undefined} />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" className="min-h-[44px]" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" className="min-h-[44px]" loading={salvando}>{form.forma === 'PIX' ? 'Gerar Pix' : `Registrar venda de ${fmtBRL(modelo.preco)}`}</Button>
        </div>
      </form>
    </Modal>
  );
}
