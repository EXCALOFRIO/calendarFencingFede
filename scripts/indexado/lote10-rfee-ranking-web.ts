/**
 * Ranking nacional RFEE de las temporadas 2013-2014 a 2016-2017, de la web antigua de la RFEE
 * (`www.esgrima.es/pdfs/ranking/*.htm[l]`, enlazadas desde `ranking.html`) guardada en la
 * Wayback Machine. Skermo sólo publica desde 2017-2018.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-rfee-ranking-web.ts --descargar
 *   ... --generar --base <nuevo9.sqlite> --salida <calendario-trabajo/rankings-lote10-rfee-web> [--dia YYYY-MM-DD]
 *   ... --comprobar --base <nuevo9.sqlite> --salida <calendario-trabajo/rankings-lote10-rfee-web>
 *
 * Cada página es una lista («RANKING NACIONAL SABLE MASCULINO ABSOLUTO 2014-2015»): puesto,
 * «APELLIDOS, Nombre», club, nacionalidad, año de nacimiento, puntos de cada prueba y total. El
 * mismo nombre de fichero se publicó varias veces durante la temporada (y algunos con la fecha de
 * la última prueba en el nombre): de cada temporada, arma, género y categoría se queda la versión
 * con más pruebas puntuadas y, a igualdad, la capturada más tarde. Los «Ranking Interno», de
 * clubes, de equipos y la Liga no son el ranking nacional individual y no se leen.
 *
 * Se guardan con `source = 'skermo_ranking'` (el ranking nacional RFEE de la aplicación), como las
 * listas en PDF de 2017-2021. Vínculo con personas, sólo con una candidata:
 *  - el vínculo estricto por nombre de las listas en PDF (`vincularPorNombre`: mismo nombre y
 *    resultado individual en esa temporada, arma, género y categoría);
 *  - si no, mismo nombre normalizado, género y año de nacimiento publicado, entre las personas
 *    españolas con ese año de nacimiento conocido.
 * Un año de nacimiento conocido distinto del publicado anula el vínculo.
 */
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  claveNombre, contextoLista, indicePorNombre, sentenciasPublicacion, vincularPorNombre, type CandidataNombre, type FilaCarga,
} from '../../src/lib/ingest/ranking-skermo-historico';
import type { PublicacionRanking } from '../../src/lib/ingest/sources/ranking-oficial-historico';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import { comprobarCarpeta } from './lote10-rankings-comprobar';
import { redLote10 } from './lote10-red';
import { componerChunk, proyeccion } from './sincronizar-d1';

const CDX = 'http://web.archive.org/cdx/search/cdx?url=esgrima.es/pdfs/ranking/&matchType=prefix&output=json&fl=timestamp,original,statuscode,mimetype,digest,length&filter=statuscode:200&collapse=digest&limit=20000';
const FUENTE = 'skermo_ranking';
const SALIDA = join(CARPETA_TRABAJO, 'rankings-lote10-rfee-web');

export type FilaWeb = { puesto: number; nombre: string; club: string | null; nacion: string | null; anio: number | null; puntos: string | null };
export type ListaWeb = {
  temporada: string;
  arma: 'FLORETE' | 'ESPADA' | 'SABLE';
  genero: 'M' | 'F';
  categoria: 'ABS' | 'M20' | 'M17' | 'M15';
  titulo: string;
  pruebas: number;
  filas: FilaWeb[];
};

const limpiar = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
const plano = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();

/** Texto de la página: UTF-8 si lo es, si no Latin-1 (la web antigua no declaraba juego de caracteres). */
export function decodificar(b: Buffer): string {
  const u = b.toString('utf8');
  return u.includes('\uFFFD') ? b.toString('latin1') : u;
}

