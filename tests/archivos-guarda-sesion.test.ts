import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localAuthDatabase } from './d1-auth-local';

const h = vi.hoisted(() => ({
  getSessionProfile: vi.fn(),
  r2Bucket: vi.fn(),
  get: vi.fn(),
  local: null as null | ReturnType<typeof import('./d1-auth-local').localAuthDatabase>,
}));

vi.mock('@/lib/auth/session', () => ({
  getSessionProfile: h.getSessionProfile,
}));

vi.mock('@/lib/storage', () => ({
  r2Bucket: h.r2Bucket,
}));

vi.mock('@/db', () => ({
  get db() {
    return h.local!.db;
  },
}));

import { GET } from '@/app/api/archivos/[...ruta]/route';
import { clavePdfConvocatoria } from '@/lib/callups/crear';

const EVENTO = 'evento-123';
const ANTIGUA = ['convocatorias', EVENTO, '1700000000-lista.pdf'];
const BASE_ANTIGUA = 'https://calendario-esgrima.antiguo.workers.dev/api/archivos/';

const CONVOCADO = { profileId: 'p-convocado', role: 'athlete' } as const;
const TUTOR = { profileId: 'p-tutor', role: 'athlete' } as const;
const AJENO = { profileId: 'p-ajeno', role: 'athlete' } as const;
const ADMIN = { profileId: 'p-admin', role: 'admin' } as const;

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

function sembrar() {
  const s = h.local!.sqlite;
  for (const id of ['p-convocado', 'p-tutor', 'p-ajeno', 'p-admin']) {
    s.prepare('INSERT INTO user_profile (id,email,full_name,role,ical_token) VALUES (?,?,?,?,?)')
      .run(id, `${id}@example.test`, id, id === 'p-admin' ? 'admin' : 'athlete', `${id}-${'t'.repeat(24)}`);
  }
  s.prepare(`INSERT INTO event (id,source,source_id,name,start_date,end_date,scope,content_hash)
    VALUES (?,?,?,?,?,?,?,?)`).run(EVENTO, 'fie', 'x', 'Copa', '2026-10-01', '2026-10-02', 'INTERNACIONAL', 'h');
  s.prepare(`INSERT INTO athlete (id,user_profile_id,guardian_profile_id,first_name,last_name,birth_date,gender)
    VALUES ('a1','p-convocado','p-tutor','Ana','Sintética','2008-01-01','F')`).run();
}

function convocatoria(id: string, pdfUrl: string, publicada: boolean) {
  const s = h.local!.sqlite;
  s.prepare('INSERT INTO call_up (id,event_id,title,pdf_url,published) VALUES (?,?,?,?,?)')
    .run(id, EVENTO, 'Convocatoria', pdfUrl, publicada ? 1 : 0);
  s.prepare('INSERT INTO call_up_athlete (call_up_id,athlete_id) VALUES (?,?)').run(id, 'a1');
}

