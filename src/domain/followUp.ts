import type { EstadoCaso, Incidente, Notificacion, OrigenResponsable, TipoNotificacion } from '../types/noc';
import { ETIQUETA_ESTADO_CASO } from './handover';

/**
 * Etiquetas sugeridas (D22): un comentario corto que acompaña a la descripción, como en traspasos-noc
 * (chip de color en Outlook, `[ETIQUETA]` en texto). El técnico puede crear las suyas (se guardan en su navegador).
 * VM: al caso se le programó una ventana de mantenimiento. El orden es también la prioridad del reporte.
 */
export const ETIQUETAS_SUGERIDAS = ['Crítico', 'Escalar', 'VM', 'Monitoreo', 'Pendiente cliente', 'Seguimiento'] as const;
export const LARGO_MAXIMO_ETIQUETA = 40;
export const LARGO_MAXIMO_DESCRIPCION = 2000;
/** Cuántas etiquetas propias se recuerdan por navegador. */
export const MAXIMO_ETIQUETAS_PROPIAS = 30;

/** Color (clave de estilo) de cada etiqueta sugerida; las propias usan 'otra'. */
export type ColorDeEtiqueta = 'critico' | 'escalar' | 'vm' | 'monitoreo' | 'pendiente' | 'seguimiento' | 'otra';
const COLORES: Record<string, ColorDeEtiqueta> = {
  'Crítico': 'critico',
  'Escalar': 'escalar',
  'VM': 'vm',
  'Monitoreo': 'monitoreo',
  'Pendiente cliente': 'pendiente',
  'Seguimiento': 'seguimiento'
};

export function colorDeEtiqueta(etiqueta: string | null | undefined): ColorDeEtiqueta | null {
  if (!etiqueta) return null;
  return COLORES[etiqueta] ?? 'otra';
}

const plano = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/**
 * Agrega una etiqueta propia a la lista del navegador: normalizada, sin repetir (ni una sugerida), la más
 * reciente primero y como máximo MAXIMO_ETIQUETAS_PROPIAS.
 */
export function agregarEtiquetaPropia(propias: readonly string[], nueva: string): string[] {
  const etiqueta = normalizarEtiqueta(nueva);
  if (!etiqueta || ETIQUETAS_SUGERIDAS.some((s) => plano(s) === plano(etiqueta))) return [...propias];
  return [etiqueta, ...propias.filter((p) => plano(p) !== plano(etiqueta))].slice(0, MAXIMO_ETIQUETAS_PROPIAS);
}

/** Opciones del combobox de etiquetas: sugeridas primero, luego las propias (y la actual si no está en ninguna). */
export function opcionesDeEtiqueta(propias: readonly string[], actual?: string | null): string[] {
  const opciones: string[] = [...ETIQUETAS_SUGERIDAS];
  for (const p of [...propias, ...(actual ? [actual] : [])]) {
    if (!opciones.some((o) => plano(o) === plano(p))) opciones.push(p);
  }
  return opciones;
}

/** Estados que el técnico puede elegir para su caso (cerrarlo lo saca de su seguimiento). */
export const ESTADOS_DE_SEGUIMIENTO: readonly EstadoCaso[] = ['en_curso', 'pausado', 'resuelto', 'cerrado'];

export interface GruposDeSeguimiento {
  /** Recibidos en un traspaso (de hoy o para el próximo turno). */
  traspaso: Incidente[];
  /** Asignados por el dispatch (o reasignados/reabiertos) en el día operativo de hoy. */
  nuevos: Incidente[];
  /** Abiertos de días anteriores que nadie traspasó: hay que ponerlos al día y traspasarlos. */
  anteriores: Incidente[];
}

const porAsignacion = (a: Incidente, b: Incidente) => a.creadoEn.localeCompare(b.creadoEn);

/** Reparte los casos abiertos de un técnico en las secciones de su vista de Seguimiento. */
export function agruparSeguimiento(casos: Incidente[], tecnicoId: string, fechaHoy: string): GruposDeSeguimiento {
  const mios = casos.filter((c) => c.tecnicoId === tecnicoId && c.estado !== 'cerrado').sort(porAsignacion);
  const esTraspaso = (c: Incidente) => c.origenResponsable === 'traspaso';
  const esAnterior = (c: Incidente) => !!c.fechaResponsable && c.fechaResponsable < fechaHoy;

  return {
    traspaso: mios.filter((c) => esTraspaso(c) && !esAnterior(c)),
    nuevos: mios.filter((c) => !esTraspaso(c) && !esAnterior(c)),
    anteriores: mios.filter(esAnterior)
  };
}

/** Casos propios sin descripción (la necesitan para entregarse en el traspaso, D21). */
export function sinDescripcion(casos: Incidente[]): Incidente[] {
  return casos.filter((c) => !c.descripcion?.trim());
}

/** Horas que marcan el atraso de un caso sin actualizar (las mismas de las alertas de coordinación, D12). */
export const NIVELES_DE_ATRASO = [2, 4, 6] as const;
export type NivelDeAtraso = 0 | (typeof NIVELES_DE_ATRASO)[number];

