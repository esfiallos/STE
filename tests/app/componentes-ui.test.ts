// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mejorarCombobox } from '../../src/scripts/ui/combobox';
import { confirmar } from '../../src/scripts/ui/confirmar';
import { mejorarCampoDeFecha } from '../../src/scripts/ui/fecha';

const esperar = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const tecla = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const escribir = (input: HTMLInputElement, valor: string) => {
  input.value = valor;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 9, 10, 0)); // lunes 9/11/2026
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('confirmar (D23)', () => {
  it('panel centrado con resumen: Enter acepta y el texto va por textContent', async () => {
    const respuesta = confirmar({
      titulo: '¿Cerrar turno?',
      mensaje: '<b>2</b> caso(s)',
      resumen: [{ etiqueta: 'Ana Pérez', valor: '2 caso(s)' }],
      aceptar: 'Cerrar turno',
      peligro: true
    });
    const panel = document.querySelector<HTMLElement>('.confirm-overlay .confirm--panel')!;
    expect(panel.getAttribute('role')).toBe('alertdialog');
    expect(panel.classList.contains('confirm--danger')).toBe(true);
    expect(panel.querySelector('.confirm__message')!.textContent).toBe('<b>2</b> caso(s)');
    expect(panel.querySelector('b')).toBeNull();
    expect(panel.querySelector('dt')!.textContent).toBe('Ana Pérez');
    expect(document.activeElement?.textContent).toBe('Cerrar turno');

    tecla(document.body, 'Enter');
    await expect(respuesta).resolves.toBe(true);
    await esperar();
    expect(document.querySelector('.confirm')).toBeNull();
  });

  it('Esc o "Cancelar" responden false y el foco vuelve a donde estaba', async () => {
    const boton = document.createElement('button');
    document.body.append(boton);
    boton.focus();

    const primera = confirmar({ titulo: 'Uno', ancla: boton });
    expect(document.querySelector('.confirm--popover')).not.toBeNull();
    expect(document.querySelector('.confirm-overlay')).toBeNull();
    tecla(document.body, 'Escape');
    await expect(primera).resolves.toBe(false);
    expect(document.activeElement).toBe(boton);

    const segunda = confirmar({ titulo: 'Dos' });
    click(document.querySelector('[data-confirmar="no"]')!);
    await expect(segunda).resolves.toBe(false);
  });

  it('abrir otra confirmación cancela la anterior; un clic fuera también cancela', async () => {
    const primera = confirmar({ titulo: 'Uno' });
    const segunda = confirmar({ titulo: 'Dos' });
    await expect(primera).resolves.toBe(false);
    await esperar();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await expect(segunda).resolves.toBe(false);
  });
});

