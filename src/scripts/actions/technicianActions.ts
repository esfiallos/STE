import { actualizarAlmuerzo, borrarTecnico, crearTecnico } from '../../services/tecnicosRepo';
import { cargarDatos } from '../../state/sync';
import type { Hora, TurnoId } from '../../types/noc';
import type { Resultado } from '../../types/result';
import { reproducirSonido } from '../ui/sound';
import { avisarSiFalla, mostrarAviso } from '../ui/toast';

export async function agregarTecnico(nombre: string, turno: TurnoId): Promise<Resultado> {
  const resultado = await crearTecnico(nombre, turno);
  if (resultado.ok) await cargarDatos();
  return resultado;
}

/** Elimina al técnico y, por cascada en la base de datos, los incidentes que tenía asignados. */
export async function quitarTecnico(tecnicoId: string, nombre: string): Promise<void> {
  if (!avisarSiFalla(await borrarTecnico(tecnicoId))) return;

  await cargarDatos();
  mostrarAviso(`${nombre} fue eliminado.`);
}

export async function guardarHorarioDeAlmuerzo(tecnicoId: string, inicio: Hora, fin: Hora): Promise<Resultado> {
  const resultado = await actualizarAlmuerzo(tecnicoId, inicio, fin);
  if (resultado.ok) {
    reproducirSonido('almuerzo');
    await cargarDatos();
  }
  return resultado;
}

export async function limpiarHorarioDeAlmuerzo(tecnicoId: string): Promise<Resultado> {
  const resultado = await actualizarAlmuerzo(tecnicoId, null, null);
  if (resultado.ok) await cargarDatos();
  return resultado;
}
