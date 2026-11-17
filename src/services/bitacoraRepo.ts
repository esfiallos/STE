import type { EntradaBitacora } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaBitacora {
  id: string;
  created_at: string;
  usuario_email: string;
  accion: string;
  codigo: string | null;
  tecnico: string | null;
  detalle: string | null;
}

const aEntrada = (fila: FilaBitacora): EntradaBitacora => ({
  id: fila.id,
  creadoEn: fila.created_at,
  usuario: fila.usuario_email,
  accion: fila.accion,
  codigo: fila.codigo,
  tecnico: fila.tecnico,
  detalle: fila.detalle
});

export async function listarBitacora(limite = 300): Promise<Resultado<EntradaBitacora[]>> {
  const { data, error } = await supabase
    .from('bitacora')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo cargar la bitácora');
  return exito((data as FilaBitacora[]).map(aEntrada));
}

/** Busca por INC, técnico, usuario o detalle en toda la bitácora. */
export async function buscarEnBitacora(termino: string): Promise<Resultado<EntradaBitacora[]>> {
  const { data, error } = await supabase.rpc('buscar_en_bitacora', { p_termino: termino });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo buscar en la bitácora');
  return exito((data as FilaBitacora[]).map(aEntrada));
}
