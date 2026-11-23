/**
 * Pestaña "Traspaso" del técnico: arma la entrega de fin de turno a partir de sus casos abiertos,
 * reparte entre los receptores planificados, muestra el reporte y cierra turno (enviar_traspaso).
 * El borrador se guarda solo en la base (traspasos / traspaso_items) mientras se edita.
 */
import {
  combinarBorrador,
  entradasDelReporte,
  normalizarItem,
  problemasDelTraspaso,
  receptoresDelTraspaso,
  type ProblemaDelTraspaso
} from '../../domain/handoverDraft';
import { repartirCasos, type ModoDeReparto } from '../../domain/handoverBalance';
import { armarBloques, reporteHtml, reporteTexto, reporteTsv, type OrdenDeReporte } from '../../domain/handoverReport';
import { momentoCorto } from '../../domain/followUp';
import { debeTraspasarse } from '../../domain/handover';
import { nombreDeTurno } from '../../domain/shifts';
import { fechaOperativa, sumarDias } from '../../domain/time';
import { listarJornadas } from '../../services/jornadasRepo';
import { obtenerTraspasoDelDia } from '../../services/traspasosRepo';
import { appStore } from '../../state/appStore';
import type { EstadoCaso, Incidente, ItemTraspaso, Jornada, ReceptorTraspaso, Traspaso } from '../../types/noc';
import { cerrarTurno, copiarReporte, guardarBorrador, type FormatoDeCopia } from '../actions/handoverActions';
import { byId, clonarPlantilla, crearElemento, ref } from '../dom';
import { formatearFechaHora, formatearFechaLarga } from '../ui/format';
import { mostrarAviso } from '../ui/toast';
import { confirmar } from '../ui/confirmar';
import { mejorarCampoDeFecha } from '../ui/fecha';
import { mejorarCampoDeEtiqueta } from '../ui/etiquetas';
import { guardarSeguimiento } from '../actions/followUpActions';
import { filtrarCasos } from '../../domain/caseFilters';
import { crearBarraDeFiltros, type BarraDeFiltros } from '../features/caseFilters';

const ESPERA_GUARDADO_MS = 700;

interface Contexto {
  fecha: string;
  jornadas: Jornada[];
  miJornada: Jornada | null;
}

let tecnicoId = '';
let contexto: Contexto | null = null;
let traspaso: Traspaso | null = null;
let items: ItemTraspaso[] = [];
let sobrantes: string[] = [];
let errorDeCarga: string | null = null;
let cargando = false;
const candados = new Set<string>();
/** Receptores que entran al reparto automático (los que se desmarcan quedan fuera). */
const excluidos = new Set<string>();
const deshacer: ItemTraspaso[][] = [];
let temporizadorGuardado: number | undefined;
let guardando: Promise<void> = Promise.resolve();
let renderPendiente = false;
let salidas = { html: '', texto: '', tsv: '' };

const vista = () => byId('handoverView');

function misCasos(): Incidente[] {
  return appStore.get().casosAbiertos.filter((c) => c.tecnicoId === tecnicoId);
}

function receptores(): ReceptorTraspaso[] {
  if (!contexto?.miJornada) return [];
  const { catalogo } = appStore.get();
  return receptoresDelTraspaso(contexto.miJornada.turno, contexto.fecha, contexto.jornadas, catalogo, tecnicoId);
}

const esBorrador = () => !traspaso || traspaso.estado === 'borrador';

/** Mientras se escribe en un caso no se redibuja la lista: se perdería el texto y el cursor. */
function estaEditando(): boolean {
  const activo = document.activeElement;
  return activo instanceof HTMLElement && vista().contains(activo) && activo.matches('input[type="text"], textarea');
}

function describirReceptor(r: ReceptorTraspaso): string {
  const turno = r.turno === 'comodin' && r.horarioInicio ? `${nombreDeTurno(r.turno)} ${r.horarioInicio}–${r.horarioFin}` : nombreDeTurno(r.turno);
  const dia = r.fecha === contexto?.fecha ? 'hoy' : 'mañana';
  return `${r.nombre} · ${turno} · ${dia}`;
}

