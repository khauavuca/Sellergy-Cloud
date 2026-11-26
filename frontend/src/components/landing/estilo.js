// Classes compartilhadas da landing, copiadas do prototipo aprovado
// (docs/prototipo/clientes/project/Main.dc.html). Cores fixas: a pagina
// publica nao segue o tema escuro do painel.
//   primaria #136F4D · hover #0F5C40 · texto #15171A · muted #4A5059 / #5B616B
//   borda #E3E5E8 · fundo #F6F7F5 · faixa #EEF0EC · escuro #15171A

export const foco =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#136F4D] focus-visible:ring-offset-2 focus-visible:ring-offset-white';

/** Foco para elementos sobre o fundo escuro (#15171A). */
export const focoEscuro =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#15171A]';

// .bp / .bs do prototipo
const botaoBase =
  'inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-[10px] font-semibold text-[15px] no-underline cursor-pointer box-border transition-colors';

export const botaoPrimario = `${botaoBase} ${foco} bg-[#136F4D] text-white border border-[#136F4D] hover:bg-[#0F5C40] hover:text-white`;
export const botaoSecundario = `${botaoBase} ${foco} bg-white text-[#15171A] border border-[#D5D8DC] hover:bg-[#F1F2EF] hover:text-[#15171A]`;

// .nl do prototipo
export const linkNav = `inline-flex items-center min-h-11 px-3 rounded-lg text-[15px] font-medium text-[#3D434B] no-underline hover:bg-[#ECEEEA] hover:text-[#15171A] ${foco}`;

// .tab / .tab.on do prototipo
export const aba = (ligada) =>
  `min-h-11 px-[18px] rounded-full border-0 text-[15px] font-semibold cursor-pointer transition-colors ${foco} ${
    ligada ? 'bg-[#15171A] text-white' : 'bg-transparent text-[#4A5059] hover:text-[#15171A]'
  }`;

export const titulo = "font-[family-name:'Space_Grotesk',Inter,system-ui,sans-serif]";
/** h2 das secoes: Space Grotesk 40px, line-height 1.1, -0.025em. */
export const tituloSecao = `${titulo} font-bold text-[32px] sm:text-[40px] leading-[1.1] tracking-[-0.025em]`;
export const container = 'max-w-[1200px] mx-auto px-6';
