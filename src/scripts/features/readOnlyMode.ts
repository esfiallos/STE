import { appStore } from '../../state/appStore';
import { byId } from '../dom';

const CLAVE_PREFERENCIA = 'noc.modoConsulta';

function leerPreferencia(): boolean {
  try {
    return sessionStorage.getItem(CLAVE_PREFERENCIA) === '1';
  } catch {
    return false;
  }
}

function guardarPreferencia(activo: boolean): void {
  try {
    sessionStorage.setItem(CLAVE_PREFERENCIA, activo ? '1' : '0');
  } catch {
    // Sin almacenamiento disponible: el modo solo dura hasta recargar.
  }
}

/** Modo Consulta: bloquea la edición para evitar cambios accidentales. Se conserva al recargar la pestaña. */
export function iniciarModoConsulta(): void {
  const boton = byId<HTMLButtonElement>('btnToggleMode');
  const icono = byId('modeIcon');
  const etiqueta = byId('modeLabel');

  const aplicar = () => {
    const activo = appStore.get().modoConsulta;
    document.body.classList.toggle('modo-consulta', activo);
    boton.setAttribute('aria-pressed', String(activo));
    icono.className = activo ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open';
    etiqueta.textContent = activo ? 'Consulta activa' : 'Modo Consulta';
  };

  appStore.set({ modoConsulta: leerPreferencia() });
  appStore.subscribe(aplicar);
  aplicar();

  boton.addEventListener('click', () => {
    const activo = !appStore.get().modoConsulta;
    guardarPreferencia(activo);
    appStore.set({ modoConsulta: activo });
  });
}
