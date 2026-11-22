import type { EstadoCaso, Incidente, Notificacion, OrigenResponsable, TipoNotificacion } from '../types/noc';
import { ETIQUETA_ESTADO_CASO } from './handover';

/** Etiquetas que se ofrecen al técnico (también puede escribir una propia, hasta 40 caracteres). */
/** VM: al caso se le programó una ventana de mantenimiento (VM). */
export const ETIQUETAS_SUGERIDAS = ['Crítico', 'Monitoreo', 'Pendiente cliente', 'Escalar', 'VM'] as const;
export const LARGO_MAXIMO_ETIQUETA = 40;
export const LARGO_MAXIMO_ACTUALIZACION = 500;

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

/** Casos propios que aún no tienen última actualización (la necesitan para el traspaso). */
export function sinActualizar(casos: Incidente[]): Incidente[] {
  return casos.filter((c) => !c.ultimaActualizacion?.trim());
}

/** Texto plano para pegar en un chat o correo: una línea por caso. */
export function resumenParaCopiar(caso: Incidente): string {
  const partes = [
    caso.codigo,
    caso.estado ? ETIQUETA_ESTADO_CASO[caso.estado] : null,
    caso.etiqueta ? `[${caso.etiqueta}]` : null,
    caso.cliente,
    caso.descripcion ?? caso.nota,
    caso.ultimaActualizacion ? `Últ. act.: ${caso.ultimaActualizacion}` : null
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
  cancelado: 'El dispatch canceló'
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
