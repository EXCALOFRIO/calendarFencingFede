import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { abrirD1Local } from '../src/lib/ingest/sport-incremental/local';
import { dbConSportLease, reclamarSportLease } from '../src/lib/ingest/sport-incremental/lease';
import { ejecutarResultadosAuto } from '../src/lib/ingest/resultados-auto/ejecutar';
import { POR_DEFECTO, type ConfigResultadosAuto } from '../src/lib/ingest/resultados-auto/config';
import { diaUtc } from '../src/lib/ingest/resultados-auto/estado';
import { extraerPdfConIa, type ClienteIa } from '../src/lib/ingest/resultados-auto/ia';
import type { Transporte } from '../src/lib/ingest/resultados-auto/red';
import {
  comprobarClasificacion, comprobarCuadroClasificacion, comprobarPoules, sanearAsaltos, veredictoEstricto,
} from '../src/lib/ingest/resultados-auto/validacion-estricta';
import { validarExtraccion } from '../src/lib/ingest/hechos/pdf-validacion';
import { hechosSkermo } from '../src/lib/ingest/hechos/skermo';
import { normalizarNombre } from '../src/lib/ingest/hechos/reglas-carga';
import type { AsaltoHecho, HechosPrueba } from '../src/lib/ingest/hechos/formato';

// ------------------------------------------------------------------ IA y validación estricta (puro)

/** Texto de un PDF sintético: los nombres que la IA puede devolver están aquí y sólo aquí. */
const PAGINAS = [
  `CAMPEONATO DE ESPAÑA M17 ESPADA FEMENINA CLASIFICACION FINAL
   1 ARANDA LOPEZ Ana CLUB ESGRIMA NORTE
   2 BENITEZ ROMERO Bea CLUB ESGRIMA SUR
   3 CASTILLO MORA Cris CLUB ESGRIMA ESTE
   POULE 1 ARANDA LOPEZ Ana BENITEZ ROMERO Bea CASTILLO MORA Cris`,
];
const ANA = 'ARANDA LOPEZ Ana';
const BEA = 'BENITEZ ROMERO Bea';
const CRIS = 'CASTILLO MORA Cris';

type Cruda = Record<string, unknown>;
function competicion(extra: Cruda = {}): Cruda {
  return {
    headerLines: [], weapon: 'ESPADA', gender: 'F', category: 'M17', format: 'INDIVIDUAL', date: '2026-03-07',
    status: { results: 'completo', pools: 'completo', tableau: 'completo' },
    results: [
      { position: 1, name: ANA, club: 'CLUB ESGRIMA NORTE' },
      { position: 2, name: BEA, club: 'CLUB ESGRIMA SUR' },
      { position: 3, name: CRIS, club: 'CLUB ESGRIMA ESTE' },
    ],
    pools: [{
      pool: 1, fencers: [ANA, BEA, CRIS],
      bouts: [
        { aName: ANA, bName: BEA, scoreA: 5, scoreB: 1 },
        { aName: ANA, bName: CRIS, scoreA: 5, scoreB: 2 },
        { aName: BEA, bName: CRIS, scoreA: 5, scoreB: 3 },
      ],
      summary: [
        { name: ANA, victories: 2, touchesScored: 10, touchesReceived: 3, index: 7 },
        { name: BEA, victories: 1, touchesScored: 6, touchesReceived: 8, index: -2 },
        { name: CRIS, victories: 0, touchesScored: 5, touchesReceived: 10, index: -5 },
      ],
    }],
    tableau: [{ round: 'T2', aName: ANA, bName: BEA, scoreA: 15, scoreB: 9 }],
    ...extra,
  };
}

const ctxIa = {
  url: 'https://app.skermo.org/doc/campeonato.pdf', sha256: 'a'.repeat(64), docId: 'url-test', season: '2025-2026',
  textos: PAGINAS, editionName: 'Campeonato', maxCaracteres: 60_000, neuronasDisponibles: 6_000,
};
const cliente = (respuesta: unknown): ClienteIa => ({
  modelo: 'modelo-de-prueba',
  generarJson: async () => (typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta)),
});
const motivos = (r: Awaited<ReturnType<typeof extraerPdfConIa>>) => (r.ok ? [] : r.fallos.map((f) => f.motivo));

