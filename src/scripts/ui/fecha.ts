import {
  chipsDeFecha,
  dentroDeLimites,
  describirDistancia,
  describirFechaCorta,
  interpretarFecha,
  nombreDelMes,
  semanasDelMes,
  sumarMeses,
  type DireccionDeFecha,
  type LimitesDeFecha
} from '../../domain/dateInput';
import { fechaOperativa, sumarDias } from '../../domain/time';
import { crearElemento } from '../dom';
import { animarEntrada, animarSacudida } from './animacion';

/**
 * Selector de fecha rápido (D24). Mejora un `<input type="date">` existente sin cambiar cómo se usa:
 * el input original queda oculto y sigue teniendo el valor ISO; al elegir se dispara su `change` (burbujea),
 * así los listeners actuales siguen funcionando. Se puede llamar otra vez sobre el mismo input (p. ej. tras
 * cambiar su valor por código) y solo actualiza lo que se ve.
 *
 * - Chips de un clic (Hoy, Mañana, días de la semana…) y mini calendario.
 * - Escritura rápida en el mismo campo: `m`, `+3`, `vie`, `25`, `25/11`… con vista previa antes de aceptar.
 * - ↑/↓ suman o restan un día; Enter acepta; Esc cierra.
 */
export interface OpcionesCampoDeFecha {
  /** Para qué lado ofrecer atajos: recordatorios → futuro; consultar un día → pasado. */
  direccion: DireccionDeFecha;
  /** Texto del campo vacío. */
  vacio?: string;
}

interface Estado {
  original: HTMLInputElement;
  texto: HTMLInputElement;
  opciones: OpcionesCampoDeFecha;
}

const estados = new WeakMap<HTMLInputElement, Estado>();

const hoy = () => fechaOperativa(new Date());
const limitesDe = (input: HTMLInputElement): LimitesDeFecha => ({ minimo: input.min || null, maximo: input.max || null });

function mostrarValor(estado: Estado): void {
  const { original, texto, opciones } = estado;
  texto.value = original.value ? `${describirFechaCorta(original.value, hoy())} · ${describirDistancia(original.value, hoy())}` : '';
  texto.placeholder = opciones.vacio ?? 'Elegir fecha';
  texto.disabled = original.disabled;
  texto.closest('.date-field')?.querySelector<HTMLButtonElement>('.date-field__toggle')?.toggleAttribute('disabled', original.disabled);
}

