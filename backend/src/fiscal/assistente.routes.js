// Assistente "Ativar nota fiscal" (tela /app/fiscal/ativar). Frente C da fase 2.
// Montado DENTRO de routes/fiscal.routes.js em /fiscal/assistente, entao herda
// login, modulo FISCAL, papel privilegiado e o recurso notaFiscal do plano.
//
//   GET  /fiscal/assistente               -> estado de cada passo + o que falta
//   PUT  /fiscal/assistente/empresa       -> CNPJ, regime, inscricoes, endereco, emissor
//   POST /fiscal/assistente/certificado   -> .pfx + senha (multipart). Vai pro emissor;
//                                            aqui fica so a referencia e a validade
//   PUT  /fiscal/assistente/configuracao  -> serie, proximo numero, CSC, emitir sozinho
//   POST /fiscal/assistente/teste         -> nota de R$ 1,00 em HOMOLOGACAO
//   POST /fiscal/assistente/ativar        -> passa a emitir de verdade (PRODUCAO)

const express = require('express');
const multer = require('multer');
const prisma = require('../prisma');
const { carregarCredencialDecifrada } = require('../credenciais');
const { PROVEDORES, TIPO_CREDENCIAL_POR_PROVEDOR } = require('../adapters/fiscal');
const assistente = require('./assistente');
const {
  lerCertificadoA1, enviarAoProvedor, ehRefSimulada, refSoHomologacao, TAMANHO_MAX,
} = require('./certificado');

const emissaoRealLigada = () => String(process.env.FISCAL_LIVE || '').toLowerCase() === 'true';
const { credencialValida, emitirNotaDeTeste } = require('./emissao');
const revenda = require('./revenda');

const roteador = express.Router();

const PROVEDOR_POR_TIPO = Object.fromEntries(Object.entries(TIPO_CREDENCIAL_POR_PROVEDOR).map(([p, t]) => [t, p]));
const NOME_PROVEDOR = { FOCUS_NFE: 'Focus NFe', NUVEM_FISCAL: 'Nuvem Fiscal' };

const CAMPOS = {
  provedor: true, credencialId: true, regime: true, cnpj: true, inscricao: true, inscricaoMunicipal: true,
  razaoSocial: true, nomeFantasia: true, cnae: true, emailEmitente: true, telefoneEmitente: true,
  logradouro: true, numero: true, complemento: true, bairro: true, municipio: true, uf: true, cep: true,
  certificadoRef: true, certificadoValidoAte: true, certificadoTitular: true,
  csc: true, cscId: true, serie: true, proximoNumero: true, emitirAutomatico: true, ambiente: true, ativo: true,
};

/**
 * CNPJ do certificado x CNPJ da empresa. Certificado sem CNPJ legivel (e-CPF,
 * certificado fora do padrao ICP-Brasil) e recusado: o emissor rejeitaria a
 * nota de qualquer jeito. Devolve null (ok) ou { erro, codigo }.
 */
function conferirCnpjCertificado(cnpjCertificado, cnpjEmpresa) {
  if (!cnpjCertificado) {
    return {
      codigo: 'CERTIFICADO_SEM_CNPJ',
      erro: 'Não conseguimos ler o CNPJ deste certificado. Use o certificado A1 de pessoa jurídica (e-CNPJ) da empresa.',
    };
  }
  if (cnpjCertificado !== String(cnpjEmpresa || '').replace(/\D/g, '')) {
    return { codigo: 'CERTIFICADO_OUTRO_CNPJ', erro: 'Este certificado é de outro CNPJ. Confira se é o da sua empresa.' };
  }
  return null;
}

