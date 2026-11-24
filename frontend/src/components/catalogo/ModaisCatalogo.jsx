// Modais do Catalogo: categoria de servico (so o nome) e variacao do servico
// (preco, custo, duracao, foto). Usados so pela CatalogoPage.
import { useEffect, useState } from 'react';
import { Button, Input, UploadImagem, InputDuracao, LabelAjuda } from '../ui';
import Modal from '../Modal';
import catalogoService from '../../services/catalogoService';

// Modal contextual de categoria de serviço — só o nome; o uso (SERVICO) é
// automático porque estamos no módulo de Serviços.
export function ModalCategoriaServico({ isOpen, onClose, onSalvar }) {
  const [nome, setNome] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpa o campo ao abrir
    if (isOpen) setNome('');
  }, [isOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!nome.trim()) return;
    onSalvar(nome.trim());
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nova categoria de serviço" description="Vai aparecer só no cadastro de serviços." size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={<LabelAjuda texto="Nome" ajuda="Ex.: Cabelo, Estética, Consultas." />}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          autoFocus
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit">Criar</Button>
        </div>
      </form>
    </Modal>
  );
}

// Catalogo so lida com servicos — modal de variacao nao tem campos de estoque
// (nao faz sentido pra servico). Duracao sempre visivel.
// Abre sempre com estado novo: o conteudo remonta a cada abertura (key).
export function ModalVariacao(props) {
  if (!props.isOpen) return null;
  return <ModalVariacaoConteudo key={props.variacao?.id || 'nova'} {...props} />;
}

function ModalVariacaoConteudo({ isOpen, onClose, variacao, onSalvar }) {
  const [form, setForm] = useState(() => (variacao
    ? {
      nome: variacao.nome || '',
      sku: variacao.sku || '',
      preco: variacao.preco || 0,
      precoCusto: variacao.precoCusto || 0,
      duracaoMin: variacao.duracaoMin ?? '',
      imagemUrl: variacao.imagemUrl || '',
    }
    : { nome: '', sku: '', preco: 0, precoCusto: 0, duracaoMin: '', imagemUrl: '' }));
  const [tempsParaLimpar, setTempsParaLimpar] = useState([]);

  const handleClose = async () => {
    if (!variacao) {
      for (const url of tempsParaLimpar) {
        catalogoService.removerImagemTemp(url);
      }
    }
    onClose();
  };

  const handleUpload = async (file) => {
    let url;
    if (variacao) {
      url = await catalogoService.uploadImagemVariacao(variacao.id, file);
    } else {
      url = await catalogoService.uploadImagemTemp(file);
      setTempsParaLimpar((prev) => [...prev, url]);
    }
    setForm((prev) => ({ ...prev, imagemUrl: url }));
  };

  const handleRemoverImagem = async () => {
    if (variacao) {
      await catalogoService.removerImagemVariacao(variacao.id);
    } else if (form.imagemUrl) {
      await catalogoService.removerImagemTemp(form.imagemUrl);
      setTempsParaLimpar((prev) => prev.filter((u) => u !== form.imagemUrl));
    }
    setForm((prev) => ({ ...prev, imagemUrl: '' }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSalvar({
      ...form,
      preco: parseFloat(form.preco) || 0,
      precoCusto: parseFloat(form.precoCusto) || 0,
      // Catalogo so trata servicos: sem campos de estoque, sempre tem duracao.
      duracaoMin: form.duracaoMin === '' || form.duracaoMin == null
        ? null
        : (parseInt(form.duracaoMin, 10) || null),
      imagemUrl: form.imagemUrl || null,
    });
    setTempsParaLimpar([]);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={variacao ? 'Editar variação' : 'Nova variação'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-4">
          <UploadImagem
            imagemUrl={form.imagemUrl || null}
            onUpload={handleUpload}
            onRemover={handleRemoverImagem}
            tamanho="sm"
          />
          <div className="flex-1 space-y-3 min-w-0">
            <Input label={<LabelAjuda texto="Nome da variação" ajuda="Ex.: Tamanho P, Cor Azul." />} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required autoFocus />
            <Input label="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
        </div>
        <Input label={<LabelAjuda texto="Preço do serviço (R$)" ajuda="O valor que o cliente paga pelo atendimento." />} type="number" step="0.01" min="0" value={form.preco} onChange={(e) => setForm({ ...form, preco: e.target.value })} required />

        {/* Campos de estoque (atual/min/ideal/localizacao) removidos —
            Catalogo so lida com servicos, esses nao se aplicam. */}

        {/* Duracao do atendimento — sempre visivel pra servicos. */}
        <InputDuracao
          label={<LabelAjuda texto="Duração do atendimento" ajuda="Tempo médio do atendimento. Usado pela Agenda pra evitar conflito de horário." />}
          value={form.duracaoMin}
          onChange={(min) => setForm({ ...form, duracaoMin: min })}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose} type="button">Cancelar</Button>
          <Button variant="primary" type="submit">{variacao ? 'Salvar' : 'Criar variação'}</Button>
        </div>
      </form>
    </Modal>
  );
}
