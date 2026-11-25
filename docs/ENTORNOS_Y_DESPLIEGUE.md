# Entornos y despliegue

Hay dos entornos completos (app **y** base de datos). Los dos se publican en **Cloudflare** (Workers con archivos
estáticos, `wrangler.jsonc`) desde GitHub Actions, cada uno desde su rama y contra su base.

| | Desarrollo | Producción |
|---|---|---|
| Dónde corre | `bun run dev` (local) **y** worker `panel-noc-dev` | Worker `panel-noc` |
| Dirección | `https://panel-noc-dev.<subdominio>.workers.dev` | `https://panel-noc.<subdominio>.workers.dev` |
| Base de datos | Proyecto Supabase **DEV** (`bofqefbxziqxzrdujihd`) | Proyecto Supabase **STE** (`kkslgsgapodpzuifjrwz`) |
| Configuración | `.env.development` (local) · entorno de GitHub `development` | Entorno de GitHub `production` |
| `PUBLIC_APP_ENV` | `development` | `production` |
| Se reconoce porque | Insignia naranja **DESARROLLO** y título `[DEV]` | Sin insignia |
| Rama que publica | `desarrollo` (`deploy-dev.yml`) | `main` (`deploy.yml`) |

`bun run dev` se niega a arrancar si `PUBLIC_APP_ENV` no es `development`, y cada workflow comprueba antes de
compilar que la URL de Supabase sea la del proyecto que le toca: DEV nunca se publica contra la base real ni al
revés. La compilación de producción no puede llevar la insignia de desarrollo, y la de DEV debe llevarla.

`<subdominio>` es el de la cuenta de Cloudflare (Workers & Pages → *Your subdomain*).


## 1. Configurar Cloudflare y GitHub (una sola vez)

1. **Cuenta de Cloudflare** (plan gratis). Anota el *Account ID* (Workers & Pages, columna derecha) y elige el
   subdominio de `workers.dev` si te lo pide.
2. **Token de API:** My Profile → API Tokens → *Create Token* → plantilla **Edit Cloudflare Workers** → limita
   *Account Resources* a tu cuenta → crea y copia el token (se muestra una sola vez).
3. **Secretos del repositorio** (Settings → Secrets and variables → Actions → *Repository secrets*):
   `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.
4. **Entornos de GitHub** (Settings → Environments), cada uno con sus secretos:
   - `production`: `PUBLIC_SUPABASE_URL` = `https://kkslgsgapodpzuifjrwz.supabase.co` y
     `PUBLIC_SUPABASE_PUBLISHABLE_KEY` = la clave publicable de STE.
   - `development` (nuevo): `PUBLIC_SUPABASE_URL` = `https://bofqefbxziqxzrdujihd.supabase.co` y la clave
     publicable de DEV.
   - En cada uno, la variable `SITE_URL` con su dirección (opcional: solo da el enlace en Actions).
   - Opcional: en `production`, *Deployment branches* = solo `main`; en `development`, solo `desarrollo`.
5. **`bun.lock` al día:** el CI usa `--frozen-lockfile` y falla si no coincide con `package.json`.
6. Push a `desarrollo` → se publica DEV. Merge/push a `main` → se publica producción. También se pueden lanzar a
   mano desde Actions (*Run workflow*).
7. **Supabase, en cada proyecto** (Authentication → URL Configuration):
   - PROD: *Site URL* = `https://panel-noc.<subdominio>.workers.dev`; *Redirect URLs* +=
     `https://panel-noc.<subdominio>.workers.dev/restablecer/`.
   - DEV: *Redirect URLs* += `https://panel-noc-dev.<subdominio>.workers.dev/restablecer/` (la *Site URL* puede
     seguir en `http://localhost:4321`, con `http://localhost:4321/restablecer/` también en la lista).

   Si falta, el correo de recuperación llega pero el enlace abre la *Site URL* en vez de `/restablecer/`.
   La página va **directo** en la raíz: `/restablecer/`, no dentro de `/login/`.
8. **Correos:** el servidor de correo incluido en Supabase solo envía a los miembros del equipo del proyecto y con
   un límite bajo por hora. Para que les llegue a todos los técnicos, configura un SMTP propio en
   Authentication → Emails → *SMTP Settings* (Enable custom SMTP). Opción sin dominio propio, con una cuenta de Gmail:
   1. En la cuenta de Google activa la verificación en 2 pasos y crea una **contraseña de aplicación**
      (Cuenta de Google → Seguridad → Contraseñas de aplicaciones). Son 16 letras; no es tu contraseña normal.
   2. En Supabase: *Sender email* = esa cuenta de Gmail · *Sender name* = `Panel NOC` · *Host* =
      `smtp.gmail.com` · *Port* = `465` · *Username* = la cuenta de Gmail · *Password* = la contraseña de
      aplicación. Guarda.
   3. Authentication → Rate Limits: sube *emails per hour* (con SMTP propio ya se puede; p. ej. 30).
   4. Templates → *Reset Password*: texto del correo en español.

   Gmail permite unos 500 correos al día, de sobra para recuperar contraseñas. Si más adelante hay un dominio
   propio, un servicio transaccional (Resend, Brevo, SendGrid) es mejor para la entrega. El mismo SMTP puede
   usarse en DEV y en PROD.
