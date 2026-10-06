/**
 * Datos nacionales de perfil por persona canónica, desde una copia SQLite y las
 * clasificaciones públicas de Skermo. Escribe `perfiles/nacional.jsonl`.
 *
 *   npx tsx scripts/indexado/perfiles-nacional.ts [--db <copia.sqlite>]
 *     [--cache <dir>] [--salida <fichero.jsonl>] [--sin-red]
 *     [--concurrencia 2] [--pausa-ms 500]
 *
 * Fuentes:
 *  - Club: `sport_result.source_club` del resultado más reciente del grupo de
 *    fusión (Skermo, Engarde, PDF RFEE, FIE) y el club del ranking RFEE vigente
 *    (`official_ranking_entry`). Skermo/Engarde/PDF publican CÓDIGOS («SAMA-M»),
 *    no nombres: ninguna fuente los traduce (ver `CodigoClub` en
 *    src/components/ranking/tabla-oficial.tsx).
 *  - Fecha de nacimiento: la clasificación de cada prueba de Skermo
 *    (`/ranking/public/RFEE/competition/<id>`: licencia, nombre, apellidos con
 *    acentos, club y fecha de nacimiento), el ranking RFEE vigente y
 *    `fie_fencer`. El año de la subdivisión de los PDF «por año de nacimiento»
 *    (clave `…:M12:2008:pdf…`) sólo como año y con la menor prioridad.
 *  - Variantes de nombre con acentos y corte nombre/apellidos (Skermo).
 *
 * Las páginas de Skermo se cachean en gzip por prueba; relanzar no repite
 * descargas. La licencia se resuelve a persona SÓLO por `sport_external_id`
 * confirmado: nunca por nombre.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import {
  anioDeFecha,
  elegirClub,
  leerClasificacionSkermo,
  type ClubElegido,
  type FilaClasificacionSkermo,
  type FilaClub,
} from './perfiles-datos';
import type { VarianteNombre } from './perfiles-nombre';

const AGENTE = 'calendario-esgrima/1.0 (perfiles; contacto en la app)';

export type FechaPublicada = { fecha: string; fuente: string };

export type FilaNacional = {
  personaId: string;
  club: ClubElegido | null;
  /** Fechas completas publicadas (cada aparición cuenta). */
  fechas: FechaPublicada[];
  /** Años sin fecha (subdivisión de PDF por año de nacimiento). */
  aniosSubdivision: number[];
  variantes: VarianteNombre[];
};

export function mapaCanonico(db: DatabaseSync): Map<string, string> {
  const filas = db.prepare(`
    SELECT p.id AS id, coalesce(m2.id, m1.id, p.id) AS c
    FROM sport_person p
    LEFT JOIN sport_person m1 ON m1.id = p.merged_into_person_id
    LEFT JOIN sport_person m2 ON m2.id = m1.merged_into_person_id`).all() as { id: string; c: string }[];
  return new Map(filas.map((f) => [f.id, f.c]));
}

/** Licencia RFEE → persona canónica; una licencia en dos personas canónicas no se usa. */
function licencias(db: DatabaseSync, canon: Map<string, string>): Map<string, string> {
  const filas = db.prepare(`
    SELECT DISTINCT value AS lic, person_id AS p FROM sport_external_id
    WHERE scheme = 'rfee_license' AND link_status = 'CONFIRMADO' AND person_id IS NOT NULL`).all() as { lic: string; p: string }[];
  const tmp = new Map<string, Set<string>>();
  for (const f of filas) {
    const c = canon.get(f.p);
    if (!c) continue;
    const s = tmp.get(f.lic.toUpperCase()) ?? new Set<string>();
    s.add(c);
    tmp.set(f.lic.toUpperCase(), s);
  }
  return new Map([...tmp].filter(([, s]) => s.size === 1).map(([l, s]) => [l, [...s][0]]));
}

