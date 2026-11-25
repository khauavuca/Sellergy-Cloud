import clsx from 'clsx';
import { Save } from 'lucide-react';
import { Painel, LinhaInfo, Badge, Button, Switch, Textarea } from '../ui';

// Coluna da direita: liga/desliga o bot, mostra como ele responde (IA ou
// menu de perguntas — quem escolhe é o administrador, em admin/bots) e, com
// IA, o texto do negócio e as ações que ela pode fazer sozinha.
export default function PainelBotAtendimento({
  bot, online, alternarStatus, iaForm, setIaForm, alternarAcaoBot, acoesDisponiveis, tamMaxPrompt,
  salvarIA, salvandoIA, consumoIA, faqs, tempoRelativo,
}) {
  const ehIA = !!bot.iaAtiva;
  const faqsAtivas = faqs.filter((f) => f.ativo).length;
  // A cota é do negócio (soma de todos os bots) + pacote extra autorizado.
  const usadoIA = consumoIA ? (consumoIA.tokensUsadosCliente ?? consumoIA.tokensUsados ?? 0) : 0;
  const limiteIA = consumoIA ? (consumoIA.limiteTokens ?? consumoIA.tokensIncluidosMes ?? 0) : 0;
  const pctIA = consumoIA && limiteIA > 0 ? Math.round((usadoIA / limiteIA) * 100) : null;
  const fmtTokens = (n) => {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`;
    if (v >= 1_000) return `${Math.round(v / 1_000).toLocaleString('pt-BR')} mil`;
    return v.toLocaleString('pt-BR');
  };
  const avisoIA = consumoIA?.iaPausadaNaPlataforma
    ? 'A IA está pausada na plataforma por hoje. O bot responde pelo menu de perguntas.'
    : consumoIA?.cotaEsgotada
      ? 'A cota de IA do mês acabou. Até o mês virar, o bot responde pelo menu de perguntas, sem IA.'
      : null;

  return (
    <Painel
      titulo="Bot de atendimento"
      acoes={<Badge variant={online ? 'success' : 'neutral'} size="sm">{online ? 'Online' : 'Offline'}</Badge>}
      semPadding
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-[var(--text-main)]">Responder sozinho</div>
          <div className="text-xs text-[var(--text-muted)]">{online ? 'O bot está respondendo as mensagens.' : 'O bot está desligado.'}</div>
        </div>
        <Switch checked={online} onChange={alternarStatus} ariaLabel="Ligar ou desligar o bot" />
      </div>

      <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)]">Como o bot responde</span>
        <div className="flex gap-1 bg-[var(--bg-subtle)] rounded-[10px] p-1" role="group" aria-label="Modo do bot (definido pelo administrador)">
          {[{ t: 'Com IA', on: ehIA }, { t: 'Menu de perguntas', on: !ehIA }].map((m) => (
            <span
              key={m.t}
              aria-current={m.on ? 'true' : undefined}
              className={clsx(
                'flex-1 h-8 rounded-lg grid place-items-center text-[13px] font-semibold',
                m.on ? 'bg-[var(--text-main)] text-[var(--bg-card)]' : 'text-[var(--text-muted)]'
              )}
            >
              {m.t}
            </span>
          ))}
        </div>
        <span className="text-xs text-[var(--text-muted)] leading-relaxed">
          {ehIA
            ? `Entende texto livre e usa as informações do negócio. Modelo: ${bot.iaModelo || '—'}.`
            : 'Sem IA: responde com base nas perguntas e respostas cadastradas e nas palavras-chave.'}
          {' '}O modo é definido pelo administrador.
        </span>
      </div>

      {ehIA && (
        <>
          <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
            <Textarea
              label="Informações do negócio para a IA"
              aria-label="Informações do negócio para a IA"
              rows={5}
              value={iaForm.iaPromptSistema}
              onChange={(e) => setIaForm((f) => ({ ...f, iaPromptSistema: e.target.value.slice(0, tamMaxPrompt) }))}
              placeholder="Ex: Somos a Boutique Bella, funcionamos de seg a sáb das 9h às 18h. Trocas em até 7 dias com nota fiscal. Aceitamos Pix e cartão..."
              hint={`${iaForm.iaPromptSistema.length}/${tamMaxPrompt} caracteres · nome, horários, trocas, pagamentos e tom de voz.`}
            />
          </div>
          <div className="px-4 pt-2.5 pb-1 text-xs font-medium text-[var(--text-muted)]">O que a IA pode fazer sozinha</div>
          {acoesDisponiveis.map((acao) => (
            <div key={acao.chave} className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border-subtle)]">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[var(--text-main)]">{acao.titulo}</div>
                <div className="text-xs text-[var(--text-muted)] leading-snug mt-0.5">{acao.descricao}</div>
              </div>
              <Switch
                checked={iaForm.acoesPermitidas.includes(acao.chave)}
                onChange={() => alternarAcaoBot(acao.chave)}
                ariaLabel={acao.titulo}
              />
            </div>
          ))}
        </>
      )}

      <div>
        <LinhaInfo rotulo="Mensagens hoje" valor={(bot.mensagensHoje ?? 0).toLocaleString('pt-BR')} forte />
        <LinhaInfo rotulo="Total de mensagens" valor={(bot.totalMensagens ?? 0).toLocaleString('pt-BR')} />
        <LinhaInfo rotulo="Última atividade" valor={tempoRelativo(bot.ultimaAtividadeEm)} />
        {ehIA ? (
          <LinhaInfo
            rotulo="Consumo de IA (mês)"
            valor={consumoIA ? `${fmtTokens(usadoIA)} de ${fmtTokens(limiteIA)} tokens` : '—'}
          >
            {pctIA != null && (
              <div className="basis-full h-1.5 rounded-full bg-[var(--bg-subtle)]" role="progressbar" aria-label="Consumo de IA do mês" aria-valuenow={Math.min(100, pctIA)} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className={clsx('h-1.5 rounded-full', pctIA >= 100 ? 'bg-[var(--danger)]' : pctIA >= 90 ? 'bg-[var(--warning)]' : 'bg-[var(--primary)]')}
                  style={{ width: `${Math.min(100, pctIA)}%` }}
                />
              </div>
            )}
            {consumoIA && (
              <span className="basis-full text-xs text-[var(--text-muted)] leading-snug">
                {`Cota do plano: ${fmtTokens(consumoIA.tokensIncluidosMes)} tokens por mês (cerca de ${Math.round((consumoIA.tokensIncluidosMes || 0) / 3300).toLocaleString('pt-BR')} respostas)`}
                {consumoIA.excedenteAutorizadoTokens > 0 ? ` + ${fmtTokens(consumoIA.excedenteAutorizadoTokens)} do pacote extra` : ''}
                {`. Restam ${fmtTokens(consumoIA.tokensRestantes ?? Math.max(0, limiteIA - usadoIA))}.`}
              </span>
            )}
            {avisoIA && (
              <span role="status" className="basis-full text-xs font-medium text-[var(--warning-text)] leading-snug">{avisoIA}</span>
            )}
          </LinhaInfo>
        ) : (
          <LinhaInfo rotulo="Perguntas ativas no menu" valor={`${faqsAtivas} de ${faqs.length}`} />
        )}
      </div>

      {ehIA && (
        <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
          <Button variant="primary" icon={Save} onClick={salvarIA} loading={salvandoIA} fullWidth>
            Salvar
          </Button>
        </div>
      )}
    </Painel>
  );
}
