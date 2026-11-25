import { abreviaturaDeJornada, OPCIONES_DE_JORNADA, opcionDeJornada, valorDeJornada } from '../../domain/planning';
import {
  avisoVigente,
  describirAviso,
  describirCambio,
  diaEditable,
  MAX_MOTIVO_AVISO,
  pideMotivo,
  type ContextoDePlanificacion
} from '../../domain/planningNotices';
import { diasDeLaSemana, fechaOperativa, inicioDeSemana, sumarDias } from '../../domain/time';
import { listarJornadas, type JornadaPlanificada } from '../../services/jornadasRepo';
import { appStore } from '../../state/appStore';
import type { AvisoPlanificacion, Jornada, TecnicoCatalogo } from '../../types/noc';
import { avisarCambioDeDia, cargarAvisos, marcarVistos } from '../actions/planningNoticeActions';
import { planificarJornadas, quitarJornada } from '../actions/technicianActions';
import { byId, crearElemento } from '../dom';
import { abrirModalAlmuerzo } from '../modals/lunchModal';
import { formatearFechaHora } from '../ui/format';
import { avisarSiFalla, mostrarAviso } from '../ui/toast';
import { confirmar } from '../ui/confirmar';
import { pedirTexto } from '../ui/pedirTexto';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

let lunes = '';
let jornadas: Jornada[] = [];
let numeroDeCarga = 0;
let jornadasCargadas = false;
/** Avisos con los que se dibujó la vista (para redibujar solo si cambian). */
let avisosDibujados: readonly AvisoPlanificacion[] | null = null;

const fechaCorta = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
const hoy = () => fechaOperativa(new Date());
const claveCelda = (tecnicoId: string, fecha: string) => `${tecnicoId}|${fecha}`;
const esCoordinador = () => appStore.get().perfil?.rol === 'coordinador';

function contexto(): ContextoDePlanificacion {
  const ahora = new Date();
  const { perfil, avisos } = appStore.get();
  return { rol: perfil?.rol, hoy: fechaOperativa(ahora), ahora, avisos };
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
  renderizarAvisos();
}

/** Chip del encabezado: el dispatch ya dio el motivo de ese día (y puede seguir cambiándolo sin darlo otra vez). */
function chipDelDia(fecha: string, ctx: ContextoDePlanificacion): HTMLElement | null {
  if (fecha < ctx.hoy || !avisoVigente(fecha, ctx.avisos, ctx.ahora)) return null;
  const chip = crearElemento('span', 'planning-day-chip', ctx.rol === 'coordinador' ? 'Cambiado por dispatch' : 'Motivo indicado');
  chip.dataset.estado = 'avisado';
  return chip;
}

function crearAviso(a: AvisoPlanificacion, esCoord: boolean): HTMLLIElement {
  const item = crearElemento('li', 'planning-request');
  item.dataset.avisoId = a.id;
  const nuevo = esCoord && !a.visto;
  const estado = crearElemento('span', 'planning-request__state', nuevo ? 'Nuevo' : fechaCorta(a.fecha));
  estado.dataset.estado = nuevo ? 'nuevo' : 'visto';

  const texto = crearElemento('span', 'planning-request__text', describirAviso(a));
  texto.append(crearElemento('span', 'planning-request__meta', `Avisado ${formatearFechaHora(a.creadoEn)}`));
  if (a.cambios.length > 0) {
    const lista = crearElemento('ul', 'planning-request__changes');
    lista.append(...a.cambios.map((c) => crearElemento('li', '', `${describirCambio(c, a.autorNombre)} · ${formatearFechaHora(c.en)}`)));
    texto.append(lista);
  }
  item.append(estado, texto);

  if (nuevo) {
    const visto = crearElemento('button', 'btn btn-sm', 'Visto');
    visto.type = 'button';
    visto.dataset.action = 'marcar-aviso-visto';
    item.append(visto);
  }
  return item;
}

const vacio = (texto: string) => crearElemento('li', 'planning-requests__empty', texto);

/** Lista de los cambios que hizo el dispatch con su motivo (los ven dispatch y coordinación). */
function renderizarAvisos(): void {
  const { avisos } = contexto();
  avisosDibujados = avisos;
  const recientes = [...avisos].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)).slice(0, 10);
  byId('planningNoticeList').replaceChildren(
    ...(recientes.length ? recientes.map((a) => crearAviso(a, esCoordinador())) : [vacio('El dispatch no ha cambiado la planificación en estos días.')])
  );
}

/**
 * La primera vez que el dispatch cambia un turno de un día pide el motivo (D38); no espera respuesta.
 * Devuelve false si cancela o la base lo rechaza.
 */
async function asegurarMotivo(fecha: string): Promise<boolean> {
  if (!pideMotivo(fecha, contexto())) return true;
  const motivo = await pedirTexto({
    titulo: `Cambio en la planificación del ${fechaCorta(fecha)}`,
    mensaje: 'Coordinación recibirá el motivo y el detalle de los cambios. Se pide una vez por día.',
    etiqueta: 'Motivo',
    placeholder: 'Ej: Luis se reportó enfermo, hay que cubrir el turno B',
    maxLength: MAX_MOTIVO_AVISO,
    aceptar: 'Guardar cambio'
  });
  if (motivo === null) return false;
  return avisarSiFalla(await avisarCambioDeDia(fecha, motivo));
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
  if (!(await asegurarMotivo(fecha))) {
    selector.value = valorDeJornada(actual);
    return;
  }

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
  // El cambio quedó anotado en el aviso del día (también llega por tiempo real).
  if (appStore.get().perfil?.rol === 'dispatch') await cargarAvisos();
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
  const existentes = new Set(jornadas.map((j) => `${j.tecnicoId}|${j.fecha}`));
  const reemplazadas = copia.filter((j) => existentes.has(`${j.tecnicoId}|${j.fecha}`)).length;
  const aceptado = await confirmar({
    titulo: 'Copiar la semana anterior',
    mensaje: `Se copiarán ${copia.length} jornada(s) de la semana anterior. Las ya planificadas se reemplazan.`,
    resumen: [
      { etiqueta: 'Jornadas a copiar', valor: String(copia.length) },
      { etiqueta: 'Se reemplazan', valor: String(reemplazadas) }
    ],
    aceptar: 'Copiar semana'
  });
  if (!aceptado) return;

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

  byId('planningNoticeList').addEventListener('click', (evento) => {
    const boton = evento.target instanceof Element ? evento.target.closest<HTMLElement>('[data-action="marcar-aviso-visto"]') : null;
    const id = boton?.closest<HTMLElement>('[data-aviso-id]')?.dataset.avisoId;
    if (id) void marcarVistos([id]);
  });

  // Un aviso nuevo, un cambio más o un aviso visto (propio o de otro usuario) cambian chips y lista.
  appStore.subscribe(() => {
    const { vista, avisos } = appStore.get();
    if (vista === 'planificacion' && jornadasCargadas && avisos !== avisosDibujados) renderizar();
  });
}