async function contexto(clienteId) {
  const [config, cliente, credenciais] = await Promise.all([
    prisma.configuracaoFiscal.findUnique({ where: { clienteId }, select: CAMPOS }),
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { segmento: true, nome: true, cpfCnpj: true } }),
    prisma.credencial.findMany({
      where: { clienteId, tipo: { in: Object.values(TIPO_CREDENCIAL_POR_PROVEDOR) } },
      select: { id: true, nome: true, tipo: true },
      orderBy: { criadoEm: 'asc' },
    }),
  ]);
  const tipos = assistente.tiposPorSegmento(cliente?.segmento);
  // Emissor: conta da Sellergy (revenda) ou chave propria do cliente.
  const fiscais = await revenda.credenciaisFiscais(clienteId);
  const temChaveRevenda = Boolean(await revenda.chaveRevenda());
  const usandoRevenda = Boolean(fiscais.revenda && config?.credencialId === fiscais.revenda.id);
  const emissorModo = revenda.modoEmissor({
    credencialPropria: !usandoRevenda && fiscais.proprias.length > 0,
    credencialRevenda: usandoRevenda ? fiscais.revenda : null,
    temChaveRevenda,
  });
  const temCredencial = (config ? Boolean(await credencialValida(clienteId, config)) : false)
    || (emissorModo === 'SELLERGY' && temChaveRevenda);
  const proprias = credenciais.filter((cr) => fiscais.proprias.some((p) => p.id === cr.id));
  return { config, cliente, credenciais: proprias, tipos, temCredencial, emissorModo, temRevenda: Boolean(fiscais.revenda) };
}

function respostaEstado({ config, cliente, credenciais, tipos, temCredencial, emissorModo }) {
  const c = config || null;
  const pend = assistente.pendencias(c, { temCredencial, tipos, emissaoReal: emissaoRealLigada() });
  return {
    config: c ? { ...c, csc: c.csc ? `••••${c.csc.slice(-4)}` : null, temCsc: Boolean(c.csc) } : null,
    tipos,
    regimes: assistente.REGIMES,
    emissores: credenciais.map((cr) => ({
      credencialId: cr.id, nome: cr.nome, provedor: PROVEDOR_POR_TIPO[cr.tipo], provedorNome: NOME_PROVEDOR[PROVEDOR_POR_TIPO[cr.tipo]],
    })),
    sugestaoCnpj: !c?.cnpj && String(cliente?.cpfCnpj || '').replace(/\D/g, '').length === 14 ? cliente.cpfCnpj.replace(/\D/g, '') : null,
    certificado: c?.certificadoRef ? {
      titular: c.certificadoTitular, validoAte: c.certificadoValidoAte, diasParaVencer: assistente.diasParaVencer(c.certificadoValidoAte),
      // Registrado com FISCAL_LIVE desligado: com o modo real ligado, precisa reenviar.
      simulado: ehRefSimulada(c.certificadoRef),
      precisaReenviar: emissaoRealLigada() && ehRefSimulada(c.certificadoRef),
    } : null,
    pendencias: pend,
    // SELLERGY: a nota sai pela conta da Sellergy, o cliente nao configura emissor.
    emissorModo,
    ativo: Boolean(c?.ativo && c?.ambiente === 'PRODUCAO'),
    emissaoReal: emissaoRealLigada(),
  };
}

roteador.get('/', async (req, res) => {
  try {
    res.json(respostaEstado(await contexto(req.usuario.clienteId)));
  } catch (e) {
    console.error('[fiscal/assistente]', e);
    res.status(500).json({ erro: 'Não foi possível carregar o assistente.' });
  }
});

