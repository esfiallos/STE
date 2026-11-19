import type { TecnicoCatalogo } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaTecnico {
  id: string;
  nombre: string;
  activo: boolean | null;
}

/** Catálogo de técnicos (activos e inactivos). El turno de cada día está en las jornadas. */
export async function listarTecnicos(): Promise<Resultado<TecnicoCatalogo[]>> {
  const { data, error } = await supabase.from('tecnicos').select('id, nombre, activo').order('nombre', { ascending: true });
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar los técnicos');
  return exito((data as FilaTecnico[]).map((fila) => ({ id: fila.id, nombre: fila.nombre, activo: fila.activo ?? true })));
}

export async function crearTecnico(nombre: string): Promise<Resultado> {
  const { error } = await supabase.from('tecnicos').insert({ nombre: nombre.trim() });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo agregar el técnico', 'Ya existe un técnico con ese nombre.');
  return exito();
}

/** Los técnicos no se borran (conservan su historial de casos): se desactivan. */
export async function cambiarActivo(id: string, activo: boolean): Promise<Resultado> {
  const { error } = await supabase.from('tecnicos').update({ activo }).eq('id', id);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo actualizar el técnico');
  return exito();
}
