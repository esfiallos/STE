import { describe, expect, it } from 'vitest';
import { construirRutas } from '../../src/scripts/routes';
import { validarEntorno } from '../../src/services/environment';

describe('entorno', () => {
  it('en desarrollo exige PUBLIC_APP_ENV=development', () => {
    expect(() => validarEntorno('development', false)).not.toThrow();
    expect(() => validarEntorno('production', false)).toThrow(/Estás en desarrollo/);
    expect(() => validarEntorno(undefined, false)).toThrow(/DESARROLLO/);
  });

  it('una compilación declara su entorno: producción o DEV publicado', () => {
    expect(() => validarEntorno('production', true)).not.toThrow();
    expect(() => validarEntorno('development', true)).not.toThrow();
    expect(() => validarEntorno(undefined, true)).toThrow(/no declara su entorno/);
    expect(() => validarEntorno('staging', true)).toThrow(/no declara su entorno/);
  });
});

describe('rutas con ruta base (GitHub Pages)', () => {
  it('en la raíz', () => {
    expect(construirRutas('/')).toEqual({ inicio: '/', login: '/login/', restablecer: '/restablecer/' });
  });

  it('en un repositorio de proyecto, con o sin barra final', () => {
    expect(construirRutas('/panel-noc')).toEqual({ inicio: '/panel-noc/', login: '/panel-noc/login/', restablecer: '/panel-noc/restablecer/' });
    expect(construirRutas('/panel-noc/')).toEqual({ inicio: '/panel-noc/', login: '/panel-noc/login/', restablecer: '/panel-noc/restablecer/' });
  });
});
