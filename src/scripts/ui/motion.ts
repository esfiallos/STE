/**
 * Animaciones del tablero. El tablero se redibuja completo, así que antes de dibujar se miden las tarjetas
 * (posiciones) y después se anima la diferencia:
 *   · FLIP: un caso que cambia de lugar se desliza desde donde estaba;
 *   · entrada + destello del caso nuevo; destello suave del caso movido;
 *   · "pop" del contador de la tarjeta del técnico y realce de la columna que recibe.
 * Las clases las anima el SCSS (y `_base.scss` las apaga con prefers-reduced-motion); el deslizamiento usa
 * la Web Animations API y también se omite con movimiento reducido.
 *
 * Si el tablero se vuelve a dibujar mientras una animación sigue en curso (p. ej. se cierra el formulario
 * justo después de asignar), `continuarAnimaciones` la retoma en el punto en que iba en vez de cortarla.
 */
import type { CambiosDelTablero } from '../../domain/boardChanges';

const DURACION_FLIP_MS = 320;
/** Lo que dura la animación de clase más larga (ver `_motion.scss`). */
export const DURACION_ANIMACION_MS = 900;
const CURVA = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export type Posiciones = Map<string, DOMRect>;

type Destino = 'caso' | 'columna' | 'contador';

interface AnimacionEnCurso {
  destino: Destino;
  id: string;
  clase: string;
  inicio: number;
}

/** Clave `destino:id:clase` → animación que empezó y quizá no ha terminado. */
const enCurso = new Map<string, AnimacionEnCurso>();

const movimientoReducido = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Posición de cada tarjeta de caso visible (antes de redibujar). */
export function medirCasos(contenedor: ParentNode): Posiciones {
  const posiciones: Posiciones = new Map();
  contenedor.querySelectorAll<HTMLElement>('[data-incidente-id]').forEach((tarjeta) => {
    const id = tarjeta.dataset.incidenteId;
    if (id && !posiciones.has(id)) posiciones.set(id, tarjeta.getBoundingClientRect());
  });
  return posiciones;
}

function elementos(contenedor: ParentNode, destino: Destino, id: string): HTMLElement[] {
  if (destino === 'caso') {
    return [...contenedor.querySelectorAll<HTMLElement>('[data-incidente-id]')].filter((e) => e.dataset.incidenteId === id);
  }
  // Un comodín puede salir en dos turnos: se animan todas sus tarjetas.
  const columnas = [...contenedor.querySelectorAll<HTMLElement>('.tech-column-card[data-tecnico-id]')].filter((e) => e.dataset.tecnicoId === id);
  if (destino === 'columna') return columnas;
  return columnas.flatMap((c) => [...c.querySelectorAll<HTMLElement>('[data-ref="conteo"]')]);
}

function aplicarClase(elemento: HTMLElement, clase: string, transcurrido: number): void {
  elemento.style.animationDelay = transcurrido > 0 ? `-${Math.round(transcurrido)}ms` : '';
  elemento.classList.add(clase);
  // Un elemento puede tener dos animaciones (entrada + destello): se quita la clase al terminar la más larga.
  window.setTimeout(() => {
    elemento.classList.remove(clase);
    elemento.style.animationDelay = '';
  }, DURACION_ANIMACION_MS - transcurrido);
}

function iniciar(contenedor: ParentNode, destino: Destino, id: string, clase: string, ahora: number): void {
  enCurso.set(`${destino}:${id}:${clase}`, { destino, id, clase, inicio: ahora });
  elementos(contenedor, destino, id).forEach((elemento) => aplicarClase(elemento, clase, 0));
}

function deslizarDesde(tarjeta: HTMLElement, antes: DOMRect): void {
  if (typeof tarjeta.animate !== 'function') return;
  const despues = tarjeta.getBoundingClientRect();
  const dx = antes.left - despues.left;
  const dy = antes.top - despues.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  tarjeta.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
    duration: DURACION_FLIP_MS,
    easing: CURVA
  });
}

/** Retoma, en el tablero recién dibujado, las animaciones que aún no terminaron. */
export function continuarAnimaciones(contenedor: ParentNode, ahora = performance.now()): void {
  for (const [clave, animacion] of enCurso) {
    const transcurrido = ahora - animacion.inicio;
    if (transcurrido >= DURACION_ANIMACION_MS) {
      enCurso.delete(clave);
      continue;
    }
    elementos(contenedor, animacion.destino, animacion.id).forEach((elemento) => aplicarClase(elemento, animacion.clase, transcurrido));
  }
}

/** Anima lo que cambió en el tablero recién dibujado. */
export function animarCambiosDelTablero(contenedor: ParentNode, cambios: CambiosDelTablero, antes: Posiciones, ahora = performance.now()): void {
  for (const id of cambios.nuevos) iniciar(contenedor, 'caso', id, 'is-entering', ahora);
  for (const id of cambios.movidos) {
    iniciar(contenedor, 'caso', id, 'is-moved', ahora);
    const posicionAnterior = antes.get(id);
    if (posicionAnterior && !movimientoReducido()) {
      elementos(contenedor, 'caso', id).forEach((tarjeta) => deslizarDesde(tarjeta, posicionAnterior));
    }
  }
  for (const id of cambios.receptores) iniciar(contenedor, 'columna', id, 'is-receiving', ahora);
  for (const id of cambios.conteosCambiados) iniciar(contenedor, 'contador', id, 'is-popping', ahora);
}
