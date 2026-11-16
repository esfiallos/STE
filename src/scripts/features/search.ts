import { incidenteCoincide, normalizarBusqueda } from '../../domain/search';
import { appStore } from '../../state/appStore';
import { copiarCodigo } from '../actions/incidentActions';
import { byId } from '../dom';

/** Enter con un único incidente encontrado: copia su número. */
function copiarCoincidenciaUnica(): void {
  const { busqueda, incidentes } = appStore.get();
  const termino = normalizarBusqueda(busqueda);
  if (!termino) return;

  const coincidencias = incidentes.filter((incidente) => incidenteCoincide(incidente, termino));
  const unica = coincidencias.length === 1 ? coincidencias[0] : undefined;
  if (unica) void copiarCodigo(unica.codigo);
}

export function iniciarBuscador(): void {
  const campo = byId<HTMLInputElement>('searchInput');

  campo.addEventListener('input', () => appStore.set({ busqueda: campo.value }));
  campo.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') copiarCoincidenciaUnica();
    if (evento.key === 'Escape') {
      campo.value = '';
      appStore.set({ busqueda: '' });
    }
  });
}
