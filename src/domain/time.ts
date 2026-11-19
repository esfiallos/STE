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

function segmentos(desde: number, hasta: number): Array<[number, number]> {
  return desde < hasta
    ? [[desde, hasta]]
    : [
        [desde, 1440],
        [0, hasta]
      ];
}

/** ¿Dos rangos horarios comparten algún momento? Soporta rangos que cruzan la medianoche. */
export function rangosSeSolapan(inicioA: string, finA: string, inicioB: string, finB: string): boolean {
  const a1 = aMinutos(inicioA);
  const a2 = aMinutos(finA);
  const b1 = aMinutos(inicioB);
  const b2 = aMinutos(finB);
  if (a1 === null || a2 === null || b1 === null || b2 === null || a1 === a2 || b1 === b2) return false;

  return segmentos(a1, a2).some(([x1, x2]) => segmentos(b1, b2).some(([y1, y2]) => x1 < y2 && y1 < x2));
}

/** Un rango es válido si ambas horas existen y no son iguales (puede cruzar la medianoche). */
export function esRangoValido(inicio: string, fin: string): boolean {
  const desde = aMinutos(inicio);
  const hasta = aMinutos(fin);
  return desde !== null && hasta !== null && desde !== hasta;
}

/** Hora (local, Honduras) en que empieza el día operativo. */
export const INICIO_DIA_OPERATIVO = '06:00';

/**
 * Fecha operativa (YYYY-MM-DD) de un momento: el día operativo va de 06:00 a 06:00,
 * así que entre 00:00 y 05:59 sigue siendo el día anterior (turno C).
 * Misma regla que `public.fecha_operativa()` en la base de datos.
 */
export function fechaOperativa(ahora: Date): string {
  const inicio = aMinutos(INICIO_DIA_OPERATIVO) ?? 0;
  const fecha = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  if (minutosDelDia(ahora) < inicio) fecha.setDate(fecha.getDate() - 1);
  return formatearFechaLocal(fecha);
}

/** Suma días a una fecha "YYYY-MM-DD" sin pasar por UTC. */
export function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return formatearFechaLocal(new Date(anio!, mes! - 1, dia! + dias));
}

/** Lunes (YYYY-MM-DD) de la semana de una fecha "YYYY-MM-DD". La semana de planificación va de lunes a domingo. */
export function inicioDeSemana(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const diaSemana = (new Date(anio!, mes! - 1, dia!).getDay() + 6) % 7; // lunes = 0
  return sumarDias(fecha, -diaSemana);
}

export function diasDeLaSemana(lunes: string): string[] {
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}
