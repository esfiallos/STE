import {
  agruparSeguimiento,
  ESTADOS_DE_SEGUIMIENTO,
  ETIQUETA_ORIGEN,
  normalizarEtiqueta,
  resumenDeVarios,
  resumenParaCopiar,
  sinActualizar,
  type GruposDeSeguimiento
} from '../../domain/followUp';
import { ETIQUETA_ESTADO_CASO } from '../../domain/handover';
import { listarResponsables } from '../../services/casosRepo';
import { appStore } from '../../state/appStore';
import type { EstadoCaso, Incidente } from '../../types/noc';
import { copiarTexto, guardarSeguimiento } from '../actions/followUpActions';
import { byId, clonarPlantilla, crearElemento, ref } from '../dom';
import { formatearFechaCorta, formatearFechaHora } from '../ui/format';
import { mostrarAviso } from '../ui/toast';

let tecnicoId = '';
let renderPendiente = false;
/** Casos con el historial desplegado (se conserva al redibujar). */
const historialAbierto = new Set<string>();

const vista = () => byId('followUpView');

/** Mientras se escribe en un caso no se redibuja: se perdería el texto y el cursor. */
function estaEditando(): boolean {
  const activo = document.activeElement;
  return activo instanceof HTMLElement && vista().contains(activo) && activo.matches('input, textarea');
}

function misCasos(): Incidente[] {
  const { casosAbiertos } = appStore.get();
  return casosAbiertos.filter((c) => c.tecnicoId === tecnicoId);
}

function crearTarjeta(caso: Incidente, hoy: string): HTMLElement {
  const fragmento = clonarPlantilla('tpl-seguimiento-caso');
  const tarjeta = ref(fragmento, 'tarjeta');
  tarjeta.dataset.casoId = caso.id;
  tarjeta.dataset.estado = caso.estado ?? 'en_curso';
  tarjeta.classList.toggle('is-sin-actualizar', !caso.ultimaActualizacion?.trim());

  ref(fragmento, 'codigo').textContent = caso.codigo;
  ref(fragmento, 'origen').textContent = caso.origenResponsable ? ETIQUETA_ORIGEN[caso.origenResponsable] : 'Asignado';

  const fecha = ref(fragmento, 'fecha');
  if (caso.fechaResponsable && caso.fechaResponsable !== hoy) {
    fecha.textContent = caso.fechaResponsable > hoy ? `Para tu turno del ${formatearFechaCorta(caso.fechaResponsable)}` : `Desde el ${formatearFechaCorta(caso.fechaResponsable)}`;
    fecha.classList.remove('hidden');
  }

  const descripcion = [caso.cliente, caso.area, caso.descripcion ?? caso.nota].filter(Boolean).join(' · ');
  const parrafo = ref(fragmento, 'descripcion');
  if (descripcion) parrafo.textContent = descripcion;
  else parrafo.remove();

  const estado = ref<HTMLSelectElement>(fragmento, 'estado');
  estado.append(...ESTADOS_DE_SEGUIMIENTO.map((e) => new Option(ETIQUETA_ESTADO_CASO[e], e)));
  estado.value = caso.estado ?? 'en_curso';

  ref<HTMLInputElement>(fragmento, 'etiqueta').value = caso.etiqueta ?? '';
  const actualizacion = ref<HTMLTextAreaElement>(fragmento, 'actualizacion');
  actualizacion.value = caso.ultimaActualizacion ?? '';
  actualizacion.dataset.original = actualizacion.value;

  ref(fragmento, 'meta').textContent = caso.ultimaActualizacionEn
    ? `Actualizado ${formatearFechaHora(caso.ultimaActualizacionEn)}${caso.ultimaActualizacionPor ? ` · ${caso.ultimaActualizacionPor}` : ''}`
    : 'Sin última actualización: la necesitarás para el traspaso.';

  if (historialAbierto.has(caso.id)) void cargarHistorial(tarjeta, caso.id);
  return tarjeta;
}

