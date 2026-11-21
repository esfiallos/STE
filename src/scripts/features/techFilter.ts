import { nombreDeTurno } from '../../domain/shifts';
import { appStore } from '../../state/appStore';
import { byId } from '../dom';

/** Firma de la lista para no reconstruir el <select> en cada cambio del store. */
let firmaAnterior = '';

function poblarOpciones(selector: HTMLSelectElement): void {
  const { tecnicos, filtroTecnico } = appStore.get();
  const firma = tecnicos.map((t) => `${t.id}:${t.turno}`).join('|');
  if (firma === firmaAnterior) return;
  firmaAnterior = firma;

  selector.replaceChildren(
    new Option('Todos los técnicos', ''),
    ...tecnicos.map((t) => new Option(`${t.nombre} · ${nombreDeTurno(t.turno)}`, t.id))
  );

  // Si el técnico filtrado ya no trabaja hoy, se vuelve a "todos".
  const sigue = tecnicos.some((t) => t.id === filtroTecnico);
  selector.value = sigue ? filtroTecnico : '';
  if (!sigue && filtroTecnico) appStore.set({ filtroTecnico: '' });
}

/** Filtro del tablero por técnico: muestra solo su columna (en todos los turnos donde aparece). */
export function iniciarFiltroPorTecnico(): void {
  const selector = byId<HTMLSelectElement>('filterTech');
  firmaAnterior = '';

  selector.addEventListener('change', () => appStore.set({ filtroTecnico: selector.value }));
  appStore.subscribe(() => poblarOpciones(selector));
  poblarOpciones(selector);
}
