import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { extractText, getDocumentProxy } from 'unpdf';
import { archivoEfc, combosEfc, listaEfc, temporadasEfc, urlEfc, EFC_BASE, type ComboEfc } from '../src/lib/ingest/rankings-internacionales/efc';
import { archivoFie, combosFie, parseRankingFie, urlFie } from '../src/lib/ingest/rankings-internacionales/fie';
import { listaFfe, parseListadoFfe, urlFichaFfe, urlListadoFfe, type FichaFfe } from '../src/lib/ingest/rankings-internacionales/ffe';
import {
  CONSULTAS_FIS,
  elegirDocumentosFis,
  listasFis,
  parseBusquedaFis,
  urlArchivoFis,
  urlBusquedaFis,
  type DocumentoFis,
} from '../src/lib/ingest/rankings-internacionales/fis';
import { COMBOS_HKFA, archivoHkfa, listaHkfa, urlHkfa } from '../src/lib/ingest/rankings-internacionales/hkfa';
import { archivoMvsz, combosMvsz, listaMvsz, temporadasMvsz, urlFormularioMvsz, urlMvsz } from '../src/lib/ingest/rankings-internacionales/mvsz';
import { sentenciasLista, type FilaSql } from '../src/lib/ingest/rankings-internacionales/sql';
import type { ListaInternacional } from '../src/lib/ingest/rankings-internacionales/tipos';
import { indicePersonas, vincularLista, type MotivoSinVinculo, type PersonaFie } from '../src/lib/ingest/rankings-internacionales/vincular';
import { leerXlsx } from '../src/lib/ingest/rankings-internacionales/xlsx';
import { currentFieSeason } from '../src/lib/ingest/sources/fie';
import { FUENTES_RANKING } from '../src/lib/sport/rankings-internacionales-fuentes';
import { componerChunk, proyeccion } from './indexado/sincronizar-d1';

/**
 * Rankings internacionales: histórico FIE, EFC (europeo), FFE (Francia), FIS
 * (Italia), FAHK (Hong Kong) y MVSZ (Hungría), a
 * `sport_ranking_publication`/`sport_ranking_entry`.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/rankings-internacionales.ts --descargar [--fuentes fie,efc,ffe,fis,hkfa,mvsz]
 *   ... --generar --base <copia .sqlite> --salida <dir> [--fuentes ...] [--todas-las-filas] [--dia YYYY-MM-DD]
 *   ... --comprobar --base <copia .sqlite> --salida <dir>
 *
 * --descargar: sólo GET públicos, como mucho 2 a la vez por fuente (cada fuente
 *   es un anfitrión distinto y van una detrás de otra), 500 ms entre peticiones
 *   de cada hilo, User-Agent de INGEST_USER_AGENT, caché en disco.
 * --generar: lee la caché y la copia (sólo lectura), vincula personas y escribe
 *   ficheros SQL atómicos (lease + contexto de capacidad + cuerpo + cierre) e
 *   `informe.json`. Por defecto sólo se guardan las filas vinculadas a una
 *   persona: las demás no aparecen en ningún perfil y ocuparían D1 sin uso;
 *   `published_total` conserva el tamaño de la lista.
 * --comprobar: aplica los ficheros sobre una base en memoria con el esquema y
 *   las guardas de la copia; comprueba recuentos, idempotencia y claves ajenas.
 */

const TRABAJO = join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'calendario-datos', 'calendario-trabajo');
const CACHE = join(TRABAJO, 'cache-rankings-int');
const PAUSA_MS = 500;
const CONCURRENCIA = 2;
const MAX_CUERPO_BYTES = 8 * 1024 * 1024;

const args = process.argv.slice(2);
const arg = (nombre: string, def = '') => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const bandera = (nombre: string) => args.includes(`--${nombre}`);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HOY = arg('dia', new Date().toISOString().slice(0, 10));
const TEMPORADA_FIE = currentFieSeason(new Date(`${HOY}T12:00:00Z`));

let peticiones = 0;

async function pedir(url: string): Promise<Buffer> {
  let ultimo: unknown = null;
  for (let intento = 0; intento < 2; intento += 1) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+contacto)', 'Accept-Language': 'en,es;q=0.8' },
        signal: AbortSignal.timeout(90_000),
      });
      peticiones += 1;
      if (r.status === 404) return Buffer.alloc(0);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      ultimo = e;
      await espera(3_000);
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
}

