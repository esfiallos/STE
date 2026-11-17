import type { Incidente } from '../../types/noc';
import { clonarPlantilla, ref } from '../dom';

interface OpcionesVistaIncidente {
  posicion: number;
  coincideConBusqueda: boolean;
  /** Histórico: el comentario siempre se ve y no hay botón para desplegarlo. */
  notaFija: boolean;
  notaAbierta: boolean;
  arrastrable: boolean;
}

export function crearVistaIncidente(incidente: Incidente, opciones: OpcionesVistaIncidente): HTMLElement {
  const { posicion, coincideConBusqueda, notaFija, notaAbierta, arrastrable } = opciones;
  const fragmento = clonarPlantilla('tpl-incidente');
  const tarjeta = ref(fragmento, 'incidente');

  tarjeta.dataset.incidenteId = incidente.id;
  tarjeta.draggable = arrastrable;
  tarjeta.classList.toggle('is-match', coincideConBusqueda);
  ref(fragmento, 'indice').textContent = String(posicion);
  ref(fragmento, 'codigo').textContent = incidente.codigo;

  const botonNota = ref(fragmento, 'botonNota');
  const nota = ref(fragmento, 'nota');

  if (!incidente.nota) {
    botonNota.remove();
    nota.remove();
    return tarjeta;
  }

  const visible = notaFija || notaAbierta;
  nota.textContent = incidente.nota;
  nota.classList.toggle('hidden', !visible);

  if (notaFija) {
    botonNota.remove();
  } else {
    botonNota.setAttribute('aria-expanded', String(visible));
    botonNota.classList.toggle('is-active', visible);
    botonNota.title = visible ? 'Ocultar comentario' : 'Ver comentario';
  }

  return tarjeta;
}
