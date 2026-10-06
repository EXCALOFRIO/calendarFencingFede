/**
 * Qué añadirían los hechos de `hechos/lote7-equipos` a las pruebas por equipos de la copia,
 * sin cargarlos: por prueba, secciones vacías que pasan a tener filas, agrupado por el estado
 * de partida (R = clasificación, P = poules, T = cuadro; `-` = vacía).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-equipos-resumen.ts [--db <nuevo7.sqlite>]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento } from './comun';
import { CACHE_EQUIPOS, NUEVO7, pruebasEquipos, SALIDA_EQUIPOS, type PruebaEquipos } from './lote7-equipos-comun';
import type { Publica } from './lote7-equipos-pdf';

const perfil = (r: number, p: number, t: number) => `${r ? 'R' : '-'}${p ? 'P' : '-'}${t ? 'T' : '-'}`;

function main(): void {
  const db = new DatabaseSync(argumento('db', NUEVO7), { readOnly: true });
  const pruebas = [...pruebasEquipos(db, 'rfee_pdf'), ...pruebasEquipos(db, 'engarde')];
  db.close();
  const porClave = new Map<string, PruebaEquipos>(pruebas.map((p) => [`${p.source}\u0000${p.season}\u0000${p.competitionKey}`, p]));
  const nuevos = new Map<string, { r: number; p: number; t: number; ficheros: number }>();
  const huerfanos: string[] = [];
  for (const sub of ['engarde', 'pdf']) {
    const dir = join(SALIDA_EQUIPOS, sub);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      const h = JSON.parse(readFileSync(join(dir, f), 'utf8')) as HechosPrueba;
      if (h.extractor === 'lote7_equipos_vacio') continue;
      const k = `${h.source}\u0000${h.edition.season}\u0000${h.competition.competitionKey}`;
      if (!porClave.has(k)) {
        huerfanos.push(f);
        continue;
      }
      const x = nuevos.get(k) ?? { r: 0, p: 0, t: 0, ficheros: 0 };
      x.r = Math.max(x.r, h.results.length);
      x.p = Math.max(x.p, h.bouts.filter((b) => b.phase === 'POULE').length);
      x.t = Math.max(x.t, h.bouts.filter((b) => b.phase === 'TABLEAU').length);
      x.ficheros += 1;
      nuevos.set(k, x);
    }
  }
  const tabla: Record<string, Record<string, number>> = {};
  const sumar = (g: string, k: string, n = 1) => ((tabla[g] ??= {})[k] = (tabla[g][k] ?? 0) + n);
  for (const [k, p] of porClave) {
    const pasado = (p.date ?? p.edition.startDate ?? '9999') < new Date().toISOString().slice(0, 10);
    const g = `${p.source} ${p.season >= '2017' ? '>=2017' : '<2017'}${pasado ? '' : ' futura'} ${perfil(p.resultados.length, p.poules, p.cuadro)}`;
    sumar(g, 'pruebas');
    const n = nuevos.get(k);
    if (!n) continue;
    const ganaR = p.resultados.length === 0 && n.r > 0;
    const ganaP = p.poules === 0 && n.p > 0;
    const ganaT = p.cuadro === 0 && n.t > 0;
    if (ganaR) sumar(g, 'ganaClasificacion');
    if (ganaP) sumar(g, 'ganaPoules');
    if (ganaT) sumar(g, 'ganaCuadro');
    if (!ganaR && !ganaP && !ganaT && (n.p > p.poules || n.t > p.cuadro)) sumar(g, 'completaSeccionParcial');
    sumar(g, 'conFichero');
    sumar(g, 'encuentrosNuevos', Math.max(0, n.p - p.poules) + Math.max(0, n.t - p.cuadro));
    sumar(g, `despues ${perfil(p.resultados.length + n.r, p.poules + n.p, p.cuadro + n.t)}`);
  }
  // Por qué sigue faltando algo en las rfee_pdf: lo que decidió el plan y lo que dejó la validación.
  const planRuta = join(CACHE_EQUIPOS, 'plan-pdf.json');
  const plan = existsSync(planRuta)
    ? (JSON.parse(readFileSync(planRuta, 'utf8')) as { plan: { url: string; sha256: string | null; decision: string; publica: Publica | null }[] }).plan
    : [];
  const planPorUrl = new Map(plan.map((d) => [d.url, d]));
  const fallidos = new Set<string>();
  const dirEstado = join(CACHE_EQUIPOS, 'droid-estado');
  if (existsSync(dirEstado)) {
    for (const f of readdirSync(dirEstado)) {
      const e = JSON.parse(readFileSync(join(dirEstado, f), 'utf8')) as { sha256: string; hecho: boolean };
      if (!e.hecho) fallidos.add(e.sha256);
    }
  }
  const pendientes: Record<string, number> = {};
  const ejemplos: Record<string, string[]> = {};
  for (const [k, p] of porClave) {
    if (p.source !== 'rfee_pdf') continue;
    const n = nuevos.get(k) ?? { r: 0, p: 0, t: 0, ficheros: 0 };
    const falta = [
      p.resultados.length + n.r === 0 ? 'clasificacion' : null,
      p.poules + n.p === 0 ? 'poules' : null,
      p.cuadro + n.t === 0 ? 'cuadro' : null,
    ].filter(Boolean);
    if (falta.length === 0) continue;
    const d = planPorUrl.get((p.sourceUrl ?? '').split('#')[0]);
    const pub = d?.publica;
    const motivos = falta.map((s) => {
      if (!d) return `${s}:sin_documento`;
      if (d.decision === 'sin_capa_de_texto') return `${s}:pdf_sin_capa_de_texto`;
      if (d.sha256 && fallidos.has(d.sha256)) return `${s}:droid_no_puede_leer_el_pdf`;
      const publica = s === 'clasificacion' ? pub?.clasificacion : s === 'poules' ? pub?.poules : pub?.cuadro;
      return publica ? `${s}:publicado_pero_no_validado` : `${s}:el_documento_no_lo_publica`;
    });
    for (const m of motivos) {
      pendientes[m] = (pendientes[m] ?? 0) + 1;
      if ((ejemplos[m] ??= []).length < 5) ejemplos[m].push(`${p.edition.name} | ${p.competitionKey}`);
    }
  }
  const salida = { generado: new Date().toISOString(), tabla, pendientesRfeePdf: pendientes, ejemplos, huerfanos };
  writeFileSync(join(SALIDA_EQUIPOS, '_resumen.json'), JSON.stringify(salida, null, 2));
  console.log(JSON.stringify(salida, null, 2));
}

main();
