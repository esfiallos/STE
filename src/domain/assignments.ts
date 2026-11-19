import type { Incidente, Jornada, Tecnico, TecnicoCatalogo, TecnicoConIncidentes } from '../types/noc';

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
    if (incidente.tecnicoId === null) continue;
    const lista = porTecnico.get(incidente.tecnicoId) ?? [];
    lista.push(incidente);
    porTecnico.set(incidente.tecnicoId, lista);
  }

  return tecnicos.map((tecnico) => ({ ...tecnico, incidentes: porTecnico.get(tecnico.id) ?? [] }));
}

/** Técnicos que trabajan un día: los activos del catálogo que tienen jornada, con su turno y almuerzo de ese día. */
export function tecnicosDelDia(catalogo: TecnicoCatalogo[], jornadas: Jornada[]): Tecnico[] {
  const porId = new Map(catalogo.filter((t) => t.activo).map((t) => [t.id, t]));
  return jornadas
    .flatMap((jornada) => {
      const tecnico = porId.get(jornada.tecnicoId);
      if (!tecnico) return [];
      return [
        {
          id: tecnico.id,
          nombre: tecnico.nombre,
          jornadaId: jornada.id,
          turno: jornada.turno,
          horarioInicio: jornada.horarioInicio,
          horarioFin: jornada.horarioFin,
          almuerzoInicio: jornada.almuerzoInicio,
          almuerzoFin: jornada.almuerzoFin
        }
      ];
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Casos que pertenecen al tablero del día `fecha`: los que su responsable tiene hasta ese día.
 * Los traspasados para el día siguiente (ej. B → A de mañana) aparecen recién al empezar ese día.
 */
export function casosDelTablero(casos: Incidente[], fecha: string): Incidente[] {
  return casos.filter((caso) => !caso.fechaResponsable || caso.fechaResponsable <= fecha);
}

/** Casos abiertos sin responsable, o cuyo responsable no trabaja hoy: el dispatch debe reasignarlos. */
export function casosPorReasignar(casos: Incidente[], tecnicosDeHoy: Tecnico[]): Incidente[] {
  const deHoy = new Set(tecnicosDeHoy.map((t) => t.id));
  return casos.filter((caso) => caso.tecnicoId === null || !deHoy.has(caso.tecnicoId));
}
