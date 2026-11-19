import { describirNoDisponibilidad, estadoDelTecnico } from '../../domain/availability';
import { asignarCaso, cerrarCaso, crearCaso } from '../../services/casosRepo';
import { appStore } from '../../state/appStore';
import { cargarDatos } from '../../state/sync';
import type { Resultado } from '../../types/result';
import { copiarAlPortapapeles } from '../ui/clipboard';
import { reproducirSonido } from '../ui/sound';
import { avisarSiFalla, mostrarAviso } from '../ui/toast';

export async function asignarIncidente(codigo: string, nota: string, tecnicoId: string): Promise<Resultado> {
  const resultado = await crearCaso(codigo, nota, tecnicoId);
  if (resultado.ok) {
    reproducirSonido('asignar');
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
  const { incidentes, tecnicos, soloLectura } = appStore.get();
  if (soloLectura) return;

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

/** Los casos ya no se borran: se cierran y quedan en el historial y la búsqueda. */
export async function cerrarIncidente(incidenteId: string): Promise<void> {
  const incidente = appStore.get().incidentes.find((i) => i.id === incidenteId);

  if (!avisarSiFalla(await cerrarCaso(incidenteId))) return;

  await cargarDatos();
  mostrarAviso(`${incidente?.codigo ?? 'Caso'} cerrado.`);
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
