// Controller de Relatórios Mensais (snapshot persistido).
// Tenant isolation rigoroso — toda query filtra por clienteId do JWT.

const prisma = require('../prisma');
const { gerarSnapshot, mesAnterior } = require('../jobs/gerarRelatorioMensal');
const { lerInteiro } = require('../utils/numero');
const { validarMesFechamento } = require('../financeiro/regras');

class RelatorioMensalController {

  // GET /relatorios-mensais — lista os snapshots disponíveis (mais recentes primeiro)
  async listar(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado.' });

      const itens = await prisma.relatorioMensal.findMany({
        where: { clienteId },
        orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
        select: {
          id: true, ano: true, mes: true, geradoEm: true, geradoPor: true,
        },
      });
      res.json(itens);
    } catch (e) {
      console.error('[relatorioMensal/listar]', e?.message);
      res.status(500).json({ error: 'Erro ao listar relatórios mensais.' });
    }
  }

  // GET /relatorios-mensais/:ano/:mes
  async detalhe(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado.' });

      const a = lerInteiro(req.params.ano, { min: 2000, max: 2100 });
      const m = lerInteiro(req.params.mes, { min: 1, max: 12 });
      const ano = a.valor;
      const mes = m.valor;
      if (!a.ok || !m.ok) {
        return res.status(422).json({ error: 'Ano ou mês inválido.' });
      }

      const r = await prisma.relatorioMensal.findUnique({
        where: { clienteId_ano_mes: { clienteId, ano, mes } },
      });
      if (!r) return res.status(404).json({ error: 'Relatório não encontrado para esse mês.' });
      res.json(r);
    } catch (e) {
      console.error('[relatorioMensal/detalhe]', e?.message);
      res.status(500).json({ error: 'Erro ao buscar relatório.' });
    }
  }

  // POST /relatorios-mensais/gerar — força geração agora.
  // Body opcional: { ano, mes }. Sem corpo, usa o mês anterior.
  // Só CLIENT e ADMINISTRADOR podem disparar.
  async gerarManual(req, res) {
    try {
      const { clienteId, id: usuarioId, perfil } = req.usuario;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado.' });
      if (perfil !== 'CLIENT' && perfil !== 'ADMINISTRADOR') {
        return res.status(403).json({ error: 'Apenas o dono ou administrador pode gerar manualmente.' });
      }

      let ano;
      let mes;
      const veioAno = req.body?.ano !== undefined && req.body?.ano !== null && req.body?.ano !== '';
      const veioMes = req.body?.mes !== undefined && req.body?.mes !== null && req.body?.mes !== '';
      if (!veioAno && !veioMes) {
        ({ ano, mes } = mesAnterior());
      } else {
        const a = lerInteiro(req.body?.ano, { min: 2000, max: 2100 });
        const m = lerInteiro(req.body?.mes, { min: 1, max: 12 });
        if (!a.ok || !m.ok) return res.status(422).json({ erro: 'Ano ou mês inválido.' });
        ano = a.valor;
        mes = m.valor;
      }
      // So fecha mes que ja terminou (Brasilia) e de 2000 em diante.
      const v = validarMesFechamento(ano, mes);
      if (!v.ok) return res.status(422).json({ erro: v.erro });

      const r = await gerarSnapshot({ clienteId, ano, mes, geradoPor: usuarioId });
      res.status(201).json(r);
    } catch (e) {
      console.error('[relatorioMensal/gerarManual]', e?.message);
      res.status(500).json({ error: 'Erro ao gerar relatório.' });
    }
  }
}

module.exports = new RelatorioMensalController();
