// /admin/integracoes — chaves da plataforma (uma por tipo, da Sellergy) e, por
// cliente, de onde vem cada integração. Pagamento e WhatsApp oficial ficam
// sempre no cliente: só aparecem aqui como situação, na tabela.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, FileText, KeyRound, Lock } from 'lucide-react';
import api from '../services/api';
import {
  Pagina, FaixaNumeros, Numero, ColunasPagina, Painel, Badge, Button, Input, SearchBar, useToast,
} from '../components/ui';

const CHAVES = [
  {
    tipo: 'DEEPSEEK_KEY', grupo: 'IA', nome: 'DeepSeek', icone: Sparkles,
    desc: 'Respostas do bot com IA. O gasto de cada cliente é limitado pela cota dele.',
    campos: [{ campo: 'apiKey', rotulo: 'Chave (API key)', exemplo: 'sk-...' }],
    ajuda: 'Cota e modelo de cada cliente ficam em Clientes › IA do bot.',
  },
  {
    tipo: 'FOCUS_NFE_KEY', grupo: 'Notas fiscais', nome: 'Focus NFe', icone: FileText,
    desc: 'Token de revenda da Sellergy. Fica guardado para quando as notas passarem a usar a conta da plataforma.',
    campos: [{ campo: 'token', rotulo: 'Token de revenda', exemplo: 'Cole o token' }],
    ajuda: 'Hoje cada cliente ainda emite com a chave própria (tela Fiscal dele).',
  },
  {
    tipo: 'NUVEM_FISCAL_KEY', grupo: 'Notas fiscais', nome: 'Nuvem Fiscal', icone: FileText,
    desc: 'Alternativa à Focus NFe, também como conta da Sellergy.',
    campos: [
      { campo: 'accessToken', rotulo: 'Access token', exemplo: 'Cole o access token' },
      { campo: 'clientId', rotulo: 'Client ID (opcional)', exemplo: 'Renova o token sozinho' },
      { campo: 'clientSecret', rotulo: 'Client secret (opcional)', exemplo: 'Renova o token sozinho' },
    ],
    ajuda: 'Hoje cada cliente ainda emite com a chave própria (tela Fiscal dele).',
  },
];
const TOM = { ok: 'success', info: 'info', alerta: 'warning', neutro: 'neutral' };
const data = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '');

function FormChave({ def, configurada, onSalvou, onRemoveu, onFechar }) {
  const toast = useToast();
  const [valores, setValores] = useState({});
  const [salvando, setSalvando] = useState(false);

  const salvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await api.put(`/admin/plataforma/credenciais/${def.tipo}`, { dados: valores });
      toast.success(`Chave da ${def.nome} salva.`);
      setValores({});
      onSalvou();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const remover = async () => {
    if (!confirm(`Remover a chave da ${def.nome}?${def.tipo === 'DEEPSEEK_KEY' ? ' Os bots com IA passam a responder pelo menu de perguntas até cadastrar outra.' : ''}`)) return;
    try {
      await api.delete(`/admin/plataforma/credenciais/${def.tipo}`);
      toast.success('Chave removida.');
      onRemoveu();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível remover.');
    }
  };

  return (
    <Painel
      titulo={def.nome}
      subtitulo={configurada ? 'Configurada. Cole de novo só para trocar.' : 'Ainda não configurada.'}
      acoes={<Button variant="secondary" size="sm" onClick={onFechar}>Fechar</Button>}
    >
      <form onSubmit={salvar} className="flex flex-col gap-3">
        {def.campos.map((c) => (
          <Input
            key={c.campo}
            type="password"
            size="sm"
            label={c.rotulo}
            placeholder={c.exemplo}
            autoComplete="off"
            value={valores[c.campo] || ''}
            onChange={(e) => setValores((v) => ({ ...v, [c.campo]: e.target.value }))}
          />
        ))}
        <p className="m-0 text-xs text-[var(--text-muted)] leading-relaxed">{def.ajuda}</p>
        <p className="m-0 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <Lock size={12} aria-hidden="true" /> Guardada cifrada. A chave não aparece de novo.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {configurada && <Button type="button" variant="danger-soft" size="sm" onClick={remover}>Remover chave</Button>}
          <span className="flex-1" />
          <Button type="submit" variant="primary" size="sm" loading={salvando}>Salvar chave</Button>
        </div>
      </form>
    </Painel>
  );
}

