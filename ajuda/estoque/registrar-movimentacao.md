---
title: Registrar entrada, saída ou ajuste de estoque
description: Como corrigir a quantidade de um produto, registrar devolução ou venda manual.
ordem: 4
---

# Registrar entrada, saída ou ajuste de estoque

Use quando a quantidade mudou fora de uma venda ou de uma nota: produto quebrou, cliente devolveu, a contagem deu diferente.

<small>Leva 1 minuto</small>

## Passo a passo

<Passo n="1">

Abra **Estoque › Movimentações** e clique em **Nova movimentação**.

</Passo>

<Passo n="2">

Em **Produto**, escolha o item. Em **O que aconteceu?**, escolha uma opção: **Compra de fornecedor**, **Venda manual**, **Devolução do cliente**, **Ajuste para mais**, **Ajuste para menos** ou **Reserva**.

<!-- PRINT: modal Registrar movimentação -->

</Passo>

<Passo n="3">

Informe a **Quantidade**. O sistema mostra quanto vai ficar em estoque depois e avisa se ficar abaixo do mínimo.

</Passo>

<Passo n="4">

Escreva em **Motivo / observação** o que houve (ex.: 2 unidades quebradas no manuseio) e clique em **Registrar**.

</Passo>

::: warning Atenção
**Compra de fornecedor** também lança uma despesa já paga no Financeiro (custo × quantidade), e **Venda manual** lança uma receita já paga (preço × quantidade). Não registre a mesma venda aqui e em **Vendas**, senão ela conta duas vezes. Os outros tipos só mexem no estoque.
:::

## Perguntas frequentes

<Pergunta titulo="Onde vejo o histórico de um produto?">

Em **Estoque › Movimentações**. Busque pelo nome do produto ou pela observação.

</Pergunta>

## Leia também

- [Ver o que precisa repor](./ver-o-que-repor)
