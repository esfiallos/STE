import type { CoincidenciaHistorial, TecnicoConIncidentes } from '../types/noc';
import { exito, falla, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

/** Fechas (YYYY-MM-DD) que tienen snapshot, de la más reciente a la más antigua. */
export async function listarFechasDeSnapshots(): Promise<Resultado<string[]>> {
  const { data, error } = await supabase
    .from('historial_snapshots')
    .select('fecha')
    .order('fecha', { ascending: false });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo cargar el historial');
  return exito((data as { fecha: string }[]).map((fila) => fila.fecha));
}

/** Asegura la forma de cada técnico aunque el snapshot sea de una versión anterior. */
function normalizarSnapshot(datos: unknown): TecnicoConIncidentes[] {
  if (!Array.isArray(datos)) return [];

  return (datos as Partial<TecnicoConIncidentes>[]).map((tecnico) => ({
    id: String(tecnico.id ?? ''),
    nombre: tecnico.nombre ?? '',
    turno: tecnico.turno ?? 'turnoA',
    horarioInicio: tecnico.horarioInicio ?? null,
    horarioFin: tecnico.horarioFin ?? null,
    almuerzoInicio: tecnico.almuerzoInicio ?? null,
    almuerzoFin: tecnico.almuerzoFin ?? null,
    incidentes: (tecnico.incidentes ?? []).map((incidente) => ({ ...incidente, nota: incidente.nota ?? null }))
  }));
}

export async function obtenerSnapshot(fecha: string): Promise<Resultado<TecnicoConIncidentes[]>> {
  const { data, error } = await supabase
    .from('historial_snapshots')
    .select('datos_panel')
    .eq('fecha', fecha)
    .maybeSingle();

  if (error) return errorDeBaseDeDatos(error, 'No se pudo cargar el snapshot');
  if (!data) return falla('No existe un snapshot para esa fecha.');
  return exito(normalizarSnapshot(data.datos_panel));
}

interface FilaCoincidencia {
  fecha: string;
  codigo: string;
  nota: string | null;
  tecnico: string;
  turno: CoincidenciaHistorial['turno'];
}

/** Busca un INC, una nota o un técnico en todos los snapshots. */
export async function buscarEnHistorial(termino: string): Promise<Resultado<CoincidenciaHistorial[]>> {
  const { data, error } = await supabase.rpc('buscar_en_historial', { p_termino: termino });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo buscar en el historial');
  return exito((data as FilaCoincidencia[]).map((fila) => ({ ...fila })));
}
