import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, QrCode, User, Scissors, CalendarDays, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import Modal from '../Modal';
import { Input, Textarea, Select, Combobox, Badge, Button, LinhaInfo } from '../ui';
import { formatarTelefoneBR } from '../../utils/formatTelefone';
import { formatarCpfCnpj, erroCpfCnpj, limparCpfCnpj } from '../../utils/cpfCnpj';
import { STATUS_LABELS, fmtBRL, fmtHora } from './agendaUtils';

// Modal de novo agendamento / edição. Visual do mockup NovoAgendamento:
// blocos Cliente → Serviço → Dia e horário à esquerda e, à direita, o resumo,
// pacote e sinal, status e observações. A lógica é a mesma de antes.

function precoEfetivoVariacao(v) {
  if (!v) return 0;
  return v.preco || 0;
}

const pad = (n) => String(n).padStart(2, '0');
const dataLocalISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function formInicialAgendamento(ag, inicial) {
  if (ag) {
    const d = new Date(ag.data);
    return {
      ...ag,
      data: dataLocalISO(d),
      hora: d.toTimeString().slice(0, 5),
      preco: ag.preco || 0,
      variacaoId: '', // edição mantém o serviço já gravado; não re-liga variação
      especialistaId: ag.especialistaId || '',
      observacoes: ag.observacoes || '',
    };
  }
  const base = inicial?.data ? new Date(inicial.data) : new Date();
  return {
    nomeCliente: '', telefoneCliente: '',
    data: dataLocalISO(base),
    hora: inicial?.data ? `${pad(base.getHours())}:${pad(base.getMinutes())}` : '09:00',
    duracao: 30, variacaoId: '', servico: '', preco: 0, especialistaId: inicial?.especialistaId || '',
    observacoes: '', status: 'PENDING', origem: 'MANUAL',
  };
}

// Abre sempre com estado novo: o conteúdo remonta a cada abertura (key).
export default function ModalAgendamento(props) {
  if (!props.isOpen) return null;
  const chave = props.ag?.id || `novo-${props.inicial?.data ? new Date(props.inicial.data).getTime() : ''}-${props.inicial?.especialistaId || ''}`;
  return <ModalAgendamentoConteudo key={chave} {...props} />;
}

