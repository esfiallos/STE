import { unirTecnicosConIncidentes } from '../../domain/assignments';
import { formatearFechaLocal } from '../../domain/time';
import { guardarSnapshot } from '../../services/snapshotsRepo';
import { appStore } from '../../state/appStore';
import { avisarSiFalla, mostrarAviso } from '../ui/toast';

/** Guarda la foto del tablero de hoy (una por día: guardar otra vez reemplaza la anterior). */
export async function guardarSnapshotDeHoy(): Promise<void> {
  const { tecnicos, incidentes } = appStore.get();
  const fecha = formatearFechaLocal(new Date());

  const resultado = await guardarSnapshot(fecha, unirTecnicosConIncidentes(tecnicos, incidentes));
  if (avisarSiFalla(resultado)) mostrarAviso(`Snapshot del ${fecha} guardado.`, 'exito');
}
