import type { Hora, Jornada, TurnoTecnico } from '../types/noc';
import { HORARIOS_COMODIN, nombreDeTurno, TURNOS } from './shifts';

/** Una opción del selector de la grilla de planificación: un turno, o comodín con uno de sus horarios fijos. */
export interface OpcionDeJornada {
  valor: string;
  etiqueta: string;
  turno: TurnoTecnico;
  horarioInicio: Hora | null;
  horarioFin: Hora | null;
}

export const OPCIONES_DE_JORNADA: readonly OpcionDeJornada[] = [
  ...TURNOS.map((t) => ({
    valor: t.id,
    etiqueta: `${t.nombre} (${t.inicio}-${t.fin})`,
    turno: t.id,
    horarioInicio: null,
    horarioFin: null
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
export function valorDeJornada(jornada: Pick<Jornada, 'turno' | 'horarioInicio'> | undefined): string {
  if (!jornada) return '';
  return jornada.turno === 'comodin' ? `comodin-${jornada.horarioInicio ?? ''}` : jornada.turno;
}

export function opcionDeJornada(valor: string): OpcionDeJornada | undefined {
  return OPCIONES_DE_JORNADA.find((o) => o.valor === valor);
}

/** Abreviatura para la celda de la grilla: A, B, C o C7 (comodín de 07:00). */
export function abreviaturaDeJornada(jornada: Pick<Jornada, 'turno' | 'horarioInicio'>): string {
  if (jornada.turno === 'comodin') return `Comodín ${jornada.horarioInicio ?? ''}`.trim();
  return nombreDeTurno(jornada.turno);
}
