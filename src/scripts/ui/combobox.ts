import { filtrarOpciones, mismoTexto } from '../../domain/search';
import { crearElemento } from '../dom';
import { animarEntrada } from './animacion';

/**
 * Combobox reutilizable (D22). Mejora un `<input type="text">` existente: se escribe para filtrar, flechas +
 * Enter para elegir, Esc cierra; ofrece "Crear «texto»" si se permite y una opción para dejarlo vacío.
 * Al elegir, escribe el valor en el mismo input y dispara `input` y `change` (burbujean): los listeners que ya
 * escuchaban el campo siguen funcionando. Llamarlo otra vez sobre el mismo input no hace nada nuevo.
 */
export interface OpcionesCombobox {
  /** Opciones a ofrecer (se leen cada vez que se abre, por si cambian). */
  opciones: () => readonly string[];
  /** Permite usar un texto que no está en la lista ("Crear «…»"). */
  permitirCrear?: boolean;
  /** Se llama al crear un valor nuevo (p. ej. para recordarlo). */
  alCrear?: (valor: string) => void;
  /** Texto de la opción que deja el campo vacío; sin él no se ofrece. */
  vacio?: string;
}

interface Opcion {
  valor: string;
  texto: string;
  tipo: 'opcion' | 'crear' | 'vacio';
}

const mejorados = new WeakSet<HTMLInputElement>();
let secuencia = 0;

export function mejorarCombobox(input: HTMLInputElement, config: OpcionesCombobox): void {
  if (mejorados.has(input)) return;
  mejorados.add(input);

  const idLista = `combo-lista-${++secuencia}`;
  input.removeAttribute('list');
  input.autocomplete = 'off';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', idLista);
  input.classList.add('combo__input');

  let lista: HTMLElement | null = null;
  let opciones: Opcion[] = [];
  let activa = -1;
  let valorAlAbrir = '';
  /** Mientras se avisan los eventos de una elección propia, el listener de `input` no debe reabrir la lista. */
  let emitiendo = false;

  const calcular = (): Opcion[] => {
    const texto = input.value.trim();
    const todas = config.opciones();
    // Al abrir con un valor ya elegido se muestran todas, para poder cambiarlo sin borrar
    const filtradas = texto && texto !== valorAlAbrir ? filtrarOpciones(todas, texto) : [...todas];
    const resultado: Opcion[] = filtradas.map((o) => ({ valor: o, texto: o, tipo: 'opcion' }));
    if (config.permitirCrear && texto && !todas.some((o) => mismoTexto(o, texto))) {
      resultado.push({ valor: texto, texto: `Crear «${texto}»`, tipo: 'crear' });
    }
    if (config.vacio && valorAlAbrir) resultado.push({ valor: '', texto: config.vacio, tipo: 'vacio' });
    return resultado;
  };

  const dibujar = () => {
    if (!lista) return;
    opciones = calcular();
    if (activa >= opciones.length) activa = opciones.length - 1;
    if (opciones.length === 0) {
      lista.replaceChildren(crearElemento('li', 'combo__empty', 'Sin coincidencias'));
    } else {
      lista.replaceChildren(
        ...opciones.map((opcion, indice) => {
          const item = crearElemento('li', `combo__option combo__option--${opcion.tipo}`, opcion.texto);
          item.id = `${idLista}-${indice}`;
          item.setAttribute('role', 'option');
          item.dataset.indice = String(indice);
          const elegida = opcion.tipo === 'opcion' && mismoTexto(opcion.valor, valorAlAbrir);
          item.setAttribute('aria-selected', String(indice === activa || (activa < 0 && elegida)));
          item.classList.toggle('is-active', indice === activa);
          item.classList.toggle('is-chosen', elegida);
          return item;
        })
      );
    }
    if (activa >= 0) input.setAttribute('aria-activedescendant', `${idLista}-${activa}`);
    else input.removeAttribute('aria-activedescendant');
    lista.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
  };

  const posicionar = () => {
    if (!lista) return;
    const r = input.getBoundingClientRect();
    const alto = lista.offsetHeight || 220;
    const abajo = r.bottom + 4 + alto <= window.innerHeight;
    lista.style.left = `${r.left}px`;
    lista.style.minWidth = `${Math.max(r.width, 180)}px`;
    lista.style.top = `${abajo ? r.bottom + 4 : Math.max(8, r.top - 4 - alto)}px`;
  };

  const cerrar = () => {
    lista?.remove();
    lista = null;
    activa = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    window.removeEventListener('resize', cerrar);
    window.removeEventListener('scroll', posicionar, true);
  };

  const abrir = () => {
    if (lista || input.disabled || input.readOnly) return;
    valorAlAbrir = input.value.trim();
    activa = -1;
    lista = crearElemento('ul', 'combo__list');
    lista.id = idLista;
    lista.setAttribute('role', 'listbox');
    lista.addEventListener('mousedown', (evento) => evento.preventDefault()); // no quitar el foco al input
    lista.addEventListener('click', (evento) => {
      const item = evento.target instanceof Element ? evento.target.closest<HTMLElement>('[data-indice]') : null;
      if (item) elegir(Number(item.dataset.indice));
    });
    document.body.append(lista);
    input.setAttribute('aria-expanded', 'true');
    dibujar();
    posicionar();
    window.addEventListener('resize', cerrar);
    window.addEventListener('scroll', posicionar, true);
    void animarEntrada(lista, 'arriba');
  };

  const elegir = (indice: number) => {
    const opcion = opciones[indice];
    if (!opcion) return;
    // Si coincide con una opción existente salvo mayúsculas/acentos, se usa la forma de la lista
    const existente = config.opciones().find((o) => mismoTexto(o, opcion.valor));
    const valor = opcion.tipo === 'crear' && existente ? existente : opcion.valor;
    if (opcion.tipo === 'crear' && !existente) config.alCrear?.(valor);
    input.value = valor;
    cerrar();
    emitiendo = true;
    try {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      emitiendo = false;
    }
  };

  input.addEventListener('focus', abrir);
  input.addEventListener('click', abrir);
  input.addEventListener('input', () => {
    if (emitiendo) return;
    if (!lista) abrir();
    activa = input.value.trim() ? 0 : -1;
    dibujar();
  });
  input.addEventListener('keydown', (evento) => {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (!lista) abrir();
      const total = opciones.length;
      if (total === 0) return;
      activa = evento.key === 'ArrowDown' ? (activa + 1) % total : (activa - 1 + total) % total;
      dibujar();
    } else if (evento.key === 'Enter' && lista) {
      if (activa >= 0) {
        evento.preventDefault();
        evento.stopPropagation();
        elegir(activa);
      } else {
        cerrar();
      }
    } else if (evento.key === 'Escape' && lista) {
      evento.stopPropagation();
      input.value = valorAlAbrir;
      cerrar();
    } else if (evento.key === 'Tab') {
      cerrar();
    }
  });
  input.addEventListener('blur', () => {
    // Texto libre que no está en la lista: solo vale si se permite crear
    const texto = input.value.trim();
    if (texto && !config.permitirCrear && !config.opciones().some((o) => mismoTexto(o, texto))) input.value = valorAlAbrir;
    cerrar();
  });
}
