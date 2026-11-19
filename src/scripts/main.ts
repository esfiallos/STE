/**
 * Punto de entrada del panel (/): comprueba la sesión y el rol, conecta las funciones
 * y arranca la sincronización. Aquí solo se orquesta; la lógica vive en cada módulo.
 */
import { fechaOperativa } from '../domain/time';
import { obtenerSesion } from '../services/authService';
import { obtenerMiPerfil } from '../services/perfilRepo';
import { appStore } from '../state/appStore';
import { cargarDatos, iniciarSincronizacion } from '../state/sync';
import { cargarBitacora, iniciarBitacora } from './audit/auditView';
import { iniciarEventosDelTablero } from './board/boardEvents';
import { iniciarDragAndDrop } from './board/dragAndDrop';
import { aplicarRenderPendiente, solicitarRender } from './board/renderScheduler';
import { byId } from './dom';
import { iniciarEstadoDeConexion } from './features/connectionStatus';
import { iniciarAccionesDeLaBarra } from './features/headerActions';
import { iniciarBuscador } from './features/search';
import { iniciarSesionDeUsuario, mostrarAvisoSinPerfil } from './features/session';
import { iniciarPestanas } from './features/tabs';
import { iniciarFiltroPorTecnico } from './features/techFilter';
import { cargarHistorial, iniciarHistorial } from './history/historyView';
import { iniciarModalAsignar } from './modals/assignIncidentModal';
import { iniciarModalAlmuerzo } from './modals/lunchModal';
import { iniciarModales } from './modals/modal';
import { iniciarModalTecnicos } from './modals/techniciansModal';
import { cargarPlanificacion, iniciarPlanificacion } from './planning/planningView';
import { RUTAS } from './routes';
import { mostrarAviso } from './ui/toast';

/** Los estados "en almuerzo" y "disponible" dependen de la hora: se refrescan solos. */
const REFRESCO_DE_HORA_MS = 30_000;

/** Redibuja por la hora y, si a las 06:00 cambió el día operativo, vuelve a leer el tablero (queda limpio). */
function refrescarPorLaHora(): void {
  if (fechaOperativa(new Date()) !== appStore.get().fechaOperativa) void cargarDatos();
  solicitarRender();
}

async function iniciar(): Promise<void> {
  const sesion = await obtenerSesion();
  if (!sesion) {
    window.location.replace(RUTAS.login);
    return;
  }

  const perfil = await obtenerMiPerfil(sesion.user.id);
  if (!perfil.ok) {
    mostrarAviso(perfil.error, 'error');
    return;
  }
  if (!perfil.data) {
    mostrarAvisoSinPerfil(sesion.user.email);
    return;
  }

  const esDispatch = perfil.data.rol === 'dispatch';
  appStore.set({ perfil: perfil.data, soloLectura: !esDispatch });
  document.body.classList.toggle('solo-lectura', !esDispatch);
  byId('appRoot').classList.remove('hidden');

  iniciarSesionDeUsuario(sesion.user.email, perfil.data);
  iniciarModales();
  iniciarModalAsignar();
  iniciarModalAlmuerzo();
  iniciarModalTecnicos();
  iniciarAccionesDeLaBarra();
  iniciarBuscador();
  iniciarFiltroPorTecnico();
  iniciarEstadoDeConexion();
  iniciarEventosDelTablero();
  iniciarDragAndDrop(aplicarRenderPendiente);
  iniciarHistorial();
  iniciarBitacora();
  if (esDispatch) iniciarPlanificacion();

  appStore.subscribe(solicitarRender);
  solicitarRender();

  iniciarSincronizacion();
  void cargarDatos();
  window.setInterval(refrescarPorLaHora, REFRESCO_DE_HORA_MS);

  iniciarPestanas({
    tablero: () => undefined,
    ...(esDispatch ? { planificacion: () => void cargarPlanificacion() } : {}),
    historial: () => void cargarHistorial(),
    bitacora: () => void cargarBitacora()
  });
}

void iniciar();
