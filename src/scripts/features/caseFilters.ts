import { AREAS_DE_CASO } from '../../domain/areas';
import {
  conteoPorTipo,
  cuantosFiltros,
  ETIQUETA_ATRASO,
  FILTROS_DE_ATRASO,
  filtrarCasos,
  filtrosDesdeTexto,
  FILTROS_VACIOS,
  SIN_AREA,
  type CampoDeFiltro,
  type CasoFiltrable,
  type FiltrosDeCasos
} from '../../domain/caseFilters';
import { ETIQUETA_TIPO, TIPOS_DE_CASO } from '../../domain/caseType';
import { ESTADOS_DE_SEGUIMIENTO } from '../../domain/followUp';
import { ETIQUETA_ESTADO_CASO } from '../../domain/handover';
import { crearElemento } from '../dom';

/**
 * Barra de filtros reutilizable (§11.11): chips de tipo con contador (FRESH · Tarea · Incidente · Otro) y listas
 * de técnico, área y estado, más "Limpiar". Cada vista elige qué campos ofrece y qué hace al cambiar.
 * Los filtros se recuerdan por vista en sessionStorage (si el navegador no deja, simplemente no se recuerdan).
 */
export interface OpcionesDeBarra {
  /** Clave para recordar los filtros de esta vista. */
  clave: string;
  /** Campos que se ofrecen, en orden ('tipo' se dibuja como chips). */
  campos: CampoDeFiltro[];
  /** Técnicos para la lista (se leen en cada `actualizar`). */
  tecnicos?: () => { id: string; nombre: string }[];
  /** Texto de la lista de técnicos ("Todos los técnicos", "Todos los receptores"…). */
  todosLosTecnicos?: string;
  alCambiar: (filtros: FiltrosDeCasos) => void;
}

export interface BarraDeFiltros {
  filtros(): FiltrosDeCasos;
  /** Recalcula contadores, opciones de técnico y el "Mostrando X de Y" con la lista completa de la vista. */
  actualizar(casos: readonly CasoFiltrable[]): void;
  limpiar(): void;
}

const prefijo = 'panel-noc:filtros:';

function leer(clave: string): FiltrosDeCasos {
  try {
    return filtrosDesdeTexto(window.sessionStorage.getItem(prefijo + clave));
  } catch {
    return { ...FILTROS_VACIOS };
  }
}

function guardar(clave: string, filtros: FiltrosDeCasos): void {
  try {
    window.sessionStorage.setItem(prefijo + clave, JSON.stringify(filtros));
  } catch {
    // Sin almacenamiento: los filtros valen mientras la página esté abierta.
  }
}

function lista(campo: CampoDeFiltro, titulo: string, opciones: [string, string][]): HTMLSelectElement {
  const select = crearElemento('select', 'case-filters__select');
  select.dataset.filtro = campo;
  select.setAttribute('aria-label', titulo);
  select.append(...opciones.map(([valor, texto]) => new Option(texto, valor)));
  return select;
}

