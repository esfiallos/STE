import { describirAviso, novedadesDeAvisos, problemaDeAviso } from '../../domain/planningNotices';
import { fechaOperativa, sumarDias } from '../../domain/time';
import { avisarCambio, listarAvisos, marcarAvisosVistos } from '../../services/avisosPlanificacionRepo';
import { appStore } from '../../state/appStore';
import { falla, type Resultado } from '../../types/result';
import { reproducirSonido } from '../ui/sound';
import { mostrarAviso } from '../ui/toast';

/** Se leen los avisos de los últimos días (los más viejos ya no interesan). */
const DIAS_DE_HISTORIAL = 14;

let numeroDeCarga = 0;

/** Relee los avisos. Con `avisar`, coordinación recibe un aviso en pantalla de lo nuevo. */
export async function cargarAvisos(avisar = false): Promise<void> {
  const numero = ++numeroDeCarga;
  const resultado = await listarAvisos(sumarDias(fechaOperativa(new Date()), -DIAS_DE_HISTORIAL));
  if (numero !== numeroDeCarga) return;
  if (!resultado.ok) {
    mostrarAviso(resultado.error, 'error');
    return;
  }
  const { avisos: antes, perfil } = appStore.get();
  appStore.set({ avisos: resultado.data });
  if (!avisar) return;

  const novedades = novedadesDeAvisos(antes, resultado.data, perfil?.rol);
  for (const a of novedades) mostrarAviso(describirAviso(a), 'info');
  if (novedades.length > 0) reproducirSonido('notificacion');
}

/** El dispatch da el motivo de los cambios de un día (D38): no espera respuesta. */
export async function avisarCambioDeDia(fecha: string, motivo: string): Promise<Resultado> {
  const problema = problemaDeAviso(fecha, motivo, fechaOperativa(new Date()));
  if (problema) return falla(problema);
  const resultado = await avisarCambio(fecha, motivo);
  if (resultado.ok) await cargarAvisos();
  return resultado;
}

/** Coordinación vio estos avisos: primero en pantalla, luego en la base. */
export async function marcarVistos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const marcar = new Set(ids);
  appStore.set({ avisos: appStore.get().avisos.map((a) => (marcar.has(a.id) ? { ...a, visto: true } : a)) });
  const resultado = await marcarAvisosVistos(ids);
  if (!resultado.ok) {
    mostrarAviso(resultado.error, 'error');
    await cargarAvisos();
  }
}
