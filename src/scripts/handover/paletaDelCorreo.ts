/**
 * Paleta de la tabla del traspaso que eligió el técnico. Es una preferencia de su navegador (localStorage):
 * si no se puede leer o guardar (modo privado, almacenamiento bloqueado) se usa la de siempre.
 */
import { esPaletaCorreo, PALETA_POR_DEFECTO, type IdPaletaCorreo } from '../../domain/handoverReport';

const CLAVE = 'panel-noc:paleta-traspaso';

export function leerPaletaDelCorreo(): IdPaletaCorreo {
  try {
    const guardada = localStorage.getItem(CLAVE);
    return esPaletaCorreo(guardada) ? guardada : PALETA_POR_DEFECTO;
  } catch {
    return PALETA_POR_DEFECTO;
  }
}

export function guardarPaletaDelCorreo(paleta: IdPaletaCorreo): void {
  try {
    localStorage.setItem(CLAVE, paleta);
  } catch {
    // Sin almacenamiento: la elección vale solo mientras la página siga abierta.
  }
}