function idsFie(db: DatabaseSync, canon: Map<string, string>): Map<number, string> {
  const filas = db.prepare(`
    SELECT DISTINCT value AS v, person_id AS p FROM sport_external_id
    WHERE scheme = 'fie_addr_id' AND scope_source = 'fie' AND link_status = 'CONFIRMADO'`).all() as { v: string; p: string }[];
  const tmp = new Map<number, Set<string>>();
  for (const f of filas) {
    const c = canon.get(f.p);
    if (!c || !/^\d+$/.test(f.v)) continue;
    const s = tmp.get(Number(f.v)) ?? new Set<string>();
    s.add(c);
    tmp.set(Number(f.v), s);
  }
  return new Map([...tmp].filter(([, s]) => s.size === 1).map(([v, s]) => [v, [...s][0]]));
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function descargarSkermo(
  urls: Map<string, string>, cache: string, concurrencia: number, pausa: number, sinRed: boolean,
) {
  mkdirSync(cache, { recursive: true });
  const pendientes = [...urls].filter(([id]) => !existsSync(join(cache, `${id}.html.gz`)));
  console.log(`skermo: ${urls.size} pruebas, ${pendientes.length} sin caché${sinRed ? ' (sin red)' : ''}`);
  if (sinRed) return;
  let i = 0;
  let fallos = 0;
  async function hilo() {
    while (i < pendientes.length) {
      const [id, url] = pendientes[i++];
      try {
        const res = await fetch(url, { headers: { 'User-Agent': AGENTE, Accept: 'text/html' }, signal: AbortSignal.timeout(45_000) });
        if (res.ok) {
          const tmp = join(cache, `${id}.html.gz.tmp`);
          writeFileSync(tmp, gzipSync(await res.text()));
          renameSync(tmp, join(cache, `${id}.html.gz`));
        } else {
          fallos += 1;
        }
      } catch {
        fallos += 1;
        await esperar(pausa * 4);
      }
      if (i % 100 === 0) console.log(`  skermo ${i}/${pendientes.length}, fallos ${fallos}`);
      await esperar(pausa);
    }
  }
  await Promise.all(Array.from({ length: concurrencia }, hilo));
  console.log(`skermo: fallos ${fallos}`);
}

export function construirNacional(
  db: DatabaseSync,
  paginasSkermo: Iterable<FilaClasificacionSkermo[]>,
): { filas: FilaNacional[]; stats: Record<string, number> } {
  const canon = mapaCanonico(db);
  const porLicencia = licencias(db, canon);
  const porFie = idsFie(db, canon);
  const stats: Record<string, number> = {};
  const sumar = (k: string, n = 1) => { stats[k] = (stats[k] ?? 0) + n; };

  const personas = new Map<string, { clubes: FilaClub[]; fechas: FechaPublicada[]; anios: number[]; variantes: Map<string, VarianteNombre> }>();
  const de = (id: string) => {
    let p = personas.get(id);
    if (!p) { p = { clubes: [], fechas: [], anios: [], variantes: new Map() }; personas.set(id, p); }
    return p;
  };
  const variante = (id: string, v: VarianteNombre) => {
    const p = de(id);
    const k = `${v.fuente}|${v.nombre ?? ''}|${v.apellidos ?? ''}|${v.texto}`;
    const previa = p.variantes.get(k);
    if (previa) previa.peso = (previa.peso ?? 1) + (v.peso ?? 1);
    else p.variantes.set(k, { ...v, peso: v.peso ?? 1 });
  };

  // 1. Clubes de los resultados.
  const clubes = db.prepare(`
    SELECT r.person_id AS p, r.source AS fuente, r.source_club AS club,
           coalesce(r.occurred_on, c.competition_date, e.start_date) AS fecha
    FROM sport_result r
    JOIN sport_competition c ON c.id = r.competition_id
    JOIN sport_edition e ON e.id = c.edition_id
    WHERE r.person_id IS NOT NULL AND r.source_club IS NOT NULL AND trim(r.source_club) <> ''
      AND c.format = 'INDIVIDUAL'`).all() as { p: string; fuente: string; club: string; fecha: string | null }[];
  for (const f of clubes) {
    const c = canon.get(f.p);
    if (!c) continue;
    de(c).clubes.push({ club: f.club, fuente: f.fuente, fecha: f.fecha });
    sumar('clubes_resultados');
  }

  // 2. Clasificaciones de Skermo: fecha de nacimiento, nombre con acentos y club.
  for (const pagina of paginasSkermo) {
    sumar('skermo_paginas');
    for (const fila of pagina) {
      sumar('skermo_filas');
      const c = porLicencia.get(fila.licencia);
      if (!c) { sumar('skermo_sin_persona'); continue; }
      if (fila.fechaNacimiento) de(c).fechas.push({ fecha: fila.fechaNacimiento, fuente: 'skermo_clasificacion' });
      variante(c, { texto: `${fila.nombre} ${fila.apellidos}`, nombre: fila.nombre, apellidos: fila.apellidos, fuente: 'skermo_clasificacion' });
    }
  }

  // 3. Ranking RFEE vigente (Skermo): fecha, nombre separado y club actual.
  const ranking = db.prepare(`
    SELECT source_license AS lic, source_first_name AS nombre, source_last_name AS apellidos,
           source_athlete_name AS texto, source_club AS club, source_birth_date AS fecha, season_label AS temporada
    FROM official_ranking_entry WHERE source_license IS NOT NULL`).all() as {
    lic: string; nombre: string | null; apellidos: string | null; texto: string; club: string | null; fecha: string | null; temporada: string;
  }[];
  for (const f of ranking) {
    const c = porLicencia.get(f.lic.toUpperCase());
    if (!c) { sumar('ranking_sin_persona'); continue; }
    sumar('ranking_filas');
    if (f.fecha && anioDeFecha(f.fecha)) de(c).fechas.push({ fecha: f.fecha, fuente: 'ranking_rfee' });
    // El ranking da el club de la licencia de la temporada: se fecha al inicio de esa temporada.
    const inicio = /^\d{4}/.test(f.temporada ?? '') ? `${f.temporada.slice(0, 4)}-09-01` : null;
    if (f.club) de(c).clubes.push({ club: f.club, fuente: 'ranking_rfee', fecha: inicio });
    variante(c, { texto: f.texto, nombre: f.nombre, apellidos: f.apellidos, fuente: 'ranking_rfee' });
  }

  // 4. fie_fencer (tiradores enlazados por la app).
  const fencers = db.prepare(`SELECT fie_id AS id, source_birth_date AS fecha FROM fie_fencer WHERE source_birth_date IS NOT NULL`)
    .all() as { id: number; fecha: string }[];
  for (const f of fencers) {
    const c = porFie.get(Number(f.id));
    if (c && anioDeFecha(f.fecha)) { de(c).fechas.push({ fecha: f.fecha, fuente: 'fie_fencer' }); sumar('fie_fencer'); }
  }

  // 5. PDF por año de nacimiento: la subdivisión «2008» de la clave del hecho.
  const pdf = db.prepare(`SELECT person_id AS p, source_fact_key AS k FROM sport_result
    WHERE source = 'rfee_pdf' AND person_id IS NOT NULL`).all() as { p: string; k: string }[];
  for (const f of pdf) {
    const sub = f.k.split(':')[6] ?? '';
    if (!/^(19|20)\d\d$/.test(sub)) continue;
    const c = canon.get(f.p);
    if (c) { de(c).anios.push(Number(sub)); sumar('pdf_subdivision'); }
  }

  const filas: FilaNacional[] = [];
  for (const [personaId, p] of personas) {
    filas.push({
      personaId,
      club: elegirClub(p.clubes),
      fechas: p.fechas,
      aniosSubdivision: p.anios,
      variantes: [...p.variantes.values()],
    });
  }
  return { filas, stats };
}

function* leerPaginas(cache: string, ids: Iterable<string>): Generator<FilaClasificacionSkermo[]> {
  for (const id of ids) {
    const ruta = join(cache, `${id}.html.gz`);
    if (!existsSync(ruta)) continue;
    yield leerClasificacionSkermo(gunzipSync(readFileSync(ruta)).toString('utf8'));
  }
}

async function main() {
  const dbRuta = argumento('db', join(CARPETA_TRABAJO, 'perfiles.sqlite'));
  const cache = resolve(argumento('cache', join(CARPETA_TRABAJO, 'cache-skermo-competiciones')));
  const salida = resolve(argumento('salida', join(CARPETA_TRABAJO, 'perfiles', 'nacional.jsonl')));
  const concurrencia = Math.min(3, Math.max(1, Number(argumento('concurrencia', '2'))));
  const pausa = Math.max(200, Number(argumento('pausa-ms', '500')));
  const db = new DatabaseSync(dbRuta, { readOnly: true });

  const urls = new Map<string, string>();
  for (const { u } of db.prepare(`SELECT DISTINCT source_url AS u FROM sport_result
    WHERE source = 'skermo_rfee' AND source_url LIKE 'https://app.skermo.org/ranking/public/RFEE/competition/%'`).all() as { u: string }[]) {
    const id = u.match(/\/competition\/(\d+)/)?.[1];
    if (id) urls.set(id, `https://app.skermo.org/ranking/public/RFEE/competition/${id}?setLang=es`);
  }
  await descargarSkermo(urls, cache, concurrencia, pausa, bandera('sin-red'));

  const { filas, stats } = construirNacional(db, leerPaginas(cache, urls.keys()));
  db.close();
  mkdirSync(dirname(salida), { recursive: true });
  writeFileSync(`${salida}.tmp`, filas.map((f) => JSON.stringify(f)).join('\n') + '\n');
  renameSync(`${salida}.tmp`, salida);
  const conClub = filas.filter((f) => f.club).length;
  const conFecha = filas.filter((f) => f.fechas.length > 0).length;
  console.log(JSON.stringify({ salida, personas: filas.length, conClub, conFecha, ...stats }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
