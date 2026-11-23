import { appStore } from '../../state/appStore';
import { byId } from '../dom';
import { crearBarraDeFiltros } from './caseFilters';

/** Filtros del tablero por tipo, área y estado (§11.11). El de técnico sigue en techFilter.ts. */
export function iniciarFiltrosDelTablero(): void {
  const barra = crearBarraDeFiltros(byId('boardFilters'), {
    clave: 'tablero',
    campos: ['tipo', 'area', 'estado'],
    alCambiar: (filtrosTablero) => appStore.set({ filtrosTablero })
  });
  appStore.set({ filtrosTablero: barra.filtros() });

  let ultimos = appStore.get().incidentes;
  barra.actualizar(ultimos);
  appStore.subscribe(() => {
    const { incidentes } = appStore.get();
    if (incidentes === ultimos) return;
    ultimos = incidentes;
    barra.actualizar(incidentes);
  });
}
