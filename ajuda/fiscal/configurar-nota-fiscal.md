---
title: Configurar a nota fiscal
description: Ative a emissão de NFS-e ou NFC-e em 4 passos, com certificado digital e nota de teste.
ordem: 1
---

# Configurar a nota fiscal

O assistente **Configurar nota fiscal** liga a emissão de nota em 4 passos: **Empresa**, **Certificado**, **Configuração** e **Teste**. No fim, você pode deixar a nota sair sozinha em toda venda paga.

<small>Leva 10 minutos · quem pode fazer: dono e administrador [CONFERIR: perfis com acesso]</small>

## Antes de começar

- Nota fiscal está no plano **Profissional** e no **Negócio**.
- Tenha em mãos o cartão CNPJ, a inscrição municipal e/ou estadual e o **certificado digital A1** (arquivo .pfx) com a senha.
- Para NFC-e, tenha o **CSC** que a SEFAZ do seu estado fornece.

## Passo a passo

<Passo n="1">

No menu, abra **Fiscal › Configurar nota fiscal**.

</Passo>

<Passo n="2">

**Passo 1 de 4 · Dados da empresa.** Preencha do jeito que está no cartão CNPJ: **Razão social**, **Nome fantasia (opcional)**, **Inscrição municipal** (está no alvará ou no site da prefeitura) e/ou **Inscrição estadual** (se não tiver, escreva "ISENTO"), **Emissor da nota** e endereço. Clique em **Salvar e continuar**.

<!-- PRINT: assistente no Passo 1 de 4, Dados da empresa -->

</Passo>

<Passo n="3">

**Passo 2 de 4 · Certificado digital A1.** Clique em **Escolher arquivo .pfx**, digite a **Senha do certificado** e clique em **Enviar certificado**. Aparece **Certificado aceito**.

</Passo>

<Passo n="4">

**Passo 3 de 4 · Como a nota sai.** Informe o **Próximo número** (se já emitia em outro sistema, continue de onde parou) e, para NFC-e, o **CSC da NFC-e**. Ligue **Emitir sozinho em toda venda paga** se quiser. Clique em **Salvar e continuar**.

</Passo>

<Passo n="5">

**Nota de teste.** Clique em **Emitir nota de teste**. É uma nota de R$ 1,00 no ambiente de teste (**Homologação**), que não vale como nota de verdade. Se der certo, clique em **Ativar nota fiscal**.

</Passo>

::: warning Atenção
A integração com o emissor da nota é ligada pelo suporte do Sellergy. Se a tela pedir, fale com a gente pelo chat. [CONFERIR: quais emissores e cidades/estados já estão atendidos]
:::

::: tip Dica
Com **Emitir sozinho** ligado, cada venda concluída ganha a nota em até 2 minutos.
:::

## Leia também

- [Emitir uma nota fiscal](./emitir-nota-fiscal)
