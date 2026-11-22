/** Rutas de la app respetando la ruta base (en GitHub Pages el sitio cuelga de /<repositorio>/). */
export function construirRutas(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    inicio: `${base}/`,
    login: `${base}/login/`,
    restablecer: `${base}/restablecer/`
  };
}

export const RUTAS = construirRutas(import.meta.env.BASE_URL);

/** Navega reemplazando la entrada del historial (no se puede "volver" a la página anterior). */
export function irA(url: string): void {
  window.location.replace(url);
}
