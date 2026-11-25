/**
 * Evita el error más peligroso de tener dos entornos: creer que se trabaja en la base de
 * DESARROLLO estando conectado a la de PRODUCCIÓN (o publicar una compilación con datos de dev).
 *
 *  - `astro dev`   → PUBLIC_APP_ENV debe ser "development"  (.env.development)
 *  - `astro build` → "production" (workflow de producción, base PROD) o "development" (DEV publicado en
 *                    Cloudflare, base DEV, con insignia y título [DEV]). Que la base sea la correcta lo comprueba
 *                    cada workflow antes de compilar (referencia del proyecto de Supabase).
 */
export function validarEntorno(declarado: string | undefined, esCompilacion: boolean): void {
  if (!esCompilacion) {
    if (declarado === 'development') return;
    throw new Error(
      `Estás en desarrollo pero PUBLIC_APP_ENV vale "${declarado ?? ''}". Crea .env.development con las claves de la base de DESARROLLO y PUBLIC_APP_ENV=development.`
    );
  }
  if (declarado === 'production' || declarado === 'development') return;
  throw new Error(`Esta compilación no declara su entorno: PUBLIC_APP_ENV vale "${declarado ?? ''}". Debe ser "production" o "development".`);
}