function pintarGrupo(grupo: keyof GruposDeSeguimiento, casos: Incidente[], hoy: string): void {
  const seccion = vista().querySelector<HTMLElement>(`[data-grupo="${grupo}"]`)!;
  const lista = ref(seccion, 'lista');
  seccion.classList.toggle('hidden', grupo === 'anteriores' && casos.length === 0);
  lista.replaceChildren(
    ...(casos.length > 0
      ? casos.map((c) => crearTarjeta(c, hoy))
      : [crearElemento('p', 'empty-incidents', grupo === 'traspaso' ? 'No tienes casos recibidos en traspaso.' : 'No tienes casos nuevos hoy.')])
  );
}

/** Dibuja el seguimiento completo; si se está escribiendo en un caso, lo deja para cuando termine. */
export function renderizarSeguimiento(): void {
  if (!tecnicoId) return;
  if (estaEditando()) {
    renderPendiente = true;
    return;
  }
  renderPendiente = false;

  const { fechaOperativa, carga } = appStore.get();
  const estado = byId('followUpStatus');
  estado.textContent = carga === 'cargando' ? 'Cargando tus casos…' : '';
  estado.classList.toggle('hidden', carga !== 'cargando');

  const casos = misCasos();
  const grupos = agruparSeguimiento(casos, tecnicoId, fechaOperativa);
  pintarGrupo('traspaso', grupos.traspaso, fechaOperativa);
  pintarGrupo('nuevos', grupos.nuevos, fechaOperativa);
  pintarGrupo('anteriores', grupos.anteriores, fechaOperativa);

  const pendientes = sinActualizar(casos).length;
  byId('followUpSummary').textContent =
    casos.length === 0
      ? 'No tienes casos abiertos.'
      : `${casos.length} caso(s) abierto(s)${pendientes > 0 ? ` · ${pendientes} sin última actualización` : ' · todos al día'}`;

  const insignia = byId('followUpBadge');
  insignia.textContent = String(pendientes);
  insignia.classList.toggle('hidden', pendientes === 0);
}

async function cargarHistorial(tarjeta: HTMLElement, casoId: string): Promise<void> {
  const lista = ref(tarjeta, 'historial');
  const boton = tarjeta.querySelector<HTMLElement>('[data-action="ver-historial"]')!;
  lista.classList.remove('hidden');
  boton.setAttribute('aria-expanded', 'true');
  lista.replaceChildren(crearElemento('li', 'text-muted', 'Cargando historial…'));

  const resultado = await listarResponsables(casoId);
  if (!resultado.ok) {
    lista.replaceChildren(crearElemento('li', 'form-error', resultado.error));
    return;
  }
  lista.replaceChildren(
    ...resultado.data.map((r) =>
      crearElemento(
        'li',
        r.hasta ? '' : 'is-actual',
        `${r.tecnicoNombre} · ${ETIQUETA_ORIGEN[r.origen]} · ${formatearFechaHora(r.desde)}${r.hasta ? ` → ${formatearFechaHora(r.hasta)}` : ' (actual)'}`
      )
    )
  );
}

function casoDe(elemento: Element): Incidente | undefined {
  const id = elemento.closest<HTMLElement>('[data-caso-id]')?.dataset.casoId;
  return misCasos().find((c) => c.id === id);
}

async function guardar(tarjeta: HTMLElement, caso: Incidente, cambios: Parameters<typeof guardarSeguimiento>[1], aviso: string): Promise<void> {
  tarjeta.classList.add('is-saving');
  const resultado = await guardarSeguimiento(caso.id, cambios);
  tarjeta.classList.remove('is-saving');
  if (!resultado.ok) {
    mostrarAviso(resultado.error, 'error');
    renderizarSeguimiento(); // vuelve a mostrar el valor guardado
    return;
  }
  mostrarAviso(aviso, 'exito');
}

async function guardarActualizacion(tarjeta: HTMLElement): Promise<void> {
  const caso = casoDe(tarjeta);
  const campo = ref<HTMLTextAreaElement>(tarjeta, 'actualizacion');
  if (!caso || campo.value === campo.dataset.original) return;
  campo.blur();
  await guardar(tarjeta, caso, { ultimaActualizacion: campo.value.trim() || null }, `${caso.codigo}: última actualización guardada.`);
}

