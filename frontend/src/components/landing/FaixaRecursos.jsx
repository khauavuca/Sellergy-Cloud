import {
  BellRing, Boxes, MessagesSquare, Contact, LifeBuoy, CalendarCheck, Megaphone, Package, Percent, QrCode, ReceiptText, Sparkles, Store, Wallet, Link2,
} from 'lucide-react';

// Recursos reais do sistema, rolando numa faixa infinita.
const RECURSOS = [
  { icone: MessagesSquare, texto: 'Conversas do WhatsApp' },
  { icone: Contact, texto: 'Ficha completa do cliente' },
  { icone: CalendarCheck, texto: 'Agenda online' },
  { icone: BellRing, texto: 'Lembrete no WhatsApp' },
  { icone: QrCode, texto: 'Pix com QR na tela' },
  { icone: ReceiptText, texto: 'NFC-e e NFS-e' },
  { icone: Wallet, texto: 'Caixa que abre sozinho' },
  { icone: Boxes, texto: 'Controle de estoque' },
  { icone: Link2, texto: 'Link de agendamento' },
  { icone: Store, texto: 'Catálogo online' },
  { icone: Package, texto: 'Pacotes de sessões' },
  { icone: Percent, texto: 'Comissões' },
  { icone: Megaphone, texto: 'Campanhas e recompra' },
  { icone: Sparkles, texto: 'Atendimento com IA' },
  { icone: LifeBuoy, texto: 'Ajuda dentro do sistema' },
];

function Lista({ escondida = false }) {
  return (
    <ul className="list-none m-0 p-0 flex shrink-0" aria-hidden={escondida || undefined}>
      {RECURSOS.map(({ icone: Icone, texto }) => (
        <li key={texto} className="flex items-center gap-2.5 px-6 text-[15px] font-semibold text-[#3D434B] whitespace-nowrap">
          <span className="w-8 h-8 rounded-lg bg-white border border-[#E3E5E8] text-[#136F4D] grid place-items-center">
            <Icone size={16} aria-hidden="true" />
          </span>
          {texto}
        </li>
      ))}
    </ul>
  );
}

export default function FaixaRecursos() {
  return (
    <section aria-label="O que tem no Sellergy Cloud" className="border-y border-[#E3E5E8] bg-[#F1F2EF] py-5">
      <div className="ld-faixa-moldura overflow-hidden">
        <div className="ld-faixa">
          <Lista />
          <Lista escondida />
        </div>
      </div>
    </section>
  );
}
