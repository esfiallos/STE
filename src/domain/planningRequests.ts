import type { Rol, SolicitudPlanificacion } from '../types/noc';

/** Igual que el check de `solicitudes_planificacion.motivo` (sql/10). */
export const MAX_MOTIVO_SOLICITUD = 500;

/** "2026-11-10" → "10/11". */
const diaYMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;

const vigente = (s: SolicitudPlanificacion, ahora: Date) =>
  s.estado === 'aprobada' && s.venceEn !== null && new Date(s.venceEn).getTime() > ahora.getTime();

/** Aprobación vigente para ese día (la base habilita al dispatch con ella). */
export function aprobacionVigente(fecha: string, solicitudes: readonly SolicitudPlanificacion[], ahora: Date): SolicitudPlanificacion | undefined {
  return solicitudes.find((s) => s.fecha === fecha && vigente(s, ahora));
}

export function solicitudPendiente(fecha: string, solicitudes: readonly SolicitudPlanificacion[]): SolicitudPlanificacion | undefined {
  return solicitudes.find((s) => s.fecha === fecha && s.estado === 'pendiente');
}

export interface ContextoDePlanificacion {
  rol: Rol | undefined;
  /** Día operativo en curso. */
  hoy: string;
  ahora: Date;
  solicitudes: readonly SolicitudPlanificacion[];
}

/**
 * Misma regla que `puede_planificar()` (sql/10): nadie toca días pasados (D15); coordinación planifica de hoy en
 * adelante y el dispatch solo los días con una aprobación vigente (D14).
 */
export function diaEditable(fecha: string, { rol, hoy, ahora, solicitudes }: ContextoDePlanificacion): boolean {
  if (fecha < hoy) return false;
  if (rol === 'coordinador') return true;
  return rol === 'dispatch' && aprobacionVigente(fecha, solicitudes, ahora) !== undefined;
}

export type EstadoDelDia = 'pasado' | 'habilitado' | 'pendiente' | 'bloqueado';

/** Cómo ve el dispatch un día de la planificación. */
export function estadoDelDia(fecha: string, contexto: ContextoDePlanificacion): EstadoDelDia {
  if (fecha < contexto.hoy) return 'pasado';
  if (aprobacionVigente(fecha, contexto.solicitudes, contexto.ahora)) return 'habilitado';
  if (solicitudPendiente(fecha, contexto.solicitudes)) return 'pendiente';
  return 'bloqueado';
}

/** Lo mismo que valida `solicitar_edicion_planificacion()`; null si se puede enviar. */
export function problemaDeSolicitud(fecha: string, motivo: string, contexto: Omit<ContextoDePlanificacion, 'rol'>): string | null {
  if (!fecha) return 'Indica el día que quieres editar.';
  if (fecha < contexto.hoy) return `El ${diaYMes(fecha)} ya pasó: los días pasados no se planifican.`;
  const texto = motivo.trim();
  if (!texto) return 'Indica el motivo de la solicitud.';
  if (texto.length > MAX_MOTIVO_SOLICITUD) return `El motivo no puede pasar de ${MAX_MOTIVO_SOLICITUD} caracteres.`;
  if (aprobacionVigente(fecha, contexto.solicitudes, contexto.ahora)) return `El ${diaYMes(fecha)} ya está habilitado para editar.`;
  if (solicitudPendiente(fecha, contexto.solicitudes)) return `Ya hay una solicitud pendiente para el ${diaYMes(fecha)}.`;
  return null;
}

/** Lo que coordinación tiene por responder (los días pasados ya no se pueden aprobar). La más antigua primero. */
export function solicitudesPorResponder(solicitudes: readonly SolicitudPlanificacion[], hoy: string): SolicitudPlanificacion[] {
  return solicitudes.filter((s) => s.estado === 'pendiente' && s.fecha >= hoy).sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));
}

/** Respuestas que el dispatch aún no ha visto. La más reciente primero. */
export function respuestasSinVer(solicitudes: readonly SolicitudPlanificacion[]): SolicitudPlanificacion[] {
  return solicitudes
    .filter((s) => s.estado !== 'pendiente' && !s.respuestaVista)
    .sort((a, b) => (b.resueltaEn ?? '').localeCompare(a.resueltaEn ?? ''));
}

/** Texto para coordinación: quién pide qué día y por qué. */
export function describirSolicitud(s: SolicitudPlanificacion): string {
  return `${s.solicitanteNombre ?? 'Dispatch'} pide editar la planificación del ${diaYMes(s.fecha)}: ${s.motivo}`;
}

/** Texto para el dispatch con la respuesta de coordinación. */
export function describirRespuesta(s: SolicitudPlanificacion): string {
  const quien = s.resueltaPorNombre ?? 'Coordinación';
  const base =
    s.estado === 'aprobada'
      ? `${quien} aprobó editar el ${diaYMes(s.fecha)} (hasta las 06:00)`
      : s.estado === 'rechazada'
        ? `${quien} rechazó editar el ${diaYMes(s.fecha)}`
        : `Solicitud del ${diaYMes(s.fecha)} pendiente`;
  return s.respuesta ? `${base}: ${s.respuesta}` : `${base}.`;
}

/**
 * Compara dos lecturas de las solicitudes y devuelve lo que merece aviso:
 * para coordinación, las nuevas pendientes; para el dispatch, las que acaban de responderse.
 */
export function novedadesDeSolicitudes(
  antes: readonly SolicitudPlanificacion[],
  ahora: readonly SolicitudPlanificacion[],
  rol: Rol | undefined
): SolicitudPlanificacion[] {
  const previas = new Map(antes.map((s) => [s.id, s]));
  if (rol === 'coordinador') return ahora.filter((s) => s.estado === 'pendiente' && !previas.has(s.id));
  if (rol === 'dispatch') return ahora.filter((s) => s.estado !== 'pendiente' && previas.get(s.id)?.estado === 'pendiente');
  return [];
}
