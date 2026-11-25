// Formulario do servico (Catalogo). Usado em 2 lugares:
// - ModalServico: "Novo serviço" e "Editar" pelo menu da linha (modal grande);
// - EditorServico (coluna da direita da tela): edita o servico selecionado,
//   em modo `compacto` (campos menores, visibilidade vira o interruptor
//   "Aparece no link de agendamento" e o rodape tem Excluir/Arquivar/Salvar).
//
// Primeiro uso: conta nova pode nao ter categoria nem profissional. O proprio
// formulario oferece criar a categoria ali e o "Eu mesmo atendo". Erros
// aparecem no campo (nada de alert() do navegador).
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Plus, UserCheck } from 'lucide-react';
import {
  Button, IconButton, Input, Textarea, Select, Switch,
  UploadImagem, InputDuracao, LabelAjuda,
} from '../ui';
import Modal from '../Modal';
import catalogoService from '../../services/catalogoService';
import { VISIBILIDADES } from './constantes';


function formInicialProduto(produto) {
  if (produto) {
    // Em edicao puxa duracao da 1a variacao "Padrao" se existir.
    const variacaoPadrao = produto.variacoes?.[0];
    return {
      ...produto,
      descricao: produto.descricao || '',
      categoriaId: produto.categoriaId || '',
      imagemUrl: produto.imagemUrl || '',
      duracaoMin: variacaoPadrao?.duracaoMin ?? '',
      especialistasIds: (produto.especialistas || []).map((e) => e.id),
      sinalPercentual: produto.sinalPercentual ?? '',
      sinalAlterado: false,
    };
  }
  // Default SERVICO porque Catalogo so cadastra servicos.
  return {
    nome: '', descricao: '', tipo: 'SERVICO', visibilidade: 'ATIVO',
    categoriaId: '', imagemUrl: '', duracaoMin: '', preco: '', especialistasIds: [],
    sinalPercentual: '', sinalAlterado: false,
  };
}

// Erro da API ({ erro, campos }) -> { campo: mensagem }. Sem campo -> _geral.
function errosDaApi(e) {
  const d = e?.response?.data || {};
  const msg = d.erro || d.error || 'Não foi possível salvar. Tente de novo.';
  const campos = Array.isArray(d.campos) && d.campos.length ? d.campos : ['_geral'];
  return Object.fromEntries(campos.map((c) => [c, msg]));
}

const PRECO_VALIDO = /^\d{1,7}([.,]\d{1,2})?$/;

