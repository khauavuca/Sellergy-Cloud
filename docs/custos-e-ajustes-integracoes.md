# Custos das integrações e plano de ajustes

Levantado em 24/11/2026. Os preços dos provedores vieram de fontes públicas de outubro e novembro de 2026; os sites oficiais ainda precisam ser conferidos antes de fechar preço (links no fim). Câmbio usado nas contas: **US$ 1 = R$ 5,50**.

## 1. Quem paga cada integração hoje (pelo código)

| Integração | Quem paga a conta do provedor | Observação |
|---|---|---|
| IA (DeepSeek) | **Plataforma** (uma chave só, do Sellergy) | Só o plano Negócio tem IA. Cada bot tem uma cota de tokens e um preço de excedente que hoje só aparece num relatório; ninguém cobra de verdade. |
| WhatsApp oficial (Meta) | Quem for dono da conta na Meta (WABA) do número | O token é cadastrado por cliente. Se o cliente usa a conta Meta dele, a Meta cobra no cartão dele. Os avisos da régua de cobrança saem do número do próprio Sellergy e são pagos pela plataforma. |
| WhatsApp por QR Code (Baileys) | Ninguém paga por mensagem | Custo escondido: memória da VPS (cada número conectado mantém um socket aberto) e risco de banimento. |
| Mensalidade (Asaas da plataforma) | **Plataforma** | Taxa por mensalidade recebida. |
| Conta de recebimento (subconta Asaas) | **Cliente** | As taxas saem do dinheiro que o cliente recebe. A plataforma não ganha nada com isso hoje. |
| Mercado Pago e Pagar.me | **Cliente** | Conta própria do cliente. |
| Nota fiscal (Focus NFe / Nuvem Fiscal) | **A definir** | Hoje só o admin cadastra a credencial do emissor. Se for a conta do Sellergy, a plataforma paga por CNPJ e por nota. |
| Arquivos (MinIO), Redis, Postgres | **Plataforma** | Ficam na VPS (custo fixo). |
| BrasilAPI (CNPJ) | Grátis | — |

## 2. Preço de cada provedor (referência nov/2026)

**DeepSeek** (por milhão de tokens):
- `deepseek-flash`: US$ 0,30 entrada / US$ 1,20 saída no horário de pico, e metade disso fora do pico (US$ 0,15 / 0,60).
- Cache de prompt sai por US$ 0,003–0,006.
- O horário de pico (UTC 01–04h e 06–10h) cai à noite e de madrugada no Brasil, então o horário comercial daqui é quase todo fora do pico.
- O modelo `deepseek-v4-flash`, usado como padrão no código, aparece como **aposentado** nas fontes. Precisa confirmar o nome atual na documentação.

**Meta (WhatsApp oficial), por mensagem entregue para número +55:**
- Utilidade (lembrete, confirmação, cobrança): R$ 0,035.
- Marketing (campanha): R$ 0,3217.
- Resposta dentro da janela de 24 h: grátis.

**Asaas:**
- Pix: R$ 1,99.
- Boleto: R$ 1,99 a R$ 3,49.
- Cartão à vista: R$ 0,49 + 2,99%.
- Cartão parcelado: até 3,99% + R$ 0,49.

**Focus NFe:**
- Solo: R$ 94,90 por CNPJ, com 100 notas.
- Start: R$ 119,90 para até 3 CNPJs, mais R$ 39,90 por CNPJ extra.
- Growth: R$ 572 com CNPJs ilimitados e 4.000 notas.
- Excedente: R$ 0,11 por nota.
- Retail (NFC-e): R$ 62,90.

**Nuvem Fiscal:** tem plano gratuito de entrada e cobra por volume. Não achei a tabela oficial.

## 3. Conta por plano (o que sobra para a plataforma)

Preços atuais: Essencial R$ 59 · Profissional R$ 119 · Negócio R$ 199.

### 3.1 Se a plataforma pagar tudo (como o código permite hoje)

| Custo mensal por cliente | Essencial | Profissional | Negócio |
|---|---|---|---|
| Taxa Asaas da mensalidade (Pix) | R$ 1,99 | R$ 1,99 | R$ 1,99 |
| Lembretes pela Meta na cota cheia (300 / 1.000 / 3.000 × R$ 0,035) | R$ 10,50 | R$ 35,00 | R$ 105,00 |
| Nota fiscal na Focus (CNPJ extra no Start) | — | R$ 39,90 | R$ 39,90 |
| IA (1.000 respostas/mês, estimado abaixo) | — | — | R$ 3 a 6 |
| **Total variável** | **R$ 12,49** | **R$ 76,89** | **R$ 149,89** |
| **% da mensalidade** | 21% | **65%** | **75%** |

