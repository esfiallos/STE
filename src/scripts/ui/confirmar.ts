import { crearElemento } from '../dom';
import { animarEntrada, animarFondo, animarSalida } from './animacion';

/** Una línea del resumen del panel: "Ana Pérez → 3 caso(s)". */
export interface LineaDeResumen {
  etiqueta: string;
  valor: string;
}

export interface OpcionesConfirmacion {
  titulo: string;
  mensaje?: string;
  /** Resumen en lista (solo en el panel; en el popover se ignora si no hay espacio). */
  resumen?: LineaDeResumen[];
  /** Texto del botón que confirma (por defecto "Confirmar"). */
  aceptar?: string;
  /** Texto del botón que cancela (por defecto "Cancelar"). */
  cancelar?: string;
  /** Acción destructiva o irreversible: botón rojo. */
  peligro?: boolean;
  /**
   * Con ancla, confirmación liviana en un popover junto a ese elemento (cerrar un caso, desactivar…).
   * Sin ancla, panel centrado con fondo (cerrar turno, copiar semana…).
   */
  ancla?: Element | null;
}

let abierta: { cerrar: (respuesta: boolean) => void } | null = null;

const ESPACIO = 8;

/** Coloca el popover debajo del ancla (o encima si no cabe), sin salirse de la ventana. */
function posicionar(popover: HTMLElement, ancla: Element): 'arriba' | 'abajo' {
  const r = ancla.getBoundingClientRect();
  const ancho = popover.offsetWidth || 300;
  const alto = popover.offsetHeight || 140;
  const izquierda = Math.min(Math.max(ESPACIO, r.right - ancho), window.innerWidth - ancho - ESPACIO);
  const cabeAbajo = r.bottom + ESPACIO + alto <= window.innerHeight;
  popover.style.left = `${izquierda}px`;
  popover.style.top = `${cabeAbajo ? r.bottom + ESPACIO : Math.max(ESPACIO, r.top - ESPACIO - alto)}px`;
  return cabeAbajo ? 'arriba' : 'abajo';
}

function crearContenido(opciones: OpcionesConfirmacion, idTitulo: string): { cuerpo: HTMLElement; aceptar: HTMLButtonElement; cancelar: HTMLButtonElement } {
  const cuerpo = crearElemento('div', 'confirm__body');
  const titulo = crearElemento('h3', 'confirm__title', opciones.titulo);
  titulo.id = idTitulo;
  cuerpo.append(titulo);
  if (opciones.mensaje) cuerpo.append(crearElemento('p', 'confirm__message', opciones.mensaje));

  if (opciones.resumen?.length) {
    const lista = crearElemento('dl', 'confirm__summary');
    for (const linea of opciones.resumen) {
      lista.append(crearElemento('dt', '', linea.etiqueta), crearElemento('dd', '', linea.valor));
    }
    cuerpo.append(lista);
  }

  const acciones = crearElemento('div', 'confirm__actions');
  const cancelar = crearElemento('button', 'btn', opciones.cancelar ?? 'Cancelar');
  const aceptar = crearElemento('button', opciones.peligro ? 'btn btn-danger' : 'btn btn-primary', opciones.aceptar ?? 'Confirmar');
  cancelar.type = 'button';
  aceptar.type = 'button';
  cancelar.dataset.confirmar = 'no';
  aceptar.dataset.confirmar = 'si';
  acciones.append(cancelar, aceptar);
  cuerpo.append(acciones);
  return { cuerpo, aceptar, cancelar };
}

let secuencia = 0;

/**
 * Reemplaza a `window.confirm` (D23). Devuelve true si la persona acepta.
 * Enter acepta, Esc o un clic fuera cancelan; el foco queda atrapado entre los botones y vuelve a donde estaba.
 * Solo hay una confirmación abierta: abrir otra cancela la anterior.
 */
export function confirmar(opciones: OpcionesConfirmacion): Promise<boolean> {
  abierta?.cerrar(false);

  return new Promise<boolean>((resolver) => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const idTitulo = `confirm-titulo-${++secuencia}`;
    const { cuerpo, aceptar, cancelar } = crearContenido(opciones, idTitulo);
    const anclado = !!opciones.ancla && document.contains(opciones.ancla);

    const caja = crearElemento('div', anclado ? 'confirm confirm--popover' : 'confirm confirm--panel');
    caja.setAttribute('role', 'alertdialog');
    caja.setAttribute('aria-modal', 'true');
    caja.setAttribute('aria-labelledby', idTitulo);
    if (opciones.peligro) caja.classList.add('confirm--danger');
    caja.append(cuerpo);

    const fondo = anclado ? null : crearElemento('div', 'confirm-overlay');
    if (fondo) fondo.append(caja);
    document.body.append(fondo ?? caja);
    const origen = anclado ? posicionar(caja, opciones.ancla!) : 'centro';

    let terminado = false;
    const cerrar = (respuesta: boolean) => {
      if (terminado) return;
      terminado = true;
      abierta = null;
      document.removeEventListener('keydown', alTeclear, true);
      document.removeEventListener('pointerdown', alTocarFuera, true);
      window.removeEventListener('resize', alCambiarVentana);
      window.removeEventListener('scroll', alCambiarVentana, true);
      resolver(respuesta);
      if (previo && document.contains(previo)) previo.focus();
      void Promise.all([animarSalida(caja), fondo ? animarFondo(fondo, false) : Promise.resolve()]).then(() => (fondo ?? caja).remove());
    };

    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        evento.stopPropagation();
        cerrar(false);
      } else if (evento.key === 'Enter' && document.activeElement !== cancelar) {
        evento.preventDefault();
        evento.stopPropagation();
        cerrar(true);
      } else if (evento.key === 'Tab') {
        // Foco atrapado entre los dos botones
        evento.preventDefault();
        (document.activeElement === aceptar ? cancelar : aceptar).focus();
      }
    };
    const alTocarFuera = (evento: PointerEvent) => {
      if (evento.target instanceof Node && !caja.contains(evento.target)) cerrar(false);
    };
    const alCambiarVentana = () => {
      if (anclado && document.contains(opciones.ancla!)) posicionar(caja, opciones.ancla!);
    };

    aceptar.addEventListener('click', () => cerrar(true));
    cancelar.addEventListener('click', () => cerrar(false));
    document.addEventListener('keydown', alTeclear, true);
    // El clic que abrió la confirmación ya terminó; los siguientes fuera de la caja cancelan.
    window.setTimeout(() => !terminado && document.addEventListener('pointerdown', alTocarFuera, true), 0);
    window.addEventListener('resize', alCambiarVentana);
    window.addEventListener('scroll', alCambiarVentana, true);

    abierta = { cerrar };
    aceptar.focus();
    if (fondo) void animarFondo(fondo, true);
    void animarEntrada(caja, origen);
  });
}
