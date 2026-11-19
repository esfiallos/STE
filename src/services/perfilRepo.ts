import type { Perfil } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaPerfil {
  nombre: string;
  rol: Perfil['rol'];
  tecnico_id: string | null;
}

/** Perfil (rol) del usuario con sesión. null si el administrador aún no le asignó uno. */
export async function obtenerMiPerfil(usuarioId: string): Promise<Resultado<Perfil | null>> {
  const { data, error } = await supabase.from('perfiles').select('nombre, rol, tecnico_id').eq('id', usuarioId).limit(1);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo cargar tu perfil');

  const fila = (data as FilaPerfil[])[0];
  return exito(fila ? { nombre: fila.nombre, rol: fila.rol, tecnicoId: fila.tecnico_id } : null);
}
