import type { Incidente } from '../../types/noc';
import { clonarPlantilla, ref } from '../dom';

export function crearVistaIncidente(incidente: Incidente, posicion: number, coincideConBusqueda: boolean): HTMLElement {
  const fragmento = clonarPlantilla('tpl-incidente');
  const tarjeta = ref(fragmento, 'incidente');

  tarjeta.dataset.incidenteId = incidente.id;
  tarjeta.classList.toggle('is-match', coincideConBusqueda);
  ref(fragmento, 'indice').textContent = String(posicion);
  ref(fragmento, 'codigo').textContent = incidente.codigo;

  const nota = ref(fragmento, 'nota');
  if (incidente.nota) nota.textContent = incidente.nota;
  else nota.remove();

  return tarjeta;
}
