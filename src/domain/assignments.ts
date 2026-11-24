import type { Incidente, Jornada, OrigenResponsable, Tecnico, TecnicoCatalogo, TecnicoConIncidentes } from '../types/noc';

/** Misma normalización que aplica la base de datos al guardar el código. */
export function normalizarCodigo(codigo: string): string {
  return codigo.trim().toUpperCase();
}

export function buscarIncidentePorCodigo(incidentes: Incidente[], codigo: string): Incidente | undefined {
  const normalizado = normalizarCodigo(codigo);
  return incidentes.find((incidente) => incidente.codigo === normalizado);
}

export function unirTecnicosConIncidentes(tecnicos: Tecnico[], incidentes: Incidente[]): TecnicoConIncidentes[] {
  const porTecnico = new Map<string, Incidente[]>();

  for (const incidente of incidentes) {
    if (incidente.tecnicoId === null) continue;
    const lista = porTecnico.get(incidente.tecnicoId) ?? [];
    lista.push(incidente);
    porTecnico.set(incidente.tecnicoId, lista);
  }

  return tecnicos.map((tecnico) => ({ ...tecnico, incidentes: porTecnico.get(tecnico.id) ?? [] }));
}

/** Técnicos que trabajan un día: los activos del catálogo que tienen jornada, con su turno y almuerzo de ese día. */
export function tecnicosDelDia(catalogo: TecnicoCatalogo[], jornadas: Jornada[]): Tecnico[] {
  const porId = new Map(catalogo.filter((t) => t.activo).map((t) => [t.id, t]));
  return jornadas
    .flatMap((jornada) => {
      const tecnico = porId.get(jornada.tecnicoId);
      if (!tecnico) return [];
      return [
        {
          id: tecnico.id,
          nombre: tecnico.nombre,
          jornadaId: jornada.id,
          turno: jornada.turno,
          horarioInicio: jornada.horarioInicio,
          horarioFin: jornada.horarioFin,
          almuerzoInicio: jornada.almuerzoInicio,
          almuerzoFin: jornada.almuerzoFin
        }
      ];
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Cómo llega un caso a un técnico cuando lo hace el dispatch (= `origenes_del_tablero()` en SQL, D16).
 * El tablero de un día solo muestra estas asignaciones: lo traspasado vive en Mi seguimiento.
 */
export const ORIGENES_DEL_TABLERO: readonly OrigenResponsable[] = ['dispatch', 'reasignacion', 'reapertura'];

/** Una asignación de un caso a un técnico en un día operativo (fila de `caso_responsables`). */
export interface AsignacionDeCaso {
  casoId: string;
  tecnicoId: string | null;
  fechaOperativa: string;
  origen: OrigenResponsable;
  desde: string;
}

/**
 * Casos del tablero del día `fecha` (D16, = vista `tablero_del_dia`): por caso, la última asignación del
 * dispatch de ese día. Un traspaso posterior no lo cambia de columna. Devuelve caso → técnico asignado.
 */
export function asignacionesDelDia(asignaciones: AsignacionDeCaso[], fecha: string): Map<string, AsignacionDeCaso> {
  const porCaso = new Map<string, AsignacionDeCaso>();
  for (const a of asignaciones) {
    if (a.fechaOperativa !== fecha || !ORIGENES_DEL_TABLERO.includes(a.origen)) continue;
    const previa = porCaso.get(a.casoId);
    if (!previa || a.desde > previa.desde) porCaso.set(a.casoId, a);
  }
  return porCaso;
}

/**
 * Casos abiertos que el responsable tiene hasta el día `fecha` (sin lo recibido para un día siguiente).
 * Es la base de "Por reasignar"; el tablero se lee aparte (`tablero_del_dia`).
 */
export function casosHastaElDia(casos: Incidente[], fecha: string): Incidente[] {
  return casos.filter((caso) => !caso.fechaResponsable || caso.fechaResponsable <= fecha);
}

/** Por qué un caso está en "Por reasignar" (null si no lo está). */
export type MotivoPorReasignar = 'sin_responsable' | 'no_trabaja_hoy' | 'turno_sin_traspaso';

export function motivoPorReasignar(caso: Incidente, tecnicosDeHoy: ReadonlySet<string>): MotivoPorReasignar | null {
  if (caso.estado === 'cerrado') return null;
  if (caso.tecnicoId === null) return 'sin_responsable';
  if (!tecnicosDeHoy.has(caso.tecnicoId)) return 'no_trabaja_hoy';
  // D33: su turno terminó y no lo traspasó (la BD ya descontó la gracia)
  if (caso.sinTraspasoDesde) return 'turno_sin_traspaso';
  return null;
}

/**
 * Casos abiertos sin responsable, cuyo responsable no trabaja hoy o cuyo turno terminó sin traspasarlos:
 * el dispatch debe reasignarlos.
 */
export function casosPorReasignar(casos: Incidente[], tecnicosDeHoy: Tecnico[]): Incidente[] {
  const deHoy = new Set(tecnicosDeHoy.map((t) => t.id));
  return casos.filter((caso) => motivoPorReasignar(caso, deHoy) !== null);
}
