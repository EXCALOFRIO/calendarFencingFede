/**
 * Extracción con droids de los PDF RFEE que el lector local no lee entero.
 *
 * Por cada PDF lanza `droid exec` (sólo herramienta Read, sin red), valida en
 * código la respuesta contra el texto del propio PDF y escribe un fichero de
 * hechos por prueba (formato común `hechosPrueba`). Las claves se calculan
 * aquí, igual que el lector local, a partir de la URL y de la cabecera: el
 * modelo nunca decide una clave.
 *
 * Uso:
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/pdf-droids.ts [--limite N] [--solo sha,sha]
 *     [--concurrencia 8] [--modelo gpt-6-luna] [--modelo-fuerte gpt-6-sol] [--timeout 300]
 *     [--reintentar-fallos] [--revalidar]
 *
 * `--revalidar` vuelve a pasar la validación sobre las respuestas crudas guardadas, sin lanzar droids.
 * Reanudable: un PDF con estado `hecho` en pdf-droid-raw/_estado no se vuelve a lanzar.
 * Los registros nunca imprimen nombres de personas; las respuestas crudas quedan en pdf-droid-raw.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { freemem, homedir } from 'node:os';
import { RAIZ_DATOS } from './comun';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ARMAS, CATEGORIAS, FORMATOS, GENEROS, ficheroHechos, hechosPrueba,
  type AsaltoHecho, type HechosPrueba, type ResultadoHecho,
} from '../../src/lib/ingest/hechos/formato';
import { metadatosDeCabecera } from '../../src/lib/ingest/sources/rfee-pdf/cabecera';
import { normalizar } from '../../src/lib/ingest/sources/rfee-pdf/geometria';
import { consistenciaCuadro } from './cuadro-consistencia';
import { fechasCatalogo, indiceFechas, type IndiceFechas, type InventarioNacional, type PruebaFecha } from './fechas-catalogo';

export * from '../../src/lib/ingest/hechos/pdf-validacion';
import { docIdDeUrl, slugCohorte, claveEdicion, claveCompeticion, compacto, claveNombre, extraerJson, listasGanadores, validarExtraccion, type ContextoValidacion, type Descartes, type ResultadoValidacion, arr, enumDe, estadoDe, int, str, ESTADOS, type AsaltoCrudo, type Estado, type PruebaCruda } from '../../src/lib/ingest/hechos/pdf-validacion';

/** Peso de una extracción para elegir entre intentos: filas válidas, penalizando descartes. */
export function puntuar(v: ResultadoValidacion): number {
  const desc = Object.values(v.descartes).reduce((a, b) => a + b, 0);
  return v.aceptadas.results * 2 + v.aceptadas.bouts - desc;
}

/** ¿Merece la pena repetir con el modelo fuerte? */
export function necesitaEscalar(
  v: ResultadoValidacion | null,
  lectorLocal: { results?: number | null; bouts?: number | null } = {},
): boolean {
  if (!v) return true;
  if (v.sinTexto) return false;
  if (v.hechos.length === 0) return true;
  const propuestas = v.propuestas.results + v.propuestas.bouts;
  const aceptadas = v.aceptadas.results + v.aceptadas.bouts;
  if (propuestas === 0) return true;
  // El droid sólo aporta si llega a lo que ya lee el lector local (con margen para filas descartadas).
  if ((lectorLocal.results ?? 0) * 0.9 > v.aceptadas.results || (lectorLocal.bouts ?? 0) * 0.9 > v.aceptadas.bouts) return true;
  return (propuestas - aceptadas) / propuestas > 0.15;
}

// ---------------------------------------------------------------- troceado de PDF largos

/**
 * Los modelos recortan la respuesta en PDF largos (cientos de asaltos). Para
 * esos se pide la clasificación en una pasada y los asaltos por tramos de páginas.
 */
export const PAGINAS_POR_TRAMO = 6;

export function tramos(paginas: number, porTramo = PAGINAS_POR_TRAMO): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 1; a <= paginas; a += porTramo) out.push([a, Math.min(paginas, a + porTramo - 1)]);
  return out;
}

export const ALCANCE_RESULTADOS =
  'SCOPE OF THIS PASS: extract ONLY the competitions and their final classification (results). Return empty "pools" and "tableau" lists and set status.pools and status.tableau to "sin_resultados". Bouts are extracted in other passes.';

