/**
 * PDFs de clasificación 2017-18 recuperados de la web antigua de la RFEE
 * (`rfee-huecos-descargar.ts`) -> ficheros de hechos `rfee_pdf`.
 *
 * Dos lecturas por PDF:
 *  - el lector local de PDFs (`pdf-a-hechos.ts#lecturaAHechos`); sólo se
 *    aceptan sus pruebas `completo`: en estos PDFs, lo parcial son páginas de
 *    equipos leídas como individuales;
 *  - una lectura por columnas de la «Clasificación general final» /
 *    «Classement général» impresa por Engarde, para las pruebas que el lector
 *    no da por completas: la exportación en francés (TNR junior de Vitoria) y
 *    las páginas de equipos con componentes (Cto. de España senior).
 *
 * La fecha de la prueba es la de la cabecera del PDF si cae dentro de la fila
 * de `resultados.html`; si no, la de la fila. Se omiten las pruebas que la
 * base ya tiene con resultados (misma arma, género, categoría y formato a ±3
 * días, en una fuente nacional o en una prueba FIE celebrada en España), para
 * no duplicar lo que llegó por Engarde o la FIE. Sólo lee la base.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/rfee-huecos-a-hechos.ts \
 *     [--entrada <calendario-trabajo/rfee-huecos>] [--salida <calendario-trabajo/hechos>] [--db <nuevo.sqlite>]
 *
 * Escribe `<salida>/rfee-huecos/*.json` y `<salida>/rfee-huecos/_informe.json`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hechosPrueba, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { docIdDeUrl, extraerPaginas, sha256Hex } from '../../src/lib/ingest/sources/rfee-pdf/lectura';
import { leerResultadosPdf } from '../../src/lib/ingest/sources/rfee-pdf/resultados';
import type { ItemTexto, LecturaPdf, PaginaTexto } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { argumento, CARPETA_TRABAJO, NUEVO_POR_DEFECTO } from './comun';
import { lecturaAHechos, nombreUnico } from './pdf-a-hechos';
import { CARPETA_RFEE_HUECOS, type EntradaManifiesto, type ManifiestoHuecos } from './rfee-huecos-descargar';

const MARGEN_DIAS = 3;
const dia = (f: string): number => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/** PDFs recuperados que no se convierten, por clave de fichero (`claveFichero`). */
export const EXCLUIDOS: Record<string, string> = {
  'clasificacion criterium 2018.pdf':
    'Criterium M10/M12: no es una clasificación; agrupa por año de nacimiento con GANADOR/FINALISTA y el resto sin puesto, y el lector no atribuye el género en 18 de 25 secciones',
};

type Arma = HechosPrueba['competition']['weapon'];
type Genero = HechosPrueba['competition']['gender'];
type Categoria = HechosPrueba['competition']['category'];
type Formato = HechosPrueba['competition']['format'];

// ---------------------------------------------------------------------------
// Lectura por columnas de la clasificación general impresa por Engarde.

type Linea = { y: number; items: ItemTexto[]; texto: string };

