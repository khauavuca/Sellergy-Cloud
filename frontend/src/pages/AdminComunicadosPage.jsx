// /admin/comunicados — aviso dentro do sistema e no WhatsApp pra base de
// clientes (frente D da fase 2). Rotas em backend/src/routes/adminComunicados.routes.js.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Megaphone, RefreshCw, Send, X } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { Badge, Button, EmptyState, Input, Switch, Textarea, useToast } from '../components/ui';
import ConfirmarAcao from '../components/conta/ConfirmarAcao';
import { SemPermissao, ErroCarregar, Carregando } from '../components/suporte/EstadosAdmin';
import { usePapelAdmin, erroDaApi, dataHora } from '../components/suporte/papelAdmin';

const PUBLICOS = [
  { valor: 'TODOS', rotulo: 'Todos' },
  { valor: 'SERVICO', rotulo: 'Clínicas e serviços' },
  { valor: 'PRODUTO', rotulo: 'Lojas' },
  { valor: 'TRIAL', rotulo: 'Em teste' },
];
const NOME_PUBLICO = Object.fromEntries(PUBLICOS.map((p) => [p.valor, p.rotulo]));
const MAX_TITULO = 100;
const MAX_TEXTO = 1000;

const num = (v) => Number(v || 0).toLocaleString('pt-BR');

function textoResultado(r) {
  const partes = [];
  if (r.comunicado?.noSistema) partes.push(`${num(r.notificacoes)} aviso(s) no sistema`);
  if (r.comunicado?.noWhatsapp) {
    if (r.whatsappErro === 'SEM_CANAL_PLATAFORMA') partes.push('WhatsApp não enviado: canal do Sellergy não configurado');
    else if (r.whatsappErro) partes.push('WhatsApp não enviado: fila indisponível');
    else partes.push(`${num(r.whatsappEnfileirados)} WhatsApp na fila (saem espaçados)`);
  }
  return `Comunicado enviado. ${partes.join(' · ')}.`;
}

