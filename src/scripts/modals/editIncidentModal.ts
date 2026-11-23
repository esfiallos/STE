import { normalizarCodigo } from '../../domain/assignments';
import { appStore } from '../../state/appStore';
import type { Incidente } from '../../types/noc';
import { cancelarIncidente as cancelarEnBase, editarIncidente } from '../actions/incidentActions';
import { byId } from '../dom';
import { abrirModal, cerrarModal, establecerError } from './modal';

const MODAL_EDITAR = 'modalEditIncident';
const MODAL_CANCELAR = 'modalCancelIncident';

const casoDelTablero = (id: string): Incidente | undefined => appStore.get().incidentes.find((i) => i.id === id);

/** El técnico ya lo trabajó (lo dice su seguimiento): cancelar borra también lo que registró. */
function trabajoDelTecnico(id: string): string | null {
  const caso = appStore.get().casosAbiertos.find((c) => c.id === id);
  if (!caso) return null;
  const hecho = [
    caso.estado && caso.estado !== 'en_curso' ? 'cambió el estado' : '',
    caso.area ? 'registró el área' : '',
    caso.etiqueta ? 'puso etiqueta' : '',
    caso.descripcion ? 'escribió la descripción' : ''
  ].filter(Boolean);
  if (hecho.length === 0 && !caso.actividadTecnicoEn) return null;
  return `El técnico ya trabajó este caso${hecho.length ? ` (${hecho.join(', ')})` : ''}: se perderá.`;
}

/** Editar código y empresa (D26). Solo dispatch; la base lo impone. */
export function abrirEdicionDeCaso(id: string): void {
  const caso = casoDelTablero(id);
  if (!caso || appStore.get().soloLectura) return;
  byId<HTMLInputElement>('editIncidentId').value = caso.id;
  byId<HTMLInputElement>('editIncidentCode').value = caso.codigo;
  byId<HTMLInputElement>('editIncidentCompany').value = caso.cliente ?? '';
  establecerError('editIncidentError', null);
  abrirModal(MODAL_EDITAR);
}

/** Cancelar un caso asignado hoy por error (D25): pide motivo opcional y avisa si ya se trabajó. */
export function abrirCancelacionDeCaso(id: string): void {
  const caso = casoDelTablero(id);
  if (!caso || appStore.get().soloLectura) return;
  const tecnico = appStore.get().catalogo.find((t) => t.id === caso.tecnicoId)?.nombre ?? 'su técnico';
  byId<HTMLInputElement>('cancelIncidentId').value = caso.id;
  byId('cancelIncidentCode').textContent = caso.codigo;
  byId('cancelIncidentTech').textContent = tecnico;
  byId<HTMLInputElement>('cancelIncidentReason').value = '';

  const aviso = trabajoDelTecnico(caso.id);
  const elementoAviso = byId('cancelIncidentWorked');
  elementoAviso.textContent = aviso ?? '';
  elementoAviso.classList.toggle('hidden', aviso === null);

  establecerError('cancelIncidentError', null);
  abrirModal(MODAL_CANCELAR);
}

export function iniciarModalEdicionDeCaso(): void {
  byId<HTMLFormElement>('formEditIncident').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const id = byId<HTMLInputElement>('editIncidentId').value;
    const codigo = normalizarCodigo(byId<HTMLInputElement>('editIncidentCode').value);
    const empresa = byId<HTMLInputElement>('editIncidentCompany').value;
    if (!codigo) {
      establecerError('editIncidentError', 'Indica el número de caso.');
      return;
    }
    const caso = casoDelTablero(id);
    if (caso && caso.codigo === codigo && (caso.cliente ?? '') === empresa.trim()) {
      cerrarModal(MODAL_EDITAR);
      return;
    }
    const resultado = await editarIncidente(id, codigo, empresa);
    if (resultado.ok) cerrarModal(MODAL_EDITAR);
    else establecerError('editIncidentError', resultado.error);
  });

  byId<HTMLFormElement>('formCancelIncident').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const id = byId<HTMLInputElement>('cancelIncidentId').value;
    const resultado = await cancelarEnBase(id, byId<HTMLInputElement>('cancelIncidentReason').value);
    if (resultado.ok) cerrarModal(MODAL_CANCELAR);
    else establecerError('cancelIncidentError', resultado.error);
  });
}
