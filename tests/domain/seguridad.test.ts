import { describe, expect, it } from 'vitest';
import { archivoDeCabeceras, politicaParaMeta } from '../../src/config/seguridad';

const URL_SUPABASE = 'https://abcdefgh.supabase.co';

describe('política de seguridad (D35, Cloudflare)', () => {
  it('la CSP solo conecta con nuestro Supabase (HTTP y Realtime)', () => {
    const csp = politicaParaMeta(URL_SUPABASE);
    expect(csp).toContain("connect-src 'self' https://abcdefgh.supabase.co wss://abcdefgh.supabase.co");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('frame-ancestors'); // desde <meta> el navegador lo ignora
    expect(politicaParaMeta('no es url')).toContain("connect-src 'self';");
  });

  it('_headers: la misma CSP + frame-ancestors y cabeceras de endurecimiento; caché larga para /_astro', () => {
    const archivo = archivoDeCabeceras(URL_SUPABASE);
    const [todo, astro] = archivo.split('\n\n');
    expect(todo!.split('\n')[0]).toBe('/*');
    expect(todo).toContain(`Content-Security-Policy: ${politicaParaMeta(URL_SUPABASE)}; frame-ancestors 'none'`);
    for (const cabecera of ['X-Frame-Options: DENY', 'X-Content-Type-Options: nosniff', 'Referrer-Policy:', 'X-Robots-Tag: noindex']) {
      expect(todo).toContain(cabecera);
    }
    expect(astro).toBe('/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n');
  });
});
