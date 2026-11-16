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

/** Reasignación por arrastre: sin formulario, así que los errores se avisan aquí. */
export async function moverIncidente(incidenteId: string, tecnicoDestinoId: string): Promise<void> {
  const incidente = appStore.get().incidentes.find((i) => i.id === incidenteId);
  if (!incidente || incidente.tecnicoId === tecnicoDestinoId) return;

  avisarSiFalla(await reasignarIncidente(incidenteId, tecnicoDestinoId));
}

export async function quitarIncidente(incidenteId: string): Promise<void> {
  const incidente = appStore.get().incidentes.find((i) => i.id === incidenteId);

  const resultado = await borrarIncidente(incidenteId);
  if (!avisarSiFalla(resultado)) return;

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
