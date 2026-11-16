import type { Incidente, Tecnico, TecnicoConIncidentes } from '../types/noc';

/** Misma normalización que aplica la base de datos al guardar el código. */
export function normalizarCodigo(codigo: string): string {
  return codigo.trim().toUpperCase();
}

export function buscarIncidentePorCodigo(incidentes: Incidente[], codigo: string): Incidente | undefined {
  const normalizado = normalizarCodigo(codigo);
  return incidentes.find((incidente) => incidente.codigo === normalizado);
}

export function unirTecnicosConIncidentes(tecnicos: Tecnico[], incidentes: Incidente[]): TecnicoConIncidentes[] {
  const porTecnico = new Map<string, Incidente[]>();

  for (const incidente of incidentes) {
    const lista = porTecnico.get(incidente.tecnicoId) ?? [];
    lista.push(incidente);
    porTecnico.set(incidente.tecnicoId, lista);
  }

  return tecnicos.map((tecnico) => ({ ...tecnico, incidentes: porTecnico.get(tecnico.id) ?? [] }));
}
