/**
 * Pruebas nacionales publicadas en Engarde (engarde-service.com) desde 2018-19 que no
 * existen en nuevo7 en ninguna fuente: ni como Engarde ni como Skermo, PDF o FIE con la
 * misma arma, género (o mixto), categoría y modalidad a ±2 días.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-faltan-engarde.ts [--db <nuevo7.sqlite>] [--hasta <AAAA-MM-DD>]
 *
 * Torneos: la lista pública de cada organizador español (`prog/getTournois.php`), la de
 * `rfee` pedida ahora y las demás de la caché de `engarde-historico-descargar.ts`; entran
 * los de la RFEE, los enlazados desde el catálogo nacional y los que el título declara
 * nacionales (TNR, Campeonato de España, Liga Nacional, TLM…). Las ligas y campeonatos
 * autonómicos quedan fuera (se cuentan en el informe).
 *
 * Primero se leen sólo los índices; las páginas (clasificación, poules, cuadro) se piden
 * únicamente para las pruebas que faltan. Conversión con `convertirPrueba` de
 * `engarde-a-hechos.ts` y sus mismas claves (`engarde:{org}/{evt}/{compe}`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ENGARDE_BASE,
  ENGARDE_INDICE,
  esSegmentoEngarde,
  parsearIndiceEngarde,
  parsearTorneoEngarde,
  urlPruebaEngarde,
  urlTorneoEngarde,
  type PruebaEngarde,
} from '../../src/lib/ingest/sources/engarde';
import { armaDeTitulo, categoriasDeTitulo, esEquiposDeTitulo, generoDeTitulo } from '../../src/lib/ingest/sources/engarde-antiguo';
import { argumento, CARPETA_TRABAJO } from './comun';
import { categoriaEngarde, convertirPrueba, generoEngarde, temporadaRfee, type Paginas, type PruebaIndice } from './engarde-a-hechos';
import { enlaceEngarde, formularioIndiceEngarde, paginasDePrueba } from './engarde-descargar';
import { ORGANIZADORES_ES, type TorneoLista } from './engarde-historico-descargar';
import { abrirNuevo7, dia, EscritorHechos, INVENTARIO_NACIONAL, NUEVO7 } from './lote7-faltan-comun';
import { Red } from './lote7-faltan-red';

const CACHE_HISTORICO = join(CARPETA_TRABAJO, 'engarde-historico', 'raw');
export const DESDE = '2018-09-01';

// Sin `\b` final: «T.N.R.» acaba en punto y «ESPAÑA» llega sin tilde («ESPANA»).
const NACIONAL = /\b(T\.?N\.?R\.?|TORNEO NACIONAL|RANKING NACIONAL|CAMPEONATO DE ESPA\w*|CTO\.? (DE )?ESPA\w*|CPTO\.? (DE )?ESPA\w*|CAMP\.? ESPA\w*|LIGA NACIONAL|LIGA (DE )?(ORO|PLATA|BRONCE|IBERDROLA)|TLM|LIGA MASTER|SILLA DE RUEDAS|JUEGOS NACIONALES|CRITERIUM NACIONAL)(?![A-Z0-9])/i;

/** Un torneo de Engarde cuenta como nacional por su organizador, su enlace en el catálogo o su título. */
export function esNacional(t: { org: string; evt: string; titulo: string }, enlazados: ReadonlySet<string>): boolean {
  if (t.org.toLowerCase() === 'rfee') return true;
  if (enlazados.has(`${t.org}/${t.evt}`.toLowerCase())) return true;
  const titulo = t.titulo.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
  return NACIONAL.test(titulo);
}

type Comp = { source: string; weapon: string; gender: string; category: string; format: string; d: number; division?: string | null };
/** `division`: división de la Liga Nacional de clubes (oro, plata…) que nombra el título; las divisiones son pruebas distintas. */
export type Atributos = { weapon: string; gender: string; category: string; format: string; fecha: string; division?: string | null };

/** División de liga que nombra un texto («LIGA PLATA 3ª JORNADA» → PLATA), o null. */
export function divisionLiga(texto: string | null | undefined): string | null {
  // Los códigos de prueba usan guiones bajos («ema_liga_oro»): se separan como palabras.
  const t = (texto ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/[^A-Z0-9ªº]+/g, ' ');
  if (/\b4\s*[ªºAO]?\s*DIVISI/.test(t) || /\bCUARTA\b/.test(t)) return '4DIV';
  return /\b(ORO|PLATA|BRONCE|IBERDROLA)\b/.exec(t)?.[1] ?? null;
}

