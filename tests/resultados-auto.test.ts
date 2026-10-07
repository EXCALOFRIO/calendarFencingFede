import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { abrirD1Local } from '../src/lib/ingest/sport-incremental/local';
import { ejecutarResultadosAuto, huellaHechos, proximaEspera, proximaHecha } from '../src/lib/ingest/resultados-auto/ejecutar';
import { leerConfigResultadosAuto, POR_DEFECTO, type ConfigResultadosAuto } from '../src/lib/ingest/resultados-auto/config';
import { leerEventosResultados } from '../src/lib/ingest/resultados-auto/eventos';
import { comprobarPoules, sanearAsaltos } from '../src/lib/ingest/resultados-auto/validacion-estricta';
import { extraerPdfConIa, neuronasEstimadas } from '../src/lib/ingest/resultados-auto/ia';
import { crearRed, RedDetenida, type Transporte } from '../src/lib/ingest/resultados-auto/red';
import type { AsaltoHecho, HechosPrueba } from '../src/lib/ingest/hechos/formato';
import { hechosSkermo } from '../src/lib/ingest/hechos/skermo';
import { normalizarNombre } from '../src/lib/ingest/hechos/reglas-carga';
import { dbConSportLease, reclamarSportLease } from '../src/lib/ingest/sport-incremental/lease';
import { sql } from 'drizzle-orm';

const fixture = (f: string) => new URL(`./fixtures/resultados-auto/${f}`, import.meta.url);
const INDICE = readFileSync(fixture('skermo-indice-rfee.html'), 'utf8');
const CLASIFICACION_10351 = gunzipSync(readFileSync(fixture('skermo-clasificacion-10351.html.gz'))).toString('utf8');
const AHORA = Date.UTC(2026, 9, 7, 10, 20);
const MIGRACIONES = ['0000_aplicacion.sql', '0002_guardia_deportiva.sql', '0005_presupuesto_8gib.sql', '0007_perfil_deportista.sql'];

const limpiezas: (() => void)[] = [];
afterEach(() => limpiezas.splice(0).reverse().forEach((f) => f()));

function base(con0017 = true) {
  const dir = mkdtempSync(join(tmpdir(), 'resultados-auto-'));
  const ruta = join(dir, 'local.sqlite');
  const s = new DatabaseSync(ruta);
  for (const m of [...MIGRACIONES, ...(con0017 ? ['0017_resultados_automaticos.sql'] : [])]) {
    s.exec(readFileSync(new URL(`../drizzle-d1/${m}`, import.meta.url), 'utf8'));
  }
  s.close();
  const local = abrirD1Local(ruta, true);
  const espia = new DatabaseSync(ruta);
  limpiezas.push(() => { local.close(); espia.close(); rmSync(dir, { recursive: true, force: true }); });
  const n = (t: string) => Number((espia.prepare(`select count(*) n from ${t}`).get() as { n: number }).n);
  return { db: local.db, espia, n };
}

/** Skermo index plus one classification (10351); everything else answers 404. */
function transporte() {
  const pedidas: string[] = [];
  const t: Transporte = async (url) => {
    pedidas.push(url);
    if (url.startsWith('https://app.skermo.org/calendar/public/RFEE/results')) return new Response(INDICE);
    if (url.startsWith('https://app.skermo.org/ranking/public/RFEE/competition/10351')) return new Response(CLASIFICACION_10351);
    return new Response('no', { status: 404 });
  };
  return { t, pedidas };
}

const cfg = (extra: Partial<ConfigResultadosAuto> = {}): ConfigResultadosAuto =>
  ({ ...POR_DEFECTO, habilitado: true, maxUnidadesPasada: 100, ...extra });

let uuidN = 0;
const deps = (db: ReturnType<typeof base>['db'], t: Transporte, extra: Partial<ConfigResultadosAuto> = {}, presupuestoBytes = 8 * 1024 ** 3) => ({
  db, config: cfg(extra), presupuestoBytes, ahora: () => AHORA, transporte: t, pausaMs: 0,
  uuid: () => `prueba-${++uuidN}`, registro: { log: vi.fn(), warn: vi.fn() },
});