export const alcanceAsaltos = (a: number, b: number) =>
  `SCOPE OF THIS PASS: look ONLY at pages ${a} to ${b} and extract ONLY the pool bouts and tableau bouts printed on those pages, completely. Return an empty "results" list with status.results "sin_resultados". For each competition with bouts on those pages still fill headerLines, weapon, gender, category, categoryRaw, format and date. Set status.pools / status.tableau for what appears on these pages ("sin_resultados" if none).`;

/** Firma de una prueba para emparejar pasadas: los mismos atributos que la clave. */
function firmaPrueba(p: PruebaCruda, conCohorte: boolean): string {
  const meta = metadatosDeCabecera(arr(p.headerLines).map(str).filter((l): l is string => l !== null));
  const partes: (string | null)[] = [
    meta.arma ?? enumDe(p.weapon, ARMAS), meta.genero ?? enumDe(p.gender, GENEROS),
    meta.formato ?? enumDe(p.format, FORMATOS), enumDe(meta.categoria, CATEGORIAS) ?? enumDe(p.category, CATEGORIAS),
  ];
  if (conCohorte) partes.push(slugCohorte(meta.cohorte ?? ''));
  return partes.join(':');
}

const PEOR: Record<Estado, number> = { completo: 0, sin_resultados: 1, parcial: 2, ilegible: 3 };

/** Une el estado de una sección leída por tramos: vacía si ningún tramo la tiene, parcial si alguno lo es. */
function unirEstado(estados: (Estado | null)[]): Estado {
  const con = estados.filter((e): e is Estado => e !== null && e !== 'sin_resultados');
  if (con.length === 0) return 'sin_resultados';
  return con.reduce((a, b) => (PEOR[b] > PEOR[a] ? b : a));
}

/**
 * Une la pasada de clasificación con las pasadas de asaltos. Cada prueba de un
 * tramo se asigna a la prueba de la clasificación con la misma firma (con
 * cohorte, luego sin ella, luego la única que haya); si no casa, entra como
 * prueba propia sin clasificación.
 */
export function fusionarTramos(resultados: unknown, trozos: unknown[]): unknown {
  const base = (resultados ?? {}) as { documentTitle?: unknown; competitions?: unknown };
  const pruebas = (arr(base.competitions) as PruebaCruda[]).map((p) => ({
    ...p,
    pools: [] as { pool?: unknown; fencers?: unknown; bouts?: unknown }[],
    tableau: [] as AsaltoCrudo[],
    _pools: [] as (Estado | null)[],
    _tableau: [] as (Estado | null)[],
  }));
  type Destino = (typeof pruebas)[number];
  const buscar = (p: PruebaCruda): Destino | null => {
    for (const conCohorte of [true, false]) {
      const f = firmaPrueba(p, conCohorte);
      const c = pruebas.filter((d) => firmaPrueba(d, conCohorte) === f);
      if (c.length === 1) return c[0];
    }
    return pruebas.length === 1 ? pruebas[0] : null;
  };
  for (const trozo of trozos) {
    for (const p of arr((trozo as { competitions?: unknown } | null)?.competitions) as PruebaCruda[]) {
      const poolsT = arr(p.pools) as { pool?: unknown; fencers?: unknown; bouts?: unknown }[];
      const tabT = arr(p.tableau) as AsaltoCrudo[];
      let d = buscar(p);
      if (!d) {
        if (poolsT.length === 0 && tabT.length === 0) continue;
        d = { ...p, results: [], status: { results: 'sin_resultados' }, pools: [], tableau: [], _pools: [], _tableau: [] };
        pruebas.push(d);
      }
      d._pools.push(estadoDe(p.status?.pools));
      d._tableau.push(estadoDe(p.status?.tableau));
      for (const pool of poolsT) {
        // Una poule partida entre dos tramos se une por su número.
        const existente = d.pools.find((x) => int(x.pool) !== null && int(x.pool) === int(pool.pool));
        if (!existente) {
          d.pools.push({ pool: pool.pool, fencers: [...arr(pool.fencers)], bouts: [...arr(pool.bouts)] });
          continue;
        }
        const fencers = arr(existente.fencers);
        for (const f of arr(pool.fencers)) if (!fencers.includes(f)) fencers.push(f);
        existente.fencers = fencers;
        existente.bouts = [...arr(existente.bouts), ...arr(pool.bouts)];
      }
      for (const a of tabT) {
        const repetido = d.tableau.some((x) =>
          str(x.round) === str(a.round) && x.scoreA === a.scoreA && x.scoreB === a.scoreB
          && str(x.aName) === str(a.aName) && str(x.bName) === str(a.bName));
        if (!repetido) d.tableau.push(a);
      }
    }
  }
  return {
    documentTitle: base.documentTitle ?? null,
    competitions: pruebas.map(({ _pools, _tableau, ...p }) => {
      // Una poule que aparece en dos tramos repite asaltos: se quedan una vez por pareja.
      const pools = p.pools.map((pool) => {
        const vistos = new Set<string>();
        const bouts = (arr(pool.bouts) as AsaltoCrudo[]).filter((b) => {
          const k = [compacto(str(b.aName) ?? ''), compacto(str(b.bName) ?? '')].sort().join('|');
          if (vistos.has(k)) return false;
          vistos.add(k);
          return true;
        });
        return { ...pool, bouts };
      });
      return {
        ...p,
        pools,
        status: { ...(p.status ?? {}), pools: unirEstado(_pools), tableau: unirEstado(_tableau) },
      };
    }),
  };
}

