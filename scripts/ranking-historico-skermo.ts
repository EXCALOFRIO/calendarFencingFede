import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fetchText } from '../src/lib/ingest/fetcher';
import {
  contextoLista,
  indicePorLicencia,
  indicePorNombre,
  sentenciasPublicacion,
  vincular,
  vincularPorNombre,
  type CandidataNombre,
  type FilaCarga,
  type MotivoSinVinculo,
} from '../src/lib/ingest/ranking-skermo-historico';
import { combinacionesRfee, leerRankingRfee, type LecturaRanking } from '../src/lib/ingest/sources/ranking-oficial-historico';
import {
  lecturaDePdf,
  parseSkermoClasificaciones,
  skermoClasificacionUrl,
  type DocumentoClasificacion,
} from '../src/lib/ingest/sources/ranking-rfee-clasificacion-pdf';
import { extractText, getDocumentProxy } from 'unpdf';
import { parseSkermoRankingCategories, RANKING_FEDERATION, skermoRankingFormUrl, type RankingCombo } from '../src/lib/ingest/sources/ranking-rfee';
import {
  normalizeLicense,
  parseSkermoNationalRanking,
  parseSkermoRankingAthlete,
  parseSkermoSeasons,
  SKERMO_GENDER_CODE,
  SKERMO_WEAPON_CODE,
  skermoNationalRankingUrl,
} from '../src/lib/ingest/sources/skermo-results';
import { componerChunk, proyeccion } from './indexado/sincronizar-d1';

/**
 * Ranking nacional RFEE (Skermo) de TODAS las temporadas publicadas.
 *
 *   npx tsx scripts/ranking-historico-skermo.ts --descargar [--temporadas 2021-2022,2022-2023] [--max-fichas N]
 *   npx tsx scripts/ranking-historico-skermo.ts --generar --base <copia de producción .sqlite> --salida <dir>
 *   npx tsx scripts/ranking-historico-skermo.ts --comprobar --base <copia de producción .sqlite> --salida <dir>
 *
 * --descargar: GET públicos, como mucho 2 a la vez y 500 ms entre peticiones de
 *   cada uno, con caché en disco: lo ya descargado no se vuelve a pedir. Listas
 *   (60 por temporada) y una ficha por tirador para leer su licencia.
 * --generar: lee la caché y la copia de producción (sólo lectura) y escribe
 *   ficheros SQL autocontenidos (lease + contexto de capacidad + cuerpo + cierre)
 *   para `wrangler d1 execute --remote --file`. Cada fichero es atómico.
 * --comprobar: aplica los ficheros sobre una base en memoria con el esquema y
 *   las guardas de la copia, y comprueba recuentos y claves ajenas.
 */

const TRABAJO = join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'calendario-datos', 'calendario-trabajo');
const CACHE = join(TRABAJO, 'cache-ranking-skermo');
const PAUSA_MS = 500;
const CONCURRENCIA = 2;
const FUENTE = 'skermo_ranking';

const args = process.argv.slice(2);
const arg = (nombre: string, def = '') => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const bandera = (nombre: string) => args.includes(`--${nombre}`);

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const archivoSeguro = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');

let peticiones = 0;
async function enCache(nombre: string, url: string): Promise<string> {
  const ruta = join(CACHE, nombre);
  if (existsSync(ruta)) return readFileSync(ruta, 'utf8');
  const { body } = await fetchText(url, { timeoutMs: 30_000, retries: 1 });
  peticiones += 1;
  writeFileSync(ruta, body);
  await espera(PAUSA_MS);
  return body;
}

async function enParalelo<T>(items: readonly T[], fn: (item: T) => Promise<void>) {
  let i = 0;
  const fallos: string[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCIA }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try {
          await fn(item);
        } catch (e) {
          fallos.push(e instanceof Error ? e.message.slice(0, 160) : String(e));
          await espera(PAUSA_MS * 4);
        }
      }
    }),
  );
  return fallos;
}

type Temporada = { value: string; label: string };

