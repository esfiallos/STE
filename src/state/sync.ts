import { casosDelTablero, tecnicosDelDia } from '../domain/assignments';
import { fechaOperativa } from '../domain/time';
import { listarCasosAbiertos } from '../services/casosRepo';
import { listarJornadas } from '../services/jornadasRepo';
import { suscribirCambios } from '../services/realtime';
import { listarTecnicos } from '../services/tecnicosRepo';
import { appStore } from './appStore';

const RETARDO_AGRUPACION_MS = 150;
const INTERVALO_RESPALDO_MS = 60_000;

let ultimaCarga = 0;

/**
 * Lee el catálogo, las jornadas del día operativo en curso y los casos abiertos, y actualiza el store.
 * A las 06:00 cambia la fecha operativa y el tablero queda limpio solo (sin borrar nada).
 * Si llegan respuestas desordenadas, gana la más reciente.
 */
export async function cargarDatos(): Promise<void> {
  const numeroDeCarga = ++ultimaCarga;
  const fecha = fechaOperativa(new Date());
  const [catalogo, jornadas, casos] = await Promise.all([listarTecnicos(), listarJornadas(fecha, fecha), listarCasosAbiertos()]);
  if (numeroDeCarga !== ultimaCarga) return;

  if (!catalogo.ok || !jornadas.ok || !casos.ok) {
    const motivo = [catalogo, jornadas, casos].map((r) => (r.ok ? '' : r.error)).find(Boolean) ?? '';
    appStore.set({ carga: 'error', errorCarga: `No se pudo actualizar el tablero. ${motivo}` });
    return;
  }

  appStore.set({
    fechaOperativa: fecha,
    catalogo: catalogo.data,
    tecnicos: tecnicosDelDia(catalogo.data, jornadas.data),
    incidentes: casosDelTablero(casos.data, fecha),
    carga: 'listo',
    errorCarga: null
  });
}

let temporizador: number | undefined;

/** Agrupa avisos seguidos (varios eventos Realtime juntos) en una sola lectura. */
export function solicitarSincronizacion(): void {
  window.clearTimeout(temporizador);
  temporizador = window.setTimeout(() => void cargarDatos(), RETARDO_AGRUPACION_MS);
}

/**
 * Mantiene el tablero al día: Realtime como vía principal, y como respaldo
 * una lectura periódica y otra al volver a la pestaña o recuperar la red.
 */
export function iniciarSincronizacion(): () => void {
  const cancelarRealtime = suscribirCambios(solicitarSincronizacion, (conexion) => {
    appStore.set({ conexion });
    if (conexion === 'conectado') solicitarSincronizacion();
  });

  const alVolverALaPestana = () => {
    if (document.visibilityState === 'visible') solicitarSincronizacion();
  };

  const respaldo = window.setInterval(solicitarSincronizacion, INTERVALO_RESPALDO_MS);
  document.addEventListener('visibilitychange', alVolverALaPestana);
  window.addEventListener('online', solicitarSincronizacion);

  return () => {
    cancelarRealtime();
    window.clearInterval(respaldo);
    document.removeEventListener('visibilitychange', alVolverALaPestana);
    window.removeEventListener('online', solicitarSincronizacion);
  };
}
