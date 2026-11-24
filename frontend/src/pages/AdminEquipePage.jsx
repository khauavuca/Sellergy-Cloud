// /admin/equipe — equipe Sellergy (papeis) e auditoria (frente D da fase 2).
// Rotas em backend/src/routes/adminEquipe.routes.js. So o dono acessa.
import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, PlayCircle, RefreshCw, ScrollText, ShieldCheck, ShieldOff, UserPlus, UserX } from 'lucide-react';
import api from '../services/api';
import { Badge, Button, EmptyState, Input, Select, Switch, useToast } from '../components/ui';
import Modal from '../components/Modal';
import ConfirmarAcao from '../components/conta/ConfirmarAcao';
import { SemPermissao, ErroCarregar, Carregando } from '../components/suporte/EstadosAdmin';
import { usePapelAdmin, erroDaApi, dataHora, NOME_PAPEL } from '../components/suporte/papelAdmin';

const OPCOES_PAPEL = ['DONO', 'SUPORTE', 'FINANCEIRO'].map((p) => ({ value: p, label: NOME_PAPEL[p] }));
const VARIANTE_PAPEL = { DONO: 'success', SUPORTE: 'info', FINANCEIRO: 'accent', DESATIVADO: 'neutral' };

const LINHAS_MATRIZ = [
  { rotulo: 'Ver clientes e uso', acao: 'clientes.ver' },
  { rotulo: 'Entrar como suporte (só leitura)', acao: 'suporte.entrar' },
  { rotulo: 'Responder chamados', acao: 'suporte.responder' },
  { rotulo: 'Dar baixa, desconto e mudar plano', acao: 'cobranca.baixa' },
  { rotulo: 'Suspender e cancelar', acao: 'conta.suspender' },
  { rotulo: 'Preços, régua e equipe', acao: 'equipe.gerenciar' },
];

const ROTULO_ACAO = {
  ASSINATURA_ESTENDER_TESTE: 'Estendeu o teste grátis',
  ASSINATURA_CANCELAR: 'Cancelou a assinatura',
  ASSINATURA_SUSPENDER: 'Suspendeu a conta',
  ADMIN_LOGIN: 'Entrou no painel',
  ADMIN_LOGIN_FALHOU: 'Errou a senha ou o código no login',
  ADMIN_LOGIN_BLOQUEADO: 'Login bloqueado por tentativas erradas',
  ASSINATURA_REATIVAR: 'Reativou a conta',
  ASSINATURA_DESCONTO: 'Deu desconto na mensalidade',
  ASSINATURA_MUDAR_PLANO: 'Mudou o plano',
  ASSINATURA_EDITAR: 'Editou a assinatura',
  FATURA_BAIXA_MANUAL: 'Deu baixa manual em fatura',
  SUPORTE_ENTRAR: 'Entrou como suporte (só leitura)',
  SUPORTE_SAIR: 'Encerrou a sessão de suporte',
  SUPORTE_RESPOSTAS_PRONTAS: 'Editou as respostas prontas',
  CHAMADO_RESPONDER: 'Respondeu chamado',
  CHAMADO_RESPONDER_RESOLVER: 'Respondeu e resolveu chamado',
  CHAMADO_RESOLVER: 'Resolveu chamado',
  CHAMADO_REABRIR: 'Reabriu chamado',
  COMUNICADO_ENVIAR: 'Enviou comunicado',
  PLANO_EDITAR: 'Mudou preço/limites do plano',
  PLANO_RESTAURAR_PADRAO: 'Voltou o plano ao padrão',
  CUPOM_CRIAR: 'Criou cupom',
  CUPOM_LIGAR: 'Ligou cupom',
  CUPOM_DESLIGAR: 'Desligou cupom',
  CUSTOS_EDITAR: 'Editou os custos',
  EQUIPE_CRIAR: 'Criou acesso na equipe',
  EQUIPE_EDITAR: 'Editou acesso da equipe',
  EQUIPE_DESATIVAR: 'Desativou acesso da equipe',
  EQUIPE_REATIVAR: 'Reativou acesso da equipe',
  EQUIPE_NOVA_SENHA: 'Gerou senha provisória',
};
const rotuloAcao = (a) => ROTULO_ACAO[a] || a;

function alvo(i) {
  if (i.alvoNome) return i.alvoNome;
  if (!i.alvoTipo) return '—';
  return `${i.alvoTipo.toLowerCase()}${i.alvoId ? ` ${String(i.alvoId).slice(0, 8)}` : ''}`;
}

