// Cliente final (Lead) pelo telefone: a regra UNICA do sistema.
//
// O telefone e o que liga tudo: a conversa do WhatsApp (API oficial ou QR
// Code), o cadastro em Clientes, os agendamentos, as vendas, os pedidos, os
// pacotes e as cobrancas. Antes cada parte comparava de um jeito (numero
// exato, 8 ultimos digitos, numero com DDD) e o mesmo cliente virava dois
// cadastros, ou dois clientes viravam um. Agora todo mundo passa por aqui.
//
// "Mesmo telefone" = mesma chave normalizada (so digitos, com 55 e com o 9 do
// celular): "(62) 98888-7777", "5562988887777" e "556288887777" sao a mesma
// pessoa. Telefone sem DDD nao entra (nao da pra saber de quem e).

const prisma = require('../prisma');
const { chaveTelefone, digitos } = require('../conversas/regras');
const { garantirEtapa } = require('../services/etapaLeadAuto');

/** "(62) 98888-7777" a partir de qualquer formato valido; senao, os digitos. PURA. */
function telefoneParaExibir(valor) {
  const chave = chaveTelefone(valor);
  if (!chave) return digitos(valor) || null;
  const nacional = chave.startsWith('55') ? chave.slice(2) : chave;
  if (nacional.length === 11) return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`;
  if (nacional.length === 10) return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`;
  return chave;
}

/** Os dois telefones sao da mesma pessoa? PURA. */
function mesmoTelefone(a, b) {
  const x = chaveTelefone(a);
  return Boolean(x) && x === chaveTelefone(b);
}

/** Cadastro do negocio com esse telefone (o mais recente), ou null. */
async function acharLeadPorTelefone(clienteId, telefone, client = prisma) {
  const chave = chaveTelefone(telefone);
  if (!clienteId || !chave) return null;
  const candidatos = await client.lead.findMany({
    where: { clienteId, telefone: { contains: chave.slice(-4) } },
    orderBy: { atualizadoEm: 'desc' },
    take: 50,
  });
  return candidatos.find((l) => chaveTelefone(l.telefone) === chave) || null;
}

/**
 * Acha o cadastro pelo telefone ou cria um novo (etapa "Novo" do funil).
 * Nome so e usado na criacao; um nome melhor no cadastro existente nao e
 * trocado pelo do WhatsApp. Devolve { lead, criado }.
 */
async function acharOuCriarLead({ clienteId, telefone, nome, origem = 'WHATSAPP', email, cpf }, client = prisma) {
  const chave = chaveTelefone(telefone);
  if (!clienteId || !chave) return { lead: null, criado: false };
  const existente = await acharLeadPorTelefone(clienteId, chave, client);
  if (existente) {
    // Completa so o que estiver vazio (nunca sobrescreve o que o negocio digitou).
    const completar = {};
    if (!existente.nome?.trim() && nome) completar.nome = String(nome).slice(0, 120);
    if (!existente.email && email) completar.email = email;
    if (!existente.cpf && cpf) completar.cpf = cpf;
    const lead = Object.keys(completar).length
      ? await client.lead.update({ where: { id: existente.id }, data: completar })
      : existente;
    return { lead, criado: false };
  }
  const etapa = await garantirEtapa(client, clienteId, 'novo').catch(() => null);
  const lead = await client.lead.create({
    data: {
      clienteId,
      etapaId: etapa?.id || null,
      nome: String(nome || '').trim().slice(0, 120) || `Contato ${telefoneParaExibir(chave)}`,
      telefone: telefoneParaExibir(chave),
      email: email || null,
      cpf: cpf || null,
      origem,
      ultimoContato: new Date(),
    },
  });
  await client.historicoLead.create({
    data: { leadId: lead.id, acao: 'CRIADO', paraEtapa: etapa?.slug || null, observacoes: `Cadastro criado automaticamente (${String(origem).toLowerCase()})` },
  }).catch(() => {});
  return { lead, criado: true };
}

module.exports = { telefoneParaExibir, mesmoTelefone, acharLeadPorTelefone, acharOuCriarLead };
