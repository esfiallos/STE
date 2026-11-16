import { unirTecnicosConIncidentes } from '../../domain/assignments';
import { esTurnoId, TURNOS } from '../../domain/shifts';
import { appStore } from '../../state/appStore';
import { agregarTecnico, quitarTecnico } from '../actions/technicianActions';
import { byId, clonarPlantilla, crearElemento, ref } from '../dom';
import { abrirModal, establecerError } from './modal';

const ID_MODAL = 'modalTechnicians';
const ID_ERROR = 'techError';

function crearFila(id: string, nombre: string, casos: number): HTMLElement {
  const fragmento = clonarPlantilla('tpl-tecnico-fila');
  const fila = ref(fragmento, 'fila');

  fila.dataset.tecnicoId = id;
  fila.dataset.tecnicoNombre = nombre;
  ref(fragmento, 'nombre').textContent = nombre;
  ref(fragmento, 'casos').textContent = casos === 0 ? '' : `${casos} caso(s)`;
  return fila;
}

function renderizarLista(): void {
  const { tecnicos, incidentes } = appStore.get();
  const conIncidentes = unirTecnicosConIncidentes(tecnicos, incidentes);
  const contenido: HTMLElement[] = [];

  for (const turno of TURNOS) {
    contenido.push(crearElemento('div', 'tech-group-title font-mono', turno.nombre));

    const delTurno = conIncidentes.filter((t) => t.turno === turno.id);
    if (delTurno.length === 0) {
      contenido.push(crearElemento('div', 'tech-item-row text-muted', 'Sin técnicos en este turno'));
    }
    delTurno.forEach((t) => contenido.push(crearFila(t.id, t.nombre, t.incidentes.length)));
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
  const turno = byId<HTMLSelectElement>('newTechShift');

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!esTurnoId(turno.value) || !nombre.value.trim()) return;

    const resultado = await agregarTecnico(nombre.value, turno.value);
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
    if (!evento.target.closest('[data-action="quitar-tecnico"]')) return;

    const fila = evento.target.closest<HTMLElement>('[data-tecnico-id]');
    const { tecnicoId, tecnicoNombre } = fila?.dataset ?? {};
    if (!tecnicoId || !tecnicoNombre) return;

    const casos = appStore.get().incidentes.filter((i) => i.tecnicoId === tecnicoId).length;
    const aviso = casos > 0 ? `\nSe eliminarán también sus ${casos} caso(s) asignado(s).` : '';
    if (window.confirm(`¿Eliminar a ${tecnicoNombre}?${aviso}`)) void quitarTecnico(tecnicoId, tecnicoNombre);
  });

  // Mantiene la lista al día si cambian los datos con el modal abierto.
  appStore.subscribe(renderizarLista);
}
