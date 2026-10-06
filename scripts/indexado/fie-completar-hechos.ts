/**
 * Hechos de asaltos FIE que faltan en la base, desde la caché de la API FIE
 * (`fie-completar-descargar`), sin red:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-completar-hechos.ts \
 *     [--base <sqlite>] [--salida <dir>] [--informe <json>]
 *
 * Sólo se escribe fichero para las pruebas con alguna fase en la que la FIE
 * publica asaltos legibles que la base no tiene (victorias por prioridad, poules
 * con la matriz desfasada, segunda vuelta de poules) o en la que la base guarda
 * claves que la FIE ya no publica (tirador corregido, segunda vuelta guardada como
 * `P<n>`). Cada fase incluida lleva TODOS sus asaltos legibles:
 *  - si la base guarda claves que sobran, la fase va `completo` para que el
 *    cargador la sustituya (borra lo que sobra) en lugar de duplicar;
 *  - si no, `completo` sólo cuando no queda ningún asalto disputado ilegible, y
 *    `parcial` (fusión por clave estable, sin borrar) en otro caso.
 * Los puestos no se tocan (`results` vacío y estado `parcial`: el cargador se salta
 * la sección) y el vínculo a persona sale de la clasificación ya guardada: cada
 * referencia es el ID FIE, que es la `source_fact_key` del puesto. La excepción son
 * las pruebas en las que la FIE corrigió tiradores y cuya clasificación vigente se
 * descargó (`<season>-<id>-ranking-p1.json`): van con ella, `completo`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resultFactKey } from '../../src/lib/identity/resolver';
import { ficheroHechos, hechosPrueba, type AsaltoHecho, type HechosPrueba, type ResultadoHecho } from '../../src/lib/ingest/hechos/formato';
import { normalizarPaginaRanking, urlPrueba } from '../../src/lib/ingest/sources/fie-resultados';
import { argumento } from './comun';
import { analizarCuadro, analizarPoules, claveAsalto, total, type AnalisisFase } from './fie-completar-analisis';
import {
  abrirBase, asaltosDeBase, BASE_PRODUCCION, CACHE, CACHE_FIE, leerFieCache, pruebasFieIndividuales,
  puestosDeBase, SALIDA_HECHOS, sha256, type AsaltoBase, type PruebaBase,
} from './fie-completar-comun';

const PAIS = /^[A-Z]{3}$/;

/** Cabecera de hechos con las claves de la fila FIE existente, para que el cargador la actualice. */
export function cabecera(p: PruebaBase): Pick<HechosPrueba, 'version' | 'source' | 'edition' | 'competition'> {
  return {
    version: 1,
    source: 'fie',
    edition: {
      season: p.season,
      tournamentKey: p.tournamentKey,
      name: p.editionName,
      startDate: p.startDate,
      endDate: p.endDate,
      city: p.city,
      countryCode: p.countryCode && PAIS.test(p.countryCode) ? p.countryCode : null,
    },
    competition: {
      competitionKey: p.competitionKey,
      weapon: p.weapon,
      gender: p.gender,
      category: p.category,
      categoryRaw: p.categoryRaw,
      format: p.format,
      date: p.date,
    },
  };
}

export type DecisionFase = {
  incluir: boolean;
  estado: HechosPrueba['status']['pools'];
  nuevos: number;
  sobrantes: number;
  ilegibles: number;
  motivo: string;
};

/** Qué hacer con una fase: incluirla (con qué estado) o dejarla como está en la base. */
export function decidirFase(a: AnalisisFase, guardadas: readonly Pick<AsaltoBase, 'phase' | 'roundKey' | 'aRef' | 'bRef'>[]): DecisionFase {
  const claves = new Set(guardadas.map((b) => `${b.phase}|${b.roundKey}|${b.aRef}|${b.bRef}`));
  const legibles = new Set(a.asaltos.map(claveAsalto));
  const nuevos = a.asaltos.filter((b) => !claves.has(claveAsalto(b))).length;
  const sobran = [...claves].filter((k) => !legibles.has(k));
  const ilegibles = total(a.ilegibles);
  const base = { nuevos, sobrantes: sobran.length, ilegibles };
  if (!a.publicado || a.asaltos.length === 0) return { ...base, incluir: false, estado: 'sin_resultados', motivo: 'sin asaltos legibles en la FIE' };
  if (nuevos === 0 && sobran.length === 0) return { ...base, incluir: false, estado: 'completo', motivo: 'la base ya tiene todos los legibles' };
  const refsEstables = sobran.every((k) => {
    const [, , x, y] = k.split('|');
    return /^\d+$/.test(x) && /^\d+$/.test(y);
  });
  if (sobran.length > 0) {
    if (!refsEstables || a.asaltos.length < guardadas.length) {
      return { ...base, incluir: nuevos > 0, estado: 'parcial', motivo: 'sobran claves que no son de la FIE o hay menos legibles: sólo se fusiona' };
    }
    return { ...base, incluir: true, estado: 'completo', motivo: 'sustituye: la base guarda claves que la FIE ya no publica' };
  }
  return { ...base, incluir: true, estado: ilegibles === 0 ? 'completo' : 'parcial', motivo: 'añade los legibles que faltan' };
}

