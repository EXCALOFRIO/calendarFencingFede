/**
 * Convierte las páginas de Engarde descargadas por `engarde-descargar.ts` al
 * formato común de hechos (`src/lib/ingest/hechos/formato.ts`), sin red.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/engarde-a-hechos.ts \
 *     [--inventario <national-inventory.json>] [--entrada <calendario-trabajo/engarde>] \
 *     [--salida <calendario-trabajo/hechos/engarde>]
 *
 * Sólo se convierten las pruebas del índice de cada torneo que corresponden a
 * una fila del catálogo nacional RFEE que enlaza ese torneo (misma arma, género,
 * formato, categoría si ambas la declaran y fecha a ±3 días): un torneo de
 * Engarde puede traer pruebas regionales que el catálogo no recoge.
 *
 * Claves: edición `engarde:{org}/{evt}`, prueba `engarde:{org}/{evt}/{compe}`,
 * participante `engarde:<nombre normalizado>|<nación o club>` (la misma de
 * `puestosDeEngarde`). Engarde no publica licencia ni ID: nunca se infieren.
 */
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import { FusionAsaltos } from '../../src/lib/ingest/asaltos-complementarios';
import {
  ficheroHechos,
  hechosPrueba,
  type AsaltoHecho,
  type HechosPrueba,
  type ResultadoHecho,
} from '../../src/lib/ingest/hechos/formato';
import { mapCategory } from '../../src/lib/ingest/mappers';
import {
  parsearIndiceEngarde,
  parsearPaginaEngarde,
  parsearTorneoEngarde,
  puestosDeEngarde,
  urlPruebaEngarde,
  type PaginaEngarde,
  type PruebaEngarde,
} from '../../src/lib/ingest/sources/engarde';
import { parsearCuadroEngarde } from '../../src/lib/ingest/sources/engarde-cuadro';
import { parsearPoulesEngarde } from '../../src/lib/ingest/sources/engarde-poules';
import { argumento } from './comun';
import {
  CacheEngarde,
  CARPETA_ENGARDE,
  claveCache,
  INVENTARIO_POR_DEFECTO,
  leerInventario,
  paginasDePrueba,
  torneosDelInventario,
  type FilaInventario,
} from './engarde-descargar';

type Genero = HechosPrueba['competition']['gender'];
type Categoria = HechosPrueba['competition']['category'];
type Estado = HechosPrueba['status']['results'];

const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);

/** Temporada RFEE (septiembre-agosto) de una fecha ISO. */
export function temporadaRfee(fecha: string): string {
  const a = Number(fecha.slice(0, 4));
  const m = Number(fecha.slice(5, 7));
  return m >= 9 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}

/** Engarde marca el sexo `n` (o `x`) en las pruebas mixtas, que `mapGender` no reconoce. */
export function generoEngarde(p: Pick<PruebaEngarde, 'genero'>, sexe: string | null): Genero | null {
  if (p.genero) return p.genero;
  return sexe && /^(n|x|mixte?|mixed|mixto)$/i.test(sexe.trim()) ? 'MIXTO' : null;
}

const CATEGORIA_TITULO: [RegExp, Categoria][] = [
  [/\bveteran|\bvet\b/, 'VET'],
  [/\babsolut|\bsenior/, 'ABS'],
  [/\bjunior|\bm-?20\b|\bu-?20\b|\bsub-?20\b/, 'M20'],
  [/\bcadet|\bm-?17\b|\bu-?17\b|\bsub-?17\b/, 'M17'],
  [/\binfantil|\bm-?15\b|\bu-?15\b|\bsub-?15\b/, 'M15'],
  [/\bm-?14\b|\bu-?14\b/, 'M14'],
  [/\balevin|\bm-?13\b|\bu-?13\b/, 'M13'],
  [/\bsub-?23\b|\bm-?23\b|\bu-?23\b/, 'M23'],
];

