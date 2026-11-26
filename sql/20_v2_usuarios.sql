-- =====================================================================
-- Panel NOC · v2.9 · Usuarios desde coordinación
-- Requiere 04 a 19. Idempotente: se puede ejecutar más de una vez.
--
-- D39: coordinación crea cuentas, cambia nombre y rol, pone contraseñas temporales e inhabilita/habilita usuarios
-- desde la pestaña "Usuarios". Lo hacen funciones SECURITY DEFINER que solo aceptan a coordinación (lo mismo que
-- el procedimiento manual de docs/interno/ALTA_DE_USUARIOS.md, pero con reglas y bitácora):
--   · Crear: cuenta de Auth confirmada con contraseña temporal (sin correo: el proyecto no tiene SMTP propio) +
--     perfil con su rol + ficha de técnico si es técnico (reutiliza una ficha libre con el mismo nombre).
--   · Inhabilitar (alguien se va o es despedido): el perfil queda inactivo, Auth bloquea la cuenta y se cierran sus
--     sesiones. Con el perfil inactivo, mi_rol()/tiene_perfil()/mi_tecnico_id() no lo reconocen: pierde el acceso al
--     instante aunque su sesión siga abierta. Si era técnico, su ficha se desactiva y se quita de la planificación
--     futura; su historial y sus casos se conservan (los abiertos se reparten desde "Por reasignar").
--   · Nadie se cambia el rol ni se inhabilita a sí mismo, y siempre queda al menos una persona de coordinación activa.
--   · Nada se borra: las cuentas se inhabilitan.
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

begin;

-- ---------------------------------------------------------------------
-- 1. Perfil activo / inhabilitado
-- ---------------------------------------------------------------------
alter table public.perfiles add column if not exists activo           boolean not null default true;
alter table public.perfiles add column if not exists inhabilitado_en  timestamptz;
alter table public.perfiles add column if not exists inhabilitado_por text;

comment on column public.perfiles.activo is 'false = inhabilitado por coordinación (D39): no entra ni ve nada; se conserva su historial.';
comment on table public.perfiles is 'Rol de cada usuario. Lo administra coordinación (pestaña Usuarios, D39). Un técnico se enlaza a su fila de tecnicos.';

-- Las funciones de rol solo reconocen perfiles activos (así un inhabilitado pierde el acceso al instante).
create or replace function public.mi_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.perfiles where id = auth.uid() and activo;
$$;

create or replace function public.mi_tecnico_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tecnico_id from public.perfiles where id = auth.uid() and rol = 'tecnico' and activo;
$$;

create or replace function public.tiene_perfil()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and activo);
$$;

-- ---------------------------------------------------------------------
-- 2. Piezas internas (no se llaman desde la app)
-- ---------------------------------------------------------------------
create or replace function public.exigir_coordinacion()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_coordinador() then
    raise exception 'Solo coordinación puede administrar usuarios.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.validar_datos_de_usuario(p_nombre text, p_rol text)
returns void
language plpgsql
immutable
as $$
begin
  if char_length(btrim(coalesce(p_nombre, ''))) not between 1 and 80 then
    raise exception 'El nombre es obligatorio (máximo 80 caracteres).';
  end if;
  if p_rol is null or p_rol not in ('tecnico', 'dispatch', 'coordinador') then
    raise exception 'Rol no válido: elige Técnico, Dispatch o Coordinación.';
  end if;
end;
$$;

create or replace function public.validar_contrasena_temporal(p_contrasena text)
returns void
language plpgsql
immutable
as $$
begin
  -- bcrypt usa como máximo 72 bytes
  if char_length(coalesce(p_contrasena, '')) < 8 or octet_length(p_contrasena) > 72 then
    raise exception 'La contraseña temporal debe tener entre 8 y 72 caracteres.';
  end if;
end;
$$;

