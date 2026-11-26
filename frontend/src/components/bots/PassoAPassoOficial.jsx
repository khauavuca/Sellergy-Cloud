import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, Copy, CheckCircle2, Info, Loader2, ExternalLink, ShieldCheck } from 'lucide-react';
import api from '../../services/api';
import { Painel, LinhaInfo, Badge, Button, Input, IconButton, useToast } from '../ui';

// Passo a passo do WhatsApp oficial com o app do PROPRIO cliente na Meta.
//   1. Dados do app: Identificação do número + token + segredo do app, num
//      formulário só. O servidor limpa, confere (na Meta, com envio real) e
//      gera o verify token sozinho.
//   2. Webhook: o cliente copia a URL e o verify token pra Meta. A tela espera
//      a Meta confirmar (o servidor marca webhookConfirmadoEm) e avança sozinha.
//   3. Pronto: resumo e o teste de mandar um "oi".
const PASSOS = [
  { n: 1, t: 'Dados do app' },
  { n: 2, t: 'Webhook' },
  { n: 3, t: 'Pronto' },
];
const LINK_APPS_META = 'https://developers.facebook.com/apps';

function Ajuda({ children }) {
  return <p className="m-0 mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{children}</p>;
}

export default function PassoAPassoOficial({ id, bot, urlWebhook, copiar, onSalvo, antesDeSalvar }) {
  const toast = useToast();
  const ehOficial = (bot.provedorCanal || 'META_CLOUD') === 'META_CLOUD';
  const dadosSalvos = ehOficial && !!bot.identificadorCanal && !!bot.credencialCanalId && !!bot.verifyTokenCanal;
  const webhookOk = dadosSalvos && !!bot.webhookConfirmadoEm;
  const feitos = { 1: dadosSalvos, 2: webhookOk, 3: webhookOk };

  const [passo, setPasso] = useState(() => (webhookOk ? 3 : dadosSalvos ? 2 : 1));
  const [form, setForm] = useState({
    identificadorCanal: ehOficial ? bot.identificadorCanal || '' : '',
    accessToken: '',
    appSecret: '',
  });
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const avancouSozinho = useRef(false);

  const muda = (campo) => (e) => {
    setForm((f) => ({ ...f, [campo]: e.target.value }));
    setErros((x) => ({ ...x, [campo]: undefined }));
  };

  const salvar = async () => {
    setSalvando(true);
    setErros({});
    try {
      await antesDeSalvar?.();
      const r = await api.put(`/bots/${bot.id}/canal/oficial`, form);
      onSalvo(r.data.bot);
      setForm((f) => ({ ...f, accessToken: '', appSecret: '' }));
      toast.success(r.data.conferidoNaMeta ? 'A Meta confirmou o número. Agora ligue o webhook.' : 'Dados salvos. Agora ligue o webhook.');
      setPasso(r.data.bot.webhookConfirmadoEm ? 3 : 2);
    } catch (e) {
      const d = e.response?.data || {};
      if (d.campo) setErros({ [d.campo]: d.erro });
      else toast.error(d.erro || 'Não foi possível salvar. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const conferirWebhook = async ({ silencioso = false } = {}) => {
    if (!silencioso) setVerificando(true);
    try {
      const r = await api.get(`/bots/${bot.id}`);
      if (r.data?.webhookConfirmadoEm && !bot.webhookConfirmadoEm) onSalvo(r.data);
      else if (!silencioso) toast.info?.('Ainda não chegou a confirmação da Meta.');
    } catch {
      if (!silencioso) toast.error('Não foi possível conferir agora.');
    } finally {
      if (!silencioso) setVerificando(false);
    }
  };

  // No passo do webhook, confere sozinho a cada 5 s até a Meta confirmar.
  useEffect(() => {
    if (passo !== 2 || !dadosSalvos || webhookOk) return undefined;
    const t = setInterval(() => conferirWebhook({ silencioso: true }), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passo, dadosSalvos, webhookOk, bot.id]);

  // Confirmou enquanto esperava: avança pro "Pronto" uma vez.
  useEffect(() => {
    if (webhookOk && passo === 2 && !avancouSozinho.current) {
      avancouSozinho.current = true;
      setPasso(3);
      toast.success('A Meta confirmou o webhook.');
    }
  }, [webhookOk, passo, toast]);

  const etiqueta = !ehOficial
    ? <Badge variant="neutral" size="sm">Não está em uso</Badge>
    : webhookOk
      ? <Badge variant="success" size="sm">Concluído</Badge>
      : <Badge variant="warning" size="sm">Falta configurar</Badge>;

  return (
    <Painel id={id} titulo="Passo a passo do oficial" acoes={etiqueta} semPadding>
      <nav aria-label="Passos da conexão oficial" className="flex flex-wrap border-b border-[var(--border-subtle)]">
        {PASSOS.map((p) => {
          const ativo = p.n === passo;
          const feito = feitos[p.n];
          const bloqueado = p.n > 1 && !dadosSalvos;
          return (
            <button
              key={p.n}
              type="button"
              aria-current={ativo ? 'step' : undefined}
              disabled={bloqueado}
              onClick={() => setPasso(p.n)}
              className={clsx(
                'flex-[1_1_140px] flex items-center gap-2.5 px-4 py-3 text-[13px] font-semibold text-left border-b-[3px] -mb-px transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                ativo
                  ? 'text-[var(--text-main)] border-[var(--primary)]'
                  : feito
                    ? 'text-[var(--success-text)] border-transparent hover:bg-[var(--bg-subtle)]'
                    : 'text-[var(--text-muted)] border-transparent hover:bg-[var(--bg-subtle)]'
              )}
            >
              <span
                className={clsx(
                  'flex-shrink-0 w-[26px] h-[26px] rounded-full grid place-items-center text-xs font-bold',
                  ativo
                    ? 'bg-[var(--primary)] text-[var(--text-on-primary)]'
                    : feito
                      ? 'bg-[var(--success-soft)] text-[var(--success-text)]'
                      : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                )}
              >
                {feito ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : p.n}
              </span>
              {p.t}
              {feito && <span className="sr-only">(feito)</span>}
            </button>
          );
        })}
      </nav>

      {!ehOficial && (
        <div className="mx-4 mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--info-soft)] text-xs text-[var(--info-text)] leading-relaxed">
          <Info size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>O bot está usando o número por QR Code. Ao salvar estes dados, ele passa a usar a API oficial.</span>
        </div>
      )}

      {passo === 1 && (
        <div className="p-4 flex flex-col gap-4 max-w-[600px]">
          <div>
            <h3 className="m-0 text-[15px] font-semibold text-[var(--text-main)]">Cole os dados do seu app na Meta</h3>
            <p className="m-0 mt-1 text-[13px] text-[var(--text-secondary)] leading-relaxed">
              Tudo fica no painel de desenvolvedores da Meta, no app do seu WhatsApp.{' '}
              <a href={LINK_APPS_META} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold">
                Abrir meus apps <ExternalLink size={12} aria-hidden="true" />
              </a>
            </p>
          </div>

          <div>
            <Input
              size="sm"
              label="Identificação do número de telefone"
              value={form.identificadorCanal}
              onChange={muda('identificadorCanal')}
              placeholder="Ex.: 1290672074119010"
              inputMode="numeric"
              autoComplete="off"
              error={erros.identificadorCanal}
            />
            <Ajuda>WhatsApp › Configuração da API › logo abaixo do número. É um código só de dígitos, não o telefone.</Ajuda>
          </div>

          <div>
            <Input
              size="sm"
              type="password"
              label="Token de acesso"
              value={form.accessToken}
              onChange={muda('accessToken')}
              placeholder={dadosSalvos ? 'Já salvo. Cole outro só se quiser trocar.' : 'Começa com EAA...'}
              autoComplete="off"
              error={erros.accessToken}
            />
            <Ajuda>Use o token permanente: Configurações do negócio › Usuários do sistema › Gerar token, com as permissões de WhatsApp. O token temporário da tela de teste vence em 24 horas.</Ajuda>
          </div>

          <div>
            <Input
              size="sm"
              type="password"
              label="Segredo do app (App Secret)"
              value={form.appSecret}
              onChange={muda('appSecret')}
              placeholder={dadosSalvos ? 'Já salvo. Cole outro só se quiser trocar.' : '32 letras e números'}
              autoComplete="off"
              error={erros.appSecret}
            />
            <Ajuda>Configurações do app › Básico › Chave secreta do app › Mostrar. Ele garante que as mensagens vêm mesmo da Meta.</Ajuda>
          </div>

          <p className="m-0 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <ShieldCheck size={13} aria-hidden="true" /> O token e o segredo são guardados cifrados e não aparecem de novo.
          </p>
        </div>
      )}

      {passo === 2 && (
        <div className="p-4 flex flex-col gap-4 max-w-[600px]">
          <div>
            <h3 className="m-0 text-[15px] font-semibold text-[var(--text-main)]">Ligue o webhook na Meta</h3>
            <ol className="m-0 mt-2 pl-5 list-decimal text-[13px] text-[var(--text-secondary)] flex flex-col gap-1.5 leading-relaxed">
              <li>Na Meta, abra WhatsApp › Configuração e, em Webhook, clique em Editar.</li>
              <li>Cole a URL de retorno e o token de verificação abaixo e clique em Verificar e salvar.</li>
              <li>Em Campos do webhook, clique em Gerenciar e assine <strong>messages</strong>.</li>
            </ol>
          </div>

          <div>
            <span className="block text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">URL de retorno (Callback URL)</span>
            <div className="flex gap-1.5 items-center">
              <Input size="sm" value={urlWebhook} readOnly aria-label="URL de retorno" />
              <IconButton icon={Copy} variant="secondary" size="sm" ariaLabel="Copiar URL de retorno" onClick={() => copiar(urlWebhook, 'URL')} />
            </div>
          </div>
          <div>
            <span className="block text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">Token de verificação (Verify token)</span>
            <div className="flex gap-1.5 items-center">
              <Input size="sm" value={bot.verifyTokenCanal || ''} readOnly aria-label="Token de verificação" />
              <IconButton icon={Copy} variant="secondary" size="sm" ariaLabel="Copiar token de verificação" onClick={() => copiar(bot.verifyTokenCanal || '', 'Token de verificação')} />
            </div>
          </div>

          <div
            role="status"
            className={clsx(
              'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px]',
              webhookOk ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
            )}
          >
            {webhookOk
              ? <CheckCircle2 size={16} aria-hidden="true" />
              : <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            <span className="flex-1">{webhookOk ? 'A Meta confirmou o webhook.' : 'Esperando a Meta confirmar. Esta tela atualiza sozinha.'}</span>
            {!webhookOk && (
              <Button variant="secondary" size="sm" onClick={() => conferirWebhook()} loading={verificando}>Conferir agora</Button>
            )}
          </div>
        </div>
      )}

      {passo === 3 && (
        <>
          <div className="p-4 flex gap-3 items-start border-b border-[var(--border-subtle)]">
            <span
              className={clsx(
                'flex-shrink-0 w-10 h-10 rounded-full grid place-items-center',
                webhookOk ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'bg-[var(--warning-soft)] text-[var(--warning-text)]'
              )}
              aria-hidden="true"
            >
              {webhookOk ? <CheckCircle2 size={20} /> : <Info size={20} />}
            </span>
            <div className="flex-1 min-w-0">
              <strong className="text-[15px] text-[var(--text-main)]">
                {webhookOk ? 'WhatsApp oficial conectado' : 'Falta a Meta confirmar o webhook'}
              </strong>
              <div className="text-[13px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                {webhookOk
                  ? 'Para testar, mande um "oi" do seu celular para o número. O bot responde em seguida, se o “Responder sozinho” estiver ligado.'
                  : 'Volte ao passo Webhook e siga os 3 itens.'}
              </div>
            </div>
          </div>
          <div>
            <LinhaInfo rotulo="Número" valor={bot.oficialNumeroExibicao || (ehOficial && bot.identificadorCanal) || '—'} />
            <LinhaInfo rotulo="Token e segredo do app" valor={dadosSalvos ? 'Salvos' : '—'} />
            <LinhaInfo rotulo="Webhook" valor={webhookOk ? 'Confirmado' : 'Aguardando'} />
          </div>
        </>
      )}

      <div className="px-4 py-3 flex flex-wrap gap-2 items-center border-t border-[var(--border-subtle)]">
        <Button variant="secondary" size="sm" onClick={() => setPasso((p) => Math.max(1, p - 1))} disabled={passo === 1}>
          Voltar
        </Button>
        <span className="flex-1" />
        {passo === 1 && (
          <Button variant="primary" size="sm" onClick={salvar} loading={salvando}>
            {dadosSalvos ? 'Salvar alterações' : 'Salvar e continuar'}
          </Button>
        )}
        {passo === 2 && (
          <Button variant="secondary" size="sm" onClick={() => setPasso(3)} disabled={!webhookOk}>
            Continuar
          </Button>
        )}
      </div>
    </Painel>
  );
}
