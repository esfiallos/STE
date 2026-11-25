import { crearElemento } from '../dom';
import { animarEntrada, animarFondo, animarSalida, animarSacudida } from './animacion';

export interface OpcionesPedirTexto {
  titulo: string;
  mensaje?: string;
  etiqueta: string;
  placeholder?: string;
  maxLength?: number;
  /** Texto del botón que acepta (por defecto "Aceptar"). */
  aceptar?: string;
}

let secuencia = 0;

/**
 * Panel centrado (como `confirmar` sin ancla) con un campo de texto obligatorio. Devuelve el texto sin espacios
 * de sobra, o null si se cancela (Esc, clic fuera o "Cancelar"). Enter acepta; vacío no se acepta.
 */
export function pedirTexto(opciones: OpcionesPedirTexto): Promise<string | null> {
  return new Promise((resolver) => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = ++secuencia;

    const cuerpo = crearElemento('form', 'confirm__body');
    cuerpo.noValidate = true;
    const titulo = crearElemento('h3', 'confirm__title', opciones.titulo);
    titulo.id = `pedir-texto-titulo-${id}`;
    cuerpo.append(titulo);
    if (opciones.mensaje) cuerpo.append(crearElemento('p', 'confirm__message', opciones.mensaje));

    const etiqueta = crearElemento('label', 'confirm__label', opciones.etiqueta);
    const campo = document.createElement('input');
    campo.type = 'text';
    campo.id = `pedir-texto-campo-${id}`;
    campo.className = 'confirm__field';
    campo.autocomplete = 'off';
    campo.maxLength = opciones.maxLength ?? 500;
    if (opciones.placeholder) campo.placeholder = opciones.placeholder;
    etiqueta.htmlFor = campo.id;
    cuerpo.append(etiqueta, campo);

    const acciones = crearElemento('div', 'confirm__actions');
    const cancelar = crearElemento('button', 'btn', 'Cancelar');
    const aceptar = crearElemento('button', 'btn btn-primary', opciones.aceptar ?? 'Aceptar');
    cancelar.type = 'button';
    aceptar.type = 'submit';
    acciones.append(cancelar, aceptar);
    cuerpo.append(acciones);

    const caja = crearElemento('div', 'confirm confirm--panel');
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-modal', 'true');
    caja.setAttribute('aria-labelledby', titulo.id);
    caja.append(cuerpo);
    const fondo = crearElemento('div', 'confirm-overlay');
    fondo.append(caja);
    document.body.append(fondo);

    let terminado = false;
    const cerrar = (texto: string | null) => {
      if (terminado) return;
      terminado = true;
      document.removeEventListener('keydown', alTeclear, true);
      document.removeEventListener('pointerdown', alTocarFuera, true);
      resolver(texto);
      if (previo && document.contains(previo)) previo.focus();
      void Promise.all([animarSalida(caja), animarFondo(fondo, false)]).then(() => fondo.remove());
    };
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      evento.stopPropagation();
      cerrar(null);
    };
    const alTocarFuera = (evento: PointerEvent) => {
      if (evento.target instanceof Node && !caja.contains(evento.target)) cerrar(null);
    };

    cuerpo.addEventListener('submit', (evento) => {
      evento.preventDefault();
      const texto = campo.value.trim();
      if (!texto) {
        campo.focus();
        animarSacudida(caja);
        return;
      }
      cerrar(texto);
    });
    cancelar.addEventListener('click', () => cerrar(null));
    document.addEventListener('keydown', alTeclear, true);
    window.setTimeout(() => !terminado && document.addEventListener('pointerdown', alTocarFuera, true), 0);

    campo.focus();
    void animarFondo(fondo, true);
    void animarEntrada(caja, 'centro');
  });
}
