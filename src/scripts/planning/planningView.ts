import { abreviaturaDeJornada, OPCIONES_DE_JORNADA, opcionDeJornada, valorDeJornada } from '../../domain/planning';
import {
  describirSolicitud,
  diaEditable,
  estadoDelDia,
  solicitudesPorResponder,
  type ContextoDePlanificacion
} from '../../domain/planningRequests';
import { diasDeLaSemana, fechaOperativa, inicioDeSemana, sumarDias } from '../../domain/time';
import { listarJornadas, type JornadaPlanificada } from '../../services/jornadasRepo';
import { appStore } from '../../state/appStore';
import type { Jornada, SolicitudPlanificacion, TecnicoCatalogo } from '../../types/noc';
import { pedirEdicionDeDia, responderSolicitud } from '../actions/planningRequestActions';
import { planificarJornadas, quitarJornada } from '../actions/technicianActions';
import { byId, crearElemento } from '../dom';
import { abrirModalAlmuerzo } from '../modals/lunchModal';
import { formatearFechaHora } from '../ui/format';
import { avisarSiFalla, mostrarAviso } from '../ui/toast';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

let lunes = '';
let jornadas: Jornada[] = [];
let numeroDeCarga = 0;
/** Solicitudes con las que se dibujó la vista (para redibujar solo si cambian). */
let jornadasCargadas = false;
let solicitudesDibujadas: readonly SolicitudPlanificacion[] | null = null;

const fechaCorta = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
const hoy = () => fechaOperativa(new Date());
const claveCelda = (tecnicoId: string, fecha: string) => `${tecnicoId}|${fecha}`;
const esCoordinador = () => appStore.get().perfil?.rol === 'coordinador';

function contexto(): ContextoDePlanificacion {
  const ahora = new Date();
  const { perfil, solicitudes } = appStore.get();
  return { rol: perfil?.rol, hoy: fechaOperativa(ahora), ahora, solicitudes };
}

function mostrarEstado(mensaje: string | null, esError = false): void {
  const estado = byId('planningStatus');
  estado.textContent = mensaje ?? '';
  estado.classList.toggle('hidden', mensaje === null);
  estado.classList.toggle('board-status--error', esError);
}

function crearCelda(tecnico: TecnicoCatalogo, fecha: string, jornada: Jornada | undefined, editable: boolean): HTMLTableCellElement {
  const celda = document.createElement('td');
  celda.className = 'planning-cell';
  celda.dataset.tecnicoId = tecnico.id;
  celda.dataset.fecha = fecha;
  celda.classList.toggle('is-today', fecha === hoy());
  celda.classList.toggle('is-past', fecha < hoy());
  celda.classList.toggle('is-locked', !editable && fecha >= hoy());
  if (jornada) celda.dataset.turno = jornada.turno;

  const selector = document.createElement('select');
  selector.className = 'planning-select';
  selector.dataset.action = 'cambiar-jornada';
  selector.setAttribute('aria-label', `${tecnico.nombre}, ${fecha}`);
  selector.append(new Option('Libre', ''), ...OPCIONES_DE_JORNADA.map((o) => new Option(o.etiqueta, o.valor)));
  selector.value = valorDeJornada(jornada);
  selector.disabled = !editable;
  if (!editable && fecha >= hoy()) selector.title = 'Para editar este día pide permiso a coordinación.';
  celda.append(selector);

  if (jornada) {
    const almuerzo = crearElemento(
      'button',
      'planning-lunch',
      jornada.almuerzoInicio ? `Almuerzo ${jornada.almuerzoInicio}-${jornada.almuerzoFin}` : '+ Almuerzo'
    );
    almuerzo.type = 'button';
    almuerzo.dataset.action = 'editar-almuerzo-jornada';
    almuerzo.dataset.jornadaId = jornada.id;
    almuerzo.disabled = !editable;
    celda.append(almuerzo);
  }
  return celda;
}

