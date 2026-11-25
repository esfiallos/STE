import { filtrarOpciones, mismoTexto } from '../../domain/search';
import { crearElemento } from '../dom';
import { mejorarCombobox } from './combobox';

/**
 * Agrega búsqueda rápida a un `<select>` (§14.4): oculta la lista y pone en su lugar un campo con combobox que
 * filtra sus opciones al escribir. El `<select>` sigue teniendo el valor y recibe `change` (burbujea), así que
 * quien ya lo escuchaba no cambia nada. Mismo patrón que `ui/fecha.ts`.
 */
export interface OpcionesListaConBusqueda {
  placeholder?: string;
}

const opcionesReales = (lista: HTMLSelectElement) => [...lista.options].filter((o) => o.value !== '');

export function mejorarListaConBusqueda(lista: HTMLSelectElement, opciones: OpcionesListaConBusqueda = {}): HTMLInputElement {
  const campo = crearElemento('input', 'select-busqueda');
  campo.type = 'text';
  campo.placeholder = opciones.placeholder ?? 'Buscar…';
  campo.setAttribute('aria-label', lista.getAttribute('aria-label') ?? lista.closest('label')?.querySelector('span')?.textContent ?? 'Buscar');
  campo.disabled = lista.disabled;

  const textoActual = () => (lista.value ? (lista.selectedOptions[0]?.text ?? '') : '');
  campo.value = textoActual();
  lista.classList.add('select-busqueda__original');
  lista.tabIndex = -1;
  lista.setAttribute('aria-hidden', 'true');
  lista.after(campo);

  // Sin opción "vacía": borrar el texto no debe quitar lo elegido (se vuelve a mostrar al salir del campo)
  mejorarCombobox(campo, { opciones: () => opcionesReales(lista).map((o) => o.text) });

  const aplicar = () => {
    const texto = campo.value.trim();
    if (!texto) {
      campo.value = textoActual(); // campo vacío = estado normal: se ve lo que ya estaba elegido
      return;
    }
    const todas = opcionesReales(lista);
    // El texto exacto de una opción o, si lo escrito coincide con una sola, esa ("marta" → "Marta Soto · …")
    const coincidencias = texto ? filtrarOpciones(todas.map((o) => o.text), texto) : [];
    const elegida = texto
      ? (todas.find((o) => mismoTexto(o.text, texto)) ??
        (coincidencias.length === 1 ? todas.find((o) => o.text === coincidencias[0]) : undefined))
      : null;
    const valor = texto ? elegida?.value : '';
    if (valor === undefined) {
      campo.value = textoActual(); // texto que no es ninguna opción: vuelve a lo que había
      return;
    }
    campo.value = elegida?.text ?? '';
    if (valor === lista.value) return;
    lista.value = valor;
    lista.dispatchEvent(new Event('change', { bubbles: true }));
  };
  campo.addEventListener('change', (evento) => {
    evento.stopPropagation(); // el que cuenta es el change del <select>
    aplicar();
  });
  campo.addEventListener('input', (evento) => evento.stopPropagation());
  campo.addEventListener('blur', () => window.setTimeout(aplicar, 0));
  return campo;
}
