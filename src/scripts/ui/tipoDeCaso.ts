import { ETIQUETA_TIPO, tipoDeCaso } from '../../domain/caseType';

/** Chip con el tipo del caso (FRESH · Tarea · Incidente · Otro), coloreado con `case-type--*`. */
export function pintarTipo(elemento: HTMLElement, codigo: string): void {
  const tipo = tipoDeCaso(codigo);
  elemento.textContent = ETIQUETA_TIPO[tipo];
  elemento.dataset.tipo = tipo;
  elemento.className = `case-type case-type--${tipo.toLowerCase()}`;
}
