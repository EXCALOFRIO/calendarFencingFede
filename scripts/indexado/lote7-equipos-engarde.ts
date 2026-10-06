/**
 * Encuentros de las pruebas por equipos de fuente `engarde` que sólo tienen la
 * clasificación: poules y cuadro de equipos leídos de las páginas de Engarde ya
 * descargadas (engarde-service.com y su exportación estática), sin red.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-equipos-engarde.ts \
 *     [--db <nuevo7.sqlite>] [--salida <hechos/lote7-equipos>]
 *
 * Los conversores de Engarde no importan los encuentros de equipos porque
 * `checkBout` los reserva al cara a cara individual. Aquí se leen con los mismos
 * parsers (la geometría de la poule y del cuadro es la de individual, con relevos
 * a 45) y se escriben con la fuente, temporada y claves de la prueba guardada.
 * Las referencias de cada equipo son el `factKey` de su puesto guardado (nombre
 * normalizado único); la clasificación no se reescribe.
 *
 * Algunos cuadros publican además los relevos tirador a tirador (tocados de cada
 * relevo y marcador acumulado). No se importan: en una prueba EQUIPOS todos los
 * asaltos son de equipo (`desvincularEquipos` los separa de las personas) y un
 * relevo no es un asalto individual a 5/15; el informe los cuenta.
 */
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import { FusionAsaltos } from '../../src/lib/ingest/asaltos-complementarios';
import type { AsaltoHecho, HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { urlPruebaEngarde } from '../../src/lib/ingest/sources/engarde';
import { documentosDelMenu, esCuadroPrincipal, normalizarCuadroAntiguo, tipoDocumentoEngarde } from '../../src/lib/ingest/sources/engarde-antiguo';
import { claveRondaCuadro, parsearCuadroEngarde } from '../../src/lib/ingest/sources/engarde-cuadro';
import { parsearPoulesEngarde } from '../../src/lib/ingest/sources/engarde-poules';
import { argumento, CARPETA_TRABAJO } from './comun';
import { CacheEngarde, claveCache, paginasDePrueba } from './engarde-descargar';
import { urlFicheroEngarde } from './engarde-historico-descargar';
import {
  asegurarCarpeta, escribirHechos, hechosDePrueba, incoherentesCuadroEquipos, motivoEncuentro, NUEVO7, pruebasEquipos,
  SALIDA_EQUIPOS, tercerPuestoComoRonda,
} from './lote7-equipos-comun';

type Estado = HechosPrueba['status']['results'];
export type Documento = { url: string; html: string; tipo: 'poules' | 'cuadro'; pagina: number; antiguo: boolean };

const CACHES = [
  join(CARPETA_TRABAJO, 'engarde'),
  join(CARPETA_TRABAJO, 'cache-asaltos-rfee', 'engarde'),
  join(CARPETA_TRABAJO, 'engarde-historico'),
];

function numeroPoules(fichero: string): number {
  const n = fichero.match(/(\d+)\.html?$/i);
  return n ? Number(n[1]) : 1;
}

/** Documentos de poules y cuadro principal de la prueba en cualquiera de las cachés; `faltan` = enlazados y no descargados. */
export function documentosEnCache(caches: readonly CacheEngarde[], org: string, evt: string, compe: string): { docs: Documento[]; faltan: string[] } {
  for (const cache of caches) {
    const docs: Documento[] = [];
    const faltan: string[] = [];
    const menu = cache.leer(claveCache(org, evt, compe, 'files_menu.html'));
    if (menu !== null) {
      for (const d of documentosDelMenu(menu)) {
        if (d.tipo === 'clasificacion' || (d.tipo === 'cuadro' && !esCuadroPrincipal(d.fichero))) continue;
        const html = cache.leer(claveCache(org, evt, compe, `files_${d.fichero}`));
        if (html === null) faltan.push(d.fichero);
        else docs.push({ url: urlFicheroEngarde(org, evt, compe, d.fichero), html, tipo: d.tipo, pagina: numeroPoules(d.fichero), antiguo: true });
      }
      return { docs, faltan };
    }
    const prueba = cache.leer(claveCache(org, evt, compe, 'prueba.html'));
    if (prueba === null) continue;
    for (const f of paginasDePrueba(prueba, org, evt, compe)) {
      const tipo = tipoDocumentoEngarde(f);
      if (tipo !== 'poules' && tipo !== 'cuadro') continue;
      const html = cache.leer(claveCache(org, evt, compe, f));
      if (html === null) faltan.push(f);
      else docs.push({ url: `${urlPruebaEngarde(org, evt, compe)}/${f}`, html, tipo, pagina: numeroPoules(f), antiguo: false });
    }
    return { docs, faltan };
  }
  return { docs: [], faltan: [] };
}

/** Referencia de equipo: el `factKey` de su puesto guardado si el nombre es único; si no, la forma de `referencias()`. */
export function refsEquipos(resultados: readonly { factKey: string; name: string }[]): (nombre: string) => string | null {
  const porNombre = new Map<string, string | null>();
  for (const r of resultados) {
    const n = normalizeSportName(r.name);
    porNombre.set(n, porNombre.has(n) ? null : r.factKey);
  }
  return (nombre) => {
    const n = normalizeSportName(nombre);
    if (!n) return null;
    if (porNombre.has(n)) return porNombre.get(n) ?? null;
    return `engarde:${n}|`;
  };
}

/**
 * Dos diferencias del cuadro de equipos con el individual que el parser no admite: el marcador
 * lleva «45/34 >>» (enlace a los relevos) y los encuentros por puestos (tercer lugar, cuadro
 * 9-16…) se dibujan en espejo, como columnas tituladas a la izquierda del cuadro principal.
 * Esas columnas dejan de ser rondas (sus participantes no son la primera ronda del cuadro) y el
 * cuadro queda parcial: los encuentros por puestos no se importan.
 */
export function prepararCuadroEquipos(html: string): { html: string; sinPuestos: boolean } {
  const $ = cheerio.load(html);
  $('table.tableau td.score').each((_, td) => {
    const t = $(td).text().replace(/\u00a0/g, ' ');
    const m = t.match(/(\d{1,3})\s*\/\s*(\d{1,3})\s*(?:>\s*)*$/);
    if (m) $(td).text(`${m[1]}/${m[2]}`);
  });
  let sinPuestos = false;
  $('table.tableau').each((_, tabla) => {
    const titulos = $(tabla).find('td.tableTitle').toArray();
    const primeraRonda = titulos.findIndex((td) => claveRondaCuadro($(td).text().replace(/\u00a0/g, ' ').trim()) !== null);
    if (primeraRonda <= 0) return;
    for (const td of titulos.slice(0, primeraRonda)) $(td).removeClass('tableTitle');
    sinPuestos = true;
  });
  return { html: $.html(), sinPuestos };
}

export type LecturaEquipos = {
  bouts: AsaltoHecho[];
  pools: Estado;
  tableau: Estado;
  notas: string[];
  descartes: Record<string, number>;
};

/** Primero y segundo de la clasificación guardada, si cada puesto es de un solo equipo. */
export function podioDe(resultados: readonly { name: string; position: number | null }[]): { primero: string | null; segundo: string | null } {
  const de = (n: number) => {
    const xs = resultados.filter((r) => r.position === n);
    return xs.length === 1 ? xs[0].name : null;
  };
  return { primero: de(1), segundo: de(2) };
}

export function encuentrosEngarde(
  docs: readonly Documento[],
  faltan: readonly string[],
  ref: (n: string) => string | null,
  podio: { primero: string | null; segundo: string | null } = { primero: null, segundo: null },
): LecturaEquipos {
  const bouts: AsaltoHecho[] = [];
  const notas: string[] = [];
  const descartes: Record<string, number> = {};
  const descartar = (m: string) => (descartes[m] = (descartes[m] ?? 0) + 1);
  const valido = (b: AsaltoHecho) => {
    const m = motivoEncuentro(b) ?? (b.aRef === b.bRef ? 'mismo_equipo' : null);
    if (m) descartar(m);
    return m === null;
  };

  // Poules.
  let pools: Estado = 'sin_resultados';
  const paginasPoules = docs.filter((d) => d.tipo === 'poules');
  if (paginasPoules.length > 0) {
    let esperados = 0;
    let importados = 0;
    let ilegibles = 0;
    for (const d of paginasPoules) {
      const r = parsearPoulesEngarde(d.html, { pagina: d.pagina });
      if (r.estado !== 'leido') {
        ilegibles += 1;
        continue;
      }
      esperados += r.esperados;
      for (const a of r.asaltos) {
        const aRef = ref(a.a.nombre);
        const bRef = ref(a.b.nombre);
        if (!aRef || !bRef) {
          descartar('poule_equipo_ambiguo');
          continue;
        }
        const b: AsaltoHecho = {
          phase: 'POULE', roundKey: a.ronda, aRef, bRef, aName: a.a.nombre, bName: a.b.nombre,
          scoreA: a.a.tocados, scoreB: a.b.tocados, winner: a.ganador,
        };
        if (!valido(b)) continue;
        bouts.push(b);
        importados += 1;
      }
    }
    const faltanPoules = faltan.some((f) => /^poules/i.test(f));
    if (importados === 0) pools = ilegibles > 0 ? 'ilegible' : 'sin_resultados';
    else if (importados === esperados && ilegibles === 0 && !faltanPoules) pools = 'completo';
    else {
      pools = 'parcial';
      notas.push(`Poules de equipos: ${importados} de ${esperados} encuentros${faltanPoules ? '; faltan páginas de poules' : ''}`);
    }
  }

  // Cuadro principal (los cuadros de puestos no tienen rondas regulares).
  let tableau: Estado = 'sin_resultados';
  const paginasCuadro = docs.filter((d) => d.tipo === 'cuadro');
  if (paginasCuadro.length > 0) {
    const fusion = new FusionAsaltos();
    let ilegibles = 0;
    let sinTercero = false;
    for (const d of paginasCuadro) {
      const p = prepararCuadroEquipos(d.antiguo ? normalizarCuadroAntiguo(d.html) : d.html);
      sinTercero ||= p.sinPuestos;
      const c = parsearCuadroEngarde(p.html, { individual: true });
      if (c.estado !== 'leido') {
        ilegibles += 1;
        continue;
      }
      fusion.anadir(c, d.url);
    }
    if (sinTercero) notas.push('Los encuentros por puestos dibujados junto al cuadro principal no se importan');
    const parte = fusion.resumen(ilegibles === 0 && !sinTercero && !faltan.some((f) => /^tableau/i.test(f)));
    let importados = 0;
    for (const a of parte.asaltos) {
      const aRef = ref(a.nombreA);
      const bRef = ref(a.nombreB);
      if (!aRef || !bRef) {
        descartar('cuadro_equipo_ambiguo');
        continue;
      }
      const b: AsaltoHecho = {
        phase: 'TABLEAU', roundKey: a.ronda === 'SF' ? 'T4' : a.ronda === 'F' ? 'T2' : a.ronda, aRef, bRef,
        aName: a.nombreA, bName: a.nombreB, scoreA: a.puntosA, scoreB: a.puntosB, winner: null,
      };
      if (!valido(b)) continue;
      bouts.push(b);
      importados += 1;
    }
    const reparados = tercerPuestoComoRonda(bouts);
    if (reparados.some((b, i) => b !== bouts[i])) notas.push('Encuentro por el tercer puesto leído en el cuadro principal: pasa a T2-3');
    bouts.splice(0, bouts.length, ...reparados);
    const fuera = incoherentesCuadroEquipos(bouts, podio, (x, y) => normalizeSportName(x) === normalizeSportName(y));
    if (fuera.size > 0) {
      descartes.cuadro_incoherente = fuera.size;
      importados -= fuera.size;
      for (const i of [...fuera].sort((x, y) => y - x)) bouts.splice(i, 1);
    }
    if (importados === 0) tableau = ilegibles > 0 ? 'ilegible' : 'sin_resultados';
    else if (parte.completo && importados === parte.importado) tableau = 'completo';
    else {
      tableau = 'parcial';
      notas.push(`Cuadro de equipos: ${importados} de ${parte.publicado} encuentros publicados`);
    }
  }
  if (Object.keys(descartes).length > 0) notas.push(`Encuentros descartados: ${JSON.stringify(descartes)}`);
  return { bouts, pools, tableau, notas, descartes };
}

function main(): void {
  const rutaDb = argumento('db', NUEVO7);
  const salida = asegurarCarpeta(join(argumento('salida', SALIDA_EQUIPOS), 'engarde'));
  const db = new DatabaseSync(rutaDb, { readOnly: true });
  const pruebas = pruebasEquipos(db, 'engarde');
  db.close();
  const caches = CACHES.map((c) => new CacheEngarde(c));
  const inf = {
    generado: new Date().toISOString(),
    pruebas: pruebas.length,
    ficheros: 0,
    encuentros: { POULE: 0, TABLEAU: 0 },
    estados: { pools: {} as Record<string, number>, tableau: {} as Record<string, number> },
    sinDocumentos: [] as string[],
    sinEncuentros: [] as string[],
    yaCompletas: 0,
    faltanPaginas: [] as { prueba: string; faltan: string[] }[],
    /** Cuadros que publican los relevos tirador a tirador (no se importan: ver cabecera). */
    conRelevosPublicados: [] as string[],
  };
  const sumar = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
  const escritos = new Set<string>();
  for (const p of pruebas) {
    if (!p.competitionKey.startsWith('engarde:')) {
      inf.sinDocumentos.push(`${p.competitionKey} (Wayback: sólo clasificación)`);
      continue;
    }
    if (p.poules > 0 && p.cuadro > 0) {
      inf.yaCompletas += 1;
      continue;
    }
    const [org, evt, compe] = p.competitionKey.slice('engarde:'.length).split('/');
    const { docs, faltan } = documentosEnCache(caches, org, evt, compe);
    if (faltan.length > 0) inf.faltanPaginas.push({ prueba: p.competitionKey, faltan });
    if (docs.length === 0) {
      inf.sinDocumentos.push(p.competitionKey);
      continue;
    }
    if (docs.some((d) => d.tipo === 'cuadro' && /<a name="?\w+-\d+/i.test(d.html) && /Toques|Touches/i.test(d.html))) {
      inf.conRelevosPublicados.push(p.competitionKey);
    }
    const l = encuentrosEngarde(docs, faltan, refsEquipos(p.resultados), podioDe(p.resultados));
    if (l.bouts.length === 0) {
      inf.sinEncuentros.push(p.competitionKey);
      continue;
    }
    const principal = docs.find((d) => d.tipo === 'cuadro') ?? docs[0];
    const h = hechosDePrueba(p, {
      extractor: 'lector_engarde_equipos',
      sourceUrl: principal.url,
      sourceSha256: createHash('sha256').update(principal.html).digest('hex'),
      results: [],
      bouts: l.bouts,
      status: {
        results: 'sin_resultados', pools: l.pools, tableau: l.tableau, publishedParticipants: null,
        notes: ['Encuentros por equipos de Engarde; la clasificación guardada no se toca', ...l.notas],
      },
    });
    escritos.add(escribirHechos(salida, h));
    inf.ficheros += 1;
    for (const b of h.bouts) inf.encuentros[b.phase] += 1;
    sumar(inf.estados.pools, l.pools);
    sumar(inf.estados.tableau, l.tableau);
  }
  // La subcarpeta es exclusiva de este productor: lo que no se ha escrito ahora es de una ejecución anterior.
  for (const f of readdirSync(salida)) if (f.endsWith('.json') && !f.startsWith('_') && !escritos.has(f)) rmSync(join(salida, f));
  writeFileSync(join(salida, '_informe.json'), JSON.stringify(inf, null, 2));
  console.log(JSON.stringify({
    ...inf, sinDocumentos: inf.sinDocumentos.length, faltanPaginas: inf.faltanPaginas.length,
    conRelevosPublicados: inf.conRelevosPublicados.length,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