/** Ruta relativa a CACHE; si ya existe no se pide. */
async function enCache(ruta: string, url: string): Promise<Buffer> {
  const completa = join(CACHE, ruta);
  if (existsSync(completa)) return readFileSync(completa);
  const cuerpo = await pedir(url);
  mkdirSync(dirname(completa), { recursive: true });
  writeFileSync(completa, cuerpo);
  await espera(PAUSA_MS);
  return cuerpo;
}

const leerCache = (ruta: string): Buffer | null => {
  const completa = join(CACHE, ruta);
  return existsSync(completa) ? readFileSync(completa) : null;
};

async function enParalelo<T>(items: readonly T[], fn: (item: T) => Promise<void>, etiqueta: string) {
  let i = 0;
  let hechas = 0;
  const fallos: string[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCIA }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try {
          await fn(item);
        } catch (e) {
          fallos.push(e instanceof Error ? e.message.slice(0, 200) : String(e));
          await espera(PAUSA_MS * 4);
        }
        hechas += 1;
        if (hechas % 100 === 0) console.log(`  ${etiqueta}: ${hechas}/${items.length} (peticiones ${peticiones})`);
      }
    }),
  );
  console.log(`${etiqueta}: ${items.length} tareas, ${fallos.length} fallos, peticiones acumuladas ${peticiones}`);
  for (const f of fallos.slice(0, 5)) console.log(`  fallo: ${f}`);
  return fallos;
}

async function textoPdf(bytes: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join('\n');
}

// ------------------------------------------------------------------ FIE ---

const FIE_DESDE = 2003;
const combosFieTodos = () => combosFie(FIE_DESDE, TEMPORADA_FIE);

async function descargarFie() {
  await enParalelo(combosFieTodos(), async (c) => {
    await enCache(join('fie', archivoFie(c)), urlFie(c));
  }, 'fie');
}

function listasFieCache(): ListaInternacional[] {
  const salida: ListaInternacional[] = [];
  for (const c of combosFieTodos()) {
    // La temporada en curso la mantiene la ingesta diaria (`fie_tiradores`).
    if (c.season >= TEMPORADA_FIE) continue;
    const b = leerCache(join('fie', archivoFie(c)));
    if (!b || b.length === 0) continue;
    const l = parseRankingFie(JSON.parse(b.toString('utf8')), c, HOY);
    if (l && l.filas.length) salida.push(l);
  }
  return salida;
}

// ------------------------------------------------------------------ EFC ---

async function temporadasEfcCache(): Promise<number[]> {
  const html = (await enCache(join('efc', 'rankings.html'), EFC_BASE)).toString('utf8');
  return temporadasEfc(html);
}

async function descargarEfc() {
  const combos = combosEfc(await temporadasEfcCache());
  await enParalelo(combos, async (c) => {
    await enCache(join('efc', archivoEfc(c)), urlEfc(c, true));
  }, 'efc');
}

function listasEfcCache(): { lista: ListaInternacional; combo: ComboEfc }[] {
  const html = leerCache(join('efc', 'rankings.html'));
  if (!html) return [];
  const salida: { lista: ListaInternacional; combo: ComboEfc }[] = [];
  for (const c of combosEfc(temporadasEfc(html.toString('utf8')))) {
    const b = leerCache(join('efc', archivoEfc(c)));
    if (!b || b.length < 4 || b[0] !== 0x50) continue;
    const l = listaEfc(c, leerXlsx(b), HOY);
    if (l && l.filas.length) salida.push({ lista: l, combo: c });
  }
  return salida;
}

// ------------------------------------------------------------------ FFE ---

const ffeTemporadas = () => Array.from({ length: 5 }, (_, i) => TEMPORADA_FIE - 4 + i);

