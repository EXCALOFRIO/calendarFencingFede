/**
 * Auditoría completa del organismo `rfee` de Engarde (https://engarde-service.com/organism/rfee),
 * todas las temporadas: cada prueba publicada se compara con su equivalente en nuevo7 (cualquier
 * fuente) y en los hechos de los demás lotes 7 (`hechos/lote7-*`), y se escriben en
 * `hechos/lote7-engarde-rfee/` las pruebas que faltan enteras y las que existen sin alguna fase
 * (clasificación, poules, cuadro, encuentros de equipos) que Engarde sí publica.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-engarde-rfee.ts [--db <nuevo7.sqlite>] [--solo-indices]
 *
 * Equivalente: misma clave `engarde:rfee/{evt}/{compe}` o mismo arma, categoría, modalidad,
 * género compatible, fecha a ±2 días y división de liga; en individual, además, al menos el
 * 30 % de los nombres de la lista menor compatibles (si las dos tienen ≥4 nombres).
 *
 * Qué se escribe (claves de Engarde, `engarde:rfee/{evt}/{compe}`):
 *  - falta entera → la prueba completa;
 *  - existe con la misma clave → la prueba completa; el cargador rellena por sección;
 *  - existe en otra fuente, individual, con ≥50 % de nombres compatibles → la prueba completa;
 *    `dedupe-pruebas.ts` traslada la fase con más asaltos a la prueba que queda;
 *  - existe en otra fuente por equipos, o con pocos nombres en común → no se escribe (sería un
 *    duplicado que nada fusiona); se lista en el informe.
 *
 * Páginas: primero las cachés de descargas anteriores (sólo lectura), si se guardaron después
 * de acabar el torneo; si no, la red educada del lote 7.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import type { AsaltoHecho, HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { parsearPaginaEngarde, parsearTorneoEngarde, urlPruebaEngarde, urlTorneoEngarde } from '../../src/lib/ingest/sources/engarde';
import { categoriasDeTitulo, tipoDocumentoEngarde } from '../../src/lib/ingest/sources/engarde-antiguo';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import { convertirPrueba, temporadaRfee, type Paginas, type PruebaIndice } from './engarde-a-hechos';
import { claveCache, paginasDePrueba } from './engarde-descargar';
import { encuentrosEngarde, podioDe, refsEquipos, type Documento } from './lote7-equipos-engarde';
import { abrirNuevo7, dia, EscritorHechos, NUEVO7 } from './lote7-faltan-comun';
import { divisionLiga, indice, listaFresca, validarAtributos, type Atributos } from './lote7-faltan-engarde';
import { Red } from './lote7-faltan-red';

export const SALIDA_ENGARDE_RFEE = join(CARPETA_TRABAJO, 'hechos', 'lote7-engarde-rfee');
const HECHOS = join(CARPETA_TRABAJO, 'hechos');
const SEMILLAS = [
  join(CARPETA_TRABAJO, 'engarde', 'raw'),
  join(CARPETA_TRABAJO, 'cache-asaltos-rfee', 'engarde', 'raw'),
  join(CARPETA_TRABAJO, 'engarde-historico', 'raw'),
];

/** Cachés de descargas anteriores de Engarde (`claveCache`), sólo lectura. */
class Semillas {
  private readonly porClave = new Map<string, { ruta: string; en: string }>();

