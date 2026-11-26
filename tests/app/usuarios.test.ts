// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperar, fijarHora, iniciarApp } from '../helpers/app';
import { datosBase, HOY, type Datos } from '../helpers/backendSimulado';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fijarHora(10);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fila = (datos: Record<string, unknown>) => ({
  rol: 'tecnico', activo: true, tecnico_id: null, ultimo_ingreso: null, creado_en: null, inhabilitado_en: null,
  inhabilitado_por: null, ...datos
});

function datosConUsuarios(): Datos {
  const datos = datosBase();
  datos.usuarios = [
    fila({ id: 'yo', correo: 'coord@noc.test', nombre: 'Coordinación', rol: 'coordinador', ultimo_ingreso: `${HOY}T15:00:00Z` }),
    fila({ id: 'u-ana', correo: 'ana@noc.test', nombre: 'Ana Pérez', tecnico_id: 'ana' }),
    fila({ id: 'u-disp', correo: 'dispatch@noc.test', nombre: '<b>Dispatch</b>', rol: 'dispatch' }),
    fila({ id: 'u-ex', correo: 'ex@noc.test', nombre: 'Ex Técnico', activo: false, inhabilitado_en: `${HOY}T08:00:00Z`, inhabilitado_por: 'coord@noc.test' }),
    fila({ id: 'u-nueva', correo: 'nueva@noc.test', nombre: 'nueva', rol: null })
  ];
  return datos;
}

