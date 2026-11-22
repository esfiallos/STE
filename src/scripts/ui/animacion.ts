import autoAnimate from '@formkit/auto-animate';
import { animate } from 'motion';

/**
 * Único punto que usa las librerías de animación (D27):
 * - Motion (`animate`) para paneles, popovers, confirmaciones y microinteracciones.
 * - auto-animate para listas que crecen o se achican de a un elemento (avisos, resultados).
 * Con "reducir movimiento" o sin soporte del navegador (p. ej. jsdom en las pruebas) no se anima nada,
 * y las promesas se resuelven al instante: el comportamiento no depende de la animación.
 * El FLIP del tablero sigue en ui/motion.ts.
 */

const prefiereMenosMovimiento = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const puedeAnimar = (elemento: Element): boolean =>
  !prefiereMenosMovimiento() && typeof (elemento as HTMLElement).animate === 'function';

const RESORTE = { type: 'spring', bounce: 0.22, duration: 0.32 } as const;

/** Entrada de un panel o popover: aparece y se acomoda con un resorte suave. */
export async function animarEntrada(elemento: HTMLElement, desde: 'arriba' | 'abajo' | 'centro' = 'centro'): Promise<void> {
  if (!puedeAnimar(elemento)) return;
  const desplazamiento = desde === 'arriba' ? -6 : desde === 'abajo' ? 6 : 0;
  await animate(
    elemento,
    { opacity: [0, 1], transform: [`translateY(${desplazamiento}px) scale(0.97)`, 'translateY(0px) scale(1)'] },
    RESORTE
  );
}

/** Salida rápida; se espera a que termine antes de quitar el elemento. */
export async function animarSalida(elemento: HTMLElement): Promise<void> {
  if (!puedeAnimar(elemento)) return;
  await animate(elemento, { opacity: [1, 0], transform: ['scale(1)', 'scale(0.97)'] }, { duration: 0.14, ease: 'easeIn' });
}

/** Fondo de un modal: solo opacidad. */
export async function animarFondo(elemento: HTMLElement, visible: boolean): Promise<void> {
  if (!puedeAnimar(elemento)) return;
  await animate(elemento, { opacity: visible ? [0, 1] : [1, 0] }, { duration: visible ? 0.18 : 0.12 });
}

/** "Pop" de confirmación sobre un botón o chip (p. ej. al guardar). */
export function animarPulso(elemento: HTMLElement): void {
  if (!puedeAnimar(elemento)) return;
  void animate(elemento, { transform: ['scale(1)', 'scale(1.08)', 'scale(1)'] }, { duration: 0.32, ease: 'easeOut' });
}

/** Sacudida corta para un error (campo inválido, acción rechazada). */
export function animarSacudida(elemento: HTMLElement): void {
  if (!puedeAnimar(elemento)) return;
  void animate(elemento, { transform: ['translateX(0)', 'translateX(-5px)', 'translateX(5px)', 'translateX(-3px)', 'translateX(0)'] }, { duration: 0.32 });
}

const listasAnimadas = new WeakSet<HTMLElement>();

/**
 * Anima altas, bajas y cambios de orden de los hijos de `contenedor` (auto-animate).
 * Úsalo en listas que se modifican de a un elemento; en las que se redibujan completas, cada redibujo
 * se vería como una entrada de todo, así que ahí no conviene.
 */
export function animarLista(contenedor: HTMLElement): void {
  if (listasAnimadas.has(contenedor) || typeof ResizeObserver === 'undefined' || !puedeAnimar(contenedor)) return;
  listasAnimadas.add(contenedor);
  autoAnimate(contenedor, { duration: 200, easing: 'ease-out' });
}
