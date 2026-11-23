import {
  agruparSeguimiento,
  ESTADOS_DE_SEGUIMIENTO,
  ETIQUETA_ORIGEN,
  haceCuanto,
  nivelDeAtraso,
  normalizarEtiqueta,
  resumenDeVarios,
  resumenParaCopiar,
  sinDescripcion,
  type GruposDeSeguimiento
} from '../../domain/followUp';
import { ETIQUETA_ESTADO_CASO } from '../../domain/handover';
import { fechaCorta } from '../../domain/handoverReport';
import { listarResponsables } from '../../services/casosRepo';
import { appStore } from '../../state/appStore';
import type { EstadoCaso, Incidente } from '../../types/noc';
import { copiarTexto, guardarSeguimiento, marcarCasoActualizado } from '../actions/followUpActions';
import { byId, clonarPlantilla, crearElemento, ref } from '../dom';
import { animarPulso } from '../ui/animacion';
import { confirmar } from '../ui/confirmar';
import { mejorarCampoDeEtiqueta } from '../ui/etiquetas';
import { formatearFechaCorta, formatearFechaHora } from '../ui/format';
import { mostrarAviso } from '../ui/toast';
import { filtrarCasos, hayFiltros } from '../../domain/caseFilters';
import { crearBarraDeFiltros, type BarraDeFiltros } from '../features/caseFilters';
import { pintarTipo } from '../ui/tipoDeCaso';

/**
 * "Mi seguimiento" (fase 12): una fila por caso para que entren 20+ casos en pantalla (§11.4).
 * - La descripción (D20) se edita en la misma fila: crece al enfocarla; Ctrl+Enter o salir del campo guarda,
 *   Esc deshace lo escrito.
 * - "Última actualización" es una fecha (D19): la marca cualquier cambio del técnico o el botón Actualizado.
 * - El borde izquierdo avisa el atraso sin actualizar (2/4/6 h).
 */
const REFRESCO_RELATIVO_MS = 60_000;

let tecnicoId = '';
let renderPendiente = false;
/** Casos con el historial desplegado (se conserva al redibujar). */
const historialAbierto = new Set<string>();
const gruposColapsados = new Set<string>();
let barra: BarraDeFiltros | null = null;

const vista = () => byId('followUpView');

/** Mientras se escribe en un caso no se redibuja: se perdería el texto y el cursor. */
function estaEditando(): boolean {
  const activo = document.activeElement;
  return activo instanceof HTMLElement && vista().contains(activo) && activo.matches('input, textarea');
}

function misCasos(): Incidente[] {
  return appStore.get().casosAbiertos.filter((c) => c.tecnicoId === tecnicoId);
}

function pintarHace(elemento: HTMLElement, caso: Pick<Incidente, 'ultimaActualizacionEn' | 'ultimaActualizacionPor'>, ahora: Date): void {
  const iso = caso.ultimaActualizacionEn;
  elemento.classList.toggle('is-never', !iso);
  elemento.dataset.iso = iso ?? '';
  elemento.textContent = iso ? haceCuanto(iso, ahora) : 'Sin actualizar';
  elemento.title = iso ? `${formatearFechaHora(iso)}${caso.ultimaActualizacionPor ? ` · ${caso.ultimaActualizacionPor}` : ''}` : 'Aún no lo actualizas';
}

/** Ajusta la altura del cuadro de descripción a su contenido (solo mientras se edita). */
function ajustarAltura(campo: HTMLTextAreaElement): void {
  campo.style.height = 'auto';
  if (document.activeElement === campo) campo.style.height = `${Math.min(campo.scrollHeight + 2, 192)}px`;
}