/** Lista del ranking nacional individual; `null` si la página es otra cosa (interno, clubes...). */
export function parsearRankingWeb(html: string): ListaWeb | null {
  const titulo = limpiar(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const t = plano(titulo);
  // El título viene a veces cortado («... JUNIOR 2016-201»): basta con que el final sea el principio del año siguiente.
  const m = /^RANKING NACIONAL (ESPADA|FLORETE|SABLE) (MASCULIN[OA]|FEMENIN[OA]) (ABSOLUT[OA]|SENIOR|JUNIOR|CADETE|INFANTIL|M-?15)\s+(20\d\d)\s*[-/]\s*(\d{1,4})$/.exec(t);
  if (!m || !String(Number(m[4]) + 1).startsWith(m[5]) || m[5].length < 3) return null;
  const categoria = ({ ABSOLUTO: 'ABS', ABSOLUTA: 'ABS', SENIOR: 'ABS', JUNIOR: 'M20', CADETE: 'M17', INFANTIL: 'M15' } as const)[m[3] as 'SENIOR'] ?? 'M15';
  const participantes = /Tiradores Participantes:([\s\S]*?)<\/tr>/i.exec(html)?.[1] ?? '';
  const pruebas = [...participantes.matchAll(/<td[^>]*>([^<]*)<\/td>/gi)].filter((x) => /^\d+$/.test(x[1].trim())).length;
  const filas: FilaWeb[] = [];
  for (const tr of html.split(/<tr\b/i).slice(1)) {
    const celdas = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)(?=<td\b|<\/tr>|$)/gi)].map((x) => limpiar(x[1].replace(/<\/td>\s*$/i, '')));
    if (celdas.length < 6 || !/^\d{1,4}$/.test(celdas[0])) continue;
    const nombre = celdas[1];
    if (!/,/.test(nombre) || /^\d/.test(nombre)) continue;
    const [apellidos, nombrePila] = nombre.split(',').map((x) => x.trim());
    const anio = /^(19[2-9]\d|20[01]\d)$/.test(celdas[4]) ? Number(celdas[4]) : null;
    const total = celdas.at(-1)!.replace(/\s+/g, '');
    filas.push({
      puesto: Number(celdas[0]),
      nombre: [apellidos, nombrePila].filter(Boolean).join(' '),
      club: celdas[2] || null,
      nacion: /^[A-Z]{3}$/.test(celdas[3]) ? celdas[3] : null,
      anio,
      puntos: /^-?\d+([.,]\d+)?$/.test(total) ? total.replace(',', '.') : null,
    });
  }
  if (filas.length === 0) return null;
  return {
    temporada: `${m[4]}-${Number(m[4]) + 1}`, arma: m[1] as ListaWeb['arma'], genero: m[2].startsWith('MASC') ? 'M' : 'F', categoria, titulo, pruebas, filas,
  };
}

/**
 * Lista coherente: puestos crecientes desde 1 y puntos no crecientes. La RFEE publica a veces al
 * mismo tirador en dos filas (dos licencias): se conservan las dos, sin vincular ninguna.
 */
export function listaCoherente(l: ListaWeb): string | null {
  if (l.filas[0].puesto !== 1) return 'no_empieza_en_1';
  for (let i = 1; i < l.filas.length; i += 1) {
    if (l.filas[i].puesto < l.filas[i - 1].puesto) return 'puestos_desordenados';
    const a = Number(l.filas[i - 1].puntos);
    const b = Number(l.filas[i].puntos);
    if (l.filas[i].puntos !== null && l.filas[i - 1].puntos !== null && b > a + 1e-9) return 'puntos_crecientes';
  }
  return null;
}

export const refFila = (f: Pick<FilaWeb, 'nombre' | 'anio'>) => `rfee-web:${claveNombre(f.nombre).replace(/ /g, '_')}|${f.anio ?? ''}`;

type Version = { ts: string; original: string };

async function versiones(): Promise<Version[]> {
  const red = redLote10('wayback');
  const r = await red.get(CDX);
  if (r.status !== 200) throw new Error(`CDX ${r.status}`);
  const filas = JSON.parse(r.body.toString('utf8')) as string[][];
  return filas.slice(1).filter((f) => f[3] === 'text/html' && /\.html?$/i.test(f[1])).map((f) => ({ ts: f[0], original: f[1] }));
}

const urlVersion = (v: Version) => `http://web.archive.org/web/${v.ts}id_/${v.original}`;

