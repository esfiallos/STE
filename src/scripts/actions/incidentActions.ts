import { describirNoDisponibilidad, estadoDelTecnico } from '../../domain/availability';
import { asignarCaso, cancelarCaso, crearCaso, editarCaso } from '../../services/casosRepo';
import { asignarARonda as asignarARondaEnBase, type AsignacionPorRonda } from '../../services/rondaRepo';
import { appStore } from '../../state/appStore';
import { cargarDatos } from '../../state/sync';
import { exito, type Resultado } from '../../types/result';
import { copiarAlPortapapeles } from '../ui/clipboard';
import { reproducirSonido } from '../ui/sound';
import { avisarSiFalla, mostrarAviso } from '../ui/toast';

export async function asignarIncidente(codigo: string, empresa: string, tecnicoId: string): Promise<Resultado> {
  const resultado = await crearCaso(codigo, empresa, tecnicoId);
  if (resultado.ok) {
    reproducirSonido('asignar');
    await cargarDatos();
  }
  return resultado;
}

/** Crea el caso y lo asigna al siguiente técnico de la ronda (lo decide la base de datos). */
export async function asignarIncidenteARonda(codigo: string, empresa: string): Promise<Resultado<AsignacionPorRonda>> {
  const resultado = await asignarARondaEnBase(codigo, empresa);
  if (resultado.ok) {
    reproducirSonido('asignar');
    mostrarAviso(`${codigo.trim().toUpperCase()} asignado por ronda a ${resultado.data.tecnicoNombre}.`, 'exito');
    await cargarDatos();
  }
  return resultado;
}

/** Cambia el responsable de un caso; con `reabrir`, además lo saca de "Cerrado". */
export async function reasignarIncidente(incidenteId: string, tecnicoId: string, reabrir = false): Promise<Resultado> {
  const resultado = await asignarCaso(incidenteId, tecnicoId, reabrir);
  if (resultado.ok) {
    reproducirSonido('asignar');
    await cargarDatos();
  }
  return resultado;
}

/** Reasignación por arrastre: sin formulario, así que los avisos se muestran aquí. */
export async function moverIncidente(incidenteId: string, tecnicoDestinoId: string): Promise<void> {
  const { incidentes, casosAbiertos, tecnicos, soloLectura } = appStore.get();
  if (soloLectura) return;

  // Del tablero del día, o de "Por reasignar" (casos abiertos de otro día)
  const incidente = incidentes.find((i) => i.id === incidenteId) ?? casosAbiertos.find((i) => i.id === incidenteId);
  const destino = tecnicos.find((t) => t.id === tecnicoDestinoId);
  if (!incidente || !destino || incidente.tecnicoId === tecnicoDestinoId) return;

  const estado = estadoDelTecnico(destino, new Date());
  if (estado !== 'disponible') {
    mostrarAviso(describirNoDisponibilidad(destino, estado), 'error');
    return;
  }

  avisarSiFalla(await reasignarIncidente(incidenteId, tecnicoDestinoId));
}

/** Corrección del dispatch (D26): código y empresa. */
export async function editarIncidente(incidenteId: string, codigo: string, empresa: string): Promise<Resultado> {
  const resultado = await editarCaso(incidenteId, codigo, empresa);
  if (resultado.ok) {
    await cargarDatos();
    mostrarAviso(`${codigo} actualizado.`, 'exito');
  }
  return resultado;
}

/** Cancela un caso asignado hoy por error (D25): deja de existir y su número queda libre. */
export async function cancelarIncidente(incidenteId: string, motivo: string): Promise<Resultado> {
  const resultado = await cancelarCaso(incidenteId, motivo);
  if (!resultado.ok) return resultado;
  await cargarDatos();
  mostrarAviso(`${resultado.data || 'Caso'} cancelado.`);
  return exito();
}

export async function copiarCodigo(codigo: string): Promise<void> {
  const copiado = await copiarAlPortapapeles(codigo);
  if (copiado) {
    reproducirSonido('copiar');
    mostrarAviso(`${codigo} copiado al portapapeles.`, 'exito');
  } else {
    mostrarAviso('No se pudo copiar. Selecciona el texto y usa Ctrl+C.', 'error');
  }
}
