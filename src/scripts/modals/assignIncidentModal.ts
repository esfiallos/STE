import { buscarIncidentePorCodigo, normalizarCodigo } from '../../domain/assignments';
import { estadoDelTecnico } from '../../domain/availability';
import { siguienteEnRonda, turnoEnCurso } from '../../domain/round';
import { ultimoDeRonda } from '../../services/rondaRepo';
import { ETIQUETA_COMODIN, TURNOS } from '../../domain/shifts';
import { appStore } from '../../state/appStore';
import { byId } from '../dom';
import { asignarIncidenteARonda } from '../actions/incidentActions';
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
    empresa: byId<HTMLInputElement>('inputIncCompany'),
    enviar: byId<HTMLButtonElement>('btnSubmitIncident'),
    ronda: byId<HTMLButtonElement>('btnAssignRound'),
    pista: byId('roundHint')
  };
}

const disponiblesAhora = () => {
  const ahora = new Date();
  return appStore.get().tecnicos.filter((t) => estadoDelTecnico(t, ahora) === 'disponible');
};

/** Muestra quién recibiría el caso por ronda (la base decide al asignar; esto es solo una vista previa). */
async function mostrarSiguienteEnRonda(): Promise<void> {
  const { pista } = campos();
  const candidatos = disponiblesAhora();
  if (candidatos.length === 0) {
    pista.textContent = '';
    return;
  }
  const ultimo = await ultimoDeRonda(appStore.get().fechaOperativa, turnoEnCurso(new Date()));
  const siguiente = siguienteEnRonda(candidatos, ultimo.ok ? ultimo.data : null);
  pista.textContent = siguiente ? `Siguiente en la ronda: ${siguiente.nombre}` : '';
}

/** Solo se ofrecen técnicos disponibles ahora (en su horario y fuera de su almuerzo), agrupados por turno. */
function poblarTecnicos(): void {
  const { tecnico, enviar, ronda } = campos();
  const disponibles = disponiblesAhora();

  if (disponibles.length === 0) {
    tecnico.replaceChildren(new Option('No hay técnicos disponibles ahora', '', true, true));
    tecnico.disabled = true;
    enviar.disabled = true;
    ronda.disabled = true;
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
  ronda.disabled = false;
}

export function abrirModalAsignar(): void {
  campos().formulario.reset();
  poblarTecnicos();
  establecerError(ID_ERROR, null);
  campos().pista.textContent = '';
  abrirModal(ID_MODAL);
  void mostrarSiguienteEnRonda();
}

/** "Asignar a la ronda": crea el caso y la base elige al siguiente técnico disponible. */
async function alAsignarARonda(): Promise<void> {
  const { codigo: campoCodigo, empresa, ronda, tecnico } = campos();
  establecerError(ID_ERROR, null);
  const { incidentes, soloLectura, catalogo } = appStore.get();
  if (soloLectura) return establecerError(ID_ERROR, 'No tienes permiso para asignar casos.');

  const codigo = normalizarCodigo(campoCodigo.value);
  if (!codigo) return establecerError(ID_ERROR, 'Indica el número de incidente.');
  const enTablero = buscarIncidentePorCodigo(incidentes, codigo);
  if (enTablero && enTablero.estado !== 'cerrado') {
    const quien = catalogo.find((t) => t.id === enTablero.tecnicoId)?.nombre ?? 'otro técnico';
    return establecerError(ID_ERROR, `${codigo} ya está asignado a ${quien}.`);
  }

  ronda.disabled = true;
  try {
    const resultado = await asignarIncidenteARonda(codigo, empresa.value);
    if (resultado.ok) cerrarModal(ID_MODAL);
    else establecerError(ID_ERROR, resultado.error);
  } finally {
    ronda.disabled = tecnico.disabled;
  }
}

async function alEnviar(evento: SubmitEvent): Promise<void> {
  evento.preventDefault();
  const { codigo, tecnico, empresa, enviar } = campos();

  establecerError(ID_ERROR, null);
  enviar.disabled = true;

  try {
    const resultado = await solicitarAsignacion(codigo.value, empresa.value, tecnico.value);
    if (resultado === null) return;

    if (resultado.ok) cerrarModal(ID_MODAL);
    else establecerError(ID_ERROR, resultado.error);
  } finally {
    enviar.disabled = tecnico.disabled;
  }
}

export function iniciarModalAsignar(): void {
  campos().formulario.addEventListener('submit', (evento) => void alEnviar(evento));
  campos().ronda.addEventListener('click', () => void alAsignarARonda());
}
