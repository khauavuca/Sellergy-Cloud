import { ArrowRight } from 'lucide-react';
import { IconeCheck } from './Icones';
import Revelar from './Revelar';
import { container, tituloSecao } from './estilo';

// Capitulo 1 da historia: a rotina de hoje (riscada) e como fica.
const TROCAS = [
  { antes: 'Agenda no caderno e cliente que esquece o horário', depois: 'Lembrete no WhatsApp com Confirmar e Remarcar' },
  { antes: 'Abrir o app do banco pra ver se o Pix caiu', depois: 'A venda fecha sozinha quando o Pix cai' },
  { antes: 'Fechar o caixa na calculadora no fim do dia', depois: 'Fechamento pronto, separado por forma de pagamento' },
  { antes: 'Descobrir que o produto acabou quando o cliente pede', depois: 'Aviso de estoque baixo antes de faltar' },
  { antes: 'Nota fiscal deixada pra depois', depois: 'NFC-e e NFS-e na mesma tela da venda' },
];

export default function AntesDepois() {
  return (
    <section aria-labelledby="titulo-rotina" className={`${container} py-20 sm:py-28`}>
      <Revelar className="max-w-[720px]">
        <p className="m-0 text-[13px] font-semibold text-[#C2410C] uppercase tracking-[0.08em]">Você conhece essa rotina</p>
        <h2 id="titulo-rotina" className={`${tituloSecao} mt-3 mb-0`}>
          O dia passa e metade dele vai embora em coisa que não é atender.
        </h2>
        <p className="mt-4 mb-0 text-[18px] leading-[1.6] text-[#4A5059]">
          Caderno, calculadora, print de comprovante, mensagem um por um. Dá pra largar tudo isso.
        </p>
      </Revelar>

      <ul className="list-none p-0 mt-12 mb-0 flex flex-col gap-3">
        {TROCAS.map((t, i) => (
          <Revelar
            key={t.antes}
            como="li"
            atraso={i * 90}
            className="grid md:grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-6 bg-white border border-[#E3E5E8] rounded-2xl px-5 py-4 sm:px-6 sm:py-5"
          >
            <p className="m-0 text-[16px] text-[#6B717A]">
              <span className="sr-only">Antes: </span>
              <span className="ld-risco" style={{ '--ld-atraso': `${i * 90}ms` }}>{t.antes}</span>
            </p>
            <ArrowRight size={20} className="hidden md:block text-[#B0B5BC]" aria-hidden="true" />
            <p className="m-0 flex items-center gap-2.5 text-[16px] font-semibold text-[#15171A]">
              <span className="w-7 h-7 shrink-0 rounded-full bg-[#E3F1EA] text-[#136F4D] grid place-items-center">
                <IconeCheck tamanho={15} />
              </span>
              <span><span className="sr-only">Com o Sellergy: </span>{t.depois}</span>
            </p>
          </Revelar>
        ))}
      </ul>
    </section>
  );
}
