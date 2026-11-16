import { appStore } from '../../state/appStore';
import { byId } from '../dom';
import { abrirModalAsignar } from '../modals/assignIncidentModal';
import { abrirModalTecnicos } from '../modals/techniciansModal';

/** Botones de la cabecera que abren modales (ocultos en Modo Consulta; aquí se vuelve a comprobar). */
export function iniciarAccionesDeCabecera(): void {
  byId('btnNewIncident').addEventListener('click', () => {
    if (!appStore.get().modoConsulta) abrirModalAsignar();
  });

  byId('btnManageTechs').addEventListener('click', () => {
    if (!appStore.get().modoConsulta) abrirModalTecnicos();
  });
}
