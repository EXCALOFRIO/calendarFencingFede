/**
 * Asaltos de pruebas FIE individuales sin poules o sin cuadro desde
 * exportaciones HTML de Engarde archivadas en la Wayback Machine:
 *
 * - resultados en directo de la propia FIE: `fie.ch/External_Data/resultats/`
 *   (Mundiales de San Petersburgo 2007 y júnior-cadete de Belek 2007),
 *   `live.fie.ch/resultats/` (júnior-cadete de Acireale 2008) y
 *   `live.fie.ch/antalya/resultats/` (Mundiales de Antalya 2009);
 * - las exportaciones estáticas `engarde-service.com/files/<org>/<evt>/<prueba>/`
 *   que el servidor ya no sirve (Mundiales de Budapest 2013, júnior-cadete de
 *   Poreč 2013, Europeos júnior-cadete de Budapest 2013, Copas del Mundo...).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-fie-engarde-wayback.ts descargar
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-fie-engarde-wayback.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * `descargar` lista con el CDX las capturas 200 de esos prefijos, agrupa por
 * carpeta de prueba y, en las que tienen clasificación y poules o cuadro, baja
 * la última captura de la clasificación, las poules y los cuadros. `hechos`
 * trabaja sólo con la caché: cada carpeta se casa con la prueba FIE de su
 * arma, género y categoría (del código de carpeta o del título), fecha a ±7
 * días y al menos la mitad de la clasificación en común (y 15 puntos más que
 * la siguiente candidata); los asaltos llevan los `factKey` de la clasificación
 * guardada y sólo se escriben las fases que la base no tiene.
 *
 * Validación: poules con TD y TR de la tabla reproducidos (lector de Engarde);
 * cuadro coherente y conforme a los puestos oficiales (final = 1.º y 2.º,
 * semifinales = 3.º, perdedor de la ronda de N entre N/2+1 y N); marcadores
 * imposibles fuera. Lo que no cumple queda en el informe con su motivo.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import type { HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { parsearPaginaEngarde, puestosDeEngarde } from '../../src/lib/ingest/sources/engarde';
import {
  armaDeTitulo, cabeceraDocumento, categoriasDeTitulo, decodificarHtml, esEquiposDeTitulo, generoDeTitulo, normalizarClasificacionAntigua,
  normalizarCuadroAntiguo,
} from '../../src/lib/ingest/sources/engarde-antiguo';
import { parsearCuadroEngarde } from '../../src/lib/ingest/sources/engarde-cuadro';
import { parsearPoulesEngarde } from '../../src/lib/ingest/sources/engarde-poules';
import { argumento } from './comun';
import { hechosBase, solape } from './fie-completar-otras';
import { anadirAsaltos } from './fie-huecos-asaltos';
import { parsearCuadroArbol } from './lote10-fie-engarde-arbol';
import {
  abrirBase, corregirRondasPorPuestos, cuadroContraClasificacion, escribirHechos, hechosAsaltos, HOY, mapaPuestos, pruebasFie, puestosDeBase, type PruebaBase,
} from './lote10-fie-comun';
import { CACHE_LOTE10_FIE, cdx, enCache, NUEVO9, obtener, salidaLote10Fie, sha256, urlWayback } from './lote10-fie-red';

type Arma = HechosPrueba['competition']['weapon'];
type Genero = HechosPrueba['competition']['gender'];
type Categoria = HechosPrueba['competition']['category'];
type Lectura = Parameters<typeof anadirAsaltos>[1];
type BoutLeido = NonNullable<Lectura['poules']>['bouts'][number];

const MANIFIESTO = join(CACHE_LOTE10_FIE, 'engarde-wayback-manifiesto.json');
const INFORME = join(CACHE_LOTE10_FIE, 'engarde-wayback-informe.json');

/** Prefijos de la Wayback con exportaciones de Engarde de pruebas FIE. */
export const PREFIJOS: { prefijo: string; hasta: string; descripcion: string }[] = [
  { prefijo: 'live.fie.ch/', hasta: '2012', descripcion: 'resultados en directo de la FIE (live.fie.ch)' },
  { prefijo: 'fie.ch/External_Data/resultats/', hasta: '2012', descripcion: 'resultados en directo de la FIE (fie.ch/External_Data)' },
  { prefijo: 'fie.ch/External%5FData/resultats/', hasta: '2012', descripcion: 'resultados en directo de la FIE (fie.ch/External_Data)' },
  { prefijo: 'engarde-service.com/files/', hasta: '2019', descripcion: 'exportación estática de Engarde (engarde-service.com/files)' },
];