/** Categoría de la prueba: la del índice; si falta, una única que nombre el título. */
export function categoriaEngarde(categorie: string | null, titulo: string): Categoria | null {
  const delIndice = mapCategory(categorie);
  if (delIndice) return delIndice;
  if (categorie && categorie.trim()) return null;
  const t = titulo.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const halladas = new Set(CATEGORIA_TITULO.filter(([re]) => re.test(t)).map(([, c]) => c));
  return halladas.size === 1 ? [...halladas][0] : null;
}

export type PruebaIndice = PruebaEngarde & { sexe: string | null; categoriaFinal: Categoria | null; generoFinal: Genero | null };

/** Filas del catálogo que describen la prueba de Engarde. */
export function filasDePrueba(p: PruebaIndice, filas: readonly FilaInventario[]): FilaInventario[] {
  return filas.filter((f) => {
    if (!p.arma || f.arma !== p.arma) return false;
    const formato = p.individual === true ? 'INDIVIDUAL' : p.individual === false ? 'EQUIPOS' : null;
    if (!formato || f.formato !== formato) return false;
    if (p.generoFinal && p.generoFinal !== 'MIXTO' && f.genero && f.genero !== p.generoFinal) return false;
    if (p.categoriaFinal && f.categoria && f.categoria !== p.categoriaFinal) return false;
    if (p.fecha && f.fecha && Math.abs(dia(p.fecha) - dia(f.fecha)) > 3) return false;
    return true;
  });
}

function sexesDelIndice(xml: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of xml.matchAll(/<comp\b[^>]*\bcompe="([^"]+)"[^>]*>/g)) {
    const sexe = c[0].match(/\bsexe="([^"]*)"/)?.[1];
    if (sexe !== undefined) m.set(c[1], sexe);
  }
  return m;
}

/** `null` = nombre vacío o repetido en la clasificación (ambiguo). */
type Referencias = { deNombre: (nombre: string) => string | null };

/** Referencia de un tirador de poule o cuadro: el `factKey` de su puesto, por nombre normalizado único. */
export function referencias(puestos: readonly { clave: string; nombre: string }[]): Referencias {
  const porNombre = new Map<string, string | null>();
  for (const p of puestos) {
    const n = normalizeSportName(p.nombre);
    porNombre.set(n, porNombre.has(n) ? null : p.clave);
  }
  return {
    deNombre(nombre) {
      const n = normalizeSportName(nombre);
      if (!n) return null;
      if (porNombre.has(n)) return porNombre.get(n) ?? null;
      return `engarde:${n}|`;
    },
  };
}

/**
 * La plantilla catalana titula la clasificación final «Classificació general»,
 * sin «final». Se acepta como final sólo si el índice da la prueba por
 * terminada y el título no es el de una fase (después de poules, de una ronda…).
 */
export function esGeneralDePruebaTerminada(encabezado: string | null, estadoIndice: string): boolean {
  if (estadoIndice !== 'completed' || !encabezado) return false;
  const t = encabezado.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return /\b(general|overall)\b/.test(t) && !/poule|ronda|tour|round|despues|after|apres|despres|provisional|provisoire/.test(t);
}

const SIN_PUESTO = /\b(abandon\w*|retirad[oa]|retir[eé]e?|withdrawn|exclu\w*|expulsad[oa]|descalificad[oa]|disqualifi\w*|dnf|dns|dsq|abs|absent\w*|ausente|forfait|scratch|no presentad[oa]|no se presenta)\b/i;

/**
 * Engarde deja vacía la celda de puesto de los tiradores que abandonan o son
 * excluidos y anota el motivo en otra columna; el lector de clasificaciones
 * descarta esas filas como ilegibles. Se copia el motivo a la celda de puesto
 * para que la fila se lea con puesto nulo.
 */
export function marcarFilasSinPuesto(html: string): string {
  const $ = cheerio.load(html);
  let cambios = 0;
  $('table.liste tr').each((_, tr) => {
    const celdas = $(tr).children('td');
    if (celdas.length < 2) return;
    const primera = celdas.eq(0);
    if (primera.text().replace(/\s+/g, '').length > 0) return;
    const motivo = celdas
      .toArray()
      .slice(1)
      .map((c) => $(c).text().replace(/\s+/g, ' ').trim())
      .map((t) => t.match(SIN_PUESTO)?.[0])
      .find(Boolean);
    if (!motivo) return;
    primera.text(motivo.toLowerCase());
    cambios += 1;
  });
  return cambios > 0 ? $.html() : html;
}

