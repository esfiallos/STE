import type { Hora, Jornada, TurnoTecnico } from '../types/noc';
import { HORARIOS_COMODIN, HORARIOS_TURNO_C, nombreDeTurno, tramoDelTurnoC, TURNOS } from './shifts';

/**
 * Una opción del selector de la grilla de planificación: turno A o B, un tramo del turno C (C1, C2 o los dos)
 * o comodín con uno de sus horarios fijos.
 */
export interface OpcionDeJornada {
  valor: string;
  etiqueta: string;
  turno: TurnoTecnico;
  horarioInicio: Hora | null;
  horarioFin: Hora | null;
}

export const OPCIONES_DE_JORNADA: readonly OpcionDeJornada[] = [
  ...TURNOS.filter((t) => t.id !== 'turnoC').map((t) => ({
    valor: t.id,
    etiqueta: `${t.nombre} (${t.inicio}-${t.fin})`,
    turno: t.id,
    horarioInicio: null,
    horarioFin: null
  })),
  ...HORARIOS_TURNO_C.map((h) => ({
    valor: `turnoC-${h.inicio}-${h.fin}`,
    etiqueta: `Turno ${h.nombre} (${h.inicio}-${h.fin})`,
    turno: 'turnoC' as const,
    horarioInicio: h.inicio,
    horarioFin: h.fin
  })),
  ...HORARIOS_COMODIN.map((h) => ({
    valor: `comodin-${h.inicio}`,
    etiqueta: `${nombreDeTurno('comodin')} ${h.inicio}-${h.fin}`,
    turno: 'comodin' as const,
    horarioInicio: h.inicio,
    horarioFin: h.fin
  }))
];

/** Valor del selector que corresponde a una jornada ('' = libre). */
export function valorDeJornada(jornada: Pick<Jornada, 'turno' | 'horarioInicio' | 'horarioFin'> | undefined): string {
  if (!jornada) return '';
  if (jornada.turno === 'comodin') return `comodin-${jornada.horarioInicio ?? ''}`;
  // Una jornada C sin horario (anterior a la migración 14) es toda la noche
  if (jornada.turno === 'turnoC') return `turnoC-${jornada.horarioInicio ?? '22:00'}-${jornada.horarioFin ?? '06:00'}`;
  return jornada.turno;
}

export function opcionDeJornada(valor: string): OpcionDeJornada | undefined {
  return OPCIONES_DE_JORNADA.find((o) => o.valor === valor);
}

/** Texto corto para la celda de la grilla: "Turno A", "Turno C1 + C2", "Comodín 07:00". */
export function abreviaturaDeJornada(jornada: Pick<Jornada, 'turno' | 'horarioInicio' | 'horarioFin'>): string {
  if (jornada.turno === 'comodin') return `Comodín ${jornada.horarioInicio ?? ''}`.trim();
  if (jornada.turno === 'turnoC') return `Turno ${tramoDelTurnoC(jornada.horarioInicio, jornada.horarioFin) ?? 'C1 + C2'}`;
  return nombreDeTurno(jornada.turno);
}