// ------------------------------------------------------------------ carga

/** Lee la planificación de hoy y mañana y el traspaso del día; luego une con los casos propios. */
export async function cargarTraspaso(): Promise<void> {
  if (!tecnicoId || cargando) return;
  cargando = true;
  pintarEstado('Cargando tu traspaso…');
  const fecha = appStore.get().fechaOperativa || fechaOperativa(new Date());
  const [jornadas, delDia] = await Promise.all([listarJornadas(fecha, sumarDias(fecha, 1)), obtenerTraspasoDelDia(tecnicoId, fecha)]);
  cargando = false;

  if (!jornadas.ok || !delDia.ok) {
    errorDeCarga = (!jornadas.ok ? jornadas.error : !delDia.ok ? delDia.error : '') || 'No se pudo cargar el traspaso.';
    renderizarTraspaso();
    return;
  }
  errorDeCarga = null;
  contexto = {
    fecha,
    jornadas: jornadas.data,
    miJornada: jornadas.data.find((j) => j.tecnicoId === tecnicoId && j.fecha === fecha) ?? null
  };
  traspaso = delDia.data;
  items = [];
  sobrantes = [];
  candados.clear();
  deshacer.length = 0;
  unirConMisCasos(traspaso?.items ?? []);
  renderizarTraspaso();
}

/** Mantiene un ítem por cada caso propio abierto (los nuevos entran precargados). */
function unirConMisCasos(base: ItemTraspaso[]): void {
  if (!contexto || !esBorrador()) return;
  const combinado = combinarBorrador(misCasos(), base, contexto.fecha);
  items = combinado.items;
  sobrantes = [...new Set([...sobrantes, ...combinado.sobrantes])];
}

// ------------------------------------------------------------------ guardado

function programarGuardado(): void {
  window.clearTimeout(temporizadorGuardado);
  pintarGuardado('Cambios sin guardar…');
  temporizadorGuardado = window.setTimeout(() => void guardarAhora(), ESPERA_GUARDADO_MS);
}

function guardarAhora(): Promise<void> {
  window.clearTimeout(temporizadorGuardado);
  guardando = guardando.then(async () => {
    if (!contexto || !esBorrador() || items.length === 0) return;
    const resultado = await guardarBorrador(traspaso, tecnicoId, contexto.fecha, items.map(normalizarItem), sobrantes);
    if (!resultado.ok) {
      pintarGuardado('No se pudo guardar el borrador', true);
      mostrarAviso(resultado.error, 'error');
      return;
    }
    traspaso = { ...resultado.data, items };
    sobrantes = [];
    pintarGuardado(`Borrador guardado ${new Date().toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' })}`);
  });
  return guardando;
}

function pintarGuardado(texto: string, esError = false): void {
  const estado = byId('handoverSaveState');
  estado.textContent = texto;
  estado.classList.toggle('is-error', esError);
}

// ------------------------------------------------------------------ dibujo

function pintarEstado(texto: string | null): void {
  const estado = byId('handoverStatus');
  estado.textContent = texto ?? '';
  estado.classList.toggle('hidden', !texto);
}

/** Mensaje en lugar del formulario cuando no hay nada que armar; null si se puede armar el traspaso. */
function mensajeSinFormulario(): string | null {
  if (errorDeCarga) return errorDeCarga;
  if (!contexto) return 'Cargando tu traspaso…';
  if (traspaso?.estado === 'enviado') {
    const pendientes = misCasos().length;
    const cuando = traspaso.enviadoEn ? ` (${formatearFechaHora(traspaso.enviadoEn)})` : '';
    return `Ya cerraste turno hoy${cuando}. Consulta lo entregado en "Mis traspasos".${
      pendientes > 0 ? ` Te llegaron ${pendientes} caso(s) después: pide al dispatch que los reasigne.` : ''
    }`;
  }
  if (!contexto.miJornada) return `No tienes jornada planificada hoy (${formatearFechaLarga(contexto.fecha)}): pide al dispatch que te planifique.`;
  if (items.length === 0) return 'No tienes casos abiertos: no hay nada que traspasar.';
  return null;
}

