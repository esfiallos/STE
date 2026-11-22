import type { EstadoSolicitud, SolicitudPlanificacion } from '../types/noc';
import { exito, falla, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaSolicitud {
  id: string;
  fecha_operativa: string;
  motivo: string;
  solicitante_nombre: string | null;
  estado: EstadoSolicitud;
  respuesta: string | null;
  resuelta_por_nombre: string | null;
  resuelta_en: string | null;
  vence_en: string | null;
  respuesta_vista: boolean;
  creada_en: string;
}

const aSolicitud = (f: FilaSolicitud): SolicitudPlanificacion => ({
  id: f.id,
  fecha: f.fecha_operativa,
  motivo: f.motivo,
  solicitanteNombre: f.solicitante_nombre,
  estado: f.estado,
  respuesta: f.respuesta,
  resueltaPorNombre: f.resuelta_por_nombre,
  resueltaEn: f.resuelta_en,
  venceEn: f.vence_en,
  respuestaVista: f.respuesta_vista,
  creadaEn: f.creada_en
});

/** Solicitudes de días desde `desde` en adelante (las más recientes primero). */
export async function listarSolicitudes(desde: string): Promise<Resultado<SolicitudPlanificacion[]>> {
  const { data, error } = await supabase
    .from('solicitudes_planificacion')
    .select('*')
    .gte('fecha_operativa', desde)
    .order('creada_en', { ascending: false })
    .limit(200);
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron leer las solicitudes de planificación');
  return exito((data as FilaSolicitud[]).map(aSolicitud));
}

/** La base explica el motivo cuando rechaza (día pasado, ya pendiente, sin permiso…): se muestra tal cual. */
function fallaDeLaBase(error: { message: string; code?: string }, contexto: string): Resultado<never> {
  console.error(`[${contexto}]`, error);
  return falla(error.message || `No se pudo ${contexto}.`, error.code === '23505' ? 'duplicado' : undefined);
}

export async function solicitarEdicion(fecha: string, motivo: string): Promise<Resultado> {
  const { error } = await supabase.rpc('solicitar_edicion_planificacion', { p_fecha: fecha, p_motivo: motivo.trim() });
  return error ? fallaDeLaBase(error, 'enviar la solicitud') : exito();
}

export async function resolverSolicitud(id: string, aprobar: boolean, respuesta: string): Promise<Resultado> {
  const { error } = await supabase.rpc('resolver_solicitud_planificacion', {
    p_id: id,
    p_aprobar: aprobar,
    p_respuesta: respuesta.trim() || null
  });
  return error ? fallaDeLaBase(error, 'responder la solicitud') : exito();
}

export async function marcarRespuestasVistas(ids: string[]): Promise<Resultado> {
  if (ids.length === 0) return exito();
  const { error } = await supabase.from('solicitudes_planificacion').update({ respuesta_vista: true }).in('id', ids);
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron marcar las respuestas como vistas');
  return exito();
}

/** Avisa de cualquier cambio en las solicitudes (nueva, respondida o vista). */
export function suscribirSolicitudes(alCambiar: () => void): () => void {
  const canal = supabase
    .channel('solicitudes-planificacion')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_planificacion' }, () => alCambiar())
    .subscribe();
  return () => {
    void supabase.removeChannel(canal);
  };
}
