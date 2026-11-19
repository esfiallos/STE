import { appStore } from '../../state/appStore';
import { byId } from '../dom';
import { abrirModalAsignar } from '../modals/assignIncidentModal';
import { abrirModalTecnicos } from '../modals/techniciansModal';

/** Botones de la barra del tablero que abren modales (ocultos sin rol dispatch; aquí se vuelve a comprobar). */
export function iniciarAccionesDeLaBarra(): void {
  byId('btnNewIncident').addEventListener('click', () => {
    if (!appStore.get().soloLectura) abrirModalAsignar();
  });

  byId('btnManageTechs').addEventListener('click', () => {
    if (!appStore.get().soloLectura) abrirModalTecnicos();
  });
}
