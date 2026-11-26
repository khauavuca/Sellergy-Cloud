import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Lock, XCircle } from 'lucide-react';
import api from '../../services/api';
import { Button, Combobox, Input, Painel, useToast } from '../ui';

// Admin › Integrações › IA da plataforma: provedor (DeepSeek direto ou
// OpenRouter), modelo (OpenRouter: lista deles, só os que aceitam
// ferramentas), chave e o botão Testar (manda um "oi" de verdade).

const PROVEDORES = [
  { id: 'DEEPSEEK', nome: 'DeepSeek', desc: 'Direto na DeepSeek. Modelo (Flash/Pro) por cliente.', exemplo: 'sk-...' },
  { id: 'OPENROUTER', nome: 'OpenRouter', desc: 'Centenas de modelos, inclusive grátis. Um modelo para todos.', exemplo: 'sk-or-...' },
];

const usd = (v) => (v == null ? '?' : `US$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`);

export default function FormIAPlataforma({ info, onSalvou, onRemoveu, onFechar }) {
  const toast = useToast();
  const [provedor, setProvedor] = useState(info?.provedor || 'DEEPSEEK');
  const [modelo, setModelo] = useState(info?.modelo || '');
  const [apiKey, setApiKey] = useState('');
  const [modelos, setModelos] = useState(null);
  const [erroModelos, setErroModelos] = useState(false);
  const [soGratis, setSoGratis] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState(null);

  const mesmoProvedor = info?.configurada && info.provedor === provedor;
  const def = PROVEDORES.find((p) => p.id === provedor);

  useEffect(() => {
    if (provedor !== 'OPENROUTER' || modelos) return undefined;
    let vivo = true;
    api.get('/admin/plataforma/ia/modelos')
      .then((r) => { if (vivo) setModelos(r.data || []); })
      .catch(() => { if (vivo) setErroModelos(true); });
    return () => { vivo = false; };
  }, [provedor, modelos]);

  const opcoes = useMemo(() => (modelos || [])
    .filter((m) => !soGratis || m.gratis || m.id === modelo)
    .map((m) => ({
      value: m.id,
      label: m.nome,
      sublabel: m.gratis ? `${m.id} · grátis, com limite por minuto` : `${m.id} · ${usd(m.entrada)} entrada / ${usd(m.saida)} saída por milhão`,
      badge: m.gratis ? 'Grátis' : undefined,
    })), [modelos, soGratis, modelo]);

  const salvar = async (e) => {
    e.preventDefault();
    if (provedor === 'OPENROUTER' && !modelo) return toast.error('Escolha o modelo.');
    if (!mesmoProvedor && !apiKey.trim()) return toast.error(`Cole a chave do ${def.nome}.`);
    setSalvando(true);
    try {
      await api.put('/admin/plataforma/ia', { provedor, modelo: provedor === 'OPENROUTER' ? modelo : undefined, apiKey: apiKey.trim() || undefined });
      toast.success('IA da plataforma salva.');
      setApiKey('');
      setTeste(null);
      onSalvou();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const testar = async () => {
    setTestando(true);
    setTeste(null);
    try {
      const r = await api.post('/admin/plataforma/ia/testar');
      setTeste(r.data);
    } catch (err) {
      setTeste({ ok: false, erro: err.response?.data?.erro || 'Não foi possível testar.' });
    } finally {
      setTestando(false);
    }
  };

  const remover = async () => {
    if (!confirm('Remover a chave da IA? Os bots com IA passam a responder pelo menu de perguntas até cadastrar outra.')) return;
    try {
      await api.delete('/admin/plataforma/credenciais/DEEPSEEK_KEY');
      toast.success('Chave removida.');
      setTeste(null);
      onRemoveu();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível remover.');
    }
  };

  const mudouAlgo = !info?.configurada || provedor !== info.provedor || (provedor === 'OPENROUTER' && modelo !== info.modelo) || apiKey.trim();

  return (
    <Painel
      titulo="IA da plataforma"
      subtitulo="Quem responde os bots com IA de todos os clientes."
      acoes={<Button variant="secondary" size="sm" onClick={onFechar}>Fechar</Button>}
    >
      <form onSubmit={salvar} className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Provedor" className="grid grid-cols-2 gap-2">
          {PROVEDORES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={provedor === p.id}
              onClick={() => { setProvedor(p.id); setTeste(null); }}
              className={clsx(
                'text-left rounded-[10px] border px-3 py-2.5 transition-colors',
                provedor === p.id ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border-main)] bg-[var(--bg-card)] hover:bg-[var(--bg-subtle)]',
              )}
            >
              <span className="block text-[13px] font-semibold text-[var(--text-main)]">{p.nome}</span>
              <span className="block mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">{p.desc}</span>
            </button>
          ))}
        </div>

        {provedor === 'OPENROUTER' && (
          <div className="flex flex-col gap-1.5">
            {erroModelos ? (
              <p className="m-0 text-xs text-[var(--danger-text)]">Não foi possível buscar a lista do OpenRouter. Tente de novo daqui a pouco.</p>
            ) : (
              <Combobox
                label="Modelo"
                size="sm"
                value={modelo}
                onChange={(id) => { setModelo(id); setTeste(null); }}
                options={opcoes}
                placeholder={modelos ? 'Busque pelo nome (ex.: deepseek, gemma)' : 'Carregando modelos...'}
                disabled={!modelos}
              />
            )}
            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <input type="checkbox" checked={soGratis} onChange={(e) => setSoGratis(e.target.checked)} />
              Mostrar só os grátis
            </label>
            <p className="m-0 text-[11px] text-[var(--text-muted)] leading-relaxed">
              Só aparecem modelos que aceitam ferramentas (marcar horário, ver produto). Os grátis têm limite de pedidos por minuto: bons para teste.
            </p>
          </div>
        )}

        <Input
          type="password"
          size="sm"
          label={`Chave do ${def.nome}`}
          placeholder={mesmoProvedor ? 'Deixe vazio para manter a atual' : def.exemplo}
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <p className="m-0 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <Lock size={12} aria-hidden="true" /> Guardada cifrada. A chave não aparece de novo.
        </p>

        {info?.configurada && !info.ligadaNosBots && (
          <div role="status" className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--warning-soft)] text-xs text-[var(--warning-text)]">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
            O servidor está com a IA em modo simulado (IA_MODO). O Testar funciona, mas os bots ainda dão resposta de exemplo.
          </div>
        )}

        {teste && (
          <div
            role="status"
            className={clsx('flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs leading-relaxed', teste.ok ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'bg-[var(--danger-soft)] text-[var(--danger-text)]')}
          >
            {teste.ok ? <CheckCircle2 size={15} className="flex-shrink-0 mt-px" aria-hidden="true" /> : <XCircle size={15} className="flex-shrink-0 mt-px" aria-hidden="true" />}
            <div className="min-w-0">
              <strong className="block">{teste.ok ? `Respondeu em ${(teste.ms / 1000).toFixed(1).replace('.', ',')} s` : 'Falhou'}</strong>
              <span className="block break-words">{teste.ok ? `"${teste.texto || '(resposta vazia)'}"` : teste.erro}</span>
              {teste.modelo && <span className="block opacity-80 mt-0.5">{teste.modelo}</span>}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {info?.configurada && <Button type="button" variant="danger-soft" size="sm" onClick={remover}>Remover</Button>}
          <span className="flex-1" />
          {info?.configurada && (
            <Button type="button" variant="secondary" size="sm" loading={testando} disabled={!!mudouAlgo} onClick={testar}
              title={mudouAlgo ? 'Salve antes de testar' : undefined}>
              Testar
            </Button>
          )}
          <Button type="submit" variant="primary" size="sm" loading={salvando} disabled={!mudouAlgo}>Salvar</Button>
        </div>
      </form>
    </Painel>
  );
}
