import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  crearFetchReplayNacional, ejecutarLoteNacional, guardarStreamBlobNacional,
  leerBlobVerificadoNacional, leerEstadoCacheNacional, leerManifiestoCacheNacional,
  leerUnidadesCacheNacional, prepararUnidadesNacionales, rutaBlobNacional,
  escribirEstadoCacheNacional, escribirManifiestoCacheNacional, escribirUnidadCacheNacional,
  permiteRobotsNacional, retryAfterNacional, sha256Nacional, validarUrlNacional,
  LIMITES_CACHE_NACIONAL, type InventarioCacheNacional,
} from '../src/lib/ingest/backfill/cache-nacional';
import { parseSkermoCompetitionResults } from '../src/lib/ingest/sources/skermo-results';
import { descargarPdf } from '../src/lib/ingest/sources/rfee-pdf/lectura';

const htmlUrl = 'https://app.skermo.org/ranking/public/RFEE/competition/100?setLang=es';
const pdfUrl = 'https://app.skermo.org/client/1/test.pdf';
const html = `<html><head><title>Prueba sintética</title></head><body><table><thead><tr>
<th>Posición</th><th>Nombre</th><th>Apellidos</th><th>Licencia</th><th>Club</th><th>Puntuación</th>
</tr></thead><tbody><tr><td>1</td><td>Persona</td><td>Sintética</td><td>TEST0001</td><td>TEST</td><td>1.5</td>
</tr></tbody></table></body></html>`;
const pdf = '%PDF-1.4\n%synthetic fixture\n%%EOF';
const inventario = (): InventarioCacheNacional => ({
  ownRfeeCatalog: [{
    fuente: 'skermo_rfee', federacion: 'RFEE', temporada: '2018-2019',
    clavePrueba: 'RFEE:100', claveCatalogo: 'rfee-test', arma: 'ESPADA', genero: 'M',
    categoria: 'ABS', categoriaOriginal: 'ABS', formato: 'INDIVIDUAL',
    enlaces: [{ tipo: 'html', url: htmlUrl }, { tipo: 'pdf', url: pdfUrl }],
  }],
});
const stream = (text: string) => new Response(text).body!;
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'cache-nacional-test-')); });
afterEach(async () => { vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); });

function fakeDeps(responder?: (url: string) => Response | Promise<Response>) {
  let ahora = 1_000_000;
  const starts: number[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    starts.push(ahora);
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    if (String(input).endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow:\n');
    return responder ? await responder(String(input)) : new Response(String(input) === pdfUrl ? pdf : html,
      { headers: { 'content-type': String(input) === pdfUrl ? 'application/pdf' : 'text/html' } });
  });
  return {
    starts, fetcher,
    deps: { fetch: fetcher as typeof fetch, ahora: () => ahora,
      esperar: async (ms: number) => { ahora += ms; }, libres: async () => 20 * 1024 ** 3 },
    advance: (ms: number) => { ahora += ms; },
  };
}
const runOptions = () => ({ root, unidades: prepararUnidadesNacionales(inventario()), aplicar: true });

describe('immutable national cache', () => {
  it('hashes, verifies and deduplicates content-addressed blobs', async () => {
    const first = await guardarStreamBlobNacional(root, stream(pdf), 100);
    const second = await guardarStreamBlobNacional(root, stream(pdf), 100);
    expect(first.sha256).toBe(sha256Nacional(new TextEncoder().encode(pdf)));
    expect(first.creado).toBe(true);
    expect(second.creado).toBe(false);
    expect(await leerBlobVerificadoNacional(root, first.sha256, first.bytes)).toEqual(new TextEncoder().encode(pdf));
    expect(await readdir(join(root, 'blobs'))).toEqual([`${first.sha256}.bin`]);
  });
  it('does not overwrite or serve a corrupt immutable blob', async () => {
    const first = await guardarStreamBlobNacional(root, stream(pdf), 100);
    await writeFile(rutaBlobNacional(root, first.sha256), 'corrupt');
    await expect(guardarStreamBlobNacional(root, stream(pdf), 100)).rejects.toThrow('SHA-256');
    await expect(leerBlobVerificadoNacional(root, first.sha256)).rejects.toThrow('SHA-256');
    expect(await readFile(rutaBlobNacional(root, first.sha256), 'utf8')).toBe('corrupt');
  });
  it('discards an interrupted stream and its temporary file', async () => {
    const interrupted = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode('part')); },
      pull(c) { c.error(new Error('synthetic network interruption')); },
    });
    await expect(guardarStreamBlobNacional(root, interrupted, 100)).rejects.toThrow('interrumpió');
    expect(await readdir(join(root, 'blobs'))).toEqual([]);
  });
  it('discards over-budget and short Content-Length payloads', async () => {
    await expect(guardarStreamBlobNacional(root, stream(pdf), 2)).rejects.toThrow('límite');
    await expect(guardarStreamBlobNacional(root, stream('short'), 100, 20)).rejects.toThrow('interrumpió');
    expect(await readdir(join(root, 'blobs'))).toEqual([]);
  });
  it('writes atomic checkpoints and rejects invalid unit IDs', async () => {
    const unidad = prepararUnidadesNacionales(inventario())[0];
    await escribirUnidadCacheNacional(root, unidad);
    expect(await leerUnidadesCacheNacional(root)).toEqual([unidad]);
    await expect(escribirUnidadCacheNacional(root, { ...unidad, id: '../unsafe' })).rejects.toThrow();
    expect((await readdir(join(root, 'units'))).some((n) => n.includes('.tmp'))).toBe(false);
  });
  it('rejects negative cumulative request counts', async () => {
    await escribirEstadoCacheNacional(root, { version: 1, peticionesIniciadas: -1,
      bytesPayloadActuales: 0, ultimoInicioPeticion: null, cooldownHasta: null });
    await expect(leerEstadoCacheNacional(root)).rejects.toThrow('formato');
  });
});

