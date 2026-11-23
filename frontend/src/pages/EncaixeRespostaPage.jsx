// /encaixe/:token — pagina publica (sem login) da oferta de encaixe.
// Quem recebeu a oferta no WhatsApp aceita ou recusa aqui.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Clock, Loader2, AlertCircle } from 'lucide-react';
import api from '../services/api';
import { Button } from '../components/ui';

const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dia = (d) => new Date(d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });

function Tela({ children }) {
  return (
    <div className="min-h-screen bg-[var(--bg-app)] px-4 py-10">
      <div className="max-w-md mx-auto space-y-6">{children}</div>
    </div>
  );
}

export default function EncaixeRespostaPage() {
  const { token } = useParams();
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(null);
  const [resposta, setResposta] = useState(null);

  useEffect(() => {
    api.get(`/publico/encaixe/${token}`)
      .then((r) => setDados(r.data))
      .catch((e) => setErro(e.response?.data?.erro || 'Não foi possível abrir a oferta.'))
      .finally(() => setCarregando(false));
  }, [token]);

  const responder = async (acao) => {
    setEnviando(acao);
    try {
      const r = await api.post(`/publico/encaixe/${token}`, { acao });
      setResposta(r.data);
    } catch (e) {
      if (e.response?.data?.mensagem) setResposta(e.response.data);
      else setErro(e.response?.data?.erro || 'Não foi possível registrar sua resposta. Tente de novo.');
    } finally {
      setEnviando(null);
    }
  };

  if (carregando) return <div className="min-h-screen grid place-items-center bg-[var(--bg-app)]"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;

  if (!dados) {
    return (
      <Tela>
        <div className="text-center">
          <AlertCircle className="mx-auto text-[var(--text-muted)]" />
          <h1 className="text-lg font-semibold text-[var(--text-main)] mt-3">Oferta não encontrada</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{erro || 'Confira o link que você recebeu no WhatsApp.'}</p>
        </div>
      </Tela>
    );
  }

  const { negocio, oferta } = dados;
  const cabecalho = (
    <header className="flex items-center gap-3">
      {negocio.logo && <img src={negocio.logo} alt="" className="w-11 h-11 rounded-xl object-cover" />}
      <div>
        <div className="text-base font-semibold text-[var(--text-main)]">{negocio.nome}</div>
        <div className="text-sm text-[var(--text-muted)]">Horário que vagou</div>
      </div>
    </header>
  );
  const detalhe = (
    <div className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 space-y-2">
      <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><CalendarClock size={16} /> <span>{`${dia(oferta.data).charAt(0).toUpperCase()}${dia(oferta.data).slice(1)}, às ${hora(oferta.data)}`}</span></div>
      <div className="text-base font-semibold text-[var(--text-main)]">{oferta.servico || 'Atendimento'}{oferta.profissional ? ` com ${oferta.profissional}` : ''}</div>
      <div className="text-sm text-[var(--text-muted)]">{oferta.duracao} min</div>
    </div>
  );

  if (resposta) {
    const aceitou = resposta.resultado === 'ACEITO';
    return (
      <Tela>
        {cabecalho}
        <div className="text-center space-y-3 pt-4">
          {aceitou ? <CheckCircle2 size={40} className="mx-auto text-[var(--success)]" /> : <Clock size={40} className="mx-auto text-[var(--text-muted)]" />}
          <h1 className="text-xl font-semibold text-[var(--text-main)]">{aceitou ? 'Horário é seu!' : 'Tudo certo'}</h1>
          <p className="text-sm text-[var(--text-secondary)]" role="status">{resposta.mensagem}</p>
        </div>
        {aceitou && detalhe}
      </Tela>
    );
  }

  const situacoes = {
    SUA: { titulo: 'Esse horário já é seu', texto: 'Você aceitou essa oferta. Até lá!' },
    RECUSOU: { titulo: 'Você continua na fila', texto: 'Você respondeu que não pode. Avisamos no próximo horário que vagar.' },
    PREENCHIDA: { titulo: 'Esse horário já foi preenchido', texto: 'Outra pessoa respondeu primeiro. Você continua na fila e avisamos no próximo que vagar.' },
    VENCIDA: { titulo: 'O prazo dessa oferta acabou', texto: 'Você continua na fila e avisamos no próximo horário que vagar.' },
  };
  const fechada = situacoes[oferta.situacao];

  return (
    <Tela>
      {cabecalho}
      {fechada ? (
        <div className="space-y-3">
          <h1 className="text-xl font-semibold text-[var(--text-main)]">{fechada.titulo}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{fechada.texto}</p>
          {detalhe}
        </div>
      ) : (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold text-[var(--text-main)]">Oi, {oferta.primeiroNome}! Quer ficar com esse horário?</h1>
          {detalhe}
          <p className="text-sm text-[var(--text-muted)]">Vale pra quem responder primeiro, até {hora(oferta.expiraEm)}.</p>
          {erro && <p role="alert" className="text-sm text-[var(--danger-text)]">{erro}</p>}
          <div className="grid gap-2">
            <Button variant="primary" size="lg" fullWidth loading={enviando === 'ACEITAR'} disabled={!!enviando} onClick={() => responder('ACEITAR')}>Quero esse horário</Button>
            <Button variant="secondary" size="lg" fullWidth loading={enviando === 'RECUSAR'} disabled={!!enviando} onClick={() => responder('RECUSAR')}>Não posso, continuo na fila</Button>
          </div>
        </div>
      )}
    </Tela>
  );
}
