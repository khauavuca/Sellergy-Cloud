// /admin/planos — preço e limites de cada plano + cupons (frente D da fase 2).
import { useCallback, useEffect, useState } from 'react';
import { Check, Info, Minus, Plus, RefreshCw, RotateCcw, Tags, Ticket } from 'lucide-react';
import api from '../services/api';
import { Badge, Button, EmptyState, Input, Select, Switch, Textarea, useToast } from '../components/ui';
import Modal from '../components/Modal';
import ConfirmarAcao from '../components/conta/ConfirmarAcao';
import { brl, dataCurta } from '../components/conta/rotulosAssinatura';
import { Carregando, ErroCarregar, SemPermissao } from '../components/suporte/EstadosAdmin';
import { erroDaApi, usePapelAdmin } from '../components/suporte/papelAdmin';

const LIMITES = [
  { chave: 'usuarios', rotulo: 'Usuários' },
  { chave: 'profissionais', rotulo: 'Profissionais' },
  { chave: 'lembretesMes', rotulo: 'Lembretes por mês' },
  { chave: 'notasMes', rotulo: 'Notas fiscais por mês' },
];

const NOME_RECURSO = {
  vendas: 'Vendas', estoque: 'Estoque', agenda: 'Agenda', financeiro: 'Financeiro', lembretesWhatsapp: 'Lembretes no WhatsApp',
  pagamentos: 'Pagamentos', notaFiscal: 'Nota fiscal', campanhas: 'Campanhas', pacotes: 'Pacotes', linkAgendamento: 'Link de agendamento',
  catalogoOnline: 'Catálogo online', atendimentoIa: 'Atendimento com IA', relatoriosAvancados: 'Relatórios avançados',
};

const textoLimite = (v) => (v === null || v === undefined ? 'ilimitado' : Number(v).toLocaleString('pt-BR'));
const numero = (v) => Number(String(v).replace(',', '.'));

function descontoDoCupom(c) {
  if (c.tipo === 'MESES_GRATIS') return `${c.valor} ${c.valor === 1 ? 'mês grátis' : 'meses grátis'}`;
  const v = `${Number(c.valor).toLocaleString('pt-BR')}%`;
  return c.duracaoMeses ? `${v} por ${c.duracaoMeses} ${c.duracaoMeses === 1 ? 'mês' : 'meses'}` : `${v} sempre`;
}

