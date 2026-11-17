import type { Tecnico } from '../types/noc';
import { estaEnAlmuerzo } from './lunch';
import { horarioDelTecnico } from './shifts';
import { estaDentroDelRango } from './time';

export type EstadoTecnico = 'disponible' | 'almuerzo' | 'fuera-de-horario';

export const ETIQUETA_ESTADO: Record<EstadoTecnico, string> = {
  disponible: 'Disponible',
  almuerzo: 'En almuerzo',
  'fuera-de-horario': 'Fuera de horario'
};

export function estaEnHorario(tecnico: Tecnico, ahora: Date): boolean {
  const horario = horarioDelTecnico(tecnico);
  return horario !== null && estaDentroDelRango(horario.inicio, horario.fin, ahora);
}

/** Solo un técnico "disponible" (en su horario y fuera de su almuerzo) puede recibir casos. */
export function estadoDelTecnico(tecnico: Tecnico, ahora: Date): EstadoTecnico {
  if (!estaEnHorario(tecnico, ahora)) return 'fuera-de-horario';
  return estaEnAlmuerzo(tecnico, ahora) ? 'almuerzo' : 'disponible';
}

export function describirNoDisponibilidad(tecnico: Tecnico, estado: EstadoTecnico): string {
  if (estado === 'almuerzo') {
    return `${tecnico.nombre} está en su almuerzo${tecnico.almuerzoFin ? ` hasta las ${tecnico.almuerzoFin}` : ''}.`;
  }
  const horario = horarioDelTecnico(tecnico);
  return `${tecnico.nombre} está fuera de su horario${horario ? ` (${horario.inicio} - ${horario.fin})` : ''}.`;
}
