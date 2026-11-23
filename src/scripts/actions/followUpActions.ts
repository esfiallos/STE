import { actualizarSeguimiento, marcarActualizado, type CambiosDeSeguimiento } from '../../services/casosRepo';
import { marcarLeida, marcarTodasLeidas } from '../../services/notificacionesRepo';
import { appStore } from '../../state/appStore';
import { cargarDatos } from '../../state/sync';
import { exito, type Resultado } from '../../types/result';
import { copiarAlPortapapeles } from '../ui/clipboard';
import { reproducirSonido } from '../ui/sound';
import { mostrarAviso } from '../ui/toast';

/** El técnico actualiza estado, etiqueta, área, empresa o descripción de uno de sus casos. */
export async function guardarSeguimiento(casoId: string, cambios: CambiosDeSeguimiento): Promise<Resultado> {
  const resultado = await actualizarSeguimiento(casoId, cambios);
  if (resultado.ok) await cargarDatos();
  return resultado;
}

/** Botón "Actualizado" (D19): marca la fecha de última actualización sin cambiar nada más. */
export async function marcarCasoActualizado(casoId: string): Promise<Resultado> {
  const resultado = await marcarActualizado(casoId);
  if (!resultado.ok) return resultado;
  await cargarDatos();
  return exito();
}

export async function copiarTexto(texto: string, descripcion: string): Promise<void> {
  if (await copiarAlPortapapeles(texto)) {
    reproducirSonido('copiar');
    mostrarAviso(`${descripcion} copiado al portapapeles.`, 'exito');
  } else {
    mostrarAviso('No se pudo copiar. Selecciona el texto y usa Ctrl+C.', 'error');
  }
}

/** Marca una notificación como leída (primero en pantalla, luego en la base). */
export async function leerNotificacion(id: string): Promise<void> {
  const { notificaciones } = appStore.get();
  if (!notificaciones.some((n) => n.id === id && !n.leida)) return;
  appStore.set({ notificaciones: notificaciones.map((n) => (n.id === id ? { ...n, leida: true } : n)) });
  const resultado = await marcarLeida(id);
  if (!resultado.ok) mostrarAviso(resultado.error, 'error');
}

export async function leerTodasLasNotificaciones(tecnicoId: string): Promise<void> {
  const { notificaciones } = appStore.get();
  if (!notificaciones.some((n) => !n.leida)) return;
  appStore.set({ notificaciones: notificaciones.map((n) => ({ ...n, leida: true })) });
  const resultado = await marcarTodasLeidas(tecnicoId);
  if (!resultado.ok) mostrarAviso(resultado.error, 'error');
}