// ---------------------------------------------------------------------------
// Carpetas y documentos
// ---------------------------------------------------------------------------

export type TipoDoc = 'clasificacion' | 'poules' | 'cuadro';

/** Tipo de documento de una exportación de Engarde por su nombre (decodificado y en minúsculas). */
export function tipoDoc(fichero: string): TipoDoc | null {
  const f = decodeURIComponent(fichero).toLowerCase().replace(/\s+/g, '');
  if (/^(clasfinal|clasgeneral)\.html?$/.test(f)) return 'clasificacion';
  if (/^poules\d{0,2}\.html?$/.test(f)) return 'poules';
  // Cuadro principal: `tableau.htm`, `tableau64.htm`, `tableau_a64.htm`, `tableaude128.htm`, `tableauprelim.htm`,
  // `tableaufinal.htm`; los `tableau_b8`, `tableau_c4`... son cuadros de puestos.
  if (/^tableau(_a\d+|\d+|de\d+|prelim|final)?\.html?$/.test(f)) return 'cuadro';
  return null;
}

/** Número de ronda de poules por el nombre: `poules.htm` y `poules1.htm` → 1. */
export const vueltaPoules = (fichero: string) => Number(/(\d+)\.html?$/i.exec(fichero)?.[1] ?? '1') || 1;

export type Carpeta = { clave: string; documentos: { fichero: string; tipo: TipoDoc; timestamp: string; original: string }[] };

/** Clave de carpeta normalizada (sin esquema, `www.`, puerto ni mayúsculas; `%5F` → `_`). */
export function claveCarpeta(original: string): { carpeta: string; fichero: string } | null {
  const u = original.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/:80\//, '/').replace(/%5F/gi, '_').replace(/\?.*$/, '');
  const i = u.lastIndexOf('/');
  if (i < 0) return null;
  return { carpeta: u.slice(0, i + 1).toLowerCase(), fichero: u.slice(i + 1) };
}

const segundos = (ts: string) => Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12)) / 1000;
/** Dos capturas de una carpeta separadas por más de esto son de pruebas distintas (la FIE reutilizaba `ef-in/`...). */
const HUECO_ENTRE_PRUEBAS = 20 * 86_400;

/**
 * Carpetas de prueba con su clasificación y sus poules o cuadros. Una misma
 * carpeta de resultados en directo se reutilizó en campeonatos distintos: las
 * capturas se parten en tandas separadas por más de 20 días y cada tanda es
 * una prueba (clave `<carpeta>@<primera captura>`), con la última captura de
 * cada documento dentro de la tanda.
 */
export function agruparCapturas(capturas: readonly { timestamp: string; original: string }[]): Carpeta[] {
  const porCarpeta = new Map<string, { fichero: string; tipo: TipoDoc; timestamp: string; original: string }[]>();
  for (const c of capturas) {
    const k = claveCarpeta(c.original);
    if (!k || !k.fichero) continue;
    const tipo = tipoDoc(k.fichero);
    if (!tipo) continue;
    (porCarpeta.get(k.carpeta) ?? porCarpeta.set(k.carpeta, []).get(k.carpeta)!).push({ fichero: k.fichero, tipo, timestamp: c.timestamp, original: c.original });
  }
  const salida: Carpeta[] = [];
  for (const [carpeta, todas] of porCarpeta) {
    todas.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    const tandas: (typeof todas)[] = [];
    for (const c of todas) {
      const ultima = tandas[tandas.length - 1];
      if (ultima && segundos(c.timestamp) - segundos(ultima[ultima.length - 1].timestamp) <= HUECO_ENTRE_PRUEBAS) ultima.push(c);
      else tandas.push([c]);
    }
    for (const t of tandas) {
      const docs = new Map<string, Carpeta['documentos'][number]>();
      // La última captura de la tanda es la del estado final de la prueba.
      for (const c of t) docs.set(decodeURIComponent(c.fichero).toLowerCase(), c);
      const documentos = [...docs.values()];
      if (!documentos.some((d) => d.tipo === 'clasificacion') || !documentos.some((d) => d.tipo !== 'clasificacion')) continue;
      salida.push({ clave: tandas.length > 1 ? `${carpeta}@${t[0].timestamp.slice(0, 8)}` : carpeta, documentos });
    }
  }
  return salida;
}

