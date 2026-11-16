import { listarIncidentes } from '../services/incidentesRepo';
import { suscribirCambios } from '../services/realtime';
import { listarTecnicos } from '../services/tecnicosRepo';
import { appStore } from './appStore';

const RETARDO_AGRUPACION_MS = 150;
const INTERVALO_RESPALDO_MS = 60_000;

let ultimaCarga = 0;

/** Lee técnicos e incidentes y actualiza el store. Si llegan respuestas desordenadas, gana la más reciente. */
export async function cargarDatos(): Promise<void> {
  const numeroDeCarga = ++ultimaCarga;
  const [tecnicos, incidentes] = await Promise.all([listarTecnicos(), listarIncidentes()]);
  if (numeroDeCarga !== ultimaCarga) return;

  if (!tecnicos.ok || !incidentes.ok) {
    const motivo = !tecnicos.ok ? tecnicos.error : !incidentes.ok ? incidentes.error : '';
    appStore.set({ carga: 'error', errorCarga: `No se pudo actualizar el tablero. ${motivo}` });
    return;
  }

  appStore.set({
    tecnicos: tecnicos.data,
    incidentes: incidentes.data,
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
