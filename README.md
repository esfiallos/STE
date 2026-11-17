# Panel NOC · Traspasos y Turnos

Panel en tiempo real para un Network Operations Center: incidentes B2B asignados a técnicos por turno
(A mañana, B tarde, C nocturno y comodín), almuerzos, búsqueda con copia rápida, Modo Consulta,
historial diario y bitácora de cambios por usuario.

**Stack:** Astro · SCSS · Supabase (Auth, Postgres, Realtime, pg_cron) · Bun · TypeScript.

## Puesta en marcha

1. Crea la base de **desarrollo** y configura GitHub siguiendo `docs/ENTORNOS_Y_DESPLIEGUE.md`
   (dos entornos: desarrollo solo local, producción en GitHub Pages).
2. Scripts de `sql/`, en este orden: `01_schema_inicial.sql`, `02_migracion_v3.sql` y, solo en desarrollo,
   `03_datos_demo_dev.sql`. Si la base ya tenía el esquema inicial con datos, solo `02_migracion_v3.sql`.
3. Copia `.env.example` como `.env.development` con las claves del proyecto Supabase **DEV**.
4. `bun install` y `bun run dev` (http://localhost:4321). Verás la insignia naranja DESARROLLO.

Otros comandos: `bun run check` (tipos), `bun run test` (compila y ejecuta las pruebas), `bun run build` (sitio estático en `dist/`), `bun run preview`.
Astro corre sobre Node ≥ 22; para forzar Bun usa `bun --bun run dev`.

## Cómo funciona

- **Tablero:** turnos → técnicos → incidentes, en tiempo real. Los horarios de los turnos están en `src/domain/shifts.ts`.
- **Disponibilidad:** un técnico recibe casos solo si está en su horario y fuera de su almuerzo. Si no, su columna se
  atenúa (amarillo en almuerzo, gris fuera de horario), el botón «+» se deshabilita y no acepta casos arrastrados.
- **Comodín:** técnico con horario propio (ej. 07:00 - 17:00). Aparece en todos los turnos que su horario toca y recibe
  casos solo mientras esté en su horario.
- **Almuerzo:** es un elemento más de la columna (amarillo, no transferible). Se edita con el lápiz.
- **Incidentes:** un INC solo puede estar con un técnico. Reasignar = arrastrarlo o volver a asignarlo y confirmar.
  Copiar el número y ver el comentario son botones distintos.
- **Historial:** foto del tablero al cierre de cada día (la genera la base de datos a las 23:59, hora de Honduras) y
  búsqueda de casos en días anteriores (snapshots + bitácora, para incluir los casos que se cerraron durante el día).
- **Bitácora:** quién asignó, reasignó o eliminó qué y cuándo. La escriben triggers de la base de datos: no se puede
  omitir, editar ni borrar desde la app.

Probar el snapshot sin esperar a la noche: `select public.generar_snapshot_diario();` en el SQL Editor.

## Arquitectura

Cada capa solo conoce a la que tiene debajo:

```
sql/                Esquema, migraciones y datos de demostración (solo dev) de Supabase
tests/              Pruebas: dominio, app con Supabase simulado y SQL
.github/workflows/  Verificación (CI) y despliegue a GitHub Pages
docs/               Entornos y despliegue
src/
├── pages/          index.astro (Tablero · Historial · Bitácora) y login.astro: solo ensamblan componentes
├── layouts/        Layout.astro: HTML base y estilos globales
├── components/     Marcado Astro sin lógica (layout, board, metrics, history, audit, modals, auth, ui)
│                   Lo dinámico son <template> que el código clona (nunca innerHTML con datos)
├── scripts/        Comportamiento en el navegador
│   ├── main.ts     Arranque: comprueba sesión y conecta todo
│   ├── board/      Vistas del tablero (turno, técnico, incidente, almuerzo), eventos, drag & drop
│   ├── modals/     Un controlador por modal + assignFlow (reglas de asignación compartidas)
│   ├── history/    Historial: foto de un día y búsqueda
│   ├── audit/      Bitácora
│   ├── features/   Pestañas, buscador, Modo Consulta, sesión, estado de conexión
│   ├── actions/    Casos de uso: llaman a services, avisan al usuario, recargan datos
│   └── ui/         Toast, sonido, portapapeles, tablas, formato de fechas
├── state/          Store único, sincronización con Supabase (Realtime + respaldo)
├── services/       Único lugar que habla con Supabase (repositorios, auth, realtime)
├── domain/         Reglas puras: turnos, disponibilidad, almuerzo, métricas, búsqueda (sin DOM ni Supabase)
├── styles/         SCSS por parcial; los colores están solo en abstracts/_variables.scss
└── types/          Tipos del dominio y `Resultado`
```

### Reglas del proyecto

- `domain/` no importa Supabase ni el DOM: se puede probar aislado.
- Solo `services/` habla con Supabase; devuelve `Resultado` (sin excepciones) con mensajes en español.
- Los componentes `.astro` solo tienen marcado; la lógica vive en `scripts/`, un archivo por responsabilidad.
- Los textos de usuarios (código, comentario, nombre) se asignan con `textContent`: no se interpreta HTML.
- Una acción de datos = repositorio → recarga → el store notifica → se redibuja.
- Los colores y el tema se cambian en `src/styles/abstracts/_variables.scss` (paleta aproximada tipo Tigo).

## Seguridad

- La clave `PUBLISHABLE` va en el navegador por diseño; la protección real son las políticas RLS: solo usuarios
  autenticados leen y escriben, y la bitácora y los snapshots no se pueden escribir desde la app.
- Mantén desactivado el registro libre de usuarios en Supabase.
- Las reglas de disponibilidad (almuerzo, horario) se aplican en la interfaz, no en la base de datos.
- El Modo Consulta es un seguro de interfaz contra clics accidentales, no un permiso de solo lectura.
.