describe('national enumeration and policy', () => {
  it('deduplicates URLs while retaining exact official associations and excluding PII', () => {
    const i = inventario();
    i.ownRfeeCatalog.push({ ...i.ownRfeeCatalog[0], temporada: '2019-2020' });
    Object.assign(i.ownRfeeCatalog[0], { nombre: 'PRIVATE_NAME', sourceLicense: 'PRIVATE_LICENSE' });
    const units = prepararUnidadesNacionales(i);
    expect(units).toHaveLength(2);
    expect(units[0].asociaciones.map((a) => a.temporada)).toEqual(['2018-2019', '2019-2020']);
    expect(JSON.stringify(units)).not.toContain('PRIVATE');
    expect(units[0].asociaciones[0].categoriaOriginal).toBe('ABS');
  });
  it('does not enumerate external-only or autonomous competitions', () => {
    const i = inventario();
    i.ownRfeeCatalog[0].enlaces = [{ tipo: 'externo', url: 'https://example.com/' }];
    expect(prepararUnidadesNacionales(i)).toEqual([]);
    i.ownRfeeCatalog[0].federacion = 'FCE';
    expect(() => prepararUnidadesNacionales(i)).toThrow('no nacional');
  });
  it.each([
    'http://app.skermo.org/client/1/test.pdf',
    'https://private:secret@app.skermo.org/client/1/test.pdf',
    'https://app.skermo.org:444/client/1/test.pdf',
    'https://app.skermo.org/ranking/public/FCE/competition/1',
    'https://app.skermo.org/ranking-rfee/public/RFEE/1',
    'https://app.skermo.org/client/1/test.pdf?token=secret',
    'https://app.skermo.org/client/1/test.pdf#fragment',
    'https://evil.test/client/1/test.pdf',
  ])('rejects nonpublic/nonnational URL %s', (url) => {
    expect(() => validarUrlNacional(url)).toThrow();
  });
  it('honours robots longest allow/disallow and fails closed on crawl-delay', () => {
    expect(permiteRobotsNacional('User-agent: *\nDisallow:\n', htmlUrl)).toBe(true);
    expect(permiteRobotsNacional('User-agent: *\nDisallow: /\nAllow: /ranking/public/RFEE/', htmlUrl)).toBe(true);
    expect(permiteRobotsNacional('User-agent: *\nDisallow: /client/*.pdf$', pdfUrl)).toBe(false);
    expect(permiteRobotsNacional('User-agent: *\nCrawl-delay: 10', htmlUrl)).toBe(false);
    expect(permiteRobotsNacional('<html>login</html>', htmlUrl)).toBe(false);
    expect(permiteRobotsNacional('User-agent: CalendarioEsgrima\nDisallow: /\nUser-agent: *\nDisallow:', htmlUrl)).toBe(false);
  });
  it('preserves long Retry-After seconds/date and distinguishes absent headers', () => {
    expect(retryAfterNacional('7200', 1000)).toBe(7_200_000);
    expect(retryAfterNacional(new Date(7_201_000).toUTCString(), 1000)).toBe(7_200_000);
    expect(retryAfterNacional(null, 1000)).toBeNull();
    expect(retryAfterNacional('garbage', 1000)).toBeNull();
  });
});

