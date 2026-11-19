import { byId } from '../dom';

/** Muestra (o limpia, con null) un mensaje de error o de éxito de los formularios de acceso. */
export function mostrarMensaje(id: string, mensaje: string | null): void {
  const elemento = byId(id);
  elemento.textContent = mensaje ?? '';
  elemento.classList.toggle('hidden', mensaje === null);
}

/** Botón con indicador de carga: se deshabilita y cambia su texto mientras se espera al servidor. */
export function ponerCargando(boton: HTMLButtonElement, cargando: boolean, texto: string): void {
  boton.disabled = cargando;
  boton.classList.toggle('is-loading', cargando);
  boton.setAttribute('aria-busy', String(cargando));
  const etiqueta = boton.querySelector('[data-ref="texto"]');
  if (etiqueta) etiqueta.textContent = texto;
}

/** Sacude la tarjeta para señalar un error (se desactiva solo con "reducir movimiento"). */
export function sacudir(elemento: HTMLElement): void {
  elemento.classList.remove('is-shaking');
  void elemento.offsetWidth; // reinicia la animación
  elemento.classList.add('is-shaking');
}

/** Cambia de panel dentro de la tarjeta (iniciar sesión ↔ recuperar) con una transición corta. */
export function mostrarPanel(paneles: HTMLElement[], visible: HTMLElement): void {
  paneles.forEach((panel) => panel.classList.toggle('hidden', panel !== visible));
  visible.classList.remove('is-entering');
  void visible.offsetWidth;
  visible.classList.add('is-entering');
  visible.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus();
}

/** Botones "mostrar contraseña" y aviso de Bloq Mayús de todos los campos de contraseña de la página. */
export function iniciarCamposDeContrasena(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-toggle-password]').forEach((boton) => {
    const campo = byId<HTMLInputElement>(boton.dataset.togglePassword!);
    const icono = boton.querySelector('i');

    boton.addEventListener('click', () => {
      const mostrar = campo.type === 'password';
      campo.type = mostrar ? 'text' : 'password';
      const texto = mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña';
      boton.setAttribute('aria-pressed', String(mostrar));
      boton.setAttribute('aria-label', texto);
      boton.title = texto;
      if (icono) icono.className = mostrar ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
      campo.focus();
    });

    const aviso = document.querySelector<HTMLElement>(`[data-caps-hint="${campo.id}"]`);
    if (!aviso) return;
    const revisar = (evento: KeyboardEvent) => {
      if (typeof evento.getModifierState === 'function') {
        aviso.classList.toggle('hidden', !evento.getModifierState('CapsLock'));
      }
    };
    campo.addEventListener('keydown', revisar);
    campo.addEventListener('keyup', revisar);
    campo.addEventListener('blur', () => aviso.classList.add('hidden'));
  });
}
