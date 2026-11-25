// Logica pura da frente D (painel admin): override de planos, margem,
// visao geral e validacoes. Sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const catalogo = require('../planos/catalogo');
const { calcularUso, validarCustos, normalizarCustos, receitaMensal, intervaloDoMes } = require('./uso');
const { receitaPorMes, conversaoDoTeste } = require('./visaoGeral');
const { validarPlano, validarCupom, validarCupomParaAssinatura } = require('./planos');
const { validarComunicado, filtroDoPublico } = require('./comunicados');
const { limparDetalhes } = require('../seguranca/auditoria');

test('override de planos: aplica preco/limite, mantem recursos e obterPlano sincrono', (t) => {
  t.after(() => catalogo.aplicarOverrides([]));
  const { PLANOS } = catalogo;
  catalogo.aplicarOverrides([
    { codigo: 'PRO', precoMensal: 129.9, limites: { usuarios: 7, lembretesMes: null, inventado: 3, profissionais: -1 } },
    { codigo: 'XYZ', precoMensal: 10, limites: {} },
    { codigo: 'BASIC', precoMensal: 0, limites: { usuarios: 9 } }, // preco invalido: ignora a linha
  ]);
  const pro = catalogo.obterPlano('PRO');
  assert.equal(pro.precoMensal, 129.9);
  assert.equal(pro.limites.usuarios, 7);
  assert.equal(pro.limites.lembretesMes, catalogo.ILIMITADO);
  assert.equal(pro.limites.profissionais, 5, 'limite negativo e ignorado');
  assert.equal(pro.limites.inventado, undefined);
  assert.equal(pro.recursos.notaFiscal, true);
  assert.equal(catalogo.obterPlano('BASIC').precoMensal, 59);
  assert.equal(PLANOS.PRO, pro, 'quem importou PLANOS ve a troca');
  assert.deepEqual(catalogo.planosPersonalizados(), ['PRO']);
  const publico = catalogo.planosPublicos().find((p) => p.codigo === 'PRO');
  assert.equal(publico.precoMensal, 129.9);
  assert.equal(publico.limites.lembretesMes, null);
  assert.ok(Object.isFrozen(pro));
  // Voltar ao codigo
  catalogo.aplicarOverrides([]);
  assert.equal(catalogo.obterPlano('PRO').precoMensal, 119);
  assert.deepEqual(catalogo.planosPersonalizados(), []);
});

test('override vale pro valor da fatura (assinatura/cobranca usa obterPlano)', (t) => {
  t.after(() => catalogo.aplicarOverrides([]));
  const { valorDoCiclo } = require('../assinatura/cobranca');
  catalogo.aplicarOverrides([{ codigo: 'BASIC', precoMensal: 69, limites: {} }]);
  assert.equal(valorDoCiclo('BASIC', 'MENSAL', 0), 69);
  assert.equal(valorDoCiclo('BASIC', 'MENSAL', 59), 59, 'preco mantido de quem ja assinava');
  assert.equal(valorDoCiclo('BASIC', 'ANUAL', 0), Math.round(69 * 12 * 0.8 * 100) / 100);
});

test('validacao do preco/limite do plano', () => {
  assert.ok(validarPlano({ precoMensal: 0 }).erro);
  assert.deepEqual(validarPlano({ precoMensal: 'abc' }).campos, ['precoMensal']);
  assert.deepEqual(validarPlano({ precoMensal: 99, limites: { usuarios: 2.5 } }).campos, ['limites.usuarios']);
  const ok = validarPlano({ precoMensal: 99.999, limites: { usuarios: 3, lembretesMes: null, xpto: 1 } });
  assert.deepEqual(ok.dados, { precoMensal: 100, limites: { usuarios: 3, lembretesMes: null } });
});

