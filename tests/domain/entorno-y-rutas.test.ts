import { describe, expect, it } from 'vitest';
import { construirRutas } from '../../src/scripts/routes';
import { validarEntorno } from '../../src/services/environment';

describe('entorno', () => {
  it('en desarrollo exige PUBLIC_APP_ENV=development', () => {
    expect(() => validarEntorno('development', false)).not.toThrow();
    expect(() => validarEntorno('production', false)).toThrow(/Estás en desarrollo/);
    expect(() => validarEntorno(undefined, false)).toThrow(/DESARROLLO/);
  });

  it('una compilación de producción exige PUBLIC_APP_ENV=production', () => {
    expect(() => validarEntorno('production', true)).not.toThrow();
    expect(() => validarEntorno('development', true)).toThrow(/compilación es de producción/);
    expect(() => validarEntorno(undefined, true)).toThrow();
  });
});

describe('rutas con ruta base (GitHub Pages)', () => {
  it('en la raíz', () => {
    expect(construirRutas('/')).toEqual({ inicio: '/', login: '/login/' });
  });

  it('en un repositorio de proyecto, con o sin barra final', () => {
    expect(construirRutas('/panel-noc')).toEqual({ inicio: '/panel-noc/', login: '/panel-noc/login/' });
    expect(construirRutas('/panel-noc/')).toEqual({ inicio: '/panel-noc/', login: '/panel-noc/login/' });
  });
});
