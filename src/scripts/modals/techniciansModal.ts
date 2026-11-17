import { unirTecnicosConIncidentes } from '../../domain/assignments';
import { ETIQUETA_COMODIN, esTurnoTecnico, TURNOS } from '../../domain/shifts';
import { esRangoValido } from '../../domain/time';
import { appStore } from '../../state/appStore';
import { agregarTecnico, quitarTecnico } from '../actions/technicianActions';
import { byId, clonarPlantilla, crearElemento, ref } from '../dom';
import { abrirModal, establecerError } from './modal';

const ID_MODAL = 'modalTechnicians';
const ID_ERROR = 'techError';

const GRUPOS = [...TURNOS.map((t) => ({ id: t.id as string, nombre: t.nombre })), { id: 'comodin', nombre: ETIQUETA_COMODIN }];

function crearFila(id: string, nombre: string, casos: number, horario: string): HTMLElement {
  const fragmento = clonarPlantilla('tpl-tecnico-fila');
  const fila = ref(fragmento, 'fila');

  fila.dataset.tecnicoId = id;
  fila.dataset.tecnicoNombre = nombre;
  ref(fragmento, 'nombre').textContent = nombre;
  ref(fragmento, 'horario').textContent = horario;
  ref(fragmento, 'casos').textContent = casos === 0 ? '' : `${casos} caso(s)`;
  return fila;
}

function renderizarLista(): void {
  const { tecnicos, incidentes } = appStore.get();
  const conIncidentes = unirTecnicosConIncidentes(tecnicos, incidentes);
  const contenido: HTMLElement[] = [];

  for (const grupo of GRUPOS) {
    contenido.push(crearElemento('div', 'tech-group-title', grupo.nombre));

    const delGrupo = conIncidentes.filter((t) => t.turno === grupo.id);
    if (delGrupo.length === 0) {
      contenido.push(crearElemento('div', 'tech-item-row text-muted', 'Sin técnicos'));
    }
    delGrupo.forEach((t) => {
      const horario = t.horarioInicio && t.horarioFin ? `${t.horarioInicio} - ${t.horarioFin}` : '';
      contenido.push(crearFila(t.id, t.nombre, t.incidentes.length, horario));
    });
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
  const horarioComodin = byId('comodinHorario');
  const inicio = byId<HTMLInputElement>('comodinStart');
  const fin = byId<HTMLInputElement>('comodinEnd');

  const alternarHorario = () => {
    const esComodin = turno.value === 'comodin';
    horarioComodin.classList.toggle('hidden', !esComodin);
    inicio.required = esComodin;
    fin.required = esComodin;
  };
  turno.addEventListener('change', alternarHorario);
  alternarHorario();

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!esTurnoTecnico(turno.value) || !nombre.value.trim()) return;

    const esComodin = turno.value === 'comodin';
    if (esComodin && !esRangoValido(inicio.value, fin.value)) {
      establecerError(ID_ERROR, 'Indica el horario del comodín (la hora de fin debe ser distinta de la de inicio).');
      return;
    }

    const horario = esComodin ? { inicio: inicio.value, fin: fin.value } : undefined;
    const resultado = await agregarTecnico(nombre.value, turno.value, horario);
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
