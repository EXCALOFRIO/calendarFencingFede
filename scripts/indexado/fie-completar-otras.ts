/**
 * Asaltos de pruebas FIE individuales que la FIE no publica (sólo su
 * clasificación), desde otras fuentes públicas:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-completar-otras.ts descargar
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-completar-otras.ts hechos [--base <sqlite>] [--salida <dir>]
 *
 * - Engarde (engarde-service.com): torneos de organizadores que alojaron el
 *   campeonato (`ENGARDE`), páginas vivas o, si dicen «no data», la exportación
 *   estática `/files/...`. Cada prueba FIE se casa con la prueba Engarde de arma,
 *   género y categoría compatibles en el título cuya clasificación final comparte
 *   más tiradores con la guardada (mínimo 50 % y 15 puntos más que la siguiente).
 * - PDF de documentación enlazados por Ophardt (`PDF_OPHARDT`), con los lectores
 *   de poules y cuadro del PDF Engarde de la RFEE.
 *
 * `descargar` deja todo en `cache-fie-completar/web`; `hechos` trabaja sin red.
 * Las referencias de cada asalto son las `source_fact_key` de la clasificación
 * guardada de la prueba (emparejamiento de `fie-huecos-asaltos.emparejarTiradores`);
 * los puestos no se tocan. Sólo se escriben las pruebas sin ningún asalto guardado.
 */
