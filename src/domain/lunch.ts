import type { Tecnico } from '../types/noc';
import { aMinutos, estaDentroDelRango } from './time';

type HorarioAlmuerzo = Pick<Tecnico, 'almuerzoInicio' | 'almuerzoFin'>;

export const HORARIO_ALMUERZO_PREDETERMINADO = { inicio: '12:00', fin: '12:30' } as const;

export function estaEnAlmuerzo(horario: HorarioAlmuerzo, ahora: Date): boolean {
  if (horario.almuerzoInicio === null || horario.almuerzoFin === null) return false;
  return estaDentroDelRango(horario.almuerzoInicio, horario.almuerzoFin, ahora);
}

export function describirAlmuerzo(horario: HorarioAlmuerzo): string {
  if (horario.almuerzoInicio === null || horario.almuerzoFin === null) return 'Sin horario';
  return `${horario.almuerzoInicio} - ${horario.almuerzoFin}`;
}

export function esRangoDeAlmuerzoValido(inicio: string, fin: string): boolean {
  const desde = aMinutos(inicio);
  const hasta = aMinutos(fin);
  return desde !== null && hasta !== null && desde !== hasta;
}
