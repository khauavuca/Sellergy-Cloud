import { Link } from 'react-router-dom';
import PaginaLegal from '../components/legal/PaginaLegal';
import { EMPRESA } from '../legal/empresa';

const SECOES = [
  {
    id: 'quem-somos',
    titulo: 'Quem somos e o que é o serviço',
    conteudo: (
      <>
        <p>
          O <strong>{EMPRESA.marca}</strong> é um sistema online de gestão para clínicas de estética, salões e lojas pequenas:
          agenda com lembretes, vendas e caixa, estoque, cobrança por Pix e link, nota fiscal, catálogo online e atendimento
          pelo WhatsApp. O serviço é oferecido por {EMPRESA.razaoSocial}, CNPJ {EMPRESA.cnpj}, com endereço em {EMPRESA.endereco}.
        </p>
        <p>
          Ao criar uma conta ou usar o sistema, você concorda com estes Termos e com a{' '}
          <Link to="/privacidade">Política de privacidade</Link>. Se usa o sistema em nome de uma empresa, declara que tem poderes para aceitar por ela.
        </p>
      </>
    ),
  },
  {
    id: 'conta',
    titulo: 'Sua conta',
    conteudo: (
      <ul>
        <li>Você precisa ter 18 anos ou mais e informar dados verdadeiros no cadastro.</li>
        <li>Login e senha são pessoais. Recomendamos ativar o código em 2 etapas. Você responde pelo que for feito com o seu acesso.</li>
        <li>O dono da conta pode convidar pessoas da equipe e define o que cada uma pode ver e fazer.</li>
        <li>Se perceber uso indevido da sua conta, avise a gente na hora.</li>
      </ul>
    ),
  },
  {
    id: 'teste-e-planos',
    titulo: 'Teste grátis, planos e pagamento',
    conteudo: (
      <>
        <ul>
          <li><strong>Teste grátis:</strong> 14 dias com os recursos do plano Profissional, sem cartão. Ao fim do teste, sem plano escolhido, a conta fica só para consulta.</li>
          <li><strong>Planos:</strong> preço fixo por negócio, mensal ou anual (o anual tem desconto). Preços e limites de cada plano estão na página de preços.</li>
          <li><strong>Cobrança:</strong> recorrente, por Pix, boleto ou cartão, processada pelo nosso parceiro de pagamento. Os dados do cartão são digitados no ambiente do parceiro e não ficam com a gente.</li>
          <li><strong>Atraso:</strong> avisamos antes e depois do vencimento. Com 10 dias de atraso, a conta fica só para consulta até o pagamento. Nada é apagado por atraso.</li>
          <li><strong>Mudança de preço:</strong> avisamos com pelo menos 30 dias de antecedência. Quem já assina mantém o preço até o fim do ciclo pago.</li>
        </ul>
        <p>Valores pagos de um período já iniciado não são devolvidos, exceto quando a lei exigir.</p>
      </>
    ),
  },
  {
    id: 'cancelamento',
    titulo: 'Cancelamento',
    conteudo: (
      <ul>
        <li>Você pode cancelar quando quiser, sem multa e sem fidelidade, na tela Meu plano.</li>
        <li>Depois de cancelada, a conta fica disponível só para consulta e exportação por 60 dias. Avisamos antes de apagar os dados de vez.</li>
        <li>Documentos que a lei manda guardar (como notas fiscais) são mantidos pelo prazo legal.</li>
        <li>Podemos suspender ou encerrar contas que violem estes Termos, com aviso, salvo em caso de fraude ou risco a terceiros.</li>
      </ul>
    ),
  },
  {
    id: 'whatsapp',
    titulo: 'WhatsApp e mensagens',
    conteudo: (
      <>
        <p>O sistema envia mensagens pelo WhatsApp do seu negócio (lembretes, confirmações, cobranças, campanhas). Há dois jeitos de conectar:</p>
        <ul>
          <li><strong>WhatsApp oficial (API da Meta):</strong> segue as regras e os preços da Meta.</li>
          <li>
            <strong>WhatsApp pelo QR Code:</strong> usa a conexão do WhatsApp Web, que <strong>não é oficial</strong>. Aplicamos limites e
            intervalos para reduzir riscos, mas o WhatsApp pode restringir ou bloquear o número a qualquer momento, por decisão dele. Ao usar
            esse modo, você assume esse risco.
          </li>
        </ul>
        <p>
          Você só deve mandar mensagens para quem é seu cliente ou autorizou o contato, e deve respeitar quem pedir para sair (o sistema faz
          isso sozinho quando a pessoa responde SAIR). É proibido usar o sistema para spam, golpes ou conteúdo ilegal.
        </p>
      </>
    ),
  },
  {
    id: 'dados-dos-seus-clientes',
    titulo: 'Dados dos seus clientes',
    conteudo: (
      <>
        <p>
          Os dados que você cadastra sobre os seus clientes (nome, telefone, histórico, agendamentos, compras) são seus. Para esses dados,
          <strong> você é o controlador</strong> e o {EMPRESA.marca} é o <strong>operador</strong>, nos termos da LGPD: tratamos esses dados só
          para prestar o serviço a você, seguindo as suas instruções.
        </p>
        <p>
          Você é responsável por ter base legal para tratar esses dados e por informar seus clientes sobre isso. Os detalhes estão na{' '}
          <Link to="/privacidade">Política de privacidade</Link>.
        </p>
      </>
    ),
  },
  {
    id: 'nota-fiscal-e-pagamentos',
    titulo: 'Nota fiscal e pagamentos dos seus clientes',
    conteudo: (
      <ul>
        <li>A emissão de nota depende do seu certificado digital, do seu cadastro na prefeitura ou SEFAZ e de um emissor parceiro. Os dados fiscais informados (regime, alíquotas, códigos) são de sua responsabilidade.</li>
        <li>As cobranças que você faz para os seus clientes passam pelo provedor de pagamento escolhido por você (ou pela conta de recebimento aberta pelo sistema), com as taxas e regras desse provedor.</li>
        <li>O {EMPRESA.marca} não é banco nem instituição de pagamento e não guarda dinheiro dos seus clientes.</li>
      </ul>
    ),
  },
  {
    id: 'uso-permitido',
    titulo: 'O que não pode',
    conteudo: (
      <ul>
        <li>Usar o sistema para atividade ilegal, fraude ou para enganar pessoas.</li>
        <li>Tentar acessar dados de outros negócios, burlar limites, testar a segurança sem autorização ou sobrecarregar o serviço.</li>
        <li>Copiar, revender ou fazer engenharia reversa do sistema.</li>
      </ul>
    ),
  },
  {
    id: 'disponibilidade',
    titulo: 'Disponibilidade e suporte',
    conteudo: (
      <>
        <p>
          Trabalhamos para manter o sistema no ar o tempo todo, com backups diários. Podem acontecer paradas para manutenção (avisadas sempre
          que possível) e falhas de serviços de terceiros (WhatsApp, provedores de pagamento, prefeituras, internet).
        </p>
        <p>O suporte é feito pelo botão Ajuda dentro do sistema e pelos canais informados no site.</p>
      </>
    ),
  },
  {
    id: 'responsabilidade',
    titulo: 'Limites de responsabilidade',
    conteudo: (
      <>
        <p>
          O sistema é uma ferramenta: as decisões do seu negócio (preços, cobranças, mensagens, dados fiscais) são suas. Não respondemos por
          lucros cessantes, perda de clientes ou bloqueios de número feitos pelo WhatsApp.
        </p>
        <p>
          Quando houver responsabilidade nossa, ela fica limitada ao valor pago por você nos últimos 12 meses, exceto nos casos em que a lei
          não permite esse limite.
        </p>
      </>
    ),
  },
  {
    id: 'propriedade',
    titulo: 'Propriedade intelectual',
    conteudo: (
      <p>
        O sistema, a marca e o conteúdo do site são do {EMPRESA.marca}. Você recebe uma licença de uso enquanto a assinatura estiver ativa.
        Os seus dados continuam seus e podem ser exportados.
      </p>
    ),
  },
  {
    id: 'mudancas',
    titulo: 'Mudanças nestes Termos',
    conteudo: (
      <p>
        Podemos atualizar estes Termos. Mudanças importantes são avisadas no sistema e por e-mail ou WhatsApp com antecedência. Continuar
        usando depois da data de vigência significa concordar com a nova versão.
      </p>
    ),
  },
  {
    id: 'lei-e-foro',
    titulo: 'Lei aplicável e contato',
    conteudo: (
      <>
        <p>
          Estes Termos seguem as leis do Brasil. Fica eleito o foro de {EMPRESA.foro}, ressalvado o direito do consumidor de escolher o foro do
          seu domicílio.
        </p>
        <p>Dúvidas: {EMPRESA.emailContato}.</p>
      </>
    ),
  },
];

export default function TermosPage() {
  return (
    <PaginaLegal
      titulo="Termos de uso"
      resumo="Estas são as regras de uso do Sellergy Cloud, escritas do jeito mais direto possível. Leia com calma: ao criar uma conta você concorda com elas."
      secoes={SECOES}
    />
  );
}
