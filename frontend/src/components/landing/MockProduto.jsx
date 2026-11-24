import { IconeCheck } from './Icones';
import { titulo } from './estilo';

// Ilustracao do produto (igual ao prototipo), so com HTML/CSS. Nomes ficticios
// de exemplo; nao representam clientes reais.
const HORARIOS = [
  { hora: '09:00', nome: 'Mariana Alves', servico: 'Limpeza de pele · Ana', status: 'Confirmado' },
  { hora: '10:30', nome: 'Paula Rocha', servico: 'Drenagem · Bruno', status: 'Aguardando' },
  { hora: '14:30', nome: 'Juliana Costa', servico: 'Peeling químico · Carla', status: 'Confirmado' },
];

const corStatus = {
  Confirmado: 'bg-[#E3F4EA] text-[#0E5C34]',
  Aguardando: 'bg-[#FDF0D9] text-[#7A4A00]',
};

const cartao = 'bg-white border border-[#E3E5E8] rounded-2xl shadow-[0_12px_32px_rgba(21,23,26,0.06)]';

export default function MockProduto() {
  return (
    <div
      role="img"
      aria-label="Exemplo do sistema: agenda do dia, lembrete confirmado no WhatsApp e Pix recebido"
      className="flex flex-col gap-3.5 min-w-0"
    >
      {/* Agenda de hoje */}
      <div className={`${cartao} px-5 py-[18px] mr-4 sm:mr-12`}>
        <div className="flex justify-between items-baseline gap-3">
          <p className="m-0 font-semibold">Agenda de hoje</p>
          <p className="m-0 text-[13px] text-[#5B616B]">terça, 24 de novembro</p>
        </div>
        <div className="flex flex-col mt-2.5">
          {HORARIOS.map((h, i) => (
            <div
              key={h.hora}
              className={`flex items-center gap-3.5 py-2.5 ${i < HORARIOS.length - 1 ? 'border-b border-[#EEF0EC]' : ''}`}
            >
              <span className="w-[46px] shrink-0 font-semibold tabular-nums">{h.hora}</span>
              <span className="flex-1 min-w-0 text-[14px]">
                {h.nome}
                <br />
                <span className="text-[#5B616B]">{h.servico}</span>
              </span>
              <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full ${corStatus[h.status]}`}>{h.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Lembrete no WhatsApp */}
      <div className={`${cartao} px-[18px] py-4 ml-4 sm:ml-12`}>
        <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#5B616B]">
          Lembrete automático · 24 h antes
        </p>
        <div className="mt-2.5 bg-[#EEF6F1] rounded-[4px_14px_14px_14px] px-3.5 py-3 text-[14px] leading-[1.45] max-w-[330px]">
          Olá, Juliana! Passando para lembrar do seu horário na Clínica Lumi: amanhã, às 14:30. Você confirma?
          <div className="flex gap-2 mt-2.5">
            <span className="flex-1 text-center bg-white rounded-lg p-2 font-semibold text-[#136F4D]">Confirmar</span>
            <span className="flex-1 text-center bg-white rounded-lg p-2 font-semibold text-[#136F4D]">Remarcar</span>
          </div>
        </div>
        <div className="flex justify-end mt-2">
          <span className="bg-[#15171A] text-white rounded-[14px_4px_14px_14px] px-3.5 py-2 text-[14px]">Confirmar</span>
        </div>
        <p className="mt-2 mb-0 text-[12px] text-[#5B616B] text-right">Agenda atualizada: confirmado às 14:41</p>
      </div>

      {/* Pix recebido */}
      <div className="bg-[#15171A] text-white rounded-2xl px-5 py-4 flex items-center gap-3.5 mr-0 sm:mr-24">
        <span className="w-10 h-10 shrink-0 rounded-xl bg-[#136F4D] grid place-items-center">
          <IconeCheck />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold">Pix recebido</span>
          <span className="text-[13px] text-[#B9BEC6]">Venda 1042 · balcão · caixa aberto às 08:02</span>
        </span>
        <span className={`${titulo} text-[22px] font-bold tabular-nums whitespace-nowrap`}>R$ 189,80</span>
      </div>
    </div>
  );
}
