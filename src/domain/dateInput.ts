import { sumarDias } from './time';

/**
 * Fechas rápidas (D24): interpreta lo que se escribe en el selector de fecha y arma los chips de un clic.
 * Puro: trabaja con "YYYY-MM-DD" y una fecha de referencia (hoy operativo).
 *
 * Se entiende: h/hoy · m/mañana · pm/pasado · ayer · anteayer · +N / -N (días) · lun…dom (próximo, o último en
 * dirección "pasado"; hoy cuenta) · D (día del mes) · D/M · D/M/AA · D/M/AAAA · AAAA-MM-DD.
 */
export type DireccionDeFecha = 'futuro' | 'pasado';

export interface LimitesDeFecha {
  /** Mínimo y máximo permitidos, inclusive ("YYYY-MM-DD"). */
  minimo?: string | null;
  maximo?: string | null;
}

const NOMBRES_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const;
const NOMBRES_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;

const sinAcentos = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

const partes = (fecha: string) => fecha.split('-').map(Number) as [number, number, number];

/** 0 = domingo … 6 = sábado. */
export function diaDeSemana(fecha: string): number {
  const [a, m, d] = partes(fecha);
  return new Date(a, m - 1, d).getDay();
}

/** Construye la fecha solo si existe (31/11 no existe). */
function fechaValida(anio: number, mes: number, dia: number): string | null {
  const f = new Date(anio, mes - 1, dia);
  if (f.getFullYear() !== anio || f.getMonth() !== mes - 1 || f.getDate() !== dia) return null;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Diferencia en días (b − a). */
export function diasEntre(a: string, b: string): number {
  const [aa, am, ad] = partes(a);
  const [ba, bm, bd] = partes(b);
  return Math.round((Date.UTC(ba, bm - 1, bd) - Date.UTC(aa, am - 1, ad)) / 86_400_000);
}

export function dentroDeLimites(fecha: string, { minimo, maximo }: LimitesDeFecha = {}): boolean {
  return (!minimo || fecha >= minimo) && (!maximo || fecha <= maximo);
}

/** Devuelve la fecha escrita, o null si no se entiende (o el texto está vacío). No aplica límites. */
export function interpretarFecha(texto: string, hoy: string, direccion: DireccionDeFecha = 'futuro'): string | null {
  const t = sinAcentos(texto.trim().toLowerCase()).replace(/\s+/g, ' ');
  if (!t) return null;

  const atajos: Record<string, number> = { h: 0, hoy: 0, m: 1, manana: 1, pm: 2, pasado: 2, 'pasado manana': 2, ayer: -1, anteayer: -2 };
  if (t in atajos) return sumarDias(hoy, atajos[t]!);

  const relativo = /^([+-])\s*(\d{1,3})$/.exec(t);
  if (relativo) return sumarDias(hoy, (relativo[1] === '-' ? -1 : 1) * Number(relativo[2]));

  // Día de la semana: "lun", "lunes", "mie", "miércoles"…
  const indice = /^[a-z]{2,}$/.test(t) ? NOMBRES_LARGOS.findIndex((nombre) => sinAcentos(nombre).startsWith(t)) : -1;
  if (indice >= 0) {
    const actual = diaDeSemana(hoy);
    const diferencia = direccion === 'futuro' ? (indice - actual + 7) % 7 : -((actual - indice + 7) % 7);
    return sumarDias(hoy, diferencia);
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const [anioHoy, mesHoy, diaHoy] = partes(hoy);

  // Solo el día del mes: este mes, o el siguiente (anterior, en dirección "pasado") si ya pasó.
  const soloDia = /^(\d{1,2})$/.exec(t);
  if (soloDia) {
    const dia = Number(soloDia[1]);
    const enEsteMes = fechaValida(anioHoy, mesHoy, dia);
    if (direccion === 'futuro') {
      if (enEsteMes && dia >= diaHoy) return enEsteMes;
      return mesHoy === 12 ? fechaValida(anioHoy + 1, 1, dia) : fechaValida(anioHoy, mesHoy + 1, dia);
    }
    if (enEsteMes && dia <= diaHoy) return enEsteMes;
    return mesHoy === 1 ? fechaValida(anioHoy - 1, 12, dia) : fechaValida(anioHoy, mesHoy - 1, dia);
  }

  // D/M, D/M/AA, D/M/AAAA (también con "-" o ".")
  const dma = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
  if (dma) {
    const dia = Number(dma[1]);
    const mes = Number(dma[2]);
    if (dma[3]) {
      const anio = dma[3].length === 2 ? 2000 + Number(dma[3]) : Number(dma[3]);
      return fechaValida(anio, mes, dia);
    }
    // Sin año: el más cercano en la dirección pedida (dic → ene cruza de año)
    const esteAnio = fechaValida(anioHoy, mes, dia);
    if (!esteAnio) return fechaValida(direccion === 'futuro' ? anioHoy + 1 : anioHoy - 1, mes, dia);
    if (direccion === 'futuro' && diasEntre(hoy, esteAnio) < -31) return fechaValida(anioHoy + 1, mes, dia);
    if (direccion === 'pasado' && diasEntre(hoy, esteAnio) > 31) return fechaValida(anioHoy - 1, mes, dia);
    return esteAnio;
  }

  return null;
}

/** "sáb 21/11" (agrega el año si no es el de `hoy`). */
export function describirFechaCorta(fecha: string, hoy?: string): string {
  const [a, m, d] = partes(fecha);
  const anio = hoy && partes(hoy)[0] !== a ? `/${a}` : '';
  return `${NOMBRES_CORTOS[diaDeSemana(fecha)]} ${d}/${m}${anio}`;
}

/** "Hoy", "Mañana", "Ayer" o "en 3 días" / "hace 3 días": ayuda a leer el resultado de lo escrito. */
export function describirDistancia(fecha: string, hoy: string): string {
  const n = diasEntre(hoy, fecha);
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Mañana';
  if (n === -1) return 'Ayer';
  if (n === 2) return 'Pasado mañana';
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
}

export interface ChipDeFecha {
  texto: string;
  fecha: string;
}

/**
 * Chips de un clic según la dirección: futuro = Hoy · Mañana · Pasado mañana · próximos 4 días de la semana;
 * pasado = Hoy · Ayer · Anteayer · 4 días anteriores. Sin los que caen fuera de los límites.
 */
export function chipsDeFecha(hoy: string, direccion: DireccionDeFecha, limites: LimitesDeFecha = {}): ChipDeFecha[] {
  const paso = direccion === 'futuro' ? 1 : -1;
  const fijos: ChipDeFecha[] =
    direccion === 'futuro'
      ? [{ texto: 'Hoy', fecha: hoy }, { texto: 'Mañana', fecha: sumarDias(hoy, 1) }, { texto: 'Pasado mañana', fecha: sumarDias(hoy, 2) }]
      : [{ texto: 'Hoy', fecha: hoy }, { texto: 'Ayer', fecha: sumarDias(hoy, -1) }, { texto: 'Anteayer', fecha: sumarDias(hoy, -2) }];
  const semana = [3, 4, 5, 6].map((n) => {
    const fecha = sumarDias(hoy, n * paso);
    return { texto: describirFechaCorta(fecha, hoy), fecha };
  });
  return [...fijos, ...semana].filter((c) => dentroDeLimites(c.fecha, limites));
}

/** Las 6 semanas (lunes a domingo) que muestra el mini calendario del mes de `fecha`. */
export function semanasDelMes(fecha: string): string[][] {
  const [a, m] = partes(fecha);
  const primero = `${a}-${String(m).padStart(2, '0')}-01`;
  const desfase = (diaDeSemana(primero) + 6) % 7; // lunes = 0
  const inicio = sumarDias(primero, -desfase);
  return Array.from({ length: 6 }, (_, s) => Array.from({ length: 7 }, (_, d) => sumarDias(inicio, s * 7 + d)));
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function nombreDelMes(fecha: string): string {
  const [a, m] = partes(fecha);
  return `${MESES[m - 1]} ${a}`;
}

/** Suma meses conservando el día 1 (para navegar el calendario). */
export function sumarMeses(fecha: string, meses: number): string {
  const [a, m] = partes(fecha);
  const f = new Date(a, m - 1 + meses, 1);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-01`;
}
