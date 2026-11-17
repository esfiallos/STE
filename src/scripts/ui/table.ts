import { crearElemento } from '../dom';

/** Tabla de solo lectura con estilo de lista. Si no hay filas, muestra el texto indicado. */
export function crearTabla(encabezados: string[], filas: string[][], textoVacio: string): HTMLElement {
  if (filas.length === 0) return crearElemento('p', 'table-empty', textoVacio);

  const tabla = crearElemento('table', 'data-table');

  const cabecera = tabla.createTHead().insertRow();
  encabezados.forEach((texto) => cabecera.append(crearElemento('th', '', texto)));

  const cuerpo = tabla.createTBody();
  filas.forEach((fila) => {
    const tr = cuerpo.insertRow();
    fila.forEach((texto) => tr.append(crearElemento('td', '', texto)));
  });

  const contenedor = crearElemento('div', 'data-table-wrap');
  contenedor.append(tabla);
  return contenedor;
}
