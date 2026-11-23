import { describe, expect, it } from 'vitest';
import { errorDelEnlaceDeRecuperacion, esCorreoValido, validarContrasenaNueva } from '../../src/domain/credentials';

describe('contraseña nueva', () => {
  it('exige longitud mínima, letras y números, y que coincida', () => {
    expect(validarContrasenaNueva('abc12', 'abc12')).toContain('al menos 8');
    expect(validarContrasenaNueva('solamenteletras', 'solamenteletras')).toContain('letras y números');
    expect(validarContrasenaNueva('12345678', '12345678')).toContain('letras y números');
    expect(validarContrasenaNueva('clave2026', 'clave2027')).toBe('Las contraseñas no coinciden.');
    expect(validarContrasenaNueva('contraseña1', 'contraseña1')).toBeNull();
  });
});

describe('correo', () => {
  it('reconoce la forma básica', () => {
    expect(esCorreoValido(' ana@empresa.hn ')).toBe(true);
    expect(esCorreoValido('ana@')).toBe(false);
    expect(esCorreoValido('')).toBe(false);
  });
});

describe('enlace de recuperación', () => {
  it('sin error en la dirección no hay mensaje', () => {
    expect(errorDelEnlaceDeRecuperacion('#access_token=x&type=recovery', '')).toBeNull();
    expect(errorDelEnlaceDeRecuperacion('', '?code=abc')).toBeNull();
  });

  it('distingue el enlace vencido de otros errores, en el hash o en la búsqueda', () => {
    expect(errorDelEnlaceDeRecuperacion('#error=access_denied&error_code=otp_expired', '')).toContain('venció');
    expect(errorDelEnlaceDeRecuperacion('', '?error=server_error')).toContain('no es válido');
  });
});
