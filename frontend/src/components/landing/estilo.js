// Classes compartilhadas da landing. Cores fixas (nao seguem o tema escuro do
// app) para a pagina publica ficar igual para todo visitante.
//   primaria #136F4D · escura #0F3D2C · ambar #F2C46B
//   texto #15171A · muted #5B616B · borda #E3E5E8 · fundo #F6F7F5

export const foco =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#136F4D] focus-visible:ring-offset-2 focus-visible:ring-offset-white';

const botaoBase =
  'inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-[10px] font-semibold text-[15px] no-underline transition-colors cursor-pointer select-none';

export const botaoPrimario = `${botaoBase} ${foco} bg-[#136F4D] text-white border border-[#136F4D] hover:bg-[#0F5C40] hover:border-[#0F5C40]`;
export const botaoSecundario = `${botaoBase} ${foco} bg-white text-[#15171A] border border-[#CFD3D8] hover:bg-[#F1F2EF]`;
export const botaoAmbar = `${botaoBase} ${foco} bg-[#F2C46B] text-[#15171A] border border-[#F2C46B] hover:bg-[#EDB548] hover:border-[#EDB548]`;

export const titulo = "font-[family-name:'Space_Grotesk',Inter,system-ui,sans-serif] tracking-[-0.025em]";
export const sobretitulo = 'text-[13px] font-semibold uppercase tracking-[0.08em] text-[#136F4D]';
export const container = 'max-w-[1200px] mx-auto px-4 sm:px-6';