/**
 * Clasificación FIE vigente (`<season>-<id>-ranking-p1.json`, una página de 200) cuando se
 * descargó para una prueba que la FIE revisó (tiradores corregidos). `null` si no está o no
 * trae todos los puestos.
 */
export function resultadosFieCache(season: string, competitionId: string): ResultadoHecho[] | null {
  const ruta = join(CACHE_FIE, `${season}-${competitionId}-ranking-p1.json`);
  if (!existsSync(ruta)) return null;
  const n = normalizarPaginaRanking(JSON.parse(readFileSync(ruta, 'utf8')));
  if (!n.ok || n.puestos.length !== n.total || n.total === 0) return null;
  return n.puestos.map((r) => ({
    factKey: resultFactKey(String(r.fieId)),
    name: r.nombre,
    countryCode: r.paisCodigo && PAIS.test(r.paisCodigo) ? r.paisCodigo : null,
    club: null,
    position: r.posicion,
    positionRaw: r.posicion === null ? null : String(r.posicion),
    points: r.puntosPrueba === null || !/^-?\d+(\.\d+)?$/.test(String(r.puntosPrueba)) ? null : String(r.puntosPrueba),
    fieId: String(r.fieId),
    license: null,
    birthYear: null,
  }));
}

export type ResultadoPrueba = {
  season: string;
  competitionKey: string;
  nombre: string;
  poules: DecisionFase;
  cuadro: DecisionFase;
  refsFueraDeClasificacion: string[];
  clasificacionRevisada?: boolean;
  fichero: string | null;
};

