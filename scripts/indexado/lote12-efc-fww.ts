/**
 * Lote 12, EFC: cuadro de pruebas del circuito europeo cadete que tienen clasificación (y poules
 * en individual) pero no cuadro, y que Fencing Worldwide (Ophardt) publica: las que `lote7-efc`
 * leyó de allí por equipos y las que `lote8b-efc-pdf` leyó de un PDF de Ophardt cuyo nombre
 * («documentation-916173-2024-…») da el identificador de la prueba en Fencing Worldwide.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote12-efc-fww.ts [--huecos <huecos-nuevo12.json>]
 *
 * El cuadro (`/direct/<n>`) se lee con `parsearDirectaFww` y cada participante («FRANCE 2» o
 * «APELLIDO Nombre») se casa con su puesto por nombre normalizado único (`refsEquipos`, que sirve
 * igual para personas). Un encuentro con algún participante sin puesto se descarta; si se descarta
 * más del 10 % o el cuadro no es coherente (`validarPrueba`), la prueba no se escribe. Edición,
 * prueba y puestos son los del fichero previo; se escriben sólo los encuentros del cuadro (caché
 * nueva `cache-lote12-efc`, 2 peticiones por host y ≥800 ms).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { parsearDirectaFww } from '../../src/lib/ingest/sources/fww-asaltos';
import { argumento, CARPETA_TRABAJO } from './comun';
import { validarPrueba } from './lote8c-engarde';
import { refsEquipos } from './lote7-equipos-engarde';
import { Red } from './lote7-faltan-red';
import { destinosDePruebaFww, urlFww } from './lote7-fie-fww';

const HECHOS = join(CARPETA_TRABAJO, 'hechos');
const SALIDA = join(HECHOS, 'lote12-efc-fww');
const DOCUMENTACION = /documentation-(\d+)-(\d{4})-/;

/** Ruta de la prueba en Fencing Worldwide («8029-2024») desde la URL de la lectura previa. */
export function rutaFww(url: string | null): string | null {
  const u = decodeURIComponent(url ?? '');
  return /fencingworldwide\.com\/en\/([^/]+)\/results\//.exec(u)?.[1] ?? (DOCUMENTACION.exec(u) ? `${DOCUMENTACION.exec(u)![1]}-${DOCUMENTACION.exec(u)![2]}` : null);
}
const CACHE = join(CARPETA_TRABAJO, 'cache-lote12-efc');

type Hueco = { id: string; fuente: string; formato: string; faltan: string[]; lecturas: { source: string; key: string; url: string | null }[] };

function previaDe(clave: string): HechosPrueba | null {
  for (const carpeta of ['lote7-efc', 'lote8b-efc-pdf', 'lote8-efc']) {
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
    .filter((h) => h.fuente === 'EFC' && h.faltan.length === 1 && h.faltan[0] === 'cuadro' && h.lecturas.some((l) => l.source === 'efc' && rutaFww(l.url)));
  const red = new Red(CACHE, 800, 2);
  mkdirSync(SALIDA, { recursive: true });
  const detalle: Record<string, unknown>[] = [];
  const totales = { pruebas: 0, puestos: 0, cuadro: 0 };
  for (const h of huecos) {
    const l = h.lecturas.find((x) => x.source === 'efc')!;
    const ruta = rutaFww(l.url)!;
    const anotar = (motivo: string, extra: Record<string, unknown> = {}) => detalle.push({ hueco: h.id, fww: ruta, motivo, ...extra });
    const previa = previaDe(l.key);
    if (!previa) {
      anotar('sin_fichero_previo');
      continue;
    }
    const res = await red.get(urlFww(ruta, 'results/'));
    if (res.status !== 200) {
      anotar(`results_http_${res.status}`);
      continue;
    }
    const directas = destinosDePruebaFww(res.body.toString('utf8'), ruta).filter((d) => d.startsWith('direct/'));
    if (directas.length === 0) {
      anotar('sin_cuadro_publicado');
      continue;
    }
    const ref = refsEquipos(previa.results);
    const vistos = new Set<string>();
    const bouts: AsaltoHecho[] = [];
    let publicados = 0;
    let sinEquipo = 0;
    const excluidos: Record<string, number> = {};
    for (const d of directas) {
      const r = await red.get(urlFww(ruta, d));
      if (r.status !== 200) continue;
      const lectura = parsearDirectaFww(r.body.toString('utf8'), { refPorNombre: true });
      publicados += lectura.publicado;
      for (const [k, v] of Object.entries(lectura.excluidos)) excluidos[k] = (excluidos[k] ?? 0) + Number(v);
      for (const a of lectura.asaltos) {
        const ra = ref(a.nombreA);
        const rb = ref(a.nombreB);
        if (!ra || !rb || ra === rb) {
          sinEquipo += 1;
          continue;
        }
        const k = `${a.ronda}|${[ra, rb].sort().join('|')}`;
        if (vistos.has(k)) continue;
        vistos.add(k);
        bouts.push({ phase: 'TABLEAU', roundKey: a.ronda, aRef: ra, bRef: rb, aName: a.nombreA, bName: a.nombreB, scoreA: a.puntosA, scoreB: a.puntosB, winner: null });
      }
    }
    if (bouts.length === 0 || sinEquipo > (bouts.length + sinEquipo) * 0.1) {
      anotar('equipos_sin_casar', { encuentros: bouts.length, sinEquipo, publicados, excluidos });
      continue;
    }
    const completo = sinEquipo === 0 && Object.entries(excluidos).every(([k, v]) => k === 'bye' || v === 0);
    const candidata: HechosPrueba = {
      ...previa,
      bouts: [...previa.bouts.filter((b) => b.phase === 'POULE'), ...bouts],
      status: {
        ...previa.status,
        tableau: completo ? 'completo' : 'parcial',
        notes: [...previa.status.notes, `Cuadro por equipos de Fencing Worldwide (${directas.join(', ')}), lote 12: ${bouts.length} encuentros${completo ? '' : `; excluidos ${JSON.stringify(excluidos)}, sin equipo ${sinEquipo}`}`],
      },
    };
    const v = validarPrueba(candidata);
    const tb = v.hechos.bouts.filter((b) => b.phase === 'TABLEAU').length;
    if (tb === 0 || v.fasesRetiradas.length > 0) {
      anotar('cuadro_no_valido', { encuentros: bouts.length, descartes: v.descartes.length, fasesRetiradas: v.fasesRetiradas });
      continue;
    }
    const fichero = ficheroHechos(v.hechos);
    writeFileSync(join(SALIDA, fichero), `${JSON.stringify(v.hechos, null, 1)}\n`);
    totales.pruebas += 1;
    totales.puestos += v.hechos.results.length;
    totales.cuadro += tb;
    anotar('escrita', { fichero, encuentros: tb, sinEquipo, publicados, excluidos, descartes: v.descartes.length, tableau: v.hechos.status.tableau });
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