function lineasDe(p: PaginaTexto): Linea[] {
  const ordenados = p.items.filter((i) => i.s.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const lineas: Linea[] = [];
  for (const it of ordenados) {
    const ultima = lineas.at(-1);
    if (ultima && Math.abs(ultima.y - it.y) <= 2) ultima.items.push(it);
    else lineas.push({ y: it.y, items: [it], texto: '' });
  }
  for (const l of lineas) {
    l.items.sort((a, b) => a.x - b.x);
    l.texto = l.items.map((i) => i.s.trim()).join(' ');
  }
  return lineas;
}

const MESES: Record<string, string> = {
  ene: '01', jan: '01', feb: '02', fev: '02', mar: '03', abr: '04', avr: '04', may: '05', mai: '05', jun: '06',
  jul: '07', ago: '08', aou: '08', sep: '09', oct: '10', nov: '11', dic: '12', dec: '12',
};

/** `22-ene-18` / `10-jun-18` -> ISO. */
export function fechaCabecera(texto: string): string | null {
  const m = texto
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/^(\d{1,2})[-/ ]([a-z]{3})[a-z]*\.?[-/ ](\d{2}|\d{4})$/);
  if (!m || !MESES[m[2]]) return null;
  const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${anio}-${MESES[m[2]]}-${m[1].padStart(2, '0')}`;
}

export function armaGenero(texto: string): { arma: Arma; genero: Genero } | null {
  const m = texto.toUpperCase().match(/\b(ESPADA|FLORETE|SABLE)\s+(FEMENIN[OA]|MASCULIN[OA])\b/);
  return m ? { arma: m[1] as Arma, genero: m[2].startsWith('F') ? 'F' : 'M' } : null;
}

export function categoriaDe(...textos: string[]): Categoria | null {
  for (const t of textos.map((x) => x.toUpperCase())) {
    if (/VETERAN/.test(t)) return 'VET';
    if (/JUNIOR|\bM-?20\b/.test(t)) return 'M20';
    if (/CADETE|\bM-?17\b/.test(t)) return 'M17';
    if (/SENIOR|ABSOLUT/.test(t)) return 'ABS';
  }
  return null;
}

export type FilaColumnas = { posicion: number; nombre: string; club: string | null; componentes: string[] };
export type SeccionColumnas = {
  paginas: number[];
  cabecera: string[];
  arma: Arma | null;
  genero: Genero | null;
  categoria: Categoria | null;
  formato: Formato | null;
  fecha: string | null;
  filas: FilaColumnas[];
  error: string | null;
};

const esPuesto = (s: string) => /^\d{1,3}$/.test(s.trim());
const TITULO_CLASIFICACION = /^(clasificaci[oó]n general final|classement g[eé]n[eé]ral)$/i;

/** Puestos 1..n con empates: cada puesto repite el anterior o es su índice. */
export function puestosCoherentes(p: readonly number[]): boolean {
  return p.length > 0 && p[0] === 1 && p.every((x, i) => i === 0 || x === p[i - 1] || x === i + 1);
}

function filasIndividuales(columnas: ItemTexto[], lineas: Linea[]): { filas: FilaColumnas[]; ignoradas: number } {
  const col = (re: RegExp) => columnas.find((c) => re.test(c.s.trim()));
  const nom = col(/^(apellido-nom|nom)$/i);
  const nombre = col(/^(nombre|pr[eé]nom)$/i);
  const club = col(/^(club|naci[oó]n|nation)$/i);
  const filas: FilaColumnas[] = [];
  let ignoradas = 0;
  for (const l of lineas) {
    const [primero, ...resto] = l.items;
    if (!primero || !esPuesto(primero.s) || resto.length === 0 || !nom) {
      if (l.items.length >= 3) ignoradas += 1;
      continue;
    }
    const celdas = new Map<ItemTexto, string[]>();
    for (const it of resto) {
      // Engarde alinea cada celda a la izquierda de su columna: se asigna a la cabecera más próxima.
      const destino = [nom, nombre, club].filter((c): c is ItemTexto => !!c).sort((a, b) => Math.abs(a.x - it.x) - Math.abs(b.x - it.x))[0];
      celdas.set(destino, [...(celdas.get(destino) ?? []), it.s.trim()]);
    }
    const n = [...(celdas.get(nom) ?? []), ...(nombre ? celdas.get(nombre) ?? [] : [])].join(' ').trim();
    if (!n) { ignoradas += 1; continue; }
    filas.push({ posicion: Number(primero.s), nombre: n, club: club ? (celdas.get(club) ?? []).join(' ').trim() || null : null, componentes: [] });
  }
  return { filas, ignoradas };
}

function filasEquipos(columnas: ItemTexto[], lineas: Linea[]): { filas: FilaColumnas[]; ignoradas: number; error: string | null } {
  // La cabecera «Club» va centrada: el club de cada componente empieza ~20 pt a su izquierda.
  const clubX = columnas.find((c) => /^club$/i.test(c.s.trim()))?.x ?? Infinity;
  const items = lineas.flatMap((l) => l.items);
  const textos = items.filter((i) => !esPuesto(i.s) && i.x < clubX - 30);
  if (textos.length === 0) return { filas: [], ignoradas: 0, error: 'sin_filas' };
  const equipoX = Math.min(...textos.map((i) => i.x));
  const conComponentes = textos.some((i) => i.x > equipoX + 4);
  const filas: FilaColumnas[] = [];
  let ignoradas = 0;
  if (!conComponentes) {
    // «Rg | Nom»: puesto y equipo en la misma línea.
    for (const l of lineas) {
      const [primero, ...resto] = l.items;
      if (!primero || !esPuesto(primero.s) || resto.length === 0) { ignoradas += 1; continue; }
      filas.push({ posicion: Number(primero.s), nombre: resto.map((i) => i.s.trim()).join(' '), club: null, componentes: [] });
    }
    return { filas, ignoradas, error: null };
  }
  // Bloques: equipo en la columna izquierda, componentes sangrados y el puesto a la izquierda,
  // a media altura del bloque (puede caer en la línea de un componente).
  const orden = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  let actual: (FilaColumnas & { conPuesto: boolean }) | null = null;
  const bloques: (FilaColumnas & { conPuesto: boolean })[] = [];
  for (const it of orden) {
    if (it.x >= clubX - 30) continue;
    if (esPuesto(it.s) && it.x < equipoX) {
      if (!actual || actual.conPuesto) return { filas: [], ignoradas, error: 'puesto_sin_equipo' };
      actual.posicion = Number(it.s);
      actual.conPuesto = true;
    } else if (Math.abs(it.x - equipoX) <= 3) {
      actual = { posicion: 0, nombre: it.s.trim(), club: null, componentes: [], conPuesto: false };
      bloques.push(actual);
    } else if (actual) actual.componentes.push(it.s.trim());
    else ignoradas += 1;
  }
  if (bloques.some((b) => !b.conPuesto)) return { filas: [], ignoradas, error: 'equipo_sin_puesto' };
  return { filas: bloques.map(({ conPuesto: _, ...b }) => b), ignoradas, error: null };
}

/** Secciones «Clasificación general final» / «Classement général»; continúan en páginas siguientes hasta la próxima cabecera. */
export function seccionesColumnas(paginas: readonly PaginaTexto[]): SeccionColumnas[] {
  type Abierta = { s: SeccionColumnas; columnas: ItemTexto[] | null; lineas: Linea[] };
  const abiertas: Abierta[] = [];
  for (const p of paginas) {
    const ls = lineasDe(p);
    for (let i = 0; i < ls.length; i += 1) {
      const l = ls[i];
      const actual = abiertas.at(-1);
      if (TITULO_CLASIFICACION.test(l.texto)) {
        // La cabecera son las líneas pegadas encima (10-15 pt entre sí según la plantilla; hasta 35 pt
        // hasta el título de la clasificación). Una fila con puesto ya es de la sección anterior.
        const cabecera: string[] = [];
        let y = l.y;
        for (let j = i - 1; j >= 0 && cabecera.length < 5; j -= 1) {
          if (ls[j].y - y > (cabecera.length === 0 ? 40 : 16) || esPuesto(ls[j].items[0]?.s ?? '')) break;
          cabecera.unshift(ls[j].texto);
          y = ls[j].y;
        }
        if (actual) actual.lineas.splice(actual.lineas.length - cabecera.length, cabecera.length);
        const ag = cabecera.map(armaGenero).find((x) => x) ?? null;
        abiertas.push({
          s: {
            paginas: [p.numero], cabecera, arma: ag?.arma ?? null, genero: ag?.genero ?? null, categoria: null, formato: null,
            fecha: cabecera.map(fechaCabecera).find((x) => x) ?? null, filas: [], error: null,
          },
          columnas: null,
          lineas: [],
        });
        continue;
      }
      if (!actual) continue;
      if (!actual.s.paginas.includes(p.numero)) actual.s.paginas.push(p.numero);
      if (!actual.columnas && /^(cl\.|rg)$/i.test(l.items[0]?.s.trim() ?? '')) actual.columnas = l.items;
      else if (actual.columnas) actual.lineas.push(l);
    }
  }
  return abiertas.map(({ s, columnas, lineas }) => {
    if (!columnas) return { ...s, error: 'sin_cabecera_de_columnas' };
    const individual = columnas.some((c) => /^(nombre|pr[eé]nom)$/i.test(c.s.trim()));
    const r = individual ? { ...filasIndividuales(columnas, lineas), error: null } : filasEquipos(columnas, lineas);
    const error = r.error ?? (r.ignoradas > 0 ? `lineas_no_reconocidas:${r.ignoradas}` : !puestosCoherentes(r.filas.map((f) => f.posicion)) ? 'puestos_incoherentes' : null);
    return { ...s, formato: individual ? 'INDIVIDUAL' : 'EQUIPOS', filas: r.filas, error };
  });
}

// ---------------------------------------------------------------------------

export type CompeticionBase = {
  source: string;
  key: string;
  weapon: string;
  gender: string;
  category: string;
  format: string;
  date: string;
  country: string | null;
  results: number;
};

/**
 * Competición ya cargada (con resultados) que cubre la misma prueba; nunca la
 * propia clave de este productor. De la FIE sólo cuentan las pruebas en España:
 * a ±3 días hay campeonatos continentales con las mismas armas.
 */
export function yaEnBase(c: Pick<HechosPrueba['competition'], 'competitionKey' | 'weapon' | 'gender' | 'category' | 'format' | 'date'>, base: readonly CompeticionBase[]): CompeticionBase | null {
  if (!c.date) return null;
  const d = dia(c.date);
  return (
    base.find(
      (b) =>
        b.results > 0 &&
        b.key !== c.competitionKey &&
        (b.source !== 'fie' || b.country === 'ESP') &&
        b.weapon === c.weapon &&
        b.category === c.category &&
        b.format === c.format &&
        (b.gender === c.gender || b.gender === 'MIXTO' || c.gender === 'MIXTO') &&
        Math.abs(dia(b.date) - d) <= MARGEN_DIAS,
    ) ?? null
  );
}

/** La fecha impresa sólo vale dentro de la fila de la página de resultados (los PDFs de Vitoria imprimen el lunes siguiente). */
export function fechaPrueba(delPdf: string | null, inicio: string, fin: string): { fecha: string; nota: string | null } {
  if (delPdf && delPdf >= inicio && delPdf <= fin) return { fecha: delPdf, nota: null };
  return {
    fecha: inicio,
    nota: delPdf ? `Fecha impresa ${delPdf} fuera de la ficha RFEE (${inicio}..${fin}); se usa ${inicio}` : `PDF sin fecha; se usa la de la ficha RFEE (${inicio})`,
  };
}

async function leerBase(ruta: string): Promise<CompeticionBase[]> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(ruta, { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT c.source, c.competition_key key, c.weapon, c.gender, c.category, c.format,
                coalesce(c.competition_date, e.start_date) date, e.country_code country,
                (SELECT count(*) FROM sport_result r WHERE r.competition_id = c.id) results
           FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
          WHERE coalesce(c.competition_date, e.start_date) BETWEEN '2017-08-01' AND '2018-09-30'`,
      )
      .all() as CompeticionBase[];
  } finally {
    db.close();
  }
}

