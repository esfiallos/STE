import type { EstadoCaso, ItemTraspaso, ItemTraspasoEnviado, Traspaso, TraspasoDelCaso, TraspasoEnviado, TurnoTecnico } from '../types/noc';
import { exito, type Resultado } from '../types/result';
import { errorDeBaseDeDatos } from './dbErrors';
import { supabase } from './supabaseClient';

interface FilaTraspaso {
  id: string;
  de_tecnico_id: string;
  fecha_operativa: string;
  turno_origen: TurnoTecnico | null;
  estado: 'borrador' | 'enviado';
  enviado_en: string | null;
}

interface FilaItem {
  traspaso_id: string;
  caso_id: string;
  para_tecnico_id: string | null;
  estado: EstadoCaso;
  etiqueta: string | null;
  /** Desde la migración 12 (D21). Los ítems anteriores tienen nota_personalizada / ultima_actualizacion. */
  descripcion?: string | null;
  actualizado_en?: string | null;
  nota_personalizada: string | null;
  ultima_actualizacion: string | null;
  recordatorio_fecha: string | null;
  recordatorio_texto: string | null;
  fecha_destino: string | null;
}

interface FilaCaso {
  id: string;
  codigo: string;
  cliente: string | null;
  area: string | null;
  nota: string | null;
}

const COLUMNAS_TRASPASO = 'id, de_tecnico_id, fecha_operativa, turno_origen, estado, enviado_en';
const COLUMNAS_ITEM =
  'traspaso_id, caso_id, para_tecnico_id, estado, etiqueta, descripcion, actualizado_en, nota_personalizada, ultima_actualizacion, recordatorio_fecha, recordatorio_texto, fecha_destino';

/** La descripción del ítem; en traspasos anteriores a la 12, la nota o el texto de última actualización. */
const descripcionDe = (f: FilaItem): string | null =>
  f.descripcion?.trim() || f.nota_personalizada?.trim() || f.ultima_actualizacion?.trim() || null;

const aItem = (f: FilaItem): ItemTraspaso => ({
  casoId: f.caso_id,
  paraTecnicoId: f.para_tecnico_id,
  estado: f.estado,
  etiqueta: f.etiqueta,
  descripcion: descripcionDe(f),
  recordatorioFecha: f.recordatorio_fecha,
  recordatorioTexto: f.recordatorio_texto,
  actualizadoEn: f.actualizado_en ?? null
});

const aTraspaso = (f: FilaTraspaso, items: ItemTraspaso[]): Traspaso => ({
  id: f.id,
  deTecnicoId: f.de_tecnico_id,
  fecha: f.fecha_operativa,
  turnoOrigen: f.turno_origen,
  estado: f.estado,
  enviadoEn: f.enviado_en,
  items
});

async function leerItems(traspasoIds: string[]): Promise<Resultado<FilaItem[]>> {
  if (traspasoIds.length === 0) return exito([]);
  const { data, error } = await supabase.from('traspaso_items').select(COLUMNAS_ITEM).in('traspaso_id', traspasoIds);
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar los casos del traspaso');
  return exito(data as FilaItem[]);
}

/** El traspaso del técnico en un día operativo (borrador o enviado), o null si aún no lo empezó. */
export async function obtenerTraspasoDelDia(tecnicoId: string, fecha: string): Promise<Resultado<Traspaso | null>> {
  const { data, error } = await supabase
    .from('traspasos')
    .select(COLUMNAS_TRASPASO)
    .eq('de_tecnico_id', tecnicoId)
    .eq('fecha_operativa', fecha)
    .limit(1);
  if (error) return errorDeBaseDeDatos(error, 'No se pudo cargar tu traspaso');
  const fila = (data as FilaTraspaso[])[0];
  if (!fila) return exito(null);

  const items = await leerItems([fila.id]);
  if (!items.ok) return items;
  return exito(aTraspaso(fila, items.data.map(aItem)));
}

/** Crea el borrador del día (si ya existe, lo devuelve). */
export async function crearBorrador(tecnicoId: string, fecha: string): Promise<Resultado<Traspaso>> {
  const { data, error } = await supabase
    .from('traspasos')
    .insert({ de_tecnico_id: tecnicoId, fecha_operativa: fecha })
    .select(COLUMNAS_TRASPASO)
    .single();
  if (error) {
    const existente = await obtenerTraspasoDelDia(tecnicoId, fecha);
    if (existente.ok && existente.data) return exito(existente.data);
    return errorDeBaseDeDatos(error, 'No se pudo empezar el traspaso');
  }
  return exito(aTraspaso(data as FilaTraspaso, []));
}

/** Guarda los ítems del borrador (crea o reemplaza por caso) y quita los de casos que ya no son tuyos. */
export async function guardarItems(traspasoId: string, items: ItemTraspaso[], sobrantes: string[] = []): Promise<Resultado> {
  if (items.length > 0) {
    const filas = items.map((i) => ({
      traspaso_id: traspasoId,
      caso_id: i.casoId,
      para_tecnico_id: i.paraTecnicoId,
      estado: i.estado,
      etiqueta: i.etiqueta,
      descripcion: i.descripcion,
      recordatorio_fecha: i.recordatorioFecha,
      recordatorio_texto: i.recordatorioTexto
    }));
    const { error } = await supabase.from('traspaso_items').upsert(filas, { onConflict: 'traspaso_id,caso_id' });
    if (error) return errorDeBaseDeDatos(error, 'No se pudo guardar el borrador del traspaso');
  }
  if (sobrantes.length > 0) {
    const { error } = await supabase.from('traspaso_items').delete().eq('traspaso_id', traspasoId).in('caso_id', sobrantes);
    if (error) return errorDeBaseDeDatos(error, 'No se pudo actualizar el borrador del traspaso');
  }
  return exito();
}

