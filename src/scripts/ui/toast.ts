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

/** Muestra el error si la operación falló. Si devuelve true, el resultado es exitoso y se puede leer `data`. */
export function avisarSiFalla<T>(resultado: Resultado<T>): resultado is Extract<Resultado<T>, { ok: true }> {
  if (!resultado.ok) mostrarAviso(resultado.error, 'error');
  return resultado.ok;
}