function crearFila(caso: Incidente, hoy: string, ahora: Date): HTMLElement {
  const fragmento = clonarPlantilla('tpl-seguimiento-caso');
  const fila = ref(fragmento, 'tarjeta');
  fila.dataset.casoId = caso.id;
  fila.dataset.estado = caso.estado ?? 'en_curso';
  fila.dataset.atraso = String(nivelDeAtraso(caso, ahora));

  ref(fragmento, 'codigo').textContent = caso.codigo;
  pintarTipo(ref(fragmento, 'tipo'), caso.codigo);
  ref(fragmento, 'origen').textContent = caso.origenResponsable ? ETIQUETA_ORIGEN[caso.origenResponsable] : 'Asignado';

  const fecha = ref(fragmento, 'fecha');
  if (caso.fechaResponsable && caso.fechaResponsable !== hoy) {
    fecha.textContent = caso.fechaResponsable > hoy ? `Para tu turno del ${formatearFechaCorta(caso.fechaResponsable)}` : `Desde el ${formatearFechaCorta(caso.fechaResponsable)}`;
    fecha.classList.remove('hidden');
  }
  const recordatorio = ref(fragmento, 'recordatorio');
  if (caso.recordatorioFecha) {
    recordatorio.textContent = `Recordar ${fechaCorta(caso.recordatorioFecha)}${caso.recordatorioTexto ? `: ${caso.recordatorioTexto}` : ''}`;
    recordatorio.classList.remove('hidden');
  }

  ref<HTMLInputElement>(fragmento, 'empresa').value = caso.cliente ?? '';
  ref<HTMLSelectElement>(fragmento, 'area').value = caso.area ?? '';

  const estado = ref<HTMLSelectElement>(fragmento, 'estado');
  estado.append(...ESTADOS_DE_SEGUIMIENTO.map((e) => new Option(ETIQUETA_ESTADO_CASO[e], e)));
  estado.value = caso.estado ?? 'en_curso';

  const etiqueta = ref<HTMLInputElement>(fragmento, 'etiqueta');
  etiqueta.value = caso.etiqueta ?? '';
  mejorarCampoDeEtiqueta(etiqueta);

  const descripcion = ref<HTMLTextAreaElement>(fragmento, 'descripcion');
  descripcion.value = caso.descripcion ?? '';
  descripcion.dataset.original = caso.descripcion ?? '';
  descripcion.title = descripcion.value;
  // La nota histórica del dispatch (antes de la fase 10) queda como pista, sin copiarse sola.
  if (!caso.descripcion && caso.nota) descripcion.placeholder = `Nota del dispatch: ${caso.nota}`;

  pintarHace(ref(fragmento, 'hace'), caso, ahora);

  if (historialAbierto.has(caso.id)) void cargarHistorial(fila, caso.id);
  return fila;
}

