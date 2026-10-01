import 'dotenv/config';
import { fetchJson, fetchText } from '../src/lib/ingest/fetcher';
import {
  combinacionesRfee,
  claveRanking,
  leerRankingFie,
  leerRankingRfee,
  tareasRankingFie,
  type LecturaRanking,
} from '../src/lib/ingest/sources/ranking-oficial-historico';
import {
  parseSkermoRankingCategories,
  parseSkermoSeasons,
  RANKING_FEDERATION,
  skermoRankingFormUrl,
} from '../src/lib/ingest/sources/ranking-rfee';

/**
 * Rankings OFICIALES (no el cálculo interno) de una temporada:
 *
 *   npm run ranking-oficial -- rfee 2021-2022 --max 6            -> lectura y resumen, no escribe
 *   npm run ranking-oficial -- fie 2024 --max 6 --aplicar        -> además guarda en la base
 *
 * RFEE: la temporada se lee del formulario de Skermo y sólo se piden las
 * categorías que el formulario ofrece (hoy no incluye M10/M12). FIE: 48 listas
 * por año (individual y equipos). Sin `--aplicar` sólo hace GET públicos y
 * muestra recuentos, sin nombres. `--aplicar` omite las listas ya cerradas
 * (salvo `--releer`) y exige el esquema 0017 aplicado por el propietario;
 * M10/M12 además exigen la 0019. `--max` aplaza listas, no las recorta.
 */

const args = process.argv.slice(2);
const maxArg = args.indexOf('--max');
const [fuenteArg, temporada] = args.filter((a, i) => !a.startsWith('--') && i !== maxArg + 1);
const max = maxArg >= 0 ? Number(args[maxArg + 1]) : 6;
const aplicar = args.includes('--aplicar');
const releer = args.includes('--releer');
const PAUSA_MS = 400;

if (
  !(fuenteArg === 'rfee' || fuenteArg === 'fie') ||
  !temporada ||
  !Number.isInteger(max) ||
  max < 1 ||
  (fuenteArg === 'fie' && !/^\d{4}$/.test(temporada)) ||
  (fuenteArg === 'rfee' && !/^\d{4}-\d{4}$/.test(temporada))
) {
  console.error('Uso: npm run ranking-oficial -- <rfee AAAA-AAAA | fie AAAA> [--max N] [--aplicar] [--releer]');
  process.exit(1);
}

const hoy = new Date().toISOString().slice(0, 10);
const fuente = fuenteArg === 'rfee' ? 'skermo_ranking' : 'fie_tiradores';

type Tarea = { clave: string; leer: () => Promise<LecturaRanking> };
const tareas: Tarea[] = [];

if (fuenteArg === 'rfee') {
  const { body: formulario } = await fetchText(skermoRankingFormUrl(RANKING_FEDERATION), { timeoutMs: 60_000 });
  const opcion = parseSkermoSeasons(formulario).find((o) => o.label === temporada);
  if (!opcion) {
    console.error(`El ranking de Skermo/${RANKING_FEDERATION} no publica la temporada ${temporada}.`);
    process.exit(1);
  }
  const deps = { html: async (url: string) => (await fetchText(url, { timeoutMs: 60_000 })).body };
  for (const combo of combinacionesRfee(parseSkermoRankingCategories(formulario))) {
    tareas.push({
      clave: claveRanking(combo.weapon, combo.gender, combo.categoryRaw, 'INDIVIDUAL'),
      leer: () => leerRankingRfee({ season: opcion, combo, hoy }, deps),
    });
  }
} else {
  const deps = { json: (url: string) => fetchJson<unknown>(url, { timeoutMs: 60_000 }) };
  const armas = { E: 'ESPADA', F: 'FLORETE', S: 'SABLE' } as const;
  for (const t of tareasRankingFie(Number(temporada))) {
    tareas.push({
      clave: claveRanking(armas[t.weapon as keyof typeof armas], t.gender, t.category, t.tipo === 'E' ? 'EQUIPOS' : 'INDIVIDUAL'),
      leer: () => leerRankingFie(t, hoy, deps),
    });
  }
}
console.log(`${fuenteArg.toUpperCase()} ${temporada}: ${tareas.length} listas posibles.`);

let persistencia: {
  deps: import('../src/lib/ingest/ranking-oficial-persist').DepsPersistenciaRanking;
  persistir: typeof import('../src/lib/ingest/ranking-oficial-persist').persistirLecturaRanking;
  cerradas: Set<string>;
} | null = null;

if (aplicar) {
  const { db } = await import('../src/db');
  const { esquemaDeportivo } = await import('../src/lib/sport/esquema-db');
  const { crearDepsPersistenciaRankingDb, clavesRankingLeidas } = await import('../src/lib/ingest/ranking-oficial-db');
  const { persistirLecturaRanking } = await import('../src/lib/ingest/ranking-oficial-persist');
  if (!(await esquemaDeportivo()).identidad) {
    console.log('El esquema deportivo (migración 0017) no está aplicado: no se escribió nada.');
    process.exit(2);
  }
  persistencia = {
    deps: crearDepsPersistenciaRankingDb(db),
    persistir: persistirLecturaRanking,
    cerradas: await clavesRankingLeidas(db, fuente, temporada),
  };
}

const pendientes = tareas.filter((t) => releer || !persistencia?.cerradas.has(t.clave));
const lote = pendientes.slice(0, max);
const estados: Record<string, number> = {};
const escritura: Record<string, number> = {};
let filas = 0;
for (const tarea of lote) {
  const lectura = await tarea.leer();
  estados[lectura.cobertura.estado] = (estados[lectura.cobertura.estado] ?? 0) + 1;
  filas += lectura.publicacion?.entradas.length ?? 0;
  if (persistencia) {
    const r = await persistencia.persistir(persistencia.deps, lectura);
    const clave = r.publicacion ?? r.estado;
    escritura[clave] = (escritura[clave] ?? 0) + 1;
  }
  await new Promise((r) => setTimeout(r, PAUSA_MS));
}
console.log(
  `Leídas ${lote.length} de ${pendientes.length} pendientes: estados=${JSON.stringify(estados)} filas=${filas}` +
    (persistencia ? ` escritura=${JSON.stringify(escritura)}` : '') +
    (pendientes.length > lote.length ? ` (quedan ${pendientes.length - lote.length} para otra ejecución)` : ''),
);
if (!aplicar) console.log('Modo lectura: no se ha escrito nada. Añade --aplicar para guardar.');
