/**
 * Asaltos de pruebas FIE individuales de las temporadas 2015 y 2016 (las que el
 * lote 7 no miró: empezó en 2017) que la base tiene sin poules o sin cuadro,
 * desde Fencing Worldwide (fencingworldwide.com, la web pública de resultados
 * de Ophardt; su archivo anual empieza en 2015). Mismos lectores y reglas que
 * `lote7-fie-fww.ts`, con la caché y la red del lote 10.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-fie-fww.ts descargar [--db <sqlite>]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-fie-fww.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * Cada prueba FIE se casa con la única prueba FWW del torneo compatible (fechas
 * y sede) con su arma, género y categoría cuya clasificación comparte al menos
 * la mitad de los tiradores (y 15 puntos más que la siguiente). Las poules se
 * validan con la tabla publicada y el cuadro, además de coherente, contra los
 * puestos oficiales (final = 1.º y 2.º, semifinales = 3.º, perdedor de la ronda
 * de N entre N/2+1 y N); lo que no cumple no se escribe.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FWW_BASE, parsearResultadosFww } from '../../src/lib/ingest/sources/fww';
import { argumento } from './comun';
import { hechosBase, solape } from './fie-completar-otras';
import { anadirAsaltos } from './fie-huecos-asaltos';
import {
  abrirBase, cuadroContraClasificacion, escribirHechos, hechosAsaltos, HOY, mapaPuestos, pruebasFie, puestosDeBase, type PruebaBase,
} from './lote10-fie-comun';
import {
  destinosDePruebaFww, ediciones, leerPruebaFww, parsearArchivoFww, pruebasDeTorneoFww, torneoCompatible, type Edicion, type TorneoFww,
} from './lote7-fie-fww';
import { CACHE_LOTE10_FIE, enCache, NUEVO9, obtener, salidaLote10Fie, sha256, texto } from './lote10-fie-red';

const MANIFIESTO = join(CACHE_LOTE10_FIE, 'fww-manifiesto.json');
const INFORME = join(CACHE_LOTE10_FIE, 'fww-informe.json');
const url = (ruta: string, resto: string) => `${FWW_BASE}/en/${ruta}/${resto}`;

type Manifiesto = { torneos: { edicion: string; torneo: TorneoFww; pruebas: { ruta: string; destinos: string[] }[] }[] };

export function objetivosFww(pruebas: readonly PruebaBase[]): PruebaBase[] {
  return pruebas.filter((p) => {
    const fecha = p.date ?? p.startDate;
    if (!fecha || fecha >= HOY || fecha < '2014-09-01' || p.resultados === 0) return false;
    const olimpicos = /juegos_olimpicos/.test(p.tournamentKey);
    return (p.poule === 0 && !olimpicos) || p.tableau === 0;
  });
}

async function descargar() {
  const db = abrirBase(argumento('db', NUEVO9));
  const eds = ediciones(objetivosFww(pruebasFie(db, { desde: 2015, hasta: 2016, formato: 'INDIVIDUAL' })));
  db.close();
  console.log(`${eds.length} ediciones objetivo`);
  const anios = [...new Set(eds.flatMap((e) => [e.desde.slice(0, 4), e.hasta.slice(0, 4)]))].filter((a) => a >= '2015').sort();
  const archivo: TorneoFww[] = [];
  for (const a of anios) {
    const d = await obtener(`${FWW_BASE}/en/archive/${a}`);
    const t = parsearArchivoFww(texto(d) ?? '');
    console.log(`archivo ${a}: HTTP ${d.status}, ${t.length} torneos`);
    archivo.push(...t);
  }
  const man: Manifiesto = { torneos: [] };
  for (const e of eds) {
    const ts = archivo.filter((t) => torneoCompatible(e, t));
    if (!ts.length) continue;
    for (const t of ts) {
      const pagina = texto(await obtener(url(t.ruta, 'tournament/')));
      const rutas = pagina ? pruebasDeTorneoFww(pagina) : [];
      console.log(`+ ${e.clave}: ${t.ruta} «${t.nombre}» ${t.pais} ${t.ciudad} ${t.desde}..${t.hasta}: ${rutas.length} pruebas`);
      const pruebas: Manifiesto['torneos'][number]['pruebas'] = [];
      for (const r of rutas) {
        const res = texto(await obtener(url(r, 'results/')));
        const p = res ? parsearResultadosFww(res) : null;
        if (!p || p.formato === 'EQUIPOS' || !p.hayTabla) continue;
        if (!e.pruebas.some((x) => x.weapon === p.arma && x.gender === p.genero && (p.categoria === null || p.categoria === x.category))) continue;
        const global = texto(await obtener(url(r, 'global/')));
        const destinos = global ? destinosDePruebaFww(global, r) : [];
        for (const d of destinos) await obtener(url(r, d));
        pruebas.push({ ruta: r, destinos });
      }
      man.torneos.push({ edicion: e.clave, torneo: t, pruebas });
    }
  }
  writeFileSync(MANIFIESTO, `${JSON.stringify(man, null, 1)}\n`);
  console.log(`manifiesto en ${MANIFIESTO}`);
}

type Fila = { season: string; competitionKey: string; edicion: string; prueba: string | null; motivo: string; poules?: string; cuadro?: string; problemas?: string[] };

function hechos() {
  const db = abrirBase(argumento('db', NUEVO9));
  const salida = argumento('salida', salidaLote10Fie('fww'));
  if (!existsSync(MANIFIESTO)) throw new Error(`falta ${MANIFIESTO}: ejecuta antes «descargar»`);
  const man = JSON.parse(readFileSync(MANIFIESTO, 'utf8')) as Manifiesto;
  const eds: Edicion[] = ediciones(objetivosFww(pruebasFie(db, { desde: 2015, hasta: 2016, formato: 'INDIVIDUAL' })));
  const informe: Fila[] = [];
  let escritos = 0;
  let nP = 0;
  let nT = 0;
  for (const e of eds) {
    const torneos = man.torneos.filter((t) => t.edicion === e.clave);
    const candidatas = torneos.flatMap((t) => t.pruebas.map((p) => {
      const res = texto(enCache(url(p.ruta, 'results/')));
      return { torneo: t.torneo, ruta: p.ruta, destinos: p.destinos, resultados: res ? parsearResultadosFww(res) : null };
    })).filter((c) => c.resultados?.hayTabla);
    for (const p of e.pruebas) {
      const base = { season: p.season, competitionKey: p.competitionKey, edicion: e.clave };
      if (!torneos.length) {
        informe.push({ ...base, prueba: null, motivo: 'sin_torneo_en_el_archivo_de_fww' });
        continue;
      }
      const puestos = puestosDeBase(db, p.id);
      const compatibles = candidatas
        .filter((c) => c.resultados!.arma === p.weapon && c.resultados!.genero === p.gender && (c.resultados!.categoria === null || c.resultados!.categoria === p.category))
        .map((c) => ({ c, s: solape(puestos, c.resultados!.filas.map((f) => ({ nombre: f.nombre, pais: f.nacion }))) }))
        .sort((x, y) => y.s - x.s);
      const mejor = compatibles[0];
      if (!mejor || mejor.s < 0.5 || (compatibles[1] && compatibles[1].s > mejor.s - 0.15)) {
        informe.push({ ...base, prueba: mejor?.c.ruta ?? null, motivo: !mejor ? 'sin_prueba_fww_compatible' : `solape_insuficiente_o_ambiguo:${compatibles.slice(0, 2).map((x) => x.s.toFixed(2)).join('/')}` });
        continue;
      }
      const c = mejor.c;
      const paginas: { destino: string; html: string; sha: string }[] = [];
      for (const d of c.destinos) {
        const doc = enCache(url(c.ruta, d));
        const html = texto(doc);
        if (html && doc?.sha256) paginas.push({ destino: d, html, sha: doc.sha256 });
      }
      const lectura = leerPruebaFww(paginas, c.resultados!);
      if (!lectura.poules && !lectura.cuadro) {
        informe.push({ ...base, prueba: c.ruta, motivo: 'fww_no_publica_asaltos' });
        continue;
      }
      const fuenteUrl = url(c.ruta, 'results/');
      const r = anadirAsaltos(hechosBase(p, puestos), lectura, { nombre: 'fww', url: fuenteUrl, descripcion: 'Fencing Worldwide' });
      let bouts = r.hechos.bouts.filter((b) => (b.phase === 'POULE' ? p.poule === 0 : p.tableau === 0));
      const problemas = cuadroContraClasificacion(bouts.filter((b) => b.phase === 'TABLEAU'), mapaPuestos(puestos));
      if (problemas.length) bouts = bouts.filter((b) => b.phase !== 'TABLEAU');
      const poules = bouts.filter((b) => b.phase === 'POULE').length;
      const cuadro = bouts.filter((b) => b.phase === 'TABLEAU').length;
      const fila: Fila = {
        ...base, prueba: c.ruta, motivo: 'escrita', problemas,
        poules: `${poules}/${r.informe.pools.esperados} ${JSON.stringify(r.informe.pools.descartados)}`,
        cuadro: `${cuadro}/${r.informe.tableau.esperados} ${JSON.stringify(r.informe.tableau.descartados)}`,
      };
      if (!bouts.length) {
        informe.push({ ...fila, motivo: 'ningun_asalto_valido_de_una_fase_que_falte' });
        continue;
      }
      const h = hechosAsaltos(p, {
        extractor: 'lote10_fww', sourceUrl: fuenteUrl, sourceSha256: sha256(paginas.map((x) => x.sha).join('|')),
        pools: poules ? r.hechos.status.pools : 'parcial',
        tableau: cuadro ? r.hechos.status.tableau : 'parcial',
        notas: [
          `Lote 10: poules y cuadro publicados en Fencing Worldwide (Ophardt), torneo ${c.torneo.ruta} «${c.torneo.nombre}» (${c.torneo.pais ?? '?'} ${c.torneo.ciudad}), prueba ${c.ruta}; results vacío a propósito`,
          `Prueba casada por fechas, sede, arma, género, categoría y clasificación (${Math.round(mejor.s * 100)} % en común); tiradores identificados por nombre y nación con los factKey de la clasificación FIE`,
          `Poules ${poules} de ${r.informe.pools.esperados}; cuadro ${cuadro} de ${r.informe.tableau.esperados}${problemas.length ? ` (cuadro descartado: ${problemas.join(', ')})` : ' (coherente con los puestos oficiales)'}`,
        ],
        bouts,
      });
      escribirHechos(salida, h);
      escritos += 1;
      nP += poules;
      nT += cuadro;
      informe.push(fila);
    }
  }
  db.close();
  const motivos: Record<string, number> = {};
  for (const i of informe) motivos[i.motivo.split(':')[0]] = (motivos[i.motivo.split(':')[0]] ?? 0) + 1;
  writeFileSync(INFORME, `${JSON.stringify({ generado: new Date().toISOString(), escritos, poules: nP, cuadro: nT, motivos, pruebas: informe }, null, 1)}\n`);
  for (const i of informe.filter((x) => x.motivo !== 'sin_torneo_en_el_archivo_de_fww')) console.log(`${i.season} ${i.competitionKey} ${i.prueba ?? '-'}: ${i.motivo} ${i.poules ?? ''} ${i.cuadro ?? ''} ${i.problemas?.join(',') ?? ''}`);
  console.log(`${escritos} ficheros (${nP} asaltos de poule, ${nT} de cuadro) en ${salida}; informe en ${INFORME}`);
  console.log(JSON.stringify(motivos));
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'descargar') await descargar();
  else if (orden === 'hechos') hechos();
  else throw new Error('uso: lote10-fie-fww.ts descargar|hechos [--db <sqlite>] [--salida <dir>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
