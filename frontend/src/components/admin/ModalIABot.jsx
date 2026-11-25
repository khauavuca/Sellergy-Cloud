import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot as IconeBot, Sparkles } from 'lucide-react';
import api from '../../services/api';
import { Badge, Button, Input, Select, Switch, useToast } from '../ui';
import Modal from '../Modal';
import ChaveIAPlataforma from './ChaveIAPlataforma';

const MODELOS = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek Flash (rápido e barato)' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek Pro (mais caro, raciocina melhor)' },
];
const num = (v) => Number(v || 0).toLocaleString('pt-BR');
// "2.000.000" ou "2000000" -> 2000000; inválido -> NaN.
const lerInteiroBR = (t) => {
  const limpo = String(t ?? '').replace(/[.\s]/g, '');
  return /^\d{1,12}$/.test(limpo) ? Number(limpo) : NaN;
};
// "15" ou "15,50" (reais por milhão) -> número; inválido -> NaN.
const lerReais = (t) => {
  const limpo = String(t ?? '').trim().replace(/\./g, '').replace(',', '.');
  return /^\d{1,6}(\.\d{1,2})?$/.test(limpo) ? Number(limpo) : NaN;
};

function formDoBot(bot) {
  return {
    iaAtiva: !!bot.iaAtiva,
    iaModelo: bot.iaModelo === 'deepseek-flash' ? 'deepseek-v4-flash' : (bot.iaModelo || 'deepseek-v4-flash'),
    tokensMes: num(bot.iaTokensIncluidosMes ?? 2000000),
    // No banco: centavos por MIL tokens. Na tela: reais por MILHÃO (x10).
    precoMilhao: String(Math.round((bot.iaPrecoPorMilTokensExcedenteCentavos ?? 1.5) * 10 * 100) / 100).replace('.', ','),
    excedente: num(bot.iaExcedenteAutorizadoTokens ?? 0),
  };
}

