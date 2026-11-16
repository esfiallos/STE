import type { TecnicoConIncidentes } from '../types/noc';
import { estaEnAlmuerzo } from './lunch';
import { turnoActivo } from './shifts';

export interface Metricas {
  casosActivos: number;
  tecnicosEnTurno: number;
  almuerzosActivos: number;
}

export function calcularMetricas(tecnicos: TecnicoConIncidentes[], ahora: Date): Metricas {
  const turnoEnCurso = turnoActivo(ahora);

  return {
    casosActivos: tecnicos.reduce((total, tecnico) => total + tecnico.incidentes.length, 0),
    tecnicosEnTurno: tecnicos.filter((tecnico) => tecnico.turno === turnoEnCurso).length,
    almuerzosActivos: tecnicos.filter((tecnico) => estaEnAlmuerzo(tecnico, ahora)).length
  };
}
