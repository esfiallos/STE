import { alCerrarSesion, cerrarSesion } from '../../services/authService';
import { byId } from '../dom';
import { RUTAS } from '../routes';

const irAlLogin = () => window.location.replace(RUTAS.login);

/** Muestra el usuario conectado, habilita "Cerrar sesión" y expulsa al login si la sesión termina. */
export function iniciarSesionDeUsuario(correo: string | undefined): void {
  byId('userEmail').textContent = correo ?? '';

  byId('btnLogout').addEventListener('click', async () => {
    await cerrarSesion();
    irAlLogin();
  });

  alCerrarSesion(irAlLogin);
}
