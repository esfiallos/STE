/**
 * Solicitudes de planificación (dispatch y coordinación): carga inicial, tiempo real e insignia de la pestaña.
 * Cada cambio en la tabla se relee y se avisa de lo nuevo (solicitud que llega / respuesta que llega).
 */
import { respuestasSinVer, solicitudesPorResponder } from '../../domain/planningRequests';
import { fechaOperativa } from '../../domain/time';
import { suscribirSolicitudes } from '../../services/solicitudesRepo';
import { appStore } from '../../state/appStore';
import { cargarSolicitudes } from '../actions/planningRequestActions';
import { byId } from '../dom';

/** Agrupa ráfagas de cambios (aprobar = un update) en una sola relectura. */
const ESPERA_MS = 200;

function pintarInsignia(): void {
  const { solicitudes, perfil } = appStore.get();
  const total =
    perfil?.rol === 'coordinador'
      ? solicitudesPorResponder(solicitudes, fechaOperativa(new Date())).length
      : respuestasSinVer(solicitudes).length;
  const insignia = byId('planningBadge');
  insignia.textContent = String(total);
  insignia.classList.toggle('hidden', total === 0);
}

export function iniciarAvisoDeSolicitudes(): () => void {
  let temporizador: number | undefined;
  appStore.subscribe(pintarInsignia);
  pintarInsignia();
  void cargarSolicitudes();
  return suscribirSolicitudes(() => {
    window.clearTimeout(temporizador);
    temporizador = window.setTimeout(() => void cargarSolicitudes(true), ESPERA_MS);
  });
}
