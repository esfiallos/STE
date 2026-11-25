/**
 * Áreas a las que puede pertenecer un caso (catálogo fijo, D8). El técnico la elige en su seguimiento.
 * Misma lista que `public.areas_de_caso()` en la base de datos (una prueba verifica que coincidan).
 */
export const AREAS_DE_CASO = [
  'CPE',
  'PLEX',
  'TX',
  'CORE CS',
  'CORE IP',
  'CORE PS',
  'SIO',
  'SOPORTE DIGITAL',
  'FRESH',
  'REDPRO',
  'PVR',
  'REGIONAL',
  'COMERCIAL'
] as const;

export type AreaDeCaso = (typeof AREAS_DE_CASO)[number];

export function esAreaValida(area: string | null | undefined): area is AreaDeCaso {
  return typeof area === 'string' && (AREAS_DE_CASO as readonly string[]).includes(area);
}

/** Clave de estilo del color del área ("CORE IP" → "core-ip"); null si no es un área del catálogo. */
export function claveDeArea(area: string | null | undefined): string | null {
  return esAreaValida(area) ? area.toLowerCase().replace(/\s+/g, '-') : null;
}

/** Largo máximo del nombre de la empresa (casos.cliente). */
export const LARGO_MAXIMO_EMPRESA = 120;
