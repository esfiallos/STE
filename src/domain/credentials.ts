/** Reglas de las contraseñas nuevas (al restablecer). Supabase puede exigir más: su mensaje se traduce aparte. */
export const LONGITUD_MINIMA_CONTRASENA = 8;

/** Devuelve el motivo por el que la contraseña nueva no sirve, o null si es válida. */
export function validarContrasenaNueva(contrasena: string, confirmacion: string): string | null {
  if (contrasena.length < LONGITUD_MINIMA_CONTRASENA) {
    return `La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres.`;
  }
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(contrasena) || !/\d/.test(contrasena)) {
    return 'La contraseña debe combinar letras y números.';
  }
  if (contrasena !== confirmacion) return 'Las contraseñas no coinciden.';
  return null;
}

/** Comprobación mínima de forma, para avisar antes de llamar al servidor. */
export function esCorreoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim());
}

/**
 * Si el enlace del correo de recuperación llegó con error (vencido, ya usado…), Supabase lo indica en la
 * dirección: `#error=access_denied&error_code=otp_expired` (o en `?error=`). Devuelve un mensaje o null.
 */
export function errorDelEnlaceDeRecuperacion(hash: string, busqueda: string): string | null {
  const parametros = new URLSearchParams(hash.replace(/^#/, ''));
  new URLSearchParams(busqueda.replace(/^\?/, '')).forEach((valor, clave) => {
    if (!parametros.has(clave)) parametros.set(clave, valor);
  });

  if (!parametros.has('error') && !parametros.has('error_code')) return null;
  if (parametros.get('error_code') === 'otp_expired') {
    return 'El enlace venció o ya se usó. Pide uno nuevo desde "¿Olvidaste tu contraseña?".';
  }
  return 'El enlace no es válido. Pide uno nuevo desde "¿Olvidaste tu contraseña?".';
}
