import type { AvisoPlanificacion, CambioDePlanificacion, Rol } from '../types/noc';

/** Igual que el check de `avisos_planificacion.motivo` (sql/18). */
export const MAX_MOTIVO_AVISO = 500;

/** "2026-11-10" → "10/11". */
const diaYMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;

/** Aviso vigente para ese día: con él el dispatch cambia sin volver a dar el motivo (= `aviso_de_planificacion`). */
export function avisoVigente(fecha: string, avisos: readonly AvisoPlanificacion[], ahora: Date): AvisoPlanificacion | undefined {
  return avisos.find((a) => a.fecha === fecha && new Date(a.venceEn).getTime() > ahora.getTime());
}

export interface ContextoDePlanificacion {
  rol: Rol | undefined;
  /** Día operativo en curso. */
  hoy: string;
  ahora: Date;
  avisos: readonly AvisoPlanificacion[];
}

/** Misma regla que `puede_planificar()` (sql/18): dispatch y coordinación, de hoy en adelante (D38, D15). */
export function diaEditable(fecha: string, { rol, hoy }: Pick<ContextoDePlanificacion, 'rol' | 'hoy'>): boolean {
  return fecha >= hoy && (rol === 'coordinador' || rol === 'dispatch');
}

/** El dispatch da el motivo la primera vez que cambia un turno de ese día (el almuerzo no lo pide). */
export function pideMotivo(fecha: string, contexto: ContextoDePlanificacion): boolean {
  return contexto.rol === 'dispatch' && diaEditable(fecha, contexto) && !avisoVigente(fecha, contexto.avisos, contexto.ahora);
}

/** Lo mismo que valida `avisar_cambio_planificacion()`; null si se puede enviar. */
export function problemaDeAviso(fecha: string, motivo: string, hoy: string): string | null {
  if (!fecha) return 'Indica el día que cambias.';
  if (fecha < hoy) return `El ${diaYMes(fecha)} ya pasó: los días pasados no se planifican.`;
  const texto = motivo.trim();
  if (!texto) return 'Indica el motivo del cambio.';
  if (texto.length > MAX_MOTIVO_AVISO) return `El motivo no puede pasar de ${MAX_MOTIVO_AVISO} caracteres.`;
  return null;
}

/** Lo que coordinación aún no ha visto. El más reciente primero. */
export function avisosSinVer(avisos: readonly AvisoPlanificacion[]): AvisoPlanificacion[] {
  return avisos.filter((a) => !a.visto).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
}

/** "Dispatch Uno cambió la planificación del 10/11 (2 cambios): Luis se reportó enfermo" */
export function describirAviso(a: AvisoPlanificacion): string {
  const n = a.cambios.length;
  const cuantos = n === 0 ? '' : n === 1 ? ' (1 cambio)' : ` (${n} cambios)`;
  return `${a.autorNombre ?? 'Dispatch'} cambió la planificación del ${diaYMes(a.fecha)}${cuantos}: ${a.motivo}`;
}

/** "Beto Ruiz: Turno B → Libre" (+ " · Dispatch Dos" si lo hizo otro que quien dio el motivo). */
export function describirCambio(c: CambioDePlanificacion, autorDelAviso?: string | null): string {
  const base = `${c.tecnico ?? 'Técnico'}: ${c.antes} → ${c.despues}`;
  return c.por && c.por !== autorDelAviso ? `${base} · ${c.por}` : base;
}

/**
 * Compara dos lecturas y devuelve lo que merece aviso a coordinación: avisos nuevos o con cambios nuevos que aún
 * no vio. Al dispatch no se le avisa nada (los cambios son suyos).
 */
export function novedadesDeAvisos(
  antes: readonly AvisoPlanificacion[],
  ahora: readonly AvisoPlanificacion[],
  rol: Rol | undefined
): AvisoPlanificacion[] {
  if (rol !== 'coordinador') return [];
  const previos = new Map(antes.map((a) => [a.id, a]));
  return ahora.filter((a) => {
    if (a.visto) return false;
    const previo = previos.get(a.id);
    return !previo || a.cambios.length > previo.cambios.length;
  });
}
