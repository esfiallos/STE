import { esCorreoValido } from '../../domain/credentials';
import { iniciarSesion, obtenerSesion, solicitarRecuperacion } from '../../services/authService';
import { byId } from '../dom';
import { irA, RUTAS } from '../routes';
import { iniciarCamposDeContrasena, mostrarMensaje, mostrarPanel, ponerCargando, sacudir } from './authUi';

/** Dirección absoluta de /restablecer/ a la que vuelve el enlace del correo. */
const urlDeRestablecer = () => new URL(RUTAS.restablecer, window.location.origin).href;

function iniciarAcceso(): void {
  const tarjeta = byId('loginCard');
  const formulario = byId<HTMLFormElement>('loginForm');
  const correo = byId<HTMLInputElement>('loginEmail');
  const contrasena = byId<HTMLInputElement>('loginPassword');
  const enviar = byId<HTMLButtonElement>('loginSubmit');

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarMensaje('loginError', null);

    if (!esCorreoValido(correo.value) || !contrasena.value) {
      mostrarMensaje('loginError', 'Escribe tu correo y tu contraseña.');
      sacudir(tarjeta);
      (esCorreoValido(correo.value) ? contrasena : correo).focus();
      return;
    }

    ponerCargando(enviar, true, 'Entrando…');
    const resultado = await iniciarSesion(correo.value, contrasena.value);
    if (resultado.ok) {
      irA(RUTAS.inicio);
      return;
    }

    mostrarMensaje('loginError', resultado.error);
    ponerCargando(enviar, false, 'Entrar');
    sacudir(tarjeta);
    contrasena.select();
  });
}

function iniciarRecuperacion(): void {
  const tarjeta = byId('loginCard');
  const acceso = byId<HTMLFormElement>('loginForm');
  const recuperar = byId<HTMLFormElement>('recoverForm');
  const correo = byId<HTMLInputElement>('recoverEmail');
  const enviar = byId<HTMLButtonElement>('recoverSubmit');
  const subtitulo = tarjeta.querySelector('[data-ref="subtitulo"]');
  const paneles = [acceso, recuperar];

  const abrirRecuperar = () => {
    correo.value = correo.value || byId<HTMLInputElement>('loginEmail').value;
    mostrarMensaje('recoverError', null);
    mostrarMensaje('recoverDone', null);
    if (subtitulo) subtitulo.textContent = 'Recupera el acceso a tu cuenta';
    mostrarPanel(paneles, recuperar);
  };
  const volver = () => {
    if (subtitulo) subtitulo.textContent = 'Inicia sesión para continuar';
    mostrarPanel(paneles, acceso);
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  };

  byId('btnForgot').addEventListener('click', abrirRecuperar);
  byId('btnBackToLogin').addEventListener('click', volver);

  recuperar.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarMensaje('recoverError', null);
    mostrarMensaje('recoverDone', null);

    if (!esCorreoValido(correo.value)) {
      mostrarMensaje('recoverError', 'Escribe un correo válido.');
      sacudir(tarjeta);
      correo.focus();
      return;
    }

    ponerCargando(enviar, true, 'Enviando…');
    const resultado = await solicitarRecuperacion(correo.value, urlDeRestablecer());
    ponerCargando(enviar, false, 'Enviar enlace');

    if (!resultado.ok) {
      mostrarMensaje('recoverError', resultado.error);
      sacudir(tarjeta);
      return;
    }
    // Mismo mensaje exista o no la cuenta: no se revela qué correos están registrados.
    mostrarMensaje(
      'recoverDone',
      `Si ${correo.value.trim()} tiene una cuenta, en unos minutos te llegará un correo con el enlace. Revisa también la carpeta de spam.`
    );
  });

  // Desde /restablecer/ con un enlace vencido se llega a /login/#recuperar
  if (window.location.hash === '#recuperar') abrirRecuperar();
}

async function iniciar(): Promise<void> {
  if (await obtenerSesion()) {
    irA(RUTAS.inicio);
    return;
  }
  iniciarCamposDeContrasena();
  iniciarAcceso();
  iniciarRecuperacion();
}

void iniciar();
