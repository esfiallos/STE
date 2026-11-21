import { errorDelEnlaceDeRecuperacion, validarContrasenaNueva } from '../../domain/credentials';
import { cambiarContrasena, obtenerSesion } from '../../services/authService';
import { byId } from '../dom';
import { irA, RUTAS } from '../routes';
import { iniciarCamposDeContrasena, mostrarMensaje, mostrarPanel, ponerCargando, sacudir } from './authUi';

/** Tiempo para leer "Contraseña actualizada" antes de entrar al panel. */
const ESPERA_ANTES_DE_ENTRAR_MS = 1500;

const paneles = () => ['resetChecking', 'resetForm', 'resetInvalid', 'resetDone'].map((id) => byId(id));

function mostrarEnlaceInvalido(mensaje: string): void {
  byId('resetInvalidText').textContent = mensaje;
  byId<HTMLAnchorElement>('resetInvalidLink').href = `${RUTAS.login}#recuperar`;
  mostrarPanel(paneles(), byId('resetInvalid'));
}

function iniciarFormulario(): void {
  const tarjeta = byId('resetCard');
  const formulario = byId<HTMLFormElement>('resetForm');
  const contrasena = byId<HTMLInputElement>('resetPassword');
  const confirmacion = byId<HTMLInputElement>('resetConfirm');
  const enviar = byId<HTMLButtonElement>('resetSubmit');

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarMensaje('resetError', null);

    const motivo = validarContrasenaNueva(contrasena.value, confirmacion.value);
    if (motivo) {
      mostrarMensaje('resetError', motivo);
      sacudir(tarjeta);
      return;
    }

    ponerCargando(enviar, true, 'Guardando…');
    const resultado = await cambiarContrasena(contrasena.value);
    if (!resultado.ok) {
      ponerCargando(enviar, false, 'Guardar contraseña');
      mostrarMensaje('resetError', resultado.error);
      sacudir(tarjeta);
      return;
    }

    mostrarPanel(paneles(), byId('resetDone'));
    window.setTimeout(() => irA(RUTAS.inicio), ESPERA_ANTES_DE_ENTRAR_MS);
  });
}

/**
 * El enlace del correo abre esta página con el token en la dirección; el cliente de Supabase lo lee
 * solo y deja una sesión temporal con la que se puede cambiar la contraseña.
 */
async function iniciar(): Promise<void> {
  iniciarCamposDeContrasena();
  iniciarFormulario();

  const error = errorDelEnlaceDeRecuperacion(window.location.hash, window.location.search);
  if (error) {
    mostrarEnlaceInvalido(error);
    return;
  }

  const sesion = await obtenerSesion();
  if (!sesion) {
    mostrarEnlaceInvalido('Abre esta página desde el enlace del correo de recuperación. Si ya lo usaste, pide uno nuevo.');
    return;
  }

  // Quita el token de la dirección para que no quede en el historial del navegador.
  history.replaceState(null, '', window.location.pathname);
  byId('resetEmail').textContent = sesion.user.email ?? '';
  mostrarPanel(paneles(), byId('resetForm'));
}

void iniciar();