export function crearBarraDeFiltros(contenedor: HTMLElement, opciones: OpcionesDeBarra): BarraDeFiltros {
  let filtros = leer(opciones.clave);
  let ultimos: readonly CasoFiltrable[] = [];

  contenedor.classList.add('case-filters');
  contenedor.setAttribute('role', 'group');
  contenedor.setAttribute('aria-label', 'Filtros');

  const chips = crearElemento('div', 'case-filters__chips');
  chips.setAttribute('role', 'radiogroup');
  chips.setAttribute('aria-label', 'Tipo de caso');
  const listas = crearElemento('div', 'case-filters__lists');
  const resumen = crearElemento('span', 'case-filters__summary');
  resumen.setAttribute('aria-live', 'polite');
  const limpiarBoton = crearElemento('button', 'btn btn-sm case-filters__clear');
  limpiarBoton.type = 'button';

  const selects = new Map<CampoDeFiltro, HTMLSelectElement>();
  for (const campo of opciones.campos) {
    if (campo === 'tecnico') selects.set(campo, lista('tecnico', 'Filtrar por técnico', [['', opciones.todosLosTecnicos ?? 'Todos los técnicos']]));
    if (campo === 'area') {
      selects.set(campo, lista('area', 'Filtrar por área', [['', 'Todas las áreas'], ...AREAS_DE_CASO.map((a): [string, string] => [a, a]), [SIN_AREA, 'Sin área']]));
    }
    if (campo === 'estado') {
      selects.set(campo, lista('estado', 'Filtrar por estado', [['', 'Todos los estados'], ...ESTADOS_DE_SEGUIMIENTO.map((e): [string, string] => [e, ETIQUETA_ESTADO_CASO[e]])]));
    }
    if (campo === 'atraso') {
      selects.set(campo, lista('atraso', 'Filtrar por tiempo sin actualizar', [['', 'Cualquier actualización'], ...FILTROS_DE_ATRASO.map((a): [string, string] => [a, ETIQUETA_ATRASO[a]])]));
    }
  }
  listas.append(...selects.values());
  contenedor.replaceChildren(...(opciones.campos.includes('tipo') ? [chips] : []), listas, resumen, limpiarBoton);

  const pintarTecnicos = () => {
    const select = selects.get('tecnico');
    if (!select || !opciones.tecnicos) return;
    const tecnicos = opciones.tecnicos();
    const firma = tecnicos.map((t) => t.id).join('|');
    if (select.dataset.firma !== firma) {
      select.dataset.firma = firma;
      select.replaceChildren(new Option(opciones.todosLosTecnicos ?? 'Todos los técnicos', ''), ...tecnicos.map((t) => new Option(t.nombre, t.id)));
    }
  };

  const pintar = () => {
    pintarTecnicos();
    for (const [campo, select] of selects) {
      select.value = filtros[campo];
      // Un valor que ya no existe (técnico que no trabaja hoy) vuelve a "todos"
      if (select.value !== filtros[campo]) {
        filtros = { ...filtros, [campo]: '' };
        select.value = '';
      }
      select.classList.toggle('is-active', !!filtros[campo]);
    }

    if (opciones.campos.includes('tipo')) {
      const conteo = conteoPorTipo(ultimos, filtros);
      chips.replaceChildren(
        ...(['', ...TIPOS_DE_CASO] as const)
          .filter((tipo) => tipo === '' || tipo !== 'OTRO' || conteo.OTRO > 0 || filtros.tipo === 'OTRO')
          .map((tipo) => {
            const chip = crearElemento('button', `case-chip case-chip--${tipo || 'todos'}`);
            chip.type = 'button';
            chip.dataset.tipo = tipo;
            chip.setAttribute('role', 'radio');
            chip.setAttribute('aria-checked', String(filtros.tipo === tipo));
            chip.classList.toggle('is-selected', filtros.tipo === tipo);
            chip.append(crearElemento('span', '', tipo ? ETIQUETA_TIPO[tipo] : 'Todos'), crearElemento('span', 'case-chip__count', String(conteo[tipo])));
            return chip;
          })
      );
    }

    const activos = cuantosFiltros(filtros);
    limpiarBoton.textContent = `Limpiar (${activos})`;
    limpiarBoton.classList.toggle('hidden', activos === 0);
    const visibles = filtrarCasos(ultimos, filtros).length;
    resumen.textContent = activos > 0 ? `Mostrando ${visibles} de ${ultimos.length}` : '';
  };

  const cambiar = (nuevos: FiltrosDeCasos) => {
    filtros = nuevos;
    guardar(opciones.clave, filtros);
    pintar();
    opciones.alCambiar(filtros);
  };

  listas.addEventListener('change', (evento) => {
    const select = evento.target instanceof HTMLSelectElement ? evento.target : null;
    const campo = select?.dataset.filtro as CampoDeFiltro | undefined;
    if (select && campo) cambiar({ ...filtros, [campo]: select.value });
  });
  chips.addEventListener('click', (evento) => {
    const chip = evento.target instanceof Element ? evento.target.closest<HTMLElement>('[data-tipo]') : null;
    if (!chip) return;
    const tipo = chip.dataset.tipo as FiltrosDeCasos['tipo'];
    cambiar({ ...filtros, tipo: filtros.tipo === tipo ? '' : tipo });
  });
  limpiarBoton.addEventListener('click', () => cambiar({ ...FILTROS_VACIOS }));

  pintar();

  return {
    filtros: () => filtros,
    actualizar: (casos) => {
      ultimos = casos;
      pintar();
    },
    limpiar: () => cambiar({ ...FILTROS_VACIOS })
  };
}