const mismaDivision = (a: string | null | undefined, b: string | null | undefined) => !a || !b || a === b;

const compatiblesEntreSi = (a: Atributos, b: Atributos) =>
  a.weapon === b.weapon && a.category === b.category && a.format === b.format && Math.abs(dia(a.fecha) - dia(b.fecha)) <= 2 &&
  (a.gender === b.gender || a.gender === 'MIXTO' || b.gender === 'MIXTO') && mismaDivision(a.division, b.division);

/**
 * Índices de las pruebas de un mismo torneo que no se distinguen entre sí (mismo arma,
 * categoría, modalidad y fecha, género compatible): son fases de una sola prueba
 * («Poules Florete Mixto 2013» y «Tablón Florete Masculino 2013») o grupos que el índice
 * no separa, y ninguna se puede presentar como la prueba.
 */
export function fasesDeUnaPrueba(lista: readonly Atributos[]): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < lista.length; i += 1) {
    for (let j = i + 1; j < lista.length; j += 1) {
      if (compatiblesEntreSi(lista[i], lista[j])) {
        s.add(i);
        s.add(j);
      }
    }
  }
  return s;
}

/**
 * Atributos de una prueba del índice, contrastados con su código («ffind», «sm_eq») y su
 * título publicado. El índice de Engarde arrastra a veces los valores de otra prueba
 * (espada en una prueba titulada «Florete femenino», cadete en «Veteranos 60/70»); si el
 * título y el código coinciden entre sí y fijan un único valor, mandan ellos; si se
 * contradicen, la prueba no se atribuye.
 */
export function validarAtributos(
  p: Pick<PruebaIndice, 'compe' | 'titulo' | 'arma' | 'generoFinal' | 'categoriaFinal' | 'individual' | 'fecha'>,
): { ok: true; atributos: Atributos; corregido: boolean } | { ok: false; motivo: string } {
  if (!p.fecha || p.individual === null) return { ok: false, motivo: 'atributos_incompletos' };
  const cod = armaGeneroDeCodigo(p.compe);
  const armaT = armaDeTitulo(p.titulo);
  const generoT = generoDeTitulo(p.titulo);
  const catsT = categoriasDeTitulo(p.titulo);
  const formatoT = esEquiposDeTitulo(p.titulo);
  // El título manda si el código no lo contradice; sin título, el código sólo confirma el índice.
  const elegir = (titulo: string | null, codigo: string | null, indice: string | null, mixto: boolean): string | null | false => {
    if (titulo) return codigo && codigo !== titulo && !(mixto && titulo === 'MIXTO') ? false : titulo;
    if (codigo && indice && codigo !== indice && !(mixto && indice === 'MIXTO')) return false;
    return indice;
  };
  const weapon = elegir(armaT, cod?.weapon ?? null, p.arma, false);
  const gender = elegir(generoT, cod?.gender ?? null, p.generoFinal, true);
  if (weapon === false || gender === false) return { ok: false, motivo: 'atributos_contradictorios' };
  const category = catsT.length === 1 ? catsT[0] : catsT.length > 1 && p.categoriaFinal && catsT.includes(p.categoriaFinal) ? p.categoriaFinal : catsT.length > 1 ? null : p.categoriaFinal;
  const format = p.individual ? 'INDIVIDUAL' : 'EQUIPOS';
  if (formatoT && format === 'INDIVIDUAL') return { ok: false, motivo: 'atributos_contradictorios' };
  if (!weapon || !gender || !category) return { ok: false, motivo: 'atributos_incompletos' };
  const corregido = weapon !== p.arma || gender !== p.generoFinal || category !== p.categoriaFinal;
  return { ok: true, atributos: { weapon, gender, category, format, fecha: p.fecha, division: divisionLiga(p.titulo) ?? divisionLiga(p.compe) }, corregido };
}

/** Índice de pruebas existentes por arma|categoría|modalidad, para la comprobación de «falta». */
export class Existentes {
  private readonly porClave = new Map<string, Comp[]>();
  private readonly claves: Set<string>;

  constructor(comps: Comp[], claves: Iterable<string>) {
    for (const c of comps) {
      const k = `${c.weapon}|${c.category}|${c.format}`;
      (this.porClave.get(k) ?? this.porClave.set(k, []).get(k)!).push(c);
    }
    this.claves = new Set(claves);
  }

  tieneClave(k: string): boolean {
    return this.claves.has(k);
  }

