import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Check, Copy, CheckCircle2, Info, Megaphone } from 'lucide-react';
import { Painel, LinhaInfo, Badge, Button, Input, Select, IconButton } from '../ui';

// Passo a passo da conexão oficial (WhatsApp Cloud API da Meta). Hoje a
// conexão é manual: o cliente copia o Phone Number ID e o token do painel da
// Meta e cola o verify token + callback URL lá. Cada passo mostra um desses
// campos técnicos; "feito" vem do que JÁ está salvo no bot, não do formulário.
const PASSOS = [
  { n: 1, t: 'Número' },
  { n: 2, t: 'Credencial' },
  { n: 3, t: 'Webhook' },
  { n: 4, t: 'Pronto' },
];

export default function PassoAPassoOficial({
  id, bot, conexao, setConexao, credsWhatsapp, urlWebhook, copiar, gerarVerifyToken, salvarCanal, salvandoCanal,
}) {
  const ehOficial = (bot.provedorCanal || 'META_CLOUD') === 'META_CLOUD';
  const feitos = {
    1: ehOficial && !!bot.identificadorCanal,
    2: ehOficial && !!bot.credencialCanalId,
    3: ehOficial && !!bot.verifyTokenCanal,
  };
  feitos[4] = feitos[1] && feitos[2] && feitos[3];

  const [passo, setPasso] = useState(() => PASSOS.find((p) => !feitos[p.n])?.n || 4);
  const credSelecionada = credsWhatsapp.find((c) => c.id === bot.credencialCanalId);

  const etiqueta = !ehOficial
    ? <Badge variant="neutral" size="sm">Não está em uso</Badge>
    : feitos[4]
      ? <Badge variant="success" size="sm">Concluído</Badge>
      : <Badge variant="warning" size="sm">Falta configurar</Badge>;

  return (
    <Painel id={id} titulo="Passo a passo do oficial" acoes={etiqueta} semPadding>
      <nav aria-label="Passos da conexão oficial" className="flex flex-wrap border-b border-[var(--border-subtle)]">
        {PASSOS.map((p) => {
          const ativo = p.n === passo;
          const feito = feitos[p.n];
          return (
            <button
              key={p.n}
              type="button"
              aria-current={ativo ? 'step' : undefined}
              onClick={() => setPasso(p.n)}
              className={clsx(
                'flex-[1_1_140px] flex items-center gap-2.5 px-4 py-3 text-[13px] font-semibold text-left border-b-[3px] -mb-px transition-colors',
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
          <span>O bot está usando o número por QR Code. Ao salvar esta conexão, ele passa a usar a API oficial.</span>
        </div>
      )}

      {passo === 1 && (
        <div className="p-4 flex flex-col gap-3 max-w-[560px]">
          <h3 className="m-0 text-[15px] font-semibold text-[var(--text-main)]">Qual número vai usar?</h3>
          <p className="m-0 text-[13px] text-[var(--text-secondary)] leading-relaxed">
            No painel da Meta (WhatsApp &gt; Configuração da API), copie a Identificação do número de telefone e cole aqui.
          </p>
          <Input
            size="sm"
            label="Phone Number ID"
            aria-label="Phone Number ID"
            value={conexao.identificadorCanal}
            onChange={(e) => setConexao({ ...conexao, identificadorCanal: e.target.value })}
            placeholder="Ex: 1290672074119010"
            hint="Obrigatório: sem ele, as mensagens recebidas não chegam ao bot."
          />
        </div>
      )}

      {passo === 2 && (
        <div className="p-4 flex flex-col gap-3 max-w-[560px]">
          <h3 className="m-0 text-[15px] font-semibold text-[var(--text-main)]">Qual token o bot usa para enviar?</h3>
          <p className="m-0 text-[13px] text-[var(--text-secondary)] leading-relaxed">
            Escolha a credencial do WhatsApp cadastrada para a sua conta.
          </p>
          <Select
            label="Credencial (token do canal)"
            aria-label="Credencial (token do canal)"
            value={conexao.credencialCanalId}
            onChange={(e) => setConexao({ ...conexao, credencialCanalId: e.target.value })}
            options={[
              { value: '', label: credsWhatsapp.length ? 'Selecione...' : 'Nenhuma credencial WhatsApp' },
              ...credsWhatsapp.map((c) => ({ value: c.id, label: c.nome })),
            ]}
            hint={credsWhatsapp.length === 0 ? 'Cadastre a integração do WhatsApp com o administrador.' : undefined}
          />
        </div>
      )}

      {passo === 3 && (
        <div className="p-4 flex flex-col gap-3 max-w-[560px]">
          <h3 className="m-0 text-[15px] font-semibold text-[var(--text-main)]">Ligue o webhook no painel da Meta</h3>
          <p className="m-0 text-[13px] text-[var(--text-secondary)] leading-relaxed">
            Em WhatsApp &gt; Configuração, cole a callback URL e o verify token abaixo e assine o campo “messages”.
          </p>
          <div>
            <Input
              size="sm"
              label="Verify token"
              aria-label="Verify token"
              value={conexao.verifyTokenCanal}
              onChange={(e) => setConexao({ ...conexao, verifyTokenCanal: e.target.value })}
              placeholder="Use no painel da Meta ao configurar o webhook"
            />
            <button
              type="button"
              className="text-xs font-semibold text-[var(--accent-text)] mt-1.5 hover:underline"
              onClick={() => setConexao({ ...conexao, verifyTokenCanal: gerarVerifyToken() })}
            >
              Gerar verify token
            </button>
          </div>
          <div>
            <span className="block text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">
              Callback URL (cole no painel da Meta)
            </span>
            <div className="flex gap-1.5 items-center">
              <Input size="sm" value={urlWebhook} readOnly aria-label="Callback URL" />
              <IconButton icon={Copy} variant="secondary" size="sm" ariaLabel="Copiar callback URL" onClick={() => copiar(urlWebhook, 'URL')} />
            </div>
            <p className="m-0 text-[11px] text-[var(--text-muted)] mt-1">
              Essa URL é a mesma para todo mundo — o que identifica o seu bot é o verify token acima.
            </p>
          </div>
        </div>
      )}

      {passo === 4 && (
        <>
          <div className="p-4 flex gap-3 items-start border-b border-[var(--border-subtle)]">
            <span
              className={clsx(
                'flex-shrink-0 w-10 h-10 rounded-full grid place-items-center',
                feitos[4] ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'bg-[var(--warning-soft)] text-[var(--warning-text)]'
              )}
              aria-hidden="true"
            >
              {feitos[4] ? <CheckCircle2 size={20} /> : <Info size={20} />}
            </span>
            <div className="flex-1 min-w-0">
              <strong className="text-[15px] text-[var(--text-main)]">
                {feitos[4] ? 'WhatsApp oficial configurado' : 'Ainda falta salvar algum passo'}
              </strong>
              <div className="text-[13px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                {feitos[4]
                  ? 'O bot recebe e responde pela API oficial. Os modelos de mensagem são aprovados no painel da Meta.'
                  : 'Confira os passos sem o ✓, preencha e clique em Salvar conexão.'}
              </div>
            </div>
          </div>
          <div>
            <LinhaInfo rotulo="Phone Number ID" valor={(ehOficial && bot.identificadorCanal) || '—'} />
            <LinhaInfo rotulo="Credencial" valor={credSelecionada?.nome || (feitos[2] ? 'Selecionada' : '—')} />
            <LinhaInfo rotulo="Verify token" valor={feitos[3] ? 'Definido' : '—'} />
          </div>
        </>
      )}

      <div className="px-4 py-3 flex flex-wrap gap-2 items-center border-t border-[var(--border-subtle)]">
        <Button variant="secondary" size="sm" onClick={() => setPasso((p) => Math.max(1, p - 1))} disabled={passo === 1}>
          Voltar
        </Button>
        <span className="flex-1" />
        {feitos[4] && (
        <Link
          to="/app/campanhas"
          className="h-9 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] font-semibold text-[var(--text-main)] inline-flex items-center gap-1.5 hover:bg-[var(--bg-subtle)]"
        >
          <Megaphone size={14} aria-hidden="true" /> Criar campanha
        </Link>
        )}
        <Button variant={passo === 4 ? 'primary' : 'secondary'} size="sm" onClick={salvarCanal} loading={salvandoCanal}>
          Salvar conexão
        </Button>
        {passo < 4 && (
          <Button variant="primary" size="sm" onClick={() => setPasso((p) => Math.min(4, p + 1))}>
            Continuar
          </Button>
        )}
      </div>
    </Painel>
  );
}
