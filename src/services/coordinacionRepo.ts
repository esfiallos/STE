import { resumirEstadisticas, type EstadisticasDelDia } from '../domain/coordination';
import type { AlertaCoordinacion, CasoEncontrado, EstadoCaso, TipoAlerta } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaCasoEncontrado {
  id: string;
  codigo: string;
  cliente: string | null;
  area: string | null;
  nota: string | null;
  descripcion: string | null;
  estado: EstadoCaso;
  etiqueta: string | null;
  ultima_actualizacion: string | null;
  ultima_actualizacion_en: string | null;
  ultima_actualizacion_por: string | null;
  actividad_tecnico_en: string | null;
  tecnico_actual_id: string | null;
  tecnico_actual: string | null;
  creado_en: string;
  creado_por: string | null;
  cerrado_en: string | null;
  recordatorio_fecha: string | null;
  recordatorio_texto: string | null;
}

const aCasoEncontrado = (f: FilaCasoEncontrado): CasoEncontrado => ({
  id: f.id,
  codigo: f.codigo,
  cliente: f.cliente,
  area: f.area,
  nota: f.nota,
  descripcion: f.descripcion,
  estado: f.estado,
  etiqueta: f.etiqueta,
  ultimaActualizacion: f.ultima_actualizacion,
  ultimaActualizacionEn: f.ultima_actualizacion_en,
  ultimaActualizacionPor: f.ultima_actualizacion_por,
  actividadTecnicoEn: f.actividad_tecnico_en,
  tecnicoActualId: f.tecnico_actual_id,
  tecnicoActual: f.tecnico_actual,
  creadoEn: f.creado_en,
  creadoPor: f.creado_por,
  cerradoEn: f.cerrado_en,
  recordatorioFecha: f.recordatorio_fecha,
  recordatorioTexto: f.recordatorio_texto
});

/** Busca en todos los casos alguna vez creados (código, empresa, área, nota, actualización, técnico). */
export async function buscarCasos(termino: string, limite = 50): Promise<Resultado<CasoEncontrado[]>> {
  const { data, error } = await supabase.rpc('buscar_casos', { p_termino: termino, p_limite: limite });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo buscar');
  return exito(((data ?? []) as FilaCasoEncontrado[]).map(aCasoEncontrado));
}

/** Casos que tuvieron responsable en el día operativo, por estado actual. */
export async function estadisticasDelDia(fecha: string): Promise<Resultado<EstadisticasDelDia>> {
  const { data, error } = await supabase.rpc('estadisticas_del_dia', { p_fecha: fecha });
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar las estadísticas');
  return exito(resumirEstadisticas((data ?? []) as { estado: EstadoCaso; total: number }[]));
}

interface FilaAlerta {
  id: string;
  tipo: TipoAlerta;
  caso_id: string;
  tecnico_id: string | null;
  tecnico_nombre: string | null;
  nivel: 2 | 4 | 6 | null;
  referencia: string;
  detalle: string | null;
  leida: boolean;
  creado_en: string;
}

export const aAlerta = (f: FilaAlerta): AlertaCoordinacion => ({
  id: f.id,
  tipo: f.tipo,
  casoId: f.caso_id,
  tecnicoId: f.tecnico_id,
  tecnicoNombre: f.tecnico_nombre,
  nivel: f.nivel,
  referencia: f.referencia,
  detalle: f.detalle,
  leida: f.leida,
  creadoEn: f.creado_en
});

/** Últimas alertas de coordinación (RLS: solo coordinadores). */
export async function listarAlertas(limite = 100): Promise<Resultado<AlertaCoordinacion[]>> {
  const { data, error } = await supabase
    .from('alertas_coordinacion')
    .select('id, tipo, caso_id, tecnico_id, tecnico_nombre, nivel, referencia, detalle, leida, creado_en')
    .order('creado_en', { ascending: false })
    .limit(limite);
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar las alertas');
  return exito((data as FilaAlerta[]).map(aAlerta));
}

/** Marca leídas las alertas indicadas. */
export async function marcarAlertasLeidas(ids: string[]): Promise<Resultado> {
  if (ids.length === 0) return exito();
  const { error } = await supabase.from('alertas_coordinacion').update({ leida: true }).in('id', ids);
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron marcar las alertas');
  return exito();
}

/** Avisa cada alerta NUEVA en tiempo real. Devuelve la función para cancelar la suscripción. */
export function suscribirAlertas(alLlegar: (alerta: AlertaCoordinacion) => void): () => void {
  const canal = supabase
    .channel('alertas-coordinacion')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alertas_coordinacion' }, (cambio) =>
      alLlegar(aAlerta(cambio.new as FilaAlerta))
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(canal);
  };
}
