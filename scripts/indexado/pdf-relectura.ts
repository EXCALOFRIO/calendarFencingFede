/**
 * Relectura de los PDF RFEE de las pruebas nacionales principales con poules o cuadro
 * incompletos (`pdf-relectura-objetivos.ts`). Por PDF: lector local + segunda pasada de
 * nombres confundibles (`pdf-relectura-lector.ts`), validación y UN fichero de hechos por
 * prueba en `<salida>/` (por defecto `calendario-trabajo/hechos/pdf-relectura`). Sólo lee
 * la base y la caché; no escribe en ninguna base.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/pdf-relectura.ts \
 *     --db <copia.sqlite> [--cache <cache-rfee-2018>] [--inventario <json>] [--salida <dir>] [--desde 2017-01-01]
 *
 * Pruebas en dos fases (TNR con 1ª fase y fase final en el mismo PDF): se emite una sola
 * prueba con las dos fases (poules `P*` y `V2P*`, cuadro previo `A*` y principal `B*`,
 * como la FIE) y las lecturas antiguas partidas de ese PDF se listan en
 * `_correcciones.json#sustituidas` para retirarlas con `pdf-relectura-aplicar.ts`.
 *
 * Se escribe un fichero sólo si mejora lo guardado (más asaltos en poules o cuadro que
 * cualquier prueba de la base con asaltos de ese PDF y la misma arma y género).
 */
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { extraerPaginas, sha256Hex } from '../../src/lib/ingest/sources/rfee-pdf/lectura';
import type { AsaltoPdf, LecturaPdf, PruebaPdf } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { argumento, CARPETA_CACHES, CARPETA_TRABAJO, normalizarNombre, NUEVO_POR_DEFECTO, palabrasNombre } from './comun';
import { consistenciaCuadro } from './cuadro-consistencia';
import { cabe, casarUnico, firmaLaxa, INVENTARIO_NACIONAL, leerCatalogoNacional, nombresCompatiblesRecorte, prepararNombre } from './dedupe-pruebas';
import { cargarIndiceFechas } from './fechas-catalogo';
import { lecturaAHechos, nombreUnico, resolverDocId, type IndiceBase } from './pdf-a-hechos';
import { medirCuadro, medirPoules } from './pdf-relectura-comun';
import { releerPdf, type PruebaReleida } from './pdf-relectura-lector';
import { cargarManifiesto, medirPrincipales, rutaBlob } from './pdf-relectura-objetivos';

const sinFragmento = (u: string) => u.split('#')[0];

// ------------------------------------------------------------------ lectura aumentada

/** La prueba del lector con los asaltos recuperados y su cobertura al día. */
export function aumentarPrueba(r: PruebaReleida): PruebaPdf {
  const p = r.prueba;
  if (r.recuperados.length === 0) return p;
  const asaltos = [...p.asaltos, ...r.recuperados];
  const cobertura = { ...p.cobertura };
  for (const [k, fase] of [['poules', 'POULE'], ['cuadro', 'TABLEAU']] as const) {
    const c = cobertura[k];
    const importado = asaltos.filter((a) => a.fase === fase).length;
    const extra = importado - c.importado;
    if (extra === 0) continue;
    const completo = c.publicado !== null && importado >= c.publicado;
    cobertura[k] = {
      ...c, importado, estado: completo ? 'completo' : c.estado,
      motivo: completo ? null : `${c.motivo ?? ''}; ${extra} recuperados en la relectura`.replace(/^; /, ''),
    };
  }
  // Las regiones rechazadas por identidad ya no cuentan cuando la sección queda completa.
  const rechazos = p.rechazos.filter((x) =>
    !((x.seccion === 'poules' && cobertura.poules.estado === 'completo') || (x.seccion === 'cuadro' && cobertura.cuadro.estado === 'completo')));
  return { ...p, asaltos, cobertura, rechazos };
}

// ------------------------------------------------------------------ dos fases

