import { buscarIncidentePorCodigo, normalizarCodigo } from '../../domain/assignments';
import { describirNoDisponibilidad, estadoDelTecnico } from '../../domain/availability';
import { appStore } from '../../state/appStore';
import { falla, type Resultado } from '../../types/result';
import { asignarIncidente, reasignarIncidente } from '../actions/incidentActions';

/**
 * Reglas de asignar un INC a un técnico, comunes al formulario rápido de la tarjeta y al modal:
 * el técnico debe estar disponible y un INC no puede estar en dos técnicos a la vez
 * (si ya existe, se ofrece reasignarlo). Devuelve null si la persona cancela.
 */
export async function solicitarAsignacion(
  codigoEscrito: string,
  nota: string,
  tecnicoId: string
): Promise<Resultado | null> {
  const codigo = normalizarCodigo(codigoEscrito);
  if (!codigo) return falla('Indica el número de incidente.');

  const { tecnicos, incidentes } = appStore.get();
  const destino = tecnicos.find((t) => t.id === tecnicoId);
  if (!destino) return falla('Selecciona un técnico.');

  const estado = estadoDelTecnico(destino, new Date());
  if (estado !== 'disponible') return falla(describirNoDisponibilidad(destino, estado));

  const existente = buscarIncidentePorCodigo(incidentes, codigo);
  if (!existente) return asignarIncidente(codigo, nota, tecnicoId);

  if (existente.tecnicoId === tecnicoId) return falla(`${codigo} ya está asignado a ${destino.nombre}.`);

  const actual = tecnicos.find((t) => t.id === existente.tecnicoId);
  const confirmado = window.confirm(
    `${codigo} ya está asignado a ${actual?.nombre ?? 'otro técnico'}.\n¿Reasignarlo a ${destino.nombre}?`
  );
  return confirmado ? reasignarIncidente(existente.id, tecnicoId) : null;
}
