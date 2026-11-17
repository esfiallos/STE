import type { BorradorAsignacion, ModoTablero } from '../../types/noc';

/** Todo lo que las vistas necesitan saber para dibujarse, sea el tablero vivo o una foto histórica. */
export interface ContextoTablero {
  modo: ModoTablero;
  ahora: Date;
  /** Texto del buscador ya normalizado. */
  termino: string;
  notasAbiertas: ReadonlySet<string>;
  claveFormulario: string | null;
  borrador: BorradorAsignacion | null;
}
