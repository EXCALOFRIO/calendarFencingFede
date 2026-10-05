import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { claveEdicionFie } from '../../src/lib/ingest/fie-resultados-persist';
import {
  hechosPrueba,
  ficheroHechos,
  type AsaltoHecho,
  type HechosPrueba,
  type ResultadoHecho,
} from '../../src/lib/ingest/hechos/formato';
import {
  leerPruebaFie,
  urlCuadro,
  urlPoules,
  urlPrueba,
  urlRanking,
  type EstadoCobertura,
  type ParteAsaltos,
} from '../../src/lib/ingest/sources/fie-resultados';
import { resultFactKey } from '../../src/lib/identity/resolver';
import { RAIZ_DATOS } from './comun';

/**
 * Convierte las respuestas FIE descargadas por `fie-descargar-antiguas.ts` al formato común
 * de hechos, con el mismo lector (`leerPruebaFie`) que la ingesta FIE, sin red.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-antiguas-a-hechos.ts [--entrada <dir>] [--salida <dir>] [--todo]
 *
 * Sólo procesa las pruebas con línea no fallida en progress.jsonl. Sin `--todo` se salta las
 * que ya tienen fichero de hechos, así que puede correr en incrementos mientras descarga.
 */

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const TMP = RAIZ_DATOS;
const ENTRADA = opt('--entrada', path.join(TMP, 'calendario-trabajo', 'fie-antiguo'));
const SALIDA = opt('--salida', path.join(TMP, 'calendario-trabajo', 'hechos', 'fie-antiguo'));
const TODO = args.includes('--todo');
const RAW = path.join(ENTRADA, 'raw');
const TAMANO_PAGINA = 200;

mkdirSync(SALIDA, { recursive: true });

type Linea = { season: number; id: number; estado: string };

const PAIS = /^[A-Z]{3}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (v: string | null) => (v && FECHA.test(v) ? v : null);
const pais = (v: string | null) => (v && PAIS.test(v) ? v : null);

function estado(e: EstadoCobertura | undefined): HechosPrueba['status']['results'] {
  if (e === 'completo' || e === 'sin_resultados' || e === 'parcial') return e;
  if (e === 'conflicto') return 'parcial';
  return e === undefined ? 'sin_resultados' : 'ilegible';
}

/** Mapa URL -> fichero raw, en el mismo orden en que el lector los pide. */
function lectorOffline(season: number, id: number, leidos: Buffer[]) {
  const mapa = new Map<string, string>([
    [urlPrueba(season, id), 'meta'],
    [urlPoules(season, id), 'pools'],
    [urlCuadro(season, id), 'tableau'],
  ]);
  for (let p = 1; p <= 200; p += 1) mapa.set(urlRanking(season, id, p, TAMANO_PAGINA), `ranking-p${p}`);
  return async (url: string): Promise<unknown> => {
    const kind = mapa.get(url);
    if (!kind) throw new Error('URL no prevista');
    const f = path.join(RAW, `${season}-${id}-${kind}.json`);
    if (!existsSync(f)) throw new Error(`falta ${kind}`);
    const b = readFileSync(f);
    leidos.push(b);
    return JSON.parse(b.toString('utf8'));
  };
}

const informe = {
  generado: '',
  pruebasEnProgreso: 0,
  convertidas: 0,
  yaExistentes: 0,
  conResultados: 0,
  sinResultados: 0,
  errorMetadata: 0,
  errorValidacion: 0,
  resultados: 0,
  asaltosPoule: 0,
  asaltosCuadro: 0,
  asaltosDescartadosMarcador: 0,
  porEstadoRanking: {} as Record<string, number>,
  erroresMetadata: {} as Record<string, number>,
};

function asaltos(parte: ParteAsaltos | null, descartados: { n: number }): AsaltoHecho[] {
  if (!parte) return [];
  const salida: AsaltoHecho[] = [];
  for (const a of parte.asaltos) {
    if (a.puntosA > 45 || a.puntosB > 45) {
      descartados.n += 1;
      continue;
    }
    salida.push({
      phase: a.fase,
      roundKey: a.ronda,
      aRef: a.refA,
      bRef: a.refB,
      aName: a.nombreA,
      bName: a.nombreB,
      scoreA: a.puntosA,
      scoreB: a.puntosB,
      winner: null,
    });
  }
  return salida;
}