describe('configuración', () => {
  it('apagada por defecto; la IA sigue al interruptor de extracción si no tiene el suyo', () => {
    expect(leerConfigResultadosAuto({})).toMatchObject({ habilitado: false, iaHabilitada: false, maxPeticiones: 40, maxFilasDia: 6000 });
    expect(leerConfigResultadosAuto({ RESULTADOS_AUTO_ENABLED: 'true', AI_EXTRACTION_ENABLED: 'true' }).iaHabilitada).toBe(true);
    expect(leerConfigResultadosAuto({ AI_EXTRACTION_ENABLED: 'true', RESULTADOS_AUTO_IA_ENABLED: 'false' }).iaHabilitada).toBe(false);
  });
  it('ignora topes fuera de rango o no numéricos', () => {
    const c = leerConfigResultadosAuto({ RESULTADOS_AUTO_MAX_PETICIONES: '0', RESULTADOS_AUTO_MAX_FILAS_DIA: '12x', RESULTADOS_AUTO_MAX_MS: '30000' });
    expect(c.maxPeticiones).toBe(POR_DEFECTO.maxPeticiones);
    expect(c.maxFilasDia).toBe(POR_DEFECTO.maxFilasDia);
    expect(c.maxMs).toBe(30_000);
  });
});

describe('calendario de una unidad', () => {
  const DIA = 86_400_000;
  const f = Date.UTC(2026, 9, 3);
  it('cada hora los dos primeros días, luego cada 6 h, luego diario y nada tras la ventana', () => {
    expect(proximaEspera('2026-10-03', f + DIA, { ventanaDias: 21 })).toBe(f + DIA + 3_600_000);
    expect(proximaEspera('2026-10-03', f + 3 * DIA, { ventanaDias: 21 })).toBe(f + 3 * DIA + 6 * 3_600_000);
    expect(proximaEspera('2026-10-03', f + 10 * DIA, { ventanaDias: 21 })).toBe(f + 11 * DIA);
    expect(proximaEspera('2026-10-03', f + 22 * DIA, { ventanaDias: 21 })).toBeNull();
  });
  it('una unidad completa reciente se revisa una vez a los dos días; una antigua, nunca', () => {
    expect(proximaHecha('2026-10-03', f + DIA)).toBe(f + 3 * DIA);
    expect(proximaHecha('2026-10-03', f + 6 * DIA)).toBeGreaterThan(f + 1_000 * DIA);
  });
});

describe('red acotada', () => {
  it('sólo HTTPS a las fuentes permitidas y tope de peticiones por pasada', async () => {
    const t = vi.fn<Transporte>(async () => new Response('{}'));
    const red = crearRed({ maxPeticiones: 1, restanteMs: () => 30_000, transporte: t, pausaMs: 0 });
    await expect(red.texto('https://example.com/x')).rejects.toThrow('host_no_permitido');
    await expect(red.texto('http://fie.org/x')).rejects.toThrow('host_no_permitido');
    await red.json('https://fie.org/api/x');
    await expect(red.json('https://fie.org/api/y')).rejects.toBeInstanceOf(RedDetenida);
    expect(t).toHaveBeenCalledOnce();
  });
  it('un 429 detiene toda la pasada, no sólo la petición', async () => {
    const t = vi.fn<Transporte>(async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }));
    const red = crearRed({ maxPeticiones: 10, restanteMs: () => 30_000, transporte: t, pausaMs: 0 });
    await expect(red.texto('https://app.skermo.org/a')).rejects.toMatchObject({ motivo: 'limite_remoto', retryAfterMs: 120_000 });
    await expect(red.texto('https://app.skermo.org/b')).rejects.toBeInstanceOf(RedDetenida);
    expect(t).toHaveBeenCalledOnce();
  });
});

