import { Check } from 'lucide-react';
import { titulo } from './estilo';

// Ilustracao do produto feita so com HTML/CSS. Os nomes sao ficticios e
// servem de exemplo; nao representam clientes reais.
const HORARIOS = [
  { hora: '09:00', nome: 'Mariana A.', servico: 'Limpeza de pele · Ana', status: 'Confirmado' },
  { hora: '10:30', nome: 'Paula R.', servico: 'Drenagem · Bruno', status: 'Aguardando' },
  { hora: '14:30', nome: 'Juliana C.', servico: 'Peeling químico · Carla', status: 'Confirmado' },
];

const corStatus = {
  Confirmado: 'bg-[#E3F4EA] text-[#0E5C34]',
  Aguardando: 'bg-[#FDF0D9] text-[#7A4A00]',
};

export default function MockProduto() {
  return (
    <div
      role="img"
      aria-label="Exemplo do sistema: agenda do dia com horários confirmados, lembrete respondido no WhatsApp e um Pix recebido no caixa"
      className="relative flex flex-col gap-3.5 select-none"
    >
      <div aria-hidden="true" className="absolute -inset-6 -z-10 rounded-[32px] bg-[radial-gradient(60%_60%_at_70%_30%,#DCEFE5_0%,transparent_70%)]" />

      {/* Agenda */}
      <div className="bg-white border border-[#E3E5E8] rounded-2xl px-5 py-4 shadow-[0_12px_32px_rgba(21,23,26,0.06)] sm:mr-12">
        <div className="flex justify-between items-baseline gap-3">
          <p className="m-0 font-semibold">Agenda de hoje</p>
          <p className="m-0 text-[13px] text-[#5B616B]">3 horários</p>
        </div>
        <ul className="mt-2.5 list-none p-0 m-0">
          {HORARIOS.map((h, i) => (
            <li
              key={h.hora}
              className={`flex items-center gap-3.5 py-2.5 ${i < HORARIOS.length - 1 ? 'border-b border-[#EEF0EC]' : ''}`}
            >
              <span className="w-[46px] font-semibold tabular-nums">{h.hora}</span>
              <span className="flex-1 text-sm leading-snug min-w-0">
                {h.nome}
                <span className="block text-[#5B616B] truncate">{h.servico}</span>
              </span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${corStatus[h.status]}`}>
                {h.status}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* WhatsApp */}
      <div className="bg-white border border-[#E3E5E8] rounded-2xl px-[18px] py-4 shadow-[0_12px_32px_rgba(21,23,26,0.06)] sm:ml-12">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.06em] text-[#5B616B]">
          Lembrete automático · 24 h antes
        </p>
        <div className="mt-2.5 bg-[#EEF6F1] rounded-[4px_14px_14px_14px] px-3.5 py-3 text-sm leading-relaxed max-w-[330px]">
          Olá, Juliana! Passando para lembrar do seu horário amanhã, às 14:30. Você confirma?
          <div className="flex gap-2 mt-2.5">
            <span className="flex-1 text-center bg-white rounded-lg py-2 font-semibold text-[#136F4D]">Confirmar</span>
            <span className="flex-1 text-center bg-white rounded-lg py-2 font-semibold text-[#136F4D]">Remarcar</span>
          </div>
        </div>
        <div className="flex justify-end mt-2">
          <span className="bg-[#15171A] text-white rounded-[14px_4px_14px_14px] px-3.5 py-2 text-sm">Confirmar</span>
        </div>
        <p className="mt-2 mb-0 text-xs text-[#5B616B] text-right">Agenda atualizada: confirmado às 14:41</p>
      </div>

      {/* Pix */}
      <div className="bg-[#0F3D2C] text-white rounded-2xl px-5 py-4 flex items-center gap-3.5 sm:mr-24">
        <span className="grid place-items-center w-10 h-10 rounded-xl bg-[#F2C46B] text-[#0F3D2C] shrink-0">
          <Check size={20} strokeWidth={2.5} aria-hidden="true" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold">Pix recebido</span>
          <span className="block text-[13px] text-[#C9D6CF] truncate">Venda no balcão · caixa aberto</span>
        </span>
        <span className={`${titulo} text-[22px] font-bold tabular-nums whitespace-nowrap`}>R$ 189,80</span>
      </div>
    </div>
  );
}