function resumoDetalhes(d) {
  if (!d || typeof d !== 'object') return null;
  return JSON.stringify(d, null, 2);
}

// ---------------------------------------------------------------------
// Senha provisoria (mostrada uma vez)
// ---------------------------------------------------------------------
function ModalSenha({ dados, onFechar }) {
  const toast = useToast();
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(dados.senha);
      toast.success('Senha copiada.');
    } catch {
      toast.error('Não deu pra copiar. Selecione e copie à mão.');
    }
  };
  return (
    <Modal isOpen={Boolean(dados)} onClose={onFechar} title="Senha provisória" size="sm">
      {dados && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Acesso de <strong className="text-[var(--text-main)]">{dados.nome}</strong> ({dados.email}).
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 break-all rounded-lg bg-[var(--bg-subtle)] px-3 py-2.5 text-base font-semibold text-[var(--text-main)] select-all">
              {dados.senha}
            </code>
            <Button variant="secondary" className="min-h-11" icon={Copy} onClick={copiar} aria-label="Copiar senha">Copiar</Button>
          </div>
          <p className="text-sm text-[var(--warning-text)] bg-[var(--warning-soft)] rounded-lg px-3 py-2">
            Anote agora: esta senha não aparece de novo. No primeiro acesso a pessoa troca a senha
            {dados.exige2fa ? ' e ativa o código em 2 etapas' : ''}. Mande por um canal seguro.
          </p>
          <div className="flex justify-end">
            <Button className="min-h-11" onClick={onFechar}>Já anotei</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Nova pessoa
// ---------------------------------------------------------------------
function ModalNovaPessoa({ isOpen, onFechar, onCriado }) {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState('SUPORTE');
  const [exige2fa, setExige2fa] = useState(true);
  const [campos, setCampos] = useState([]);
  const [enviando, setEnviando] = useState(false);

  const fechar = () => {
    if (enviando) return;
    setNome(''); setEmail(''); setPapel('SUPORTE'); setExige2fa(true); setCampos([]);
    onFechar();
  };

  const salvar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api.post('/admin/equipe', { nome: nome.trim(), email: email.trim(), papel, exige2fa });
      onCriado({ nome: r.data.pessoa.nome, email: r.data.pessoa.email, senha: r.data.senhaProvisoria, exige2fa });
      setNome(''); setEmail(''); setPapel('SUPORTE'); setExige2fa(true); setCampos([]);
    } catch (err) {
      setCampos(err.response?.data?.campos || []);
      toast.error(erroDaApi(err, 'Não foi possível criar o acesso.'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={fechar} title="Convidar pessoa para a equipe" size="sm">
      <form onSubmit={salvar} className="space-y-4">
        <Input label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} required
          error={campos.includes('nome') ? 'Informe o nome.' : undefined} />
        <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} required
          error={campos.includes('email') ? 'E-mail inválido ou já em uso.' : undefined} />
        <Select label="Papel" placeholder="" options={OPCOES_PAPEL} value={papel} onChange={(e) => setPapel(e.target.value)}
          error={campos.includes('papel') ? 'Escolha o papel.' : undefined} />
        <div className="flex items-center justify-between gap-3 min-h-11">
          <span className="text-sm text-[var(--text-main)]">Exigir código em 2 etapas</span>
          <Switch checked={exige2fa} onChange={setExige2fa} ariaLabel="Exigir código em 2 etapas" />
        </div>
        <p className="text-xs text-[var(--text-muted)]">A pessoa recebe uma senha provisória (mostrada uma vez) e troca no primeiro acesso.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="min-h-11" onClick={fechar} disabled={enviando}>Voltar</Button>
          <Button type="submit" className="min-h-11" loading={enviando}>Criar acesso</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------
function Auditoria() {
  const [filtros, setFiltros] = useState({ acao: '', usuarioId: '', de: '', ate: '', busca: '' });
  const [buscaDigitada, setBuscaDigitada] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState(null);
  const [opcoes, setOpcoes] = useState({ acoes: [], pessoas: [] });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null);

  const carregar = useCallback(() => {
    const params = { pagina, porPagina: 25 };
    Object.entries(filtros).forEach(([k, v]) => { if (v) params[k] = v; });
    return api.get('/admin/equipe/auditoria', { params })
      .then((r) => { setDados(r.data); setErro(''); })
      .catch((e) => setErro(erroDaApi(e, 'Não foi possível carregar a auditoria.')))
      .finally(() => setCarregando(false));
  }, [filtros, pagina]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    api.get('/admin/equipe/auditoria/filtros').then((r) => setOpcoes({ acoes: r.data?.acoes || [], pessoas: r.data?.pessoas || [] })).catch(() => {});
  }, []);

  const mudar = (campo, valor) => { setCarregando(true); setPagina(1); setFiltros((f) => ({ ...f, [campo]: valor })); };
  const itens = dados?.itens || [];

  return (
    <section aria-labelledby="eq-auditoria" className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="eq-auditoria" className="text-base font-semibold text-[var(--text-main)]">Auditoria</h2>
          <p className="text-sm text-[var(--text-muted)]">Tudo que alguém da equipe faz fica aqui. Não dá pra apagar.</p>
        </div>
        <Button variant="secondary" className="min-h-11" icon={RefreshCw} loading={carregando} onClick={() => { setCarregando(true); carregar(); }}>Atualizar</Button>
      </div>

      <form
        className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5"
        onSubmit={(e) => { e.preventDefault(); mudar('busca', buscaDigitada.trim()); }}
      >
        <Select label="Ação" placeholder="" value={filtros.acao} onChange={(e) => mudar('acao', e.target.value)}
          options={[{ value: '', label: 'Todas' }, ...opcoes.acoes.map((a) => ({ value: a, label: rotuloAcao(a) }))]} />
        <Select label="Pessoa" placeholder="" value={filtros.usuarioId} onChange={(e) => mudar('usuarioId', e.target.value)}
          options={[{ value: '', label: 'Todas' }, ...opcoes.pessoas.map((p) => ({ value: p.id, label: p.nome }))]} />
        <Input label="De" type="date" value={filtros.de} onChange={(e) => mudar('de', e.target.value)} />
        <Input label="Até" type="date" value={filtros.ate} onChange={(e) => mudar('ate', e.target.value)} />
        <Input label="Buscar" placeholder="Nome, ação ou id" value={buscaDigitada}
          onChange={(e) => setBuscaDigitada(e.target.value)}
          onBlur={() => mudar('busca', buscaDigitada.trim())} />
      </form>

      {erro ? (
        <ErroCarregar texto={erro} onTentar={carregar} />
      ) : carregando && !dados ? (
        <Carregando linhas={5} />
      ) : itens.length === 0 ? (
        <EmptyState icon={ScrollText} title="Nada registrado" description="Mude os filtros ou espere a próxima ação da equipe." />
      ) : (
        <ul className="divide-y divide-[var(--border-main)] border border-[var(--border-main)] rounded-xl">
          {itens.map((i) => {
            const detalhes = resumoDetalhes(i.detalhes);
            const expandido = aberto === i.id;
            return (
              <li key={i.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <span className="text-xs text-[var(--text-muted)] tabular-nums w-28 flex-shrink-0 pt-0.5">{dataHora(i.criadoEm)}</span>
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm text-[var(--text-main)]">
                      <strong>{i.usuarioNome}</strong> · {rotuloAcao(i.acao)}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Alvo: {alvo(i)}{i.ip ? ` · IP ${i.ip}` : ''}
                    </p>
                  </div>
                  {detalhes && (
                    <Button variant="ghost" size="sm" className="min-h-11" aria-expanded={expandido}
                      onClick={() => setAberto(expandido ? null : i.id)}>
                      {expandido ? 'Esconder' : 'Detalhes'}
                    </Button>
                  )}
                </div>
                {expandido && detalhes && (
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-[var(--bg-subtle)] p-3 text-xs text-[var(--text-secondary)] whitespace-pre-wrap break-words">{detalhes}</pre>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dados && dados.paginas > 1 && (
        <nav aria-label="Páginas da auditoria" className="flex items-center justify-between gap-2">
          <Button variant="secondary" className="min-h-11" disabled={pagina <= 1 || carregando} onClick={() => { setCarregando(true); setPagina((p) => p - 1); }}>Anterior</Button>
          <span className="text-sm text-[var(--text-secondary)]">Página {dados.pagina} de {dados.paginas} · {dados.total} registro(s)</span>
          <Button variant="secondary" className="min-h-11" disabled={pagina >= dados.paginas || carregando} onClick={() => { setCarregando(true); setPagina((p) => p + 1); }}>Próxima</Button>
        </nav>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------
export default function AdminEquipePage() {
  const toast = useToast();
  const { pode } = usePapelAdmin();
  const permitido = pode('equipe.gerenciar');
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [novaAberta, setNovaAberta] = useState(false);
  const [senha, setSenha] = useState(null);
  const [confirmacao, setConfirmacao] = useState(null);
  const [reativarPapel, setReativarPapel] = useState({});
  const [ocupado, setOcupado] = useState(null);

  const carregar = useCallback(() => {
    return api.get('/admin/equipe')
      .then((r) => { setDados(r.data); setErro(''); })
      .catch((e) => setErro(erroDaApi(e, 'Não foi possível carregar a equipe.')))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => { if (permitido) carregar(); }, [carregar, permitido]);

  if (!permitido) return <SemPermissao />;

  const executar = async (id, fn, sucesso, falha) => {
    setOcupado(id);
    try {
      const r = await fn();
      if (sucesso) toast.success(sucesso);
      await carregar();
      return r;
    } catch (e) {
      toast.error(erroDaApi(e, falha));
      return false;
    } finally {
      setOcupado(null);
    }
  };

  const pessoas = dados?.pessoas || [];
  const matriz = dados?.matriz || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Equipe e auditoria</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Quem da Sellergy acessa o painel e o que fez.</p>
        </div>
        <Button className="min-h-11" icon={UserPlus} onClick={() => setNovaAberta(true)}>Convidar pessoa</Button>
      </div>

      {erro && <ErroCarregar texto={erro} onTentar={carregar} />}

      <div className="grid gap-4 grid-cols-1 xl:grid-cols-5">
        <section aria-labelledby="eq-pessoas" className="xl:col-span-3 rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 space-y-3">
          <h2 id="eq-pessoas" className="text-base font-semibold text-[var(--text-main)]">Equipe Sellergy</h2>
          {dados?.admin2faObrigatorioGeral && (
            <p className="text-sm text-[var(--text-secondary)] rounded-lg bg-[var(--bg-subtle)] px-3 py-2">
              O código em 2 etapas está exigido para todo mundo pelo servidor (ADMIN_2FA_OBRIGATORIO).
            </p>
          )}
          {carregando && !dados ? (
            <Carregando linhas={3} />
          ) : pessoas.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Ninguém na equipe" description="Convide a primeira pessoa." />
          ) : (
            <ul className="divide-y divide-[var(--border-main)] border border-[var(--border-main)] rounded-xl">
              {pessoas.map((p) => (
                <li key={p.id} className="p-3 space-y-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="flex-1 min-w-[180px]">
                      <p className="text-sm font-semibold text-[var(--text-main)]">
                        {p.nome}{p.euMesmo && <span className="font-normal text-[var(--text-muted)]"> (você)</span>}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] break-all">{p.email}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {p.ultimaAcao ? `Última ação registrada: ${dataHora(p.ultimaAcao)}` : 'Nenhuma ação registrada'}
                        {p.deveTrocarSenha ? ' · ainda não trocou a senha provisória' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge size="sm" variant={VARIANTE_PAPEL[p.papel] || 'neutral'}>{NOME_PAPEL[p.papel] || p.papel}</Badge>
                      <Badge size="sm" variant={p.totpAtivo ? 'success' : 'warning'} icon={p.totpAtivo ? ShieldCheck : ShieldOff}>
                        {p.totpAtivo ? '2 etapas ativo' : 'Sem 2 etapas'}
                      </Badge>
                    </div>
                  </div>

                  {p.ativo ? (
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                      <div className="sm:w-48">
                        <Select
                          label="Papel"
                          placeholder=""
                          options={OPCOES_PAPEL}
                          value={p.papel}
                          disabled={p.euMesmo || ocupado === p.id}
                          aria-label={`Papel de ${p.nome}`}
                          onChange={(e) => {
                            const novo = e.target.value;
                            setConfirmacao({
                              titulo: 'Trocar o papel?',
                              texto: `${p.nome} passa de ${NOME_PAPEL[p.papel]} para ${NOME_PAPEL[novo]}. Vale na hora, inclusive na sessão aberta.`,
                              rotulo: 'Trocar papel', variante: 'primary',
                              acao: () => executar(p.id, () => api.put(`/admin/equipe/${p.id}`, { papel: novo }), 'Papel atualizado.', 'Não foi possível trocar o papel.'),
                            });
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2 min-h-11">
                        <Switch
                          checked={p.exige2fa}
                          disabled={ocupado === p.id}
                          ariaLabel={`Exigir código em 2 etapas de ${p.nome}`}
                          onChange={(v) => executar(p.id, () => api.put(`/admin/equipe/${p.id}`, { exige2fa: v }), v ? '2 etapas exigido.' : '2 etapas não é mais exigido.', 'Não foi possível salvar.')}
                        />
                        <span className="text-sm text-[var(--text-secondary)]">Exigir 2 etapas</span>
                      </div>
                      {!p.euMesmo && (
                        <div className="flex flex-wrap gap-2 sm:ml-auto">
                          <Button variant="secondary" className="min-h-11" icon={KeyRound}
                            onClick={() => setConfirmacao({
                              titulo: 'Gerar senha provisória?',
                              texto: `A senha atual de ${p.nome} deixa de valer. A nova aparece uma vez só e precisa ser trocada no primeiro acesso.`,
                              rotulo: 'Gerar senha', variante: 'primary',
                              acao: async () => {
                                const r = await executar(p.id, () => api.post(`/admin/equipe/${p.id}/nova-senha`), null, 'Não foi possível gerar a senha.');
                                if (r?.data?.senhaProvisoria) setSenha({ nome: p.nome, email: p.email, senha: r.data.senhaProvisoria, exige2fa: p.exige2fa });
                                return Boolean(r);
                              },
                            })}>
                            Nova senha
                          </Button>
                          <Button variant="danger-soft" className="min-h-11" icon={UserX}
                            onClick={() => setConfirmacao({
                              titulo: 'Desativar o acesso?',
                              texto: `${p.nome} não entra mais no painel e a sessão aberta para na próxima ação. Dá pra reativar depois.`,
                              rotulo: 'Desativar', variante: 'danger',
                              acao: () => executar(p.id, () => api.post(`/admin/equipe/${p.id}/desativar`), 'Acesso desativado.', 'Não foi possível desativar.'),
                            })}>
                            Desativar
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                      <div className="sm:w-48">
                        <Select label="Reativar como" placeholder="" options={OPCOES_PAPEL}
                          value={reativarPapel[p.id] || 'SUPORTE'}
                          onChange={(e) => setReativarPapel((m) => ({ ...m, [p.id]: e.target.value }))} />
                      </div>
                      <Button variant="secondary" className="min-h-11" icon={PlayCircle} loading={ocupado === p.id}
                        onClick={() => executar(p.id, () => api.post(`/admin/equipe/${p.id}/reativar`, { papel: reativarPapel[p.id] || 'SUPORTE' }), 'Acesso reativado.', 'Não foi possível reativar.')}>
                        Reativar
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="eq-matriz" className="xl:col-span-2 rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5">
          <h2 id="eq-matriz" className="text-base font-semibold text-[var(--text-main)]">O que cada papel faz</h2>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <caption className="sr-only">Permissões por papel</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  <th scope="col" className="py-2 pr-2 font-semibold"><span className="sr-only">Permissão</span></th>
                  {['DONO', 'SUPORTE', 'FINANCEIRO'].map((p) => <th key={p} scope="col" className="py-2 px-2 font-semibold text-center">{NOME_PAPEL[p]}</th>)}
                </tr>
              </thead>
              <tbody>
                {LINHAS_MATRIZ.map((l) => (
                  <tr key={l.acao} className="border-t border-[var(--border-main)]">
                    <th scope="row" className="py-2 pr-2 text-left font-normal text-[var(--text-main)]">{l.rotulo}</th>
                    {['DONO', 'SUPORTE', 'FINANCEIRO'].map((p) => {
                      const sim = (matriz[l.acao] || []).includes(p);
                      return (
                        <td key={p} className="py-2 px-2 text-center">
                          <span aria-hidden="true" className={sim ? 'text-[var(--success)] font-semibold' : 'text-[var(--text-muted)]'}>{sim ? '✓' : '—'}</span>
                          <span className="sr-only">{sim ? 'Pode' : 'Não pode'}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Auditoria />

      <ModalNovaPessoa
        isOpen={novaAberta}
        onFechar={() => setNovaAberta(false)}
        onCriado={(s) => { setNovaAberta(false); setSenha(s); carregar(); }}
      />
      <ModalSenha dados={senha} onFechar={() => setSenha(null)} />
      <ConfirmarAcao
        isOpen={Boolean(confirmacao)}
        onClose={() => setConfirmacao(null)}
        titulo={confirmacao?.titulo}
        rotuloConfirmar={confirmacao?.rotulo}
        variante={confirmacao?.variante}
        onConfirmar={() => confirmacao?.acao()}
      >
        <p>{confirmacao?.texto}</p>
      </ConfirmarAcao>
    </div>
  );
}