async function descargarFfe() {
  const fichas: { saison: number; ficha: FichaFfe }[] = [];
  for (const saison of ffeTemporadas()) {
    const html = (await enCache(join('ffe', `listado-${saison}.html`), urlListadoFfe(saison))).toString('utf8');
    for (const ficha of parseListadoFfe(html)) fichas.push({ saison, ficha });
  }
  console.log(`ffe: ${fichas.length} fichas nacionales individuales`);
  await enParalelo(fichas, async ({ ficha }) => {
    await enCache(join('ffe', `ficha-${ficha.id}.html`), urlFichaFfe(ficha.id));
  }, 'ffe');
}

function listasFfeCache(): { lista: ListaInternacional; saison: number }[] {
  const salida: { lista: ListaInternacional; saison: number }[] = [];
  for (const saison of ffeTemporadas()) {
    const listado = leerCache(join('ffe', `listado-${saison}.html`));
    if (!listado) continue;
    for (const ficha of parseListadoFfe(listado.toString('utf8'))) {
      const html = leerCache(join('ffe', `ficha-${ficha.id}.html`));
      if (!html) continue;
      const l = listaFfe(saison, ficha, html.toString('utf8'), HOY);
      if (l.filas.length) salida.push({ lista: l, saison });
    }
  }
  return salida;
}

// ------------------------------------------------------------------ FIS ---

async function documentosFis(descargarPaginas: boolean): Promise<DocumentoFis[]> {
  const docs: DocumentoFis[] = [];
  for (const consulta of CONSULTAS_FIS) {
    for (let pagina = 1; pagina <= 8; pagina += 1) {
      const ruta = join('fis', `busqueda-${consulta.replace(/\W+/g, '_')}-${pagina}.html`);
      const b = descargarPaginas ? await enCache(ruta, urlBusquedaFis(consulta, pagina)) : leerCache(ruta);
      if (!b) break;
      const encontrados = parseBusquedaFis(b.toString('utf8'));
      if (!encontrados.length) break;
      docs.push(...encontrados);
    }
  }
  return docs;
}

async function descargarFis() {
  const elegidos = elegirDocumentosFis(await documentosFis(true));
  console.log(`fis: ${elegidos.length} documentos de ranking (${elegidos.map((d) => `${d.categoria} ${d.temporada}${d.finale ? '' : '*'}`).join(', ')})`);
  await enParalelo(elegidos, async (d) => {
    await enCache(join('fis', `archivo-${d.idFile}.xlsx`), urlArchivoFis(d.idFile));
  }, 'fis');
}

async function listasFisCache(): Promise<{ lista: ListaInternacional; finale: boolean }[]> {
  const salida: { lista: ListaInternacional; finale: boolean }[] = [];
  for (const d of elegirDocumentosFis(await documentosFis(false))) {
    const b = leerCache(join('fis', `archivo-${d.idFile}.xlsx`));
    if (!b || b.length < 4 || b[0] !== 0x50) continue;
    for (const l of listasFis(d, leerXlsx(b))) salida.push({ lista: l, finale: d.finale });
  }
  return salida;
}

// ----------------------------------------------------------------- FAHK ---

async function descargarHkfa() {
  await enParalelo(COMBOS_HKFA, async (c) => {
    await enCache(join('hkfa', `${HOY}-${archivoHkfa(c)}`), urlHkfa(c));
  }, 'hkfa');
}

async function listasHkfaCache(): Promise<ListaInternacional[]> {
  const salida: ListaInternacional[] = [];
  const dir = join(CACHE, 'hkfa');
  if (!existsSync(dir)) return salida;
  // Cada descarga se guarda con su día: es la lista vigente ese día.
  for (const nombre of readdirSync(dir).sort()) {
    const m = /^(\d{4}-\d{2}-\d{2})-(.+\.pdf)$/.exec(nombre);
    const c = m && COMBOS_HKFA.find((x) => archivoHkfa(x) === m[2]);
    if (!m || !c) continue;
    const b = readFileSync(join(dir, nombre));
    if (b.length < 5 || b.subarray(0, 4).toString('latin1') !== '%PDF') continue;
    const l = listaHkfa(c, await textoPdf(b), m[1]);
    if (l) salida.push(l);
  }
  return salida;
}

// ----------------------------------------------------------------- MVSZ ---

async function descargarMvsz() {
  const form = (await enCache(join('mvsz', 'formulario.html'), urlFormularioMvsz())).toString('utf8');
  await enParalelo(combosMvsz(temporadasMvsz(form)), async (c) => {
    await enCache(join('mvsz', archivoMvsz(c)), urlMvsz(c));
  }, 'mvsz');
}