export default function FormServico({
  produto, categorias = [], especialistas = [], onSalvar, onCancelar, onExcluir, compacto = false, onAlterou, temps,
  onCriarCategoria, onEuAtendo,
}) {
  const [form, setFormBruto] = useState(() => formInicialProduto(produto));
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [novaCategoria, setNovaCategoria] = useState('');
  const [criandoCategoria, setCriandoCategoria] = useState(false);
  const [abrirNovaCategoria, setAbrirNovaCategoria] = useState(false);
  const [criandoEu, setCriandoEu] = useState(false);
  const semCategoria = categorias.length === 0;

  // Avisa o pai que ha alteracao nao salva (selo "Sem alterações salvas").
  const setForm = (valor) => {
    setFormBruto(valor);
    setErros((e) => (Object.keys(e).length ? {} : e));
    onAlterou?.();
  };
  // Imagens temp (modo criacao) sao avisadas ao modal (ModalServico), que
  // limpa as orfas ao fechar sem salvar (X ou Cancelar). Em edicao o upload
  // e direto no produto existente.
  const tam = compacto ? 'md' : 'lg';

  const toggleEspecialista = (id) => setForm((f) => ({
    ...f,
    especialistasIds: f.especialistasIds.includes(id)
      ? f.especialistasIds.filter((x) => x !== id)
      : [...f.especialistasIds, id],
  }));

  const criarCategoria = async () => {
    const nome = novaCategoria.trim();
    if (nome.length < 2) { setErros({ novaCategoria: 'Digite o nome da categoria (ex.: Serviços).' }); return; }
    setCriandoCategoria(true);
    try {
      const cat = await onCriarCategoria(nome);
      setNovaCategoria('');
      setAbrirNovaCategoria(false);
      if (cat?.id) setForm((f) => ({ ...f, categoriaId: cat.id }));
    } catch (e) {
      const d = e?.response?.data || {};
      setErros({ novaCategoria: d.erro || d.error || 'Não foi possível criar a categoria.' });
    } finally {
      setCriandoCategoria(false);
    }
  };

  const euAtendo = async () => {
    setCriandoEu(true);
    try {
      const esp = await onEuAtendo();
      if (esp?.id) setForm((f) => ({ ...f, especialistasIds: [...new Set([...(f.especialistasIds || []), esp.id])] }));
    } catch (e) {
      const d = e?.response?.data || {};
      setErros({ especialistasIds: d.erro || d.error || 'Não foi possível cadastrar você como profissional.' });
    } finally {
      setCriandoEu(false);
    }
  };

  // Erro de upload sobe pro componente UploadImagem, que mostra a mensagem.
  const handleUpload = async (file) => {
    let url;
    if (produto) {
      // Edicao: upload direto no produto existente
      url = await catalogoService.uploadImagemProduto(produto.id, file);
    } else {
      // Criacao: upload temp; URL vai no body do submit
      url = await catalogoService.uploadImagemTemp(file);
      temps?.adicionar(url);
    }
    setForm((prev) => ({ ...prev, imagemUrl: url }));
  };

  const handleRemoverImagem = async () => {
    if (produto) {
      // Edicao: remove no backend
      await catalogoService.removerImagemProduto(produto.id);
    } else if (form.imagemUrl) {
      // Criacao: a URL atual e temp; remove no backend
      await catalogoService.removerImagemTemp(form.imagemUrl);
      temps?.remover(form.imagemUrl);
    }
    setForm((prev) => ({ ...prev, imagemUrl: '' }));
  };

  const enviar = async (extra = {}) => {
    if (salvando) return;
    const precoTexto = String(form.preco ?? '').trim();
    const novos = {};
    if (!String(form.nome || '').trim()) novos.nome = 'Informe o nome do serviço.';
    if (!form.categoriaId) novos.categoriaId = semCategoria ? 'Crie a primeira categoria aqui embaixo.' : 'Escolha a categoria.';
    if (!form.especialistasIds || form.especialistasIds.length === 0) novos.especialistasIds = 'Escolha quem atende este serviço.';
    if (!produto && precoTexto && !PRECO_VALIDO.test(precoTexto)) novos.preco = 'Preço inválido. Ex.: 45,90';
    if (Object.keys(novos).length) { setErros(novos); return; }

    // Catalogo cadastra SO servicos. Forcar tipo=SERVICO no payload pra
    // blindar contra qualquer estado inesperado.
    const duracao = form.duracaoMin === '' || form.duracaoMin == null
      ? null
      : (parseInt(form.duracaoMin, 10) || null);
    const { preco: _preco, ...resto } = form;
    setSalvando(true);
    try {
      await onSalvar({
        ...resto,
        ...extra,
        // Preco so no cadastro novo: o backend cria a variacao "Padrão" com ele.
        ...(!produto && precoTexto ? { preco: precoTexto } : {}),
        tipo: 'SERVICO',
        imagemUrl: form.imagemUrl || null,
        duracaoMin: duracao,
      });
      temps?.limpar();
    } catch (e) {
      setErros(errosDaApi(e));
    } finally {
      setSalvando(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    enviar();
  };

  const idBase = produto?.id || 'novo';
  const noLink = form.visibilidade === 'ATIVO';
  const erroGeral = erros._geral || erros.duracaoMin || erros.descricao || erros.visibilidade || erros.imagemUrl;

  return (
    <form onSubmit={handleSubmit} className={compacto ? 'space-y-3.5' : 'space-y-4'} noValidate>
      <div className={compacto ? 'flex items-start gap-3' : 'flex items-start gap-4'}>
        <UploadImagem
          imagemUrl={form.imagemUrl || null}
          onUpload={handleUpload}
          onRemover={handleRemoverImagem}
          tamanho={compacto ? 'sm' : 'md'}
        />
        <div className={compacto ? 'flex-1 space-y-3 min-w-0' : 'flex-1 space-y-4 min-w-0'}>
          <Input
            size={tam}
            label={<LabelAjuda texto="Nome do serviço" ajuda="Ex.: Corte de cabelo, Consulta nutricional." />}
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            maxLength={120}
            error={erros.nome}
            required
            autoFocus={!compacto}
          />
          {!compacto && (
            <Textarea
              size={tam}
              label={<LabelAjuda texto="Descrição" ajuda="O que está incluído no atendimento." />}
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              maxLength={2000}
              rows={3}
            />
          )}
        </div>
      </div>

      {compacto && (
        <Textarea
          label={<LabelAjuda texto="Descrição" ajuda="O que está incluído no atendimento." />}
          value={form.descricao}
          onChange={(e) => setForm({ ...form, descricao: e.target.value })}
          maxLength={2000}
          rows={2}
        />
      )}

      {/* Sem seletor de Tipo: Catalogo cadastra so servicos.
          Produtos fisicos sao cadastrados no Estoque. */}
      <div className={compacto ? 'space-y-3.5' : 'grid grid-cols-1 md:grid-cols-2 gap-4'}>
        {!compacto && (
          <Select
            size={tam}
            label="Visibilidade"
            value={form.visibilidade}
            onChange={(e) => setForm({ ...form, visibilidade: e.target.value })}
            options={VISIBILIDADES}
            placeholder=""
          />
        )}
        <div className="min-w-0">
          {!semCategoria && (
            <Select
              size={tam}
              label={<LabelAjuda texto="Categoria" ajuda="Agrupa as vendas deste serviço nos relatórios." />}
              value={form.categoriaId}
              onChange={(e) => setForm({ ...form, categoriaId: e.target.value })}
              placeholder="Selecione..."
              options={categorias.map((c) => ({ value: c.id, label: c.nome }))}
              error={erros.categoriaId}
            />
          )}
          {onCriarCategoria && (semCategoria || abrirNovaCategoria) && (
            <div className={semCategoria ? '' : 'mt-2'}>
              <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                  <Input
                    size={tam}
                    label={semCategoria ? 'Categoria (crie a primeira)' : 'Nova categoria'}
                    placeholder="Ex.: Serviços, Cabelo, Estética"
                    value={novaCategoria}
                    maxLength={60}
                    onChange={(e) => { setNovaCategoria(e.target.value); setErros({}); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); criarCategoria(); } }}
                    error={erros.novaCategoria || (semCategoria ? erros.categoriaId : undefined)}
                  />
                </div>
                <Button type="button" variant="secondary" icon={Plus} onClick={criarCategoria} loading={criandoCategoria}>
                  Criar
                </Button>
              </div>
            </div>
          )}
          {onCriarCategoria && !semCategoria && !abrirNovaCategoria && (
            <button
              type="button"
              onClick={() => setAbrirNovaCategoria(true)}
              className="mt-1.5 p-0 bg-transparent border-0 text-xs font-semibold text-[var(--primary)] hover:underline cursor-pointer"
            >
              + Nova categoria
            </button>
          )}
        </div>
      </div>

      {/* Preco no cadastro novo: vira a variacao "Padrão". Na edicao o preco
          fica em "Preço e variações" (cada variacao tem o seu). */}
      {!produto && (
        <Input
          size={tam}
          label={<LabelAjuda texto="Preço (R$)" ajuda="O valor que o cliente paga. Depois dá pra criar variações com outros preços." />}
          inputMode="decimal"
          placeholder="Ex.: 45,90"
          value={form.preco ?? ''}
          onChange={(e) => setForm({ ...form, preco: e.target.value.replace(/[^\d.,]/g, '') })}
          error={erros.preco}
        />
      )}

      {/* Duracao sempre visivel — Catalogo so trata servicos.
          Persiste na variacao Padrao via backend. */}
      <InputDuracao
        size={tam}
        label={<LabelAjuda texto={compacto ? 'Duração' : 'Quanto tempo leva o atendimento?'} ajuda="A Agenda usa isso pra não marcar 2 clientes no mesmo horário." />}
        value={form.duracaoMin}
        onChange={(min) => setForm({ ...form, duracaoMin: min })}
      />

      {/* Sinal por Pix ao agendar (fase 2). Vazio = segue o padrao do negocio. */}
      <div className={compacto ? '' : 'border border-[var(--border-main)] rounded-xl p-4 space-y-2'}>
        <Input
          size={tam}
          label="Sinal ao agendar (% do preço)"
          type="number" min={0} max={100} step={1}
          placeholder="Padrão do negócio"
          value={form.sinalPercentual ?? ''}
          onChange={(e) => setForm({ ...form, sinalPercentual: e.target.value, sinalAlterado: true })}
          hint="Vazio = usa o padrão de Configurações › Operação. 0 = este serviço não cobra sinal. Só cobra se o recebimento por Pix estiver configurado em Pagamentos."
        />
      </div>

      {/* Quem atende — obrigatório. A agenda usa este vínculo pra reservar o
          horário do profissional escolhido. */}
      <div>
        <div id={`quem-faz-${idBase}`} className={compacto ? 'text-xs font-semibold text-[var(--text-secondary)] mb-1.5' : 'block text-sm font-medium text-[var(--text-secondary)] mb-2'}>
          {compacto ? 'Quem faz' : 'Quem atende este serviço'}
        </div>
        {especialistas.length === 0 ? (
          <div className="text-[13px] text-[var(--text-muted)] bg-[var(--bg-subtle)] rounded-lg p-3 leading-relaxed space-y-2">
            <p className="m-0">
              Ainda não tem ninguém cadastrado pra atender. Se é você quem faz o serviço, é só um clique.
              Pra cadastrar outras pessoas, vá em <Link to="/app/usuarios" className="font-semibold underline">Equipe</Link>.
            </p>
            {onEuAtendo && (
              <Button type="button" variant="secondary" size="sm" icon={UserCheck} onClick={euAtendo} loading={criandoEu}>
                Eu mesmo atendo
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`quem-faz-${idBase}`}>
              {especialistas.map((esp) => {
                const sel = form.especialistasIds.includes(esp.id);
                return (
                  <button
                    type="button"
                    key={esp.id}
                    aria-pressed={sel}
                    onClick={() => toggleEspecialista(esp.id)}
                    className={`h-8 px-3 rounded-full border text-xs font-semibold transition-colors ${
                      sel
                        ? 'border-[var(--text-main)] bg-[var(--text-main)] text-[var(--bg-card)]'
                        : 'border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                    }`}
                  >
                    {esp.nome}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
              Selecione um ou mais. Na agenda você escolhe qual deles vai atender.
            </p>
          </>
        )}
        {erros.especialistasIds && (
          <p className="text-xs mt-1.5 font-medium text-[var(--danger)]" role="alert">{erros.especialistasIds}</p>
        )}
      </div>

      {compacto && (
        <div className="flex items-center gap-3 py-3 border-y border-[var(--border-subtle)]">
          <div className="flex-1 min-w-0">
            <div id={`link-${idBase}`} className="text-[13px] font-semibold text-[var(--text-main)]">Aparece no link de agendamento</div>
            <div className="text-xs text-[var(--text-muted)]">
              {form.visibilidade === 'ARQUIVADO'
                ? 'Arquivado: fora do link e da agenda.'
                : 'Cliente marca sozinha pelo link. Desligado = pausado.'}
            </div>
          </div>
          <Switch
            checked={noLink}
            ariaLabel="Aparece no link de agendamento"
            onChange={(v) => setForm({ ...form, visibilidade: v ? 'ATIVO' : 'PAUSADO' })}
          />
        </div>
      )}

      {erroGeral && (
        <p className="m-0 text-[13px] font-medium text-[var(--danger)]" role="alert">{erroGeral}</p>
      )}

      {compacto ? (
        <div className="flex items-center gap-2 pt-1">
          {onExcluir && (
            <IconButton icon={Trash2} variant="ghost" size="sm" ariaLabel="Excluir serviço" onClick={onExcluir} />
          )}
          {form.visibilidade !== 'ARQUIVADO' && (
            <Button variant="secondary" size="sm" type="button" onClick={() => enviar({ visibilidade: 'ARQUIVADO' })} disabled={salvando}>Arquivar</Button>
          )}
          <span className="flex-1" />
          <Button variant="primary" size="sm" type="submit" loading={salvando}>Salvar</Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onCancelar} type="button">Cancelar</Button>
          <Button variant="primary" type="submit" loading={salvando}>{produto ? 'Salvar' : 'Criar serviço'}</Button>
        </div>
      )}
    </form>
  );
}

// Modal de cadastro/edicao. Abre sempre com estado novo (o form remonta a
// cada abertura pela `key`). Fechar pelo X tambem limpa as imagens temp.
export function ModalServico({ isOpen, onClose, produto, categorias, especialistas, onSalvar, onCriarCategoria, onEuAtendo }) {
  if (!isOpen) return null;
  return (
    <ModalServicoConteudo
      key={produto?.id || 'novo'}
      onClose={onClose}
      produto={produto}
      categorias={categorias}
      especialistas={especialistas}
      onSalvar={onSalvar}
      onCriarCategoria={onCriarCategoria}
      onEuAtendo={onEuAtendo}
    />
  );
}

function ModalServicoConteudo({ onClose, produto, categorias, especialistas, onSalvar, onCriarCategoria, onEuAtendo }) {
  // Imagens temp subidas no modo criacao; fechar sem salvar (X ou Cancelar)
  // remove as orfas (best-effort). Em edicao o upload e direto no produto.
  const temps = useRef([]);
  const fechar = () => {
    if (!produto) {
      for (const url of temps.current) {
        catalogoService.removerImagemTemp(url);
      }
    }
    onClose();
  };
  const controleTemps = {
    adicionar: (url) => { temps.current = [...temps.current, url]; },
    remover: (url) => { temps.current = temps.current.filter((u) => u !== url); },
    limpar: () => { temps.current = []; },
  };

  return (
    <Modal
      isOpen
      onClose={fechar}
      title={produto ? 'Editar serviço' : 'Novo serviço'}
      description={produto ? null : 'Cadastre o serviço com nome, foto, preço e duração.'}
      size="2xl"
    >
      <FormServico
        produto={produto}
        categorias={categorias}
        especialistas={especialistas}
        onSalvar={onSalvar}
        onCancelar={fechar}
        temps={controleTemps}
        onCriarCategoria={onCriarCategoria}
        onEuAtendo={onEuAtendo}
      />
    </Modal>
  );
}
