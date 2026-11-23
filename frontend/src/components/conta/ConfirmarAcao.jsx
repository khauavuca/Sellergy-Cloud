import { useState } from 'react';
import Modal from '../Modal';
import { Button, Textarea } from '../ui';

/**
 * Confirmacao para acoes que mexem em dinheiro ou acesso (cancelar, suspender,
 * dar baixa). Com `pedirMotivo`, mostra um campo de texto e manda o motivo
 * no onConfirmar(motivo).
 */
export default function ConfirmarAcao({
  isOpen, onClose, titulo, children, rotuloConfirmar = 'Confirmar', variante = 'danger',
  pedirMotivo = false, motivoObrigatorio = false, rotuloMotivo = 'Motivo', onConfirmar,
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const fechar = () => {
    if (enviando) return;
    setMotivo('');
    onClose();
  };

  const confirmar = async (e) => {
    e.preventDefault();
    if (motivoObrigatorio && !motivo.trim()) return;
    setEnviando(true);
    try {
      const ok = await onConfirmar(motivo.trim());
      if (ok !== false) {
        setMotivo('');
        onClose();
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={fechar} title={titulo} size="sm">
      <form onSubmit={confirmar} className="space-y-4">
        <div className="text-sm text-[var(--text-secondary)] space-y-2">{children}</div>
        {pedirMotivo && (
          <Textarea
            label={motivoObrigatorio ? rotuloMotivo : `${rotuloMotivo} (opcional)`}
            aria-label={rotuloMotivo}
            rows={3}
            maxLength={300}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required={motivoObrigatorio}
          />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" className="min-h-11" onClick={fechar} disabled={enviando}>Voltar</Button>
          <Button
            type="submit"
            variant={variante}
            className="min-h-11"
            loading={enviando}
            disabled={motivoObrigatorio && !motivo.trim()}
          >
            {rotuloConfirmar}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
