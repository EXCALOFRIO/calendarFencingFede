/**
 * Cobertura de una base ya cargada (nuevo11, nuevo12...), sin sumar ficheros de hechos: mismo
 * universo y criterios que `cobertura.ts`, con la foto «antes» como única foto.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/cobertura-base.ts \
 *     --db <nuevo12.sqlite> [--hoy 2026-10-07] [--md docs/cobertura-2026-10-07.md] \
 *     [--salida <calendario-trabajo/cobertura>] [--etiqueta nuevo12]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { argumento, CARPETA_CACHES, CARPETA_TRABAJO } from './comun';
import type { HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import {
  CARPETA_COBERTURA, construirUnidades, type Evaluada, evaluarUnidades, ficherosHechos, filasCatalogo, huecos, matriz, type Recuento, registroDeHechos,
  registrosNuevo7, temporadaComun,
} from './cobertura';

const hoy = argumento('hoy', new Date().toISOString().slice(0, 10));
const rutaDb = argumento('db', join(CARPETA_TRABAJO, 'nuevo11.sqlite'));
const etiqueta = argumento('etiqueta', rutaDb.replace(/^.*[\\/]/, '').replace(/\.sqlite$/, ''));
const salida = argumento('salida', CARPETA_COBERTURA);
const mdRuta = argumento('md', '');
const raiz = join(CARPETA_TRABAJO, 'hechos');

const db = new DatabaseSync(rutaDb, { readOnly: true });
const registros = registrosNuevo7(db);
const estados = db.prepare(`SELECT c.source, i.fact_kind, i.status, count(*) n FROM sport_import_coverage i
  LEFT JOIN sport_competition c ON c.id = i.competition_id GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`).all() as { source: string | null; fact_kind: string; status: string; n: number }[];
db.close();

const inv = JSON.parse(readFileSync(join(CARPETA_CACHES, 'history-national', 'national-inventory.json'), 'utf8'));
const efcInforme = join(raiz, 'lote7-efc', '_informe-efc.json');
const efcPendientes = existsSync(efcInforme)
  ? (JSON.parse(readFileSync(efcInforme, 'utf8')).detalle as Record<string, unknown>[]).filter((d) => d.motivo === 'xml_sin_captura' || d.motivo === 'xml_ilegible')
  : [];
const catalogo = filasCatalogo(inv, hoy);
// Carpetas de hechos aún sin cargar (`--previstas lote12-a,lote12-b`): se suman como si se cargaran.
const previstas = argumento('previstas', '').split(',').filter(Boolean);
const extra = previstas.flatMap((c) => ficherosHechos(join(raiz, c)).map((f) => registroDeHechos(JSON.parse(readFileSync(f, 'utf8')) as HechosPrueba, c, 'lote7')));
const prevision = previstas.length > 0
  ? evaluarUnidades(construirUnidades({ nuevo7: registros, lote7: extra, lote8: [], catalogo, efcPendientes, hoy }))
  : null;
const unidades = evaluarUnidades(construirUnidades({ nuevo7: registros, lote7: [], lote8: [], catalogo, efcPendientes, hoy }));

const n = (x: number) => x.toLocaleString('es-ES');
const pct = (a: number, b: number) => (b === 0 ? '–' : `${((100 * a) / b).toFixed(1).replace('.', ',')} %`);
const fila = (k: string, r: Recuento) =>
  `| ${k} | ${n(r.pruebas)} | ${n(r.clasificacion)} (${pct(r.clasificacion, r.pruebas)}) | ${n(r.poules)}/${n(r.poulesAplica)} (${pct(r.poules, r.poulesAplica)}) | ${n(r.cuadro)}/${n(r.cuadroAplica)} (${pct(r.cuadro, r.cuadroAplica)}) | ${n(r.completas)} (${pct(r.completas, r.pruebas)}) |`;
const CAB = '| | Pruebas | Clasificación | Poules (tiene/aplica) | Cuadro (tiene/aplica) | Completas |\n|---|---:|---:|---:|---:|---:|';
const tabla = (us: readonly Evaluada[], clave: (u: Evaluada) => string, total = false) => {
  const m = matriz(us, clave);
  const filas = [...m].map(([k, r]) => fila(k, r.antes));
  if (total) filas.push(fila('**Total**', [...matriz(us, () => 'T').values()][0].antes));
  return [CAB, ...filas].join('\n');
};
const organismo = (u: Evaluada) => (u.fuente === 'FIE' ? (temporadaComun(u) >= '2014-2015' ? 'FIE ≥2014-15' : 'FIE ≤2013-14') : u.fuente);
const tramo = (u: Evaluada) => {
  const t = temporadaComun(u);
  if (u.fuente === 'FIE' && t < '2002-2003') return '≤2001-2002';
  if (u.fuente === 'RFEE' && t < '2013-2014') return '≤2012-2013';
  return t;
};
const modalidad = (u: Evaluada) => (u.format === 'EQUIPOS' ? 'equipos' : 'individual');

const partes: string[] = [];
partes.push(`## Resumen por organismo\n\n${tabla(unidades, organismo, true)}\n`);
if (prevision) {
  const conFoto = prevision.map((u) => ({ ...u, ev: { ...u.ev, antes: u.ev.lote7 } }));
  partes.push(`## Previsión con ${previstas.map((c) => `\`${c}\``).join(', ')} cargadas\n\n${tabla(conFoto, organismo, true)}\n`);
}
partes.push(`## Por organismo y modalidad\n\n${tabla(unidades, (u) => `${organismo(u)} ${modalidad(u)}`)}\n`);
partes.push(`## Por organismo y arma\n\n${tabla(unidades, (u) => `${u.fuente} ${u.weapon}`)}\n`);
for (const f of ['FIE', 'EFC', 'RFEE'] as const) {
  partes.push(`## ${f} por temporada\n\n${tabla(unidades.filter((u) => u.fuente === f), tramo)}\n`);
}
const hs = huecos(unidades, 'antes');
const resumenHuecos = new Map<string, number>();
for (const h of hs) {
  const k = `${h.fuente === 'FIE' ? (h.temporada >= '2014-2015' ? 'FIE ≥2014-15' : 'FIE ≤2013-14') : h.fuente} | ${h.formato === 'EQUIPOS' ? 'equipos' : 'individual'} | ${h.faltan.join(' + ')}`;
  resumenHuecos.set(k, (resumenHuecos.get(k) ?? 0) + 1);
}
partes.push(`## Huecos (pruebas no completas)\n\n| Organismo | Modalidad | Falta | Pruebas |\n|---|---|---|---:|\n${[...resumenHuecos].sort().map(([k, v]) => `| ${k} | ${n(v)} |`).join('\n')}\n`);
const est = new Map<string, number>();
for (const e of estados) {
  const src = e.source ?? '(sin prueba)';
  const k = `${src} | ${e.fact_kind} | ${e.status}`;
  est.set(k, (est.get(k) ?? 0) + e.n);
}
partes.push(`## Estados en sport_import_coverage (fuente, hecho, estado)\n\n| Fuente | Hecho | Estado | Filas |\n|---|---|---|---:|\n${[...est].map(([k, v]) => `| ${k} | ${n(v)} |`).join('\n')}\n`);

mkdirSync(salida, { recursive: true });
writeFileSync(join(salida, `huecos-${etiqueta}.json`), `${JSON.stringify({ generado: new Date().toISOString(), hoy, db: rutaDb, total: hs.length, huecos: hs }, null, 1)}\n`);
writeFileSync(join(salida, `cobertura-${etiqueta}.json`), `${JSON.stringify({
  hoy, db: rutaDb,
  porOrganismo: Object.fromEntries([...matriz(unidades, organismo)].map(([k, r]) => [k, r.antes])),
  porOrganismoTemporadaArmaModalidad: Object.fromEntries([...matriz(unidades, (u) => `${u.fuente}|${temporadaComun(u)}|${u.weapon}|${u.format}`)].map(([k, r]) => [k, r.antes])),
}, null, 1)}\n`);
const md = partes.join('\n');
if (mdRuta) writeFileSync(resolve(mdRuta), md);
else writeFileSync(join(salida, `cobertura-${etiqueta}.md`), md);
console.log(md.split('## Por organismo y modalidad')[0]);
console.log(`huecos: ${hs.length} → ${join(salida, `huecos-${etiqueta}.json`)}`);
