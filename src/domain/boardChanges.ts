import type { Incidente } from '../types/noc';

/** Lo que el tablero recuerda de un dibujo para compararlo con el siguiente. */
export interface FotoDelTablero {
  fecha: string;
  /** Id del caso → id de su técnico (null = sin responsable). */
  responsables: ReadonlyMap<string, string | null>;
}

export interface CambiosDelTablero {
  /** Casos que no estaban en el tablero (recién asignados). */
  nuevos: Set<string>;
  /** Casos que cambiaron de técnico (reasignados o arrastrados). */
  movidos: Set<string>;
  /** Técnicos que recibieron un caso nuevo o movido (se realza su columna). */
  receptores: Set<string>;
  /** Técnicos cuyo número de casos cambió (el contador hace "pop"). */
  conteosCambiados: Set<string>;
}

export function fotoDelTablero(fecha: string, incidentes: readonly Pick<Incidente, 'id' | 'tecnicoId'>[]): FotoDelTablero {
  return { fecha, responsables: new Map(incidentes.map((i) => [i.id, i.tecnicoId])) };
}

const sinCambios = (): CambiosDelTablero => ({ nuevos: new Set(), movidos: new Set(), receptores: new Set(), conteosCambiados: new Set() });

function contarPorTecnico(responsables: ReadonlyMap<string, string | null>): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const tecnicoId of responsables.values()) if (tecnicoId) conteo.set(tecnicoId, (conteo.get(tecnicoId) ?? 0) + 1);
  return conteo;
}

/**
 * Qué cambió entre dos dibujos del tablero. Se compara el estado (no el DOM), así abrir un turno colapsado,
 * buscar o filtrar no se confunde con un caso nuevo. Sin dibujo anterior, o si cambió el día operativo
 * (06:00, el tablero queda limpio), no hay nada que animar.
 */
export function cambiosDelTablero(antes: FotoDelTablero | null, ahora: FotoDelTablero): CambiosDelTablero {
  const cambios = sinCambios();
  if (!antes || antes.fecha !== ahora.fecha) return cambios;

  for (const [id, tecnicoId] of ahora.responsables) {
    if (!antes.responsables.has(id)) {
      cambios.nuevos.add(id);
      if (tecnicoId) cambios.receptores.add(tecnicoId);
    } else if (antes.responsables.get(id) !== tecnicoId) {
      cambios.movidos.add(id);
      if (tecnicoId) cambios.receptores.add(tecnicoId);
    }
  }

  const conteoAntes = contarPorTecnico(antes.responsables);
  const conteoAhora = contarPorTecnico(ahora.responsables);
  for (const tecnicoId of new Set([...conteoAntes.keys(), ...conteoAhora.keys()])) {
    if ((conteoAntes.get(tecnicoId) ?? 0) !== (conteoAhora.get(tecnicoId) ?? 0)) cambios.conteosCambiados.add(tecnicoId);
  }
  return cambios;
}

export const hayCambios = (c: CambiosDelTablero) =>
  c.nuevos.size + c.movidos.size + c.receptores.size + c.conteosCambiados.size > 0;