// ---------------------------------------------------------------- ejecución

const TEMP = RAIZ_DATOS;
const TRABAJO = join(TEMP, 'calendario-trabajo');
export const RUTAS = {
  calidad: join(TRABAJO, 'hechos', 'pdf-calidad.json'),
  salida: join(TRABAJO, 'hechos', 'pdf-droid'),
  crudo: join(TRABAJO, 'pdf-droid-raw'),
  estado: join(TRABAJO, 'pdf-droid-raw', '_estado'),
  trabajo: join(TRABAJO, 'pdf-droid-work'),
  base: join(TRABAJO, 'base.sqlite'),
  inventario: join(TEMP, 'qa-prod-calendario', 'history-national', 'national-inventory.json'),
  droid: join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', 'droid', 'bin', 'droid'),
  prompt: join(dirname(fileURLToPath(import.meta.url)), 'pdf-droid-prompt.md'),
};

type EntradaCalidad = {
  pdfId: string; url: string; sha256: string; blobPath: string; season?: string | null;
  docId?: string | null; needsDroid: boolean; reason?: string;
  /** Lo que ya lee el lector local de este PDF. */
  pages?: number | null; results?: number | null; bouts?: number | null;
};

type EstadoPdf = {
  pdfId: string; url: string; urls: string[]; sha256: string; hecho: boolean; modelo: string | null;
  clavesEnProduccion: number; resultadosEscritos: number; asaltosEscritos: number;
  /** `completo` (una llamada) o `tramos` (clasificación + asaltos por páginas). */
  modo: string | null;
  intentos: { modelo: string; ok: boolean; motivo: string | null; segundos: number; puntuacion: number | null }[];
  ficheros: string[];
  propuestas: { results: number; bouts: number };
  aceptadas: { results: number; bouts: number };
  descartes: Descartes;
  estados: { results: Record<string, number>; pools: Record<string, number>; tableau: Record<string, number> };
  problemas: string[];
  sinTexto: boolean;
  error: string | null;
  segundos: number;
  terminadoEn: string;
};

function argumentos() {
  const a = process.argv.slice(2);
  const valor = (n: string) => {
    const i = a.indexOf(n);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    limite: valor('--limite') ? Number(valor('--limite')) : Infinity,
    solo: valor('--solo')?.split(',').filter(Boolean) ?? null,
    concurrencia: Number(valor('--concurrencia') ?? 8),
    modelo: valor('--modelo') ?? 'gpt-6-luna',
    modeloFuerte: valor('--modelo-fuerte') ?? 'gpt-6-sol',
    timeoutMs: Number(valor('--timeout') ?? 300) * 1000,
    timeoutFuerteMs: Number(valor('--timeout-fuerte') ?? 600) * 1000,
    reintentarFallos: a.includes('--reintentar-fallos'),
    /** Vuelve a validar las respuestas crudas guardadas, sin lanzar droids. */
    revalidar: a.includes('--revalidar'),
  };
}

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

