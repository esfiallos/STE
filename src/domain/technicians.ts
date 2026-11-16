/** Iniciales para el avatar: dos palabras → una letra de cada una; una palabra → dos letras. */
export function obtenerIniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length >= 2) {
    return palabras
      .slice(0, 2)
      .map((palabra) => palabra.charAt(0))
      .join('')
      .toUpperCase();
  }
  return nombre.trim().slice(0, 2).toUpperCase();
}