function listasMvszCache(): ListaInternacional[] {
  const form = leerCache(join('mvsz', 'formulario.html'));
  if (!form) return [];
  const salida: ListaInternacional[] = [];
  for (const c of combosMvsz(temporadasMvsz(form.toString('utf8')))) {
    const b = leerCache(join('mvsz', archivoMvsz(c)));
    const l = b && listaMvsz(c, b.toString('utf8'), HOY);
    if (l) salida.push(l);
  }
  return salida;
}

// -------------------------------------------------------------- Generar ---

type Candidata = { lista: ListaInternacional; cerrada: boolean };

async function candidatas(fuentes: Set<string>): Promise<Candidata[]> {
  const salida: Candidata[] = [];
  if (fuentes.has('fie')) for (const l of listasFieCache()) salida.push({ lista: l, cerrada: Number(l.temporada) < TEMPORADA_FIE });
  if (fuentes.has('efc')) for (const { lista, combo } of listasEfcCache()) salida.push({ lista, cerrada: combo.season + 1 < TEMPORADA_FIE });
  if (fuentes.has('ffe')) for (const { lista, saison } of listasFfeCache()) salida.push({ lista, cerrada: saison < TEMPORADA_FIE });
  if (fuentes.has('fis')) {
    for (const { lista, finale } of await listasFisCache()) {
      salida.push({ lista, cerrada: finale || Number(lista.temporada.slice(5)) < TEMPORADA_FIE });
    }
  }
  if (fuentes.has('hkfa')) for (const lista of await listasHkfaCache()) salida.push({ lista, cerrada: false });
  if (fuentes.has('mvsz')) for (const lista of listasMvszCache()) salida.push({ lista, cerrada: Number(lista.temporada.slice(5)) < TEMPORADA_FIE });
  return salida;
}

function abrirBase(ruta: string) {
  if (!ruta || !existsSync(ruta)) throw new Error('falta --base <copia de producción .sqlite>');
  return new DatabaseSync(resolve(ruta), { readOnly: true });
}

function personasFie(base: DatabaseSync): PersonaFie[] {
  const filas = base.prepare(
    `SELECT e.value AS fieId, c.id AS personId, c.country_code AS pais, c.gender AS genero, c.birth_year AS anio,
            c.display_name AS nombre, trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) AS nombre2
     FROM sport_external_id e JOIN sport_person p ON p.id = e.person_id
     JOIN sport_person c ON c.id = coalesce(p.merged_into_person_id, p.id)
     WHERE e.scheme = 'fie_addr_id' AND e.link_status = 'CONFIRMADO' AND c.merged_into_person_id IS NULL`,
  ).all() as { fieId: string; personId: string; pais: string | null; genero: string | null; anio: number | null; nombre: string; nombre2: string }[];
  const conFie = new Set(filas.map((f) => f.personId));
  const sinFie = (base.prepare(
    `SELECT c.id AS personId, c.country_code AS pais, c.gender AS genero, c.birth_year AS anio,
            c.display_name AS nombre, trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) AS nombre2
     FROM sport_person c
     WHERE c.merged_into_person_id IS NULL AND c.country_code IS NOT NULL AND c.gender IN ('M','F')
       AND c.id IN (SELECT DISTINCT coalesce(p.merged_into_person_id, p.id) FROM sport_result r JOIN sport_person p ON p.id = r.person_id)`,
  ).all() as Omit<(typeof filas)[number], 'fieId'>[]).filter((f) => !conFie.has(f.personId));
  const persona = (f: Omit<(typeof filas)[number], 'fieId'>, fieId: string | null): PersonaFie => ({
    personId: f.personId,
    fieId,
    pais: f.pais,
    genero: f.genero,
    anioNacimiento: f.anio === null ? null : Number(f.anio),
    nombres: [f.nombre, f.nombre2],
  });
  return [...filas.map((f) => persona(f, String(f.fieId))), ...sinFie.map((f) => persona(f, null))];
}