function prueba(bouts: AsaltoHecho[], source: HechosPrueba['source'] = 'rfee_pdf', pools: HechosPrueba['status']['pools'] = 'completo'): HechosPrueba {
  return {
    version: 1, source, extractor: 'test', sourceUrl: 'https://app.skermo.org/x.pdf', sourceSha256: 'a'.repeat(64),
    edition: { season: '2026-2027', tournamentKey: 'pdf:x', name: 'X', startDate: '2026-10-03', endDate: '2026-10-03', city: null, countryCode: null },
    competition: { competitionKey: 'pdf:x:1', weapon: 'ESPADA', gender: 'M', category: 'ABS', categoryRaw: 'ABS', format: 'INDIVIDUAL', date: '2026-10-03' },
    status: { results: 'completo', pools, tableau: 'completo', publishedParticipants: null, notes: [] },
    results: [], bouts,
  } as HechosPrueba;
}
const b = (phase: 'POULE' | 'TABLEAU', roundKey: string, aRef: string, bRef: string, scoreA = 5, scoreB = 2): AsaltoHecho =>
  ({ phase, roundKey, aRef, bRef, aName: aRef, bName: bRef, scoreA, scoreB, winner: null });
const todosContraTodos = (ronda: string, refs: string[]) =>
  refs.flatMap((x, i) => refs.slice(i + 1).map((y) => b('POULE', ronda, x, y)));

describe('saneado de asaltos deterministas', () => {
  it('deja intacta una poule completa y un cuadro coherente', () => {
    const h = prueba([...todosContraTodos('P1', ['a', 'b', 'c', 'd']), b('TABLEAU', 'T2', 'a', 'b')]);
    expect(sanearAsaltos(h)).toMatchObject({ poulesQuitadas: [], cuadroQuitados: 0 });
  });
  it('quita la poule con una pareja repetida (otra lectura de la misma matriz) y la deja parcial', () => {
    const h = prueba([...todosContraTodos('P1', ['a', 'b', 'c']), b('POULE', 'P1', 'b', 'a', 3, 5), ...todosContraTodos('P2', ['d', 'e'])]);
    const s = sanearAsaltos(h);
    expect(s.poulesQuitadas).toEqual(['P1']);
    expect(s.hechos.bouts.map((x) => x.roundKey)).toEqual(['P2']);
    expect(s.hechos.status.pools).toBe('parcial');
  });
  it('en un PDF completo, un tirador sin sus n-1 asaltos invalida la poule; en Engarde es una retirada', () => {
    const corta = todosContraTodos('P1', ['a', 'b', 'c', 'd']).slice(1);
    expect(sanearAsaltos(prueba(corta, 'rfee_pdf')).poulesQuitadas).toEqual(['P1']);
    expect(sanearAsaltos(prueba(corta, 'engarde')).poulesQuitadas).toEqual([]);
  });
  it('quita del cuadro al perdedor que vuelve a tirar', () => {
    const h = prueba([b('TABLEAU', 'T4', 'a', 'b'), b('TABLEAU', 'T4', 'c', 'd'), b('TABLEAU', 'T2', 'b', 'c')]);
    const s = sanearAsaltos(h);
    expect(s.cuadroQuitados).toBeGreaterThan(0);
    expect(s.hechos.status.tableau).toBe('parcial');
  });
});

