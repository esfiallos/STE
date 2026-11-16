import { esRangoDeAlmuerzoValido, HORARIO_ALMUERZO_PREDETERMINADO } from '../../domain/lunch';
import { appStore } from '../../state/appStore';
import { guardarHorarioDeAlmuerzo, limpiarHorarioDeAlmuerzo } from '../actions/technicianActions';
import { byId } from '../dom';
import { abrirModal, cerrarModal, establecerError } from './modal';

const ID_MODAL = 'modalLunch';
const ID_ERROR = 'lunchError';

function campos() {
  return {
    formulario: byId<HTMLFormElement>('formLunch'),
    tecnicoId: byId<HTMLInputElement>('lunchTechId'),
    nombre: byId('lunchTechName'),
    inicio: byId<HTMLInputElement>('lunchStart'),
    fin: byId<HTMLInputElement>('lunchEnd'),
    limpiar: byId<HTMLButtonElement>('btnClearLunch')
  };
}

export function abrirModalAlmuerzo(tecnicoId: string): void {
  const tecnico = appStore.get().tecnicos.find((t) => t.id === tecnicoId);
  if (!tecnico) return;

  const { tecnicoId: campoId, nombre, inicio, fin } = campos();
  campoId.value = tecnico.id;
  nombre.textContent = tecnico.nombre;
  inicio.value = tecnico.almuerzoInicio ?? HORARIO_ALMUERZO_PREDETERMINADO.inicio;
  fin.value = tecnico.almuerzoFin ?? HORARIO_ALMUERZO_PREDETERMINADO.fin;

  establecerError(ID_ERROR, null);
  abrirModal(ID_MODAL);
}

export function iniciarModalAlmuerzo(): void {
  const { formulario, tecnicoId, inicio, fin, limpiar } = campos();

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    if (!esRangoDeAlmuerzoValido(inicio.value, fin.value)) {
      establecerError(ID_ERROR, 'La hora de fin debe ser distinta de la de inicio.');
      return;
    }

    const resultado = await guardarHorarioDeAlmuerzo(tecnicoId.value, inicio.value, fin.value);
    if (resultado.ok) cerrarModal(ID_MODAL);
    else establecerError(ID_ERROR, resultado.error);
  });

  limpiar.addEventListener('click', async () => {
    const resultado = await limpiarHorarioDeAlmuerzo(tecnicoId.value);
    if (resultado.ok) cerrarModal(ID_MODAL);
    else establecerError(ID_ERROR, resultado.error);
  });
}
