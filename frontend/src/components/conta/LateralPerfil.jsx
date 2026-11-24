import { Link } from 'react-router-dom';
import { Painel, LinhaInfo } from '../ui';

// Coluna da direita do Meu perfil (só pra quem é de um negócio):
// "Sua agenda" (cadastro de profissional ligado ao login) e "Seu mês".

const DIAS = { 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sáb', 7: 'dom' };

function textoDias(dias) {
  const lista = [...new Set(dias.map(Number))].filter((d) => DIAS[d]).sort((a, b) => a - b);
  if (lista.length === 0) return '—';
  if (lista.length === 7) return 'todos os dias';
  const seguidos = lista.every((d, i) => i === 0 || d === lista[i - 1] + 1);
  if (seguidos && lista.length >= 3) return `${DIAS[lista[0]]} a ${DIAS[lista[lista.length - 1]]}`;
  return lista.map((d) => DIAS[d]).join(', ');
}

// Jornada própria ({"1":[{inicio,fim}],...}) ou, sem ela, o horário da loja
// ({abertura, fechamento, dias}).
function resumoJornada(jornada, horarioLoja) {
  if (jornada && typeof jornada === 'object') {
    const dias = Object.keys(jornada).filter((d) => Array.isArray(jornada[d]) && jornada[d].length > 0);
    const intervalos = dias.flatMap((d) => jornada[d]);
    if (dias.length > 0) {
      const inicio = intervalos.map((i) => i.inicio).filter(Boolean).sort()[0];
      const fim = intervalos.map((i) => i.fim).filter(Boolean).sort().at(-1);
      return { dias: textoDias(dias), horario: inicio && fim ? `${inicio} às ${fim}` : '—', daLoja: false };
    }
  }
  if (horarioLoja && Array.isArray(horarioLoja.dias)) {
    return {
      dias: textoDias(horarioLoja.dias),
      horario: horarioLoja.abertura && horarioLoja.fechamento ? `${horarioLoja.abertura} às ${horarioLoja.fechamento}` : '—',
      daLoja: true,
    };
  }
  return null;
}

const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pct = (v) => `${String(v).replace('.', ',')}%`;

function textoComissao(esp) {
  const partes = [];
  if (Number(esp?.comissaoServicoPct) > 0) partes.push(`${pct(esp.comissaoServicoPct)} dos serviços`);
  if (Number(esp?.comissaoFixa) > 0) partes.push(`${brl(esp.comissaoFixa)} por atendimento`);
  if (Number(esp?.comissaoProdutoPct) > 0) partes.push(`${pct(esp.comissaoProdutoPct)} dos produtos`);
  return partes.length ? partes.join(' · ') : 'sem comissão';
}

function Esqueleto() {
  return (
    <div className="p-4 space-y-2.5" aria-hidden="true">
      {[0, 1, 2].map((i) => <div key={i} className="h-4 rounded bg-[var(--bg-subtle)] animate-pulse" />)}
    </div>
  );
}

function NumeroMes({ rotulo, valor }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-[var(--text-muted)] truncate">{rotulo}</div>
      <div className="mt-0.5 text-lg font-bold tracking-tight tabular-nums text-[var(--text-main)] truncate">{valor}</div>
    </div>
  );
}

export default function LateralPerfil({ carregando, especialista, mes, horarioLoja }) {
  if (carregando) {
    return (
      <Painel titulo="Sua agenda" semPadding>
        <Esqueleto />
      </Painel>
    );
  }
  if (especialista === undefined) return null;

  if (especialista === null) {
    return (
      <Painel titulo="Sua agenda" semPadding>
        <p className="m-0 px-4 py-3.5 text-[13px] text-[var(--text-muted)]">
          Você ainda não está na agenda como profissional. Quem cuida da equipe liga seu login a um profissional em Agenda.
        </p>
      </Painel>
    );
  }

  const jornada = resumoJornada(especialista.jornada, horarioLoja);
  const nomeMes = new Date().toLocaleDateString('pt-BR', { month: 'long' });

  return (
    <>
      <Painel
        titulo="Sua agenda"
        acoes={<Link to="/app/agenda" className="text-[13px] font-semibold text-[var(--primary)] hover:underline">Abrir</Link>}
        semPadding
      >
        {!especialista.ativo && <LinhaInfo rotulo="Situação" valor="Inativo na agenda" />}
        <LinhaInfo rotulo="Atende" valor={jornada?.dias || '—'} />
        <LinhaInfo rotulo={jornada?.daLoja ? 'Horário (da loja)' : 'Horário'} valor={jornada?.horario || '—'} />
        <LinhaInfo rotulo="Serviços" valor={(especialista.servicosIds || []).length} />
        <LinhaInfo rotulo="Comissão" valor={textoComissao(especialista)} />
      </Painel>

      {mes && (
        <Painel titulo="Seu mês" subtitulo={`Seus horários de ${nomeMes} na agenda`}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            <NumeroMes rotulo="Atendimentos" valor={mes.concluidos} />
            <NumeroMes rotulo="Valor atendido" valor={brl(mes.valorConcluido)} />
            <NumeroMes rotulo="A atender" valor={mes.aAtender} />
            <NumeroMes rotulo="Cancelados" valor={mes.cancelados} />
          </div>
        </Painel>
      )}
    </>
  );
}
