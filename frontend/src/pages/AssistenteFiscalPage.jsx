// /app/fiscal/ativar — assistente "Ativar nota fiscal". Frente C da fase 2.
// Prototipo: sellergy-prototipo/project/AssistenteFiscal.dc.html.
// Passos: Empresa -> Certificado -> Configuracao -> Teste. Backend em
// /fiscal/assistente (src/fiscal/assistente.routes.js).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowLeft, ArrowRight, CheckCircle2, Loader2, ShieldCheck, Upload, AlertTriangle, RefreshCw, Circle, XCircle,
} from 'lucide-react';
import api from '../services/api';
import {
  Button, Switch, useToast, Pagina, ColunasPagina, Painel, LinhaInfo, Badge,
} from '../components/ui';
import { useResumoConta } from '../components/conta/useResumoConta';

const PASSOS = ['Empresa', 'Certificado', 'Configuração', 'Teste'];
const SUB_PASSOS = ['CNPJ e inscrições', 'arquivo .pfx A1', 'série e numeração', 'nota de R$ 1,00'];
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const NOME_TIPO = { NFSE: 'NFS-e (serviços)', NFCE: 'NFC-e (produtos no balcão)' };

const EMPRESA_VAZIA = {
  cnpj: '', razaoSocial: '', nomeFantasia: '', regime: '', inscricao: '', inscricaoMunicipal: '', cnae: '',
  emailEmitente: '', telefoneEmitente: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '', credencialId: '',
};

const mascaraCnpj = (v) => String(v || '').replace(/\D/g, '').slice(0, 14)
  .replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
  .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
const fmtData = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '');
const erroDe = (e, padrao) => e?.response?.data?.erro || padrao;