/** Cierra turno: la base valida y entrega todo en una transacción. Devuelve cuántos casos cambiaron de manos. */
export async function enviarTraspaso(traspasoId: string): Promise<Resultado<number>> {
  const { data, error } = await supabase.rpc('enviar_traspaso', { p_traspaso: traspasoId });
  if (error) return errorDeBaseDeDatos(error, 'No se pudo cerrar turno');
  return exito(Number(data ?? 0));
}

async function leerCasos(ids: string[]): Promise<Resultado<Map<string, FilaCaso>>> {
  if (ids.length === 0) return exito(new Map());
  const { data, error } = await supabase.from('casos').select('id, codigo, cliente, area, nota').in('id', [...new Set(ids)]);
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar los casos del traspaso');
  return exito(new Map((data as FilaCaso[]).map((c) => [c.id, c])));
}

/** Une traspasos, ítems y datos de cada caso. */
async function completar(traspasos: FilaTraspaso[], items: FilaItem[]): Promise<Resultado<TraspasoEnviado[]>> {
  const casos = await leerCasos(items.map((i) => i.caso_id));
  if (!casos.ok) return casos;
  const detalle = (i: FilaItem): ItemTraspasoEnviado | null => {
    const caso = casos.data.get(i.caso_id);
    if (!caso) return null;
    return { ...aItem(i), traspasoId: i.traspaso_id, codigo: caso.codigo, cliente: caso.cliente, area: caso.area, nota: caso.nota, fechaDestino: i.fecha_destino };
  };
  return exito(
    traspasos
      .map((t) => ({
        id: t.id,
        deTecnicoId: t.de_tecnico_id,
        fecha: t.fecha_operativa,
        turnoOrigen: t.turno_origen,
        enviadoEn: t.enviado_en,
        items: items
          .filter((i) => i.traspaso_id === t.id)
          .map(detalle)
          .filter((i): i is ItemTraspasoEnviado => i !== null)
      }))
      .sort((a, b) => (a.enviadoEn ?? '').localeCompare(b.enviadoEn ?? ''))
  );
}

/** Traspaso que el técnico envió en un día operativo (como máximo uno). */
export async function listarEnviados(tecnicoId: string, fecha: string): Promise<Resultado<TraspasoEnviado[]>> {
  const { data, error } = await supabase
    .from('traspasos')
    .select(COLUMNAS_TRASPASO)
    .eq('de_tecnico_id', tecnicoId)
    .eq('fecha_operativa', fecha)
    .eq('estado', 'enviado');
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar tus traspasos');
  const traspasos = data as FilaTraspaso[];
  const items = await leerItems(traspasos.map((t) => t.id));
  if (!items.ok) return items;
  return completar(traspasos, items.data);
}

/** Casos que el técnico recibió para un día operativo, agrupados por el traspaso de quien los entregó. */
export async function listarRecibidos(tecnicoId: string, fecha: string): Promise<Resultado<TraspasoEnviado[]>> {
  const respuesta = await supabase.from('traspaso_items').select(COLUMNAS_ITEM).eq('para_tecnico_id', tecnicoId).eq('fecha_destino', fecha);
  if (respuesta.error) return errorDeBaseDeDatos(respuesta.error, 'No se pudieron cargar los traspasos recibidos');
  const items = respuesta.data as FilaItem[];
  const ids = [...new Set(items.map((i) => i.traspaso_id))];
  if (ids.length === 0) return exito([]);

  const { data, error } = await supabase.from('traspasos').select(COLUMNAS_TRASPASO).in('id', ids);
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar los traspasos recibidos');
  return completar(data as FilaTraspaso[], items);
}

/** Todos los traspasos en los que viajó un caso (ficha del buscador; dispatch y coordinación). */
export async function listarTraspasosDelCaso(casoId: string): Promise<Resultado<TraspasoDelCaso[]>> {
  const respuesta = await supabase.from('traspaso_items').select(COLUMNAS_ITEM).eq('caso_id', casoId);
  if (respuesta.error) return errorDeBaseDeDatos(respuesta.error, 'No se pudieron cargar los traspasos del caso');
  const items = respuesta.data as FilaItem[];
  if (items.length === 0) return exito([]);

  const { data, error } = await supabase
    .from('traspasos')
    .select(COLUMNAS_TRASPASO)
    .in('id', [...new Set(items.map((i) => i.traspaso_id))])
    .eq('estado', 'enviado');
  if (error) return errorDeBaseDeDatos(error, 'No se pudieron cargar los traspasos del caso');
  const traspasos = new Map((data as FilaTraspaso[]).map((t) => [t.id, t]));

  return exito(
    items
      .filter((i) => traspasos.has(i.traspaso_id))
      .map((i) => {
        const t = traspasos.get(i.traspaso_id)!;
        return {
          fecha: t.fecha_operativa,
          deTecnicoId: t.de_tecnico_id,
          paraTecnicoId: i.para_tecnico_id,
          fechaDestino: i.fecha_destino,
          estado: i.estado,
          etiqueta: i.etiqueta,
          descripcion: descripcionDe(i),
          enviadoEn: t.enviado_en
        };
      })
      .sort((a, b) => (a.enviadoEn ?? '').localeCompare(b.enviadoEn ?? ''))
  );
}
