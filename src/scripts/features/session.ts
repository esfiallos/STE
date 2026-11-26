import { alCerrarSesion, cerrarSesion } from '../../services/authService';
import type { Perfil } from '../../types/noc';
import { byId } from '../dom';
import { RUTAS } from '../routes';

const irAlLogin = () => window.location.replace(RUTAS.login);

const ETIQUETA_ROL: Record<Perfil['rol'], string> = { dispatch: 'Dispatch', tecnico: 'Técnico', coordinador: 'Coordinación' };

/** Muestra el usuario conectado y su rol, habilita "Cerrar sesión" y expulsa al login si la sesión termina. */
export function iniciarSesionDeUsuario(correo: string | undefined, perfil: Perfil): void {
  byId('userEmail').textContent = perfil.nombre || correo || '';
  byId('userEmail').title = correo ?? '';

  const rol = byId('userRole');
  rol.textContent = ETIQUETA_ROL[perfil.rol];
  rol.dataset.rol = perfil.rol;
  rol.classList.remove('hidden');

  byId('btnLogout').addEventListener('click', async () => {
    await cerrarSesion();
    irAlLogin();
  });

  alCerrarSesion(irAlLogin);
}

/**
 * Sesión válida pero sin rol asignado, o con el usuario inhabilitado por coordinación (D39): pantalla de aviso con
 * la opción de salir.
 */
export function mostrarAvisoSinPerfil(correo: string | undefined, motivo: 'sin-perfil' | 'inhabilitado' = 'sin-perfil'): void {
  const aviso = byId('noProfileNotice');
  aviso.querySelectorAll<HTMLElement>('[data-aviso]').forEach((bloque) => bloque.classList.toggle('hidden', bloque.dataset.aviso !== motivo));
  aviso.querySelectorAll<HTMLElement>('[data-ref="correo"]').forEach((campo) => (campo.textContent = correo ?? ''));
  aviso.classList.remove('hidden');
  byId('btnNoProfileLogout').addEventListener('click', async () => {
    await cerrarSesion();
    irAlLogin();
  });
}
