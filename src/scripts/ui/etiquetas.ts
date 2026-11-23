import { agregarEtiquetaPropia, colorDeEtiqueta, opcionesDeEtiqueta } from '../../domain/followUp';
import { mejorarCombobox } from './combobox';

/**
 * Etiquetas propias del técnico (D22): se recuerdan solo en este navegador (localStorage). Si el navegador no
 * deja guardar (modo privado, almacenamiento bloqueado) todo sigue funcionando, solo que no se recuerdan.
 */
const CLAVE = 'panel-noc:etiquetas-propias';

export function leerEtiquetasPropias(): string[] {
  try {
    const valor: unknown = JSON.parse(window.localStorage.getItem(CLAVE) ?? '[]');
    return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function recordarEtiquetaPropia(etiqueta: string): void {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(agregarEtiquetaPropia(leerEtiquetasPropias(), etiqueta)));
  } catch {
    // Sin almacenamiento: la etiqueta se usa igual en el caso, solo no se ofrece la próxima vez.
  }
}

/** Pinta el campo con el color de su etiqueta (las propias usan el neutro). */
export function pintarEtiqueta(campo: HTMLInputElement): void {
  campo.classList.forEach((clase) => clase.startsWith('tag-color') && campo.classList.remove(clase));
  const color = colorDeEtiqueta(campo.value.trim());
  if (color) campo.classList.add('tag-color', `tag-color--${color}`);
}

/** Combobox de etiqueta: sugeridas + propias, "Crear «…»" recuerda la nueva, y el color de la elegida. */
export function mejorarCampoDeEtiqueta(campo: HTMLInputElement): void {
  mejorarCombobox(campo, {
    opciones: () => opcionesDeEtiqueta(leerEtiquetasPropias(), campo.value.trim() || null),
    permitirCrear: true,
    alCrear: recordarEtiquetaPropia,
    vacio: 'Sin etiqueta'
  });
  pintarEtiqueta(campo);
  if (!campo.dataset.etiquetaPintada) {
    campo.dataset.etiquetaPintada = 'si';
    campo.addEventListener('change', () => pintarEtiqueta(campo));
    campo.addEventListener('focus', () => campo.classList.remove('tag-color'));
    campo.addEventListener('blur', () => pintarEtiqueta(campo));
  }
}