/**
 * Cuánto lleva el caso sin que el técnico lo toque, en niveles 0/2/4/6 h, contando desde lo más reciente entre
 * su última actualización y la hora en que le llegó. Es una guía visual para el técnico: las alertas de
 * coordinación (que solo cuentan horas dentro del turno) las calcula la base.
 */
export function nivelDeAtraso(caso: Pick<Incidente, 'ultimaActualizacionEn' | 'creadoEn'>, ahora: Date): NivelDeAtraso {
  const horas = horasSinActualizar(caso, ahora);
  if (horas === null) return 0;
  return ([...NIVELES_DE_ATRASO].reverse().find((n) => horas >= n) ?? 0) as NivelDeAtraso;
}

/**
 * Horas que lleva el caso sin actualizar, desde lo más reciente entre su última actualización y la hora en que
 * le llegó a su responsable (sin reiniciarse por turno). Null si no hay ninguna fecha válida.
 */
export function horasSinActualizar(
  caso: Partial<Pick<Incidente, 'ultimaActualizacionEn' | 'creadoEn'>>,
  ahora: Date
): number | null {
  const referencias = [caso.ultimaActualizacionEn, caso.creadoEn].filter((v): v is string => !!v).map((v) => Date.parse(v)).filter((n) => !Number.isNaN(n));
  if (referencias.length === 0) return null;
  return (ahora.getTime() - Math.max(...referencias)) / 3_600_000;
}

/** Cómo se ordenan los casos dentro de cada grupo de Mi seguimiento. */
export type OrdenDeSeguimiento = 'asignacion' | 'atraso';

/** Los que más tiempo llevan sin actualizar primero (los que quedaron sin traspaso, antes que todos). */
export function ordenarPorAtraso<T extends Pick<Incidente, 'ultimaActualizacionEn' | 'creadoEn' | 'sinTraspasoDesde'>>(
  casos: readonly T[],
  ahora: Date
): T[] {
  const peso = (c: T) => (c.sinTraspasoDesde ? 1e9 : 0) + (horasSinActualizar(c, ahora) ?? 0);
  return [...casos].sort((a, b) => peso(b) - peso(a));
}

/** "recién", "hace 12 min", "hace 3 h", "hace 2 d". */
export function haceCuanto(iso: string, ahora: Date): string {
  const minutos = Math.floor((ahora.getTime() - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutos) || minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

/** "21/11 14:05" en la hora local del navegador (sin Intl, igual en todos). */
export function momentoCorto(iso: string): string {
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return '';
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${dos(f.getDate())}/${dos(f.getMonth() + 1)} ${dos(f.getHours())}:${dos(f.getMinutes())}`;
}

/** Texto plano para pegar en un chat o correo: una línea por caso. */
export function resumenParaCopiar(caso: Incidente): string {
  const partes = [
    caso.codigo,
    caso.estado ? ETIQUETA_ESTADO_CASO[caso.estado] : null,
    caso.etiqueta ? `[${caso.etiqueta}]` : null,
    caso.cliente,
    caso.descripcion ?? caso.nota,
    caso.ultimaActualizacionEn ? `Últ. act.: ${momentoCorto(caso.ultimaActualizacionEn)}` : null
  ];
  return partes.filter((p): p is string => !!p && p.trim() !== '').join(' · ');
}

export function resumenDeVarios(casos: Incidente[]): string {
  return casos.map(resumenParaCopiar).join('\n');
}

export const ETIQUETA_ORIGEN: Record<OrigenResponsable, string> = {
  dispatch: 'Asignado por dispatch',
  reasignacion: 'Reasignado',
  traspaso: 'Recibido en traspaso',
  reapertura: 'Reabierto',
  migracion: 'Migrado del tablero anterior'
};

const TEXTO_NOTIFICACION: Record<TipoNotificacion, string> = {
  asignado: 'Te asignaron',
  reasignado: 'Te reasignaron',
  traspaso: 'Recibiste en traspaso',
  recordatorio: 'Recordatorio:',
  cancelado: 'El dispatch canceló',
  cierre_pendiente: 'Traspaso pendiente:'
};

export function describirNotificacion(notificacion: Pick<Notificacion, 'tipo' | 'detalle'>): string {
  return `${TEXTO_NOTIFICACION[notificacion.tipo]} ${notificacion.detalle ?? 'un caso'}`;
}

export function contarNoLeidas(notificaciones: Notificacion[]): number {
  return notificaciones.filter((n) => !n.leida).length;
}

/** Normaliza la etiqueta escrita: sin espacios sobrantes, vacía = sin etiqueta, cortada al máximo. */
export function normalizarEtiqueta(texto: string): string | null {
  const limpia = texto.trim().replace(/\s+/g, ' ').slice(0, LARGO_MAXIMO_ETIQUETA);
  return limpia === '' ? null : limpia;
}