function renderizar(): void {
  const dias = diasDeLaSemana(lunes);
  byId('planningWeekLabel').textContent = `Semana del ${fechaCorta(dias[0]!)} al ${fechaCorta(dias[6]!)}`;

  const porCelda = new Map(jornadas.map((j) => [claveCelda(j.tecnicoId, j.fecha), j]));
  const activos = appStore.get().catalogo.filter((t) => t.activo);
  const ctx = contexto();
  const editables = new Set(dias.filter((fecha) => diaEditable(fecha, ctx)));

  const encabezado = document.createElement('thead');
  const filaEncabezado = document.createElement('tr');
  filaEncabezado.append(crearElemento('th', '', 'Técnico'));
  dias.forEach((fecha, i) => {
    const th = crearElemento('th', fecha === hoy() ? 'is-today' : '', `${DIAS[i]} ${fechaCorta(fecha)}`);
    const chip = chipDelDia(fecha, ctx);
    if (chip) th.append(chip);
    filaEncabezado.append(th);
  });
  encabezado.append(filaEncabezado);

  const cuerpo = document.createElement('tbody');
  if (activos.length === 0) {
    const fila = document.createElement('tr');
    const celda = crearElemento('td', 'text-muted', 'No hay técnicos activos. Agrégalos con el botón "Técnicos" del tablero.');
    celda.colSpan = 8;
    fila.append(celda);
    cuerpo.append(fila);
  }
  activos.forEach((tecnico) => {
    const fila = document.createElement('tr');
    fila.append(crearElemento('th', 'planning-name', tecnico.nombre));
    dias.forEach((fecha) => fila.append(crearCelda(tecnico, fecha, porCelda.get(claveCelda(tecnico.id, fecha)), editables.has(fecha))));
    cuerpo.append(fila);
  });

  // Totales por día: cuántos técnicos hay en cada turno
  const pie = document.createElement('tfoot');
  const filaPie = document.createElement('tr');
  filaPie.append(crearElemento('th', '', 'Cobertura'));
  dias.forEach((fecha) => {
    const delDia = jornadas.filter((j) => j.fecha === fecha);
    const conteo = (turno: string) => delDia.filter((j) => j.turno === turno).length;
    filaPie.append(
      crearElemento('td', 'planning-total', `A ${conteo('turnoA')} · B ${conteo('turnoB')} · C ${conteo('turnoC')} · Com ${conteo('comodin')}`)
    );
  });
  pie.append(filaPie);

  byId('planningGrid').replaceChildren(encabezado, cuerpo, pie);
  renderizarSolicitudes();
}

/** Chip del encabezado: si el dispatch tiene ese día habilitado o una solicitud pendiente. */
function chipDelDia(fecha: string, ctx: ContextoDePlanificacion): HTMLElement | null {
  const estado = estadoDelDia(fecha, ctx);
  if (estado !== 'habilitado' && estado !== 'pendiente') return null;
  const texto =
    estado === 'pendiente' ? 'Solicitud pendiente' : ctx.rol === 'coordinador' ? 'Dispatch habilitado' : 'Editable hasta 06:00';
  const chip = crearElemento('span', 'planning-day-chip', texto);
  chip.dataset.estado = estado;
  return chip;
}

const ESTADO_DE_SOLICITUD: Record<SolicitudPlanificacion['estado'], string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada'
};

function crearSolicitud(s: SolicitudPlanificacion): HTMLLIElement {
  const item = crearElemento('li', 'planning-request');
  item.dataset.solicitudId = s.id;
  const vencida = s.estado === 'pendiente' && s.fecha < hoy();
  const estado = crearElemento('span', 'planning-request__state', vencida ? 'Sin responder' : ESTADO_DE_SOLICITUD[s.estado]);
  estado.dataset.estado = vencida ? 'vencida' : s.estado;

  const texto = crearElemento('span', 'planning-request__text', `Editar el ${fechaCorta(s.fecha)} · ${s.motivo}`);
  const meta = [`Pedida por ${s.solicitanteNombre ?? 'dispatch'} · ${formatearFechaHora(s.creadaEn)}`];
  if (s.estado !== 'pendiente') {
    meta.push(`${ESTADO_DE_SOLICITUD[s.estado]} por ${s.resueltaPorNombre ?? 'coordinación'}${s.respuesta ? `: ${s.respuesta}` : ''}`);
  }
  texto.append(crearElemento('span', 'planning-request__meta', meta.join(' · ')));
  item.append(estado, texto);
  return item;
}

function crearPendiente(s: SolicitudPlanificacion): HTMLLIElement {
  const item = crearElemento('li', 'planning-request');
  item.dataset.solicitudId = s.id;
  const texto = crearElemento('span', 'planning-request__text', describirSolicitud(s));
  texto.append(crearElemento('span', 'planning-request__meta', `Enviada ${formatearFechaHora(s.creadaEn)}`));

  const respuesta = document.createElement('input');
  respuesta.type = 'text';
  respuesta.className = 'planning-request__answer';
  respuesta.maxLength = 500;
  respuesta.placeholder = 'Respuesta (opcional)';
  respuesta.setAttribute('aria-label', `Respuesta para el ${fechaCorta(s.fecha)}`);

  const aprobar = crearElemento('button', 'btn btn-sm btn-primary', 'Aprobar');
  aprobar.type = 'button';
  aprobar.dataset.action = 'aprobar-solicitud';
  const rechazar = crearElemento('button', 'btn btn-sm', 'Rechazar');
  rechazar.type = 'button';
  rechazar.dataset.action = 'rechazar-solicitud';
  item.append(texto, respuesta, aprobar, rechazar);
  return item;
}