type Resumen = {
  listas: number;
  listasYaCargadas: number;
  temporadas: Set<string>;
  filasPublicadas: number;
  filasVinculadas: number;
  porFieId: number;
  porNombre: number;
  personas: Set<string>;
  motivos: Partial<Record<MotivoSinVinculo, number>>;
  filasCargadas: number;
};

async function generar() {
  if (!arg('salida')) throw new Error('falta --salida <dir>');
  const salida = resolve(arg('salida'));
  const base = abrirBase(arg('base'));
  const fuentes = new Set((arg('fuentes') || 'fie,efc,ffe,fis,hkfa,mvsz').split(','));
  const todas = bandera('todas-las-filas');
  const indice = indicePersonas(personasFie(base));
  console.log(`Personas con id FIE: ${indice.porFieId.size}; claves de nombre: ${indice.porNombre.size}`);

  const existentes = base.prepare(
    `SELECT source, season, weapon, gender, category_raw AS raw, published_on AS dia FROM sport_ranking_publication WHERE format = 'INDIVIDUAL'`,
  ).all() as { source: string; season: string; weapon: string; gender: string; raw: string; dia: string }[];
  const claveLista = (s: string, t: string, a: string, g: string, r: string) => `${s}|${t}|${a}|${g}|${r}`;
  const listasExistentes = new Set(existentes.map((e) => claveLista(e.source, e.season, e.weapon, e.gender, e.raw)));
  const diasExistentes = new Set(existentes.map((e) => `${claveLista(e.source, e.season, e.weapon, e.gender, e.raw)}|${e.dia}`));

  if (existsSync(salida)) for (const f of readdirSync(salida)) if (/^\d{2}-.*\.sql$/.test(f)) rmSync(join(salida, f));
  mkdirSync(salida, { recursive: true });

  const resumen = new Map<string, Resumen>();
  const cuerpos = new Map<string, { sentencias: string[]; cargo: number; listas: number; entradas: number }[]>();
  const vistas = new Set<string>();

  for (const { lista: l, cerrada } of await candidatas(fuentes)) {
    const r = resumen.get(l.fuente) ?? {
      listas: 0, listasYaCargadas: 0, temporadas: new Set<string>(), filasPublicadas: 0, filasVinculadas: 0,
      porFieId: 0, porNombre: 0, personas: new Set<string>(), motivos: {}, filasCargadas: 0,
    };
    resumen.set(l.fuente, r);
    const clave = claveLista(l.fuente, l.temporada, l.arma, l.genero, l.categoriaRaw);
    // Las temporadas ya leídas por la ingesta diaria de la FIE no se duplican en el histórico.
    const yaFie = l.fuente === 'fie_historico' && listasExistentes.has(claveLista('fie_tiradores', l.temporada, l.arma, l.genero, l.categoriaRaw));
    const ya = yaFie || (cerrada ? listasExistentes.has(clave) : diasExistentes.has(`${clave}|${l.publicadoEl}`)) || vistas.has(`${clave}|${cerrada ? '' : l.publicadoEl}`);
    vistas.add(`${clave}|${cerrada ? '' : l.publicadoEl}`);
    if (ya) {
      r.listasYaCargadas += 1;
      continue;
    }
    const paisFederacion = FUENTES_RANKING[l.fuente].pais;
    const filas: FilaSql[] = [];
    const refs = new Set<string>();
    // Una misma referencia dos veces en una lista (la FFE lo hace a veces): cuenta la primera.
    const unicas = l.filas.filter((f) => !refs.has(f.ref) && refs.add(f.ref));
    const vinculos = vincularLista(unicas, l, paisFederacion, indice);
    for (const [i, f] of unicas.entries()) {
      const v = vinculos[i];
      r.filasPublicadas += 1;
      if ('via' in v) {
        r.filasVinculadas += 1;
        r.personas.add(v.personId);
        if (v.via === 'fie_id') r.porFieId += 1;
        else r.porNombre += 1;
      } else {
        r.motivos[v.motivo] = (r.motivos[v.motivo] ?? 0) + 1;
      }
      if (v.personId || todas) {
        filas.push({ ref: f.ref, personId: v.personId, nombre: f.nombre || null, pais: f.pais, puesto: f.puesto, puntos: f.puntos });
      }
    }
    r.listas += 1;
    r.temporadas.add(l.temporada);
    r.filasCargadas += filas.length;
    const { sentencias, cargo } = sentenciasLista(l, filas, cerrada);
    const grupo = `${l.fuente}-${l.temporada}`;
    const partes = cuerpos.get(grupo) ?? [];
    let parte = partes[partes.length - 1];
    const bytes = sentencias.reduce((n, s) => n + s.length + 2, 0);
    const actual = parte ? parte.sentencias.reduce((n, s) => n + s.length + 2, 0) : 0;
    if (!parte || actual + bytes > MAX_CUERPO_BYTES) {
      parte = { sentencias: [], cargo: 0, listas: 0, entradas: 0 };
      partes.push(parte);
    }
    parte.sentencias.push(...sentencias);
    parte.cargo += cargo;
    parte.listas += 1;
    parte.entradas += filas.length;
    cuerpos.set(grupo, partes);
  }

  const orden = ['fie_historico', 'efc_ranking', 'ffe_classement', 'fis_ranking', 'hkfa_ranking', 'mvsz_ranglista'];
  const medido = statSync(resolve(arg('base'))).size;
  const ficheros: { archivo: string; fuente: string; temporada: string; listas: number; entradas: number; cargoBytes: number; bytes: number; sha256: string }[] = [];
  let n = 0;
  const grupos = [...cuerpos.keys()].sort((a, b) => {
    const fa = orden.findIndex((o) => a.startsWith(`${o}-`));
    const fb = orden.findIndex((o) => b.startsWith(`${o}-`));
    return fa - fb || a.localeCompare(b);
  });
  for (const grupo of grupos) {
    const partes = cuerpos.get(grupo)!;
    partes.forEach((p, i) => {
      n += 1;
      const archivo = `${String(n).padStart(2, '0')}-${grupo}${partes.length > 1 ? `-${i + 1}` : ''}.sql`;
      const cuerpo = p.sentencias.map((s) => `${s};\n`).join('');
      const texto = componerChunk(cuerpo, { owner: randomUUID(), medidoBytes: medido, proyectadoBytes: proyeccion(p.cargo) });
      writeFileSync(join(salida, archivo), texto);
      const [fuente, ...resto] = grupo.split('-');
      ficheros.push({
        archivo, fuente: fuente.replace(/_\d+$/, ''), temporada: resto.join('-'), listas: p.listas, entradas: p.entradas,
        cargoBytes: p.cargo, bytes: Buffer.byteLength(texto), sha256: createHash('sha256').update(texto, 'utf8').digest('hex'),
      });
    });
  }

  const informe = {
    generado: new Date().toISOString(),
    dia: HOY,
    temporadaFieVigente: TEMPORADA_FIE,
    soloFilasVinculadas: !todas,
    personasConIdFie: indice.porFieId.size,
    fuentes: Object.fromEntries([...resumen.entries()].map(([f, r]) => [f, {
      listas: r.listas,
      listasYaCargadas: r.listasYaCargadas,
      temporadas: [...r.temporadas].sort(),
      filasPublicadas: r.filasPublicadas,
      filasVinculadas: r.filasVinculadas,
      tasaVinculo: r.filasPublicadas ? Math.round((r.filasVinculadas / r.filasPublicadas) * 1000) / 10 : 0,
      vinculoPorIdFie: r.porFieId,
      vinculoPorNombre: r.porNombre,
      personasDistintas: r.personas.size,
      motivosSinVinculo: r.motivos,
      filasCargadas: r.filasCargadas,
    }])),
    totalEntradas: ficheros.reduce((s, f) => s + f.entradas, 0),
    totalCargoBytes: ficheros.reduce((s, f) => s + f.cargoBytes, 0),
    ficheros,
  };
  writeFileSync(join(salida, 'informe.json'), `${JSON.stringify(informe, null, 2)}\n`);
  console.log(JSON.stringify({ ...informe, ficheros: `${ficheros.length} ficheros` }, null, 2));
  base.close();
}

