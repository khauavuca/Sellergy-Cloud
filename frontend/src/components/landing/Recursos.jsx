import {
  BarChart3, CalendarCheck, Link2, MessageCircle, Package, QrCode, ReceiptText, Store, Wallet,
} from 'lucide-react';
import { container, sobretitulo, titulo } from './estilo';

// `plano` marca o que nao vem no Essencial (ver backend/src/planos/catalogo.js).
const RECURSOS = [
  { icone: CalendarCheck, titulo: 'Agenda com lembrete', texto: 'Agenda por profissional, com lembrete no WhatsApp 24 h e 2 h antes e confirmação em um toque.' },
  { icone: Link2, titulo: 'Link de agendamento', texto: 'O cliente marca sozinho pelo link, vendo só os horários livres de verdade.', plano: 'A partir do Profissional' },
  { icone: QrCode, titulo: 'PDV com Pix', texto: 'Venda no balcão com Pix, cartão ou dinheiro. O QR Code aparece na tela e a venda fecha quando o pagamento cai.' },
  { icone: Wallet, titulo: 'Caixa automático', texto: 'A primeira venda do dia abre o caixa. No fechamento você vê o que entrou em cada forma de pagamento.' },
  { icone: Package, titulo: 'Estoque', texto: 'Cada venda baixa o estoque, e o produto acabando aparece no início antes de faltar.' },
  { icone: Store, titulo: 'Catálogo online', texto: 'Uma vitrine com seus produtos e serviços para mandar no WhatsApp e pôr na bio.', plano: 'A partir do Profissional' },
  { icone: ReceiptText, titulo: 'Nota fiscal', texto: 'NFC-e para produto e NFS-e para serviço, emitidas a partir da venda.', plano: 'A partir do Profissional' },
  { icone: MessageCircle, titulo: 'WhatsApp do negócio', texto: 'Conecte o número que você já usa lendo um QR Code. Campanhas no Profissional e atendimento com IA no Negócio.' },
  { icone: BarChart3, titulo: 'Relatórios', texto: 'Vendas, caixa e financeiro do dia a dia em um lugar só. Relatórios avançados no plano Negócio.' },
];

export default function Recursos() {
  return (
    <section id="recursos" aria-labelledby="titulo-recursos" className={`${container} scroll-mt-20 py-16 md:py-20`}>
      <p className={`${sobretitulo} m-0`}>Recursos</p>
      <h2 id="titulo-recursos" className={`${titulo} text-[32px] md:text-[40px] leading-[1.1] font-bold mt-3 mb-0 max-w-[680px]`}>
        Tudo o que o caderno, a planilha e a maquininha faziam separado
      </h2>
      <ul className="list-none p-0 m-0 mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {RECURSOS.map(({ icone: Icone, titulo: nome, texto, plano }) => (
          <li key={nome} className="bg-white border border-[#E3E5E8] rounded-2xl p-6 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="grid place-items-center w-11 h-11 rounded-xl bg-[#E3F1EA] text-[#136F4D]">
                <Icone size={20} strokeWidth={1.9} aria-hidden="true" />
              </span>
              {plano && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#FBEFD4] text-[#6B4400]">{plano}</span>
              )}
            </div>
            <h3 className="m-0 text-lg font-semibold">{nome}</h3>
            <p className="m-0 text-[15px] text-[#4A5059] leading-relaxed">{texto}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