  constructor(carpetas: readonly string[]) {
    for (const c of carpetas) {
      const reg = join(c, '_registro.jsonl');
      if (!existsSync(reg)) continue;
      for (const l of readFileSync(reg, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        const r = JSON.parse(l) as { clave: string; status: number; fichero: string | null; en: string };
        if (r.status === 200 && r.fichero && !this.porClave.has(r.clave)) this.porClave.set(r.clave, { ruta: join(c, r.fichero), en: r.en });
      }
    }
  }

  /** Página guardada al menos un día después de `fin` (el torneo ya había terminado). */
  leer(clave: string, fin: string | null): string | null {
    const r = this.porClave.get(clave);
    if (!r || !existsSync(r.ruta)) return null;
    if (fin && r.en.slice(0, 10) <= fin) return null;
    return readFileSync(r.ruta, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Equivalentes en nuevo7 y en los demás lotes
// ---------------------------------------------------------------------------

export type Equivalente = {
  origen: 'nuevo7' | string;
  source: string;
  key: string;
  weapon: string;
  gender: string;
  category: string;
  format: string;
  d: number;
  division: string | null;
  resultados: number;
  poules: number;
  cuadro: number;
  nombres: () => string[];
};

/** Nombres compatibles: mismo nombre normalizado, o uno contenido en el otro con ≥2 palabras en común. */
export function nombresCompatibles(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = a.split(' ').filter((x) => x.length > 1);
  const pb = new Set(b.split(' ').filter((x) => x.length > 1));
  const comunes = pa.filter((x) => pb.has(x)).length;
  return comunes >= 2 && (comunes === pa.length || comunes === pb.size || comunes >= 3);
}

/** Fracción de los nombres de la lista menor con un nombre compatible en la otra; null si alguna tiene <4. */
export function solapeNombres(a: readonly string[], b: readonly string[]): number | null {
  const [menor, mayor] = a.length <= b.length ? [a, b] : [b, a];
  if (menor.length < 4) return null;
  const exactos = new Set(mayor);
  let n = 0;
  for (const x of menor) if (exactos.has(x) || mayor.some((y) => nombresCompatibles(x, y))) n += 1;
  return n / menor.length;
}

export function compatible(e: Atributos, c: Pick<Equivalente, 'weapon' | 'gender' | 'category' | 'format' | 'd' | 'division'>, margen = 2): boolean {
  return e.weapon === c.weapon && e.category === c.category && e.format === c.format && Math.abs(dia(e.fecha) - c.d) <= margen &&
    (e.gender === c.gender || e.gender === 'MIXTO' || c.gender === 'MIXTO') &&
    (!e.division || !c.division || e.division === c.division);
}

export function equivalentesNuevo7(db: ReturnType<typeof abrirNuevo7>): Equivalente[] {
  const nombres = db.prepare(`SELECT source_name n FROM sport_result WHERE competition_id=?
    UNION SELECT fencer_a_name FROM sport_bout WHERE competition_id=? UNION SELECT fencer_b_name FROM sport_bout WHERE competition_id=?`);
  const filas = db.prepare(`
    SELECT c.id, c.source, c.competition_key k, c.weapon, c.gender, c.category, c.format, coalesce(c.competition_date, e.start_date) f,
           e.name || ' ' || coalesce(c.category_raw, '') || ' ' || c.competition_key texto,
           (SELECT count(*) FROM sport_result r WHERE r.competition_id = c.id) nr,
           (SELECT count(*) FROM sport_bout b WHERE b.competition_id = c.id AND b.phase = 'POULE') np,
           (SELECT count(*) FROM sport_bout b WHERE b.competition_id = c.id AND b.phase = 'TABLEAU') nt
      FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE coalesce(c.competition_date, e.start_date) IS NOT NULL AND c.category NOT IN ('OTRA')`).all() as Record<string, string | number>[];
  return filas.map((r) => {
    let cache: string[] | null = null;
    const id = String(r.id);
    return {
      origen: 'nuevo7', source: String(r.source), key: String(r.k), weapon: String(r.weapon), gender: String(r.gender),
      category: String(r.category), format: String(r.format), d: dia(String(r.f)),
      division: r.format === 'EQUIPOS' ? divisionLiga(String(r.texto)) : null,
      resultados: Number(r.nr), poules: Number(r.np), cuadro: Number(r.nt),
      nombres: () => (cache ??= (nombres.all(id, id, id) as { n: string }[]).map((x) => normalizeSportName(x.n)).filter(Boolean)),
    };
  });
}

function* ficherosHechos(carpeta: string): Generator<string> {
  for (const f of readdirSync(carpeta)) {
    const ruta = join(carpeta, f);
    if (statSync(ruta).isDirectory()) yield* ficherosHechos(ruta);
    else if (f.endsWith('.json') && !f.startsWith('_')) yield ruta;
  }
}

/** Hechos ya escritos por los demás lotes 7 (otras carpetas `hechos/lote7-*`), sólo lectura. */
export function equivalentesLotes(excluir: readonly string[]): Equivalente[] {
  const out: Equivalente[] = [];
  if (!existsSync(HECHOS)) return out;
  for (const c of readdirSync(HECHOS)) {
    if (!c.startsWith('lote7-') || excluir.includes(c)) continue;
    for (const ruta of ficherosHechos(join(HECHOS, c))) {
      let h: HechosPrueba;
      try {
        h = JSON.parse(readFileSync(ruta, 'utf8')) as HechosPrueba;
      } catch {
        continue;
      }
      const comp = h?.competition;
      const fecha = comp?.date ?? h?.edition?.startDate;
      if (!comp || !fecha) continue;
      const nombres = [...new Set([...h.results.map((r) => r.name), ...h.bouts.flatMap((b) => [b.aName, b.bName])].map(normalizeSportName).filter(Boolean))];
      out.push({
        origen: c, source: h.source, key: comp.competitionKey, weapon: comp.weapon, gender: comp.gender, category: comp.category,
        format: comp.format, d: dia(fecha), division: comp.format === 'EQUIPOS' ? divisionLiga(`${h.edition.name} ${comp.categoryRaw ?? ''} ${comp.competitionKey}`) : null,
        resultados: h.results.length, poules: h.bouts.filter((b) => b.phase === 'POULE').length,
        cuadro: h.bouts.filter((b) => b.phase === 'TABLEAU').length, nombres: () => nombres,
      });
    }
  }
  return out;
}

export type Cobertura = { resultados: number; poules: number; cuadro: number };

/** Fases que Engarde publica y el equivalente no tiene o tiene claramente incompletas (<90 % y ≥3 filas menos). */
export function fasesQueFaltan(e: Cobertura, c: Cobertura): (keyof Cobertura)[] {
  return (['resultados', 'poules', 'cuadro'] as const).filter((k) => e[k] > 0 && (c[k] === 0 || (c[k] < e[k] * 0.9 && e[k] - c[k] >= 3)));
}


/** `dedupe-pruebas.ts` sólo une una prueba de Engarde con una de estas fuentes (nunca con FIE ni con otra de Engarde). */
const FUSIONA_CON_ENGARDE = new Set(['skermo_rfee', 'rfee_pdf']);

/** Engarde publica 2012-01-01 como fecha de relleno en torneos antiguos; no es una fecha real. */
const FECHA_RELLENO = '2012-01-01';
const fechaReal = (f: string | null | undefined): string | null => (f && /^\d{4}-\d{2}-\d{2}$/.test(f) && f !== FECHA_RELLENO ? f : null);

/** Fecha de la prueba: la del índice, si no la de su página publicada y, si no, la de la lista de torneos. */
export function fechaDePrueba(indice: string | null, portada: string | null, lista: string | null | undefined): string | null {
  return fechaReal(indice) ?? fechaReal(portada ? parsearPaginaEngarde(portada).fecha : null) ?? fechaReal(lista);
}

/** Eventos del circuito europeo (EFC) alojados en el organismo rfee: van con fuente `efc` (`lote7-efc.ts`). */
export function esEventoEfc(titulo: string | null | undefined, evt: string): boolean {
  return /\b(efc|ecc)\b|europe|europa|circuito europeo|cadet circuit|circuit europ/i.test(titulo ?? '') || /(^|[^a-z])(efc|ecc)([^a-z]|$)/i.test(evt);
}

const plano = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * Grupo de edad dentro de la categoría que nombra el título (o, sin título, el código): año
 * de nacimiento en el Criterium Nacional («FLORETE MIXTO 2014-2015») o tramo de veteranos
 * («ESPADA FEM 50 60»). Dos pruebas con grupos distintos son pruebas distintas, no fases.
 */
export function grupoEdad(texto: string, categoria: string): string | null {
  const t = plano(texto.replace(/_/g, ' ').replace(/([a-z])(\d)/gi, '$1 $2'));
  const anios = [...t.matchAll(/\b(19[4-9]\d|20[0-2]\d)\b/g)].map((m) => m[1]);
  for (const m of t.matchAll(/\b(20[0-2]\d) (\d{2})\b/g)) {
    if (Number(m[2]) === (Number(m[1]) + 1) % 100) anios.push(`20${m[2]}`);
  }
  if (anios.length > 0) return `N${[...new Set(anios)].sort().join('-')}`;
  if (categoria === 'VET') {
    const v = [...t.matchAll(/\b(30|40|50|60|70)\b/g)].map((m) => m[1]);
    if (v.length > 0) return `V${[...new Set(v)].sort().join('-')}`;
    const g = /\bGRUPO ([A-D])\b/.exec(t) ?? /\bGR ([A-D])\b/.exec(t);
    if (g) return `G${g[1]}`;
  }
  return null;
}

/**
 * Arma y género de una prueba de veteranos que los da en forma abreviada en el título
 * («VETERANOS EF40») o en el código («efv_40», «smv_60»), que `validarAtributos` no lee.
 */
export function armaGeneroVeteranos(titulo: string, compe: string): { weapon: string; gender: string } | null {
  const m = /\b([EFS])([FM])\s?(30|40|50|60|70)\b/.exec(plano(titulo)) ?? /^([efs])([fm])v(?:et)?[_-]?\d/i.exec(compe);
  if (!m) return null;
  return { weapon: { E: 'ESPADA', F: 'FLORETE', S: 'SABLE' }[m[1].toUpperCase() as 'E' | 'F' | 'S'], gender: m[2].toUpperCase() === 'F' ? 'F' : 'M' };
}

const contenido = (g: string | null) => (g ? g.slice(1).split('-') : []);
/** Un grupo contenido en otro distinto («V60» en «V50-60»): un tablón por tramo de una prueba común. */
export const gruposSolapados = (a: string | null, b: string | null): boolean =>
  !!a && !!b && a !== b && a[0] === b[0] && (contenido(a).every((x) => contenido(b).includes(x)) || contenido(b).every((x) => contenido(a).includes(x)));

const CATEGORIA_CODIGO: [RegExp, string][] = [
  [/(^|[^0-9])13([^0-9]|$)/, 'M13'], [/(^|[^0-9])14([^0-9]|$)/, 'M14'], [/(^|[^0-9])15([^0-9]|$)/, 'M15'],
  [/(^|[^0-9])17([^0-9]|$)|cad/, 'M17'], [/(^|[^0-9])20([^0-9]|$)|jun|jr/, 'M20'], [/(^|[^0-9])23([^0-9]|$)/, 'M23'],
  [/abs|sen/, 'ABS'], [/vet/, 'VET'],
];

/**
 * Atributos de una prueba antigua cuyo índice no trae título y repite los valores por defecto
 * (espada masculina): arma y género del código («ff17i», «sm_eq», «efe»), modalidad de su
 * sufijo (i/ind, e/eq) y categoría de los dígitos del código o, si no, del título del torneo.
 */
export function atributosDeCodigo(compe: string, tituloTorneo: string): { weapon: string; gender: string; category: string; individual: boolean } | null {
  const m = /^([efs])([fm])(.*)$/i.exec(compe);
  if (!m) return null;
  const resto = m[3].toLowerCase();
  const eq = /eq|equip/.test(resto) || /(^|[0-9_-])e$/.test(resto);
  const ind = /ind/.test(resto) || /(^|[0-9_-])i$/.test(resto);
  if (eq === ind) return null;
  const porCodigo = CATEGORIA_CODIGO.filter(([re]) => re.test(resto)).map(([, c]) => c);
  const porTitulo = categoriasDeTitulo(tituloTorneo);
  const category = porCodigo.length === 1 ? porCodigo[0] : porCodigo.length === 0 && porTitulo.length === 1 ? porTitulo[0] : null;
  if (!category) return null;
  return { weapon: { e: 'ESPADA', f: 'FLORETE', s: 'SABLE' }[m[1].toLowerCase() as 'e' | 'f' | 's'], gender: m[2].toLowerCase() === 'f' ? 'F' : 'M', category, individual: ind };
}

/**
 * Une en una prueba las fases que Engarde publica como pruebas separadas («1ª FASE» y «FASE
 * FINAL», «Poules» y «Tablón»): la clasificación es la del miembro con más puestos; cada fase,
 * la del miembro con más asaltos de esa fase, con sus tiradores llevados por nombre a los
 * puestos de la clasificación. Los asaltos de un tirador sin puesto se descartan.
 */
export function fusionarFases(miembros: readonly HechosPrueba[]): HechosPrueba | null {
  const conPuestos = miembros.filter((h) => h.results.length > 0);
  if (conPuestos.length === 0) return null;
  const principal = [...conPuestos].sort((a, b) => b.results.length - a.results.length)[0];
  const porNombre = new Map<string, string | null>();
  for (const r of principal.results) {
    const n = normalizeSportName(r.name);
    porNombre.set(n, porNombre.has(n) ? null : r.factKey);
  }
  const h: HechosPrueba = structuredClone(principal);
  h.bouts = [];
  const otras = miembros.filter((x) => x !== principal).map((x) => x.competition.competitionKey);
  h.status.notes = [...principal.status.notes, `Fases publicadas en Engarde como pruebas separadas: ${[principal.competition.competitionKey, ...otras].join(', ')}`];
  for (const [fase, estado] of [['POULE', 'pools'], ['TABLEAU', 'tableau']] as const) {
    const origen = [...miembros].sort((a, b) => b.bouts.filter((x) => x.phase === fase).length - a.bouts.filter((x) => x.phase === fase).length)[0];
    const bouts = origen.bouts.filter((x) => x.phase === fase);
    if (bouts.length === 0) continue;
    if (origen === principal) {
      h.bouts.push(...bouts);
      h.status[estado] = principal.status[estado];
      continue;
    }
    let descartados = 0;
    for (const b of bouts) {
      const a = porNombre.get(normalizeSportName(b.aName));
      const c = porNombre.get(normalizeSportName(b.bName));
      if (!a || !c || a === c) {
        descartados += 1;
        continue;
      }
      h.bouts.push({ ...b, aRef: a, bRef: c });
    }
    h.status[estado] = descartados > 0 && origen.status[estado] === 'completo' ? 'parcial' : origen.status[estado];
    if (descartados > 0) h.status.notes.push(`${fase === 'POULE' ? 'Poules' : 'Cuadro'} de ${origen.competition.competitionKey}: ${descartados} asaltos con un tirador sin puesto en la clasificación`);
  }
  return h;
}

/**
 * Poules mixtas con tablón por género (Criterium Nacional: «Poules Florete Mixto 2011»,
 * «Tablón Florete Femenino 2011», «Tablón Florete Masculino 2011»): cada tablón es la prueba,
 * con su clasificación, y recibe los asaltos de poule entre dos tiradores de su clasificación.
 */
export function repartirPoulesMixtas(mixta: HechosPrueba, porGenero: readonly HechosPrueba[]): HechosPrueba[] {
  const poules = mixta.bouts.filter((b) => b.phase === 'POULE');
  return porGenero.map((g) => {
    const h: HechosPrueba = structuredClone(g);
    if (poules.length === 0 || h.bouts.some((b) => b.phase === 'POULE')) return h;
    const porNombre = new Map<string, string | null>();
    for (const r of h.results) {
      const n = normalizeSportName(r.name);
      porNombre.set(n, porNombre.has(n) ? null : r.factKey);
    }
    let n = 0;
    for (const b of poules) {
      const a = porNombre.get(normalizeSportName(b.aName));
      const c = porNombre.get(normalizeSportName(b.bName));
      if (!a || !c || a === c) continue;
      h.bouts.push({ ...b, aRef: a, bRef: c });
      n += 1;
    }
    if (n > 0) {
      // Las poules son mixtas: los asaltos contra tiradores del otro género no son de esta prueba.
      h.status.pools = 'parcial';
      h.status.notes.push(`Poules mixtas de ${mixta.competition.competitionKey}: ${n} asaltos entre tiradores de esta clasificación`);
    }
    return h;
  });
}

/** 1 para la primera fase de una prueba en dos fases («1ª FASE», «1FASE»), 2 para la final («FASE FINAL», «2ª FASE»). */
export function ordenFase(titulo: string): 1 | 2 | null {
  const t = plano(titulo);
  if (/\b(1 ?[AO]?|PRIMERA) ?FASE\b|\b1FASE\b/.test(t)) return 1;
  if (/\bFASE FINAL\b|\b(2 ?[AO]?|SEGUNDA) ?FASE\b|\b2FASE\b/.test(t)) return 2;
  return null;
}

/**
 * Prueba en dos fases publicada como dos pruebas: la clasificación es la de la fase final
 * más los tiradores que sólo están en la de la primera fase, con su puesto si queda por
 * detrás de los de la final; las poules de la primera fase son la vuelta 1 (`P<n>`) y las de
 * la final la vuelta 2 (`V2P<n>`); el cuadro es el de la final y el de la primera fase sólo
 * se añade si sus rondas no coinciden con las de la final.
 */
export function unirDosFases(primera: HechosPrueba, final: HechosPrueba): HechosPrueba | null {
  if (final.results.length === 0) return null;
  const h: HechosPrueba = structuredClone(final);
  const porNombre = new Map<string, string | null>();
  const anotarNombre = (n: string, k: string) => {
    const x = normalizeSportName(n);
    porNombre.set(x, porNombre.has(x) && porNombre.get(x) !== k ? null : k);
  };
  for (const r of h.results) anotarNombre(r.name, r.factKey);
  const ultimo = Math.max(0, ...h.results.map((r) => r.position ?? 0));
  const claves = new Set(h.results.map((r) => r.factKey));
  let anadidos = 0;
  for (const r of primera.results) {
    if (porNombre.has(normalizeSportName(r.name))) continue;
    if (r.position !== null && r.position <= ultimo) continue;
    const factKey = claves.has(r.factKey) ? `${r.factKey}|f1` : r.factKey;
    h.results.push({ ...r, factKey });
    claves.add(factKey);
    anotarNombre(r.name, factKey);
    anadidos += 1;
  }
  const ref = (n: string) => porNombre.get(normalizeSportName(n)) ?? null;
  const llevar = (b: AsaltoHecho, roundKey: string): AsaltoHecho | null => {
    const a = ref(b.aName);
    const c = ref(b.bName);
    return a && c && a !== c ? { ...b, roundKey, aRef: a, bRef: c } : null;
  };
  let descartados = 0;
  const bouts: AsaltoHecho[] = [];
  for (const b of primera.bouts.filter((x) => x.phase === 'POULE')) {
    const y = llevar(b, b.roundKey);
    if (y) bouts.push(y);
    else descartados += 1;
  }
  for (const b of final.bouts.filter((x) => x.phase === 'POULE')) {
    const y = llevar(b, b.roundKey.startsWith('V') ? b.roundKey : `V2${b.roundKey}`);
    if (y) bouts.push(y);
    else descartados += 1;
  }
  const rondasFinal = new Set(final.bouts.filter((x) => x.phase === 'TABLEAU').map((x) => x.roundKey));
  bouts.push(...final.bouts.filter((x) => x.phase === 'TABLEAU').map((b) => llevar(b, b.roundKey)).filter((x): x is AsaltoHecho => !!x));
  const cuadroPrimera = primera.bouts.filter((x) => x.phase === 'TABLEAU');
  const cuadroAparte = cuadroPrimera.length > 0 && cuadroPrimera.every((b) => !rondasFinal.has(b.roundKey));
  if (cuadroAparte) {
    for (const b of cuadroPrimera) {
      const y = llevar(b, b.roundKey);
      if (y) bouts.push(y);
      else descartados += 1;
    }
  }
  h.bouts = bouts;
  if (bouts.some((b) => b.phase === 'POULE')) h.status.pools = primera.status.pools === 'completo' && final.status.pools === 'completo' && descartados === 0 ? 'completo' : 'parcial';
  h.status.notes.push(
    `Prueba en dos fases publicada en Engarde como ${primera.competition.competitionKey} (1ª fase) y ${final.competition.competitionKey} (final)`,
    ...(anadidos > 0 ? [`${anadidos} puestos de la 1ª fase que no llegan a la final`] : []),
    ...(cuadroPrimera.length > 0 && !cuadroAparte ? ['El cuadro de la 1ª fase repite rondas del de la final y no se incluye'] : []),
    ...(descartados > 0 ? [`${descartados} asaltos con un tirador sin puesto en la clasificación`] : []),
  );
  if (h.status.publishedParticipants !== null) h.status.publishedParticipants = h.results.length;
  return h;
}

// ---------------------------------------------------------------------------

type Prueba = { p: PruebaIndice; k: string; atributos: Atributos; grupo: string | null; nota: string | null };
type Convertida = Prueba & { h: HechosPrueba };

async function main(): Promise<void> {
  const soloIndices = bandera('solo-indices');
  const db = abrirNuevo7(argumento('db', NUEVO7));
  const base = equivalentesNuevo7(db);
  const lotes = equivalentesLotes(['lote7-engarde-rfee', 'lote7-efc']);
  const porKey = new Map<string, Equivalente[]>();
  for (const e of [...base, ...lotes]) (porKey.get(e.key) ?? porKey.set(e.key, []).get(e.key)!).push(e);
  const red = new Red();
  const semillas = new Semillas(SEMILLAS);
  const escritor = new EscritorHechos('lector_engarde', SALIDA_ENGARDE_RFEE);
  const hoy = new Date().toISOString().slice(0, 10);

  const torneos = (await listaFresca(red, 'rfee')).filter((t, i, xs) => xs.findIndex((x) => x.Event === t.Event) === i);

  const motivos: Record<string, number> = {};
  const anotar = (m: string, n = 1) => (motivos[m] = (motivos[m] ?? 0) + n);
  const detalle: Record<string, unknown>[] = [];
  const porTorneo: Record<string, unknown>[] = [];
  const totales = { pruebasPublicadas: 0, pruebasLeidas: 0, resultados: 0, poules: 0, cuadro: 0, encuentrosEquipos: 0 };
  const escritos = { faltaEntera: 0, fases: 0, fasesUnidas: 0, resultados: 0, poules: 0, cuadro: 0, encuentrosEquipos: 0 };

  for (const t of torneos) {
    const org = 'rfee';
    const evt = t.Event;
    const pruebas = await indice(red, org, evt);
    const fechas = pruebas.map((p) => fechaReal(p.fecha)).filter((f): f is string => !!f).sort();
    const fin = fechas.at(-1) ?? fechaReal(t.date);
    porTorneo.push({ evt, titulo: t.Titre, fechaLista: t.date, pruebas: pruebas.length, inicio: fechas[0] ?? null, fin });
    totales.pruebasPublicadas += pruebas.length;
    if (pruebas.length === 0) {
      anotar('torneo_sin_indice');
      continue;
    }
    if (soloIndices) continue;
    if (fin && fin >= hoy) {
      anotar('torneo_sin_terminar', pruebas.length);
      continue;
    }
    if (esEventoEfc(t.Titre, evt)) {
      anotar('evento_efc', pruebas.length);
      detalle.push({ torneo: `${org}/${evt}`, titulo: t.Titre, motivo: 'evento_efc' });
      continue;
    }
    let nombre: string | null = null;
    const validas: Prueba[] = [];
    const portadas = new Map<string, string | null>();
    const traerDe = (compe: string) => async (pagina: string, url: string): Promise<string | null> => {
      const s = semillas.leer(claveCache(org, evt, compe, pagina), fin);
      if (s !== null) return s;
      const r = await red.get(url);
      return r.status === 200 ? r.body.toString('utf8') : null;
    };
    for (const p0 of pruebas) {
      const k = `engarde:${org}/${evt}/${p0.compe}`;
      const portada = await traerDe(p0.compe)('prueba.html', urlPruebaEngarde(org, evt, p0.compe));
      portadas.set(p0.compe, portada);
      if (portada !== null && /currently has no data/i.test(portada)) {
        anotar('engarde_sin_datos');
        detalle.push({ prueba: k, titulo: p0.titulo, fecha: p0.fecha, motivo: 'engarde_sin_datos' });
        continue;
      }
      const p = { ...p0, fecha: fechaDePrueba(p0.fecha, portada, t.date) };
      const legado = !p.titulo?.trim() && p.fecha ? atributosDeCodigo(p.compe, t.Titre ?? '') : null;
      if (legado && p.fecha) {
        const a: Atributos = { weapon: legado.weapon, gender: legado.gender, category: legado.category, format: legado.individual ? 'INDIVIDUAL' : 'EQUIPOS', fecha: p.fecha, division: null };
        validas.push({
          p: { ...p, arma: a.weapon as PruebaIndice['arma'], generoFinal: a.gender as PruebaIndice['generoFinal'], categoriaFinal: a.category as PruebaIndice['categoriaFinal'], individual: legado.individual },
          k, atributos: a, grupo: grupoEdad(p.compe, a.category),
          nota: `Arma, género, categoría y modalidad deducidos del código «${p.compe}» y del título del torneo «${t.Titre}»; el índice de Engarde no trae título y decía ${p0.arma} ${p0.generoFinal} ${p0.categoriaFinal}`,
        });
        continue;
      }
      const v = validarAtributos(p);
      if (!v.ok) {
        anotar(v.motivo);
        detalle.push({ prueba: k, titulo: p.titulo, indice: `${p.arma} ${p.generoFinal} ${p.categoriaFinal} ${p.individual}`, motivo: v.motivo });
        continue;
      }
      let a = v.atributos;
      let nota = v.corregido ? `Arma, género y categoría según el título publicado «${p.titulo}»; el índice de Engarde decía ${p.arma} ${p.generoFinal} ${p.categoriaFinal}` : null;
      const vet = a.category === 'VET' ? armaGeneroVeteranos(p.titulo ?? '', p.compe) : null;
      if (vet && (vet.weapon !== a.weapon || vet.gender !== a.gender)) {
        nota = `Arma y género según la abreviatura del título «${p.titulo}» o del código «${p.compe}»; el índice de Engarde decía ${p0.arma} ${p0.generoFinal}`;
        a = { ...a, ...vet };
      }
      // La Liga Nacional de Clubes (oro, plata, bronce, Iberdrola, 4ª división) es por equipos aunque el índice diga individual.
      if (a.division && a.format === 'INDIVIDUAL') {
        nota = [nota, 'Prueba de liga por equipos marcada como individual en el índice de Engarde'].filter(Boolean).join('; ');
        a = { ...a, format: 'EQUIPOS' };
      }
      validas.push({
        p: {
          ...p, arma: a.weapon as PruebaIndice['arma'], generoFinal: a.gender as PruebaIndice['generoFinal'], categoriaFinal: a.category as PruebaIndice['categoriaFinal'],
          individual: a.format === 'INDIVIDUAL',
        },
        k, atributos: a, grupo: grupoEdad(p.titulo?.trim() ? p.titulo : p.compe, a.category), nota,
      });
    }

    // Lectura de cada prueba válida.
    const convertidas: Convertida[] = [];
    for (const x of validas) {
      const { p, k, atributos } = x;
      const traer = traerDe(p.compe);
      const portada = portadas.get(p.compe) ?? null;
      if (portada === null) {
        anotar('sin_pagina_de_prueba');
        detalle.push({ prueba: k, motivo: 'sin_pagina_de_prueba' });
        continue;
      }
      if (/currently has no data/i.test(portada)) {
        anotar('engarde_sin_datos');
        detalle.push({ prueba: k, titulo: p.titulo, fecha: p.fecha, motivo: 'engarde_sin_datos' });
        continue;
      }
      const paginas: Paginas = { prueba: portada, clasfinal: null, poules: [], cuadros: [], faltan: [] };
      const docs: Documento[] = [];
      for (const f of paginasDePrueba(portada, org, evt, p.compe).slice(0, 24)) {
        const url = `${urlPruebaEngarde(org, evt, p.compe)}/${f}`;
        const cuerpo = await traer(f, url);
        if (cuerpo === null) {
          paginas.faltan.push(f);
          continue;
        }
        const np = f.match(/^poules(\d+)\.htm$/i);
        if (/^clasfinal\.htm$/i.test(f)) paginas.clasfinal = cuerpo;
        else if (np) paginas.poules.push({ pagina: Number(np[1]), html: cuerpo });
        else paginas.cuadros.push({ url, html: cuerpo });
        const tipo = tipoDocumentoEngarde(f);
        if (tipo === 'poules' || tipo === 'cuadro') docs.push({ url, html: cuerpo, tipo, pagina: np ? Number(np[1]) : 1, antiguo: false });
      }
      if (nombre === null) {
        const tor = semillas.leer(claveCache(org, evt, null, 'torneo.html'), null) ??
          ((r) => (r.status === 200 ? r.body.toString('utf8') : null))(await red.get(urlTorneoEngarde(org, evt)));
        nombre = (tor ? parsearTorneoEngarde(tor).nombre : null) ?? t.Titre?.trim() ?? `${org}/${evt}`;
      }
      const ctx = { season: temporadaRfee(atributos.fecha), nombreTorneo: nombre, inicio: fechas[0] ?? atributos.fecha, fin: fin ?? atributos.fecha, ciudad: p.ciudad };
      const r = convertirPrueba(p, paginas, ctx);
      let h: HechosPrueba | null = r.ok ? r.hechos : null;
      if (atributos.format === 'EQUIPOS' && docs.length > 0) {
        const refs = h && h.results.length > 0 ? refsEquipos(h.results) : (n: string) => (normalizeSportName(n) ? `engarde:equipo:${normalizeSportName(n)}` : null);
        const eq = encuentrosEngarde(docs, paginas.faltan, refs, podioDe(h?.results ?? []));
        if (eq.bouts.length > 0) {
          h ??= equiposSinClasificacion(p, portada, ctx);
          h.bouts = eq.bouts as AsaltoHecho[];
          h.status.pools = eq.pools;
          h.status.tableau = eq.tableau;
          h.status.notes = h.status.notes.filter((n) => !/no se importan asaltos individuales/.test(n)).concat(eq.notas);
        }
      }
      if (!h) {
        anotar(r.ok ? 'sin_hechos' : r.motivo);
        detalle.push({ prueba: k, titulo: p.titulo, fecha: p.fecha, motivo: r.ok ? 'sin_hechos' : r.motivo });
        continue;
      }
      if (x.nota) h.status.notes.push(x.nota);
      totales.pruebasLeidas += 1;
      totales.resultados += h.results.length;
      totales.poules += h.bouts.filter((b) => b.phase === 'POULE').length;
      totales.cuadro += h.bouts.filter((b) => b.phase === 'TABLEAU').length;
      if (atributos.format === 'EQUIPOS') totales.encuentrosEquipos += h.bouts.length;
      convertidas.push({ ...x, h });
    }

    // Fases de una misma prueba publicadas por separado: mismo arma, categoría, modalidad,
    // fecha, división y grupo de edad. Un grupo contenido en otro no se sabe repartir.
    const padre = convertidas.map((_, i) => i);
    const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
    const ambiguas = new Set<number>();
    const compat = (a: Atributos, b: Atributos) =>
      a.weapon === b.weapon && a.category === b.category && a.format === b.format && Math.abs(dia(a.fecha) - dia(b.fecha)) <= 2 &&
      (a.gender === b.gender || a.gender === 'MIXTO' || b.gender === 'MIXTO') && (a.division ?? null) === (b.division ?? null);
    for (let i = 0; i < convertidas.length; i += 1) {
      for (let j = i + 1; j < convertidas.length; j += 1) {
        if (!compat(convertidas[i].atributos, convertidas[j].atributos)) continue;
        if (convertidas[i].grupo === convertidas[j].grupo) padre[raiz(i)] = raiz(j);
        else if (gruposSolapados(convertidas[i].grupo, convertidas[j].grupo) || !convertidas[i].grupo || !convertidas[j].grupo) {
          ambiguas.add(i);
          ambiguas.add(j);
        }
      }
    }
    const grupos = new Map<number, number[]>();
    for (let i = 0; i < convertidas.length; i += 1) (grupos.get(raiz(i)) ?? grupos.set(raiz(i), []).get(raiz(i))!).push(i);

    for (const miembros of grupos.values()) {
      if (miembros.some((i) => ambiguas.has(i))) {
        for (const i of miembros) {
          anotar('fases_ambiguas');
          detalle.push({ prueba: convertidas[i].k, titulo: convertidas[i].p.titulo, grupo: convertidas[i].grupo, motivo: 'fases_ambiguas' });
        }
        continue;
      }
      const salidas: { h: HechosPrueba; x: Convertida; claves: string[] }[] = [];
      const mixtas = miembros.filter((i) => convertidas[i].atributos.gender === 'MIXTO');
      const conGenero = miembros.filter((i) => convertidas[i].atributos.gender !== 'MIXTO');
      if (miembros.length === 1) {
        const x = convertidas[miembros[0]];
        salidas.push({ h: x.h, x, claves: [x.k] });
      } else if (mixtas.length === 1 && conGenero.length > 0 && new Set(conGenero.map((i) => convertidas[i].atributos.gender)).size === conGenero.length &&
        conGenero.every((i) => convertidas[i].h.results.length > 0) && convertidas[miembros[0]].atributos.format === 'INDIVIDUAL') {
        const mixta = convertidas[mixtas[0]];
        const repartidas = repartirPoulesMixtas(mixta.h, conGenero.map((i) => convertidas[i].h));
        conGenero.forEach((i, n) => salidas.push({ h: repartidas[n], x: convertidas[i], claves: [convertidas[i].k] }));
        anotar('poules_mixtas_repartidas', miembros.length);
      } else if (miembros.length === 2 && mixtas.length === 0 && convertidas[miembros[0]].atributos.format === 'INDIVIDUAL' &&
        ordenFase(convertidas[miembros[0]].p.titulo ?? '') !== null && ordenFase(convertidas[miembros[1]].p.titulo ?? '') !== null &&
        ordenFase(convertidas[miembros[0]].p.titulo ?? '') !== ordenFase(convertidas[miembros[1]].p.titulo ?? '')) {
        const [i1, i2] = [...miembros].sort((a, b) => ordenFase(convertidas[a].p.titulo ?? '')! - ordenFase(convertidas[b].p.titulo ?? '')!);
        const h = unirDosFases(convertidas[i1].h, convertidas[i2].h);
        if (!h) {
          for (const i of miembros) {
            anotar('fases_de_una_prueba');
            detalle.push({ prueba: convertidas[i].k, titulo: convertidas[i].p.titulo, motivo: 'fases_de_una_prueba' });
          }
          continue;
        }
        salidas.push({ h, x: convertidas[i2], claves: [convertidas[i2].k, convertidas[i1].k] });
        anotar('dos_fases_unidas', 2);
      } else {
        // Con varios miembros sin nombres en común no son fases sino pruebas que el índice no distingue.
        const hs = miembros.map((i) => convertidas[i].h);
        const fusion = fusionarFases(hs);
        const nombresDe = (y: HechosPrueba) => [...new Set(y.results.map((r) => normalizeSportName(r.name)).filter(Boolean))];
        const principal = fusion ? hs.find((y) => y.competition.competitionKey === fusion.competition.competitionKey)! : null;
        const ligados = !!principal && hs.every((y) => y === principal || y.results.length === 0 || (solapeNombres(nombresDe(y), nombresDe(principal)) ?? 1) >= 0.5);
        if (!fusion || !ligados || mixtas.length > 0 || convertidas[miembros[0]].atributos.format === 'EQUIPOS') {
          for (const i of miembros) {
            anotar('fases_de_una_prueba');
            detalle.push({ prueba: convertidas[i].k, titulo: convertidas[i].p.titulo, grupo: convertidas[i].grupo, motivo: 'fases_de_una_prueba' });
          }
          continue;
        }
        salidas.push({ h: fusion, x: convertidas[miembros.find((i) => convertidas[i].h === principal)!], claves: miembros.map((i) => convertidas[i].k) });
        anotar('fases_unidas', miembros.length);
      }
      for (const { h, x, claves } of salidas) {
        const { k, atributos, p } = x;
        const e: Cobertura = {
          resultados: h.results.length, poules: h.bouts.filter((b) => b.phase === 'POULE').length, cuadro: h.bouts.filter((b) => b.phase === 'TABLEAU').length,
        };

        // Equivalentes: por clave y por atributos (en individual, con nombres en común).
        const nombresE = [...new Set([...h.results.map((y) => y.name), ...h.bouts.flatMap((b) => [b.aName, b.bName])].map(normalizeSportName).filter(Boolean))];
        const mismaClave = claves.flatMap((c) => porKey.get(c) ?? []);
        const porAtributos = [...base, ...lotes].filter((c) => !claves.includes(c.key) && compatible(atributos, c)).map((c) => {
          const s = atributos.format === 'INDIVIDUAL' ? solapeNombres(nombresE, c.nombres()) : null;
          return { c, s };
        });
        const mismos = porAtributos.filter((y) => y.s === null || y.s >= 0.3);
        const equivalentes = [...mismaClave, ...mismos.map((y) => y.c)];
        const c: Cobertura = {
          resultados: Math.max(0, ...equivalentes.map((y) => y.resultados)),
          poules: Math.max(0, ...equivalentes.map((y) => y.poules)),
          cuadro: Math.max(0, ...equivalentes.map((y) => y.cuadro)),
        };
        const faltan = fasesQueFaltan(e, c);
        const info = {
          prueba: k, unidas: claves.length > 1 ? claves : undefined, titulo: p.titulo, fecha: atributos.fecha,
          atributos: `${atributos.weapon} ${atributos.gender} ${atributos.category} ${atributos.format}${x.grupo ? ` ${x.grupo}` : ''}`,
          engarde: e, existente: c, equivalentes: equivalentes.map((y) => `${y.origen}:${y.source}:${y.key}`).slice(0, 6),
        };
        if (equivalentes.length === 0) {
          escritor.escribir(h);
          escritos.faltaEntera += 1;
          anotar('escrita_falta_entera');
        } else if (faltan.length === 0) {
          const m = equivalentes.every((y) => y.origen !== 'nuevo7') ? 'cubierta_por_otro_lote7' : 'completa_en_nuevo7';
          anotar(m);
          detalle.push({ ...info, motivo: m });
          continue;
        } else {
          const ind = atributos.format === 'INDIVIDUAL';
          // Con la misma clave de Engarde (en nuevo7 o en otro lote) el cargador completa la prueba por secciones.
          const fusionable = mismaClave.some((y) => y.origen === 'nuevo7' || y.source === 'engarde') ||
            (ind && mismos.some((y) => y.c.origen === 'nuevo7' && FUSIONA_CON_ENGARDE.has(y.c.source) && y.s !== null && y.s >= 0.5));
          if (!fusionable) {
            const m = ind ? 'fase_falta_sin_fusion_segura' : 'fase_falta_equipos_otra_fuente';
            anotar(m);
            detalle.push({ ...info, faltan, motivo: m });
            continue;
          }
          escritor.escribir(h);
          escritos.fases += 1;
          anotar(`escrita_fases_${faltan.join('_')}`);
        }
        if (claves.length > 1) escritos.fasesUnidas += 1;
        escritos.resultados += e.resultados;
        escritos.poules += e.poules;
        escritos.cuadro += e.cuadro;
        if (atributos.format === 'EQUIPOS') escritos.encuentrosEquipos += e.poules + e.cuadro;
        detalle.push({ ...info, faltan: equivalentes.length === 0 ? ['prueba'] : faltan, motivo: 'escrita', estados: h.status });
        // Una prueba recién escrita cuenta como existente para el resto del recorrido.
        lotes.push({
          origen: 'lote7-engarde-rfee', source: 'engarde', key: k, weapon: atributos.weapon, gender: atributos.gender, category: atributos.category,
          format: atributos.format, d: dia(atributos.fecha), division: atributos.division ?? null, ...e, nombres: () => nombresE,
        });
      }
    }
  }
  db.close();
  if (!soloIndices) escritor.limpiarAntiguos();
  const resumen = {
    generado: new Date().toISOString(), torneos: torneos.length, torneosConIndice: porTorneo.filter((x) => (x as { pruebas: number }).pruebas > 0).length,
    publicado: totales, ficheros: escritor.total, escritos, motivos, peticiones: red.peticiones, torneosDetalle: porTorneo, detalle,
  };
  if (!soloIndices) escritor.informe('engarde-rfee', resumen);
  console.log(JSON.stringify({ ...resumen, torneosDetalle: soloIndices ? porTorneo : porTorneo.length, detalle: detalle.length }, null, 1));
}

/** Prueba por equipos que publica encuentros (jornadas de liga) pero no clasificación. */
function equiposSinClasificacion(
  p: PruebaIndice, portada: string,
  ctx: { season: string; nombreTorneo: string; inicio: string | null; fin: string | null; ciudad: string | null },
): HechosPrueba {
  return {
    version: 1, source: 'engarde', extractor: 'lector_engarde', sourceUrl: urlPruebaEngarde(p.org, p.evt, p.compe),
    sourceSha256: createHash('sha256').update(portada).digest('hex'),
    edition: {
      season: ctx.season, tournamentKey: `engarde:${p.org}/${p.evt}`, name: ctx.nombreTorneo, startDate: ctx.inicio, endDate: ctx.fin,
      city: ctx.ciudad, countryCode: p.pais && /^[A-Z]{3}$/.test(p.pais) ? p.pais : null,
    },
    competition: {
      competitionKey: `engarde:${p.org}/${p.evt}/${p.compe}`, weapon: p.arma!, gender: p.generoFinal!, category: p.categoriaFinal!,
      categoryRaw: (p.categoriaOriginal ?? p.titulo) || null, format: 'EQUIPOS', date: p.fecha,
    },
    status: { results: 'sin_resultados', pools: 'sin_resultados', tableau: 'sin_resultados', publishedParticipants: null, notes: ['Engarde no publica clasificación final para esta prueba'] },
    results: [],
    bouts: [],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
