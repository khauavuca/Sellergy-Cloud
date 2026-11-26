import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, CalendarX, Loader2, AlertCircle } from 'lucide-react';
import api from '../services/api';
import { Button } from '../components/ui';

// Pagina PUBLICA do link que vai no lembrete: /confirmar/<token>.
// O cliente confirma ou pede pra remarcar sem precisar responder no WhatsApp.

function Caixa({ children }) {
  return (
    <div className="min-h-screen grid place-items-center bg-[var(--bg-app)] px-4">
      <div className="w-full max-w-sm text-center">{children}</div>
    </div>
  );
}

export default function ConfirmarPage() {
  const { token } = useParams();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [agora] = useState(() => Date.now());

  useEffect(() => {
    api.get(`/publico/confirmacao/${token}`)
      .then((r) => setDados(r.data))
      .catch(() => setErro('Este link é inválido ou já expirou.'));
  }, [token]);

  const responder = async (acao) => {
    setEnviando(acao);
    try {
      const r = await api.post(`/publico/confirmacao/${token}`, { acao });
      setResultado(r.data);
    } catch (e) {
      setResultado(e.response?.data || { ok: false, mensagem: 'Não foi possível registrar. Tente de novo.' });
    } finally {
      setEnviando(null);
    }
  };

  if (erro) {
    return <Caixa><AlertCircle className="mx-auto text-[var(--text-muted)]" /><p className="text-sm text-[var(--text-secondary)] mt-3">{erro}</p></Caixa>;
  }
  if (!dados) {
    return <Caixa><Loader2 className="mx-auto animate-spin text-[var(--text-muted)]" /></Caixa>;
  }

  const { negocio, agendamento: ag } = dados;
  const quando = new Date(ag.data);
  const diaLongo = quando.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const diaTexto = diaLongo.charAt(0).toUpperCase() + diaLongo.slice(1);
  const horaTexto = quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  if (resultado) {
    const Icone = resultado.status === 'CONFIRMED' ? CalendarCheck : CalendarX;
    return (
      <Caixa>
        <Icone size={40} className={resultado.status === 'CONFIRMED' ? 'mx-auto text-[var(--success)]' : 'mx-auto text-[var(--text-muted)]'} />
        <p className="text-base font-semibold text-[var(--text-main)] mt-3">{resultado.mensagem}</p>
      </Caixa>
    );
  }

  const encerrado = ['CANCELED', 'COMPLETED'].includes(ag.status) || quando.getTime() < agora;

  return (
    <Caixa>
      {negocio.logo && <img src={negocio.logo} alt="" className="w-12 h-12 rounded-xl object-cover mx-auto mb-3" />}
      <p className="text-sm text-[var(--text-muted)]">{negocio.nome}</p>
      <h1 className="text-xl font-semibold tracking-tight text-[var(--text-main)] mt-1">
        {ag.primeiroNome ? `${ag.primeiroNome}, seu horário` : 'Seu horário'}
      </h1>
      <p className="text-base text-[var(--text-main)] mt-4">{diaTexto}</p>
      <p className="text-3xl font-semibold text-[var(--text-main)] tabular-nums">{horaTexto}</p>
      {(ag.servico || ag.profissional) && (
        <p className="text-sm text-[var(--text-secondary)] mt-2">{[ag.servico, ag.profissional && `com ${ag.profissional}`].filter(Boolean).join(' ')}</p>
      )}

      {encerrado ? (
        <p className="text-sm text-[var(--text-muted)] mt-6">Este horário não está mais ativo.</p>
      ) : ag.status === 'CONFIRMED' ? (
        <div className="mt-6 space-y-3">
          <p className="text-sm font-medium text-[var(--success-text)]">Presença já confirmada.</p>
          <Button variant="ghost" fullWidth loading={enviando === 'REMARCAR'} onClick={() => responder('REMARCAR')}>Preciso remarcar</Button>
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          <Button variant="primary" size="lg" fullWidth loading={enviando === 'CONFIRMAR'} onClick={() => responder('CONFIRMAR')}>Confirmar presença</Button>
          <Button variant="secondary" size="lg" fullWidth loading={enviando === 'REMARCAR'} onClick={() => responder('REMARCAR')}>Preciso remarcar</Button>
        </div>
      )}
    </Caixa>
  );
}
