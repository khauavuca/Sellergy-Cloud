# Fase 2 — fluxos do protótipo

Branch `feat/fase-1-estrutura`, 23/11/2026. Implementa as telas do protótipo que ainda não tinham código. Complementa:
- [fase-1-estrutura.md](fase-1-estrutura.md)
- [assinatura-e-whatsapp.md](assinatura-e-whatsapp.md)

## Agenda

| Fluxo | Onde | Como funciona |
|---|---|---|
| Fila de encaixe | `agenda/encaixe.js`, `routes/encaixe.routes.js`, `routes/publicoEncaixe.routes.js`, telas `/app/agenda/encaixe` e `/encaixe/:token` | Cancelar ou remarcar, pela recepção, pelo lembrete ou pela enquete, gera uma vaga. O sistema acha até 3 pessoas da fila que servem e oferece pelo WhatsApp (link + enquete "Quero/Não posso"). O primeiro que aceita fica com o horário; não há corrida. A oferta expira em 30 min. Oferta automática quando o horário vaga com mais de 2 h de antecedência, se `Cliente.encaixeAutomatico`. O link público oferece "me avise se vagar". |
| Sinal por Pix | `agenda/sinal.js`, `pagamentoHooks/agendamento.js` | Percentual padrão do negócio (`sinalPadraoPct`) ou por serviço (`Produto.sinalPercentual`). Na recepção e no link público, gera Pix (origem AGENDAMENTO). Pago: confirma o horário. Não pago em 4 h (nunca depois do horário): libera e vira vaga. Ao concluir, o sinal abate do valor. |
| Pacotes de sessões | `agenda/pacotes.js`, `routes/pacotes.routes.js`, tela `/app/pacotes` | Modelos; venda no caixa ou Pix parcelado (origem PACOTE); uso no agendamento; consumo ao concluir (idempotente); estorno ao cancelar; vencimento; filtro "acabando". Recurso de plano `pacotes`. |
| Comissões | `agenda/comissoes.js`, `routes/comissoes.routes.js`, tela `/app/comissoes` | Regra por profissional: % de serviço, % de produto e valor fixo. A comissão de atendimento sai ao concluir. A de produto sai quando a venda no caixa informa "Quem vendeu" (`Venda.especialistaId`; sem informar, vale a profissional logada). Tem vale, fechamento do mês e pagamento com saída no financeiro e recibo no WhatsApp. Venda ou atendimento cancelado estorna; se já foi paga, desconta. |

## Vendas online

| Fluxo | Onde | Como funciona |
|---|---|---|
| Pagamento do negócio de verdade | `services/pagamentoService.js`, `routes/webhooks.routes.js` | Liga com `PAGAMENTO_LIVE=true` e pega o ambiente da credencial. O webhook nunca aplica o status do corpo: sempre consulta o provedor. |
| Loja online | `routes/publicoCatalogo.routes.js`, telas `/loja/:slug` e `/pedido/:token` | Vitrine com sacola, retirada ou entrega, frete e mínimo. Preço sempre recalculado no servidor; estoque conferido; número do pedido sem corrida. Recurso de plano `catalogoOnline`. |
| Pedidos | `pedidos/pedidoService.js`, `routes/pedidos.routes.js`, tela `/app/pedidos` | Quadro Novo, Aguardando pagamento, Pago e Entregue. "Aceitar e mandar Pix no WhatsApp"; pagamento confirmado registra a venda (baixa estoque, caixa automático). Pedido sem pagamento expira em 24 h. "Vender pelo WhatsApp" monta o pedido na mão. A aba "Loja online" configura a vitrine. |
| Conta de recebimento | `pagamentos/subcontaAsaas.js`, `pagamentos/contaRecebimento.js`, tela `/app/recebimentos` | Subconta Asaas aberta pela plataforma em 3 passos. A chave fica no cofre do negócio. Status por webhook (`ACCOUNT_STATUS_*`) e por botão. Mostra saldo, extrato, taxas e saque só pra chave Pix cadastrada. |

## Ativação

