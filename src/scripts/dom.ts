/** Busca un elemento por id y falla con un mensaje claro si no existe. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (!elemento) throw new Error(`No se encontró el elemento #${id}`);
  return elemento as T;
}

/** Busca dentro de una plantilla clonada el elemento marcado con data-ref="nombre". */
export function ref<T extends HTMLElement = HTMLElement>(raiz: ParentNode, nombre: string): T {
  const elemento = raiz.querySelector<T>(`[data-ref="${nombre}"]`);
  if (!elemento) throw new Error(`La plantilla no tiene data-ref="${nombre}"`);
  return elemento;
}

export function clonarPlantilla(id: string): DocumentFragment {
  return byId<HTMLTemplateElement>(id).content.cloneNode(true) as DocumentFragment;
}

export function crearElemento<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  clase: string,
  texto?: string
): HTMLElementTagNameMap[K] {
  const elemento = document.createElement(etiqueta);
  elemento.className = clase;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}
