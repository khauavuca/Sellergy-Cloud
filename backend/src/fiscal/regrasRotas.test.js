const test = require('node:test');
const assert = require('node:assert');
const { montarAtualizacaoConfig, avaliarCancelamento } = require('./regrasRotas');
const { avaliarLimiteNotas, STATUS_QUE_CONTAM, inicioDoMes } = require('./limiteNotas');
const { PLANOS_BASE, ILIMITADO } = require('../planos/catalogo');

const PROVEDORES = ['FOCUS_NFE', 'NUVEM_FISCAL'];

// --------------------------- PUT /fiscal/config -----------------------------

test('PUT config: so muda o que veio no corpo (nao zera o resto)', () => {
  const atual = { provedor: 'FOCUS_NFE', ambiente: 'HOMOLOGACAO', razaoSocial: 'Lumi', ativo: false };
  const r = montarAtualizacaoConfig({ serie: '2' }, { atual, provedores: PROVEDORES });
  assert.deepStrictEqual(r.dados, { serie: '2' });
});

test('PUT config: campo enviado vazio limpa; ativo nunca liga sozinho', () => {
  const atual = { provedor: 'FOCUS_NFE', ambiente: 'HOMOLOGACAO' };
  const r = montarAtualizacaoConfig({ inscricao: '', complemento: null }, { atual, provedores: PROVEDORES });
  assert.deepStrictEqual(r.dados, { inscricao: null, complemento: null });
  const novo = montarAtualizacaoConfig({ provedor: 'NUVEM_FISCAL' }, { atual: null, provedores: PROVEDORES });
  assert.strictEqual(novo.dados.ativo, false);
  assert.strictEqual(novo.dados.ambiente, 'HOMOLOGACAO');
  assert.strictEqual(montarAtualizacaoConfig({ ativo: 'sim' }, { atual, provedores: PROVEDORES }).erro, 'ativo deve ser true ou false.');
  assert.strictEqual(montarAtualizacaoConfig({ ativo: true }, { atual, provedores: PROVEDORES }).dados.ativo, true);
});

test('PUT config: PRODUCAO so com o assistente concluido', () => {
  const atual = { provedor: 'FOCUS_NFE', ambiente: 'HOMOLOGACAO' };
  const bloqueado = montarAtualizacaoConfig({ ambiente: 'producao' }, { atual, provedores: PROVEDORES, prontoParaProducao: false });
  assert.strictEqual(bloqueado.status, 422);
  assert.match(bloqueado.erro, /assistente/);
  const ok = montarAtualizacaoConfig({ ambiente: 'PRODUCAO' }, { atual, provedores: PROVEDORES, prontoParaProducao: true });
  assert.strictEqual(ok.dados.ambiente, 'PRODUCAO');
  // Ja estava em producao: reenviar o mesmo ambiente nao exige de novo.
  const mantem = montarAtualizacaoConfig({ ambiente: 'PRODUCAO' }, { atual: { ...atual, ambiente: 'PRODUCAO' }, provedores: PROVEDORES });
  assert.strictEqual(mantem.dados.ambiente, 'PRODUCAO');
});

test('PUT config: valida emissor, CNPJ, UF, tributacao e nao aceita certificadoRef na mao', () => {
  assert.match(montarAtualizacaoConfig({}, { atual: null, provedores: PROVEDORES }).erro, /Escolha o emissor/);
  assert.match(montarAtualizacaoConfig({ provedor: 'X' }, { atual: null, provedores: PROVEDORES }).erro, /Emissor invalido/);
  const atual = { provedor: 'FOCUS_NFE', ambiente: 'HOMOLOGACAO' };
  assert.strictEqual(montarAtualizacaoConfig({ cnpj: '11.222.333/0001-82' }, { atual, provedores: PROVEDORES }).erro, 'CNPJ do emitente invalido.');
  assert.strictEqual(montarAtualizacaoConfig({ cnpj: '11.222.333/0001-81' }, { atual, provedores: PROVEDORES }).dados.cnpj, '11222333000181');
  assert.strictEqual(montarAtualizacaoConfig({ uf: 'XX' }, { atual, provedores: PROVEDORES }).erro, 'UF invalida.');
  const trib = montarAtualizacaoConfig({ tributacao: { codigoMunicipio: '3550308', aliquotaIss: '2,5' } }, { atual, provedores: PROVEDORES });
  assert.deepStrictEqual(trib.dados.tributacao, { codigoMunicipio: '3550308', aliquotaIss: 2.5 });
  const tribRuim = montarAtualizacaoConfig({ tributacao: { codigoMunicipio: '35' } }, { atual, provedores: PROVEDORES });
  assert.deepStrictEqual(tribRuim.campos, ['tributacao.codigoMunicipio']);
  assert.strictEqual(montarAtualizacaoConfig({ certificadoRef: 'FOCUS_NFE:empresa:1' }, { atual, provedores: PROVEDORES }).status, 422);
  assert.deepStrictEqual(montarAtualizacaoConfig({ certificadoRef: null }, { atual, provedores: PROVEDORES }).dados, { certificadoRef: null });
});