const vacio = (texto: string) => crearElemento('li', 'planning-requests__empty', texto);

/** Formulario del dispatch (días de la semana visible) y listas de solicitudes. */
function renderizarSolicitudes(): void {
  const ctx = contexto();
  solicitudesDibujadas = ctx.solicitudes;
  const semana = diasDeLaSemana(lunes);

  if (esCoordinador()) {
    const pendientes = solicitudesPorResponder(ctx.solicitudes, ctx.hoy);
    byId('planningPendingList').replaceChildren(
      ...(pendientes.length ? pendientes.map(crearPendiente) : [vacio('No hay solicitudes por responder.')])
    );
  } else {
    const selector = byId<HTMLSelectElement>('planningRequestDate');
    const anterior = selector.value;
    const dias = semana.filter((fecha) => fecha >= ctx.hoy);
    const sufijo = { habilitado: ' · habilitado', pendiente: ' · pendiente', bloqueado: '', pasado: '' } as const;
    selector.replaceChildren(
      ...(dias.length
        ? dias.map((fecha) => new Option(`${DIAS[semana.indexOf(fecha)]} ${fechaCorta(fecha)}${sufijo[estadoDelDia(fecha, ctx)]}`, fecha))
        : [new Option('Esta semana ya pasó', '')])
    );
    if (dias.includes(anterior)) selector.value = anterior;
    selector.disabled = dias.length === 0;
    byId<HTMLButtonElement>('btnPlanningRequest').disabled = dias.length === 0;
  }

  const recientes = [...ctx.solicitudes].sort((a, b) => b.creadaEn.localeCompare(a.creadaEn)).slice(0, 10);
  byId('planningRequestList').replaceChildren(...(recientes.length ? recientes.map(crearSolicitud) : [vacio('Aún no hay solicitudes.')]));
}

function mostrarErrorDeSolicitud(mensaje: string | null): void {
  const error = byId('planningRequestError');
  error.textContent = mensaje ?? '';
  error.classList.toggle('hidden', !mensaje);
}

async function enviarSolicitud(evento: Event): Promise<void> {
  evento.preventDefault();
  const fecha = byId<HTMLSelectElement>('planningRequestDate').value;
  const motivo = byId<HTMLInputElement>('planningRequestReason');
  const boton = byId<HTMLButtonElement>('btnPlanningRequest');
  boton.disabled = true;
  const resultado = await pedirEdicionDeDia(fecha, motivo.value);
  boton.disabled = false;
  if (!resultado.ok) {
    mostrarErrorDeSolicitud(resultado.error);
    return;
  }
  mostrarErrorDeSolicitud(null);
  motivo.value = '';
}

async function contestarSolicitud(boton: HTMLButtonElement): Promise<void> {
  const item = boton.closest<HTMLElement>('[data-solicitud-id]');
  const id = item?.dataset.solicitudId;
  if (!item || !id) return;
  const aprobar = boton.dataset.action === 'aprobar-solicitud';
  const respuesta = item.querySelector<HTMLInputElement>('.planning-request__answer')?.value ?? '';
  item.querySelectorAll('button').forEach((b) => (b.disabled = true));
  const resultado = await responderSolicitud(id, aprobar, respuesta);
  if (!avisarSiFalla(resultado)) item.querySelectorAll('button').forEach((b) => (b.disabled = false));
}

/** Abre la planificación en la semana de ese día (desde la campana). */
export function mostrarSemanaDe(fecha: string): void {
  lunes = inicioDeSemana(fecha);
  void cargarPlanificacion();
}

/** Lee las jornadas de la semana visible y redibuja la grilla. */
export async function cargarPlanificacion(): Promise<void> {
  if (!lunes) lunes = inicioDeSemana(hoy());
  const numero = ++numeroDeCarga;
  mostrarEstado('Cargando planificación…');

  const resultado = await listarJornadas(lunes, sumarDias(lunes, 6));
  if (numero !== numeroDeCarga) return;
  if (!resultado.ok) {
    mostrarEstado(resultado.error, true);
    return;
  }
  jornadas = resultado.data;
  jornadasCargadas = true;
  mostrarEstado(null);
  renderizar();
}

