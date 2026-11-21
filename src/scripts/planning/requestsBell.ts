/**
 * Campana del dispatch: respuestas de coordinación a sus solicitudes para editar la planificación.
 * Al abrir una se marca vista y se lleva a la planificación de ese día.
 */
import { describirRespuesta, respuestasSinVer } from '../../domain/planningRequests';
import { appStore } from '../../state/appStore';
import type { SolicitudPlanificacion } from '../../types/noc';
import { marcarVistas } from '../actions/planningRequestActions';
import { byId, crearElemento } from '../dom';
import { formatearFechaHora } from '../ui/format';

/** Respuestas que se muestran en la campana (las vistas también, como historial corto). */
const RESPUESTAS_EN_LISTA = 10;

let alAbrir: (fecha: string) => void = () => undefined;

const panelAbierto = () => !byId('requestsPanel').classList.contains('hidden');

function alternarPanel(abrir = !panelAbierto()): void {
  byId('requestsPanel').classList.toggle('hidden', !abrir);
  byId('btnRequests').setAttribute('aria-expanded', String(abrir));
}

function crearItem(s: SolicitudPlanificacion): HTMLLIElement {
  const item = crearElemento('li', `notif__item${s.respuestaVista ? '' : ' is-unread'}`);
  const boton = crearElemento('button', 'notif__link');
  boton.type = 'button';
  boton.dataset.solicitudId = s.id;
  boton.append(crearElemento('span', 'notif__text', describirRespuesta(s)), crearElemento('span', 'notif__time', formatearFechaHora(s.resueltaEn ?? s.creadaEn)));
  item.append(boton);
  return item;
}

function pintar(): void {
  const { solicitudes } = appStore.get();
  const sinVer = respuestasSinVer(solicitudes).length;
  const contador = byId('requestsCount');
  contador.textContent = sinVer > 99 ? '99+' : String(sinVer);
  contador.classList.toggle('hidden', sinVer === 0);
  byId('btnRequests').setAttribute('aria-label', sinVer > 0 ? `Respuestas de coordinación: ${sinVer} sin ver` : 'Respuestas de coordinación');

  const respondidas = solicitudes
    .filter((s) => s.estado !== 'pendiente')
    .sort((a, b) => (b.resueltaEn ?? '').localeCompare(a.resueltaEn ?? ''))
    .slice(0, RESPUESTAS_EN_LISTA);
  byId('requestsList').replaceChildren(
    ...(respondidas.length === 0 ? [crearElemento('li', 'notif__empty', 'Coordinación aún no ha respondido solicitudes.')] : respondidas.map(crearItem))
  );
}

export function iniciarCampanaDeSolicitudes(abrirPlanificacion: (fecha: string) => void): void {
  alAbrir = abrirPlanificacion;
  byId('btnRequests').addEventListener('click', (evento) => {
    evento.stopPropagation();
    alternarPanel();
  });
  byId('requestsPanel').addEventListener('click', (evento) => evento.stopPropagation());
  document.addEventListener('click', () => panelAbierto() && alternarPanel(false));
  document.addEventListener('keydown', (evento) => evento.key === 'Escape' && panelAbierto() && alternarPanel(false));
  byId('btnRequestsReadAll').addEventListener('click', () => void marcarVistas(respuestasSinVer(appStore.get().solicitudes).map((s) => s.id)));
  byId('requestsList').addEventListener('click', (evento) => {
    const boton = evento.target instanceof Element ? evento.target.closest<HTMLElement>('[data-solicitud-id]') : null;
    const solicitud = appStore.get().solicitudes.find((s) => s.id === boton?.dataset.solicitudId);
    if (!solicitud) return;
    if (!solicitud.respuestaVista) void marcarVistas([solicitud.id]);
    alternarPanel(false);
    alAbrir(solicitud.fecha);
  });

  appStore.subscribe(pintar);
  pintar();
}
