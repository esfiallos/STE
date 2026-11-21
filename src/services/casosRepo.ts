import type { EstadoCaso, Incidente, OrigenResponsable, ResponsableCaso } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaCasoAbierto {
  id: string;
  codigo: string;
  cliente?: string | null;
  area?: string | null;
  descripcion?: string | null;
  nota: string | null;
  estado: EstadoCaso;
  etiqueta?: string | null;
  tecnico_actual_id: string | null;
  ultima_actualizacion?: string | null;
  ultima_actualizacion_en?: string | null;
  ultima_actualizacion_por?: string | null;
  creado_en: string;
  fecha_responsable: string | null;
  asignado_en: string | null;
  /** Desde la migración 06. */
  origen_responsable?: OrigenResponsable | null;
  /** Desde la migración 07. */
  actividad_tecnico_en?: string | null;
  recordatorio_fecha?: string | null;
  recordatorio_texto?: string | null;
}

function aIncidente(fila: FilaCasoAbierto): Incidente {
  return {
    id: fila.id,
    codigo: fila.codigo,
    nota: fila.nota,
    tecnicoId: fila.tecnico_actual_id,
    creadoEn: fila.asignado_en ?? fila.creado_en,
    estado: fila.estado,
    fechaResponsable: fila.fecha_responsable,
    origenResponsable: fila.origen_responsable ?? null,
    cliente: fila.cliente ?? null,
    area: fila.area ?? null,
    descripcion: fila.descripcion ?? null,
    etiqueta: fila.etiqueta ?? null,
    ultimaActualizacion: fila.ultima_actualizacion ?? null,
    ultimaActualizacionEn: fila.ultima_actualizacion_en ?? null,
    ultimaActualizacionPor: fila.ultima_actualizacion_por ?? null,
    actividadTecnicoEn: fila.actividad_tecnico_en ?? null,
    recordatorioFecha: fila.recordatorio_fecha ?? null,
    recordatorioTexto: fila.recordatorio_texto ?? null
  };
}

/** Lo que el técnico puede cambiar de SUS casos (la base de datos rechaza cualquier otra columna). */
export interface CambiosDeSeguimiento {
  estado?: EstadoCaso;
  etiqueta?: string | null;
  ultimaActualizacion?: string | null;
  /** Una de AREAS_DE_CASO (la base rechaza otra). */
  area?: string | null;
  /** Empresa (columna `cliente`). */
  empresa?: string | null;
}

export async function actualizarSeguimiento(id: string, cambios: CambiosDeSeguimiento): Promise<Resultado> {
  const fila: Record<string, unknown> = {};
  if (cambios.estado !== undefined) fila.estado = cambios.estado;
  if (cambios.etiqueta !== undefined) fila.etiqueta = cambios.etiqueta;
  if (cambios.ultimaActualizacion !== undefined) fila.ultima_actualizacion = cambios.ultimaActualizacion;
  if (cambios.area !== undefined) fila.area = cambios.area;
  if (cambios.empresa !== undefined) fila.cliente = cambios.empresa;

  const { error } = await supabase.from('casos').update(fila).eq('id', id);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo actualizar el caso');
  return exito();
}

interface FilaResponsable {
  tecnico_nombre: string;
  fecha_operativa: string;
  origen: OrigenResponsable;
  desde: string;
  hasta: string | null;
  asignado_por: string;
}

/** Historial de responsables de un caso, del más antiguo al actual. */
export async function listarResponsables(casoId: string): Promise<Resultado<ResponsableCaso[]>> {
  const { data, error } = await supabase
    .from('caso_responsables')
    .select('tecnico_nombre, fecha_operativa, origen, desde, hasta, asignado_por')
    .eq('caso_id', casoId)
    .order('desde', { ascending: true });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo cargar el historial del caso');
  return exito(
    (data as FilaResponsable[]).map((f) => ({
      tecnicoNombre: f.tecnico_nombre,
      fechaOperativa: f.fecha_operativa,
      origen: f.origen,
      desde: f.desde,
      hasta: f.hasta,
      asignadoPor: f.asignado_por
    }))
  );
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
