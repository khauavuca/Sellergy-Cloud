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
  assert.deepStrictEqual(ok.dados, { serie: '1', proximoNumero: 152, csc: null, emitirAutomatico: true });
});

test('pendencias por passo e liberacao da nota de teste', () => {
  const vazio = a.pendencias(null, { tipos: ['NFSE'] });
  assert.ok(vazio.empresa.includes('CNPJ'));
  assert.deepStrictEqual(vazio.certificado, ['certificado A1']);
  assert.ok(vazio.emissor.length === 2);
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
  assert.deepStrictEqual(r, { certificadoRef: 'NUVEM_FISCAL:empresa:11222333000181', simulado: true });
});
