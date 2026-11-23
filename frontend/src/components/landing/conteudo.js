// =====================================================================
// CONTEUDO DA LANDING — textos, contatos e planos de reserva.
// =====================================================================
// Troque aqui o que muda com frequencia (WhatsApp, links legais) sem
// precisar mexer nos componentes.
//
// Regra da casa: nada de depoimento, numero de clientes, avaliacao ou logo
// de empresa inventados. So o que o produto faz de verdade.
// =====================================================================

/** Numero do WhatsApp comercial, so digitos com DDI (ex.: '5511988887777'). */
export const WHATSAPP_CONTATO = '[SEU WHATSAPP]';

/** Link do WhatsApp, ou null enquanto o numero nao foi configurado. */
export function linkWhatsapp(mensagem = 'Olá! Quero saber mais sobre o Sellergy Cloud.') {
  const digitos = String(WHATSAPP_CONTATO).replace(/\D/g, '');
  if (digitos.length < 10) return null;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensagem)}`;
}

export const ROTA_CADASTRO = '/cadastro';
export const ROTA_LOGIN = '/app/login';

export const LINKS_LEGAIS = [
  { rotulo: 'Termos de uso', href: '#' },
  { rotulo: 'Privacidade', href: '#' },
];

export const DIAS_DE_TESTE_PADRAO = 14;
export const DESCONTO_ANUAL = 0.2;

// ---------------------------------------------------------------------
// Planos: espelho de backend/src/planos/catalogo.js, usado so quando
// GET /publico/planos falha. A fonte de verdade continua sendo a API.
// ---------------------------------------------------------------------
export const PLANOS_RESERVA = [
  {
    codigo: 'BASIC',
    nome: 'Essencial',
    precoMensal: 59,
    descricao: '1 loja ou até 2 profissionais',
    limites: { usuarios: 2, profissionais: 2, lembretesMes: 300 },
    recursos: {
      vendas: true, estoque: true, agenda: true, financeiro: true, lembretesWhatsapp: true, pagamentos: true,
      notaFiscal: false, campanhas: false, pacotes: false, linkAgendamento: false, catalogoOnline: false,
      atendimentoIa: false, relatoriosAvancados: false,
    },
  },
  {
    codigo: 'PRO',
    nome: 'Profissional',
    precoMensal: 119,
    descricao: 'até 5 usuários ou profissionais',
    limites: { usuarios: 5, profissionais: 5, lembretesMes: 1000 },
    recursos: {
      vendas: true, estoque: true, agenda: true, financeiro: true, lembretesWhatsapp: true, pagamentos: true,
      notaFiscal: true, campanhas: true, pacotes: true, linkAgendamento: true, catalogoOnline: true,
      atendimentoIa: false, relatoriosAvancados: false,
    },
  },
  {
    codigo: 'PREMIUM',
    nome: 'Negócio',
    precoMensal: 199,
    descricao: 'até 10 pessoas ou mais de uma unidade',
    limites: { usuarios: 10, profissionais: 10, lembretesMes: 3000 },
    recursos: {
      vendas: true, estoque: true, agenda: true, financeiro: true, lembretesWhatsapp: true, pagamentos: true,
      notaFiscal: true, campanhas: true, pacotes: true, linkAgendamento: true, catalogoOnline: true,
      atendimentoIa: true, relatoriosAvancados: true,
    },
  },
];

/** Plano destacado como recomendado (o mesmo liberado no teste gratis). */
export const PLANO_RECOMENDADO = 'PRO';

/** Nome de cada recurso do catalogo, na ordem em que aparece no card. */
export const ROTULO_RECURSO = {
  vendas: 'Vendas no balcão (PDV)',
  pagamentos: 'Pix com QR Code na tela',
  financeiro: 'Caixa e financeiro',
  estoque: 'Controle de estoque',
  agenda: 'Agenda de atendimentos',
  lembretesWhatsapp: 'Lembrete e confirmação no WhatsApp',
  notaFiscal: 'Nota fiscal (NFC-e e NFS-e)',
  linkAgendamento: 'Link de agendamento online',
  catalogoOnline: 'Catálogo online',
  pacotes: 'Pacotes de sessões',
  campanhas: 'Campanhas pelo WhatsApp',
  atendimentoIa: 'Atendimento com IA no WhatsApp',
  relatoriosAvancados: 'Relatórios avançados',
};

// ---------------------------------------------------------------------
// Beneficios por segmento (abas Clinicas / Lojas)
// ---------------------------------------------------------------------
export const SEGMENTOS = [
  {
    id: 'clinicas',
    rotulo: 'Clínicas e estética',
    itens: [
      {
        chave: 'Agenda',
        titulo: 'Lembrete que confirma sozinho',
        texto: '24 h antes, o cliente recebe a mensagem com os botões Confirmar e Remarcar. Quem ainda não confirmou ganha um segundo aviso 2 h antes.',
        pontos: ['Status atualizado na agenda na hora', 'Horário remarcado volta a ficar livre'],
      },
      {
        chave: 'Link de agendamento',
        titulo: 'Sua agenda aberta 24 horas',
        texto: 'Um link para pôr na bio e no WhatsApp. O cliente escolhe serviço, profissional e horário, e só aparecem horários livres de verdade.',
        pontos: ['Cliente novo vira cadastro sozinho', 'Disponível a partir do Profissional'],
      },
      {
        chave: 'Atendimento',
        titulo: 'Concluiu, cobrou',
        texto: 'Ao concluir o atendimento, a venda já vem montada com serviço e profissional. É só escolher Pix, cartão ou dinheiro.',
        pontos: ['Pacotes de sessões com saldo', 'NFS-e a partir do Profissional'],
      },
    ],
  },
  {
    id: 'lojas',
    rotulo: 'Lojas',
    itens: [
      {
        chave: 'Balcão',
        titulo: 'Venda em poucos toques',
        texto: 'Busque ou leia o código, ajuste a quantidade e receba. O Pix gera o QR Code na tela e a venda fecha quando o pagamento cai.',
        pontos: ['Pix, cartão e dinheiro', 'NFC-e a partir do Profissional'],
      },
      {
        chave: 'Caixa',
        titulo: 'O caixa abre sozinho',
        texto: 'A primeira venda do dia abre o caixa automaticamente. No fechamento, você vê o que entrou em cada forma de pagamento.',
        pontos: ['Sangria e suprimento', 'Diferença destacada no fechamento'],
      },
      {
        chave: 'Estoque e catálogo',
        titulo: 'Avisa antes de faltar',
        texto: 'Cada venda baixa o estoque, e o produto acabando aparece logo no início. Compartilhe o catálogo online com quem compra pelo WhatsApp.',
        pontos: ['Catálogo online para compartilhar', 'Campanhas pelo WhatsApp'],
      },
    ],
  },
];

// ---------------------------------------------------------------------
// Perguntas frequentes
// ---------------------------------------------------------------------
export const PERGUNTAS = [
  {
    pergunta: 'Preciso de cartão de crédito para testar?',
    resposta: 'Não. Você cria a conta com o nome do negócio, seu e-mail e uma senha. Os 14 dias começam na hora, com tudo do plano Profissional liberado.',
  },
  {
    pergunta: 'O que acontece quando o teste acaba?',
    resposta: 'Nada é apagado. Sem plano escolhido, a conta fica em modo só consulta: você vê tudo, mas não registra vendas nem agendamentos até assinar.',
  },
  {
    pergunta: 'Funciona com o WhatsApp que eu já uso?',
    resposta: 'Sim. Basta ler um QR Code com o celular do negócio. A partir daí, os lembretes e as confirmações de horário saem por esse número.',
  },
  {
    pergunta: 'Emite nota fiscal?',
    resposta: 'Sim, a partir do plano Profissional: NFC-e para venda de produto e NFS-e para serviço.',
  },
  {
    pergunta: 'Vocês cobram por profissional?',
    resposta: 'Não. O preço é fixo por negócio. Cada plano tem um limite de usuários e profissionais, e você troca de plano quando precisar de mais.',
  },
  {
    pergunta: 'Tem fidelidade ou multa para cancelar?',
    resposta: 'Não. Você pode cancelar ou trocar de plano quando quiser.',
  },
];
