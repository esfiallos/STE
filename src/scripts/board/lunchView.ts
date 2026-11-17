import type { Tecnico } from '../../types/noc';
import { clonarPlantilla, ref } from '../dom';

/** El almuerzo se dibuja como un elemento más de la columna: amarillo y no transferible. */
export function crearVistaAlmuerzo(tecnico: Tecnico, enAlmuerzo: boolean, editable: boolean): HTMLElement {
  const fragmento = clonarPlantilla('tpl-almuerzo');
  const elemento = ref(fragmento, 'almuerzo');
  const { almuerzoInicio, almuerzoFin } = tecnico;
  const tieneHorario = almuerzoInicio !== null && almuerzoFin !== null;

  elemento.classList.toggle('is-active', enAlmuerzo);
  elemento.classList.toggle('is-empty', !tieneHorario);

  ref(fragmento, 'texto').textContent = enAlmuerzo
    ? `En almuerzo hasta las ${almuerzoFin}`
    : tieneHorario
      ? `Almuerzo ${almuerzoInicio} - ${almuerzoFin}`
      : 'Sin horario de almuerzo';

  const boton = ref(fragmento, 'botonEditar');
  if (editable) {
    const etiqueta = tieneHorario ? 'Editar horario de almuerzo' : 'Agregar horario de almuerzo';
    boton.title = etiqueta;
    boton.setAttribute('aria-label', etiqueta);
  } else {
    boton.remove();
  }

  return elemento;
}
