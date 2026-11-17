import { describirAccion } from '../../domain/audit';
import type { EntradaBitacora } from '../../types/noc';
import { formatearFechaHora } from '../ui/format';
import { crearTabla } from '../ui/table';

/** Tabla de movimientos (bitácora). La usan la pestaña Bitácora y la búsqueda del Historial. */
export function crearTablaBitacora(entradas: EntradaBitacora[], textoVacio: string): HTMLElement {
  const filas = entradas.map((e) => [
    formatearFechaHora(e.creadoEn),
    e.usuario,
    describirAccion(e.accion),
    e.codigo ?? '',
    e.tecnico ?? '',
    e.detalle ?? ''
  ]);
  return crearTabla(['Fecha y hora', 'Usuario', 'Acción', 'Caso', 'Técnico', 'Detalle'], filas, textoVacio);
}
