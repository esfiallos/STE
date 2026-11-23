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

/**
 * Tramos del turno C (v2.3): C1 22:00-00:00 y C2 00:00-06:00. Quien hace toda la noche tiene los dos y se
 * guarda como 22:00-06:00 ("C1 + C2"). La base de datos exige los mismos (jornada_horario_valido,
 * public.horarios_turno_c()). Para el traspaso todos son "turno C".
 */
export const HORARIOS_TURNO_C: readonly { inicio: string; fin: string; nombre: string }[] = [
  { inicio: '22:00', fin: '00:00', nombre: 'C1' },
  { inicio: '00:00', fin: '06:00', nombre: 'C2' },
  { inicio: '22:00', fin: '06:00', nombre: 'C1 + C2' }
];

/** Tramo del turno C de un horario (C1, C2 o C1 + C2), o null si no es uno de ellos. */
export function tramoDelTurnoC(inicio: string | null, fin: string | null): string | null {
  if (!inicio || !fin) return null;
  return HORARIOS_TURNO_C.find((h) => h.inicio === inicio.slice(0, 5) && h.fin === fin.slice(0, 5))?.nombre ?? null;
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
  if (tecnico.turno === 'turnoC' && tecnico.horarioInicio !== null && tecnico.horarioFin !== null) {
    return { inicio: tecnico.horarioInicio, fin: tecnico.horarioFin };
  }
  const turno = TURNOS.find((t) => t.id === tecnico.turno);
  return turno ? { inicio: turno.inicio, fin: turno.fin } : null;
}

/** Nombre de la jornada de un día: "Turno A", "Turno C1", "Turno C1 + C2", "Comodín 07:00–17:00". */
export function nombreDeJornada(tecnico: DatosDeHorario): string {
  if (tecnico.turno === 'comodin') {
    return tecnico.horarioInicio ? `${ETIQUETA_COMODIN} ${tecnico.horarioInicio}–${tecnico.horarioFin}` : ETIQUETA_COMODIN;
  }
  if (tecnico.turno === 'turnoC') {
    const tramo = tramoDelTurnoC(tecnico.horarioInicio, tecnico.horarioFin);
    if (tramo) return `Turno ${tramo}`;
  }
  return nombreDeTurno(tecnico.turno);
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