describe('bounded downloader and strictly offline replay', () => {
  it('dry-run creates no files and starts no request', async () => {
    const fake = fakeDeps();
    const result = await ejecutarLoteNacional({ ...runOptions(), aplicar: false }, fake.deps);
    expect(result.peticionesLote).toBe(0);
    expect(fake.fetcher).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });
  it('spaces actual GET starts >=350ms including policy, verifies resume and releases lock', async () => {
    const fake = fakeDeps();
    const result = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(result.peticionesLote).toBe(3);
    expect(fake.starts).toEqual([1_000_000, 1_000_350, 1_000_700]);
    expect(result.estados.cached).toBe(2);
    expect(await readdir(root)).not.toContain('run.lock');
    const again = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(again.peticionesLote).toBe(0);
    expect(again.motivoParada).toBe('sin_unidades_pendientes_seleccionadas');
  });
  it('replays exact HTML/PDF through existing pure national parsers without network', async () => {
    const fake = fakeDeps();
    await ejecutarLoteNacional(runOptions(), fake.deps);
    const network = vi.fn(() => { throw new Error('network forbidden'); });
    vi.stubGlobal('fetch', network);
    const replay = crearFetchReplayNacional(root);
    const response = await replay(htmlUrl);
    const parsed = parseSkermoCompetitionResults(await response.text(), {
      federationCode: 'RFEE', competitionId: '100',
    });
    expect(parsed.rowsSeen).toBe(1);
    expect(parsed.rows[0].sourceLicense).toBe('TEST0001');
    vi.stubGlobal('fetch', replay);
    expect(await descargarPdf(pdfUrl)).toEqual(new TextEncoder().encode(pdf));
    expect(network).not.toHaveBeenCalled();
    expect(await (await replay(new Request(htmlUrl), { method: 'HEAD' })).text()).toBe('');
    await expect(replay(htmlUrl, { method: 'POST' })).rejects.toThrow('GET y HEAD');
    await expect(replay(htmlUrl.replace('100', '999'))).rejects.toThrow('cache_miss');
  });
  it('does not silently skip corrupted resume data or fall back to HTTP', async () => {
    const fake = fakeDeps();
    await ejecutarLoteNacional(runOptions(), fake.deps);
    const m = await leerManifiestoCacheNacional(root);
    await writeFile(rutaBlobNacional(root, m.unidades[0].sha256!), 'corrupt');
    const calls = fake.fetcher.mock.calls.length;
    const result = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(result.motivoParada).toBe('integridad_local_fallida');
    expect(fake.fetcher.mock.calls).toHaveLength(calls);
    expect(result.estados.partial).toBe(1);
    await expect(crearFetchReplayNacional(root)(htmlUrl)).rejects.toThrow('partial');
  });
  it('marks byte-empty HTTP responses separately, including safe 204 replay', async () => {
    const fake = fakeDeps(() => new Response(null, { status: 204 }));
    const result = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(result.estados.empty).toBe(2);
    expect((await crearFetchReplayNacional(root)(htmlUrl)).status).toBe(204);
  });
  it.each([429, 503])('stops immediately at %s, preserves cooldown and forbids next batch', async (status) => {
    const fake = fakeDeps(() => new Response('not cached', { status, headers: { 'retry-after': '7200' } }));
    const result = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(result.peticionesLote).toBe(2);
    expect(result.motivoParada).toBe('cooldown_fuente');
    expect(result.cooldownHasta).toBe(1_000_350 + 7_200_000);
    expect(result.estados.cooldown).toBe(1);
    const again = await ejecutarLoteNacional({ ...runOptions(), reintentar: true }, fake.deps);
    expect(again.motivoParada).toBe('cooldown_vigente');
    expect(again.peticionesLote).toBe(0);
  });
  it('distinguishes 404 from empty/cached and never caches error bodies', async () => {
    const fake = fakeDeps(() => new Response('private error body', { status: 404 }));
    const result = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(result.estados.http_error).toBe(2);
    const m = await leerManifiestoCacheNacional(root);
    expect(m.unidades.every((u) => u.bytes === null && u.sha256 === null)).toBe(true);
    expect(JSON.stringify(m)).not.toContain('private error body');
  });
  it('does not follow redirects, and records status rather than login payloads', async () => {
    const fake = fakeDeps(() => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }));
    const result = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(result.estados.http_error).toBe(2);
    expect(fake.fetcher).toHaveBeenCalledTimes(3);
  });
  it('never promotes successful 206 responses to complete cached evidence', async () => {
    const fake = fakeDeps(() => new Response('partial bytes', {
      status: 206, headers: { 'content-range': 'bytes 0-12/100', 'content-type': 'text/html' },
    }));
    const result = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(result.motivoParada).toBe('respuesta_parcial');
    expect(result.estados.partial).toBe(1);
    expect(result.peticionesLote).toBe(2);
    expect((await leerUnidadesCacheNacional(root))[0].sha256).toBeNull();
  });
  it('keeps malformed successful PDFs distinct from cache hits', async () => {
    const fake = fakeDeps(() => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }));
    const result = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(result.estados.invalid_payload).toBe(1);
    await expect(crearFetchReplayNacional(root)(pdfUrl)).rejects.toThrow('invalid_payload');
  });
  it('reserves requests cumulatively across checkpoints; no request-limit reset', async () => {
    const fake = fakeDeps();
    await ejecutarLoteNacional({ ...runOptions(), maxUnidades: 1, maxPeticiones: 2 }, fake.deps);
    const next = await ejecutarLoteNacional({ ...runOptions(), maxPeticiones: 2 }, fake.deps);
    expect(next.motivoParada).toBe('presupuesto_peticiones');
    expect(next.peticionesCampana).toBe(2);
    expect(fake.fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not reset the thirty-minute campaign after CLI restart', async () => {
    const fake = fakeDeps();
    await ejecutarLoteNacional({ ...runOptions(), maxUnidades: 1 }, fake.deps);
    fake.advance(30 * 60_000);
    const next = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(next.motivoParada).toBe('presupuesto_tiempo');
    expect(next.peticionesLote).toBe(0);
  });
  it('stops before any GET if >=5GiB free cannot be preserved', async () => {
    const fake = fakeDeps();
    const result = await ejecutarLoteNacional(runOptions(), {
      ...fake.deps, libres: async () => LIMITES_CACHE_NACIONAL.libresBytes,
    });
    expect(result.motivoParada).toBe('espacio_libre');
    expect(fake.fetcher).not.toHaveBeenCalled();
  });
  it('enforces cumulative 512MiB root growth including non-payload files', async () => {
    const fake = fakeDeps();
    const archivo = await open(join(root, 'synthetic-sparse-budget.bin'), 'wx');
    await archivo.truncate(500 * 1024 * 1024);
    await archivo.close();
    await escribirEstadoCacheNacional(root, {
      version: 1, peticionesIniciadas: 1, ultimoInicioPeticion: 1_000_000,
      cooldownHasta: null, bytesPayloadActuales: 0,
      campanaInicio: 1_000_000, bytesDiscoInicio: 0,
    });
    const result = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(result.motivoParada).toBe('presupuesto_bytes');
    expect(fake.fetcher).not.toHaveBeenCalled();
  });
  it('never silently extends the campaign or retries a failed technical GET', async () => {
    const fake = fakeDeps(() => { throw new Error('synthetic network failure'); });
    const result = await ejecutarLoteNacional(runOptions(), fake.deps);
    expect(result.motivoParada).toBe('fallo_tecnico');
    expect(result.estados.network_error).toBe(1);
    expect(result.peticionesCampana).toBe(2);
    expect(fake.fetcher).toHaveBeenCalledTimes(2);
    expect((await leerUnidadesCacheNacional(root))[0].intentos).toBe(1);
  });
  it('preserves mislabeled source links without inventing a PDF extension', () => {
    const i = inventario();
    i.ownRfeeCatalog[0].enlaces = [
      { tipo: 'pdf', url: 'https://app.skermo.org/client/1/mislabeled.jpg' },
      { tipo: 'pdf', url: 'https://app.skermo.org/client/1/missing-extension.' },
    ];
    const units = prepararUnidadesNacionales(i);
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.tipo === 'pdf' && u.estado === 'pending')).toBe(true);
  });
  it('has no runtime database/cloud storage imports or credential loading', async () => {
    const files = [
      new URL('../src/lib/ingest/backfill/cache-nacional.ts', import.meta.url),
      new URL('../scripts/descargar-historico-nacional.ts', import.meta.url),
    ];
    for (const file of files) {
      const code = await readFile(file, 'utf8');
      expect(code).not.toMatch(/from ['"](?:@\/db|@neondatabase|drizzle|dotenv|@opennext)/);
      expect(code).not.toMatch(/process\.env|DATABASE_URL|\.put\(/);
    }
  });
  it('will not steal a running or stale lock', async () => {
    const fake = fakeDeps();
    await writeFile(join(root, 'run.lock'), '{"pid":12345}');
    await expect(ejecutarLoteNacional(runOptions(), fake.deps)).rejects.toThrow('lock');
    expect(fake.fetcher).not.toHaveBeenCalled();
  });
  it('enforces 200 units, 2000 GETs and 30 minutes as hard upper bounds', async () => {
    for (const limits of [{ maxUnidades: 201 }, { maxPeticiones: 2001 }, { maxMinutos: 31 }]) {
      await expect(ejecutarLoteNacional({ ...runOptions(), ...limits })).rejects.toThrow('Límite');
    }
  });
  it('rejects manifest key tampering before any offline response', async () => {
    const fake = fakeDeps();
    await ejecutarLoteNacional(runOptions(), fake.deps);
    const m = await leerManifiestoCacheNacional(root);
    m.unidades[0].id = 'html-invalid';
    await escribirManifiestoCacheNacional(root, m);
    await expect(crearFetchReplayNacional(root)(htmlUrl)).rejects.toThrow('Clave');
  });
});
