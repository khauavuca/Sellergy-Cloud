import { useEffect, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { IconeCheck } from './Icones';
import { titulo } from './estilo';

// Ilustracao do produto, so com HTML/CSS. Conta uma mini-historia ao carregar:
// a agenda aparece, o lembrete sai, a cliente digita e confirma, o status
// muda na agenda e o Pix cai. Nomes ficticios de exemplo.
const HORARIOS = [
  { hora: '09:00', nome: 'Mariana Alves', servico: 'Limpeza de pele · Ana', status: 'Confirmado' },
  { hora: '10:30', nome: 'Paula Rocha', servico: 'Drenagem · Bruno', status: 'Aguardando' },
  { hora: '14:30', nome: 'Juliana Costa', servico: 'Peeling químico · Carla', status: 'Confirmado', muda: true },
];

// Linha do tempo da animacao (ms)
const T = { lembrete: 1100, digitando: 1900, resposta: 3000, status: 3400, pix: 3900, link: 5200 };

const corStatus = {
  Confirmado: 'bg-[#E3F4EA] text-[#0E5C34]',
  Aguardando: 'bg-[#FDF0D9] text-[#7A4A00]',
};

const cartao = 'bg-white/90 backdrop-blur border border-[#E3E5E8] rounded-2xl shadow-[0_20px_50px_rgba(21,23,26,0.08)]';
const atraso = (ms) => ({ '--ld-atraso': `${ms}ms` });

const brl = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Valor que conta de 0 ate o final quando o card do Pix aparece. */
function ValorContando({ final, inicio }) {
  const parado = typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [valor, setValor] = useState(parado ? final : 0);

  useEffect(() => {
    if (parado) return undefined;
    let quadro;
    const espera = setTimeout(() => {
      const t0 = performance.now();
      const passo = (agora) => {
        const p = Math.min(1, (agora - t0) / 1000);
        setValor(final * (1 - (1 - p) ** 3));
        if (p < 1) quadro = requestAnimationFrame(passo);
      };
      quadro = requestAnimationFrame(passo);
    }, inicio);
    return () => { clearTimeout(espera); cancelAnimationFrame(quadro); };
  }, [final, inicio, parado]);

  return <>R$ {brl(valor)}</>;
}

export default function MockProduto() {
  return (
    <div
      role="img"
      aria-label="Exemplo do sistema: agenda do dia, lembrete confirmado no WhatsApp e Pix recebido"
      className="relative flex flex-col gap-3.5 min-w-0"
    >
      {/* Agenda de hoje */}
      <div className="ld-entrar mr-4 sm:mr-12" style={atraso(150)}>
        <div className={`${cartao} ld-flutuar px-5 py-[18px]`} style={{ '--ld-fase': '0s' }}>
          <div className="flex justify-between items-baseline gap-3">
            <p className="m-0 font-semibold flex items-center gap-2">
              <span className="relative flex w-2 h-2">
                <span className="ld-ping absolute inline-flex h-full w-full rounded-full bg-[#1FA672] opacity-70" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-[#136F4D]" />
              </span>
              Agenda de hoje
            </p>
            <p className="m-0 text-[13px] text-[#5B616B]">terça, 24 de novembro</p>
          </div>
          <div className="flex flex-col mt-2.5">
            {HORARIOS.map((h, i) => (
              <div
                key={h.hora}
                className={`ld-msg flex items-center gap-3.5 py-2.5 ${i < HORARIOS.length - 1 ? 'border-b border-[#EEF0EC]' : ''}`}
                style={atraso(350 + i * 130)}
              >
                <span className="w-[46px] shrink-0 font-semibold tabular-nums">{h.hora}</span>
                <span className="flex-1 min-w-0 text-[14px]">
                  {h.nome}
                  <br />
                  <span className="text-[#5B616B]">{h.servico}</span>
                </span>
                {h.muda ? (
                  <span className="relative inline-grid">
                    <span className={`col-start-1 row-start-1 text-[12px] font-semibold px-2.5 py-1 rounded-full ld-pop ${corStatus.Confirmado}`} style={atraso(T.status)}>
                      Confirmado
                    </span>
                    <span className={`col-start-1 row-start-1 text-[12px] font-semibold px-2.5 py-1 rounded-full ld-status-antigo ${corStatus.Aguardando}`} style={atraso(T.status)} aria-hidden="true">
                      Aguardando
                    </span>
                  </span>
                ) : (
                  <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full ${corStatus[h.status]}`}>{h.status}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lembrete no WhatsApp */}
      <div className="ld-entrar ml-4 sm:ml-12" style={atraso(700)}>
        <div className={`${cartao} ld-flutuar px-[18px] py-4`} style={{ '--ld-fase': '-2s' }}>
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#5B616B]">
            Lembrete automático · 24 h antes
          </p>
          <div className="ld-msg mt-2.5 bg-[#EEF6F1] rounded-[4px_14px_14px_14px] px-3.5 py-3 text-[14px] leading-[1.45] max-w-[330px]" style={atraso(T.lembrete)}>
            Olá, Juliana! Passando para lembrar do seu horário na Clínica Lumi: amanhã, às 14:30. Você confirma?
            <div className="flex gap-2 mt-2.5">
              <span className="flex-1 text-center bg-white rounded-lg p-2 font-semibold text-[#136F4D]">Confirmar</span>
              <span className="flex-1 text-center bg-white rounded-lg p-2 font-semibold text-[#136F4D]">Remarcar</span>
            </div>
          </div>
          <div className="relative flex justify-end mt-2 min-h-9">
            <span className="ld-digitando absolute right-0 top-0 flex gap-1 items-center bg-[#15171A] rounded-[14px_4px_14px_14px] px-3.5 py-3" style={atraso(T.digitando)} aria-hidden="true">
              <i /><i /><i />
            </span>
            <span className="ld-msg bg-[#15171A] text-white rounded-[14px_4px_14px_14px] px-3.5 py-2 text-[14px]" style={atraso(T.resposta)}>
              Confirmar
            </span>
          </div>
          <p className="ld-msg mt-2 mb-0 text-[12px] text-[#5B616B] text-right" style={atraso(T.status)}>
            Agenda atualizada: confirmado às 14:41
          </p>
        </div>
      </div>

      {/* Pix recebido */}
      <div className="ld-entrar mr-0 sm:mr-24" style={atraso(T.pix)}>
        <div className="ld-flutuar bg-[#15171A] text-white rounded-2xl px-5 py-4 flex items-center gap-3.5 shadow-[0_20px_50px_rgba(19,111,77,0.25)]" style={{ '--ld-fase': '-4s' }}>
          <span className="ld-pop w-10 h-10 shrink-0 rounded-xl bg-[#136F4D] grid place-items-center" style={atraso(T.pix + 250)}>
            <IconeCheck />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold">Pix recebido</span>
            <span className="text-[13px] text-[#B9BEC6]">Venda 1042 · balcão · caixa aberto às 08:02</span>
          </span>
          <span className={`${titulo} text-[22px] font-bold tabular-nums whitespace-nowrap`}>
            <ValorContando final={189.8} inicio={T.pix + 200} />
          </span>
        </div>
      </div>

      {/* Notificacao: agendamento pelo link */}
      <div
        className="ld-pop absolute -top-5 right-0 sm:-right-3 hidden sm:flex items-center gap-2.5 bg-white border border-[#E3E5E8] rounded-full pl-2 pr-4 py-2 shadow-[0_14px_34px_rgba(21,23,26,0.12)]"
        style={atraso(T.link)}
        aria-hidden="true"
      >
        <span className="w-7 h-7 rounded-full bg-[#E3F1EA] text-[#136F4D] grid place-items-center">
          <CalendarPlus size={15} />
        </span>
        <span className="text-[13px] font-semibold">Novo horário pelo link</span>
      </div>
    </div>
  );
}