describe('campo de fecha rápido (D24)', () => {
  const crear = (valor = '', atributos: Record<string, string> = {}) => {
    const input = document.createElement('input');
    input.type = 'date';
    input.value = valor;
    Object.entries(atributos).forEach(([k, v]) => input.setAttribute(k, v));
    const cambios: string[] = [];
    input.addEventListener('change', () => cambios.push(input.value));
    document.body.append(input);
    mejorarCampoDeFecha(input, { direccion: 'futuro', vacio: 'Sin recordatorio' });
    const texto = document.querySelector<HTMLInputElement>('.date-field__text')!;
    return { input, texto, cambios };
  };

  it('oculta el input original y muestra la fecha legible', () => {
    const { input, texto } = crear('2026-11-10');
    expect(input.classList.contains('hidden')).toBe(true);
    expect(texto.value).toBe('mar 10/11 · Mañana');
    // Llamarlo otra vez solo actualiza lo que se ve
    input.value = '2026-11-13';
    mejorarCampoDeFecha(input, { direccion: 'futuro' });
    expect(document.querySelectorAll('.date-field')).toHaveLength(1);
    expect(texto.value).toBe('vie 13/11 · en 4 días');
  });

  it('escribir un atajo muestra la vista previa y Enter lo aplica (dispara change en el original)', () => {
    const { input, texto, cambios } = crear();
    texto.dispatchEvent(new FocusEvent('focus'));
    expect(document.querySelector('.date-pop')).not.toBeNull();
    escribir(texto, 'vie');
    expect(document.querySelector('.date-pop__preview')!.textContent).toBe('→ vie 13/11 · en 4 días');
    tecla(texto, 'Enter');
    expect(input.value).toBe('2026-11-13');
    expect(cambios).toEqual(['2026-11-13']);
    expect(document.querySelector('.date-pop')).toBeNull();
  });

  it('respeta el mínimo: lo de antes no se acepta y los días quedan deshabilitados', () => {
    const { input, texto } = crear('', { min: '2026-11-09' });
    texto.dispatchEvent(new FocusEvent('focus'));
    escribir(texto, 'ayer');
    expect(document.querySelector('.date-pop__preview')!.classList.contains('is-error')).toBe(true);
    tecla(texto, 'Enter');
    expect(input.value).toBe('');
    expect(document.querySelector<HTMLButtonElement>('.date-pop__day[data-fecha="2026-11-08"]')!.disabled).toBe(true);
  });

  it('chips y calendario de un clic; flechas suman días; se puede quitar', () => {
    const { input, texto, cambios } = crear();
    texto.dispatchEvent(new FocusEvent('focus'));
    click([...document.querySelectorAll('.date-chip')].find((c) => c.textContent === 'Mañana')!);
    expect(input.value).toBe('2026-11-10');

    tecla(texto, 'ArrowUp');
    expect(input.value).toBe('2026-11-11');

    texto.dispatchEvent(new FocusEvent('focus'));
    click(document.querySelector('.date-pop__day[data-fecha="2026-11-20"]')!);
    expect(input.value).toBe('2026-11-20');

    texto.dispatchEvent(new FocusEvent('focus'));
    click(document.querySelector('[data-quitar]')!);
    expect(input.value).toBe('');
    expect(cambios).toEqual(['2026-11-10', '2026-11-11', '2026-11-20', '']);
  });
});

describe('combobox (D22)', () => {
  const crear = () => {
    const input = document.createElement('input');
    input.type = 'text';
    const cambios: string[] = [];
    input.addEventListener('change', () => cambios.push(input.value));
    document.body.append(input);
    const creadas: string[] = [];
    mejorarCombobox(input, {
      opciones: () => ['Crítico', 'Monitoreo', 'Pendiente cliente', 'VM'],
      permitirCrear: true,
      alCrear: (v) => creadas.push(v),
      vacio: 'Sin etiqueta'
    });
    const opciones = () => [...document.querySelectorAll('.combo__option')].map((o) => o.textContent);
    return { input, cambios, creadas, opciones };
  };

  it('al enfocar muestra todas; escribir filtra y Enter elige la primera', () => {
    const { input, cambios, opciones } = crear();
    input.dispatchEvent(new FocusEvent('focus'));
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(opciones()).toEqual(['Crítico', 'Monitoreo', 'Pendiente cliente', 'VM']);

    escribir(input, 'crit');
    expect(opciones()).toEqual(['Crítico', 'Crear «crit»']);
    tecla(input, 'Enter');
    expect(input.value).toBe('Crítico');
    expect(cambios).toEqual(['Crítico']);
    expect(document.querySelector('.combo__list')).toBeNull();
  });

  it('"Crear" usa el texto nuevo; si ya existe sin acentos, usa la forma de la lista', () => {
    const { input, creadas, opciones } = crear();
    input.dispatchEvent(new FocusEvent('focus'));
    escribir(input, 'Proveedor');
    tecla(input, 'ArrowDown');
    tecla(input, 'Enter');
    expect(input.value).toBe('Proveedor');
    expect(creadas).toEqual(['Proveedor']);

    input.dispatchEvent(new FocusEvent('blur'));
    input.dispatchEvent(new FocusEvent('focus'));
    expect(opciones()).toContain('Sin etiqueta');
    escribir(input, 'vm');
    expect(opciones()).toEqual(['VM', 'Sin etiqueta']);
  });

  it('Esc deja el valor que tenía al abrir; "Sin etiqueta" lo vacía', () => {
    const { input, cambios } = crear();
    input.value = 'VM';
    input.dispatchEvent(new FocusEvent('focus'));
    escribir(input, 'algo');
    tecla(input, 'Escape');
    expect(input.value).toBe('VM');

    input.dispatchEvent(new FocusEvent('focus'));
    click([...document.querySelectorAll('.combo__option')].find((o) => o.textContent === 'Sin etiqueta')!);
    expect(input.value).toBe('');
    expect(cambios).toEqual(['']);
  });
});
