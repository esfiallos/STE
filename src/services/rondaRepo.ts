import type { TurnoId } from '../types/noc';
import { exito, falla, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

export interface AsignacionPorRonda {
  casoId: string;
  tecnicoId: string;
  tecnicoNombre: string;
}

/** Crea el caso y la base lo asigna al siguiente técnico de la ronda (D10). */
export async function asignarARonda(codigo: string, nota: string): Promise<Resultado<AsignacionPorRonda>> {
  const { data, error } = await supabase.rpc('asignar_a_ronda', { p_codigo: codigo, p_nota: nota.trim() || null });
  if (error) {
    // La base explica el motivo (ya existe, nadie disponible…): se muestra tal cual.
    console.error('[asignar a la ronda]', error);
    return falla(error.message, error.code === '23505' ? 'duplicado' : undefined);
  }
  const fila = (data as { caso_id: string; tecnico_id: string; tecnico_nombre: string }[] | null)?.[0];
  if (!fila) return falla('No se pudo asignar el caso a la ronda.');
  return exito({ casoId: fila.caso_id, tecnicoId: fila.tecnico_id, tecnicoNombre: fila.tecnico_nombre });
}

/** Nombre de quien recibió el último caso de la ronda en ese turno (null si aún nadie). */
export async function ultimoDeRonda(fecha: string, turno: TurnoId): Promise<Resultado<string | null>> {
  const { data, error } = await supabase.from('ronda_estado').select('ultimo_nombre').eq('fecha_operativa', fecha).eq('turno', turno).limit(1);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo leer la ronda');
  return exito((data as { ultimo_nombre: string | null }[])[0]?.ultimo_nombre ?? null);
}
