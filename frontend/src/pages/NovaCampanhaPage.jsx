// Tela "Nova campanha" em 4 passos (Objetivo → Público → Mensagem → Envio),
// com o resumo do envio e a prévia no celular à direita (mockup aprovado).
// Cria pelo POST /campanhas; "Enviar agora" chama /:id/disparar e "Agendar"
// chama /:id/agendar (o cron dispara na hora).
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Check, Info, Save } from 'lucide-react';
import api from '../services/api';
import {
  Button, Input, Select, Textarea, Switch, Badge, useToast, Pagina, ColunasPagina, Painel, LinhaInfo,
} from '../components/ui';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import { usePermissao } from '../hooks/usePermissao';
import { useAuthStore } from '../store/auth.store';
import PreviaCelular from '../components/campanhas/PreviaCelular';
import {
  SEGMENTOS, JANELAS, OBJETIVOS, BOTOES_MENSAGEM, VARIAVEIS, MAX_MENSAGEM, FORM_CAMPANHA_VAZIO,
  fmtBRL, fmtNum, montarPrevia,
} from '../components/campanhas/constantes';

const PASSOS = ['Objetivo', 'Público', 'Mensagem', 'Envio'];
const RODAPE_SAIR = 'Pra não receber mais mensagens assim, responda SAIR.';
const RITMO = {
  OFICIAL: '1 a cada 3 segundos, pra proteger o número',
  QR_CODE: '1 a cada 25 a 55 segundos, das 8h às 20h, com limite por dia',
};
const NOME_CANAL = { OFICIAL: 'Oficial', QR_CODE: 'WhatsApp Web' };

const hojeISO = () => new Date().toLocaleDateString('en-CA');
const amanhaISO = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
const quandoAgendado = (f) => (f.agendarData && f.agendarHora ? new Date(`${f.agendarData}T${f.agendarHora}:00`) : null);
const fmtQuando = (d) => (d && !Number.isNaN(d.getTime())
  ? d.toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : 'Escolha o dia e a hora');

/** Cartão de opção (objetivo, botão, quando enviar). */
function Opcao({ ativo, titulo, desc, onClick, disabled }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors min-w-0',
        ativo
          ? 'border-[var(--primary)] bg-[var(--primary-soft)] shadow-[0_0_0_1px_var(--primary)]'
          : 'border-[var(--border-main)] bg-[var(--bg-card)] hover:border-[var(--border-strong)]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span className="min-w-0">
        <strong className="block text-[13px] text-[var(--text-main)]">{titulo}</strong>
        <span className="block text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">{desc}</span>
      </span>
    </button>
  );
}

function CabecalhoPasso({ titulo, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--border-subtle)]">
      <h2 className="m-0 text-sm font-bold text-[var(--text-main)]">{titulo}</h2>
      {children}
    </div>
  );
}

function Linha({ children, className }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-[var(--border-subtle)] text-[13px] text-[var(--text-main)] min-w-0', className)}>
      {children}
    </div>
  );
}

