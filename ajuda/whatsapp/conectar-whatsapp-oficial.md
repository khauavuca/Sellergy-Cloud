---
title: Conectar o WhatsApp oficial (Meta)
description: Ligue a API oficial do WhatsApp ao Sellergy com os dados do seu app na Meta.
ordem: 2
---

# Conectar o WhatsApp oficial (Meta)

A conexão aprovada pela Meta: sem risco de bloqueio do número, funciona com o celular desligado e permite campanhas com modelos aprovados. É cobrada por mensagem pela Meta.

<small>Leva 15 minutos · quem pode fazer: quem tem acesso a Bots</small>

## Antes de começar

Você precisa do Gerenciador de Negócios da Meta e de um app com o WhatsApp configurado.

## Passo a passo

<Passo n="1">

No menu, abra **Bots**. No cartão **WhatsApp oficial (Meta)**, clique em **Usar o oficial**.

</Passo>

<Passo n="2">

Em **Cole os dados do seu app na Meta**, preencha:

- **Identificação do número de telefone**: fica em WhatsApp › Configuração da API, logo abaixo do número. É um código só de dígitos, não o telefone.
- **Token de acesso**: use o token permanente (Configurações do negócio › Usuários do sistema › Gerar token, com as permissões de WhatsApp). Começa com EAA...
- **Segredo do app (App Secret)**: Configurações do app › Básico › Chave secreta do app › Mostrar.

Clique em **Salvar e continuar**.

<!-- PRINT: passo dos dados do app com os três campos -->

</Passo>

<Passo n="3">

Em **Ligue o webhook na Meta**, copie a **URL de retorno (Callback URL)** e o **Token de verificação (Verify token)**.

</Passo>

<Passo n="4">

Na Meta, abra WhatsApp › Configuração e, em Webhook, clique em Editar. Cole a URL e o token e clique em Verificar e salvar. Em Campos do webhook, clique em Gerenciar e assine **messages**.

</Passo>

<Passo n="5">

Volte ao Sellergy. A tela atualiza sozinha quando a Meta confirma; se quiser, clique em **Conferir agora**. Está pronto quando aparecer **A Meta confirmou o webhook.**

</Passo>

::: warning Atenção
No oficial, a conversa fica aberta por 24 horas desde a última mensagem do cliente. Depois disso, só dá para mandar modelo aprovado (campanha).
:::

::: tip Dica
Se o bot estava usando o número por QR Code, ao salvar esses dados ele passa a usar a API oficial.
:::

## Leia também

- [Conectar o número por QR Code](./conectar-por-qr-code)
- [Responder uma conversa](./responder-uma-conversa)