/** Lleva la vista a un caso y lo resalta (al abrir una notificación). */
export function resaltarCaso(casoId: string): void {
  const tarjeta = vista().querySelector<HTMLElement>(`[data-caso-id="${casoId}"]`);
  if (!tarjeta) return;
  tarjeta.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  tarjeta.classList.remove('is-highlight');
  void tarjeta.offsetWidth;
  tarjeta.classList.add('is-highlight');
}

export function iniciarSeguimiento(miTecnicoId: string): void {
  tecnicoId = miTecnicoId;
  const raiz = vista();

  raiz.addEventListener('click', (evento) => {
    if (!(evento.target instanceof Element)) return;
    const boton = evento.target.closest<HTMLElement>('[data-action]');
    const tarjeta = boton?.closest<HTMLElement>('[data-caso-id]');
    const caso = tarjeta ? casoDe(tarjeta) : undefined;
    if (!boton || !tarjeta || !caso) return;

    const accion = boton.dataset.action;
    if (accion === 'copiar-codigo') void copiarTexto(caso.codigo, caso.codigo);
    if (accion === 'copiar-resumen') void copiarTexto(resumenParaCopiar(caso), `Resumen de ${caso.codigo}`);
    if (accion === 'guardar-actualizacion') void guardarActualizacion(tarjeta);
    if (accion === 'ver-historial') {
      if (historialAbierto.delete(caso.id)) {
        ref(tarjeta, 'historial').classList.add('hidden');
        boton.setAttribute('aria-expanded', 'false');
      } else {
        historialAbierto.add(caso.id);
        void cargarHistorial(tarjeta, caso.id);
      }
    }
  });

  raiz.addEventListener('change', (evento) => {
    const campo = evento.target;
    if (!(campo instanceof HTMLElement)) return;
    const tarjeta = campo.closest<HTMLElement>('[data-caso-id]');
    const caso = tarjeta ? casoDe(tarjeta) : undefined;
    if (!tarjeta || !caso) return;

    if (campo instanceof HTMLSelectElement && campo.dataset.ref === 'estado') {
      const estado = campo.value as EstadoCaso;
      if (estado === 'cerrado' && !window.confirm(`¿Cerrar ${caso.codigo}? Sale de tu seguimiento y del tablero.`)) {
        campo.value = caso.estado ?? 'en_curso';
        return;
      }
      void guardar(tarjeta, caso, { estado }, `${caso.codigo}: ${ETIQUETA_ESTADO_CASO[estado]}.`);
    }
    if (campo instanceof HTMLInputElement && campo.dataset.ref === 'etiqueta') {
      const etiqueta = normalizarEtiqueta(campo.value);
      if (etiqueta !== (caso.etiqueta ?? null)) void guardar(tarjeta, caso, { etiqueta }, `${caso.codigo}: etiqueta ${etiqueta ?? 'quitada'}.`);
    }
  });

  // "Guardar" solo se habilita si el texto cambió; Ctrl/Cmd + Enter guarda.
  raiz.addEventListener('input', (evento) => {
    const campo = evento.target;
    if (!(campo instanceof HTMLTextAreaElement)) return;
    const tarjeta = campo.closest<HTMLElement>('[data-caso-id]');
    const boton = tarjeta?.querySelector<HTMLButtonElement>('[data-action="guardar-actualizacion"]');
    if (boton) boton.disabled = campo.value === campo.dataset.original;
  });
  raiz.addEventListener('keydown', (evento) => {
    if (!(evento.target instanceof HTMLTextAreaElement) || evento.key !== 'Enter' || !(evento.ctrlKey || evento.metaKey)) return;
    evento.preventDefault();
    const tarjeta = evento.target.closest<HTMLElement>('[data-caso-id]');
    if (tarjeta) void guardarActualizacion(tarjeta);
  });
  raiz.addEventListener('focusout', () => window.setTimeout(() => renderPendiente && renderizarSeguimiento(), 0));

  byId('btnCopyAllCases').addEventListener('click', () => {
    const casos = misCasos();
    if (casos.length === 0) mostrarAviso('No tienes casos abiertos para copiar.');
    else void copiarTexto(resumenDeVarios(casos), `${casos.length} caso(s)`);
  });

  appStore.subscribe(renderizarSeguimiento);
  renderizarSeguimiento();
}