function urlLista(season: Temporada, combo: RankingCombo) {
  return skermoNationalRankingUrl(RANKING_FEDERATION, {
    season: season.value,
    weapon: SKERMO_WEAPON_CODE[combo.weapon],
    category: combo.categoryValue,
    gender: SKERMO_GENDER_CODE[combo.gender],
  });
}

const nombreLista = (season: Temporada, combo: RankingCombo) =>
  archivoSeguro(`lista-${season.value}-${combo.weapon}-${combo.gender}-${combo.categoryRaw}.html`);

async function formulario() {
  const html = await enCache('formulario.html', skermoRankingFormUrl(RANKING_FEDERATION));
  return { temporadas: parseSkermoSeasons(html) as Temporada[], categorias: parseSkermoRankingCategories(html) };
}

function temporadasPedidas(todas: Temporada[]): Temporada[] {
  const filtro = arg('temporadas');
  if (!filtro) return todas;
  const pedidas = new Set(filtro.split(','));
  return todas.filter((t) => pedidas.has(t.label));
}

/** skermoId -> { url de su ficha en la temporada más reciente en que aparece, temporada } */
function fichasNecesarias(temporadas: Temporada[], combos: RankingCombo[]) {
  const porId = new Map<string, { url: string; season: number }>();
  for (const t of temporadas) {
    for (const combo of combos) {
      const ruta = join(CACHE, nombreLista(t, combo));
      if (!existsSync(ruta)) continue;
      const { rows } = parseSkermoNationalRanking(readFileSync(ruta, 'utf8'), { federationCode: RANKING_FEDERATION });
      for (const r of rows) {
        if (!r.skermoAthleteId || !r.athleteUrl) continue;
        const previo = porId.get(r.skermoAthleteId);
        if (!previo || Number(t.value) > previo.season) porId.set(r.skermoAthleteId, { url: r.athleteUrl, season: Number(t.value) });
      }
    }
  }
  return porId;
}

async function descargar() {
  mkdirSync(CACHE, { recursive: true });
  const { temporadas, categorias } = await formulario();
  const elegidas = temporadasPedidas(temporadas);
  const combos = combinacionesRfee(categorias);
  console.log(`Temporadas: ${elegidas.map((t) => t.label).join(', ')}; ${combos.length} listas por temporada.`);

  const tareas = elegidas.flatMap((t) => combos.map((c) => ({ t, c })));
  const fallosListas = await enParalelo(tareas, async ({ t, c }) => {
    await enCache(nombreLista(t, c), urlLista(t, c));
  });
  console.log(`Listas: ${tareas.length} (${peticiones} pedidas ahora, ${fallosListas.length} fallos).`);

  const fichas = fichasNecesarias(elegidas, combos);
  const pendientes = [...fichas.entries()].filter(([id]) => !existsSync(join(CACHE, `ficha-${id}.html`)));
  const max = Number(arg('max-fichas', String(pendientes.length)));
  const lote = pendientes.slice(0, max);
  console.log(`Fichas: ${fichas.size} tiradores; ${pendientes.length} sin caché; se piden ${lote.length}.`);
  let hechas = 0;
  const fallosFichas = await enParalelo(lote, async ([id, f]) => {
    await enCache(`ficha-${id}.html`, f.url);
    hechas += 1;
    if (hechas % 250 === 0) console.log(`  ${hechas}/${lote.length} fichas`);
  });
  console.log(`Fichas pedidas: ${hechas}; fallos ${fallosFichas.length}. Peticiones totales: ${peticiones}.`);
  for (const f of [...fallosListas, ...fallosFichas].slice(0, 5)) console.log(`  fallo: ${f}`);
}

// ------------------------------------------- Clasificaciones en PDF (2017-2021) ---

/**
 * Antes de 2021-2022 el ranking dinámico de Skermo no tiene filas: esas
 * temporadas sólo se publican como PDF en `/classification/public/RFEE`.
 */
const TEMPORADAS_PDF = ['2017-2018', '2018-2019', '2019-2020', '2020-2021'];

