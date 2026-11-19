# Panel NOC · Traspasos y Turnos — contexto rápido

Panel web en tiempo real para un NOC: incidentes (INC) asignados a técnicos por turno, almuerzos,
búsqueda, Modo Consulta (solo lectura), historial diario (snapshots) y bitácora de cambios.
Todo el código, nombres y mensajes están **en español**; mantén ese idioma.

**Stack:** Astro 7 (sitio estático, sin SSR) · TypeScript estricto · SCSS · Supabase (Auth, Postgres, RLS,
Realtime, pg_cron) · Bun · Vitest (+ jsdom, + PGlite para SQL). Deploy: GitHub Pages (rama `gh-pages`).

## Comandos

```bash
bun run dev         # local, usa .env.development (base Supabase DEV)
bun run check       # tipos (astro check)
bun run test:unit   # solo tests/domain, rápido, sin build
bun run test        # build + todas las pruebas (igual que el CI)
```

## Arquitectura (cada capa solo conoce la de abajo)

```
pages/ + components/   Marcado Astro sin lógica. Lo dinámico son <template> que scripts/ clona.
        │
scripts/               Comportamiento en el navegador
  main.ts              Arranque: sesión → iniciar módulos → store.subscribe(render) → sync
  board/               Vistas del tablero, eventos, drag & drop, renderScheduler
  modals/              Un controlador por modal + assignFlow (reglas de asignación compartidas)
  features/            Pestañas, buscador, Modo Consulta, sesión, estado de conexión
  history/ audit/      Vistas de Historial y Bitácora
  actions/             Casos de uso: service → recarga (cargarDatos) → aviso/sonido
  ui/                  toast, sonido, portapapeles, tablas, formato
        │
state/                 appStore (createStore: get/set/subscribe) + sync.ts (Realtime + respaldo)
        │
services/              ÚNICO lugar que habla con Supabase. Repos devuelven Resultado<T>, nunca lanzan.
        │
domain/                Reglas puras (sin DOM ni Supabase): turnos, tiempo, disponibilidad, almuerzo,
                       métricas, búsqueda, asignaciones, bitácora
types/                 noc.ts (modelo) y result.ts (Resultado, exito, falla)
styles/                SCSS por parcial; colores/tema SOLO en abstracts/_variables.scss
```

### Flujo de datos

1. Acción del usuario → `scripts/actions/*` → `services/*Repo` (Supabase) → `Resultado`.
2. Si ok → `cargarDatos()` relee técnicos + incidentes → `appStore.set()`.
3. El store notifica → `solicitarRender()` redibuja tablero y métricas (se pospone si hay drag o
   escritura en un formulario de tarjeta).
4. Otros clientes: Realtime (`services/realtime.ts`) solo avisa "hubo cambios" → `solicitarSincronizacion()`
   (debounce 150 ms). Respaldo: relectura cada 60 s, al volver a la pestaña y al recuperar red.
5. Cada 30 s se re-renderiza solo para refrescar estados dependientes de la hora.

## Reglas del proyecto (respetar siempre)

- `domain/` no importa Supabase ni DOM: debe poder probarse aislado.
- Solo `services/` importa `supabaseClient`. Errores → `errorDeBaseDeDatos()` → `falla(...)` con mensaje en español.
- `.astro` = solo marcado; la lógica en `scripts/`, un archivo por responsabilidad.
- Texto de usuario (código, nota, nombre) siempre vía `textContent`. **Nunca `innerHTML` con datos.**
- Mapeo snake_case (BD) ↔ camelCase (TS) se hace en cada repo (`aIncidente`, etc.).
- Los horarios de turnos viven solo en `src/domain/shifts.ts` (`TURNOS`).

## Dominio clave

- Turnos: A 06–14, B 14–22, C 22–06 (cruza medianoche). **Comodín**: horario propio, aparece en todos los
  turnos que su horario toca.
- Un técnico recibe casos solo si está `disponible` (en horario y fuera de almuerzo) → `domain/availability.ts`.
- Un INC solo puede estar con un técnico: índice único en BD sobre `codigo` normalizado (trigger).
  Duplicado → `Resultado` con `motivo: 'duplicado'`.

## Base de datos (`sql/`, se ejecutan a mano en el SQL Editor de Supabase)

- `01_schema_inicial.sql`: `tecnicos`, `incidentes`, `historial_snapshots`, RLS (usuarios autenticados), Realtime.
- `02_migracion_v3.sql`: comodín (`horario_inicio/fin`), `bitacora` (la escriben **triggers**, la app solo lee),
  `generar_snapshot_diario()`, `buscar_en_historial()`, `buscar_en_bitacora()`, pg_cron 23:59 Honduras (05:59 UTC).
- `03_datos_demo_dev.sql`: solo DEV; se niega a correr si no existe la tabla marcadora `public.entorno_dev`.
- Cambios de esquema → nuevo archivo `sql/0N_*.sql` idempotente + actualizar `tests/sql/`.

## Entornos

- `PUBLIC_APP_ENV` debe ser `development` en `astro dev` y `production` en `astro build`;
  `services/environment.ts` aborta si no coincide. DEV muestra insignia y título `[DEV]`.
- Variables: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (solo la clave publicable, nunca service_role).
- Rutas siempre vía `RUTAS` (`scripts/routes.ts`), que respeta `BASE_PATH` de GitHub Pages.
- CI: `ci.yml` (ramas/PR, solo verifica) y `deploy.yml` (push a `main` → verifica, compila, publica `gh-pages`).
  Detalle en `docs/ENTORNOS_Y_DESPLIEGUE.md`.

## Pruebas (`tests/`, ninguna toca una base real)

- `domain/`: funciones puras.
- `app/`: la app real con jsdom (`// @vitest-environment jsdom`) contra `helpers/backendSimulado.ts`
  (stub de `fetch` que imita PostgREST). Usa `helpers/app.ts` (`iniciarApp`, `fijarHora`, `esperar`).
- `sql/`: ejecuta los `.sql` en PGlite con un Supabase mínimo simulado (sin el bloque pg_cron).