roteador.put('/empresa', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const v = assistente.validarEmpresa(req.body || {});
    if (v.erro) return res.status(422).json({ erro: v.erro, campos: v.campos });

    const atual = await prisma.configuracaoFiscal.findUnique({ where: { clienteId }, select: { provedor: true, credencialId: true, cnpj: true } });
    let { provedor, credencialId } = atual || {};
    if (req.body?.credencialId) {
      const cred = await prisma.credencial.findFirst({ where: { id: req.body.credencialId, clienteId }, select: { id: true, tipo: true } });
      if (!cred || !PROVEDOR_POR_TIPO[cred.tipo]) return res.status(422).json({ erro: 'Emissor não encontrado.', campos: ['credencialId'] });
      provedor = PROVEDOR_POR_TIPO[cred.tipo];
      credencialId = cred.id;
    }
    if (!credencialId) {
      const primeira = await prisma.credencial.findFirst({
        where: { clienteId, tipo: { in: Object.values(TIPO_CREDENCIAL_POR_PROVEDOR) }, OR: [{ descricao: null }, { descricao: { not: revenda.MARCA_REVENDA } }] },
        select: { id: true, tipo: true }, orderBy: { criadoEm: 'asc' },
      });
      if (primeira) { provedor = PROVEDOR_POR_TIPO[primeira.tipo]; credencialId = primeira.id; }
    }
    if (!PROVEDORES.includes(provedor)) provedor = 'FOCUS_NFE'; // sem integracao ainda: a tela mostra o que falta

    // Trocou de CNPJ: o certificado antigo era de outra empresa.
    const trocouCnpj = atual?.cnpj && atual.cnpj !== v.dados.cnpj;
    const dados = {
      ...v.dados, provedor, credencialId: credencialId || null,
      ...(trocouCnpj ? { certificadoRef: null, certificadoValidoAte: null, certificadoTitular: null } : {}),
    };
    const salva = await prisma.configuracaoFiscal.upsert({
      where: { clienteId },
      // Nasce em homologacao e inativa: so emite de verdade depois do "Ativar".
      create: { clienteId, ...dados, ambiente: 'HOMOLOGACAO', ativo: false },
      update: dados,
    });
    // Empresa ja cadastrada na conta da Sellergy: leva os dados novos pro emissor.
    const ctx = await contexto(clienteId);
    if (ctx.emissorModo === 'SELLERGY' && ctx.temRevenda && !trocouCnpj) {
      await revenda.sincronizarEmpresa({ clienteId, config: salva, tipos: ctx.tipos });
    }
    return res.json(respostaEstado(await contexto(clienteId)));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ erro: e.message, codigo: e.codigo });
    console.error('[fiscal/assistente/empresa]', e);
    return res.status(500).json({ erro: 'Não foi possível salvar os dados da empresa.' });
  }
});

// .pfx so em memoria, nunca em disco.
const uploadCertificado = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAX, files: 1, fields: 2, fieldSize: 512 },
}).single('certificado');

function receberCertificado(req, res, next) {
  uploadCertificado(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ erro: 'Esse arquivo é grande demais para um certificado A1.' });
    return res.status(400).json({ erro: 'Envie o arquivo .pfx e a senha.' });
  });
}

roteador.post('/certificado', receberCertificado, async (req, res) => {
  const buffer = req.file?.buffer;
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
  try {
    const clienteId = req.usuario.clienteId;
    const config = await prisma.configuracaoFiscal.findUnique({ where: { clienteId } });
    if (!config?.cnpj) return res.status(409).json({ erro: 'Preencha os dados da empresa antes do certificado.' });
    if (req.file && !/\.(pfx|p12)$/i.test(req.file.originalname || '')) {
      return res.status(422).json({ erro: 'Escolha o arquivo .pfx (ou .p12) do certificado A1.', campos: ['certificado'] });
    }

    const info = lerCertificadoA1(buffer, senha);
    const recusa = conferirCnpjCertificado(info.cnpj, config.cnpj);
    if (recusa) return res.status(422).json({ erro: recusa.erro, codigo: recusa.codigo, campos: ['certificado'] });

    // Conta da Sellergy: cadastra a empresa com o certificado no emissor.
    const ctxAntes = await contexto(clienteId);
    if (ctxAntes.emissorModo === 'SELLERGY') {
      const { simulado } = await revenda.sincronizarEmpresa({
        clienteId, config, tipos: ctxAntes.tipos, certificado: { base64: buffer.toString('base64'), senha },
      });
      const ref = `FOCUS_NFE:empresa:${String(config.cnpj).replace(/\D/g, '')}`;
      await prisma.configuracaoFiscal.update({
        where: { clienteId },
        data: { certificadoRef: simulado ? `simulado:${ref}` : ref, certificadoValidoAte: info.validoAte, certificadoTitular: info.titular },
      });
      return res.json({ ...respostaEstado(await contexto(clienteId)), envioSimulado: simulado });
    }

    const credencial = config.credencialId
      ? await carregarCredencialDecifrada({ credencialId: config.credencialId, clienteId }).catch(() => null)
      : null;
    const { certificadoRef, simulado } = await enviarAoProvedor({
      provedor: config.provedor, credencial, cnpj: config.cnpj, buffer, senha,
    });
    await prisma.configuracaoFiscal.update({
      where: { clienteId },
      data: { certificadoRef, certificadoValidoAte: info.validoAte, certificadoTitular: info.titular },
    });
    const estado = respostaEstado(await contexto(clienteId));
    return res.json({ ...estado, envioSimulado: simulado });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ erro: e.message, codigo: e.codigo, campos: ['certificado'] });
    console.error('[fiscal/assistente/certificado]', e?.message);
    return res.status(500).json({ erro: 'Não foi possível enviar o certificado.' });
  } finally {
    // Nada do certificado sobrevive a requisicao.
    if (buffer) buffer.fill(0);
    if (req.body) delete req.body.senha;
  }
});

