import { buscarIncidentePorCodigo, normalizarCodigo } from '../../domain/assignments';
import { esTurnoId } from '../../domain/shifts';
import { appStore } from '../../state/appStore';
import { asignarIncidente, reasignarIncidente } from '../actions/incidentActions';
import { byId } from '../dom';
import { abrirModal, cerrarModal, establecerError } from './modal';

const ID_MODAL = 'modalNewIncident';
const ID_ERROR = 'incidentError';

function campos() {
  return {
    formulario: byId<HTMLFormElement>('formNewIncident'),
    codigo: byId<HTMLInputElement>('inputIncNumber'),
    turno: byId<HTMLSelectElement>('selectShift'),
    tecnico: byId<HTMLSelectElement>('selectTechnician'),
    nota: byId<HTMLInputElement>('inputIncNote'),
    enviar: byId<HTMLButtonElement>('btnSubmitIncident')
  };
}

function poblarTecnicos(tecnicoSeleccionadoId?: string): void {
  const { turno, tecnico, enviar } = campos();
  const candidatos = appStore.get().tecnicos.filter((t) => t.turno === turno.value);

  const opciones = candidatos.map((t) => new Option(t.nombre, t.id, false, t.id === tecnicoSeleccionadoId));
  if (candidatos.length === 0) opciones.push(new Option('Sin técnicos en este turno', '', true, true));

  tecnico.replaceChildren(...opciones);
  tecnico.disabled = candidatos.length === 0;
  enviar.disabled = candidatos.length === 0;
}

/** Abre el modal. Si se indica un técnico, deja preseleccionados su turno y su nombre. */
export function abrirModalAsignar(tecnicoId?: string): void {
  const { formulario, turno } = campos();
  const preseleccionado = appStore.get().tecnicos.find((t) => t.id === tecnicoId);

  formulario.reset();
  if (preseleccionado) turno.value = preseleccionado.turno;
  poblarTecnicos(preseleccionado?.id);
  establecerError(ID_ERROR, null);
  abrirModal(ID_MODAL);
}

/** El INC ya existe: no se duplica, pero se ofrece moverlo al técnico elegido. */
async function ofrecerReasignacion(codigo: string, incidenteId: string, tecnicoActualId: string, tecnicoDestinoId: string) {
  const { tecnicos } = appStore.get();
  const actual = tecnicos.find((t) => t.id === tecnicoActualId);
  const destino = tecnicos.find((t) => t.id === tecnicoDestinoId);

  if (tecnicoActualId === tecnicoDestinoId) {
    establecerError(ID_ERROR, `${codigo} ya está asignado a ${destino?.nombre ?? 'ese técnico'}.`);
    return;
  }

  const confirmado = window.confirm(
    `${codigo} ya está asignado a ${actual?.nombre ?? 'otro técnico'}.\n¿Reasignarlo a ${destino?.nombre ?? 'este técnico'}?`
  );
  if (!confirmado) return;

  const resultado = await reasignarIncidente(incidenteId, tecnicoDestinoId);
  if (resultado.ok) cerrarModal(ID_MODAL);
  else establecerError(ID_ERROR, resultado.error);
}

async function alEnviar(evento: SubmitEvent): Promise<void> {
  evento.preventDefault();
  const { codigo, tecnico, nota, enviar } = campos();

  const codigoNormalizado = normalizarCodigo(codigo.value);
  if (!codigoNormalizado || !tecnico.value) {
    establecerError(ID_ERROR, 'Indica el número de incidente y el técnico.');
    return;
  }

  establecerError(ID_ERROR, null);
  enviar.disabled = true;

  try {
    const existente = buscarIncidentePorCodigo(appStore.get().incidentes, codigoNormalizado);
    if (existente) {
      await ofrecerReasignacion(codigoNormalizado, existente.id, existente.tecnicoId, tecnico.value);
      return;
    }

    const resultado = await asignarIncidente(codigoNormalizado, nota.value, tecnico.value);
    if (resultado.ok) cerrarModal(ID_MODAL);
    else establecerError(ID_ERROR, resultado.error);
  } finally {
    enviar.disabled = tecnico.disabled;
  }
}

export function iniciarModalAsignar(): void {
  const { formulario, turno } = campos();
  turno.addEventListener('change', () => {
    if (esTurnoId(turno.value)) poblarTecnicos();
  });
  formulario.addEventListener('submit', (evento) => void alEnviar(evento));
}
