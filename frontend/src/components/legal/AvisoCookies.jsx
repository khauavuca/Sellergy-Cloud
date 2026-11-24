import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { lerConsentimento, salvarConsentimento, EVENTO_ABRIR_COOKIES } from './consentimentoCookies';

const foco = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#136F4D] focus-visible:ring-offset-2';
const botao = `inline-flex items-center justify-center min-h-11 px-5 rounded-[10px] font-semibold text-[15px] cursor-pointer ${foco}`;

/**
 * Aviso de cookies (LGPD). Aparece na primeira visita, em todas as paginas,
 * ate a pessoa escolher. Reabre pelo link "preferências de cookies".
 */
export default function AvisoCookies() {
  const [aberto, setAberto] = useState(() => !lerConsentimento());

  useEffect(() => {
    const abrir = () => setAberto(true);
    window.addEventListener(EVENTO_ABRIR_COOKIES, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_COOKIES, abrir);
  }, []);

  if (!aberto) return null;

  const escolher = (escolha) => {
    salvarConsentimento(escolha);
    setAberto(false);
  };

  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      data-no-print
      className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4 font-[family-name:Inter,system-ui,sans-serif]"
    >
      <div className="max-w-[1100px] mx-auto bg-white border border-[#E3E5E8] rounded-2xl shadow-[0_12px_40px_rgba(21,23,26,0.18)] p-4 sm:p-5 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1 text-[14px] leading-[1.55] text-[#3D434B]">
          <p className="m-0 font-semibold text-[15px] text-[#15171A]">Usamos cookies</p>
          <p className="mt-1 mb-0">
            Os essenciais mantêm você logado com segurança e lembram suas preferências. Cookies de medição ou marketing só com a sua
            autorização. Saiba mais na <Link to="/privacidade#cookies" className="text-[#136F4D] font-semibold">Política de privacidade</Link>.
          </p>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:shrink-0">
          <button type="button" onClick={() => escolher('essenciais')} className={`${botao} bg-white text-[#15171A] border border-[#CFD3D8] hover:bg-[#F1F2EF]`}>
            Só os essenciais
          </button>
          <button type="button" onClick={() => escolher('todos')} className={`${botao} bg-[#136F4D] text-white border border-[#136F4D] hover:bg-[#0F5C40]`}>
            Aceitar todos
          </button>
        </div>
      </div>
    </div>
  );
}