describe('validación estricta de la IA', () => {
  const poule = (bouts: unknown[], summary: unknown[]) => [{ pool: 1, fencers: ['ANA', 'BEA', 'CRIS'], bouts, summary }];
  const asaltos = [
    { aName: 'ANA', bName: 'BEA', scoreA: 5, scoreB: 1 },
    { aName: 'ANA', bName: 'CRIS', scoreA: 5, scoreB: 2 },
    { aName: 'BEA', bName: 'CRIS', scoreA: 3, scoreB: 5 },
  ];
  const resumen = [
    { name: 'ANA', victories: 2, touchesScored: 10, touchesReceived: 3 },
    { name: 'BEA', victories: 0, touchesScored: 4, touchesReceived: 10 },
    { name: 'CRIS', victories: 1, touchesScored: 7, touchesReceived: 8 },
  ];
  it('acepta una poule que cuadra con su resumen impreso', () => {
    expect(comprobarPoules(poule(asaltos, resumen), true)).toEqual([]);
  });
  it('rechaza asaltos de menos o un resumen que no cuadra', () => {
    expect(comprobarPoules(poule(asaltos.slice(1), resumen), true)[0]).toMatch(/asaltos_2_de_3/);
    const malo = resumen.map((r) => (r.name === 'BEA' ? { ...r, touchesScored: 5 } : r));
    expect(comprobarPoules(poule(asaltos, malo), true)).toContain('poule_1:resumen_no_cuadra');
  });
  const ctx = { url: 'https://app.skermo.org/x.pdf', sha256: 'a'.repeat(64), docId: 'x', season: '2026-2027', textos: ['ANA BEA CRIS'],
    editionName: 'X', maxCaracteres: 60_000, neuronasDisponibles: 6_000 };
  it('no llama al modelo sin neuronas o con un texto demasiado largo', async () => {
    const generarJson = vi.fn(async () => '{}');
    expect(await extraerPdfConIa({ modelo: 'm', generarJson }, { ...ctx, neuronasDisponibles: 10 })).toMatchObject({ ok: false, llamada: false, motivo: 'ia_sin_neuronas_hoy' });
    expect(await extraerPdfConIa({ modelo: 'm', generarJson }, { ...ctx, maxCaracteres: 5 })).toMatchObject({ ok: false, llamada: false });
    expect(generarJson).not.toHaveBeenCalled();
  });
  it('una respuesta que no es JSON o no supera la validación no se acepta y cuenta como llamada', async () => {
    expect(await extraerPdfConIa({ modelo: 'm', generarJson: async () => 'lo siento' }, ctx)).toMatchObject({ ok: false, llamada: true });
    const r = await extraerPdfConIa({ modelo: 'm', generarJson: async () => JSON.stringify({ competitions: [] }) }, ctx);
    expect(r).toMatchObject({ ok: false, llamada: true, motivo: 'ia_no_supera_validacion' });
  });
  it('la estimación de neuronas del peor caso cabe varias veces en la capa gratuita', () => {
    expect(neuronasEstimadas(60_000, 8_192 * 3)).toBeLessThan(1_000);
  });
});

