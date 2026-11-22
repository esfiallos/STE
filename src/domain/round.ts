/**
 * Ronda de asignación (D10): el caso va al siguiente técnico disponible en orden alfabético, rotando dentro
 * del turno en curso. Misma regla que `public.asignar_a_ronda()` en la base de datos, que es la que decide;
 * aquí solo se calcula para mostrar "siguiente en la ronda" antes de asignar.
 */
import type { TurnoId } from '../types/noc';
import { TURNOS } from './shifts';
import { estaDentroDelRango } from './time';

/** Clave de orden: minúsculas, sin acentos y con espacios simples (= public.clave_de_ronda). */
export function claveDeRonda(nombre: string): string {
  return nombre
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Comparación byte a byte, igual que `collate "C"` en la base. */
const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface CandidatoDeRonda {
  id: string;
  nombre: string;
}

/** Candidatos en el orden de la ronda. */
export function ordenarRonda<T extends CandidatoDeRonda>(candidatos: T[]): T[] {
  return [...candidatos].sort(
    (a, b) => comparar(claveDeRonda(a.nombre), claveDeRonda(b.nombre)) || comparar(a.nombre, b.nombre) || comparar(a.id, b.id)
  );
}

/**
 * Quién recibe el próximo caso: el primero (en orden) cuyo nombre va después del último que recibió en
 * este turno; si no hay ninguno después, se vuelve al primero. null si nadie está disponible.
 */
export function siguienteEnRonda<T extends CandidatoDeRonda>(candidatos: T[], ultimoNombre: string | null): T | null {
  const orden = ordenarRonda(candidatos);
  if (orden.length === 0) return null;
  if (!ultimoNombre) return orden[0]!;
  const ultimo = claveDeRonda(ultimoNombre);
  return orden.find((c) => comparar(claveDeRonda(c.nombre), ultimo) > 0) ?? orden[0]!;
}

/** Turno A, B o C en curso a una hora (el puntero de la ronda se reinicia al empezar cada uno). */
export function turnoEnCurso(ahora: Date): TurnoId {
  return TURNOS.find((t) => estaDentroDelRango(t.inicio, t.fin, ahora))?.id ?? 'turnoC';
}
