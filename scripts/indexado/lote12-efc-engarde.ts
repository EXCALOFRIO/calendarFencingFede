/**
 * Lote 12, EFC: cuadros (y poules) de pruebas del circuito europeo cadete publicadas en Engarde
 * que `lote7-efc` dejó sin cuadro porque la página nueva de Engarde (2025-) escribe en las rondas
 * siguientes «NOMBRE Apellido NAC» y el lector no casaba al ganador con los contendientes.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote12-efc-engarde.ts [--huecos <huecos-nuevo12.json>]
 *
 * Toma de los huecos EFC (`cobertura-base.ts`) las pruebas cuya lectura viene de Engarde, vuelve
 * a bajar sus páginas (caché nueva `cache-lote12-efc`, 2 peticiones por host y ≥800 ms), limpia
 * la nación pegada al nombre (`quitarNacionEnCuadro`, la de `lote8c-engarde`) y convierte con los
 * lectores de siempre. La edición y la prueba conservan las claves EFC del fichero de `lote7-efc`;
 * los puestos se escriben de nuevo (misma lectura) y la prueba sólo se escribe si aporta alguna
 * fase que el hueco no tenía, pasa `validarPrueba` y su clasificación coincide con la anterior.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { tipoDocumentoEngarde } from '../../src/lib/ingest/sources/engarde-antiguo';
import { parsearTorneoEngarde, urlPruebaEngarde, urlTorneoEngarde } from '../../src/lib/ingest/sources/engarde';
import { argumento, CARPETA_TRABAJO } from './comun';
import { convertirPrueba, type Paginas, type PruebaIndice } from './engarde-a-hechos';
import { paginasDePrueba } from './engarde-descargar';
import { acuerdoClasificacion, quitarNacionEnCuadro, validarPrueba } from './lote8c-engarde';
import { encuentrosEngarde, podioDe, refsEquipos, type Documento } from './lote7-equipos-engarde';
import { indice } from './lote7-faltan-engarde';
import { Red } from './lote7-faltan-red';

const HECHOS = join(CARPETA_TRABAJO, 'hechos');
const SALIDA = join(HECHOS, 'lote12-efc-engarde');
const CACHE = join(CARPETA_TRABAJO, 'cache-lote12-efc');

type Hueco = { id: string; fuente: string; faltan: string[]; lecturas: { source: string; key: string; url: string | null }[] };

function ficheroLote7(clave: string): HechosPrueba | null {
  for (const carpeta of ['lote7-efc', 'lote8-efc', 'lote8b-efc-pdf']) {
    const dir = join(HECHOS, carpeta);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      const h = JSON.parse(readFileSync(join(dir, f), 'utf8')) as HechosPrueba;
      if (h.competition?.competitionKey === clave) return h;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const huecos = (JSON.parse(readFileSync(argumento('huecos', join(CARPETA_TRABAJO, 'cobertura', 'huecos-nuevo12.json')), 'utf8')).huecos as Hueco[])
    .filter((h) => h.fuente === 'EFC' && h.lecturas.some((l) => l.source === 'efc' && /engarde-service\.com\/competition\//.test(l.url ?? '')));
  const red = new Red(CACHE, 800, 2);
  mkdirSync(SALIDA, { recursive: true });
  const indices = new Map<string, PruebaIndice[]>();
  const torneos = new Map<string, string | null>();
  const detalle: Record<string, unknown>[] = [];
  const totales = { pruebas: 0, puestos: 0, poules: 0, cuadro: 0 };

  for (const h of huecos) {
    const l = h.lecturas.find((x) => x.source === 'efc')!;
    const [org, evt, compe] = new URL(l.url!).pathname.split('/').filter(Boolean).slice(1);
    const previa = ficheroLote7(l.key);
    const anotar = (motivo: string, extra: Record<string, unknown> = {}) => detalle.push({ hueco: h.id, engarde: `${org}/${evt}/${compe}`, faltan: h.faltan, motivo, ...extra });
    if (!previa) {
      anotar('sin_fichero_previo');
      continue;
    }
    const kt = `${org}/${evt}`;
    if (!indices.has(kt)) {
      indices.set(kt, await indice(red, org, evt));
      const t = await red.get(urlTorneoEngarde(org, evt));
      torneos.set(kt, t.status === 200 ? parsearTorneoEngarde(t.body.toString('utf8')).nombre : null);
    }
    const p0 = indices.get(kt)!.find((p) => p.compe.toLowerCase() === compe.toLowerCase());
    if (!p0) {
      anotar('no_esta_en_el_indice');
      continue;
    }
    const c0 = previa.competition;
    const p: PruebaIndice = { ...p0, arma: c0.weapon as PruebaIndice['arma'], generoFinal: c0.gender as PruebaIndice['generoFinal'], categoriaFinal: c0.category as PruebaIndice['categoriaFinal'], individual: c0.format === 'INDIVIDUAL' };
    const portada = await red.get(urlPruebaEngarde(org, evt, compe));
    const html = portada.status === 200 ? portada.body.toString('utf8') : null;
    if (!html || /currently has no data/i.test(html)) {
      anotar('engarde_sin_datos');
      continue;
    }
    const paginas: Paginas = { prueba: html, clasfinal: null, poules: [], cuadros: [], faltan: [] };
    const docs: Documento[] = [];
    for (const f of paginasDePrueba(html, org, evt, compe)) {
      const url = `${urlPruebaEngarde(org, evt, compe)}/${f}`;
      const r = await red.get(url);
      if (r.status !== 200) {
        paginas.faltan.push(f);
        continue;
      }
      const leido = r.body.toString('utf8');
      const np = f.match(/^poules(\d+)\.htm$/i);
      const cuerpo = !np && /^tableau/i.test(f) ? quitarNacionEnCuadro(leido) : leido;
      if (/^clasfinal\.htm$/i.test(f)) paginas.clasfinal = cuerpo;
      else if (np) paginas.poules.push({ pagina: Number(np[1]), html: cuerpo });
      else paginas.cuadros.push({ url, html: cuerpo });
      const tipo = tipoDocumentoEngarde(f);
      if (tipo === 'poules' || tipo === 'cuadro') docs.push({ url, html: cuerpo, tipo, pagina: np ? Number(np[1]) : 1, antiguo: false });
    }
    const c = convertirPrueba(p, paginas, {
      season: previa.edition.season, nombreTorneo: torneos.get(kt) ?? previa.edition.name, inicio: previa.edition.startDate, fin: previa.edition.endDate, ciudad: previa.edition.city,
    });
    if (!c.ok) {
      anotar(`engarde_${c.motivo}`);
      continue;
    }
    const nueva = c.hechos;
    if (c0.format === 'EQUIPOS' && nueva.results.length > 0 && docs.length > 0) {
      const eq = encuentrosEngarde(docs, paginas.faltan, refsEquipos(nueva.results), podioDe(nueva.results));
      if (eq.bouts.length > 0) {
        nueva.bouts = eq.bouts as AsaltoHecho[];
        nueva.status.pools = eq.pools;
        nueva.status.tableau = eq.tableau;
        nueva.status.notes = nueva.status.notes.filter((n) => !/no se importan asaltos individuales/.test(n)).concat(eq.notas);
      }
    }
    const candidata: HechosPrueba = {
      ...nueva, source: 'efc', extractor: previa.extractor,
      edition: previa.edition,
      competition: previa.competition,
      status: { ...nueva.status, notes: [...nueva.status.notes, `Prueba del circuito europeo publicada en Engarde: ${org}/${evt}/${compe} (lote 12, cuadro con nación limpiada)`] },
    };
    const v = validarPrueba(candidata);
    const hechos = v.hechos;
    const pb = hechos.bouts.filter((b) => b.phase === 'POULE').length;
    const tb = hechos.bouts.length - pb;
    const aporta = (h.faltan.includes('poules') && pb > 0) || (h.faltan.includes('cuadro') && tb > 0);
    const acuerdo = acuerdoClasificacion(hechos.results, previa.results);
    const resumen = { puestos: hechos.results.length, puestosPrevios: previa.results.length, poules: pb, cuadro: tb, acuerdo, descartes: v.descartes.length, fasesRetiradas: v.fasesRetiradas };
    if (!aporta) {
      anotar('no_aporta_las_fases_que_faltan', resumen);
      continue;
    }
    if (hechos.results.length !== previa.results.length || (acuerdo.acuerdo !== null && acuerdo.acuerdo < 0.95)) {
      anotar('clasificacion_distinta', resumen);
      continue;
    }
    const fichero = ficheroHechos(hechos);
    writeFileSync(join(SALIDA, fichero), `${JSON.stringify(hechos, null, 1)}\n`);
    totales.pruebas += 1;
    totales.puestos += hechos.results.length;
    totales.poules += pb;
    totales.cuadro += tb;
    anotar('escrita', { ...resumen, fichero, tableau: hechos.status.tableau, pools: hechos.status.pools });
  }
  const motivos: Record<string, number> = {};
  for (const d of detalle) motivos[String(d.motivo)] = (motivos[String(d.motivo)] ?? 0) + 1;
  writeFileSync(join(SALIDA, '_informe.json'), `${JSON.stringify({ generado: new Date().toISOString(), huecos: huecos.length, totales, motivos, peticiones: red.peticiones, detalle }, null, 1)}\n`);
  console.log({ huecos: huecos.length, totales, motivos, peticiones: red.peticiones });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
