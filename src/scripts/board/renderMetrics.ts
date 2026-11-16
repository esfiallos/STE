import { unirTecnicosConIncidentes } from '../../domain/assignments';
import { calcularMetricas } from '../../domain/metrics';
import { appStore } from '../../state/appStore';
import { byId } from '../dom';

export function renderizarMetricas(): void {
  const { tecnicos, incidentes } = appStore.get();
  const metricas = calcularMetricas(unirTecnicosConIncidentes(tecnicos, incidentes), new Date());

  byId('statTotalIncidents').textContent = String(metricas.casosActivos);
  byId('statActiveTechs').textContent = String(metricas.tecnicosEnTurno);
  byId('statInLunchTechs').textContent = String(metricas.almuerzosActivos);
}
