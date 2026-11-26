// =====================================================================
// CONTEUDO DA LANDING — textos, contatos e planos de reserva.
// =====================================================================
// Textos copiados do prototipo aprovado pelo dono
// (docs/prototipo/clientes/project/Main.dc.html).
//
// Regra da casa: nada de depoimento, numero de clientes, avaliacao ou logo
// de empresa inventados. So o que o produto faz de verdade.
// =====================================================================

/**
 * WhatsApp comercial, so digitos com DDI (ex.: 5511988887777), lido de
 * VITE_WHATSAPP_CONTATO no build. Vazio = a landing nao mostra o contato.
 */
export const WHATSAPP_CONTATO = String(import.meta.env.VITE_WHATSAPP_CONTATO || '').replace(/\D/g, '');

/** Link do WhatsApp, ou null enquanto o numero nao foi configurado. */
export function linkWhatsapp() {
  if (WHATSAPP_CONTATO.length < 10) return null;
  return `https://wa.me/${WHATSAPP_CONTATO}`;
}

export const ROTA_CADASTRO = '/cadastro';
export const ROTA_LOGIN = '/app/login';

export const LINKS_LEGAIS = [
  { rotulo: 'Termos de uso', to: '/termos' },
  { rotulo: 'Privacidade', to: '/privacidade' },
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

/** Plano destacado (o mesmo liberado no teste gratis). */
export const PLANO_RECOMENDADO = 'PRO';

/** Texto de cada plano conhecido, como no prototipo. Plano novo da API usa a descricao dela. */
export const TEXTO_PLANO = {
  BASIC: {
    desc: 'Para sair do caderno e da planilha.',
    itens: ['Vendas, agenda, caixa e estoque', 'Pix com QR na tela', 'Lembrete e confirmação no WhatsApp', 'Caixa que abre sozinho'],
  },
  PRO: {
    desc: 'Para quem quer agenda cheia e nota em dia.',
    itens: ['Tudo do Essencial', 'Nota fiscal NFC-e e NFS-e', 'Link de agendamento online', 'Pacotes de sessões', 'Campanhas e recompra', 'Catálogo online'],
  },
  PREMIUM: {
    desc: 'Para equipe maior ou mais de um caixa.',
    itens: ['Tudo do Profissional', 'Atendimento com IA no WhatsApp', 'Relatórios avançados', 'Ajuda na migração dos dados'],
  },
};

/** Nome de cada recurso do catalogo (so para plano que nao esta em TEXTO_PLANO). */
export const ROTULO_RECURSO = {
  vendas: 'Vendas no balcão (PDV)',
  pagamentos: 'Pix com QR na tela',
  financeiro: 'Caixa e financeiro',
  estoque: 'Controle de estoque',
  agenda: 'Agenda de atendimentos',
  lembretesWhatsapp: 'Lembrete e confirmação no WhatsApp',
  notaFiscal: 'Nota fiscal NFC-e e NFS-e',
  linkAgendamento: 'Link de agendamento online',
  catalogoOnline: 'Catálogo online',
  pacotes: 'Pacotes de sessões',
  campanhas: 'Campanhas e recompra',
  atendimentoIa: 'Atendimento com IA no WhatsApp',
  relatoriosAvancados: 'Relatórios avançados',
};

// ---------------------------------------------------------------------
// Beneficios por segmento (abas Clinicas e estetica / Lojas)
// ---------------------------------------------------------------------
export const SEGMENTOS = [
  {
    id: 'clinicas',
    rotulo: 'Clínicas e estética',
    itens: [
      {
        chave: 'Agenda',
        titulo: 'Lembrete que confirma sozinho',
        texto: '24 h antes, o cliente recebe a mensagem com os botões Confirmar e Remarcar. Quem não responde ganha um segundo aviso 2 h antes.',
        pontos: ['Status na agenda na hora', 'Horário remarcado volta a ficar livre'],
      },
      {
        chave: 'Link de agendamento',
        titulo: 'Sua agenda aberta 24 horas',
        texto: 'Um link para pôr na bio e no WhatsApp. O cliente escolhe serviço, profissional e horário, e só aparecem horários livres de verdade.',
        pontos: ['sellergycloud.com/agendar/seu-negocio', 'Cliente novo vira cadastro sozinho'],
      },
      {
        chave: 'Atendimento',
        titulo: 'Concluiu, cobrou',
        texto: 'Ao concluir o atendimento, a venda já vem montada com serviço e profissional. É só escolher Pix, cartão ou dinheiro.',
        pontos: ['Pacotes de sessões com saldo', 'NFS-e no plano Profissional'],
      },
    ],
  },
  {
    id: 'lojas',
    rotulo: 'Lojas',
    itens: [
      {
        chave: 'Balcão',
        titulo: 'Venda em três toques',
        texto: 'Busque ou leia o código, ajuste a quantidade e receba. O Pix gera o QR na tela e a venda fecha quando o pagamento cai.',
        pontos: ['Pix, cartão e dinheiro', 'NFC-e no plano Profissional'],
      },
      {
        chave: 'Caixa',
        titulo: 'O caixa abre sozinho',
        texto: 'A primeira venda do dia abre o caixa com o troco do último fechamento. No fim do dia, o fechamento mostra o que entrou em cada forma de pagamento.',
        pontos: ['Sangria e suprimento', 'Diferença destacada no fechamento'],
      },
      {
        chave: 'Estoque e recompra',
        titulo: 'Avisa antes de faltar',
        texto: 'Cada venda baixa o estoque. Produto acabando aparece no início, e quem comprou há 30 dias pode receber uma mensagem de recompra.',
        pontos: ['Catálogo online para compartilhar', 'Campanhas pelo WhatsApp oficial'],
      },
    ],
  },
];

// ---------------------------------------------------------------------
// Como funciona
// ---------------------------------------------------------------------
// O prototipo diz "seu WhatsApp", mas o cadastro real pede e-mail (WhatsApp
// e opcional); o texto segue o que a tela de cadastro pede de verdade.
export const PASSOS = [
  { titulo: 'Crie a conta', texto: 'Nome do negócio, seu e-mail e uma senha. Leva uns dois minutos e você já entra no sistema.' },
  { titulo: 'Siga os primeiros passos', texto: 'O assistente pede só o que falta pro seu tipo de negócio: serviços ou produtos, profissionais e horário de atendimento.' },
  { titulo: 'Conecte o WhatsApp', texto: 'Leia o QR Code com o celular do negócio, como no WhatsApp Web, ou use o WhatsApp oficial. Suas conversas e contatos aparecem no sistema e os lembretes saem sozinhos.' },
];

// ---------------------------------------------------------------------
// Perguntas frequentes
// ---------------------------------------------------------------------
export const PERGUNTAS = [
  {
    pergunta: 'Preciso de cartão de crédito para testar?',
    resposta: 'Não. Você cria a conta só com o nome do negócio, seu e-mail e uma senha. Os 14 dias começam na hora, com tudo do plano Profissional liberado.',
  },
  {
    pergunta: 'O que acontece quando o teste acaba?',
    resposta: 'Seus dados ficam salvos. Sem plano escolhido, a conta passa a só consulta: você vê tudo, mas não registra vendas nem agendamentos até assinar.',
  },
  {
    pergunta: 'Funciona com o WhatsApp que eu já uso?',
    resposta: 'Sim. Basta ler um QR Code com o celular do negócio, como no WhatsApp Web, e as conversas e contatos que já estão no número aparecem no sistema. Se preferir, use o WhatsApp oficial. Campanhas para muitos contatos saem só pelo WhatsApp oficial, para o seu número não ser bloqueado.',
  },
  {
    pergunta: 'Dá pra atender o WhatsApp pelo sistema?',
    resposta: 'Sim. Você responde por texto, foto, vídeo, áudio, documento ou mensagem de voz gravada na tela, deixa nota interna pra equipe e reage com emoji. Quem escreve vira cliente, com agenda, vendas e Pix ligados à ficha.',
  },
  {
    pergunta: 'Tenho ajuda se travar em alguma coisa?',
    resposta: 'Sim. Dentro do sistema tem um botão de ajuda com chat, e a Central de Ajuda (ajuda.sellergycloud.com) mostra o passo a passo de cada tela.',
  },
  {
    pergunta: 'Emite nota fiscal?',
    resposta: 'Sim, a partir do Profissional: NFC-e para venda de produto e NFS-e para serviço, emitidas na mesma tela da venda.',
  },
  {
    pergunta: 'Consigo trazer meus clientes de outro sistema ou planilha?',
    resposta: 'Sim. Você importa uma planilha de clientes e produtos. No plano Negócio a gente faz a migração com você.',
  },
];
