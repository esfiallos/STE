import { buscarIncidentePorCodigo, normalizarCodigo } from '../../domain/assignments';
import { describirNoDisponibilidad, estadoDelTecnico } from '../../domain/availability';
import { buscarCasoPorCodigo } from '../../services/casosRepo';
import { appStore } from '../../state/appStore';
import { falla, type Resultado } from '../../types/result';
import { asignarIncidente, reasignarIncidente } from '../actions/incidentActions';

const nombreDe = (tecnicoId: string | null): string =>
  appStore.get().catalogo.find((t) => t.id === tecnicoId)?.nombre ?? 'sin responsable';

/**
 * Reglas de asignar un caso a un técnico, comunes al formulario rápido de la tarjeta y al modal:
 * el técnico debe estar disponible y un caso no puede estar en dos técnicos a la vez
 * (si ya existe, se ofrece reasignarlo; si estaba cerrado, reabrirlo). Devuelve null si la persona cancela.
 */
export async function solicitarAsignacion(
  codigoEscrito: string,
  empresa: string,
  tecnicoId: string
): Promise<Resultado | null> {
  const { tecnicos, incidentes, soloLectura } = appStore.get();
  if (soloLectura) return falla('No tienes permiso para asignar casos.');

  const codigo = normalizarCodigo(codigoEscrito);
  if (!codigo) return falla('Indica el número de incidente.');

  const destino = tecnicos.find((t) => t.id === tecnicoId);
  if (!destino) return falla('Selecciona un técnico.');

  const estado = estadoDelTecnico(destino, new Date());
  if (estado !== 'disponible') return falla(describirNoDisponibilidad(destino, estado));

  // 1. Ya está abierto en el tablero de hoy (uno cerrado se ofrece reabrir más abajo)
  const enTablero = buscarIncidentePorCodigo(incidentes, codigo);
  if (enTablero && enTablero.estado !== 'cerrado') {
    if (enTablero.tecnicoId === tecnicoId) return falla(`${codigo} ya está asignado a ${destino.nombre}.`);
    const confirmado = window.confirm(
      `${codigo} ya está asignado a ${nombreDe(enTablero.tecnicoId)}.\n¿Reasignarlo a ${destino.nombre}?`
    );
    return confirmado ? reasignarIncidente(enTablero.id, tecnicoId) : null;
  }

  // 2. Caso nuevo
  const creado = await asignarIncidente(codigo, empresa, tecnicoId);
  if (creado.ok || creado.motivo !== 'duplicado') return creado;

  // 3. Existe fuera del tablero de hoy: cerrado, o abierto con otro día/responsable
  const existente = await buscarCasoPorCodigo(codigo);
  if (!existente.ok) return existente;
  if (!existente.data) return creado;

  const { id, estado: estadoCaso, tecnicoId: actual } = existente.data;
  const cerrado = estadoCaso === 'cerrado';
  const pregunta = cerrado
    ? `${codigo} ya existe y está cerrado (último responsable: ${nombreDe(actual)}).\n¿Reabrirlo y asignarlo a ${destino.nombre}?`
    : `${codigo} ya existe y lo tiene ${nombreDe(actual)}.\n¿Reasignarlo a ${destino.nombre}?`;

  return window.confirm(pregunta) ? reasignarIncidente(id, tecnicoId, cerrado) : null;
}