async function descargar(): Promise<void> {
  const red = redLote10('wayback');
  const vs = await versiones();
  let n = 0;
  for (const v of vs) {
    const r = await red.get(urlVersion(v));
    if (r.status === 200) n += 1;
  }
  console.log(`Versiones: ${vs.length}; leídas ${n}; peticiones nuevas ${red.peticiones}`);
}

type Elegida = { lista: ListaWeb; version: Version; url: string };

async function elegidas(): Promise<{ elegidas: Elegida[]; descartes: Record<string, number> }> {
  const red = redLote10('wayback');
  const porClave = new Map<string, Elegida>();
  const descartes: Record<string, number> = {};
  for (const v of await versiones()) {
    const r = await red.get(urlVersion(v));
    if (r.status !== 200) continue;
    const l = parsearRankingWeb(decodificar(r.body));
    if (!l) {
      descartes.no_es_ranking_nacional = (descartes.no_es_ranking_nacional ?? 0) + 1;
      continue;
    }
    const k = `${l.temporada}|${l.arma}|${l.genero}|${l.categoria}`;
    const previa = porClave.get(k);
    const mejor = !previa || l.pruebas > previa.lista.pruebas || (l.pruebas === previa.lista.pruebas && (l.filas.length > previa.lista.filas.length ||
      (l.filas.length === previa.lista.filas.length && v.ts > previa.version.ts)));
    if (previa) descartes.version_anterior = (descartes.version_anterior ?? 0) + 1;
    if (mejor) porClave.set(k, { lista: l, version: v, url: `https://web.archive.org/web/${v.ts}/${v.original}` });
  }
  return { elegidas: [...porClave.values()].sort((a, b) => `${a.lista.temporada}${a.lista.arma}${a.lista.genero}${a.lista.categoria}`.localeCompare(`${b.lista.temporada}${b.lista.arma}${b.lista.genero}${b.lista.categoria}`)), descartes };
}

function candidatas(base: DatabaseSync, temporadas: string[]) {
  const enPrueba = base.prepare(
    `SELECT DISTINCT c.season || '|' || c.weapon || '|' || c.gender || '|' || c.category AS contexto, coalesce(p.merged_into_person_id, p.id) AS pid
       FROM sport_competition c JOIN sport_result r ON r.competition_id = c.id JOIN sport_person p ON p.id = r.person_id
      WHERE c.format = 'INDIVIDUAL' AND c.season IN (SELECT value FROM json_each(?))`,
  ).all(JSON.stringify(temporadas)) as { contexto: string; pid: string }[];
  const personas = base.prepare(
    `SELECT p.id AS pid, p.display_name AS nombre, p.gender AS genero, p.birth_year AS anio, p.country_code AS pais
       FROM sport_person p WHERE p.merged_into_person_id IS NULL`,
  ).all() as { pid: string; nombre: string; genero: string | null; anio: number | null; pais: string | null }[];
  const alias = base.prepare(`SELECT coalesce(p.merged_into_person_id, p.id) AS pid, a.name_original AS nombre FROM sport_person_alias a JOIN sport_person p ON p.id = a.person_id`).all() as { pid: string; nombre: string | null }[];
  const nombres = new Map<string, Set<string>>();
  const anyadir = (pid: string, n: string | null) => n && nombres.set(pid, (nombres.get(pid) ?? new Set()).add(n));
  for (const p of personas) anyadir(p.pid, p.nombre);
  for (const a of alias) anyadir(a.pid, a.nombre);
  const datos = new Map(personas.map((p) => [p.pid, p] as const));
  const lista: CandidataNombre[] = [];
  for (const { contexto, pid } of enPrueba) {
    for (const nombre of nombres.get(pid) ?? []) lista.push({ contexto, nombre, personId: pid, genero: datos.get(pid)?.genero ?? null });
  }
  // Nombre + género + año de nacimiento: sólo personas españolas con el año conocido.
  const porNacimiento = new Map<string, Set<string>>();
  for (const p of personas) {
    if (p.pais !== 'ESP' || p.anio === null || (p.genero !== 'M' && p.genero !== 'F')) continue;
    for (const n of nombres.get(p.pid) ?? []) {
      const k = `${p.genero}|${p.anio}|${claveNombre(n)}`;
      porNacimiento.set(k, (porNacimiento.get(k) ?? new Set()).add(p.pid));
    }
  }
  return { indice: indicePorNombre(lista), porNacimiento, datos };
}