describe('/api/archivos: sesión, permiso en D1 y solo PDFs de convocatoria', () => {
  beforeEach(() => {
    h.local = localAuthDatabase();
    sembrar();
    h.getSessionProfile.mockReset();
    h.r2Bucket.mockReset();
    h.get.mockReset();
    h.r2Bucket.mockReturnValue({ get: h.get, put: vi.fn() });
    h.get.mockImplementation(async () => objetoR2('%PDF nominal', 'application/pdf'));
  });
  afterEach(() => h.local!.sqlite.close());

  it('deniega sin sesión sin leer el cubo ni revelar nada', async () => {
    convocatoria('c1', BASE_ANTIGUA + ANTIGUA.join('/'), true);
    h.getSessionProfile.mockResolvedValue(null);
    const res = await llamar(ANTIGUA);
    expect(res.status).toBe(401);
    expect(h.get).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('ETag')).toBeNull();
    expect(await res.text()).not.toContain('nominal');
  });

  it('deniega sin consultar el cubo si la comprobación de sesión falla', async () => {
    h.getSessionProfile.mockRejectedValue(new Error('auth caída'));
    const res = await llamar(ANTIGUA);
    expect(res.status).toBe(503);
    expect(h.get).not.toHaveBeenCalled();
  });

  it('una clave ANTIGUA sigue sirviéndose al convocado y a su tutor, con cabeceras privadas', async () => {
    convocatoria('c1', BASE_ANTIGUA + ANTIGUA.join('/'), true);
    for (const perfil of [CONVOCADO, TUTOR]) {
      h.getSessionProfile.mockResolvedValue(perfil);
      const res = await llamar(ANTIGUA);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
      expect(await res.text()).toBe('%PDF nominal');
    }
    expect(h.get).toHaveBeenCalledWith(ANTIGUA.join('/'));
  });

  it('las claves nuevas son aleatorias y también se sirven a quien tiene permiso', async () => {
    const clave = clavePdfConvocatoria(EVENTO);
    expect(clave).toMatch(new RegExp(`^convocatorias/${EVENTO}/[0-9a-f-]{36}\\.pdf$`));
    expect(clavePdfConvocatoria(EVENTO)).not.toBe(clave);
    convocatoria('c1', `https://app.example.test/api/archivos/${clave}`, true);
    h.getSessionProfile.mockResolvedValue(CONVOCADO);
    expect((await llamar(clave.split('/'))).status).toBe(200);
  });

  it('una cuenta con sesión que no está convocada recibe 404 sin leer R2', async () => {
    convocatoria('c1', BASE_ANTIGUA + ANTIGUA.join('/'), true);
    h.getSessionProfile.mockResolvedValue(AJENO);
    const res = await llamar(ANTIGUA);
    expect(res.status).toBe(404);
    expect(h.get).not.toHaveBeenCalled();
  });

  it('un borrador no lo ve el convocado; el admin sí', async () => {
    convocatoria('c1', BASE_ANTIGUA + ANTIGUA.join('/'), false);
    h.getSessionProfile.mockResolvedValue(CONVOCADO);
    expect((await llamar(ANTIGUA)).status).toBe(404);
    h.getSessionProfile.mockResolvedValue(ADMIN);
    expect((await llamar(ANTIGUA)).status).toBe(200);
  });

  it('un tirador dado de baja (inactivo) pierde el acceso', async () => {
    convocatoria('c1', BASE_ANTIGUA + ANTIGUA.join('/'), true);
    h.local!.sqlite.prepare("UPDATE athlete SET active = 0 WHERE id='a1'").run();
    h.getSessionProfile.mockResolvedValue(CONVOCADO);
    expect((await llamar(ANTIGUA)).status).toBe(404);
  });

  it('el permiso es de ESE fichero: la clave de otra convocatoria del mismo evento no vale', async () => {
    convocatoria('c1', BASE_ANTIGUA + ANTIGUA.join('/'), true);
    h.getSessionProfile.mockResolvedValue(CONVOCADO);
    expect((await llamar(['convocatorias', EVENTO, 'otro.pdf'])).status).toBe(404);
    // Un sufijo parcial tampoco: '-lista.pdf' no es la clave entera.
    expect((await llamar(['convocatorias', EVENTO, 'lista.pdf'])).status).toBe(404);
    expect(h.get).not.toHaveBeenCalled();
  });

  it.each([
    ['borradores', EVENTO, '1700000000-borrador.pdf'],
    ['snapshots', EVENTO, '1700000000.html'],
    ['ingest', 'fie', '2026-01-01', 'run.html.gz'],
    ['historico-interno', 'hash-ficticio.json.gz'],
    ['migracion-interna', 'x'],
    ['backup-interno', 'x'],
    ['convocatorias', 'sin-fichero'],
    ['convocatorias', EVENTO, 'sub', 'x.pdf'],
  ])('ni el admin puede leer otros prefijos del cubo: %s/%s', async (...ruta) => {
    h.getSessionProfile.mockResolvedValue(ADMIN);
    const res = await llamar(ruta);
    expect(res.status).toBe(404);
    expect(h.get).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it.each([
    { ruta: ['%malformado'] },
    { ruta: ['carpeta', 'fichero\\oculto'] },
    { ruta: ['carpeta', '\u0000'] },
    { ruta: ['x'.repeat(513)] },
    { ruta: ['..', 'x'] },
  ])('rechaza una ruta dañada sin leer el objeto: %j', async ({ ruta }) => {
    h.getSessionProfile.mockResolvedValue(ADMIN);
    const res = await llamar(ruta);
    expect(res.status).toBe(400);
    expect(h.get).not.toHaveBeenCalled();
  });

  it('con permiso conserva 404 si el objeto ya no está y 503 sin cubo', async () => {
    convocatoria('c1', BASE_ANTIGUA + ANTIGUA.join('/'), true);
    h.getSessionProfile.mockResolvedValue(CONVOCADO);
    h.get.mockResolvedValue(null);
    const noEsta = await llamar(ANTIGUA);
    expect(noEsta.status).toBe(404);
    expect(noEsta.headers.get('Cache-Control')).toBe('private, no-store');
    h.r2Bucket.mockReturnValue(null);
    expect((await llamar(ANTIGUA)).status).toBe(503);
  });

  it('sin sesión y sin cubo responde 401, no 503', async () => {
    h.getSessionProfile.mockResolvedValue(null);
    h.r2Bucket.mockReturnValue(null);
    expect((await llamar(ANTIGUA)).status).toBe(401);
  });
});
