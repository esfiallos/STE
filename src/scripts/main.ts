/**
 * Punto de entrada del panel (/): comprueba la sesión, conecta las funciones
 * y arranca la sincronización. Aquí solo se orquesta; la lógica vive en cada módulo.
 */
import { appStore } from '../state/appStore';
import { cargarDatos, iniciarSincronizacion } from '../state/sync';
import { obtenerSesion } from '../services/authService';
import { iniciarEventosDelTablero } from './board/boardEvents';
import { iniciarDragAndDrop } from './board/dragAndDrop';
import { aplicarRenderPendiente, solicitarRender } from './board/renderScheduler';
import { byId } from './dom';
import { iniciarEstadoDeConexion } from './features/connectionStatus';
import { iniciarAccionesDeCabecera } from './features/headerActions';
import { iniciarModoConsulta } from './features/readOnlyMode';
import { iniciarBuscador } from './features/search';
import { iniciarSesionDeUsuario } from './features/session';
import { iniciarSnapshot } from './features/snapshot';
import { iniciarModalAsignar } from './modals/assignIncidentModal';
import { iniciarModalAlmuerzo } from './modals/lunchModal';
import { iniciarModales } from './modals/modal';
import { iniciarModalTecnicos } from './modals/techniciansModal';
import { RUTAS } from './routes';

/** Los indicadores "en almuerzo" y "en turno" dependen de la hora: se refrescan solos. */
const REFRESCO_DE_HORA_MS = 30_000;

async function iniciar(): Promise<void> {
  const sesion = await obtenerSesion();
  if (!sesion) {
    window.location.replace(RUTAS.login);
    return;
  }
  byId('appRoot').classList.remove('hidden');

  iniciarSesionDeUsuario(sesion.user.email);
  iniciarModales();
  iniciarModalAsignar();
  iniciarModalAlmuerzo();
  iniciarModalTecnicos();
  iniciarAccionesDeCabecera();
  iniciarBuscador();
  iniciarModoConsulta();
  iniciarSnapshot();
  iniciarEstadoDeConexion();
  iniciarEventosDelTablero();
  iniciarDragAndDrop(aplicarRenderPendiente);

  appStore.subscribe(solicitarRender);
  solicitarRender();

  iniciarSincronizacion();
  void cargarDatos();
  window.setInterval(solicitarRender, REFRESCO_DE_HORA_MS);
}

void iniciar();
