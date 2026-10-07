import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  procesar: vi.fn(),
  runIngest: vi.fn(),
  requireWritableRole: vi.fn(),
}));

vi.mock('@/lib/ai/extract', () => ({
  VERSION_ESQUEMA: 1,
  leerConfiguracionIa: () => ({ activa: true, proveedor: 'workers_ai' }),
  crearClienteModelo: () => ({ modelo: 'modelo-sintetico' }),
  huellaDeExtraccion: async () => 'huella',
  documentosPendientesDeExtraer: async () => [
    { id: 'doc-1', origen: 'fie', pdfUrl: 'https://static.fie.org/uploads/1/x.pdf', titulo: 'Circular', fileHash: null, eventId: null },
  ],
  procesarDocumentoOficial: h.procesar,
}));
vi.mock('@/lib/ingest/runner', () => ({
  INGEST_SOURCES: ['fie'],
  SOURCE_DESCRIPTION: { fie: 'FIE' },
  isIngestSource: (s: string) => s === 'fie',
  runIngest: h.runIngest,
}));
vi.mock('@/lib/auth/session', () => ({ requireWritableRole: h.requireWritableRole }));

import { estadoCron, secretoCronValido } from '@/lib/cron/secreto';
import { GET as extraer } from '@/app/api/cron/extraer/route';
import { GET as ingestCron } from '@/app/api/cron/ingest/[source]/route';
import { POST as ingestAdmin } from '@/app/api/admin/ingest/route';

const SECRETO = 'secreto-sintetico-de-pruebas';
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); h.procesar.mockReset(); h.runIngest.mockReset(); });

function conCabecera(valor?: string, url = 'https://app.example.test/api/cron/extraer') {
  return new Request(url, valor === undefined ? {} : { headers: { authorization: valor } });
}

describe('secreto de cron en tiempo constante', () => {
  it('acepta sólo el Bearer exacto', () => {
    expect(secretoCronValido(`Bearer ${SECRETO}`, SECRETO)).toBe(true);
    for (const malo of [null, '', SECRETO, `Bearer ${SECRETO} `, `bearer ${SECRETO}`, `Bearer ${SECRETO.slice(0, -1)}`, `Bearer ${SECRETO}x`]) {
      expect(secretoCronValido(malo, SECRETO), String(malo)).toBe(false);
    }
  });

  it('compara resúmenes HMAC de igual longitud con timingSafeEqual, nunca con ===', () => {
    const fuente = readFileSync(new URL('../src/lib/cron/secreto.ts', import.meta.url), 'utf8');
    expect(fuente).toContain("createHmac('sha256'");
    expect(fuente).toContain('timingSafeEqual(');
    for (const ruta of ['cron/sport', 'cron/notify', 'cron/ingest/[source]', 'cron/extraer']) {
      const texto = readFileSync(new URL(`../src/app/api/${ruta}/route.ts`, import.meta.url), 'utf8');
      expect(texto, ruta).toMatch(/from '@\/lib\/cron\/secreto'/);
      expect(texto, ruta).not.toMatch(/!== `Bearer|=== `Bearer/);
    }
  });

  it('un secreto vacío o en blanco cuenta como ausente', () => {
    expect(estadoCron(conCabecera('Bearer '), '')).toBe('sin_secreto');
    expect(estadoCron(conCabecera('Bearer  '), ' ')).toBe('sin_secreto');
    expect(estadoCron(conCabecera(`Bearer ${SECRETO}`), SECRETO)).toBe('autorizado');
    expect(estadoCron(conCabecera('Bearer otro'), SECRETO)).toBe('no_autorizado');
  });

  it('en producción sin secreto las rutas responden 503 y no ejecutan nada', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');
    expect((await extraer(conCabecera())).status).toBe(503);
    const r = await ingestCron(conCabecera(undefined, 'https://app.example.test/api/cron/ingest/fie'), {
      params: Promise.resolve({ source: 'fie' }),
    });
    expect(r.status).toBe(503);
    expect(h.procesar).not.toHaveBeenCalled();
    expect(h.runIngest).not.toHaveBeenCalled();
  });

  it('con secreto, una cabecera equivocada da 401', async () => {
    vi.stubEnv('CRON_SECRET', SECRETO);
    expect((await extraer(conCabecera('Bearer equivocado'))).status).toBe(401);
    expect(h.procesar).not.toHaveBeenCalled();
  });
});

describe('extraer no devuelve mensajes de error internos', () => {
  it('una circular que falla sale con su tipo de error, sin el mensaje', async () => {
    vi.stubEnv('CRON_SECRET', SECRETO);
    const registro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const privado = 'D1_ERROR: SELECT * FROM user_profile WHERE email = persona@example.test';
    h.procesar.mockRejectedValue(new TypeError(privado));
    const r = await extraer(conCabecera(`Bearer ${SECRETO}`));
    expect(r.status).toBe(200);
    const texto = await r.text();
    expect(texto).not.toContain('user_profile');
    expect(texto).not.toContain('persona@example.test');
    expect(JSON.parse(texto).detalle[0]).toMatchObject({ estado: 'error', motivo: expect.stringContaining('TypeError') });
    expect(JSON.stringify(registro.mock.calls)).not.toContain('persona@example.test');
  });
});

describe('/api/admin/ingest comprueba Origin (CSRF)', () => {
  const peticion = (origin?: string) => new Request('https://app.example.test/api/admin/ingest?source=fie', {
    method: 'POST', headers: origin === undefined ? {} : { origin },
  });

  it.each([undefined, 'https://otro.excalofrio.workers.dev', 'null'])('origen %s: 403 sin mirar la sesión ni ingerir', async (origin) => {
    const r = await ingestAdmin(peticion(origin));
    expect(r.status).toBe(403);
    expect(h.requireWritableRole).not.toHaveBeenCalled();
    expect(h.runIngest).not.toHaveBeenCalled();
  });

  it('mismo origen y admin: ingiere', async () => {
    h.requireWritableRole.mockResolvedValue({ email: 'admin@example.test' });
    h.runIngest.mockResolvedValue({ status: 'ok' });
    const r = await ingestAdmin(peticion('https://app.example.test'));
    expect(r.status).toBe(200);
    expect(h.runIngest).toHaveBeenCalledOnce();
  });
});
