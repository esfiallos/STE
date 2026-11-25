/**
 * Avisos de cambios en la planificación (dispatch y coordinación): carga inicial, tiempo real e insignia de la
 * pestaña (solo coordinación: avisos sin ver). Cada cambio en la tabla se relee y coordinación recibe lo nuevo.
 */
import { avisosSinVer } from '../../domain/planningNotices';
import { suscribirAvisos } from '../../services/avisosPlanificacionRepo';
import { appStore } from '../../state/appStore';
import { cargarAvisos } from '../actions/planningNoticeActions';
import { byId } from '../dom';

/** Agrupa ráfagas de cambios (varias celdas seguidas) en una sola relectura. */
const ESPERA_MS = 300;

function pintarInsignia(): void {
  const { avisos, perfil } = appStore.get();
  const total = perfil?.rol === 'coordinador' ? avisosSinVer(avisos).length : 0;
  const insignia = byId('planningBadge');
  insignia.textContent = String(total);
  insignia.classList.toggle('hidden', total === 0);
}

export function iniciarAvisosDePlanificacion(): () => void {
  let temporizador: number | undefined;
  appStore.subscribe(pintarInsignia);
  pintarInsignia();
  void cargarAvisos();
  return suscribirAvisos(() => {
    window.clearTimeout(temporizador);
    temporizador = window.setTimeout(() => void cargarAvisos(true), ESPERA_MS);
  });
}
