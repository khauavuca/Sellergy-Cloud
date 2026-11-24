import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { coresPorStatus, fmtHora } from './agendaUtils';

// Grade de horários da Agenda (visões Dia e Semana): uma coluna por dia ou por
// profissional, linhas de hora em hora e cada atendimento posicionado pelo
// horário e pela duração. Atendimentos que se sobrepõem dividem a largura.

const PX_HORA = 56;

function minutosDoDia(d) {
  const x = new Date(d);
  return x.getHours() * 60 + x.getMinutes();
}

// Distribui os atendimentos que se sobrepõem em "faixas" lado a lado.
function distribuirEmFaixas(ags) {
  const ordenados = [...ags]
    .map((a) => {
      const ini = minutosDoDia(a.data);
      return { ag: a, ini, fim: ini + Math.max(15, Number(a.duracao) || 30) };
    })
    .sort((a, b) => a.ini - b.ini || b.fim - a.fim);

  const saida = [];
  let grupo = [];
  let fimGrupo = -1;
  const fecharGrupo = () => {
    const faixas = [];
    grupo.forEach((it) => {
      let f = faixas.findIndex((fimFaixa) => fimFaixa <= it.ini);
      if (f === -1) {
        f = faixas.length;
        faixas.push(it.fim);
      } else {
        faixas[f] = it.fim;
      }
      it.faixa = f;
    });
    grupo.forEach((it) => saida.push({ ...it, totalFaixas: faixas.length }));
    grupo = [];
    fimGrupo = -1;
  };
  ordenados.forEach((it) => {
    if (grupo.length && it.ini >= fimGrupo) fecharGrupo();
    grupo.push(it);
    fimGrupo = Math.max(fimGrupo, it.fim);
  });
  if (grupo.length) fecharGrupo();
  return saida;
}

/**
 * colunas: [{ chave, titulo, subtitulo?, hoje?, data: Date, especialistaId?, agendamentos }]
 */
