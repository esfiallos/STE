import { abreviaturaDeJornada } from '../../domain/planning';
import { appStore } from '../../state/appStore';
import type { TecnicoCatalogo } from '../../types/noc';
import { agregarTecnico, cambiarActivoTecnico } from '../actions/technicianActions';
import { byId, clonarPlantilla, crearElemento, ref } from '../dom';
import { abrirModal, establecerError } from './modal';

const ID_MODAL = 'modalTechnicians';
const ID_ERROR = 'techError';

function crearFila(tecnico: TecnicoCatalogo): HTMLElement {
  const { tecnicos, incidentes } = appStore.get();
  const deHoy = tecnicos.find((t) => t.id === tecnico.id);
  const casos = incidentes.filter((i) => i.tecnicoId === tecnico.id).length;

  const fragmento = clonarPlantilla('tpl-tecnico-fila');
  const fila = ref(fragmento, 'fila');
  fila.dataset.tecnicoId = tecnico.id;
  fila.dataset.tecnicoNombre = tecnico.nombre;
  fila.dataset.activo = String(tecnico.activo);
  fila.classList.toggle('is-inactivo', !tecnico.activo);

  ref(fragmento, 'nombre').textContent = tecnico.nombre;
  ref(fragmento, 'horario').textContent = deHoy ? `Hoy: ${abreviaturaDeJornada(deHoy)}` : tecnico.activo ? 'Libre hoy' : '';
  ref(fragmento, 'casos').textContent = casos === 0 ? '' : `${casos} caso(s)`;

  const boton = ref(fragmento, 'botonActivo');
  boton.textContent = tecnico.activo ? 'Desactivar' : 'Activar';
  boton.title = tecnico.activo
    ? 'Deja de aparecer en la planificación; conserva su historial'
    : 'Vuelve a aparecer en la planificación';
  return fila;
}

function renderizarLista(): void {
  const { catalogo } = appStore.get();
  const activos = catalogo.filter((t) => t.activo);
  const inactivos = catalogo.filter((t) => !t.activo);

  const contenido: HTMLElement[] = [crearElemento('div', 'tech-group-title', `Activos (${activos.length})`)];
  if (activos.length === 0) contenido.push(crearElemento('div', 'tech-item-row text-muted', 'Sin técnicos'));
  activos.forEach((t) => contenido.push(crearFila(t)));

  if (inactivos.length > 0) {
    contenido.push(crearElemento('div', 'tech-group-title', `Inactivos (${inactivos.length})`));
    inactivos.forEach((t) => contenido.push(crearFila(t)));
  }

  byId('techManagerList').replaceChildren(...contenido);
}

export function abrirModalTecnicos(): void {
  establecerError(ID_ERROR, null);
  renderizarLista();
  abrirModal(ID_MODAL);
}

export function iniciarModalTecnicos(): void {
  const formulario = byId<HTMLFormElement>('formAddTech');
  const nombre = byId<HTMLInputElement>('newTechName');

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!nombre.value.trim()) return;

    const resultado = await agregarTecnico(nombre.value);
    if (resultado.ok) {
      establecerError(ID_ERROR, null);
      nombre.value = '';
      nombre.focus();
    } else {
      establecerError(ID_ERROR, resultado.error);
    }
  });

  byId('techManagerList').addEventListener('click', (evento) => {
    if (!(evento.target instanceof Element)) return;
    if (!evento.target.closest('[data-action="alternar-activo"]')) return;

    const fila = evento.target.closest<HTMLElement>('[data-tecnico-id]');
    const { tecnicoId, tecnicoNombre, activo } = fila?.dataset ?? {};
    if (!tecnicoId || !tecnicoNombre) return;

    const desactivar = activo === 'true';
    if (desactivar) {
      const casos = appStore.get().incidentes.filter((i) => i.tecnicoId === tecnicoId).length;
      const aviso = casos > 0 ? `\nTiene ${casos} caso(s) abierto(s): quedarán "por reasignar".` : '';
      if (!window.confirm(`¿Desactivar a ${tecnicoNombre}?${aviso}`)) return;
    }
    void cambiarActivoTecnico(tecnicoId, tecnicoNombre, !desactivar);
  });

  // Mantiene la lista al día si cambian los datos con el modal abierto.
  appStore.subscribe(renderizarLista);
}