const RE_PRIMERA = /\b(1|PRIMERA)\s*[ªºA°.]?\s*FASE\b/;
const RE_FINAL = /\b(2|SEGUNDA)\s*[ªºA°.]?\s*FASE\b|\bFASE\s+FINAL\b/;
const cabeceraNorm = (p: PruebaPdf) => p.cabecera.join(' / ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

/**
 * 1ª fase y fase final de la misma arma y género en un PDF. La fase final se reconoce por
 * su cabecera («2ª FASE», «FASE FINAL»); la otra, por la suya («1ª FASE», «PRIMERA FASE»)
 * o por ser la única otra prueba individual de esa arma y género con asaltos.
 */
export function fasesDelDocumento(pruebas: readonly PruebaPdf[]): { primera: PruebaPdf; final: PruebaPdf }[] {
  const out: { primera: PruebaPdf; final: PruebaPdf }[] = [];
  const grupos = new Map<string, PruebaPdf[]>();
  for (const p of pruebas) {
    if (p.formato !== 'INDIVIDUAL' || !p.arma || !p.genero || p.asaltos.length === 0) continue;
    const k = `${p.arma}|${p.genero}`;
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  for (const ps of grupos.values()) {
    if (ps.length < 2) continue;
    const finales = ps.filter((p) => RE_FINAL.test(cabeceraNorm(p)) && !RE_PRIMERA.test(cabeceraNorm(p)));
    const primeras = ps.filter((p) => RE_PRIMERA.test(cabeceraNorm(p)));
    const sinMarca = ps.filter((p) => !finales.includes(p) && !primeras.includes(p));
    const final = finales.length === 1 ? finales[0] : null;
    const primera = primeras.length === 1 ? primeras[0] : primeras.length === 0 && sinMarca.length === 1 ? sinMarca[0] : null;
    if (!final || !primera || primera === final) continue;
    // La fase final la tiran los exentos y los clasificados: es la menor de las dos.
    if (final.puestos.length >= primera.puestos.length) continue;
    out.push({ primera, final });
  }
  return out;
}

const NUMERO_VUELTA = /^V(\d+)P(\d+)$/;

/** Ronda de la fase final dentro de la prueba unida: poules en la vuelta siguiente, cuadro principal `B…`. */
export function rondaFaseFinal(fase: AsaltoHecho['phase'], ronda: string, vueltasPrimera: number): string {
  if (fase === 'POULE') {
    const v = NUMERO_VUELTA.exec(ronda);
    const p = /^P(\d+)$/.exec(ronda);
    if (v) return `V${Number(v[1]) + vueltasPrimera}P${v[2]}`;
    if (p) return `V${1 + vueltasPrimera}P${p[1]}`;
    return ronda;
  }
  const a = /^[AT](\d+)$/.exec(ronda);
  return a ? `B${a[1]}` : ronda;
}

/**
 * Une 1ª fase y fase final en una prueba. Puestos: los de la fase final (la clasificación
 * de cabeza del evento); los asaltos de la 1ª fase de quien también está en la final pasan
 * a su puesto de la final. Si Skermo publica la clasificación entera (`conClasificacionGlobal`),
 * los demás de la 1ª fase no llevan puesto (sus asaltos llevan su nombre y la fusión los liga a
 * Skermo); si no, van detrás de los de la final en el orden de la 1ª fase.
 */
export function combinarFases(h1: HechosPrueba, h2: HechosPrueba, docId: string, conClasificacionGlobal = true): HechosPrueba {
  const porNombre = new Map<string, string | null>();
  for (const r of h2.results) {
    const n = normalizarNombre(r.name);
    porNombre.set(n, porNombre.has(n) ? null : r.factKey);
  }
  // Sin otra fuente con la clasificación entera (Skermo), los eliminados en la 1ª fase van detrás
  // de los de la fase final, en el orden de la 1ª fase (empates incluidos).
  const soloPrimera = conClasificacionGlobal ? [] : h1.results.filter((r) => !porNombre.has(normalizarNombre(r.name)));
  const extra = soloPrimera.map((r) => ({
    ...r,
    position: r.position === null ? null : h2.results.length + 1 + soloPrimera.filter((x) => x.position !== null && x.position < r.position!).length,
    positionRaw: r.position === null ? r.positionRaw : `1ª fase: ${r.position}`,
  }));
  const nombreDe = new Map(h1.results.map((r) => [r.factKey, r.name]));
  const ref = (k: string, nombre: string) => porNombre.get(normalizarNombre(nombreDe.get(k) ?? nombre)) ?? k;
  const vueltas = Math.max(1, ...h1.bouts.filter((b) => b.phase === 'POULE').map((b) => Number(NUMERO_VUELTA.exec(b.roundKey)?.[1] ?? 1)));
  const bouts: AsaltoHecho[] = [
    ...h1.bouts.map((b) => ({ ...b, aRef: ref(b.aRef, b.aName), bRef: ref(b.bRef, b.bName) })),
    ...h2.bouts.map((b) => ({ ...b, roundKey: rondaFaseFinal(b.phase, b.roundKey, vueltas) })),
  ];
  const peor = (a: string, b: string) => (['ilegible', 'parcial', 'completo', 'sin_resultados'].find((e) => e === a || e === b) ?? a) as HechosPrueba['status']['pools'];
  const c = h2.competition;
  return hechosPrueba.parse({
    ...h2,
    edition: { ...h2.edition, startDate: h1.edition.startDate ?? h2.edition.startDate, endDate: h2.edition.endDate ?? h1.edition.endDate },
    competition: {
      ...c,
      competitionKey: `pdf:${docId}:${docId}:${c.weapon}:${c.gender}:${c.format}:${c.category}:FASES`,
      date: h1.competition.date ?? c.date,
    },
    status: {
      results: h2.status.results,
      pools: peor(h1.status.pools, h2.status.pools),
      tableau: peor(h1.status.tableau, h2.status.tableau),
      publishedParticipants: null,
      notes: [
        'Prueba en dos fases unida por la relectura: 1ª fase en poules P* y cuadro previo A*; fase final en poules V2P* y cuadro principal B*',
        ...h1.status.notes.map((n) => `1ª fase: ${n}`),
        ...h2.status.notes.map((n) => `Fase final: ${n}`),
      ],
    },
    results: [...h2.results, ...extra],
    bouts,
  });
}

// ------------------------------------------------------------------ validación

/**
 * Asaltos de cuadro incoherentes, tramo a tramo: `consistenciaCuadro` sólo mira rondas
 * `A…`/`T…`, así que el cuadro principal `B…` de una prueba en dos fases se comprueba aparte.
 */
export function incoherentesPorTramo<T extends AsaltoHecho>(bouts: readonly T[]): Set<T> {
  const fuera = new Set<T>();
  const cuadro = bouts.filter((b) => b.phase === 'TABLEAU');
  for (const tramo of [cuadro.filter((b) => !b.roundKey.startsWith('B')), cuadro.filter((b) => b.roundKey.startsWith('B'))]) {
    const c = consistenciaCuadro(tramo.map((b) => ({ ...b, roundKey: b.roundKey.replace(/^B/, 'A') })));
    for (const i of c.incoherentes) fuera.add(tramo[i]);
  }
  return fuera;
}

export type Validacion = { hechos: HechosPrueba; problemas: Record<string, number> };

/**
 * Comprobaciones antes de escribir: marcador de poule ≤ 5 y de cuadro ≤ 15 (salvo que la
 * prueba entera tire a más: entonces se acepta su máximo), una pareja una sola vez por poule,
 * una poule no tiene más asaltos que n·(n−1)/2 y el cuadro es coherente (`consistenciaCuadro`).
 * Lo que no pasa se quita y se cuenta.
 */
export function validarHechos(h: HechosPrueba): Validacion {
  const problemas: Record<string, number> = {};
  const sumar = (k: string, n = 1) => {
    if (n > 0) problemas[k] = (problemas[k] ?? 0) + n;
  };
  const limite = (fase: string, normal: number) => {
    const marcadores = h.bouts.filter((b) => b.phase === fase).map((b) => Math.max(b.scoreA, b.scoreB));
    const fuera = marcadores.filter((m) => m > normal).length;
    // Más del 10 % (y más de dos) por encima del tope normal: la prueba tira a otro tope (poules a 10...).
    return fuera > Math.max(2, marcadores.length * 0.1) ? Math.max(...marcadores) : normal;
  };
  const topes = { POULE: limite('POULE', 5), TABLEAU: limite('TABLEAU', 15) };
  let bouts = h.bouts.filter((b) => {
    const ok = Math.max(b.scoreA, b.scoreB) <= topes[b.phase] && b.aRef !== b.bRef && (b.scoreA !== b.scoreB || b.winner !== null);
    if (!ok) sumar(`${b.phase.toLowerCase()}_marcador_invalido`);
    return ok;
  });
  // Una pareja se cruza una vez por vuelta y cada tirador está en una sola poule de la vuelta;
  // gana lo primero (el lector, luego lo recuperado, luego lo ya guardado).
  const vistos = new Set<string>();
  const pouleDe = new Map<string, string>();
  const vuelta = (ronda: string) => /^V(\d+)P/.exec(ronda)?.[1] ?? '1';
  bouts = bouts.filter((b) => {
    if (b.phase !== 'POULE') return true;
    const v = vuelta(b.roundKey);
    const k = `${v}|${[b.aRef, b.bRef].sort().join('|')}`;
    if (vistos.has(k)) {
      sumar('poule_pareja_repetida');
      return false;
    }
    if ([b.aRef, b.bRef].some((r) => (pouleDe.get(`${v}|${r}`) ?? b.roundKey) !== b.roundKey)) {
      sumar('poule_tirador_en_dos_poules');
      return false;
    }
    vistos.add(k);
    for (const r of [b.aRef, b.bRef]) pouleDe.set(`${v}|${r}`, b.roundKey);
    return true;
  });
  const porPoule = new Map<string, AsaltoHecho[]>();
  for (const b of bouts) if (b.phase === 'POULE') porPoule.set(b.roundKey, [...(porPoule.get(b.roundKey) ?? []), b]);
  const pouleMala = new Set<string>();
  for (const [k, xs] of porPoule) {
    const n = new Set(xs.flatMap((b) => [b.aRef, b.bRef])).size;
    if (xs.length > (n * (n - 1)) / 2) pouleMala.add(k);
  }
  bouts = bouts.filter((b) => {
    if (b.phase === 'POULE' && pouleMala.has(b.roundKey)) {
      sumar('poule_mas_asaltos_que_posibles');
      return false;
    }
    return true;
  });
  const fuera = incoherentesPorTramo(bouts);
  sumar('cuadro_incoherente', fuera.size);
  bouts = bouts.filter((b) => !fuera.has(b));
  return { hechos: hechosPrueba.parse({ ...h, bouts }), problemas };
}

// ------------------------------------------------------------------ base (sólo lectura)

/** Namespaces de documento PDF en la base, como `pdf-a-hechos.ts#cargarBase`. */
export function indiceNamespaces(db: DatabaseSync): IndiceBase {
  const namespaces = new Map<string, (string | null)[]>();
  const anotar = (season: string, docId: string, url: string | null) => {
    const k = `${season}|${docId}`;
    namespaces.set(k, [...(namespaces.get(k) ?? []), url]);
  };
  for (const r of db.prepare(`select season, competition_key k, source_url u from sport_import_coverage where source='rfee_pdf' and fact_kind='pdf'`).all() as { season: string; k: string; u: string | null }[]) {
    if (r.k.startsWith('doc:')) anotar(r.season, r.k.slice(4), r.u);
  }
  for (const r of db.prepare(`select season, competition_key k, source_url u from sport_competition where source='rfee_pdf'`).all() as { season: string; k: string; u: string | null }[]) {
    const m = /^pdf:([^:]+):/.exec(r.k);
    if (m) anotar(r.season, m[1], r.u);
  }
  for (const r of db.prepare(`select season, tournament_key k, source_url u from sport_edition where source='rfee_pdf'`).all() as { season: string; k: string; u: string | null }[]) {
    if (r.k.startsWith('pdf:')) anotar(r.season, r.k.slice(4), r.u);
  }
  return { namespaces, competiciones: new Map(), docsPorSeason: new Map() };
}

export type Guardado = { id: string; source: string; season: string; key: string; edicion: string; weapon: string; gender: string; category: string; poules: number; cuadro: number; resultados: number };

/** Por URL de PDF (sin fragmento): pruebas de la base con asaltos de ese PDF o con esa URL. */
export function guardadosPorPdf(db: DatabaseSync): Map<string, Guardado[]> {
  const out = new Map<string, Map<string, Guardado>>();
  const filas = db.prepare(
    `SELECT c.id, c.source, c.season, c.competition_key key, e.tournament_key edicion, c.weapon, c.gender, c.category,
            b.source_url u, b.phase, count(*) n
       FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id JOIN sport_edition e ON e.id = c.edition_id
      WHERE b.source = 'rfee_pdf' AND c.format = 'INDIVIDUAL' GROUP BY c.id, b.source_url, b.phase`,
  ).all() as (Omit<Guardado, 'poules' | 'cuadro' | 'resultados'> & { u: string | null; phase: string; n: number })[];
  const resultados = new Map((db.prepare(`SELECT competition_id c, count(*) n FROM sport_result GROUP BY competition_id`).all() as { c: string; n: number }[]).map((r) => [r.c, Number(r.n)]));
  const anotar = (url: string, f: Omit<Guardado, 'poules' | 'cuadro' | 'resultados'>, fase: string | null, n: number) => {
    const m = out.get(url) ?? new Map<string, Guardado>();
    const g = m.get(f.id) ?? { ...f, poules: 0, cuadro: 0, resultados: resultados.get(f.id) ?? 0 };
    if (fase === 'POULE') g.poules += n;
    if (fase === 'TABLEAU') g.cuadro += n;
    m.set(f.id, g);
    out.set(url, m);
  };
  for (const f of filas) if (f.u) anotar(sinFragmento(f.u), f, f.phase, Number(f.n));
  for (const c of db.prepare(
    `SELECT c.id, c.source, c.season, c.competition_key key, e.tournament_key edicion, c.weapon, c.gender, c.category, c.source_url u
       FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id WHERE c.source = 'rfee_pdf' AND c.format = 'INDIVIDUAL'`,
  ).all() as (Omit<Guardado, 'poules' | 'cuadro' | 'resultados'> & { u: string | null })[]) {
    if (c.u) anotar(sinFragmento(c.u), c, null, 0);
  }
  return new Map([...out].map(([u, m]) => [u, [...m.values()]]));
}

/** Pareja de un asalto sin marcador: primera palabra de cada nombre, en orden. */
export const firmaPareja = (a: string, b: string): string => [palabrasNombre(a)[0] ?? '', palabrasNombre(b)[0] ?? ''].sort().join('|');

/** Fracción de `parte` (multiconjunto) que está en `todo`. */
export function contenido(parte: readonly string[], todo: readonly string[]): number {
  if (parte.length === 0) return 1;
  const resto = new Map<string, number>();
  for (const f of todo) resto.set(f, (resto.get(f) ?? 0) + 1);
  let n = 0;
  for (const f of parte) {
    const k = resto.get(f) ?? 0;
    if (k > 0) {
      n += 1;
      resto.set(f, k - 1);
    }
  }
  return n / parte.length;
}

type Firmas = { all: (id: string) => unknown[] };

/**
 * Lecturas rfee_pdf de la misma edición (el mismo PDF), arma y género que la prueba unida
 * sustituye, con la fracción de sus asaltos que la unida contiene. Otra categoría del mismo
 * PDF sólo cuenta si sus asaltos son de esta prueba (lectura antigua mal rotulada, ≥ 80 %).
 */
export function partesSustituibles(mismas: readonly Guardado[], h: HechosPrueba, firmasDe: Firmas): { g: Guardado; contenido: number }[] {
  // Por pareja y sin marcador: si las dos lecturas discrepan en el marcador, manda la relectura.
  const nuevas = h.bouts.map((b) => firmaPareja(b.aName, b.bName));
  const out: { g: Guardado; contenido: number }[] = [];
  for (const g of mismas) {
    if (g.source !== 'rfee_pdf' || g.edicion !== h.edition.tournamentKey || g.key === h.competition.competitionKey) continue;
    const suyas = (firmasDe.all(g.id) as { a: string; sa: number; b: string; sb: number }[]).map((x) => firmaPareja(x.a, x.b));
    const c = contenido(suyas, nuevas);
    if (g.category !== h.competition.category && (suyas.length === 0 || c < 0.8)) continue;
    out.push({ g, contenido: c });
  }
  return out;
}

export type AsaltoGuardado = { phase: string; roundKey: string; aName: string; bName: string; scoreA: number; scoreB: number };

/**
 * Añade a la relectura los asaltos ya guardados de ese PDF que no trae (lecturas antiguas
 * o del droid que leyeron una poule o un cruce que el lector actual no lee), para que
 * cargar la relectura nunca borre un asalto. Cada nombre se lleva a su puesto (exacto o
 * recortado y único); un asalto de cuadro sólo entra si deja el cuadro coherente y uno
 * de poule si la pareja no está ya en esa poule y la poule no pasa de n·(n−1)/2.
 * `faseDe` (pruebas en dos fases) dice en qué fase va cada asalto o null si no se sabe.
 */
export function completarConGuardado(
  h: HechosPrueba,
  guardados: readonly AsaltoGuardado[],
  faseDe: ((a: AsaltoGuardado) => 1 | 2 | null) | null = null,
  vueltasPrimera = 1,
  /** Otros puestos con los que casar nombres (los de la 1ª fase en una prueba unida). */
  otros: readonly { factKey: string; name: string }[] = [],
): { hechos: HechosPrueba; añadidos: { poules: number; cuadro: number }; descartados: number } {
  const listas = [h.results, otros].map((l) => ({ l, p: l.map((r) => prepararNombre(r.name)) }));
  const refDe = (nombre: string): { ref: string; nombre: string } | null => {
    const n = prepararNombre(nombre);
    for (const { l, p } of listas) {
      const i = casarUnico(n, p);
      if (i !== null) return { ref: l[i].factKey, nombre: l[i].name };
    }
    // En dos fases la clasificación de la 1ª a veces no se lee entera: un nombre que no encaja con
    // ningún puesto (no uno ambiguo) es un tirador de esa fase sin puesto leído.
    const alguno = listas.some(({ p }) => p.some((x) => x.norm === n.norm || nombresCompatiblesRecorte(n, x)));
    if (faseDe && !alguno && n.norm !== '') return { ref: `${h.competition.competitionKey}:guardado:${n.norm.replace(/\s+/g, '-')}`, nombre };
    return null;
  };
  // Cada tirador está en una sola poule por vuelta y una pareja se cruza una vez por vuelta.
  const vuelta = (ronda: string) => /^V(\d+)P/.exec(ronda)?.[1] ?? '1';
  const pouleDe = new Map<string, string>();
  const parejas = new Set<string>();
  for (const b of h.bouts) {
    if (b.phase !== 'POULE') continue;
    for (const r of [b.aRef, b.bRef]) pouleDe.set(`${vuelta(b.roundKey)}|${r}`, b.roundKey);
    parejas.add(`${vuelta(b.roundKey)}|${[b.aRef, b.bRef].sort().join('|')}`);
  }
  const bouts = [...h.bouts];
  const firmas = new Map<string, number[]>();
  bouts.forEach((b, i) => {
    const k = firmaLaxa(b.aName, b.scoreA, b.bName, b.scoreB);
    firmas.set(k, [...(firmas.get(k) ?? []), i]);
  });
  const añadidos = { poules: 0, cuadro: 0 };
  let descartados = 0;
  // La lectura guardada (droid, otro recorte) puede traer el nombre más largo que la relectura:
  // es el que distingue a dos puestos recortados iguales. Se toma por referencia (todos sus
  // asaltos con el mismo nombre) y sólo si las lecturas guardadas no dan dos distintos.
  const largos = new Map<string, string | null>();
  const alargar = (ref: string, corto: string, largo: string) => {
    const c = prepararNombre(corto);
    const l = prepararNombre(largo);
    if (!(l.palabras.join(' ').length > c.palabras.join(' ').length && c.norm !== l.norm && cabe(c.palabras, l.palabras))) return;
    const previo = largos.get(ref);
    largos.set(ref, previo === undefined || previo === largo ? largo : null);
  };
  const poule = (ronda: string) => bouts.filter((b) => b.phase === 'POULE' && b.roundKey === ronda);
  for (const g of guardados) {
    const k = firmaLaxa(g.aName, g.scoreA, g.bName, g.scoreB);
    const libres = firmas.get(k) ?? [];
    if (libres.length > 0) {
      const b = bouts[libres.shift()!];
      const directo = palabrasNombre(b.aName)[0] === palabrasNombre(g.aName)[0] && b.scoreA === g.scoreA;
      const [ga, gb] = directo ? [g.aName, g.bName] : [g.bName, g.aName];
      alargar(b.aRef, b.aName, ga);
      alargar(b.bRef, b.bName, gb);
      continue;
    }
    const fase = faseDe ? faseDe(g) : 1;
    if (fase === null) {
      descartados += 1;
      continue;
    }
    // Un nombre que no casa con un solo puesto no entra: sería un tirador de más en la prueba.
    const a = refDe(g.aName);
    const b = refDe(g.bName);
    if (!a || !b || a.ref === b.ref) {
      descartados += 1;
      continue;
    }
    const tam = /^[AT](\d+)$/.exec(g.roundKey)?.[1];
    const roundKey = g.phase === 'POULE'
      ? (faseDe && fase === 2 ? rondaFaseFinal('POULE', g.roundKey, vueltasPrimera) : g.roundKey)
      : tam ? `${faseDe && fase === 2 ? 'B' : 'A'}${tam}` : g.roundKey;
    const nuevo: AsaltoHecho = {
      phase: g.phase === 'POULE' ? 'POULE' : 'TABLEAU', roundKey, aRef: a.ref, bRef: b.ref, aName: a.nombre, bName: b.nombre,
      scoreA: g.scoreA, scoreB: g.scoreB, winner: null,
    };
    if (nuevo.scoreA === nuevo.scoreB) {
      descartados += 1;
      continue;
    }
    if (nuevo.phase === 'POULE') {
      const v = vuelta(roundKey);
      const xs = poule(roundKey);
      const pareja = `${v}|${[a.ref, b.ref].sort().join('|')}`;
      const tiradores = new Set([...xs.flatMap((x) => [x.aRef, x.bRef]), a.ref, b.ref]).size;
      const otraPoule = [a.ref, b.ref].some((r) => (pouleDe.get(`${v}|${r}`) ?? roundKey) !== roundKey);
      if (parejas.has(pareja) || otraPoule || xs.length + 1 > (tiradores * (tiradores - 1)) / 2) {
        descartados += 1;
        continue;
      }
      bouts.push(nuevo);
      parejas.add(pareja);
      for (const r of [a.ref, b.ref]) pouleDe.set(`${v}|${r}`, roundKey);
      añadidos.poules += 1;
      continue;
    }
    // Una ronda de S no tiene más de S/2 cruces: lo que sobra es otra ronda u otra fase mal rotulada.
    const enRonda = bouts.filter((x) => x.phase === 'TABLEAU' && x.roundKey === roundKey).length;
    const lleno = tam !== undefined && enRonda >= Number(tam) / 2;
    if (lleno || incoherentesPorTramo([...bouts, nuevo]).size > incoherentesPorTramo(bouts).size) {
      descartados += 1;
      continue;
    }
    bouts.push(nuevo);
    añadidos.cuadro += 1;
  }
  let nombresLargos = 0;
  for (let i = 0; i < bouts.length; i += 1) {
    const b = bouts[i];
    const aName = largos.get(b.aRef) ?? b.aName;
    const bName = largos.get(b.bRef) ?? b.bName;
    if (aName === b.aName && bName === b.bName) continue;
    bouts[i] = { ...b, aName, bName };
    nombresLargos += 1;
  }
  if (añadidos.poules + añadidos.cuadro === 0 && nombresLargos === 0) return { hechos: h, añadidos, descartados };
  const notas = añadidos.poules + añadidos.cuadro > 0
    ? [...h.status.notes, `Relectura: ${añadidos.poules} asaltos de poule y ${añadidos.cuadro} de cuadro de lecturas anteriores del mismo PDF`]
    : h.status.notes;
  return { hechos: hechosPrueba.parse({ ...h, status: { ...h.status, notes: notas }, bouts }), añadidos, descartados };
}

/**
 * Fase que dice la clave de una lectura partida («…:TNRABSPRIMERAFASE», «…:TNRABS13ABSFASEFINAL»).
 * Manda sobre los tiradores: la clasificación de la 1ª fase suele listar sólo a los eliminados
 * en ella, así que quien pasó a la final parece un exento de la final.
 */
export function faseDeClave(clave: string): 1 | 2 | null {
  const sufijo = clave.split(':').pop() ?? '';
  if (/PRIMERAFASE|1AFASE|FASE1$/.test(sufijo)) return 1;
  if (/FASEFINAL|FINAL$/.test(sufijo)) return 2;
  return null;
}

/**
 * Fase de un asalto guardado de una prueba en dos fases: la final si algún tirador no está en
 * la 1ª fase (los exentos), la 1ª si alguno no está en la final; si los dos están en ambas, no se sabe.
 */
export function faseSegunTiradores(primera: readonly { name: string }[], final: readonly { name: string }[]) {
  const p1 = primera.map((r) => prepararNombre(r.name));
  const p2 = final.map((r) => prepararNombre(r.name));
  const en = (lista: ReturnType<typeof prepararNombre>[], n: string) => casarUnico(prepararNombre(n), lista) !== null;
  // La clasificación de la fase final es la corta y completa: quien no está en ella tiró la 1ª fase
  // (aunque falte en la clasificación de la 1ª, que a veces el lector no lee entera).
  return (a: AsaltoGuardado): 1 | 2 | null => {
    const nombres = [a.aName, a.bName];
    const primera = nombres.some((n) => !en(p2, n));
    const exento = nombres.some((n) => en(p2, n) && !en(p1, n));
    if (primera && !exento) return 1;
    if (exento && !primera) return 2;
    return null;
  };
}

// ------------------------------------------------------------------ informe

export type FilaInforme = {
  url: string; fichero: string | null; competitionKey: string; weapon: string; gender: string; category: string;
  fases: boolean; resultados: number; poules: number; cuadro: number;
  guardado: { poules: number; cuadro: number };
  recuperados: { poules: number; cuadro: number };
  medida: { poules: string; cuadro: string };
  problemas: Record<string, number>;
  escrito: boolean; motivo: string;
};

export type Correcciones = {
  generadoEn: string;
  /** Lecturas antiguas de un PDF en dos fases que la prueba unida sustituye: se borran tras cargar. */
  sustituidas: { source: string; season: string; competitionKey: string; id: string; motivo: string; porCompetitionKey: string }[];
  /** Atributos mal indexados en otra fuente (Engarde): se corrigen en la copia de trabajo. */
  atributos: { source: string; season: string; competitionKey: string; id: string | null; cambios: Record<string, string>; motivo: string }[];
  /** Errores del catálogo de Skermo: enlace de un PDF a otra prueba. Informativos. */
  catalogo: { claveCatalogo: string; url: string; enlazadoComo: string; contenidoReal: string; mismoContenidoQue: string | null; efecto: string }[];
};

/**
 * Errores de índice comprobados a mano contra los documentos:
 *  - Engarde `rfee/cesp_junior2020`: `fmind` y `ffind` son florete (el nombre lo dice y el PDF
 *    RFEE de florete trae los mismos tiradores) y el índice los rotula espada. Su fecha (8 dic.)
 *    queda a 3 días de los PDF (5 dic., impresa en la cabecera de EF, EM y FM), fuera de la
 *    ventana de ±2 días de `dedupe-pruebas.ts`; `efind` y `emind` igual.
 *  - Skermo: el PDF que el catálogo enlaza a la prueba masculina es el femenino (mismo SHA-256
 *    que el que enlaza la femenina).
 */
export const CORRECCIONES_CONOCIDAS: Pick<Correcciones, 'atributos' | 'catalogo'> = {
  atributos: [
    { source: 'engarde', season: '2019-2020', competitionKey: 'engarde:rfee/cesp_junior2020/fmind', id: null, cambios: { weapon: 'FLORETE', competition_date: '2020-12-05' }, motivo: 'Engarde rotula ESPADA el florete masculino del Cto. de España Junior 2020; fecha del PDF RFEE (5 dic. 2020)' },
    { source: 'engarde', season: '2019-2020', competitionKey: 'engarde:rfee/cesp_junior2020/ffind', id: null, cambios: { weapon: 'FLORETE', competition_date: '2020-12-05' }, motivo: 'Engarde rotula ESPADA el florete femenino del Cto. de España Junior 2020; fecha del catálogo RFEE (5 dic. 2020)' },
    { source: 'engarde', season: '2019-2020', competitionKey: 'engarde:rfee/cesp_junior2020/efind', id: null, cambios: { competition_date: '2020-12-05' }, motivo: 'Fecha de la cabecera del PDF RFEE de espada femenina (5 dic. 2020): la copia de Engarde queda fuera de la ventana de fusión' },
    { source: 'engarde', season: '2019-2020', competitionKey: 'engarde:rfee/cesp_junior2020/emind', id: null, cambios: { competition_date: '2020-12-05' }, motivo: 'Fecha de la cabecera del PDF RFEE de espada masculina (5 dic. 2020): la copia de Engarde queda fuera de la ventana de fusión' },
  ],
  catalogo: [
    {
      claveCatalogo: 'skermo_rfee|2024-2025|RFEE:8678', url: 'https://app.skermo.org/client/1/358bf5cd824835bc5111797c58b9b578.pdf',
      enlazadoComo: 'TNR M-20 (1/2) SABLE M 2024-10-06', contenidoReal: 'TNR M-20 SABLE FEMENINO 06.10.2024 (49 tiradoras)',
      mismoContenidoQue: 'https://app.skermo.org/client/1/c13cd15adf99e11e7dc69700cdb24c7b.pdf (RFEE:8679, SABLE F)',
      efecto: 'Ninguno en la base: la fusión no cruza géneros; la lectura del PDF está en la prueba femenina y la masculina tiene sus asaltos de Engarde (rfee/madrid/sm20_ind). El PDF masculino no está publicado.',
    },
    {
      claveCatalogo: 'skermo_rfee|2025-2026|RFEE:9593', url: 'https://app.skermo.org/client/1/9bd38ad6fa65bae887cc75f772971590.pdf',
      enlazadoComo: 'TNR M13 FLORETE M 2025-11-30', contenidoReal: 'TNR M13 FLORETE FEMENINO 30.11.2025 (22 tiradoras)',
      mismoContenidoQue: 'https://app.skermo.org/client/1/3ca6126e259e0dbc514a7e31442740b9.pdf (RFEE:9594, FLORETE F)',
      efecto: 'La lectura está en la prueba femenina (correcto). La masculina (36 puestos) queda sin asaltos: el PDF masculino no está publicado.',
    },
  ],
};

function escribirJson(ruta: string, valor: unknown) {
  writeFileSync(ruta, `${JSON.stringify(valor, null, 1)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const rutaDb = argumento('db', NUEVO_POR_DEFECTO);
  const cache = argumento('cache', join(CARPETA_CACHES, 'cache-rfee-2018'));
  const rutaInventario = argumento('inventario', INVENTARIO_NACIONAL);
  const salida = resolve(argumento('salida', join(CARPETA_TRABAJO, 'hechos', 'pdf-relectura')));
  const desde = argumento('desde', '2017-01-01');
  // Pruebas en dos fases que no se escriben (perderían asaltos guardados), para revisarlas.
  const descartadas = argumento('descartadas', '') || null;
  mkdirSync(salida, { recursive: true });
  if (descartadas) mkdirSync(descartadas, { recursive: true });

  const db = new DatabaseSync(rutaDb, { readOnly: true });
  const catalogo = leerCatalogoNacional(rutaInventario);
  const { filas: medidas } = medirPrincipales(db, { desde, catalogo });
  const incompletas = medidas.filter((f) => !f.poules.completo || !f.cuadro.completo);
  const urls = [...new Set(incompletas.flatMap((f) => f.pdfs))].sort();
  const indice = indiceNamespaces(db);
  const guardados = guardadosPorPdf(db);
  const idDe = new Map<string, string>();
  for (const a of CORRECCIONES_CONOCIDAS.atributos) {
    const r = db.prepare('SELECT id FROM sport_competition WHERE source=? AND season=? AND competition_key=?').get(a.source, a.season, a.competitionKey) as { id: string } | undefined;
    if (r) idDe.set(`${a.source}|${a.season}|${a.competitionKey}`, r.id);
  }
  const firmasDe = db.prepare('SELECT fencer_a_name a, score_a sa, fencer_b_name b, score_b sb FROM sport_bout WHERE competition_id=?');
  const asaltosDe = db.prepare(
    `SELECT phase, round_key roundKey, fencer_a_name aName, fencer_b_name bName, score_a scoreA, score_b scoreB, source_url u
       FROM sport_bout WHERE competition_id=? AND source='rfee_pdf' ORDER BY phase, round_key, id`,
  );

  const manifiesto = cargarManifiesto(cache);
  const fechas = cargarIndiceFechas(rutaInventario);
  const usados = new Set<string>();
  const escritos = new Set<string>();
  const informe: FilaInforme[] = [];
  const sustituidas: Correcciones['sustituidas'] = [];
  const errores: { url: string; error: string }[] = [];
  const t0 = Date.now();

  for (const url of urls) {
    const u = manifiesto.get(url);
    if (!u) {
      errores.push({ url, error: 'pdf_no_en_cache' });
      continue;
    }
    const temporadas = [...new Set((u.asociaciones ?? []).map((a) => a.temporada))];
    if (temporadas.length !== 1) {
      errores.push({ url, error: 'temporada_ambigua' });
      continue;
    }
    const season = temporadas[0];
    try {
      const bytes = new Uint8Array(readFileSync(rutaBlob(cache, u)));
      const sha = await sha256Hex(bytes);
      if (sha !== u.sha256) throw new Error('hash_mismatch');
      const { docId } = resolverDocId(indice, season, u.url);
      const { paginas, perfil } = await extraerPaginas(bytes);
      const { lectura, releidas } = releerPdf(paginas, { url: u.url, docId });
      const pruebas = releidas.map(aumentarPrueba);
      const recuperadosDe = new Map(releidas.map((r, i) => [pruebas[i], r.recuperados]));
      const fases = fasesDelDocumento(pruebas);
      const enFases = new Set(fases.flatMap((f) => [f.primera, f.final]));
      // Una fase sin categoría reconocida toma la de la otra: es la misma prueba.
      for (const f of fases) {
        if (!f.final.categoria && f.primera.categoria) f.final.categoria = f.primera.categoria;
        if (!f.primera.categoria && f.final.categoria) f.primera.categoria = f.final.categoria;
      }
      const conv = lecturaAHechos({ ...lectura, pruebas, sha256: sha, perfil } as LecturaPdf, season, fechas);
      const hechoDe = new Map<PruebaPdf, HechosPrueba>();
      for (const h of conv.hechos) {
        const p = pruebas.find((x) => h.competition.competitionKey === `pdf:${docId}:${x.clave}`);
        if (p) hechoDe.set(p, h);
      }
      const candidatos: { h: HechosPrueba; pruebas: PruebaPdf[]; fases: { h1: HechosPrueba; h2: HechosPrueba } | null }[] = [];
      for (const f of fases) {
        const h1 = hechoDe.get(f.primera);
        const h2 = hechoDe.get(f.final);
        const conSkermo = medidas.some((m) => m.source === 'skermo_rfee' && m.weapon === f.final.arma && m.gender === f.final.genero && m.pdfs.includes(url));
        if (h1 && h2) candidatos.push({ h: combinarFases(h1, h2, docId, conSkermo), pruebas: [f.primera, f.final], fases: { h1, h2 } });
      }
      for (const [p, h] of hechoDe) if (!enFases.has(p) && h.competition.format === 'INDIVIDUAL') candidatos.push({ h, pruebas: [p], fases: null });

      for (const c of candidatos) {
        const comp = c.h.competition;
        const mismas = (guardados.get(url) ?? []).filter((g) => g.weapon === comp.weapon && g.gender === comp.gender);
        // Asaltos ya guardados de este PDF en lecturas de esta prueba (o, en dos fases, de sus partes).
        const fuentes = c.fases
          ? partesSustituibles(mismas, c.h, firmasDe).map((p) => p.g).concat(mismas.filter((g) => g.source !== 'rfee_pdf' && g.category === comp.category))
          : mismas.filter((g) => g.category === comp.category);
        const previos: (AsaltoGuardado & { grupo: string; pista: 1 | 2 | null })[] = [];
        for (const g of fuentes) {
          const pista = faseDeClave(g.key);
          for (const b of asaltosDe.all(g.id) as (AsaltoGuardado & { u: string | null })[]) {
            if (b.u && sinFragmento(b.u) === url) previos.push({ ...b, grupo: `${g.id}|${b.phase === 'POULE' ? b.roundKey : 'T'}`, pista });
          }
        }
        let faseDe: ((a: AsaltoGuardado) => 1 | 2 | null) | null = null;
        if (c.fases) {
          // Una poule guardada va entera a la fase que dicen la mayoría de sus asaltos.
          const porTirador = faseSegunTiradores(c.fases.h1.results, c.fases.h2.results);
          const votos = new Map<string, number[]>();
          for (const b of previos) votos.set(b.grupo, [...(votos.get(b.grupo) ?? []), porTirador(b) ?? 0]);
          const decision = new Map([...votos].map(([k, vs]) => {
            const uno = vs.filter((v) => v === 1).length;
            const dos = vs.filter((v) => v === 2).length;
            return [k, uno > 3 * dos ? 1 : dos > 3 * uno ? 2 : null] as const;
          }));
          // El cuadro de una lectura partida es de una sola fase: si la mayoría lo dice, también
          // valen los cruces cuyos tiradores no lo deciden (clasificación de la 1ª leída a medias).
          faseDe = (a) => {
            const { grupo, pista } = a as AsaltoGuardado & { grupo: string; pista: 1 | 2 | null };
            if (pista) return pista;
            return grupo.endsWith('|T') ? decision.get(grupo) ?? porTirador(a) : decision.get(grupo) ?? null;
          };
        }
        const vueltas = Math.max(1, ...(c.fases?.h1.bouts ?? []).filter((b) => b.phase === 'POULE').map((b) => Number(NUMERO_VUELTA.exec(b.roundKey)?.[1] ?? 1)));
        const completado = completarConGuardado(c.h, previos, faseDe, vueltas, c.fases?.h1.results ?? []);
        const { hechos: h, problemas } = validarHechos(completado.hechos);
        if (completado.descartados > 0) problemas.guardados_no_incorporados = completado.descartados;
        const nP = h.bouts.filter((b) => b.phase === 'POULE').length;
        const nT = h.bouts.filter((b) => b.phase === 'TABLEAU').length;
        const guardado = { poules: Math.max(0, ...mismas.map((g) => g.poules)), cuadro: Math.max(0, ...mismas.map((g) => g.cuadro)) };
        const recuperados = c.pruebas.flatMap((p) => recuperadosDe.get(p) ?? []);
        const medidaP = medirPoules(h.bouts);
        const medidaC = medirCuadro(h.bouts, { resultados: h.results.length, conPoules: nP > 0 });
        const fila: FilaInforme = {
          url, fichero: null, competitionKey: comp.competitionKey, weapon: comp.weapon, gender: comp.gender, category: comp.category,
          fases: c.fases !== null, resultados: h.results.length, poules: nP, cuadro: nT, guardado,
          recuperados: { poules: recuperados.filter((a: AsaltoPdf) => a.fase === 'POULE').length, cuadro: recuperados.filter((a: AsaltoPdf) => a.fase === 'TABLEAU').length },
          medida: { poules: `${medidaP.asaltos}/${medidaP.esperados}`, cuadro: `${medidaC.asaltos}/${medidaC.esperados}` },
          problemas, escrito: false, motivo: '',
        };
        // En dos fases, la unida sustituye a las lecturas partidas: sólo si contiene lo que traen.
        const partes = c.fases ? partesSustituibles(mismas, h, firmasDe) : [];
        // Lo que la unida no contiene choca con ella (ronda llena, cruce incoherente o pareja con otro marcador).
        const perdida = partes.find((p) => p.contenido < 0.85 && (1 - p.contenido) * (p.g.poules + p.g.cuadro) > 2);
        const mejora = c.fases ? !perdida : nP > guardado.poules || nT > guardado.cuadro;
        if (!mejora) {
          fila.motivo = perdida
            ? `dos_fases_peor_que_lo_guardado:${perdida.g.key} (${Math.round(perdida.contenido * 100)} % de sus ${perdida.g.poules + perdida.g.cuadro} asaltos)`
            : 'no_mejora_lo_guardado';
          informe.push(fila);
          if (descartadas && c.fases) writeFileSync(join(descartadas, nombreUnico(h, new Set())), JSON.stringify(h, null, 1), 'utf8');
          continue;
        }
        const nombre = nombreUnico(h, usados);
        writeFileSync(join(salida, nombre), JSON.stringify(h, null, 1), 'utf8');
        escritos.add(nombre);
        fila.fichero = nombre;
        fila.escrito = true;
        fila.motivo = c.fases ? 'dos_fases_unidas' : nP > guardado.poules && nT > guardado.cuadro ? 'mas_poules_y_cuadro' : nP > guardado.poules ? 'mas_poules' : 'mas_cuadro';
        informe.push(fila);
        if (c.fases) {
          for (const { g } of partes) {
            sustituidas.push({
              source: g.source, season: g.season, competitionKey: g.key, id: g.id, porCompetitionKey: comp.competitionKey,
              motivo: `lectura parcial de un PDF en dos fases (${g.poules} poules, ${g.cuadro} cuadro, ${g.resultados} puestos)`,
            });
          }
        }
      }
    } catch (e) {
      errores.push({ url, error: e instanceof Error ? e.message : String(e) });
    }
  }
  db.close();
  for (const f of readdirSync(salida)) if (f.endsWith('.json') && !f.startsWith('_') && !escritos.has(f)) unlinkSync(join(salida, f));

  const correcciones: Correcciones = {
    generadoEn: new Date().toISOString(),
    sustituidas,
    atributos: CORRECCIONES_CONOCIDAS.atributos.map((a) => ({ ...a, id: idDe.get(`${a.source}|${a.season}|${a.competitionKey}`) ?? null })),
    catalogo: CORRECCIONES_CONOCIDAS.catalogo,
  };
  escribirJson(join(salida, '_correcciones.json'), correcciones);
  const resumen = {
    generadoEn: new Date().toISOString(),
    segundos: Math.round((Date.now() - t0) / 1000),
    pruebasIncompletas: incompletas.length,
    pdfs: urls.length,
    ficheros: escritos.size,
    pruebasDosFases: informe.filter((f) => f.fases && f.escrito).length,
    asaltosRecuperados: informe.filter((f) => f.escrito).reduce((n, f) => ({ poules: n.poules + f.recuperados.poules, cuadro: n.cuadro + f.recuperados.cuadro }), { poules: 0, cuadro: 0 }),
    mejoraSobreGuardado: informe.filter((f) => f.escrito).reduce((n, f) => ({
      poules: n.poules + Math.max(0, f.poules - f.guardado.poules), cuadro: n.cuadro + Math.max(0, f.cuadro - f.guardado.cuadro),
    }), { poules: 0, cuadro: 0 }),
    sustituidas: sustituidas.length,
    problemas: informe.reduce<Record<string, number>>((m, f) => {
      for (const [k, n] of Object.entries(f.problemas)) m[k] = (m[k] ?? 0) + n;
      return m;
    }, {}),
    errores,
  };
  escribirJson(join(salida, '_informe.json'), { ...resumen, filas: informe });
  console.log(JSON.stringify(resumen, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
