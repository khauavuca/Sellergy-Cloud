import { Link } from 'react-router-dom';
import PaginaLegal from '../components/legal/PaginaLegal';
import { EMPRESA } from '../legal/empresa';
import { abrirPreferenciasCookies } from '../components/legal/consentimentoCookies';

const SECOES = [
  {
    id: 'quem-trata',
    titulo: 'Quem trata seus dados',
    conteudo: (
      <>
        <p>
          O {EMPRESA.marca} é oferecido por {EMPRESA.razaoSocial}, CNPJ {EMPRESA.cnpj}, {EMPRESA.endereco}. Esta Política explica quais dados
          pessoais tratamos, para quê e quais são os seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD).
        </p>
        <ul>
          <li><strong>Somos controladores</strong> dos dados de quem visita o site e de quem tem conta no sistema (donos e equipe dos negócios).</li>
          <li>
            <strong>Somos operadores</strong> dos dados que os negócios cadastram sobre os clientes deles (agenda, compras, mensagens). Nesse
            caso, quem decide sobre os dados é o negócio; para exercer seus direitos, fale primeiro com ele.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'dados-coletados',
    titulo: 'Quais dados tratamos',
    conteudo: (
      <ul>
        <li><strong>Cadastro:</strong> nome, e-mail, celular, nome do negócio, segmento e senha (guardada criptografada, nunca em texto).</li>
        <li><strong>Assinatura:</strong> CPF ou CNPJ, plano e histórico de faturas. Dados de cartão são digitados no ambiente do parceiro de pagamento e não ficam com a gente.</li>
        <li><strong>Uso do sistema:</strong> registros de acesso (data, hora e IP), ações feitas no sistema e mensagens de suporte.</li>
        <li><strong>Dados que você cadastra:</strong> clientes, agenda, vendas, estoque, financeiro, mensagens do WhatsApp do seu negócio e dados fiscais.</li>
        <li><strong>Certificado digital:</strong> o arquivo e a senha são enviados direto ao emissor de nota fiscal. Guardamos só a referência, o titular e a validade.</li>
      </ul>
    ),
  },
  {
    id: 'finalidades',
    titulo: 'Para que usamos e com qual base legal',
    conteudo: (
      <ul>
        <li><strong>Prestar o serviço</strong> (criar a conta, rodar agenda, vendas, cobranças, lembretes, notas): execução de contrato.</li>
        <li><strong>Cobrar a assinatura</strong> e emitir documentos fiscais: execução de contrato e obrigação legal.</li>
        <li><strong>Segurança</strong> (login em 2 etapas, prevenção de fraude, auditoria de acessos): legítimo interesse e obrigação legal.</li>
        <li><strong>Guardar registros de acesso</strong> por 6 meses: obrigação legal (Marco Civil da Internet).</li>
        <li><strong>Avisos sobre a conta</strong> (fatura, teste acabando, novidades do sistema): execução de contrato e legítimo interesse. Você pode pedir para não receber comunicados que não sejam essenciais.</li>
      </ul>
    ),
  },
  {
    id: 'compartilhamento',
    titulo: 'Com quem compartilhamos',
    conteudo: (
      <>
        <p>Não vendemos dados. Compartilhamos só o necessário com fornecedores que ajudam a prestar o serviço:</p>
        <ul>
          <li><strong>Hospedagem e infraestrutura:</strong> Hostinger (servidores e site) e armazenamento de backups criptografados.</li>
          <li><strong>Pagamentos:</strong> Asaas e, quando o negócio escolher, Mercado Pago ou outro provedor de pagamento.</li>
          <li><strong>WhatsApp:</strong> Meta (WhatsApp oficial) ou a conexão do WhatsApp Web do próprio negócio.</li>
          <li><strong>Nota fiscal:</strong> emissor parceiro (Focus NFe ou Nuvem Fiscal), prefeituras e SEFAZ.</li>
          <li><strong>Consulta de CNPJ:</strong> BrasilAPI, com dados públicos da Receita Federal.</li>
          <li><strong>Atendimento com IA</strong> (só no plano que tem esse recurso e quando o negócio liga): provedor de IA que processa o texto das conversas.</li>
          <li><strong>Fontes do site:</strong> Google Fonts.</li>
          <li><strong>Autoridades:</strong> quando a lei ou uma ordem judicial exigir.</li>
        </ul>
        <p>
          Alguns desses fornecedores podem tratar dados fora do Brasil (por exemplo, nos Estados Unidos). Nesses casos, a transferência segue
          o que a LGPD permite, com contratos e medidas de segurança adequadas.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    titulo: 'Cookies',
    conteudo: (
      <>
        <p>Usamos poucos cookies:</p>
        <ul>
          <li><strong>Essenciais:</strong> mantêm você logado com segurança (cookie de sessão protegido, que o navegador não deixa outros scripts lerem) e protegem contra ataques entre sites. Sem eles o sistema não funciona.</li>
          <li><strong>Preferências:</strong> lembram o tema claro ou escuro e a sua escolha sobre cookies, guardados no seu próprio navegador.</li>
          <li><strong>Medição e marketing:</strong> hoje não usamos. Se um dia usarmos, só serão ligados com a sua autorização.</li>
        </ul>
        <p>
          Você pode mudar sua escolha a qualquer momento:{' '}
          <button type="button" onClick={abrirPreferenciasCookies} className="text-[#136F4D] font-semibold underline underline-offset-2 bg-transparent border-0 p-0 cursor-pointer">
            abrir preferências de cookies
          </button>
          . Também dá para apagar cookies nas configurações do navegador (aí você precisa entrar de novo).
        </p>
      </>
    ),
  },
  {
    id: 'seguranca',
    titulo: 'Como protegemos',
    conteudo: (
      <ul>
        <li>Conexão sempre criptografada (HTTPS) e servidores com acesso restrito.</li>
        <li>Senhas com hash, credenciais e segredos criptografados, login em 2 etapas e registro de quem acessou o quê no painel interno.</li>
        <li>Cada negócio só enxerga os próprios dados.</li>
        <li>Backups diários criptografados, guardados fora do servidor principal.</li>
      </ul>
    ),
  },
  {
    id: 'retencao',
    titulo: 'Por quanto tempo guardamos',
    conteudo: (
      <ul>
        <li>Enquanto a conta estiver ativa.</li>
        <li>Depois do cancelamento: 60 dias só para consulta e exportação. Depois disso, os dados são apagados.</li>
        <li>Registros de acesso: 6 meses. Documentos fiscais e de cobrança: pelo prazo que a lei exigir (em geral, 5 anos).</li>
      </ul>
    ),
  },
  {
    id: 'direitos',
    titulo: 'Seus direitos',
    conteudo: (
      <>
        <p>Pela LGPD você pode, a qualquer momento:</p>
        <ul>
          <li>confirmar se tratamos seus dados e ter acesso a eles;</li>
          <li>corrigir dados incompletos ou errados;</li>
          <li>pedir anonimização, bloqueio ou eliminação de dados desnecessários;</li>
          <li>pedir a portabilidade (exportação) dos dados;</li>
          <li>saber com quem compartilhamos;</li>
          <li>revogar consentimentos e se opor a tratamentos baseados em legítimo interesse;</li>
          <li>reclamar na Autoridade Nacional de Proteção de Dados (ANPD).</li>
        </ul>
        <p>Respondemos em até 15 dias.</p>
      </>
    ),
  },
  {
    id: 'contato',
    titulo: 'Encarregado e contato',
    conteudo: (
      <>
        <p>
          Encarregado pelo tratamento de dados: {EMPRESA.encarregado}, pelo e-mail {EMPRESA.emailPrivacidade}.
        </p>
        <p>
          Esta Política pode ser atualizada; avisamos mudanças importantes no sistema. Veja também os{' '}
          <Link to="/termos">Termos de uso</Link>.
        </p>
      </>
    ),
  },
];

export default function PrivacidadePage() {
  return (
    <PaginaLegal
      titulo="Política de privacidade"
      resumo="Aqui explicamos, sem juridiquês, quais dados o Sellergy Cloud trata, para quê, com quem compartilha e como você exerce seus direitos."
      secoes={SECOES}
    />
  );
}