describe('pasada completa sobre una base local', () => {
  it('apagada no abre la red ni la base', async () => {
    const { t, pedidas } = transporte();
    const r = await ejecutarResultadosAuto({ ...deps(null as never, t), config: { ...POR_DEFECTO } });
    expect(r.status).toBe('deshabilitado');
    expect(pedidas).toEqual([]);
  });

  it('sin la migración 0017 responde ok:false y no pide nada', async () => {
    const { db } = base(false);
    const { t, pedidas } = transporte();
    expect(await ejecutarResultadosAuto(deps(db, t))).toMatchObject({ ok: false, status: 'migracion_pendiente' });
    expect(pedidas).toEqual([]);
  });

  it('con poco margen en el libro de capacidad no escribe y abre una revisión', async () => {
    const { db, espia, n } = base();
    const { t, pedidas } = transporte();
    const r = await ejecutarResultadosAuto(deps(db, t, {}, 100 * 1024 ** 2));
    expect(r).toMatchObject({ ok: false, status: 'ledger_bajo' });
    expect(pedidas).toEqual([]);
    expect(n('sport_result')).toBe(0);
    expect(espia.prepare(`select clave, motivo from resultado_auto_revision`).all()).toEqual([{ clave: 'global', motivo: 'ledger_bajo' }]);
  });

  it('descubre, carga una clasificación de Skermo con lease y libro, emite eventos y es idempotente', async () => {
    const { db, espia, n } = base();
    const { t } = transporte();
    const r = await ejecutarResultadosAuto(deps(db, t));
    expect(r.ok).toBe(true);
    expect(r.unidades.descubiertas).toBe(16);
    const unidad = espia.prepare(`select estado, huella is not null h from resultado_auto_unidad where clave='skermo|2026-2027|10351'`).get();
    expect(unidad).toEqual({ estado: 'hecho', h: 1 });
    expect(n('sport_competition')).toBe(1);
    expect(n('sport_result')).toBe(49);
    // Every published licence is new here and has no homonym: one person per placing.
    expect(n('sport_person')).toBe(49);
    expect(n('sport_write_context')).toBe(0);
    expect(Number((espia.prepare(`select accounted_bytes a from sport_capacity_ledger`).get() as { a: number }).a)).toBeGreaterThan(0);
    // Released, not deleted: the row stays with an expiry that has already passed.
    const lease = espia.prepare(`select expires_at e, (unixepoch('subsec') * 1000) ahora from sport_write_lease`).get() as { e: number; ahora: number };
    expect(lease.e).toBeLessThanOrEqual(lease.ahora);
    // A 404 is an answer about that unit, not a reason to stop the pass.
    expect(r.unidades.errores).toBeGreaterThan(0);

    const ev = await leerEventosResultados(db, { desdeId: 0, limite: 1_000 });
    expect(ev.eventos.filter((e) => e.tipo === 'prueba_publicada')).toHaveLength(1);
    expect(ev.eventos.filter((e) => e.tipo === 'resultado_persona')).toHaveLength(49);
    expect(ev.eventos[0].datos).toMatchObject({ source: 'skermo_rfee', competitionKey: 'RFEE:10351', arma: 'FLORETE', genero: 'F' });
    expect((await leerEventosResultados(db, { desdeId: ev.ultimoId })).eventos).toEqual([]);

    // Same source again, without the shortcut of the stored fingerprint: nothing to write.
    espia.exec(`update resultado_auto_unidad set proxima=0, huella=null where clave='skermo|2026-2027|10351'`);
    const antes = { r: n('sport_result'), p: n('sport_person'), c: n('sport_link_candidate'), e: n('resultado_auto_evento') };
    const r2 = await ejecutarResultadosAuto(deps(db, t));
    expect(r2.filas).toBe(0);
    expect({ r: n('sport_result'), p: n('sport_person'), c: n('sport_link_candidate'), e: n('resultado_auto_evento') }).toEqual(antes);
    expect(espia.prepare(`select estado from resultado_auto_unidad where clave='skermo|2026-2027|10351'`).get()).toEqual({ estado: 'hecho' });
  });

  it('una licencia de otra temporada no enlaza con una persona de otro género: queda propuesta', async () => {
    const { db, espia, n } = base();
    const h = hechosSkermo('10351', CLASIFICACION_10351, 'c'.repeat(64))!;
    const f = h.results.find((x) => x.license)!;
    const lease = (await reclamarSportLease(db))!;
    const escritor = dbConSportLease(db, lease);
    await escritor.execute(sql`insert into sport_person (id, display_name, name_normalized, gender, created_at, updated_at)
      values ('p-otro', ${f.name}, ${normalizarNombre(f.name)}, 'M', 0, 0)`);
    await escritor.execute(sql`insert into sport_external_id (id, person_id, scheme, value, scope_source, scope_federation, scope_season,
        scope_weapon, valid_from, valid_to, link_status, linked_via, linked_at, evidence, created_at, updated_at)
      values ('e-otro', 'p-otro', 'rfee_license', ${f.license}, 'skermo_rfee', 'RFEE', '2025-2026', '', '2025-09-01', '2026-08-31',
        'CONFIRMADO', 'prueba', 0, 'prueba', 0, 0)`);
    await lease.liberar();
    const { t } = transporte();
    await ejecutarResultadosAuto(deps(db, t));
    const fila = espia.prepare(`select person_id p from sport_result where source_fact_key=?`).get(f.factKey) as { p: string | null };
    expect(fila.p).toBeNull();
    expect(espia.prepare(`select person_id p, status s from sport_link_candidate where source='resultados_auto'`).all())
      .toEqual([{ p: 'p-otro', s: 'PROPUESTO' }]);
    expect(n('sport_person')).toBe(49);
  });

  it('respeta el tope diario de filas: no empieza una prueba que no cabe', async () => {
    const { db, n } = base();
    const { t } = transporte();
    const r = await ejecutarResultadosAuto(deps(db, t, { maxFilasDia: 60 }));
    expect(r.detalle.some((d) => d.motivo === 'tope_filas_dia')).toBe(true);
    expect(n('sport_result')).toBe(0);
  });

  it('la huella ignora notas y la huella de la fuente', () => {
    const h = prueba([b('TABLEAU', 'T2', 'a', 'b')]);
    expect(huellaHechos([h])).toBe(huellaHechos([{ ...h, sourceSha256: 'b'.repeat(64), status: { ...h.status, notes: ['x'] } }]));
    expect(huellaHechos([h])).not.toBe(huellaHechos([{ ...h, bouts: [] }]));
  });
});