/**
 * Título y líneas de cabecera de un documento de Engarde sin la fecha (cada
 * documento lleva la de su fase), para comprobar que todos son de la misma prueba.
 */
export function firmaCabecera(html: string): string {
  const c = cabeceraDocumento(html);
  return [c.titulo ?? '', ...c.lineas.filter((l) => !fechaCabecera([l]))].join(' | ')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\x20-\x7e]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Atributos de la prueba
// ---------------------------------------------------------------------------

export type Atributos = { arma: Arma | null; genero: Genero | null; categoria: Categoria | null; equipos: boolean };

/**
 * Atributos del código de carpeta de Engarde: arma (e/f/s), sexo (f/m/h) y
 * categoría opcional (c, j, s) y modalidad (`-in`, `-eq`): `efj-in`, `ems-eq`,
 * `EFC-AUX`, `ef-in` (sin categoría: absoluta en un Mundial absoluto).
 */
export function atributosDeCodigo(codigo: string): Atributos | null {
  const m = /^([efs])([fmh])([cjs])?(?:[-_](in|eq|aux))?$/i.exec(codigo.trim());
  if (!m) return null;
  const arma: Arma = m[1].toLowerCase() === 'e' ? 'ESPADA' : m[1].toLowerCase() === 'f' ? 'FLORETE' : 'SABLE';
  const genero: Genero = m[2].toLowerCase() === 'f' ? 'F' : 'M';
  const c = m[3]?.toLowerCase();
  const categoria: Categoria | null = c === 'c' ? 'M17' : c === 'j' ? 'M20' : c === 's' ? 'ABS' : null;
  return { arma, genero, categoria, equipos: m[4]?.toLowerCase() === 'eq' };
}

export function atributosDeCabecera(titulo: string, lineas: readonly string[]): Atributos {
  const t = [titulo, ...lineas].join(' ');
  const cats = categoriasDeTitulo(t).filter((c: Categoria) => c === 'M17' || c === 'M20' || c === 'ABS');
  return { arma: armaDeTitulo(t), genero: generoDeTitulo(t), categoria: cats.length === 1 ? cats[0] : null, equipos: esEquiposDeTitulo(t) };
}