// ------------------------------------------------------------ Comprobar ---

function comprobar() {
  const salida = resolve(arg('salida'));
  const rutaBase = resolve(arg('base'));
  const informe = JSON.parse(readFileSync(join(salida, 'informe.json'), 'utf8')) as { ficheros: { archivo: string; entradas: number; listas: number }[] };
  const db = new DatabaseSync(':memory:');
  db.exec(`ATTACH DATABASE 'file:${rutaBase.replace(/\\/g, '/')}?mode=ro' AS src`);
  db.exec('PRAGMA foreign_keys = OFF');
  const tablas = ['sport_person', 'sport_ranking_publication', 'sport_ranking_entry', 'sport_import_coverage', 'sport_competition', 'sport_edition',
    'sport_write_lease', 'sport_write_context', 'sport_write_charge', 'sport_capacity_ledger', 'athlete'];
  const ddl = db.prepare(`SELECT type, name, tbl_name, sql FROM src.sqlite_master WHERE sql IS NOT NULL AND (tbl_name IN (${tablas.map(() => '?').join(',')}) OR name = 'sport_write_authorized') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END`).all(...tablas) as { type: string; name: string; sql: string }[];
  for (const d of ddl.filter((x) => x.type === 'table')) db.exec(d.sql);
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
  try {
    db.exec(`INSERT INTO sport_ranking_publication(source,season,weapon,gender,category,category_raw,published_on) VALUES('x','x','ESPADA','M','ABS','x','2000-01-01')`);
    throw new Error('la guarda no bloqueó una escritura sin lease');
  } catch (e) {
    if ((e as Error).message.includes('guarda no bloqueó')) throw e;
  }
  const ledgerAntes = (db.prepare(`SELECT accounted_bytes AS a FROM sport_capacity_ledger`).get() as { a: number }).a;
  let ok = true;
  for (const f of informe.ficheros) {
    const cuenta = () => (db.prepare(`SELECT count(*) AS n FROM sport_ranking_entry`).get() as { n: number }).n;
    const antes = cuenta();
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
    const despues = cuenta();
    const owner = sql.match(/VALUES\('global','([0-9a-f-]{36})'/)?.[1];
    if (!owner) throw new Error(`${f.archivo}: sin cabecera de lease`);
    db.exec('BEGIN IMMEDIATE');
    db.exec(sql.replaceAll(owner, randomUUID()));
    db.exec('COMMIT');
    const reaplicado = cuenta();
    const bien = despues - antes === f.entradas && reaplicado === despues;
    ok &&= bien;
    console.log(`${bien ? 'OK' : 'DISTINTO'} ${f.archivo}: +${despues - antes} entradas (esperadas ${f.entradas}); re-aplicado +${reaplicado - despues}`);
  }
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  const abiertos = db.prepare(`SELECT (SELECT count(*) FROM sport_write_context) + (SELECT count(*) FROM sport_write_charge) AS n`).get() as { n: number };
  const ledger = db.prepare(`SELECT accounted_bytes AS a, blocked AS b FROM sport_capacity_ledger`).get() as { a: number; b: number };
  console.log(`foreign_key_check=${fk.length} contextosAbiertos=${abiertos.n} ledger=${ledger.a} (+${ledger.a - ledgerAntes}) bloqueado=${ledger.b}`);
  ok &&= fk.length === 0 && abiertos.n === 0 && ledger.b === 0;
  console.log(ok ? 'COMPROBACIÓN OK' : 'COMPROBACIÓN CON FALLOS');
  process.exitCode = ok ? 0 : 1;
}

// ------------------------------------------------------------ Principal ---

const DESCARGAS: Record<string, () => Promise<void>> = {
  fie: descargarFie,
  efc: descargarEfc,
  ffe: descargarFfe,
  fis: descargarFis,
  hkfa: descargarHkfa,
  mvsz: descargarMvsz,
};

async function descargar() {
  const pedidas = (arg('fuentes') || Object.keys(DESCARGAS).join(',')).split(',');
  for (const f of pedidas) {
    const fn = DESCARGAS[f];
    if (!fn) throw new Error(`fuente desconocida: ${f}`);
    console.log(`== ${f}`);
    await fn();
  }
}

try {
  if (bandera('descargar')) await descargar();
  else if (bandera('generar')) await generar();
  else if (bandera('comprobar')) comprobar();
  else {
    console.error('Modo: --descargar [--fuentes ...] | --generar --base <sqlite> --salida <dir> | --comprobar --base <sqlite> --salida <dir>');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exitCode = 1;
}