export type Paginas = { prueba: string; clasfinal?: string | null; poules: { pagina: number; html: string }[]; cuadros: { url: string; html: string }[]; faltan: string[] };

export type Conversion =
  | { ok: true; hechos: HechosPrueba }
  | { ok: false; motivo: string };

export function convertirPrueba(
  p: PruebaIndice,
  paginas: Paginas,
  ctx: { season: string; nombreTorneo: string; inicio: string | null; fin: string | null; ciudad: string | null },
): Conversion {
  if (!p.arma || !p.generoFinal || !p.categoriaFinal || p.individual === null) {
    return { ok: false, motivo: 'atributos_incompletos' };
  }
  let pagina: PaginaEngarde = parsearPaginaEngarde(marcarFilasSinPuesto(paginas.prueba));
  // La portada de la prueba muestra el último documento publicado (a veces las poules);
  // la clasificación final, si existe, está en `clasfinal.htm`.
  if (pagina.tipo !== 'clasificacion' && paginas.clasfinal) {
    const final = parsearPaginaEngarde(marcarFilasSinPuesto(paginas.clasfinal));
    if (final.tipo !== 'desconocida') pagina = { ...final, cuadros: pagina.cuadros };
  }
  if (pagina.tipo === 'clasificacion_provisional' && esGeneralDePruebaTerminada(pagina.encabezado, p.estado)) {
    pagina.tipo = 'clasificacion';
  }
  const notas: string[] = [];
  const individual = p.individual === true;

  // Puestos.
  let estadoResultados: Estado;
  let resultados: ResultadoHecho[] = [];
  const puestos = pagina.tipo === 'clasificacion' ? puestosDeEngarde(pagina) : [];
  if (pagina.tipo !== 'clasificacion') {
    estadoResultados = 'sin_resultados';
    notas.push(
      pagina.tipo === 'clasificacion_provisional'
        ? 'Engarde sólo publica una clasificación provisional, no la final'
        : 'Engarde no publica clasificación final para esta prueba',
    );
  } else {
    resultados = puestos.map((x) => ({
      factKey: x.clave,
      name: x.nombre,
      countryCode: x.pais && /^[A-Z]{3}$/.test(x.pais) ? x.pais : null,
      club: x.club ?? (x.pais && !/^[A-Z]{3}$/.test(x.pais) ? x.pais : null),
      position: x.posicion,
      positionRaw: x.posicionRaw,
      points: null,
      fieId: null,
      license: null,
      birthYear: null,
    }));
    const total = pagina.publicado ?? resultados.length;
    if (resultados.length === 0 && pagina.anomalias === 0) estadoResultados = 'sin_resultados';
    else if (resultados.length === total && pagina.anomalias === 0) estadoResultados = 'completo';
    else {
      estadoResultados = 'parcial';
      notas.push(`Clasificación: se leyeron ${resultados.length} de ${total} filas publicadas`);
    }
  }
  const refs = referencias(puestos);
  const asaltos: AsaltoHecho[] = [];

  // Poules.
  let estadoPoules: Estado;
  if (!individual) {
    estadoPoules = 'sin_resultados';
    notas.push('Prueba por equipos: no se importan asaltos individuales');
  } else if (paginas.poules.length === 0) {
    estadoPoules = 'sin_resultados';
    notas.push('Engarde no publica poules para esta prueba');
  } else {
    let esperados = 0;
    let importados = 0;
    let ilegibles = 0;
    for (const { pagina: n, html } of paginas.poules) {
      const r = parsearPoulesEngarde(html, { pagina: n });
      if (r.estado !== 'leido') {
        ilegibles += 1;
        continue;
      }
      esperados += r.esperados;
      for (const b of r.asaltos) {
        const aRef = refs.deNombre(b.a.nombre);
        const bRef = refs.deNombre(b.b.nombre);
        if (!aRef || !bRef || aRef === bRef) continue;
        asaltos.push({
          phase: 'POULE', roundKey: b.ronda, aRef, bRef, aName: b.a.nombre, bName: b.b.nombre,
          scoreA: b.a.tocados, scoreB: b.b.tocados, winner: b.ganador,
        });
        importados += 1;
      }
    }
    if (importados === 0) {
      estadoPoules = ilegibles > 0 ? 'ilegible' : 'sin_resultados';
      notas.push(ilegibles > 0 ? 'Las poules publicadas no tienen un formato reconocido' : 'Las poules publicadas no traen asaltos legibles');
    } else if (importados === esperados && ilegibles === 0 && paginas.faltan.every((f) => !f.startsWith('poules'))) {
      estadoPoules = 'completo';
    } else {
      estadoPoules = 'parcial';
      notas.push(`Poules: se importaron ${importados} de ${esperados} asaltos esperados${ilegibles ? `; ${ilegibles} página(s) sin formato reconocido` : ''}`);
    }
  }

  // Cuadro.
  let estadoCuadro: Estado;
  if (!individual) estadoCuadro = 'sin_resultados';
  else if (paginas.cuadros.length === 0) {
    estadoCuadro = 'sin_resultados';
    notas.push('Engarde no publica cuadro para esta prueba');
  } else {
    const fusion = new FusionAsaltos();
    let ilegibles = 0;
    for (const { url, html } of paginas.cuadros) {
      const c = parsearCuadroEngarde(html, { individual: true });
      if (c.estado !== 'leido') {
        ilegibles += 1;
        continue;
      }
      fusion.anadir(c, url);
    }
    const parte = fusion.resumen(ilegibles === 0 && paginas.faltan.every((f) => !f.startsWith('tableau')));
    let sinRef = 0;
    for (const b of parte.asaltos) {
      const ra = refs.deNombre(b.nombreA);
      const rb = refs.deNombre(b.nombreB);
      if (!ra || !rb || ra === rb) {
        sinRef += 1;
        continue;
      }
      const ronda = b.ronda === 'SF' ? 'T4' : b.ronda === 'F' ? 'T2' : b.ronda;
      asaltos.push({
        phase: 'TABLEAU', roundKey: ronda, aRef: ra, bRef: rb, aName: b.nombreA, bName: b.nombreB,
        scoreA: Math.min(b.puntosA, 45), scoreB: Math.min(b.puntosB, 45), winner: null,
      });
    }
    const importados = parte.importado - sinRef;
    if (importados <= 0) {
      estadoCuadro = ilegibles > 0 ? 'ilegible' : 'sin_resultados';
      notas.push(ilegibles > 0 ? 'El cuadro publicado no tiene un formato reconocido' : 'El cuadro publicado no trae asaltos legibles');
    } else if (parte.completo && sinRef === 0) estadoCuadro = 'completo';
    else {
      estadoCuadro = 'parcial';
      notas.push(`Cuadro: se importaron ${importados} de ${parte.publicado} cruces publicados`);
    }
  }

  if (resultados.length === 0 && asaltos.length === 0) return { ok: false, motivo: 'sin_hechos' };

  const fecha = p.fecha ?? pagina.fecha;
  const h: HechosPrueba = {
    version: 1,
    source: 'engarde',
    extractor: 'lector_engarde',
    sourceUrl: urlPruebaEngarde(p.org, p.evt, p.compe),
    sourceSha256: createHash('sha256').update(paginas.prueba).digest('hex'),
    edition: {
      season: ctx.season,
      tournamentKey: `engarde:${p.org}/${p.evt}`,
      name: ctx.nombreTorneo,
      startDate: ctx.inicio,
      endDate: ctx.fin,
      city: ctx.ciudad,
      countryCode: p.pais && /^[A-Z]{3}$/.test(p.pais) ? p.pais : null,
    },
    competition: {
      competitionKey: `engarde:${p.org}/${p.evt}/${p.compe}`,
      weapon: p.arma,
      gender: p.generoFinal,
      category: p.categoriaFinal,
      categoryRaw: (p.categoriaOriginal ?? p.titulo) || null,
      format: individual ? 'INDIVIDUAL' : 'EQUIPOS',
      date: fecha,
    },
    status: {
      results: estadoResultados,
      pools: estadoPoules,
      tableau: estadoCuadro,
      publishedParticipants: pagina.tipo === 'clasificacion' ? (pagina.publicado ?? resultados.length) : null,
      notes: notas,
    },
    results: resultados,
    bouts: asaltos,
  };
  return { ok: true, hechos: hechosPrueba.parse(h) };
}