// Quatro cartões de passo no topo (número/OK, nome e o que cada um pede).
function Passos({ atual, feitos, irPara }) {
  return (
    <ol className="flex flex-wrap gap-2.5" aria-label="Passos">
      {PASSOS.map((t, i) => {
        const n = i + 1;
        const on = n === atual;
        const feito = feitos[i];
        return (
          <li key={t} className="flex min-w-0" style={{ flex: '1 1 160px' }}>
            <button
              type="button"
              onClick={() => irPara(n)}
              aria-current={on ? 'step' : undefined}
              className={clsx(
                'w-full flex items-center gap-2.5 px-3.5 py-3 rounded-[10px] border bg-[var(--bg-card)] text-left text-[13px] font-semibold transition-colors',
                on ? 'border-[var(--primary)] ring-1 ring-[var(--primary)] text-[var(--text-main)]'
                  : 'border-[var(--border-main)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
              )}
            >
              <span
                className={clsx('w-[26px] h-[26px] rounded-full grid place-items-center text-xs font-bold flex-shrink-0',
                  on ? 'bg-[var(--text-main)] text-[var(--bg-card)]'
                    : feito ? 'bg-[var(--primary)] text-[var(--text-on-primary)]' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]')}
                aria-hidden="true"
              >
                {feito && !on ? 'OK' : n}
              </span>
              <span className="min-w-0">
                <span className="block truncate">{t}</span>
                <span className="block text-xs font-normal text-[var(--text-muted)] truncate">{SUB_PASSOS[i]}</span>
              </span>
              {feito && <span className="sr-only">(feito)</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Campo({ id, rotulo, ajuda, erro, children, className }) {
  return (
    <div className={clsx('flex flex-col gap-1.5 min-w-0', className)}>
      <label htmlFor={id} className="text-xs font-semibold text-[var(--text-secondary)]">{rotulo}</label>
      {children}
      {erro ? <p className="text-xs text-[var(--danger-text)]">{erro}</p> : ajuda ? <p className="text-xs text-[var(--text-muted)] leading-snug">{ajuda}</p> : null}
    </div>
  );
}

const classeCampo = (erro) => clsx(
  'w-full h-[38px] rounded-lg border bg-[var(--bg-card)] px-2.5 text-[13px] text-[var(--text-main)]',
  erro ? 'border-[var(--danger)]' : 'border-[var(--border-strong)]',
);

const grade = (min) => ({ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` });

function Falta({ itens }) {
  if (!itens?.length) return null;
  return (
    <p role="status" className="text-[13px] text-[var(--warning-text)] bg-[var(--warning-soft)] rounded-lg px-3 py-2">
      Falta: {itens.join(', ')}.
    </p>
  );
}

// Rodapé do cartão do passo: Voltar à esquerda, ações à direita.
function Rodape({ voltar, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-[var(--border-subtle)]">
      {voltar ? <Button variant="ghost" icon={ArrowLeft} onClick={voltar}>Voltar</Button> : <span />}
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export default function AssistenteFiscalPage() {
  const toast = useToast();
  const { resumo } = useResumoConta();
  const [estado, setEstado] = useState(null);
  const [erroCarga, setErroCarga] = useState(null);
  const [passo, setPasso] = useState(1);
  const [empresa, setEmpresa] = useState(EMPRESA_VAZIA);
  const [config, setConfig] = useState({ serie: '1', proximoNumero: '1', csc: '', emitirAutomatico: false });
  const [camposErro, setCamposErro] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [arquivo, setArquivo] = useState(null);
  const [senhaCert, setSenhaCert] = useState('');
  const [erroCert, setErroCert] = useState(null);
  const [teste, setTeste] = useState(null);
  const [testando, setTestando] = useState(false);
  const [erroTeste, setErroTeste] = useState(null);
  const arquivoRef = useRef(null);

  const semPlano = resumo?.plano?.recursos && resumo.plano.recursos.notaFiscal === false;

  const aplicarEstado = useCallback((e, { preencher = false } = {}) => {
    setEstado(e);
    if (preencher) {
      const c = e.config || {};
      setEmpresa({
        ...EMPRESA_VAZIA,
        ...Object.fromEntries(Object.keys(EMPRESA_VAZIA).map((k) => [k, c[k] ?? ''])),
        cnpj: mascaraCnpj(c.cnpj || e.sugestaoCnpj || ''),
        credencialId: c.credencialId || e.emissores?.[0]?.credencialId || '',
      });
      setConfig({
        serie: c.serie || '1',
        proximoNumero: String(c.proximoNumero || 1),
        csc: c.temCsc ? c.csc : '',
        emitirAutomatico: c.emitirAutomatico === true,
      });
    }
  }, []);

  const carregar = useCallback(async () => {
    try {
      const r = await api.get('/fiscal/assistente');
      aplicarEstado(r.data, { preencher: true });
      setErroCarga(null);
    } catch (e) {
      setErroCarga(erroDe(e, 'Não foi possível carregar.'));
    }
  }, [aplicarEstado]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao montar
    carregar();
  }, [carregar]);

  const tratarErro = (e, padrao) => {
    const d = e?.response?.data;
    if (d?.codigo === 'PLANO_SEM_RECURSO') toast.error('Nota fiscal está no plano Profissional e no Negócio.');
    else toast.error(d?.erro || padrao);
    setCamposErro(Array.isArray(d?.campos) ? d.campos : []);
  };

  const salvarEmpresa = async () => {
    setSalvando(true);
    setCamposErro([]);
    try {
      const r = await api.put('/fiscal/assistente/empresa', { ...empresa, credencialId: empresa.credencialId || undefined });
      aplicarEstado(r.data);
      setPasso(2);
    } catch (e) {
      tratarErro(e, 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const enviarCertificado = async () => {
    setErroCert(null);
    if (!arquivo) { setErroCert('Escolha o arquivo .pfx.'); return; }
    if (!senhaCert) { setErroCert('Digite a senha do certificado.'); return; }
    setSalvando(true);
    try {
      const form = new FormData();
      form.append('certificado', arquivo);
      form.append('senha', senhaCert);
      const r = await api.post('/fiscal/assistente/certificado', form);
      aplicarEstado(r.data);
      setArquivo(null);
      setSenhaCert('');
      toast.success('Certificado aceito.');
    } catch (e) {
      setErroCert(erroDe(e, 'Não foi possível enviar o certificado.'));
    } finally {
      setSalvando(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  };

  const salvarConfig = async () => {
    setSalvando(true);
    setCamposErro([]);
    try {
      const r = await api.put('/fiscal/assistente/configuracao', config);
      aplicarEstado(r.data);
      setConfig((c) => ({ ...c, csc: r.data.config?.temCsc ? r.data.config.csc : '' }));
      setPasso(4);
    } catch (e) {
      tratarErro(e, 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const emitirTeste = async () => {
    setTestando(true);
    setErroTeste(null);
    setTeste(null);
    try {
      const r = await api.post('/fiscal/assistente/teste');
      setTeste(r.data);
    } catch (e) {
      setErroTeste(erroDe(e, 'Não foi possível emitir a nota de teste.'));
    } finally {
      setTestando(false);
    }
  };

  const ativar = async () => {
    setSalvando(true);
    try {
      const r = await api.post('/fiscal/assistente/ativar');
      aplicarEstado(r.data);
      toast.success('Nota fiscal ativada.');
    } catch (e) {
      tratarErro(e, 'Não foi possível ativar.');
    } finally {
      setSalvando(false);
    }
  };


  if (erroCarga) {
    return (
      <Painel titulo="Configurar nota fiscal" className="max-w-xl">
        <p className="text-[13px] text-[var(--danger-text)]">{erroCarga}</p>
        <Button className="mt-3" variant="secondary" icon={RefreshCw} onClick={carregar}>Tentar de novo</Button>
      </Painel>
    );
  }
  if (!estado) return <div className="p-6"><Loader2 className="animate-spin text-[var(--text-muted)]" aria-label="Carregando" /></div>;

  const pend = estado.pendencias;
  const feitos = [!pend.empresa.length, !pend.certificado.length, !pend.configuracao.length, estado.ativo];
  const setE = (k) => (e) => setEmpresa((x) => ({ ...x, [k]: k === 'cnpj' ? mascaraCnpj(e.target.value) : e.target.value }));
  const err = (k) => (camposErro.includes(k) ? 'Confira este campo' : undefined);
  const tipos = estado.tipos || [];
  const qtdFeitos = feitos.filter(Boolean).length;
  const faltaPorPasso = [pend.empresa, pend.certificado, pend.configuracao, [...pend.emissor, 'nota de teste e ativação']];
  const emissorAtual = estado.emissores.find((em) => em.credencialId === (estado.config?.credencialId || empresa.credencialId));
  const cert = estado.certificado;
  const certVencendo = cert && cert.diasParaVencer !== null && cert.diasParaVencer <= 30;

  const lateral = (
    <>
      <Painel titulo="O que falta" acoes={<Badge variant={qtdFeitos === 4 ? 'success' : 'neutral'}>{qtdFeitos} de 4</Badge>} semPadding>
        <ul>
          {PASSOS.map((t, i) => {
            const st = feitos[i] ? 'Feito' : i + 1 === passo ? 'Agora' : 'Falta';
            const itens = feitos[i] ? [] : faltaPorPasso[i];
            return (
              <li key={t} className="px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0 text-[13px]">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setPasso(i + 1)} className="flex-1 min-w-0 text-left font-semibold text-[var(--text-main)] hover:underline">
                    {t}
                  </button>
                  <Badge variant={st === 'Feito' ? 'success' : st === 'Agora' ? 'warning' : 'neutral'}>{st}</Badge>
                </div>
                {itens.length > 0 && <p className="mt-0.5 text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">{itens.join(', ')}</p>}
              </li>
            );
          })}
        </ul>
        {semPlano && (
          <p className="px-4 py-3 border-t border-[var(--border-subtle)] text-xs text-[var(--info-text)] bg-[var(--info-soft)] rounded-b-[10px]">
            Nota fiscal está nos planos Profissional e Negócio. <Link to="/app/plano" className="font-semibold underline">Ver planos</Link>
          </p>
        )}
      </Painel>

      <Painel titulo="Resumo" subtitulo="Do que já está salvo" semPadding>
        <LinhaInfo rotulo="Vai emitir" valor={tipos.map((t) => NOME_TIPO[t]).join(' e ') || '—'} />
        <LinhaInfo rotulo="Emissor" valor={emissorAtual ? emissorAtual.provedorNome : 'Não ligado'} />
        <LinhaInfo rotulo="Certificado">
          {cert ? (
            <Badge variant={pend.certificado.length ? 'danger' : certVencendo ? 'warning' : 'success'}>
              {pend.certificado.length ? 'Vencido' : `até ${fmtData(cert.validoAte)}`}
            </Badge>
          ) : <Badge variant="neutral">Não enviado</Badge>}
        </LinhaInfo>
        <LinhaInfo rotulo="Numeração" valor={estado.config?.serie ? `série ${estado.config.serie} · nº ${estado.config.proximoNumero}` : '—'} />
        <LinhaInfo rotulo="Emitir sozinho">
          <Badge variant={estado.config?.emitirAutomatico ? 'success' : 'neutral'}>{estado.config?.emitirAutomatico ? 'Ligado' : 'Desligado'}</Badge>
        </LinhaInfo>
        <LinhaInfo rotulo="Situação">
          <Badge variant={estado.ativo ? 'success' : 'neutral'}>{estado.ativo ? 'Ativada' : 'Não ativada'}</Badge>
        </LinhaInfo>
      </Painel>
    </>
  );

  return (
    <Pagina>
      <p className="text-[13px] text-[var(--text-muted)]">
        Faça uma vez. Depois a nota sai sozinha em cada venda paga.{' '}
        <Link to="/app/fiscal" className="font-semibold text-[var(--primary)] hover:underline">Ver notas fiscais</Link>
      </p>

      {estado.ativo && (
        <div role="status" className="flex items-start gap-3 rounded-[10px] bg-[var(--success-soft)] text-[var(--success-text)] px-4 py-3">
          <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" aria-hidden />
          <div className="text-[13px]">
            <p className="font-semibold">Nota fiscal ativada.</p>
            <p>{estado.config?.emitirAutomatico ? 'A próxima venda paga já sai com nota.' : 'Emita pelas Notas fiscais ou ligue "Emitir sozinho" na Configuração.'}
              {!estado.emissaoReal && ' O servidor ainda está em modo de teste: as notas ficam simuladas até o suporte ligar a emissão real.'}
            </p>
            <Link to="/app/fiscal" className="font-semibold underline">Ver notas fiscais</Link>
          </div>
        </div>
      )}

      <Passos atual={passo} feitos={feitos} irPara={setPasso} />

      <ColunasPagina lateral={lateral}>
        {passo === 1 && (
          <Painel titulo="Dados da empresa" subtitulo="Do jeito que está no cartão CNPJ. Confira com seu contador se tiver dúvida." acoes={<Badge variant="neutral">Passo 1 de 4</Badge>} semPadding>
            <div className="p-4 grid gap-3.5" style={grade(220)}>
              <Campo id="f-cnpj" rotulo="CNPJ" erro={err('cnpj')}><input id="f-cnpj" inputMode="numeric" className={classeCampo(err('cnpj'))} value={empresa.cnpj} onChange={setE('cnpj')} placeholder="00.000.000/0000-00" /></Campo>
              <Campo id="f-regime" rotulo="Regime" erro={err('regime')}>
                <select id="f-regime" className={classeCampo(err('regime'))} value={empresa.regime} onChange={setE('regime')}>
                  <option value="">Escolha…</option>
                  {estado.regimes.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Campo>
              <Campo id="f-razao" rotulo="Razão social" erro={err('razaoSocial')}><input id="f-razao" className={classeCampo(err('razaoSocial'))} value={empresa.razaoSocial} onChange={setE('razaoSocial')} /></Campo>
              <Campo id="f-fantasia" rotulo="Nome fantasia (opcional)"><input id="f-fantasia" className={classeCampo()} value={empresa.nomeFantasia} onChange={setE('nomeFantasia')} /></Campo>
              {tipos.includes('NFSE') && (
                <Campo id="f-im" rotulo="Inscrição municipal" ajuda="Está no alvará ou no site da prefeitura."><input id="f-im" className={classeCampo()} value={empresa.inscricaoMunicipal} onChange={setE('inscricaoMunicipal')} /></Campo>
              )}
              {tipos.includes('NFCE') && (
                <Campo id="f-ie" rotulo="Inscrição estadual" ajuda='Se não tiver, escreva "ISENTO".'><input id="f-ie" className={classeCampo()} value={empresa.inscricao} onChange={setE('inscricao')} /></Campo>
              )}
              <Campo id="f-email" rotulo="E-mail da empresa (opcional)" erro={err('emailEmitente')}><input id="f-email" type="email" className={classeCampo(err('emailEmitente'))} value={empresa.emailEmitente} onChange={setE('emailEmitente')} /></Campo>
              {estado.emissores.length > 1 && (
                <Campo id="f-emissor" rotulo="Emissor da nota">
                  <select id="f-emissor" className={classeCampo()} value={empresa.credencialId} onChange={setE('credencialId')}>
                    {estado.emissores.map((em) => <option key={em.credencialId} value={em.credencialId}>{em.provedorNome} · {em.nome}</option>)}
                  </select>
                </Campo>
              )}
            </div>
            <div className="px-4 pb-4">
              <p className="text-xs font-semibold text-[var(--text-muted)] mb-2.5">Endereço</p>
              <div className="grid gap-3.5" style={grade(220)}>
                <Campo id="f-cep" rotulo="CEP" erro={err('cep')}><input id="f-cep" inputMode="numeric" className={classeCampo(err('cep'))} value={empresa.cep} onChange={setE('cep')} /></Campo>
                <Campo id="f-log" rotulo="Rua / avenida" erro={err('logradouro')}><input id="f-log" className={classeCampo(err('logradouro'))} value={empresa.logradouro} onChange={setE('logradouro')} /></Campo>
                <div className="grid grid-cols-2 gap-3.5">
                  <Campo id="f-num" rotulo="Número" erro={err('numero')}><input id="f-num" className={classeCampo(err('numero'))} value={empresa.numero} onChange={setE('numero')} /></Campo>
                  <Campo id="f-comp" rotulo="Complemento"><input id="f-comp" className={classeCampo()} value={empresa.complemento} onChange={setE('complemento')} /></Campo>
                </div>
                <Campo id="f-bairro" rotulo="Bairro"><input id="f-bairro" className={classeCampo()} value={empresa.bairro} onChange={setE('bairro')} /></Campo>
                <div className="grid grid-cols-[1fr_5.5rem] gap-3.5">
                  <Campo id="f-mun" rotulo="Cidade" erro={err('municipio')}><input id="f-mun" className={classeCampo(err('municipio'))} value={empresa.municipio} onChange={setE('municipio')} /></Campo>
                  <Campo id="f-uf" rotulo="UF" erro={err('uf')}>
                    <select id="f-uf" className={classeCampo(err('uf'))} value={empresa.uf} onChange={setE('uf')}>
                      <option value="">--</option>
                      {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </Campo>
                </div>
              </div>
            </div>
            <p className="px-4 pb-3 text-[13px] text-[var(--text-secondary)]">O que você vai emitir: <strong>{tipos.map((t) => NOME_TIPO[t]).join(' e ')}</strong>.</p>
            <Rodape>
              <Button icon={ArrowRight} iconPosition="right" loading={salvando} onClick={salvarEmpresa}>Salvar e continuar</Button>
            </Rodape>
          </Painel>
        )}

        {passo === 2 && (
          <Painel
            titulo="Certificado digital A1"
            acoes={cert ? <Badge variant={pend.certificado.length ? 'danger' : 'success'}>{pend.certificado.length ? 'Vencido' : 'Certificado aceito'}</Badge> : <Badge variant="neutral">Passo 2 de 4</Badge>}
            semPadding
          >
            <div className="p-4 flex flex-col gap-3.5">
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                É o arquivo .pfx que a certificadora te entregou. Sem ele a prefeitura e a SEFAZ não aceitam a nota.
                O arquivo e a senha vão direto pro emissor; aqui fica só a validade, pra avisar antes de vencer.
              </p>
              <Falta itens={pend.empresa.length ? ['dados da empresa (passo 1)'] : null} />
              {cert && (
                <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--border-main)] px-3.5 py-3">
                  <ShieldCheck size={18} className={pend.certificado.length ? 'text-[var(--danger-text)]' : 'text-[var(--success-text)]'} aria-hidden />
                  <div className="flex-1 min-w-0 text-[13px]">
                    <p className="font-semibold text-[var(--text-main)] truncate">{cert.titular}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Válido até {fmtData(cert.validoAte)}
                      {certVencendo ? ` · vence em ${cert.diasParaVencer} dias` : ''}
                    </p>
                  </div>
                </div>
              )}
              <div className="rounded-[10px] border border-dashed border-[var(--border-strong)] p-4 flex flex-col gap-3">
                <p className="text-[13px] font-semibold text-[var(--text-main)]">{cert ? 'Trocar o certificado' : 'Enviar o certificado'}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <input ref={arquivoRef} id="f-pfx" type="file" accept=".pfx,.p12,application/x-pkcs12" className="sr-only" onChange={(e) => setArquivo(e.target.files?.[0] || null)} />
                  <Button variant="secondary" icon={Upload} onClick={() => arquivoRef.current?.click()}>Escolher arquivo .pfx</Button>
                  <span className="text-[13px] text-[var(--text-secondary)] truncate max-w-full">{arquivo ? arquivo.name : 'Nenhum arquivo escolhido'}</span>
                </div>
                <Campo id="f-senha-cert" rotulo="Senha do certificado" className="max-w-sm">
                  <input id="f-senha-cert" type="password" autoComplete="off" className={classeCampo()} value={senhaCert} onChange={(e) => setSenhaCert(e.target.value)} />
                </Campo>
                {erroCert && <p role="alert" className="text-[13px] text-[var(--danger-text)]">{erroCert}</p>}
                <div>
                  <Button loading={salvando} disabled={Boolean(pend.empresa.length)} onClick={enviarCertificado}>Enviar certificado</Button>
                </div>
              </div>
            </div>
            <Rodape voltar={() => setPasso(1)}>
              <Button icon={ArrowRight} iconPosition="right" disabled={Boolean(pend.certificado.length)} onClick={() => setPasso(3)}>Continuar</Button>
            </Rodape>
          </Painel>
        )}

        {passo === 3 && (
          <Painel titulo="Como a nota sai" subtitulo="Série, numeração e emissão automática." acoes={<Badge variant="neutral">Passo 3 de 4</Badge>} semPadding>
            <div className="p-4 grid gap-3.5" style={grade(240)}>
              <Campo id="f-serie" rotulo="Série" erro={err('serie')}><input id="f-serie" inputMode="numeric" className={classeCampo(err('serie'))} value={config.serie} onChange={(e) => setConfig((c) => ({ ...c, serie: e.target.value }))} /></Campo>
              <Campo id="f-prox" rotulo="Próximo número" erro={err('proximoNumero')} ajuda="Se já emitia em outro sistema, continue de onde parou."><input id="f-prox" inputMode="numeric" className={classeCampo(err('proximoNumero'))} value={config.proximoNumero} onChange={(e) => setConfig((c) => ({ ...c, proximoNumero: e.target.value }))} /></Campo>
              {tipos.includes('NFCE') && (
                <Campo id="f-csc" rotulo="CSC da NFC-e" erro={err('csc')} ajuda="Código que a SEFAZ te deu, no site da SEFAZ do seu estado.">
                  <input id="f-csc" autoComplete="off" className={classeCampo(err('csc'))} value={config.csc} onChange={(e) => setConfig((c) => ({ ...c, csc: e.target.value }))} />
                </Campo>
              )}
            </div>
            <div className="flex items-start justify-between gap-4 px-4 py-3 border-t border-[var(--border-subtle)]">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--text-main)]">Emitir sozinho em toda venda paga</p>
                <p className="text-xs text-[var(--text-muted)]">Depois de ativar, cada venda concluída ganha a nota em até 2 minutos.</p>
              </div>
              <Switch ariaLabel="Emitir sozinho em toda venda paga" checked={config.emitirAutomatico} onChange={(v) => setConfig((c) => ({ ...c, emitirAutomatico: v }))} />
            </div>
            <Rodape voltar={() => setPasso(2)}>
              <Button icon={ArrowRight} iconPosition="right" loading={salvando} onClick={salvarConfig}>Salvar e continuar</Button>
            </Rodape>
          </Painel>
        )}

        {passo === 4 && (
          <Painel titulo="Nota de teste" acoes={<Badge variant="info">Homologação</Badge>} semPadding>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-[13px] text-[var(--text-secondary)]">Mandamos uma nota de R$ 1,00 pro ambiente de teste. Não vale como nota de verdade.</p>
              <Falta itens={[...pend.empresa, ...pend.certificado, ...pend.configuracao, ...pend.emissor]} />
              {pend.emissor.length > 0 && (
                <p className="text-[13px] text-[var(--text-secondary)]">A integração com o emissor da nota é ligada pelo suporte do Sellergy. Fale com a gente pelo chat e avisamos quando estiver pronta.</p>
              )}
              {erroTeste && <p role="alert" className="text-[13px] text-[var(--danger-text)] flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden />{erroTeste}</p>}
            </div>
            {teste && (
              <ul className="border-t border-[var(--border-subtle)]" aria-live="polite">
                <li className="flex items-center gap-2.5 px-4 py-2.5 border-b border-[var(--border-subtle)] text-[13px]">
                  <CheckCircle2 size={16} className="text-[var(--success-text)]" aria-hidden />
                  <span className="flex-1 min-w-0">Certificado aceito</span>
                  <Badge variant="success">OK</Badge>
                </li>
                {teste.resultados.map((r) => (
                  <li key={r.tipo} className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 border-b border-[var(--border-subtle)] text-[13px]">
                    {r.status === 'EMITIDA' ? <CheckCircle2 size={16} className="text-[var(--success-text)]" aria-hidden />
                      : r.status === 'ERRO' ? <XCircle size={16} className="text-[var(--danger-text)]" aria-hidden />
                        : <Circle size={16} className="text-[var(--text-muted)]" aria-hidden />}
                    <span className="flex-1 min-w-0 [overflow-wrap:anywhere]">
                      {NOME_TIPO[r.tipo]} de teste {r.status === 'EMITIDA' ? 'autorizada' : r.status === 'ERRO' ? 'recusada' : 'em processamento'}
                      {r.mensagem && <span className="block text-xs text-[var(--danger-text)]">{r.mensagem}</span>}
                    </span>
                    <span className="text-xs text-[var(--text-muted)] tabular-nums">{r.numero ? `nº ${r.numero} · ` : ''}{(r.ms / 1000).toFixed(1).replace('.', ',')} s</span>
                  </li>
                ))}
                {teste.simulado && (
                  <li className="px-4 py-2.5 border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">Teste simulado: o servidor ainda não está ligado ao emissor real ({teste.provedor}).</li>
                )}
              </ul>
            )}
            <Rodape voltar={() => setPasso(3)}>
              <Button variant="secondary" loading={testando} disabled={!pend.prontoParaTeste} onClick={emitirTeste}>
                {teste ? 'Emitir de novo' : 'Emitir nota de teste'}
              </Button>
              {!estado.ativo && (
                <Button loading={salvando} disabled={!teste?.ok} onClick={ativar}>Ativar nota fiscal</Button>
              )}
            </Rodape>
          </Painel>
        )}
      </ColunasPagina>
    </Pagina>
  );
}
