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
  if (alerta.tipo === 'turno_sin_traspaso') return `${caso}: ${tecnico} terminó su turno sin traspasarlo`;
  return `${caso}: ${alerta.nivel} h sin actualización de ${tecnico}`;
}

/** "Sin traspaso" ya dice lo más grave del caso: su "N h sin actualización" no se muestra aparte (D33). */
const laCubre = (cubre: AlertaCoordinacion['tipo'], tipo: AlertaCoordinacion['tipo']) =>
  cubre === 'turno_sin_traspaso' && tipo === 'sin_actualizacion';

/**
 * Alertas por atender: las no leídas, una por caso y tipo (la de más horas), primero las más graves
 * y, entre iguales, las más recientes. Un caso con "terminó su turno sin traspaso" no repite su "N h sin
 * actualización".
 */
export function alertasActivas(alertas: AlertaCoordinacion[]): AlertaCoordinacion[] {
  const porCaso = new Map<string, AlertaCoordinacion>();
  for (const a of alertas) {
    if (a.leida) continue;
    const clave = `${a.casoId}|${a.tipo}`;
    const actual = porCaso.get(clave);
    if (!actual || (a.nivel ?? 0) > (actual.nivel ?? 0)) porCaso.set(clave, a);
  }
  const tipos = new Map<string, Set<AlertaCoordinacion['tipo']>>();
  for (const a of porCaso.values()) tipos.set(a.casoId, (tipos.get(a.casoId) ?? new Set()).add(a.tipo));
  return [...porCaso.values()]
    .filter((a) => ![...tipos.get(a.casoId)!].some((otro) => laCubre(otro, a.tipo)))
    .sort(
    (a, b) => pesoDeAlerta(b) - pesoDeAlerta(a) || b.creadoEn.localeCompare(a.creadoEn)
  );
}

/** Orden de las alertas: un turno que terminó sin traspaso va primero (el caso no tiene a nadie). */
function pesoDeAlerta(alerta: Pick<AlertaCoordinacion, 'tipo' | 'nivel'>): number {
  return alerta.tipo === 'turno_sin_traspaso' ? 100 : (alerta.nivel ?? 0);
}

/**
 * Ids de las alertas no leídas del mismo caso y tipo (al atender una se marcan todas), más las que esa alerta
 * ocultaba (las "sin actualización" de un caso sin traspaso).
 */
export function alertasHermanas(alertas: AlertaCoordinacion[], alerta: AlertaCoordinacion): string[] {
  return alertas
    .filter((a) => !a.leida && a.casoId === alerta.casoId && (a.tipo === alerta.tipo || laCubre(alerta.tipo, a.tipo)))
    .map((a) => a.id);
}

/** Gravedad visual de una alerta. */
export function gravedadDeAlerta(alerta: Pick<AlertaCoordinacion, 'tipo' | 'nivel'>): 'aviso' | 'alta' | 'critica' {
  if (alerta.tipo === 'turno_sin_traspaso') return 'critica';
  if (alerta.tipo !== 'sin_actualizacion') return 'aviso';
  return alerta.nivel === 6 ? 'critica' : alerta.nivel === 4 ? 'alta' : 'aviso';
}
