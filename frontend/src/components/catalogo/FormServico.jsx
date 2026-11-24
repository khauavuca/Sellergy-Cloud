// Formulario do servico (Catalogo). Usado em 2 lugares:
// - ModalServico: "Novo serviço" e "Editar" pelo menu da linha (modal grande);
// - EditorServico (coluna da direita da tela): edita o servico selecionado,
//   em modo `compacto` (campos menores, visibilidade vira o interruptor
//   "Aparece no link de agendamento" e o rodape tem Excluir/Arquivar/Salvar).
import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
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
    categoriaId: '', imagemUrl: '', duracaoMin: '', especialistasIds: [],
    sinalPercentual: '', sinalAlterado: false,
  };
}

export default function FormServico({
  produto, categorias = [], especialistas = [], onSalvar, onCancelar, onExcluir, compacto = false, onAlterou, temps,
}) {
  const [form, setFormBruto] = useState(() => formInicialProduto(produto));
  // Avisa o pai que ha alteracao nao salva (selo "Sem alterações salvas").
  const setForm = (valor) => {
    setFormBruto(valor);
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

  const enviar = (extra = {}) => {
    if (!form.categoriaId) {
      alert('Selecione uma categoria financeira (necessária para CMV/relatórios).');
      return;
    }
    if (!form.especialistasIds || form.especialistasIds.length === 0) {
      alert('Selecione ao menos um especialista que atende este serviço.');
      return;
    }
    // Catalogo cadastra SO servicos. Forcar tipo=SERVICO no payload pra
    // blindar contra qualquer estado inesperado.
    const duracao = form.duracaoMin === '' || form.duracaoMin == null
      ? null
      : (parseInt(form.duracaoMin, 10) || null);
    onSalvar({
      ...form,
      ...extra,
      tipo: 'SERVICO',
      imagemUrl: form.imagemUrl || null,
      duracaoMin: duracao,
    });
    temps?.limpar();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    enviar();
  };

  const idBase = produto?.id || 'novo';
  const noLink = form.visibilidade === 'ATIVO';

  return (
    <form onSubmit={handleSubmit} className={compacto ? 'space-y-3.5' : 'space-y-4'}>
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
            required
            autoFocus={!compacto}
          />
          {!compacto && (
            <Textarea
              size={tam}
              label={<LabelAjuda texto="Descrição" ajuda="O que está incluído no atendimento." />}
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
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
        <Select
          size={tam}
          label={<LabelAjuda texto="Categoria financeira" ajuda="Necessária para vincular vendas e CMV." />}
          value={form.categoriaId}
          onChange={(e) => setForm({ ...form, categoriaId: e.target.value })}
          placeholder="Selecione..."
          options={categorias.map((c) => ({ value: c.id, label: c.nome }))}
        />
      </div>

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

      {/* Especialistas que atendem — obrigatório. A agenda usa este vínculo
          pra reservar o horário do profissional escolhido. */}
      <div>
        <div id={`quem-faz-${idBase}`} className={compacto ? 'text-xs font-semibold text-[var(--text-secondary)] mb-1.5' : 'block text-sm font-medium text-[var(--text-secondary)] mb-2'}>
          {compacto ? 'Quem faz' : 'Especialistas que atendem este serviço'}
        </div>
        {especialistas.length === 0 ? (
          <div className="text-[13px] text-[var(--text-muted)] bg-[var(--bg-subtle)] rounded-lg p-3 leading-relaxed">
            Cadastre um especialista antes (na tela <strong>Especialistas</strong>). O serviço precisa de pelo menos um profissional que o execute.
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

      {compacto ? (
        <div className="flex items-center gap-2 pt-1">
          {onExcluir && (
            <IconButton icon={Trash2} variant="ghost" size="sm" ariaLabel="Excluir serviço" onClick={onExcluir} />
          )}
          {form.visibilidade !== 'ARQUIVADO' && (
            <Button variant="secondary" size="sm" type="button" onClick={() => enviar({ visibilidade: 'ARQUIVADO' })}>Arquivar</Button>
          )}
          <span className="flex-1" />
          <Button variant="primary" size="sm" type="submit">Salvar</Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onCancelar} type="button">Cancelar</Button>
          <Button variant="primary" type="submit">{produto ? 'Salvar' : 'Criar serviço'}</Button>
        </div>
      )}
    </form>
  );
}

// Modal de cadastro/edicao. Abre sempre com estado novo (o form remonta a
// cada abertura pela `key`). Fechar pelo X tambem limpa as imagens temp.
export function ModalServico({ isOpen, onClose, produto, categorias, especialistas, onSalvar }) {
  if (!isOpen) return null;
  return (
    <ModalServicoConteudo
      key={produto?.id || 'novo'}
      onClose={onClose}
      produto={produto}
      categorias={categorias}
      especialistas={especialistas}
      onSalvar={onSalvar}
    />
  );
}

function ModalServicoConteudo({ onClose, produto, categorias, especialistas, onSalvar }) {
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
      />
    </Modal>
  );
}
