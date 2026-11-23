import { ETIQUETA_ESTADO_CASO } from '../../domain/handover';
import type { Incidente } from '../../types/noc';
import { clonarPlantilla, ref } from '../dom';
import { pintarTipo } from '../ui/tipoDeCaso';

interface OpcionesVistaIncidente {
  posicion: number;
  coincideConBusqueda: boolean;
  /** Histórico: el comentario siempre se ve y no hay botón para desplegarlo. */
  notaFija: boolean;
  notaAbierta: boolean;
  arrastrable: boolean;
  /** Editar y cancelar (solo en el tablero vivo; no en "Por reasignar" ni en el historial). */
  conAcciones: boolean;
}

export function crearVistaIncidente(incidente: Incidente, opciones: OpcionesVistaIncidente): HTMLElement {
  const { posicion, coincideConBusqueda, notaFija, notaAbierta, arrastrable, conAcciones } = opciones;
  const fragmento = clonarPlantilla('tpl-incidente');
  const tarjeta = ref(fragmento, 'incidente');
  const cerrado = incidente.estado === 'cerrado';

  tarjeta.dataset.incidenteId = incidente.id;
  tarjeta.draggable = arrastrable;
  tarjeta.classList.toggle('is-match', coincideConBusqueda);
  tarjeta.classList.toggle('is-closed', cerrado);
  ref(fragmento, 'indice').textContent = String(posicion);
  ref(fragmento, 'codigo').textContent = incidente.codigo;
  pintarTipo(ref(fragmento, 'tipo'), incidente.codigo);

  const empresa = ref(fragmento, 'empresa');
  if (incidente.cliente) empresa.textContent = incidente.cliente;
  else empresa.remove();

  // El estado solo se muestra cuando no es "En curso" (lo normal al asignar).
  const estado = ref(fragmento, 'estado');
  if (incidente.estado && incidente.estado !== 'en_curso') {
    estado.textContent = ETIQUETA_ESTADO_CASO[incidente.estado];
    estado.dataset.estado = incidente.estado;
  } else {
    estado.remove();
  }

  // Un caso cerrado ya no se edita ni se cancela: queda como registro del día.
  if (!conAcciones || cerrado) {
    ref(fragmento, 'botonEditar').remove();
    ref(fragmento, 'botonCancelar').remove();
  }

  const botonNota = ref(fragmento, 'botonNota');
  const nota = ref(fragmento, 'nota');

  // La nota es histórica (antes el dispatch dejaba un comentario); los casos nuevos traen empresa.
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
