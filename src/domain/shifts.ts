import type { TurnoId } from '../types/noc';
import { estaDentroDelRango } from './time';

export interface Turno {
  id: TurnoId;
  nombre: string;
  /** Horario del turno en 24 h. El nocturno cruza la medianoche. */
  inicio: string;
  fin: string;
}

/**
 * Única fuente de verdad de los turnos.
 * Ajusta aquí los horarios reales del NOC: de ellos depende la métrica "Técnicos en turno".
 */
export const TURNOS: readonly Turno[] = [
  { id: 'turnoA', nombre: 'Turno A (Mañana)', inicio: '06:00', fin: '14:00' },
  { id: 'turnoB', nombre: 'Turno B (Tarde)', inicio: '14:00', fin: '22:00' },
  { id: 'turnoC', nombre: 'Turno C (Nocturno)', inicio: '22:00', fin: '06:00' }
];

export function esTurnoId(valor: string): valor is TurnoId {
  return TURNOS.some((turno) => turno.id === valor);
}

/** Id del turno en curso, o null si los horarios configurados no cubren la hora actual. */
export function turnoActivo(ahora: Date): TurnoId | null {
  const turno = TURNOS.find((t) => estaDentroDelRango(t.inicio, t.fin, ahora));
  return turno ? turno.id : null;
}
