import { BadgeDollarSign, Download, MessageCircle, ShieldCheck, Smartphone, Upload } from 'lucide-react';
import Revelar from './Revelar';
import { moverHolofote } from './aoRolar';
import { container, titulo, tituloSecao } from './estilo';

// Capitulo 3: por que vale a pena. So o que o produto entrega de verdade.
const VANTAGENS = [
  {
    icone: MessageCircle,
    titulo: 'O WhatsApp que você já usa',
    texto: 'Leia um QR Code com o celular do negócio e pronto. Lembretes, confirmações e cobranças saem do seu número, com limites que protegem o chip.',
    grande: true,
  },
  {
    icone: BadgeDollarSign,
    titulo: 'Preço fixo, sem fidelidade',
    texto: 'Um valor por negócio, sem taxa por agendamento. Cancele quando quiser, sem multa.',
  },
  {
    icone: Smartphone,
    titulo: 'Nada pra instalar',
    texto: 'Abre no navegador do computador e vira app na tela do celular.',
  },
  {
    icone: Upload,
    titulo: 'Começa com o que você já tem',
    texto: 'Importe a planilha de clientes e produtos. O assistente pede só o que falta pro seu tipo de negócio.',
    grande: true,
  },
  {
    icone: ShieldCheck,
    titulo: 'Seguro de verdade',
    texto: 'Login em 2 etapas, conexão criptografada, backup diário e cada negócio vendo só os próprios dados.',
    grande: true,
  },
  {
    icone: Download,
    titulo: 'Seus dados são seus',
    texto: 'Exporte quando quiser. Se o teste acabar ou você cancelar, nada some de uma hora pra outra.',
  },
];

export default function Vantagens() {
  return (
    <section id="vantagens" aria-labelledby="titulo-vantagens" className={`${container} py-20 sm:py-28`}>
      <Revelar className="max-w-[680px]">
        <p className="m-0 text-[13px] font-semibold text-[#136F4D] uppercase tracking-[0.08em]">Por que o Sellergy</p>
        <h2 id="titulo-vantagens" className={`${tituloSecao} mt-3 mb-0`}>
          Simples pra começar, <span className="ld-texto-vivo">sólido pra crescer.</span>
        </h2>
      </Revelar>

      <ul className="list-none p-0 mt-12 mb-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {VANTAGENS.map((v, i) => {
          const Icone = v.icone;
          return (
            <Revelar
              key={v.titulo}
              como="li"
              atraso={(i % 3) * 110}
              className={v.grande ? 'lg:col-span-2' : ''}
            >
              <div
                onMouseMove={moverHolofote}
                className="ld-holofote group h-full bg-white border border-[#E3E5E8] rounded-[20px] p-7 transition-[translate,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-[#BFDCCD] hover:shadow-[0_24px_50px_rgba(19,111,77,0.12)]"
              >
              <span className="w-12 h-12 rounded-[14px] bg-[#E3F1EA] text-[#136F4D] grid place-items-center transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                <Icone size={22} aria-hidden="true" />
              </span>
              <h3 className={`${titulo} mt-5 mb-0 text-[21px] font-bold tracking-[-0.01em]`}>{v.titulo}</h3>
              <p className="mt-2 mb-0 text-[#4A5059] leading-[1.6] max-w-[520px]">{v.texto}</p>
              </div>
            </Revelar>
          );
        })}
      </ul>
    </section>
  );
}
