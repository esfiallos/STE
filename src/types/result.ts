export type MotivoDeFalla = 'duplicado';

/** Resultado de una operación que puede fallar, sin lanzar excepciones. */
export type Resultado<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; motivo?: MotivoDeFalla };

export function exito<T = null>(data: T = null as T): Resultado<T> {
  return { ok: true, data };
}

export function falla(error: string, motivo?: MotivoDeFalla): Resultado<never> {
  return motivo ? { ok: false, error, motivo } : { ok: false, error };
}
