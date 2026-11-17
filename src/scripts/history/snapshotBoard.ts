import { tecnicosDelTurno, TURNOS } from '../../domain/shifts';
import type { TecnicoConIncidentes } from '../../types/noc';
import type { ContextoTablero } from '../board/boardContext';
import { crearVistaTurno } from '../board/shiftView';

/** Dibuja la foto de un día con las mismas vistas del tablero, pero en modo histórico (solo lectura). */
export function renderizarSnapshot(contenedor: HTMLElement, tablero: TecnicoConIncidentes[]): void {
  const contexto: ContextoTablero = {
    modo: 'historico',
    ahora: new Date(),
    termino: '',
    notasAbiertas: new Set(),
    claveFormulario: null,
    borrador: null
  };

  contenedor.replaceChildren(
    ...TURNOS.map((turno) => crearVistaTurno(turno, tecnicosDelTurno(tablero, turno.id), contexto, false))
  );
}
