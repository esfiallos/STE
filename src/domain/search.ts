import type { Incidente, TecnicoConIncidentes } from '../types/noc';

export function normalizarBusqueda(texto: string): string {
  return texto.trim().toLowerCase();
}

export function incidenteCoincide(incidente: Incidente, termino: string): boolean {
  if (!termino) return false;
  return (
    incidente.codigo.toLowerCase().includes(termino) ||
    (incidente.cliente?.toLowerCase().includes(termino) ?? false) ||
    (incidente.nota?.toLowerCase().includes(termino) ?? false)
  );
}

/** Un técnico coincide si lo hace su nombre o alguno de sus incidentes. Sin término, todos coinciden. */
export function tecnicoCoincide(tecnico: TecnicoConIncidentes, termino: string): boolean {
  if (!termino) return true;
  return (
    tecnico.nombre.toLowerCase().includes(termino) ||
    tecnico.incidentes.some((incidente) => incidenteCoincide(incidente, termino))
  );
}

const plano = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Igualdad sin mayúsculas ni acentos ("critico" = "Crítico"). */
export function mismoTexto(a: string, b: string): boolean {
  return plano(a) === plano(b);
}

/**
 * Opciones de un combobox que coinciden con lo escrito (sin mayúsculas ni acentos): primero las que empiezan
 * igual, luego las que lo contienen, en su orden original. Sin texto, todas.
 */
export function filtrarOpciones(opciones: readonly string[], texto: string): string[] {
  const t = plano(texto);
  if (!t) return [...opciones];
  const empiezan = opciones.filter((o) => plano(o).startsWith(t));
  const contienen = opciones.filter((o) => !plano(o).startsWith(t) && plano(o).includes(t));
  return [...empiezan, ...contienen];
}