const MESES: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Fecha de una línea de cabecera de Engarde: «Le 10 avril 2008», «14 avril 2007», «April 10, 2008». */
export function fechaCabecera(lineas: readonly string[]): string | null {
  for (const l of [...lineas].reverse()) {
    const t = l.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const m = /(\d{1,2})(?:er)?\s+([a-z]+)\s+(\d{4})/.exec(t) ?? null;
    const n = m ? null : /([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(t);
    const dia = m ? Number(m[1]) : n ? Number(n[2]) : null;
    const mes = m ? MESES[m[2]] : n ? MESES[n[1]] : undefined;
    const anio = m ? Number(m[3]) : n ? Number(n[3]) : null;
    if (dia && mes && anio && dia <= 31) return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lectura de una carpeta
// ---------------------------------------------------------------------------

export type Pagina = { fichero: string; tipo: TipoDoc; url: string; html: string; sha: string };

const sumar = (m: Record<string, number>, k: string, n = 1) => (m[k] = (m[k] ?? 0) + n);

/** Poules, cuadro y clasificación de las páginas de una carpeta, con nombres y naciones de la fuente. */
export function leerCarpeta(paginas: readonly Pagina[]): Lectura & { clasificacion: { nombre: string; pais: string | null; puesto: number | null }[] } {
  const naciones = new Map<string, string | null>();
  const nacion = (club: string | null) => (club && /^[A-Z]{3}$/.test(club.trim()) ? club.trim() : null);
  const clasificacion: { nombre: string; pais: string | null; puesto: number | null }[] = [];
  for (const p of paginas.filter((x) => x.tipo === 'clasificacion')) {
    const pagina = parsearPaginaEngarde(normalizarClasificacionAntigua(p.html));
    if (!pagina.tipo.startsWith('clasificacion')) continue;
    const filas = puestosDeEngarde(pagina);
    if (filas.length <= clasificacion.length) continue;
    clasificacion.length = 0;
    for (const x of filas) clasificacion.push({ nombre: x.nombre, pais: x.pais && /^[A-Z]{3}$/.test(x.pais) ? x.pais : null, puesto: x.posicion });
  }
  for (const c of clasificacion) naciones.set(normalizeSportName(c.nombre), c.pais);

  let poules: Lectura['poules'] = null;
  for (const p of paginas.filter((x) => x.tipo === 'poules')) {
    const r = parsearPoulesEngarde(p.html, { pagina: vueltaPoules(p.fichero) });
    if (r.estado !== 'leido') continue;
    poules ??= { bouts: [], esperados: 0, descartados: {} };
    poules.esperados += r.esperados;
    for (const [k, n] of Object.entries(r.excluidos)) if (n) sumar(poules.descartados, k, n);
    for (const t of r.tiradores) if (!naciones.has(normalizeSportName(t.nombre))) naciones.set(normalizeSportName(t.nombre), nacion(t.club));
    for (const b of r.asaltos) {
      poules.bouts.push({
        phase: 'POULE', roundKey: b.ronda,
        a: { nombre: b.a.nombre, pais: nacion(b.a.club) }, b: { nombre: b.b.nombre, pais: nacion(b.b.club) },
        scoreA: b.a.tocados, scoreB: b.b.tocados, winner: b.a.tocados === b.b.tocados ? b.ganador : null,
      });
    }
  }

  const cruces = new Map<string, BoutLeido>();
  const descartados: Record<string, number> = {};
  let esperados = 0;
  let completo = false;
  for (const p of paginas.filter((x) => x.tipo === 'cuadro')) {
    const moderno = parsearCuadroEngarde(normalizarCuadroAntiguo(p.html), { individual: true });
    const lista: { ronda: string; nombreA: string; puntosA: number; nombreB: string; puntosB: number }[] = [];
    if (moderno.estado === 'leido' && moderno.asaltos.length > 0) {
      const ronda = (r: string) => (r === 'SF' ? 'A4' : r === 'F' ? 'A2' : r.replace(/^T(\d+)$/, 'A$1'));
      for (const b of moderno.asaltos) lista.push({ ...b, ronda: ronda(b.ronda) });
      esperados += moderno.asaltos.length;
      if (moderno.completo) completo = true;
    } else {
      const a = parsearCuadroArbol(p.html);
      if (a.estado !== 'leido') continue;
      lista.push(...a.cruces);
      esperados += a.esperados;
      for (const [k, n] of Object.entries(a.excluidos)) sumar(descartados, k, n);
      if (a.completo) completo = true;
    }
    for (const b of lista) {
      if (!/^A\d+$/.test(b.ronda)) continue;
      const clave = `${b.ronda}|${[normalizeSportName(b.nombreA), normalizeSportName(b.nombreB)].sort().join('|')}`;
      if (cruces.has(clave)) {
        esperados -= 1;
        continue;
      }
      const max = Math.max(b.puntosA, b.puntosB);
      if (b.puntosA === b.puntosB || max > 15 || Math.min(b.puntosA, b.puntosB) < 0) {
        sumar(descartados, 'marcador_imposible');
        continue;
      }
      cruces.set(clave, {
        phase: 'TABLEAU', roundKey: b.ronda,
        a: { nombre: b.nombreA, pais: naciones.get(normalizeSportName(b.nombreA)) ?? null },
        b: { nombre: b.nombreB, pais: naciones.get(normalizeSportName(b.nombreB)) ?? null },
        scoreA: b.puntosA, scoreB: b.puntosB, winner: null,
      });
    }
  }
  const cuadro: Lectura['cuadro'] = cruces.size ? { bouts: [...cruces.values()], esperados, completo, descartados } : null;
  const puestos = clasificacion.filter((c) => c.puesto !== null).map((c) => ({ t: { nombre: c.nombre, pais: c.pais }, puesto: c.puesto! }));
  return { arma: null, genero: null, puestos, poules, cuadro, clasificacion };
}

// ---------------------------------------------------------------------------
// Órdenes
// ---------------------------------------------------------------------------

type Manifiesto = { generado: string; carpetas: (Carpeta & { prefijo: string })[] };

const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);

type Candidata = { p: PruebaBase; puestos: ReturnType<typeof puestosDeBase>; s: number };
type Casamiento = { ok: true; mejor: Candidata; lectura: ReturnType<typeof leerCarpeta> } | { ok: false; motivo: string };

/** Prueba FIE de una carpeta: arma, género y categoría, fecha a ±7 días y ≥50 % de la clasificación en común. */
function casarCarpeta(
  db: ReturnType<typeof abrirBase>,
  todas: readonly PruebaBase[],
  clave: string,
  paginas: readonly Pagina[],
): Casamiento {
  const clas = paginas.find((p) => p.tipo === 'clasificacion');
  if (!clas) return { ok: false, motivo: 'clasificacion_no_descargada' };
  const cab = cabeceraDocumento(clas.html);
  const codigo = clave.replace(/@\d+$/, '').replace(/\/$/, '').split('/').pop() ?? '';
  const deCodigo = atributosDeCodigo(codigo);
  const deCab = atributosDeCabecera(cab.titulo ?? '', cab.lineas);
  const at: Atributos = {
    arma: deCodigo?.arma ?? deCab.arma, genero: deCodigo?.genero ?? deCab.genero,
    categoria: deCodigo?.categoria ?? deCab.categoria, equipos: deCodigo ? deCodigo.equipos : deCab.equipos,
  };
  if (at.equipos) return { ok: false, motivo: 'equipos_no_se_importan' };
  if (!at.arma || !at.genero) return { ok: false, motivo: 'sin_arma_o_genero' };
  const fecha = fechaCabecera(cab.lineas) ?? fechaCabecera([cab.titulo ?? '']);
  const anioCaptura = Number(clas.url.match(/\/web\/(\d{4})/)?.[1] ?? 0);
  const lectura = leerCarpeta(paginas);
  if (lectura.clasificacion.length < 4) return { ok: false, motivo: 'clasificacion_ilegible' };
  const candidatas: Candidata[] = todas.filter((p) => {
    if (p.weapon !== at.arma || p.gender !== at.genero) return false;
    if (at.categoria && p.category !== at.categoria) return false;
    const f = (p.date ?? p.startDate)!;
    if (fecha) return Math.abs(dia(f) - dia(fecha)) <= 7;
    // Sin fecha en la cabecera: el año del título o de la captura.
    const anio = Number(/\b(20\d\d)\b/.exec([cab.titulo, ...cab.lineas].join(' '))?.[1] ?? anioCaptura);
    return Number(f.slice(0, 4)) === anio;
  }).map((p) => ({ p, puestos: puestosDeBase(db, p.id) }))
    .map((x) => ({ ...x, s: solape(x.puestos, lectura.clasificacion) }))
    .sort((a, b) => b.s - a.s);
  // Una prueba pequeña cuyos tiradores estaban todos en la de Engarde (el Panamericano frente al Mundial) solapa
  // casi igual; se desempata con la parte de la clasificación de Engarde que está en la FIE.
  const inversa = (x: Candidata) => (x.s * x.puestos.length) / Math.max(1, lectura.clasificacion.length);
  if (candidatas[1] && candidatas[1].s > candidatas[0].s - 0.15) {
    const cerca = candidatas.filter((x) => x.s > candidatas[0].s - 0.15);
    const grande = cerca.find((x) => inversa(x) >= 0.5 && cerca.every((y) => y === x || inversa(x) - inversa(y) >= 0.3));
    if (grande) candidatas.splice(0, candidatas.length, grande, ...candidatas.filter((x) => x !== grande && !cerca.includes(x)));
  }
  const mejor = candidatas[0];
  // Sin fecha en la cabecera el año sale de la captura, y la Wayback vuelve a capturar carpetas antiguas años
  // después (la «sm-in» del Mundial de 2007 capturada en 2012 solapa un 51 % con los JJOO de 2012): más exigencia.
  const umbral = fecha ? 0.5 : 0.75;
  if (!mejor || mejor.s < umbral || (candidatas[1] && candidatas[1].s > mejor.s - 0.15)) {
    return {
      ok: false,
      motivo: mejor ? `sin_prueba_fie_con_solape:${candidatas.slice(0, 2).map((x) => `${x.p.season}:${x.p.competitionKey}=${x.s.toFixed(2)}`).join('/')}` : 'sin_prueba_fie_candidata',
    };
  }
  return { ok: true, mejor, lectura };
}

/** Páginas de la carpeta en caché; las que no llevan la cabecera de la clasificación (otra prueba) quedan fuera. */
export function paginasEnCache(c: Carpeta): { paginas: Pagina[]; otraCabecera: string[] } {
  const paginas: Pagina[] = [];
  for (const d of c.documentos) {
    const url = urlWayback(d.timestamp, d.original);
    const doc = enCache(url);
    if (!doc?.bytes || !doc.sha256) continue;
    paginas.push({ fichero: decodeURIComponent(d.fichero), tipo: d.tipo, url, html: decodificarHtml(doc.bytes), sha: doc.sha256 });
  }
  const clas = paginas.find((p) => p.tipo === 'clasificacion');
  if (!clas) return { paginas, otraCabecera: [] };
  const firma = firmaCabecera(clas.html);
  const otraCabecera = paginas.filter((p) => p.tipo !== 'clasificacion' && firmaCabecera(p.html) !== firma).map((p) => p.fichero);
  return { paginas: paginas.filter((p) => !otraCabecera.includes(p.fichero)), otraCabecera };
}

function objetivosEngarde(db: ReturnType<typeof abrirBase>): PruebaBase[] {
  return pruebasFie(db, { formato: 'INDIVIDUAL' }).filter((p) => {
    const f = p.date ?? p.startDate;
    return f && f < HOY && p.resultados > 0;
  });
}

async function descargar() {
  const db = abrirBase(argumento('db', NUEVO9));
  const todas = objetivosEngarde(db);
  const man: Manifiesto = { generado: new Date().toISOString(), carpetas: [] };
  for (const f of PREFIJOS) {
    const capturas = await cdx(f.prefijo, { matchType: 'prefix', filter: 'statuscode:200', to: f.hasta, limit: '200000' });
    const carpetas = agruparCapturas(capturas);
    console.log(`${f.prefijo}: ${capturas.length} capturas, ${carpetas.length} carpetas con clasificación y poules o cuadro`);
    for (const c of carpetas) {
      if (man.carpetas.some((x) => x.clave === c.clave)) continue;
      man.carpetas.push({ ...c, prefijo: f.prefijo });
      // Primero la clasificación: el resto sólo si casa con una prueba FIE a la que le falta una fase.
      for (const d of c.documentos.filter((x) => x.tipo === 'clasificacion')) await obtener(urlWayback(d.timestamp, d.original));
      const cas = casarCarpeta(db, todas, c.clave, paginasEnCache(c).paginas);
      if (!cas.ok || (cas.mejor.p.poule > 0 && cas.mejor.p.tableau > 0)) {
        console.log(`  ${c.clave}: ${cas.ok ? 'la base ya tiene poules y cuadro' : cas.motivo}`);
        continue;
      }
      for (const d of c.documentos.filter((x) => x.tipo !== 'clasificacion')) await obtener(urlWayback(d.timestamp, d.original));
      console.log(`  ${c.clave} -> ${cas.mejor.p.season}:${cas.mejor.p.competitionKey}: ${c.documentos.map((d) => d.fichero).join(', ')}`);
    }
  }
  db.close();
  writeFileSync(MANIFIESTO, `${JSON.stringify(man, null, 1)}\n`);
  console.log(`manifiesto en ${MANIFIESTO} (${man.carpetas.length} carpetas)`);
}

type FilaInforme = { carpeta: string; motivo: string; fie?: string; solape?: number; poules?: string; cuadro?: string; problemas?: string[]; sinCasar?: string[]; otraCabecera?: string[] };

function hechos() {
  const db = abrirBase(argumento('db', NUEVO9));
  const salida = argumento('salida', salidaLote10Fie('engarde-wayback'));
  if (!existsSync(MANIFIESTO)) throw new Error(`falta ${MANIFIESTO}: ejecuta antes «descargar»`);
  const man = JSON.parse(readFileSync(MANIFIESTO, 'utf8')) as Manifiesto;
  const todas = objetivosEngarde(db);
  const informe: FilaInforme[] = [];
  const usadas = new Map<string, string>();
  let escritos = 0;
  let nPoules = 0;
  let nCuadro = 0;
  for (const c of man.carpetas) {
    const { paginas, otraCabecera } = paginasEnCache(c);
    const cas = casarCarpeta(db, todas, c.clave, paginas);
    if (!cas.ok) {
      informe.push({ carpeta: c.clave, motivo: cas.motivo });
      continue;
    }
    const { mejor, lectura } = cas;
    const clas = paginas.find((x) => x.tipo === 'clasificacion')!;
    const p: PruebaBase = mejor.p;
    const fie = `${p.season}:${p.competitionKey}`;
    if (p.poule > 0 && p.tableau > 0) {
      informe.push({ carpeta: c.clave, fie, solape: mejor.s, motivo: 'la_base_ya_tiene_poules_y_cuadro' });
      continue;
    }
    if (usadas.has(fie)) {
      informe.push({ carpeta: c.clave, fie, solape: mejor.s, motivo: `prueba_ya_completada_desde:${usadas.get(fie)}` });
      continue;
    }
    const r = anadirAsaltos(hechosBase(p, mejor.puestos), lectura, {
      nombre: 'engarde_wayback', url: clas.url, descripcion: 'exportación HTML de Engarde archivada en la Wayback Machine',
    });
    const pf = mapaPuestos(mejor.puestos);
    let bouts = r.hechos.bouts.filter((b) => (b.phase === 'POULE' ? p.poule === 0 : p.tableau === 0));
    const cuadroLeido = bouts.filter((b) => b.phase === 'TABLEAU');
    const cuadroCorregido = corregirRondasPorPuestos(cuadroLeido, pf);
    const renombradas = cuadroCorregido.some((b, i) => b.roundKey !== cuadroLeido[i].roundKey);
    bouts = [...bouts.filter((b) => b.phase === 'POULE'), ...cuadroCorregido];
    const problemas = cuadroContraClasificacion(bouts.filter((b) => b.phase === 'TABLEAU'), pf);
    if (problemas.length) bouts = bouts.filter((b) => b.phase !== 'TABLEAU');
    const poules = bouts.filter((b) => b.phase === 'POULE').length;
    const cuadro = bouts.filter((b) => b.phase === 'TABLEAU').length;
    const fila: FilaInforme = {
      carpeta: c.clave, fie, solape: Number(mejor.s.toFixed(2)), motivo: 'escrita',
      poules: `${poules}/${r.informe.pools.esperados} ${JSON.stringify(r.informe.pools.descartados)}`,
      cuadro: `${cuadro}/${r.informe.tableau.esperados} ${JSON.stringify(r.informe.tableau.descartados)}`,
      problemas, sinCasar: r.informe.tiradores.sinCasar.slice(0, 10), otraCabecera,
    };
    if (!bouts.length) {
      informe.push({ ...fila, motivo: problemas.length ? 'cuadro_contradice_clasificacion_y_sin_poules' : 'ningun_asalto_valido_de_una_fase_que_falte' });
      continue;
    }
    // Muchos tiradores sin fila en la clasificación FIE: casi seguro otra prueba con participantes en común.
    const sinRef = (r.informe.pools.descartados.tirador_sin_referencia ?? 0) + (r.informe.tableau.descartados.tirador_sin_referencia ?? 0);
    if (sinRef > 0.2 * (r.informe.pools.esperados + r.informe.tableau.esperados)) {
      informe.push({ ...fila, motivo: 'demasiados_tiradores_sin_referencia' });
      continue;
    }
    const estado = (fase: 'pools' | 'tableau', n: number) => (n === 0 ? 'parcial' : problemas.length && fase === 'tableau' ? 'parcial' : r.hechos.status[fase]);
    const sha = sha256(paginas.map((x) => x.sha).join('|'));
    const h = hechosAsaltos(p, {
      extractor: 'lote10_engarde_wayback', sourceUrl: clas.url, sourceSha256: sha,
      pools: estado('pools', poules), tableau: estado('tableau', cuadro),
      notas: [
        `Lote 10: asaltos de la exportación HTML de Engarde archivada en la Wayback Machine (${c.clave}: ${paginas.map((x) => x.fichero).join(', ')}), la misma prueba que la FIE publica sin asaltos; results vacío a propósito`,
        `Prueba casada por arma, género, categoría, fecha y clasificación (${Math.round(mejor.s * 100)} % de la clasificación FIE en la de Engarde); tiradores identificados por nombre y nación con los factKey de la clasificación FIE`,
        `Poules ${poules} de ${r.informe.pools.esperados} asaltos (TD y TR de cada fila reproducidos); cuadro ${cuadro} de ${r.informe.tableau.esperados} cruces${problemas.length ? ` (cuadro descartado: ${problemas.join(', ')})` : ' (coherente con los puestos oficiales)'}`,
        ...(Object.keys(r.informe.pools.descartados).length ? [`Poules fuera: ${JSON.stringify(r.informe.pools.descartados)}`] : []),
        ...(Object.keys(r.informe.tableau.descartados).length ? [`Cuadro fuera: ${JSON.stringify(r.informe.tableau.descartados)}`] : []),
        ...(otraCabecera.length ? [`Documentos de otra prueba en la misma carpeta, no leídos: ${otraCabecera.join(', ')}`] : []),
        ...(renombradas && cuadro ? ['Ronda previa titulada «Tableau préliminaire de N» renombrada a la de 2N: todos sus perdedores tienen puesto oficial entre N+1 y 2N'] : []),
      ],
      bouts,
    });
    escribirHechos(salida, h);
    usadas.set(fie, c.clave);
    escritos += 1;
    nPoules += poules;
    nCuadro += cuadro;
    informe.push(fila);
  }
  db.close();
  const motivos: Record<string, number> = {};
  for (const i of informe) sumar(motivos, i.motivo.split(':')[0]);
  writeFileSync(INFORME, `${JSON.stringify({ generado: new Date().toISOString(), escritos, poules: nPoules, cuadro: nCuadro, motivos, carpetas: informe }, null, 1)}\n`);
  for (const i of informe) console.log(`${i.carpeta} -> ${i.fie ?? '-'} ${i.motivo}${i.poules ? ` poules ${i.poules}` : ''}${i.cuadro ? ` cuadro ${i.cuadro}` : ''}${i.problemas?.length ? ` problemas ${i.problemas.join(',')}` : ''}`);
  console.log(`${escritos} ficheros (${nPoules} asaltos de poule, ${nCuadro} de cuadro) en ${salida}; informe en ${INFORME}`);
  console.log(JSON.stringify(motivos));
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'descargar') await descargar();
  else if (orden === 'hechos') hechos();
  else throw new Error('uso: lote10-fie-engarde-wayback.ts descargar|hechos [--db <sqlite>] [--salida <dir>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
