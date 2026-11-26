// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { actuarComo, crearBaseSupabase, MIGRACIONES } from '../helpers/baseSql';

const U_DISPATCH = 'd0000000-0000-0000-0000-000000000001';
const U_COORD = 'c0000000-0000-0000-0000-000000000001';
const U_LUIS = 'a0000000-0000-0000-0000-000000000002';
const U_SIN_PERFIL = 'f0000000-0000-0000-0000-000000000003';
const LUIS = '22222222-2222-2222-2222-222222222222';
const PEDRO = '44444444-4444-4444-4444-444444444444';

describe('usuarios desde coordinación (migración 20)', () => {
  let db: PGlite;
  let como: ReturnType<typeof actuarComo>;
  let D: string;

  const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const n = async (sql: string, params: unknown[] = []) => Number((await uno<{ n: number }>(sql, params)).n);
  const comoCoordinacion = () => como(U_COORD, 'coord@noc.test');
  const crear = (correo: string, nombre: string, rol: string, clave = 'Temporal-123') =>
    uno<{ id: string }>('select crear_usuario($1, $2, $3, $4) id', [correo, nombre, rol, clave]).then((r) => r.id);
  const perfil = async (id: string) => {
    await como(null);
    const fila = await uno<{ rol: string; activo: boolean; tecnico_id: string | null; nombre: string }>(
      'select rol, activo, tecnico_id, nombre from perfiles where id = $1', [id]);
    await comoCoordinacion();
    return fila;
  };
  const leerComoAdmin = async <T>(sql: string, params: unknown[] = []) => {
    await como(null);
    const fila = await uno<T>(sql, params);
    await comoCoordinacion();
    return fila;
  };

  beforeAll(async () => {
    db = await crearBaseSupabase();
    for (const m of ['esquema', 'v3', 'v4', 'corte', 'seguimiento', 'traspasos', 'coordinador', 'ronda', 'planificacion',
                     'tableroDelDia', 'seguimientoDescripcion', 'filtros', 'turnoC', 'traspasoPropio', 'proteccion',
                     'entregaSupervision', 'planificacionConAviso', 'rendimiento'] as const) {
      await db.exec(MIGRACIONES[m]());
    }
    await db.exec(MIGRACIONES.usuarios());
    await db.exec(MIGRACIONES.usuarios()); // se puede ejecutar dos veces
    como = actuarComo(db);
    D = (await uno<{ d: string }>('select fecha_operativa()::text d')).d;

    await db.exec(`
      insert into tecnicos (id, nombre) values ('${LUIS}','Luis Mora');
      insert into tecnicos (id, nombre, activo) values ('${PEDRO}','Pedro Ríos', false);
      insert into auth.users (id, email) values ('${U_DISPATCH}','dispatch@noc.test'), ('${U_COORD}','coord@noc.test'),
        ('${U_LUIS}','luis@noc.test'), ('${U_SIN_PERFIL}','nueva@noc.test');
      insert into perfiles (id, nombre, rol) values ('${U_DISPATCH}','Dispatch','dispatch'), ('${U_COORD}','Coord','coordinador');
      insert into perfiles (id, nombre, rol, tecnico_id) values ('${U_LUIS}','Luis Mora','tecnico','${LUIS}');
      insert into jornadas (fecha_operativa, tecnico_id, turno) values
        ('${D}','${LUIS}','turnoA'), ('${D}'::date + 1,'${LUIS}','turnoA'), ('${D}'::date + 2,'${LUIS}','turnoB');
      insert into auth.sessions (user_id) values ('${U_LUIS}'), ('${U_LUIS}');
    `);
    await como(U_DISPATCH, 'dispatch@noc.test');
    await db.exec(`insert into casos (codigo, descripcion, tecnico_actual_id) values ('INC1', 'Uno', '${LUIS}')`);
    await comoCoordinacion();
  });

  it('solo coordinación administra usuarios', async () => {
    await como(U_DISPATCH, 'dispatch@noc.test');
    await expect(db.query('select * from usuarios_de_la_app()')).rejects.toThrow(/Solo coordinación/);
    await expect(crear('x@noc.test', 'X', 'dispatch')).rejects.toThrow(/Solo coordinación/);
    await expect(db.query(`select inhabilitar_usuario('${U_LUIS}')`)).rejects.toThrow(/Solo coordinación/);
    await como(null, '');
    await db.exec('set role anon');
    await expect(db.query('select * from usuarios_de_la_app()')).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    await comoCoordinacion();
  });

  it('la lista incluye las cuentas sin perfil', async () => {
    const filas = (await db.query<{ correo: string; rol: string | null; activo: boolean }>('select correo, rol, activo from usuarios_de_la_app()')).rows;
    expect(filas.find((f) => f.correo === 'nueva@noc.test')).toMatchObject({ rol: null, activo: true });
    expect(filas.find((f) => f.correo === 'luis@noc.test')).toMatchObject({ rol: 'tecnico', activo: true });
  });

  it('crea un técnico con cuenta confirmada, contraseña temporal, ficha y bitácora', async () => {
    const id = await crear('  Ana.Ruiz@NOC.test ', 'Ana Ruiz', 'tecnico');
    const cuenta = await leerComoAdmin<{ email: string; ok: boolean; confirmada: boolean; identidades: number }>(
      `select email, encrypted_password = extensions.crypt('Temporal-123', encrypted_password) ok,
              email_confirmed_at is not null confirmada, (select count(*)::int from auth.identities where user_id = u.id) identidades
       from auth.users u where id = $1`, [id]);
    expect(cuenta).toEqual({ email: 'ana.ruiz@noc.test', ok: true, confirmada: true, identidades: 1 });
    const p = await perfil(id);
    expect(p).toMatchObject({ rol: 'tecnico', activo: true, nombre: 'Ana Ruiz' });
    expect((await leerComoAdmin<{ nombre: string }>('select nombre from tecnicos where id = $1', [p.tecnico_id])).nombre).toBe('Ana Ruiz');
    expect(await n(`select count(*) n from bitacora where accion = 'usuario_creado' and tecnico = 'Ana Ruiz'`)).toBe(1);
  });

  it('valida correo, nombre, rol, contraseña y correos repetidos', async () => {
    await expect(crear('no-es-correo', 'X', 'dispatch')).rejects.toThrow(/correo válido/);
    await expect(crear('x@noc.test', '  ', 'dispatch')).rejects.toThrow(/nombre es obligatorio/);
    await expect(crear('x@noc.test', 'X', 'admin')).rejects.toThrow(/Rol no válido/);
    await expect(crear('x@noc.test', 'X', 'dispatch', 'corta')).rejects.toThrow(/entre 8 y 72/);
    await expect(crear('ANA.RUIZ@noc.test', 'Otra', 'dispatch')).rejects.toThrow(/Ya existe una cuenta/);
  });

  it('reutiliza una ficha de técnico libre con el mismo nombre, pero no una de otro usuario', async () => {
    const id = await crear('pedro@noc.test', 'pedro ríos', 'tecnico');
    expect((await perfil(id)).tecnico_id).toBe(PEDRO);
    expect((await leerComoAdmin<{ activo: boolean }>('select activo from tecnicos where id = $1', [PEDRO])).activo).toBe(true);
    await expect(crear('otro.luis@noc.test', 'Luis Mora', 'tecnico')).rejects.toThrow(/otro usuario enlazado/);
  });

  it('cambia el rol: deja de ser técnico (ficha desactivada) y vuelve con la misma ficha', async () => {
    const id = (await uno<{ id: string }>(`select id from usuarios_de_la_app() where correo = 'ana.ruiz@noc.test'`)).id;
    const ficha = (await perfil(id)).tecnico_id;
    await db.query('select actualizar_usuario($1, $2, $3)', [id, 'Ana Ruiz', 'dispatch']);
    expect(await perfil(id)).toMatchObject({ rol: 'dispatch', tecnico_id: null });
    expect((await leerComoAdmin<{ activo: boolean }>('select activo from tecnicos where id = $1', [ficha])).activo).toBe(false);
    await db.query('select actualizar_usuario($1, $2, $3)', [id, 'Ana Ruiz', 'tecnico']);
    expect(await perfil(id)).toMatchObject({ rol: 'tecnico', tecnico_id: ficha });
    expect((await leerComoAdmin<{ activo: boolean }>('select activo from tecnicos where id = $1', [ficha])).activo).toBe(true);
    // Renombrar a un técnico también renombra su ficha; a un nombre ocupado, no
    await db.query('select actualizar_usuario($1, $2, $3)', [id, 'Ana Ruiz Paz', 'tecnico']);
    expect((await leerComoAdmin<{ nombre: string }>('select nombre from tecnicos where id = $1', [ficha])).nombre).toBe('Ana Ruiz Paz');
    await expect(db.query('select actualizar_usuario($1, $2, $3)', [id, 'Luis Mora', 'tecnico'])).rejects.toThrow(/Ya hay un técnico/);
    expect(await n(`select count(*) n from bitacora where accion = 'usuario_actualizado' and detalle like 'rol: Técnico → Dispatch%'`)).toBe(1);
  });

  it('da rol a una cuenta que no tenía perfil', async () => {
    await db.query('select actualizar_usuario($1, $2, $3)', [U_SIN_PERFIL, 'Nueva Dispatch', 'dispatch']);
    expect(await perfil(U_SIN_PERFIL)).toMatchObject({ rol: 'dispatch', activo: true });
  });

  it('nadie se cambia el rol a sí mismo y siempre queda una persona de coordinación', async () => {
    await expect(db.query('select actualizar_usuario($1, $2, $3)', [U_COORD, 'Coord', 'dispatch'])).rejects.toThrow(/propio rol/);
    await db.query('select actualizar_usuario($1, $2, $3)', [U_COORD, 'Coordinación', 'coordinador']); // el nombre sí
    await expect(db.query(`select inhabilitar_usuario('${U_COORD}')`)).rejects.toThrow(/propio usuario/);
    const otra = await crear('coord2@noc.test', 'Coord Dos', 'coordinador');
    await db.query('select actualizar_usuario($1, $2, $3)', [otra, 'Coord Dos', 'dispatch']); // quedo yo
    await db.query('select actualizar_usuario($1, $2, $3)', [otra, 'Coord Dos', 'coordinador']);
    // Desde la otra cuenta: no puede dejar a coordinación sin nadie activo
    await como(otra, 'coord2@noc.test');
    await db.query(`select inhabilitar_usuario('${U_COORD}')`);
    await como(U_COORD, 'coord@noc.test');
    await expect(db.query('select * from usuarios_de_la_app()')).rejects.toThrow(/Solo coordinación/); // ya no entra
    await como(otra, 'coord2@noc.test');
    await db.query(`select habilitar_usuario('${U_COORD}')`);
    await comoCoordinacion();
    await expect(db.query(`select actualizar_usuario($1, 'Coord Dos', 'dispatch')`, [otra])).resolves.toBeDefined();
    await como(null);
    await db.exec(`update perfiles set activo = false where rol = 'coordinador' and id <> '${U_COORD}'`);
    await comoCoordinacion();
  });

  it('inhabilitar corta el acceso al instante, bloquea la cuenta y quita al técnico de la planificación futura', async () => {
    const abiertos = await n(`select inhabilitar_usuario('${U_LUIS}', 'Dejó la empresa') n`);
    expect(abiertos).toBe(1);
    const cuenta = await leerComoAdmin<{ bloqueada: boolean; sesiones: number; ficha: boolean; jornadas: string }>(
      `select banned_until > now() + interval '50 years' bloqueada,
              (select count(*)::int from auth.sessions where user_id = '${U_LUIS}') sesiones,
              (select activo from tecnicos where id = '${LUIS}') ficha,
              (select string_agg(fecha_operativa::text, ',') from jornadas where tecnico_id = '${LUIS}') jornadas
       from auth.users where id = '${U_LUIS}'`);
    expect(cuenta).toEqual({ bloqueada: true, sesiones: 0, ficha: false, jornadas: D });
    expect(await perfil(U_LUIS)).toMatchObject({ activo: false, rol: 'tecnico', tecnico_id: LUIS });
    expect(await n(`select count(*) n from bitacora where accion = 'usuario_inhabilitado' and detalle = 'Dejó la empresa'`)).toBe(1);

    // Con su sesión todavía abierta: ya no ve casos ni tiene rol, pero sí su perfil (para el aviso de la app)
    await como(U_LUIS, 'luis@noc.test');
    expect(await n('select count(*) n from casos')).toBe(0);
    expect((await uno<{ r: string | null }>('select mi_rol() r')).r).toBeNull();
    expect((await uno<{ t: string | null }>('select mi_tecnico_id() t')).t).toBeNull();
    expect(await uno<{ activo: boolean }>(`select activo from perfiles where id = '${U_LUIS}'`)).toEqual({ activo: false });
    await comoCoordinacion();
    // Repetirlo no duplica la bitácora
    await db.query(`select inhabilitar_usuario('${U_LUIS}')`);
    expect(await n(`select count(*) n from bitacora where accion = 'usuario_inhabilitado'`)).toBe(2); // + la de coordinación de arriba
  });

  it('habilitar devuelve el acceso y la ficha', async () => {
    await db.query(`select habilitar_usuario('${U_LUIS}')`);
    const cuenta = await leerComoAdmin<{ banned_until: string | null; ficha: boolean }>(
      `select banned_until, (select activo from tecnicos where id = '${LUIS}') ficha from auth.users where id = '${U_LUIS}'`);
    expect(cuenta).toEqual({ banned_until: null, ficha: true });
    await como(U_LUIS, 'luis@noc.test');
    expect(await n('select count(*) n from casos')).toBe(1);
    await comoCoordinacion();
  });

  it('pone una contraseña temporal y cierra las sesiones de esa persona', async () => {
    await como(null);
    await db.exec(`insert into auth.sessions (user_id) values ('${U_LUIS}')`);
    await comoCoordinacion();
    await expect(db.query(`select cambiar_contrasena_de_usuario('${U_LUIS}', '1234')`)).rejects.toThrow(/entre 8 y 72/);
    await db.query(`select cambiar_contrasena_de_usuario('${U_LUIS}', 'Nueva-clave-9')`);
    const cuenta = await leerComoAdmin<{ ok: boolean; sesiones: number }>(
      `select encrypted_password = extensions.crypt('Nueva-clave-9', encrypted_password) ok,
              (select count(*)::int from auth.sessions where user_id = '${U_LUIS}') sesiones
       from auth.users where id = '${U_LUIS}'`);
    expect(cuenta).toEqual({ ok: true, sesiones: 0 });
    expect(await n(`select count(*) n from bitacora where accion = 'contrasena_temporal' and detalle not like '%Nueva-clave%'`)).toBe(1);
  });
});
