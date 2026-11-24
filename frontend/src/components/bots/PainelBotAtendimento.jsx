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
  const pctIA = consumoIA && consumoIA.tokensIncluidosMes > 0
    ? Math.round((consumoIA.tokensUsados / consumoIA.tokensIncluidosMes) * 100)
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
            valor={consumoIA
              ? `${consumoIA.tokensUsados.toLocaleString('pt-BR')} / ${consumoIA.tokensIncluidosMes.toLocaleString('pt-BR')}`
              : '—'}
          >
            {pctIA != null && (
              <div className="basis-full h-1.5 rounded-full bg-[var(--bg-subtle)]" role="progressbar" aria-label="Consumo de IA do mês" aria-valuenow={Math.min(100, pctIA)} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className={clsx('h-1.5 rounded-full', pctIA >= 90 ? 'bg-[var(--warning)]' : 'bg-[var(--primary)]')}
                  style={{ width: `${Math.min(100, pctIA)}%` }}
                />
              </div>
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
