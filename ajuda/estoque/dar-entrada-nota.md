---
title: Dar entrada numa nota de compra
description: Como lançar uma compra de fornecedor, com ou sem o XML da NF-e.
ordem: 2
---

# Dar entrada numa nota de compra

Quando a mercadoria chega, lance a nota no Sellergy. De uma vez só, o estoque soma, o custo do produto é atualizado (o preço recalcula mantendo o seu lucro) e a despesa vai para o financeiro.

<small>Leva 3 minutos · quem pode fazer: [CONFERIR: perfis com permissão no Estoque]</small>

## Passo a passo

<Passo n="1">

No menu, abra **Estoque › Entrada de nota** e clique em **Nova entrada**.

<!-- PRINT: tela Entrada de nota com o botão Nova entrada -->

</Passo>

<Passo n="2">

Tem o arquivo XML da nota do fornecedor? Clique em **Importar XML** e escolha o arquivo. O sistema preenche os itens e liga cada um ao produto certo quando reconhece. Os que ele não reconhecer, você escolhe na lista.

</Passo>

<Passo n="3">

Sem XML? Preencha à mão: **Fornecedor** (opcional), **Número da nota** (opcional) e **Data da nota** (sem ela, vale a data de hoje).

</Passo>

<Passo n="4">

Em **Itens da nota**, clique em **Adicionar item** para cada produto. Escolha o produto e informe a quantidade e o custo unitário. O total aparece embaixo.

<!-- PRINT: modal Nova entrada de nota com itens preenchidos -->

</Passo>

<Passo n="5">

Se a nota já foi paga, deixe marcado **Já paguei esta nota**. Se ainda vai pagar, desmarque.

</Passo>

<Passo n="6">

Clique em **Registrar entrada**. Pronto: aparece "Entrada registrada. Estoque e custos atualizados."

</Passo>

::: tip O que acontece no financeiro
O sistema lança uma despesa **"Compra de mercadorias"**. Com **Já paguei esta nota** marcado, ela entra como paga. Desmarcado, entra como conta a pagar.
:::

::: warning Atenção
Só aparecem produtos físicos cadastrados. Se a lista estiver vazia, clique em **Ir para Produtos** e cadastre antes.
:::

## Perguntas frequentes

<Pergunta titulo="Como o custo novo é calculado?">

O sistema faz a média entre o que você já tinha em estoque e o que entrou agora (custo médio). [CONFERIR: se a conta usa custo médio ou "última nota"]

</Pergunta>

<Pergunta titulo="Preciso cadastrar o fornecedor antes?">

Não é obrigatório: dá para escolher **Sem fornecedor**. Mas cadastrar em **Estoque › Fornecedores** (botão **Novo fornecedor**) ajuda nos relatórios.

</Pergunta>

## Leia também

- [Cadastrar um produto](./cadastrar-produto)
- [Lançar uma conta a pagar](../financeiro/lancar-conta-a-pagar)
