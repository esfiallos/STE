import type { AvisoPlanificacion, CambioDePlanificacion } from '../types/noc';
import { exito, falla, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaCambio {
  en?: string;
  por?: string | null;
  tecnico?: string | null;
  antes?: string;
  despues?: string;
}

interface FilaAviso {
  id: string;
  fecha_operativa: string;
  motivo: string;
  autor_nombre: string | null;
  creado_en: string;
  vence_en: string;
  cambios: FilaCambio[] | null;
  visto: boolean;
}

const aCambio = (c: FilaCambio): CambioDePlanificacion => ({
  en: c.en ?? '',
  por: c.por ?? null,
  tecnico: c.tecnico ?? null,
  antes: c.antes ?? '',
  despues: c.despues ?? ''
});

const aAviso = (f: FilaAviso): AvisoPlanificacion => ({
  id: f.id,
  fecha: f.fecha_operativa,
  motivo: f.motivo,
  autorNombre: f.autor_nombre,
  creadoEn: f.creado_en,
  venceEn: f.vence_en,
  cambios: (f.cambios ?? []).map(aCambio),
  visto: f.visto
});

/** Avisos de días desde `desde` en adelante (los más recientes primero). */
export async function listarAvisos(desde: string): Promise<Resultado<AvisoPlanificacion[]>> {
  const { data, error } = await supabase
    .from('avisos_planificacion')
    .select('*')
    .gte('fecha_operativa', desde)
    .order('creado_en', { ascending: false })
    .limit(200);
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron leer los cambios de la planificación');
  return exito((data as FilaAviso[]).map(aAviso));
}

/** El dispatch da el motivo de los cambios de un día. La base explica el motivo cuando lo rechaza. */
export async function avisarCambio(fecha: string, motivo: string): Promise<Resultado> {
  const { error } = await supabase.rpc('avisar_cambio_planificacion', { p_fecha: fecha, p_motivo: motivo.trim() });
  if (error) {
    console.error('[avisar el cambio]', error);
    return falla(error.message || 'No se pudo guardar el motivo del cambio.');
  }
  return exito();
}

/** Coordinación ya vio estos avisos. */
export async function marcarAvisosVistos(ids: string[]): Promise<Resultado> {
  if (ids.length === 0) return exito();
  const { error } = await supabase.from('avisos_planificacion').update({ visto: true }).in('id', ids);
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron marcar los avisos como vistos');
  return exito();
}

/** Avisa de cualquier cambio en los avisos (nuevo, con un cambio más o visto). */
export function suscribirAvisos(alCambiar: () => void): () => void {
  const canal = supabase
    .channel('avisos-planificacion')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'avisos_planificacion' }, () => alCambiar())
    .subscribe();
  return () => {
    void supabase.removeChannel(canal);
  };
}