export default function GradeHorarios({ colunas, selecionadoId, onSelecionar, onHorarioLivre, larguraMinColuna = 120 }) {
  // Faixa de horas: 8h–18h por padrão, ampliada pelos atendimentos do período.
  const { horaIni, horaFim } = useMemo(() => {
    let min = 8;
    let max = 18;
    colunas.forEach((c) => c.agendamentos.forEach((a) => {
      const ini = minutosDoDia(a.data);
      const fim = ini + (Number(a.duracao) || 30);
      min = Math.min(min, Math.floor(ini / 60));
      max = Math.max(max, Math.ceil(fim / 60));
    }));
    return { horaIni: min, horaFim: Math.min(24, max) };
  }, [colunas]);

  const horas = [];
  for (let h = horaIni; h < horaFim; h++) horas.push(h);
  const altura = horas.length * PX_HORA;
  const agora = new Date();
  const minAgora = agora.getHours() * 60 + agora.getMinutes();
  const topoAgora = ((minAgora - horaIni * 60) * PX_HORA) / 60;
  const gridCols = `56px repeat(${colunas.length}, minmax(${larguraMinColuna}px, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: `${56 + colunas.length * larguraMinColuna}px` }}>
        {/* Cabeçalho das colunas */}
        <div className="grid border-b border-[var(--border-main)]" style={{ gridTemplateColumns: gridCols }}>
          <div />
          {colunas.map((c) => (
            <div
              key={c.chave}
              className={`px-2 py-2.5 text-center border-l border-[var(--border-subtle)] min-w-0 ${c.hoje ? 'bg-[var(--primary-soft)]' : ''}`}
            >
              {c.subtitulo && <div className="text-xs font-medium text-[var(--text-muted)] truncate">{c.subtitulo}</div>}
              <div className={`truncate ${c.subtitulo ? 'text-lg font-bold tabular-nums' : 'text-[13px] font-semibold'} ${c.hoje ? 'text-[var(--primary)]' : 'text-[var(--text-main)]'}`}>
                {c.titulo}
              </div>
              {!c.subtitulo && (
                <div className="text-[11px] text-[var(--text-muted)] tabular-nums">
                  {c.agendamentos.length} {c.agendamentos.length === 1 ? 'horário' : 'horários'}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Corpo */}
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          <div aria-hidden="true">
            {horas.map((h) => (
              <div key={h} className="pr-2 pt-1 text-right text-[11px] text-[var(--text-muted)] tabular-nums box-border" style={{ height: PX_HORA }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {colunas.map((c) => {
            const itens = distribuirEmFaixas(c.agendamentos);
            const mostrarAgora = c.hoje && minAgora >= horaIni * 60 && minAgora <= horaFim * 60;
            return (
              <div
                key={c.chave}
                className="relative border-l border-[var(--border-subtle)]"
                style={{
                  height: altura,
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_HORA - 1}px, var(--border-subtle) ${PX_HORA - 1}px, var(--border-subtle) ${PX_HORA}px)`,
                }}
              >
                {/* Horários livres: clique abre "Novo agendamento" já com dia e hora. */}
                {onHorarioLivre && horas.map((h, i) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      const d = new Date(c.data);
                      d.setHours(h, 0, 0, 0);
                      onHorarioLivre({ data: d, especialistaId: c.especialistaId || '' });
                    }}
                    aria-label={`Novo agendamento ${c.subtitulo ? `${c.subtitulo} ${c.titulo}` : `com ${c.titulo}`} às ${String(h).padStart(2, '0')}:00`}
                    className="group absolute inset-x-0 flex items-start justify-end p-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] focus-visible:bg-[var(--bg-subtle)] transition-colors"
                    style={{ top: i * PX_HORA, height: PX_HORA - 1 }}
                  >
                    <span className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 inline-flex items-center gap-1">
                      <Plus size={12} aria-hidden="true" /> livre
                    </span>
                  </button>
                ))}

                {itens.map(({ ag, ini, fim, faixa, totalFaixas }) => {
                  const cores = coresPorStatus(ag.status);
                  const top = ((ini - horaIni * 60) * PX_HORA) / 60;
                  const h = Math.max(24, ((fim - ini) * PX_HORA) / 60 - 3);
                  const largura = 100 / totalFaixas;
                  const selecionado = ag.id === selecionadoId;
                  return (
                    <button
                      key={ag.id}
                      type="button"
                      onClick={() => onSelecionar(ag)}
                      aria-pressed={selecionado}
                      title={`${fmtHora(ag.data)} · ${ag.nomeCliente}${ag.servico ? ` · ${ag.servico}` : ''} · ${ag.duracao}min`}
                      className={`absolute z-[1] rounded-md px-2 py-1 text-left text-xs overflow-hidden hover:brightness-95 transition-[filter] ${ag.status === 'CANCELED' ? 'line-through opacity-80' : ''}`}
                      style={{
                        top: top + 1,
                        height: h,
                        left: `calc(${faixa * largura}% + 3px)`,
                        width: `calc(${largura}% - 6px)`,
                        backgroundColor: cores.soft,
                        color: cores.text,
                        borderLeft: `3px solid ${cores.solid}`,
                        boxShadow: selecionado ? '0 0 0 2px var(--primary)' : 'none',
                      }}
                    >
                      <div className="font-bold truncate">
                        <span className="tabular-nums">{fmtHora(ag.data)}</span> {ag.nomeCliente}
                      </div>
                      {ag.servico && <div className="truncate opacity-85">{ag.servico}</div>}
                      {ag.pacote && <div className="truncate opacity-85">Pacote · {ag.pacote.sessoesUsadas} de {ag.pacote.sessoesTotal}</div>}
                      {ag.sinalStatus === 'PENDENTE' && <div className="truncate font-semibold">Sinal pendente</div>}
                    </button>
                  );
                })}

                {mostrarAgora && (
                  <div className="absolute inset-x-0 z-[2] h-0.5 bg-[var(--accent)] pointer-events-none" style={{ top: topoAgora }} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
