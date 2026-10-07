import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localAuthDatabase } from './d1-auth-local';

const h = vi.hoisted(() => ({
  local: null as null | ReturnType<typeof import('./d1-auth-local').localAuthDatabase>,
  requireWritableRole: vi.fn(),
  requireWritableProfile: vi.fn(),
  getManagedAthletes: vi.fn(),
  storeFile: vi.fn(),
}));

vi.mock('@/db', () => ({
  get db() {
    return h.local!.db;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({
  requireWritableRole: h.requireWritableRole,
  requireWritableProfile: h.requireWritableProfile,
  requireRole: vi.fn(),
  getManagedAthletes: h.getManagedAthletes,
}));
vi.mock('@/lib/storage', () => ({
  storageBackend: () => 'r2',
  storeFile: h.storeFile,
}));

import { POST } from '@/app/api/admin/convocatorias/route';
import { responderConvocatoria } from '@/lib/callups/actions';

const ORIGEN = 'https://app.example.test';
const EVENTO = 'evento-1';

function formulario(pdfBytes = 1024) {
  const datos = new FormData();
  datos.set('eventId', EVENTO);
  datos.set('title', 'Convocatoria de prueba');
  datos.set('pdf', new File([new Uint8Array(pdfBytes)], 'lista nominal.pdf', { type: 'application/pdf' }));
  return datos;
}

async function peticion(datos: FormData, cabeceras: Record<string, string> = {}) {
  const cuerpo = new Response(datos);
  const bytes = await cuerpo.arrayBuffer();
  return new Request(`${ORIGEN}/api/admin/convocatorias`, {
    method: 'POST',
    body: bytes,
    headers: {
      origin: ORIGEN,
      'content-type': cuerpo.headers.get('content-type')!,
      'content-length': String(bytes.byteLength),
      ...cabeceras,
    },
  });
}

beforeEach(() => {
  h.local = localAuthDatabase();
  const s = h.local.sqlite;
  s.prepare('INSERT INTO user_profile (id,email,full_name,role,ical_token) VALUES (?,?,?,?,?)')
    .run('p-admin', 'admin@example.test', 'Admin', 'admin', 't'.repeat(32));
  s.prepare('INSERT INTO user_profile (id,email,full_name,role,ical_token) VALUES (?,?,?,?,?)')
    .run('p-tirador', 'tirador@example.test', 'Tirador', 'athlete', 'u'.repeat(32));
  s.prepare(`INSERT INTO event (id,source,source_id,name,start_date,end_date,scope,content_hash)
    VALUES (?,?,?,?,?,?,?,?)`).run(EVENTO, 'fie', 'x', 'Copa', '2026-10-01', '2026-10-02', 'INTERNACIONAL', 'h');
  h.requireWritableRole.mockReset().mockResolvedValue({ profileId: 'p-admin', role: 'admin', fullName: 'Admin' });
  h.storeFile.mockReset().mockImplementation(async (clave: string) => ({
    url: `${ORIGEN}/api/archivos/${clave}`, pathname: clave, backend: 'r2',
  }));
});
afterEach(() => h.local!.sqlite.close());

describe('/api/admin/convocatorias: subida de PDF fuera de las acciones de servidor', () => {
  it('crea el borrador y guarda el PDF con una clave aleatoria', async () => {
    const res = await POST(await peticion(formulario()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    const clave = h.storeFile.mock.calls[0][0] as string;
    expect(clave).toMatch(new RegExp(`^convocatorias/${EVENTO}/[0-9a-f-]{36}\\.pdf$`));
    expect(clave).not.toContain('nominal');
    const fila = h.local!.sqlite.prepare('SELECT pdf_url, pdf_name, published FROM call_up').get()!;
    expect(fila).toMatchObject({ pdf_url: `${ORIGEN}/api/archivos/${clave}`, pdf_name: 'lista nominal.pdf', published: 0 });
  });

  it.each(['', 'https://otro.excalofrio.workers.dev'])('rechaza el origen %j antes de mirar la sesión', async (origen) => {
    const res = await POST(await peticion(formulario(), { origin: origen }));
    expect(res.status).toBe(403);
    expect(h.requireWritableRole).not.toHaveBeenCalled();
    expect(h.storeFile).not.toHaveBeenCalled();
  });

  it('sin sesión 401; sin rol admin o en vista previa 403', async () => {
    h.requireWritableRole.mockRejectedValueOnce(new Error('NO_AUTENTICADO'));
    expect((await POST(await peticion(formulario()))).status).toBe(401);
    h.requireWritableRole.mockRejectedValueOnce(new Error('Esta pantalla es para admin'));
    expect((await POST(await peticion(formulario()))).status).toBe(403);
    expect(h.storeFile).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo de más de 8 MB por Content-Length sin leerlo', async () => {
    const req = await peticion(formulario(16), { 'content-length': String(9 * 1024 * 1024) });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(req.bodyUsed).toBe(false);
  });

  it('un PDF de 2 MB (más de lo que admiten las acciones) sí cabe', async () => {
    expect((await POST(await peticion(formulario(2 * 1024 * 1024)))).status).toBe(200);
  });
});

describe('responderConvocatoria valida en ejecución y avisa una vez por hora', () => {
  beforeEach(() => {
    const s = h.local!.sqlite;
    s.prepare(`INSERT INTO athlete (id,user_profile_id,first_name,last_name,birth_date,gender)
      VALUES ('a1','p-tirador','Ana','Sintética','2008-01-01','F')`).run();
    s.prepare("INSERT INTO call_up (id,event_id,title,published,created_by_profile_id) VALUES ('c1',?, 'Conv', 1, 'p-admin')").run(EVENTO);
    s.prepare("INSERT INTO call_up_athlete (id,call_up_id,athlete_id) VALUES ('ca1','c1','a1')").run();
    h.requireWritableProfile.mockReset().mockResolvedValue({ profileId: 'p-tirador', role: 'athlete', fullName: 'Tirador' });
    h.getManagedAthletes.mockReset().mockResolvedValue([{ id: 'a1' }]);
  });

  it.each(['quizas', 'CONFIRMADO', '', null, 1])('rechaza la respuesta %j sin escribir', async (respuesta) => {
    const r = await responderConvocatoria('ca1', respuesta as never);
    expect(r.ok).toBe(false);
    expect(h.local!.sqlite.prepare('SELECT status FROM call_up_athlete').get()!.status).toBe('pendiente');
  });

  it('rechaza un motivo de más de 500 caracteres y acepta uno de 500', async () => {
    const largo = await responderConvocatoria('ca1', 'rechazado', 'x'.repeat(501));
    expect(largo).toMatchObject({ ok: false, error: expect.stringContaining('500') });
    expect((await responderConvocatoria('ca1', 'rechazado', 'x'.repeat(500))).ok).toBe(true);
  });

  it('rechaza un id que no es texto o es enorme', async () => {
    expect((await responderConvocatoria({} as never, 'confirmado')).ok).toBe(false);
    expect((await responderConvocatoria('x'.repeat(65), 'confirmado')).ok).toBe(false);
  });

  it('alternar confirmar y rechazar en la misma hora encola un solo correo', async () => {
    expect((await responderConvocatoria('ca1', 'confirmado')).ok).toBe(true);
    expect((await responderConvocatoria('ca1', 'rechazado', 'Lesión de rodilla')).ok).toBe(true);
    expect((await responderConvocatoria('ca1', 'confirmado')).ok).toBe(true);
    const avisos = h.local!.sqlite.prepare("SELECT dedupe_key FROM notification WHERE kind='respuesta_convocatoria'").all();
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0].dedupe_key)).toMatch(/^callup-response:ca1:\d{4}-\d{2}-\d{2}T\d{2}$/);
    // La respuesta vigente sí cambia.
    expect(h.local!.sqlite.prepare('SELECT status FROM call_up_athlete').get()!.status).toBe('confirmado');
  });
});
