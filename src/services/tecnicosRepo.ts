import type { Hora, Tecnico, TurnoTecnico } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaTecnico {
  id: string;
  nombre: string;
  turno: TurnoTecnico;
  horario_inicio: string | null;
  horario_fin: string | null;
  almuerzo_inicio: string | null;
  almuerzo_fin: string | null;
}

/** Postgres devuelve "HH:MM:SS"; la app trabaja con "HH:MM". */
const recortarHora = (hora: string | null): Hora | null => (hora ? hora.slice(0, 5) : null);

function aTecnico(fila: FilaTecnico): Tecnico {
  return {
    id: fila.id,
    nombre: fila.nombre,
    turno: fila.turno,
    horarioInicio: recortarHora(fila.horario_inicio),
    horarioFin: recortarHora(fila.horario_fin),
    almuerzoInicio: recortarHora(fila.almuerzo_inicio),
    almuerzoFin: recortarHora(fila.almuerzo_fin)
  };
}

export async function listarTecnicos(): Promise<Resultado<Tecnico[]>> {
  const { data, error } = await supabase.from('tecnicos').select('*').order('nombre', { ascending: true });
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar los técnicos');
  return exito((data as FilaTecnico[]).map(aTecnico));
}

export interface HorarioLaboral {
  inicio: Hora;
  fin: Hora;
}

/** El horario laboral solo aplica al turno "comodin". */
export async function crearTecnico(nombre: string, turno: TurnoTecnico, horario?: HorarioLaboral): Promise<Resultado> {
  const { error } = await supabase.from('tecnicos').insert({
    nombre: nombre.trim(),
    turno,
    horario_inicio: turno === 'comodin' ? (horario?.inicio ?? null) : null,
    horario_fin: turno === 'comodin' ? (horario?.fin ?? null) : null
  });
  if (error) {
    return errorDeBaseDeDatos(error, 'No se pudo agregar el técnico', 'Ya existe un técnico con ese nombre en el turno.');
  }
  return exito();
}

export async function borrarTecnico(id: string): Promise<Resultado> {
  const { error } = await supabase.from('tecnicos').delete().eq('id', id);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo eliminar el técnico');
  return exito();
}

/** Pasa null en ambas horas para limpiar el horario. */
export async function actualizarAlmuerzo(id: string, inicio: Hora | null, fin: Hora | null): Promise<Resultado> {
  const { error } = await supabase
    .from('tecnicos')
    .update({ almuerzo_inicio: inicio, almuerzo_fin: fin })
    .eq('id', id);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo guardar el horario de comida');
  return exito();
}
