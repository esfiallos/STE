/**
 * Evita el error más peligroso de tener dos entornos: creer que se trabaja en la base de
 * DESARROLLO estando conectado a la de PRODUCCIÓN (o publicar una compilación con datos de dev).
 *
 *  - `astro dev`   → PUBLIC_APP_ENV debe ser "development"  (.env.development)
 *  - `astro build` → PUBLIC_APP_ENV debe ser "production"    (variables del workflow de producción)
 */
export function validarEntorno(declarado: string | undefined, esCompilacionDeProduccion: boolean): void {
  const esperado = esCompilacionDeProduccion ? 'production' : 'development';
  if (declarado === esperado) return;

  throw new Error(
    esCompilacionDeProduccion
      ? `Esta compilación es de producción pero PUBLIC_APP_ENV vale "${declarado ?? ''}". Debe ser "production".`
      : `Estás en desarrollo pero PUBLIC_APP_ENV vale "${declarado ?? ''}". Crea .env.development con las claves de la base de DESARROLLO y PUBLIC_APP_ENV=development.`
  );
}
