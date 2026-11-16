import { tecnicoCoincide } from '../../domain/search';
import type { Turno } from '../../domain/shifts';
import type { TecnicoConIncidentes } from '../../types/noc';
import { clonarPlantilla, crearElemento, ref } from '../dom';
import { crearVistaTecnico } from './technicianView';

interface OpcionesVistaTurno {
  turno: Turno;
  tecnicos: TecnicoConIncidentes[];
  termino: string;
  colapsadoPorUsuario: boolean;
  enCurso: boolean;
  ahora: Date;
}

const plural = (cantidad: number, singular: string, pluralTexto: string) =>
  `${cantidad} ${cantidad === 1 ? singular : pluralTexto}`;

export function crearVistaTurno(opciones: OpcionesVistaTurno): HTMLElement {
  const { turno, tecnicos, termino, colapsadoPorUsuario, enCurso, ahora } = opciones;
  const fragmento = clonarPlantilla('tpl-turno');
  const seccion = ref(fragmento, 'turno');

  // Al buscar se ignora el colapso para que los resultados siempre se vean.
  const colapsado = colapsadoPorUsuario && termino === '';
  const casos = tecnicos.reduce((total, t) => total + t.incidentes.length, 0);

  seccion.dataset.turnoId = turno.id;
  ref(fragmento, 'encabezado').setAttribute('aria-expanded', String(!colapsado));
  ref(fragmento, 'chevron').className = `fa-solid fa-chevron-${colapsado ? 'right' : 'down'} icon-blue`;
  ref(fragmento, 'titulo').textContent = turno.nombre;
  ref(fragmento, 'badgeTecnicos').textContent = plural(tecnicos.length, 'técnico', 'técnicos');
  ref(fragmento, 'badgeEnTurno').classList.toggle('hidden', !enCurso);
  ref(fragmento, 'casos').textContent = plural(casos, 'caso', 'casos');

  const cuerpo = ref(fragmento, 'cuerpo');
  if (colapsado) {
    cuerpo.remove();
    return seccion;
  }

  const visibles = tecnicos.filter((t) => tecnicoCoincide(t, termino));
  if (tecnicos.length === 0) {
    cuerpo.append(crearElemento('div', 'empty-tech-notice', 'Sin técnicos en este turno. Agrégalos desde «Técnicos».'));
  } else if (visibles.length === 0) {
    cuerpo.append(crearElemento('div', 'empty-tech-notice', 'Sin coincidencias en este turno.'));
  } else {
    visibles.forEach((tecnico) => cuerpo.append(crearVistaTecnico({ tecnico, termino, ahora })));
  }

  return seccion;
}
