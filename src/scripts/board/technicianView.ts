import { describirNoDisponibilidad, estadoDelTecnico, ETIQUETA_ESTADO } from '../../domain/availability';
import { estaEnAlmuerzo } from '../../domain/lunch';
import { incidenteCoincide } from '../../domain/search';
import { horarioDelTecnico } from '../../domain/shifts';
import { obtenerIniciales } from '../../domain/technicians';
import type { TecnicoConIncidentes, TurnoId } from '../../types/noc';
import { clonarPlantilla, crearElemento, ref } from '../dom';
import type { ContextoTablero } from './boardContext';
import { crearVistaIncidente } from './incidentView';
import { crearVistaAlmuerzo } from './lunchView';

export function claveDeTarjeta(turnoId: TurnoId, tecnicoId: string): string {
  return `${turnoId}:${tecnicoId}`;
}

export function crearVistaTecnico(tecnico: TecnicoConIncidentes, turnoId: TurnoId, contexto: ContextoTablero): HTMLElement {
  const { modo, ahora, termino, notasAbiertas, claveFormulario, borrador } = contexto;
  const vivo = modo === 'vivo';
  const estado = vivo ? estadoDelTecnico(tecnico, ahora) : null;
  const clave = claveDeTarjeta(turnoId, tecnico.id);

  const fragmento = clonarPlantilla('tpl-tecnico');
  const tarjeta = ref(fragmento, 'tecnico');
  tarjeta.dataset.tecnicoId = tecnico.id;
  tarjeta.dataset.clave = clave;
  tarjeta.dataset.disponible = String(estado === 'disponible');
  if (estado) tarjeta.classList.add(`is-${estado}`);
  tarjeta.classList.toggle('is-mine', !!contexto.miTecnicoId && contexto.miTecnicoId === tecnico.id);

  ref(fragmento, 'avatar').textContent = obtenerIniciales(tecnico.nombre);
  ref(fragmento, 'nombre').textContent = tecnico.nombre;
  const cerrados = tecnico.incidentes.filter((i) => i.estado === 'cerrado').length;
  ref(fragmento, 'conteo').textContent =
    `${tecnico.incidentes.length} caso(s)` + (cerrados > 0 ? ` · ${cerrados} cerrado(s)` : '');

  // Etiqueta de estado (solo tablero vivo) y horario propio del comodín
  const etiquetaEstado = ref(fragmento, 'estado');
  if (estado) {
    etiquetaEstado.textContent = ETIQUETA_ESTADO[estado];
    etiquetaEstado.dataset.estado = estado;
  } else {
    etiquetaEstado.remove();
  }

  const etiquetaHorario = ref(fragmento, 'horario');
  const horario = horarioDelTecnico(tecnico);
  if (tecnico.turno === 'comodin' && horario) etiquetaHorario.textContent = `Comodín ${horario.inicio} - ${horario.fin}`;
  else etiquetaHorario.remove();

  // Botón "+" : deshabilitado (con el motivo) cuando el técnico no está disponible
  const botonAsignar = ref<HTMLButtonElement>(fragmento, 'botonAsignar');
  if (!vivo) {
    botonAsignar.remove();
  } else if (estado !== null && estado !== 'disponible') {
    botonAsignar.disabled = true;
    botonAsignar.title = describirNoDisponibilidad(tecnico, estado);
  }

  // Formulario de asignación rápida: el técnico y el turno ya se conocen, solo falta el INC
  const formulario = ref<HTMLFormElement>(fragmento, 'formAsignar');
  if (vivo && estado === 'disponible' && claveFormulario === clave) {
    if (borrador?.clave === clave) {
      formulario.querySelector<HTMLInputElement>('[name="codigo"]')!.value = borrador.codigo;
      formulario.querySelector<HTMLInputElement>('[name="empresa"]')!.value = borrador.empresa;
    }
  } else {
    formulario.remove();
  }

  // Incidentes + almuerzo (último elemento de la columna)
  const pila = ref(fragmento, 'incidentes');
  tecnico.incidentes.forEach((incidente, indice) => {
    pila.append(
      crearVistaIncidente(incidente, {
        posicion: indice + 1,
        coincideConBusqueda: incidenteCoincide(incidente, termino),
        notaFija: !vivo,
        notaAbierta: notasAbiertas.has(incidente.id),
        arrastrable: vivo && incidente.estado !== 'cerrado',
        conAcciones: vivo
      })
    );
  });
  if (tecnico.incidentes.length === 0) pila.append(crearElemento('div', 'empty-incidents', 'Sin incidentes asignados'));

  pila.append(crearVistaAlmuerzo(tecnico, vivo && estaEnAlmuerzo(tecnico, ahora), vivo));

  return tarjeta;
}
