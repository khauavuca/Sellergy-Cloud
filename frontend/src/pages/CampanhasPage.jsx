import { useState, useEffect, useMemo } from 'react';
import clsx from 'clsx';
import {
  Repeat, RefreshCw, MessageCircle, Info, Plus, Send, Megaphone, Copy, AlertTriangle,
} from 'lucide-react';
import api from '../services/api';
import {
  Button, Select, Badge, EmptyState, useToast,
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, LinhaInfo, BarraFerramentas, AbasPilula,
} from '../components/ui';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import { usePermissao } from '../hooks/usePermissao';
import { useAuthStore } from '../store/auth.store';
import NovaCampanhaModal from '../components/campanhas/NovaCampanhaModal';
import PreviaCelular from '../components/campanhas/PreviaCelular';
import {
  fmtBRL, fmtData, fmtNum, STATUS_CAMPANHA_VARIANT, STATUS_CAMPANHA_LABEL, FORM_CAMPANHA_VAZIO,
  JANELAS, SEGMENTOS, textoCupom, urlSegmento, contarResposta,
} from '../components/campanhas/constantes';

const soDigitos = (t) => String(t || '').replace(/\D/g, '');
const fmtDataHora = (d) => (d
  ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' ·')
  : '—');

const FILTROS_STATUS = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'RASCUNHO', rotulo: 'Rascunhos' },
  { valor: 'ENVIANDO', rotulo: 'Enviando' },
  { valor: 'CONCLUIDA', rotulo: 'Concluídas' },
  { valor: 'ERRO', rotulo: 'Com erro' },
];

const th = 'text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap';
const td = 'px-4 py-2.5 border-b border-[var(--border-subtle)]';

const textoSegmento = (seg, dias) => {
  const info = SEGMENTOS.find((s) => s.valor === seg);
  if (!info) return seg;
  return seg === 'recompra' && dias ? `${info.label} · ${dias}+ dias` : info.label;
};

