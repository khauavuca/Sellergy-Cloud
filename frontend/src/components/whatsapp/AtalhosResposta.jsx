import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Clock, Link2, QrCode, ShoppingBag } from 'lucide-react';
import { Button, Input, Select, useToast } from '../ui';
import Modal from '../Modal';
import api from '../../services/api';
import { erroDaApi, moeda } from './util';

// Atalhos que escrevem a resposta pronta no campo (a pessoa ainda confere e
// envia). Só aparecem os que têm backend pronto pro negócio
// (GET /conversas/atalhos): link de agendamento, link do catálogo, horários
// livres e Pix.

const COR_DIA = { livre: '#1E9E5A', poucos: '#E0A11B', lotado: '#C2410C' };
const NOME_DIA = { livre: 'livre', poucos: 'poucos horários', lotado: 'lotado', fechado: 'fechado' };
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function Atalho({ icon: Icon, children, ...props }) {
  return (
    <button
      type="button"
      className="h-8 px-3 rounded-full border border-[var(--border-main)] bg-[var(--success-soft)] text-[var(--success-text)] text-xs font-semibold inline-flex items-center gap-1.5 hover:brightness-95 disabled:opacity-50"
      {...props}
    >
      <Icon size={14} aria-hidden="true" />
      {children}
    </button>
  );
}

