/**
 * Campana del coordinador: alertas por casos sin actualización (2/4/6 h), recordatorios sin turno y
 * solicitudes del dispatch para editar la planificación. Las alertas llegan en tiempo real (alertas_coordinacion);
 * al abrir una se marca atendida y se abre el caso. Una solicitud lleva a la planificación de ese día.
 */
import { alertasActivas, describirAlerta, gravedadDeAlerta } from '../../domain/coordination';
import { describirSolicitud, solicitudesPorResponder } from '../../domain/planningRequests';
import { fechaOperativa } from '../../domain/time';
import { suscribirAlertas } from '../../services/coordinacionRepo';
import { appStore } from '../../state/appStore';
import type { AlertaCoordinacion, SolicitudPlanificacion } from '../../types/noc';
import { atenderAlerta, atenderTodas, cargarAlertas } from '../actions/coordinationActions';
import { byId, crearElemento } from '../dom';
import { formatearFechaHora } from '../ui/format';
import { reproducirSonido } from '../ui/sound';
import { mostrarAviso } from '../ui/toast';

let alAbrir: (alerta: AlertaCoordinacion) => void = () => undefined;
let alAbrirSolicitud: (solicitud: SolicitudPlanificacion) => void = () => undefined;

const panelAbierto = () => !byId('alertsPanel').classList.contains('hidden');

function alternarPanel(abrir = !panelAbierto()): void {
  byId('alertsPanel').classList.toggle('hidden', !abrir);
  byId('btnAlerts').setAttribute('aria-expanded', String(abrir));
}

/** Una alerta como botón (campana y panel principal usan el mismo). */
export function crearBotonDeAlerta(alerta: AlertaCoordinacion): HTMLButtonElement {
  const boton = crearElemento('button', `notif__link alerta alerta--${gravedadDeAlerta(alerta)}`);
  boton.type = 'button';
  boton.dataset.alertaId = alerta.id;
  boton.append(crearElemento('span', 'notif__text', describirAlerta(alerta)), crearElemento('span', 'notif__time', formatearFechaHora(alerta.creadoEn)));
  return boton;
}

function crearBotonDeSolicitud(solicitud: SolicitudPlanificacion): HTMLButtonElement {
  const boton = crearElemento('button', 'notif__link alerta alerta--solicitud');
  boton.type = 'button';
  boton.dataset.solicitudId = solicitud.id;
  boton.append(
    crearElemento('span', 'notif__text', describirSolicitud(solicitud)),
    crearElemento('span', 'notif__time', formatearFechaHora(solicitud.creadaEn))
  );
  return boton;
}

function pintar(): void {
  const { alertas, solicitudes } = appStore.get();
  const activas = alertasActivas(alertas);
  const pendientes = solicitudesPorResponder(solicitudes, fechaOperativa(new Date()));
  const total = activas.length + pendientes.length;
  const contador = byId('alertsCount');
  contador.textContent = total > 99 ? '99+' : String(total);
  contador.classList.toggle('hidden', total === 0);
  byId('btnAlerts').setAttribute('aria-label', total > 0 ? `Alertas: ${total} por atender` : 'Alertas de coordinación');

  const enLista = (boton: HTMLButtonElement) => {
    const item = crearElemento('li', 'notif__item is-unread');
    item.append(boton);
    return item;
  };
  byId('alertsList').replaceChildren(
    ...(total === 0
      ? [crearElemento('li', 'notif__empty', 'Sin alertas por atender.')]
      : [...pendientes.map((s) => enLista(crearBotonDeSolicitud(s))), ...activas.map((a) => enLista(crearBotonDeAlerta(a)))])
  );
}

function recibirAlerta(alerta: AlertaCoordinacion): void {
  const { alertas } = appStore.get();
  if (alertas.some((a) => a.id === alerta.id)) return;
  appStore.set({ alertas: [alerta, ...alertas] });
  const texto = describirAlerta(alerta);
  reproducirSonido('notificacion');
  mostrarAviso(texto, gravedadDeAlerta(alerta) === 'critica' ? 'error' : 'info');
  if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    try {
      new Notification('Panel NOC · Coordinación', { body: texto, tag: 'panel-noc-alertas' });
    } catch {
      // Basta con el aviso en pantalla.
    }
  }
  const campana = byId('btnAlerts');
  campana.classList.remove('is-ringing');
  void campana.offsetWidth;
  campana.classList.add('is-ringing');
}

/** Abre la alerta pulsada (en la campana o en el panel): la marca atendida y lleva al caso. */
export function abrirAlertaPulsada(evento: Event): void {
  const deSolicitud = evento.target instanceof Element ? evento.target.closest<HTMLElement>('[data-solicitud-id]') : null;
  const solicitud = appStore.get().solicitudes.find((s) => s.id === deSolicitud?.dataset.solicitudId);
  if (solicitud) {
    alternarPanel(false);
    alAbrirSolicitud(solicitud);
    return;
  }
  const boton = evento.target instanceof Element ? evento.target.closest<HTMLElement>('[data-alerta-id]') : null;
  const alerta = appStore.get().alertas.find((a) => a.id === boton?.dataset.alertaId);
  if (!alerta) return;
  void atenderAlerta(alerta);
  alternarPanel(false);
  alAbrir(alerta);
}

export function iniciarCampanaDeAlertas(
  abrirCaso: (alerta: AlertaCoordinacion) => void,
  abrirSolicitud: (solicitud: SolicitudPlanificacion) => void = () => undefined
): () => void {
  alAbrir = abrirCaso;
  alAbrirSolicitud = abrirSolicitud;
  byId('btnAlerts').addEventListener('click', (evento) => {
    evento.stopPropagation();
    alternarPanel();
  });
  byId('alertsPanel').addEventListener('click', (evento) => evento.stopPropagation());
  document.addEventListener('click', () => panelAbierto() && alternarPanel(false));
  document.addEventListener('keydown', (evento) => evento.key === 'Escape' && panelAbierto() && alternarPanel(false));
  byId('alertsList').addEventListener('click', abrirAlertaPulsada);
  byId('btnAlertsReadAll').addEventListener('click', () => void atenderTodas());

  appStore.subscribe(pintar);
  pintar();
  void cargarAlertas();
  return suscribirAlertas(recibirAlerta);
}
