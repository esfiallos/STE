import { actualizarAlmuerzo, borrarJornada, guardarJornadas, type JornadaPlanificada } from '../../services/jornadasRepo';
import { cambiarActivo, crearTecnico } from '../../services/tecnicosRepo';
import { cargarDatos } from '../../state/sync';
import type { Hora } from '../../types/noc';
import type { Resultado } from '../../types/result';
import { reproducirSonido } from '../ui/sound';
import { avisarSiFalla, mostrarAviso } from '../ui/toast';

export async function agregarTecnico(nombre: string): Promise<Resultado> {
  const resultado = await crearTecnico(nombre);
  if (resultado.ok) await cargarDatos();
  return resultado;
}

/** Desactivar no borra nada: el técnico deja de aparecer en la planificación y conserva su historial. */
export async function cambiarActivoTecnico(tecnicoId: string, nombre: string, activo: boolean): Promise<void> {
  if (!avisarSiFalla(await cambiarActivo(tecnicoId, activo))) return;

  await cargarDatos();
  mostrarAviso(activo ? `${nombre} vuelve a estar activo.` : `${nombre} fue desactivado.`);
}

export async function guardarHorarioDeAlmuerzo(jornadaId: string, inicio: Hora, fin: Hora): Promise<Resultado> {
  const resultado = await actualizarAlmuerzo(jornadaId, inicio, fin);
  if (resultado.ok) {
    reproducirSonido('almuerzo');
    await cargarDatos();
  }
  return resultado;
}

export async function limpiarHorarioDeAlmuerzo(jornadaId: string): Promise<Resultado> {
  const resultado = await actualizarAlmuerzo(jornadaId, null, null);
  if (resultado.ok) await cargarDatos();
  return resultado;
}

/** Guarda (crea o reemplaza) jornadas de la planificación. */
export async function planificarJornadas(jornadas: JornadaPlanificada[]): Promise<Resultado> {
  const resultado = await guardarJornadas(jornadas);
  if (resultado.ok) await cargarDatos();
  return resultado;
}

export async function quitarJornada(jornadaId: string): Promise<Resultado> {
  const resultado = await borrarJornada(jornadaId);
  if (resultado.ok) await cargarDatos();
  return resultado;
}
