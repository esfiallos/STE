/** Convierte "HH:MM" (o "HH:MM:SS") a minutos desde las 00:00. Devuelve null si no es válida. */
export function aMinutos(hora: string): number | null {
  const coincidencia = /^(\d{1,2}):(\d{2})/.exec(hora);
  if (!coincidencia) return null;

  const horas = Number(coincidencia[1]);
  const minutos = Number(coincidencia[2]);
  if (horas > 23 || minutos > 59) return null;

  return horas * 60 + minutos;
}

export function minutosDelDia(fecha: Date): number {
  return fecha.getHours() * 60 + fecha.getMinutes();
}

/**
 * ¿La hora actual está dentro de [inicio, fin)?
 * Soporta rangos que cruzan la medianoche (ej. 22:00 - 06:00).
 */
export function estaDentroDelRango(inicio: string, fin: string, ahora: Date): boolean {
  const desde = aMinutos(inicio);
  const hasta = aMinutos(fin);
  if (desde === null || hasta === null || desde === hasta) return false;

  const actual = minutosDelDia(ahora);
  return desde < hasta ? actual >= desde && actual < hasta : actual >= desde || actual < hasta;
}

/** Fecha local en formato YYYY-MM-DD (no UTC: evita que de noche caiga en el día siguiente). */
export function formatearFechaLocal(fecha: Date): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}