9. **Cerrar el registro** (en DEV y en PROD): Authentication → Sign In / Providers → desactiva
   *Allow new users to sign up*. Las cuentas se crean solo desde el panel (procedimiento en
   `docs/interno/ALTA_DE_USUARIOS.md`). La URL y la clave publicable están en el JS público: con el registro
   abierto cualquiera podría crearse una cuenta. Desde la migración 16 una cuenta sin perfil no lee nada, pero
   cerrarlo evita cuentas basura y abuso del envío de correos. Revisa también en Authentication → Policies la
   longitud mínima de contraseña (≥ 10) y activa *Leaked password protection* si tu plan lo permite.

10. **Proteger DEV en línea** (recomendado): Workers & Pages → `panel-noc-dev` → Settings → Domains & Routes →
    en `workers.dev`, activa **Cloudflare Access** y deja solo los correos del equipo (gratis hasta 50 usuarios).
    Así la dirección de DEV no queda abierta a cualquiera (igual pide iniciar sesión en la app).
11. **Retirar GitHub Pages** cuando producción ya funcione en Cloudflare: Settings → Pages → *Unpublish* y borra la
    rama `gh-pages`. Cambiar de dirección cierra la sesión de todos una vez, pide de nuevo el permiso de
    notificaciones y pierde lo guardado en el navegador (etiquetas propias, filtros): ver `docs/CLOUDFLARE.md` §6.

## 4. Flujo de trabajo

```
rama de trabajo ──► merge a desarrollo ──► Desplegar desarrollo ──► panel-noc-dev (base DEV)
                         │
                         └──► PR a main ──► CI ──► merge a main ──► Desplegar a producción ──► panel-noc (base PROD)
```

- Las ramas de trabajo y los PR a `main` ejecutan **CI**: solo verifican, nunca publican.
- Un push a `desarrollo` ejecuta **Desplegar desarrollo**; un push a `main`, **Desplegar a producción**.
- **Volver atrás:** Workers & Pages → el worker → *Deployments* → *Rollback* (inmediato), o `git revert` en la rama
  y se vuelve a publicar.
- Las migraciones `sql/` se siguen aplicando a mano (DEV primero, luego PROD), justo antes de publicar el código que
  las necesita.

## 5. Qué hace cada workflow

| Archivo | Cuándo corre | Qué hace |
|---|---|---|
| `verificar.yml` | Lo llaman los demás | Instala, revisa tipos (`astro check`) y ejecuta las pruebas |
| `ci.yml` | PR a `main` y push a ramas que no sean `main`, `desarrollo` ni `gh-pages` | Solo verifica |
| `publicar.yml` | Lo llaman los dos de abajo | Comprueba secretos, clave publicable y proyecto de Supabase → compila → revisa `dist/` (páginas, 404, `_headers` con la CSP, insignia según entorno) → `wrangler deploy` |
| `deploy-dev.yml` | Push a `desarrollo` o a mano | Verifica → publica DEV (`--env dev`) |
| `deploy.yml` | Push a `main` o a mano | Verifica → publica producción |

La compilación escribe `dist/_headers` (integración de `astro.config.ts`, política en `src/config/seguridad.ts`):
CSP con `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `noindex`
y caché larga para `/_astro/*`. La misma CSP va también en una `<meta>` como respaldo.

## 6. Pruebas

```bash
bun run test        # compila y ejecuta todo (lo mismo que hace el CI)
bun run test:unit   # solo reglas de dominio, sin compilar (rápido)
bun run test:watch  # modo interactivo mientras programas
bun run check       # tipos
```

- `tests/domain/`: tiempo, turnos, comodín, disponibilidad, métricas, búsqueda, entorno y rutas.
- `tests/app/`: la app real contra un Supabase simulado: disponibilidad, almuerzo, asignación rápida, INC único,
  arrastre, rol técnico en solo lectura, día operativo, filtro por técnico, planificación semanal, seguimiento del técnico, notificaciones, login y restablecer contraseña, historial y pestañas.
- `tests/sql/`: ejecuta `sql/` en un PostgreSQL de prueba: migración sobre datos existentes, comodín, INC único,
  bitácora con el usuario, snapshot, búsquedas, permisos y la protección del script de datos de demo.

Ninguna prueba toca una base real.

## 7. Problemas comunes

| Síntoma | Causa |
|---|---|
| El CI falla con `Cannot find module '../../src/...'` o `ENOENT ... sql/...` | El repositorio está incompleto o mezcla versiones: reemplaza `src/`, `tests/` y `sql/` con los del paquete completo. Antes de subir, ejecuta `bun run check` y `bun run test` en tu computador: fallan igual que en el CI |
| El CI falla en "Instalar dependencias" | `bun.lock` desactualizado: ejecuta `bun install` y súbelo |
| El sitio publicado carga sin estilos o da 404 | `BASE_PATH` debe ser `/` en Cloudflare (lo fija `publicar.yml`) |
| Pantalla en blanco al abrir; consola: "PUBLIC_APP_ENV vale…" | Falta `.env.development` (en local) o `PUBLIC_APP_ENV` en la compilación |
| `bun run dev` dice "Estás en desarrollo pero…" | `.env.development` no declara `PUBLIC_APP_ENV=development` |
| El deploy falla en "Comprobar la configuración" | Falta un secreto (del entorno o `CLOUDFLARE_*` del repositorio), la clave no es la publicable o la URL no es del proyecto de Supabase de ese entorno |
| El deploy falla en "Publicar en Cloudflare" con error de autenticación | Token vencido, sin permiso *Workers Scripts: Edit* o `CLOUDFLARE_ACCOUNT_ID` de otra cuenta |
| La app publicada no conecta con Supabase (consola: "Content Security Policy") | La CSP se arma con `PUBLIC_SUPABASE_URL` al compilar: revisa el secreto del entorno |
