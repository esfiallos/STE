import type { EstadoCaso, TurnoTecnico } from '../types/noc';
import { sumarDias } from './time';

/** Un turno al que se puede traspasar y cuántos días después es su día operativo (0 = mismo día). */
export interface DestinoDeTraspaso {
  turno: TurnoTecnico;
  desfaseDias: 0 | 1;
}

/**
 * A quién puede traspasar cada turno al cerrar (D6). Misma regla que `public.desfase_traspaso()`
 * en la base de datos, que la vuelve a validar al enviar.
 */
export const DESTINOS_DE_TRASPASO: Readonly<Record<TurnoTecnico, readonly DestinoDeTraspaso[]>> = {
  turnoA: [
    { turno: 'turnoB', desfaseDias: 0 },
    { turno: 'comodin', desfaseDias: 0 }
  ],
  turnoB: [
    { turno: 'turnoC', desfaseDias: 0 },
    { turno: 'turnoA', desfaseDias: 1 },
    { turno: 'comodin', desfaseDias: 1 }
  ],
  comodin: [
    { turno: 'turnoC', desfaseDias: 0 },
    { turno: 'turnoA', desfaseDias: 1 },
    { turno: 'comodin', desfaseDias: 1 }
  ],
  turnoC: [
    { turno: 'turnoA', desfaseDias: 1 },
    { turno: 'comodin', desfaseDias: 1 }
  ]
};

/** Días de diferencia para traspasar de `origen` a `destino`, o null si no está permitido. */
export function desfaseDeTraspaso(origen: TurnoTecnico, destino: TurnoTecnico): 0 | 1 | null {
  return DESTINOS_DE_TRASPASO[origen].find((d) => d.turno === destino)?.desfaseDias ?? null;
}

/** ¿Puede recibir un técnico planificado en `turnoReceptor` el día `fechaReceptor`? */
export function puedeRecibirTraspaso(
  origen: TurnoTecnico,
  fechaOrigen: string,
  turnoReceptor: TurnoTecnico,
  fechaReceptor: string
): boolean {
  const desfase = desfaseDeTraspaso(origen, turnoReceptor);
  return desfase !== null && sumarDias(fechaOrigen, desfase) === fechaReceptor;
}

export const ETIQUETA_ESTADO_CASO: Record<EstadoCaso, string> = {
  en_curso: 'En curso',
  pausado: 'Pausado',
  resuelto: 'Resuelto',
  cerrado: 'Cerrado'
};

/** Todo caso que no esté cerrado debe traspasarse al cerrar turno (D2). */
export function debeTraspasarse(estado: EstadoCaso): boolean {
  return estado !== 'cerrado';
}
