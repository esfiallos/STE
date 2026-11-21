import { describirRespuesta, describirSolicitud, novedadesDeSolicitudes, problemaDeSolicitud } from '../../domain/planningRequests';
import { fechaOperativa, sumarDias } from '../../domain/time';
import { listarSolicitudes, marcarRespuestasVistas, resolverSolicitud, solicitarEdicion } from '../../services/solicitudesRepo';
import { appStore } from '../../state/appStore';
import { falla, type Resultado } from '../../types/result';
import { reproducirSonido } from '../ui/sound';
import { mostrarAviso } from '../ui/toast';

/** Se leen las solicitudes de los últimos días (las más viejas ya no habilitan nada). */
const DIAS_DE_HISTORIAL = 14;

let numeroDeCarga = 0;

/**
 * Relee las solicitudes. Con `avisar`, compara con lo que había y avisa de lo nuevo:
 * a coordinación las solicitudes que llegan; al dispatch las respuestas.
 */
export async function cargarSolicitudes(avisar = false): Promise<void> {
  const numero = ++numeroDeCarga;
  const resultado = await listarSolicitudes(sumarDias(fechaOperativa(new Date()), -DIAS_DE_HISTORIAL));
  if (numero !== numeroDeCarga) return;
  if (!resultado.ok) {
    mostrarAviso(resultado.error, 'error');
    return;
  }
  const { solicitudes: antes, perfil } = appStore.get();
  appStore.set({ solicitudes: resultado.data });
  if (!avisar) return;

  const novedades = novedadesDeSolicitudes(antes, resultado.data, perfil?.rol);
  for (const s of novedades) {
    const texto = perfil?.rol === 'coordinador' ? describirSolicitud(s) : describirRespuesta(s);
    mostrarAviso(texto, s.estado === 'rechazada' ? 'error' : 'info');
  }
  if (novedades.length > 0) reproducirSonido('notificacion');
}

/** El dispatch pide permiso a coordinación para editar un día. */
export async function pedirEdicionDeDia(fecha: string, motivo: string): Promise<Resultado> {
  const { solicitudes } = appStore.get();
  const ahora = new Date();
  const problema = problemaDeSolicitud(fecha, motivo, { hoy: fechaOperativa(ahora), ahora, solicitudes });
  if (problema) return falla(problema);

  const resultado = await solicitarEdicion(fecha, motivo);
  if (resultado.ok) {
    mostrarAviso('Solicitud enviada a coordinación.', 'exito');
    await cargarSolicitudes();
  }
  return resultado;
}

/** Coordinación aprueba o rechaza una solicitud (con una respuesta opcional). */
export async function responderSolicitud(id: string, aprobar: boolean, respuesta: string): Promise<Resultado> {
  const resultado = await resolverSolicitud(id, aprobar, respuesta);
  await cargarSolicitudes();
  if (resultado.ok) mostrarAviso(aprobar ? 'Solicitud aprobada: el dispatch ya puede editar ese día.' : 'Solicitud rechazada.', 'exito');
  return resultado;
}

/** El dispatch vio las respuestas: primero en pantalla, luego en la base. */
export async function marcarVistas(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const marcar = new Set(ids);
  appStore.set({ solicitudes: appStore.get().solicitudes.map((s) => (marcar.has(s.id) ? { ...s, respuestaVista: true } : s)) });
  const resultado = await marcarRespuestasVistas(ids);
  if (!resultado.ok) {
    mostrarAviso(resultado.error, 'error');
    await cargarSolicitudes();
  }
}
