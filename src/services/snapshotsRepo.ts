import type { TecnicoConIncidentes } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

/** Guarda la foto del tablero del día; si ya existía una para esa fecha, la reemplaza. */
export async function guardarSnapshot(fecha: string, tablero: TecnicoConIncidentes[]): Promise<Resultado> {
  const { error } = await supabase
    .from('historial_snapshots')
    .upsert({ fecha, datos_panel: tablero }, { onConflict: 'fecha' });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo guardar el snapshot');
  return exito();
}