function pintarReceptores(lista: ReceptorTraspaso[]): void {
  const cuenta = new Map<string, number>();
  for (const i of items) if (i.paraTecnicoId && debeTraspasarse(i.estado)) cuenta.set(i.paraTecnicoId, (cuenta.get(i.paraTecnicoId) ?? 0) + 1);

  const contenedor = byId('handoverReceivers');
  if (lista.length === 0) {
    contenedor.replaceChildren(crearElemento('p', 'form-error', 'Nadie planificado puede recibir de tu turno. Avisa al dispatch.'));
    return;
  }
  contenedor.replaceChildren(
    ...lista.map((r) => {
      const etiqueta = crearElemento('label', 'handover-receiver');
      const casilla = document.createElement('input');
      casilla.type = 'checkbox';
      casilla.checked = !excluidos.has(r.tecnicoId);
      casilla.dataset.receptor = r.tecnicoId;
      etiqueta.append(casilla, crearElemento('span', '', describirReceptor(r)), crearElemento('span', 'handover-receiver__count', String(cuenta.get(r.tecnicoId) ?? 0)));
      return etiqueta;
    })
  );
}

function crearItem(item: ItemTraspaso, caso: Incidente, lista: ReceptorTraspaso[], problemas: ProblemaDelTraspaso[]): HTMLElement {
  const fragmento = clonarPlantilla('tpl-traspaso-item');
  const tarjeta = ref(fragmento, 'item');
  tarjeta.dataset.casoId = caso.id;
  tarjeta.dataset.estado = item.estado;
  tarjeta.classList.toggle('has-problem', problemas.some((p) => p.casoId === caso.id));

  ref(fragmento, 'codigo').textContent = caso.codigo;
  ref(fragmento, 'meta').textContent = [
    caso.cliente,
    caso.area,
    caso.ultimaActualizacionEn ? `Últ. act. ${momentoCorto(caso.ultimaActualizacionEn)}` : 'Sin actualizar'
  ]
    .filter(Boolean)
    .join(' · ');

  const campo = <T extends HTMLElement>(nombre: string) => fragmento.querySelector<T>(`[data-campo="${nombre}"]`)!;
  campo<HTMLInputElement>('candado').checked = candados.has(caso.id);
  campo<HTMLSelectElement>('estado').value = item.estado;

  const receptor = campo<HTMLSelectElement>('receptor');
  receptor.append(new Option(item.estado === 'cerrado' ? 'No se entrega (cerrado)' : '— Elegir —', ''));
  receptor.append(...lista.map((r) => new Option(describirReceptor(r), r.tecnicoId)));
  if (item.paraTecnicoId && !lista.some((r) => r.tecnicoId === item.paraTecnicoId)) {
    const nombre = appStore.get().catalogo.find((t) => t.id === item.paraTecnicoId)?.nombre ?? 'Otro técnico';
    receptor.append(new Option(`${nombre} (ya no puede recibir)`, item.paraTecnicoId));
  }
  receptor.value = item.estado === 'cerrado' ? '' : (item.paraTecnicoId ?? '');
  receptor.disabled = item.estado === 'cerrado';

  const etiqueta = campo<HTMLInputElement>('etiqueta');
  etiqueta.value = item.etiqueta ?? '';
  mejorarCampoDeEtiqueta(etiqueta);
  campo<HTMLTextAreaElement>('descripcion').value = item.descripcion ?? '';
  const fecha = campo<HTMLInputElement>('recordatorioFecha');
  fecha.value = item.recordatorioFecha ?? '';
  fecha.min = contexto?.fecha ?? '';
  const texto = campo<HTMLInputElement>('recordatorioTexto');
  texto.value = item.recordatorioTexto ?? '';
  fecha.disabled = texto.disabled = item.estado === 'cerrado';
  mejorarCampoDeFecha(fecha, { direccion: 'futuro', vacio: 'Sin recordatorio' });
  return tarjeta;
}