async function escribirAtomico(ruta: string, contenido: string) {
  const tmp = `${ruta}.${process.pid}.tmp`;
  await writeFile(tmp, contenido, 'utf8');
  // En Windows un lector (antivirus, el cargador) bloquea el destino unos milisegundos: EPERM/EBUSY pasajeros.
  for (let i = 1; ; i += 1) {
    try {
      await rename(tmp, ruta);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
}

async function esperarCalidad(): Promise<EntradaCalidad[]> {
  for (;;) {
    if (existsSync(RUTAS.calidad)) {
      try {
        const j = JSON.parse(await readFile(RUTAS.calidad, 'utf8')) as EntradaCalidad[];
        if (Array.isArray(j)) return j;
      } catch {
        // Puede estar a medio escribir.
      }
    }
    log('esperando pdf-calidad.json');
    await new Promise((r) => setTimeout(r, 180_000));
  }
}

type Metadatos = {
  edicionPorDoc: Map<string, { name: string; season: string; start: string | null; end: string | null }>;
  docPorUrl: Map<string, string>;
  tituloPorUrl: Map<string, { titulo: string | null; season: string }>;
  clavesProd: Set<string>;
  fechas: IndiceFechas | null;
};

async function cargarMetadatos(): Promise<Metadatos> {
  const edicionPorDoc: Metadatos['edicionPorDoc'] = new Map();
  const docPorUrl = new Map<string, string>();
  const clavesProd = new Set<string>();
  if (existsSync(RUTAS.base)) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(RUTAS.base, { readOnly: true });
    const eds = db.prepare(`select tournament_key, name, season, start_date, end_date, source_url from sport_edition where source = 'rfee_pdf'`).all() as {
      tournament_key: string; name: string; season: string; start_date: string | null; end_date: string | null; source_url: string | null;
    }[];
    for (const e of eds) {
      const doc = e.tournament_key.replace(/^pdf:/, '');
      edicionPorDoc.set(doc, { name: e.name, season: e.season, start: e.start_date, end: e.end_date });
      if (e.source_url) docPorUrl.set(e.source_url.split('#')[0], doc);
    }
    for (const c of db.prepare(`select competition_key from sport_competition where source = 'rfee_pdf'`).all() as { competition_key: string }[]) {
      clavesProd.add(c.competition_key);
    }
    db.close();
  }
  const tituloPorUrl: Metadatos['tituloPorUrl'] = new Map();
  let fechas: IndiceFechas | null = null;
  if (existsSync(RUTAS.inventario)) {
    const inv = JSON.parse(await readFile(RUTAS.inventario, 'utf8')) as InventarioNacional & {
      readingUnits?: { sourceUrl: string; season: string; datos?: { titulo?: string | null } }[];
    };
    for (const u of inv.readingUnits ?? []) {
      if (!tituloPorUrl.has(u.sourceUrl)) tituloPorUrl.set(u.sourceUrl, { titulo: u.datos?.titulo ?? null, season: u.season });
    }
    fechas = indiceFechas(inv);
  }
  return { edicionPorDoc, docPorUrl, tituloPorUrl, clavesProd, fechas };
}

export async function textoPdf(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { text } = await extractText(doc, { mergePages: false });
    return text;
  } finally {
    await doc.loadingTask.destroy();
  }
}

function matarArbol(pid: number) {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}

export async function lanzarDroid(modelo: string, carpeta: string, promptPath: string, timeoutMs: number) {
  return await new Promise<{ ok: boolean; stdout: string; stderr: string; motivo: string | null }>((resolve) => {
    const hijo = spawn(process.execPath, [
      RUTAS.droid, 'exec', '-m', modelo, '--cwd', carpeta, '--only-tools', 'Read', '-o', 'json', '-f', promptPath,
    ], { cwd: carpeta, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let vencido = false;
    hijo.stdout.on('data', (d) => (stdout += d));
    hijo.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => {
      vencido = true;
      if (hijo.pid) matarArbol(hijo.pid);
    }, timeoutMs);
    hijo.on('error', (e) => {
      clearTimeout(t);
      resolve({ ok: false, stdout, stderr: `${stderr}\n${e.message}`, motivo: 'spawn_error' });
    });
    hijo.on('close', (code) => {
      clearTimeout(t);
      resolve({ ok: !vencido && code === 0, stdout, stderr, motivo: vencido ? 'timeout' : code === 0 ? null : `exit_${code}` });
    });
  });
}

let permisosDroid = 8;
const enEspera: (() => void)[] = [];

/** Limita los droids vivos (cada uno ocupa ~800 MB) y no lanza otro si la máquina va justa de memoria. */
export async function semaforo<T>(f: () => Promise<T>): Promise<T> {
  if (permisosDroid > 0) permisosDroid -= 1;
  else await new Promise<void>((r) => enEspera.push(r));
  try {
    while (freemem() < 2.5 * 1024 ** 3) await new Promise((r) => setTimeout(r, 15_000));
    return await f();
  } finally {
    const siguiente = enEspera.shift();
    if (siguiente) siguiente();
    else permisosDroid += 1;
  }
}

const contar = (lista: string[]) => lista.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});

