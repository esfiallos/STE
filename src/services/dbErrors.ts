import type { PostgrestError } from '@supabase/supabase-js';
import { falla } from '../types/result';

const VIOLACION_DE_UNICIDAD = '23505';

/** Traduce un error de Postgres a un Resultado con mensaje legible. */
export function errorDeBaseDeDatos(error: PostgrestError, contexto: string, mensajeDuplicado?: string) {
  console.error(`[${contexto}]`, error);

  if (error.code === VIOLACION_DE_UNICIDAD && mensajeDuplicado) {
    return falla(mensajeDuplicado, 'duplicado');
  }
  return falla(`${contexto}: ${error.message}`);
}