| Fluxo | Onde | Como funciona |
|---|---|---|
| Importar planilha | `importacao/*`, `routes/importacao.routes.js`, tela `/app/importar` | CSV/XLSX lido no navegador, colunas sugeridas, revisão no servidor (telefone, e-mail, CPF, duplicados, juntar com o que já existe), lotes em transação, "Desfazer". Clientes, produtos e serviços. |
| Assistente fiscal | `fiscal/*`, tela `/app/fiscal/ativar` | Empresa, certificado A1 (o .pfx e a senha não são guardados), configuração, nota de teste em homologação. "Emitir sozinho" emite a nota das vendas pagas (rotina no worker). |
| Convite da equipe | `convites/*`, `routes/convites.routes.js`, `routes/publicoConvite.routes.js`, tela `/convite/:token` | Convite pelo WhatsApp, vale 7 dias e conta no limite do plano. A pessoa cria a senha e entra logada. |
| Celular da dona | `routes/hoje.routes.js`, tela `/app/hoje`, PWA | Mostra quanto vendeu, quanto tem a receber e o saldo, mais horários e avisos do dia. "Cobrar rápido" gera Pix; quando cai, entra no caixa. A tela pode ser instalada no celular; o service worker não guarda HTML nem dados da API. |

## Painel admin (equipe Sellergy)

| Área | Onde |
|---|---|
| Visão geral (MRR, conversão, cancelamento, receita por mês, funil, "Precisa de você") | `admin/visaoGeral.js`, `/admin/dashboard` |
| Assinaturas (já existia) com papéis, desconto e entrar como suporte | `routes/assinaturas.routes.js`, `/admin/assinaturas` |
| Suporte: chamados e "entrar como suporte" (30 min, só leitura, auditado) | `routes/adminSuporte.routes.js`, `routes/suporte.routes.js`, `seguranca/sessaoSuporte.js`, botão Ajuda no app |
| Comunicados (no sistema e WhatsApp) | `admin/comunicados.js`, `/admin/comunicados`, faixa no app |
| Saúde do sistema | `admin/saude.js`, `/admin/saude` |
| Uso e custos por cliente | `admin/uso.js`, `/admin/uso` |
| Planos e preços editáveis e cupons | `admin/planos.js`, `planos/sincronizacao.js`, `/admin/planos` |
| Equipe com papéis (Dono, Suporte, Financeiro) e auditoria | `seguranca/papeis.js`, `seguranca/auditoria.js`, `/admin/equipe` |

Detalhes dos planos e cupons:
- **Preço editado:** vale pra quem assina depois. Se o preço sobe, quem já paga o preço de tabela mantém o antigo.
- **Cupom no `POST /conta/assinar` (`cupom`):**
  - meses grátis empurram a primeira cobrança;
  - % reduz a mensalidade;
  - % com prazo volta sozinho ao preço do plano (`descontosTemporarios` em ConfigPlataforma, rotina diária).

## Infra compartilhada

- **WhatsApp pro cliente final de qualquer processo:** `services/mensagemTenant.js` usa a fila `whatsapp-tenant` e respeita o opt-out.
- **Efeito do pagamento por origem:** `services/pagamentoHooks/` com AGENDAMENTO, PEDIDO, PACOTE e AVULSA (cobrança rápida).
- **Rotinas do worker:** `agenda/rotinasFase2.js` carrega `tarefasAgenda`, `tarefasPedidos`, `tarefasAdmin` e `tarefasFiscal`.
- **Migrações:**
  - `20261123180000_fase2_fluxos_prototipo`
  - `20261123180100_origem_cobranca_pedido_pacote`
  - `20261123180200_fiscal_assistente`
  - `20261123180300_venda_quem_vendeu`

## Variáveis novas

Estão em `.env.production.example`: `PAGAMENTO_LIVE`, `PAGAMENTO_AMBIENTE_PADRAO`, `API_URL_PUBLICA`, `CAMPANHA_CANAL_NAO_OFICIAL`. Também reaproveita as já existentes `ASAAS_PLATAFORMA_*`, `PLATAFORMA_CLIENTE_ID` e `FISCAL_LIVE`.

## Como foi testado

- **Backend:** `node --test` com 314 de 314.
- **Smokes contra a API local, rodados juntos com o código final:**

  | Smoke | Resultado |
  |---|---|
  | Fase 1 | 26/26 |
  | Assinatura e 2FA | 26/26 |
  | Webhook e régua | 10/10 |
  | Upload seguro | ok |
  | Comissão de produto e cobrança rápida | 8/8 |
  | Agenda | 72/72 |
  | Vendas online | 67/67 |
  | Ativação | 68/68 |
  | Admin | 81/81 |

  O smoke da agenda está em `backend/scripts/smoke-fase2-agenda.js`.
- **Navegador:** cada bloco foi conferido com dados de teste, já apagados.

**Não testado de verdade, porque depende de chave ou de aparelho:**
- Asaas, Mercado Pago, BrasilAPI, Focus NFe e Nuvem Fiscal em produção ou sandbox;
- envio real pelo WhatsApp (QR Code com celular, canal oficial).
