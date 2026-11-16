import { byId } from '../dom';

const SELECTOR_CAMPOS = 'input:not([type="hidden"]):not([disabled]), select:not([disabled])';

export function abrirModal(id: string): void {
  const modal = byId(id);
  modal.classList.remove('hidden');
  window.setTimeout(() => modal.querySelector<HTMLElement>(SELECTOR_CAMPOS)?.focus(), 0);
}

export function cerrarModal(id: string): void {
  byId(id).classList.add('hidden');
}

/** Muestra (o limpia, con null) el mensaje de error de un formulario. */
export function establecerError(idElemento: string, mensaje: string | null): void {
  const elemento = byId(idElemento);
  elemento.textContent = mensaje ?? '';
  elemento.classList.toggle('hidden', mensaje === null);
}

/** Cierre común a todos los modales: botón ×, "Cancelar", clic en el fondo y tecla Escape. */
export function iniciarModales(): void {
  document.addEventListener('click', (evento) => {
    if (!(evento.target instanceof Element)) return;

    const botonCerrar = evento.target.closest('[data-close-modal]');
    const fondo = evento.target.classList.contains('noc-modal-overlay') ? evento.target : null;
    (botonCerrar?.closest('.noc-modal-overlay') ?? fondo)?.classList.add('hidden');
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Escape') return;
    document.querySelectorAll('.noc-modal-overlay').forEach((modal) => modal.classList.add('hidden'));
  });
}
