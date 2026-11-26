const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const a = require('./assistente');
const { lerCertificadoA1, cnpjDoTitular, enviarAoProvedor } = require('./certificado');

// fixtures/certificado-teste.pfx: certificado AUTOASSINADO (openssl) so pra teste, senha "senha123",
// CN "LUMI ESTETICA LTDA:11222333000181", vale 20 anos. Nao e ICP-Brasil, nao emite nota.
const PFX = fs.readFileSync(path.join(__dirname, 'fixtures', 'certificado-teste.pfx'));

test('o que o negocio emite por segmento', () => {
  assert.deepStrictEqual(a.tiposPorSegmento('SERVICO'), ['NFSE']);
  assert.deepStrictEqual(a.tiposPorSegmento('PRODUTO'), ['NFCE']);
  assert.deepStrictEqual(a.tiposPorSegmento('HIBRIDO'), ['NFSE', 'NFCE']);
});

test('passo Empresa valida CNPJ, regime e endereco', () => {
  const ruim = a.validarEmpresa({ cnpj: '11.222.333/0001-82', regime: 'Outro' });
  assert.ok(ruim.campos.includes('cnpj'));
  assert.ok(ruim.campos.includes('regime'));
  const ok = a.validarEmpresa({
    cnpj: '11.222.333/0001-81', razaoSocial: 'Lumi Estética Ltda', regime: 'Simples Nacional',
    uf: 'sp', cep: '01310-100', municipio: 'São Paulo', logradouro: 'Av. Paulista', numero: '1000',
  });
  assert.strictEqual(ok.dados.cnpj, '11222333000181');
  assert.strictEqual(ok.dados.uf, 'SP');
  assert.strictEqual(ok.dados.cep, '01310100');
});

test('passo Configuracao exige CSC so quando emite NFC-e', () => {
  assert.ok(a.validarConfiguracao({ serie: '1', proximoNumero: '1' }, { tipos: ['NFCE'] }).campos.includes('csc'));
  const ok = a.validarConfiguracao({ serie: '001', proximoNumero: '152', emitirAutomatico: true }, { tipos: ['NFSE'] });
  assert.deepStrictEqual(ok.dados, { serie: '1', proximoNumero: 152, csc: null, cscId: null, emitirAutomatico: true });
});

test('NFC-e pede o ID do CSC junto com o codigo e completa com zeros', () => {
  const semId = a.validarConfiguracao({ serie: '1', proximoNumero: '1', csc: 'ABCDEF0123456789' }, { tipos: ['NFCE'] });
  assert.ok(semId.campos.includes('cscId'));
  assert.match(semId.erro, /ID do CSC/);
  const ok = a.validarConfiguracao({ serie: '1', proximoNumero: '1', csc: 'ABCDEF0123456789', cscId: '1' }, { tipos: ['NFCE'] });
  assert.strictEqual(ok.dados.cscId, '000001');
  const p = a.pendencias({ csc: 'ABCDEF0123456789', serie: '1', proximoNumero: 1 }, { tipos: ['NFCE'] });
  assert.ok(p.configuracao.includes('ID do CSC'));
});

test('pendencias por passo e liberacao da nota de teste', () => {
  const vazio = a.pendencias(null, { tipos: ['NFSE'] });
  assert.ok(vazio.empresa.includes('CNPJ'));
  assert.deepStrictEqual(vazio.certificado, ['certificado A1']);
  assert.deepStrictEqual(vazio.emissor, ['emissor de notas liberado pela Sellergy']);
  assert.strictEqual(vazio.prontoParaTeste, false);
  const cheio = a.pendencias({
    provedor: 'FOCUS_NFE', cnpj: '11222333000181', razaoSocial: 'X', regime: 'MEI', logradouro: 'R', numero: '1',
    municipio: 'SP', uf: 'SP', cep: '01310100', inscricaoMunicipal: '123', certificadoRef: 'FOCUS_NFE:empresa:1',
    certificadoValidoAte: new Date(Date.now() + 86400000), serie: '1', proximoNumero: 1,
  }, { tipos: ['NFSE'], temCredencial: true });
  assert.strictEqual(cheio.prontoParaTeste, true);
  const vencido = a.pendencias({ certificadoRef: 'x', certificadoValidoAte: new Date(Date.now() - 1000) });
  assert.match(vencido.certificado[0], /venceu/);
});

