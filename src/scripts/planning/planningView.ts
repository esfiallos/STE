import { abreviaturaDeJornada, OPCIONES_DE_JORNADA, opcionDeJornada, valorDeJornada } from '../../domain/planning';
import { diasDeLaSemana, fechaOperativa, inicioDeSemana, sumarDias } from '../../domain/time';
import { listarJornadas, type JornadaPlanificada } from '../../services/jornadasRepo';
import { appStore } from '../../state/appStore';
import type { Jornada, TecnicoCatalogo } from '../../types/noc';
import { planificarJornadas, quitarJornada } from '../actions/technicianActions';
import { byId, crearElemento } from '../dom';
import { abrirModalAlmuerzo } from '../modals/lunchModal';
import { avisarSiFalla, mostrarAviso } from '../ui/toast';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

let lunes = '';
let jornadas: Jornada[] = [];
let numeroDeCarga = 0;

const fechaCorta = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
const hoy = () => fechaOperativa(new Date());
const claveCelda = (tecnicoId: string, fecha: string) => `${tecnicoId}|${fecha}`;

function mostrarEstado(mensaje: string | null, esError = false): void {
  const estado = byId('planningStatus');
  estado.textContent = mensaje ?? '';
  estado.classList.toggle('hidden', mensaje === null);
  estado.classList.toggle('board-status--error', esError);
}

function crearCelda(tecnico: TecnicoCatalogo, fecha: string, jornada: Jornada | undefined): HTMLTableCellElement {
  const celda = document.createElement('td');
  celda.className = 'planning-cell';
  celda.dataset.tecnicoId = tecnico.id;
  celda.dataset.fecha = fecha;
  celda.classList.toggle('is-today', fecha === hoy());
  celda.classList.toggle('is-past', fecha < hoy());
  if (jornada) celda.dataset.turno = jornada.turno;

  const selector = document.createElement('select');
  selector.className = 'planning-select';
  selector.dataset.action = 'cambiar-jornada';
  selector.setAttribute('aria-label', `${tecnico.nombre}, ${fecha}`);
  selector.append(new Option('Libre', ''), ...OPCIONES_DE_JORNADA.map((o) => new Option(o.etiqueta, o.valor)));
  selector.value = valorDeJornada(jornada);
  selector.disabled = fecha < hoy();
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
    almuerzo.disabled = fecha < hoy();
    celda.append(almuerzo);
  }
  return celda;
}

function renderizar(): void {
  const dias = diasDeLaSemana(lunes);
  byId('planningWeekLabel').textContent = `Semana del ${fechaCorta(dias[0]!)} al ${fechaCorta(dias[6]!)}`;

  const porCelda = new Map(jornadas.map((j) => [claveCelda(j.tecnicoId, j.fecha), j]));
  const activos = appStore.get().catalogo.filter((t) => t.activo);

  const encabezado = document.createElement('thead');
  const filaEncabezado = document.createElement('tr');
  filaEncabezado.append(crearElemento('th', '', 'Técnico'));
  dias.forEach((fecha, i) => {
    const th = crearElemento('th', fecha === hoy() ? 'is-today' : '', `${DIAS[i]} ${fechaCorta(fecha)}`);
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
    dias.forEach((fecha) => fila.append(crearCelda(tecnico, fecha, porCelda.get(claveCelda(tecnico.id, fecha)))));
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
}
