// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { esperar } from '../helpers/app';

/** Carga el HTML compilado de una página (sin sus scripts) en el DOM de la prueba. */
function cargarPagina(ruta: string): void {
  const archivo = resolve(process.cwd(), 'dist', ruta, 'index.html');
  if (!existsSync(archivo)) throw new Error(`No existe ${archivo}. Compila antes con "bun run build".`);
  const cuerpo = /<body[^>]*>([\s\S]*)<\/body>/.exec(readFileSync(archivo, 'utf8'))?.[1] ?? '';
  document.body.innerHTML = cuerpo.replace(/<script[\s\S]*?<\/script>/g, '');
}

/** Sustituye el servicio de autenticación (nunca se llama a Supabase) y arranca el script de la página. */
async function arrancar(pagina: 'login' | 'restablecer', servicio: Record<string, unknown>) {
  vi.resetModules();
  cargarPagina(pagina);
  const auth = {
    obtenerSesion: vi.fn(async () => null),
    iniciarSesion: vi.fn(async () => ({ ok: false, error: 'Correo o contraseña incorrectos.' })),
    solicitarRecuperacion: vi.fn(async () => ({ ok: true, data: null })),
    cambiarContrasena: vi.fn(async () => ({ ok: true, data: null })),
    ...servicio
  };
  vi.doMock('../../src/services/authService', () => auth);
  const reemplazar = vi.fn();
  const rutas = await vi.importActual<typeof import('../../src/scripts/routes')>('../../src/scripts/routes');
  vi.doMock('../../src/scripts/routes', () => ({ ...rutas, irA: reemplazar }));

  await import(pagina === 'login' ? '../../src/scripts/auth/loginPage' : '../../src/scripts/auth/resetPage');
  await esperar();
  return { auth, reemplazar };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enviar = (id: string) => $(id).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

afterEach(() => {
  vi.doUnmock('../../src/services/authService');
  vi.doUnmock('../../src/scripts/routes');
});

describe('inicio de sesión', () => {
  it('valida antes de llamar al servidor y muestra el error del servidor', async () => {
    const { auth } = await arrancar('login', {});

    enviar('loginForm');
    expect($('loginError').textContent).toBe('Escribe tu correo y tu contraseña.');
    expect(auth.iniciarSesion).not.toHaveBeenCalled();

    $<HTMLInputElement>('loginEmail').value = 'ana@noc.test';
    $<HTMLInputElement>('loginPassword').value = 'mala';
    enviar('loginForm');
    await esperar();

    expect(auth.iniciarSesion).toHaveBeenCalledWith('ana@noc.test', 'mala');
    expect($('loginError').textContent).toBe('Correo o contraseña incorrectos.');
    expect($<HTMLButtonElement>('loginSubmit').disabled).toBe(false);
  });

  it('con una sesión abierta va directo al panel', async () => {
    const { reemplazar } = await arrancar('login', { obtenerSesion: vi.fn(async () => ({ user: {} })) });
    expect(reemplazar).toHaveBeenCalledWith('/');
  });

  it('el botón del ojo muestra y oculta la contraseña', async () => {
    await arrancar('login', {});
    const boton = document.querySelector<HTMLButtonElement>('[data-toggle-password="loginPassword"]')!;

    boton.click();
    expect($<HTMLInputElement>('loginPassword').type).toBe('text');
    expect(boton.getAttribute('aria-pressed')).toBe('true');
    boton.click();
    expect($<HTMLInputElement>('loginPassword').type).toBe('password');
  });
});

describe('¿Olvidaste tu contraseña?', () => {
  it('abre el panel con el correo ya escrito, envía el enlace a /restablecer/ y no revela si la cuenta existe', async () => {
    const { auth } = await arrancar('login', {});
    $<HTMLInputElement>('loginEmail').value = 'ana@noc.test';

    $('btnForgot').click();
    expect($('loginForm').classList.contains('hidden')).toBe(true);
    expect($('recoverForm').classList.contains('hidden')).toBe(false);
    expect($<HTMLInputElement>('recoverEmail').value).toBe('ana@noc.test');

    enviar('recoverForm');
    await esperar();

    expect(auth.solicitarRecuperacion).toHaveBeenCalledWith('ana@noc.test', `${window.location.origin}/restablecer/`);
    expect($('recoverDone').textContent).toContain('Si ana@noc.test tiene una cuenta');

    $('btnBackToLogin').click();
    expect($('loginForm').classList.contains('hidden')).toBe(false);
  });

  it('muestra el aviso de espera si se pide otro enlace demasiado pronto', async () => {
    await arrancar('login', {
      solicitarRecuperacion: vi.fn(async () => ({ ok: false, error: 'Ya se envió un enlace hace poco. Espera un minuto antes de pedir otro.' }))
    });
    $('btnForgot').click();
    $<HTMLInputElement>('recoverEmail').value = 'ana@noc.test';
    enviar('recoverForm');
    await esperar();

    expect($('recoverError').textContent).toContain('Espera un minuto');
    expect($('recoverDone').classList.contains('hidden')).toBe(true);
  });
});

describe('restablecer contraseña', () => {
  const conSesion = { obtenerSesion: vi.fn(async () => ({ user: { email: 'ana@noc.test' } })) };

  it('sin el enlace del correo (sin sesión) pide un enlace nuevo', async () => {
    await arrancar('restablecer', {});
    expect($('resetInvalid').classList.contains('hidden')).toBe(false);
    expect($<HTMLAnchorElement>('resetInvalidLink').getAttribute('href')).toBe('/login/#recuperar');
  });

  it('valida la contraseña nueva y, al guardar, entra al panel', async () => {
    const { auth, reemplazar } = await arrancar('restablecer', conSesion);

    expect($('resetForm').classList.contains('hidden')).toBe(false);
    expect($('resetEmail').textContent).toBe('ana@noc.test');

    $<HTMLInputElement>('resetPassword').value = 'clave2026';
    $<HTMLInputElement>('resetConfirm').value = 'otra2026';
    enviar('resetForm');
    expect($('resetError').textContent).toBe('Las contraseñas no coinciden.');
    expect(auth.cambiarContrasena).not.toHaveBeenCalled();

    $<HTMLInputElement>('resetConfirm').value = 'clave2026';
    enviar('resetForm');
    await esperar();
    expect(auth.cambiarContrasena).toHaveBeenCalledWith('clave2026');
    expect($('resetDone').classList.contains('hidden')).toBe(false);

    await esperar(1600);
    expect(reemplazar).toHaveBeenCalledWith('/');
  });
});
