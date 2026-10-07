/**
 * Sólo D1 local. PERF_ESTADO aislado; --preparar copia el espejo en modo
 * lectura y prepara UNA copia. Sin salida de filas, parámetros ni identidades.
 * Ejecutar antes/después con PERF_HOY fijo y comparar huellas de las respuestas.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { prepararEsquema } from './preparar-copia.mts';
import { abrirD1Local } from './d1-local.mts';
import { medidor, completarLecturas, type Registro } from './medidor.mts';

const raiz = resolve(import.meta.dirname, '../..');
if (process.argv.includes('--cache')) {
  const { almacenMemoria, almacenKv, enCascada } = await import('@/lib/cache/almacenes');
  let { crearCache } = await import('@/lib/cache/cache');
  // Reproduce exactamente las dos operaciones anteriores, sin tocar archivos.
  if (process.argv.includes('--anterior')) {
    const { transpileModule, ModuleKind, ScriptTarget } = await import('typescript');
    const codigo = readFileSync(join(raiz, 'src/lib/cache/cache.ts'), 'utf8')
      .replaceAll('await leer(almacen, clave.id)', 'await almacen.leer(clave.id).catch(() => null)')
      .replaceAll('await leer(almacen, alias.id)', 'await almacen.leer(alias.id).catch(() => null)')
      .replace('...(def.anteriorMientrasRevalida === false ? [] : [almacen.escribir(alias.id, { ...entrada, k: alias.completa })])',
        'almacen.escribir(alias.id, { ...entrada, k: alias.completa })');
    const js = transpileModule(codigo, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } })
      .outputText.replace(/from '(\.\/[^']+)'/g, (_m, p: string) => `from '${pathToFileURL(join(raiz, 'src/lib/cache', p + '.ts')).href}'`);
    ({ crearCache } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64')));
  }
  const medidas = [];
  for (const concurrencia of [1, 10, 50]) for (const anterior of [true, false]) {
    for (let repeticion = 0; repeticion < 5; repeticion++) {
      let get = 0, put = 0, bytes = 0, calculos = 0;
      const almacen = enCascada([almacenMemoria(), almacenKv({
        async get() { get++; await new Promise(r => setTimeout(r, 2)); return null; },
        async put(_k, v) { put++; bytes += Buffer.byteLength(v); },
      })]);
      const pendientes: Promise<unknown>[] = [];
      const cache = crearCache({
        almacen: () => almacen, versiones: { de: async () => 'v1', olvidar() {} },
        esperar: p => { pendientes.push(p); },
      });
      const leer = cache.definir({
        espacio: 'perfil-prueba', depende: [], frescoMs: 60_000, caducaMs: 60_000,
        anteriorMientrasRevalida: anterior,
        cargar: async () => { calculos++; await new Promise(r => setTimeout(r, 2)); return { datos: 'x'.repeat(191_881) }; },
      });
      for (const estado of ['fria', 'caliente']) {
        get = put = bytes = calculos = 0;
        const tiempos: number[] = [];
        await Promise.all(Array.from({ length: concurrencia }, async () => {
          const t = performance.now(); await leer(); tiempos.push(performance.now() - t);
        }));
        await Promise.all(pendientes.splice(0));
        tiempos.sort((a, b) => a - b);
        medidas.push({ concurrencia, anterior, repeticion, estado, get, put, bytes, calculos,
          p50: tiempos[Math.ceil(concurrencia * .5) - 1], p95: tiempos[Math.ceil(concurrencia * .95) - 1] });
      }
    }
  }
  writeFileSync(process.argv[2], JSON.stringify(medidas, null, 2));
  console.log('Simulación KV completada; 5 repeticiones, concurrencia 1/10/50, cargas fría/caliente');
  process.exit(0);
}
const estado = process.env.PERF_ESTADO;
if (!estado) throw new Error('Falta PERF_ESTADO exclusivo de este arnés');
const hoy = process.env.PERF_HOY ?? '2026-10-07';
if (process.argv.includes('--preparar')) {
  const copia = process.env.PERF_COPIA;
  const origen = process.env.PERF_ORIGEN;
  if (!copia || !origen || existsSync(copia)) throw new Error('Se exige origen y copia nueva');
  mkdirSync(estado, { recursive: true });
  copyFileSync(origen, copia);
  const d = new DatabaseSync(copia);
  try {
    console.log(prepararEsquema(d));
    for (const nombre of ['0014_notificaciones.sql', '0015_indices_rendimiento.sql',
      '0016_cache_epoca.sql', '0017_resultados_automaticos.sql', '0020_quitar_indices_duplicados.sql']) {
      d.exec(readFileSync(join(raiz, 'drizzle-d1', nombre), 'utf8'));
    }
    console.log('Esquema preparado; índices y tablas comprobados');
    console.log(d.prepare(`SELECT type, count(*) AS n FROM sqlite_master GROUP BY type`).all());
  } finally { d.close(); }
  process.exit(0);
}

const local = await abrirD1Local(estado, process.env.PERF_COPIA);
let registros: Registro[] = [];
const enlace = medidor(local.DB, () => registros);
const pendientes: Promise<unknown>[] = [];
let kvGet = 0, kvPut = 0, kvBytes = 0;
const kv = new Map<string, string>();
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = {
  env: { DB: enlace, CACHE_DATOS: {
    async get(k: string) { kvGet++; return kv.get(k) ?? null; },
    async put(k: string, v: string) { kvPut++; kvBytes += Buffer.byteLength(v); kv.set(k, v); },
  } },
  ctx: { waitUntil(p: Promise<unknown>) { pendientes.push(p); }, passThroughOnException() {} }, cf: {},
};
try {
  const { createD1Database } = await import('@/db/d1/runtime');
  const { esquemaDeportivo } = await import('@/lib/sport/esquema-db');
  const { cargarInicio } = await import('@/lib/sport/explorar/inicio-pantalla');
  const { cargarCabeceraPerfil, contextoPerfilPublico } = await import('@/lib/sport/explorar/perfil-cache-real');
  const { getAnotacionesOlimpicas, olvidarAnotacionesOlimpicas } = await import('@/lib/queries/olimpica');
  // Cuenta de fixture sólo en la copia, misma que el arnés de rutas.
  const cuenta = '4e1f6cfc-2693-42dd-8876-d75e1a9c8c9e';
  const persona = 'b40372bf-0b56-4faf-a603-4e0b7f351739';
  const top = await local.DB.prepare(`SELECT DISTINCT coalesce(per.merged_into_person_id, per.id) AS id
    FROM sport_ranking_publication p JOIN sport_ranking_entry e ON e.publication_id = p.id
    JOIN sport_person per ON per.id = e.person_id
    WHERE p.source = 'fie_tiradores' AND p.format = 'INDIVIDUAL' AND e.position <= 4 LIMIT 19`).all<{id: string}>();
  const ids = ['8bf5062e-5677-4540-b2bc-1ae911cda424', ...top.results.map(r => r.id)];
  await local.DB.batch(ids.map((id, i) => local.DB.prepare(
    'INSERT OR IGNORE INTO sport_favorite (profile_id, person_id, created_at) VALUES (?, ?, ?)',
  ).bind(cuenta, id, 1_700_000_000_000 + i)));
  const ctx = {
    ...contextoPerfilPublico(hoy), db: createD1Database(enlace), esquema: esquemaDeportivo,
    perfil: async () => ({
      authUserId: 'perf', email: 'perf@example.test', profileId: cuenta, fullName: 'Medida',
      role: 'athlete' as const, clubId: null, clubName: null, icalToken: '', weapons: [],
    }),
  };
  let inicio = cargarInicio;
  if (process.argv.includes('--feed-anterior')) {
    // El algoritmo previo, incluido el conteo correlacionado por resultado.
    // No toca fuentes: permite contrastar en el MISMO estado local.
    const { transpileModule, ModuleKind, ScriptTarget } = await import('typescript');
    const original = readFileSync(join(raiz, 'src/lib/sport/explorar/seguidos.ts'), 'utf8');
    const codigo = original
      .replace('pagina AS MATERIALIZED (', 'pagina AS (')
      .replace(/\), conteos AS MATERIALIZED \([\s\S]*?FROM \(SELECT DISTINCT prueba FROM pagina\) pruebas/, '')
      .replace('tot.participantes AS participantes', '(SELECT count(*) FROM sport_result x WHERE x.competition_id = pg.prueba) AS participantes')
      .replace('CROSS JOIN conteos tot ON tot.prueba = pg.prueba', '');
    if (codigo === original || codigo.includes('conteos AS MATERIALIZED')) throw new Error('La reconstrucción anterior no corresponde a esta versión');
    const js = transpileModule(codigo, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText
      .replace(/from '([^']+)'/g, (_m, p: string) => `from '${p.startsWith('./')
        ? pathToFileURL(join(raiz, 'src/lib/sport/explorar', p + '.ts')).href : import.meta.resolve(p)}'`);
    const anterior = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
    inicio = async (contexto, criterios) => {
      const r = await anterior.leerFeedSiguiendo(contexto, { ...criterios, limite: 20 });
      if (r.estado !== 'ok' || r.sinResultados) throw new Error('Esta comparación exige fixture de feed no vacío');
      return { vista: { tipo: 'ok', items: r.items, siguiente: r.siguiente, sinResultados: false }, siguiendo: null };
    };
  }
  const serializar = (v: unknown) => JSON.stringify(v, (_k, x) => x instanceof Map ? Object.fromEntries(x) : x instanceof Set ? [...x] : x);
  const medidas: object[] = [];
  const filtro = process.env.PERF_FILTRO ?? '';
  const rutas = [
    { nombre: 'feed', cargar: () => inicio(ctx, {}) },
    { nombre: 'feed-medallas', cargar: () => inicio(ctx, { soloMedallas: true }) },
    { nombre: 'cabecera', cargar: () => cargarCabeceraPerfil(ctx, persona) },
    { nombre: 'olimpica', cargar: () => getAnotacionesOlimpicas('FLORETE', 'M') },
  ].filter(r => !filtro || r.nombre === filtro);
  for (const ruta of rutas) {
    olvidarAnotacionesOlimpicas();
    for (const concurrencia of (process.env.PERF_CONCURRENCIA ?? '1,10,50').split(',').map(Number)) {
      for (let repeticion = 0; repeticion < Number(process.env.PERF_REPETICIONES ?? 5); repeticion++) {
        registros = [];
        kvGet = kvPut = kvBytes = 0;
        const t = performance.now();
        const tiempos: number[] = [];
        const respuestas = await Promise.all(Array.from({length: concurrencia}, async () => {
          const t0 = performance.now();
          const valor = await ruta.cargar();
          tiempos.push(performance.now() - t0);
          return serializar(valor);
        }));
        const ms = performance.now() - t;
        await Promise.all(pendientes.splice(0));
        const propias = registros;
        registros = [];
        await completarLecturas(local.DB, propias);
        tiempos.sort((a, b) => a - b);
        const m = {
          ruta: ruta.nombre, concurrencia, repeticion,
          cache: concurrencia === 1 && repeticion === 0 ? 'fria' : 'caliente',
          consultas: propias.length, leidas: propias.reduce((s, x) => s + (x.leidas ?? 0), 0),
          devueltas: propias.reduce((s, x) => s + x.devueltas, 0),
          escritas: propias.reduce((s, x) => s + x.escritas, 0),
          ms, p50: tiempos[Math.ceil(tiempos.length * .5) - 1], p95: tiempos[Math.ceil(tiempos.length * .95) - 1],
          bytes: respuestas.reduce((s, x) => s + Buffer.byteLength(x), 0),
          huellas: [...new Set(respuestas.map(x => createHash('sha256').update(x).digest('hex')))],
          kvGet, kvPut, kvBytes,
          consultasAgregadas: propias.map(x => ({ sql: x.sql, leidas: x.leidas, devueltas: x.devueltas })),
        };
        medidas.push(m);
        console.log(JSON.stringify({ ...m, consultasAgregadas: undefined, huellas: undefined }));
      }
    }
  }
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ hoy, medidas }, null, 2));
} finally { await local.cerrar(); }