/** Problemas, contadores, vista previa y botón de cerrar turno (no toca los campos que se editan). */
function pintarResumen(): void {
  if (!contexto) return;
  const lista = receptores();
  const casos = misCasos();
  const problemas = problemasDelTraspaso(items, casos, lista, contexto.fecha);

  const entregar = items.filter((i) => debeTraspasarse(i.estado)).length;
  const turno = contexto.miJornada ? nombreDeTurno(contexto.miJornada.turno) : '';
  byId('handoverSummary').textContent =
    `${turno} · ${formatearFechaLarga(contexto.fecha)} · ${items.length} caso(s): ${entregar} por entregar, ${items.length - entregar} se cierran.`;

  byId('handoverProblems').replaceChildren(
    ...(problemas.length > 0
      ? problemas.map((p) => crearElemento('li', 'form-error', p.mensaje))
      : [crearElemento('li', 'handover-ok', 'Todo listo: puedes cerrar turno.')])
  );
  byId<HTMLButtonElement>('btnCerrarTurno').disabled = problemas.length > 0;
  byId<HTMLButtonElement>('btnDeshacerReparto').disabled = deshacer.length === 0;
  vista().querySelectorAll<HTMLElement>('[data-caso-id]').forEach((tarjeta) => {
    tarjeta.classList.toggle('has-problem', problemas.some((p) => p.casoId === tarjeta.dataset.casoId));
  });
  pintarReceptores(lista);

  const orden = byId<HTMLSelectElement>('handoverOrder').value as OrdenDeReporte;
  const conEtiquetas = byId<HTMLInputElement>('handoverTags').checked;
  const destinos = new Map(lista.map((r) => [r.tecnicoId, r]));
  const bloques = armarBloques(entradasDelReporte(items.map(normalizarItem), casos, destinos), orden);
  salidas = { html: reporteHtml(bloques, { conEtiquetas }), texto: reporteTexto(bloques, { conEtiquetas }), tsv: reporteTsv(bloques, { conEtiquetas }) };
  byId<HTMLIFrameElement>('handoverPreview').srcdoc =
    salidas.html || '<p style="font-family:sans-serif;color:#5c6b7e">Elige a quién entregar cada caso para ver el reporte.</p>';
}

/** Dibuja la pestaña completa; si se está escribiendo, solo el resumen (la lista espera). */
export function renderizarTraspaso(): void {
  if (!tecnicoId) return;
  if (contexto && esBorrador()) unirConMisCasos(items);

  const mensaje = mensajeSinFormulario();
  pintarEstado(mensaje);
  byId('handoverBody').classList.toggle('hidden', mensaje !== null);
  byId('handoverSaveState').classList.toggle('hidden', mensaje !== null);
  if (mensaje !== null) {
    byId('handoverSummary').textContent = '';
    return;
  }

  if (estaEditando()) {
    renderPendiente = true;
    pintarResumen();
    return;
  }
  renderPendiente = false;

  const lista = receptores();
  const casos = new Map(misCasos().map((c) => [c.id, c]));
  const problemas = problemasDelTraspaso(items, [...casos.values()], lista, contexto!.fecha);
  // Los filtros solo ocultan ítems: los problemas y el reporte siguen considerando todo el traspaso.
  const filtrables = items.flatMap((i) => {
    const caso = casos.get(i.casoId);
    return caso ? [{ item: i, caso, codigo: caso.codigo, area: caso.area, estado: i.estado, tecnicoId: i.paraTecnicoId }] : [];
  });
  barraTraspaso?.actualizar(filtrables);
  const visibles = barraTraspaso ? filtrarCasos(filtrables, barraTraspaso.filtros()) : filtrables;
  byId('handoverItems').replaceChildren(
    ...(visibles.length > 0 || filtrables.length === 0
      ? visibles.map((v) => crearItem(v.item, v.caso, lista, problemas))
      : [crearElemento('p', 'empty-incidents', 'Ningún caso del traspaso coincide con los filtros.')])
  );
  pintarResumen();
}

// ------------------------------------------------------------------ acciones

