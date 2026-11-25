import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, Link2, MessagesSquare, Moon, QrCode, ReceiptText, Wallet } from 'lucide-react';
import Revelar from './Revelar';
import { useVisivel } from './aoRolar';
import { IconeSeta } from './Icones';
import { ROTA_CADASTRO } from './conteudo';
import { botaoPrimario, container, titulo, tituloSecao } from './estilo';

// Capitulo 2 da historia: um dia inteiro com o sistema trabalhando junto.
const MOMENTOS = [
  {
    hora: '08:02',
    icone: Wallet,
    titulo: 'O caixa abre sozinho',
    texto: 'A primeira venda do dia já abre o caixa com o troco de ontem. Você só atende.',
    detalhe: 'Caixa aberto · troco R$ 150,00',
  },
  {
    hora: '09:00',
    icone: CalendarCheck,
    titulo: 'A agenda chega confirmada',
    texto: 'Ontem cada cliente recebeu o lembrete e respondeu. Quem remarcou deixou o horário livre pra outro.',
    detalhe: '6 de 7 confirmados',
  },
  {
    hora: '10:15',
    icone: MessagesSquare,
    titulo: 'O WhatsApp no mesmo lugar',
    texto: 'A cliente mandou uma pergunta. A conversa aparece no sistema com a ficha dela do lado, e qualquer pessoa da equipe responde. Se o bot estiver ligado, você assume quando quiser.',
    detalhe: 'Conversa respondida · ficha aberta',
  },
  {
    hora: '11:40',
    icone: Link2,
    titulo: 'Alguém marcou enquanto você atendia',
    texto: 'Pelo link na sua bio, a cliente escolheu serviço, profissional e um horário livre de verdade. Já virou cadastro.',
    detalhe: 'Novo horário · quinta, 15:00',
  },
  {
    hora: '14:30',
    icone: QrCode,
    titulo: 'Concluiu, cobrou',
    texto: 'A venda já vem montada com o serviço. O QR do Pix aparece na tela e a venda fecha quando o dinheiro cai.',
    detalhe: 'Pix recebido · R$ 189,80',
  },
  {
    hora: '18:00',
    icone: ReceiptText,
    titulo: 'Fechamento sem calculadora',
    texto: 'O fechamento mostra o que entrou em Pix, cartão e dinheiro, e destaca se alguma coisa não bate.',
    detalhe: 'Caixa fechado · sem diferença',
  },
  {
    hora: '22:00',
    icone: Moon,
    titulo: 'Você em casa',
    texto: 'E os lembretes de amanhã já saíram sozinhos. Ninguém precisou mandar mensagem um por um.',
    detalhe: 'Lembretes de amanhã enviados',
  },
];

/** Marco da linha do tempo: acende quando entra na tela. */
function Momento({ m, ultimo }) {
  const [ref, visivel] = useVisivel({ margem: '0px 0px -35% 0px', limiar: 0 });
  const Icone = m.icone;
  return (
    <li ref={ref} className={`relative grid grid-cols-[56px_1fr] gap-5 sm:gap-7 ${ultimo ? '' : 'pb-12 sm:pb-14'}`}>
      <span
        className={`ld-marco relative z-10 w-14 h-14 rounded-2xl grid place-items-center border ${
          visivel
            ? 'bg-[#136F4D] border-[#1FA672] text-white shadow-[0_0_0_6px_rgba(31,166,114,0.15),0_0_40px_rgba(31,166,114,0.45)]'
            : 'bg-[#1C211F] border-[#2C3330] text-[#6B726E]'
        }`}
      >
        <Icone size={22} aria-hidden="true" />
      </span>
      <div className={`ld-revelar ${visivel ? 'ld-visivel' : ''} pt-1`}>
        <p className={`${titulo} m-0 text-[15px] font-bold tabular-nums text-[#7FE0B4]`}>{m.hora}</p>
        <h3 className={`${titulo} mt-1 mb-0 text-[22px] sm:text-[26px] font-bold tracking-[-0.015em] text-white`}>{m.titulo}</h3>
        <p className="mt-2 mb-0 text-[16px] leading-[1.6] text-[#B4BCB8] max-w-[560px]">{m.texto}</p>
        <span className="inline-flex mt-3.5 items-center gap-2 text-[13px] font-semibold text-[#DDE7E2] bg-white/[0.06] border border-white/10 rounded-full px-3 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#1FA672]" aria-hidden="true" />
          {m.detalhe}
        </span>
      </div>
    </li>
  );
}

