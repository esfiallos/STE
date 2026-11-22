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