roteador.put('/configuracao', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const ctx = await contexto(clienteId);
    if (!ctx.config) return res.status(409).json({ erro: 'Preencha os dados da empresa primeiro.' });
    const corpo = { ...(req.body || {}) };
    // CSC mascarado na tela: sem valor novo, mantem o atual.
    if ((!corpo.csc || String(corpo.csc).startsWith('••••')) && ctx.config.temCsc !== false) {
      const atual = await prisma.configuracaoFiscal.findUnique({ where: { clienteId }, select: { csc: true } });
      corpo.csc = atual?.csc || '';
    }
    const v = assistente.validarConfiguracao(corpo, { tipos: ctx.tipos });
    if (v.erro) return res.status(422).json({ erro: v.erro, campos: v.campos });
    const salva = await prisma.configuracaoFiscal.update({ where: { clienteId }, data: v.dados });
    // Conta da Sellergy: o CSC da NFC-e fica no cadastro da empresa no emissor.
    if (ctx.emissorModo === 'SELLERGY' && ctx.temRevenda) {
      await revenda.sincronizarEmpresa({ clienteId, config: salva, tipos: ctx.tipos });
    }
    return res.json(respostaEstado(await contexto(clienteId)));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ erro: e.message, codigo: e.codigo });
    console.error('[fiscal/assistente/configuracao]', e);
    return res.status(500).json({ erro: 'Não foi possível salvar a configuração.' });
  }
});

roteador.post('/teste', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const ctx = await contexto(clienteId);
    const estado = respostaEstado(ctx);
    if (!estado.pendencias.prontoParaTeste) {
      const p = estado.pendencias;
      const falta = [...p.empresa, ...p.certificado, ...p.configuracao, ...p.emissor];
      return res.status(422).json({ erro: `Falta: ${falta.join(', ')}.`, pendencias: p });
    }
    const r = await emitirNotaDeTeste({ clienteId, tipos: ctx.tipos });
    return res.json({ ...r, certificado: estado.certificado, provedor: NOME_PROVEDOR[ctx.config.provedor] });
  } catch (e) {
    console.error('[fiscal/assistente/teste]', e);
    return res.status(500).json({ erro: 'Não foi possível emitir a nota de teste.' });
  }
});

roteador.post('/ativar', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const ctx = await contexto(clienteId);
    const p = respostaEstado(ctx).pendencias;
    if (!p.prontoParaTeste) {
      return res.status(422).json({ erro: `Falta: ${[...p.empresa, ...p.certificado, ...p.configuracao, ...p.emissor].join(', ')}.`, pendencias: p });
    }
    // Nuvem Fiscal: o certificado precisa estar tambem na conta de producao.
    if (emissaoRealLigada() && refSoHomologacao(ctx.config?.certificadoRef)) {
      return res.status(409).json({
        erro: 'A Nuvem Fiscal aceitou o certificado só no ambiente de teste. Reenvie o certificado A1 para liberar a produção.',
        codigo: 'CERTIFICADO_SO_HOMOLOGACAO',
      });
    }
    await prisma.configuracaoFiscal.update({ where: { clienteId }, data: { ambiente: 'PRODUCAO', ativo: true } });
    return res.json(respostaEstado(await contexto(clienteId)));
  } catch (e) {
    console.error('[fiscal/assistente/ativar]', e);
    return res.status(500).json({ erro: 'Não foi possível ativar a nota fiscal.' });
  }
});

module.exports = roteador;
module.exports.conferirCnpjCertificado = conferirCnpjCertificado;
