import { estaArrastrando } from './dragAndDrop';
import { renderizarMetricas } from './renderMetrics';
import { renderizarTablero } from './renderBoard';

let renderPendiente = false;

function renderizarTodo(): void {
  renderizarTablero();
  renderizarMetricas();
}

/** Redibuja la pantalla; si hay un arrastre en curso lo posterga para no romper el gesto. */
export function solicitarRender(): void {
  if (estaArrastrando()) {
    renderPendiente = true;
    return;
  }
  renderizarTodo();
}

export function aplicarRenderPendiente(): void {
  if (!renderPendiente) return;
  renderPendiente = false;
  renderizarTodo();
}