export function hechosDePrueba(
  p: PruebaBase,
  guardadas: AsaltoBase[],
  puestos: { factKey: string }[],
): { hechos: HechosPrueba | null; informe: ResultadoPrueba } {
  const crudoP = leerFieCache(p.season, p.competitionKey, 'pools');
  const crudoT = leerFieCache(p.season, p.competitionKey, 'tableau');
  const aP = analizarPoules(crudoP?.cuerpo);
  const aT = analizarCuadro(crudoT?.cuerpo);
  const dP = decidirFase(aP, guardadas.filter((b) => b.phase === 'POULE'));
  const dT = decidirFase(aT, guardadas.filter((b) => b.phase === 'TABLEAU'));
  const informe: ResultadoPrueba = {
    season: p.season, competitionKey: p.competitionKey, nombre: p.editionName, poules: dP, cuadro: dT,
    refsFueraDeClasificacion: [], fichero: null,
  };
  if (!dP.incluir && !dT.incluir) return { hechos: null, informe };
  const bouts: AsaltoHecho[] = [...(dP.incluir ? aP.asaltos : []), ...(dT.incluir ? aT.asaltos : [])];
  // Con tiradores corregidos por la FIE también cambia la clasificación: va la vigente.
  const revisada = (dP.incluir && dP.sobrantes > 0) || (dT.incluir && dT.sobrantes > 0)
    ? resultadosFieCache(p.season, p.competitionKey) : null;
  const enClasificacion = new Set((revisada ?? puestos).map((r) => r.factKey));
  informe.refsFueraDeClasificacion = [...new Set(bouts.flatMap((b) => [b.aRef, b.bRef]).filter((r) => !enClasificacion.has(r)))];
  const notas: string[] = [];
  const nota = (nombre: string, a: AnalisisFase, d: DecisionFase) => {
    if (!d.incluir) return;
    const ileg = Object.entries(a.ilegibles).map(([k, v]) => `${k}=${v}`).join(', ');
    const nod = Object.entries(a.noDisputados).map(([k, v]) => `${k}=${v}`).join(', ');
    notas.push(`${nombre}: ${a.asaltos.length} legibles (${a.prioridad} por prioridad con winner), ${d.nuevos} nuevos, ${d.sobrantes} claves guardadas que la FIE ya no publica; ${d.motivo}${ileg ? `; ilegibles en la FIE: ${ileg}` : ''}${nod ? `; no disputados: ${nod}` : ''}${a.vueltas > 1 ? `; ${a.vueltas} vueltas de poules (V<n>P<id>)` : ''}${a.realineadas ? `; ${a.realineadas} poules con la matriz desfasada realineadas` : ''}`);
  };
  nota('poules', aP, dP);
  nota('cuadro', aT, dT);
  if (informe.refsFueraDeClasificacion.length) notas.push(`${informe.refsFueraDeClasificacion.length} IDs FIE de asaltos sin puesto en la clasificación`);
  const usados = [crudoP && dP.incluir ? crudoP.sha : null, crudoT && dT.incluir ? crudoT.sha : null].filter(Boolean);
  const hechos = hechosPrueba.parse({
    ...cabecera(p),
    extractor: 'lector_fie',
    sourceUrl: urlPrueba(Number(p.season), Number(p.competitionKey)),
    sourceSha256: sha256(usados.join('|')),
    status: {
      results: revisada ? 'completo' : 'parcial',
      pools: dP.incluir ? dP.estado : 'parcial',
      tableau: dT.incluir ? dT.estado : 'parcial',
      publishedParticipants: revisada ? revisada.length : null,
      notes: [
        revisada
          ? 'Completa asaltos de la API FIE (fie-completar) y trae la clasificación FIE vigente: la FIE corrigió tiradores de la prueba'
          : 'Completa asaltos de la API FIE (fie-completar); los puestos no se tocan',
        ...notas,
      ],
    },
    results: revisada ?? [],
    bouts,
  });
  informe.clasificacionRevisada = revisada !== null;
  informe.fichero = ficheroHechos(hechos);
  return { hechos, informe };
}

function main() {
  const base = argumento('base', BASE_PRODUCCION);
  const salida = argumento('salida', join(SALIDA_HECHOS, 'api-fie'));
  const rutaInforme = argumento('informe', join(CACHE, 'hechos-fie-informe.json'));
  const db = abrirBase(base);
  const pruebas = pruebasFieIndividuales(db).filter((p) => p.resultados > 0);
  if (existsSync(salida)) {
    for (const f of readdirSync(salida)) if (f.startsWith('fie__') && f.endsWith('.json')) rmSync(join(salida, f));
  }
  mkdirSync(salida, { recursive: true });
  const informes: ResultadoPrueba[] = [];
  const totales = { ficheros: 0, asaltos: 0, nuevosPoule: 0, nuevosCuadro: 0, sobrantesPoule: 0, sobrantesCuadro: 0, sustituciones: 0, refsFuera: 0 };
  for (const p of pruebas) {
    const r = hechosDePrueba(p, asaltosDeBase(db, p.id), puestosDeBase(db, p.id));
    if (!r.hechos) continue;
    writeFileSync(join(salida, r.informe.fichero!), `${JSON.stringify(r.hechos, null, 1)}\n`);
    informes.push(r.informe);
    totales.ficheros += 1;
    totales.asaltos += r.hechos.bouts.length;
    if (r.informe.poules.incluir) {
      totales.nuevosPoule += r.informe.poules.nuevos;
      totales.sobrantesPoule += r.informe.poules.sobrantes;
    }
    if (r.informe.cuadro.incluir) {
      totales.nuevosCuadro += r.informe.cuadro.nuevos;
      totales.sobrantesCuadro += r.informe.cuadro.sobrantes;
    }
    if ((r.informe.poules.incluir && r.informe.poules.sobrantes) || (r.informe.cuadro.incluir && r.informe.cuadro.sobrantes)) totales.sustituciones += 1;
    totales.refsFuera += r.informe.refsFueraDeClasificacion.length;
  }
  db.close();
  writeFileSync(rutaInforme, `${JSON.stringify({ generado: new Date().toISOString(), base, salida, totales, pruebas: informes }, null, 1)}\n`);
  console.log(JSON.stringify(totales, null, 2));
  console.log(`informe en ${rutaInforme}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
