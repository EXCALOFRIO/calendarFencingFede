import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CacheEndpoint, CacheManifest } from '../../src/lib/ingest/backfill/cache-local';
import { claveEdicionFie } from '../../src/lib/ingest/fie-resultados-persist';
import {
  leerPruebaFie,
  urlCuadro,
  urlPoules,
  type EstadoCobertura,
  type LecturaPruebaFie,
  type ParteAsaltos,
} from '../../src/lib/ingest/sources/fie-resultados';
import { resultFactKey } from '../../src/lib/identity/resolver';
import {
  ficheroHechos,
  hechosPrueba,
  type AsaltoHecho,
  type HechosPrueba,
  type ResultadoHecho,
} from '../../src/lib/ingest/hechos/formato';
import { RAIZ_DATOS } from './comun';

/**
 * Convierte la caché local de la API FIE en ficheros de hechos (un JSON por
 * prueba, formato `hechosPrueba`) usando el mismo lector que la importación.
 * Las claves (temporada, competition_key, source_fact_key, refs de asalto)
 * son las de `fie-resultados-persist.ts`, para que el cargador actualice las
 * filas existentes en vez de duplicarlas.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-a-hechos.ts \
 *     [--cache <dir>] [--salida <dir>] [--base <sqlite>] [--limite N] [--concurrencia N]
 *
 * Sólo lee la caché y la base (en modo lectura); no hace peticiones de red.
 */

const TEMP = RAIZ_DATOS;
const POR_DEFECTO = {
  cache: path.join(TEMP, 'qa-prod-calendario', 'cache-fie-2018'),
  salida: path.join(TEMP, 'calendario-trabajo', 'hechos', 'fie'),
};

type Fetch = (url: string) => Promise<unknown>;

