import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Check, AlertTriangle, Copy, ExternalLink } from 'lucide-react';
import api from '../../services/api';
import { Badge, Button, Painel, useToast } from '../ui';

// Configurações › Agenda e loja online: os dois links públicos e a lista do
// que falta pra cada um funcionar (GET /conta/online).

const NOME_DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function resumoHorario(h) {
  const dias = [...(h.dias || [])].sort();
  const seguidos = dias.length > 1 && dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  const texto = seguidos ? `${NOME_DIA[dias[0]]} a ${NOME_DIA[dias[dias.length - 1]]}` : dias.map((d) => NOME_DIA[d]).join(', ');
  return `${texto || 'Nenhum dia'}, ${h.abertura} às ${h.fechamento}`;
}

function Item({ ok, titulo, texto, acao }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)] last:border-b-0">
      <span
        className={clsx('w-6 h-6 rounded-full grid place-items-center flex-shrink-0', ok ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'bg-[var(--warning-soft)] text-[var(--warning-text)]')}
        aria-hidden="true"
      >
        {ok ? <Check size={14} strokeWidth={3} /> : <AlertTriangle size={13} />}
      </span>
      <div className="flex-1 min-w-[180px]">
        <p className="m-0 text-[13.5px] font-semibold text-[var(--text-main)]">{titulo}<span className="sr-only">{ok ? ' (pronto)' : ' (falta)'}</span></p>
        <p className="m-0 text-xs text-[var(--text-muted)]">{texto}</p>
      </div>
      {acao}
    </div>
  );
}

function BotaoLink({ to, children }) {
  return (
    <Link to={to} className="h-8 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-xs font-semibold text-[var(--text-main)] inline-flex items-center hover:bg-[var(--bg-subtle)]">
      {children}
    </Link>
  );
}

function LinhaLink({ url, onCopiar }) {
  if (!url) {
    return <p className="m-0 px-4 py-3 text-sm text-[var(--text-muted)] border-b border-[var(--border-subtle)]">Defina o endereço do link mais abaixo para ele aparecer aqui.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
      <span className="flex-1 min-w-0 h-10 px-3 rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] text-[13px] text-[var(--text-main)] flex items-center overflow-hidden whitespace-nowrap text-ellipsis">{url}</span>
      <Button size="sm" icon={Copy} onClick={() => onCopiar(url)}>Copiar link</Button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="h-9 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] font-semibold text-[var(--text-main)] inline-flex items-center gap-1.5 hover:bg-[var(--bg-subtle)]">
        Abrir <ExternalLink size={13} aria-hidden="true" />
      </a>
    </div>
  );
}

export default function BlocoOnline({ onAbrirSecao }) {
  const toast = useToast();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.get('/conta/online')
      .then((r) => { if (vivo) setDados(r.data); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, []);

  const copiar = (url) => navigator.clipboard?.writeText(url).then(
    () => toast.success('Link copiado.'),
    () => toast.error('Não foi possível copiar.'),
  );

  if (erro) return <Painel titulo="Agenda e loja online"><p className="m-0 text-sm text-[var(--text-muted)]">Não foi possível carregar. Recarregue a página.</p></Painel>;
  if (!dados) return <Painel titulo="Agenda e loja online"><div className="h-24 rounded-lg bg-[var(--bg-subtle)] animate-pulse" /></Painel>;
  const { agenda, loja } = dados;

  return (
    <>
      {agenda && (
        <Painel
          titulo="Link de agendamento"
          subtitulo="O cliente escolhe serviço, dia e horário sozinho."
          acoes={<Badge variant={agenda.pronto ? 'success' : 'warning'} size="sm">{agenda.pronto ? 'No ar' : 'Falta configurar'}</Badge>}
          semPadding
        >
          <LinhaLink url={agenda.link} onCopiar={copiar} />
          <Item
            ok
            titulo="Horário de funcionamento"
            texto={`${resumoHorario(agenda.horario)}${agenda.horario.salvo ? '' : ' (padrão, ainda não salvo)'}. Profissional com horário próprio usa o dele.`}
            acao={<Button variant="secondary" size="sm" onClick={() => onAbrirSecao('horario')}>{agenda.horario.salvo ? 'Mudar' : 'Ajustar'}</Button>}
          />
          <Item
            ok={agenda.servicos > 0}
            titulo="Serviços com duração e preço"
            texto={agenda.servicos > 0 ? `${agenda.servicos} serviço(s) aparecem no link.` : 'Nenhum serviço ainda. Sem serviço o link fica vazio.'}
            acao={<BotaoLink to="/app/catalogo">{agenda.servicos > 0 ? 'Serviços' : 'Cadastrar serviço'}</BotaoLink>}
          />
          <Item
            ok={agenda.profissionais > 0}
            titulo="Profissionais"
            texto={agenda.profissionais > 0
              ? `${agenda.profissionais} profissional(is) ativo(s). Serviço sem profissional marcado é atendido por todos.`
              : 'Nenhum profissional ativo para receber os horários.'}
            acao={<BotaoLink to="/app/usuarios">Equipe</BotaoLink>}
          />
        </Painel>
      )}

      {loja && (
        <Painel
          titulo="Catálogo online"
          subtitulo="O cliente monta o carrinho; o pedido chega aqui e no seu WhatsApp."
          acoes={<Badge variant={loja.pronto ? 'success' : 'warning'} size="sm">{loja.pronto ? 'No ar' : loja.online ? 'Falta configurar' : 'Desligado'}</Badge>}
          semPadding
        >
          <LinhaLink url={loja.online ? loja.link : null} onCopiar={copiar} />
          <Item
            ok={loja.online && (loja.retirada || loja.entrega)}
            titulo="Loja ligada e forma de receber"
            texto={!loja.online
              ? 'Desligada. Ligue em Pedidos › Loja online.'
              : [loja.retirada && 'retirada na loja', loja.entrega && `entrega${loja.frete ? ` (R$ ${loja.frete.toFixed(2).replace('.', ',')})` : ''}`].filter(Boolean).join(' · ') || 'Escolha retirada ou entrega.'}
            acao={<BotaoLink to="/app/pedidos">Loja online</BotaoLink>}
          />
          <Item
            ok={loja.produtos > 0}
            titulo="Produtos com preço"
            texto={loja.produtos > 0 ? `${loja.produtos} produto(s) aparecem no catálogo.` : 'Nenhum produto com preço ainda.'}
            acao={<BotaoLink to="/app/estoque">Produtos</BotaoLink>}
          />
          <Item
            ok={Boolean(loja.whatsapp)}
            titulo="WhatsApp que recebe o pedido"
            texto={loja.whatsapp
              ? `${loja.whatsapp}${loja.whatsappDoBot ? ' (conectado na tela Bots)' : ' (telefone do cadastro; conecte o WhatsApp em Bots)'}`
              : 'Conecte o WhatsApp na tela Bots para o cliente mandar o pedido.'}
            acao={<BotaoLink to="/app/bots">Bots</BotaoLink>}
          />
        </Painel>
      )}

      {!agenda && !loja && (
        <Painel titulo="Agenda e loja online">
          <p className="m-0 text-sm text-[var(--text-muted)]">Seu plano não inclui o link de agendamento nem o catálogo online.</p>
        </Painel>
      )}
    </>
  );
}
