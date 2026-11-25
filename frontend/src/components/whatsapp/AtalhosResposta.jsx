import { useState } from 'react';
import { Clock, Link2, QrCode } from 'lucide-react';
import { Button, Input, useToast } from '../ui';
import Modal from '../Modal';
import api from '../../services/api';
import { erroDaApi, moeda } from './util';

// Atalhos que escrevem a resposta pronta no campo (a pessoa ainda confere e
// envia). Só aparecem os que têm backend pronto pro negócio
// (GET /conversas/atalhos): link de agendamento, horários livres e Pix.

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
  const [valor, setValor] = useState('');
  const [ocupado, setOcupado] = useState(false);

  if (!atalhos || (!atalhos.linkAgendamento && !atalhos.horarios && !atalhos.pix)) return null;
  const primeiroNome = String(conversa?.nome || '').trim().split(/\s+/)[0];

  const buscarHorarios = async () => {
    setOcupado(true);
    try {
      const r = await api.get('/conversas/atalhos/horarios', { params: { dia } });
      if (!r.data.texto) {
        toast.error(`Nenhum horário livre em ${r.data.rotulo}.`);
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
      </div>

      <Modal isOpen={modal === 'horarios'} onClose={() => setModal(null)} title="Mandar horários livres" size="sm">
        <div className="flex flex-col gap-4">
          <Input label="Dia" type="date" value={dia} min={diaIso(0)} onChange={(e) => setDia(e.target.value)} />
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