test('margem por cliente e margem bruta com custos fixos', () => {
  const clientes = [
    { id: 'a', nome: 'Barbearia', plano: 'PRO', statusAssinatura: 'ATIVA', cicloAssinatura: 'MENSAL', mensalidade: 0 },
    { id: 'b', nome: 'Loja', plano: 'BASIC', statusAssinatura: 'ATIVA', cicloAssinatura: 'ANUAL', mensalidade: 0 },
    { id: 'c', nome: 'Teste', plano: 'PRO', statusAssinatura: 'TRIAL', cicloAssinatura: 'MENSAL', mensalidade: 0 },
  ];
  const uso = new Map([
    ['a', { lembretes: 1190, campanhas: 10, notas: 0, usuarios: 4, oficial: true }],
    ['b', { lembretes: 41, notas: 96, usuarios: 3 }],
    ['c', { lembretes: 18 }],
  ]);
  const custos = { mensagemOficial: 0.12, mensagemQr: 0.01, nota: 0.1, fixos: [{ nome: 'VPS', valor: 45 }, { nome: '', valor: 9 }] };
  const r = calcularUso({ clientes, uso, custos });
  const a = r.linhas.find((l) => l.clienteId === 'a');
  assert.equal(a.mensagens.total, 1200);
  assert.equal(a.custo, 144); // 1200 * 0.12
  assert.equal(a.paga, 119);
  assert.equal(a.margemPct, -21);
  assert.equal(a.prejuizo, true);
  assert.deepEqual(a.acimaDoLimite.map((x) => x.limite), ['lembretesMes']);
  assert.equal(a.canal, 'OFICIAL');
  const b = r.linhas.find((l) => l.clienteId === 'b');
  assert.equal(b.paga, Math.round((59 * 12 * 0.8 / 12) * 100) / 100); // anual dividido por 12
  assert.equal(b.custo, 10.01); // 41 * 0.01 + 96 * 0.1
  // 96 notas no Essencial (teto notasMes 0) e 3 usuarios de 2.
  assert.deepEqual(b.acimaDoLimite.map((x) => x.limite), ['notasMes', 'usuarios']);
  const c = r.linhas.find((l) => l.clienteId === 'c');
  assert.equal(c.paga, 0);
  assert.equal(c.margemPct, null);
  assert.equal(r.linhas[0].clienteId, 'a', 'ordenado por custo');
  assert.equal(r.totais.custoFixo, 45, 'fixo sem nome e ignorado');
  assert.equal(r.totais.receita, Math.round((119 + b.paga) * 100) / 100);
  assert.equal(r.totais.custoTotal, Math.round((144 + 10.01 + 0.18 + 45) * 100) / 100);
  assert.equal(r.totais.margemBruta, Math.round((r.totais.receita - r.totais.custoTotal) * 100) / 100);
  assert.equal(r.totais.acimaDoLimite, 2);
});

test('custos: zero por padrao (nada inventado) e validacao', () => {
  assert.deepEqual(normalizarCustos(null), { mensagemOficial: 0, mensagemQr: 0, nota: 0, fixos: [] });
  assert.ok(validarCustos({ mensagemOficial: -1, mensagemQr: 0, nota: 0 }).erro);
  assert.ok(validarCustos({ mensagemOficial: 0, mensagemQr: 0, nota: 0, fixos: [{ nome: '', valor: 1 }] }).erro);
  const ok = validarCustos({ mensagemOficial: '0.08', mensagemQr: 0, nota: 0.15, fixos: [{ nome: ' VPS ', valor: 45 }] });
  assert.deepEqual(ok.custos, { mensagemOficial: 0.08, mensagemQr: 0, nota: 0.15, fixos: [{ nome: 'VPS', valor: 45 }] });
  assert.equal(receitaMensal({ statusAssinatura: 'SUSPENSA', plano: 'PRO' }), 0);
  assert.equal(receitaMensal({ statusAssinatura: 'ATRASADA', plano: 'PRO', mensalidade: 99 }), 99);
  const m = intervaloDoMes('2026-02');
  assert.equal(m.inicio.getMonth(), 1);
  assert.equal(m.fim.getMonth(), 2);
  assert.equal(intervaloDoMes('lixo').competencia.length, 7);
});

