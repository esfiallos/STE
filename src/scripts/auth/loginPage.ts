import { iniciarSesion, obtenerSesion } from '../../services/authService';
import { byId } from '../dom';
import { RUTAS } from '../routes';

function mostrarError(mensaje: string | null): void {
  const elemento = byId('loginError');
  elemento.textContent = mensaje ?? '';
  elemento.classList.toggle('hidden', mensaje === null);
}

async function iniciar(): Promise<void> {
  if (await obtenerSesion()) {
    window.location.replace(RUTAS.inicio);
    return;
  }

  const formulario = byId<HTMLFormElement>('loginForm');
  const correo = byId<HTMLInputElement>('loginEmail');
  const contrasena = byId<HTMLInputElement>('loginPassword');
  const enviar = byId<HTMLButtonElement>('loginSubmit');

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarError(null);
    enviar.disabled = true;
    enviar.textContent = 'Entrando…';

    const resultado = await iniciarSesion(correo.value, contrasena.value);
    if (resultado.ok) {
      window.location.replace(RUTAS.inicio);
      return;
    }

    mostrarError(resultado.error);
    enviar.disabled = false;
    enviar.textContent = 'Entrar';
    contrasena.select();
  });
}

void iniciar();