import * as cheerio from 'cheerio';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import { ficheroHechos, hechosPrueba, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { ENGARDE_INDICE, parsearIndiceEngarde, parsearPaginaEngarde, puestosDeEngarde, urlPruebaEngarde } from '../../src/lib/ingest/sources/engarde';
import { argumento } from './comun';
import { paginasDePrueba } from './engarde-descargar';
import { decodificarHtml, documentosDelMenu, normalizarCuadroAntiguo } from '../../src/lib/ingest/sources/engarde-antiguo';
import { parsearCuadroEngarde } from '../../src/lib/ingest/sources/engarde-cuadro';
import { parsearPoulesEngarde } from '../../src/lib/ingest/sources/engarde-poules';
import { cabecera } from './fie-completar-hechos';
import {
  abrirBase, BASE_PRODUCCION, CACHE, enParalelo, obtenerWeb, pruebasFieIndividuales, puestosDeBase, SALIDA_HECHOS, sha256,
  textoDe, USER_AGENT, webEnCache, type PruebaBase, type PuestoBase,
} from './fie-completar-comun';
import { anadirAsaltos, leerEngarde, type InformePrueba } from './fie-huecos-asaltos';
import { CARPETA_PDF, INVENTARIO_OPHARDT } from './fie-completar-ophardt';
import { dividirPaginaPorPruebas } from '../../src/lib/ingest/sources/rfee-pdf/bloques';
import { leerCuadro } from '../../src/lib/ingest/sources/rfee-pdf/cuadro';
import { extraerPaginas } from '../../src/lib/ingest/sources/rfee-pdf/lectura';
import { analizarPagina } from '../../src/lib/ingest/sources/rfee-pdf/paginas';
import { leerPoules } from '../../src/lib/ingest/sources/rfee-pdf/poules';

type FuenteEngarde = { org: string; evt: string; season: string; descripcion: string; claves: string[] };

/** Torneos Engarde de los organizadores de campeonatos cuya clasificación FIE no trae asaltos. */
export const ENGARDE: FuenteEngarde[] = [
  {
    org: 'uaefencingfederation', evt: 'uae2018', season: '2018', descripcion: 'Campeonatos de Asia júnior y cadete, Dubái 2018',
    claves: ['763', '764', '765', '766', '767', '768'],
  },
  {
    org: 'eyad', evt: 'cj_jor_18m', season: '2022', descripcion: 'Campeonato del Mediterráneo cadete y júnior, Ammán 2022',
    claves: ['925', '926', '927', '928', '929', '930', '931', '932', '933', '934', '935', '936'],
  },
];

/**
 * PDF de documentación enlazados por Ophardt (`fie-completar-ophardt inventario`) que el lector
 * de PDF Engarde de la RFEE lee en parte: cuadro de los Asiáticos cadetes 2017 (Korat; sus
 * matrices de poule no las lee) y poules y cuadro de la espada masculina cadete de Dubái 2018,
 * cuyas páginas Engarde están vacías.
 */
export const PDF_OPHARDT: { season: string; claves: string[]; fases: ('POULE' | 'TABLEAU')[] }[] = [
  { season: '2017', claves: ['763', '764', '765', '766', '767', '768'], fases: ['TABLEAU'] },
  { season: '2018', claves: ['764'], fases: ['POULE', 'TABLEAU'] },
];

const SIN_DATOS = /currently has no data/i;
const urlEstatica = (org: string, evt: string, compe: string, fichero: string) =>
  `https://engarde-service.com/files/${org}/${evt}/${compe}/${fichero}`;

type Atributos = { weapon: PruebaBase['weapon'] | null; gender: PruebaBase['gender'] | null; category: PruebaBase['category'] | null };

/** Arma, género y categoría del título de una prueba Engarde («Cadet Female Epee», «Men's Sabe Junior»…). */
export function atributosEngarde(titulo: string): Atributos {
  const t = titulo.toLowerCase();
  const weapon = /\b(epee|épée|espada)\b/.test(t) ? 'ESPADA' : /\b(foil|fleuret|florete)\b/.test(t) ? 'FLORETE'
    : /\bsab(re|er|e|le)?\b/.test(t) ? 'SABLE' : null;
  const gender = /\b(female|women'?s?|woman|girls?|feminin[e]?|femenino)\b/.test(t) ? 'F'
    : /\b(male|men'?s?|boys?|masculin|masculino)\b/.test(t) ? 'M' : null;
  const category = /\bcadets?\b|\bu-?17\b/.test(t) ? 'M17' : /\bjuniors?\b|\bu-?20\b/.test(t) ? 'M20'
    : /\bunder 15\b|\bu-?15\b/.test(t) ? 'M15' : null;
  return { weapon, gender, category };
}

const MANIFIESTO = join(CACHE, 'otras-manifiesto.json');
const INFORME = join(CACHE, 'otras-informe.json');

type Manifiesto = { engarde: { org: string; evt: string; compe: string; titulo: string; paginas: string[] }[] };

// ---------------------------------------------------------------------------
// Engarde: índice (POST) con caché propia
// ---------------------------------------------------------------------------

function formularioIndice(org: string, evt: string, pagina: number): Record<string, string> {
  return {
    option: 'competition', sexe: '', arme: '', indiv: '', categorie: '', orderby: 'competitions_tournament',
    datefrom: '', dateto: '', country: '', city: '', type: '', state: '', page: String(pagina), lang: 'en',
    large: 'E', nrows: '20', organism: org, event: evt, order: 'ASC', show_test: '0', cache: '1',
  };
}

async function indiceEngarde(org: string, evt: string): Promise<string[]> {
  const compes: string[] = [];
  for (let pagina = 1, total = 1; pagina <= total && pagina <= 10; pagina += 1) {
    const fichero = join(CACHE, 'engarde-indices', `${org}__${evt}__p${pagina}.xml`);
    let xml: string;
    if (existsSync(fichero)) xml = readFileSync(fichero, 'utf8');
    else {
      const r = await fetch(ENGARDE_INDICE, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(formularioIndice(org, evt, pagina)),
      });
      xml = await r.text();
      mkdirSync(join(CACHE, 'engarde-indices'), { recursive: true });
      writeFileSync(fichero, xml);
    }
    const i = parsearIndiceEngarde(xml);
    if (!i.ok) break;
    total = i.paginas;
    for (const p of i.pruebas) if (!compes.includes(p.compe)) compes.push(p.compe);
  }
  return compes;
}

async function descargar() {
  const man: Manifiesto = { engarde: [] };
  for (const f of ENGARDE) {
    const compes = await indiceEngarde(f.org, f.evt);
    console.log(`${f.org}/${f.evt}: ${compes.length} pruebas`);
    await enParalelo(compes, 2, async (compe) => {
      const base = urlPruebaEngarde(f.org, f.evt, compe);
      const html = textoDe(await obtenerWeb(base));
      if (html === null) return;
      const titulo = cheerio.load(html)('h1').first().text().replace(/\s+/g, ' ').trim();
      const paginas = paginasDePrueba(html, f.org, f.evt, compe).slice(0, 24);
      for (const p of paginas) await obtenerWeb(`${base}/${p}`);
      // Torneos migrados de la plataforma antigua: las páginas dicen «no data» y los datos
      // están en la exportación estática `/files/...`.
      const menu = textoDe(await obtenerWeb(urlEstatica(f.org, f.evt, compe, 'menu.html')));
      const estaticas = menu ? documentosDelMenu(menu).map((d) => d.fichero).slice(0, 24) : [];
      for (const p of estaticas) await obtenerWeb(urlEstatica(f.org, f.evt, compe, p));
      man.engarde.push({ org: f.org, evt: f.evt, compe, titulo, paginas: [...new Set([...paginas, ...estaticas])] });
      console.log(`  ${compe} «${titulo}»: ${paginas.join(', ')} | estáticas: ${estaticas.join(', ')}`);
    });
  }
  writeFileSync(MANIFIESTO, `${JSON.stringify(man, null, 1)}\n`);
  console.log(`manifiesto en ${MANIFIESTO}`);
}

// ---------------------------------------------------------------------------
// Hechos
// ---------------------------------------------------------------------------

const clavePersona = (nombre: string, pais: string | null) => `${normalizeSportName(nombre)}|${pais ?? ''}`;

/** Fracción de la clasificación guardada que aparece en la de la fuente (nombre y nación). */
export function solape(guardada: readonly Pick<PuestoBase, 'name' | 'countryCode'>[], fuente: readonly { nombre: string; pais: string | null }[]): number {
  if (guardada.length === 0) return 0;
  const enFuente = new Set(fuente.map((x) => clavePersona(x.nombre, x.pais)));
  const soloNombre = new Set(fuente.map((x) => normalizeSportName(x.nombre)));
  let n = 0;
  for (const r of guardada) {
    if (enFuente.has(clavePersona(r.name, r.countryCode)) || soloNombre.has(normalizeSportName(r.name))) n += 1;
  }
  return n / guardada.length;
}

/** Hechos con la clasificación guardada, para casar a los tiradores de la fuente con sus `factKey`. */
export function hechosBase(p: PruebaBase, puestos: PuestoBase[]): HechosPrueba {
  return hechosPrueba.parse({
    ...cabecera(p),
    extractor: 'fie_completar',
    sourceUrl: p.sourceUrl ?? `https://fie.org/competitions/${p.season}/${p.competitionKey}`,
    sourceSha256: sha256(''),
    // Sin la fase en la fuente no se sabe si la prueba la tuvo: `parcial` con 0 asaltos, que el
    // cargador se salta, en lugar de `sin_resultados`, que afirmaría que no la hubo.
    status: { results: 'parcial', pools: 'parcial', tableau: 'parcial', publishedParticipants: null, notes: [] },
    results: puestos.map((r) => ({
      factKey: r.factKey, name: r.name, countryCode: r.countryCode && /^[A-Z]{3}$/.test(r.countryCode) ? r.countryCode : null,
      club: null, position: r.position, positionRaw: null, points: null, fieId: null, license: null, birthYear: null,
    })),
    bouts: [],
  });
}

type Candidata = { org: string; evt: string; compe: string; titulo: string; url: string; paginas: { nombre: string; url: string; html: string }[]; faltan: number; puestos: { nombre: string; pais: string | null }[] };

function estadoFinal(h: HechosPrueba, fase: 'POULE' | 'TABLEAU', paginaVacia: boolean): HechosPrueba['status']['pools'] {
  const actual = fase === 'POULE' ? h.status.pools : h.status.tableau;
  if (!h.bouts.some((b) => b.phase === fase)) return 'parcial';
  return paginaVacia && actual === 'completo' ? 'parcial' : actual;
}

export function paginasSinAsaltos(paginas: readonly { nombre: string; html: string }[]): { poules: string[]; cuadro: string[] } {
  const poules: string[] = [];
  const cuadro: string[] = [];
  for (const p of paginas) {
    const np = /^poules(\d+)\.htm$/i.exec(p.nombre);
    if (np) {
      const r = parsearPoulesEngarde(p.html, { pagina: Number(np[1]) });
      if (r.estado !== 'leido' || r.asaltos.length === 0) poules.push(p.nombre);
    } else if (/^tableau(_a)?[\d-]+\.html?$/i.test(p.nombre)) {
      const r = parsearCuadroEngarde(p.html, { individual: true });
      if (r.estado !== 'leido' || r.asaltos.length === 0) cuadro.push(p.nombre);
    }
  }
  return { poules, cuadro };
}

function candidatasEngarde(man: Manifiesto, f: FuenteEngarde): Candidata[] {
  const out: Candidata[] = [];
  for (const e of man.engarde.filter((x) => x.org === f.org && x.evt === f.evt)) {
    const base = urlPruebaEngarde(e.org, e.evt, e.compe);
    const paginas: Candidata['paginas'] = [];
    let faltan = 0;
    for (const nombre of e.paginas) {
      const viva = textoDe(webEnCache(`${base}/${nombre}`));
      const urlFija = urlEstatica(e.org, e.evt, e.compe, nombre);
      const fija = webEnCache(urlFija);
      const html = viva !== null && !SIN_DATOS.test(viva) ? viva : fija?.bytes ? decodificarHtml(fija.bytes) : null;
      if (html === null) {
        if (viva === null) faltan += 1;
        continue;
      }
      const url = html === viva ? `${base}/${nombre}` : urlFija;
      paginas.push({ nombre, url, html: /^tableau/i.test(nombre) ? normalizarCuadroAntiguo(html) : html });
    }
    const final = paginas.find((p) => /^clasfinal\.htm$/i.test(p.nombre));
    const puestos = final
      ? puestosDeEngarde(parsearPaginaEngarde(final.html)).map((x) => ({ nombre: x.nombre, pais: x.pais && /^[A-Z]{3}$/.test(x.pais) ? x.pais : null }))
      : [];
    out.push({ ...e, url: base, paginas, faltan, puestos });
  }
  return out;
}

type InventarioPdf = { pruebas: { season: string; competitionKey: string; pdf?: string; sha256?: string; formato?: string }[] };

/**
 * Asaltos de un PDF de documentación de Ophardt con los lectores de poules y cuadro del PDF
 * Engarde de la RFEE, atribuyendo cada nombre a la clasificación guardada (`Participante.ref` =
 * `source_fact_key`). Lo que el lector no atribuye a una sola fila queda fuera y la fase, parcial.
 */
async function hechosDePdf(p: PruebaBase, puestos: PuestoBase[], fases: ('POULE' | 'TABLEAU')[]):
  Promise<{ hechos: HechosPrueba; informe: InformePrueba } | { motivo: string }> {
  const inv = JSON.parse(readFileSync(INVENTARIO_OPHARDT, 'utf8')) as InventarioPdf;
  const x = inv.pruebas.find((e) => e.season === p.season && e.competitionKey === p.competitionKey);
  const ruta = join(CARPETA_PDF, `${p.season}-${p.competitionKey}.pdf`);
  if (!x?.pdf || !existsSync(ruta)) return { motivo: 'sin PDF de Ophardt en caché' };
  const bytes = new Uint8Array(readFileSync(ruta));
  const { paginas } = await extraerPaginas(bytes);
  const analizadas = paginas.flatMap(dividirPaginaPorPruebas).map(analizarPagina);
  const registro = puestos.map((r) => ({ ref: r.factKey, nombre: r.name, club: null, pais: r.countryCode }));
  const nombres = new Map(puestos.map((r) => [r.factKey, r.name]));
  const po = fases.includes('POULE') ? leerPoules(analizadas.filter((a) => a.tipo === 'poules'), registro) : null;
  const cu = fases.includes('TABLEAU') ? leerCuadro(analizadas.filter((a) => a.tipo === 'cuadro'), registro) : null;
  const bouts = [...(po?.asaltos ?? []), ...(cu?.asaltos ?? [])].map((a) => ({
    phase: a.fase, roundKey: a.ronda, aRef: a.refA, bRef: a.refB, aName: nombres.get(a.refA) ?? a.nombreA,
    bName: nombres.get(a.refB) ?? a.nombreB, scoreA: a.puntosA, scoreB: a.puntosB, winner: null,
  })).filter((b) => b.aRef !== b.bRef && b.scoreA !== b.scoreB && Math.max(b.scoreA, b.scoreB) <= 45);
  if (bouts.length === 0) return { motivo: 'el lector de PDF no atribuye ningún asalto' };
  type LecturaFase = NonNullable<typeof po> | NonNullable<typeof cu> | null;
  const fuera = (l: LecturaFase) => (l ? Object.values(l.excluidos).reduce((s, v) => s + v, 0) - l.excluidos.bye - l.excluidos.duplicado + l.rechazos.length : 0);
  const estado = (l: LecturaFase, fase: 'POULE' | 'TABLEAU'): HechosPrueba['status']['pools'] => {
    const n = bouts.filter((b) => b.phase === fase).length;
    if (!l || n === 0) return 'parcial';
    return fuera(l) === 0 && n >= l.publicado ? 'completo' : 'parcial';
  };
  const hechos = hechosPrueba.parse({
    ...cabecera(p),
    extractor: 'lector_pdf_ophardt',
    sourceUrl: x.pdf,
    sourceSha256: sha256(bytes),
    status: {
      results: 'parcial',
      pools: estado(po, 'POULE'),
      tableau: estado(cu, 'TABLEAU'),
      publishedParticipants: null,
      notes: [
        `Asaltos del PDF de documentación enlazado por Ophardt Online (${x.pdf}), leídos con el lector de PDF Engarde; nombres atribuidos a la clasificación guardada`,
        ...(po ? [`poules: ${po.asaltos.length} de ${po.publicado} publicados; excluidos ${JSON.stringify(po.excluidos)}; ${po.rechazos.length} regiones sin leer`] : ['poules: el lector no lee las matrices de este PDF']),
        ...(cu ? [`cuadro: ${cu.asaltos.length} de ${cu.publicado} publicados; excluidos ${JSON.stringify(cu.excluidos)}; ${cu.rechazos.length} regiones sin leer`] : []),
        'los puestos no se tocan',
      ],
    },
    results: [],
    bouts,
  });
  const desc = (l: LecturaFase) => (l ? Object.fromEntries(Object.entries(l.excluidos).filter(([k, v]) => v && k !== 'bye')) : {});
  return {
    hechos,
    informe: {
      season: p.season, competitionKey: p.competitionKey, fuente: 'pdf_ophardt', url: x.pdf,
      pools: { estado: hechos.status.pools, importados: bouts.filter((b) => b.phase === 'POULE').length, esperados: po?.publicado ?? 0, descartados: desc(po) },
      tableau: { estado: hechos.status.tableau, importados: bouts.filter((b) => b.phase === 'TABLEAU').length, esperados: cu?.publicado ?? 0, descartados: desc(cu) },
      tiradores: { publicados: puestos.length, casados: {}, sinCasar: [] },
    },
  };
}

async function hechos() {
  const base = argumento('base', BASE_PRODUCCION);
  const salida = argumento('salida', join(SALIDA_HECHOS, 'otras'));
  mkdirSync(salida, { recursive: true });
  const man = JSON.parse(readFileSync(MANIFIESTO, 'utf8')) as Manifiesto;
  const db = abrirBase(base);
  const pruebas = pruebasFieIndividuales(db);
  const informe: (InformePrueba & { solape?: number; compe?: string })[] = [];
  const sinCambio: { season: string; competitionKey: string; motivo: string }[] = [];
  let escritos = 0;
  for (const f of ENGARDE) {
    const candidatas = candidatasEngarde(man, f);
    const usadas = new Set<string>();
    for (const clave of f.claves) {
      const p = pruebas.find((x) => x.season === f.season && x.competitionKey === clave);
      if (!p) {
        sinCambio.push({ season: f.season, competitionKey: clave, motivo: 'no está en la base' });
        continue;
      }
      if (p.poule + p.tableau > 0) {
        sinCambio.push({ season: f.season, competitionKey: clave, motivo: 'ya tiene asaltos' });
        continue;
      }
      const puestos = puestosDeBase(db, p.id);
      // El título descarta las pruebas de otra arma, género o categoría; lo que no publica no descarta.
      const compatible = (c: Candidata) => {
        const a = atributosEngarde(c.titulo);
        return (!a.weapon || a.weapon === p.weapon) && (!a.gender || a.gender === p.gender) && (!a.category || a.category === p.category);
      };
      const orden = candidatas
        .filter((c) => !usadas.has(c.compe) && compatible(c))
        .map((c) => ({ c, s: solape(puestos, c.puestos) }))
        .sort((a, b) => b.s - a.s);
      const mejor = orden[0];
      if (!mejor || mejor.s < 0.5 || (orden[1] && orden[1].s >= mejor.s - 0.15)) {
        sinCambio.push({ season: f.season, competitionKey: clave, motivo: `sin prueba Engarde inequívoca (solape ${mejor ? mejor.s.toFixed(2) : '-'}${orden[1] ? ` / ${orden[1].s.toFixed(2)}` : ''})` });
        continue;
      }
      usadas.add(mejor.c.compe);
      const h = hechosBase(p, puestos);
      const r = anadirAsaltos(h, leerEngarde(mejor.c.paginas, mejor.c.faltan), {
        nombre: 'engarde', url: mejor.c.url, descripcion: `poules y cuadro publicados en Engarde (${f.descripcion}, prueba «${mejor.c.titulo}»)`,
      });
      if (r.hechos.bouts.length === 0) {
        sinCambio.push({ season: f.season, competitionKey: clave, motivo: 'ningún asalto válido' });
        informe.push({ ...r.informe, solape: mejor.s, compe: mejor.c.compe, motivo: 'sin_asaltos_validos' });
        continue;
      }
      const shas = mejor.c.paginas.map((x) => sha256(x.html)).join('|');
      // Una página de poules o de cuadro publicada que el lector no sabe leer (cuadro de una sola
      // ronda sin título en la columna de ganadores, poule sin celdas) deja la fase incompleta
      // aunque las demás páginas cuadren.
      const vacias = paginasSinAsaltos(mejor.c.paginas);
      const notas = [...r.hechos.status.notes, `Prueba Engarde casada por clasificación: ${Math.round(mejor.s * 100)} % de la clasificación guardada aparece en la de Engarde; los puestos no se tocan`];
      if (vacias.poules.length) notas.push(`páginas de poules sin asaltos legibles: ${vacias.poules.join(', ')}`);
      if (vacias.cuadro.length) notas.push(`páginas de cuadro sin asaltos legibles: ${vacias.cuadro.join(', ')}`);
      const final = hechosPrueba.parse({
        ...r.hechos,
        extractor: 'engarde_fie_completar',
        sourceUrl: mejor.c.url,
        sourceSha256: sha256(shas),
        results: [],
        status: {
          ...r.hechos.status,
          results: 'parcial',
          pools: estadoFinal(r.hechos, 'POULE', vacias.poules.length > 0),
          tableau: estadoFinal(r.hechos, 'TABLEAU', vacias.cuadro.length > 0),
          notes: notas,
        },
      });
      r.informe.pools.estado = final.status.pools;
      r.informe.tableau.estado = final.status.tableau;
      writeFileSync(join(salida, ficheroHechos(final)), `${JSON.stringify(final, null, 1)}\n`);
      escritos += 1;
      informe.push({ ...r.informe, solape: mejor.s, compe: mejor.c.compe });
    }
  }
  const escritosEngarde = new Set(informe.filter((i) => !i.motivo).map((i) => `${i.season}|${i.competitionKey}`));
  for (const f of PDF_OPHARDT) {
    for (const clave of f.claves) {
      const p = pruebas.find((x) => x.season === f.season && x.competitionKey === clave);
      if (!p || p.poule + p.tableau > 0 || escritosEngarde.has(`${f.season}|${clave}`)) continue;
      const r = await hechosDePdf(p, puestosDeBase(db, p.id), f.fases);
      if ('motivo' in r) {
        sinCambio.push({ season: f.season, competitionKey: clave, motivo: r.motivo });
        continue;
      }
      writeFileSync(join(salida, ficheroHechos(r.hechos)), `${JSON.stringify(r.hechos, null, 1)}\n`);
      escritos += 1;
      informe.push(r.informe);
    }
  }
  db.close();
  writeFileSync(INFORME, `${JSON.stringify({ generado: new Date().toISOString(), escritos, pruebas: informe, sinCambio }, null, 1)}\n`);
  for (const i of informe) {
    console.log(`${i.season} ${i.competitionKey} ${i.fuente} ${i.compe} solape=${i.solape?.toFixed(2)}: poules ${i.pools.importados}/${i.pools.esperados} ${i.pools.estado} ${JSON.stringify(i.pools.descartados)}; cuadro ${i.tableau.importados}/${i.tableau.esperados} ${i.tableau.estado} ${JSON.stringify(i.tableau.descartados)}; sin casar ${i.tiradores.sinCasar.length}`);
  }
  for (const s of sinCambio) console.log(`${s.season} ${s.competitionKey}: ${s.motivo}`);
  console.log(`${escritos} ficheros en ${salida}; informe en ${INFORME}`);
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'descargar') await descargar();
  else if (orden === 'hechos') await hechos();
  else throw new Error('uso: fie-completar-otras.ts descargar|hechos');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
