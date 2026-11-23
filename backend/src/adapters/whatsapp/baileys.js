// Adapter BAILEYS — WhatsApp Web nao oficial (QR Code), sem app/aprovacao da
// Meta. Precisa de uma conexao viva (`this.socket`, um `sock` do Baileys) —
// so existe dentro do processo worker.js, onde o gerenciador de conexao
// (services/baileys/gerenciadorConexao.js) mantem o registro por bot.
//
// Todo envio passa pelo "envio humano" (services/baileys/envioHumano.js):
// espera a vez do numero, mostra "digitando..." e confere se o destino tem
// WhatsApp. E isso que segura o risco de banimento do numero do cliente.
//
// Sem templates HSM (isso e da API oficial). Em troca o WhatsApp Web aceita
// texto livre, imagem, documento e ENQUETE — usada no lembrete de horario
// (Confirmar / Remarcar), que o cliente responde com um toque.
//
// BAILEYS_ENVIO_REAL=1 liga o envio de verdade (sem isso, so loga).

const { ProvedorWhatsApp } = require('./ProvedorWhatsApp');
const envioHumano = require('../../services/baileys/envioHumano');

function digitosDe(para) {
  return String(para || '').replace(/\D/g, '');
}

function paraJid(para) {
  return `${digitosDe(para)}@s.whatsapp.net`;
}

class BaileysAdapter extends ProvedorWhatsApp {
  static get provedor() { return 'BAILEYS'; }

  get _envioReal() { return process.env.BAILEYS_ENVIO_REAL === '1'; }

  get _numeroProprio() {
    return String(this.socket?.user?.id || '').split(':')[0].split('@')[0] || 'desconhecido';
  }

  /**
   * @param {string} descricao  pra log
   * @param {string} para
   * @param {object} conteudo   payload do sock.sendMessage
   * @param {{ tipo?: 'conversa'|'lembrete'|'campanha', textoParaDigitar?: string }} [opcoes]
   */
  async _enviar(descricao, para, conteudo, { tipo = 'conversa', textoParaDigitar = '' } = {}) {
    if (!this._envioReal || this.modo !== 'live') {
      console.log('[baileys:DRY_RUN]', descricao);
      return { ok: true, simulado: true };
    }
    if (!this.socket) return { ok: false, simulado: false, erro: 'Sessão WhatsApp Web não conectada.' };

    const digitos = digitosDe(para);
    if (digitos.length < 10) return { ok: false, simulado: false, erro: 'Telefone inválido.' };
    const jid = paraJid(digitos);
    const numero = this._numeroProprio;

    try {
      if (!(await envioHumano.temWhatsapp(this.socket, digitos))) {
        return { ok: false, simulado: false, erro: 'Esse número não tem WhatsApp.', codigo: 'SEM_WHATSAPP' };
      }
      await envioHumano.aguardarVez(numero, tipo);
      await envioHumano.simularDigitacao(this.socket, jid, textoParaDigitar);
      const resultado = await this.socket.sendMessage(jid, conteudo);
      await envioHumano.registrarResultado(numero, true);
      return { ok: true, simulado: false, idMensagem: resultado?.key?.id || null, mensagem: resultado };
    } catch (erro) {
      await envioHumano.registrarResultado(numero, false);
      console.error('[baileys] envio falhou', erro?.message);
      return { ok: false, simulado: false, erro: erro?.message || 'falha no envio' };
    }
  }

  enviarTexto({ para, texto, tipo = 'conversa' }) {
    const final = tipo === 'campanha' ? envioHumano.variarTexto(texto) : texto;
    return this._enviar(`texto -> ${para}`, para, { text: final }, { tipo, textoParaDigitar: final });
  }

  enviarDocumento({ para, link, filename, caption, tipo = 'conversa' }) {
    return this._enviar(`documento -> ${para}`, para,
      { document: { url: link }, fileName: filename, caption, mimetype: 'application/pdf' },
      { tipo, textoParaDigitar: caption || '' });
  }

  enviarImagem({ para, link, legenda, tipo = 'conversa' }) {
    const final = tipo === 'campanha' ? envioHumano.variarTexto(legenda) : legenda;
    return this._enviar(`imagem -> ${para}`, para, { image: { url: link }, caption: final }, { tipo, textoParaDigitar: final || '' });
  }

  /**
   * Enquete de escolha unica. Devolve tambem a mensagem enviada (com o
   * messageSecret) — quem chama guarda pra conseguir ler o voto depois.
   */
  enviarEnquete({ para, pergunta, opcoes, tipo = 'lembrete' }) {
    return this._enviar(`enquete -> ${para}`, para,
      { poll: { name: pergunta, values: opcoes, selectableCount: 1 } },
      { tipo, textoParaDigitar: pergunta });
  }

  async enviarTemplate() {
    throw Object.assign(new Error('Templates HSM não existem no WhatsApp Web.'), {
      status: 501, codigo: 'BAILEYS_TEMPLATE_INDISPONIVEL',
    });
  }
}

module.exports = BaileysAdapter;
