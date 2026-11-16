/** Rutas de la app respetando la ruta base (en GitHub Pages el sitio cuelga de /<repositorio>/). */
export function construirRutas(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    inicio: `${base}/`,
    login: `${base}/login/`
  };
}

export const RUTAS = construirRutas(import.meta.env.BASE_URL);
