import { defineConfig } from 'astro/config';

// En GitHub Pages el sitio vive en https://usuario.github.io/<repositorio>/, así que el workflow de
// producción define BASE_PATH (y SITE_URL). En local no se definen y el sitio queda en "/".
// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL,
  base: process.env.BASE_PATH ?? '/'
});
