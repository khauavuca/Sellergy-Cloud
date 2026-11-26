import { MessageCircle, Plus, Trash2 } from 'lucide-react';
import { Painel, Badge, Button, Input, Switch, IconButton, EmptyState } from '../ui';

// Menu de perguntas do bot (modo sem IA): adicionar, ligar/desligar,
// editar palavras-chave (salva ao sair do campo) e excluir.
export default function PainelPerguntasBot({
  faqs, novaFaq, setNovaFaq, adicionarFaq, alternarFaqAtivo, editandoChaves, setEditandoChaves, salvarChaves, excluirFaq,
}) {
  const th = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
  const td = 'px-4 py-2.5 border-b border-[var(--border-subtle)] align-top';

  return (
    <Painel
      titulo="Perguntas do menu"
      subtitulo="O bot responde com base nessas perguntas e nas palavras-chave. Sem IA."
      acoes={<Badge variant="neutral" size="sm">{faqs.length} {faqs.length === 1 ? 'pergunta' : 'perguntas'}</Badge>}
      semPadding
    >
      <form
        className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end px-4 py-3 border-b border-[var(--border-subtle)]"
        onSubmit={(e) => { e.preventDefault(); adicionarFaq(); }}
      >
        <Input
          size="sm"
          label="Pergunta"
          aria-label="Pergunta"
          value={novaFaq.pergunta}
          onChange={(e) => setNovaFaq({ ...novaFaq, pergunta: e.target.value })}
          placeholder="Ex: Qual o horário?"
        />
        <Input
          size="sm"
          label="Resposta"
          aria-label="Resposta"
          value={novaFaq.resposta}
          onChange={(e) => setNovaFaq({ ...novaFaq, resposta: e.target.value })}
          placeholder="Ex: Seg a sex, 9h às 18h."
        />
        <Input
          size="sm"
          label="Palavras-chave (opcional)"
          aria-label="Palavras-chave (opcional), separadas por vírgula"
          value={novaFaq.palavrasChave}
          onChange={(e) => setNovaFaq({ ...novaFaq, palavrasChave: e.target.value })}
          placeholder="horário, abre, fecha"
        />
        <Button type="submit" variant="secondary" size="sm" icon={Plus}>Adicionar</Button>
      </form>

      {faqs.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="Sem perguntas ainda"
          description="Adicione a primeira pergunta para o bot começar a responder."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={th}>Pergunta e resposta</th>
                <th className={th}>Palavras-chave</th>
                <th className={th}>Ativa</th>
                <th className={th}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {faqs.map((f) => (
                <tr key={f.id}>
                  <td className={td}>
                    <div className="font-semibold text-[var(--text-main)]">{f.pergunta}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">{f.resposta}</div>
                  </td>
                  <td className={`${td} min-w-[220px]`}>
                    <Input
                      size="sm"
                      aria-label={`Palavras-chave de "${f.pergunta}" (separadas por vírgula)`}
                      placeholder="Separadas por vírgula"
                      value={editandoChaves[f.id] ?? (f.palavrasChave || []).join(', ')}
                      onChange={(e) => setEditandoChaves((s) => ({ ...s, [f.id]: e.target.value }))}
                      onBlur={() => { if (editandoChaves[f.id] !== undefined) salvarChaves(f); }}
                    />
                  </td>
                  <td className={td}>
                    <div className="h-9 flex items-center">
                      <Switch checked={!!f.ativo} onChange={() => alternarFaqAtivo(f)} ariaLabel={`Pergunta "${f.pergunta}" ativa`} />
                    </div>
                  </td>
                  <td className={`${td} text-right`}>
                    <IconButton icon={Trash2} variant="danger" size="sm" ariaLabel={`Excluir "${f.pergunta}"`} onClick={() => excluirFaq(f)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Painel>
  );
}
