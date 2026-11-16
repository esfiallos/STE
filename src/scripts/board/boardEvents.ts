import { appStore } from '../../state/appStore';
import { copiarCodigo, quitarIncidente } from '../actions/incidentActions';
import { byId } from '../dom';
import { abrirModalAlmuerzo } from '../modals/lunchModal';
import { abrirModalAsignar } from '../modals/assignIncidentModal';
import { esTurnoId } from '../../domain/shifts';

function alternarTurno(turnoId: string | undefined): void {
  if (!turnoId || !esTurnoId(turnoId)) return;

  const { turnosColapsados } = appStore.get();
  appStore.set({
    turnosColapsados: turnosColapsados.includes(turnoId)
      ? turnosColapsados.filter((id) => id !== turnoId)
      : [...turnosColapsados, turnoId]
  });
}

function manejarAccion(boton: HTMLElement): void {
  const accion = boton.dataset.action;
  const turnoId = boton.closest<HTMLElement>('[data-turno-id]')?.dataset.turnoId;
  const tecnicoId = boton.closest<HTMLElement>('[data-tecnico-id]')?.dataset.tecnicoId;
  const incidenteId = boton.closest<HTMLElement>('[data-incidente-id]')?.dataset.incidenteId;

  if (accion === 'alternar-turno') {
    alternarTurno(turnoId);
    return;
  }

  if (appStore.get().modoConsulta) return; // las demás acciones modifican datos

  if (accion === 'asignar' && tecnicoId) abrirModalAsignar(tecnicoId);
  if (accion === 'editar-almuerzo' && tecnicoId) abrirModalAlmuerzo(tecnicoId);
  if (accion === 'quitar-incidente' && incidenteId) void quitarIncidente(incidenteId);
}

/** Un solo listener para todo el tablero: sigue funcionando aunque las tarjetas se vuelvan a dibujar. */
export function iniciarEventosDelTablero(): void {
  byId('shiftsAccordionContainer').addEventListener('click', (evento) => {
    if (!(evento.target instanceof Element)) return;

    const boton = evento.target.closest<HTMLElement>('[data-action]');
    if (boton) {
      manejarAccion(boton);
      return;
    }

    const codigo = evento.target.closest('.incident-item-card')?.querySelector('.inc-code')?.textContent;
    if (codigo) void copiarCodigo(codigo);
  });
}