export default function AdminIntegracoesPage() {
  const [chaves, setChaves] = useState(null);
  const [porCliente, setPorCliente] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState(false);

  const carregarChaves = useCallback(() => api.get('/admin/plataforma/credenciais')
    .then((r) => setChaves(Object.fromEntries((r.data || []).map((c) => [c.tipo, c]))))
    .catch(() => setErro(true)), []);
  const carregarClientes = useCallback(() => api.get('/admin/plataforma/integracoes/clientes')
    .then((r) => setPorCliente(r.data))
    .catch(() => setErro(true)), []);

  useEffect(() => { carregarChaves(); carregarClientes(); }, [carregarChaves, carregarClientes]);

  const configuradas = chaves ? Object.values(chaves).filter((c) => c.configurada).length : null;
  const totais = porCliente?.totais;
  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (porCliente?.clientes || []).filter((c) => !q || c.nome?.toLowerCase().includes(q));
  }, [porCliente, busca]);
  const defAberta = CHAVES.find((c) => c.tipo === aberta);

  return (
    <Pagina>
      {erro && (
        <div role="alert" className="px-4 py-3 rounded-[10px] bg-[var(--danger-soft)] text-sm text-[var(--danger-text)]">
          Não foi possível carregar tudo. Recarregue a página.
        </div>
      )}

      <FaixaNumeros>
        <Numero rotulo="Chaves da plataforma" icone={KeyRound} carregando={configuradas === null} valor={`${configuradas ?? 0} de ${CHAVES.length}`} detalhe="configuradas" />
        <Numero rotulo="IA ligada" carregando={!totais} valor={totais?.iaLigada ?? 0} detalhe="clientes usando a chave da IA" />
        <Numero rotulo="WhatsApp oficial" carregando={!totais} valor={totais?.oficialConectado ?? 0}
          detalhe={totais?.oficialPendente ? `${totais.oficialPendente} com configuração incompleta` : 'conectados'}
          tomDetalhe={totais?.oficialPendente ? 'alerta' : 'neutro'} />
        <Numero rotulo="Sem pagamento" carregando={!totais} valor={totais?.semPagamento ?? 0} tom={totais?.semPagamento ? 'alerta' : 'neutro'} detalhe="clientes sem Pix configurado" />
      </FaixaNumeros>

      <ColunasPagina
        larguraLateral={340}
        lateral={(
          <>
            {defAberta && (
              <FormChave
                key={defAberta.tipo}
                def={defAberta}
                configurada={!!chaves?.[defAberta.tipo]?.configurada}
                onSalvou={carregarChaves}
                onRemoveu={carregarChaves}
                onFechar={() => setAberta(null)}
              />
            )}
            <Painel titulo="Ficam em cada cliente">
              <div className="flex flex-col gap-2.5 text-[13px] text-[var(--text-secondary)] leading-relaxed">
                <p className="m-0"><strong className="text-[var(--text-main)]">Pagamento</strong> (Mercado Pago, Asaas, Pagar.me): o Pix cai na conta de quem é dono da chave.</p>
                <p className="m-0"><strong className="text-[var(--text-main)]">WhatsApp oficial</strong>: cada cliente usa o app dele na Meta. Ele mesmo cola os dados na tela Bots, ou você cadastra em Clientes › Integrações.</p>
                <Link to="/admin/clientes" className="text-[13px] font-semibold">Ir para Clientes</Link>
              </div>
            </Painel>
          </>
        )}
      >
        <Painel titulo="Chaves da plataforma" subtitulo="Uma chave da Sellergy para todos os clientes." semPadding>
          {['IA', 'Notas fiscais'].map((grupo) => (
            <div key={grupo}>
              <div className="px-4 pt-3 pb-1.5 text-[11px] font-bold tracking-wider uppercase text-[var(--text-muted)]">{grupo}</div>
              {CHAVES.filter((c) => c.grupo === grupo).map((c) => {
                const info = chaves?.[c.tipo];
                const Icone = c.icone;
                return (
                  <div
                    key={c.tipo}
                    className={`flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-4 py-3.5 border-t border-[var(--border-subtle)] ${aberta === c.tipo ? 'bg-[var(--bg-subtle)]' : ''}`}
                  >
                    <span className="w-10 h-10 rounded-[10px] bg-[var(--bg-subtle)] grid place-items-center text-[var(--text-secondary)] flex-shrink-0" aria-hidden="true">
                      <Icone size={18} />
                    </span>
                    <div className="flex-[1_1_220px] min-w-0">
                      <p className="m-0 text-sm font-semibold text-[var(--text-main)]">{c.nome}</p>
                      <p className="m-0 mt-0.5 text-xs text-[var(--text-muted)]">{c.desc}</p>
                    </div>
                    {info?.configurada && <span className="text-xs text-[var(--text-secondary)]">desde {data(info.atualizadoEm || info.criadoEm)}</span>}
                    {chaves && (
                      <Badge variant={info?.configurada ? 'success' : 'warning'} size="sm">
                        {info?.configurada ? 'Configurada' : 'Não configurada'}
                      </Badge>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => setAberta(c.tipo)}>
                      {info?.configurada ? 'Trocar chave' : 'Configurar'}
                    </Button>
                  </div>
                );
              })}
            </div>
          ))}
        </Painel>
      </ColunasPagina>

      <Painel
        titulo="Por cliente"
        subtitulo="De onde vem cada integração."
        acoes={<div className="w-[240px] max-w-full"><SearchBar value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente" /></div>}
        semPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Origem das integrações por cliente</caption>
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)] bg-[var(--bg-subtle)]">
                <th scope="col" className="px-4 py-2.5 font-semibold">Cliente</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">WhatsApp</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Notas fiscais</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">IA do bot</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {!porCliente && (
                <tr><td colSpan={5} className="px-4 py-6"><div className="h-6 rounded bg-[var(--bg-subtle)] animate-pulse" /></td></tr>
              )}
              {porCliente && linhas.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-[var(--text-muted)]">Nenhum cliente encontrado.</td></tr>
              )}
              {linhas.map((l) => (
                <tr key={l.clienteId} className="border-t border-[var(--border-subtle)]">
                  <td className="px-4 py-2.5 font-semibold text-[var(--text-main)] whitespace-nowrap">{l.nome}</td>
                  {['whatsapp', 'notas', 'ia', 'pagamento'].map((k) => (
                    <td key={k} className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant={TOM[l[k].tom] || 'neutral'} size="sm">{l[k].rotulo}</Badge>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Painel>
    </Pagina>
  );
}
