import { alertasHermanas } from '../../domain/coordination';
import { listarAlertas, marcarAlertasLeidas } from '../../services/coordinacionRepo';
import { appStore } from '../../state/appStore';
import type { AlertaCoordinacion } from '../../types/noc';
import { mostrarAviso } from '../ui/toast';

export async function cargarAlertas(): Promise<void> {
  const resultado = await listarAlertas();
  if (resultado.ok) appStore.set({ alertas: resultado.data });
  else mostrarAviso(resultado.error, 'error');
}

/** Marca como atendidas (leídas) las alertas indicadas: primero en pantalla, luego en la base. */
export async function atenderAlertas(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const marcar = new Set(ids);
  appStore.set({ alertas: appStore.get().alertas.map((a) => (marcar.has(a.id) ? { ...a, leida: true } : a)) });
  const resultado = await marcarAlertasLeidas(ids);
  if (!resultado.ok) {
    mostrarAviso(resultado.error, 'error');
    await cargarAlertas();
  }
}

/** Atiende una alerta junto con las demás no leídas del mismo caso (2 h, 4 h…). */
export function atenderAlerta(alerta: AlertaCoordinacion): Promise<void> {
  return atenderAlertas(alertasHermanas(appStore.get().alertas, alerta));
}

export function atenderTodas(): Promise<void> {
  return atenderAlertas(appStore.get().alertas.filter((a) => !a.leida).map((a) => a.id));
}

/** Código del caso de una alerta ("INC100: VM 10:00" → "INC100"). */
export const codigoDeAlerta = (alerta: AlertaCoordinacion) => (alerta.detalle ?? '').split(':')[0]!.trim();
