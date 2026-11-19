import type { Session } from '@supabase/supabase-js';
import { exito, falla, type Resultado } from '../types/result';
import { supabase } from './supabaseClient';

function traducirErrorDeAutenticacion(mensaje: string): string {
  const texto = mensaje.toLowerCase();
  if (texto.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (texto.includes('email not confirmed')) return 'La cuenta aún no está confirmada. Pide al administrador que la active.';
  if (texto.includes('rate limit') || texto.includes('too many')) return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
  return 'No se pudo iniciar sesión. Revisa tu conexión e inténtalo de nuevo.';
}

export async function iniciarSesion(correo: string, contrasena: string): Promise<Resultado> {
  const { error } = await supabase.auth.signInWithPassword({ email: correo.trim(), password: contrasena });
  if (error) {
    console.error('[iniciarSesion]', error);
    return falla(traducirErrorDeAutenticacion(error.message));
  }
  return exito();
}

export async function cerrarSesion(): Promise<void> {
  await supabase.auth.signOut();
}

export async function obtenerSesion(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Envía el correo con el enlace para crear una contraseña nueva. `urlDeRetorno` es la página /restablecer/
 * y debe estar en Supabase > Authentication > URL Configuration > Redirect URLs.
 * Por seguridad no se revela si el correo existe: un correo desconocido también "sale bien".
 */
export async function solicitarRecuperacion(correo: string, urlDeRetorno: string): Promise<Resultado> {
  const { error } = await supabase.auth.resetPasswordForEmail(correo.trim(), { redirectTo: urlDeRetorno });
  if (error) {
    console.error('[solicitarRecuperacion]', error);
    const texto = error.message.toLowerCase();
    if (texto.includes('rate limit') || texto.includes('security purposes') || texto.includes('too many')) {
      return falla('Ya se envió un enlace hace poco. Espera un minuto antes de pedir otro.');
    }
    return falla('No se pudo enviar el correo. Revisa tu conexión e inténtalo de nuevo.');
  }
  return exito();
}

function traducirErrorDeContrasena(mensaje: string): string {
  const texto = mensaje.toLowerCase();
  if (texto.includes('different from the old')) return 'La contraseña nueva debe ser distinta de la anterior.';
  if (texto.includes('weak') || texto.includes('at least')) return 'La contraseña es demasiado débil: usa una más larga.';
  if (texto.includes('session') || texto.includes('jwt') || texto.includes('expired')) {
    return 'El enlace venció. Pide uno nuevo desde "¿Olvidaste tu contraseña?".';
  }
  return 'No se pudo cambiar la contraseña. Inténtalo de nuevo.';
}

/** Cambia la contraseña del usuario con sesión (la que abre el enlace de recuperación). */
export async function cambiarContrasena(nueva: string): Promise<Resultado> {
  const { error } = await supabase.auth.updateUser({ password: nueva });
  if (error) {
    console.error('[cambiarContrasena]', error);
    return falla(traducirErrorDeContrasena(error.message));
  }
  return exito();
}

/** Avisa cuando la sesión termina (cierre manual, otra pestaña o token vencido). Devuelve la función para cancelar. */
export function alCerrarSesion(callback: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') callback();
  });
  return () => data.subscription.unsubscribe();
}