function cambiarItem(casoId: string, cambios: Partial<ItemTraspaso>): void {
  items = items.map((i) => (i.casoId === casoId ? { ...i, ...cambios } : i));
  programarGuardado();
}

function repartir(modo: ModoDeReparto): void {
  const participan = receptores().map((r) => r.tecnicoId).filter((id) => !excluidos.has(id));
  if (participan.length === 0) {
    mostrarAviso('Marca al menos a una persona para repartir.', 'error');
    return;
  }
  const codigos = new Map(misCasos().map((c) => [c.id, c.codigo]));
  const resultado = repartirCasos(
    items
      .filter((i) => debeTraspasarse(i.estado))
      .map((i) => ({ id: i.casoId, codigo: codigos.get(i.casoId) ?? '', receptorId: i.paraTecnicoId, bloqueado: candados.has(i.casoId) })),
    participan,
    modo
  );
  if (resultado.repartidos === 0) {
    mostrarAviso(modo === 'huerfanos' ? 'Todos los casos ya tienen a quién entregarse.' : 'No hay casos para repartir.');
    return;
  }
  deshacer.push(items.map((i) => ({ ...i })));
  items = items.map((i) => (resultado.asignaciones.has(i.casoId) ? { ...i, paraTecnicoId: resultado.asignaciones.get(i.casoId)! } : i));
  mostrarAviso(`Reparto listo: ${resultado.movidos} caso(s) cambiaron de receptor.`, 'exito');
  programarGuardado();
  renderizarTraspaso();
}

async function confirmarCierre(): Promise<void> {
  if (!contexto) return;
  const entregados = items.filter((i) => debeTraspasarse(i.estado));
  const entregar = entregados.length;
  const cerrar = items.length - entregar;
  const nombres = new Map(appStore.get().catalogo.map((t) => [t.id, t.nombre]));
  const porReceptor = new Map<string, number>();
  for (const item of entregados) {
    const nombre = nombres.get(item.paraTecnicoId ?? '') ?? 'Sin receptor';
    porReceptor.set(nombre, (porReceptor.get(nombre) ?? 0) + 1);
  }
  const recordatorios = items.filter((i) => i.recordatorioFecha).length;
  const resumen = [
    ...[...porReceptor].map(([nombre, total]) => ({ etiqueta: nombre, valor: `${total} caso(s)` })),
    ...(cerrar > 0 ? [{ etiqueta: 'Se cierran', valor: `${cerrar} caso(s)` }] : []),
    ...(recordatorios > 0 ? [{ etiqueta: 'Recordatorios', valor: String(recordatorios) }] : [])
  ];
  const aceptado = await confirmar({
    titulo: '¿Cerrar turno?',
    mensaje: `Se entregan ${entregar} caso(s)${cerrar > 0 ? ` y se cierran ${cerrar}` : ''}. Esto no se puede deshacer.`,
    resumen,
    aceptar: 'Cerrar turno',
    peligro: true
  });
  if (!aceptado) return;

  const boton = byId<HTMLButtonElement>('btnCerrarTurno');
  boton.disabled = true;
  await guardando;
  const resultado = await cerrarTurno(traspaso, tecnicoId, contexto.fecha, items.map(normalizarItem), sobrantes);
  if (!resultado.ok) {
    mostrarAviso(resultado.error, 'error');
    boton.disabled = false;
    return;
  }
  await cargarTraspaso();
}

async function guardarDescripcionDelCaso(casoId: string, texto: string): Promise<void> {
  const caso = misCasos().find((c) => c.id === casoId);
  const descripcion = texto.trim() || null;
  if (!caso || descripcion === (caso.descripcion ?? null)) return;
  const resultado = await guardarSeguimiento(casoId, { descripcion });
  if (!resultado.ok) mostrarAviso(resultado.error, 'error');
}

let barraTraspaso: BarraDeFiltros | null = null;

