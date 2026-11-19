import type { EstadoCaso, Incidente } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaCasoAbierto {
  id: string;
  codigo: string;
  nota: string | null;
  estado: EstadoCaso;
  tecnico_actual_id: string | null;
  creado_en: string;
  fecha_responsable: string | null;
  asignado_en: string | null;
}

function aIncidente(fila: FilaCasoAbierto): Incidente {
  return {
    id: fila.id,
    codigo: fila.codigo,
    nota: fila.nota,
    tecnicoId: fila.tecnico_actual_id,
    creadoEn: fila.asignado_en ?? fila.creado_en,
    estado: fila.estado,
    fechaResponsable: fila.fecha_responsable
  };
}

/** Casos no cerrados con el día operativo de su responsable (vista casos_abiertos). */
export async function listarCasosAbiertos(): Promise<Resultado<Incidente[]>> {
  const { data, error } = await supabase.from('casos_abiertos').select('*').order('asignado_en', { ascending: true });
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar los casos');
  return exito((data as FilaCasoAbierto[]).map(aIncidente));
}

export interface CasoExistente {
  id: string;
  estado: EstadoCaso;
  tecnicoId: string | null;
}

/** Busca un caso por código en todo el historial (abierto o cerrado). */
export async function buscarCasoPorCodigo(codigo: string): Promise<Resultado<CasoExistente | null>> {
  const { data, error } = await supabase.from('casos').select('id, estado, tecnico_actual_id').eq('codigo', codigo).limit(1);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo buscar el caso');
  const fila = (data as { id: string; estado: EstadoCaso; tecnico_actual_id: string | null }[])[0];
  return exito(fila ? { id: fila.id, estado: fila.estado, tecnicoId: fila.tecnico_actual_id } : null);
}

export async function crearCaso(codigo: string, nota: string, tecnicoId: string): Promise<Resultado> {
  const { error } = await supabase.from('casos').insert({ codigo, nota: nota.trim() || null, tecnico_actual_id: tecnicoId });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo asignar el caso', `El caso ${codigo} ya existe.`);
  return exito();
}

/** Asigna un caso a otro técnico; con `reabrir` también lo vuelve a poner "En curso". */
export async function asignarCaso(id: string, tecnicoId: string, reabrir = false): Promise<Resultado> {
  const cambios = reabrir ? { tecnico_actual_id: tecnicoId, estado: 'en_curso' } : { tecnico_actual_id: tecnicoId };
  const { error } = await supabase.from('casos').update(cambios).eq('id', id);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo asignar el caso');
  return exito();
}

/** Los casos no se borran: se cierran y quedan en el historial. */
export async function cerrarCaso(id: string): Promise<Resultado> {
  const { error } = await supabase.from('casos').update({ estado: 'cerrado' }).eq('id', id);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo cerrar el caso');
  return exito();
}
