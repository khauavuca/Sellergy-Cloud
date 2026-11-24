// Modal "Nova campanha" em passos (Público → Mensagem → Revisar), com resumo
// e prévia no celular à direita. Cria a campanha como rascunho pelo mesmo
// POST /campanhas de antes; o disparo continua sendo feito pela lista.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, Info, Ticket } from 'lucide-react';
import api from '../../services/api';
import Modal from '../Modal';
import { Button, Input, Select, Textarea, Switch, LabelAjuda, Badge, LinhaInfo } from '../ui';
import PreviaCelular from './PreviaCelular';
import { SEGMENTOS, JANELAS, fmtBRL, fmtNum, urlSegmento, contarResposta } from './constantes';

const PASSOS = [
  { n: 1, titulo: 'Público', desc: 'Pra quem vai' },
  { n: 2, titulo: 'Mensagem', desc: 'Texto, modelo e cupom' },
  { n: 3, titulo: 'Revisar', desc: 'Conferir e criar' },
];

const VARIAVEIS = ['[nome]', '[cupom]'];

export default function NovaCampanhaModal({ form, setForm, onCriar, onFechar, salvando, remetente, toast }) {
  const [passo, setPasso] = useState(1);
  const [publico, setPublico] = useState({ carregando: true, qtd: 0 });
  const textoRef = useRef(null);

  // Quantos leads caem no segmento escolhido (mesmos endpoints da página).
  useEffect(() => {
    let ativo = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marca carregando ao trocar o segmento
    setPublico((p) => ({ ...p, carregando: true }));
    api.get(urlSegmento(form.segmento, form.dias))
      .then((r) => { if (ativo) setPublico({ carregando: false, qtd: contarResposta(form.segmento, r.data) }); })
      .catch(() => { if (ativo) setPublico({ carregando: false, qtd: null }); });
    return () => { ativo = false; };
  }, [form.segmento, form.dias]);

  const segInfo = SEGMENTOS.find((s) => s.valor === form.segmento);
  const janela = JANELAS.find((j) => j.value === form.dias);
  const textoPublico = form.segmento === 'recompra' ? `${segInfo?.label} · ${form.dias}+ dias` : segInfo?.label;
  const qtdTexto = publico.carregando ? 'contando…' : publico.qtd == null ? '—' : `${fmtNum(publico.qtd)} cliente(s)`;

  const valorCupom = form.cupomValor
    ? (form.cupomTipo === 'PERCENTUAL' ? `${form.cupomValor}%` : fmtBRL(form.cupomValor))
    : '';
  const textoCupomForm = form.incluirCupom
    ? [form.cupomCodigo || 'Sem código', valorCupom].filter(Boolean).join(' · ')
    : 'Sem cupom';

  const previa = form.mensagem
    .split('[cupom]')
    .join(form.incluirCupom && form.cupomCodigo ? form.cupomCodigo : '[cupom]');

  const inserirVariavel = (v) => {
    const el = textoRef.current;
    const atual = form.mensagem;
    const ini = el?.selectionStart ?? atual.length;
    const fim = el?.selectionEnd ?? atual.length;
    const novo = atual.slice(0, ini) + v + atual.slice(fim);
    setForm({ ...form, mensagem: novo });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(ini + v.length, ini + v.length);
    });
  };

  const validarMensagem = () => {
    if (!form.nome.trim()) { toast.error('Informe o nome da campanha.'); return false; }
    if (!form.mensagem.trim()) { toast.error('Informe a mensagem da campanha.'); return false; }
    if (form.incluirCupom && (!form.cupomCodigo.trim() || !form.cupomValor)) {
      toast.error('Preencha o código e o valor do cupom, ou desligue o cupom.');
      return false;
    }
    return true;
  };

  const irPara = (n) => {
    if (n === passo) return;
    if (n === 3 && !validarMensagem()) return;
    setPasso(n);
  };

  const avancar = () => {
    if (passo === 3) { onCriar(); return; }
    irPara(passo + 1);
  };

  return (
    <Modal
      isOpen
      onClose={onFechar}
      title="Nova campanha"
      description="Escolha o público, escreva a mensagem e, se quiser, um cupom de desconto."
      size="2xl"
    >
      <div className="flex flex-col gap-4">
        {/* Passos */}
        <nav aria-label="Passos da campanha" className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] p-1.5">
          <ol className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 m-0 p-0 list-none">
            {PASSOS.map((p) => {
              const feito = p.n < passo;
              const atual = p.n === passo;
              return (
                <li key={p.n}>
                  <button
                    type="button"
                    onClick={() => irPara(p.n)}
                    aria-current={atual ? 'step' : undefined}
                    className={clsx(
                      'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors',
                      atual ? 'bg-[var(--primary-soft)]' : 'hover:bg-[var(--bg-subtle)]'
                    )}
                  >
                    <span
                      className={clsx(
                        'w-6 h-6 rounded-full grid place-items-center text-xs font-bold flex-shrink-0',
                        atual || feito ? 'bg-[var(--primary)] text-[var(--text-on-primary)]' : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'
                      )}
                    >
                      {feito ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : p.n}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-[var(--text-main)]">{p.titulo}</span>
                      <span className="block text-xs text-[var(--text-muted)] truncate">{p.desc}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex flex-wrap gap-4 items-start">
          {/* Passo atual */}
          <section
            aria-label="Passo atual"
            className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] min-w-0"
            style={{ flex: '999 1 420px' }}
          >
            {passo === 1 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--border-subtle)]">
                  <h4 className="m-0 text-sm font-bold text-[var(--text-main)]">Pra quem vai</h4>
                  <Badge variant="success" size="sm">{qtdTexto}</Badge>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Segmento alvo">
                  {SEGMENTOS.map((s) => {
                    const sel = form.segmento === s.valor;
                    const Icone = s.icon;
                    return (
                      <button
                        key={s.valor}
                        type="button"
                        role="radio"
                        aria-checked={sel}
                        onClick={() => setForm({ ...form, segmento: s.valor })}
                        className={clsx(
                          'flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                          sel
                            ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
                            : 'border-[var(--border-main)] hover:border-[var(--border-strong)]'
                        )}
                      >
                        <Icone size={16} aria-hidden="true" className="mt-0.5 flex-shrink-0 text-[var(--text-secondary)]" />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-[var(--text-main)]">{s.label}</span>
                          <span className="block text-xs text-[var(--text-muted)]">{s.criterio}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {form.segmento === 'recompra' && (
                  <div className="px-4 pb-4">
                    <Select
                      label="Janela de recompra"
                      size="sm"
                      value={form.dias}
                      onChange={(e) => setForm({ ...form, dias: e.target.value })}
                      options={JANELAS}
                      placeholder=""
                    />
                  </div>
                )}
                <div className="flex items-start gap-2 px-4 py-3 border-t border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                  <Info size={14} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
                  <span>{segInfo?.aviso}</span>
                </div>
              </>
            )}

            {passo === 2 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--border-subtle)]">
                  <h4 className="m-0 text-sm font-bold text-[var(--text-main)]">Mensagem</h4>
                  {form.nomeTemplate.trim()
                    ? <Badge variant="success" size="sm">Modelo informado</Badge>
                    : <Badge variant="warning" size="sm">Sem modelo · não dá pra disparar</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                  <span className="text-xs text-[var(--text-muted)]">Público</span>
                  <Badge variant="info" size="sm">{textoPublico} · {qtdTexto}</Badge>
                  <Button variant="secondary" size="sm" onClick={() => setPasso(1)}>Alterar</Button>
                </div>
                <div className="p-4 flex flex-col gap-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Nome da campanha"
                      size="sm"
                      value={form.nome}
                      onChange={(e) => setForm({ ...form, nome: e.target.value })}
                      placeholder="Ex: Volta com desconto · julho"
                      autoFocus
                    />
                    <Input
                      label={
                        <LabelAjuda
                          texto="Nome do modelo aprovado na Meta"
                          ajuda="A Meta bloqueia mensagem automática em massa fora da janela de 24h — só libera com um template (HSM) aprovado no Meta Business Manager. Crie o template lá primeiro e cole o nome exato aqui. Sem isso, a campanha fica salva como rascunho, mas não dá pra disparar."
                        />
                      }
                      size="sm"
                      value={form.nomeTemplate}
                      onChange={(e) => setForm({ ...form, nomeTemplate: e.target.value })}
                      placeholder="Ex: promocao_recompra_10off"
                    />
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                      <span className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] mr-auto">Texto</span>
                      <span className="text-xs text-[var(--text-muted)]">Inserir:</span>
                      {VARIAVEIS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => inserirVariavel(v)}
                          aria-label={`Inserir ${v} no texto`}
                          className="h-7 px-2 rounded-md border border-[var(--border-main)] bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    <Textarea
                      ref={textoRef}
                      aria-label="Texto da mensagem"
                      value={form.mensagem}
                      onChange={(e) => setForm({ ...form, mensagem: e.target.value })}
                      rows={5}
                      placeholder="Ex: Oi, [nome]! Sentimos sua falta. Volte essa semana e ganhe 10% de desconto com o cupom [cupom]."
                    />
                    <div className="flex flex-wrap justify-between gap-2 mt-1 text-xs text-[var(--text-muted)]">
                      <span>Texto de referência: o que sai no WhatsApp é o do modelo aprovado na Meta.</span>
                      <span className="tabular-nums">{fmtNum(form.mensagem.length)} caractere(s)</span>
                    </div>
                  </div>

                  <div className="rounded-[10px] border border-[var(--border-main)]">
                    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <span className="flex items-start gap-2 min-w-0">
                        <Ticket size={15} aria-hidden="true" className="mt-0.5 flex-shrink-0 text-[var(--text-secondary)]" />
                        <span>
                          <span className="block text-[13px] font-semibold text-[var(--text-main)]">Incluir cupom de desconto</span>
                          <span className="block text-xs text-[var(--text-muted)]">Use [cupom] no texto pra lembrar onde o código entra.</span>
                        </span>
                      </span>
                      <Switch checked={form.incluirCupom} onChange={(v) => setForm({ ...form, incluirCupom: v })} ariaLabel="Incluir cupom de desconto" />
                    </div>

                    {form.incluirCupom && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-3 pb-3 pt-1 border-t border-[var(--border-subtle)]">
                        <Input
                          label="Código do cupom"
                          size="sm"
                          value={form.cupomCodigo}
                          onChange={(e) => setForm({ ...form, cupomCodigo: e.target.value.toUpperCase() })}
                          placeholder="VOLTA10"
                        />
                        <div>
                          <span className="block text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5" id="nc-tipo-desc">Tipo de desconto</span>
                          <div role="radiogroup" aria-labelledby="nc-tipo-desc" className="flex rounded-xl border border-[var(--border-main)] overflow-hidden h-9">
                            {[['PERCENTUAL', '%'], ['VALOR', 'R$']].map(([val, lab]) => (
                              <button
                                key={val}
                                type="button"
                                role="radio"
                                aria-checked={form.cupomTipo === val}
                                aria-label={val === 'PERCENTUAL' ? 'Percentual' : 'Valor em reais'}
                                onClick={() => setForm({ ...form, cupomTipo: val })}
                                className={clsx(
                                  'flex-1 text-sm font-semibold transition-colors',
                                  form.cupomTipo === val ? 'bg-[var(--primary)] text-[var(--text-on-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]'
                                )}
                              >
                                {lab}
                              </button>
                            ))}
                          </div>
                        </div>
                        <Input
                          label={form.cupomTipo === 'PERCENTUAL' ? 'Desconto (%)' : 'Desconto (R$)'}
                          size="sm"
                          type="number"
                          min="0"
                          max={form.cupomTipo === 'PERCENTUAL' ? '100' : undefined}
                          value={form.cupomValor}
                          onChange={(e) => setForm({ ...form, cupomValor: e.target.value })}
                        />
                        <Input
                          label="Válido até (opcional)"
                          size="sm"
                          type="date"
                          value={form.cupomValidoAte}
                          onChange={(e) => setForm({ ...form, cupomValidoAte: e.target.value })}
                        />
                        <Input
                          label="Limite de usos (opcional)"
                          size="sm"
                          type="number"
                          min="1"
                          value={form.cupomUsoMaximo}
                          onChange={(e) => setForm({ ...form, cupomUsoMaximo: e.target.value })}
                          placeholder="Sem limite"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {passo === 3 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--border-subtle)]">
                  <h4 className="m-0 text-sm font-bold text-[var(--text-main)]">Conferir antes de criar</h4>
                  <Badge variant="neutral" size="sm">Fica como rascunho</Badge>
                </div>
                <LinhaInfo rotulo="Nome" valor={form.nome || '—'} />
                <LinhaInfo rotulo="Público" valor={textoPublico} />
                {form.segmento === 'recompra' && <LinhaInfo rotulo="Janela" valor={janela?.label} />}
                <LinhaInfo rotulo="Modelo na Meta" valor={form.nomeTemplate.trim() || 'Falta o modelo'} />
                <LinhaInfo rotulo="Cupom" valor={textoCupomForm} />
                {form.incluirCupom && form.cupomValidoAte && (
                  <LinhaInfo rotulo="Cupom válido até" valor={new Date(`${form.cupomValidoAte}T12:00:00`).toLocaleDateString('pt-BR')} />
                )}
                {form.incluirCupom && <LinhaInfo rotulo="Limite de usos" valor={form.cupomUsoMaximo || 'Sem limite'} />}
                <div className="flex items-start gap-2 px-4 py-3 text-xs text-[var(--text-muted)]">
                  <Info size={14} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
                  <span>
                    A campanha é criada como rascunho. O disparo é feito depois, pela lista de campanhas,
                    {form.nomeTemplate.trim() ? ' quando você quiser.' : ' e só fica liberado com o nome do modelo aprovado na Meta.'}
                  </span>
                </div>
              </>
            )}

            {/* Rodapé dos passos */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-[var(--border-subtle)]">
              {passo > 1 && <Button variant="secondary" size="sm" onClick={() => setPasso(passo - 1)}>Voltar</Button>}
              <Button variant="ghost" size="sm" onClick={onFechar}>Cancelar</Button>
              <span className="flex-1" />
              <span className="text-xs text-[var(--text-muted)]">Passo {passo} de {PASSOS.length}</span>
              <Button variant="primary" size="sm" onClick={avancar} loading={passo === 3 && salvando}>
                {passo === 3 ? 'Criar campanha' : 'Continuar'}
              </Button>
            </div>
          </section>

          {/* Resumo + prévia */}
          <aside aria-label="Resumo e prévia" className="min-w-0 flex flex-col gap-4" style={{ flex: '1 1 280px' }}>
            <section className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)]">
              <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--border-subtle)]">
                <h4 className="m-0 text-sm font-bold text-[var(--text-main)]">Resumo do envio</h4>
              </div>
              <LinhaInfo rotulo="Recebem" valor={qtdTexto} forte />
              <LinhaInfo rotulo="Público" valor={textoPublico} />
              <LinhaInfo rotulo="Cupom" valor={textoCupomForm} />
            </section>
            <section className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--border-subtle)]">
                <h4 className="m-0 text-sm font-bold text-[var(--text-main)]">Como chega no celular</h4>
              </div>
              <PreviaCelular texto={previa} remetente={remetente} />
            </section>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