type InformePdf = {
  fichero: string;
  url: string;
  original: string;
  filas: string[];
  emitidas: { competitionKey: string; prueba: string; lectura: string; fecha: string | null; resultados: number; notas: string[] }[];
  omitidasYaEnBase: { prueba: string; fecha: string | null; resultados: number; en: string }[];
  descartadas: { clave: string; motivo: string }[];
  avisos: string[];
  error: string | null;
};

const etiqueta = (c: Pick<HechosPrueba['competition'], 'weapon' | 'gender' | 'category' | 'format' | 'categoryRaw'>) =>
  `${c.weapon} ${c.gender} ${c.category} ${c.format}${c.categoryRaw && c.categoryRaw !== c.category ? ` (${c.categoryRaw})` : ''}`;

const claveTipo = (c: { weapon: string; gender: string; format: string }) => `${c.weapon}|${c.gender}|${c.format}`;

function hechosDeSeccion(s: SeccionColumnas, idx: number, ctx: { url: string; docId: string; sha: string; season: string; titulo: string; categoriaFila: string }): HechosPrueba | { motivo: string } {
  if (s.error) return { motivo: s.error };
  const categoria = categoriaDe(...s.cabecera) ?? categoriaDe(ctx.titulo, ctx.categoriaFila);
  if (!s.arma || !s.genero || !s.formato || !categoria) return { motivo: 'cabecera_incompleta' };
  const clave = `cg${idx + 1}:${s.arma}:${s.genero}:${s.formato}:${categoria}`;
  const prefijo = `${ctx.docId}:${clave}:`;
  return hechosPrueba.parse({
    version: 1,
    source: 'rfee_pdf',
    extractor: 'lector_pdf_columnas',
    sourceUrl: ctx.url,
    sourceSha256: ctx.sha,
    edition: { season: ctx.season, tournamentKey: `pdf:${ctx.docId}`, name: ctx.titulo, startDate: null, endDate: null, city: null, countryCode: null },
    competition: {
      competitionKey: `pdf:${ctx.docId}:${clave}`,
      weapon: s.arma, gender: s.genero, category: categoria, categoryRaw: s.cabecera.find((l) => categoriaDe(l)) ?? null,
      format: s.formato, date: s.fecha,
    },
    status: {
      results: 'completo', pools: 'sin_resultados', tableau: 'sin_resultados', publishedParticipants: s.filas.length,
      notes: [
        'Lectura por columnas de la clasificación general impresa por Engarde',
        `Cabecera: ${s.cabecera.join(' / ')}`,
        `Páginas: ${s.paginas.join(',')}`,
        ...(s.formato === 'EQUIPOS' && s.filas.some((f) => f.componentes.length)
          ? [`Componentes: ${s.filas.map((f) => `${f.nombre} (${f.componentes.join(', ')})`).join('; ')}`]
          : []),
      ],
    },
    results: s.filas.map((f, i) => ({
      factKey: `${prefijo}p${String(i + 1).padStart(4, '0')}`,
      name: f.nombre, countryCode: null, club: f.club, position: f.posicion, positionRaw: null,
      points: null, fieId: null, license: null, birthYear: null,
    })),
    bouts: [],
  });
}

