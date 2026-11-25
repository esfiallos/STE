# Evaluación: llevar el sitio de GitHub Pages a Cloudflare

Fecha: 24/11/2026. Estado: **evaluación, nada aplicado.** El repositorio no cambia hasta que se decida.

## 1. Resumen

Es viable y de bajo riesgo: la app es un sitio estático (Astro sin SSR) que habla directo con Supabase, así que
Cloudflare solo tiene que servir `dist/`. No hay que tocar la base de datos ni la lógica de la app.

**Recomendación:** usar **Cloudflare Workers con archivos estáticos** (no Pages) y **publicar desde GitHub Actions**
con `wrangler`, conservando el workflow actual (verificar → compilar → comprobar → publicar).

- Cloudflare dice que Pages sigue funcionando, pero que todo el trabajo nuevo va a Workers y que los proyectos
  nuevos deberían empezar ahí ([anuncio](https://blog.cloudflare.com/full-stack-development-on-cloudflare-workers/),
  [guía de migración Pages → Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)).
  Empezar en Pages significaría migrar dos veces.
- Pages solo gana si el dominio propio **no** está en Cloudflare (Workers exige que el DNS del dominio lo maneje
  Cloudflare). Sin dominio propio, `*.workers.dev` sirve igual que `*.pages.dev`.
- Publicar desde Actions (en vez de que Cloudflare compile por su cuenta al hacer push) mantiene los candados que
  hoy tiene `deploy.yml`: pruebas en verde, secretos correctos, clave publicable, sin marca `[DEV]`.

## 2. Qué se gana

| | GitHub Pages (hoy) | Cloudflare |
|---|---|---|
| Cabeceras HTTP propias | No (por eso la CSP va en `<meta>`) | Sí, con `_headers` |
| Anti-clickjacking (`frame-ancestors`) | No funciona desde `<meta>` | Sí, por cabecera |
| Ruta del sitio | `/STE/` (necesita `BASE_PATH`) | `/` en la raíz |
| Volver a una versión anterior | `git revert` + nuevo deploy | Un clic en el panel (o `wrangler rollback`) |
| Entorno DEV en línea | No | Posible (URL de vista previa, ver §5) |
| Costo | Gratis | Gratis (los archivos estáticos no se cobran) |
| Repositorio | Debe ser público en el plan gratis de Pages | Puede ser privado |

Lo más valioso para el proyecto es la seguridad: con cabeceras reales se completa D35 (`frame-ancestors 'none'`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) y la CSP deja de depender de `<meta>`.

## 3. Qué cambia en el repositorio

1. **`wrangler.jsonc`** (nuevo), sin script, solo archivos:
   ```jsonc
   {
     "name": "panel-noc",
     "compatibility_date": "2026-11-01",
     "assets": {
       "directory": "./dist",
       "not_found_handling": "404-page",
       "html_handling": "auto-trailing-slash"
     }
   }
   ```
   `auto-trailing-slash` hace que `/login` lleve a `/login/`, como hoy. Conviene agregar `src/pages/404.astro`
   (hoy no existe).
2. **`deploy.yml`**: el paso "Publicar en la rama gh-pages" se reemplaza por
   `cloudflare/wrangler-action` con `command: deploy`. Secretos nuevos en el entorno `production`:
   `CLOUDFLARE_API_TOKEN` (permiso *Workers Scripts: Edit*, solo esa cuenta) y `CLOUDFLARE_ACCOUNT_ID`.
   `SITE_URL` = la dirección nueva y `BASE_PATH` = `/`. Se quita `touch dist/.nojekyll` y `contents: write`.
   El resto del workflow queda igual (la comprobación de `BASE_PATH` ya se salta cuando vale `/`).
3. **Cabeceras** `dist/_headers`: la CSP depende de `PUBLIC_SUPABASE_URL`, así que se genera al compilar (un paso
   del workflow o una integración pequeña de Astro), con la misma política que `Layout.astro` más
   `frame-ancestors 'none'`. Los archivos de `/_astro/*` llevan nombre con hash: `Cache-Control: public,
   max-age=31536000, immutable`. La `<meta>` de la CSP puede quedarse como respaldo o quitarse.
4. **Documentación**: `docs/ENTORNOS_Y_DESPLIEGUE.md` §1, §4, §5 y §7, el comentario de `Layout.astro` y
   `astro.config.mjs` (que hoy explica GitHub Pages).

No cambian: `src/` (las rutas ya salen de `RUTAS`/`BASE_PATH`), `sql/`, las pruebas ni `ci.yml`.

## 4. Pasos fuera del repositorio

1. Cuenta de Cloudflare (gratis) → crear el token de API con el mínimo permiso.
2. Primer `wrangler deploy` (desde Actions o a mano) → queda en `https://panel-noc.<cuenta>.workers.dev`.
3. **Supabase PROD** → Authentication → URL Configuration: *Site URL* = la dirección nueva; agregar
   `https://<dirección nueva>/restablecer/` en *Redirect URLs*. Dejar la de GitHub Pages hasta terminar el cambio.
4. Probar en la dirección nueva con una cuenta real: login, recuperar contraseña (el enlace del correo),
   tablero en tiempo real (Realtime pasa por `wss://`, la CSP debe permitirlo), traspaso, campanas.
5. Avisar al equipo y cambiar el enlace que usan. Luego apagar GitHub Pages (Settings → Pages) y borrar la rama
   `gh-pages`. Si se quiere, dejar antes en `gh-pages` una página que redirija a la dirección nueva.

## 5. Opcional: DEV en línea

Hoy DEV solo corre en `bun run dev`. Con Cloudflare se puede publicar la rama `desarrollo` contra la base DEV en una
URL de vista previa (`wrangler versions upload` en un workflow de esa rama). Requiere:
- Permitir compilar con `PUBLIC_APP_ENV=development` (hoy `services/environment.ts` lo rechaza a propósito):
  por ejemplo un modo `preview` que mantenga la insignia **DESARROLLO** y el título `[DEV]`.
- Proteger esa URL con **Cloudflare Access** (gratis hasta 50 usuarios) para que no sea pública.
- Agregar la URL de vista previa a *Redirect URLs* de Supabase DEV.

Recomendación: dejarlo para después de mover producción.

## 6. Riesgos y cosas a tener en cuenta

- **Cambia el origen del sitio** (de `esfiallos.github.io` a la dirección nueva). Lo que el navegador guarda por
  origen no se traslada:
  - la **sesión** de Supabase: cada usuario vuelve a iniciar sesión una vez;
  - el **permiso de notificaciones** de escritorio: hay que volver a darlo;
  - las **etiquetas propias** (`localStorage`, `panel-noc:etiquetas-propias`), los filtros recordados y la paleta
    del correo del traspaso: se pierden. Si importan las etiquetas propias, avisar antes para que se anoten, o
    hacer una exportación/importación simple.
- Si el enlace de recuperar contraseña sigue apuntando a GitHub Pages es porque falta el paso 4.3.
- Un dominio propio en Workers exige que su DNS esté en Cloudflare. Si el dominio vive en otro proveedor y no se
  puede mover, usar **Pages** en su lugar (todo lo demás de este documento aplica igual, con `wrangler pages deploy
  dist`).
- El plan gratis de Workers limita las *invocaciones de script*, no los archivos estáticos: este sitio no tiene
  script, así que no aplica.

## 7. Esfuerzo estimado

Medio día: cambios del repositorio y prueba en la dirección nueva (§3, §4.1–4.4). El corte con el equipo (§4.5)
cuando convenga, en un horario de poco movimiento (no cerca de las 06:00, cambio de día operativo).
