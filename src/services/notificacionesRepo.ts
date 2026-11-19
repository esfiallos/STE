import type { Notificacion, TipoNotificacion } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaNotificacion {
  id: string;
  tipo: TipoNotificacion;
  caso_id: string;
  detalle: string | null;
  leida: boolean;
  creado_en: string;
}

export const aNotificacion = (fila: FilaNotificacion): Notificacion => ({
  id: fila.id,
  tipo: fila.tipo,
  casoId: fila.caso_id,
  detalle: fila.detalle,
  leida: fila.leida,
  creadoEn: fila.creado_en
});

/** Últimas notificaciones del técnico con sesión (RLS: cada uno solo ve las suyas). */
export async function listarNotificaciones(limite = 50): Promise<Resultado<Notificacion[]>> {
  const { data, error } = await supabase
    .from('notificaciones')
    .select('id, tipo, caso_id, detalle, leida, creado_en')
    .order('creado_en', { ascending: false })
    .limit(limite);
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar las notificaciones');
  return exito((data as FilaNotificacion[]).map(aNotificacion));
}

export async function marcarLeida(id: string): Promise<Resultado> {
  const { error } = await supabase.from('notificaciones').update({ leida: true }).eq('id', id);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo marcar la notificación');
  return exito();
}

export async function marcarTodasLeidas(tecnicoId: string): Promise<Resultado> {
  const { error } = await supabase.from('notificaciones').update({ leida: true }).eq('tecnico_id', tecnicoId).eq('leida', false);
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron marcar las notificaciones');
  return exito();
}

/**
 * Avisa en tiempo real de cada notificación NUEVA del técnico (Supabase Realtime respeta RLS).
 * Devuelve la función para cancelar la suscripción.
 */
export function suscribirNotificaciones(tecnicoId: string, alLlegar: (notificacion: Notificacion) => void): () => void {
  const canal = supabase
    .channel(`notificaciones-${tecnicoId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: `tecnico_id=eq.${tecnicoId}` },
      (cambio) => alLlegar(aNotificacion(cambio.new as FilaNotificacion))
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(canal);
  };
}
