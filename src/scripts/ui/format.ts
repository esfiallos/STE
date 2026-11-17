export function formatearFechaLarga(fecha: string): string {
  const texto = new Date(`${fecha}T00:00:00`).toLocaleDateString('es-HN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function formatearFechaCorta(fecha: string): string {
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-HN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatearFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-HN', { dateStyle: 'short', timeStyle: 'medium' });
}