function aplicar(estado: Estado, fecha: string | null): void {
  const { original } = estado;
  const nuevo = fecha ?? '';
  if (original.value !== nuevo) {
    original.value = nuevo;
    original.dispatchEvent(new Event('input', { bubbles: true }));
    original.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (original.isConnected) mostrarValor(estado);
}

// ---------------------------------------------------------------------------
// Popover (uno a la vez)
// ---------------------------------------------------------------------------
let popover: HTMLElement | null = null;
let estadoAbierto: Estado | null = null;
let mesVisible = '';

function cerrarPopover(): void {
  popover?.remove();
  popover = null;
  estadoAbierto = null;
  document.removeEventListener('pointerdown', alTocarFuera, true);
  window.removeEventListener('resize', cerrarPopover);
}

function alTocarFuera(evento: PointerEvent): void {
  if (!(evento.target instanceof Node)) return;
  if (popover?.contains(evento.target) || estadoAbierto?.texto.closest('.date-field')?.contains(evento.target)) return;
  if (estadoAbierto) confirmarTexto(estadoAbierto);
  cerrarPopover();
}

function posicionar(): void {
  if (!popover || !estadoAbierto) return;
  const campo = estadoAbierto.texto.closest('.date-field') ?? estadoAbierto.texto;
  const r = campo.getBoundingClientRect();
  const alto = popover.offsetHeight || 320;
  const ancho = popover.offsetWidth || 288;
  const abajo = r.bottom + 6 + alto <= window.innerHeight;
  popover.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - ancho - 8)}px`;
  popover.style.top = `${abajo ? r.bottom + 6 : Math.max(8, r.top - 6 - alto)}px`;
}

/** Vista previa de lo escrito: "→ vie 27/11 · en 6 días", o por qué no sirve. */
function previa(estado: Estado): { fecha: string | null; texto: string; error: boolean } {
  const escrito = estado.texto.value.trim();
  if (!escrito) return { fecha: null, texto: 'Escribe: m, +3, vie, 25 o 25/11', error: false };
  const fecha = interpretarFecha(escrito, hoy(), estado.opciones.direccion);
  if (!fecha) return { fecha: null, texto: 'No reconozco esa fecha', error: true };
  if (!dentroDeLimites(fecha, limitesDe(estado.original))) return { fecha: null, texto: `${describirFechaCorta(fecha, hoy())}: fuera de rango`, error: true };
  return { fecha, texto: `→ ${describirFechaCorta(fecha, hoy())} · ${describirDistancia(fecha, hoy())}`, error: false };
}

function dibujarPopover(): void {
  if (!popover || !estadoAbierto) return;
  const estado = estadoAbierto;
  const limites = limitesDe(estado.original);
  const seleccionada = estado.original.value;

  const p = previa(estado);
  const linea = crearElemento('p', `date-pop__preview${p.error ? ' is-error' : ''}`, p.texto);
  linea.setAttribute('aria-live', 'polite');

  const chips = crearElemento('div', 'date-pop__chips');
  for (const chip of chipsDeFecha(hoy(), estado.opciones.direccion, limites)) {
    const boton = crearElemento('button', `date-chip${chip.fecha === seleccionada ? ' is-selected' : ''}`, chip.texto);
    boton.type = 'button';
    boton.dataset.fecha = chip.fecha;
    chips.append(boton);
  }

  const cabecera = crearElemento('div', 'date-pop__month');
  const anterior = crearElemento('button', 'date-pop__nav', '‹');
  const siguiente = crearElemento('button', 'date-pop__nav', '›');
  anterior.type = siguiente.type = 'button';
  anterior.dataset.mes = '-1';
  siguiente.dataset.mes = '1';
  anterior.setAttribute('aria-label', 'Mes anterior');
  siguiente.setAttribute('aria-label', 'Mes siguiente');
  cabecera.append(anterior, crearElemento('span', 'date-pop__title', nombreDelMes(mesVisible)), siguiente);

  const grilla = crearElemento('div', 'date-pop__grid');
  grilla.setAttribute('role', 'grid');
  for (const dia of ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do']) grilla.append(crearElemento('span', 'date-pop__weekday', dia));
  const mes = mesVisible.slice(0, 7);
  for (const fecha of semanasDelMes(mesVisible).flat()) {
    const boton = crearElemento('button', 'date-pop__day', String(Number(fecha.slice(8))));
    boton.type = 'button';
    boton.dataset.fecha = fecha;
    boton.classList.toggle('is-other-month', !fecha.startsWith(mes));
    boton.classList.toggle('is-today', fecha === hoy());
    boton.classList.toggle('is-selected', fecha === seleccionada);
    boton.disabled = !dentroDeLimites(fecha, limites);
    grilla.append(boton);
  }

  const pie = crearElemento('div', 'date-pop__footer');
  if (!estado.original.required && seleccionada) {
    const quitar = crearElemento('button', 'btn btn-sm', 'Quitar fecha');
    quitar.type = 'button';
    quitar.dataset.quitar = '';
    pie.append(quitar);
  }
  pie.append(crearElemento('span', 'date-pop__hint', '↑/↓ cambia un día · Enter acepta'));

  popover.replaceChildren(linea, chips, cabecera, grilla, pie);
}

function abrirPopover(estado: Estado): void {
  if (estadoAbierto === estado) return;
  cerrarPopover();
  estadoAbierto = estado;
  mesVisible = sumarMeses(estado.original.value || hoy(), 0);
  popover = crearElemento('div', 'date-pop');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Elegir fecha');
  // Que los clics del popover no le quiten el foco al campo de texto
  popover.addEventListener('mousedown', (evento) => evento.preventDefault());
  popover.addEventListener('click', (evento) => {
    const boton = evento.target instanceof Element ? evento.target.closest<HTMLButtonElement>('button') : null;
    if (!boton || boton.disabled || !estadoAbierto) return;
    if (boton.dataset.mes) {
      mesVisible = sumarMeses(mesVisible, Number(boton.dataset.mes));
      dibujarPopover();
      return;
    }
    const elegido = estadoAbierto;
    cerrarPopover();
    aplicar(elegido, boton.dataset.quitar !== undefined ? null : (boton.dataset.fecha ?? null));
    elegido.texto.blur();
  });
  document.body.append(popover);
  dibujarPopover();
  posicionar();
  document.addEventListener('pointerdown', alTocarFuera, true);
  window.addEventListener('resize', cerrarPopover);
  void animarEntrada(popover, 'arriba');
}

/** Al salir o con Enter: aplica lo escrito si se entiende; si no, vuelve al valor anterior. */
function confirmarTexto(estado: Estado): boolean {
  const escrito = estado.texto.value.trim();
  const actual = estado.original.value ? `${describirFechaCorta(estado.original.value, hoy())} · ${describirDistancia(estado.original.value, hoy())}` : '';
  if (escrito === actual) return true;
  if (!escrito) {
    if (!estado.original.required) aplicar(estado, null);
    else mostrarValor(estado);
    return true;
  }
  const { fecha } = previa(estado);
  if (fecha) {
    aplicar(estado, fecha);
    return true;
  }
  mostrarValor(estado);
  return false;
}

// ---------------------------------------------------------------------------
// Campo
// ---------------------------------------------------------------------------
export function mejorarCampoDeFecha(original: HTMLInputElement, opciones: OpcionesCampoDeFecha): void {
  const existente = estados.get(original);
  if (existente) {
    existente.opciones = opciones;
    mostrarValor(existente);
    return;
  }

  const envoltorio = crearElemento('div', 'date-field');
  const texto = crearElemento('input', 'date-field__text');
  texto.type = 'text';
  texto.autocomplete = 'off';
  texto.spellcheck = false;
  texto.setAttribute('aria-label', original.getAttribute('aria-label') ?? 'Fecha');
  texto.setAttribute('aria-haspopup', 'dialog');
  const boton = crearElemento('button', 'date-field__toggle');
  boton.type = 'button';
  boton.tabIndex = -1;
  boton.setAttribute('aria-label', 'Abrir calendario');
  boton.append(crearElemento('i', 'fa-regular fa-calendar'));
  envoltorio.append(texto, boton);

  original.classList.add('hidden');
  original.tabIndex = -1;
  original.after(envoltorio);

  const estado: Estado = { original, texto, opciones };
  estados.set(original, estado);
  mostrarValor(estado);

  texto.addEventListener('focus', () => {
    abrirPopover(estado);
    texto.select();
  });
  texto.addEventListener('click', () => abrirPopover(estado));
  texto.addEventListener('input', () => {
    if (estadoAbierto !== estado) abrirPopover(estado);
    dibujarPopover();
  });
  texto.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      if (confirmarTexto(estado)) {
        cerrarPopover();
        texto.select();
      } else {
        animarSacudida(envoltorio);
      }
    } else if (evento.key === 'Escape') {
      if (estadoAbierto === estado) {
        evento.stopPropagation();
        mostrarValor(estado);
        cerrarPopover();
      }
    } else if (evento.key === 'ArrowUp' || evento.key === 'ArrowDown') {
      evento.preventDefault();
      const base = original.value || hoy();
      const nueva = original.value ? sumarDias(base, evento.key === 'ArrowUp' ? 1 : -1) : base;
      if (dentroDeLimites(nueva, limitesDe(original))) {
        aplicar(estado, nueva);
        mesVisible = sumarMeses(nueva, 0);
        if (estadoAbierto === estado) dibujarPopover();
        texto.select();
      }
    }
  });
  texto.addEventListener('blur', () => {
    // El popover evita el blur con sus propios clics; un blur real es salir del campo.
    window.setTimeout(() => {
      if (document.activeElement === texto) return;
      if (estadoAbierto === estado) {
        confirmarTexto(estado);
        cerrarPopover();
      }
    }, 0);
  });
  boton.addEventListener('click', () => texto.focus());
}
