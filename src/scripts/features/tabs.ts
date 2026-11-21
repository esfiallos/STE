import { appStore } from '../../state/appStore';
import type { Vista } from '../../types/noc';

const VISTAS: readonly Vista[] = [
  'panel',
  'tablero',
  'busqueda',
  'seguimiento',
  'traspaso',
  'misTraspasos',
  'planificacion',
  'historial',
  'bitacora'
];

/**
 * Pestañas Tablero / Planificación / Historial / Bitácora. La vista activa vive en la dirección (#historial),
 * así se conserva al recargar y se puede compartir el enlace. `alAbrir` carga los datos de cada vista;
 * una vista sin función en `alAbrir` no está permitida para el rol (se abre `predeterminada`).
 */
export function iniciarPestanas(alAbrir: Partial<Record<Vista, () => void>>, predeterminada: Vista = 'tablero'): void {
  const vistaDesdeLaDireccion = (): Vista => {
    const hash = window.location.hash.slice(1);
    return VISTAS.find((vista) => vista === hash && alAbrir[vista]) ?? predeterminada;
  };

  const pintar = () => {
    const { vista } = appStore.get();

    document.querySelectorAll<HTMLElement>('[data-vista]').forEach((seccion) => {
      seccion.classList.toggle('hidden', seccion.dataset.vista !== vista);
    });
    document.querySelectorAll<HTMLElement>('[data-tab]').forEach((pestana) => {
      const activa = pestana.dataset.tab === vista;
      pestana.classList.toggle('is-active', activa);
      pestana.setAttribute('aria-selected', String(activa));
    });
  };

  const abrir = (vista: Vista) => {
    appStore.set({ vista });
    pintar();
    alAbrir[vista]?.();
  };

  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((pestana) => {
    pestana.addEventListener('click', () => {
      const vista = VISTAS.find((v) => v === pestana.dataset.tab);
      if (vista) window.location.hash = vista;
    });
  });

  window.addEventListener('hashchange', () => abrir(vistaDesdeLaDireccion()));
  abrir(vistaDesdeLaDireccion());
}