Assim não é viável: o Profissional e o Negócio quase não deixam margem para VPS, suporte e marketing. Um cliente do Negócio que use a cota inteira de lembretes já come metade da mensalidade.

### 3.2 Se o cliente pagar a Meta e a nota fiscal ficar num plano por volume

| Custo mensal por cliente | Essencial | Profissional | Negócio |
|---|---|---|---|
| Taxa Asaas da mensalidade | R$ 1,99 | R$ 1,99 | R$ 1,99 |
| Nota fiscal (Growth dividido por ~50 clientes, ~100 notas cada) | — | ~R$ 14 | ~R$ 14 |
| IA | — | — | R$ 3 a 6 |
| **Total variável** | **R$ 2** | **~R$ 16** | **~R$ 22** |
| **% da mensalidade** | 3% | 13% | 11% |

Assim é viável. O custo fixo (VPS, domínio, Hostinger) se dilui com o número de clientes.

### 3.3 A conta da IA (DeepSeek)

Uma resposta do bot gasta, em média, ~3.000 tokens de entrada (instruções + catálogo + conversa) e ~200 de saída. Quando a IA usa uma ferramenta, ela faz 2 chamadas.

| | Fora do pico | No pico |
|---|---|---|
| Custo por resposta | ~R$ 0,003 | ~R$ 0,006 |
| Com ferramenta (2 chamadas) | ~R$ 0,006 | ~R$ 0,012 |
| 1.000 respostas/mês | R$ 3 a 6 | R$ 6 a 12 |

**Problemas da regra atual:**
- **Cota pequena demais:** 100 mil tokens incluídos dão para cerca de **30 respostas por mês**. O cliente estoura na primeira semana.
- **Excedente caro demais:** R$ 0,08 por mil tokens equivale a R$ 80 por milhão, de 15 a 40 vezes o custo. Mil respostas sairiam por uns **R$ 250 a mais** para o cliente. Nenhum cliente aceita isso.
- **Sem teto:** não há limite de gasto, nem por cliente nem no total da plataforma. Um bot em loop com outro robô (bug já achado na revisão) gasta sem parar.
- O excedente é só calculado; não existe cobrança.

**Proposta:**
- Incluir **2 milhões de tokens/mês no Negócio** (~600 respostas). Custo para a plataforma: até ~R$ 4.
- Excedente a **R$ 15 por milhão** (margem de 3 a 5 vezes), vendido em pacotes (por exemplo, +1.000 respostas por R$ 19).
- **Teto duro por cliente:** quando acabar a cota e o pacote, o bot passa para o menu de perguntas sem IA e avisa o dono.
- **Teto global da plataforma por dia**, como alarme e trava de segurança.
- **Limite por contato:** no máximo N respostas de IA por hora para o mesmo telefone, contra loop.
- Usar o cache de prompt (instruções fixas no começo da mensagem) para baixar o custo de entrada.

## 4. Decisões de regra de negócio (para você decidir)

1. **WhatsApp oficial: quem paga?** Recomendado: **o cliente paga a Meta direto** (conta Meta dele, cartão dele). A plataforma só cobra os próprios avisos. Na tela, mostrar "a Meta cobra cerca de R$ 0,035 por lembrete na sua conta". O QR Code continua como opção grátis, com o aviso de risco.
2. **Lembretes por QR Code:** como não custam por mensagem, a cota do plano protege o chip do cliente, não o caixa. Manter as cotas (300 / 1.000 / 3.000) mas explicar assim.
3. **Nota fiscal:** escolher um destes caminhos.
   - (a) A plataforma contrata o Focus Growth e inclui um teto de notas por plano (Profissional 100 e Negócio 300 notas/mês), com excedente a R$ 0,20 por nota.
   - (b) O cliente traz a própria conta do emissor.
   - Recomendado: **(a) depois de ~20 clientes com nota**; até lá, usar o Solo ou o Start e cobrar a nota como adicional (+R$ 29/mês) para não ficar no prejuízo.
4. **IA:** aplicar a proposta da seção 3.3 e mostrar o consumo na tela do cliente.
5. **Mensalidade:** incentivar Pix e boleto anual (taxa fixa baixa). No cartão, a taxa de ~3,8% é aceitável.
6. **Conta de recebimento (subconta Asaas):** hoje o cliente paga as taxas e a plataforma não ganha nada. Dá para cobrar um pequeno *split* por transação (por exemplo, 0,5%) ou negociar taxa menor com o Asaas pelo volume. Fica como oportunidade, não urgente.
7. **VPS:** cada número conectado por QR Code consome memória. Uma VPS de 1 GB aguenta poucos números ao mesmo tempo. Planejar subir para 2–4 GB perto de 15–20 clientes usando QR Code.