export default function AdminComunicadosPage() {
  const toast = useToast();
  const { pode } = usePapelAdmin();
  const podeVer = pode('comunicados.ver');
  const podeEnviar = pode('comunicados.enviar');

  const [lista, setLista] = useState([]);
  const [whatsConfigurado, setWhatsConfigurado] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [publico, setPublico] = useState('TODOS');
  const [noSistema, setNoSistema] = useState(true);
  const [noWhatsapp, setNoWhatsapp] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [campos, setCampos] = useState([]);
  const [previa, setPrevia] = useState(null);
  const [previaErro, setPreviaErro] = useState(null);
  const [confirmando, setConfirmando] = useState(false);

  const carregar = useCallback(() => {
    return api.get('/admin/comunicados')
      .then((r) => {
        setLista(Array.isArray(r.data?.comunicados) ? r.data.comunicados : []);
        setWhatsConfigurado(r.data?.canalWhatsappConfigurado !== false);
        setErro('');
      })
      .catch((e) => setErro(erroDaApi(e, 'Não foi possível carregar os comunicados.')))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => { if (podeVer) carregar(); }, [carregar, podeVer]);

  useEffect(() => {
    if (!podeVer) return undefined;
    let vivo = true;
    api.get('/admin/comunicados/previa', { params: { publico } })
      .then((r) => { if (vivo) { setPrevia(r.data); setPreviaErro(null); } })
      .catch((e) => { if (vivo) setPreviaErro({ publico, texto: erroDaApi(e, 'Não foi possível calcular o alcance.') }); });
    return () => { vivo = false; };
  }, [publico, podeVer]);

  if (!podeVer) return <SemPermissao />;

  // A previa so vale pro publico escolhido agora (a troca recalcula).
  const previaAtual = previa?.publico === publico ? previa : null;
  const erroPrevia = previaErro?.publico === publico ? previaErro.texto : '';
  const whatsAtivo = noWhatsapp && whatsConfigurado;
  const valido = titulo.trim().length >= 3 && texto.trim().length >= 5 && (noSistema || whatsAtivo);

  const enviar = async () => {
    try {
      const r = await api.post('/admin/comunicados', {
        titulo: titulo.trim(), texto: texto.trim(), publico, noSistema, noWhatsapp: whatsAtivo,
      });
      toast.success(textoResultado(r.data));
      setTitulo('');
      setTexto('');
      setCampos([]);
      await carregar();
      return true;
    } catch (e) {
      setCampos(e.response?.data?.campos || []);
      toast.error(erroDaApi(e, 'Não foi possível enviar o comunicado.'));
      return false;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Comunicados</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Aviso dentro do sistema e no WhatsApp para os negócios clientes.</p>
        </div>
        <Button variant="secondary" className="min-h-11" icon={RefreshCw} loading={carregando} onClick={() => { setCarregando(true); carregar(); }}>Atualizar</Button>
      </div>

      <div className="grid gap-4 grid-cols-1 xl:grid-cols-5">
        <section aria-labelledby="com-novo" className="xl:col-span-3 rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 space-y-5">
          <h2 id="com-novo" className="text-base font-semibold text-[var(--text-main)]">Novo comunicado</h2>
          {!podeEnviar && (
            <p className="text-sm text-[var(--text-secondary)] rounded-lg bg-[var(--bg-subtle)] px-3 py-2">
              Só o dono da conta Sellergy envia comunicados. Você pode ver o histórico.
            </p>
          )}

          <fieldset>
            <legend className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">Pra quem</legend>
            <div className="flex flex-wrap gap-1.5">
              {PUBLICOS.map((p) => (
                <button
                  key={p.valor}
                  type="button"
                  aria-pressed={publico === p.valor}
                  onClick={() => setPublico(p.valor)}
                  className={clsx(
                    'min-h-11 px-3.5 rounded-lg text-sm font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
                    publico === p.valor
                      ? 'bg-[var(--primary)] text-[var(--text-on-primary)] border-[var(--primary)]'
                      : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-main)] hover:text-[var(--text-main)]',
                  )}
                >
                  {p.rotulo}
                </button>
              ))}
            </div>
            <p className="text-sm text-[var(--text-secondary)] mt-2" aria-live="polite">
              {erroPrevia || (previaAtual
                ? `Vai para ${num(previaAtual.negocios)} negócio(s) · ${num(previaAtual.pessoas)} pessoa(s) no sistema · ${num(previaAtual.comTelefone)} com WhatsApp cadastrado`
                : 'Calculando o alcance…')}
            </p>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">Onde aparece</legend>
            <div className="flex items-center justify-between gap-3 min-h-11">
              <span className="text-sm text-[var(--text-main)]">Aviso dentro do sistema (faixa no topo até a pessoa fechar)</span>
              <Switch checked={noSistema} onChange={setNoSistema} ariaLabel="Aviso dentro do sistema" />
            </div>
            <div className="flex items-center justify-between gap-3 min-h-11">
              <span className="text-sm text-[var(--text-main)]">WhatsApp do Sellergy (sai espaçado, um negócio por vez)</span>
              <Switch checked={whatsAtivo} onChange={setNoWhatsapp} disabled={!whatsConfigurado} ariaLabel="Enviar pelo WhatsApp" />
            </div>
            {!whatsConfigurado && (
              <p className="flex items-start gap-2 text-sm text-[var(--warning-text)] bg-[var(--warning-soft)] rounded-lg px-3 py-2">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                O WhatsApp do Sellergy não está configurado (falta PLATAFORMA_CLIENTE_ID no servidor). Por enquanto, só aviso no sistema.
              </p>
            )}
            {campos.includes('canais') && <p className="text-sm text-[var(--danger-text)]">Escolha pelo menos um lugar.</p>}
          </fieldset>

          <Input
            label="Título"
            value={titulo}
            maxLength={MAX_TITULO}
            onChange={(e) => setTitulo(e.target.value)}
            error={campos.includes('titulo') ? 'De 3 a 100 letras.' : undefined}
            hint={`${titulo.length}/${MAX_TITULO}`}
          />
          <Textarea
            label="Texto"
            rows={5}
            value={texto}
            maxLength={MAX_TEXTO}
            onChange={(e) => setTexto(e.target.value)}
            error={campos.includes('texto') ? 'De 5 a 1.000 letras.' : undefined}
            hint={`${texto.length}/${MAX_TEXTO}`}
          />

          <div>
            <p className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">Como fica no sistema</p>
            <div className="flex items-start gap-3 rounded-xl border border-[var(--info-soft)] bg-[var(--info-soft)] px-4 py-3" aria-hidden="true">
              <Megaphone size={18} className="text-[var(--info)] flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text-main)] break-words">{titulo.trim() || 'Título do comunicado'}</p>
                <p className="text-sm text-[var(--text-secondary)] break-words whitespace-pre-line">{texto.trim() || 'O texto aparece aqui.'}</p>
              </div>
              <X size={16} className="text-[var(--text-muted)] flex-shrink-0" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              className="min-h-11"
              icon={Send}
              disabled={!podeEnviar || !valido || !previaAtual}
              onClick={() => setConfirmando(true)}
            >
              Enviar comunicado
            </Button>
          </div>
        </section>

        <section aria-labelledby="com-hist" className="xl:col-span-2 rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5">
          <h2 id="com-hist" className="text-base font-semibold text-[var(--text-main)]">Enviados</h2>
          <div className="mt-3">
            {erro ? (
              <ErroCarregar texto={erro} onTentar={carregar} />
            ) : carregando && lista.length === 0 ? (
              <Carregando linhas={3} />
            ) : lista.length === 0 ? (
              <EmptyState icon={Megaphone} title="Nenhum comunicado ainda" description="Os comunicados enviados aparecem aqui, com quantos leram." />
            ) : (
              <ul className="divide-y divide-[var(--border-main)]">
                {lista.map((c) => (
                  <li key={c.id} className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--text-main)] break-words">{c.titulo}</p>
                      <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{dataHora(c.criadoEm)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <Badge size="sm">{NOME_PUBLICO[c.publico] || c.publico}</Badge>
                      {c.noSistema && <Badge size="sm" variant="info">No sistema</Badge>}
                      {c.noWhatsapp && <Badge size="sm" variant="success">WhatsApp</Badge>}
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] mt-1.5">
                      {num(c.alcance)} negócio(s)
                      {c.leitura && (
                        <>
                          {' · '}{num(c.leitura.negociosQueLeram)} de {num(c.alcance)} leram
                          {c.leitura.pct !== null ? ` (${Number(c.leitura.pct).toLocaleString('pt-BR')}%)` : ''}
                          <span className="block text-xs text-[var(--text-muted)]">{num(c.leitura.leram)} de {num(c.leitura.pessoas)} pessoa(s) fecharam o aviso</span>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <ConfirmarAcao
        isOpen={confirmando}
        onClose={() => setConfirmando(false)}
        titulo="Enviar o comunicado?"
        rotuloConfirmar="Enviar agora"
        variante="primary"
        onConfirmar={enviar}
      >
        <p>
          Vai para {num(previaAtual?.negocios)} negócio(s) ({NOME_PUBLICO[publico]})
          {noSistema ? ', como aviso no sistema' : ''}
          {whatsAtivo ? `${noSistema ? ' e' : ','} no WhatsApp de ${num(previaAtual?.comTelefone)} negócio(s)` : ''}.
        </p>
        <p>Depois de enviado não dá pra desfazer.</p>
      </ConfirmarAcao>
    </div>
  );
}