-- Coordinadores activos que quedarían si `p_usuario` deja de serlo.
create or replace function public.otros_coordinadores_activos(p_usuario uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.perfiles where rol = 'coordinador' and activo and id <> p_usuario;
$$;

-- Ficha de técnico para un usuario: reutiliza la que tenga el mismo nombre si no es de otro usuario (y la activa),
-- o crea una nueva.
create or replace function public.ficha_de_tecnico_para(p_usuario uuid, p_nombre text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tecnico uuid;
begin
  select id into v_tecnico from public.tecnicos where lower(btrim(nombre)) = lower(btrim(p_nombre));
  if v_tecnico is null then
    insert into public.tecnicos (nombre) values (btrim(p_nombre)) returning id into v_tecnico;
    return v_tecnico;
  end if;
  if exists (select 1 from public.perfiles where tecnico_id = v_tecnico and id <> p_usuario) then
    raise exception 'Ya hay otro usuario enlazado al técnico "%": usa otro nombre.', btrim(p_nombre) using errcode = '23505';
  end if;
  update public.tecnicos set activo = true where id = v_tecnico and not activo;
  return v_tecnico;
end;
$$;

create or replace function public.nombre_de_rol(p_rol text)
returns text
language sql
immutable
as $$
  select case p_rol when 'tecnico' then 'Técnico' when 'dispatch' then 'Dispatch' when 'coordinador' then 'Coordinación'
                    else 'Sin rol' end;
$$;

create or replace function public.anotar_en_bitacora_de_usuarios(p_accion text, p_nombre text, p_detalle text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.bitacora (usuario_id, usuario_email, accion, tecnico, detalle)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', 'sistema'), p_accion, p_nombre, p_detalle);
$$;

revoke all on function public.exigir_coordinacion() from public, anon, authenticated;
revoke all on function public.validar_datos_de_usuario(text, text) from public, anon, authenticated;
revoke all on function public.validar_contrasena_temporal(text) from public, anon, authenticated;
revoke all on function public.otros_coordinadores_activos(uuid) from public, anon, authenticated;
revoke all on function public.ficha_de_tecnico_para(uuid, text) from public, anon, authenticated;
revoke all on function public.anotar_en_bitacora_de_usuarios(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Lista de usuarios (incluye cuentas de Auth sin perfil, para darles rol)
-- ---------------------------------------------------------------------
drop function if exists public.usuarios_de_la_app();
create or replace function public.usuarios_de_la_app()
returns table (
  id uuid, correo text, nombre text, rol text, activo boolean, tecnico_id uuid,
  ultimo_ingreso timestamptz, creado_en timestamptz, inhabilitado_en timestamptz, inhabilitado_por text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.exigir_coordinacion();
  return query
    select u.id, u.email::text, coalesce(p.nombre, u.raw_user_meta_data ->> 'nombre', split_part(u.email::text, '@', 1)),
           p.rol, coalesce(p.activo, true), p.tecnico_id,
           u.last_sign_in_at, u.created_at, p.inhabilitado_en, p.inhabilitado_por
    from auth.users u
    left join public.perfiles p on p.id = u.id
    order by coalesce(p.activo, true) desc, lower(coalesce(p.nombre, u.email::text));
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Crear un usuario
-- ---------------------------------------------------------------------
create or replace function public.crear_usuario(p_correo text, p_nombre text, p_rol text, p_contrasena text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correo text := lower(btrim(coalesce(p_correo, '')));
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_usuario uuid := gen_random_uuid();
  v_tecnico uuid;
begin
  perform public.exigir_coordinacion();
  if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_correo) > 254 then
    raise exception 'Escribe un correo válido.';
  end if;
  perform public.validar_datos_de_usuario(v_nombre, p_rol);
  perform public.validar_contrasena_temporal(p_contrasena);
  if exists (select 1 from auth.users where lower(email) = v_correo) then
    raise exception 'Ya existe una cuenta con el correo %: búscala en la lista y cámbiale el rol.', v_correo using errcode = '23505';
  end if;

  -- Igual que docs/interno/ALTA_DE_USUARIOS.md: los tokens van como '' (no null) o Auth falla al iniciar sesión
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_usuario, 'authenticated', 'authenticated', v_correo,
    extensions.crypt(p_contrasena, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', v_nombre), now(), now(),
    '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (v_usuario::text, v_usuario,
          jsonb_build_object('sub', v_usuario::text, 'email', v_correo, 'email_verified', true), 'email', now(), now());

  if p_rol = 'tecnico' then
    v_tecnico := public.ficha_de_tecnico_para(v_usuario, v_nombre);
  end if;
  insert into public.perfiles (id, nombre, rol, tecnico_id) values (v_usuario, v_nombre, p_rol, v_tecnico);

  perform public.anotar_en_bitacora_de_usuarios('usuario_creado', v_nombre,
    format('%s · %s', v_correo, public.nombre_de_rol(p_rol)));
  return v_usuario;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Cambiar nombre y rol (también da rol a una cuenta que no tenía perfil)
-- ---------------------------------------------------------------------
create or replace function public.actualizar_usuario(p_usuario uuid, p_nombre text, p_rol text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_perfil public.perfiles%rowtype;
  v_tecnico uuid;
  v_cambios text[] := '{}';
begin
  perform public.exigir_coordinacion();
  perform public.validar_datos_de_usuario(v_nombre, p_rol);
  if not exists (select 1 from auth.users where id = p_usuario) then
    raise exception 'Ese usuario ya no existe.';
  end if;
  select * into v_perfil from public.perfiles where id = p_usuario;

  if p_usuario = auth.uid() and v_perfil.rol is distinct from p_rol then
    raise exception 'No puedes cambiar tu propio rol: pídeselo a otra persona de coordinación.';
  end if;
  if v_perfil.rol = 'coordinador' and p_rol <> 'coordinador' and v_perfil.activo
     and public.otros_coordinadores_activos(p_usuario) = 0 then
    raise exception 'Debe quedar al menos una persona de coordinación activa.';
  end if;

  if p_rol = 'tecnico' then
    if v_perfil.tecnico_id is not null then
      v_tecnico := v_perfil.tecnico_id;
      begin
        update public.tecnicos set nombre = v_nombre, activo = coalesce(v_perfil.activo, true) where id = v_tecnico;
      exception when unique_violation then
        raise exception 'Ya hay un técnico llamado "%": usa otro nombre.', v_nombre using errcode = '23505';
      end;
    else
      v_tecnico := public.ficha_de_tecnico_para(p_usuario, v_nombre);
      if v_perfil.activo = false then
        update public.tecnicos set activo = false where id = v_tecnico;
      end if;
    end if;
  elsif v_perfil.tecnico_id is not null then
    -- Deja de ser técnico: su ficha se desactiva (los técnicos no se borran: tienen historial)
    update public.tecnicos set activo = false where id = v_perfil.tecnico_id;
  end if;

  insert into public.perfiles (id, nombre, rol, tecnico_id)
  values (p_usuario, v_nombre, p_rol, v_tecnico)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, tecnico_id = excluded.tecnico_id;

  if v_perfil.id is null then
    v_cambios := v_cambios || format('rol asignado: %s', public.nombre_de_rol(p_rol));
  else
    if v_perfil.rol is distinct from p_rol then
      v_cambios := v_cambios || format('rol: %s → %s', public.nombre_de_rol(v_perfil.rol), public.nombre_de_rol(p_rol));
    end if;
    if v_perfil.nombre is distinct from v_nombre then
      v_cambios := v_cambios || format('nombre: %s → %s', v_perfil.nombre, v_nombre);
    end if;
  end if;
  if cardinality(v_cambios) > 0 then
    perform public.anotar_en_bitacora_de_usuarios('usuario_actualizado', v_nombre, array_to_string(v_cambios, ' · '));
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Inhabilitar y volver a habilitar
-- ---------------------------------------------------------------------
-- Devuelve cuántos casos abiertos tiene (si era técnico), para avisar que hay que repartirlos.
create or replace function public.inhabilitar_usuario(p_usuario uuid, p_motivo text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil public.perfiles%rowtype;
  v_abiertos integer := 0;
begin
  perform public.exigir_coordinacion();
  if p_usuario = auth.uid() then
    raise exception 'No puedes inhabilitar tu propio usuario.';
  end if;
  select * into v_perfil from public.perfiles where id = p_usuario;
  if v_perfil.id is null then
    raise exception 'Esa cuenta no tiene rol en la app: ya no puede entrar.';
  end if;
  if char_length(coalesce(p_motivo, '')) > 500 then
    raise exception 'El motivo admite como máximo 500 caracteres.';
  end if;

  if v_perfil.activo then
    if v_perfil.rol = 'coordinador' and public.otros_coordinadores_activos(p_usuario) = 0 then
      raise exception 'Debe quedar al menos una persona de coordinación activa.';
    end if;
    update public.perfiles
    set activo = false, inhabilitado_en = now(), inhabilitado_por = coalesce(auth.jwt() ->> 'email', 'sistema')
    where id = p_usuario;
    perform public.anotar_en_bitacora_de_usuarios('usuario_inhabilitado', v_perfil.nombre,
      coalesce(nullif(btrim(p_motivo), ''), 'Sin motivo'));
  end if;

  -- Auth: bloqueada 100 años (como el "ban" del panel de Supabase) y sin sesiones abiertas
  update auth.users set banned_until = now() + interval '100 years', updated_at = now() where id = p_usuario;
  delete from auth.sessions where user_id = p_usuario;

  if v_perfil.tecnico_id is not null then
    update public.tecnicos set activo = false where id = v_perfil.tecnico_id;
    delete from public.jornadas where tecnico_id = v_perfil.tecnico_id and fecha_operativa > public.fecha_operativa();
    select count(*)::int into v_abiertos from public.casos where tecnico_actual_id = v_perfil.tecnico_id and estado <> 'cerrado';
  end if;
  return v_abiertos;
end;
$$;

create or replace function public.habilitar_usuario(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil public.perfiles%rowtype;
begin
  perform public.exigir_coordinacion();
  select * into v_perfil from public.perfiles where id = p_usuario;
  if v_perfil.id is null then
    raise exception 'Esa cuenta no tiene rol en la app: asígnale uno.';
  end if;
  update auth.users set banned_until = null, updated_at = now() where id = p_usuario;
  if not v_perfil.activo then
    update public.perfiles set activo = true, inhabilitado_en = null, inhabilitado_por = null where id = p_usuario;
    if v_perfil.tecnico_id is not null then
      update public.tecnicos set activo = true where id = v_perfil.tecnico_id;
    end if;
    perform public.anotar_en_bitacora_de_usuarios('usuario_habilitado', v_perfil.nombre, null);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Contraseña temporal (sin SMTP no hay correo de recuperación)
-- ---------------------------------------------------------------------
create or replace function public.cambiar_contrasena_de_usuario(p_usuario uuid, p_contrasena text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
begin
  perform public.exigir_coordinacion();
  perform public.validar_contrasena_temporal(p_contrasena);
  update auth.users
  set encrypted_password = extensions.crypt(p_contrasena, extensions.gen_salt('bf')), updated_at = now()
  where id = p_usuario
  returning coalesce(raw_user_meta_data ->> 'nombre', email::text) into v_nombre;
  if not found then
    raise exception 'Ese usuario ya no existe.';
  end if;
  -- Quien tenía la sesión abierta con la contraseña anterior debe volver a entrar (salvo uno mismo)
  if p_usuario <> auth.uid() then
    delete from auth.sessions where user_id = p_usuario;
  end if;
  perform public.anotar_en_bitacora_de_usuarios('contrasena_temporal', coalesce((select nombre from public.perfiles where id = p_usuario), v_nombre),
    'Coordinación puso una contraseña temporal');
end;
$$;

revoke all on function public.usuarios_de_la_app() from public, anon;
revoke all on function public.crear_usuario(text, text, text, text) from public, anon;
revoke all on function public.actualizar_usuario(uuid, text, text) from public, anon;
revoke all on function public.inhabilitar_usuario(uuid, text) from public, anon;
revoke all on function public.habilitar_usuario(uuid) from public, anon;
revoke all on function public.cambiar_contrasena_de_usuario(uuid, text) from public, anon;
grant execute on function public.usuarios_de_la_app() to authenticated;
grant execute on function public.crear_usuario(text, text, text, text) to authenticated;
grant execute on function public.actualizar_usuario(uuid, text, text) to authenticated;
grant execute on function public.inhabilitar_usuario(uuid, text) to authenticated;
grant execute on function public.habilitar_usuario(uuid) to authenticated;
grant execute on function public.cambiar_contrasena_de_usuario(uuid, text) to authenticated;

commit;