async function abrirUsuarios(datos = datosConUsuarios()) {
  const app = await iniciarApp(datos, { rol: 'coordinador' });
  const { iniciarModales } = await import('../../src/scripts/modals/modal');
  const { iniciarUsuarios, cargarUsuarios } = await import('../../src/scripts/users/usersView');
  iniciarModales();
  iniciarUsuarios('yo');
  await cargarUsuarios();
  const filas = () => app.qa('#usersList tr[data-id]');
  const filaDe = (id: string) => document.querySelector<HTMLElement>(`#usersList tr[data-id="${id}"]`)!;
  const boton = (id: string, accion: string) => filaDe(id).querySelector<HTMLButtonElement>(`[data-action="${accion}"]`)!;
  const escribir = (id: string, valor: string) => {
    const campo = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const enviar = async () => {
    document.getElementById('formUser')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await esperar(60);
  };
  return { ...app, filas, filaDe, boton, escribir, enviar };
}

describe('pestaña Usuarios (coordinación, D39)', () => {
  it('la pestaña existe solo para coordinación', async () => {
    const app = await abrirUsuarios();
    expect(app.q('[data-tab="usuarios"]').hasAttribute('data-coordinador-only')).toBe(true);
  });

  it('lista los activos por defecto, con contadores, y el nombre siempre como texto', async () => {
    const app = await abrirUsuarios();
    expect(app.filas().map((f) => f.dataset.id)).toEqual(['yo', 'u-ana', 'u-disp']);
    expect(app.filaDe('yo').textContent).toContain('Coordinación (tú)');
    expect(app.filaDe('u-disp').querySelector('b')).toBeNull();
    expect(app.filaDe('u-disp').textContent).toContain('<b>Dispatch</b>');
    expect(app.q('[data-conteo="inhabilitados"]').textContent).toBe('1');
    expect(app.q('[data-conteo="sin-rol"]').textContent).toBe('1');
    expect(app.filaDe('u-ana').textContent).toContain('Nunca');

    app.click(app.q('[data-filtro="inhabilitados"]'));
    expect(app.filas().map((f) => f.dataset.id)).toEqual(['u-ex']);
    expect(app.filaDe('u-ex').textContent).toContain('Inhabilitado');
    expect(app.boton('u-ex', 'alternar-usuario').textContent).toBe('Habilitar');

    app.click(app.q('[data-filtro="todos"]'));
    const buscador = app.q<HTMLInputElement>('#usersSearch');
    buscador.value = 'perez';
    buscador.dispatchEvent(new Event('input'));
    expect(app.filas().map((f) => f.dataset.id)).toEqual(['u-ana']);
  });

  it('no deja inhabilitarse a uno mismo', async () => {
    const app = await abrirUsuarios();
    const boton = app.boton('yo', 'alternar-usuario');
    expect(boton.disabled).toBe(true);
    expect(boton.title).toMatch(/propio usuario/);
  });

  it('crea un usuario y muestra una sola vez los datos de acceso', async () => {
    const app = await abrirUsuarios();
    app.click(app.q('#btnUserNew'));
    expect(app.q('#modalUser').classList.contains('hidden')).toBe(false);
    const clave = app.q<HTMLInputElement>('#userPasswordInput').value;
    expect(clave).toHaveLength(12);

    // Correo repetido: lo avisa sin llamar a la base
    app.escribir('userEmailInput', 'ANA@noc.test');
    app.escribir('userNameInput', 'Otra Ana');
    await app.enviar();
    expect(app.q('#userError').textContent).toMatch(/Ya existe una cuenta/);
    expect(app.escrituras.some((e) => e.includes('crear_usuario'))).toBe(false);

    app.escribir('userEmailInput', 'pedro@noc.test');
    app.escribir('userNameInput', 'Pedro Ríos');
    app.escribir('userRoleInput', 'tecnico');
    await app.enviar();
    const llamada = app.escrituras.find((e) => e.includes('crear_usuario'))!;
    expect(JSON.parse(llamada.replace(/^RPC crear_usuario /, ''))).toEqual({
      p_correo: 'pedro@noc.test', p_nombre: 'Pedro Ríos', p_rol: 'tecnico', p_contrasena: clave
    });
    expect(app.q('#formUser').classList.contains('hidden')).toBe(true);
    expect(app.q('#userAccessData').textContent).toContain(`Contraseña temporal: ${clave}`);
    expect(app.q('#userAccessData').textContent).toContain('Usuario: pedro@noc.test');
    await esperar(40);
    expect(app.filas().some((f) => f.textContent?.includes('Pedro Ríos'))).toBe(true);

    // Al abrir de nuevo, el formulario vuelve y la contraseña es otra
    app.click(app.q('#btnUserNew'));
    expect(app.q('#formUser').classList.contains('hidden')).toBe(false);
    expect(app.q<HTMLInputElement>('#userPasswordInput').value).not.toBe(clave);
  });

  it('cambia el rol con aviso y confirmación', async () => {
    const app = await abrirUsuarios();
    app.click(app.boton('u-ana', 'editar-usuario'));
    expect(app.q('#modalUser-titulo').textContent).toBe('Editar usuario');
    expect(app.q('#userEmailInput').closest('[data-modo]')!.classList.contains('hidden')).toBe(true);
    expect(app.q('#userPasswordInput').closest('[data-modo]')!.classList.contains('hidden')).toBe(true);
    app.escribir('userRoleInput', 'dispatch');
    expect(app.q('#userRoleHint').textContent).toMatch(/Deja de ser técnico/);

    app.confirmar.mockReturnValueOnce(false);
    await app.enviar();
    expect(app.escrituras.some((e) => e.includes('actualizar_usuario'))).toBe(false);

    await app.enviar();
    expect(app.confirmar).toHaveBeenLastCalledWith(expect.stringContaining('Cambiar el rol de Ana Pérez a Dispatch'));
    expect(app.escrituras.find((e) => e.includes('actualizar_usuario'))).toContain('"p_rol":"dispatch"');
    expect(app.q('#modalUser').classList.contains('hidden')).toBe(true);
    await esperar(40);
    expect(app.filaDe('u-ana').textContent).toContain('Dispatch');
  });

  it('no deja cambiarse el rol a uno mismo', async () => {
    const app = await abrirUsuarios();
    app.click(app.boton('yo', 'editar-usuario'));
    app.escribir('userRoleInput', 'dispatch');
    expect(app.q('#userRoleHint').textContent).toMatch(/propio rol/);
    await app.enviar();
    expect(app.q('#userError').textContent).toMatch(/propio rol/);
    expect(app.escrituras.some((e) => e.includes('actualizar_usuario'))).toBe(false);
  });

  it('da rol a una cuenta que no lo tenía', async () => {
    const app = await abrirUsuarios();
    app.click(app.q('[data-filtro="sin-rol"]'));
    expect(app.boton('u-nueva', 'editar-usuario').textContent).toContain('Asignar rol');
    expect(app.filaDe('u-nueva').querySelector('[data-action="alternar-usuario"]')).toBeNull();
    app.click(app.boton('u-nueva', 'editar-usuario'));
    expect(app.q('#modalUser-titulo').textContent).toBe('Asignar rol');
    app.escribir('userNameInput', 'Nueva Persona');
    app.escribir('userRoleInput', 'dispatch');
    await app.enviar();
    expect(app.confirmar).not.toHaveBeenCalled();
    expect(app.escrituras.find((e) => e.includes('actualizar_usuario'))).toContain('"p_nombre":"Nueva Persona"');
  });

  it('inhabilita con motivo y avisa de los casos abiertos', async () => {
    const app = await abrirUsuarios();
    app.pedirTexto.mockResolvedValueOnce(null); // cancelar
    app.click(app.boton('u-ana', 'alternar-usuario'));
    await esperar(40);
    expect(app.escrituras.some((e) => e.includes('inhabilitar_usuario'))).toBe(false);

    app.pedirTexto.mockResolvedValueOnce('Dejó la empresa');
    app.click(app.boton('u-ana', 'alternar-usuario'));
    await esperar(80);
    expect(app.escrituras.find((e) => e.includes('inhabilitar_usuario'))).toContain('"p_motivo":"Dejó la empresa"');
    expect(document.body.textContent).toContain('Ana Pérez tenía 1 caso abierto');
    expect(app.filas().map((f) => f.dataset.id)).not.toContain('u-ana');
    expect(app.q('[data-conteo="inhabilitados"]').textContent).toBe('2');
  });

  it('pone una contraseña temporal y la muestra para copiarla', async () => {
    const app = await abrirUsuarios();
    app.click(app.boton('u-disp', 'contrasena-usuario'));
    expect(app.q('#modalUser-titulo').textContent).toBe('Contraseña temporal');
    expect(app.q('#userTarget').textContent).toBe('<b>Dispatch</b> · dispatch@noc.test');
    app.escribir('userPasswordInput', 'corta');
    await app.enviar();
    expect(app.q('#userError').textContent).toMatch(/entre 8 y 72/);
    app.escribir('userPasswordInput', 'Nueva-Clave-7');
    await app.enviar();
    expect(app.escrituras.find((e) => e.includes('cambiar_contrasena_de_usuario'))).toContain('"p_contrasena":"Nueva-Clave-7"');
    expect(app.q('#userAccessData').textContent).toContain('Contraseña temporal: Nueva-Clave-7');
    app.click(app.q('#btnUserCopyAccess'));
    await esperar(20);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('habilita de nuevo con confirmación', async () => {
    const app = await abrirUsuarios();
    app.click(app.q('[data-filtro="inhabilitados"]'));
    app.click(app.boton('u-ex', 'alternar-usuario'));
    await esperar(80);
    expect(app.confirmar).toHaveBeenCalledWith(expect.stringContaining('Habilitar a Ex Técnico'));
    expect(app.escrituras.some((e) => e.includes('habilitar_usuario') && !e.includes('inhabilitar'))).toBe(true);
    expect(app.filas()).toHaveLength(0);
  });
});
