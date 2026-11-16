import type { EstadoConexion } from '../types/noc';
import { supabase } from './supabaseClient';

/**
 * Escucha cambios en técnicos e incidentes (Supabase Realtime).
 * No interpreta el contenido del cambio: solo avisa para que la app vuelva a leer los datos.
 * Devuelve la función para cancelar la suscripción.
 */
export function suscribirCambios(
  alHaberCambios: () => void,
  alCambiarConexion: (estado: EstadoConexion) => void
): () => void {
  alCambiarConexion('conectando');

  const canal = supabase
    .channel('panel-noc')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tecnicos' }, alHaberCambios)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incidentes' }, alHaberCambios)
    .subscribe((estado) => {
      alCambiarConexion(estado === 'SUBSCRIBED' ? 'conectado' : 'desconectado');
    });

  return () => {
    void supabase.removeChannel(canal);
  };
}
