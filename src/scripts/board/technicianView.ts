import { describirAlmuerzo, estaEnAlmuerzo } from '../../domain/lunch';
import { incidenteCoincide } from '../../domain/search';
import { obtenerIniciales } from '../../domain/technicians';
import type { TecnicoConIncidentes } from '../../types/noc';
import { clonarPlantilla, crearElemento, ref } from '../dom';
import { crearVistaIncidente } from './incidentView';

interface OpcionesVistaTecnico {
  tecnico: TecnicoConIncidentes;
  termino: string;
  ahora: Date;
}

export function crearVistaTecnico({ tecnico, termino, ahora }: OpcionesVistaTecnico): HTMLElement {
  const fragmento = clonarPlantilla('tpl-tecnico');
  const tarjeta = ref(fragmento, 'tecnico');

  tarjeta.dataset.tecnicoId = tecnico.id;
  ref(fragmento, 'avatar').textContent = obtenerIniciales(tecnico.nombre);
  ref(fragmento, 'nombre').textContent = tecnico.nombre;
  ref(fragmento, 'conteo').textContent = `${tecnico.incidentes.length} caso(s)`;

  const pila = ref(fragmento, 'incidentes');
  if (tecnico.incidentes.length === 0) {
    pila.append(crearElemento('div', 'empty-incidents', 'Sin incidentes asignados'));
  } else {
    tecnico.incidentes.forEach((incidente, indice) => {
      pila.append(crearVistaIncidente(incidente, indice + 1, incidenteCoincide(incidente, termino)));
    });
  }

  const enAlmuerzo = estaEnAlmuerzo(tecnico, ahora);
  ref(fragmento, 'almuerzo').classList.toggle('lunch-active', enAlmuerzo);
  ref(fragmento, 'almuerzoEtiqueta').textContent = enAlmuerzo ? 'En almuerzo' : 'Horario de comida';
  ref(fragmento, 'almuerzoHorario').textContent = describirAlmuerzo(tecnico);

  return tarjeta;
}