export function urlCanonica(url: string): string {
  const u = new URL(url);
  const q = [...u.searchParams.entries()]
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${u.origin}${u.pathname}${q ? `?${q}` : ''}`;
}

const sha256 = (datos: Uint8Array | string) => createHash('sha256').update(datos).digest('hex');

export { asaltosPorPrioridad, convertirPrueba, type Conversion } from '../../src/lib/ingest/hechos/fie';
import { convertirPrueba } from '../../src/lib/ingest/hechos/fie';

// ---------------------------------------------------------------------------
// Caché local
// ---------------------------------------------------------------------------

type Unidad = { season: number; competitionId: number; registros: CacheEndpoint[] };

async function cargarCache(raiz: string) {
  const manifest = JSON.parse(await readFile(path.join(raiz, 'manifest.json'), 'utf8')) as CacheManifest;
  if (manifest.version !== 1 || !manifest.units || !manifest.endpoints) throw new Error('manifest_invalido');
  const porUnidad = new Map<string, CacheEndpoint[]>();
  for (const r of Object.values(manifest.endpoints)) {
    const lista = porUnidad.get(r.unitKey) ?? [];
    lista.push(r);
    porUnidad.set(r.unitKey, lista);
  }
  const unidades: Unidad[] = Object.values(manifest.units)
    .filter((u) => u.competitionId !== null && u.season >= 2000)
    .map((u) => ({ season: u.season, competitionId: u.competitionId!, registros: porUnidad.get(u.key) ?? [] }))
    .sort((a, b) => a.season - b.season || a.competitionId - b.competitionId);
  return unidades;
}

async function fetchDeUnidad(raiz: string, u: Unidad) {
  const porUrl = new Map<string, CacheEndpoint>();
  for (const r of u.registros) porUrl.set(urlCanonica(r.url), r);
  const leidos = new Map<string, unknown>();
  const fetchJson: Fetch = async (url) => {
    const clave = urlCanonica(url);
    if (leidos.has(clave)) return leidos.get(clave);
    const r = porUrl.get(clave);
    if (!r || !r.blobSha256) throw new Error('cache_miss');
    if (r.status < 200 || r.status >= 300) throw new Error(`http_${r.status}`);
    const bytes = new Uint8Array(await readFile(path.join(raiz, 'blobs', r.blobSha256.slice(0, 2), `${r.blobSha256}.blob`)));
    if (sha256(bytes) !== r.blobSha256) throw new Error('hash_mismatch');
    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new Error('malformed_document');
    }
    leidos.set(clave, cuerpo);
    return cuerpo;
  };
  const tamanos = new Set(
    u.registros
      .map((r) => new URL(r.url))
      .filter((x) => x.pathname.endsWith('/results/ranking'))
      .map((x) => Number(x.searchParams.get('pageSize')))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
  const tamanoPagina = tamanos.size === 1 ? [...tamanos][0] : 200;
  const sourceSha256 = (usadas: string[]) => {
    const pares = [...new Set(usadas.map(urlCanonica))].sort()
      .map((x) => [x, porUrl.get(x)?.blobSha256 ?? null]);
    return sha256(JSON.stringify(pares));
  };
  return { fetchJson, tamanoPagina, sourceSha256 };
}

// ---------------------------------------------------------------------------
// Comparación con la base (sólo lectura)
// ---------------------------------------------------------------------------

type Recuento = { results: Set<string>; bouts: Set<string> };

async function cargarBase(ruta: string): Promise<Map<string, Recuento>> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(ruta, { readOnly: true });
  const mapa = new Map<string, Recuento>();
  const de = (k: string) => {
    let r = mapa.get(k);
    if (!r) mapa.set(k, (r = { results: new Set(), bouts: new Set() }));
    return r;
  };
  try {
    for (const c of db.prepare("select season, competition_key k from sport_competition where source = 'fie'").all()) {
      de(`${c.season}|${c.k}`);
    }
    const res = db.prepare(`select c.season, c.competition_key k, r.source_fact_key f from sport_result r
      join sport_competition c on c.id = r.competition_id where r.source = 'fie'`);
    for (const r of res.iterate()) de(`${r.season}|${r.k}`).results.add(String(r.f));
    const bts = db.prepare(`select c.season, c.competition_key k, b.phase, b.round_key, b.fencer_a_ref a, b.fencer_b_ref b
      from sport_bout b join sport_competition c on c.id = b.competition_id where b.source = 'fie'`);
    for (const b of bts.iterate()) de(`${b.season}|${b.k}`).bouts.add(`${b.phase}|${b.round_key}|${b.a}|${b.b}`);
  } finally {
    db.close();
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argumentos(argv: string[]) {
  const o = { cache: POR_DEFECTO.cache, salida: POR_DEFECTO.salida, base: null as string | null, limite: Infinity, concurrencia: 8 };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, valor] = [argv[i], argv[i + 1]];
    if (valor === undefined) throw new Error(`Falta el valor de ${flag}`);
    if (flag === '--cache') o.cache = valor;
    else if (flag === '--salida') o.salida = valor;
    else if (flag === '--base') o.base = valor;
    else if (flag === '--limite') o.limite = Number(valor);
    else if (flag === '--concurrencia') o.concurrencia = Number(valor);
    else throw new Error(`Opción desconocida ${flag}`);
  }
  return o;
}

async function main() {
  const o = argumentos(process.argv.slice(2));
  const inicio = Date.now();
  const unidades = (await cargarCache(o.cache)).slice(0, o.limite);
  await mkdir(o.salida, { recursive: true });

  const informe = {
    generadoEl: new Date().toISOString(),
    cache: o.cache,
    unidades: unidades.length,
    competitions: 0,
    results: 0,
    bouts: 0,
    boutsPrioridad: 0,
    boutsFueraDeRango: 0,
    porFormato: { INDIVIDUAL: 0, EQUIPOS: 0 } as Record<string, number>,
    estados: { results: {}, pools: {}, tableau: {} } as Record<'results' | 'pools' | 'tableau', Record<string, number>>,
    errores: [] as { season: number; competitionId: number; codigo: string; detalle: string }[],
    erroresPorCodigo: {} as Record<string, number>,
    comparacionBase: null as unknown,
    segundos: 0,
  };
  const propios = new Map<string, Recuento>();
  const ficheros = new Set<string>();

  let siguiente = 0;
  async function trabajador() {
    while (siguiente < unidades.length) {
      const u = unidades[siguiente++];
      try {
        const f = await fetchDeUnidad(o.cache, u);
        const c = await convertirPrueba(u.season, u.competitionId, f.fetchJson, f);
        if (!c.ok) {
          informe.errores.push({ season: u.season, competitionId: u.competitionId, codigo: c.codigo, detalle: c.detalle });
          continue;
        }
        const h = hechosPrueba.parse(c.hechos);
        const nombre = ficheroHechos(h);
        if (ficheros.has(nombre)) throw new Error(`fichero_duplicado ${nombre}`);
        ficheros.add(nombre);
        await writeFile(path.join(o.salida, nombre), `${JSON.stringify(h, null, 1)}\n`, 'utf8');
        informe.competitions += 1;
        informe.results += h.results.length;
        informe.bouts += h.bouts.length;
        informe.boutsPrioridad += c.prioridad;
        informe.boutsFueraDeRango += c.fueraDeRango;
        informe.porFormato[h.competition.format] += 1;
        for (const k of ['results', 'pools', 'tableau'] as const) {
          informe.estados[k][h.status[k]] = (informe.estados[k][h.status[k]] ?? 0) + 1;
        }
        propios.set(`${h.edition.season}|${h.competition.competitionKey}`, {
          results: new Set(h.results.map((r) => r.factKey)),
          bouts: new Set(h.bouts.map((b) => `${b.phase}|${b.roundKey}|${b.aRef}|${b.bRef}`)),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        informe.errores.push({ season: u.season, competitionId: u.competitionId, codigo: 'excepcion', detalle: msg.slice(0, 200) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, o.concurrencia) }, trabajador));
  for (const e of informe.errores) informe.erroresPorCodigo[e.codigo] = (informe.erroresPorCodigo[e.codigo] ?? 0) + 1;
  informe.errores.sort((a, b) => a.season - b.season || a.competitionId - b.competitionId);

  if (o.base) {
    const base = await cargarBase(o.base);
    let baseResults = 0;
    let baseBouts = 0;
    const faltanEnSalida: string[] = [];
    const inferiores: unknown[] = [];
    let resultadosBaseAusentes = 0;
    let asaltosBaseAusentes = 0;
    let resultadosNuevos = 0;
    let asaltosNuevos = 0;
    for (const [k, b] of base) {
      baseResults += b.results.size;
      baseBouts += b.bouts.size;
      const p = propios.get(k);
      if (!p) {
        faltanEnSalida.push(k);
        resultadosBaseAusentes += b.results.size;
        asaltosBaseAusentes += b.bouts.size;
        continue;
      }
      const rAus = [...b.results].filter((x) => !p.results.has(x)).length;
      const bAus = [...b.bouts].filter((x) => !p.bouts.has(x)).length;
      resultadosBaseAusentes += rAus;
      asaltosBaseAusentes += bAus;
      resultadosNuevos += [...p.results].filter((x) => !b.results.has(x)).length;
      asaltosNuevos += [...p.bouts].filter((x) => !b.bouts.has(x)).length;
      if (rAus || bAus || p.results.size < b.results.size || p.bouts.size < b.bouts.size) {
        inferiores.push({
          clave: k,
          base: { results: b.results.size, bouts: b.bouts.size },
          salida: { results: p.results.size, bouts: p.bouts.size },
          ausentes: { results: rAus, bouts: bAus },
        });
      }
    }
    const soloEnSalida = [...propios.keys()].filter((k) => !base.has(k));
    for (const k of soloEnSalida) {
      resultadosNuevos += propios.get(k)!.results.size;
      asaltosNuevos += propios.get(k)!.bouts.size;
    }
    informe.comparacionBase = {
      base: o.base,
      competitionsBase: base.size,
      resultsBase: baseResults,
      boutsBase: baseBouts,
      faltanEnSalida,
      soloEnSalida,
      resultadosBaseAusentes,
      asaltosBaseAusentes,
      resultadosNuevos,
      asaltosNuevos,
      pruebasConMenos: inferiores,
    };
  }
  informe.segundos = Math.round((Date.now() - inicio) / 1000);
  await writeFile(path.join(o.salida, '_informe.json'), `${JSON.stringify(informe, null, 2)}\n`, 'utf8');
  const { errores: _e, comparacionBase, ...resumen } = informe;
  console.log(JSON.stringify({ ...resumen, errores: informe.errores.length }, null, 2));
  if (comparacionBase) {
    const { pruebasConMenos, faltanEnSalida, soloEnSalida, ...c } = comparacionBase as Record<string, unknown[]>;
    console.log(JSON.stringify({ ...c, faltanEnSalida: faltanEnSalida.length, soloEnSalida: soloEnSalida.length, pruebasConMenos: pruebasConMenos.length }, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
