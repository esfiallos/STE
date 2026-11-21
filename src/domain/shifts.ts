import type { Tecnico, TurnoId, TurnoTecnico } from '../types/noc';
import { rangosSeSolapan } from './time';

export interface Turno {
  id: TurnoId;
  nombre: string;
  /** Horario del turno en 24 h. El nocturno cruza la medianoche. */
  inicio: string;
  fin: string;
}

/**
 * Única fuente de verdad de los turnos.
 * Ajusta aquí los horarios reales del NOC: de ellos depende cuándo un técnico recibe casos.
 */
export const TURNOS: readonly Turno[] = [
  { id: 'turnoA', nombre: 'Turno A', inicio: '06:00', fin: '14:00' },
  { id: 'turnoB', nombre: 'Turno B', inicio: '14:00', fin: '22:00' },
  { id: 'turnoC', nombre: 'Turno C', inicio: '22:00', fin: '06:00' }
];

export const ETIQUETA_COMODIN = 'Comodín';

/** Horarios permitidos para un comodín (D7). La base de datos exige los mismos (jornada_horario_comodin). */
export const HORARIOS_COMODIN: readonly { inicio: string; fin: string }[] = [
  { inicio: '06:00', fin: '16:00' },
  { inicio: '07:00', fin: '17:00' },
  { inicio: '08:00', fin: '18:00' }
];

export function esHorarioComodinValido(inicio: string, fin: string): boolean {
  return HORARIOS_COMODIN.some((h) => h.inicio === inicio.slice(0, 5) && h.fin === fin.slice(0, 5));
}

export function esTurnoId(valor: string): valor is TurnoId {
  return TURNOS.some((turno) => turno.id === valor);
}

export function esTurnoTecnico(valor: string): valor is TurnoTecnico {
  return valor === 'comodin' || esTurnoId(valor);
}

export function nombreDeTurno(turno: TurnoTecnico): string {
  if (turno === 'comodin') return ETIQUETA_COMODIN;
  return TURNOS.find((t) => t.id === turno)?.nombre ?? turno;
}

type DatosDeHorario = Pick<Tecnico, 'turno' | 'horarioInicio' | 'horarioFin'>;

/** Horario laboral del técnico: el propio si es comodín; si no, el de su turno. */
export function horarioDelTecnico(tecnico: DatosDeHorario): { inicio: string; fin: string } | null {
  if (tecnico.turno === 'comodin') {
    return tecnico.horarioInicio !== null && tecnico.horarioFin !== null
      ? { inicio: tecnico.horarioInicio, fin: tecnico.horarioFin }
      : null;
  }
  const turno = TURNOS.find((t) => t.id === tecnico.turno);
  return turno ? { inicio: turno.inicio, fin: turno.fin } : null;
}

/** Turnos en cuya sección aparece el técnico. Un comodín aparece en todos los que su horario toca. */
export function turnosDelTecnico(tecnico: DatosDeHorario): TurnoId[] {
  if (tecnico.turno !== 'comodin') return [tecnico.turno];

  const horario = horarioDelTecnico(tecnico);
  if (!horario) return [];
  return TURNOS.filter((t) => rangosSeSolapan(horario.inicio, horario.fin, t.inicio, t.fin)).map((t) => t.id);
}

export function tecnicosDelTurno<T extends DatosDeHorario>(tecnicos: T[], turnoId: TurnoId): T[] {
  return tecnicos.filter((tecnico) => turnosDelTecnico(tecnico).includes(turnoId));
}
