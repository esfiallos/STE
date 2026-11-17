import type { Tecnico, TecnicoConIncidentes } from '../types/noc';
import { estaEnHorario } from './availability';
import { estaEnAlmuerzo } from './lunch';

export interface Metricas {
  casosActivos: number;
  tecnicosEnTurno: number;
  almuerzosActivos: number;
}

/** Cada técnico cuenta una sola vez, aunque (comodín) aparezca en varios turnos. */
export function calcularMetricas(tecnicos: TecnicoConIncidentes[], ahora: Date): Metricas {
  const enHorario = (t: Tecnico) => estaEnHorario(t, ahora);

  return {
    casosActivos: tecnicos.reduce((total, tecnico) => total + tecnico.incidentes.length, 0),
    tecnicosEnTurno: tecnicos.filter(enHorario).length,
    almuerzosActivos: tecnicos.filter((tecnico) => enHorario(tecnico) && estaEnAlmuerzo(tecnico, ahora)).length
  };
}
