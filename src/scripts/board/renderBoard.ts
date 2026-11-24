import { casosHastaElDia, casosPorReasignar, motivoPorReasignar, unirTecnicosConIncidentes } from '../../domain/assignments';
import { cambiosDelTablero, fotoDelTablero, hayCambios, type FotoDelTablero } from '../../domain/boardChanges';
import { incidenteCoincide, normalizarBusqueda } from '../../domain/search';
import { tecnicosDelTurno, TURNOS } from '../../domain/shifts';
import { appStore, type AppState } from '../../state/appStore';
import type { Incidente } from '../../types/noc';
import { byId, crearElemento } from '../dom';
import { formatearFechaLarga } from '../ui/format';
import { animarCambiosDelTablero, continuarAnimaciones, medirCasos } from '../ui/motion';
import type { ContextoTablero } from './boardContext';
import { crearVistaIncidente } from './incidentView';
import { crearVistaTurno } from './shiftView';
import { filtrarCasos } from '../../domain/caseFilters';
import { momentoCorto } from '../../domain/followUp';

let claveAEnfocar: string | null = null;
/** Estado del último dibujo, para animar lo que cambió en el siguiente. */
let fotoAnterior: FotoDelTablero | null = null;

/** Pide que, en el próximo dibujo, se enfoque el campo del formulario de esa tarjeta (solo al abrirlo). */
export function solicitarEnfoqueDeFormulario(clave: string): void {
  claveAEnfocar = clave;
}

function enfocarFormularioPendiente(contenedor: HTMLElement): void {
  if (!claveAEnfocar) return;
  contenedor.querySelector<HTMLInputElement>(`[data-clave="${claveAEnfocar}"] input[name="codigo"]`)?.focus();
  claveAEnfocar = null;
}

/**
 * Casos abiertos cuyo responsable no trabaja hoy (o no tienen): solo el dispatch los ve, aparte del tablero
 * del día y de sus contadores, para arrastrarlos a un técnico del día. Así ningún caso se pierde.
 */
function crearFranjaPorReasignar(casos: Incidente[], estado: AppState, termino: string): HTMLElement | null {
  if (casos.length === 0) return null;

  const nombres = new Map(estado.catalogo.map((t) => [t.id, t.nombre]));
  const franja = crearElemento('section', 'reassign-strip');
  franja.setAttribute('aria-label', 'Casos por reasignar');
  franja.append(
    crearElemento('h2', 'reassign-strip__title', `Por reasignar (${casos.length})`),
    crearElemento(
      'p',
      'reassign-strip__help',
      'Casos abiertos cuyo responsable no trabaja hoy o terminó su turno sin traspasarlos. Arrástralos a un técnico disponible.'
    )
  );

  const lista = crearElemento('div', 'reassign-strip__list');
  const deHoy = new Set(estado.tecnicos.map((t) => t.id));
  casos.forEach((caso, indice) => {
    const motivo = motivoPorReasignar(caso, deHoy);
    const nombre = caso.tecnicoId ? (nombres.get(caso.tecnicoId) ?? '?') : '';
    const item = crearElemento('div', 'reassign-strip__item');
    item.append(
      crearVistaIncidente(caso, {
        posicion: indice + 1,
        coincideConBusqueda: incidenteCoincide(caso, termino),
        notaFija: false,
        notaAbierta: estado.notasAbiertas.includes(caso.id),
        arrastrable: true,
        conAcciones: false
      }),
      crearElemento(
        'span',
        `reassign-strip__owner${motivo === 'turno_sin_traspaso' ? ' reassign-strip__owner--alerta' : ''}`,
        motivo === 'sin_responsable'
          ? 'Sin responsable'
          : motivo === 'turno_sin_traspaso' && caso.sinTraspasoDesde
            ? `${nombre}: terminó su turno (${momentoCorto(caso.sinTraspasoDesde)}) sin traspasarlo`
            : `Último: ${nombre} (no trabaja hoy)`
      )
    );
    lista.append(item);
  });
  franja.append(lista);
  return franja;
}

/** Dibuja el tablero completo (casos por reasignar + acordeón de turnos) a partir del estado actual. */
export function renderizarTablero(): void {
  const estado = appStore.get();
  const contenedor = byId('shiftsAccordionContainer');
  const mensajeDeEstado = byId('boardStatus');

  const mensaje = estado.carga === 'cargando' ? 'Cargando tablero…' : estado.errorCarga;
  mensajeDeEstado.textContent = mensaje ?? '';
  mensajeDeEstado.classList.toggle('hidden', mensaje === null);
  mensajeDeEstado.classList.toggle('board-status--error', estado.carga === 'error');
  byId('boardDate').textContent = estado.fechaOperativa ? `Día operativo: ${formatearFechaLarga(estado.fechaOperativa)}` : '';

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
    borrador: estado.borrador,
    miTecnicoId: estado.perfil?.rol === 'tecnico' ? estado.perfil.tecnicoId : null
  };

  const todos = unirTecnicosConIncidentes(estado.tecnicos, filtrarCasos(estado.incidentes, estado.filtrosTablero));
  const tecnicos = estado.filtroTecnico ? todos.filter((t) => t.id === estado.filtroTecnico) : todos;

  const turnos = TURNOS.map((turno) =>
    crearVistaTurno(turno, tecnicosDelTurno(tecnicos, turno.id), contexto, estado.turnosColapsados.includes(turno.id))
  );
  const franja =
    estado.filtroTecnico || estado.soloLectura
      ? null
      : crearFranjaPorReasignar(
          casosPorReasignar(casosHastaElDia(estado.casosAbiertos, estado.fechaOperativa), estado.tecnicos),
          estado,
          contexto.termino
        );

  const foto = fotoDelTablero(estado.fechaOperativa, estado.incidentes);
  const cambios = cambiosDelTablero(fotoAnterior, foto);
  const posiciones = hayCambios(cambios) ? medirCasos(contenedor) : new Map<string, DOMRect>();
  fotoAnterior = foto;

  contenedor.replaceChildren(...(franja ? [franja] : []), ...turnos);
  continuarAnimaciones(contenedor);
  if (hayCambios(cambios)) animarCambiosDelTablero(contenedor, cambios, posiciones);

  if (estado.tecnicos.length === 0) {
    const aviso = estado.soloLectura
      ? 'Aún no hay técnicos planificados para hoy.'
      : 'Aún no hay técnicos planificados para hoy: ve a la pestaña Planificación.';
    contenedor.prepend(crearElemento('p', 'board-status', aviso));
  }

  enfocarFormularioPendiente(contenedor);
}
