# Assinatura automática, WhatsApp não oficial e 2FA

Complementa o [fase-1-estrutura.md](fase-1-estrutura.md). Branch `feat/fase-1-estrutura`, 23/11/2026.

## Mensalidade do Sellergy: teste grátis e cobrança automática

| Peça | Onde | O que faz |
|---|---|---|
| Teste grátis | `onboarding/cadastro.js` | 14 dias do plano Profissional, sem cartão. |
| Assinar | `POST /conta/assinar` → `assinatura/cobranca.js#assinarPlano` | Plano + ciclo (mensal ou anual com 20% off) + forma (Pix, cartão, boleto ou escolher na hora). Se assinar no teste, a 1ª cobrança vence no fim do teste. |
| Cobrança automática | `assinatura/asaasPlataforma.js` | Assinatura recorrente no Asaas da plataforma. O cartão é digitado na página do Asaas, nunca passa pelo nosso servidor. Devolve o `linkPagamento`. |
| Webhook | `POST /webhooks/assinatura/asaas` → `assinatura/webhookAsaas.js` | Token conferido em tempo constante (sem token configurado recusa tudo); refaz a consulta da cobrança na API; idempotente por evento. Cria, baixa e vence as faturas locais. |
| Modo manual | mesmo código, sem `ASAAS_PLATAFORMA_API_KEY` | Faturas geradas pela rotina diária e baixa pelo admin. |
| Régua | `cobranca.js#rodarRegua` (worker, 09:00) | Aviso no sistema e no WhatsApp 3 dias antes, no dia e com 1, 3 e 7 dias de atraso. Cada passo sai uma vez só (`avisosRegua`). Com 10 dias de atraso a conta fica só para consulta; nada é apagado. |
| Avisos pelo WhatsApp | `assinatura/avisos.js` | Saem do número do próprio Sellergy (`PLATAFORMA_CLIENTE_ID`) para o telefone do cliente. A API manda pela fila `aviso-plataforma`; o worker envia. |
| Cancelar | `POST /conta/cancelar`, `POST /admin/assinaturas/:id/cancelar` | Cancela no Asaas, conta só para consulta. |
| Admin | `routes/assinaturas.routes.js` | Resumo (MRR, pagantes, testes, atraso, cancelamento), faturas, dar baixa, estender teste, suspender, reativar, mudar plano. |

Configurar no Asaas (conta da plataforma): webhook para `https://api.sellergycloud.com/webhooks/assinatura/asaas`, eventos de cobrança, token de autenticação = `ASAAS_PLATAFORMA_WEBHOOK_TOKEN`.

## WhatsApp pelo QR Code (Baileys, não oficial)

O canal QR Code agora faz quase tudo. Para não queimar o número do cliente, todo envio passa pelo **envio humano** (`services/baileys/envioHumano.js`):

1. Espaçamento por número no Redis (conversa 2,5–6 s, lembrete 6–15 s, campanha 25–55 s, sempre aleatório).
2. "Digitando..." antes de enviar, proporcional ao texto.
3. Cota diária de campanha com aquecimento: 30/dia nos 3 primeiros dias conectado, 80 até 7 dias, 180 até 14, 300 até 30, depois 450. O que passa fica para o dia seguinte, sozinho.
4. Campanha só das 8h às 20h (Brasília).
5. Confere se o número tem WhatsApp antes de mandar (cache de 30 dias).
6. Variação de texto: `{Oi|Olá|E aí}, [nome]!` sai diferente para cada contato.
7. Disjuntor: 5 falhas seguidas pausam as campanhas daquele número por 1 hora.
8. Quem responde SAIR/PARAR entra em `OptOutWhatsapp` e não recebe mais campanha nem lembrete.

Recursos novos do canal:

- **Lembrete com enquete** Confirmar / Remarcar: o voto volta decifrado (`messages.update`) e muda o status na agenda. "1"/"2" e o link continuam valendo.
- **Campanha liberada** pelo QR Code (até 2.000 contatos por campanha, espalhados pela cota). Interruptor de emergência: `CAMPANHA_CANAL_NAO_OFICIAL=bloqueado`.
- Envio de imagem e documento, marca como lida a mensagem que respondeu, ignora grupos, status e canais.
- Conexão leve (sem histórico, sem "online" automático) e reconexão com espera crescente; para sozinha quando o WhatsApp bloqueia o número ou a sessão é aberta em outro lugar, e avisa o cliente.

Risco que continua existindo: é uma API não oficial. O WhatsApp pode banir números que abusam. As regras acima reduzem muito, mas não zeram. O canal oficial (Meta) continua disponível para quem quiser zero risco.

## Código em 2 etapas (2FA)

- TOTP padrão (Google Authenticator, 1Password, Authy), sem dependência nova: `seguranca/totp.js`.
- Segredo cifrado no banco com o cofre; o mesmo código não entra duas vezes (anti-replay no Redis).
- Login: a senha devolve um desafio de 5 minutos; a sessão só sai em `POST /autenticacao/login/2fa`.
- `ADMIN_2FA_OBRIGATORIO=true`: o admin sem 2FA só consegue acessar a tela para ativá-lo. Sessão do admin dura 12 h.

## Variáveis novas

| Variável | Para quê |
|---|---|
| `ASAAS_PLATAFORMA_API_KEY` | Liga a cobrança automática da mensalidade |
| `ASAAS_PLATAFORMA_AMBIENTE` | `sandbox` (padrão) ou `producao` |
| `ASAAS_PLATAFORMA_WEBHOOK_TOKEN` | Token do webhook (obrigatório pra rota aceitar eventos) |
| `PLATAFORMA_CLIENTE_ID` | Negócio do próprio Sellergy cujo WhatsApp avisa os clientes |
| `BAILEYS_ENVIO_REAL` | `1` liga o envio de verdade pelo QR Code |
| `CAMPANHA_CANAL_NAO_OFICIAL` | `bloqueado` pausa campanhas pelo QR Code |
| `ADMIN_2FA_OBRIGATORIO` | `true` exige 2FA do admin |

## Como foi testado

- `node --test` no backend (inclui `totp.test.js`, `envioHumano.test.js`, `assinatura.test.js`).
- Smoke contra o backend local: cadastro, assinar anual no teste, admin (baixa, suspender, reativar), cancelar, webhook recusando sem token, 2FA completo (26 de 26).
- Webhook e régua direto no banco: criado → aviso 3 dias antes (sem repetir) → vencido → pago → reativado, evento repetido ignorado (10 de 10).
- **Não testado** contra o Asaas sandbox de verdade (falta a chave) nem com um celular real no QR Code.
