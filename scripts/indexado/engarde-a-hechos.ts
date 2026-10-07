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
import { argumento, CARPETA_TRABAJO } from './comun';
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

export {
  categoriaEngarde,
  convertirPrueba,
  esGeneralDePruebaTerminada,
  generoEngarde,
  marcarFilasSinPuesto,
  referencias,
  temporadaRfee,
  type Conversion,
  type Paginas,
  type PruebaIndice,
} from '../../src/lib/ingest/hechos/engarde';
import { categoriaEngarde, convertirPrueba, generoEngarde, temporadaRfee, type Paginas, type PruebaIndice } from '../../src/lib/ingest/hechos/engarde';

type Genero = HechosPrueba['competition']['gender'];
type Categoria = HechosPrueba['competition']['category'];
type Estado = HechosPrueba['status']['results'];

const dia = (f: string) => Math.round(Date.parse(`T00:00:00Z`) / 86_400_000);

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
  const salida = argumento('salida', join(CARPETA_TRABAJO, 'hechos', 'engarde'));
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