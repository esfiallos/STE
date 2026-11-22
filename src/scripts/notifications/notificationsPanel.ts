import { contarNoLeidas, describirNotificacion } from '../../domain/followUp';
import { listarNotificaciones, suscribirNotificaciones } from '../../services/notificacionesRepo';
import { appStore } from '../../state/appStore';
import { solicitarSincronizacion } from '../../state/sync';
import type { Notificacion } from '../../types/noc';
import { leerNotificacion, leerTodasLasNotificaciones } from '../actions/followUpActions';
import { byId, crearElemento } from '../dom';
import { formatearFechaHora } from '../ui/format';
import { reproducirSonido } from '../ui/sound';
import { mostrarAviso } from '../ui/toast';
import { animarEntrada } from '../ui/animacion';

let alAbrirCaso: (casoId: string) => void = () => undefined;

function panelAbierto(): boolean {
  return !byId('notifPanel').classList.contains('hidden');
}

function alternarPanel(abrir = !panelAbierto()): void {
  const panel = byId('notifPanel');
  const estabaAbierto = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !abrir);
  if (abrir && !estabaAbierto) void animarEntrada(panel, 'arriba');
  byId('btnNotifications').setAttribute('aria-expanded', String(abrir));
}

function pintar(): void {
  const { notificaciones } = appStore.get();
  const noLeidas = contarNoLeidas(notificaciones);

  const contador = byId('notifCount');
  contador.textContent = noLeidas > 99 ? '99+' : String(noLeidas);
  contador.classList.toggle('hidden', noLeidas === 0);
  byId('btnNotifications').setAttribute('aria-label', noLeidas > 0 ? `Notificaciones: ${noLeidas} sin leer` : 'Notificaciones');

  const lista = byId('notifList');
  if (notificaciones.length === 0) {
    lista.replaceChildren(crearElemento('li', 'notif__empty', 'Sin notificaciones por ahora.'));
  } else {
    lista.replaceChildren(
      ...notificaciones.map((n) => {
        const item = crearElemento('li', `notif__item${n.leida ? '' : ' is-unread'}`);
        const boton = crearElemento('button', 'notif__link');
        boton.type = 'button';
        boton.dataset.notificacionId = n.id;
        if (n.casoId) boton.dataset.casoId = n.casoId;
        boton.append(crearElemento('span', 'notif__text', describirNotificacion(n)), crearElemento('span', 'notif__time', formatearFechaHora(n.creadoEn)));
        item.append(boton);
        return item;
      })
    );
  }

  const escritorio = byId('btnNotifDesktop');
  escritorio.classList.toggle('hidden', !('Notification' in window) || Notification.permission !== 'default');
}

/** Alerta de escritorio solo si la pestaña no está a la vista y el técnico la autorizó. */
function alertaDeEscritorio(texto: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  try {
    new Notification('Panel NOC', { body: texto, tag: 'panel-noc' });
  } catch {
    // Algunos navegadores solo permiten notificaciones desde un service worker: basta con el aviso en pantalla.
  }
}

/** Llega una notificación nueva (tiempo real): se agrega, suena, se avisa y la campana "salta". */
export function recibirNotificacion(notificacion: Notificacion): void {
  const { notificaciones } = appStore.get();
  if (notificaciones.some((n) => n.id === notificacion.id)) return;
  appStore.set({ notificaciones: [notificacion, ...notificaciones] });

  const texto = describirNotificacion(notificacion);
  reproducirSonido('notificacion');
  mostrarAviso(texto, 'info');
  alertaDeEscritorio(texto);

  const campana = byId('btnNotifications');
  campana.classList.remove('is-ringing');
  void campana.offsetWidth;
  campana.classList.add('is-ringing');
  solicitarSincronizacion(); // el caso nuevo aparece en el tablero y en el seguimiento
}

export async function cargarNotificaciones(): Promise<void> {
  const resultado = await listarNotificaciones();
  if (resultado.ok) appStore.set({ notificaciones: resultado.data });
}

/** Campana de notificaciones del técnico. `abrirCaso` lleva al caso en su seguimiento. */
export function iniciarNotificaciones(tecnicoId: string, abrirCaso: (casoId: string) => void): () => void {
  alAbrirCaso = abrirCaso;

  byId('btnNotifications').addEventListener('click', (evento) => {
    evento.stopPropagation();
    alternarPanel();
  });
  byId('notifPanel').addEventListener('click', (evento) => evento.stopPropagation());
  document.addEventListener('click', () => panelAbierto() && alternarPanel(false));
  document.addEventListener('keydown', (evento) => evento.key === 'Escape' && panelAbierto() && alternarPanel(false));

  byId('notifList').addEventListener('click', (evento) => {
    const boton = evento.target instanceof Element ? evento.target.closest<HTMLElement>('[data-notificacion-id]') : null;
    if (!boton?.dataset.notificacionId) return;
    void leerNotificacion(boton.dataset.notificacionId);
    // Un caso cancelado ya no existe: solo se marca como leída.
    if (!boton.dataset.casoId) return;
    alternarPanel(false);
    alAbrirCaso(boton.dataset.casoId);
  });
  byId('btnNotifReadAll').addEventListener('click', () => void leerTodasLasNotificaciones(tecnicoId));
  byId('btnNotifDesktop').addEventListener('click', async () => {
    if ('Notification' in window) await Notification.requestPermission();
    pintar();
  });

  appStore.subscribe(pintar);
  pintar();
  void cargarNotificaciones();
  return suscribirNotificaciones(tecnicoId, recibirNotificacion);
}