export type InformeEngarde = {
  generado: string;
  torneos: number;
  torneosConPruebas: number;
  pruebasIndice: number;
  pruebasDelCatalogo: number;
  ficheros: number;
  descartadas: Record<string, number>;
  /** Pruebas del catálogo que no producen fichero, con el motivo. */
  pruebasDescartadas: { prueba: string; motivo: string }[];
  filasCatalogoCubiertas: number;
  filasCatalogoSoloEngarde: { total: number; cubiertas: number };
  resultados: number;
  asaltos: { POULE: number; TABLEAU: number };
  estados: Record<string, Record<string, number>>;
};

function main(): void {
  const entrada = argumento('entrada', CARPETA_ENGARDE);
  const salida = argumento('salida', join(tmpdir(), 'calendario-trabajo', 'hechos', 'engarde'));
  const inventario = leerInventario(argumento('inventario', INVENTARIO_POR_DEFECTO));
  const porClave = new Map(inventario.map((f) => [f.claveCatalogo, f]));
  const { torneos } = torneosDelInventario(inventario);
  const cache = new CacheEngarde(entrada);
  mkdirSync(salida, { recursive: true });

  const inf: InformeEngarde = {
    generado: new Date().toISOString(), torneos: torneos.length, torneosConPruebas: 0, pruebasIndice: 0,
    pruebasDelCatalogo: 0, ficheros: 0, descartadas: {}, pruebasDescartadas: [], filasCatalogoCubiertas: 0,
    filasCatalogoSoloEngarde: { total: 0, cubiertas: 0 }, resultados: 0, asaltos: { POULE: 0, TABLEAU: 0 }, estados: {},
  };
  const descartar = (m: string) => (inf.descartadas[m] = (inf.descartadas[m] ?? 0) + 1);
  const cubiertas = new Set<string>();
  const escritos = new Set<string>();

  for (const t of torneos) {
    const filas = t.filas.map((k) => porClave.get(k)!).filter(Boolean);
    const pruebas: PruebaIndice[] = [];
    for (let n = 1; n <= 25; n += 1) {
      const xml = cache.leer(claveCache(t.org, t.evt, null, `indice-p${n}.xml`));
      if (xml === null) break;
      const indice = parsearIndiceEngarde(xml);
      if (!indice.ok) break;
      const sexes = sexesDelIndice(xml);
      for (const p of indice.pruebas) {
        if (pruebas.some((q) => q.compe === p.compe)) continue;
        const sexe = sexes.get(p.compe) ?? null;
        pruebas.push({ ...p, sexe, generoFinal: generoEngarde(p, sexe), categoriaFinal: categoriaEngarde(p.categoriaOriginal, p.titulo) });
      }
      if (n >= indice.paginas) break;
    }
    if (pruebas.length === 0) continue;
    inf.torneosConPruebas += 1;
    const torneoHtml = cache.leer(claveCache(t.org, t.evt, null, 'torneo.html'));
    const nombreTorneo = (torneoHtml ? parsearTorneoEngarde(torneoHtml).nombre : null) ?? filas[0]?.nombre ?? `${t.org}/${t.evt}`;

    const elegidas: { p: PruebaIndice; filas: FilaInventario[] }[] = [];
    for (const p of pruebas) {
      inf.pruebasIndice += 1;
      const fs = filasDePrueba(p, filas);
      if (fs.length === 0) {
        descartar('fuera_del_catalogo');
        continue;
      }
      if (!p.categoriaFinal) {
        const cats = new Set(fs.map((f) => f.categoria).filter(Boolean));
        if (cats.size === 1) p.categoriaFinal = [...cats][0] as Categoria;
      }
      elegidas.push({ p, filas: fs });
    }
    const fechas = elegidas.map((e) => e.p.fecha).filter((f): f is string => !!f).sort();
    for (const { p, filas: fs } of elegidas) {
      inf.pruebasDelCatalogo += 1;
      const prueba = cache.leer(claveCache(t.org, t.evt, p.compe, 'prueba.html'));
      if (prueba === null) {
        descartar('sin_pagina_de_prueba');
        continue;
      }
      const faltan: string[] = [];
      const poules: Paginas['poules'] = [];
      const cuadros: Paginas['cuadros'] = [];
      let clasfinal: string | null = null;
      for (const nombre of paginasDePrueba(prueba, t.org, t.evt, p.compe).slice(0, 16)) {
        const html = cache.leer(claveCache(t.org, t.evt, p.compe, nombre));
        if (html === null) {
          faltan.push(nombre);
          continue;
        }
        const np = nombre.match(/^poules(\d+)\.htm$/i);
        if (/^clasfinal\.htm$/i.test(nombre)) clasfinal = html;
        else if (np) poules.push({ pagina: Number(np[1]), html });
        else cuadros.push({ url: `${urlPruebaEngarde(t.org, t.evt, p.compe)}/${nombre}`, html });
      }
      const temporadas = new Set(fs.map((f) => f.temporada));
      const fechaRef = p.fecha ?? fechas[0] ?? null;
      const season = temporadas.size === 1 ? [...temporadas][0] : fechaRef ? temporadaRfee(fechaRef) : null;
      if (!season) {
        descartar('sin_temporada');
        continue;
      }
      const r = convertirPrueba(p, { prueba, clasfinal, poules, cuadros, faltan }, {
        season,
        nombreTorneo,
        inicio: fechas[0] ?? null,
        fin: fechas[fechas.length - 1] ?? null,
        ciudad: fs.find((f) => f.city)?.city ?? null,
      });
      if (!r.ok) {
        descartar(r.motivo);
        inf.pruebasDescartadas.push({ prueba: `${t.org}/${t.evt}/${p.compe}`, motivo: r.motivo });
        continue;
      }
      const h = r.hechos;
      const fichero = ficheroHechos(h);
      writeFileSync(join(salida, fichero), JSON.stringify(h, null, 2));
      escritos.add(fichero);
      inf.ficheros += 1;
      inf.resultados += h.results.length;
      for (const b of h.bouts) inf.asaltos[b.phase] += 1;
      for (const s of ['results', 'pools', 'tableau'] as const) {
        const e = (inf.estados[s] ??= {});
        e[h.status[s]] = (e[h.status[s]] ?? 0) + 1;
      }
      for (const f of fs) cubiertas.add(f.claveCatalogo);
    }
  }
  // La carpeta de salida es exclusiva de este conversor: lo que no se ha escrito ahora es de una ejecución anterior.
  if (existsSync(salida)) {
    for (const f of readdirSync(salida)) if (f.endsWith('.json') && !f.startsWith('_') && !escritos.has(f)) rmSync(join(salida, f));
  }
  inf.filasCatalogoCubiertas = cubiertas.size;
  const soloEngarde = inventario.filter(
    (f) => f.enlaces.some((e) => e.tipo === 'externo' && /engarde-service\.com/i.test(e.url)) &&
      !f.enlaces.some((e) => e.tipo === 'pdf' || e.tipo === 'html'),
  );
  inf.filasCatalogoSoloEngarde = { total: soloEngarde.length, cubiertas: soloEngarde.filter((f) => cubiertas.has(f.claveCatalogo)).length };
  writeFileSync(join(salida, '_informe.json'), JSON.stringify(inf, null, 2));
  console.log(JSON.stringify(inf, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