// --------------------------- cancelamento -----------------------------------

const agora = new Date('2026-11-24T12:00:00Z');
const minutosAtras = (m) => new Date(agora.getTime() - m * 60000);

test('cancelar exige justificativa com 15+ caracteres', () => {
  const r = avaliarCancelamento({ tipo: 'NFCE', emitidoEm: minutosAtras(1), motivo: '  curto  ', agora });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.codigo, 'JUSTIFICATIVA_CURTA');
  assert.strictEqual(avaliarCancelamento({ tipo: 'NFCE', emitidoEm: minutosAtras(1), motivo: undefined, agora }).status, 400);
  const ok = avaliarCancelamento({ tipo: 'NFCE', emitidoEm: minutosAtras(5), motivo: 'Cliente desistiu   da compra', agora });
  assert.deepStrictEqual(ok, { motivo: 'Cliente desistiu da compra', aviso: null });
});

test('NFC-e fora dos 30 min pede confirmacao; confirmada segue com aviso', () => {
  const fora = avaliarCancelamento({ tipo: 'NFCE', emitidoEm: minutosAtras(45), motivo: 'Cliente desistiu da compra', agora });
  assert.strictEqual(fora.status, 409);
  assert.strictEqual(fora.codigo, 'FORA_DO_PRAZO');
  const confirmado = avaliarCancelamento({ tipo: 'NFCE', emitidoEm: minutosAtras(45), motivo: 'Cliente desistiu da compra', confirmarForaDoPrazo: true, agora });
  assert.strictEqual(confirmado.motivo, 'Cliente desistiu da compra');
  assert.match(confirmado.aviso, /45 minutos/);
});

test('NFS-e nunca bloqueia pelo prazo: so avisa', () => {
  const r = avaliarCancelamento({ tipo: 'NFSE', emitidoEm: minutosAtras(3 * 24 * 60), motivo: 'Serviço não realizado no dia', agora });
  assert.strictEqual(r.erro, undefined);
  assert.match(r.aviso, /prefeitura/);
  assert.strictEqual(avaliarCancelamento({ tipo: 'NFSE', emitidoEm: minutosAtras(60), motivo: 'Serviço não realizado no dia', agora }).aviso, null);
});

// --------------------------- teto de notas do plano --------------------------

test('catalogo: notasMes Essencial 0, Profissional 100, Negocio 300', () => {
  assert.strictEqual(PLANOS_BASE.BASIC.limites.notasMes, 0);
  assert.strictEqual(PLANOS_BASE.PRO.limites.notasMes, 100);
  assert.strictEqual(PLANOS_BASE.PREMIUM.limites.notasMes, 300);
});

test('limite de notas: bloqueia ao passar, com mensagem clara e codigo estavel', () => {
  assert.strictEqual(avaliarLimiteNotas({ usadas: 99, maximo: 100, planoNome: 'Profissional' }), null);
  const e = avaliarLimiteNotas({ usadas: 100, maximo: 100, planoNome: 'Profissional', planoSugerido: 'PREMIUM', nomeSugerido: 'Negócio' });
  assert.strictEqual(e.status, 403);
  assert.strictEqual(e.codigo, 'LIMITE_DO_PLANO');
  assert.strictEqual(e.limite, 'notasMes');
  assert.match(e.message, /até 100 notas fiscais por mês e este mês já foram 100/);
  assert.match(e.message, /plano Negócio/);
  const sem = avaliarLimiteNotas({ usadas: 0, maximo: 0, planoNome: 'Essencial' });
  assert.match(sem.message, /não inclui emissão de nota fiscal/);
  const topo = avaliarLimiteNotas({ usadas: 300, maximo: 300, planoNome: 'Negócio' });
  assert.match(topo.message, /suporte/);
  assert.strictEqual(avaliarLimiteNotas({ usadas: 10_000, maximo: ILIMITADO }), null);
});

test('limite de notas: ERRO nao conta; mes comeca no dia 1', () => {
  assert.ok(!STATUS_QUE_CONTAM.includes('ERRO'));
  assert.ok(STATUS_QUE_CONTAM.includes('CANCELADA'));
  const inicio = inicioDoMes(new Date(2026, 10, 24, 15));
  assert.strictEqual(inicio.getDate(), 1);
  assert.strictEqual(inicio.getMonth(), 10);
});