test('certificado A1: le titular, CNPJ e validade; senha errada e arquivo falso recusados', () => {
  const info = lerCertificadoA1(PFX, 'senha123');
  assert.strictEqual(info.titular, 'LUMI ESTETICA LTDA');
  assert.strictEqual(info.cnpj, '11222333000181');
  assert.ok(info.validoAte > new Date());
  assert.throws(() => lerCertificadoA1(PFX, 'errada'), (e) => e.codigo === 'SENHA_ERRADA');
  assert.throws(() => lerCertificadoA1(Buffer.from('MZ fake exe'), 'x'), (e) => e.codigo === 'NAO_E_PFX');
  assert.throws(() => lerCertificadoA1(PFX, ''), (e) => e.codigo === 'SEM_SENHA');
  assert.strictEqual(cnpjDoTitular('EMPRESA:11222333000182'), null);
});

test('envio ao emissor sem FISCAL_LIVE nao bate na rede e guarda so a referencia', async () => {
  const r = await enviarAoProvedor({ provedor: 'NUVEM_FISCAL', credencial: { dados: { accessToken: 't' } }, cnpj: '11222333000181', buffer: PFX, senha: 'senha123' });
  assert.deepStrictEqual(r, { certificadoRef: 'simulado:NUVEM_FISCAL:empresa:11222333000181', simulado: true });
});

test('certificado sem CNPJ legivel ou de outro CNPJ e recusado com mensagem clara', () => {
  const { conferirCnpjCertificado } = require('./assistente.routes');
  const sem = conferirCnpjCertificado(null, '11222333000181');
  assert.strictEqual(sem.codigo, 'CERTIFICADO_SEM_CNPJ');
  assert.match(sem.erro, /e-CNPJ/);
  assert.strictEqual(conferirCnpjCertificado('11222333000181', '11.222.333/0001-82').codigo, 'CERTIFICADO_OUTRO_CNPJ');
  assert.strictEqual(conferirCnpjCertificado('11222333000181', '11.222.333/0001-81'), null);
  // O certificado de teste tem CNPJ no CN: passa na conferencia.
  assert.strictEqual(conferirCnpjCertificado(lerCertificadoA1(PFX, 'senha123').cnpj, '11222333000181'), null);
});

test('referencia simulada: com o modo real ligado, pede o reenvio do certificado', () => {
  const { ehRefSimulada, refSoHomologacao } = require('./certificado');
  const { validarProntidaoProducao } = require('../utils/validacaoFiscal');
  const base = {
    cnpj: '11222333000181', razaoSocial: 'Lumi', regime: 'MEI', logradouro: 'Rua', numero: '1', municipio: 'SP', uf: 'SP',
    cep: '01310100', inscricaoMunicipal: '123', serie: '1', proximoNumero: 1, provedor: 'FOCUS_NFE',
    certificadoRef: 'simulado:FOCUS_NFE:empresa:11222333000181', credencialId: 'c1',
  };
  assert.strictEqual(ehRefSimulada(base.certificadoRef), true);
  assert.strictEqual(ehRefSimulada('FOCUS_NFE:empresa:1'), false);
  assert.strictEqual(refSoHomologacao('NUVEM_FISCAL:empresa:1:so-homologacao'), true);
  const simulando = a.pendencias(base, { temCredencial: true, tipos: ['NFSE'], emissaoReal: false });
  assert.strictEqual(simulando.prontoParaTeste, true);
  const real = a.pendencias(base, { temCredencial: true, tipos: ['NFSE'], emissaoReal: true });
  assert.strictEqual(real.prontoParaTeste, false);
  assert.ok(real.certificado.some((p) => p.includes('reenviar')));
  // Gate de producao tambem barra a ref simulada; NFS-e pede inscricao municipal, nao estadual.
  const falta = validarProntidaoProducao(base, [], { tipo: 'NFSE' });
  assert.ok(falta.some((f) => f.includes('reenviar o certificado')));
  assert.ok(!falta.includes('inscrição estadual'));
  assert.ok(validarProntidaoProducao({ ...base, certificadoRef: 'FOCUS_NFE:empresa:1' }, [], { tipo: 'NFCE' }).includes('inscrição estadual'));
});
