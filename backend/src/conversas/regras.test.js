const test = require('node:test');
const assert = require('node:assert');
const r = require('./regras');

const AGORA = new Date('2026-11-25T15:00:00Z');

test('chaveTelefone: cadastro, WhatsApp sem o 9 e com DDI viram a mesma chave', () => {
  assert.equal(r.chaveTelefone('(11) 98888-7777'), '5511988887777');
  assert.equal(r.chaveTelefone('5511988887777'), '5511988887777');
  assert.equal(r.chaveTelefone('551188887777'), '5511988887777'); // WhatsApp antigo, sem o 9
  assert.equal(r.chaveTelefone('556232415500'), '556232415500'); // fixo fica igual
  assert.equal(r.chaveTelefone('123'), null);
  assert.equal(r.chaveTelefone(''), null);
  assert.equal(r.chaveTelefone(null), null);
});

test('pausaAtiva: até retomar, por horas e vencida', () => {
  assert.equal(r.pausaAtiva(null, AGORA), false);
  assert.equal(r.pausaAtiva({ botPausado: false }, AGORA), false);
  assert.equal(r.pausaAtiva({ botPausado: true, botPausadoAte: null }, AGORA), true);
  assert.equal(r.pausaAtiva({ botPausado: true, botPausadoAte: new Date(AGORA.getTime() + 60_000) }, AGORA), true);
  assert.equal(r.pausaAtiva({ botPausado: true, botPausadoAte: new Date(AGORA.getTime() - 60_000) }, AGORA), false);
});

test('lerPausa: vazio = até retomar; horas fora da faixa = erro', () => {
  assert.deepEqual(r.lerPausa(null, AGORA), { botPausado: true, botPausadoAte: null });
  assert.equal(r.lerPausa(2, AGORA).botPausadoAte.toISOString(), '2026-11-25T17:00:00.000Z');
  assert.ok(r.lerPausa(0, AGORA).erro);
  assert.ok(r.lerPausa(999, AGORA).erro);
  assert.ok(r.lerPausa('abc', AGORA).erro);
});

test('pausaAoResponder: estende, nunca encurta, e respeita "até retomar"', () => {
  const p = r.pausaAoResponder({ botPausado: false }, AGORA);
  assert.equal(p.botPausadoAte.getTime(), AGORA.getTime() + r.HORAS_PAUSA_PADRAO * 3600_000);
  const longa = new Date(AGORA.getTime() + 48 * 3600_000);
  assert.equal(r.pausaAoResponder({ botPausado: true, botPausadoAte: longa }, AGORA).botPausadoAte.getTime(), longa.getTime());
  assert.deepEqual(r.pausaAoResponder({ botPausado: true, botPausadoAte: null }, AGORA), { botPausado: true, botPausadoAte: null });
});

test('validarTexto: vazio, só espaço, grande demais e normal', () => {
  assert.ok(r.validarTexto('').erro);
  assert.ok(r.validarTexto('   ').erro);
  assert.ok(r.validarTexto(123).erro);
  assert.ok(r.validarTexto('a'.repeat(r.TAM_MAX_TEXTO + 1)).erro);
  assert.equal(r.validarTexto('  Oi, tudo bem?\r\n ').texto, 'Oi, tudo bem?');
});

test('janela de 24 h só vale pro oficial', () => {
  const ha23h = new Date(AGORA.getTime() - 23 * 3600_000);
  const ha25h = new Date(AGORA.getTime() - 25 * 3600_000);
  assert.equal(r.dentroDaJanela({ canal: 'META_CLOUD', ultimaEntradaEm: ha23h }, AGORA), true);
  assert.equal(r.dentroDaJanela({ canal: 'META_CLOUD', ultimaEntradaEm: ha25h }, AGORA), false);
  assert.equal(r.dentroDaJanela({ canal: 'META_CLOUD', ultimaEntradaEm: null }, AGORA), false);
  assert.equal(r.dentroDaJanela({ canal: 'BAILEYS', ultimaEntradaEm: null }, AGORA), true);
});

test('envioRealLigado: cada provedor com a sua trava', () => {
  assert.equal(r.envioRealLigado('META_CLOUD', { WHATSAPP_ENVIO_REAL: '1' }), true);
  assert.equal(r.envioRealLigado('META_CLOUD', { BAILEYS_ENVIO_REAL: '1' }), false);
  assert.equal(r.envioRealLigado('BAILEYS', { BAILEYS_ENVIO_REAL: '1' }), true);
  assert.equal(r.envioRealLigado('BAILEYS', {}), false);
  assert.equal(r.envioRealLigado('OUTRO', { WHATSAPP_ENVIO_REAL: '1' }), false);
});

