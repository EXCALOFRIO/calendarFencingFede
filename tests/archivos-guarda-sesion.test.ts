import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getSessionProfile: vi.fn(),
  r2Bucket: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  getSessionProfile: h.getSessionProfile,
}));

vi.mock('@/lib/storage', () => ({
  r2Bucket: h.r2Bucket,
}));

import { GET } from '@/app/api/archivos/[...ruta]/route';

const PERFIL = { profileId: 'p1', role: 'athlete' } as const;

function llamar(ruta: string[]) {
  return GET(new Request('http://localhost/api/archivos/' + ruta.join('/')), {
    params: Promise.resolve({ ruta }),
  });
}

function objetoR2(contenido: string, contentType: string) {
  return {
    body: new Response(contenido).body,
    size: contenido.length,
    httpEtag: '"etag-fixture"',
    httpMetadata: { contentType },
  };
}

const CLAVES = [
  ['convocatorias', 'evento-123', '1700000000-lista.pdf'],
  ['borradores', 'evento-123', '1700000000-borrador.pdf'],
  ['snapshots', 'evento-123', '1700000000.html'],
];

describe('/api/archivos exige sesión vigente antes de leer R2', () => {
  beforeEach(() => {
    h.getSessionProfile.mockReset();
    h.r2Bucket.mockReset();
    h.get.mockReset();
    h.r2Bucket.mockReturnValue({ get: h.get, put: vi.fn() });
  });

  it.each(CLAVES)('deniega sin sesión %s/%s/%s sin leer el cubo', async (...ruta) => {
    h.getSessionProfile.mockResolvedValue(null);
    h.get.mockResolvedValue(objetoR2('%PDF nominal', 'application/pdf'));

    const res = await llamar(ruta);

    expect(res.status).toBe(401);
    expect(h.get).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('ETag')).toBeNull();
    expect(res.headers.get('Content-Type')).not.toContain('pdf');
    const cuerpo = await res.text();
    expect(cuerpo).not.toContain('nominal');
  });

  it('una sesión revocada (perfil null) se trata como anónima', async () => {
    h.getSessionProfile.mockResolvedValue(null);
    await llamar(CLAVES[0]);
    expect(h.get).not.toHaveBeenCalled();
  });

  it('no revela si una clave existe o es inválida a un anónimo', async () => {
    h.getSessionProfile.mockResolvedValue(null);
    const inexistente = await llamar(['no', 'existe.pdf']);
    const invalida = await llamar(['..', 'secreto']);
    expect(inexistente.status).toBe(401);
    expect(invalida.status).toBe(401);
    expect(h.get).not.toHaveBeenCalled();
  });

  it('deniega sin consultar el cubo si la comprobación de sesión falla', async () => {
    h.getSessionProfile.mockRejectedValue(new Error('auth caída'));
    const res = await llamar(CLAVES[0]);
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).not.toBe(200);
    expect(h.get).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('con sesión válida sirve el mismo PDF con cabeceras privadas no-store', async () => {
    h.getSessionProfile.mockResolvedValue(PERFIL);
    h.get.mockResolvedValue(objetoR2('%PDF nominal', 'application/pdf'));

    const res = await llamar(CLAVES[0]);

    expect(res.status).toBe(200);
    expect(h.get).toHaveBeenCalledWith('convocatorias/evento-123/1700000000-lista.pdf');
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Length')).toBe(String('%PDF nominal'.length));
    expect(res.headers.get('ETag')).toBe('"etag-fixture"');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.text()).toBe('%PDF nominal');
  });

  it('con sesión válida sirve el snapshot HTML con cabeceras privadas no-store', async () => {
    h.getSessionProfile.mockResolvedValue(PERFIL);
    h.get.mockResolvedValue(objetoR2('<html>snap</html>', 'text/html'));

    const res = await llamar(CLAVES[2]);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Content-Disposition')).toBe('attachment');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).toBe('<html>snap</html>');
  });

  it.each(['historico-interno', 'migracion-interna', 'backup-interno'])(
    'ni una sesión válida puede descargar archivos internos completos: %s',
    async (prefijo) => {
      h.getSessionProfile.mockResolvedValue(PERFIL);
      const res = await llamar([prefijo, 'hash-ficticio.json.gz']);
      expect(res.status).toBe(404);
      expect(h.get).not.toHaveBeenCalled();
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    },
  );

  it.each([
    { ruta: ['%malformado'] },
    { ruta: ['carpeta', 'fichero\\oculto'] },
    { ruta: ['carpeta', '\u0000'] },
    { ruta: ['x'.repeat(513)] },
  ])(
    'rechaza una ruta dañada sin leer el objeto: %j',
    async ({ ruta }) => {
      h.getSessionProfile.mockResolvedValue(PERFIL);
      const res = await llamar(ruta);
      expect(res.status).toBe(400);
      expect(h.get).not.toHaveBeenCalled();
    },
  );

  it('con sesión válida conserva 400, 404 y 503 con no-store', async () => {
    h.getSessionProfile.mockResolvedValue(PERFIL);

    const invalida = await llamar(['..', 'x']);
    expect(invalida.status).toBe(400);
    expect(invalida.headers.get('Cache-Control')).toBe('private, no-store');
    expect(h.get).not.toHaveBeenCalled();

    h.get.mockResolvedValue(null);
    const noEsta = await llamar(['no', 'esta.pdf']);
    expect(noEsta.status).toBe(404);
    expect(noEsta.headers.get('Cache-Control')).toBe('private, no-store');

    h.r2Bucket.mockReturnValue(null);
    const sinCubo = await llamar(CLAVES[0]);
    expect(sinCubo.status).toBe(503);
    expect(sinCubo.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('sin sesión y sin cubo responde 401, no 503', async () => {
    h.getSessionProfile.mockResolvedValue(null);
    h.r2Bucket.mockReturnValue(null);
    const res = await llamar(CLAVES[0]);
    expect(res.status).toBe(401);
  });
});