describe('IA: la validación estricta rechaza lo que no está en el texto', () => {
  it('una extracción que cuadra entera se acepta (control)', async () => {
    const r = await extraerPdfConIa(cliente({ competitions: [competicion()] }), ctxIa);
    expect(motivos(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('un nombre de la clasificación que no aparece en el PDF bloquea la prueba entera', async () => {
    const c = competicion();
    (c.results as Cruda[])[2] = { position: 3, name: 'DOMINGUEZ PAZ Dora' };
    const r = await extraerPdfConIa(cliente({ competitions: [c] }), ctxIa);
    expect(r.ok).toBe(false);
    expect(motivos(r)).toContain('descarte:resultado_nombre_no_en_pdf');
  });

  it('un tirador inventado en un asalto también la bloquea', async () => {
    const c = competicion();
    (c.tableau as Cruda[])[0] = { round: 'T2', aName: ANA, bName: 'ZAPATA RUIZ Zoe', scoreA: 15, scoreB: 9 };
    const r = await extraerPdfConIa(cliente({ competitions: [c] }), ctxIa);
    expect(r.ok).toBe(false);
    expect(motivos(r)).toContain('descarte:cuadro_asalto_nombre_no_en_pdf');
  });

  it('un nombre corregido por el modelo (tilde o mayúsculas distintas) se tolera; uno reordenado, no', async () => {
    const c = competicion();
    (c.results as Cruda[])[0] = { position: 1, name: 'Aranda López ANA', club: 'CLUB ESGRIMA NORTE' };
    expect((await extraerPdfConIa(cliente({ competitions: [c] }), ctxIa)).ok).toBe(true);
    (c.results as Cruda[])[0] = { position: 1, name: 'Ana ARANDA LOPEZ', club: 'CLUB ESGRIMA NORTE' };
    const r = await extraerPdfConIa(cliente({ competitions: [c] }), ctxIa);
    expect(r.ok).toBe(false);
    expect(motivos(r)).toContain('descarte:resultado_nombre_no_en_pdf');
  });

  it('una respuesta con vallas markdown se lee; con texto detrás del JSON, no', async () => {
    expect((await extraerPdfConIa(cliente('```json\n' + JSON.stringify({ competitions: [competicion()] }) + '\n```'), ctxIa)).ok).toBe(true);
    const r = await extraerPdfConIa(cliente(JSON.stringify({ competitions: [competicion()] }) + ' Espero que te sirva.'), ctxIa);
    expect(r).toMatchObject({ ok: false, motivo: 'ia_respuesta_no_json', llamada: true });
  });

  it('si el modelo falla, cuenta como llamada con el peor caso de neuronas', async () => {
    const r = await extraerPdfConIa({ modelo: 'm', generarJson: async () => { throw new Error('5xx'); } }, ctxIa);
    expect(r).toMatchObject({ ok: false, motivo: 'ia_error_llamada', llamada: true });
    expect(r.ok ? 0 : r.neuronas).toBeGreaterThan(0);
  });

  it('un PDF sin capa de texto (escaneado) nunca se acepta aunque el modelo devuelva algo', async () => {
    const r = await extraerPdfConIa(cliente({ competitions: [competicion()] }), { ...ctxIa, textos: ['  ', ''] });
    expect(r.ok).toBe(false);
    expect(motivos(r)).toContain('pdf_sin_texto');
  });
});

describe('IA: marcadores imposibles', () => {
  const conAsalto = (asalto: Cruda, donde: 'pool' | 'tableau') => {
    const c = competicion();
    if (donde === 'tableau') c.tableau = [asalto];
    else (c.pools as Cruda[])[0].bouts = [asalto, ...((c.pools as Cruda[])[0].bouts as Cruda[]).slice(1)];
    return c;
  };
  it.each([
    ['poule a 16 tocados', { aName: ANA, bName: BEA, scoreA: 16, scoreB: 1 }, 'pool', 'descarte:poule_asalto_marcador_fuera_de_rango'],
    ['marcador negativo', { aName: ANA, bName: BEA, scoreA: 5, scoreB: -1 }, 'pool', 'descarte:poule_asalto_marcador_invalido'],
    ['marcador decimal', { aName: ANA, bName: BEA, scoreA: 4.5, scoreB: 1 }, 'pool', 'descarte:poule_asalto_marcador_invalido'],
    ['empate sin ganador', { aName: ANA, bName: BEA, scoreA: 4, scoreB: 4 }, 'pool', 'descarte:poule_asalto_empate_sin_ganador'],
    ['ganador contrario al marcador', { aName: ANA, bName: BEA, scoreA: 5, scoreB: 1, winner: 'B' }, 'pool', 'descarte:poule_asalto_ganador_incoherente'],
    ['contra sí misma', { aName: ANA, bName: 'aranda lopez ANA', scoreA: 5, scoreB: 1 }, 'pool', 'descarte:poule_asalto_mismo_tirador'],
    ['cuadro a 46', { round: 'T2', aName: ANA, bName: BEA, scoreA: 46, scoreB: 9 }, 'tableau', 'descarte:cuadro_asalto_marcador_invalido'],
    ['cuadro de 3', { round: 'T3', aName: ANA, bName: BEA, scoreA: 15, scoreB: 9 }, 'tableau', 'descarte:cuadro_ronda_invalida'],
  ] as const)('%s → rechazada', async (_n, asalto, donde, motivo) => {
    const r = await extraerPdfConIa(cliente({ competitions: [conAsalto(asalto, donde)] }), ctxIa);
    expect(r.ok).toBe(false);
    expect(motivos(r)).toContain(motivo);
  });

  it('un resumen de poule con el índice mal sumado se rechaza', () => {
    const c = competicion();
    const p = (c.pools as Cruda[])[0];
    (p.summary as Cruda[])[0] = { name: ANA, victories: 2, touchesScored: 10, touchesReceived: 3, index: 8 };
    expect(comprobarPoules([p], true)).toEqual(['poule_1:indice_no_cuadra']);
  });

  it('una poule sin resumen completo o con un tirador desconocido en el resumen se rechaza', () => {
    const p = (competicion().pools as Cruda[])[0];
    expect(comprobarPoules([{ ...p, summary: (p.summary as Cruda[]).slice(0, 2) }], true)).toEqual(['poule_1:sin_resumen_completo']);
    const raro = [...(p.summary as Cruda[]).slice(0, 2), { name: 'OTRA', victories: 0, touchesScored: 5, touchesReceived: 10 }];
    expect(comprobarPoules([{ ...p, summary: raro }], true)).toEqual(['poule_1:resumen_tirador_desconocido']);
    expect(comprobarPoules([{ pool: 2, fencers: [ANA], bouts: [], summary: [] }], true)).toEqual(['poule_2:sin_tiradores']);
  });
});

describe('IA: pruebas y filas duplicadas', () => {
  it('un asalto repetido dentro de la poule se rechaza', async () => {
    const c = competicion();
    const p = (c.pools as Cruda[])[0];
    p.bouts = [...(p.bouts as Cruda[]), { aName: BEA, bName: ANA, scoreA: 1, scoreB: 5 }];
    const r = await extraerPdfConIa(cliente({ competitions: [c] }), ctxIa);
    expect(r.ok).toBe(false);
    expect(motivos(r)).toContain('descarte:poule_asalto_duplicado');
  });

  it('un nombre repetido en la clasificación individual se rechaza', async () => {
    const c = competicion();
    (c.results as Cruda[])[2] = { position: 3, name: ANA };
    const r = await extraerPdfConIa(cliente({ competitions: [c] }), ctxIa);
    expect(r.ok).toBe(false);
    expect(motivos(r)).toContain('descarte:resultado_duplicado');
  });

  it('un mismo tirador dos veces en la misma ronda del cuadro se rechaza', async () => {
    const c = competicion({
      tableau: [
        { round: 'T4', aName: ANA, bName: CRIS, scoreA: 15, scoreB: 2 },
        { round: 'T4', aName: ANA, bName: BEA, scoreA: 15, scoreB: 3 },
      ],
    });
    const r = await extraerPdfConIa(cliente({ competitions: [c] }), ctxIa);
    expect(r.ok).toBe(false);
    expect(motivos(r)).toContain('descarte:cuadro_tirador_repetido_en_ronda');
  });

  it('dos pruebas con la misma cabecera reciben claves distintas (~2) y nunca la misma', () => {
    const v = validarExtraccion({ competitions: [competicion(), competicion()] }, {
      url: ctxIa.url, sha256: ctxIa.sha256, docId: ctxIa.docId, season: ctxIa.season, editionName: 'X', paginas: PAGINAS, extractor: 't',
    });
    const claves = v.hechos.map((h) => h.competition.competitionKey);
    expect(new Set(claves).size).toBe(claves.length);
    expect(claves[1]).toMatch(/~2$/);
  });

  it('la misma prueba devuelta dos veces por el modelo no se acepta para escribirse dos veces', async () => {
    const r = await extraerPdfConIa(cliente({ competitions: [competicion(), competicion()] }), ctxIa);
    expect(r.ok).toBe(false);
  });
});

describe('validación estricta: cuadro frente a clasificación', () => {
  const prueba = (results: [string, number | null][], bouts: AsaltoHecho[]): HechosPrueba => ({
    version: 1, source: 'rfee_pdf', extractor: 't', sourceUrl: 'https://app.skermo.org/x.pdf', sourceSha256: 'a'.repeat(64),
    edition: { season: '2025-2026', tournamentKey: 'pdf:x', name: 'X', startDate: '2026-03-07', endDate: '2026-03-07', city: null, countryCode: null },
    competition: { competitionKey: 'pdf:x:1', weapon: 'ESPADA', gender: 'F', category: 'M17', categoryRaw: null, format: 'INDIVIDUAL', date: '2026-03-07' },
    status: { results: 'completo', pools: 'sin_resultados', tableau: 'completo', publishedParticipants: null, notes: [] },
    results: results.map(([name, position], i) => ({
      factKey: `k${i}`, name, countryCode: null, club: null, position, positionRaw: position === null ? null : String(position),
      points: null, fieId: null, license: null, birthYear: null,
    })),
    bouts,
  }) as HechosPrueba;
  const t = (roundKey: string, a: string, b: string, sa = 15, sb = 5): AsaltoHecho =>
    ({ phase: 'TABLEAU', roundKey, aRef: a, bRef: b, aName: a, bName: b, scoreA: sa, scoreB: sb, winner: null });

  it('el ganador de la final que no es el 1 se rechaza', () => {
    expect(comprobarCuadroClasificacion(prueba([['A', 1], ['B', 2]], [t('T2', 'B', 'A')]))).toContain('final_no_cuadra_con_clasificacion');
  });
  it('quien pierde en la tabla de 8 no puede ser 3.º', () => {
    const h = prueba([['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5]], [t('T8', 'A', 'C')]);
    expect(comprobarCuadroClasificacion(h)).toContain('perdedor_T8_fuera_de_su_tramo');
  });
  it('un tirador del cuadro que no está en la clasificación se rechaza', () => {
    expect(comprobarCuadroClasificacion(prueba([['A', 1], ['B', 2]], [t('T2', 'A', 'Z')]))).toContain('cuadro_tirador_sin_puesto_T2');
  });
  it('un clasificado entre los del cuadro que no tira ningún asalto se rechaza', () => {
    const h = prueba([['A', 1], ['B', 2], ['C', 3], ['D', 3]], [t('T4', 'A', 'C'), t('T2', 'A', 'B')]);
    expect(comprobarCuadroClasificacion(h)).toContain('clasificados_del_cuadro_que_no_tiran');
  });
  it('una clasificación que no empieza en 1 o con nombres repetidos se rechaza', () => {
    expect(comprobarClasificacion(prueba([['A', 2], ['B', 3]], []))).toEqual(['clasificacion_no_empieza_en_1']);
    expect(comprobarClasificacion(prueba([['A', 1], ['a', 2]], []))).toEqual(['clasificacion_nombres_repetidos']);
    expect(comprobarClasificacion(prueba([], []))).toEqual(['sin_clasificacion']);
  });
  it('veredictoEstricto exige todas las secciones terminadas', () => {
    const v = validarExtraccion({ competitions: [competicion({ status: { results: 'parcial', pools: 'completo', tableau: 'completo' } })] }, {
      url: ctxIa.url, sha256: ctxIa.sha256, docId: ctxIa.docId, season: ctxIa.season, editionName: 'X', paginas: PAGINAS, extractor: 't',
    });
    expect(veredictoEstricto(v, { competitions: [] }).map((f) => f.motivo)).toContain('seccion_results_parcial');
  });
});

describe('saneado determinista: asaltos imposibles', () => {
  const h = (bouts: AsaltoHecho[], format: 'INDIVIDUAL' | 'EQUIPOS' = 'INDIVIDUAL') => ({
    version: 1, source: 'engarde', extractor: 't', sourceUrl: 'https://engarde-service.com/x', sourceSha256: 'b'.repeat(64),
    edition: { season: '2025-2026', tournamentKey: 'e', name: 'E', startDate: '2026-03-07', endDate: '2026-03-07', city: null, countryCode: null },
    competition: { competitionKey: 'e:1', weapon: 'SABLE', gender: 'M', category: 'ABS', categoryRaw: null, format, date: '2026-03-07' },
    status: { results: 'completo', pools: 'completo', tableau: 'completo', publishedParticipants: null, notes: [] },
    results: [], bouts,
  }) as HechosPrueba;
  const p = (r: string, a: string, b: string): AsaltoHecho => ({ phase: 'POULE', roundKey: r, aRef: a, bRef: b, aName: a, bName: b, scoreA: 5, scoreB: 1, winner: null });

  it('quita la poule en la que alguien tira contra sí mismo', () => {
    const s = sanearAsaltos(h([p('P1', 'a', 'b'), p('P1', 'a', 'a')]));
    expect(s.poulesQuitadas).toEqual(['P1']);
    expect(s.hechos.bouts).toEqual([]);
    expect(s.hechos.status.notes.join(' ')).toContain('Poules quitadas');
  });
  it('en equipos no toca nada (los relevos repiten parejas legítimamente)', () => {
    const bouts = [p('P1', 'a', 'b'), p('P1', 'a', 'b')];
    expect(sanearAsaltos(h(bouts, 'EQUIPOS')).hechos.bouts).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ pasada completa sobre base local

const fixture = (f: string) => new URL(`./fixtures/resultados-auto/${f}`, import.meta.url);
const INDICE = readFileSync(fixture('skermo-indice-rfee.html'), 'utf8');
const CLASIFICACION = gunzipSync(readFileSync(fixture('skermo-clasificacion-10351.html.gz'))).toString('utf8');
const AHORA = Date.UTC(2026, 9, 7, 10, 20);
const MIGRACIONES = ['0000_aplicacion.sql', '0002_guardia_deportiva.sql', '0005_presupuesto_8gib.sql', '0007_perfil_deportista.sql', '0017_resultados_automaticos.sql'];
const GIB = 1024 ** 3;

const limpiezas: (() => void)[] = [];
afterEach(() => limpiezas.splice(0).reverse().forEach((f) => f()));

function base() {
  const dir = mkdtempSync(join(tmpdir(), 'resultados-auto-refuerzo-'));
  const ruta = join(dir, 'local.sqlite');
  const s = new DatabaseSync(ruta);
  for (const m of MIGRACIONES) s.exec(readFileSync(new URL(`../drizzle-d1/${m}`, import.meta.url), 'utf8'));
  s.close();
  const local = abrirD1Local(ruta, true);
  const espia = new DatabaseSync(ruta);
  limpiezas.push(() => { local.close(); espia.close(); rmSync(dir, { recursive: true, force: true }); });
  const n = (t: string) => Number((espia.prepare(`select count(*) n from ${t}`).get() as { n: number }).n);
  const ledger = () => Number((espia.prepare(`select accounted_bytes a from sport_capacity_ledger where key='global'`).get() as { a: number }).a);
  return { db: local.db, espia, n, ledger };
}

type Respuesta = string | (() => Response);
function transporte(respuestas: { indice?: Respuesta; clasificacion?: Respuesta } = {}) {
  const pedidas: string[] = [];
  const responder = (r: Respuesta | undefined, defecto: string) =>
    typeof r === 'function' ? r() : new Response(r ?? defecto);
  const t: Transporte = async (url) => {
    pedidas.push(url);
    if (url.startsWith('https://app.skermo.org/calendar/public/RFEE/results')) return responder(respuestas.indice, INDICE);
    if (url.startsWith('https://app.skermo.org/ranking/public/RFEE/competition/10351')) return responder(respuestas.clasificacion, CLASIFICACION);
    return new Response('no', { status: 404 });
  };
  return { t, pedidas };
}

let uuidN = 0;
const deps = (db: ReturnType<typeof base>['db'], t: Transporte, extra: Partial<ConfigResultadosAuto> = {}, presupuestoBytes = 8 * GIB) => {
  const registro = { log: vi.fn(), warn: vi.fn() };
  return {
    db, config: { ...POR_DEFECTO, habilitado: true, maxUnidadesPasada: 100, ...extra }, presupuestoBytes, ahora: () => AHORA, transporte: t,
    pausaMs: 0, uuid: () => `refuerzo-${++uuidN}`, registro,
  };
};
const UNIDAD = 'skermo|2026-2027|10351';

describe('fuente que devuelve HTML roto', { timeout: 60_000 }, () => {
  it('un índice que no es la página de Skermo no descubre nada, no escribe y no rompe la pasada', async () => {
    const { db, n } = base();
    const { t } = transporte({ indice: '<html><body><table><tr><td>Temporada 2026-20' });
    const r = await ejecutarResultadosAuto(deps(db, t));
    expect(r).toMatchObject({ ok: true, status: 'ok' });
    expect(r.unidades.descubiertas).toBe(0);
    expect(n('sport_result')).toBe(0);
  });

  it('un índice cortado a la mitad no rompe la pasada y nunca escribe más que lo que se puede leer', async () => {
    const { db, n } = base();
    const { t } = transporte({ indice: INDICE.slice(0, Math.floor(INDICE.length / 2)), clasificacion: () => new Response('no', { status: 404 }) });
    const r = await ejecutarResultadosAuto(deps(db, t));
    expect(r.ok).toBe(true);
    expect(n('sport_result')).toBe(0);
  });

  it('una clasificación ilegible deja la unidad esperando y no escribe nada', async () => {
    const { db, espia, n } = base();
    const { t } = transporte({ clasificacion: '<html><body><div class="ranking"><table><tr><td>1</td><td>' });
    const r = await ejecutarResultadosAuto(deps(db, t));
    expect(r.ok).toBe(true);
    expect(n('sport_result')).toBe(0);
    expect(espia.prepare(`select estado, detalle from resultado_auto_unidad where clave=?`).get(UNIDAD))
      .toEqual({ estado: 'esperando', detalle: 'skermo_sin_clasificacion' });
  });

  it('un 500 de la fuente para la pasada (no se insiste), deja la unidad en error con reintento y no escribe', async () => {
    const { db, espia, n } = base();
    const { t, pedidas } = transporte({ clasificacion: () => new Response('error', { status: 500 }) });
    await ejecutarResultadosAuto(deps(db, t));
    expect(n('sport_result')).toBe(0);
    const u = espia.prepare(`select estado, intentos, proxima from resultado_auto_unidad where clave=?`).get(UNIDAD) as { estado: string; intentos: number; proxima: number };
    expect(u.estado).toBe('error');
    expect(u.intentos).toBe(1);
    expect(u.proxima).toBeGreaterThanOrEqual(AHORA + 3_600_000);
    // Tras el 500 no sale ni una petición más.
    expect(pedidas.at(-1)).toContain('/competition/10351');
  });

  it('una clasificación cortada a mitad de la tabla no se da por completa', () => {
    // Sin el cierre de la tabla, los puestos leídos (1..20 de 49) parecen una clasificación completa de 20.
    const filas = [...CLASIFICACION.matchAll(/<\/tr>/g)].map((m) => m.index!);
    const cortada = CLASIFICACION.slice(0, filas[Math.floor(filas.length / 2)] + 5);
    const completa = hechosSkermo('10351', CLASIFICACION, 'c'.repeat(64))!;
    const h = hechosSkermo('10351', cortada, 'd'.repeat(64))!;
    expect(h.results.length).toBeLessThan(completa.results.length);
    expect(h.status.results).not.toBe('completo');
  });
});

describe('topes del día y libro de capacidad', { timeout: 60_000 }, () => {
  it('con el tope diario de filas ya gastado no pide nada a la red', async () => {
    const { db, espia, n } = base();
    espia.prepare(`insert into resultado_auto_consumo (dia, clave, valor) values (?, 'filas', ?)`).run(diaUtc(AHORA), POR_DEFECTO.maxFilasDia);
    const { t, pedidas } = transporte();
    const r = await ejecutarResultadosAuto(deps(db, t));
    expect(r.status).toBe('tope_diario');
    expect(pedidas).toEqual([]);
    expect(n('sport_result')).toBe(0);
  });

  it('con el tope diario de bytes del libro gastado, tampoco', async () => {
    const { db, espia } = base();
    espia.prepare(`insert into resultado_auto_consumo (dia, clave, valor) values (?, 'bytes_ledger', ?)`).run(diaUtc(AHORA), POR_DEFECTO.maxBytesLedgerDia);
    const { t, pedidas } = transporte();
    expect((await ejecutarResultadosAuto(deps(db, t))).status).toBe('tope_diario');
    expect(pedidas).toEqual([]);
  });

  it('el consumo de otro día no cuenta', async () => {
    const { db, espia } = base();
    espia.prepare(`insert into resultado_auto_consumo (dia, clave, valor) values (?, 'filas', ?)`).run(diaUtc(AHORA - 86_400_000), POR_DEFECTO.maxFilasDia);
    const { t } = transporte();
    expect((await ejecutarResultadosAuto(deps(db, t))).status).toBe('ok');
  });

  it('el tope diario alcanzado a mitad de pasada corta el resto de unidades y suma lo escrito', async () => {
    // Primero, cuántas filas escribe la prueba que tiene datos.
    const prueba = base();
    const libre = await ejecutarResultadosAuto(deps(prueba.db, transporte().t));
    expect(libre.filas).toBeGreaterThan(0);

    const { db, espia, n } = base();
    const r = await ejecutarResultadosAuto(deps(db, transporte().t, { maxFilasDia: libre.filas }));
    expect(n('sport_result')).toBe(49);
    expect(r.filas).toBe(libre.filas);
    const escrita = r.detalle.findIndex((d) => d.clave === UNIDAD);
    expect(escrita).toBeGreaterThanOrEqual(0);
    // Ninguna unidad después de la escrita se procesa: el bucle se para por tope_diario.
    expect(r.detalle.length).toBe(escrita + 1);
    if (escrita + 1 < libre.detalle.length) expect(r.status).toBe('tope_diario');
    const consumo = espia.prepare(`select valor from resultado_auto_consumo where dia=? and clave='filas'`).get(diaUtc(AHORA)) as { valor: number };
    expect(consumo.valor).toBe(libre.filas);
    // Y la pasada siguiente del mismo día ya no pide nada.
    const { t, pedidas } = transporte();
    expect((await ejecutarResultadosAuto(deps(db, t, { maxFilasDia: libre.filas }))).status).toBe('tope_diario');
    expect(pedidas).toEqual([]);
  });

  it('una prueba que no cabe en el tope de la pasada se difiere sin escribir nada a medias', async () => {
    const { db, espia, n } = base();
    const r = await ejecutarResultadosAuto(deps(db, transporte().t, { maxFilasDia: 60 }));
    expect(n('sport_result')).toBe(0);
    expect(n('sport_competition')).toBe(0);
    expect(r.detalle.find((d) => d.clave === UNIDAD)?.motivo).toBe('tope_filas_dia');
    // La unidad no se cierra: sigue pendiente para la próxima pasada.
    expect((espia.prepare(`select estado from resultado_auto_unidad where clave=?`).get(UNIDAD) as { estado: string }).estado).toBe('pendiente');
  });

  it('ledger bajo a mitad de pasada: hay margen para empezar pero no para la prueba; se para sin escribir', async () => {
    const { db, espia, n, ledger } = base();
    const presupuesto = ledger() + POR_DEFECTO.margenLedgerMinBytes + 10_000;
    const { t } = transporte();
    const r = await ejecutarResultadosAuto(deps(db, t, {}, presupuesto));
    expect(r).toMatchObject({ ok: false, status: 'ledger_bajo' });
    expect(n('sport_result')).toBe(0);
    expect(n('sport_person')).toBe(0);
    const revision = espia.prepare(`select clave, motivo, datos from resultado_auto_revision`).get() as { clave: string; motivo: string; datos: string };
    expect(revision).toMatchObject({ clave: 'global', motivo: 'ledger_bajo' });
    expect(JSON.parse(revision.datos)).toMatchObject({ escrito: false, filas: expect.any(Number) });
    // El lease queda liberado: otra escritura puede reclamarlo.
    const lease = await reclamarSportLease(db);
    expect(lease).not.toBeNull();
    await lease!.liberar();
  });

  it('con el libro bloqueado no escribe aunque haya margen', async () => {
    const { db, espia, n } = base();
    espia.exec(`update sport_capacity_ledger set blocked = 1 where key='global'`);
    const { t, pedidas } = transporte();
    expect(await ejecutarResultadosAuto(deps(db, t))).toMatchObject({ ok: false, status: 'ledger_bajo' });
    expect(pedidas).toEqual([]);
    expect(n('sport_result')).toBe(0);
  });

  it('un 429 de la fuente detiene la pasada, libera el lease y guarda lo consumido', async () => {
    const { db, espia } = base();
    const { t } = transporte({ clasificacion: () => new Response('', { status: 429, headers: { 'retry-after': '600' } }) });
    const r = await ejecutarResultadosAuto(deps(db, t));
    const u = espia.prepare(`select estado, proxima from resultado_auto_unidad where clave=?`).get(UNIDAD) as { estado: string; proxima: number };
    expect(u.estado).toBe('error');
    expect(u.proxima).toBeGreaterThanOrEqual(AHORA + 600_000);
    const lease = await reclamarSportLease(db);
    expect(lease).not.toBeNull();
    await lease!.liberar();
    expect((espia.prepare(`select valor from resultado_auto_consumo where clave='peticiones'`).get() as { valor: number }).valor).toBe(r.peticiones);
  });

  it.each([
    [429, 'red_limite_remoto'],
    [503, 'red_fuente'],
  ])('el resumen de una pasada cortada por un %i dice por qué se paró (%s), no «ok»', async (estado, esperado) => {
    const { db } = base();
    const { t } = transporte({ clasificacion: () => new Response('', { status: estado }) });
    expect((await ejecutarResultadosAuto(deps(db, t))).status).toBe(esperado);
  });
});

describe('personas: homónimo de otro género', { timeout: 60_000 }, () => {
  it('una persona con el mismo nombre y otro género, sin licencia, nunca recibe el puesto', async () => {
    const { db, espia, n } = base();
    const h = hechosSkermo('10351', CLASIFICACION, 'c'.repeat(64))!;
    expect(h.competition.gender).toBe('F');
    const f = h.results.find((x) => x.license)!;
    const lease = (await reclamarSportLease(db))!;
    await dbConSportLease(db, lease).execute(sql`insert into sport_person (id, display_name, name_normalized, gender, created_at, updated_at)
      values ('p-homonimo-m', ${f.name}, ${normalizarNombre(f.name)}, 'M', 0, 0)`);
    await lease.liberar();
    await ejecutarResultadosAuto(deps(db, transporte().t));
    const fila = espia.prepare(`select person_id p from sport_result where source_fact_key=?`).get(f.factKey) as { p: string | null };
    expect(fila.p).not.toBe('p-homonimo-m');
    expect((espia.prepare(`select gender g from sport_person where id='p-homonimo-m'`).get() as { g: string }).g).toBe('M');
    expect(n('sport_result')).toBe(49);
    // Nada se ha fundido en la persona masculina.
    expect(espia.prepare(`select count(*) n from sport_person where merged_into_person_id='p-homonimo-m'`).get()).toEqual({ n: 0 });
  });

  it('una persona del mismo género con la misma licencia de esta temporada sí recibe el puesto', async () => {
    const { db, espia } = base();
    const h = hechosSkermo('10351', CLASIFICACION, 'c'.repeat(64))!;
    const f = h.results.find((x) => x.license)!;
    const lease = (await reclamarSportLease(db))!;
    const escritor = dbConSportLease(db, lease);
    await escritor.execute(sql`insert into sport_person (id, display_name, name_normalized, gender, created_at, updated_at)
      values ('p-buena', ${f.name}, ${normalizarNombre(f.name)}, 'F', 0, 0)`);
    await escritor.execute(sql`insert into sport_external_id (id, person_id, scheme, value, scope_source, scope_federation, scope_season,
        scope_weapon, valid_from, valid_to, link_status, linked_via, linked_at, evidence, created_at, updated_at)
      values ('e-buena', 'p-buena', 'rfee_license', ${f.license}, 'skermo_rfee', 'RFEE', ${h.edition.season}, '', '2026-09-01', '2027-08-31',
        'CONFIRMADO', 'prueba', 0, 'prueba', 0, 0)`);
    await lease.liberar();
    await ejecutarResultadosAuto(deps(db, transporte().t));
    expect(espia.prepare(`select person_id p from sport_result where source_fact_key=?`).get(f.factKey)).toEqual({ p: 'p-buena' });
  });

  it('la misma licencia en una persona de otro género no se usa: queda propuesta, no enlazada', async () => {
    const { db, espia } = base();
    const h = hechosSkermo('10351', CLASIFICACION, 'c'.repeat(64))!;
    const f = h.results.find((x) => x.license)!;
    const lease = (await reclamarSportLease(db))!;
    const escritor = dbConSportLease(db, lease);
    await escritor.execute(sql`insert into sport_person (id, display_name, name_normalized, gender, created_at, updated_at)
      values ('p-otro-genero', ${f.name}, ${normalizarNombre(f.name)}, 'M', 0, 0)`);
    await escritor.execute(sql`insert into sport_external_id (id, person_id, scheme, value, scope_source, scope_federation, scope_season,
        scope_weapon, valid_from, valid_to, link_status, linked_via, linked_at, evidence, created_at, updated_at)
      values ('e-otro', 'p-otro-genero', 'rfee_license', ${f.license}, 'skermo_rfee', 'RFEE', ${h.edition.season}, '', '2026-09-01', '2027-08-31',
        'CONFIRMADO', 'prueba', 0, 'prueba', 0, 0)`);
    await lease.liberar();
    await ejecutarResultadosAuto(deps(db, transporte().t));
    expect(espia.prepare(`select person_id p from sport_result where source_fact_key=?`).get(f.factKey)).toEqual({ p: null });
    expect(espia.prepare(`select person_id p, status s, evidence e from sport_link_candidate where source='resultados_auto'`).all())
      .toEqual([{ p: 'p-otro-genero', s: 'PROPUESTO', e: 'id_externo_con_genero_o_edad_incompatible' }]);
  });
});