test('receita por mes: 6 meses, zerados inclusive, so faturas pagas no periodo', () => {
  const agora = new Date(2026, 10, 23); // nov/2026
  const r = receitaPorMes([
    { valor: 119, pagaEm: new Date(2026, 10, 5) },
    { valor: 59, pagaEm: new Date(2026, 10, 20) },
    { valor: 199, pagaEm: new Date(2026, 6, 1) },
    { valor: 999, pagaEm: new Date(2026, 3, 1) }, // fora (abril)
    { valor: 10, pagaEm: null },
  ], agora);
  assert.deepEqual(r.map((m) => m.mes), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.equal(r[5].valor, 178);
  assert.equal(r[5].faturas, 2);
  assert.equal(r[1].valor, 199);
  assert.equal(r[0].valor, 0);
});

test('conversao do teste', () => {
  assert.deepEqual(conversaoDoTeste([]), { encerrados: 0, viraramPagantes: 0, pct: null });
  const r = conversaoDoTeste([
    { statusAssinatura: 'ATIVA' }, { statusAssinatura: 'TRIAL' }, { statusAssinatura: 'SUSPENSA', pagou: true }, { statusAssinatura: 'CANCELADA' },
  ]);
  assert.deepEqual(r, { encerrados: 4, viraramPagantes: 2, pct: 50 });
});

test('cupons: validacao e uso', () => {
  assert.ok(validarCupom({ codigo: 'a', tipo: 'PERCENTUAL', valor: 10 }).erro);
  assert.ok(validarCupom({ codigo: 'BLACK30', tipo: 'PERCENTUAL', valor: 130 }).erro);
  assert.ok(validarCupom({ codigo: 'GRATIS', tipo: 'MESES_GRATIS', valor: 1.5 }).erro);
  const ok = validarCupom({ codigo: 'black30', tipo: 'PERCENTUAL', valor: 30, duracaoMeses: 3 });
  assert.equal(ok.cupom.codigo, 'BLACK30');
  assert.equal(ok.cupom.usos, 0);
  assert.match(validarCupom({ codigo: 'BLACK30', tipo: 'PERCENTUAL', valor: 30 }, [ok.cupom]).erro, /Já existe/);
  assert.equal(validarCupomParaAssinatura([ok.cupom], 'black30').ok, true);
  assert.equal(validarCupomParaAssinatura([{ ...ok.cupom, ativo: false }], 'BLACK30').ok, false);
  assert.equal(validarCupomParaAssinatura([{ ...ok.cupom, limiteUsos: 1, usos: 1 }], 'BLACK30').ok, false);
});

test('comunicado: validacao e filtro do publico', () => {
  assert.ok(validarComunicado({ titulo: 'Oi', texto: 'x', publico: 'TODOS' }).erro);
  assert.deepEqual(validarComunicado({ titulo: 'Novidade', texto: 'Texto longo', publico: 'TODOS', noSistema: false }).campos, ['canais']);
  assert.equal(validarComunicado({ titulo: 'Novidade', texto: 'Texto longo', publico: 'TRIAL', noWhatsapp: true }).dados.noSistema, true);
  assert.deepEqual(filtroDoPublico('SERVICO').segmento, { in: ['SERVICO', 'HIBRIDO'] });
  assert.equal(filtroDoPublico('TRIAL').statusAssinatura, 'TRIAL');
  assert.deepEqual(filtroDoPublico('TODOS').statusAssinatura, { not: 'CANCELADA' });
});

test('auditoria nao grava segredo', () => {
  const d = limparDetalhes({ senhaProvisoria: 'abc', nome: 'Ana', aninhado: { apiKey: 'x', ok: 1 } });
  assert.equal(d.senhaProvisoria, '[omitido]');
  assert.equal(d.aninhado.apiKey, '[omitido]');
  assert.equal(d.nome, 'Ana');
  assert.equal(limparDetalhes(null), null);
  assert.equal(limparDetalhes({ grande: 'x'.repeat(5000) }).cortado, true);
});
