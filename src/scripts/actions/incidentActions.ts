import { describirNoDisponibilidad, estadoDelTecnico } from '../../domain/availability';
import {
  actualizarTecnicoDeIncidente,
  borrarIncidente,
  crearIncidente
} from '../../services/incidentesRepo';
import { appStore } from '../../state/appStore';
import { cargarDatos } from '../../state/sync';
import type { Resultado } from '../../types/result';
import { copiarAlPortapapeles } from '../ui/clipboard';
import { reproducirSonido } from '../ui/sound';
import { avisarSiFalla, mostrarAviso } from '../ui/toast';

export async function asignarIncidente(codigo: string, nota: string, tecnicoId: string): Promise<Resultado> {
  const resultado = await crearIncidente(codigo, nota, tecnicoId);
  if (resultado.ok) {
    reproducirSonido('asignar');
    await cargarDatos();
  }
  return resultado;
}

export async function reasignarIncidente(incidenteId: string, tecnicoId: string): Promise<Resultado> {
  const resultado = await actualizarTecnicoDeIncidente(incidenteId, tecnicoId);
  if (resultado.ok) {
    reproducirSonido('asignar');
    await cargarDatos();
  }
  return resultado;
}

/** Reasignación por arrastre: sin formulario, así que los avisos se muestran aquí. */
export async function moverIncidente(incidenteId: string, tecnicoDestinoId: string): Promise<void> {
  const { incidentes, tecnicos } = appStore.get();
  const incidente = incidentes.find((i) => i.id === incidenteId);
  const destino = tecnicos.find((t) => t.id === tecnicoDestinoId);
  if (!incidente || !destino || incidente.tecnicoId === tecnicoDestinoId) return;

  const estado = estadoDelTecnico(destino, new Date());
  if (estado !== 'disponible') {
    mostrarAviso(describirNoDisponibilidad(destino, estado), 'error');
    return;
  }

  avisarSiFalla(await reasignarIncidente(incidenteId, tecnicoDestinoId));
}

export async function quitarIncidente(incidenteId: string): Promise<void> {
  const incidente = appStore.get().incidentes.find((i) => i.id === incidenteId);

  if (!avisarSiFalla(await borrarIncidente(incidenteId))) return;

  await cargarDatos();
  mostrarAviso(`${incidente?.codigo ?? 'Incidente'} eliminado.`);
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