async function generar(): Promise<void> {
  const salida = resolve(argumento('salida', SALIDA));
  const rutaBase = argumento('base', '');
  if (!rutaBase || !existsSync(rutaBase)) throw new Error('falta --base <copia .sqlite>');
  const base = new DatabaseSync(resolve(rutaBase), { readOnly: true });
  const { elegidas: listas, descartes } = await elegidas();
  const temporadas = [...new Set(listas.map((l) => l.lista.temporada))].sort();
  const { indice, porNacimiento, datos } = candidatas(base, temporadas);
  const yaCargadas = new Set((base.prepare(`SELECT season||'|'||weapon||'|'||gender||'|'||category_raw||'|'||format AS k FROM sport_ranking_publication WHERE source = ?`).all(FUENTE) as { k: string }[]).map((r) => r.k));
  if (existsSync(salida)) for (const f of readdirSync(salida)) if (/^ranking-.*\.sql$/.test(f)) rmSync(join(salida, f));
  mkdirSync(salida, { recursive: true });

  const porTemporada = new Map<string, { sentencias: string[]; cargo: number; listas: number; entradas: number; vinculadas: number; porContexto: number; porNacimiento: number; personas: Set<string> }>();
  const incidencias: string[] = [];
  const detalle: Record<string, unknown>[] = [];
  // Una lista capturada a mitad de temporada no es la de la temporada: se exige que puntúe al
  // menos tantas pruebas como la más larga de su arma y categoría en otra temporada, menos una.
  const maxPruebas = new Map<string, number>();
  for (const { lista: l } of listas) {
    const k = `${l.arma}|${l.categoria}`;
    maxPruebas.set(k, Math.max(maxPruebas.get(k) ?? 0, l.pruebas));
  }
  for (const { lista: l, url, version } of listas) {
    const incoherente = listaCoherente(l);
    const etiqueta = `${l.temporada} ${l.arma} ${l.genero} ${l.categoria}`;
    if (incoherente) {
      incidencias.push(`${etiqueta}: ${incoherente} (${url})`);
      continue;
    }
    if (l.pruebas < (maxPruebas.get(`${l.arma}|${l.categoria}`) ?? 0) - 1) {
      incidencias.push(`${etiqueta}: lista de mitad de temporada (${l.pruebas} pruebas de ${maxPruebas.get(`${l.arma}|${l.categoria}`)}; ${url})`);
      continue;
    }
    if (yaCargadas.has(`${l.temporada}|${l.arma}|${l.genero}|${l.categoria}|INDIVIDUAL`)) {
      incidencias.push(`${etiqueta}: ya cargada`);
      continue;
    }
    const p: PublicacionRanking = {
      fuente: FUENTE, season: l.temporada, arma: l.arma, genero: l.genero, categoria: l.categoria, categoriaOriginal: l.categoria, formato: 'INDIVIDUAL',
      publicadoEl: `${version.ts.slice(0, 4)}-${version.ts.slice(4, 6)}-${version.ts.slice(6, 8)}`, url, total: l.filas.length, entradas: [],
    };
    const porNombre = vincularPorNombre(l.filas.map((f) => f.nombre), contextoLista(p), indice);
    const t = porTemporada.get(l.temporada) ?? porTemporada.set(l.temporada, { sentencias: [], cargo: 0, listas: 0, entradas: 0, vinculadas: 0, porContexto: 0, porNacimiento: 0, personas: new Set() }).get(l.temporada)!;
    const usadas = new Map<string, number>();
    const vinculos = l.filas.map((f, i) => {
      let pid = porNombre[i];
      let via: 'contexto' | 'nacimiento' | null = pid ? 'contexto' : null;
      if (!pid && f.anio !== null) {
        const c = porNacimiento.get(`${l.genero}|${f.anio}|${claveNombre(f.nombre)}`);
        if (c && c.size === 1) {
          pid = [...c][0];
          via = 'nacimiento';
        }
      }
      const conocido = pid ? datos.get(pid)?.anio ?? null : null;
      if (pid && f.anio !== null && conocido !== null && conocido !== f.anio) {
        pid = null;
        via = null;
      }
      if (pid) usadas.set(pid, (usadas.get(pid) ?? 0) + 1);
      return { pid, via };
    });
    const refs = new Map<string, number>();
    for (const f of l.filas) refs.set(refFila(f), (refs.get(refFila(f)) ?? 0) + 1);
    const filas: FilaCarga[] = l.filas.map((f, i) => {
      const repetida = (refs.get(refFila(f)) ?? 0) > 1;
      const v = repetida ? { pid: null, via: null } : vinculos[i];
      // Una persona en dos filas de la misma lista: ninguna de las dos se vincula.
      const pid = v.pid && usadas.get(v.pid) === 1 ? v.pid : null;
      if (pid) {
        t.vinculadas += 1;
        t.personas.add(pid);
        if (v.via === 'contexto') t.porContexto += 1;
        else t.porNacimiento += 1;
      }
      return { sourceRef: repetida ? `${refFila(f)}#${f.puesto}` : refFila(f), personId: pid, sourceName: f.nombre, position: f.puesto, points: f.puntos };
    });
    const { sentencias, cargo } = sentenciasPublicacion(p, filas, 'observed');
    t.sentencias.push(...sentencias);
    t.cargo += cargo;
    t.listas += 1;
    t.entradas += filas.length;
    detalle.push({ lista: etiqueta, url, pruebas: l.pruebas, filas: filas.length, vinculadas: filas.filter((f) => f.personId).length });
  }
  const medido = statSync(resolve(rutaBase)).size;
  const ficheros: { archivo: string; temporada: string; listas: number; entradas: number; cargoBytes: number; bytes: number; sha256: string }[] = [];
  for (const [temporada, t] of [...porTemporada].sort(([a], [b]) => a.localeCompare(b))) {
    if (t.sentencias.length === 0) continue;
    const archivo = `ranking-${temporada}.sql`;
    const texto = componerChunk(t.sentencias.map((s) => `${s};\n`).join(''), { owner: randomUUID(), medidoBytes: medido, proyectadoBytes: proyeccion(t.cargo) });
    writeFileSync(join(salida, archivo), texto);
    ficheros.push({ archivo, temporada, listas: t.listas, entradas: t.entradas, cargoBytes: t.cargo, bytes: Buffer.byteLength(texto), sha256: createHash('sha256').update(texto, 'utf8').digest('hex') });
  }
  const informe = {
    generado: new Date().toISOString(), fuente: FUENTE, origen: 'www.esgrima.es/pdfs/ranking (Wayback Machine)', descartes, incidencias,
    porTemporada: Object.fromEntries([...porTemporada].map(([k, t]) => [k, { listas: t.listas, filas: t.entradas, vinculadas: t.vinculadas, porContexto: t.porContexto, porNacimiento: t.porNacimiento, personas: t.personas.size }])),
    totalEntradas: ficheros.reduce((s, f) => s + f.entradas, 0), ficheros, detalle,
  };
  writeFileSync(join(salida, 'informe.json'), `${JSON.stringify(informe, null, 2)}\n`);
  console.log(JSON.stringify({ ...informe, detalle: detalle.length }, null, 2));
  base.close();
}

async function main(): Promise<void> {
  if (bandera('descargar')) await descargar();
  else if (bandera('generar')) await generar();
  else if (bandera('comprobar')) {
    const salida = resolve(argumento('salida', SALIDA));
    const informe = JSON.parse(readFileSync(join(salida, 'informe.json'), 'utf8')) as { ficheros: { archivo: string; entradas: number }[] };
    process.exitCode = comprobarCarpeta(salida, argumento('base', ''), informe.ficheros) ? 0 : 1;
  } else {
    console.error('Modo: --descargar | --generar --base <sqlite> --salida <dir> | --comprobar --base <sqlite> --salida <dir>');
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
