---
title: Cadastrar um produto
description: Como cadastrar um produto com custo, lucro e quantidade em estoque.
ordem: 1
---

# Cadastrar um produto

Cadastre cada produto que você vende para o Sellergy controlar a quantidade, o custo e o lucro. Você informa quanto pagou e quanto quer ganhar, e o sistema calcula o preço de venda.

<small>Leva 3 minutos · quem pode fazer: [CONFERIR: perfis com permissão de criar no Estoque]</small>

## Antes de começar

O produto precisa de uma categoria. Se ainda não tem nenhuma, crie em **Estoque › Categorias**, no botão **Nova categoria** (ex.: Bebidas, Roupas, Cabelo).

## Passo a passo

<Passo n="1">

No menu, abra **Estoque › Produtos** e clique em **Novo produto**.

<!-- PRINT: tela Estoque › Produtos com o botão Novo produto no topo -->

</Passo>

<Passo n="2">

Preencha **Nome do produto** e escolha a **Categoria**. A **Descrição (opcional)** pode ficar em branco.

</Passo>

<Passo n="3">

Em **Tem cor/tamanho diferente?**, deixe **Padrão** se o produto vem numa versão só. Se tiver versões, escreva o nome dela (ex.: Tamanho M, Cor azul). O **Código do produto** (SKU) é opcional.

</Passo>

<Passo n="4">

Em **Quanto você pagou (R$)**, digite o custo de cada unidade. Em **Seu lucro**, digite quanto quer ganhar e escolha **R$** (valor fixo) ou **%** (sobre o custo). O **Preço de venda** aparece calculado ao lado.

<!-- PRINT: bloco de custo, lucro e preço de venda no modal Novo produto -->

</Passo>

<Passo n="5">

Preencha o estoque:

- **Quanto tem hoje?**: a quantidade disponível agora.
- **Avisar quando tiver**: quando chegar nessa quantidade, o sistema avisa que está acabando.
- **Quanto comprar quando acabar**: a quantidade que você costuma comprar para repor.

</Passo>

<Passo n="6">

Clique em **Criar produto**. Pronto: aparece a mensagem "Produto criado" e ele entra na lista.

</Passo>

::: tip Dica
Exemplo: custo de R$ 30 com lucro de R$ 25 dá preço de R$ 55. Com lucro de 25%, dá R$ 37,50. Quando o custo mudar numa entrada de nota, o preço acompanha e o seu lucro continua o mesmo.
:::

::: tip Produto que o cliente leva e devolve
Se o produto é alugado, ative **Este produto é alugado?** e informe o **Prazo padrão (dias)**. Na venda, o sistema pede a data de devolução.
:::

## Perguntas frequentes

<Pergunta titulo="Como mudo o preço de um produto já cadastrado?">

Na lista de **Produtos**, use **Editar** na linha do produto, ajuste o custo ou o lucro e clique em **Salvar**. O preço de venda é sempre custo + lucro.

</Pergunta>

<Pergunta titulo="Por que não consigo escolher categoria?">

Porque ainda não existe nenhuma. Crie uma em **Estoque › Categorias** e volte para o cadastro.

</Pergunta>

## Leia também

- [Dar entrada numa nota de compra](./dar-entrada-nota)
- [Ver o que precisa repor](./ver-o-que-repor)
