import type { Hora, Jornada, TurnoTecnico } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaJornada {
  id: string;
  fecha_operativa: string;
  tecnico_id: string;
  turno: TurnoTecnico;
  horario_inicio: string | null;
  horario_fin: string | null;
  almuerzo_inicio: string | null;
  almuerzo_fin: string | null;
}

/** Postgres devuelve "HH:MM:SS"; la app trabaja con "HH:MM". */
const recortarHora = (hora: string | null): Hora | null => (hora ? hora.slice(0, 5) : null);

function aJornada(fila: FilaJornada): Jornada {
  return {
    id: fila.id,
    fecha: fila.fecha_operativa,
    tecnicoId: fila.tecnico_id,
    turno: fila.turno,
    horarioInicio: recortarHora(fila.horario_inicio),
    horarioFin: recortarHora(fila.horario_fin),
    almuerzoInicio: recortarHora(fila.almuerzo_inicio),
    almuerzoFin: recortarHora(fila.almuerzo_fin)
  };
}

/** Jornadas entre dos fechas operativas (incluidas). */
export async function listarJornadas(desde: string, hasta: string): Promise<Resultado<Jornada[]>> {
  const { data, error } = await supabase
    .from('jornadas')
    .select('*')
    .gte('fecha_operativa', desde)
    .lte('fecha_operativa', hasta);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo cargar la planificación');
  return exito((data as FilaJornada[]).map(aJornada));
}

/** Lo que el dispatch decide para un técnico en un día (sin id: se crea o se reemplaza). */
export type JornadaPlanificada = Omit<Jornada, 'id'>;

/** Crea o reemplaza jornadas (una por técnico y día). */
export async function guardarJornadas(jornadas: JornadaPlanificada[]): Promise<Resultado> {
  if (jornadas.length === 0) return exito();
  const filas = jornadas.map((j) => ({
    fecha_operativa: j.fecha,
    tecnico_id: j.tecnicoId,
    turno: j.turno,
    horario_inicio: j.turno === 'comodin' ? j.horarioInicio : null,
    horario_fin: j.turno === 'comodin' ? j.horarioFin : null,
    almuerzo_inicio: j.almuerzoInicio,
    almuerzo_fin: j.almuerzoFin
  }));
  const { error } = await supabase.from('jornadas').upsert(filas, { onConflict: 'fecha_operativa,tecnico_id' });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo guardar la planificación');
  return exito();
}

export async function borrarJornada(id: string): Promise<Resultado> {
  const { error } = await supabase.from('jornadas').delete().eq('id', id);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo quitar la jornada');
  return exito();
}

/** Pasa null en ambas horas para limpiar el horario. */
export async function actualizarAlmuerzo(jornadaId: string, inicio: Hora | null, fin: Hora | null): Promise<Resultado> {
  const { error } = await supabase
    .from('jornadas')
    .update({ almuerzo_inicio: inicio, almuerzo_fin: fin })
    .eq('id', jornadaId);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo guardar el horario de comida');
  return exito();
}