async function convertir(season: number, id: number): Promise<void> {
  const leidos: Buffer[] = [];
  const lectura = await leerPruebaFie(season, id, { fetchJson: lectorOffline(season, id, leidos) }, {
    tamanoPagina: TAMANO_PAGINA,
    maxPaginas: 200,
  });
  const p = lectura.prueba;
  if (!p) {
    informe.errorMetadata += 1;
    const motivo = lectura.errorPrueba ?? 'desconocido';
    informe.erroresMetadata[motivo] = (informe.erroresMetadata[motivo] ?? 0) + 1;
    return;
  }
  const individual = p.formato === 'INDIVIDUAL';
  const resultados: ResultadoHecho[] = (lectura.ranking?.puestos ?? []).map((r) => ({
    factKey: individual ? resultFactKey(String(r.fieId)) : `team:${r.fieId}`,
    name: r.nombre,
    countryCode: pais(r.paisCodigo),
    club: null,
    position: r.posicion !== null && r.posicion > 0 ? r.posicion : null,
    positionRaw: r.posicion === null ? null : String(r.posicion),
    points: r.puntosPrueba === null ? null : String(r.puntosPrueba),
    fieId: individual ? String(r.fieId) : null,
    license: null,
    birthYear: null,
  }));
  const descartados = { n: 0 };
  const boutsPoule = asaltos(lectura.poules, descartados);
  const boutsCuadro = asaltos(lectura.cuadro, descartados);
  const notas: string[] = [];
  if (lectura.ranking?.cobertura.error) notas.push(`ranking: ${lectura.ranking.cobertura.error}`);
  if (lectura.poules?.cobertura.error) notas.push(`pools: ${lectura.poules.cobertura.error}`);
  if (lectura.cuadro?.cobertura.error) notas.push(`tableau: ${lectura.cuadro.cobertura.error}`);
  if (!individual) notas.push('equipos: factKey team:<id FIE del equipo>; sin poules ni cuadro');
  if (descartados.n) notas.push(`asaltos descartados por marcador > 45: ${descartados.n}`);
  notas.push('sourceSha256 = SHA-256 de las respuestas leídas concatenadas (meta, ranking, pools, tableau)');

  const sha = createHash('sha256');
  for (const b of leidos) sha.update(b);
  const hechos: HechosPrueba = {
    version: 1,
    source: 'fie',
    extractor: 'lector_fie',
    sourceUrl: p.url,
    sourceSha256: sha.digest('hex'),
    edition: {
      season: String(season),
      tournamentKey: claveEdicionFie(p).clave,
      name: p.nombre ?? `FIE ${season}/${id}`,
      startDate: fecha(p.inicio),
      endDate: fecha(p.fin),
      city: p.ciudad,
      countryCode: pais(p.federacion),
    },
    competition: {
      competitionKey: String(id),
      weapon: p.arma,
      gender: p.genero,
      category: p.categoria as HechosPrueba['competition']['category'],
      categoryRaw: p.categoriaOriginal,
      format: p.formato,
      date: fecha(p.fecha),
    },
    status: {
      results: estado(lectura.ranking?.cobertura.estado),
      pools: estado(lectura.poules?.cobertura.estado),
      tableau: estado(lectura.cuadro?.cobertura.estado),
      publishedParticipants: lectura.ranking?.cobertura.publicado ?? null,
      notes: notas,
    },
    results: resultados,
    bouts: [...boutsPoule, ...boutsCuadro],
  };
  const v = hechosPrueba.safeParse(hechos);
  if (!v.success) {
    informe.errorValidacion += 1;
    const motivo = `zod: ${v.error.issues[0]?.path.join('.')} ${v.error.issues[0]?.message}`.slice(0, 120);
    informe.erroresMetadata[motivo] = (informe.erroresMetadata[motivo] ?? 0) + 1;
    return;
  }
  const destino = path.join(SALIDA, ficheroHechos(v.data));
  writeFileSync(`${destino}.tmp`, JSON.stringify(v.data));
  renameSync(`${destino}.tmp`, destino);

  informe.convertidas += 1;
  if (resultados.length || hechos.bouts.length) informe.conResultados += 1;
  else informe.sinResultados += 1;
  informe.resultados += resultados.length;
  informe.asaltosPoule += boutsPoule.length;
  informe.asaltosCuadro += boutsCuadro.length;
  informe.asaltosDescartadosMarcador += descartados.n;
  const er = hechos.status.results;
  informe.porEstadoRanking[er] = (informe.porEstadoRanking[er] ?? 0) + 1;
}

async function main() {
  const progreso = path.join(ENTRADA, 'progress.jsonl');
  const ultimas = new Map<string, Linea>();
  for (const l of readFileSync(progreso, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l) as Linea;
      ultimas.set(`${j.season}-${j.id}`, j);
    } catch {
      /* línea a medio escribir */
    }
  }
  const existentes = new Set(readdirSync(SALIDA));
  const listas = [...ultimas.values()].filter((l) => l.estado !== 'error');
  informe.pruebasEnProgreso = listas.length;
  for (const l of listas) {
    const nombre = `fie__${l.season}__${l.id}.json`;
    if (!TODO && existentes.has(nombre)) {
      informe.yaExistentes += 1;
      continue;
    }
    await convertir(l.season, l.id);
  }
  // El informe acumulado se recalcula sobre todos los ficheros de salida.
  const total = { ficheros: 0, conResultados: 0, sinResultados: 0, resultados: 0, asaltos: 0, porEstadoRanking: {} as Record<string, number>,
    porTemporada: {} as Record<string, { pruebas: number; resultados: number; asaltos: number }> };
  for (const f of readdirSync(SALIDA)) {
    if (!f.startsWith('fie__') || !f.endsWith('.json')) continue;
    const h = JSON.parse(readFileSync(path.join(SALIDA, f), 'utf8')) as HechosPrueba;
    total.ficheros += 1;
    total.resultados += h.results.length;
    total.asaltos += h.bouts.length;
    if (h.results.length || h.bouts.length) total.conResultados += 1;
    else total.sinResultados += 1;
    total.porEstadoRanking[h.status.results] = (total.porEstadoRanking[h.status.results] ?? 0) + 1;
    const t = (total.porTemporada[h.edition.season] ??= { pruebas: 0, resultados: 0, asaltos: 0 });
    t.pruebas += 1;
    t.resultados += h.results.length;
    t.asaltos += h.bouts.length;
  }
  informe.generado = new Date().toISOString();
  const salida = { ...informe, acumulado: total };
  writeFileSync(path.join(SALIDA, '_informe.json'), JSON.stringify(salida, null, 2));
  console.log(JSON.stringify({ ...salida, acumulado: { ...total, porTemporada: undefined } }, null, 2));
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
