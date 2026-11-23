import { defineConfig } from 'vitest/config';

// La app trabaja con la hora local de Honduras (día operativo 06:00 → 06:00). Las pruebas fijan la hora
// "local" con fakeTimers, así que la zona horaria debe ser la misma en cualquier máquina: sin esto, el CI
// (UTC) y un equipo en Honduras (UTC-6) dan resultados distintos. Los procesos de prueba la heredan.
process.env.TZ = 'America/Tegucigalpa';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node', // las pruebas de interfaz piden jsdom con un comentario al inicio del archivo
    testTimeout: 60_000,
    // Arrancar PostgreSQL de prueba (PGlite) y migrar el esquema puede pasar de 10 s si corren varios a la vez.
    hookTimeout: 60_000,
    // Valores falsos: las pruebas nunca tocan un Supabase real (usan un servidor simulado).
    env: {
      PUBLIC_APP_ENV: 'development',
      PUBLIC_SUPABASE_URL: 'https://prueba.supabase.co',
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_prueba'
    }
  }
});
