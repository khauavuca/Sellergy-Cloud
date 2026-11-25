// Conteudo de uma mensagem do WhatsApp na conversa: foto, video, GIF, audio,
// voz, documento, figurinha, localizacao, contato ou texto. A midia vem pela
// API (com login), nunca direto do storage.
import { Download, FileText, MapPin, UserRound } from 'lucide-react';
import api from '../../services/api';

const urlMidia = (conversaId, mensagemId, baixar = false) =>
  `${api.defaults.baseURL}/conversas/${conversaId}/midia/${mensagemId}${baixar ? '?baixar=1' : ''}`;

function tamanho(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function duracao(s) {
  if (!s) return '';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function ConteudoMensagem({ m, conversaId }) {
  const temArquivo = Boolean(m.midiaMime);
  const url = temArquivo ? urlMidia(conversaId, m.id) : null;
  const legenda = m.texto ? <div className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{m.texto}</div> : null;
  const falhou = m.extra?.falhaDownload;

  if (falhou) {
    return <div className="text-[12px] italic text-[var(--text-muted)]">Não foi possível baixar este arquivo do WhatsApp.{legenda}</div>;
  }

  switch (m.tipo) {
    case 'IMAGEM':
      return (
        <div>
          <a href={url} target="_blank" rel="noopener noreferrer" className="block">
            <img src={url} alt={m.texto || 'Foto'} loading="lazy" className="max-h-72 max-w-full rounded-lg object-cover" />
          </a>
          {m.extra?.visualizacaoUnica && <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Visualização única</div>}
          {legenda}
        </div>
      );
    case 'FIGURINHA':
      return <img src={url} alt="Figurinha" loading="lazy" className="w-32 h-32 object-contain" />;
    case 'GIF':
      return (
        <div>
          <video src={url} autoPlay loop muted playsInline className="max-h-64 max-w-full rounded-lg" aria-label="GIF" />
          {legenda}
        </div>
      );
    case 'VIDEO':
      return (
        <div>
          <video src={url} controls preload="metadata" className="max-h-72 max-w-full rounded-lg" aria-label="Vídeo" />
          {legenda}
        </div>
      );
    case 'AUDIO':
    case 'VOZ':
      return (
        <div className="flex flex-col gap-1 min-w-[220px]">
          <span className="text-[11px] text-[var(--text-muted)]">{m.tipo === 'VOZ' ? '🎤 Mensagem de voz' : '🎵 Áudio'}{m.midiaSegundos ? ` · ${duracao(m.midiaSegundos)}` : ''}</span>
          <audio src={url} controls preload="metadata" className="w-full h-9" />
        </div>
      );
    case 'DOCUMENTO':
      return (
        <div>
          <a href={urlMidia(conversaId, m.id, true)} className="flex items-center gap-2.5 p-2 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] no-underline min-w-[200px]">
            <FileText size={22} className="text-[var(--primary)] flex-none" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-[var(--text-main)] truncate">{m.midiaNome || 'Documento'}</span>
              <span className="block text-[11px] text-[var(--text-muted)]">{tamanho(m.midiaTamanho)}</span>
            </span>
            <Download size={16} className="text-[var(--text-muted)] flex-none" aria-hidden="true" />
          </a>
          {legenda}
        </div>
      );
    case 'LOCALIZACAO': {
      const { lat, lng, nome, endereco, aoVivo } = m.extra || {};
      return (
        <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 no-underline text-[var(--text-main)]">
          <MapPin size={20} className="text-[var(--danger)] flex-none mt-0.5" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">{nome || (aoVivo ? 'Localização em tempo real' : 'Localização')}</span>
            {endereco && <span className="block text-[12px] text-[var(--text-muted)]">{endereco}</span>}
            <span className="block text-[11px] text-[var(--primary)]">Abrir no mapa</span>
          </span>
        </a>
      );
    }
    case 'CONTATO':
      return (
        <div className="flex flex-col gap-1.5">
          {(m.extra?.contatos || []).map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <UserRound size={18} className="text-[var(--text-muted)] flex-none" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{c.nome || 'Contato'}</span>
                <span className="block text-[12px] text-[var(--text-muted)]">{(c.telefones || []).join(', ')}</span>
              </span>
            </div>
          ))}
        </div>
      );
    default:
      return <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.texto}</div>;
  }
}
