import { tecnicoCoincide } from '../../domain/search';
import type { Turno } from '../../domain/shifts';
import type { TecnicoConIncidentes } from '../../types/noc';
import { clonarPlantilla, crearElemento, ref } from '../dom';
import type { ContextoTablero } from './boardContext';
import { crearVistaTecnico } from './technicianView';

const plural = (cantidad: number, singular: string, pluralTexto: string) =>
  `${cantidad} ${cantidad === 1 ? singular : pluralTexto}`;

export function crearVistaTurno(
  turno: Turno,
  tecnicos: TecnicoConIncidentes[],
  contexto: ContextoTablero,
  colapsadoPorUsuario: boolean
): HTMLElement {
  const fragmento = clonarPlantilla('tpl-turno');
  const seccion = ref(fragmento, 'turno');

  // Al buscar se ignora el colapso para que los resultados siempre se vean.
  const colapsado = colapsadoPorUsuario && contexto.termino === '';
  const casos = tecnicos.reduce((total, t) => total + t.incidentes.length, 0);

  seccion.dataset.turnoId = turno.id;
  ref(fragmento, 'encabezado').setAttribute('aria-expanded', String(!colapsado));
  ref(fragmento, 'chevron').className = `fa-solid fa-chevron-${colapsado ? 'right' : 'down'}`;
  ref(fragmento, 'titulo').textContent = turno.nombre;
  ref(fragmento, 'horarioTurno').textContent = `${turno.inicio} - ${turno.fin}`;
  ref(fragmento, 'badgeTecnicos').textContent = plural(tecnicos.length, 'técnico', 'técnicos');
  ref(fragmento, 'casos').textContent = plural(casos, 'caso', 'casos');

  const cuerpo = ref(fragmento, 'cuerpo');
  if (colapsado) {
    cuerpo.remove();
    return seccion;
  }

  const visibles = tecnicos.filter((t) => tecnicoCoincide(t, contexto.termino));
  if (tecnicos.length === 0) {
    cuerpo.append(crearElemento('div', 'empty-tech-notice', 'Sin técnicos en este turno.'));
  } else if (visibles.length === 0) {
    cuerpo.append(crearElemento('div', 'empty-tech-notice', 'Sin coincidencias en este turno.'));
  } else {
    visibles.forEach((tecnico) => cuerpo.append(crearVistaTecnico(tecnico, turno.id, contexto)));
  }

  return seccion;
}
