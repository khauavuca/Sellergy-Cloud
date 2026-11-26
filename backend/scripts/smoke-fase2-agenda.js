// Smoke da fase 2 da agenda (frente A) CONTRA A API: fila de encaixe, sinal
// por Pix, pacotes de sessoes e comissoes. Cria um negocio descartavel e
// apaga tudo no fim.
//
// Pre-requisitos: API no ar (BACKEND_PORT=3341 por padrao) com o mesmo
// banco/Redis do env; o pagamento roda no modo fixture do adapter (a
// "sincronizacao" da cobranca devolve PAGO).
//
// Uso: cd backend; set -a; . <env>; set +a; node scripts/smoke-fase2-agenda.js

const bcrypt = require('bcryptjs');
const prisma = require('../src/prisma');

const BASE = process.env.SMOKE_API || `http://localhost:${process.env.SMOKE_PORTA || 3341}`;
const marca = `__SMOKE_FASE2_A__ ${Date.now()}`;
const sufixo = String(Date.now()).slice(-5);
const tel = (n) => `119${sufixo.slice(-4)}${String(n).padStart(4, '0')}`;

const falhas = [];
let passou = 0;
function ok(cond, msg, extra) {
  if (cond) { passou += 1; console.log(`PASS  ${msg}`); } else { falhas.push(msg); console.log(`FALHA ${msg}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}

// Dia D+n as hh:mm em Brasilia.
function quando(dias, hhmm) {
  const d = new Date(Date.now() + dias * 86400000);
  const ymd = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return new Date(`${ymd}T${hhmm}:00-03:00`);
}
const ymdDe = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

let cookie = '';
let csrf = '';
async function api(metodo, caminho, corpo) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', cookie, ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const setCookie = r.headers.getSetCookie?.() || [];
  if (setCookie.length) {
    const jar = new Map(cookie.split('; ').filter(Boolean).map((c) => c.split(/=(.*)/s).slice(0, 2)));
    for (const c of setCookie) { const [kv] = c.split(';'); const [k, v] = kv.split(/=(.*)/s); jar.set(k, v); }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, body: json };
}
async function publico(metodo, caminho, corpo) {
  const r = await fetch(`${BASE}${caminho}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}

async function main() {
  let clienteId = null;
  try {
    // ---------------- cenario ----------------
    const cliente = await prisma.cliente.create({
      data: {
        nome: marca, segmento: 'SERVICO', plano: 'PRO', status: 'ACTIVE', statusAssinatura: 'ATIVA',
        slugPublico: `smoke-a-${sufixo}`,
        modulosLiberados: { AGENDA: true, FINANCEIRO: true, PAGAMENTOS: true, VENDAS: true },
        horarioFuncionamento: { abertura: '07:00', fechamento: '21:00', dias: [0, 1, 2, 3, 4, 5, 6] },
      },
    });
    clienteId = cliente.id;
    const email = `smoke-a-${sufixo}@teste.local`;
    await prisma.usuario.create({ data: { nome: 'Dona Smoke', email, senha: await bcrypt.hash('Smoke!2026a', 10), perfil: 'CLIENT', clienteId } });
    const carla = await prisma.especialista.create({ data: { clienteId, nome: 'Carla Nunes' } });
    const peeling = await prisma.produto.create({
      data: { clienteId, nome: 'Peeling químico', tipo: 'SERVICO', variacoes: { create: [{ nome: 'Rosto', preco: 200, duracaoMin: 60 }] } },
      include: { variacoes: true },
    });
    await prisma.especialistaServico.create({ data: { especialistaId: carla.id, produtoId: peeling.id } });
    await prisma.configuracaoPagamento.create({ data: { clienteId, provedor: 'ASAAS', ativo: true } });
    const servicoTxt = 'Peeling químico - Rosto';

    const login = await api('POST', '/autenticacao/login', { email, senha: 'Smoke!2026a' });
    csrf = login.body?.csrfToken || '';
    ok(login.status === 200 && cookie, 'login da dona', login.body);

    // ---------------- configuracao ----------------
    let r = await api('PUT', '/agenda/config', { sinalPadraoPct: 30, encaixeAutomatico: false });
    ok(r.status === 200 && r.body.sinalPadraoPct === 30, 'configura sinal padrao 30%', r.body);
    r = await api('PUT', '/agenda/config', { sinalPadraoPct: 150 });
    ok(r.status === 422, 'recusa sinal acima de 100%');
    r = await api('GET', '/agenda/config');
    ok(r.body.pagamentoConfigurado === true && r.body.pacotesNoPlano === true, 'config da agenda mostra pagamento e pacotes', r.body);
    r = await api('PUT', `/especialistas/${carla.id}`, { comissaoServicoPct: 20 });
    ok(r.status === 200 && r.body.comissaoServicoPct === 20, 'regra de comissao 20% na Carla', r.body);
    r = await api('PUT', `/especialistas/${carla.id}`, { comissaoServicoPct: 120 });
    ok(r.status === 422, 'recusa comissao acima de 100%');

    // ---------------- SINAL (recepcao) ----------------
    const dataSinal = quando(2, '13:30');
    r = await api('GET', `/agenda/pre-agendamento?produtoId=${peeling.id}&preco=200&telefone=${tel(1)}`);
    ok(r.body?.sinal?.pct === 30 && r.body.sinal.valor === 60, 'pre-agendamento calcula sinal de R$ 60', r.body);
    r = await api('POST', '/agenda', {
      nomeCliente: 'Paula Sinal', telefoneCliente: tel(1), data: dataSinal.toISOString(), duracao: 60,
      servico: servicoTxt, preco: 200, especialistaId: carla.id, produtoId: peeling.id, cobrarSinal: true,
    });
    const agSinal = r.body;
    ok(r.status === 201 && agSinal.sinal?.valor === 60 && agSinal.sinalStatus === 'PENDENTE' && agSinal.sinal.qrCode, 'agenda com sinal Pix pendente', r.body);
    ok(new Date(agSinal.sinalExpiraEm).getTime() <= Date.now() + 4 * 3600000 + 5000, 'prazo do sinal em ate 4 h');
    r = await api('POST', `/pagamentos/cobrancas/${agSinal.sinalCobrancaId}/sincronizar`);
    ok(r.status === 200 && r.body.status === 'PAGO', 'cobranca do sinal paga (fixture)', r.body);
    let ag = await prisma.agendamento.findUnique({ where: { id: agSinal.id } });
    ok(ag.sinalStatus === 'PAGO' && ag.status === 'CONFIRMED', 'gancho: sinal PAGO e horario confirmado', ag);
    const receitaSinal = await prisma.lancamentoFinanceiro.findFirst({ where: { clienteId, descricao: { startsWith: 'Sinal por Pix' } } });
    ok(receitaSinal?.valor === 60, 'receita do sinal lancada');
    r = await api('POST', `/pagamentos/cobrancas/${agSinal.sinalCobrancaId}/sincronizar`);
    ok((await prisma.lancamentoFinanceiro.count({ where: { clienteId, descricao: { startsWith: 'Sinal por Pix' } } })) === 1, 'sinal pago de novo nao duplica receita');

    // Concluir: sinal abate, comissao sobre o preco cheio.
    r = await api('PATCH', `/agenda/${agSinal.id}/concluir`, {});
    ok(r.status === 200 && r.body.venda.valor === 140 && r.body.sinalAbatido === 60, 'concluir cobra so R$ 140 (sinal abatido)', r.body);
    ok(r.body.comissao?.valor === 40, 'comissao de 20% sobre R$ 200 = R$ 40', r.body);
    const vendaSinalId = r.body.venda.id;

    // Sinal sem pagamento configurado: nao cobra e explica.
    await prisma.configuracaoPagamento.update({ where: { clienteId }, data: { ativo: false } });
    r = await api('POST', '/agenda', {
      nomeCliente: 'Sem Pix', telefoneCliente: tel(2), data: quando(2, '16:00').toISOString(), duracao: 60,
      servico: servicoTxt, preco: 200, especialistaId: carla.id, produtoId: peeling.id, cobrarSinal: true,
    });
    ok(r.status === 201 && !r.body.sinal && r.body.sinalMotivo === 'SEM_PAGAMENTO', 'sem pagamento configurado: agenda sem sinal e diz o motivo', r.body);
    await prisma.configuracaoPagamento.update({ where: { clienteId }, data: { ativo: true } });

    // Sinal vencido: libera o horario.
    r = await api('POST', '/agenda', {
      nomeCliente: 'Vai Vencer', telefoneCliente: tel(3), data: quando(3, '10:00').toISOString(), duracao: 60,
      servico: servicoTxt, preco: 200, especialistaId: carla.id, produtoId: peeling.id, cobrarSinal: true,
    });
    const agVence = r.body;
    await prisma.agendamento.update({ where: { id: agVence.id }, data: { sinalExpiraEm: new Date(Date.now() - 1000) } });
    await require('../src/agenda/sinal').expirarSinais();
    ag = await prisma.agendamento.findUnique({ where: { id: agVence.id } });
    ok(ag.status === 'CANCELED' && ag.sinalStatus === 'EXPIRADO', 'sinal nao pago no prazo libera o horario', ag);
    const cobVencida = await prisma.cobranca.findUnique({ where: { id: agVence.sinalCobrancaId } });
    ok(cobVencida.status === 'EXPIRADO', 'cobranca do sinal vencida');
    ok(!!(await prisma.ofertaEncaixe.findFirst({ where: { clienteId, agendamentoOrigemId: agVence.id } })), 'horario liberado pelo sinal virou vaga');

    // ---------------- COMISSOES ----------------
    const comp = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
    r = await api('GET', `/comissoes?competencia=${comp}`);
    let pCarla = r.body.pessoas?.find((p) => p.id === carla.id);
    ok(r.status === 200 && pCarla?.total === 40 && pCarla.aPagar === 40 && pCarla.baseServicos === 200, 'fechamento do mes: R$ 40 a pagar', r.body);
    r = await api('POST', '/comissoes/vale', { especialistaId: carla.id, valor: 10, competencia: comp });
    ok(r.status === 201 && r.body.valor === -10, 'vale de R$ 10 lancado negativo', r.body);
    r = await api('GET', `/comissoes/${carla.id}/detalhe?competencia=${comp}`);
    ok(r.status === 200 && r.body.length === 2 && r.body.some((i) => i.atendimento?.cliente === 'Paula Sinal'), 'detalhe mostra atendimento e vale', r.body);
    r = await api('POST', '/comissoes/pagar', { especialistaId: carla.id, competencia: comp, lancarFinanceiro: true, enviarRecibo: true, telefone: tel(9) });
    ok(r.status === 200 && r.body.total === 30 && r.body.lancamentoId && r.body.recibo?.enviado === true, 'pagar: R$ 30, saida no financeiro, recibo enfileirado', r.body);
    const saida = await prisma.lancamentoFinanceiro.findUnique({ where: { id: r.body.lancamentoId } });
    ok(saida?.tipo === 'DESPESA' && saida.valor === 30 && saida.status === 'PAGO', 'lancamento de despesa da comissao');
    r = await api('POST', '/comissoes/pagar', { especialistaId: carla.id, competencia: comp });
    ok(r.status === 409, 'pagar de novo: nada a pagar');

    // Venda do atendimento cancelada em Vendas: comissao ja paga vira ajuste negativo.
    r = await api('POST', `/vendas/${vendaSinalId}/cancelar`, { motivo: 'Teste de estorno da comissao' });
    ok(r.status === 200, 'cancela a venda do atendimento', r.body);
    r = await api('GET', `/comissoes?competencia=${comp}`);
    pCarla = r.body.pessoas.find((p) => p.id === carla.id);
    ok(pCarla.ajustes.length === 1 && pCarla.ajustes[0].valor === -40 && pCarla.aPagar === -40, 'estorno: ajuste de -R$ 40 no mes', pCarla);
    await api('GET', `/comissoes?competencia=${comp}`);
    ok((await prisma.comissao.count({ where: { clienteId, tipo: 'AJUSTE' } })) === 1, 'estorno idempotente');

    // ---------------- FILA DE ENCAIXE ----------------
    const fila = [];
    for (const [n, extra] of [[11, {}], [12, { especialistaId: carla.id }], [13, {}], [14, { diasSemana: [0, 1, 2, 3, 4, 5, 6] }]]) {
      r = await api('POST', '/encaixe/fila', { nome: `Pessoa Fila ${n}`, telefone: tel(n), produtoId: peeling.id, ...extra });
      fila.push(r.body);
    }
    ok(fila.every((f) => f.id && f.status === 'AGUARDANDO'), '4 pessoas na fila', fila.map((f) => f.status));
    r = await api('POST', '/encaixe/fila', { nome: 'Repetida', telefone: tel(11), produtoId: peeling.id });
    ok(r.status === 409, 'mesma pessoa/servico nao entra duas vezes');
    r = await api('POST', '/encaixe/fila', { nome: 'X', telefone: '12' });
    ok(r.status === 422 && r.body.campos.includes('nome') && r.body.campos.includes('telefone'), 'fila valida nome e telefone');

    // Cancelou -> vaga com 3 candidatos (sem oferta automatica).
    r = await api('POST', '/agenda', { nomeCliente: 'Beatriz Cancela', telefoneCliente: tel(20), data: quando(1, '16:00').toISOString(), duracao: 60, servico: servicoTxt, preco: 200, especialistaId: carla.id });
    const agCancela = r.body;
    r = await api('PATCH', `/agenda/${agCancela.id}/status`, { status: 'CANCELED' });
    ok(r.status === 200, 'cancela horario de amanha 16:00');
    r = await api('GET', '/encaixe');
    let vaga = r.body.vagas?.find((v) => new Date(v.data).getTime() === new Date(agCancela.data).getTime());
    ok(vaga && vaga.status === 'VAGA' && vaga.candidatos.total === 4 && vaga.origem?.nome === 'Beatriz Cancela', 'vaga em destaque com quem serve', r.body.vagas);
    ok(r.body.fila.length >= 4 && r.body.mes.vagas >= 2, 'tela traz fila e historico do mes', r.body.mes);
    const notif = await prisma.notificacao.findFirst({ where: { clienteId, titulo: 'Vagou um horário' } });
    ok(!!notif, 'dono notificado da vaga');

    r = await api('POST', `/encaixe/vagas/${vaga.id}/ofertar`);
    ok(r.status === 200 && r.body.enviados === 3, 'oferece pras 3 primeiras', r.body);
    r = await api('POST', `/encaixe/vagas/${vaga.id}/ofertar`);
    ok(r.status === 409, 'nao oferece duas vezes ao mesmo tempo');
    const envios = await prisma.ofertaEncaixeEnvio.findMany({ where: { ofertaId: vaga.id }, include: { listaEspera: true }, orderBy: { listaEspera: { criadoEm: 'asc' } } });
    ok(envios.length === 3 && envios.every((e) => e.listaEspera.status === 'OFERTADO'), 'fila marcada como ofertada');
    r = await publico('GET', `/publico/encaixe/${envios[1].token}`);
    ok(r.status === 200 && r.body.oferta.situacao === 'ABERTA' && r.body.oferta.profissional === 'Carla', 'link publico mostra a oferta', r.body);

    // Corrida: 2 aceitam ao mesmo tempo -> so 1 leva.
    const [a1, a2] = await Promise.all([
      publico('POST', `/publico/encaixe/${envios[1].token}`, { acao: 'ACEITAR' }),
      publico('POST', `/publico/encaixe/${envios[2].token}`, { acao: 'ACEITAR' }),
    ]);
    const vencedores = [a1, a2].filter((x) => x.body.resultado === 'ACEITO');
    ok(vencedores.length === 1 && [a1, a2].some((x) => x.status === 409 && x.body.resultado === 'TARDE_DEMAIS'), 'corrida: so o primeiro fica com o horario', [a1.body, a2.body]);
    r = await publico('POST', `/publico/encaixe/${envios[0].token}`, { acao: 'RECUSAR' });
    ok(r.status === 200 && r.body.resultado === 'RECUSADO', 'quem nao pode continua na fila', r.body);
    const ofertaFinal = await prisma.ofertaEncaixe.findUnique({ where: { id: vaga.id } });
    const novoAg = await prisma.agendamento.findUnique({ where: { id: ofertaFinal.agendamentoNovoId } });
    ok(ofertaFinal.status === 'PREENCHIDA' && novoAg?.status === 'CONFIRMED' && novoAg.data.getTime() === new Date(agCancela.data).getTime(), 'horario preenchido e confirmado na agenda', ofertaFinal);
    const statusFila = await prisma.listaEspera.findMany({ where: { id: { in: envios.map((e) => e.listaEsperaId) } } });
    ok(statusFila.filter((f) => f.status === 'AGENDADO').length === 1 && statusFila.filter((f) => f.status === 'AGUARDANDO').length === 2, 'os outros voltam pra fila');
    r = await publico('POST', `/publico/encaixe/${envios[0].token}`, { acao: 'ACEITAR' });
    ok(r.status === 409, 'resposta repetida nao muda nada');

    // Remarcar pelo lembrete (link) -> vaga.
    const agLemb = await prisma.agendamento.create({ data: { clienteId, nomeCliente: 'Lembrete Remarca', telefoneCliente: tel(21), data: quando(2, '09:00'), duracao: 60, servico: servicoTxt, preco: 200, especialistaId: carla.id, tokenConfirmacao: `smk${sufixo}lembrete00` } });
    r = await publico('POST', `/publico/confirmacao/smk${sufixo}lembrete00`, { acao: 'REMARCAR' });
    ok(r.status === 200 && !!(await prisma.ofertaEncaixe.findFirst({ where: { clienteId, agendamentoOrigemId: agLemb.id, status: 'VAGA' } })), '"Remarcar" do lembrete vira vaga');

    // Remarcacao pela recepcao (mudou o horario) -> vaga do horario antigo.
    r = await api('POST', '/agenda', { nomeCliente: 'Move Horario', telefoneCliente: tel(22), data: quando(2, '11:00').toISOString(), duracao: 60, servico: servicoTxt, preco: 200, especialistaId: carla.id });
    const agMove = r.body;
    r = await api('PUT', `/agenda/${agMove.id}`, { data: quando(2, '18:00').toISOString() });
    ok(r.status === 200 && !!(await prisma.ofertaEncaixe.findFirst({ where: { clienteId, agendamentoOrigemId: agMove.id, data: new Date(agMove.data) } })), 'remarcou na recepcao: horario antigo vira vaga');

    // Automatico (+2 h): oferta sai sozinha.
    await api('PUT', '/agenda/config', { encaixeAutomatico: true });
    r = await api('POST', '/agenda', { nomeCliente: 'Auto Cancela', telefoneCliente: tel(23), data: quando(4, '15:00').toISOString(), duracao: 60, servico: servicoTxt, preco: 200, especialistaId: carla.id });
    await api('PATCH', `/agenda/${r.body.id}/status`, { status: 'CANCELED' });
    const auto = await prisma.ofertaEncaixe.findFirst({ where: { clienteId, agendamentoOrigemId: r.body.id } });
    ok(auto?.status === 'ABERTA' && auto.automatica === true, 'com automatico ligado a oferta sai sozinha', auto);
    await api('PUT', '/agenda/config', { encaixeAutomatico: false });

    // Oferta vence sem resposta -> todo mundo volta pra fila.
    await prisma.ofertaEncaixe.update({ where: { id: auto.id }, data: { expiraEm: new Date(Date.now() - 1000) } });
    await require('../src/agenda/encaixe').expirarOfertas();
    const autoDepois = await prisma.ofertaEncaixe.findUnique({ where: { id: auto.id }, include: { envios: { include: { listaEspera: true } } } });
    ok(autoDepois.status === 'EXPIRADA' && autoDepois.envios.every((e) => e.listaEspera.status === 'AGUARDANDO'), 'oferta vencida devolve a fila', autoDepois.status);
    r = await api('POST', `/encaixe/vagas/${auto.id}/ofertar`);
    ok(r.status === 422 && r.body.codigo === 'SEM_CANDIDATOS', 'reoferta nao repete quem ja recebeu (ninguem mais serve)', r.body);

    // ---------------- LINK PUBLICO: sinal e "me avise" ----------------
    const diaPub = ymdDe(quando(5, '12:00'));
    r = await publico('GET', `/publico/agenda/${cliente.slugPublico}/horarios?variacaoId=${peeling.variacoes[0].id}&especialistaId=${carla.id}&data=${diaPub}`);
    const slot = r.body.horarios?.[2];
    ok(!!slot, 'link publico lista horarios', r.body);
    r = await publico('POST', `/publico/agenda/${cliente.slugPublico}/agendamentos`, { variacaoId: peeling.variacoes[0].id, especialistaId: carla.id, inicio: slot.inicio, nome: 'Cliente Link', telefone: tel(30) });
    ok(r.status === 201 && r.body.sinal?.valor === 60 && r.body.sinal.qrImagem?.startsWith('data:image') && r.body.sinal.token, 'link publico cobra sinal e mostra o QR', r.body);
    const tokenPub = r.body.sinal?.token;
    r = await publico('GET', `/publico/agenda/${cliente.slugPublico}/sinal/${tokenPub}`);
    ok(r.status === 200 && r.body.status === 'PENDENTE' && r.body.qrCode, 'tela publica acompanha o pagamento', r.body);
    r = await publico('POST', `/publico/agenda/${cliente.slugPublico}/fila`, { variacaoId: peeling.variacoes[0].id, especialistaId: carla.id, dia: diaPub, soEsseDia: true, nome: 'Quer Vaga', telefone: tel(31) });
    ok(r.status === 201, '"me avise se vagar" pelo link', r.body);

    // ---------------- PACOTES ----------------
    r = await api('POST', '/pacotes/modelos', { nome: 'Peeling 3 sessões', produtoId: peeling.id, sessoes: 3, preco: 450, validadeDias: 90 });
    const modelo = r.body;
    ok(r.status === 201 && modelo.servico === 'Peeling químico', 'cria modelo de pacote', r.body);
    r = await api('POST', '/pacotes/modelos', { nome: 'X', sessoes: 1, preco: -1 });
    ok(r.status === 422 && r.body.campos.length >= 3, 'modelo valida campos', r.body);
    r = await api('POST', '/pacotes/vender', { modeloId: modelo.id, nome: 'Fernanda Pacote', telefone: tel(40), forma: 'CAIXA', metodoPagamento: 'PIX' });
    const pacCaixa = r.body.pacote;
    ok(r.status === 201 && r.body.venda.valor === 450 && pacCaixa.parcelasPagas === 1, 'vende pacote no caixa (gera venda)', r.body);
    r = await api('POST', '/pacotes/vender', { modeloId: modelo.id, nome: 'Gabi Parcelado', telefone: tel(41), forma: 'PIX', parcelas: 3 });
    ok(r.status === 201 && r.body.cobranca.valor === 150, 'vende pacote no Pix em 3x (parcela 1 de R$ 150)', r.body);
    const pacPix = r.body.pacote;
    await api('POST', `/pagamentos/cobrancas/${r.body.cobranca.id}/sincronizar`);
    let pp = await prisma.pacoteCliente.findUnique({ where: { id: pacPix.id } });
    const proxima = await prisma.cobranca.findFirst({ where: { clienteId, origem: 'PACOTE', refId: pacPix.id, status: 'PENDENTE' } });
    ok(pp.parcelasPagas === 1 && proxima?.valor === 150, 'parcela paga e a proxima ja gerada', pp);
    r = await api('POST', `/pacotes/clientes/${pacPix.id}/reenviar-pix`);
    ok(r.status === 200, 'reenviar Pix da parcela aberta', r.body);

    r = await api('GET', `/agenda/pre-agendamento?telefone=${tel(40)}&produtoId=${peeling.id}&preco=200`);
    ok(r.body.pacotes?.length === 1 && r.body.pacotes[0].livres === 3, 'novo agendamento mostra o saldo do pacote', r.body);
    r = await api('POST', '/agenda', { nomeCliente: 'Fernanda Pacote', telefoneCliente: tel(40), data: quando(1, '09:00').toISOString(), duracao: 60, servico: servicoTxt, preco: 200, especialistaId: carla.id, produtoId: peeling.id, pacoteClienteId: pacCaixa.id, cobrarSinal: true });
    const agPac = r.body;
    ok(r.status === 201 && agPac.pacoteClienteId === pacCaixa.id && !agPac.sinal, 'agenda usando o pacote (sem sinal)', r.body);
    r = await api('POST', '/agenda', { nomeCliente: 'Outra', telefoneCliente: tel(42), data: quando(1, '11:00').toISOString(), duracao: 60, servico: servicoTxt, preco: 200, especialistaId: carla.id, pacoteClienteId: pacCaixa.id });
    ok(r.status === 422, 'pacote de outra cliente e recusado', r.body);
    r = await api('GET', `/agenda?inicio=${encodeURIComponent(quando(1, '00:00').toISOString())}&fim=${encodeURIComponent(quando(1, '23:59').toISOString())}`);
    ok(r.body.find((a) => a.id === agPac.id)?.pacote?.saldo === 3, 'saldo do pacote visivel na agenda');
    r = await api('PATCH', `/agenda/${agPac.id}/concluir`, {});
    ok(r.status === 200 && r.body.venda.valor === 0 && r.body.pacote.sessoesUsadas === 1 && r.body.comissao.valor === 30, 'concluir consome 1 sessao, nao cobra, comissao sobre a sessao (R$ 150)', r.body);
    const { consumirSessao } = require('../src/agenda/pacotes');
    await prisma.$transaction((tx) => consumirSessao(tx, { ...agPac, clienteId }));
    pp = await prisma.pacoteCliente.findUnique({ where: { id: pacCaixa.id } });
    ok(pp.sessoesUsadas === 1 && (await prisma.pacoteUso.count({ where: { pacoteClienteId: pacCaixa.id } })) === 1, 'consumo idempotente');
    r = await api('PATCH', `/agenda/${agPac.id}/status`, { status: 'CANCELED' });
    pp = await prisma.pacoteCliente.findUnique({ where: { id: pacCaixa.id } });
    const comPac = await prisma.comissao.findUnique({ where: { agendamentoId_tipo: { agendamentoId: agPac.id, tipo: 'ATENDIMENTO' } } });
    ok(pp.sessoesUsadas === 0 && comPac.status === 'CANCELADA', 'cancelar o atendimento estorna a sessao e a comissao', { pp, comPac });

    // Link publico com pacote: usa o pacote e nao cobra sinal.
    r = await publico('POST', `/publico/agenda/${cliente.slugPublico}/agendamentos`, { variacaoId: peeling.variacoes[0].id, especialistaId: carla.id, inicio: (await publico('GET', `/publico/agenda/${cliente.slugPublico}/horarios?variacaoId=${peeling.variacoes[0].id}&especialistaId=${carla.id}&data=${diaPub}`)).body.horarios[5].inicio, nome: 'Fernanda Pacote', telefone: tel(40) });
    ok(r.status === 201 && r.body.pacote && !r.body.sinal, 'link publico usa o pacote de quem tem saldo', r.body);

    r = await api('GET', '/pacotes/clientes');
    ok(r.status === 200 && r.body.length === 2, 'lista de clientes com pacote', r.body.length);
    r = await api('GET', '/pacotes/modelos');
    ok(r.body[0]?.clientesAtivas === 2, 'modelo conta clientes ativas', r.body);
    await prisma.pacoteCliente.update({ where: { id: pacPix.id }, data: { validoAte: new Date(Date.now() + 5 * 86400000) } });
    r = await api('GET', '/pacotes/clientes?filtro=acabando');
    ok(r.body.length === 1 && r.body[0].id === pacPix.id, 'filtro "acabando"', r.body.map((x) => x.id));
    await prisma.pacoteCliente.update({ where: { id: pacPix.id }, data: { validoAte: new Date(Date.now() - 1000) } });
    await require('../src/agenda/pacotes').vencerPacotes();
    ok((await prisma.pacoteCliente.findUnique({ where: { id: pacPix.id } })).status === 'VENCIDO', 'pacote vencido pela tarefa');

    // Plano sem o recurso.
    await prisma.cliente.update({ where: { id: clienteId }, data: { plano: 'BASIC' } });
    r = await api('GET', '/pacotes/modelos');
    ok(r.status === 403 && r.body.codigo === 'PLANO_SEM_RECURSO', 'plano Essencial: pacotes bloqueados');
    await prisma.cliente.update({ where: { id: clienteId }, data: { plano: 'PRO' } });
  } catch (e) {
    console.error('ERRO inesperado:', e);
    falhas.push(`excecao: ${e.message}`);
  } finally {
    if (clienteId) await limpar(clienteId).catch((e) => console.error('limpeza:', e.message));
    await prisma.$disconnect();
  }
  console.log(`\n${passou} passaram, ${falhas.length} falharam`);
  if (falhas.length) console.log(falhas.map((f) => ` - ${f}`).join('\n'));
  // A fila do WhatsApp (BullMQ) deixa conexao aberta: sai explicitamente.
  process.exit(falhas.length ? 1 : 0);
}

async function limpar(clienteId) {
  const ags = await prisma.agendamento.findMany({ where: { clienteId }, select: { id: true } });
  const pacs = await prisma.pacoteCliente.findMany({ where: { clienteId }, select: { id: true } });
  await prisma.historicoAgendamento.deleteMany({ where: { agendamentoId: { in: ags.map((a) => a.id) } } });
  const lancs = await prisma.lancamentoFinanceiro.findMany({ where: { clienteId }, select: { id: true } });
  await prisma.historicoLancamento.deleteMany({ where: { lancamentoId: { in: lancs.map((l) => l.id) } } });
  await prisma.pacoteUso.deleteMany({ where: { pacoteClienteId: { in: pacs.map((p) => p.id) } } });
  await prisma.pacoteCliente.deleteMany({ where: { clienteId } });
  await prisma.pacoteModelo.deleteMany({ where: { clienteId } });
  await prisma.ofertaEncaixe.deleteMany({ where: { clienteId } });
  await prisma.listaEspera.deleteMany({ where: { clienteId } });
  await prisma.comissao.deleteMany({ where: { clienteId } });
  await prisma.cliente.delete({ where: { id: clienteId } });
  // Mensagens de WhatsApp que ficaram na fila do Redis pra este negocio.
  try {
    const { Queue } = require('bullmq');
    const { criarConexaoRedis, NOME_FILA_WHATSAPP_TENANT } = require('../src/filas');
    const fila = new Queue(NOME_FILA_WHATSAPP_TENANT, { connection: criarConexaoRedis() });
    const jobs = await fila.getJobs(['waiting', 'delayed', 'failed', 'completed', 'prioritized']);
    let removidos = 0;
    for (const j of jobs) if (j?.data?.clienteId === clienteId) { await j.remove().catch(() => {}); removidos += 1; }
    console.log(`(limpeza: ${removidos} mensagens de teste removidas da fila do WhatsApp)`);
    await fila.close();
  } catch (e) {
    console.log('(limpeza da fila do WhatsApp:', e.message, ')');
  }
  const sobra = await prisma.cliente.findUnique({ where: { id: clienteId } });
  console.log(sobra ? 'LIMPEZA INCOMPLETA' : '(dados de teste apagados)');
}

main();