/**
 * Un droid por contenido (SHA-256). El mismo PDF publicado en varias URL produce
 * los hechos de cada URL con sus propias claves, igual que el lector local.
 */
async function procesarPdf(grupo: EntradaCalidad[], meta: Metadatos, opt: ReturnType<typeof argumentos>, previo: EstadoPdf | null): Promise<EstadoPdf> {
  const inicio = Date.now();
  const e = grupo[0];
  const contextos = grupo.map((x) => {
    const docId = x.docId ?? meta.docPorUrl.get(x.url) ?? docIdDeUrl(x.url);
    const ed = meta.edicionPorDoc.get(docId);
    const inv = meta.tituloPorUrl.get(x.url);
    const season = x.season ?? ed?.season ?? inv?.season ?? null;
    const cat = season ? fechasCatalogo(meta.fechas, season, x.url) : null;
    return {
      url: x.url, sha256: x.sha256, docId, season,
      editionName: ed?.name ?? inv?.titulo ?? null,
      editionStart: ed?.start ?? cat?.inicio ?? null, editionEnd: ed?.end ?? cat?.fin ?? null,
      fechaCatalogo: (p: PruebaFecha) => (season ? fechasCatalogo(meta.fechas, season, x.url, p).prueba : null),
    };
  });
  const estado: EstadoPdf = {
    pdfId: e.pdfId, url: e.url, urls: grupo.map((x) => x.url), sha256: e.sha256, hecho: false, modelo: null, intentos: [], ficheros: [],
    propuestas: { results: 0, bouts: 0 }, aceptadas: { results: 0, bouts: 0 }, descartes: {},
    estados: { results: {}, pools: {}, tableau: {} }, problemas: [], sinTexto: false, error: null, segundos: 0,
    terminadoEn: '', clavesEnProduccion: 0, resultadosEscritos: 0, asaltosEscritos: 0, modo: null,
  };
  const carpeta = join(RUTAS.trabajo, e.sha256);
  try {
    if (contextos.some((c) => !c.season)) throw new Error('sin_temporada');
    const bytes = new Uint8Array(await readFile(e.blobPath));
    if (createHash('sha256').update(bytes).digest('hex') !== e.sha256) throw new Error('sha256_no_coincide');
    const paginas = await textoPdf(bytes);
    const pdf = join(carpeta, 'documento.pdf');
    const plantilla = (await readFile(RUTAS.prompt, 'utf8'))
      .replaceAll('{{PDF_PATH}}', pdf).replaceAll('{{PAGES}}', String(paginas.length));
    let preparado = false;
    const preparar = async () => {
      if (preparado) return;
      await mkdir(carpeta, { recursive: true });
      // Se escriben los bytes ya verificados: copyFile sobre la caché compartida da EBUSY en Windows.
      await writeFile(pdf, bytes);
      preparado = true;
    };
    const validar = (crudo: unknown, modelo: string, c: (typeof contextos)[number]) =>
      validarExtraccion(crudo, { ...c, season: c.season as string, paginas, extractor: `droid:${modelo}` });

    /** Una llamada (con un reintento) para un alcance; devuelve el JSON del modelo o null. */
    const pedir = async (modelo: string, etiqueta: string, alcance: string): Promise<unknown | null> => {
      for (let intento = 1; intento <= 2; intento += 1) {
        const nombreCrudo = join(RUTAS.crudo, `${e.sha256}__${modelo}__${etiqueta ? `${etiqueta}__` : ''}${intento}`);
        const t0 = Date.now();
        let stdout: string;
        let motivo: string | null = null;
        if (opt.revalidar) {
          if (!existsSync(`${nombreCrudo}.json`)) return null;
          stdout = await readFile(`${nombreCrudo}.json`, 'utf8');
        } else {
          await preparar();
          const promptPath = join(carpeta, `prompt-${modelo}-${etiqueta || 'todo'}.md`);
          await writeFile(promptPath, plantilla.replaceAll('{{ALCANCE}}', alcance), 'utf8');
          const r = await semaforo(() =>
            lanzarDroid(modelo, carpeta, promptPath, modelo === opt.modelo ? opt.timeoutMs : opt.timeoutFuerteMs));
          stdout = r.stdout;
          motivo = r.ok ? null : r.motivo;
          await writeFile(`${nombreCrudo}.json`, r.stdout, 'utf8');
          if (r.stderr.trim()) await writeFile(`${nombreCrudo}.err.txt`, r.stderr, 'utf8');
        }
        const segundos = Math.round((Date.now() - t0) / 1000);
        let crudo: unknown | null = null;
        if (motivo === null) {
          try {
            const sobre = JSON.parse(stdout) as { is_error?: boolean; result?: string };
            if (sobre.is_error || typeof sobre.result !== 'string') motivo = 'droid_is_error';
            else crudo = extraerJson(sobre.result);
          } catch (err) {
            motivo = `json_invalido:${(err as Error).message.slice(0, 60)}`;
          }
        }
        estado.intentos.push({ modelo: etiqueta ? `${modelo}:${etiqueta}` : modelo, ok: crudo !== null, motivo, segundos, puntuacion: null });
        if (crudo !== null) return crudo;
      }
      return null;
    };

    type Candidato = { crudo: unknown; v: ResultadoValidacion; modelo: string; modo: string };
    const completo = async (modelo: string): Promise<Candidato | null> => {
      const crudo = await pedir(modelo, '', '');
      return crudo === null ? null : { crudo, v: validar(crudo, modelo, contextos[0]), modelo, modo: 'completo' };
    };
    const troceado = async (modelo: string): Promise<Candidato | null> => {
      const partes = tramos(paginas.length);
      const [res, ...trozos] = await Promise.all([
        pedir(modelo, 'res', ALCANCE_RESULTADOS),
        ...partes.map(([a, b]) => pedir(modelo, `p${a}-${b}`, alcanceAsaltos(a, b))),
      ]);
      if (res === null) return null;
      if (trozos.some((t) => t === null)) estado.problemas.push(`tramos_sin_respuesta:${trozos.filter((t) => t === null).length}`);
      const crudo = fusionarTramos(res, trozos.filter((t) => t !== null));
      return { crudo, v: validar(crudo, modelo, contextos[0]), modelo, modo: 'tramos' };
    };
    const mejor = (a: Candidato | null, b: Candidato | null) => (!a ? b : !b ? a : puntuar(b.v) >= puntuar(a.v) ? b : a);
    const local = { results: e.results, bouts: e.bouts };

    let elegido: Candidato | null;
    if (paginas.length > PAGINAS_POR_TRAMO) {
      elegido = await troceado(opt.modelo);
      if (necesitaEscalar(elegido?.v ?? null, local) && opt.modeloFuerte !== opt.modelo) {
        elegido = mejor(elegido, await troceado(opt.modeloFuerte));
      }
    } else {
      elegido = await completo(opt.modelo);
      if (necesitaEscalar(elegido?.v ?? null, local) && opt.modeloFuerte !== opt.modelo) {
        elegido = mejor(elegido, await completo(opt.modeloFuerte));
      }
    }
    if (!elegido) throw new Error(estado.intentos.at(-1)?.motivo ?? 'sin_respuesta_valida');
    estado.modo = elegido.modo;

    // Una revalidación puede cambiar claves: los ficheros anteriores de este PDF se retiran antes de escribir.
    for (const f of previo?.ficheros ?? []) await rm(join(RUTAS.salida, f), { force: true });
    const { v, modelo } = elegido;
    for (const c of contextos) {
      const vc = c === contextos[0] && modelo === elegido.modelo ? v : validar(elegido.crudo, modelo, c);
      for (const h of vc.hechos) {
        const nombre = ficheroHechos(h);
        // Doble comprobación: nada sin validar llega a la carpeta de hechos.
        hechosPrueba.parse(h);
        await escribirAtomico(join(RUTAS.salida, nombre), `${JSON.stringify(h, null, 2)}\n`);
        estado.ficheros.push(nombre);
        estado.resultadosEscritos += h.results.length;
        estado.asaltosEscritos += h.bouts.length;
        if (meta.clavesProd.has(h.competition.competitionKey)) estado.clavesEnProduccion += 1;
      }
    }
    Object.assign(estado, {
      hecho: true, modelo, propuestas: v.propuestas, aceptadas: v.aceptadas, descartes: v.descartes,
      problemas: v.problemas, sinTexto: v.sinTexto,
      estados: {
        results: contar(v.hechos.map((h) => h.status.results)),
        pools: contar(v.hechos.map((h) => h.status.pools)),
        tableau: contar(v.hechos.map((h) => h.status.tableau)),
      },
    });
  } catch (err) {
    estado.error = (err as Error).message.slice(0, 200);
    if (previo?.hecho) return previo;
  } finally {
    await rm(carpeta, { recursive: true, force: true }).catch(() => undefined);
  }
  estado.segundos = Math.round((Date.now() - inicio) / 1000) + (opt.revalidar ? previo?.segundos ?? 0 : 0);
  estado.terminadoEn = new Date().toISOString();
  await escribirAtomico(join(RUTAS.estado, `${e.sha256}.json`), JSON.stringify(estado, null, 2));
  return estado;
}

