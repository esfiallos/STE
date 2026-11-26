import { describe, expect, it } from 'vitest';
import {
  avisoDeCambioDeRol,
  avisoDeCasosAbiertos,
  conteoDeUsuarios,
  filtrarUsuarios,
  generarContrasenaTemporal,
  motivoParaNoCambiarRol,
  motivoParaNoInhabilitar,
  problemaDeContrasena,
  problemaDeUsuarioNuevo,
  textoDeAcceso
} from '../../src/domain/usuarios';
import type { UsuarioApp } from '../../src/types/noc';

const usuario = (datos: Partial<UsuarioApp> & Pick<UsuarioApp, 'id'>): UsuarioApp => ({
  correo: `${datos.id}@noc.test`, nombre: datos.id, rol: 'tecnico', activo: true, tecnicoId: null,
  ultimoIngreso: null, creadoEn: null, inhabilitadoEn: null, inhabilitadoPor: null, ...datos
});

const YO = usuario({ id: 'yo', rol: 'coordinador', nombre: 'Coordinación' });
const ANA = usuario({ id: 'ana', nombre: 'Ana Pérez', correo: 'ana.perez@noc.test' });
const LUIS = usuario({ id: 'luis', nombre: 'Luis Ríos', rol: 'dispatch', activo: false });
const NUEVA = usuario({ id: 'nueva', nombre: 'nueva', rol: null });
const TODOS = [YO, ANA, LUIS, NUEVA];

describe('usuarios: validaciones', () => {
  it('pide correo válido, nombre, rol y contraseña de 8 a 72 caracteres', () => {
    const base = { correo: 'x@noc.test', nombre: 'X', rol: 'dispatch', contrasena: 'Temporal-1' };
    expect(problemaDeUsuarioNuevo(base)).toBeNull();
    expect(problemaDeUsuarioNuevo({ ...base, correo: 'x@noc' })).toMatch(/correo válido/);
    expect(problemaDeUsuarioNuevo({ ...base, nombre: '  ' })).toMatch(/nombre es obligatorio/);
    expect(problemaDeUsuarioNuevo({ ...base, rol: 'admin' })).toMatch(/Elige un rol/);
    expect(problemaDeUsuarioNuevo({ ...base, contrasena: 'corta' })).toMatch(/entre 8 y 72/);
    expect(problemaDeUsuarioNuevo({ ...base, correo: 'ANA.PEREZ@noc.test' }, [ANA.correo])).toMatch(/Ya existe una cuenta/);
    expect(problemaDeContrasena('ñ'.repeat(37))).toMatch(/entre 8 y 72/); // 74 bytes
  });
});

describe('usuarios: contraseña temporal', () => {
  it('tiene 12 caracteres, de cada tipo, sin caracteres confusos', () => {
    for (let i = 0; i < 50; i++) {
      const clave = generarContrasenaTemporal();
      expect(clave).toHaveLength(12);
      expect(clave).toMatch(/[A-Z]/);
      expect(clave).toMatch(/[a-z]/);
      expect(clave).toMatch(/[2-9]/);
      expect(clave).toMatch(/[-_.!?]/);
      expect(clave).not.toMatch(/[01OIl]/);
      expect(problemaDeContrasena(clave)).toBeNull();
    }
  });

  it('depende solo de la fuente de azar (se puede probar)', () => {
    const fija = (n: number) => new Uint32Array(n).fill(7);
    expect(generarContrasenaTemporal(12, fija)).toBe(generarContrasenaTemporal(12, fija));
  });
});

describe('usuarios: lista', () => {
  it('filtra por estado y por texto sin acentos', () => {
    expect(filtrarUsuarios(TODOS, '', 'activos').map((u) => u.id)).toEqual(['yo', 'ana']);
    expect(filtrarUsuarios(TODOS, '', 'inhabilitados').map((u) => u.id)).toEqual(['luis']);
    expect(filtrarUsuarios(TODOS, '', 'sin-rol').map((u) => u.id)).toEqual(['nueva']);
    expect(filtrarUsuarios(TODOS, 'rios', 'todos').map((u) => u.id)).toEqual(['luis']);
    expect(filtrarUsuarios(TODOS, 'PEREZ@', 'todos').map((u) => u.id)).toEqual(['ana']);
    expect(filtrarUsuarios(TODOS, 'coordinación', 'todos').map((u) => u.id)).toEqual(['yo']);
    expect(conteoDeUsuarios(TODOS)).toEqual({ activos: 2, inhabilitados: 1, 'sin-rol': 1, todos: 4 });
  });
});

describe('usuarios: reglas de cambio', () => {
  it('nadie se cambia el rol ni se inhabilita a sí mismo', () => {
    expect(motivoParaNoCambiarRol(YO, 'dispatch', 'yo', TODOS)).toMatch(/propio rol/);
    expect(motivoParaNoCambiarRol(YO, 'coordinador', 'yo', TODOS)).toBeNull(); // mismo rol: solo cambia el nombre
    expect(motivoParaNoInhabilitar(YO, 'yo', TODOS)).toMatch(/propio usuario/);
  });

  it('siempre queda una persona de coordinación activa', () => {
    const otra = usuario({ id: 'otra', rol: 'coordinador' });
    expect(motivoParaNoInhabilitar(otra, 'ana', [otra, ANA])).toMatch(/al menos una/);
    expect(motivoParaNoInhabilitar(otra, 'yo', [YO, otra])).toBeNull();
    expect(motivoParaNoCambiarRol(otra, 'dispatch', 'yo', [YO, otra])).toBeNull();
    expect(motivoParaNoCambiarRol(otra, 'dispatch', 'ana', [otra, ANA])).toMatch(/al menos una/);
  });

  it('una cuenta sin rol no se inhabilita (no puede entrar)', () => {
    expect(motivoParaNoInhabilitar(NUEVA, 'yo', TODOS)).toMatch(/no tiene rol/);
  });

  it('avisa qué pasa con la ficha y los casos', () => {
    expect(avisoDeCambioDeRol(ANA, 'dispatch')).toMatch(/Deja de ser técnico/);
    expect(avisoDeCambioDeRol(LUIS, 'tecnico')).toMatch(/Pasa a ser técnico/);
    expect(avisoDeCambioDeRol(ANA, 'tecnico')).toBeNull();
    expect(avisoDeCasosAbiertos('Ana', 0)).toBeNull();
    expect(avisoDeCasosAbiertos('Ana', 1)).toBe('Ana tenía 1 caso abierto: repártelos desde "Por reasignar" en el Tablero.');
    expect(avisoDeCasosAbiertos('Ana', 3)).toMatch(/3 casos abiertos/);
  });

  it('arma el texto de acceso para entregar', () => {
    expect(textoDeAcceso('a@noc.test', 'Clave-123', 'https://panel/login/')).toBe(
      'Panel NOC: https://panel/login/\nUsuario: a@noc.test\nContraseña temporal: Clave-123'
    );
  });
});