async function cambiarJornada(selector: HTMLSelectElement): Promise<void> {
  const celda = selector.closest<HTMLElement>('[data-tecnico-id]');
  const { tecnicoId, fecha } = celda?.dataset ?? {};
  if (!tecnicoId || !fecha) return;

  const actual = jornadas.find((j) => j.tecnicoId === tecnicoId && j.fecha === fecha);
  const opcion = opcionDeJornada(selector.value);

  let resultado;
  if (!opcion) {
    if (!actual) return;
    resultado = await quitarJornada(actual.id);
  } else {
    const nueva: JornadaPlanificada = {
      fecha,
      tecnicoId,
      turno: opcion.turno,
      horarioInicio: opcion.horarioInicio,
      horarioFin: opcion.horarioFin,
      almuerzoInicio: actual?.almuerzoInicio ?? null,
      almuerzoFin: actual?.almuerzoFin ?? null
    };
    resultado = await planificarJornadas([nueva]);
  }

  avisarSiFalla(resultado);
  await cargarPlanificacion();
}

/** Copia la semana anterior sobre la visible (reemplaza los días que ya estén planificados). */
async function copiarSemanaAnterior(): Promise<void> {
  if (!esCoordinador()) return;
  const anterior = sumarDias(lunes, -7);
  const origen = await listarJornadas(anterior, sumarDias(anterior, 6));
  if (!avisarSiFalla(origen)) return;

  const activos = new Set(appStore.get().catalogo.filter((t) => t.activo).map((t) => t.id));
  const copia: JornadaPlanificada[] = origen.data
    .filter((j) => activos.has(j.tecnicoId))
    .map(({ id: _id, ...j }) => ({ ...j, fecha: sumarDias(j.fecha, 7) }))
    .filter((j) => j.fecha >= hoy());

  if (copia.length === 0) {
    mostrarAviso('La semana anterior no tiene jornadas para copiar (o todos sus días ya pasaron).', 'error');
    return;
  }
  if (!window.confirm(`Se copiarán ${copia.length} jornada(s) de la semana anterior. Las ya planificadas se reemplazan. ¿Continuar?`)) {
    return;
  }

  if (avisarSiFalla(await planificarJornadas(copia))) mostrarAviso(`${copia.length} jornada(s) copiadas.`, 'exito');
  await cargarPlanificacion();
}

function editarAlmuerzo(jornadaId: string): void {
  const jornada = jornadas.find((j) => j.id === jornadaId);
  const nombre = appStore.get().catalogo.find((t) => t.id === jornada?.tecnicoId)?.nombre;
  if (!jornada || !nombre) return;

  abrirModalAlmuerzo(
    {
      jornadaId,
      titulo: `${nombre} · ${fechaCorta(jornada.fecha)} · ${abreviaturaDeJornada(jornada)}`,
      inicio: jornada.almuerzoInicio,
      fin: jornada.almuerzoFin
    },
    () => void cargarPlanificacion()
  );
}

function irASemana(nuevoLunes: string): void {
  lunes = nuevoLunes;
  void cargarPlanificacion();
}

export function iniciarPlanificacion(): void {
  byId('btnPrevWeek').addEventListener('click', () => irASemana(sumarDias(lunes, -7)));
  byId('btnNextWeek').addEventListener('click', () => irASemana(sumarDias(lunes, 7)));
  byId('btnThisWeek').addEventListener('click', () => irASemana(inicioDeSemana(hoy())));
  byId('btnCopyPrevWeek').addEventListener('click', () => void copiarSemanaAnterior());

  const grilla = byId('planningGrid');
  grilla.addEventListener('change', (evento) => {
    if (evento.target instanceof HTMLSelectElement && evento.target.dataset.action === 'cambiar-jornada') {
      void cambiarJornada(evento.target);
    }
  });
  grilla.addEventListener('click', (evento) => {
    const boton = evento.target instanceof Element ? evento.target.closest<HTMLElement>('[data-action="editar-almuerzo-jornada"]') : null;
    if (boton?.dataset.jornadaId) editarAlmuerzo(boton.dataset.jornadaId);
  });

  byId('planningRequestForm').addEventListener('submit', (evento) => void enviarSolicitud(evento));
  byId('planningPendingList').addEventListener('click', (evento) => {
    const boton = evento.target instanceof Element ? evento.target.closest<HTMLButtonElement>('button[data-action]') : null;
    if (boton) void contestarSolicitud(boton);
  });

  // Una solicitud nueva o respondida (propia o de otro usuario) cambia qué días se pueden editar.
  appStore.subscribe(() => {
    const { vista, solicitudes } = appStore.get();
    if (vista === 'planificacion' && jornadasCargadas && solicitudes !== solicitudesDibujadas) renderizar();
  });
}
