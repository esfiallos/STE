# Entornos y despliegue

Hay dos entornos completos (app **y** base de datos). Solo producción se publica.

| | Desarrollo | Producción |
|---|---|---|
| Dónde corre | Solo en tu computador (`bun run dev`) | GitHub Pages, rama `gh-pages` |
| Base de datos | Proyecto Supabase **DEV** | Proyecto Supabase **PROD**  |
| Configuración | Archivo `.env.development` | Secretos de GitHub, entorno `production` |
| `PUBLIC_APP_ENV` | `development` | `production` |
| Se reconoce porque | Insignia naranja **DESARROLLO** y título `[DEV]` | Sin insignia |
| Rama de código | `dev` y ramas de trabajo  | `main` (verifica, compila y publica) |

La app se niega a arrancar si el entorno no coincide con el modo (por ejemplo, un `.env` de producción en
`bun run dev`), para que nunca pruebes sobre la base real creyendo que es la de desarrollo.


## 1. Configurar GitHub

1. **Secretos de producción:** Settings → Environments → *New environment* → `production` → *Add secret*:
   - `PUBLIC_SUPABASE_URL` (URL del proyecto PROD)
   - `PUBLIC_SUPABASE_PUBLISHABLE_KEY` 

2. **Ruta base:** el workflow usa `/<nombre-del-repositorio>`. Si usas dominio propio o un repositorio llamado
   `usuario.github.io`, crea la variable `BASE_PATH` con el valor `/` (Settings → Secrets and variables → Actions → Variables).
3. **Hacer commit de `bun.lock`:** ejecuta `bun install` y sube el `bun.lock` actualizado. El CI usa
   `--frozen-lockfile` y falla si el lockfile no coincide con `package.json`.
4. Haz el push a `main`. El workflow crea y trabaja la rama `gh-pages`.
5. **Activar Pages:** Settings → Pages → *Deploy from a branch* → rama `gh-pages`, carpeta `/ (root)`.
6. En Supabase PROD: Authentication → URL Configuration → *Site URL* = la dirección de tu GitHub Pages.

## 4. Flujo de trabajo

```
rama de trabajo ──► pull request a main ──► CI (tipos + pruebas) ──► merge a main ──► Deploy ──► gh-pages
   (solo se verifica)                                                  (verifica otra vez, compila, publica)
```

- Cualquier rama y cualquier PR hacia `main` ejecuta **CI**: nunca publica.
- Un push a `main` ejecuta **Desplegar a producción**. También puedes lanzarlo a mano desde la pestaña Actions
  (*Run workflow*).
- **Volver atrás:** haz `git revert` del commit en `main`; se vuelve a desplegar el estado anterior.

## 5. Qué hace cada workflow

| Archivo | Cuándo corre | Qué hace |
|---|---|---|
| `verificar.yml` | Lo llaman los otros dos | Instala, revisa tipos (`astro check`) y ejecuta las pruebas |
| `ci.yml` | PR a `main` y push a cualquier rama salvo `main` y `gh-pages` | Solo verifica |
| `deploy.yml` | Push a `main` o a mano | Verifica → comprueba los secretos → compila → revisa el resultado → publica en `gh-pages` |

Antes de publicar, `deploy.yml` se detiene si falta un secreto, si la clave no es la publicable, si las rutas no
respetan la ruta base o si la compilación lleva la marca de desarrollo.

## 6. Pruebas

```bash
bun run test        # compila y ejecuta todo (lo mismo que hace el CI)
bun run test:unit   # solo reglas de dominio, sin compilar (rápido)
bun run test:watch  # modo interactivo mientras programas
bun run check       # tipos
```

- `tests/domain/`: tiempo, turnos, comodín, disponibilidad, métricas, búsqueda, entorno y rutas.
- `tests/app/`: la app real contra un Supabase simulado: disponibilidad, almuerzo, asignación rápida, INC único,
  arrastre, Modo Consulta, historial y pestañas.
- `tests/sql/`: ejecuta `sql/` en un PostgreSQL de prueba: migración sobre datos existentes, comodín, INC único,
  bitácora con el usuario, snapshot, búsquedas, permisos y la protección del script de datos de demo.

Ninguna prueba toca una base real.

## 7. Problemas comunes

| Síntoma | Causa |
|---|---|
| El CI falla con `Cannot find module '../../src/...'` o `ENOENT ... sql/...` | El repositorio está incompleto o mezcla versiones: reemplaza `src/`, `tests/` y `sql/` con los del paquete completo. Antes de subir, ejecuta `bun run check` y `bun run test` en tu computador: fallan igual que en el CI |
| El CI falla en "Instalar dependencias" | `bun.lock` desactualizado: ejecuta `bun install` y súbelo |
| El sitio publicado carga sin estilos o da 404 | `BASE_PATH` no coincide con la dirección de Pages |
| Pantalla en blanco al abrir; consola: "PUBLIC_APP_ENV vale…" | Falta `.env.development` (en local) o `PUBLIC_APP_ENV` en la compilación |
| `bun run dev` dice "Estás en desarrollo pero…" | `.env.development` no declara `PUBLIC_APP_ENV=development` |
| El deploy falla en "Comprobar la configuración" | Falta un secreto en el entorno `production`, o la clave no es la publicable |