export default function CampanhasPage() {
  const toast = useToast();
  const podeCriar = usePermissao('CRM', 'criar');
  const podeDisparar = usePermissao('CRM', 'editar');
  const remetente = useAuthStore((s) => s.user?.branding?.nome) || 'Sua loja';

  const [segmento, setSegmento] = useState('recompra');
  const [dias, setDias] = useState('30');
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [resumo, setResumo] = useState({ recompra: 0, recorrentes: 0, 'nunca-converteram': 0, convertidos: 0 });
  const [carregandoResumo, setCarregandoResumo] = useState(true);

  const [campanhas, setCampanhas] = useState([]);
  const [carregandoCampanhas, setCarregandoCampanhas] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('todas');
  const [selId, setSelId] = useState(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [salvandoCampanha, setSalvandoCampanha] = useState(false);
  const [disparandoId, setDisparandoId] = useState(null);
  const [form, setForm] = useState(FORM_CAMPANHA_VAZIO);

  const carregar = async (seg, d) => {
    setCarregando(true);
    try {
      const r = await api.get(urlSegmento(seg, d));
      setDados(r.data);
      // Mantém o número do segmento em dia com a janela escolhida.
      setResumo((atual) => ({ ...atual, [seg]: contarResposta(seg, r.data) }));
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao carregar a lista.');
      setDados(null);
    } finally {
      setCarregando(false);
    }
  };

  const carregarCampanhas = async () => {
    setCarregandoCampanhas(true);
    try {
      const r = await api.get('/campanhas');
      setCampanhas(r.data || []);
    } catch {
      toast.error('Não foi possível carregar as campanhas.');
    } finally {
      setCarregandoCampanhas(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao montar
    carregar('recompra', '30');

    // Contagem de cada segmento pro resumo — 1 leitura leve por segmento,
    // independente de qual está selecionado.
    Promise.all([
      api.get('/campanhas/recompra?dias=30').then((r) => r.data.candidatos?.length || 0).catch(() => 0),
      api.get('/campanhas/recorrentes').then((r) => r.data.leads?.length || 0).catch(() => 0),
      api.get('/campanhas/nunca-converteram').then((r) => r.data.leads?.length || 0).catch(() => 0),
      api.get('/campanhas/convertidos').then((r) => r.data.leads?.length || 0).catch(() => 0),
    ]).then(([recompra, recorrentes, nuncaConverteram, convertidos]) => {
      setResumo({ recompra, recorrentes, 'nunca-converteram': nuncaConverteram, convertidos });
      setCarregandoResumo(false);
    });

    carregarCampanhas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrirNovaCampanha = () => {
    setForm(FORM_CAMPANHA_VAZIO);
    setModalAberto(true);
  };

  // Abre o modal já preenchido com os dados de uma campanha existente.
  // O código do cupom fica em branco: cada cupom precisa de um código novo.
  const duplicarCampanha = (c) => {
    const diasOk = JANELAS.some((j) => j.value === String(c.diasRecompra));
    setForm({
      ...FORM_CAMPANHA_VAZIO,
      nome: `${c.nome} (cópia)`,
      segmento: c.segmento,
      dias: diasOk ? String(c.diasRecompra) : '30',
      mensagem: c.mensagem || '',
      nomeTemplate: c.nomeTemplate || '',
      incluirCupom: !!c.cupom,
      cupomTipo: c.cupom?.tipo || 'PERCENTUAL',
      cupomValor: c.cupom ? String(c.cupom.valor) : '',
      cupomUsoMaximo: c.cupom?.usoMaximo ? String(c.cupom.usoMaximo) : '',
    });
    setModalAberto(true);
  };

  useAcaoTopo(
    podeCriar ? <Button size="sm" icon={Plus} onClick={abrirNovaCampanha}>Nova campanha</Button> : null,
    [podeCriar]
  );

  const criarCampanha = async () => {
    if (!form.nome.trim()) return toast.error('Informe o nome da campanha.');
    if (!form.mensagem.trim()) return toast.error('Informe a mensagem da campanha.');
    if (form.incluirCupom && (!form.cupomCodigo.trim() || !form.cupomValor)) {
      return toast.error('Preencha o código e o valor do cupom, ou desligue o cupom.');
    }

    setSalvandoCampanha(true);
    try {
      const payload = {
        nome: form.nome.trim(),
        segmento: form.segmento,
        diasRecompra: form.segmento === 'recompra' ? parseInt(form.dias, 10) : undefined,
        mensagem: form.mensagem.trim(),
        nomeTemplate: form.nomeTemplate.trim() || undefined,
        cupom: form.incluirCupom ? {
          codigo: form.cupomCodigo.trim(),
          tipo: form.cupomTipo,
          valor: parseFloat(form.cupomValor),
          validoAte: form.cupomValidoAte || undefined,
          usoMaximo: form.cupomUsoMaximo ? parseInt(form.cupomUsoMaximo, 10) : undefined,
        } : undefined,
      };
      const r = await api.post('/campanhas', payload);
      toast.success('Campanha criada como rascunho.');
      setModalAberto(false);
      if (r.data?.id) setSelId(r.data.id);
      setFiltroStatus('todas');
      carregarCampanhas();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao criar campanha.');
    } finally {
      setSalvandoCampanha(false);
    }
  };

  const dispararCampanha = async (campanha) => {
    if (!campanha.nomeTemplate) {
      toast.error('Configure o nome do template aprovado na Meta antes de disparar (edite a campanha).');
      return;
    }
    if (!window.confirm(`Disparar "${campanha.nome}" pra ${campanha.totalAlvo} lead(s) agora? Essa ação não pode ser desfeita.`)) return;
    setDisparandoId(campanha.id);
    try {
      const r = await api.post(`/campanhas/${campanha.id}/disparar`);
      toast.success(`Disparo iniciado — ${r.data.totalAlvo} lead(s) na fila.`);
      carregarCampanhas();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Erro ao disparar campanha.');
    } finally {
      setDisparandoId(null);
    }
  };

  const handleMudarSegmento = (seg) => {
    setSegmento(seg);
    carregar(seg, dias);
  };

  const handleMudarDias = (d) => {
    setDias(d);
    carregar('recompra', d);
  };

  const irParaSegmentos = () => {
    if (segmento !== 'recompra') handleMudarSegmento('recompra');
    document.getElementById('campanhas-segmentos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Normaliza os 3 formatos de resposta (recompra/leads-conversao/leads-novos)
  // num único formato de linha, pra renderizar com 1 só template.
  const itens = useMemo(() => {
    if (!dados) return [];
    if (segmento === 'recompra') {
      return (dados.candidatos || []).map((c) => ({
        leadId: c.leadId,
        nome: c.nome,
        telefone: c.telefone,
        metrica: `Última compra ${fmtData(c.ultimaCompra)} · há ${c.diasDesde} dias`,
        submetrica: `${c.totalCompras} compra(s) · ${fmtBRL(c.valorTotal)}`,
        contatado: c.contatadoAposCompra,
      }));
    }
    if (segmento === 'recorrentes' || segmento === 'convertidos') {
      return (dados.leads || []).map((l) => ({
        leadId: l.leadId,
        nome: l.nome,
        telefone: l.telefone,
        metrica: `${l.totalConversoes} conversão(ões) · última em ${fmtData(l.ultimaConversao)}`,
        submetrica: `${l.compras} compra(s) · ${l.atendimentos} atendimento(s)${l.valorTotal ? ` · ${fmtBRL(l.valorTotal)}` : ''}`,
      }));
    }
    if (segmento === 'nunca-converteram') {
      return (dados.leads || []).map((l) => ({
        leadId: l.leadId,
        nome: l.nome,
        telefone: l.telefone,
        metrica: `Cadastrado há ${l.diasSemConverter} dias`,
        submetrica: 'Nunca comprou nem agendou',
      }));
    }
    return [];
  }, [dados, segmento]);

  // Números do topo — só o que a lista de campanhas já traz.
  const numeros = useMemo(() => {
    const agora = new Date();
    const doMes = campanhas.filter((c) => {
      if (!c.enviadoEm) return false;
      const d = new Date(c.enviadoEm);
      return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
    });
    const enviadasMes = doMes.reduce((s, c) => s + (c.totalEnviado || 0), 0);
    const falharamMes = doMes.reduce((s, c) => s + (c.totalFalhou || 0), 0);
    const rascunhos = campanhas.filter((c) => c.status === 'RASCUNHO');
    const semModelo = rascunhos.filter((c) => !c.nomeTemplate).length;
    const comCupom = campanhas.filter((c) => c.cupom);
    const cuponsUsados = comCupom.reduce((s, c) => s + (c.cupom.usosAtuais || 0), 0);
    const tentativasMes = enviadasMes + falharamMes;
    return {
      enviadasMes, falharamMes, campanhasMes: doMes.length, rascunhos: rascunhos.length, semModelo,
      comCupom: comCupom.length, cuponsUsados,
      pctFalha: tentativasMes ? Math.round((falharamMes / tentativasMes) * 1000) / 10 : 0,
    };
  }, [campanhas]);

  const contagemStatus = useMemo(() => {
    const c = { todas: campanhas.length };
    campanhas.forEach((x) => { c[x.status] = (c[x.status] || 0) + 1; });
    return c;
  }, [campanhas]);

  const abas = FILTROS_STATUS
    .filter((f) => f.valor === 'todas' || f.valor !== 'ERRO' || contagemStatus.ERRO)
    .map((f) => ({ ...f, qtd: contagemStatus[f.valor] || 0 }));

  const campanhasFiltradas = filtroStatus === 'todas' ? campanhas : campanhas.filter((c) => c.status === filtroStatus);
  const sel = campanhas.find((c) => c.id === selId) || campanhasFiltradas[0] || campanhas[0] || null;

  const segAtual = SEGMENTOS.find((s) => s.valor === segmento);

  const botaoDisparar = (c, size = 'sm') => (
    c.status === 'RASCUNHO' && podeDisparar ? (
      <Button
        variant="primary" size={size} icon={Send}
        onClick={() => dispararCampanha(c)}
        loading={disparandoId === c.id}
        aria-label={`Disparar ${c.nome}`}
      >
        Disparar
      </Button>
    ) : null
  );

  const lateral = (
    <>
      <Painel
        titulo={sel ? `Prévia · ${sel.nome}` : 'Prévia'}
        acoes={sel && (
          <Badge variant={STATUS_CAMPANHA_VARIANT[sel.status] || 'neutral'} size="sm">
            {STATUS_CAMPANHA_LABEL[sel.status] || sel.status}
          </Badge>
        )}
        semPadding
        className="overflow-hidden"
      >
        {sel ? (
          <>
            <div className="border-b border-[var(--border-subtle)]">
              <PreviaCelular texto={sel.mensagem} remetente={remetente} />
            </div>
            <LinhaInfo rotulo="Público" valor={textoSegmento(sel.segmento, sel.diasRecompra)} />
            <LinhaInfo rotulo="Modelo na Meta">
              {sel.nomeTemplate
                ? <span className="font-semibold text-[var(--text-main)] [overflow-wrap:anywhere]">{sel.nomeTemplate}</span>
                : <Badge variant="warning" size="sm">Falta o modelo na Meta</Badge>}
            </LinhaInfo>
            <LinhaInfo rotulo="Cupom" valor={textoCupom(sel.cupom)} />
            {sel.cupom && (
              <LinhaInfo
                rotulo="Usos do cupom"
                valor={`${fmtNum(sel.cupom.usosAtuais || 0)}${sel.cupom.usoMaximo ? ` de ${fmtNum(sel.cupom.usoMaximo)}` : ''}`}
              />
            )}
            {sel.cupom?.validoAte && <LinhaInfo rotulo="Cupom válido até" valor={fmtData(sel.cupom.validoAte)} />}
            <LinhaInfo rotulo="Criada em" valor={fmtData(sel.criadoEm)} />
            <LinhaInfo
              rotulo={sel.status === 'RASCUNHO' ? 'Leads no alvo (na criação)' : 'Enviadas'}
              valor={sel.status === 'RASCUNHO' ? fmtNum(sel.totalAlvo) : `${fmtNum(sel.totalEnviado)} de ${fmtNum(sel.totalAlvo)}`}
            />
            {sel.totalFalhou > 0 && <LinhaInfo rotulo="Falharam" valor={fmtNum(sel.totalFalhou)} />}
            {((sel.status === 'RASCUNHO' && podeDisparar) || podeCriar) && (
              <div className="flex gap-2 p-4 pt-3">
                {sel.status === 'RASCUNHO' && podeDisparar && (
                  <Button
                    variant="primary" size="md" icon={Send} className="flex-1"
                    onClick={() => dispararCampanha(sel)}
                    loading={disparandoId === sel.id}
                  >
                    Disparar
                  </Button>
                )}
                {podeCriar && (
                  <Button
                    variant="secondary" size="md" icon={Copy}
                    className={sel.status === 'RASCUNHO' && podeDisparar ? '' : 'flex-1'}
                    onClick={() => duplicarCampanha(sel)}
                  >
                    Duplicar
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="p-4 text-[13px] text-[var(--text-muted)]">
            {carregandoCampanhas ? 'Carregando…' : 'Crie uma campanha para ver aqui como a mensagem chega no celular.'}
          </div>
        )}
      </Painel>

      <section className="flex gap-3 items-start rounded-[10px] border border-[var(--border-main)] bg-[var(--warning-soft)] px-4 py-3.5">
        <AlertTriangle size={18} aria-hidden="true" className="flex-shrink-0 mt-0.5 text-[var(--warning-text)]" />
        <p className="m-0 text-[13px] leading-[1.45] text-[var(--text-main)]">
          <strong className="text-[var(--warning-text)]">Disparo só com modelo aprovado.</strong>{' '}
          A Meta bloqueia mensagem em massa fora da janela de 24h. Sem o nome do modelo (HSM) aprovado no
          Meta Business Manager, a campanha fica salva como rascunho e não pode ser disparada.
        </p>
      </section>
    </>
  );

  return (
    <Pagina>
      <FaixaNumeros>
        <Numero
          rotulo="Enviadas no mês"
          valor={fmtNum(numeros.enviadasMes)}
          detalhe={`em ${numeros.campanhasMes} campanha(s) disparada(s)`}
          carregando={carregandoCampanhas}
        />
        <Numero
          rotulo="Falharam no mês"
          valor={fmtNum(numeros.falharamMes)}
          tom={numeros.falharamMes > 0 ? 'perigo' : 'neutro'}
          detalhe={numeros.falharamMes > 0 ? `${String(numeros.pctFalha).replace('.', ',')}% das tentativas` : 'Nenhuma falha'}
          carregando={carregandoCampanhas}
        />
        <Numero
          rotulo="Cupons usados"
          valor={fmtNum(numeros.cuponsUsados)}
          tom={numeros.cuponsUsados > 0 ? 'sucesso' : 'neutro'}
          detalhe={`em ${numeros.comCupom} campanha(s) com cupom`}
          carregando={carregandoCampanhas}
        />
        <Numero
          rotulo="Rascunhos"
          valor={fmtNum(numeros.rascunhos)}
          detalhe={numeros.semModelo > 0 ? `${numeros.semModelo} sem modelo da Meta` : 'Prontos pra disparar'}
          tomDetalhe={numeros.semModelo > 0 ? 'alerta' : 'neutro'}
          carregando={carregandoCampanhas}
          onClick={() => setFiltroStatus('RASCUNHO')}
        />
        <Numero
          rotulo="Sumiram após comprar"
          valor={fmtNum(resumo.recompra)}
          tom={resumo.recompra > 0 ? 'alerta' : 'neutro'}
          detalhe={`Sem voltar há ${segmento === 'recompra' ? dias : '30'}+ dias`}
          carregando={carregandoResumo}
          onClick={irParaSegmentos}
        />
      </FaixaNumeros>

      <ColunasPagina lateral={lateral}>
        <Painel
          titulo="Campanhas"
          subtitulo="Disparos pelo WhatsApp oficial para um segmento de clientes"
          semPadding
        >
          <BarraFerramentas>
            <AbasPilula abas={abas} valor={filtroStatus} onChange={setFiltroStatus} rotulo="Filtrar campanhas por situação" />
            <span className="flex-1" />
            {podeCriar && (
              <Button variant="secondary" size="sm" icon={Plus} onClick={abrirNovaCampanha}>Nova campanha</Button>
            )}
          </BarraFerramentas>

          {carregandoCampanhas ? (
            <div className="text-center py-10 text-[var(--text-muted)] text-[13px]">Carregando…</div>
          ) : campanhas.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="Nenhuma campanha ainda"
              description="Crie uma campanha pra disparar mensagem (e cupom, se quiser) pra um segmento de leads."
              action={podeCriar ? <Button variant="primary" icon={Plus} onClick={abrirNovaCampanha}>Nova campanha</Button> : undefined}
            />
          ) : campanhasFiltradas.length === 0 ? (
            <div className="text-center py-10 text-[var(--text-muted)] text-[13px]">Nenhuma campanha nessa situação.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>Campanha</th>
                    <th className={th}>Segmento</th>
                    <th className={th}>Envio</th>
                    <th className={clsx(th, 'text-right')}>Alvo</th>
                    <th className={clsx(th, 'text-right')}>Enviadas</th>
                    <th className={clsx(th, 'text-right')}>Falharam</th>
                    <th className={clsx(th, 'text-right')}>Cupom usado</th>
                    <th className={th}>Situação</th>
                    <th className={th}><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {campanhasFiltradas.map((c) => {
                    const ativa = sel?.id === c.id;
                    const envio = c.status === 'ENVIANDO'
                      ? `Enviando · ${fmtNum(c.totalEnviado)}/${fmtNum(c.totalAlvo)}`
                      : fmtDataHora(c.enviadoEm);
                    const rascunho = c.status === 'RASCUNHO';
                    return (
                      <tr
                        key={c.id}
                        className={clsx(
                          'transition-colors',
                          ativa ? 'bg-[var(--primary-soft)] shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-[var(--bg-subtle)]'
                        )}
                      >
                        <td className={td}>
                          <button
                            type="button"
                            onClick={() => setSelId(c.id)}
                            aria-pressed={ativa}
                            className="text-left font-semibold text-[var(--text-main)] hover:text-[var(--primary)] hover:underline"
                          >
                            {c.nome}
                          </button>
                          <div className="text-xs text-[var(--text-muted)]">{textoCupom(c.cupom)}</div>
                        </td>
                        <td className={clsx(td, 'text-[var(--text-secondary)] whitespace-nowrap')}>{textoSegmento(c.segmento, c.diasRecompra)}</td>
                        <td className={clsx(td, 'text-[var(--text-secondary)] whitespace-nowrap')}>{envio}</td>
                        <td className={clsx(td, 'text-right tabular-nums')}>{fmtNum(c.totalAlvo)}</td>
                        <td className={clsx(td, 'text-right tabular-nums')}>{rascunho ? '—' : fmtNum(c.totalEnviado)}</td>
                        <td className={clsx(td, 'text-right tabular-nums', c.totalFalhou > 0 && 'text-[var(--danger-text)] font-semibold')}>
                          {rascunho ? '—' : fmtNum(c.totalFalhou)}
                        </td>
                        <td className={clsx(td, 'text-right tabular-nums')}>{c.cupom ? fmtNum(c.cupom.usosAtuais || 0) : '—'}</td>
                        <td className={td}>
                          <Badge variant={STATUS_CAMPANHA_VARIANT[c.status] || 'neutral'} size="sm">
                            {STATUS_CAMPANHA_LABEL[c.status] || c.status}
                          </Badge>
                        </td>
                        <td className={clsx(td, 'text-right whitespace-nowrap')}>{botaoDisparar(c)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Painel>

        <Painel
          id="campanhas-segmentos"
          titulo="Segmentos prontos"
          subtitulo="Clique num segmento para ver os clientes e chamar no WhatsApp"
          semPadding
        >
          <div className="grid border-b border-[var(--border-subtle)]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            {SEGMENTOS.map((s) => {
              const ativo = segmento === s.valor;
              return (
                <button
                  key={s.valor}
                  type="button"
                  onClick={() => handleMudarSegmento(s.valor)}
                  aria-pressed={ativo}
                  className={clsx(
                    'text-left px-4 py-3 border-r border-b -mb-px border-[var(--border-subtle)] transition-colors',
                    ativo ? 'bg-[var(--primary-soft)] shadow-[inset_0_-2px_0_var(--primary)]' : 'hover:bg-[var(--bg-subtle)]'
                  )}
                >
                  <span className="block text-xs font-medium text-[var(--text-muted)]">{s.label}</span>
                  {carregandoResumo ? (
                    <span className="block h-6 w-12 my-0.5 rounded-md bg-[var(--bg-subtle)] animate-pulse" />
                  ) : (
                    <span className="block text-lg font-bold tabular-nums text-[var(--text-main)]">{fmtNum(resumo[s.valor] ?? 0)}</span>
                  )}
                  <span className="block text-xs text-[var(--text-muted)]">
                    {s.valor === 'recompra' ? `Janela de ${segmento === 'recompra' ? dias : '30'}+ dias` : s.criterio}
                  </span>
                </button>
              );
            })}
          </div>

          <BarraFerramentas>
            <Repeat size={16} aria-hidden="true" className="text-[var(--text-muted)] ml-1" />
            <h3 className="m-0 text-[13px] font-semibold text-[var(--text-main)]">{segAtual?.label}</h3>
            {!carregando && <Badge variant="neutral" size="sm">{itens.length}</Badge>}
            <span className="flex-1" />
            {segmento === 'recompra' && (
              <Select
                aria-label="Janela de recompra"
                size="sm"
                value={dias}
                onChange={(e) => handleMudarDias(e.target.value)}
                options={JANELAS}
                placeholder=""
                fullWidth={false}
                className="w-52"
              />
            )}
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => carregar(segmento, dias)}>Atualizar</Button>
          </BarraFerramentas>

          <div className="flex items-start gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--info-soft)] text-[var(--info-text)] text-xs leading-relaxed">
            <Info size={14} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
            <span>{segAtual?.aviso}</span>
          </div>

          {carregando ? (
            <div className="text-center py-10 text-[var(--text-muted)] text-[13px]">Carregando…</div>
          ) : itens.length === 0 ? (
            <EmptyState
              icon={segAtual?.icon || Repeat}
              title={`Ninguém em "${segAtual?.label}"`}
              description="Quando leads entrarem nesse critério, eles aparecem aqui."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>Cliente</th>
                    <th className={th}>Situação</th>
                    <th className={th}><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((it) => (
                    <tr key={it.leadId} className="hover:bg-[var(--bg-subtle)] transition-colors">
                      <td className={td}>
                        <div className="font-semibold text-[var(--text-main)]">{it.nome}</div>
                        <div className="text-xs text-[var(--text-muted)]">{it.telefone || 'Sem telefone'}</div>
                      </td>
                      <td className={td}>
                        <div className="text-[var(--text-secondary)]">{it.metrica}</div>
                        <div className="text-xs text-[var(--text-muted)] mt-0.5">{it.submetrica}</div>
                      </td>
                      <td className={clsx(td, 'text-right')}>
                        <div className="flex items-center justify-end gap-2">
                          {it.contatado && <Badge variant="success" size="sm">Já contatado</Badge>}
                          {it.telefone ? (
                            <a
                              href={`https://wa.me/${soDigitos(it.telefone)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Abrir WhatsApp de ${it.nome}`}
                              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-[var(--primary)] text-[var(--text-on-primary)] hover:bg-[var(--primary-hover)]"
                            >
                              <MessageCircle size={14} aria-hidden="true" /> WhatsApp
                            </a>
                          ) : (
                            <span className="text-xs text-[var(--text-muted)]">sem contato</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Painel>
      </ColunasPagina>

      {modalAberto && (
        <NovaCampanhaModal
          form={form}
          setForm={setForm}
          onCriar={criarCampanha}
          onFechar={() => setModalAberto(false)}
          salvando={salvandoCampanha}
          remetente={remetente}
          toast={toast}
        />
      )}
    </Pagina>
  );
}
