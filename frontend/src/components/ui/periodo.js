// Presets e calculo de intervalo usados pelo PeriodoPills.

export const PRESETS_PERIODO = [
  { value: 'hoje', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'mes_atual', label: 'Este mês' },
  { value: 'mes_anterior', label: 'Mês passado' },
  { value: '90d', label: '90 dias' },
  { value: 'custom', label: 'Personalizado' },
];

// Mantém a mesma lógica de cálculo do componente antigo, para não quebrar
// as chamadas existentes. Pode ser importada de outros lugares.
export function calcularIntervalo(preset, customInicio, customFim) {
  const fim = new Date();
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  fim.setHours(23, 59, 59, 999);

  switch (preset) {
    case 'hoje':
      return { inicio, fim };
    case '7d':
      inicio.setDate(inicio.getDate() - 6);
      return { inicio, fim };
    case '30d':
      inicio.setDate(inicio.getDate() - 29);
      return { inicio, fim };
    case '90d':
      inicio.setDate(inicio.getDate() - 89);
      return { inicio, fim };
    case 'mes_atual':
      return {
        inicio: new Date(fim.getFullYear(), fim.getMonth(), 1, 0, 0, 0),
        fim,
      };
    case 'mes_anterior': {
      const ini = new Date(fim.getFullYear(), fim.getMonth() - 1, 1, 0, 0, 0);
      const f = new Date(fim.getFullYear(), fim.getMonth(), 0, 23, 59, 59, 999);
      return { inicio: ini, fim: f };
    }
    case 'custom':
      return {
        inicio: customInicio ? new Date(customInicio + 'T00:00:00') : inicio,
        fim: customFim ? new Date(customFim + 'T23:59:59') : fim,
      };
    default:
      return { inicio, fim };
  }
}
