import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { crearBackendSimulado, datosBase, type Datos } from './backendSimulado';

/** Carga el HTML real compilado (con todas las plantillas) dentro del DOM de la prueba. */
function cargarPaginaCompilada(): void {
  const ruta = resolve(process.cwd(), 'dist/index.html');
  if (!existsSync(ruta)) {
    throw new Error('No existe dist/index.html. Compila antes con "bun run build" (el script "test" ya lo hace).');
  }
  const cuerpo = /<body[^>]*>([\s\S]*)<\/body>/.exec(readFileSync(ruta, 'utf8'))?.[1] ?? '';
  document.body.innerHTML = cuerpo.replace(/<script[\s\S]*?<\/script>/g, '');
  document.body.className = '';
}

// Cada prueba crea un cliente nuevo de Supabase: ese aviso es esperado y solo mete ruido.
const advertencia = console.warn.bind(console);
vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('Multiple GoTrueClient')) advertencia(...args);
});

/** Fija la hora local del reloj (2026-11-09 a la hora indicada). */
export function fijarHora(hora: number, minutos = 0): void {
  vi.setSystemTime(new Date(2026, 10, 9, hora, minutos));
}

export const esperar = (ms = 40) => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * Arranca la app como lo hace main.ts (sin login), contra un Supabase simulado, con el rol indicado.
 * Cada llamada empieza de cero: módulos, estado, DOM y base de datos.
 */
export async function iniciarApp(datos: Datos = datosBase(), { rol = 'dispatch' }: { rol?: 'dispatch' | 'tecnico' } = {}) {
  vi.resetModules();
  cargarPaginaCompilada();
  const backend = crearBackendSimulado(datos);

  vi.doMock('../../src/scripts/ui/sound', () => ({ reproducirSonido: () => undefined }));
  const confirmar = vi.fn((_mensaje?: string) => true);
  window.confirm = confirmar;
  document.execCommand = vi.fn(() => true);

  const { appStore } = await import('../../src/state/appStore');
  const { cargarDatos } = await import('../../src/state/sync');
  const { solicitarRender, aplicarRenderPendiente } = await import('../../src/scripts/board/renderScheduler');
  const { iniciarEventosDelTablero } = await import('../../src/scripts/board/boardEvents');
  const { iniciarDragAndDrop } = await import('../../src/scripts/board/dragAndDrop');
  const { iniciarModalAsignar, abrirModalAsignar } = await import('../../src/scripts/modals/assignIncidentModal');
  const { iniciarFiltroPorTecnico } = await import('../../src/scripts/features/techFilter');
  const { solicitarAsignacion } = await import('../../src/scripts/modals/assignFlow');

  appStore.set({ perfil: { nombre: 'Prueba', rol, tecnicoId: null }, soloLectura: rol !== 'dispatch' });
  document.body.classList.toggle('solo-lectura', rol !== 'dispatch');

  iniciarModalAsignar();
  iniciarFiltroPorTecnico();
  iniciarEventosDelTablero();
  iniciarDragAndDrop(aplicarRenderPendiente);
  appStore.subscribe(solicitarRender);
  await cargarDatos();
  await esperar();

  return {
    ...backend,
    confirmar,
    appStore,
    cargarDatos,
    solicitarRender,
    solicitarAsignacion,
    abrirModalAsignar,

    q: <T extends Element>(selector: string) => document.querySelector(selector) as T,
    qa: (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)],
    tarjeta: (turno: string, tecnicoId: string) => document.querySelector<HTMLElement>(`[data-clave="${turno}:${tecnicoId}"]`)!,
    click: (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  };
}
