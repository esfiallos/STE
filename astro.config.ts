import { writeFile } from 'node:fs/promises';
import type { AstroIntegration } from 'astro';
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import { archivoDeCabeceras } from './src/config/seguridad';

// El sitio se publica en Cloudflare (Workers con archivos estáticos, wrangler.jsonc) en la raíz del dominio: ruta
// base "/". SITE_URL (opcional) la define cada workflow. BASE_PATH queda por si algún día se sirve bajo una subruta.
// https://astro.build/config

/** Escribe dist/_headers (cabeceras HTTP de Cloudflare) con la CSP del Supabase de esta compilación. */
function cabecerasDeCloudflare(): AstroIntegration {
  return {
    name: 'panel-noc:cabeceras',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        // Igual que lo que Astro incrusta en el sitio: variables del sistema (CI) o, en local, .env.production
        const url = process.env.PUBLIC_SUPABASE_URL ?? loadEnv('production', process.cwd(), 'PUBLIC_').PUBLIC_SUPABASE_URL;
        await writeFile(new URL('_headers', dir), archivoDeCabeceras(url));
      }
    }
  };
}

export default defineConfig({
  site: process.env.SITE_URL || undefined,
  base: process.env.BASE_PATH ?? '/',
  integrations: [cabecerasDeCloudflare()]
});
