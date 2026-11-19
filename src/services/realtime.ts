import type { EstadoConexion } from '../types/noc';
import { supabase } from './supabaseClient';

const TABLAS = ['tecnicos', 'jornadas', 'casos', 'caso_responsables'] as const;

/**
 * Escucha cambios en técnicos, jornadas y casos (Supabase Realtime).
 * No interpreta el contenido del cambio: solo avisa para que la app vuelva a leer los datos.
 * Devuelve la función para cancelar la suscripción.
 */
export function suscribirCambios(
  alHaberCambios: () => void,
  alCambiarConexion: (estado: EstadoConexion) => void
): () => void {
  alCambiarConexion('conectando');

  const canal = TABLAS.reduce(
    (c, table) => c.on('postgres_changes', { event: '*', schema: 'public', table }, alHaberCambios),
    supabase.channel('panel-noc')
  ).subscribe((estado) => {
    alCambiarConexion(estado === 'SUBSCRIBED' ? 'conectado' : 'desconectado');
  });

  return () => {
    void supabase.removeChannel(canal);
  };
}
