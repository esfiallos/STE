import { appStore } from '../../state/appStore';
import { moverIncidente } from '../actions/incidentActions';
import { byId } from '../dom';

let incidenteArrastradoId: string | null = null;

export function estaArrastrando(): boolean {
  return incidenteArrastradoId !== null;
}

function columnaBajoElCursor(evento: Event): HTMLElement | null {
  return evento.target instanceof Element ? evento.target.closest<HTMLElement>('.tech-column-card') : null;
}

function limpiarResaltados(): void {
  document
    .querySelectorAll('.drag-over, .drag-blocked, .is-dragging')
    .forEach((el) => el.classList.remove('drag-over', 'drag-blocked', 'is-dragging'));
}

/**
 * Reasignar un incidente arrastrándolo a la columna de otro técnico.
 * Las columnas de técnicos no disponibles (almuerzo / fuera de horario) no aceptan casos.
 * `alTerminar` se llama al soltar o cancelar el arrastre.
 */
export function iniciarDragAndDrop(alTerminar: () => void): void {
  const tablero = byId('shiftsAccordionContainer');

  tablero.addEventListener('dragstart', (evento) => {
    const tarjeta = evento.target instanceof Element ? evento.target.closest<HTMLElement>('.incident-item-card') : null;
    if (!tarjeta) return;

    if (appStore.get().modoConsulta) {
      evento.preventDefault();
      return;
    }

    incidenteArrastradoId = tarjeta.dataset.incidenteId ?? null;
    evento.dataTransfer?.setData('text/plain', incidenteArrastradoId ?? ''); // Firefox lo exige
    if (evento.dataTransfer) evento.dataTransfer.effectAllowed = 'move';
    tarjeta.classList.add('is-dragging');
  });

  tablero.addEventListener('dragover', (evento) => {
    const columna = columnaBajoElCursor(evento);
    if (!estaArrastrando() || !columna) return;

    if (columna.dataset.disponible !== 'true') {
      columna.classList.add('drag-blocked'); // sin preventDefault: el navegador muestra "no permitido"
      return;
    }

    evento.preventDefault(); // habilita soltar aquí
    columna.classList.add('drag-over');
  });

  tablero.addEventListener('dragleave', (evento) => {
    const columna = columnaBajoElCursor(evento);
    const destino = evento.relatedTarget;
    if (columna && !(destino instanceof Node && columna.contains(destino))) {
      columna.classList.remove('drag-over', 'drag-blocked');
    }
  });

  tablero.addEventListener('drop', (evento) => {
    const columna = columnaBajoElCursor(evento);
    if (!columna || !incidenteArrastradoId) return;

    evento.preventDefault();
    const tecnicoDestinoId = columna.dataset.tecnicoId;
    if (tecnicoDestinoId) void moverIncidente(incidenteArrastradoId, tecnicoDestinoId);
  });

  // "dragend" ocurre siempre al final (soltado o cancelado con Escape).
  tablero.addEventListener('dragend', () => {
    incidenteArrastradoId = null;
    limpiarResaltados();
    alTerminar();
  });
}
