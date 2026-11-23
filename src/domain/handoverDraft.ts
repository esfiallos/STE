/**
 * Borrador del traspaso de fin de turno: a quién se puede entregar, cómo se arma a partir de los casos
 * propios y qué falta para poder cerrar turno. La base de datos vuelve a validar todo en enviar_traspaso().
 */
import type { Incidente, ItemTraspaso, Jornada, ReceptorTraspaso, TecnicoCatalogo, TurnoTecnico } from '../types/noc';
import { normalizarEtiqueta } from './followUp';
import { debeTraspasarse, puedeRecibirTraspaso } from './handover';
import type { DestinoDeBloque, FilaDeReporte } from './handoverReport';

const ORDEN_DE_TURNO: Record<TurnoTecnico, number> = { turnoA: 1, comodin: 2, turnoB: 3, turnoC: 4 };

/**
 * Técnicos planificados que pueden recibir de quien entrega (D6), con el día en que reciben.
 * `jornadas` debe traer el día de quien entrega y el siguiente. Orden: día, turno, nombre.
 */
export function receptoresDelTraspaso(
  turnoOrigen: TurnoTecnico,
  fechaOrigen: string,
  jornadas: Jornada[],
  catalogo: TecnicoCatalogo[],
  miTecnicoId: string
): ReceptorTraspaso[] {
  const porId = new Map(catalogo.map((t) => [t.id, t]));
  return jornadas
    .filter((j) => j.tecnicoId !== miTecnicoId && porId.get(j.tecnicoId)?.activo)
    .filter((j) => puedeRecibirTraspaso(turnoOrigen, fechaOrigen, j.turno, j.fecha))
    .map((j) => ({
      tecnicoId: j.tecnicoId,
      nombre: porId.get(j.tecnicoId)!.nombre,
      turno: j.turno,
      fecha: j.fecha,
      horarioInicio: j.horarioInicio,
      horarioFin: j.horarioFin
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || ORDEN_DE_TURNO[a.turno] - ORDEN_DE_TURNO[b.turno] || a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Ítem nuevo de un caso, precargado con su estado, etiqueta, descripción y recordatorio actuales:
 * enviar_traspaso escribe los valores del ítem en el caso (un ítem vacío borraría la etiqueta).
 * Un recordatorio ya vencido no se arrastra.
 */
export function itemInicial(caso: Incidente, fechaHoy: string): ItemTraspaso {
  const recordatorioVigente = !!caso.recordatorioFecha && caso.recordatorioFecha >= fechaHoy;
  return {
    casoId: caso.id,
    paraTecnicoId: null,
    estado: caso.estado ?? 'en_curso',
    etiqueta: caso.etiqueta ?? null,
    descripcion: caso.descripcion ?? null,
    recordatorioFecha: recordatorioVigente ? caso.recordatorioFecha! : null,
    recordatorioTexto: recordatorioVigente ? (caso.recordatorioTexto ?? null) : null
  };
}

/**
 * Une los casos propios abiertos con lo ya guardado en el borrador: cada caso tiene su ítem (el guardado
 * o uno nuevo precargado) y se descartan los ítems de casos que ya no son míos.
 * La descripción siempre es la del caso (D21): es una sola nota, la misma de Mi seguimiento.
 */
export function combinarBorrador(
  misCasos: Incidente[],
  guardados: ItemTraspaso[],
  fechaHoy: string
): { items: ItemTraspaso[]; sobrantes: string[] } {
  const porCaso = new Map(guardados.map((i) => [i.casoId, i]));
  const ids = new Set(misCasos.map((c) => c.id));
  return {
    items: misCasos.map((c) => {
      const item = porCaso.get(c.id) ?? itemInicial(c, fechaHoy);
      // Gana la del caso; si el caso aún no tiene (se está guardando lo recién escrito), se conserva la del ítem.
      return { ...item, descripcion: c.descripcion ?? item.descripcion ?? null };
    }),
    sobrantes: guardados.filter((i) => !ids.has(i.casoId)).map((i) => i.casoId)
  };
}

/** Limpia lo que escribió el usuario antes de guardarlo (espacios, vacíos = null, etiqueta normalizada). */
export function normalizarItem(item: ItemTraspaso): ItemTraspaso {
  const texto = (valor: string | null) => (valor?.trim() ? valor.trim() : null);
  return {
    ...item,
    paraTecnicoId: item.estado === 'cerrado' ? null : item.paraTecnicoId,
    etiqueta: item.etiqueta ? normalizarEtiqueta(item.etiqueta) : null,
    descripcion: texto(item.descripcion),
    recordatorioFecha: item.estado === 'cerrado' ? null : item.recordatorioFecha || null,
    recordatorioTexto: item.estado === 'cerrado' ? null : texto(item.recordatorioTexto)
  };
}

export interface ProblemaDelTraspaso {
  casoId: string | null;
  mensaje: string;
}

/**
 * Lo que impide cerrar turno (D2): cada caso no cerrado necesita un receptor válido y su descripción (D21);
 * un recordatorio necesita fecha y no puede ser de un día pasado.
 */
export function problemasDelTraspaso(
  items: ItemTraspaso[],
  casos: Pick<Incidente, 'id' | 'codigo'>[],
  receptores: ReceptorTraspaso[],
  fechaHoy: string
): ProblemaDelTraspaso[] {
  const problemas: ProblemaDelTraspaso[] = [];
  const validos = new Set(receptores.map((r) => r.tecnicoId));
  const codigo = new Map(casos.map((c) => [c.id, c.codigo]));
  const porCaso = new Map(items.map((i) => [i.casoId, i]));

  if (receptores.length === 0 && items.some((i) => debeTraspasarse(i.estado))) {
    problemas.push({ casoId: null, mensaje: 'No hay nadie planificado que pueda recibir tu traspaso: avisa al dispatch.' });
  }
  for (const caso of casos) {
    if (!porCaso.has(caso.id)) problemas.push({ casoId: caso.id, mensaje: `${caso.codigo} no está en el traspaso.` });
  }
  for (const item of items) {
    const c = codigo.get(item.casoId) ?? 'Un caso';
    if (!debeTraspasarse(item.estado)) continue;
    if (!item.paraTecnicoId) problemas.push({ casoId: item.casoId, mensaje: `${c}: elige a quién se entrega.` });
    else if (!validos.has(item.paraTecnicoId)) problemas.push({ casoId: item.casoId, mensaje: `${c}: el receptor ya no puede recibir de tu turno.` });
    if (!item.descripcion?.trim()) problemas.push({ casoId: item.casoId, mensaje: `${c}: falta la descripción.` });
    if (!item.recordatorioFecha && item.recordatorioTexto?.trim()) problemas.push({ casoId: item.casoId, mensaje: `${c}: el recordatorio necesita fecha.` });
    if (item.recordatorioFecha && item.recordatorioFecha < fechaHoy) problemas.push({ casoId: item.casoId, mensaje: `${c}: el recordatorio tiene una fecha pasada.` });
  }
  return problemas;
}

/** Caso con los datos que muestra el reporte (de casos_abiertos o de un traspaso enviado). */
export type DatosDelCaso = Pick<Incidente, 'id' | 'codigo' | 'cliente' | 'area' | 'nota'> &
  Partial<Pick<Incidente, 'descripcion' | 'ultimaActualizacionEn'>>;

/** Prepara las filas del reporte: cada ítem con el destino de su receptor (cerrados sin destino). */
export function entradasDelReporte(
  items: ItemTraspaso[],
  casos: DatosDelCaso[],
  destinos: Map<string, DestinoDeBloque>
): { destino: DestinoDeBloque | null; fila: FilaDeReporte }[] {
  const porId = new Map(casos.map((c) => [c.id, c]));
  return items.flatMap((item) => {
    const caso = porId.get(item.casoId);
    if (!caso) return [];
    const destino = item.estado === 'cerrado' || !item.paraTecnicoId ? null : (destinos.get(item.paraTecnicoId) ?? null);
    if (item.estado !== 'cerrado' && !destino) return []; // sin receptor todavía: no entra al reporte
    return [
      {
        destino,
        fila: {
          codigo: caso.codigo,
          empresa: caso.cliente ?? null,
          area: caso.area ?? null,
          estado: item.estado,
          etiqueta: item.etiqueta,
          descripcion: item.descripcion?.trim() || caso.descripcion?.trim() || caso.nota || null,
          ultimaActualizacionEn: item.actualizadoEn ?? caso.ultimaActualizacionEn ?? null,
          recordatorioFecha: item.recordatorioFecha,
          recordatorioTexto: item.recordatorioTexto
        }
      }
    ];
  });
}
