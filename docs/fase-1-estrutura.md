# Fase 1 — estrutura do código

Implementa a Fase 1 do plano de 21/11/2026 (doc "Sellergy Cloud — Mercado, modelo
de negócio e fluxos"): os fluxos que fazem o cliente pagar e ficar. Branch
`feat/fase-1-estrutura`.

## O que entrou

| Ponto do plano | Onde está | Como funciona |
|---|---|---|
| Planos com preço fixo (R$ 59 / 119 / 199) | `backend/src/planos/` | `catalogo.js` é a fonte única de preço, limites e recursos. `recursos.js` aplica: `exigirRecurso`, `exigirRecursoNaEscrita`, `garantirDentroDoLimite`. O enum `Plano` do banco continua BASIC/PRO/PREMIUM (= Essencial/Profissional/Negócio). |
| Cadastro próprio + 14 dias grátis | `backend/src/onboarding/cadastro.js`, `POST /autenticacao/cadastro`, tela `/cadastro` | Cria o negócio (TRIAL, plano Profissional durante o teste) e o dono (sempre `CLIENT`) e já entra logado. |
| Falha de segurança fechada | `POST /autenticacao/registrar` agora responde 410 | A rota antiga criava usuário solto com o perfil padrão do schema (`ADMIN`): qualquer pessoa virava administrador do sistema. |
| Assistente de início | `backend/src/onboarding/passos.js`, `GET /conta/resumo`, componente `InicioChecklist` | Passos por segmento, calculados dos dados reais (tem produto? tem venda?). Nada é gravado como "feito". |
| Lembrete e confirmação de consulta | `backend/src/agenda/lembretes.js`, `respostaLembrete.js` | Roda no `worker.js` a cada 5 min. 24 h antes (pendentes e confirmados) e 2 h antes (só quem não confirmou). Resposta por botão do template, por "1/2" no WhatsApp ou pelo link `/confirmar/<token>`. Respeita a cota mensal do plano. |
| Link público de agendamento | `backend/src/routes/publico.routes.js`, tela `/agendar/<slug>` | Só horários livres (mesma regra da agenda), checagem de conflito com lock, lead criado/reaproveitado pelo telefone. Plano Profissional para cima. |
| Caixa automático | `backend/src/services/caixaAutomatico.js` | Primeira venda do dia sem caixa aberto abre um sozinho, com o fundo do último fechamento. Desliga por tenant em `Cliente.caixaAutomatico`. |
| Campanha pelo WhatsApp | `routes/campanhas.routes.js`, `services/campanhaService.js` | Atualizado em 23/11: o QR Code também dispara campanha, pelo "envio humano". Ver [assinatura-e-whatsapp.md](assinatura-e-whatsapp.md). |
| Mensalidade do Sellergy | `backend/src/assinatura/` (`situacao.js`, `cobranca.js`), `routes/assinaturas.routes.js`, `routes/conta.routes.js` | Faturas mensais, ATIVA → ATRASADA → SUSPENSA (10 dias). Suspenso e teste vencido = **somente leitura** (consulta tudo, não registra; nada é apagado). Baixa manual pelo admin por enquanto. |

## Variáveis de ambiente novas

| Variável | Para quê | Produção |
|---|---|---|
| `APP_URL_PUBLICA` | Base dos links que vão no WhatsApp (`/confirmar/...`, `/agendar/...`) | `https://sellergycloud.com` |
| `CAMPANHA_CANAL_NAO_OFICIAL` | `bloqueado` pausa campanha pelo QR Code (interruptor de emergência) | deixar vazio |
| `ASAAS_PLATAFORMA_*` | Cobrança automática da mensalidade (ver [assinatura-e-whatsapp.md](assinatura-e-whatsapp.md)) | preencher |

O fuso `TZ=America/Sao_Paulo` agora vem fixo na imagem do backend: a agenda
calcula horários no fuso do processo, e o container roda em UTC por padrão
(08:00 virava 05:00).

## Template para aprovar na Meta (canal oficial)

Nome: `lembrete_agendamento` (configurável por cliente em `configLembrete.nomeTemplate`),
idioma `pt_BR`, categoria **Utilidade**.

```
Olá, {{1}}! Passando para lembrar do seu horário na {{2}}: {{3}}, às {{4}}.
Você confirma?
```

Botões de resposta rápida: **Confirmar** e **Remarcar** (nessa ordem). O sistema
manda o payload `CONFIRMAR:<token>` / `REMARCAR:<token>` em cada botão.

Sem o template aprovado, o canal oficial não consegue mandar o lembrete (a Meta
bloqueia texto livre fora da janela de 24 h). O canal QR Code manda texto livre.

## Rotas novas

- `POST /autenticacao/cadastro`
- `GET /conta/resumo` · `PUT /conta/configuracoes` · `POST /conta/assinar` · `GET /conta/faturas`
- `GET /publico/planos`
- `GET /publico/agenda/:slug` · `GET /publico/agenda/:slug/horarios` · `POST /publico/agenda/:slug/agendamentos`
- `GET|POST /publico/confirmacao/:token`
- `GET /admin/assinaturas` · `PUT /admin/assinaturas/:clienteId` · `POST /admin/assinaturas/faturas/:id/pagar`

## O que ficou para depois

- **Configurar lembrete e endereço público pela tela de Configurações**: hoje só pela rota `PUT /conta/configuracoes`.
- **Fila de encaixe** quando um cliente remarca.
- **Rebaixar de plano**: quem passa do limite continua com o que já tem, mas não cadastra novos.
- Fase 2 do plano: subconta de pagamento com split, sinal por Pix, pacotes, NFS-e pelo próprio cliente.