function campoDe(evento: Event): { campo: HTMLElement; casoId: string } | null {
  const campo = evento.target;
  if (!(campo instanceof HTMLElement) || !campo.dataset.campo) return null;
  const casoId = campo.closest<HTMLElement>('[data-caso-id]')?.dataset.casoId;
  return casoId ? { campo, casoId } : null;
}

export function iniciarTraspaso(miTecnicoId: string): void {
  tecnicoId = miTecnicoId;
  const lista = byId('handoverItems');
  barraTraspaso = crearBarraDeFiltros(byId('handoverFilters'), {
    clave: 'traspaso',
    campos: ['tipo', 'area', 'estado', 'tecnico'],
    todosLosTecnicos: 'Todos los receptores',
    tecnicos: () => receptores().map((r) => ({ id: r.tecnicoId, nombre: r.nombre })),
    alCambiar: () => renderizarTraspaso()
  });

  // Texto: se guarda en el modelo al escribir, sin redibujar la lista.
  lista.addEventListener('input', (evento) => {
    const objetivo = campoDe(evento);
    if (!objetivo || !(objetivo.campo instanceof HTMLInputElement || objetivo.campo instanceof HTMLTextAreaElement)) return;
    const nombre = objetivo.campo.dataset.campo!;
    if (!['etiqueta', 'descripcion', 'recordatorioTexto'].includes(nombre)) return;
    cambiarItem(objetivo.casoId, { [nombre]: objetivo.campo.value });
    pintarResumen();
  });

  // Listas, fechas y candado: cambian la forma del caso, se redibuja.
  lista.addEventListener('change', (evento) => {
    const objetivo = campoDe(evento);
    if (!objetivo) return;
    const { campo, casoId } = objetivo;
    const valor = (campo as HTMLInputElement).value;
    switch (campo.dataset.campo) {
      case 'candado':
        if ((campo as HTMLInputElement).checked) candados.add(casoId);
        else candados.delete(casoId);
        return;
      case 'estado':
        cambiarItem(casoId, valor === 'cerrado' ? { estado: 'cerrado', paraTecnicoId: null } : { estado: valor as EstadoCaso });
        break;
      case 'receptor':
        cambiarItem(casoId, { paraTecnicoId: valor || null });
        break;
      case 'recordatorioFecha':
        cambiarItem(casoId, { recordatorioFecha: valor || null });
        break;
      case 'descripcion':
        // Es la descripción del caso (D21): se guarda en el caso y se ve igual en Mi seguimiento.
        void guardarDescripcionDelCaso(casoId, valor);
        return;
      default:
        return;
    }
    renderizarTraspaso();
  });
  lista.addEventListener('focusout', () => window.setTimeout(() => renderPendiente && renderizarTraspaso(), 0));

  byId('handoverReceivers').addEventListener('change', (evento) => {
    const casilla = evento.target;
    if (!(casilla instanceof HTMLInputElement) || !casilla.dataset.receptor) return;
    if (casilla.checked) excluidos.delete(casilla.dataset.receptor);
    else excluidos.add(casilla.dataset.receptor);
  });

  byId('btnRepartirPendientes').addEventListener('click', () => repartir('huerfanos'));
  byId('btnRebalancear').addEventListener('click', () => repartir('todos'));
  byId('btnDeshacerReparto').addEventListener('click', () => {
    const anterior = deshacer.pop();
    if (!anterior) return;
    items = anterior;
    programarGuardado();
    renderizarTraspaso();
  });
  byId('handoverOrder').addEventListener('change', pintarResumen);
  byId('handoverTags').addEventListener('change', pintarResumen);
  vista().querySelectorAll<HTMLElement>('.handover-copy [data-copiar]').forEach((boton) =>
    boton.addEventListener('click', () => void copiarReporte(boton.dataset.copiar as FormatoDeCopia, salidas))
  );
  byId('btnCerrarTurno').addEventListener('click', () => void confirmarCierre());

  appStore.subscribe(() => {
    if (contexto && appStore.get().vista === 'traspaso') renderizarTraspaso();
  });
}

/** Al abrir la pestaña: vuelve a leer la planificación y el borrador. */
export function abrirTraspaso(): void {
  void cargarTraspaso();
}