function CartaoBot({ bot, chaveOk, onSalvou }) {
  const toast = useToast();
  const [form, setForm] = useState(() => formDoBot(bot));
  const [consumo, setConsumo] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const muda = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e?.target ? e.target.value : e }));

  useEffect(() => {
    let vivo = true;
    api.get(`/bots/${bot.id}/consumo-ia`).then((r) => { if (vivo) setConsumo(r.data); }).catch(() => {});
    return () => { vivo = false; };
  }, [bot.id]);

  const salvar = async () => {
    const tokens = lerInteiroBR(form.tokensMes);
    const excedente = lerInteiroBR(form.excedente);
    const reais = lerReais(form.precoMilhao);
    if (Number.isNaN(tokens)) return toast.error('Tokens incluídos: use só números (ex.: 2.000.000).');
    if (Number.isNaN(excedente)) return toast.error('Pacote extra: use só números (ex.: 500.000).');
    if (Number.isNaN(reais)) return toast.error('Preço do extra: use reais (ex.: 15 ou 15,50).');
    if (form.iaAtiva && !bot.iaAtiva && !chaveOk
      && !confirm('A chave da DeepSeek ainda não foi cadastrada. Ligar mesmo assim? O bot vai responder "indisponível" até a chave existir.')) return;
    setSalvando(true);
    try {
      const r = await api.put(`/bots/${bot.id}`, {
        iaAtiva: form.iaAtiva,
        iaModelo: form.iaModelo,
        iaTokensIncluidosMes: tokens,
        iaExcedenteAutorizadoTokens: excedente,
        iaPrecoPorMilTokensExcedenteCentavos: reais / 10,
      });
      onSalvou({ ...bot, ...r.data });
      toast.success(form.iaAtiva ? 'IA ligada neste bot.' : 'Configuração salva.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)]" aria-label={`Bot ${bot.nome}`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
        <IconeBot size={16} aria-hidden="true" className="text-[var(--text-muted)]" />
        <div className="flex-1 min-w-0">
          <p className="m-0 text-sm font-semibold text-[var(--text-main)] truncate">{bot.nome}</p>
          <p className="m-0 text-xs text-[var(--text-muted)]">
            {bot.status === 'ONLINE' ? 'Online' : 'Offline'}
            {bot.baileysNumeroConectado || bot.telefone ? ` · ${bot.baileysNumeroConectado || bot.telefone}` : ''}
          </p>
        </div>
        <span className="text-xs font-medium text-[var(--text-secondary)]">Responder com IA</span>
        <Switch checked={form.iaAtiva} onChange={muda('iaAtiva')} ariaLabel={`Responder com IA no bot ${bot.nome}`} />
      </div>

      <div className="p-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Select label="Modelo" options={MODELOS} value={form.iaModelo} onChange={muda('iaModelo')} />
        </div>
        <Input label="Tokens incluídos por mês" inputMode="numeric" value={form.tokensMes} onChange={muda('tokensMes')}
          hint="Cota do negócio (soma dos bots)." />
        <Input label="Pacote extra liberado (tokens)" inputMode="numeric" value={form.excedente} onChange={muda('excedente')}
          hint="Passa da cota até este tanto, cobrado à parte." />
        <Input label="Preço do extra (R$ por milhão de tokens)" inputMode="decimal" value={form.precoMilhao} onChange={muda('precoMilhao')} />
        <div className="text-xs text-[var(--text-secondary)] self-end pb-1">
          {consumo ? (
            <>
              Usado neste mês: <strong className="text-[var(--text-main)] tabular-nums">{num(consumo.tokensUsadosCliente)}</strong> de {num(consumo.limiteTokens)} tokens
              {consumo.cotaEsgotada && <> · <Badge variant="warning" size="sm">Cota esgotada</Badge></>}
              {consumo.iaPausadaNaPlataforma && <> · <Badge variant="danger" size="sm">Teto do dia atingido</Badge></>}
            </>
          ) : 'Sem consumo neste mês.'}
        </div>
      </div>

      <div className="flex justify-end px-4 pb-4">
        <Button variant="primary" size="sm" loading={salvando} onClick={salvar}>Salvar</Button>
      </div>
    </section>
  );
}

/**
 * Modal (admin) que liga/desliga a IA nos bots de UM cliente e define o
 * modelo e a cota. O dono do negócio só vê o modo e ajusta a instrução.
 */
export default function ModalIABot({ isOpen, onClose, cliente }) {
  const [bots, setBots] = useState(null);
  const [erro, setErro] = useState(false);
  const [chaveOk, setChaveOk] = useState(true);
  const aoMudarChave = useCallback((ok) => setChaveOk(ok), []);

  useEffect(() => {
    if (!isOpen || !cliente) return;
    let vivo = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicia ao abrir outro cliente
    setBots(null);
    setErro(false);
    api.get('/bots', { params: { clienteId: cliente.id } })
      .then((r) => { if (vivo) setBots(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [isOpen, cliente]);

  const trocarBot = (novo) => setBots((lista) => lista.map((b) => (b.id === novo.id ? novo : b)));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`IA do bot · ${cliente?.nome || ''}`}
      description="Ligue a resposta com IA e defina modelo e cota. O cliente só vê o modo e escreve a instrução."
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-subtle)] p-4">
          <ChaveIAPlataforma onMudou={aoMudarChave} />
        </div>

        {!chaveOk && (
          <div role="status" className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--warning-soft)] text-sm text-[var(--warning-text)]">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
            Cadastre a chave acima antes de ligar a IA, senão o bot responde que está indisponível.
          </div>
        )}

        {erro ? (
          <p className="text-sm text-[var(--danger-text)]">Não foi possível carregar os bots deste cliente.</p>
        ) : bots === null ? (
          <div className="h-40 rounded-[10px] bg-[var(--bg-subtle)] animate-pulse" aria-label="Carregando" />
        ) : bots.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Sparkles size={20} aria-hidden="true" className="text-[var(--text-muted)]" />
            <p className="m-0 text-sm text-[var(--text-secondary)]">Este cliente ainda não tem bot. Ele aparece quando o cliente abre a tela de Bots.</p>
          </div>
        ) : (
          bots.map((b) => <CartaoBot key={b.id} bot={b} chaveOk={chaveOk} onSalvou={trocarBot} />)
        )}
      </div>
    </Modal>
  );
}