function pintarGrupo(grupo: keyof GruposDeSeguimiento, casos: Incidente[], hoy: string, ahora: Date, filtrando: boolean): void {
  const seccion = vista().querySelector<HTMLElement>(`[data-grupo="${grupo}"]`)!;
  seccion.classList.toggle('hidden', grupo === 'anteriores' && casos.length === 0);
  seccion.classList.toggle('is-collapsed', gruposColapsados.has(grupo));
  seccion.querySelector('[data-action="alternar-grupo"]')?.setAttribute('aria-expanded', String(!gruposColapsados.has(grupo)));
  ref(seccion, 'conteo').textContent = String(casos.length);
  ref(seccion, 'lista').replaceChildren(
    ...(casos.length > 0
      ? casos.map((c) => crearFila(c, hoy, ahora))
      : [
          crearElemento(
            'p',
            'empty-incidents',
            filtrando ? 'Ningún caso coincide con los filtros.' : grupo === 'traspaso' ? 'No tienes casos recibidos en traspaso.' : 'No tienes casos nuevos hoy.'
          )
        ])
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

  const ahora = new Date();
  const casos = misCasos();
  barra?.actualizar(casos);
  const filtros = barra?.filtros();
  const filtrando = !!filtros && hayFiltros(filtros);
  const grupos = agruparSeguimiento(filtros ? filtrarCasos(casos, filtros) : casos, tecnicoId, fechaOperativa);
  pintarGrupo('traspaso', grupos.traspaso, fechaOperativa, ahora, filtrando);
  pintarGrupo('nuevos', grupos.nuevos, fechaOperativa, ahora, filtrando);
  pintarGrupo('anteriores', grupos.anteriores, fechaOperativa, ahora, filtrando);

  const pendientes = sinDescripcion(casos).length;
  byId('followUpSummary').textContent =
    casos.length === 0
      ? 'No tienes casos abiertos.'
      : `${casos.length} caso(s) abierto(s)${pendientes > 0 ? ` · ${pendientes} sin descripción (la necesitan para el traspaso)` : ' · todos con descripción'}`;

  const insignia = byId('followUpBadge');
  insignia.textContent = String(pendientes);
  insignia.title = 'Casos sin descripción';
  insignia.classList.toggle('hidden', pendientes === 0);
}

/** Solo actualiza los "hace N min" y el atraso, sin redibujar (no interrumpe lo que se escribe). */
function refrescarTiempos(): void {
  const ahora = new Date();
  const porId = new Map(misCasos().map((c) => [c.id, c]));
  vista()
    .querySelectorAll<HTMLElement>('.followup-row[data-caso-id]')
    .forEach((fila) => {
      const caso = porId.get(fila.dataset.casoId!);
      if (!caso) return;
      fila.dataset.atraso = String(nivelDeAtraso(caso, ahora));
      pintarHace(ref(fila, 'hace'), caso, ahora);
    });
}

async function cargarHistorial(fila: HTMLElement, casoId: string): Promise<void> {
  const lista = ref(fila, 'historial');
  const boton = fila.querySelector<HTMLElement>('[data-action="ver-historial"]')!;
  lista.classList.remove('hidden');
  boton.setAttribute('aria-expanded', 'true');
  boton.classList.add('is-active');
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

async function guardar(fila: HTMLElement, caso: Incidente, cambios: Parameters<typeof guardarSeguimiento>[1], aviso: string): Promise<void> {
  fila.classList.add('is-saving');
  const resultado = await guardarSeguimiento(caso.id, cambios);
  fila.classList.remove('is-saving');
  if (!resultado.ok) {
    mostrarAviso(resultado.error, 'error');
    renderizarSeguimiento(); // vuelve a mostrar el valor guardado
    return;
  }
  mostrarAviso(aviso, 'exito');
}

async function guardarDescripcion(fila: HTMLElement): Promise<void> {
  const caso = casoDe(fila);
  const campo = ref<HTMLTextAreaElement>(fila, 'descripcion');
  const texto = campo.value.trim();
  if (!caso || texto === (campo.dataset.original ?? '').trim()) return;
  campo.dataset.original = texto;
  campo.classList.remove('is-dirty');
  await guardar(fila, caso, { descripcion: texto || null }, `${caso.codigo}: descripción guardada.`);
}

async function marcarActualizado(fila: HTMLElement, boton: HTMLElement): Promise<void> {
  const caso = casoDe(fila);
  if (!caso) return;
  fila.classList.add('is-saving');
  const resultado = await marcarCasoActualizado(caso.id);
  fila.classList.remove('is-saving');
  if (!resultado.ok) {
    mostrarAviso(resultado.error, 'error');
    return;
  }
  boton.classList.add('is-done');
  animarPulso(boton);
  mostrarAviso(`${caso.codigo}: marcado como actualizado.`, 'exito');
}

/** Lleva la vista a un caso y lo resalta (al abrir una notificación). */
export function resaltarCaso(casoId: string): void {
  const fila = vista().querySelector<HTMLElement>(`[data-caso-id="${casoId}"]`);
  if (!fila) return;
  fila.closest('.followup-section')?.classList.remove('is-collapsed');
  fila.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  fila.classList.remove('is-highlight');
  void fila.offsetWidth;
  fila.classList.add('is-highlight');
}

export function iniciarSeguimiento(miTecnicoId: string): void {
  tecnicoId = miTecnicoId;
  const raiz = vista();
  barra = crearBarraDeFiltros(byId('followUpFilters'), {
    clave: 'seguimiento',
    campos: ['tipo', 'area', 'estado'],
    alCambiar: () => renderizarSeguimiento()
  });

  raiz.addEventListener('click', (evento) => {
    if (!(evento.target instanceof Element)) return;
    const boton = evento.target.closest<HTMLElement>('[data-action]');
    if (!boton) return;

    if (boton.dataset.action === 'alternar-grupo') {
      const grupo = boton.closest<HTMLElement>('[data-grupo]')?.dataset.grupo;
      if (!grupo) return;
      if (!gruposColapsados.delete(grupo)) gruposColapsados.add(grupo);
      boton.closest('.followup-section')?.classList.toggle('is-collapsed', gruposColapsados.has(grupo));
      boton.setAttribute('aria-expanded', String(!gruposColapsados.has(grupo)));
      return;
    }

    const fila = boton.closest<HTMLElement>('[data-caso-id]');
    const caso = fila ? casoDe(fila) : undefined;
    if (!fila || !caso) return;

    const accion = boton.dataset.action;
    if (accion === 'copiar-codigo') void copiarTexto(caso.codigo, caso.codigo);
    if (accion === 'copiar-resumen') void copiarTexto(resumenParaCopiar(caso), `Resumen de ${caso.codigo}`);
    if (accion === 'marcar-actualizado') void marcarActualizado(fila, boton);
    if (accion === 'ver-historial') {
      if (historialAbierto.delete(caso.id)) {
        ref(fila, 'historial').classList.add('hidden');
        boton.setAttribute('aria-expanded', 'false');
        boton.classList.remove('is-active');
      } else {
        historialAbierto.add(caso.id);
        void cargarHistorial(fila, caso.id);
      }
    }
  });

  raiz.addEventListener('change', (evento) => {
    const campo = evento.target;
    if (!(campo instanceof HTMLElement)) return;
    const fila = campo.closest<HTMLElement>('[data-caso-id]');
    const caso = fila ? casoDe(fila) : undefined;
    if (!fila || !caso) return;

    if (campo instanceof HTMLSelectElement && campo.dataset.ref === 'estado') {
      const estado = campo.value as EstadoCaso;
      if (estado === 'cerrado') {
        void confirmar({
          titulo: `¿Cerrar ${caso.codigo}?`,
          mensaje: 'Sale de tu seguimiento. En el tablero del día queda como cerrado.',
          aceptar: 'Cerrar caso',
          peligro: true,
          ancla: campo
        }).then((si) => {
          if (si) void guardar(fila, caso, { estado }, `${caso.codigo}: ${ETIQUETA_ESTADO_CASO[estado]}.`);
          else campo.value = caso.estado ?? 'en_curso';
        });
        return;
      }
      void guardar(fila, caso, { estado }, `${caso.codigo}: ${ETIQUETA_ESTADO_CASO[estado]}.`);
    }
    if (campo instanceof HTMLSelectElement && campo.dataset.ref === 'area') {
      const area = campo.value || null;
      if (area !== (caso.area ?? null)) void guardar(fila, caso, { area }, `${caso.codigo}: área ${area ?? 'quitada'}.`);
    }
    if (campo instanceof HTMLInputElement && campo.dataset.ref === 'empresa') {
      const empresa = campo.value.trim().replace(/\s+/g, ' ') || null;
      if (empresa !== (caso.cliente ?? null)) void guardar(fila, caso, { empresa }, `${caso.codigo}: empresa ${empresa ?? 'quitada'}.`);
    }
    if (campo instanceof HTMLInputElement && campo.dataset.ref === 'etiqueta') {
      const etiqueta = normalizarEtiqueta(campo.value);
      if (etiqueta !== (caso.etiqueta ?? null)) void guardar(fila, caso, { etiqueta }, `${caso.codigo}: etiqueta ${etiqueta ?? 'quitada'}.`);
    }
  });

  // Descripción: se marca "sin guardar" al escribir y crece con el texto.
  raiz.addEventListener('input', (evento) => {
    const campo = evento.target;
    if (!(campo instanceof HTMLTextAreaElement) || campo.dataset.ref !== 'descripcion') return;
    campo.classList.toggle('is-dirty', campo.value.trim() !== (campo.dataset.original ?? '').trim());
    ajustarAltura(campo);
  });
  raiz.addEventListener('focusin', (evento) => {
    if (evento.target instanceof HTMLTextAreaElement && evento.target.dataset.ref === 'descripcion') ajustarAltura(evento.target);
  });
  raiz.addEventListener('keydown', (evento) => {
    const campo = evento.target;
    if (!(campo instanceof HTMLTextAreaElement) || campo.dataset.ref !== 'descripcion') return;
    const fila = campo.closest<HTMLElement>('[data-caso-id]');
    if (!fila) return;
    if (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey)) {
      evento.preventDefault();
      void guardarDescripcion(fila);
      campo.blur();
    } else if (evento.key === 'Escape') {
      evento.preventDefault();
      campo.value = campo.dataset.original ?? '';
      campo.classList.remove('is-dirty');
      campo.blur();
    }
  });
  // Al salir de la descripción se guarda; al salir de cualquier campo se aplica el redibujo pendiente.
  raiz.addEventListener('focusout', (evento) => {
    const campo = evento.target;
    if (campo instanceof HTMLTextAreaElement && campo.dataset.ref === 'descripcion') {
      campo.style.height = '';
      const fila = campo.closest<HTMLElement>('[data-caso-id]');
      if (fila) void guardarDescripcion(fila);
    }
    window.setTimeout(() => renderPendiente && renderizarSeguimiento(), 0);
  });

  byId('btnCopyAllCases').addEventListener('click', () => {
    const casos = misCasos();
    if (casos.length === 0) mostrarAviso('No tienes casos abiertos para copiar.');
    else void copiarTexto(resumenDeVarios(casos), `${casos.length} caso(s)`);
  });

  window.setInterval(refrescarTiempos, REFRESCO_RELATIVO_MS);
  appStore.subscribe(renderizarSeguimiento);
  renderizarSeguimiento();
}
