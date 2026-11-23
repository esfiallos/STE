/**
 * Pestaña "Panel" del coordinador: tickets del día operativo por estado y alertas por atender.
 * Las estadísticas se vuelven a leer cuando cambian los casos (Realtime → cargarDatos) mientras el panel está a la vista.
 */
import { alertasActivas, porcentaje, resumirEstadisticas, type EstadisticasDelDia } from '../../domain/coordination';
import { estadisticasDelDia } from '../../services/coordinacionRepo';
import { appStore } from '../../state/appStore';
import type { AlertaCoordinacion, EstadoCaso, Incidente } from '../../types/noc';
import { byId, crearElemento } from '../dom';
import { formatearFechaLarga } from '../ui/format';
import { abrirAlertaPulsada, crearBotonDeAlerta } from './alertsBell';
import { cumpleFiltros, filtrarCasos, hayFiltros, type FiltrosDeCasos } from '../../domain/caseFilters';
import { crearBarraDeFiltros, type BarraDeFiltros } from '../features/caseFilters';

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

let barra: BarraDeFiltros | null = null;

/**
 * Estadísticas filtradas: se calculan con el tablero del día que ya tiene la app (mismo criterio D16/D17 que
 * estadisticas_del_dia), así no hace falta otra consulta por cada combinación de filtros.
 */
function estadisticasFiltradas(filtros: FiltrosDeCasos): EstadisticasDelDia {
  const conteo = new Map<EstadoCaso, number>();
  for (const c of filtrarCasos(appStore.get().incidentes, filtros)) conteo.set(c.estado ?? 'en_curso', (conteo.get(c.estado ?? 'en_curso') ?? 0) + 1);
  return resumirEstadisticas([...conteo].map(([estado, total]) => ({ estado, total })));
}

/** Lee y dibuja las estadísticas del día operativo en curso. */
export async function cargarPanel(): Promise<void> {
  const fecha = appStore.get().fechaOperativa;
  if (!fecha) return;
  const numero = ++consulta;
  byId('coordDate').textContent = `Día operativo ${formatearFechaLarga(fecha)} (06:00 a 06:00)`;
  barra?.actualizar(appStore.get().incidentes);
  const filtros = barra?.filtros();
  let datos: EstadisticasDelDia;
  if (filtros && hayFiltros(filtros)) {
    datos = estadisticasFiltradas(filtros);
  } else {
    const resultado = await estadisticasDelDia(fecha);
    if (numero !== consulta) return;
    if (!resultado.ok) {
      pintarEstado(resultado.error, true);
      return;
    }
    datos = resultado.data;
  }
  pintarEstado(null);
  const { total, porEstado } = datos;
  const raiz = byId('coordStats');
  raiz.querySelector('[data-stat="total"]')!.textContent = String(total);
  for (const estado of ESTADOS) {
    raiz.querySelector(`[data-stat="${estado}"]`)!.textContent = String(porEstado[estado]);
    raiz.querySelector<HTMLElement>(`[data-barra="${estado}"]`)!.style.width = `${porcentaje(porEstado[estado], total)}%`;
  }
}

/** Una alerta pasa los filtros si su caso (o, si ya no está abierto, su técnico y código) los cumple. */
function alertaVisible(alerta: AlertaCoordinacion, filtros: FiltrosDeCasos | undefined): boolean {
  if (!filtros || !hayFiltros(filtros)) return true;
  const caso = appStore.get().casosAbiertos.find((c) => c.id === alerta.casoId);
  return cumpleFiltros(caso ?? { codigo: (alerta.detalle ?? '').split(' ')[0] ?? '', tecnicoId: alerta.tecnicoId }, filtros);
}

function pintarAlertas(): void {
  const todas = alertasActivas(appStore.get().alertas);
  const activas = todas.filter((a) => alertaVisible(a, barra?.filtros()));
  byId('coordAlerts').replaceChildren(
    ...(activas.length === 0
      ? [crearElemento('li', 'notif__empty', 'Sin alertas: todos los casos tienen actualización reciente.')]
      : activas.map((a) => {
          const item = crearElemento('li', 'coord-alerts__item');
          item.append(crearBotonDeAlerta(a));
          return item;
        }))
  );
  // La insignia de la pestaña cuenta todas las alertas, no solo las filtradas.
  const insignia = byId('panelBadge');
  insignia.textContent = String(todas.length);
  insignia.classList.toggle('hidden', todas.length === 0);
}

export function iniciarPanelDeCoordinacion(): void {
  barra = crearBarraDeFiltros(byId('coordFilters'), {
    clave: 'panel',
    campos: ['tipo', 'area', 'estado', 'tecnico'],
    tecnicos: () => appStore.get().tecnicos.map((t) => ({ id: t.id, nombre: t.nombre })),
    alCambiar: () => {
      pintarAlertas();
      void cargarPanel();
    }
  });
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
