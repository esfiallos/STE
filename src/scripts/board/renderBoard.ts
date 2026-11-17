import { unirTecnicosConIncidentes } from '../../domain/assignments';
import { normalizarBusqueda } from '../../domain/search';
import { tecnicosDelTurno, TURNOS } from '../../domain/shifts';
import { appStore } from '../../state/appStore';
import { byId } from '../dom';
import type { ContextoTablero } from './boardContext';
import { crearVistaTurno } from './shiftView';

let claveAEnfocar: string | null = null;

/** Pide que, en el próximo dibujo, se enfoque el campo del formulario de esa tarjeta (solo al abrirlo). */
export function solicitarEnfoqueDeFormulario(clave: string): void {
  claveAEnfocar = clave;
}

function enfocarFormularioPendiente(contenedor: HTMLElement): void {
  if (!claveAEnfocar) return;
  contenedor.querySelector<HTMLInputElement>(`[data-clave="${claveAEnfocar}"] input[name="codigo"]`)?.focus();
  claveAEnfocar = null;
}

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

  const contexto: ContextoTablero = {
    modo: 'vivo',
    ahora: new Date(),
    termino: normalizarBusqueda(estado.busqueda),
    notasAbiertas: new Set(estado.notasAbiertas),
    claveFormulario: estado.claveFormulario,
    borrador: estado.borrador
  };
  const tecnicos = unirTecnicosConIncidentes(estado.tecnicos, estado.incidentes);

  const turnos = TURNOS.map((turno) =>
    crearVistaTurno(turno, tecnicosDelTurno(tecnicos, turno.id), contexto, estado.turnosColapsados.includes(turno.id))
  );

  contenedor.replaceChildren(...turnos);
  enfocarFormularioPendiente(contenedor);
}