export default function NovaCampanhaPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const podeCriar = usePermissao('CRM', 'criar');
  const podeDisparar = usePermissao('CRM', 'editar');
  const user = useAuthStore((s) => s.user);
  const remetente = user?.branding?.nome || 'Sua loja';
  const podeCupom = ['CLIENT', 'ADMINISTRADOR', 'ADMIN'].includes(user?.perfil);

  const [form, setForm] = useState(() => ({ ...FORM_CAMPANHA_VAZIO, ...(location.state?.form || {}) }));
  const [passo, setPasso] = useState(location.state?.form ? 3 : 1);
  const [publico, setPublico] = useState({ carregando: true, dados: null });
  const [salvando, setSalvando] = useState(false);
  const [filtroGasto, setFiltroGasto] = useState(() => !!location.state?.form?.gastoMinimo);
  const textoRef = useRef(null);

  const mudar = (campos) => setForm((f) => ({ ...f, ...campos }));

  // Quantos recebem / ficam de fora, por qual canal e número (dado do backend).
  const gastoEfetivo = filtroGasto ? form.gastoMinimo : '';
  useEffect(() => {
    let ativo = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marca carregando ao trocar o público
    setPublico((p) => ({ ...p, carregando: true }));
    const t = setTimeout(() => {
      const q = new URLSearchParams({ segmento: form.segmento, dias: form.dias });
      if (gastoEfetivo) q.set('gastoMinimo', gastoEfetivo);
      api.get(`/campanhas/publico?${q}`)
        .then((r) => { if (ativo) setPublico({ carregando: false, dados: r.data }); })
        .catch(() => { if (ativo) setPublico({ carregando: false, dados: null }); });
    }, 350);
    return () => { ativo = false; clearTimeout(t); };
  }, [form.segmento, form.dias, gastoEfetivo]);

  const dados = publico.dados;
  const canal = dados?.canal || null;
  const recebem = dados?.recebem ?? 0;
  const segInfo = SEGMENTOS.find((s) => s.valor === form.segmento);
  const objInfo = OBJETIVOS.find((o) => o.valor === form.objetivo);
  const botaoInfo = BOTOES_MENSAGEM.find((b) => b.valor === form.botao);
  const qtdTexto = publico.carregando ? 'contando…' : dados ? `${fmtNum(recebem)} cliente(s)` : '—';
  const textoPublico = [
    segInfo?.label,
    form.segmento === 'recompra' ? `${form.dias}+ dias` : null,
    filtroGasto && form.gastoMinimo ? `gastou mais de ${fmtBRL(String(form.gastoMinimo).replace(',', '.'))}` : null,
  ].filter(Boolean).join(' · ');
  const agendado = quandoAgendado(form);
  const cupomAtivo = podeCupom && form.incluirCupom;
  const valorCupom = form.cupomValor ? (form.cupomTipo === 'PERCENTUAL' ? `${form.cupomValor}%` : fmtBRL(String(form.cupomValor).replace(',', '.'))) : '';

  // Prévia: mesmo texto que o backend monta (campanhaTexto.js), com dados de exemplo.
  const previa = (() => {
    const corpo = montarPrevia(form.mensagem, { cupom: cupomAtivo ? form.cupomCodigo : '', link: dados?.linkAgendamento });
    if (!corpo.trim()) return { texto: '', botoes: [] };
    if (canal === 'QR_CODE') {
      const partes = [corpo.trim()];
      if (form.botao === 'MARCAR_HORARIO' && dados?.linkAgendamento) partes.push(`Marcar horário: ${dados.linkAgendamento}`);
      partes.push(RODAPE_SAIR);
      return { texto: partes.join('\n\n'), botoes: [] };
    }
    return { texto: corpo, botoes: [botaoInfo?.titulo, 'Não quero receber'].filter(Boolean) };
  })();

  const escolherObjetivo = (o) => {
    const textoAtual = form.mensagem.trim();
    const ehModelo = !textoAtual || OBJETIVOS.some((x) => x.texto === textoAtual);
    const campos = { objetivo: o.valor, ...o.preencher };
    if (!podeCupom) campos.incluirCupom = false;
    if (ehModelo) campos.mensagem = o.texto;
    if (!form.nome.trim()) {
      campos.nome = `${o.titulo} · ${new Date().toLocaleDateString('pt-BR', { month: 'long' })}`;
    }
    mudar(campos);
  };

  const inserirVariavel = (v) => {
    const el = textoRef.current;
    const atual = form.mensagem;
    const ini = el?.selectionStart ?? atual.length;
    const fim = el?.selectionEnd ?? atual.length;
    mudar({ mensagem: (atual.slice(0, ini) + v + atual.slice(fim)).slice(0, MAX_MENSAGEM) });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(ini + v.length, ini + v.length);
    });
  };

  const validarMensagem = () => {
    if (!form.nome.trim()) { toast.error('Informe o nome da campanha.'); return false; }
    if (!form.mensagem.trim()) { toast.error('Escreva o texto da mensagem.'); return false; }
    if (cupomAtivo && (!form.cupomCodigo.trim() || !form.cupomValor)) {
      toast.error('Preencha o código e o valor do cupom, ou desligue o cupom.');
      return false;
    }
    return true;
  };

  const irPara = (n) => {
    if (n === passo) return;
    if (n === 4 && !validarMensagem()) return;
    setPasso(n);
  };

  const salvar = async (modo) => {
    if (!validarMensagem()) { setPasso(3); return; }
    if (modo !== 'rascunho') {
      if (canal === 'OFICIAL' && !form.nomeTemplate.trim()) {
        toast.error('Informe o nome do modelo aprovado na Meta para enviar.');
        setPasso(3);
        return;
      }
      if (modo === 'agendar' && (!agendado || Number.isNaN(agendado.getTime()))) {
        toast.error('Escolha o dia e a hora do envio.');
        return;
      }
    }
    setSalvando(true);
    let criada = null;
    try {
      const r = await api.post('/campanhas', {
        nome: form.nome.trim(),
        objetivo: form.objetivo || undefined,
        segmento: form.segmento,
        diasRecompra: form.segmento === 'recompra' ? form.dias : undefined,
        gastoMinimo: filtroGasto && form.gastoMinimo ? form.gastoMinimo : undefined,
        mensagem: form.mensagem.trim(),
        nomeTemplate: form.nomeTemplate.trim() || undefined,
        botao: form.botao || undefined,
        cupom: cupomAtivo ? {
          codigo: form.cupomCodigo.trim(),
          tipo: form.cupomTipo,
          valor: form.cupomValor,
          validoAte: form.cupomValidoAte || undefined,
          usoMaximo: form.cupomUsoMaximo || undefined,
        } : undefined,
      });
      criada = r.data;
      if (modo === 'agora') {
        const d = await api.post(`/campanhas/${criada.id}/disparar`);
        toast.success(`Envio começou: ${fmtNum(d.data.totalAlvo)} cliente(s) na fila.`);
      } else if (modo === 'agendar') {
        await api.post(`/campanhas/${criada.id}/agendar`, { agendadoPara: agendado.toISOString() });
        toast.success(`Campanha agendada para ${fmtQuando(agendado)}.`);
      } else {
        toast.success('Campanha salva como rascunho.');
      }
      navigate('/app/campanhas', { state: { selId: criada.id } });
    } catch (e) {
      const erro = e.response?.data?.erro;
      if (criada) {
        toast.error(`Campanha salva como rascunho, mas não saiu: ${erro || 'tente pela lista.'}`);
        navigate('/app/campanhas', { state: { selId: criada.id } });
      } else {
        toast.error(erro || 'Erro ao criar campanha.');
      }
    } finally {
      setSalvando(false);
    }
  };

  useAcaoTopo(
    podeCriar ? <Button size="sm" variant="secondary" icon={Save} onClick={() => salvar('rascunho')} disabled={salvando}>Salvar rascunho</Button> : null,
    [podeCriar, form, salvando, filtroGasto, cupomAtivo]
  );

  const descPasso = [
    objInfo?.titulo || 'Escolha um',
    publico.carregando ? 'contando…' : `${fmtNum(recebem)} clientes${form.segmento === 'recompra' ? ` · ${form.dias}+ dias` : ''}`,
    'Texto, botão e cupom',
    'Agora ou agendado',
  ];

  const textoBotaoFinal = form.quando === 'agendar'
    ? 'Agendar envio'
    : `Enviar para ${fmtNum(recebem)} cliente(s)`;

  if (!podeCriar) {
    return (
      <Pagina>
        <Painel titulo="Nova campanha">
          <p className="m-0 text-[13px] text-[var(--text-muted)]">Você não tem permissão para criar campanhas.</p>
        </Painel>
      </Pagina>
    );
  }

  const lateral = (
    <>
      <Painel
        titulo="Resumo do envio"
        acoes={<Badge variant={canal ? 'success' : 'warning'} size="sm">{NOME_CANAL[canal] || 'Sem WhatsApp'}</Badge>}
        semPadding
      >
        <LinhaInfo rotulo="Recebem" valor={qtdTexto} forte />
        <LinhaInfo
          rotulo="Ficam de fora"
          valor={dados ? [`${fmtNum(dados.semPermissao)} sem permissão`, dados.semTelefone ? `${fmtNum(dados.semTelefone)} sem telefone` : null].filter(Boolean).join(' · ') : '—'}
        />
        <LinhaInfo rotulo="Público" valor={textoPublico} />
        <LinhaInfo rotulo="Cupom" valor={cupomAtivo ? [form.cupomCodigo || 'Sem código', valorCupom].filter(Boolean).join(' · ') : 'Sem cupom'} />
        <LinhaInfo rotulo="Sai pelo número" valor={dados?.numeroSaida || (canal ? 'Conectado' : 'Nenhum conectado')} />
        <LinhaInfo rotulo="Envio" valor={form.quando === 'agendar' ? fmtQuando(agendado) : 'Agora'} />
        {canal === 'OFICIAL' && (
          <div className="px-4 py-3 text-xs text-[var(--text-muted)]">
            A Meta cobra cada mensagem de marketing direto na sua conta do WhatsApp Business.
          </div>
        )}
        {!canal && !publico.carregando && (
          <div className="px-4 py-3 text-xs text-[var(--warning-text)]">
            Conecte um WhatsApp em Bots para enviar. Sem isso, a campanha fica salva como rascunho.
          </div>
        )}
      </Painel>

      <Painel titulo="Como chega no celular" acoes={<span className="text-xs text-[var(--text-muted)]">Exemplo</span>} semPadding className="overflow-hidden">
        <PreviaCelular texto={previa.texto} remetente={remetente} botoes={previa.botoes} />
        <div className="px-4 py-3 text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
          {canal === 'QR_CODE'
            ? 'Toda mensagem leva o aviso de SAIR. Quem responde SAIR não recebe mais campanha.'
            : 'No WhatsApp oficial, os botões vêm do modelo aprovado na Meta: inclua o "Não quero receber" nele. Quem pede pra sair não recebe mais.'}
        </div>
      </Painel>
    </>
  );

  return (
    <Pagina>
      <nav aria-label="Passos da campanha" className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] overflow-hidden">
        <ol className="flex flex-wrap m-0 p-0 list-none">
          {PASSOS.map((titulo, i) => {
            const n = i + 1;
            const feito = n < passo;
            const atual = n === passo;
            return (
              <li key={titulo} className="min-w-0" style={{ flex: '1 1 160px' }}>
                <button
                  type="button"
                  onClick={() => irPara(n)}
                  aria-current={atual ? 'step' : undefined}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-4 py-3 text-left border-b-[3px] transition-colors',
                    atual ? 'border-[var(--primary)]' : 'border-transparent hover:bg-[var(--bg-subtle)]'
                  )}
                >
                  <span
                    className={clsx(
                      'w-[26px] h-[26px] rounded-full grid place-items-center text-xs font-bold flex-shrink-0',
                      atual && 'bg-[var(--primary)] text-[var(--text-on-primary)]',
                      feito && 'bg-[var(--primary-soft)] text-[var(--primary)]',
                      !atual && !feito && 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                    )}
                  >
                    {feito ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : n}
                  </span>
                  <span className="min-w-0">
                    <span className={clsx('block text-[13px] font-semibold', atual ? 'text-[var(--text-main)]' : feito ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]')}>{titulo}</span>
                    <span className="block text-xs text-[var(--text-muted)] truncate">{descPasso[i]}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <ColunasPagina lateral={lateral}>
        <section aria-label="Passo atual" className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] min-w-0">
          {passo === 1 && (
            <>
              <CabecalhoPasso titulo="O que você quer com essa campanha?" />
              <div role="radiogroup" aria-label="Objetivo" className="p-4 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
                {OBJETIVOS.map((o) => (
                  <Opcao key={o.valor} ativo={form.objetivo === o.valor} titulo={o.titulo} desc={o.desc} onClick={() => escolherObjetivo(o)} />
                ))}
              </div>
              <div className="flex items-start gap-2 px-4 pb-4 text-xs text-[var(--text-muted)]">
                <Info size={14} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
                <span>O objetivo já preenche o público e um texto de exemplo. Dá pra mudar tudo nos próximos passos.</span>
              </div>
            </>
          )}

          {passo === 2 && (
            <>
              <CabecalhoPasso titulo="Pra quem vai">
                <Badge variant="success" size="sm">{qtdTexto}</Badge>
              </CabecalhoPasso>
              <Linha>
                <span className="flex-1 min-w-[180px]">
                  <strong className="block">Segmento</strong>
                  <span className="block text-xs text-[var(--text-muted)]">{segInfo?.aviso}</span>
                </span>
                <div className="w-full sm:w-56">
                  <Select
                    aria-label="Segmento"
                    size="sm"
                    value={form.segmento}
                    onChange={(e) => mudar({ segmento: e.target.value })}
                    options={SEGMENTOS.map((s) => ({ value: s.valor, label: s.label }))}
                    placeholder=""
                  />
                </div>
              </Linha>
              {form.segmento === 'recompra' && (
                <Linha>
                  <span className="flex-1 min-w-[180px]">
                    <strong className="block">Sumiram após comprar</strong>
                    <span className="block text-xs text-[var(--text-muted)]">Última compra há pelo menos</span>
                  </span>
                  <div className="w-full sm:w-56">
                    <Select aria-label="Janela de recompra" size="sm" value={form.dias} onChange={(e) => mudar({ dias: e.target.value })} options={JANELAS} placeholder="" />
                  </div>
                </Linha>
              )}
              <Linha>
                <span className="flex-1 min-w-[180px]">Gastou mais de um valor na última visita</span>
                <Badge variant="neutral" size="sm">opcional</Badge>
                <Switch checked={filtroGasto} onChange={setFiltroGasto} ariaLabel="Filtrar por gasto na última visita" />
                {filtroGasto && (
                  <div className="w-full sm:w-40">
                    <Input
                      aria-label="Gastou mais de (R$)"
                      size="sm"
                      inputMode="decimal"
                      placeholder="R$ 100,00"
                      value={form.gastoMinimo}
                      onChange={(e) => mudar({ gastoMinimo: e.target.value.replace(/[^\d,.]/g, '') })}
                    />
                  </div>
                )}
              </Linha>
              <Linha>
                <span className="flex-1 min-w-[180px]">
                  {dados ? `${fmtNum(dados.semPermissao)} sem permissão de mensagem ficam de fora` : 'Quem pediu pra sair fica de fora'}
                  {dados?.semTelefone ? <span className="block text-xs text-[var(--text-muted)]">{fmtNum(dados.semTelefone)} sem telefone válido também ficam de fora</span> : null}
                </span>
                <span className="text-xs text-[var(--text-muted)]">regra do WhatsApp</span>
              </Linha>
            </>
          )}

          {passo === 3 && (
            <>
              <CabecalhoPasso titulo="Mensagem">
                {canal === 'QR_CODE'
                  ? <Badge variant="info" size="sm">WhatsApp Web · sai este texto</Badge>
                  : form.nomeTemplate.trim()
                    ? <Badge variant="success" size="sm">Modelo informado</Badge>
                    : <Badge variant="warning" size="sm">Falta o modelo da Meta</Badge>}
              </CabecalhoPasso>
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                {objInfo && (
                  <>
                    <span className="text-xs text-[var(--text-muted)]">Objetivo</span>
                    <Badge variant="success" size="sm">{objInfo.titulo}</Badge>
                  </>
                )}
                <span className="text-xs text-[var(--text-muted)]">Público</span>
                <Badge variant="info" size="sm">{textoPublico} · {qtdTexto}</Badge>
                <span className="flex-1" />
                <Button variant="secondary" size="sm" onClick={() => setPasso(2)}>Alterar</Button>
              </div>
              <div className="p-4 flex flex-col gap-4">
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
                  <Input
                    label="Nome da campanha"
                    size="sm"
                    maxLength={120}
                    value={form.nome}
                    onChange={(e) => mudar({ nome: e.target.value })}
                    placeholder="Ex: Volta com desconto · novembro"
                  />
                  {canal !== 'QR_CODE' && (
                    <Input
                      label="Nome do modelo aprovado na Meta"
                      size="sm"
                      maxLength={120}
                      value={form.nomeTemplate}
                      onChange={(e) => mudar({ nomeTemplate: e.target.value })}
                      placeholder="Ex: volta_cupom_15"
                    />
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="nc-texto" className="text-xs font-semibold text-[var(--text-secondary)]">Texto</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-[var(--text-muted)]">Inserir:</span>
                    {VARIAVEIS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => inserirVariavel(v)}
                        aria-label={`Inserir ${v} no texto`}
                        className="h-7 px-2.5 rounded-full border border-dashed border-[var(--info-text)] bg-[var(--info-soft)] text-xs font-semibold text-[var(--info-text)] hover:opacity-80"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    id="nc-texto"
                    ref={textoRef}
                    value={form.mensagem}
                    maxLength={MAX_MENSAGEM}
                    onChange={(e) => mudar({ mensagem: e.target.value })}
                    rows={6}
                    placeholder="Ex: Oi, [nome]! Sentimos sua falta. Volte essa semana com o cupom [cupom]."
                  />
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--text-muted)]">
                    <span>Os campos entre colchetes trocam pelos dados de cada cliente.</span>
                    <span className="tabular-nums">{fmtNum(form.mensagem.length)} de {fmtNum(MAX_MENSAGEM)} caracteres</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span id="nc-botao" className="text-xs font-semibold text-[var(--text-secondary)]">Botão da mensagem</span>
                  <div role="radiogroup" aria-labelledby="nc-botao" className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))' }}>
                    {BOTOES_MENSAGEM.map((b) => (
                      <Opcao key={b.valor} ativo={form.botao === b.valor} titulo={b.titulo} desc={b.desc} onClick={() => mudar({ botao: b.valor })} />
                    ))}
                  </div>
                  {form.botao === 'MARCAR_HORARIO' && dados && !dados.linkAgendamento && (
                    <span className="text-xs text-[var(--warning-text)]">Seu link de agendamento ainda não está configurado (Configurações → Atendimento).</span>
                  )}
                </div>

                <div className="rounded-[10px] border border-[var(--border-main)]">
                  <div className="flex items-center gap-3 px-3.5 py-3">
                    <span className="flex-1 min-w-0">
                      <strong className="block text-[13px] text-[var(--text-main)]">Incluir cupom de desconto</strong>
                      <span className="block text-xs text-[var(--text-muted)]">
                        {podeCupom ? 'O código entra no lugar de [cupom].' : 'Só o dono da conta ou um administrador cria cupom.'}
                      </span>
                    </span>
                    <Switch checked={cupomAtivo} onChange={(v) => mudar({ incluirCupom: v })} disabled={!podeCupom} ariaLabel="Incluir cupom de desconto" />
                  </div>
                  {cupomAtivo && (
                    <div className="grid gap-3 px-3.5 pb-3.5 pt-3 border-t border-[var(--border-subtle)]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))' }}>
                      <Input
                        label="Código do cupom"
                        size="sm"
                        maxLength={30}
                        value={form.cupomCodigo}
                        onChange={(e) => mudar({ cupomCodigo: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })}
                        placeholder="VOLTA15"
                      />
                      <Select
                        label="Tipo de desconto"
                        size="sm"
                        value={form.cupomTipo}
                        onChange={(e) => mudar({ cupomTipo: e.target.value })}
                        options={[{ value: 'PERCENTUAL', label: 'Desconto (%)' }, { value: 'VALOR', label: 'Desconto (R$)' }]}
                        placeholder=""
                      />
                      <Input
                        label="Valor"
                        size="sm"
                        inputMode="decimal"
                        value={form.cupomValor}
                        onChange={(e) => mudar({ cupomValor: e.target.value.replace(/[^\d,.]/g, '') })}
                        placeholder={form.cupomTipo === 'PERCENTUAL' ? '15' : '20,00'}
                      />
                      <Input label="Válido até" size="sm" type="date" min={hojeISO()} value={form.cupomValidoAte} onChange={(e) => mudar({ cupomValidoAte: e.target.value })} />
                      <Input
                        label="Limite de usos (total)"
                        size="sm"
                        inputMode="numeric"
                        value={form.cupomUsoMaximo}
                        onChange={(e) => mudar({ cupomUsoMaximo: e.target.value.replace(/\D/g, '') })}
                        placeholder="Sem limite"
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-start gap-3 rounded-lg px-3.5 py-3 bg-[var(--info-soft)]">
                  <Info size={18} aria-hidden="true" className="flex-shrink-0 mt-0.5 text-[var(--info-text)]" />
                  <span className="text-[13px] leading-[1.45] text-[var(--text-main)]">
                    {canal === 'QR_CODE'
                      ? 'Pelo WhatsApp Web sai este texto, com os campos trocados, o link do botão e o aviso de SAIR no fim.'
                      : 'No WhatsApp oficial chega o texto do modelo aprovado na Meta. Cada campo entre colchetes vira {{1}}, {{2}}… na ordem em que aparece aqui, então crie o modelo na mesma ordem. Mudou o texto do modelo? Ele volta pra análise da Meta.'}
                  </span>
                </div>
              </div>
            </>
          )}

          {passo === 4 && (
            <>
              <CabecalhoPasso titulo="Quando enviar" />
              <div role="radiogroup" aria-label="Quando enviar" className="p-4 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
                <Opcao ativo={form.quando === 'agora'} titulo="Enviar agora" desc="Começa em seguida, aos poucos" onClick={() => mudar({ quando: 'agora' })} disabled={!podeDisparar} />
                <Opcao
                  ativo={form.quando === 'agendar'}
                  titulo="Agendar"
                  desc={form.quando === 'agendar' ? fmtQuando(agendado) : 'Escolha o dia e a hora'}
                  onClick={() => mudar({ quando: 'agendar', agendarData: form.agendarData || amanhaISO() })}
                  disabled={!podeDisparar}
                />
              </div>
              {form.quando === 'agendar' && (
                <div className="grid gap-3 px-4 pb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))' }}>
                  <Input label="Dia" size="sm" type="date" min={hojeISO()} value={form.agendarData} onChange={(e) => mudar({ agendarData: e.target.value })} />
                  <Input label="Hora" size="sm" type="time" value={form.agendarHora} onChange={(e) => mudar({ agendarHora: e.target.value })} />
                </div>
              )}
              <Linha className="border-t">
                <span className="flex-1 min-w-[140px]">Ritmo de envio</span>
                <span className="text-xs text-[var(--text-muted)]">{RITMO[canal] || 'Conecte um WhatsApp em Bots para enviar'}</span>
              </Linha>
              {!podeDisparar && (
                <div className="flex items-start gap-2 px-4 py-3 text-xs text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                  <Info size={14} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
                  <span>Você pode salvar como rascunho. Enviar ou agendar fica com quem tem permissão de editar campanhas.</span>
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
            {passo > 1 && <Button variant="secondary" size="sm" onClick={() => setPasso(passo - 1)}>Voltar</Button>}
            <Button variant="ghost" size="sm" onClick={() => navigate('/app/campanhas')}>Cancelar</Button>
            <span className="flex-1" />
            <span className="text-xs text-[var(--text-muted)]">Passo {passo} de {PASSOS.length}</span>
            {passo < 4 ? (
              <Button variant="primary" size="sm" onClick={() => irPara(passo + 1)}>Continuar</Button>
            ) : podeDisparar ? (
              <Button variant="primary" size="sm" onClick={() => salvar(form.quando)} loading={salvando} disabled={form.quando === 'agora' && !publico.carregando && recebem === 0}>
                {textoBotaoFinal}
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => salvar('rascunho')} loading={salvando}>Salvar rascunho</Button>
            )}
          </div>
        </section>
      </ColunasPagina>
    </Pagina>
  );
}