export default function UmDia() {
  const trilho = useRef(null);
  const [parado] = useState(() => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const [progresso, setProgresso] = useState(parado ? 1 : 0);

  // A linha verde vai enchendo conforme a pessoa rola pelo dia.
  useEffect(() => {
    if (parado) return undefined;
    let quadro = 0;
    const medir = () => {
      quadro = 0;
      const el = trilho.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const meio = window.innerHeight * 0.6;
      setProgresso(Math.min(1, Math.max(0, (meio - r.top) / r.height)));
    };
    const aoRolar = () => { if (!quadro) quadro = requestAnimationFrame(medir); };
    medir();
    window.addEventListener('scroll', aoRolar, { passive: true });
    window.addEventListener('resize', aoRolar);
    return () => {
      window.removeEventListener('scroll', aoRolar);
      window.removeEventListener('resize', aoRolar);
      cancelAnimationFrame(quadro);
    };
  }, [parado]);

  return (
    <section id="um-dia" aria-labelledby="titulo-um-dia" className="relative overflow-clip bg-[#0E1311] text-white">
      <div className="ld-bolha w-[520px] h-[520px] bg-[#136F4D]/40 -top-40 -left-40" aria-hidden="true" />
      <div className="ld-bolha w-[420px] h-[420px] bg-[#F2C46B]/10 bottom-0 -right-32" style={{ animationDelay: '-7s' }} aria-hidden="true" />

      <div className={`${container} relative py-20 sm:py-28 grid lg:grid-cols-[minmax(0,420px)_1fr] gap-14 lg:gap-20`}>
        <Revelar className="lg:sticky lg:top-28 self-start">
          <p className="m-0 text-[13px] font-semibold text-[#7FE0B4] uppercase tracking-[0.08em]">Um dia com o Sellergy</p>
          <h2 id="titulo-um-dia" className={`${tituloSecao} mt-3 mb-0 text-white`}>
            Imagine sua terça-feira <span className="ld-texto-vivo-claro">trabalhando por você.</span>
          </h2>
          <p className="mt-5 mb-0 text-[18px] leading-[1.6] text-[#B4BCB8]">
            Do caixa que abre às oito ao lembrete que sai depois que você foi embora. Role e acompanhe o dia.
          </p>
          <Link to={ROTA_CADASTRO} className={`${botaoPrimario} ld-brilho group mt-8 min-h-[52px] px-6 text-[16px]`}>
            Quero meus dias assim
            <IconeSeta className="transition-transform group-hover:translate-x-1" />
          </Link>
        </Revelar>

        <div ref={trilho} className="relative">
          {/* trilho e preenchimento, atras dos marcos */}
          <span className="absolute left-[27px] top-2 bottom-2 w-0.5 bg-white/10 rounded-full" aria-hidden="true" />
          <span
            className="ld-linha-preenchida absolute left-[27px] top-2 bottom-2 w-0.5 rounded-full bg-gradient-to-b from-[#7FE0B4] via-[#1FA672] to-[#136F4D]"
            style={{ transform: `scaleY(${progresso})` }}
            aria-hidden="true"
          />
          <ol className="list-none m-0 p-0 relative">
            {MOMENTOS.map((m, i) => (
              <Momento key={m.hora} m={m} ultimo={i === MOMENTOS.length - 1} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
