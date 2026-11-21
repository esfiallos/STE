/**
 * Pestaña "Panel" del coordinador: tickets del día operativo por estado y alertas por atender.
 * Las estadísticas se vuelven a leer cuando cambian los casos (Realtime → cargarDatos) mientras el panel está a la vista.
 */
import { alertasActivas, porcentaje } from '../../domain/coordination';
import { estadisticasDelDia } from '../../services/coordinacionRepo';
import { appStore } from '../../state/appStore';
import type { EstadoCaso, Incidente } from '../../types/noc';
import { byId, crearElemento } from '../dom';
import { formatearFechaLarga } from '../ui/format';
import { abrirAlertaPulsada, crearBotonDeAlerta } from './alertsBell';

const ESPERA_RECARGA_MS = 500;
const ESTADOS: EstadoCaso[] = ['en_curso', 'pausado', 'resuelto', 'cerrado'];

let consulta = 0;
let temporizador: number | undefined;
let ultimosCasos: Incidente[] | null = null;

function pintarEstado(texto: string | null, esError = false): void {
  const estado = byId('coordStatus');
  estado.textContent = texto ?? '';
  estado.classList.toggle('hidden', !texto);
  estado.classList.toggle('form-error', esError);
}

/** Lee y dibuja las estadísticas del día operativo en curso. */
export async function cargarPanel(): Promise<void> {
  const fecha = appStore.get().fechaOperativa;
  if (!fecha) return;
  const numero = ++consulta;
  byId('coordDate').textContent = `Día operativo ${formatearFechaLarga(fecha)} (06:00 a 06:00)`;
  const resultado = await estadisticasDelDia(fecha);
  if (numero !== consulta) return;
  if (!resultado.ok) {
    pintarEstado(resultado.error, true);
    return;
  }
  pintarEstado(null);
  const { total, porEstado } = resultado.data;
  const raiz = byId('coordStats');
  raiz.querySelector('[data-stat="total"]')!.textContent = String(total);
  for (const estado of ESTADOS) {
    raiz.querySelector(`[data-stat="${estado}"]`)!.textContent = String(porEstado[estado]);
    raiz.querySelector<HTMLElement>(`[data-barra="${estado}"]`)!.style.width = `${porcentaje(porEstado[estado], total)}%`;
  }
}

function pintarAlertas(): void {
  const activas = alertasActivas(appStore.get().alertas);
  byId('coordAlerts').replaceChildren(
    ...(activas.length === 0
      ? [crearElemento('li', 'notif__empty', 'Sin alertas: todos los casos tienen actualización reciente.')]
      : activas.map((a) => {
          const item = crearElemento('li', 'coord-alerts__item');
          item.append(crearBotonDeAlerta(a));
          return item;
        }))
  );
  const insignia = byId('panelBadge');
  insignia.textContent = String(activas.length);
  insignia.classList.toggle('hidden', activas.length === 0);
}

export function iniciarPanelDeCoordinacion(): void {
  byId('btnCoordRefresh').addEventListener('click', () => void cargarPanel());
  byId('coordAlerts').addEventListener('click', abrirAlertaPulsada);

  appStore.subscribe(() => {
    pintarAlertas();
    const { casosAbiertos, vista } = appStore.get();
    if (vista === 'panel' && casosAbiertos !== ultimosCasos) {
      ultimosCasos = casosAbiertos;
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(() => void cargarPanel(), ESPERA_RECARGA_MS);
    }
  });
  pintarAlertas();
}
