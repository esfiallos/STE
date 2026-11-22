import type { AlertaCoordinacion, EstadoCaso } from '../types/noc';

export interface EstadisticasDelDia {
  /** Casos que tuvieron responsable en el día operativo. */
  total: number;
  porEstado: Record<EstadoCaso, number>;
}

/** Une las filas de estadisticas_del_dia() (estado → total) con todos los estados en 0 por defecto. */
export function resumirEstadisticas(filas: { estado: EstadoCaso; total: number }[]): EstadisticasDelDia {
  const porEstado: Record<EstadoCaso, number> = { en_curso: 0, pausado: 0, resuelto: 0, cerrado: 0 };
  for (const f of filas) porEstado[f.estado] = (porEstado[f.estado] ?? 0) + Number(f.total);
  return { total: Object.values(porEstado).reduce((suma, n) => suma + n, 0), porEstado };
}

/** Porcentaje entero (0 si no hay total). */
export const porcentaje = (parte: number, total: number) => (total > 0 ? Math.round((parte * 100) / total) : 0);

/** Texto de una alerta para la campana y el panel. */
export function describirAlerta(alerta: Pick<AlertaCoordinacion, 'tipo' | 'nivel' | 'detalle' | 'tecnicoNombre'>): string {
  const caso = alerta.detalle ?? 'Un caso';
  const tecnico = alerta.tecnicoNombre ?? 'su responsable';
  if (alerta.tipo === 'recordatorio_sin_jornada') return `Recordatorio de ${caso} y ${tecnico} no tiene turno ese día`;
  return `${caso}: ${alerta.nivel} h sin actualización de ${tecnico}`;
}

/**
 * Alertas por atender: las no leídas, una por caso y tipo (la de más horas), primero las más graves
 * y, entre iguales, las más recientes.
 */
export function alertasActivas(alertas: AlertaCoordinacion[]): AlertaCoordinacion[] {
  const porCaso = new Map<string, AlertaCoordinacion>();
  for (const a of alertas) {
    if (a.leida) continue;
    const clave = `${a.casoId}|${a.tipo}`;
    const actual = porCaso.get(clave);
    if (!actual || (a.nivel ?? 0) > (actual.nivel ?? 0)) porCaso.set(clave, a);
  }
  return [...porCaso.values()].sort((a, b) => (b.nivel ?? 0) - (a.nivel ?? 0) || b.creadoEn.localeCompare(a.creadoEn));
}

/** Ids de las alertas no leídas del mismo caso y tipo (al atender una se marcan todas). */
export function alertasHermanas(alertas: AlertaCoordinacion[], alerta: AlertaCoordinacion): string[] {
  return alertas.filter((a) => !a.leida && a.casoId === alerta.casoId && a.tipo === alerta.tipo).map((a) => a.id);
}

/** Gravedad visual de una alerta. */
export function gravedadDeAlerta(alerta: Pick<AlertaCoordinacion, 'tipo' | 'nivel'>): 'aviso' | 'alta' | 'critica' {
  if (alerta.tipo !== 'sin_actualizacion') return 'aviso';
  return alerta.nivel === 6 ? 'critica' : alerta.nivel === 4 ? 'alta' : 'aviso';
}
