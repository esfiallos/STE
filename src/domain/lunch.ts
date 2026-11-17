import type { Tecnico } from '../types/noc';
import { estaDentroDelRango } from './time';

type HorarioAlmuerzo = Pick<Tecnico, 'almuerzoInicio' | 'almuerzoFin'>;

export const HORARIO_ALMUERZO_PREDETERMINADO = { inicio: '12:00', fin: '12:30' } as const;

export function estaEnAlmuerzo(horario: HorarioAlmuerzo, ahora: Date): boolean {
  if (horario.almuerzoInicio === null || horario.almuerzoFin === null) return false;
  return estaDentroDelRango(horario.almuerzoInicio, horario.almuerzoFin, ahora);
}