function Bloco({ icone: Icone, titulo, acoes, children }) {
  return (
    <section className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
        <h3 className="m-0 flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
          {Icone && <Icone size={15} className="text-[var(--text-muted)]" aria-hidden="true" />}
          {titulo}
        </h3>
        {acoes}
      </div>
      <div className="p-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function ModalAgendamentoConteudo({ isOpen, onClose, ag, inicial, variacoes = [], especialistas = [], onSalvar }) {
  // Agenda é orientada ao SERVIÇO: escolhe pela busca e tudo (valor, duração,
  // especialista) vem do cadastro do serviço. Sem campos livres.
  const [form, setForm] = useState(() => formInicialAgendamento(ag, inicial));

  // Só serviços entram na agenda (produtos são vendidos, não agendados).
  const servicosVariacoes = useMemo(
    () => variacoes.filter((v) => v.produto?.tipo === 'SERVICO'),
    [variacoes]
  );

  const variacaoSel = variacoes.find((v) => v.id === form.variacaoId);

  // Pacote ativo da cliente e sinal do serviço (só no agendamento novo).
  const [pre, setPre] = useState(null);
  const [usarPacote, setUsarPacote] = useState(true);
  const [cobrarSinal, setCobrarSinal] = useState(true);
  // Asaas pede CPF/CNPJ de quem paga o sinal quando a cliente ainda nao tem.
  const [cpfSinal, setCpfSinal] = useState('');
  const [erroCpfSinal, setErroCpfSinal] = useState(null);
  const telDigitos = (form.telefoneCliente || '').replace(/\D/g, '');
  const produtoIdSel = variacaoSel?.produto?.id || '';
  useEffect(() => {
    if (!isOpen || ag) return undefined;
    if (!produtoIdSel && telDigitos.length < 10) return undefined;
    let cancelado = false;
    const t = setTimeout(() => {
      api.get('/agenda/pre-agendamento', { params: { telefone: telDigitos.length >= 10 ? telDigitos : undefined, produtoId: produtoIdSel || undefined, preco: form.preco || 0 } })
        .then((r) => { if (!cancelado) setPre(r.data); })
        .catch(() => { if (!cancelado) setPre(null); });
    }, 350);
    return () => { cancelado = true; clearTimeout(t); };
  }, [isOpen, ag, telDigitos, produtoIdSel, form.preco]);
  const pacoteDoServico = (pre?.pacotes || []).find((p) => p.produtoId === produtoIdSel && p.livres > 0) || null;
  const outrosPacotes = (pre?.pacotes || []).filter((p) => p !== pacoteDoServico);
  const vaiUsarPacote = !!pacoteDoServico && usarPacote;
  const sinalInfo = pre?.sinal && produtoIdSel && pre.sinal.valor > 0 ? pre.sinal : null;
  const vaiCobrarSinal = !ag && !vaiUsarPacote && !!sinalInfo?.pagamentoConfigurado && cobrarSinal;
  const pedeCpfSinal = vaiCobrarSinal && !!sinalInfo?.exigeCpf && !sinalInfo?.cpfCadastrado;

  // Especialistas do seletor: os do serviço escolhido; sem serviço re-selecionado
  // (edição), cai pra lista geral pra manter/trocar o profissional.
  const especialistasDoServico = variacaoSel?.produto?.especialistas || [];
  const opcoesEspecialista = especialistasDoServico.length > 0 ? especialistasDoServico : especialistas;
  const nomeEspecialista = opcoesEspecialista.find((e) => e.id === form.especialistaId)?.nome
    || especialistas.find((e) => e.id === form.especialistaId)?.nome
    || ag?.especialista?.nome
    || '';

  // Agenda do dia escolhido (do profissional, se já escolhido) — mesma rota da
  // tela da Agenda. Ajuda a ver conflito antes de salvar.
  const [doDia, setDoDia] = useState({ chave: null, itens: [] });
  const chaveDia = `${form.data}|${form.especialistaId}`;
  useEffect(() => {
    if (!form.data) return undefined;
    let vivo = true;
    const ini = new Date(`${form.data}T00:00:00`);
    const fim = new Date(`${form.data}T23:59:59.999`);
    if (Number.isNaN(ini.getTime())) return undefined;
    let url = `/agenda?inicio=${encodeURIComponent(ini.toISOString())}&fim=${encodeURIComponent(fim.toISOString())}`;
    if (form.especialistaId) url += `&especialistaId=${encodeURIComponent(form.especialistaId)}`;
    api.get(url)
      .then((r) => { if (vivo) setDoDia({ chave: chaveDia, itens: r.data || [] }); })
      .catch(() => { if (vivo) setDoDia({ chave: chaveDia, itens: [] }); });
    return () => { vivo = false; };
  }, [chaveDia, form.data, form.especialistaId]);
  const carregandoDia = doDia.chave !== chaveDia;
  const agendaDoDia = doDia.itens.filter((a) => a.id !== ag?.id && a.status !== 'CANCELED');

  const inicioEscolhido = form.data && form.hora ? new Date(`${form.data}T${form.hora}`) : null;
  const fimEscolhido = inicioEscolhido ? new Date(inicioEscolhido.getTime() + (parseInt(form.duracao) || 30) * 60000) : null;
  const conflita = (a) => {
    if (!inicioEscolhido) return false;
    const ini = new Date(a.data);
    const fim = new Date(ini.getTime() + (Number(a.duracao) || 30) * 60000);
    return ini < fimEscolhido && fim > inicioEscolhido;
  };
  const conflitos = form.especialistaId ? agendaDoDia.filter(conflita) : [];

  // Ao escolher o serviço, tudo vem do cadastro: nome, preço, duração e os
  // especialistas. Se o serviço tem só 1 especialista, já seleciona.
  const handleSelectVariacao = (id) => {
    if (id) {
      const v = variacoes.find((x) => x.id === id);
      if (v) {
        const esps = v.produto?.especialistas || [];
        setForm((f) => ({
          ...f,
          variacaoId: id,
          servico: `${v.produto?.nome} - ${v.nome}`,
          preco: precoEfetivoVariacao(v),
          duracao: v.duracaoMin || f.duracao,
          especialistaId: esps.length === 1
            ? esps[0].id
            : esps.some((e) => e.id === f.especialistaId) ? f.especialistaId : '',
        }));
      }
    } else {
      setForm((f) => ({ ...f, variacaoId: '', servico: '', preco: 0, especialistaId: '' }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.servico) {
      alert('Escolha um serviço.');
      return;
    }
    if (!form.especialistaId) {
      alert('Escolha o especialista que vai atender.');
      return;
    }
    if (pedeCpfSinal) {
      const erroDoc = erroCpfCnpj(cpfSinal, true);
      setErroCpfSinal(erroDoc);
      if (erroDoc) return;
    }
    const dataCompleta = new Date(`${form.data}T${form.hora}`);
    onSalvar({
      ...form,
      data: dataCompleta.toISOString(),
      duracao: parseInt(form.duracao) || 30,
      preco: parseFloat(form.preco) || 0,
      especialistaId: form.especialistaId || null,
      ...(ag ? {} : {
        produtoId: produtoIdSel || null,
        pacoteClienteId: vaiUsarPacote ? pacoteDoServico.id : null,
        cobrarSinal: vaiCobrarSinal,
        cpfCnpj: pedeCpfSinal ? limparCpfCnpj(cpfSinal) : undefined,
      }),
    });
  };

  const quando = inicioEscolhido && !Number.isNaN(inicioEscolhido.getTime())
    ? `${inicioEscolhido.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} às ${form.hora}`
    : '—';
  const pagarAgora = vaiUsarPacote ? 'Pacote (sem cobrança)' : vaiCobrarSinal ? fmtBRL(sinalInfo.valor) : fmtBRL(0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={ag ? 'Editar agendamento' : 'Novo agendamento'} description={ag ? null : 'Marque um atendimento com cliente, serviço, dia e hora.'} size="2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4 items-start">
          {/* Coluna principal */}
          <div className="min-w-0 flex flex-col gap-3" style={{ flex: '999 1 420px' }}>
            <Bloco icone={User} titulo="Cliente">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Nome do cliente"
                  value={form.nomeCliente}
                  onChange={(e) => setForm({ ...form, nomeCliente: e.target.value })}
                  required
                />
                <Input
                  label="Telefone (WhatsApp)"
                  value={form.telefoneCliente}
                  onChange={(e) => setForm({ ...form, telefoneCliente: formatarTelefoneBR(e.target.value) })}
                  placeholder="(11) 99999-9999"
                  maxLength={15}
                  inputMode="tel"
                />
              </div>
            </Bloco>

            {/* Serviço — fonte da verdade. Valor, duração e os especialistas
                vêm do cadastro. Sem campos livres. */}
            <Bloco
              icone={Scissors}
              titulo="Serviço"
              acoes={form.servico ? (
                <span className="text-[13px] text-[var(--text-secondary)]">
                  <strong className="text-[var(--text-main)] tabular-nums">{fmtBRL(form.preco)}</strong> · {form.duracao} min
                </span>
              ) : null}
            >
              <Combobox
                label="Buscar serviço do catálogo"
                value={form.variacaoId}
                onChange={handleSelectVariacao}
                options={servicosVariacoes.map((v) => ({
                  value: v.id,
                  label: `${v.produto?.nome} - ${v.nome}`,
                  sublabel: [
                    fmtBRL(precoEfetivoVariacao(v)),
                    v.duracaoMin ? `${v.duracaoMin}min` : null,
                  ].filter(Boolean).join(' · '),
                }))}
                placeholder={servicosVariacoes.length === 0 ? 'Nenhum serviço cadastrado' : 'Selecione um serviço'}
                clearable
              />
              {form.servico && !form.variacaoId && (
                <p className="m-0 text-[13px] text-[var(--text-secondary)]">Serviço atual: <strong className="text-[var(--text-main)]">{form.servico}</strong></p>
              )}

              {/* Especialista — vem do serviço; obrigatório. */}
              <div>
                <div className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5" id="especialista-rotulo">Especialista que vai atender</div>
                {opcoesEspecialista.length === 0 ? (
                  <div className="text-[13px] text-[var(--text-muted)]">Escolha um serviço para ver os especialistas.</div>
                ) : (
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="especialista-rotulo">
                    {opcoesEspecialista.map((esp) => {
                      const sel = form.especialistaId === esp.id;
                      return (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={sel}
                          key={esp.id}
                          onClick={() => setForm({ ...form, especialistaId: esp.id })}
                          className={`h-9 px-3 rounded-lg border text-[13px] font-semibold transition-colors ${
                            sel
                              ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--text-main)]'
                              : 'border-[var(--border-main)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                          }`}
                        >
                          {esp.nome}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </Bloco>

            <Bloco icone={CalendarDays} titulo="Dia e horário">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Data" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} required />
                <Input label="Hora" type="time" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} required />
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-secondary)]">
                  <span>{nomeEspecialista ? `Agenda de ${nomeEspecialista} nesse dia` : 'Agenda desse dia'}</span>
                  {!carregandoDia && (
                    <span className="text-[var(--text-muted)] font-medium">
                      {agendaDoDia.length === 0 ? 'Dia livre' : `${agendaDoDia.length} ${agendaDoDia.length === 1 ? 'horário marcado' : 'horários marcados'}`}
                    </span>
                  )}
                </div>
                {carregandoDia ? (
                  <div className="px-3 py-2.5 text-xs text-[var(--text-muted)]">Carregando…</div>
                ) : agendaDoDia.length === 0 ? (
                  <div className="px-3 py-2.5 text-xs text-[var(--text-muted)]">Nenhum horário marcado.</div>
                ) : (
                  <ul className="m-0 p-0 list-none max-h-44 overflow-y-auto">
                    {agendaDoDia.map((a) => {
                      const choque = form.especialistaId && conflita(a);
                      return (
                        <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-t border-[var(--border-subtle)] text-[13px]">
                          <strong className="w-12 tabular-nums text-[var(--text-main)]">{fmtHora(a.data)}</strong>
                          <span className="flex-1 min-w-0 truncate text-[var(--text-secondary)]">
                            {a.nomeCliente}{a.servico ? ` · ${a.servico}` : ''}
                            {!form.especialistaId && a.especialista?.nome ? ` · ${a.especialista.nome}` : ''}
                          </span>
                          {choque
                            ? <Badge variant="danger" size="sm">Conflito</Badge>
                            : <Badge variant={STATUS_LABELS[a.status]?.variant || 'neutral'} size="sm">{STATUS_LABELS[a.status]?.label || a.status}</Badge>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Bloco>
          </div>

          {/* Coluna lateral */}
          <aside className="min-w-0 flex flex-col gap-3" style={{ flex: '1 1 280px' }} aria-label="Resumo do agendamento">
            <section className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)]">
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
                <h3 className="m-0 text-sm font-bold text-[var(--text-main)]">Resumo</h3>
                <Badge variant={ag ? 'info' : 'warning'} size="sm">{ag ? 'Editando' : 'Rascunho'}</Badge>
              </div>
              <LinhaInfo rotulo="Cliente" valor={form.nomeCliente || '—'} forte />
              <LinhaInfo rotulo="Serviço" valor={form.servico || '—'} />
              <LinhaInfo rotulo="Com" valor={nomeEspecialista || '—'} />
              <LinhaInfo rotulo="Quando" valor={quando} forte />
              <LinhaInfo rotulo="Valor" valor={form.servico ? fmtBRL(form.preco) : '—'} forte />
              {!ag && <LinhaInfo rotulo="Pagar agora" valor={<span className="text-[var(--primary)]">{pagarAgora}</span>} forte />}
            </section>

            {conflitos.length > 0 && (
              <div className="flex items-start gap-2.5 p-3 rounded-[10px] bg-[var(--warning-soft)] text-[var(--warning-text)] text-xs leading-relaxed" role="status">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  {nomeEspecialista || 'O profissional'} já tem {conflitos.length === 1 ? 'um horário' : `${conflitos.length} horários`} nesse intervalo ({conflitos.map((c) => fmtHora(c.data)).join(', ')}).
                </span>
              </div>
            )}

            {/* Pacote da cliente e sinal por Pix (só no agendamento novo). */}
            {!ag && (pacoteDoServico || outrosPacotes.length > 0 || sinalInfo) && (
              <section className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)]">
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
                  <h3 className="m-0 text-sm font-bold text-[var(--text-main)]">Pacote e sinal</h3>
                  {sinalInfo && <span className="text-xs text-[var(--text-muted)]">Pix pelo WhatsApp</span>}
                </div>
                <div className="p-4 flex flex-col gap-3">
                  {pacoteDoServico && (
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[var(--primary)]" checked={usarPacote} onChange={(e) => setUsarPacote(e.target.checked)} />
                      <span className="text-[13px]">
                        <span className="flex items-center gap-1.5 font-semibold text-[var(--text-main)]"><Package size={14} aria-hidden="true" /> Usar o pacote {pacoteDoServico.nome}</span>
                        <span className="block text-xs text-[var(--text-secondary)] mt-0.5">
                          {pacoteDoServico.sessoesUsadas} de {pacoteDoServico.sessoesTotal} sessões usadas{pacoteDoServico.reservados ? `, ${pacoteDoServico.reservados} já marcada(s)` : ''}. Ao concluir, desconta 1 sessão e não cobra.
                        </span>
                      </span>
                    </label>
                  )}
                  {outrosPacotes.length > 0 && (
                    <p className="m-0 text-xs text-[var(--text-muted)]">
                      Tem pacote ativo: {outrosPacotes.map((p) => `${p.nome} (${p.saldo} de ${p.sessoesTotal} restantes)`).join('; ')}.
                    </p>
                  )}
                  {sinalInfo && !vaiUsarPacote && (sinalInfo.pagamentoConfigurado ? (
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[var(--primary)]" checked={cobrarSinal} onChange={(e) => setCobrarSinal(e.target.checked)} />
                      <span className="text-[13px]">
                        <span className="flex flex-wrap items-center gap-1.5 font-semibold text-[var(--text-main)]">
                          <QrCode size={14} aria-hidden="true" /> Cobrar sinal de {sinalInfo.pct}%
                          <span className="ml-auto tabular-nums">{fmtBRL(sinalInfo.valor)}</span>
                        </span>
                        <span className="block text-xs text-[var(--text-secondary)] mt-0.5">
                          A cliente recebe o Pix no WhatsApp; o horário só fica confirmado depois do pagamento e volta pra agenda se não pagar em {sinalInfo.prazoHoras} h. O sinal desconta do total ao concluir.
                        </span>
                      </span>
                    </label>
                  ) : (
                    <p className="m-0 text-xs text-[var(--text-secondary)]">
                      Este serviço pede sinal de {sinalInfo.pct}% ({fmtBRL(sinalInfo.valor)}), mas o recebimento por Pix não está configurado. O horário será marcado sem sinal. Configure em <Link to="/app/pagamentos" className="font-semibold underline">Pagamentos</Link>.
                    </p>
                  ))}
                  {pedeCpfSinal && (
                    <Input
                      label="CPF ou CNPJ de quem paga o sinal"
                      inputMode="numeric"
                      value={cpfSinal}
                      onChange={(e) => { setCpfSinal(formatarCpfCnpj(e.target.value)); setErroCpfSinal(null); }}
                      placeholder="000.000.000-00"
                      error={erroCpfSinal}
                      hint="O Asaas pede esse dado. Fica salvo na ficha da cliente."
                    />
                  )}
                </div>
              </section>
            )}

            <section className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] p-4 flex flex-col gap-3">
              {/* A duração vem do serviço e não é editada aqui. */}
              <Select
                label="Status"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                placeholder=""
                options={Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v.label }))}
              />
              <Textarea label="Observação para a profissional" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={2} />
            </section>
          </aside>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} type="button">Cancelar</Button>
          <Button variant="primary" type="submit">{ag ? 'Salvar' : 'Criar agendamento'}</Button>
        </div>
      </form>
    </Modal>
  );
}
