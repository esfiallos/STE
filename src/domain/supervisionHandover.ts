/**
 * Entrega de casos por supervisión (D37): cuando un técnico se fue sin traspasar (o no trabaja hoy), el dispatch o
 * coordinación reparte sus casos entre los técnicos de un turno. Quien recibe los ve en su seguimiento, como un
 * traspaso. La base vuelve a validar todo en `entregar_casos()`.
 */
import type { Incidente, Jornada, ReceptorTraspaso, TecnicoCatalogo, TurnoTecnico } from '../types/noc';
import { repartirCasos } from './handoverBalance';
import { horarioDelTecnico } from './shifts';
import { aMinutos, INICIO_DIA_OPERATIVO, minutosDelDia, sumarDias } from './time';

const MINUTOS_DIA = 24 * 60;
const INICIO = aMinutos(INICIO_DIA_OPERATIVO) ?? 360;
/** Minutos desde el inicio del día operativo (06:00 = 0, 05:59 = 1439). */
const minutosOperativos = (minutos: number) => (minutos - INICIO + MINUTOS_DIA) % MINUTOS_DIA;

/**
 * ¿Ya terminó el turno de esa jornada? Mismo criterio que `public.fin_de_turno()`: un turno que acaba a las 06:00
 * acaba con el día operativo. Las jornadas de días siguientes no han terminado; las de días pasados, sí.
 */
export function turnoTerminado(jornada: Pick<Jornada, 'fecha' | 'turno' | 'horarioInicio' | 'horarioFin'>, fechaHoy: string, ahora: Date): boolean {
  if (jornada.fecha > fechaHoy) return false;
  if (jornada.fecha < fechaHoy) return true;
  const horario = horarioDelTecnico(jornada);
  const fin = horario ? aMinutos(horario.fin) : null;
  if (fin === null) return false;
  const finOperativo = minutosOperativos(fin) || MINUTOS_DIA;
  return minutosOperativos(minutosDelDia(ahora)) >= finOperativo;
}

const ORDEN_DE_TURNO: Record<TurnoTecnico, number> = { turnoA: 1, comodin: 2, turnoB: 3, turnoC: 4 };

/** Quienes pueden recibir: activos, planificados hoy (con el turno sin terminar) o mañana. Orden: día, turno, nombre. */
export function receptoresParaEntregar(
  jornadas: readonly Jornada[],
  catalogo: readonly TecnicoCatalogo[],
  fechaHoy: string,
  ahora: Date
): ReceptorTraspaso[] {
  const manana = sumarDias(fechaHoy, 1);
  const porId = new Map(catalogo.map((t) => [t.id, t]));
  return jornadas
    .filter((j) => (j.fecha === fechaHoy || j.fecha === manana) && porId.get(j.tecnicoId)?.activo && !turnoTerminado(j, fechaHoy, ahora))
    .map((j) => ({
      tecnicoId: j.tecnicoId,
      nombre: porId.get(j.tecnicoId)!.nombre,
      turno: j.turno,
      fecha: j.fecha,
      horarioInicio: j.horarioInicio,
      horarioFin: j.horarioFin
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || ORDEN_DE_TURNO[a.turno] - ORDEN_DE_TURNO[b.turno] || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Una entrega: el caso, quién lo recibe y el día operativo de su turno. Es lo que recibe `entregar_casos()`. */
export interface Entrega {
  casoId: string;
  tecnicoId: string;
  fecha: string;
}

/**
 * Reparte los casos entre los receptores elegidos (de un mismo turno), parejo y alternando tipos, igual que el
 * reparto del traspaso.
 */
export function repartirEntrega(casos: readonly Pick<Incidente, 'id' | 'codigo'>[], receptores: readonly ReceptorTraspaso[]): Entrega[] {
  const { asignaciones } = repartirCasos(
    casos.map((c) => ({ id: c.id, codigo: c.codigo, receptorId: null, bloqueado: false })),
    receptores.map((r) => r.tecnicoId),
    'todos'
  );
  const fechas = new Map(receptores.map((r) => [r.tecnicoId, r.fecha]));
  return casos.flatMap((c) => {
    const tecnicoId = asignaciones.get(c.id);
    return tecnicoId ? [{ casoId: c.id, tecnicoId, fecha: fechas.get(tecnicoId)! }] : [];
  });
}