// ---------------------------------------------------------------------
// Card de um plano
// ---------------------------------------------------------------------
function CardPlano({ plano, podeEditar, onSalvo }) {
  const toast = useToast();
  // O pai troca a `key` quando o plano salvo muda: o formulario renasce.
  const [form, setForm] = useState(() => ({
    precoMensal: String(plano.precoMensal),
    ...Object.fromEntries(LIMITES.map((l) => [l.chave, plano.limites[l.chave] === null ? '' : String(plano.limites[l.chave])])),
  }));
  const [campos, setCampos] = useState([]);
  const [confirmar, setConfirmar] = useState(null);

  const corpo = () => ({
    precoMensal: numero(form.precoMensal),
    limites: Object.fromEntries(LIMITES.map((l) => [l.chave, form[l.chave].trim() === '' ? null : Number(form[l.chave])])),
  });

  const mudou = form.precoMensal !== String(plano.precoMensal)
    || LIMITES.some((l) => form[l.chave] !== (plano.limites[l.chave] === null ? '' : String(plano.limites[l.chave])));

  const salvar = async () => {
    try {
      const r = await api.put(`/admin/planos/${plano.codigo}`, corpo());
      const n = r.data?.assinantesMantiveramPreco || 0;
      toast.success(n ? `Plano salvo. ${n} assinante(s) mantiveram o preço antigo.` : 'Plano salvo.');
      onSalvo(r.data?.planos);
      return true;
    } catch (e) {
      setCampos(e.response?.data?.campos || []);
      toast.error(erroDaApi(e, 'Não foi possível salvar o plano.'));
      return false;
    }
  };

  const restaurar = async () => {
    try {
      const r = await api.delete(`/admin/planos/${plano.codigo}`);
      const n = r.data?.assinantesMantiveramPreco || 0;
      toast.success(n ? `Plano voltou ao padrão. ${n} assinante(s) mantiveram o preço antigo.` : 'Plano voltou ao padrão.');
      onSalvo(r.data?.planos);
      return true;
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível voltar ao padrão.'));
      return false;
    }
  };

  const precoNovo = numero(form.precoMensal);
  const invalidoPreco = !Number.isFinite(precoNovo) || precoNovo < 1;

  return (
    <section aria-labelledby={`plano-${plano.codigo}`} className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 space-y-4 flex flex-col">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 id={`plano-${plano.codigo}`} className="text-lg font-semibold text-[var(--text-main)]">{plano.nome}</h2>
          <p className="text-xs text-[var(--text-muted)]">{plano.descricao}</p>
        </div>
        {plano.personalizado && <Badge variant="accent" size="sm">Editado</Badge>}
      </div>
      <p className="text-sm text-[var(--text-secondary)]">
        {plano.clientes.pagantes} pagante(s) · {plano.clientes.emTeste} em teste
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Input
            label="Preço mensal (R$)"
            aria-label={`Preço mensal do plano ${plano.nome}`}
            inputMode="decimal"
            value={form.precoMensal}
            disabled={!podeEditar}
            hint={`Padrão: ${brl(plano.padrao.precoMensal)}`}
            error={campos.includes('precoMensal') || (mudou && invalidoPreco) ? 'A partir de R$ 1,00' : undefined}
            onChange={(e) => setForm({ ...form, precoMensal: e.target.value })}
          />
        </div>
        {LIMITES.map((l) => (
          <Input
            key={l.chave}
            label={l.rotulo}
            aria-label={`${l.rotulo} no plano ${plano.nome}`}
            inputMode="numeric"
            placeholder="ilimitado"
            value={form[l.chave]}
            disabled={!podeEditar}
            hint={`Padrão: ${textoLimite(plano.padrao.limites[l.chave])}`}
            error={campos.includes(`limites.${l.chave}`) ? 'Número inteiro' : undefined}
            onChange={(e) => setForm({ ...form, [l.chave]: e.target.value.replace(/\D/g, '') })}
          />
        ))}
      </div>
      {podeEditar && <p className="text-xs text-[var(--text-muted)]">Deixe um limite vazio para ilimitado.</p>}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">O que o plano libera</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {Object.entries(plano.recursos).map(([k, v]) => (
            <li key={k} className={v ? 'flex items-center gap-1.5 text-[var(--text-main)]' : 'flex items-center gap-1.5 text-[var(--text-muted)]'}>
              {v ? <Check size={14} aria-hidden="true" className="text-[var(--success)]" /> : <Minus size={14} aria-hidden="true" />}
              <span>{NOME_RECURSO[k] || k}<span className="sr-only">{v ? ': incluso' : ': não incluso'}</span></span>
            </li>
          ))}
        </ul>
      </div>

      {podeEditar && (
        <div className="flex flex-wrap gap-2 mt-auto pt-2">
          <Button
            className="min-h-11"
            disabled={!mudou || invalidoPreco}
            onClick={() => setConfirmar({
              titulo: `Salvar o plano ${plano.nome}?`,
              texto: `Preço novo: ${brl(precoNovo)}/mês. Vale pra quem assinar a partir de agora; quem já assina mantém o preço. Os limites mudam na hora para todos do plano.`,
              rotulo: 'Salvar plano',
              acao: salvar,
            })}
          >
            Salvar
          </Button>
          {plano.personalizado && (
            <Button
              variant="secondary"
              className="min-h-11"
              icon={RotateCcw}
              onClick={() => setConfirmar({
                titulo: `Voltar ${plano.nome} ao padrão?`,
                texto: `Preço volta para ${brl(plano.padrao.precoMensal)}/mês e os limites para o padrão. Quem já assina mantém o preço se o padrão for maior.`,
                rotulo: 'Voltar ao padrão',
                acao: restaurar,
              })}
            >
              Voltar ao padrão
            </Button>
          )}
        </div>
      )}

      <ConfirmarAcao
        isOpen={Boolean(confirmar)}
        onClose={() => setConfirmar(null)}
        titulo={confirmar?.titulo}
        rotuloConfirmar={confirmar?.rotulo}
        variante="primary"
        onConfirmar={() => confirmar?.acao()}
      >
        <p>{confirmar?.texto}</p>
      </ConfirmarAcao>
    </section>
  );
}

// ---------------------------------------------------------------------
// Modal: criar cupom
// ---------------------------------------------------------------------
const CUPOM_VAZIO = { codigo: '', tipo: 'PERCENTUAL', valor: '', duracaoMeses: '', validoAte: '', limiteUsos: '', descricao: '' };

