import { HORARIO_ALMUERZO_PREDETERMINADO } from '../../domain/lunch';
import { esRangoValido } from '../../domain/time';
import { appStore } from '../../state/appStore';
import type { Hora } from '../../types/noc';
import { guardarHorarioDeAlmuerzo, limpiarHorarioDeAlmuerzo } from '../actions/technicianActions';
import { byId } from '../dom';
import { abrirModal, cerrarModal, establecerError } from './modal';

const ID_MODAL = 'modalLunch';
const ID_ERROR = 'lunchError';

/** Qué se edita: el almuerzo de una jornada (un técnico en un día). */
export interface AlmuerzoAEditar {
  jornadaId: string;
  /** Texto del encabezado, ej. "Ana Pérez" o "Ana Pérez · mar 17/11". */
  titulo: string;
  inicio: Hora | null;
  fin: Hora | null;
}

let alGuardar: (() => void) | null = null;

function campos() {
  return {
    formulario: byId<HTMLFormElement>('formLunch'),
    jornadaId: byId<HTMLInputElement>('lunchTechId'),
    nombre: byId('lunchTechName'),
    inicio: byId<HTMLInputElement>('lunchStart'),
    fin: byId<HTMLInputElement>('lunchEnd'),
    limpiar: byId<HTMLButtonElement>('btnClearLunch')
  };
}

/** `despues` se llama tras guardar o quitar (p. ej. para recargar la planificación). */
export function abrirModalAlmuerzo(datos: AlmuerzoAEditar, despues?: () => void): void {
  const { jornadaId, nombre, inicio, fin } = campos();
  jornadaId.value = datos.jornadaId;
  nombre.textContent = datos.titulo;
  inicio.value = datos.inicio ?? HORARIO_ALMUERZO_PREDETERMINADO.inicio;
  fin.value = datos.fin ?? HORARIO_ALMUERZO_PREDETERMINADO.fin;
  alGuardar = despues ?? null;

  establecerError(ID_ERROR, null);
  abrirModal(ID_MODAL);
}

/** Desde el tablero: el almuerzo de hoy del técnico. */
export function abrirAlmuerzoDelTecnico(tecnicoId: string): void {
  const tecnico = appStore.get().tecnicos.find((t) => t.id === tecnicoId);
  if (!tecnico?.jornadaId) return;
  abrirModalAlmuerzo({ jornadaId: tecnico.jornadaId, titulo: tecnico.nombre, inicio: tecnico.almuerzoInicio, fin: tecnico.almuerzoFin });
}

function terminar(): void {
  cerrarModal(ID_MODAL);
  alGuardar?.();
  alGuardar = null;
}

export function iniciarModalAlmuerzo(): void {
  const { formulario, jornadaId, inicio, fin, limpiar } = campos();

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    if (!esRangoValido(inicio.value, fin.value)) {
      establecerError(ID_ERROR, 'La hora de fin debe ser distinta de la de inicio.');
      return;
    }

    const resultado = await guardarHorarioDeAlmuerzo(jornadaId.value, inicio.value, fin.value);
    if (resultado.ok) terminar();
    else establecerError(ID_ERROR, resultado.error);
  });

  limpiar.addEventListener('click', async () => {
    const resultado = await limpiarHorarioDeAlmuerzo(jornadaId.value);
    if (resultado.ok) terminar();
    else establecerError(ID_ERROR, resultado.error);
  });
}
