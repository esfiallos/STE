import { estaArrastrando } from './dragAndDrop';
import { renderizarTablero } from './renderBoard';
import { renderizarMetricas } from './renderMetrics';

let renderPendiente = false;

/** Mientras se escribe en el formulario de una tarjeta no se redibuja: se perdería el cursor y el texto. */
function estaEscribiendoEnElTablero(): boolean {
  const activo = document.activeElement;
  return activo instanceof Element && activo.closest('[data-form="asignar"]') !== null;
}

function debePosponer(): boolean {
  return estaArrastrando() || estaEscribiendoEnElTablero();
}

function renderizarTodo(): void {
  renderizarTablero();
  renderizarMetricas();
}

/** Redibuja la pantalla; si hay un arrastre o una escritura en curso lo posterga hasta que terminen. */
export function solicitarRender(): void {
  if (debePosponer()) {
    renderPendiente = true;
    return;
  }
  renderizarTodo();
}

export function aplicarRenderPendiente(): void {
  if (!renderPendiente || debePosponer()) return;
  renderPendiente = false;
  renderizarTodo();
}