function ModalCupom({ isOpen, onClose, onCriado }) {
  const toast = useToast();
  const [form, setForm] = useState(CUPOM_VAZIO);
  const [campos, setCampos] = useState([]);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const fechar = () => {
    if (enviando) return;
    setForm(CUPOM_VAZIO); setCampos([]); setErro('');
    onClose();
  };

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setErro('');
    try {
      const corpo = {
        codigo: form.codigo.trim().toUpperCase(),
        tipo: form.tipo,
        valor: numero(form.valor),
        duracaoMeses: form.tipo === 'PERCENTUAL' && form.duracaoMeses ? Number(form.duracaoMeses) : null,
        validoAte: form.validoAte || null,
        limiteUsos: form.limiteUsos ? Number(form.limiteUsos) : null,
        descricao: form.descricao.trim() || undefined,
      };
      const r = await api.post('/admin/planos/cupons', corpo);
      toast.success(`Cupom ${r.data.codigo} criado.`);
      onCriado(r.data);
      setForm(CUPOM_VAZIO); setCampos([]);
      onClose();
    } catch (err) {
      setCampos(err.response?.data?.campos || []);
      setErro(erroDaApi(err, 'Não foi possível criar o cupom.'));
    } finally {
      setEnviando(false);
    }
  };

  const tem = (c) => campos.includes(c);
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <Modal isOpen={isOpen} onClose={fechar} title="Criar cupom" size="md">
      <form onSubmit={enviar} className="space-y-4">
        {erro && <p role="alert" className="text-sm text-[var(--danger-text)] bg-[var(--danger-soft)] rounded-lg px-3 py-2">{erro}</p>}
        <Input label="Código" aria-label="Código do cupom" placeholder="BLACKFRIDAY30" value={form.codigo} maxLength={20}
          hint="3 a 20 letras ou números, sem espaço" error={tem('codigo') ? 'Código inválido ou repetido' : undefined}
          onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
        <Select label="Tipo de desconto" aria-label="Tipo de desconto" placeholder="" value={form.tipo}
          options={[{ value: 'PERCENTUAL', label: 'Porcentagem da mensalidade' }, { value: 'MESES_GRATIS', label: 'Meses grátis' }]}
          error={tem('tipo') ? 'Escolha o tipo' : undefined}
          onChange={(e) => setForm({ ...form, tipo: e.target.value })} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label={form.tipo === 'PERCENTUAL' ? 'Desconto (%)' : 'Quantos meses grátis'} aria-label="Valor do desconto" inputMode="decimal"
            value={form.valor} error={tem('valor') ? (form.tipo === 'PERCENTUAL' ? 'De 1 a 100' : 'De 1 a 12') : undefined}
            onChange={(e) => setForm({ ...form, valor: e.target.value })} />
          {form.tipo === 'PERCENTUAL' && (
            <Input label="Por quantos meses" aria-label="Duração do desconto em meses" inputMode="numeric" placeholder="sempre"
              value={form.duracaoMeses} hint="Vazio = sempre" error={tem('duracaoMeses') ? 'De 1 a 36' : undefined}
              onChange={(e) => setForm({ ...form, duracaoMeses: e.target.value.replace(/\D/g, '') })} />
          )}
          <Input label="Válido até" aria-label="Válido até" type="date" min={hoje} value={form.validoAte}
            hint="Vazio = sem prazo" error={tem('validoAte') ? 'Data futura' : undefined}
            onChange={(e) => setForm({ ...form, validoAte: e.target.value })} />
          <Input label="Limite de usos" aria-label="Limite de usos" inputMode="numeric" placeholder="sem limite" value={form.limiteUsos}
            error={tem('limiteUsos') ? 'Número inteiro' : undefined}
            onChange={(e) => setForm({ ...form, limiteUsos: e.target.value.replace(/\D/g, '') })} />
        </div>
        <Textarea label="Descrição (opcional)" aria-label="Descrição do cupom" rows={2} maxLength={120} value={form.descricao}
          placeholder="Ex.: campanha de indicação" onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" className="min-h-11" onClick={fechar} disabled={enviando}>Cancelar</Button>
          <Button type="submit" className="min-h-11" loading={enviando} disabled={!form.codigo || !form.valor}>Criar cupom</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------
