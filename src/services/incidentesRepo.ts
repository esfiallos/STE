import type { Incidente } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaIncidente {
  id: string;
  codigo: string;
  nota: string | null;
  tecnico_id: string;
  created_at: string;
}

function aIncidente(fila: FilaIncidente): Incidente {
  return {
    id: fila.id,
    codigo: fila.codigo,
    nota: fila.nota,
    tecnicoId: fila.tecnico_id,
    creadoEn: fila.created_at
  };
}

export async function listarIncidentes(): Promise<Resultado<Incidente[]>> {
  const { data, error } = await supabase.from('incidentes').select('*').order('created_at', { ascending: true });
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar los incidentes');
  return exito((data as FilaIncidente[]).map(aIncidente));
}

export async function crearIncidente(codigo: string, nota: string, tecnicoId: string): Promise<Resultado> {
  const { error } = await supabase
    .from('incidentes')
    .insert({ codigo, nota: nota.trim() || null, tecnico_id: tecnicoId });
  if (error) {
    return errorDeBaseDeDatos(error, 'No se pudo asignar el incidente', `El incidente ${codigo} ya está asignado.`);
  }
  return exito();
}

export async function actualizarTecnicoDeIncidente(id: string, tecnicoId: string): Promise<Resultado> {
  const { error } = await supabase.from('incidentes').update({ tecnico_id: tecnicoId }).eq('id', id);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo reasignar el incidente');
  return exito();
}

export async function borrarIncidente(id: string): Promise<Resultado> {
  const { error } = await supabase.from('incidentes').delete().eq('id', id);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo eliminar el incidente');
  return exito();
}
