import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const leerSql = (archivo: string) => readFileSync(resolve(process.cwd(), 'sql', archivo), 'utf8');

/** Quita el bloque final de pg_cron (solo existe en Supabase) a partir de su encabezado. */
const sinCron = (sql: string, marcador: string) => sql.split(marcador)[0]!.replace(/-- =+\s*$/, '');

export const MIGRACIONES = {
  esquema: () => leerSql('01_schema_inicial.sql'),
  v3: () => sinCron(leerSql('02_migracion_v3.sql'), '-- 5. Programar'),
  v4: () => leerSql('04_v2_modelo_base.sql'),
  corte: () => sinCron(leerSql('05_v2_corte.sql'), '-- 5. Snapshot diario'),
  seguimiento: () => leerSql('06_v2_seguimiento.sql'),
  traspasos: () => sinCron(leerSql('07_v2_traspasos.sql'), '-- 6. Recordatorios'),
  coordinador: () => sinCron(leerSql('08_v2_coordinador.sql'), '-- 6. Alertas cada 5 minutos'),
  ronda: () => leerSql('09_v2_ronda.sql'),
  planificacion: () => leerSql('10_v2_planificacion.sql'),
  tableroDelDia: () => leerSql('11_v2_tablero_del_dia.sql'),
  seguimientoDescripcion: () => leerSql('12_v2_seguimiento_descripcion.sql'),
  filtros: () => leerSql('13_v2_filtros.sql'),
  turnoC: () => leerSql('14_v2_turno_c_variantes.sql'),
  traspasoPropio: () => leerSql('15_v2_traspaso_propio.sql'),
  proteccion: () => sinCron(leerSql('16_v2_proteccion_de_casos.sql'), '-- 4. Vigilar'),
  entregaSupervision: () => leerSql('17_v2_entrega_por_supervision.sql'),
  planificacionConAviso: () => leerSql('18_v2_planificacion_con_aviso.sql'),
  rendimiento: () => sinCron(leerSql('19_v2_rendimiento.sql'), '-- 4. Limpiar el registro'),
  usuarios: () => leerSql('20_v2_usuarios.sql'),
  demo: () => leerSql('03_datos_demo_dev.sql')
};

/**
 * PostgreSQL de prueba con lo que Supabase aporta: roles, auth.users (con las columnas que usa la migración 20),
 * auth.uid()/jwt(), las extensiones en el esquema `extensions`, permisos por defecto y la publicación.
 */
export async function crearBaseSupabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated;
    create schema extensions;
    create extension pg_trgm with schema extensions;
    create extension pgcrypto with schema extensions;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create table auth.users (
      id uuid primary key, email text, instance_id uuid, aud text, role text, encrypted_password text,
      email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
      created_at timestamptz default now(), updated_at timestamptz, last_sign_in_at timestamptz, banned_until timestamptz,
      confirmation_token text, recovery_token text, email_change_token_new text, email_change text
    );
    create table auth.identities (
      id uuid primary key default gen_random_uuid(), provider_id text, user_id uuid references auth.users (id) on delete cascade,
      identity_data jsonb, provider text, created_at timestamptz, updated_at timestamptz
    );
    create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id) on delete cascade);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create publication supabase_realtime;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  return db;
}

/** Devuelve una función para actuar como un usuario de la app (rol authenticated + su JWT) o como administrador (null). */
export function actuarComo(db: PGlite) {
  return async (uid: string | null, correo = '') => {
    await db.exec('reset role');
    const claims = uid ? JSON.stringify({ sub: uid, email: correo }) : '';
    await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [uid ?? '', claims]);
    if (uid) await db.exec('set role authenticated');
  };
}
