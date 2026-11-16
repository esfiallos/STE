import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node', // las pruebas de interfaz piden jsdom con un comentario al inicio del archivo
    testTimeout: 30_000,
    // Valores falsos: las pruebas nunca tocan un Supabase real (usan un servidor simulado).
    env: {
      PUBLIC_APP_ENV: 'development',
      PUBLIC_SUPABASE_URL: 'https://prueba.supabase.co',
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_prueba'
    }
  }
});