async function main(): Promise<void> {
  const entrada = resolve(argumento('entrada', CARPETA_RFEE_HUECOS));
  const salida = resolve(argumento('salida', join(CARPETA_TRABAJO, 'hechos')));
  const rutaDb = resolve(argumento('db', NUEVO_POR_DEFECTO));
  const dir = join(salida, 'rfee-huecos');
  mkdirSync(dir, { recursive: true });
  const manifiesto = JSON.parse(readFileSync(join(entrada, 'manifiesto.json'), 'utf8')) as ManifiestoHuecos;
  const base = existsSync(rutaDb) ? await leerBase(rutaDb) : [];
  if (!base.length) throw new Error(`Sin competiciones de 2017-18 en ${rutaDb}: no se puede deduplicar`);

  const porFichero = new Map<string, EntradaManifiesto[]>();
  for (const e of manifiesto.entradas) if (e.fichero) porFichero.set(e.fichero, [...(porFichero.get(e.fichero) ?? []), e]);

  const informes: InformePdf[] = [];
  const usados = new Set<string>();
  const totales = { pdfs: porFichero.size, excluidos: 0, competiciones: 0, resultados: 0, omitidasYaEnBase: 0, descartadas: 0 };
  for (const [fichero, filas] of [...porFichero.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const e0 = filas[0];
    const inicio = filas.map((f) => f.inicio).sort()[0];
    const fin = filas.map((f) => f.fin).sort().at(-1)!;
    const inf: InformePdf = {
      fichero, url: e0.url!, original: e0.captura!.original,
      filas: filas.map((f) => `${f.inicio}..${f.fin} ${f.nombre} (${f.sede}) ${[f.arma, f.categoria, f.sexo, f.modalidad].filter(Boolean).join(' ')}`),
      emitidas: [], omitidasYaEnBase: [], descartadas: [], avisos: [], error: null,
    };
    informes.push(inf);
    if (EXCLUIDOS[e0.clave]) {
      inf.error = `excluido: ${EXCLUIDOS[e0.clave]}`;
      totales.excluidos += 1;
      continue;
    }
    try {
      const bytes = new Uint8Array(readFileSync(join(entrada, 'raw', 'pdfs', fichero)));
      const sha = await sha256Hex(bytes);
      if (sha !== e0.sha256) throw new Error('hash_distinto_del_manifiesto');
      const docId = docIdDeUrl(e0.url!);
      const { paginas, perfil } = await extraerPaginas(bytes);
      const lectura: LecturaPdf = { ...leerResultadosPdf(paginas, { url: e0.url!, docId }), sha256: sha, perfil };
      const conv = lecturaAHechos(lectura, e0.temporada, null);
      inf.avisos.push(...conv.avisos);
      inf.descartadas.push(...conv.descartadas.map((d) => ({ clave: d.clave, motivo: d.motivo })));

      const candidatos: { h: HechosPrueba; lectura: string }[] = [];
      for (const h of conv.hechos) {
        if (h.status.results !== 'completo') inf.descartadas.push({ clave: h.competition.competitionKey, motivo: `lector_${h.status.results}:${etiqueta(h.competition)} n=${h.results.length}` });
        else candidatos.push({ h, lectura: 'lector_pdf' });
      }
      const cubiertos = new Set(candidatos.map((c) => claveTipo(c.h.competition)));
      const tituloEdicion = candidatos[0]?.h.edition.name ?? e0.nombre;
      for (const [i, s] of seccionesColumnas(paginas).entries()) {
        if (s.arma && s.genero && s.formato && cubiertos.has(claveTipo({ weapon: s.arma, gender: s.genero, format: s.formato }))) continue;
        const r = hechosDeSeccion(s, i, { url: e0.url!, docId, sha, season: e0.temporada, titulo: tituloEdicion, categoriaFila: e0.categoria });
        if ('motivo' in r) inf.descartadas.push({ clave: `columnas:${i + 1}:${s.cabecera.join(' / ')}`, motivo: r.motivo });
        else candidatos.push({ h: r, lectura: 'columnas' });
      }

      const listos = candidatos.map(({ h, lectura }) => {
        const { fecha, nota } = fechaPrueba(h.competition.date, inicio, fin);
        const notas = [...h.status.notes, `Web antigua RFEE (resultados.html, temporada 17/18): ${e0.captura!.original}`];
        if (nota) notas.push(nota);
        return { h: { ...h, competition: { ...h.competition, date: fecha }, status: { ...h.status, notes: notas } }, lectura };
      });
      const fechas = listos.map((x) => x.h.competition.date!).sort();
      const edicion = { startDate: fechas[0] ?? inicio, endDate: fechas.at(-1) ?? fin, city: e0.sede || null, name: tituloEdicion };
      for (const { h, lectura } of listos) {
        const previa = yaEnBase(h.competition, base);
        if (previa) {
          inf.omitidasYaEnBase.push({ prueba: etiqueta(h.competition), fecha: h.competition.date, resultados: h.results.length, en: `${previa.source}|${previa.key}|${previa.date}|n=${previa.results}` });
          totales.omitidasYaEnBase += 1;
          continue;
        }
        const final = hechosPrueba.parse({ ...h, edition: { ...h.edition, ...edicion } });
        writeFileSync(join(dir, nombreUnico(final, usados)), JSON.stringify(final, null, 1), 'utf8');
        inf.emitidas.push({
          competitionKey: final.competition.competitionKey, prueba: etiqueta(final.competition), lectura, fecha: final.competition.date,
          resultados: final.results.length,
          notas: final.status.notes.filter((n) => !/^(Páginas|Web antigua|Componentes|poules|cuadro):?/.test(n)),
        });
        totales.competiciones += 1;
        totales.resultados += final.results.length;
      }
      totales.descartadas += inf.descartadas.length;
    } catch (e) {
      inf.error = e instanceof Error ? e.message : String(e);
    }
  }
  for (const f of readdirSync(dir)) if (f.endsWith('.json') && !f.startsWith('_') && !usados.has(f)) unlinkSync(join(dir, f));

  const sinPdf = new Map<string, { clave: string; motivo: string; filas: string[] }>();
  for (const e of manifiesto.entradas) {
    if (e.fichero) continue;
    const x = sinPdf.get(e.clave) ?? { clave: e.clave, motivo: e.error ?? 'desconocido', filas: [] };
    x.filas.push(`${e.inicio} ${e.nombre} (${e.sede})`);
    sinPdf.set(e.clave, x);
  }
  const informe = { generadoEn: new Date().toISOString(), entrada, db: rutaDb, totales, pdfs: informes, sinPdf: [...sinPdf.values()] };
  const ruta = join(dir, '_informe.json');
  writeFileSync(`${ruta}.part`, JSON.stringify(informe, null, 1), 'utf8');
  renameSync(`${ruta}.part`, ruta);
  console.log(JSON.stringify(totales));
  for (const i of informes) {
    console.log(`${i.fichero}${i.error ? ` ERROR ${i.error}` : ''}`);
    for (const x of i.emitidas) console.log(`  + ${x.prueba} ${x.fecha} n=${x.resultados} [${x.lectura}]${x.notas.length ? ` ${x.notas.join(' | ')}` : ''}`);
    for (const x of i.omitidasYaEnBase) console.log(`  = ${x.prueba} ${x.fecha} n=${x.resultados} ya en ${x.en}`);
    for (const x of i.descartadas) console.log(`  - ${x.clave.replace(/url-[0-9a-f]{64}/, 'url-…')}: ${x.motivo}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