test('statusDoEnvio e origemDoTipo', () => {
  assert.equal(r.statusDoEnvio({ ok: true, simulado: true }), 'SIMULADA');
  assert.equal(r.statusDoEnvio({ ok: true, simulado: false }), 'ENVIADA');
  assert.equal(r.statusDoEnvio({ ok: false }), 'FALHOU');
  assert.equal(r.statusDoEnvio(null), 'FALHOU');
  assert.equal(r.origemDoTipo('lembrete'), 'LEMBRETE');
  assert.equal(r.origemDoTipo('campanha'), 'CAMPANHA');
  assert.equal(r.origemDoTipo('conversa'), 'SISTEMA');
});

test('situacao da conversa na lista', () => {
  assert.equal(r.situacao({ botPausado: true, botPausadoAte: null }, AGORA), 'EQUIPE');
  assert.equal(r.situacao({ ultimaMensagemOrigem: 'CONTATO' }, AGORA), 'AGUARDANDO');
  assert.equal(r.situacao({ ultimaMensagemOrigem: 'BOT' }, AGORA), 'BOT');
});

test('filtroLista: sempre preso ao negócio, busca por nome e telefone', () => {
  const w = r.filtroLista({ clienteId: 'c1', busca: '(11) 9888', filtro: 'nao-lidas', agora: AGORA });
  assert.equal(w.clienteId, 'c1');
  const ou = w.AND[0].OR;
  assert.deepEqual(ou[1], { telefone: { contains: '119888' } });
  assert.deepEqual(w.AND[1], { naoLidas: { gt: 0 } });
  assert.deepEqual(r.filtroLista({ clienteId: 'c1', busca: '', filtro: 'todas' }), { clienteId: 'c1' });
  // Busca só com letras não procura telefone.
  assert.equal(r.filtroLista({ clienteId: 'c1', busca: 'Ana' }).AND[0].OR.length, 1);
});

test('podeVerConversas: dono, administrador, vendedor com permissão e módulo CRM', () => {
  const cli = { status: 'ACTIVE', modulosLiberados: { CRM: true } };
  assert.equal(r.podeVerConversas({ perfil: 'CLIENT', clienteId: 'c' }, cli), true);
  assert.equal(r.podeVerConversas({ perfil: 'ADMINISTRADOR', clienteId: 'c' }, cli), true);
  assert.equal(r.podeVerConversas({ perfil: 'VENDEDOR', clienteId: 'c', permissoes: {} }, cli), false);
  assert.equal(r.podeVerConversas({ perfil: 'VENDEDOR', clienteId: 'c', permissoes: { CRM: { visualizar: true } } }, cli), true);
  assert.equal(r.podeVerConversas({ perfil: 'CLIENT', clienteId: 'c' }, { status: 'ACTIVE', modulosLiberados: {} }), false);
  assert.equal(r.podeVerConversas({ perfil: 'CLIENT', clienteId: 'c' }, { ...cli, status: 'SUSPENDED' }), false);
  assert.equal(r.podeVerConversas({ perfil: 'ADMIN', clienteId: null }, cli), false);
});

test('canalConectado: mesma regra da tela de Bots', () => {
  assert.equal(r.canalConectado([]).conectado, false);
  assert.equal(r.canalConectado([{ provedorCanal: 'META_CLOUD', identificadorCanal: '1', credencialCanalId: 'x' }]).conectado, false);
  assert.equal(r.canalConectado([{ id: 'b', provedorCanal: 'META_CLOUD', identificadorCanal: '1', credencialCanalId: 'x', verifyTokenCanal: 'v' }]).provedor, 'META_CLOUD');
  assert.equal(r.canalConectado([{ provedorCanal: 'BAILEYS', statusConexaoBaileys: 'AGUARDANDO_QR' }]).conectado, false);
  const qr = r.canalConectado([{ id: 'b2', provedorCanal: 'BAILEYS', statusConexaoBaileys: 'CONECTADO', baileysNumeroConectado: '5562' }]);
  assert.deepEqual(qr, { conectado: true, provedor: 'BAILEYS', botId: 'b2', numero: '5562' });
});

test('horários livres: rótulo do dia e texto pronto', () => {
  assert.equal(r.rotuloDia('2026-11-26'), 'qui, 26/11');
  assert.equal(r.rotuloDia('2026-02-31'), null);
  assert.equal(r.rotuloDia('amanha'), null);
  assert.equal(r.horaDeMinutos(870), '14:30');
  assert.equal(r.textoHorarios('qui, 26/11', [{ nome: 'Ana', horarios: [] }]), null);
  const t = r.textoHorarios('qui, 26/11', [{ nome: 'Ana', horarios: ['14:00', '15:30'] }, { nome: 'Bia', horarios: [] }]);
  assert.match(t, /Ana: 14:00 · 15:30/);
  assert.doesNotMatch(t, /Bia/);
});

test('paginação: tamanho e cursor', () => {
  assert.equal(r.lerTamanhoPagina(undefined), 40);
  assert.equal(r.lerTamanhoPagina('500'), 100);
  assert.equal(r.lerTamanhoPagina('-3'), 40);
  assert.equal(r.lerCursorData('xx'), null);
  assert.equal(r.lerCursorData('2026-11-25T10:00:00.000Z').toISOString(), '2026-11-25T10:00:00.000Z');
});