async function leerEstados(): Promise<EstadoPdf[]> {
  const out: EstadoPdf[] = [];
  for (const f of await readdir(RUTAS.estado)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(await readFile(join(RUTAS.estado, f), 'utf8')) as EstadoPdf);
    } catch {
      // Fichero a medio escribir: se ignora en este informe.
    }
  }
  return out;
}

async function escribirInforme(seleccion: { pdfs: number; urls: number }, inicio: number) {
  const estados = await leerEstados();
  const sumar = (sel: (e: EstadoPdf) => Record<string, number>) =>
    estados.reduce<Record<string, number>>((m, e) => {
      for (const [k, n] of Object.entries(sel(e))) m[k] = (m[k] ?? 0) + n;
      return m;
    }, {});
  const hechos = estados.filter((e) => e.hecho);
  const propuestas = hechos.reduce((m, e) => ({ results: m.results + e.propuestas.results, bouts: m.bouts + e.propuestas.bouts }), { results: 0, bouts: 0 });
  const aceptadas = hechos.reduce((m, e) => ({ results: m.results + e.aceptadas.results, bouts: m.bouts + e.aceptadas.bouts }), { results: 0, bouts: 0 });
  const informe = {
    generadoEn: new Date().toISOString(),
    segundosEstaEjecucion: Math.round((Date.now() - inicio) / 1000),
    seleccion,
    pdfsProcesados: hechos.length,
    urlsProcesadas: hechos.reduce((n, e) => n + (e.urls?.length ?? 1), 0),
    pdfsFallidos: estados.filter((e) => !e.hecho).length,
    pdfsSinTexto: hechos.filter((e) => e.sinTexto).length,
    /** Pruebas distintas por contenido y ficheros escritos (uno por prueba y URL). */
    competicionesPorContenido: hechos.reduce((n, e) => n + Object.values(e.estados.results).reduce((a, b) => a + b, 0), 0),
    ficherosEscritos: hechos.reduce((n, e) => n + e.ficheros.length, 0),
    resultadosEscritos: hechos.reduce((n, e) => n + (e.resultadosEscritos ?? 0), 0),
    asaltosEscritos: hechos.reduce((n, e) => n + (e.asaltosEscritos ?? 0), 0),
    clavesCoincidentesConProduccion: hechos.reduce((n, e) => n + (e.clavesEnProduccion ?? 0), 0),
    /** Filas por contenido (sin multiplicar por URL): propuestas por el modelo y aceptadas por la validación. */
    propuestas,
    aceptadas,
    tasaDescarte: {
      results: propuestas.results ? +(1 - aceptadas.results / propuestas.results).toFixed(4) : 0,
      bouts: propuestas.bouts ? +(1 - aceptadas.bouts / propuestas.bouts).toFixed(4) : 0,
    },
    porModelo: contar(hechos.map((e) => e.modelo ?? '?')),
    porModo: contar(hechos.map((e) => e.modo ?? 'completo')),
    intentosPorModelo: contar(estados.flatMap((e) => e.intentos.map((i) => `${i.modelo}:${i.ok ? 'ok' : i.motivo ?? 'fallo'}`))),
    estados: { results: sumar((e) => e.estados.results), pools: sumar((e) => e.estados.pools), tableau: sumar((e) => e.estados.tableau) },
    descartes: sumar((e) => e.descartes),
    segundosDroidTotales: estados.reduce((n, e) => n + e.segundos, 0),
    fallos: estados.filter((e) => !e.hecho).map((e) => ({ pdfId: e.pdfId, url: e.url, sha256: e.sha256, error: e.error, intentos: e.intentos })),
    pdfsSinCompeticiones: hechos.filter((e) => e.ficheros.length === 0).map((e) => ({ pdfId: e.pdfId, url: e.url, problemas: e.problemas })),
  };
  await escribirAtomico(join(RUTAS.salida, '_informe.json'), `${JSON.stringify(informe, null, 2)}\n`);
  return informe;
}

