import type { Resultado } from '../../types/result';
import { byId, crearElemento } from '../dom';

type TipoDeAviso = 'info' | 'exito' | 'error';

const DURACION_MS = 4000;

export function mostrarAviso(mensaje: string, tipo: TipoDeAviso = 'info'): void {
  const aviso = crearElemento('div', `toast toast--${tipo}`, mensaje);
  aviso.setAttribute('role', tipo === 'error' ? 'alert' : 'status');

  byId('toastHost').append(aviso);
  window.setTimeout(() => aviso.remove(), DURACION_MS);
}

/** Muestra el error si la operación falló. Devuelve true cuando salió bien. */
export function avisarSiFalla(resultado: Resultado<unknown>): boolean {
  if (!resultado.ok) mostrarAviso(resultado.error, 'error');
  return resultado.ok;
}
