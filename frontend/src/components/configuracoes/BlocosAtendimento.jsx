import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, ExternalLink, Save, AlertCircle } from 'lucide-react';
import api from '../../services/api';
import { Painel, Badge, Button, Input, Switch } from '../ui';
import { URL_SITE } from '../../utils/painel';

// Blocos da seção "Atendimento" das Configurações que leem e gravam a
// configuração da conta (GET /conta/resumo e PUT /conta/configuracoes).

/** Linha "título + descrição ........ controle" dentro de um Painel semPadding. */
export function LinhaOpcao({ titulo, descricao, children, desativada = false }) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3 border-b border-[var(--border-subtle)] last:border-b-0 ${desativada ? 'opacity-70' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-[var(--text-main)]">{titulo}</div>
        {descricao && <div className="text-[13px] text-[var(--text-muted)] mt-0.5 leading-relaxed">{descricao}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function AvisoSimples({ children }) {
  return (
    <div className="flex items-start gap-3 text-[13px] text-[var(--text-muted)]">
      <AlertCircle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Lembretes automáticos (agenda/lembretes.js no backend): liga/desliga e
// escolhe as antecedências (24 h e 2 h). O texto vem do template aprovado
// (WhatsApp oficial) ou do texto fixo (número por QR); não é editável.
// ---------------------------------------------------------------------
export function BlocoLembretes({ resumo, recarregar, podeEditar, toast }) {
  const inicial = resumo?.configuracoes?.lembrete || { ativo: true, antecedencias: ['24h', '2h'] };
  const [cfg, setCfg] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const temRecurso = !!resumo?.plano?.recursos?.lembretesWhatsapp;
  const uso = resumo?.uso;

  const salvar = async (mudanca) => {
    const anterior = cfg;
    const novo = { ...cfg, ...mudanca };
    setCfg(novo);
    setSalvando(true);
    try {
      const r = await api.put('/conta/configuracoes', { configLembrete: novo });
      if (r.data?.configLembrete) setCfg(r.data.configLembrete);
      toast.success('Lembretes atualizados.');
      recarregar();
    } catch (e) {
      setCfg(anterior);
      toast.error(e.response?.data?.erro || 'Não foi possível salvar os lembretes.');
    } finally {
      setSalvando(false);
    }
  };

  const alternarAntecedencia = (chave, ligar) => {
    const atual = cfg.antecedencias || [];
    salvar({ antecedencias: ligar ? [...new Set([...atual, chave])] : atual.filter((a) => a !== chave) });
  };

  const desabilitado = !podeEditar || salvando;

  return (
    <Painel
      titulo="Lembretes automáticos"
      subtitulo="Saem sozinhos pelo WhatsApp. A cliente confirma ou remarca pela resposta."
      acoes={uso && temRecurso ? (
        <Badge variant={uso.lembretesNoMes >= uso.lembretesLimite ? 'warning' : 'neutral'}>
          {Number(uso.lembretesNoMes || 0).toLocaleString('pt-BR')} de {Number(uso.lembretesLimite || 0).toLocaleString('pt-BR')} no mês
        </Badge>
      ) : null}
      semPadding
    >
      {!temRecurso ? (
        <div className="p-4">
          <AvisoSimples>
            Seu plano não inclui lembretes por WhatsApp.{' '}
            <Link to="/app/plano" className="font-semibold text-[var(--primary)] underline">Ver planos</Link>
          </AvisoSimples>
        </div>
      ) : (
        <>
          <LinhaOpcao titulo="Lembretes ligados" descricao="Desligue pra parar todos os lembretes de agendamento.">
            <Switch checked={!!cfg.ativo} disabled={desabilitado} onChange={(v) => salvar({ ativo: v })} ariaLabel="Lembretes ligados" />
          </LinhaOpcao>
          <LinhaOpcao titulo="24 horas antes" descricao="Com Confirmar e Remarcar. Vai pra quem marcou ou já confirmou." desativada={!cfg.ativo}>
            <Switch
              checked={(cfg.antecedencias || []).includes('24h')}
              disabled={desabilitado || !cfg.ativo}
              onChange={(v) => alternarAntecedencia('24h', v)}
              ariaLabel="Lembrete 24 horas antes"
            />
          </LinhaOpcao>
          <LinhaOpcao titulo="2 horas antes" descricao="Só pra quem ainda não confirmou." desativada={!cfg.ativo}>
            <Switch
              checked={(cfg.antecedencias || []).includes('2h')}
              disabled={desabilitado || !cfg.ativo}
              onChange={(v) => alternarAntecedencia('2h', v)}
              ariaLabel="Lembrete 2 horas antes"
            />
          </LinhaOpcao>
          {!podeEditar && (
            <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
              <AvisoSimples>Só o dono da conta ou administradores podem mudar os lembretes.</AvisoSimples>
            </div>
          )}
        </>
      )}
    </Painel>
  );
}

/** Prévia do texto do lembrete no número por QR (mesmo formato do backend). */
export function PreviaLembrete({ nomeNegocio }) {
  return (
    <Painel titulo="Como a cliente recebe" subtitulo="Exemplo no número do negócio (QR). No WhatsApp oficial vai o modelo aprovado, com botões." semPadding>
      <div className="p-4 bg-[var(--bg-subtle)] rounded-b-[10px]">
        <div className="max-w-[280px] rounded-[10px] rounded-bl-sm bg-[var(--bg-card)] border border-[var(--border-subtle)] px-3 py-2.5 text-[13px] text-[var(--text-main)] leading-relaxed whitespace-pre-line">
          {`Olá, Mariana! Passando para lembrar do seu horário na ${nomeNegocio || 'sua empresa'}:\nquarta-feira, 26/11, às 14:00 — Corte com Ana.\n\nResponda 1 para confirmar ou 2 para remarcar.\nOu toque aqui: (link de confirmação)`}
        </div>
      </div>
    </Painel>
  );
}

// ---------------------------------------------------------------------
// Link de agendamento: endereço público (/agendar/<slug>). O mesmo slug
// vale pra loja online (pedidos).
// ---------------------------------------------------------------------
export function BlocoLinkAgendamento({ resumo, recarregar, podeEditar, toast, soEndereco = false }) {
  const slugAtual = resumo?.configuracoes?.slugPublico || '';
  const [slug, setSlug] = useState(slugAtual);
  const [salvando, setSalvando] = useState(false);
  const base = `${URL_SITE}/agendar/`;
  const link = slugAtual ? `${base}${slugAtual}` : null;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado. Cole na bio do Instagram e no WhatsApp.');
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie.');
    }
  };

  const salvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const r = await api.put('/conta/configuracoes', { slugPublico: slug });
      setSlug(r.data?.slugPublico || slug);
      toast.success('Endereço salvo.');
      recarregar();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível salvar o endereço.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Painel
      titulo={soEndereco ? 'Endereço dos links' : 'Link de agendamento'}
      subtitulo={soEndereco ? 'Vale para a agenda e para o catálogo. Use o nome do negócio, sem espaço.' : 'A página onde a cliente marca sozinha. Coloque na bio do Instagram.'}
      acoes={soEndereco ? null : link ? <Badge variant="success">No ar</Badge> : <Badge variant="neutral">Sem endereço</Badge>}
    >
      <div className="flex flex-col gap-4">
        {link && !soEndereco && (
          <div className="flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-0 truncate h-10 leading-10 px-3 rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] text-[13px] text-[var(--text-main)]">
              {link}
            </code>
            <Button variant="secondary" size="sm" icon={Copy} onClick={copiar}>Copiar</Button>
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] font-semibold text-[var(--text-main)] hover:bg-[var(--bg-subtle)]"
            >
              <ExternalLink size={14} aria-hidden="true" /> Abrir
            </a>
          </div>
        )}
        {podeEditar ? (
          <form onSubmit={salvar} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Input
                label="Endereço"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="studio-bella"
                hint={`${base}${slug || '…'} · O mesmo endereço vale pra loja online. Se trocar, o link antigo para de funcionar.`}
              />
            </div>
            <Button type="submit" variant="primary" icon={Save} loading={salvando} disabled={!slug.trim() || slug === slugAtual}>
              Salvar endereço
            </Button>
          </form>
        ) : (
          <AvisoSimples>Só o dono da conta ou administradores podem trocar o endereço.</AvisoSimples>
        )}
      </div>
    </Painel>
  );
}
