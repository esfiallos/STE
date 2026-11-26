/**
 * Cuándo volver a leer los datos por si se perdió un aviso de Realtime (relectura de respaldo).
 * Cada relectura baja el catálogo, las jornadas, el tablero del día y todos los casos abiertos; con 10–15 pantallas
 * abiertas todo el día, releer cada minuto sin necesidad consumía casi todo el Egress de Supabase.
 */
import type { EstadoConexion } from '../types/noc';

/** Cada cuánto se revisa si toca releer. */
export const REVISION_DE_RESPALDO_MS = 60_000;

/** Con Realtime conectado, los cambios llegan solos: solo se relee por seguridad cada 5 minutos. */
export const RESPALDO_CON_REALTIME_MS = 5 * 60_000;

/**
 * true si la relectura de respaldo debe ocurrir ahora: siempre que Realtime no esté conectado (no llegan avisos) y,
 * si lo está, cuando pasaron al menos RESPALDO_CON_REALTIME_MS desde la última lectura.
 */
export function tocaRelecturaDeRespaldo(conexion: EstadoConexion, msDesdeLaUltimaLectura: number): boolean {
  if (conexion !== 'conectado') return true;
  return msDesdeLaUltimaLectura >= RESPALDO_CON_REALTIME_MS;
}
