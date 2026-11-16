import { unirTecnicosConIncidentes } from '../../domain/assignments';
import { normalizarBusqueda } from '../../domain/search';
import { turnoActivo, TURNOS } from '../../domain/shifts';
import { appStore } from '../../state/appStore';
import { byId } from '../dom';
import { crearVistaTurno } from './shiftView';

/** Dibuja el acordeón de turnos completo a partir del estado actual. */
export function renderizarTablero(): void {
  const estado = appStore.get();
  const contenedor = byId('shiftsAccordionContainer');
  const mensajeDeEstado = byId('boardStatus');

  const mensaje = estado.carga === 'cargando' ? 'Cargando tablero…' : estado.errorCarga;
  mensajeDeEstado.textContent = mensaje ?? '';
  mensajeDeEstado.classList.toggle('hidden', mensaje === null);
  mensajeDeEstado.classList.toggle('board-status--error', estado.carga === 'error');

  if (estado.carga === 'cargando') {
    contenedor.replaceChildren();
    return;
  }

  const ahora = new Date();
  const termino = normalizarBusqueda(estado.busqueda);
  const tecnicos = unirTecnicosConIncidentes(estado.tecnicos, estado.incidentes);
  const turnoEnCurso = turnoActivo(ahora);

  const turnos = TURNOS.map((turno) =>
    crearVistaTurno({
      turno,
      tecnicos: tecnicos.filter((t) => t.turno === turno.id),
      termino,
      colapsadoPorUsuario: estado.turnosColapsados.includes(turno.id),
      enCurso: turno.id === turnoEnCurso,
      ahora
    })
  );

  contenedor.replaceChildren(...turnos);
}