function temporadasPdf(todas: Temporada[]): Temporada[] {
  const pedidas = new Set((arg('temporadas-pdf') || TEMPORADAS_PDF.join(',')).split(','));
  return todas.filter((t) => pedidas.has(t.label));
}

async function documentosPdf(t: Temporada): Promise<DocumentoClasificacion[]> {
  const html = await enCache(`clasif-${t.value}.html`, skermoClasificacionUrl(RANKING_FEDERATION, t.value));
  return parseSkermoClasificaciones(html).filter((d) => d.esRankingIndividual);
}

async function descargarPdf() {
  mkdirSync(CACHE, { recursive: true });
  const { temporadas } = await formulario();
  const elegidas = temporadasPdf(temporadas);
  const docs: DocumentoClasificacion[] = [];
  for (const t of elegidas) docs.push(...(await documentosPdf(t)));
  console.log(`Clasificaciones PDF: ${docs.length} rankings individuales en ${elegidas.map((t) => t.label).join(', ')}.`);
  const fallos = await enParalelo(docs, async (d) => {
    const ruta = join(CACHE, `clasif-pdf-${d.archivo}`);
    if (existsSync(ruta)) return;
    const r = await fetch(d.url, { headers: { 'User-Agent': process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+contacto)' }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${d.url}`);
    writeFileSync(ruta, Buffer.from(await r.arrayBuffer()));
    peticiones += 1;
    await espera(PAUSA_MS);
  });
  console.log(`PDF: ${peticiones} peticiones; ${fallos.length} fallos.`);
  for (const f of fallos.slice(0, 5)) console.log(`  fallo: ${f}`);
}

async function textoPdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join('\n');
}

async function lecturasPdf(hoy: string): Promise<{ lecturas: LecturaRanking[]; temporadas: Temporada[] }> {
  const { temporadas } = await formulario();
  const elegidas = temporadasPdf(temporadas);
  const lecturas: LecturaRanking[] = [];
  for (const t of elegidas) {
    for (const d of await documentosPdf(t)) {
      const ruta = join(CACHE, `clasif-pdf-${d.archivo}`);
      if (!existsSync(ruta)) continue;
      lecturas.push(lecturaDePdf(t.label, d, await textoPdf(new Uint8Array(readFileSync(ruta))), hoy));
    }
  }
  return { lecturas, temporadas: elegidas };
}

// --------------------------------------------------------------- Generar ---

type Lectura = { lectura: LecturaRanking; nacimientos: Map<string, number | null> };

async function lecturas(): Promise<{ temporadas: Temporada[]; leidas: Lectura[]; faltan: number }> {
  const { temporadas, categorias } = await formulario();
  const elegidas = temporadasPedidas(temporadas);
  const combos = combinacionesRfee(categorias);
  const hoy = arg('dia', new Date().toISOString().slice(0, 10));
  const leidas: Lectura[] = [];
  let faltan = 0;
  for (const t of elegidas) {
    for (const combo of combos) {
      const ruta = join(CACHE, nombreLista(t, combo));
      if (!existsSync(ruta)) {
        faltan += 1;
        continue;
      }
      const html = readFileSync(ruta, 'utf8');
      const lectura = await leerRankingRfee({ season: t, combo, hoy }, { html: async () => html });
      const nacimientos = new Map<string, number | null>();
      for (const r of parseSkermoNationalRanking(html, { federationCode: RANKING_FEDERATION }).rows) {
        if (r.skermoAthleteId) nacimientos.set(r.skermoAthleteId, r.sourceBirthDate ? Number(r.sourceBirthDate.slice(0, 4)) : null);
      }
      leidas.push({ lectura, nacimientos });
    }
  }
  return { temporadas: elegidas, leidas, faltan };
}

function licenciasDeFichas(): Map<string, string> {
  const salida = new Map<string, string>();
  for (const nombre of readdirSync(CACHE)) {
    const m = nombre.match(/^ficha-(\d+)\.html$/);
    if (!m) continue;
    const ficha = parseSkermoRankingAthlete(readFileSync(join(CACHE, nombre), 'utf8'));
    if (ficha?.sourceLicense) salida.set(m[1], normalizeLicense(ficha.sourceLicense));
  }
  return salida;
}

function abrirBase(ruta: string) {
  if (!ruta || !existsSync(ruta)) throw new Error('falta --base <copia de producción .sqlite>');
  return new DatabaseSync(resolve(ruta), { readOnly: true });
}

async function generar() {
  const salida = resolve(arg('salida'));
  if (!arg('salida')) throw new Error('falta --salida <dir>');
  const base = abrirBase(arg('base'));
  const { temporadas, leidas, faltan } = await lecturas();
  const pdf = await lecturasPdf(arg('dia', new Date().toISOString().slice(0, 10)));
  for (const lectura of pdf.lecturas) leidas.push({ lectura, nacimientos: new Map() });
  const licencias = licenciasDeFichas();

  // Licencias ya conocidas por la ingesta diaria (temporada vigente).
  for (const f of base.prepare(
    `SELECT DISTINCT skermo_athlete_id AS id, source_license AS lic FROM official_ranking_entry WHERE skermo_athlete_id IS NOT NULL AND source_license IS NOT NULL`,
  ).all() as { id: string; lic: string }[]) {
    if (!licencias.has(f.id)) licencias.set(f.id, normalizeLicense(f.lic));
  }

  const indice = indicePorLicencia(
    base.prepare(
      `SELECT e.value AS value, coalesce(p.merged_into_person_id, p.id) AS personId, c.birth_year AS birthYear, c.gender AS gender
       FROM sport_external_id e JOIN sport_person p ON p.id = e.person_id
       JOIN sport_person c ON c.id = coalesce(p.merged_into_person_id, p.id)
       WHERE e.scheme = 'rfee_license' AND e.link_status = 'CONFIRMADO'`,
    ).all() as { value: string; personId: string; birthYear: number | null; gender: string | null }[],
  );

  // Candidatas por nombre para las filas de PDF: quien tiene resultados
  // individuales en la misma temporada, arma, género y categoría.
  const temporadasPdfSet = [...new Set(pdf.lecturas.map((l) => l.season))];
  // En tres lecturas sencillas: un JOIN con la unión de nombres y alias
  // recorría la unión entera por cada resultado.
  const candidatasNombre: CandidataNombre[] = [];
  if (temporadasPdfSet.length > 0) {
    const enPrueba = base.prepare(
      `SELECT DISTINCT c.season || '|' || c.weapon || '|' || c.gender || '|' || c.category AS contexto, r.person_id AS pid
       FROM sport_competition c CROSS JOIN sport_result r ON r.competition_id = c.id
       WHERE c.format = 'INDIVIDUAL' AND r.person_id IS NOT NULL AND c.season IN (SELECT value FROM json_each(?))`,
    ).all(JSON.stringify(temporadasPdfSet)) as { contexto: string; pid: string }[];
    const personas = new Map((base.prepare(
      `SELECT p.id AS id, coalesce(p.merged_into_person_id, p.id) AS raiz,
              (SELECT z.gender FROM sport_person z WHERE z.id = coalesce(p.merged_into_person_id, p.id)) AS genero
       FROM sport_person p WHERE p.id IN (SELECT value FROM json_each(?))`,
    ).all(JSON.stringify([...new Set(enPrueba.map((x) => x.pid))])) as { id: string; raiz: string; genero: string | null }[])
      .map((p) => [p.id, p]));
    const conNombre = [...new Set([...personas.values()].flatMap((p) => [p.id, p.raiz]))];
    const nombres = new Map<string, Set<string>>();
    for (const n of base.prepare(
      `SELECT id AS pid, display_name AS nombre FROM sport_person WHERE id IN (SELECT value FROM json_each(?1))
       UNION SELECT person_id, name_original FROM sport_person_alias WHERE person_id IN (SELECT value FROM json_each(?1))`,
    ).all(JSON.stringify(conNombre)) as { pid: string; nombre: string | null }[]) {
      if (!n.nombre) continue;
      nombres.set(n.pid, (nombres.get(n.pid) ?? new Set()).add(n.nombre));
    }
    for (const { contexto, pid } of enPrueba) {
      const p = personas.get(pid);
      if (!p) continue;
      for (const nombre of new Set([...(nombres.get(p.id) ?? []), ...(nombres.get(p.raiz) ?? [])])) {
        candidatasNombre.push({ contexto, nombre, personId: p.raiz, genero: p.genero });
      }
    }
  }
  const indiceNombres = indicePorNombre(candidatasNombre);
  let pdfFilas = 0;
  let pdfVinculadas = 0;

  const yaCargadas = new Set(
    (base.prepare(`SELECT season||'|'||weapon||'|'||gender||'|'||category_raw||'|'||format AS k FROM sport_ranking_publication WHERE source = ?`).all(FUENTE) as { k: string }[]).map((r) => r.k),
  );

  if (existsSync(salida)) for (const f of readdirSync(salida)) if (/^ranking-.*\.sql$/.test(f)) rmSync(join(salida, f));
  mkdirSync(salida, { recursive: true });

  const estados: Record<string, number> = {};
  const motivos: Record<MotivoSinVinculo, number> = {
    sin_licencia: 0, licencia_desconocida: 0, licencia_ambigua: 0, nacimiento_distinto: 0, genero_distinto: 0,
  };
  const porTemporada: Record<string, { listas: number; filas: number; vinculadas: number; tiradores: Set<string>; tiradoresVinculados: Set<string> }> = {};
  const ficheros: { archivo: string; temporada: string; listas: number; filas: number; cargoBytes: number; sha256: string; bytes: number }[] = [];

  for (const t of temporadas) {
    const cuerpo: string[] = [];
    let cargo = 0;
    let filasTemporada = 0;
    let listas = 0;
    const resumen = (porTemporada[t.label] = { listas: 0, filas: 0, vinculadas: 0, tiradores: new Set(), tiradoresVinculados: new Set() });
    for (const { lectura, nacimientos } of leidas.filter((l) => l.lectura.season === t.label)) {
      estados[lectura.cobertura.estado] = (estados[lectura.cobertura.estado] ?? 0) + 1;
      const p = lectura.publicacion;
      if (!p || lectura.cobertura.estado !== 'completo') continue;
      if (yaCargadas.has(`${p.season}|${p.arma}|${p.genero}|${p.categoriaOriginal}|${p.formato}`)) continue;
      const esPdf = /\.pdf$/i.test(p.url);
      const porNombre = esPdf ? vincularPorNombre(p.entradas.map((e) => e.nombre ?? ''), contextoLista(p), indiceNombres) : [];
      const filas: FilaCarga[] = p.entradas.map((e, i) => {
        const skermoId = e.referencia?.tipo === 'skermo' ? e.referencia.skermoId : null;
        resumen.tiradores.add(e.sourceRef);
        if (!skermoId) {
          // Filas de PDF: sin licencia ni id publicados; sólo el vínculo estricto por nombre.
          const personId = esPdf ? porNombre[i] : null;
          if (personId) {
            resumen.vinculadas += 1;
            resumen.tiradoresVinculados.add(e.sourceRef);
            pdfVinculadas += 1;
          }
          if (esPdf) pdfFilas += 1;
          return { sourceRef: e.sourceRef, personId, sourceName: e.nombre, position: e.posicion, points: e.puntos };
        }
        const v = vincular(
          { licencia: skermoId ? (licencias.get(skermoId) ?? null) : null, anioNacimiento: skermoId ? (nacimientos.get(skermoId) ?? null) : null, genero: p.genero },
          indice,
        );
        if (v.motivo) motivos[v.motivo] += 1;
        if (v.personId) {
          resumen.vinculadas += 1;
          resumen.tiradoresVinculados.add(e.sourceRef);
        }
        return { sourceRef: e.sourceRef, personId: v.personId, sourceName: e.nombre, position: e.posicion, points: e.puntos };
      });
      const { sentencias, cargo: c } = sentenciasPublicacion(p, filas, /\.pdf$/i.test(p.url) ? 'source' : 'observed');
      cuerpo.push(...sentencias);
      cargo += c;
      filasTemporada += filas.length;
      listas += 1;
    }
    resumen.listas = listas;
    resumen.filas = filasTemporada;
    if (!cuerpo.length) continue;
    const archivo = `ranking-${t.label}.sql`;
    const texto = cuerpo.map((s) => `${s};\n`).join('');
    const sha256 = createHash('sha256').update(texto, 'utf8').digest('hex');
    ficheros.push({ archivo, temporada: t.label, listas, filas: filasTemporada, cargoBytes: cargo, sha256, bytes: Buffer.byteLength(texto) });
    writeFileSync(join(salida, archivo.replace(/\.sql$/, '.cuerpo')), texto);
  }

  // Los ficheros para D1 llevan su propia cabecera de lease y contexto; el
  // tamaño medido es el de la copia: el trigger usa max(ledger, medido).
  const medido = statSync(resolve(arg('base'))).size;
  for (const f of ficheros) {
    const cuerpo = readFileSync(join(salida, f.archivo.replace(/\.sql$/, '.cuerpo')), 'utf8');
    writeFileSync(join(salida, f.archivo), componerChunk(cuerpo, { owner: randomUUID(), medidoBytes: medido, proyectadoBytes: proyeccion(f.cargoBytes) }));
    rmSync(join(salida, f.archivo.replace(/\.sql$/, '.cuerpo')));
  }

  const informe = {
    generado: new Date().toISOString(),
    listasSinCache: faltan,
    estadosListas: estados,
    incidencias: leidas
      .filter(({ lectura: l }) => l.cobertura.estado !== 'completo' && l.cobertura.estado !== 'sin_resultados')
      .map(({ lectura: l }) => `${l.season} ${l.clave} ${l.cobertura.estado}: ${l.cobertura.error ?? ''} ${l.url}`),
    licenciasConocidas: licencias.size,
    motivosSinVinculo: motivos,
    pdfPorNombre: { filas: pdfFilas, vinculadas: pdfVinculadas, candidatas: candidatasNombre.length },
    porTemporada: Object.fromEntries(Object.entries(porTemporada).map(([k, v]) => [k, {
      listas: v.listas, filas: v.filas, filasVinculadas: v.vinculadas,
      tiradores: v.tiradores.size, tiradoresVinculados: v.tiradoresVinculados.size,
    }])),
    ficheros,
  };
  writeFileSync(join(salida, 'informe.json'), `${JSON.stringify(informe, null, 2)}\n`);
  console.log(JSON.stringify({ ...informe, ficheros: ficheros.map((f) => `${f.archivo} listas=${f.listas} filas=${f.filas} bytes=${f.bytes}`) }, null, 2));
  base.close();
}

// ------------------------------------------------------------- Comprobar ---

function comprobar() {
  const salida = resolve(arg('salida'));
  const rutaBase = resolve(arg('base'));
  const informe = JSON.parse(readFileSync(join(salida, 'informe.json'), 'utf8')) as { ficheros: { archivo: string; filas: number; listas: number }[] };
  const db = new DatabaseSync(':memory:');
  db.exec(`ATTACH DATABASE 'file:${rutaBase.replace(/\\/g, '/')}?mode=ro' AS src`);
  db.exec('PRAGMA foreign_keys = OFF');
  const tablas = ['sport_person', 'sport_ranking_publication', 'sport_ranking_entry', 'sport_import_coverage', 'sport_competition', 'sport_edition',
    'sport_write_lease', 'sport_write_context', 'sport_write_charge', 'sport_capacity_ledger', 'athlete'];
  const ddl = db.prepare(`SELECT type, name, tbl_name, sql FROM src.sqlite_master WHERE sql IS NOT NULL AND (tbl_name IN (${tablas.map(() => '?').join(',')}) OR name = 'sport_write_authorized') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END`).all(...tablas) as { type: string; name: string; sql: string }[];
  for (const d of ddl.filter((x) => x.type === 'table')) db.exec(d.sql);
  // Copia mínima: personas (para las claves ajenas), cabeceras de ranking y estado de las guardas.
  db.exec(`INSERT INTO main.sport_person SELECT * FROM src.sport_person`);
  db.exec(`UPDATE main.sport_person SET athlete_id = NULL`);
  db.exec(`INSERT INTO main.sport_ranking_publication SELECT * FROM src.sport_ranking_publication`);
  db.exec(`INSERT INTO main.sport_capacity_ledger SELECT * FROM src.sport_capacity_ledger`);
  db.exec(`INSERT INTO main.sport_write_lease SELECT * FROM src.sport_write_lease`);
  for (const d of ddl.filter((x) => x.type !== 'table')) db.exec(d.sql);
  db.exec('DETACH DATABASE src');
  db.exec('PRAGMA foreign_keys = ON');
  const guardas = (db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND (name LIKE 'sport_fence_%' OR name LIKE 'sport_charge_%' OR name LIKE 'sport_context_%')`).get() as { n: number }).n;
  console.log(`Base de prueba en memoria con ${guardas} triggers de guarda.`);

  // Sin lease, una escritura directa tiene que fallar.
  try {
    db.exec(`INSERT INTO sport_import_coverage(source,season,fact_kind) VALUES('x','x','ranking')`);
    throw new Error('la guarda no bloqueó una escritura sin lease');
  } catch (e) {
    if ((e as Error).message.includes('guarda no bloqueó')) throw e;
  }

  let ok = true;
  for (const f of informe.ficheros) {
    const antes = (db.prepare(`SELECT count(*) AS n FROM sport_ranking_entry`).get() as { n: number }).n;
    const sql = readFileSync(join(salida, f.archivo), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      console.log(`FALLO ${f.archivo}: ${(e as Error).message}`);
      ok = false;
      continue;
    }
    const despues = (db.prepare(`SELECT count(*) AS n FROM sport_ranking_entry`).get() as { n: number }).n;
    // Re-aplicar no duplica (el lease ya está liberado al final de cada fichero).
    db.exec('BEGIN IMMEDIATE');
    const owner = sql.match(/VALUES\('global','([0-9a-f-]{36})'/)?.[1];
    if (!owner) throw new Error(`${f.archivo}: sin cabecera de lease`);
    db.exec(sql.replaceAll(owner, randomUUID()));
    db.exec('COMMIT');
    const reaplicado = (db.prepare(`SELECT count(*) AS n FROM sport_ranking_entry`).get() as { n: number }).n;
    const bien = despues - antes === f.filas && reaplicado === despues;
    ok &&= bien;
    console.log(`${bien ? 'OK' : 'DISTINTO'} ${f.archivo}: +${despues - antes} entradas (esperadas ${f.filas}); re-aplicado ${reaplicado - despues}`);
  }
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  const abiertos = db.prepare(`SELECT (SELECT count(*) FROM sport_write_context) + (SELECT count(*) FROM sport_write_charge) AS n`).get() as { n: number };
  const ledger = db.prepare(`SELECT accounted_bytes AS a, blocked AS b FROM sport_capacity_ledger`).get() as { a: number; b: number };
  console.log(`foreign_key_check=${fk.length} contextosAbiertos=${abiertos.n} ledger=${ledger.a} bloqueado=${ledger.b}`);
  ok &&= fk.length === 0 && abiertos.n === 0 && ledger.b === 0;
  console.log(ok ? 'COMPROBACIÓN OK' : 'COMPROBACIÓN CON FALLOS');
  process.exitCode = ok ? 0 : 1;
}

try {
  if (bandera('descargar-pdf')) await descargarPdf();
  else if (bandera('descargar')) await descargar();
  else if (bandera('generar')) await generar();
  else if (bandera('comprobar')) comprobar();
  else {
    console.error('Modo: --descargar | --generar --base <sqlite> --salida <dir> | --comprobar --base <sqlite> --salida <dir>');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