async function main() {
  const opt = argumentos();
  const inicio = Date.now();
  for (const d of [RUTAS.salida, RUTAS.crudo, RUTAS.estado, RUTAS.trabajo]) await mkdir(d, { recursive: true });
  if (!existsSync(RUTAS.droid)) throw new Error(`No encuentro droid en ${RUTAS.droid}`);

  const calidad = await esperarCalidad();
  const meta = await cargarMetadatos();
  const previos = new Map((await leerEstados()).map((e) => [e.sha256, e]));
  const grupos = new Map<string, EntradaCalidad[]>();
  for (const e of calidad) {
    if (!e.needsDroid || (opt.solo && !opt.solo.includes(e.sha256))) continue;
    const g = grupos.get(e.sha256) ?? [];
    if (!g.some((x) => x.url === e.url)) g.push(e);
    grupos.set(e.sha256, g);
  }
  const saltar = (sha: string) => {
    const p = previos.get(sha);
    if (opt.revalidar) return !p;
    return p !== undefined && (p.hecho || !opt.reintentarFallos);
  };
  const pendientes = [...grupos.values()]
    .filter((g) => !saltar(g[0].sha256) && existsSync(g[0].blobPath))
    .slice(0, opt.limite);
  const seleccion = { pdfs: grupos.size, urls: [...grupos.values()].reduce((n, g) => n + g.length, 0) };
  log(`seleccionados=${seleccion.pdfs} urls=${seleccion.urls} pendientes=${pendientes.length} concurrencia=${opt.concurrencia} modelo=${opt.modelo} fuerte=${opt.modeloFuerte}${opt.revalidar ? ' revalidar' : ''}`);

  let siguiente = 0;
  let terminados = 0;
  const trabajador = async () => {
    for (;;) {
      const i = siguiente++;
      if (i >= pendientes.length) return;
      // Cada droid ocupa ~800 MB: no se lanza otro si la máquina va justa.
      const g = pendientes[i];
      const r = await procesarPdf(g, meta, opt, previos.get(g[0].sha256) ?? null);
      terminados += 1;
      log(`[${terminados}/${pendientes.length}] ${g[0].sha256.slice(0, 12)} ${r.hecho ? 'ok' : `fallo:${r.error}`} modelo=${r.modelo ?? '-'} urls=${g.length} ficheros=${r.ficheros.length} res=${r.aceptadas.results}/${r.propuestas.results} asaltos=${r.aceptadas.bouts}/${r.propuestas.bouts} ${r.segundos}s`);
      if (terminados % 10 === 0) await escribirInforme(seleccion, inicio);
    }
  };
  permisosDroid = Math.max(1, opt.concurrencia);
  await Promise.all(Array.from({ length: Math.max(1, opt.concurrencia) }, trabajador));
  const informe = await escribirInforme(seleccion, inicio);
  log(`fin procesados=${informe.pdfsProcesados} fallidos=${informe.pdfsFallidos} ficheros=${informe.ficherosEscritos} resultados=${informe.resultadosEscritos} asaltos=${informe.asaltosEscritos}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}