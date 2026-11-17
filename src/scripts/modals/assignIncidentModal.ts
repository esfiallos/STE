import { estadoDelTecnico } from '../../domain/availability';
import { ETIQUETA_COMODIN, TURNOS } from '../../domain/shifts';
import { appStore } from '../../state/appStore';
import { byId } from '../dom';
import { solicitarAsignacion } from './assignFlow';
import { abrirModal, cerrarModal, establecerError } from './modal';

const ID_MODAL = 'modalNewIncident';
const ID_ERROR = 'incidentError';

const GRUPOS = [...TURNOS.map((t) => ({ id: t.id as string, nombre: t.nombre })), { id: 'comodin', nombre: ETIQUETA_COMODIN }];

function campos() {
  return {
    formulario: byId<HTMLFormElement>('formNewIncident'),
    codigo: byId<HTMLInputElement>('inputIncNumber'),
    tecnico: byId<HTMLSelectElement>('selectTechnician'),
    nota: byId<HTMLInputElement>('inputIncNote'),
    enviar: byId<HTMLButtonElement>('btnSubmitIncident')
  };
}

/** Solo se ofrecen técnicos disponibles ahora (en su horario y fuera de su almuerzo), agrupados por turno. */
function poblarTecnicos(): void {
  const { tecnico, enviar } = campos();
  const ahora = new Date();
  const disponibles = appStore.get().tecnicos.filter((t) => estadoDelTecnico(t, ahora) === 'disponible');

  if (disponibles.length === 0) {
    tecnico.replaceChildren(new Option('No hay técnicos disponibles ahora', '', true, true));
    tecnico.disabled = true;
    enviar.disabled = true;
    return;
  }

  const grupos = GRUPOS.map((grupo) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = grupo.nombre;
    disponibles.filter((t) => t.turno === grupo.id).forEach((t) => optgroup.append(new Option(t.nombre, t.id)));
    return optgroup;
  }).filter((optgroup) => optgroup.children.length > 0);

  tecnico.replaceChildren(new Option('Selecciona un técnico', '', true, true), ...grupos);
  tecnico.disabled = false;
  enviar.disabled = false;
}

export function abrirModalAsignar(): void {
  campos().formulario.reset();
  poblarTecnicos();
  establecerError(ID_ERROR, null);
  abrirModal(ID_MODAL);
}

async function alEnviar(evento: SubmitEvent): Promise<void> {
  evento.preventDefault();
  const { codigo, tecnico, nota, enviar } = campos();

  establecerError(ID_ERROR, null);
  enviar.disabled = true;

  try {
    const resultado = await solicitarAsignacion(codigo.value, nota.value, tecnico.value);
    if (resultado === null) return;

    if (resultado.ok) cerrarModal(ID_MODAL);
    else establecerError(ID_ERROR, resultado.error);
  } finally {
    enviar.disabled = tecnico.disabled;
  }
}

export function iniciarModalAsignar(): void {
  campos().formulario.addEventListener('submit', (evento) => void alEnviar(evento));
}