function diaIso(somarDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + somarDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AtalhosResposta({ atalhos, conversa, onInserir, desabilitado }) {
  const toast = useToast();
  const [modal, setModal] = useState(null); // 'horarios' | 'pix'
  const [dia, setDia] = useState(() => diaIso(1));
  const [variacaoId, setVariacaoId] = useState('');
  const [especialistaId, setEspecialistaId] = useState('');
  const [dias, setDias] = useState([]);
  const [valor, setValor] = useState('');
  const [ocupado, setOcupado] = useState(false);

  // Faixa de dias (livre / poucos / lotado / fechado) do serviço e profissional escolhidos.
  useEffect(() => {
    if (modal !== 'horarios') return undefined;
    let vivo = true;
    api.get('/conversas/atalhos/dias', { params: { variacaoId: variacaoId || undefined, especialistaId: especialistaId || undefined } })
      .then((r) => { if (vivo) setDias(r.data.dias || []); })
      .catch(() => { if (vivo) setDias([]); });
    return () => { vivo = false; };
  }, [modal, variacaoId, especialistaId]);

  if (!atalhos || (!atalhos.linkAgendamento && !atalhos.linkLoja && !atalhos.horarios && !atalhos.pix)) return null;
  const primeiroNome = String(conversa?.nome || '').trim().split(/\s+/)[0];

  const buscarHorarios = async () => {
    setOcupado(true);
    try {
      const r = await api.get('/conversas/atalhos/horarios', {
        params: { dia, variacaoId: variacaoId || undefined, especialistaId: especialistaId || undefined },
      });
      if (!r.data.texto) {
        toast.error(r.data.status === 'fechado' ? `Fechado ${r.data.rotulo}.` : `Nenhum horário livre ${r.data.rotulo}.`);
        return;
      }
      onInserir(r.data.texto);
      setModal(null);
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível buscar os horários.'));
    } finally {
      setOcupado(false);
    }
  };

  const gerarPix = async () => {
    const numero = Number(String(valor).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(numero) || numero <= 0) {
      toast.error('Informe o valor do Pix.');
      return;
    }
    setOcupado(true);
    try {
      const r = await api.post('/pagamentos/cobrancas', {
        origem: 'AVULSA', metodo: 'PIX', valor: numero,
        descricao: `Pix pelo WhatsApp${conversa?.nome ? ` · ${conversa.nome}` : ''}`,
        leadId: conversa?.leadId || undefined,
      });
      const copiaECola = r.data?.qrCode;
      if (!copiaECola) {
        toast.error('O Pix foi criado, mas o provedor não devolveu o código. Veja em Pagamentos.');
        return;
      }
      onInserir(`Segue o Pix de ${moeda(numero)}${primeiroNome ? `, ${primeiroNome}` : ''}. É só copiar o código abaixo e colar no app do banco:\n\n${copiaECola}`);
      setModal(null);
      setValor('');
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível gerar o Pix.'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2" aria-label="Atalhos de resposta">
        {atalhos.pix && <Atalho icon={QrCode} disabled={desabilitado} onClick={() => setModal('pix')}>Cobrar Pix</Atalho>}
        {atalhos.horarios && <Atalho icon={Clock} disabled={desabilitado} onClick={() => setModal('horarios')}>Mandar horários livres</Atalho>}
        {atalhos.linkAgendamento && (
          <Atalho
            icon={Link2}
            disabled={desabilitado}
            onClick={() => onInserir(`Você também pode escolher o horário direto por aqui: ${atalhos.linkAgendamento}`)}
          >
            Link de agendamento
          </Atalho>
        )}
        {atalhos.linkLoja && (
          <Atalho
            icon={ShoppingBag}
            disabled={desabilitado}
            onClick={() => onInserir(`Dá uma olhada no nosso catálogo e monta o seu pedido por aqui: ${atalhos.linkLoja}`)}
          >
            Link do catálogo
          </Atalho>
        )}
      </div>

      <Modal isOpen={modal === 'horarios'} onClose={() => setModal(null)} title="Mandar horários livres" size="sm">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Serviço"
              value={variacaoId}
              onChange={(e) => setVariacaoId(e.target.value)}
              options={[{ value: '', label: 'Qualquer (30 min)' }, ...(atalhos.servicos || []).map((sv) => ({ value: sv.variacaoId, label: sv.duracaoMin ? `${sv.nome} (${sv.duracaoMin} min)` : sv.nome }))]}
            />
            <Select
              label="Profissional"
              value={especialistaId}
              onChange={(e) => setEspecialistaId(e.target.value)}
              options={[{ value: '', label: 'Qualquer um' }, ...(atalhos.profissionais || []).map((pr) => ({ value: pr.id, label: pr.nome }))]}
            />
          </div>
          <div>
            <span className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Dia</span>
            {dias.length > 0 ? (
              <div className="flex gap-1.5 overflow-x-auto pb-1" role="list" aria-label="Próximos 14 dias">
                {dias.map((d, i) => {
                  const data = new Date(`${d.dia}T12:00:00`);
                  const rot = i === 0 ? 'Hoje' : SEMANA[data.getDay()];
                  return (
                    <button
                      key={d.dia}
                      type="button"
                      role="listitem"
                      disabled={d.status === 'fechado'}
                      aria-pressed={dia === d.dia}
                      aria-label={`${rot} ${data.getDate()}: ${NOME_DIA[d.status]}`}
                      onClick={() => setDia(d.dia)}
                      className={clsx(
                        'flex-shrink-0 w-[52px] h-[62px] rounded-lg border flex flex-col items-center justify-center gap-0.5 disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)]',
                        dia === d.dia ? 'bg-[var(--primary)] border-[var(--primary)] text-[var(--text-on-primary)]' : 'bg-[var(--bg-card)] border-[var(--border-main)] text-[var(--text-main)]'
                      )}
                    >
                      <span className="text-[10px] font-semibold uppercase opacity-80">{rot}</span>
                      <span className={clsx('text-[15px] font-bold', d.status === 'fechado' && 'line-through opacity-50')}>{data.getDate()}</span>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: COR_DIA[d.status] || 'transparent' }} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <Input aria-label="Dia" type="date" value={dia} min={diaIso(0)} onChange={(e) => setDia(e.target.value)} />
            )}
            <p className="m-0 mt-1.5 text-xs text-[var(--text-muted)]">Verde: livre · amarelo: poucos · laranja: lotado · riscado: fechado.</p>
          </div>
          <p className="m-0 text-xs text-[var(--text-muted)]">Os primeiros horários livres de cada profissional entram no campo de resposta para você conferir antes de enviar.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModal(null)}>Cancelar</Button>
            <Button loading={ocupado} onClick={buscarHorarios}>Usar horários</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={modal === 'pix'} onClose={() => setModal(null)} title="Cobrar Pix" size="sm">
        <div className="flex flex-col gap-4">
          <Input label="Valor (R$)" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
          <p className="m-0 text-xs text-[var(--text-muted)]">Gera a cobrança no seu provedor de pagamento e coloca o Pix copia e cola na resposta. A confirmação chega sozinha em Pagamentos.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModal(null)}>Cancelar</Button>
            <Button loading={ocupado} onClick={gerarPix}>Gerar Pix</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