  agregar(a: Atributos, source = 'engarde'): void {
    const k = `${a.weapon}|${a.category}|${a.format}`;
    (this.porClave.get(k) ?? this.porClave.set(k, []).get(k)!).push({ source, weapon: a.weapon, gender: a.gender, category: a.category, format: a.format, d: dia(a.fecha), division: a.division ?? null });
  }

  /**
   * Alguna prueba de cualquier fuente con el mismo arma, categoría y modalidad, género
   * compatible, fecha a ±`margen` días y, si las dos la nombran, la misma división de liga.
   */
  hay(p: Atributos, margen = 2): boolean {
    const d = dia(p.fecha);
    return (this.porClave.get(`${p.weapon}|${p.category}|${p.format}`) ?? []).some(
      (c) => Math.abs(c.d - d) <= margen && (c.gender === p.gender || c.gender === 'MIXTO' || p.gender === 'MIXTO') && mismaDivision(c.division, p.division),
    );
  }
}

/**
 * Arma y género que declara el código de la prueba cuando sigue la convención de Engarde
 * («ffind», «em_eq», «sf20eq», «fm-abs»): si contradicen al índice, el índice trae los
 * valores por defecto de otra prueba y no se puede atribuir.
 */
export function armaGeneroDeCodigo(compe: string): { weapon: string; gender: string } | null {
  const m = /^(e|f|s)(f|m)(?=$|[^a-z]|ind|eq|abs|oro|plata|bronce|liga|vet|cad|jun|inf)/i.exec(compe);
  if (!m) return null;
  const weapon = { e: 'ESPADA', f: 'FLORETE', s: 'SABLE' }[m[1].toLowerCase() as 'e' | 'f' | 's'];
  return { weapon, gender: m[2].toLowerCase() === 'f' ? 'F' : 'M' };
}

function existentes(db: ReturnType<typeof abrirNuevo7>): Existentes {
  const comps = (db.prepare(`
    SELECT c.source, c.weapon, c.gender, c.category, c.format, coalesce(c.competition_date, e.start_date) f,
           e.name || ' ' || coalesce(c.category_raw, '') || ' ' || c.competition_key texto
      FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE coalesce(c.competition_date, e.start_date) IS NOT NULL`).all() as Record<string, string>[])
    .map((r) => ({
      source: r.source, weapon: r.weapon, gender: r.gender, category: r.category, format: r.format, d: dia(r.f),
      division: r.format === 'EQUIPOS' ? divisionLiga(r.texto) : null,
    }));
  const claves = (db.prepare(`SELECT competition_key k FROM sport_competition WHERE source = 'engarde'`).all() as { k: string }[]).map((r) => r.k);
  return new Existentes(comps, claves);
}

/** Lista de torneos de un organizador ya guardada por `engarde-historico-descargar.ts` (sólo lectura). */
function listaCacheada(org: string): TorneoLista[] {
  const registro = join(CACHE_HISTORICO, '_registro.jsonl');
  if (!existsSync(registro)) return [];
  const out: TorneoLista[] = [];
  for (const l of readFileSync(registro, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const r = JSON.parse(l) as { clave: string; status: number; fichero: string | null };
    if (r.status !== 200 || !r.fichero || !r.clave.startsWith(`${org}/_torneos/_torneo/p`)) continue;
    try {
      const j = JSON.parse(readFileSync(join(CACHE_HISTORICO, r.fichero), 'utf8').replace(/^\uFEFF/, '')) as { result?: TorneoLista[] };
      for (const t of j.result ?? []) if (t.Organisme?.toLowerCase() === org) out.push(t);
    } catch {
      // Una página corrupta de la caché no impide leer las demás.
    }
  }
  return out;
}

export async function listaFresca(red: Red, org: string): Promise<TorneoLista[]> {
  const out: TorneoLista[] = [];
  for (let pagina = 1, total = 1; pagina <= Math.min(total, 40); pagina += 1) {
    const r = await red.post(`${ENGARDE_BASE}/prog/getTournois.php`, { option: 'tournois', organism: org, nrows: '50', order: 'asc', page: String(pagina) });
    if (r.status !== 200) break;
    let j: { result?: TorneoLista[]; totalPages?: number | string };
    try {
      j = JSON.parse(r.body.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      break;
    }
    total = Number(j.totalPages ?? 1) || 1;
    for (const t of j.result ?? []) if (t.Organisme?.toLowerCase() === org) out.push(t);
  }
  return out;
}

function sexesDelIndice(xml: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of xml.matchAll(/<comp\b[^>]*\bcompe="([^"]+)"[^>]*>/g)) {
    const sexe = c[0].match(/\bsexe="([^"]*)"/)?.[1];
    if (sexe !== undefined) m.set(c[1], sexe);
  }
  return m;
}