export default function AdminPlanosPage() {
  const toast = useToast();
  const { pode } = usePapelAdmin();
  const [planos, setPlanos] = useState([]);
  const [cupons, setCupons] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [erroCupons, setErroCupons] = useState('');
  const [semAcesso, setSemAcesso] = useState(false);
  const [modalCupom, setModalCupom] = useState(false);
  const [alternando, setAlternando] = useState(null);

  // O estado ja nasce carregando; Atualizar e Tentar de novo ligam antes.
  const carregar = useCallback(() => Promise.all([
      api.get('/admin/planos')
        .then((r) => { setPlanos(r.data?.planos || []); setErro(''); })
        .catch((e) => {
          if (e.response?.status === 403) setSemAcesso(true);
          setErro(erroDaApi(e, 'Não foi possível carregar os planos.'));
        }),
      api.get('/admin/planos/cupons')
        .then((r) => { setCupons(r.data?.cupons || []); setErroCupons(''); })
        .catch((e) => setErroCupons(erroDaApi(e, 'Não foi possível carregar os cupons.'))),
    ]).finally(() => setCarregando(false)), []);
  const recarregar = () => { setCarregando(true); carregar(); };

  useEffect(() => { carregar(); }, [carregar]);

  const alternarCupom = async (c, ativo) => {
    setAlternando(c.codigo);
    try {
      const r = await api.put(`/admin/planos/cupons/${encodeURIComponent(c.codigo)}`, { ativo });
      setCupons((lista) => lista.map((x) => (x.codigo === c.codigo ? r.data : x)));
      toast.success(ativo ? `Cupom ${c.codigo} ligado.` : `Cupom ${c.codigo} desligado.`);
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível atualizar o cupom.'));
    } finally {
      setAlternando(null);
    }
  };

  if (semAcesso) return <SemPermissao />;

  const podePreco = pode('precos.editar');
  const podeCupom = pode('cupons.editar');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Planos e preços</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Preço e limites de cada plano. Muda para novos clientes na hora.</p>
        </div>
        <Button variant="secondary" className="min-h-11" icon={RefreshCw} loading={carregando} onClick={recarregar}>Atualizar</Button>
      </div>

      {!podePreco && !semAcesso && (
        <p className="text-sm text-[var(--text-muted)]">Você pode ver os planos. Só o dono da conta Sellergy muda preços, limites e cupons.</p>
      )}

      {erro && <ErroCarregar texto={erro} onTentar={recarregar} />}

      <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-[var(--info-soft)] text-sm text-[var(--info-text)]">
        <Info size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
        Preço novo vale pra quem assinar a partir de agora. Quem já assina mantém o preço antigo quando o preço sobe. Plano anual tem 20% de desconto sobre o mensal.
      </div>

      {carregando && planos.length === 0 ? (
        <Carregando linhas={3} />
      ) : planos.length === 0 && !erro ? (
        <EmptyState icon={Tags} title="Nenhum plano encontrado" />
      ) : (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
          {planos.map((p) => (
            <CardPlano key={`${p.codigo}-${p.precoMensal}-${JSON.stringify(p.limites)}-${p.atualizadoEm || ''}`} plano={p} podeEditar={podePreco} onSalvo={(lista) => (lista ? setPlanos(lista) : recarregar())} />
          ))}
        </div>
      )}

      <section aria-labelledby="cupons-titulo" className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border-main)] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="cupons-titulo" className="text-sm font-semibold text-[var(--text-main)]">Cupons de desconto</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">O cupom fica cadastrado aqui; ainda não é aplicado sozinho na hora de assinar.</p>
          </div>
          {podeCupom && <Button className="min-h-11" icon={Plus} onClick={() => setModalCupom(true)}>Criar cupom</Button>}
        </div>
        {erroCupons ? (
          <div className="p-4"><ErroCarregar texto={erroCupons} onTentar={recarregar} /></div>
        ) : carregando && cupons.length === 0 ? (
          <div className="p-4"><Carregando linhas={2} /></div>
        ) : cupons.length === 0 ? (
          <EmptyState icon={Ticket} title="Nenhum cupom ainda" description={podeCupom ? 'Crie um cupom para campanhas e indicações.' : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Cupons de desconto</caption>
              <thead className="bg-[var(--bg-subtle)]">
                <tr className="text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  <th scope="col" className="px-4 py-3 font-semibold">Código</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Desconto</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-right">Usos</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Validade</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Ligado</th>
                </tr>
              </thead>
              <tbody>
                {cupons.map((c) => (
                  <tr key={c.codigo} className="border-t border-[var(--border-main)]">
                    <td className="px-4 py-3">
                      <p className="font-semibold font-mono text-[var(--text-main)]">{c.codigo}</p>
                      {c.descricao && <p className="text-xs text-[var(--text-muted)]">{c.descricao}</p>}
                    </td>
                    <td className="px-4 py-3">{descontoDoCupom(c)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.usos || 0}{c.limiteUsos ? ` de ${c.limiteUsos}` : ''}</td>
                    <td className="px-4 py-3">{c.validoAte ? `até ${dataCurta(c.validoAte)}` : 'sem prazo'}</td>
                    <td className="px-4 py-3">
                      <div className="min-h-11 flex items-center gap-2">
                        <Switch
                          checked={c.ativo !== false}
                          disabled={!podeCupom || alternando === c.codigo}
                          ariaLabel={`Cupom ${c.codigo} ligado`}
                          onChange={(v) => alternarCupom(c, v)}
                        />
                        <span className="text-xs text-[var(--text-muted)]">{c.ativo !== false ? 'Ligado' : 'Desligado'}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ModalCupom isOpen={modalCupom} onClose={() => setModalCupom(false)} onCriado={(c) => setCupons((l) => [c, ...l])} />
    </div>
  );
}
