import { claveDeArea } from '../../domain/areas';
import type { EstadoCaso } from '../../types/noc';

/**
 * Color del estado y del área de un caso (§14.2), como el de las etiquetas: un chip o una lista con su fondo y su
 * texto. Los colores viven en `abstracts/_variables.scss` ($colores-estado, $colores-area).
 */
function quitarColores(elemento: HTMLElement, prefijo: string): void {
  [...elemento.classList].filter((c) => c.startsWith(prefijo)).forEach((c) => elemento.classList.remove(c));
}

export function pintarEstado(elemento: HTMLElement, estado: EstadoCaso | string | null | undefined): void {
  quitarColores(elemento, 'estado-color');
  if (estado) elemento.classList.add('estado-color', `estado-color--${estado}`);
}

export function pintarArea(elemento: HTMLElement, area: string | null | undefined): void {
  quitarColores(elemento, 'area-color');
  const clave = claveDeArea(area);
  if (clave) elemento.classList.add('area-color', `area-color--${clave}`);
}

/** Pinta una lista de estado o de área con su valor actual y la repinta al cambiar (sin esperar al redibujo). */
export function colorearLista(lista: HTMLSelectElement, tipo: 'estado' | 'area'): void {
  const pintar = () => (tipo === 'estado' ? pintarEstado(lista, lista.value) : pintarArea(lista, lista.value));
  pintar();
  if (lista.dataset.coloreada) return;
  lista.dataset.coloreada = 'si';
  lista.addEventListener('change', pintar);
}
