import { describe, expect, it } from 'vitest';
// El mismo comparador de rutas que usa Next para `headers()`.
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import nextConfig, { CSP_REPORT_ONLY } from '../next.config';

async function cabecerasPara(ruta: string): Promise<Map<string, string>> {
  const reglas = await nextConfig.headers!();
  const resultado = new Map<string, string>();
  for (const regla of reglas) {
    if (!getPathMatch(regla.source, { removeUnnamedParams: true, strict: true })(ruta)) continue;
    for (const { key, value } of regla.headers) resultado.set(key, value);
  }
  return resultado;
}

describe('cabeceras de seguridad de next.config', () => {
  it.each(['/', '/entrar', '/explorar/buscar', '/api/explorar/sugerencias', '/api/calendario/abc.ics'])(
    '%s lleva HSTS, antiencuadre, nosniff, referrer y permisos', async (ruta) => {
      const h = await cabecerasPara(ruta);
      expect(h.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
      expect(h.get('X-Frame-Options')).toBe('DENY');
      expect(h.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
      expect(h.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(h.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
      expect(h.get('X-Content-Type-Options')).toBe('nosniff');
      expect(h.get('Content-Security-Policy-Report-Only')).toBe(CSP_REPORT_ONLY);
    },
  );

  it('no pisa la CSP propia (con sandbox) de /api/archivos', async () => {
    const h = await cabecerasPara('/api/archivos/convocatorias/e/x.pdf');
    expect(h.has('Content-Security-Policy')).toBe(false);
    expect(h.get('X-Frame-Options')).toBe('DENY');
  });

  it('la CSP informativa permite lo que la app carga y nada más', () => {
    const directivas = Object.fromEntries(CSP_REPORT_ONLY.split('; ').map((d) => {
      const [nombre, ...valores] = d.split(' ');
      return [nombre, valores];
    }));
    expect(directivas['img-src']).toEqual(expect.arrayContaining(["'self'", 'https://static.fie.org', 'data:']));
    expect(directivas['connect-src']).toEqual(["'self'"]);
    expect(directivas['frame-ancestors']).toEqual(["'none'"]);
    expect(directivas['object-src']).toEqual(["'none'"]);
    // Next inserta el payload RSC con scripts en línea; sin nonces no hay otra.
    expect(directivas['script-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(CSP_REPORT_ONLY).not.toContain('unsafe-eval');
  });

  it('sin X-Powered-By y acciones de servidor con 1 MB', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe('1mb');
  });

  it('el optimizador de imágenes sólo acepta /uploads/** de static.fie.org con una calidad', () => {
    const imagenes = nextConfig.images!;
    expect(imagenes.remotePatterns).toEqual([
      { protocol: 'https', hostname: 'static.fie.org', pathname: '/uploads/**', search: '' },
    ]);
    expect(imagenes.qualities).toEqual([75]);
    expect(imagenes.deviceSizes!.length).toBeLessThanOrEqual(2);
    expect(imagenes.imageSizes!.length).toBeLessThanOrEqual(2);
    expect(Math.max(...imagenes.imageSizes!)).toBeLessThan(Math.min(...imagenes.deviceSizes!));
  });
});
