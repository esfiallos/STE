import { esTurnoId } from '../../domain/shifts';
import { appStore } from '../../state/appStore';
import { copiarCodigo } from '../actions/incidentActions';
import { byId } from '../dom';
import { solicitarAsignacion } from '../modals/assignFlow';
import { abrirCancelacionDeCaso, abrirEdicionDeCaso } from '../modals/editIncidentModal';
import { abrirAlmuerzoDelTecnico } from '../modals/lunchModal';
import { mostrarAviso } from '../ui/toast';
import { solicitarEnfoqueDeFormulario } from './renderBoard';
import { aplicarRenderPendiente } from './renderScheduler';

const SELECTOR_FORMULARIO = 'form[data-form="asignar"]';

const claveDe = (elemento: Element): string | null => elemento.closest<HTMLElement>('[data-clave]')?.dataset.clave ?? null;

function alternarTurno(turnoId: string | undefined): void {
  if (!turnoId || !esTurnoId(turnoId)) return;

  const { turnosColapsados } = appStore.get();
  appStore.set({
    turnosColapsados: turnosColapsados.includes(turnoId)
      ? turnosColapsados.filter((id) => id !== turnoId)
      : [...turnosColapsados, turnoId]
  });
}

function alternarNota(incidenteId: string | undefined): void {
  if (!incidenteId) return;

  const { notasAbiertas } = appStore.get();
  appStore.set({
    notasAbiertas: notasAbiertas.includes(incidenteId)
      ? notasAbiertas.filter((id) => id !== incidenteId)
      : [...notasAbiertas, incidenteId]
  });
}

function alternarFormulario(clave: string | null): void {
  if (!clave) return;

  const abierto = appStore.get().claveFormulario === clave;
  if (!abierto) solicitarEnfoqueDeFormulario(clave);
  appStore.set({ claveFormulario: abierto ? null : clave, borrador: null });
}

function cerrarFormulario(): void {
  appStore.set({ claveFormulario: null, borrador: null });
}

function manejarAccion(boton: HTMLElement): void {
  const accion = boton.dataset.action;
  const turnoId = boton.closest<HTMLElement>('[data-turno-id]')?.dataset.turnoId;
  const tecnicoId = boton.closest<HTMLElement>('[data-tecnico-id]')?.dataset.tecnicoId;
  const incidenteId = boton.closest<HTMLElement>('[data-incidente-id]')?.dataset.incidenteId;

  // Acciones de consulta: siempre disponibles
  if (accion === 'alternar-turno') return alternarTurno(turnoId);
  if (accion === 'ver-nota') return alternarNota(incidenteId);
  if (accion === 'copiar-codigo') {
    const codigo = boton.closest('.incident-item-card')?.querySelector('.inc-code')?.textContent;
    if (codigo) void copiarCodigo(codigo);
    return;
  }

  if (appStore.get().soloLectura) return; // las demás acciones modifican datos

  if (accion === 'asignar') alternarFormulario(claveDe(boton));
  if (accion === 'cancelar-asignar') cerrarFormulario();
  if (accion === 'editar-almuerzo' && tecnicoId) abrirAlmuerzoDelTecnico(tecnicoId);
  if (accion === 'editar-incidente' && incidenteId) abrirEdicionDeCaso(incidenteId);
  if (accion === 'cancelar-incidente' && incidenteId) abrirCancelacionDeCaso(incidenteId);
}

async function enviarFormulario(formulario: HTMLFormElement): Promise<void> {
  const tecnicoId = formulario.closest<HTMLElement>('[data-tecnico-id]')?.dataset.tecnicoId;
  if (!tecnicoId || appStore.get().soloLectura) return;

  const datos = new FormData(formulario);
  const codigo = String(datos.get('codigo') ?? '');
  const empresa = String(datos.get('empresa') ?? '');

  // Se suelta el foco antes: mientras un campo lo tiene, el tablero no se redibuja.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

  const resultado = await solicitarAsignacion(codigo, empresa, tecnicoId);
  if (resultado === null) return;

  if (resultado.ok) cerrarFormulario();
  else mostrarAviso(resultado.error, 'error');
}

/** Un solo conjunto de listeners para todo el tablero: sigue funcionando aunque las tarjetas se vuelvan a dibujar. */
export function iniciarEventosDelTablero(): void {
  const tablero = byId('shiftsAccordionContainer');

  tablero.addEventListener('click', (evento) => {
    if (!(evento.target instanceof Element)) return;
    const boton = evento.target.closest<HTMLElement>('[data-action]');
    if (boton) manejarAccion(boton);
  });

  tablero.addEventListener('submit', (evento) => {
    if (!(evento.target instanceof HTMLFormElement) || !evento.target.matches(SELECTOR_FORMULARIO)) return;
    evento.preventDefault();
    void enviarFormulario(evento.target);
  });

  // Guarda lo escrito para no perderlo si el tablero se redibuja por otro motivo.
  tablero.addEventListener('input', (evento) => {
    if (!(evento.target instanceof Element)) return;
    const formulario = evento.target.closest<HTMLFormElement>(SELECTOR_FORMULARIO);
    const clave = formulario ? claveDe(formulario) : null;
    if (!formulario || !clave) return;

    const datos = new FormData(formulario);
    appStore.set({ borrador: { clave, codigo: String(datos.get('codigo') ?? ''), empresa: String(datos.get('empresa') ?? '') } });
  });

  tablero.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && evento.target instanceof Element && evento.target.closest(SELECTOR_FORMULARIO)) {
      evento.stopPropagation();
      cerrarFormulario();
    }
  });

  // Al salir del formulario se aplican los cambios que llegaron mientras se escribía.
  tablero.addEventListener('focusout', (evento) => {
    const siguiente = evento.relatedTarget;
    if (siguiente instanceof Element && siguiente.closest(SELECTOR_FORMULARIO)) return;
    window.setTimeout(aplicarRenderPendiente, 0);
  });
}
