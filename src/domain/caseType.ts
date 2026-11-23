/**
 * Tipo de caso por el prefijo del código (§11.11, = `tipo_de_caso()` en SQL, con prueba que verifica que coincidan):
 *   #SR… o #INC… → FRESH (Freshdesk) · SCTASK… → Tarea · INC… → Incidente · lo demás → Otro.
 */
export type TipoDeCaso = 'INC' | 'SCTASK' | 'FRESH' | 'OTRO';

export function tipoDeCaso(codigo: string): TipoDeCaso {
  const c = codigo.trim().toUpperCase();
  if (c.startsWith('#SR') || c.startsWith('#INC')) return 'FRESH';
  if (c.startsWith('SCTASK')) return 'SCTASK';
  if (c.startsWith('INC')) return 'INC';
  return 'OTRO';
}

/** Orden de reparto y de presentación: primero INC, luego SCTASK, luego Fresh. */
export const ORDEN_DE_TIPO: Readonly<Record<TipoDeCaso, number>> = { INC: 1, SCTASK: 2, FRESH: 3, OTRO: 4 };

/** Nombre corto para chips y filtros. */
export const ETIQUETA_TIPO: Readonly<Record<TipoDeCaso, string>> = { FRESH: 'FRESH', SCTASK: 'Tarea', INC: 'Incidente', OTRO: 'Otro' };

/** Tipos que se ofrecen en los filtros (en este orden). */
export const TIPOS_DE_CASO: readonly TipoDeCaso[] = ['FRESH', 'SCTASK', 'INC', 'OTRO'];
