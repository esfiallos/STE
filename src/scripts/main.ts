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
import { codigoDeAlerta } from './actions/coordinationActions';
import { buscarCaso, iniciarBuscadorDeCasos } from './caseSearch/caseSearchView';
import { iniciarCampanaDeAlertas } from './coordination/alertsBell';
import { cargarPanel, iniciarPanelDeCoordinacion } from './coordination/coordinatorPanel';
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
import { iniciarSeguimiento, renderizarSeguimiento, resaltarCaso } from './followUp/followUpView';
import { abrirTraspaso, iniciarTraspaso } from './handover/handoverView';
import { cargarMisTraspasos, iniciarMisTraspasos } from './handover/myHandoversView';
import { iniciarNotificaciones } from './notifications/notificationsPanel';
import { cargarSolicitudes } from './actions/planningRequestActions';
import { cargarPlanificacion, iniciarPlanificacion, mostrarSemanaDe } from './planning/planningView';
import { iniciarAvisoDeSolicitudes } from './planning/planningRequestsSync';
import { iniciarCampanaDeSolicitudes } from './planning/requestsBell';
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
  const esCoordinador = perfil.data.rol === 'coordinador';
  const esTecnico = perfil.data.rol === 'tecnico';
  /** Técnico enlazado a su fila de `tecnicos`: tiene Seguimiento, Traspaso y notificaciones. */
  const miTecnicoId = esTecnico ? perfil.data.tecnicoId : null;
  appStore.set({ perfil: perfil.data, soloLectura: !esDispatch });
  document.body.classList.toggle('solo-lectura', !esDispatch);
  document.body.classList.toggle('rol-tecnico', miTecnicoId !== null);
  document.body.classList.toggle('rol-dispatch', esDispatch);
  document.body.classList.toggle('rol-coordinador', esCoordinador);
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
  if (esDispatch || esCoordinador) {
    iniciarPlanificacion();
    iniciarAvisoDeSolicitudes();
  }
  const abrirPlanificacionEn = (fecha: string) => {
    window.location.hash = 'planificacion';
    mostrarSemanaDe(fecha);
  };
  if (esDispatch) iniciarCampanaDeSolicitudes(abrirPlanificacionEn);
  if (miTecnicoId) {
    iniciarSeguimiento(miTecnicoId);
    iniciarTraspaso(miTecnicoId);
    iniciarMisTraspasos(miTecnicoId);
    iniciarNotificaciones(miTecnicoId, (casoId) => {
      window.location.hash = 'seguimiento';
      window.setTimeout(() => resaltarCaso(casoId), 50);
    });
  } else if (esTecnico) {
    mostrarAviso('Tu usuario técnico no está enlazado a un técnico: pide al administrador que complete tu perfil.', 'error');
  }

  if (esDispatch || esCoordinador) iniciarBuscadorDeCasos();
  if (esCoordinador) {
    iniciarPanelDeCoordinacion();
    iniciarCampanaDeAlertas(
      (alerta) => {
        window.location.hash = 'busqueda';
        void buscarCaso(codigoDeAlerta(alerta));
      },
      (solicitud) => abrirPlanificacionEn(solicitud.fecha)
    );
  }

  appStore.subscribe(solicitarRender);
  solicitarRender();

  iniciarSincronizacion();
  void cargarDatos();
  window.setInterval(refrescarPorLaHora, REFRESCO_DE_HORA_MS);

  iniciarPestanas(
    {
      ...(esCoordinador ? { panel: () => void cargarPanel() } : {}),
      tablero: () => undefined,
      ...(esDispatch || esCoordinador ? { busqueda: () => byId('caseSearchInput').focus() } : {}),
      ...(miTecnicoId
        ? { seguimiento: renderizarSeguimiento, traspaso: abrirTraspaso, misTraspasos: () => void cargarMisTraspasos() }
        : {}),
      ...(esDispatch || esCoordinador
        ? {
            planificacion: () => {
              void cargarPlanificacion();
              void cargarSolicitudes();
            }
          }
        : {}),
      historial: () => void cargarHistorial(),
      bitacora: () => void cargarBitacora()
    },
    miTecnicoId ? 'seguimiento' : esCoordinador ? 'panel' : 'tablero'
  );
}

void iniciar();