export async function indice(red: Red, org: string, evt: string): Promise<PruebaIndice[]> {
  const out: PruebaIndice[] = [];
  for (let pagina = 1, total = 1; pagina <= Math.min(total, 25); pagina += 1) {
    const r = await red.post(ENGARDE_INDICE, formularioIndiceEngarde(org, evt, pagina));
    if (r.status !== 200) break;
    const xml = r.body.toString('utf8');
    const ind = parsearIndiceEngarde(xml);
    if (!ind.ok) break;
    total = ind.paginas;
    const sexes = sexesDelIndice(xml);
    for (const p of ind.pruebas as PruebaEngarde[]) {
      if (out.some((q) => q.compe === p.compe)) continue;
      const sexe = sexes.get(p.compe) ?? null;
      out.push({ ...p, sexe, generoFinal: generoEngarde(p, sexe), categoriaFinal: categoriaEngarde(p.categoriaOriginal, p.titulo) });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const hoy = new Date().toISOString().slice(0, 10);
  const hasta = argumento('hasta', hoy);
  const db = abrirNuevo7(argumento('db', NUEVO7));
  const ex = existentes(db);
  db.close();
  const inv = JSON.parse(readFileSync(INVENTARIO_NACIONAL, 'utf8')) as { catalog: { enlaces: { tipo: string; url: string }[] }[] };
  const enlazados = new Set<string>();
  for (const f of inv.catalog) {
    for (const e of f.enlaces) {
      const r = enlaceEngarde(e.url);
      if (r.tipo === 'torneo') enlazados.add(`${r.org}/${r.evt}`.toLowerCase());
    }
  }
  const red = new Red();
  const escritor = new EscritorHechos('lector_engarde');
  const torneos: (TorneoLista & { org: string })[] = [];
  for (const org of ORGANIZADORES_ES) {
    const lista = org === 'rfee' ? await listaFresca(red, org) : listaCacheada(org);
    for (const t of lista) if (!torneos.some((x) => x.org === org && x.Event === t.Event)) torneos.push({ ...t, org });
  }
  const motivos: Record<string, number> = {};
  const anotar = (m: string) => (motivos[m] = (motivos[m] ?? 0) + 1);
  const detalle: Record<string, unknown>[] = [];
  const regionales: Record<string, number> = {};
  let resultados = 0;
  const asaltos = { POULE: 0, TABLEAU: 0 };

  for (const t of torneos) {
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null;
    if (!fecha || fecha < DESDE || fecha > hasta || !esSegmentoEngarde(t.Event)) continue;
    if (!esNacional({ org: t.org, evt: t.Event, titulo: t.Titre ?? '' }, enlazados)) {
      regionales[t.org] = (regionales[t.org] ?? 0) + 1;
      continue;
    }
    const pruebas = await indice(red, t.org, t.Event);
    if (pruebas.length === 0) {
      anotar('torneo_sin_indice');
      continue;
    }
    const fechas = pruebas.map((p) => p.fecha).filter((f): f is string => !!f).sort();
    let nombre: string | null = null;
    const faltan: { p: PruebaIndice; k: string; atributos: Atributos; indiceOriginal: string | null }[] = [];
    for (const p of pruebas) {
      const k = `engarde:${t.org}/${t.Event}/${p.compe}`;
      if (ex.tieneClave(k)) {
        anotar('ya_en_nuevo7');
        continue;
      }
      const v = validarAtributos(p);
      if (!v.ok) {
        anotar(v.motivo);
        detalle.push({ prueba: k, titulo: p.titulo, indice: `${p.arma} ${p.generoFinal} ${p.categoriaFinal} ${p.individual}`, motivo: v.motivo });
        continue;
      }
      const atributos = v.atributos;
      // Con atributos corregidos por el título, la prueba tampoco falta si existe con los del índice.
      const delIndice = p.arma && p.generoFinal && p.categoriaFinal
        ? { ...atributos, weapon: p.arma, gender: p.generoFinal, category: p.categoriaFinal }
        : atributos;
      if (ex.hay(atributos) || ex.hay(delIndice)) {
        anotar('existe_en_otra_fuente');
        continue;
      }
      // La misma prueba con la fecha publicada de otra forma (Engarde fecha el último día, el PDF el primero).
      if (ex.hay(atributos, 7) || ex.hay(delIndice, 7)) {
        anotar('posible_duplicado_fecha');
        detalle.push({ prueba: k, titulo: p.titulo, fecha: p.fecha, motivo: 'posible_duplicado_fecha' });
        continue;
      }
      faltan.push({ p: { ...p, arma: atributos.weapon as PruebaIndice['arma'], generoFinal: atributos.gender as PruebaIndice['generoFinal'], categoriaFinal: atributos.category as PruebaIndice['categoriaFinal'] }, k, atributos, indiceOriginal: v.corregido ? `${p.arma} ${p.generoFinal} ${p.categoriaFinal}` : null });
    }
    const conflicto = fasesDeUnaPrueba(faltan.map((x) => x.atributos));
    for (const i of conflicto) {
      anotar('fases_de_una_prueba');
      detalle.push({ prueba: faltan[i].k, titulo: faltan[i].p.titulo, motivo: 'fases_de_una_prueba' });
    }
    for (const [i, { p, k, atributos, indiceOriginal }] of faltan.entries()) {
      if (conflicto.has(i)) continue;
      const prueba = await red.get(urlPruebaEngarde(t.org, t.Event, p.compe));
      if (prueba.status !== 200) {
        anotar('sin_pagina_de_prueba');
        detalle.push({ prueba: k, motivo: `http_${prueba.status}` });
        continue;
      }
      const html = prueba.body.toString('utf8');
      if (/currently has no data/i.test(html)) {
        anotar('engarde_sin_datos');
        detalle.push({ prueba: k, titulo: p.titulo, fecha: p.fecha, motivo: 'engarde_sin_datos' });
        continue;
      }
      const paginas: Paginas = { prueba: html, clasfinal: null, poules: [], cuadros: [], faltan: [] };
      for (const f of paginasDePrueba(html, t.org, t.Event, p.compe).slice(0, 16)) {
        const url = `${urlPruebaEngarde(t.org, t.Event, p.compe)}/${f}`;
        const r = await red.get(url);
        if (r.status !== 200) {
          paginas.faltan.push(f);
          continue;
        }
        const cuerpo = r.body.toString('utf8');
        const np = f.match(/^poules(\d+)\.htm$/i);
        if (/^clasfinal\.htm$/i.test(f)) paginas.clasfinal = cuerpo;
        else if (np) paginas.poules.push({ pagina: Number(np[1]), html: cuerpo });
        else paginas.cuadros.push({ url, html: cuerpo });
      }
      if (nombre === null) {
        const tor = await red.get(urlTorneoEngarde(t.org, t.Event));
        nombre = (tor.status === 200 ? parsearTorneoEngarde(tor.body.toString('utf8')).nombre : null) ?? t.Titre?.trim() ?? `${t.org}/${t.Event}`;
      }
      const r = convertirPrueba(p, paginas, {
        season: temporadaRfee(atributos.fecha), nombreTorneo: nombre, inicio: fechas[0] ?? null, fin: fechas.at(-1) ?? null, ciudad: p.ciudad,
      });
      if (!r.ok) {
        anotar(r.motivo);
        detalle.push({ prueba: k, titulo: p.titulo, fecha: p.fecha, motivo: r.motivo });
        continue;
      }
      if (indiceOriginal) {
        r.hechos.status.notes.push(`Arma, género y categoría según el título publicado «${p.titulo}»; el índice de Engarde decía ${indiceOriginal}`);
      }
      escritor.escribir(r.hechos);
      // Otra copia del mismo evento en otro organizador de Engarde ya no falta.
      ex.agregar(atributos);
      anotar('escrita');
      resultados += r.hechos.results.length;
      for (const b of r.hechos.bouts) asaltos[b.phase] += 1;
      const c = r.hechos.competition;
      detalle.push({
        prueba: k, titulo: p.titulo, torneo: nombre, fecha: c.date, atributos: `${c.weapon} ${c.gender} ${c.category} ${c.format}`,
        puestos: r.hechos.results.length, poules: r.hechos.bouts.filter((b) => b.phase === 'POULE').length,
        cuadro: r.hechos.bouts.filter((b) => b.phase === 'TABLEAU').length, estados: r.hechos.status,
      });
    }
  }
  escritor.limpiarAntiguos();
  const resumen = {
    generado: new Date().toISOString(), torneosListados: torneos.length, ficheros: escritor.total, resultados, asaltos, motivos,
    torneosAutonomicosFuera: regionales, peticiones: red.peticiones, detalle,
  };
  escritor.informe('engarde', resumen);
  console.log(JSON.stringify({ ...resumen, detalle: detalle.length }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