## 5. Plano de ajustes no código (em ordem)

**Fase 1: segurança (antes de qualquer teste com número ou dinheiro real)**
1. Webhook da Meta: conferir a assinatura `X-Hub-Signature-256` com um segredo do app (`WHATSAPP_APP_SECRET`).
2. Número de WhatsApp único por cliente (`identificadorCanal` único) e travar a troca pelo PATCH.
3. Parar de mandar o QR Code e o token do bot para todo mundo: enviar só para a sala do negócio, sem esses campos.
4. Webhook de pagamento simulado: recusar quando a API está exposta (túnel), não só em produção.

**Fase 2: custo sob controle (ligado às decisões da seção 4)**
5. IA: cota nova, teto duro por cliente, teto global, limite por contato, bot desligado não responde, corrigir o nome do modelo, cobrança do excedente ou pacote.
6. Corrigir a contagem de consumo da IA, que perde incrementos quando duas mensagens chegam juntas.
7. Mostrar ao cliente quanto ele gasta na Meta e de IA no mês.

**Fase 3: bloqueios de funcionamento**
8. Asaas: pedir o CPF de quem paga nos fluxos de cobrança (cobrança, sinal, pacote, bot, cobrança rápida), ou usar um cliente padrão quando o provedor permitir.
9. Mercado Pago e Pagar.me: guardar o id certo do link e ler a assinatura do Mercado Pago pela URL.
10. Nota fiscal:
    - rota certa para NFS-e;
    - corpo da nota completo (itens, pagamento, tributos e os campos IBS/CBS obrigatórios desde agosto de 2026);
    - Nuvem Fiscal com o mesmo ambiente no certificado e na emissão;
    - trava única por venda e tipo, contra nota duplicada.
11. "Não" deixa de cancelar horário: só cancela com resposta explícita ao lembrete.

**Fase 4: robustez**
12. Confirmação de pagamento sem corrida (atualização condicional) e sem duplicar cobrança quando o provedor demora (chave de idempotência).
13. Status pago não volta a cancelado; tratar estorno e chargeback.
14. Lembretes: marcar como enviado só depois de enviar e tentar de novo depois de um reinício.
15. Telefone com 55 em campanhas e devoluções; "SAIR" também no canal oficial.
16. Worker não cair quando o Redis cair; trava entre processos nas rotinas.
17. Testes automáticos para os webhooks e os adapters (hoje não existem).

**Fase 5: ambiente de teste**
18. Roteiro `docs/testes-integracoes.md` com, para cada integração: conta de teste a criar, URL do webhook (`https://api.sellergycloud.com/...`), chave a ligar no `.env` e o que esperar.
19. Ligar os modos de teste aos poucos: mensalidade (já pode), QR Code com um chip de teste, Meta com o número de teste, IA ao vivo com teto baixo, Focus em homologação, Asaas subconta no sandbox.

## Fontes

- [DeepSeek API pricing (morphllm)](https://www.morphllm.com/deepseek-api) · [maximem.ai](https://www.maximem.ai/blog/deepseek-api-pricing-2026) · [nxcode](https://www.nxcode.io/resources/news/deepseek-api-pricing-complete-guide-2026) · [techjacksolutions](https://techjacksolutions.com/ai-tools/deepseek/deepseek-pricing/)
- [WhatsApp API Brasil (vectalk)](https://vectalk.com.br/blog/en/whatsapp-api-pricing-brazil/) · [flowcall](https://www.flowcall.co/blog/whatsapp-business-api-pricing) · [zynfo](https://zynfo.ai/whatsapp-pricing/brazil)
- [Taxas de gateway 2026 (heropay)](https://heropay.ai/guias/taxas-de-pagamento) · [Pagar.me vs Asaas](https://heropay.ai/compare/pagarme-vs-asaas) · [review Asaas 2026](https://runzos.com/asaas-review-2026/)
- [Focus NFe preços](https://focusnfe.com.br/precos/) · [comparativo de captura fiscal](https://x-apps.com.br/captura-fiscal-comparativo-fornecedores/) · [emissores de NFC-e](https://nacao.digital/blog/emissor-de-cupom-fiscal/)
- [Nuvem Fiscal (comparativo Notaas)](https://www.notaas.com.br/blog/post/nuvem-fiscal-api-precos-planos-alternativa-comparativo-notaas-2026/)
