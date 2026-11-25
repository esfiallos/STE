/**
 * Política de seguridad del sitio publicado (D35). Una sola fuente para:
 *  - la `<meta>` de `layouts/Layout.astro` (respaldo, p. ej. con `astro preview`), y
 *  - las cabeceras HTTP de Cloudflare (`dist/_headers`, las escribe la integración de `astro.config.ts`), que
 *    además pueden llevar `frame-ancestors` (anti-clickjacking): desde una `<meta>` el navegador lo ignora.
 * Sin DOM ni Supabase: la importan el layout y la configuración de Astro.
 */

/** Origen de Supabase a partir de PUBLIC_SUPABASE_URL (null si no es una URL). */
function origenDeSupabase(url: string | undefined): URL | null {
  try {
    return new URL(url ?? '');
  } catch {
    return null;
  }
}

/**
 * Solo scripts propios, conexiones a nuestro Supabase (HTTP y Realtime) y estilos/fuentes propios o del CDN de
 * iconos. 'unsafe-inline' en estilos hace falta por los style="" del reporte del traspaso y las muestras de color.
 */
export function directivasDeContenido(supabaseUrl: string | undefined): string[] {
  const supabase = origenDeSupabase(supabaseUrl);
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "font-src 'self' data: https://cdnjs.cloudflare.com",
    "img-src 'self' data:",
    `connect-src 'self'${supabase ? ` ${supabase.origin} wss://${supabase.host}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ];
}

/** Para la `<meta http-equiv="Content-Security-Policy">`. */
export const politicaParaMeta = (supabaseUrl: string | undefined) => directivasDeContenido(supabaseUrl).join('; ');

/**
 * Archivo `_headers` de Cloudflare: cabeceras para todo el sitio y caché larga para `/_astro/*` (nombres con hash).
 * El panel es interno: nunca se indexa.
 */
export function archivoDeCabeceras(supabaseUrl: string | undefined): string {
  const csp = [...directivasDeContenido(supabaseUrl), "frame-ancestors 'none'"].join('; ');
  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Frame-Options: DENY',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    '  X-Robots-Tag: noindex, nofollow',
    '',
    '/_astro/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    ''
  ].join('\n');
}
