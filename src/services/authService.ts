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

/** Avisa cuando la sesión termina (cierre manual, otra pestaña o token vencido). Devuelve la función para cancelar. */
export function alCerrarSesion(callback: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') callback();
  });
  return () => data.subscription.unsubscribe();
}
