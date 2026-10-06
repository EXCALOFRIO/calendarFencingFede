/**
 * Documentación PDF que Ophardt Online enlaza en cada sección de resultados
 * (`/cdn/documents/legacy-documentation/<id>.pdf`) para las pruebas FIE cuya
 * clasificación salió de Ophardt (`fie-huecos-ophardt`) y que no tienen asaltos:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-completar-ophardt.ts inventario [--base <sqlite>]
 *
 * Lee la página de resultados ya cacheada por `fie-huecos` (o la pide si falta),
 * descarga el PDF de la sección, lo pasa a texto con `pdftotext -layout` y anota
 * qué contiene (poules, cuadro, sólo clasificación) en
 * `cache-fie-completar/ophardt-inventario.json`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumento } from './comun';
import { CACHE, enParalelo, obtenerWeb, textoDe } from './fie-completar-comun';
import { CARPETA_HUECOS, desentidad, enCache, texto } from './fie-huecos-comun';

export const INVENTARIO_OPHARDT = join(CACHE, 'ophardt-inventario.json');
export const CARPETA_PDF = join(CACHE, 'ophardt-pdf');

type Asignado = { season: string; competitionKey: string; torneo?: string; seccion?: string; grupo: string; puestos?: number };

/** Enlaces de documentación por título de sección en una página `/en/search/results/<id>`. */
export function pdfsPorSeccion(html: string): Map<string, string> {
  const m = new Map<string, string>();
  const re = /<th[^>]*>\s*(?:<a href="([^"]*legacy-documentation\/[^"]+\.pdf)"[^>]*>[\s\S]*?<\/a>)?\s*<\/th>\s*<th>([^<]+)<\/th>\s*<th width="200"/g;
  for (const x of html.matchAll(re)) {
    const titulo = desentidad(x[2]).replace(/\s+/g, ' ').trim();
    if (x[1]) m.set(titulo, new URL(x[1].replace('/documentation/../', '/'), 'https://fencing.ophardt.online').href);
  }
  return m;
}

export type ContenidoPdf = { paginas: number; poules: boolean; cuadro: boolean; clasificacion: boolean; formato: string };

/** Qué trae el texto de un PDF de resultados (heurística por cabeceras). */
export function contenidoPdf(txt: string): ContenidoPdf {
  const t = txt.toUpperCase();
  const paginas = (txt.match(/\f/g) ?? []).length + 1;
  const poules = /POOL RESULTS|POOL NO|RESULTS OF POOLS|POULE N|POULES? RESULT|POOL #|POOL\s+\d+\b/.test(t);
  const cuadro = /TABLE OF \d+|TABLEAU DE \d+|TABLEAU OF \d+|ROUND OF \d+|DIRECT ELIMINATION|ELIMINATION DIRECTE|TABLEAU\s+\d+/.test(t);
  const clasificacion = /FINAL (STANDINGS|RANKING|RESULTS)|CLASSEMENT FINAL|OFFICIAL RESULTS/.test(t);
  const formato = /FEW\d{3}0{3}_C\d+/.test(txt) ? 'odf_juegos'
    : /ENGARDE|EN GARDE/i.test(txt) ? 'engarde'
    : /FENCING ?TIME/i.test(txt) ? 'fencingtime'
    : /OPHARDT/i.test(txt) ? 'ophardt'
    : 'otro';
  return { paginas, poules, cuadro, clasificacion, formato };
}

async function inventario() {
  const asignados = JSON.parse(readFileSync(join(CARPETA_HUECOS, 'ophardt-informe.json'), 'utf8')) as Asignado[];
  const auditoria = JSON.parse(readFileSync(argumento('auditoria', join(CACHE, 'auditoria-antes.json')), 'utf8')) as {
    pruebas: { season: string; competitionKey: string; estado: string; poules: { motivos: Record<string, number> } }[];
  };
  const objetivo = new Set(auditoria.pruebas
    .filter((p) => p.estado === 'sin_asaltos' || p.poules.motivos['ilegible:poule_sin_datos'])
    .map((p) => `${p.season}|${p.competitionKey}`));
  const lista = asignados.filter((a) => a.torneo && objetivo.has(`${a.season}|${a.competitionKey}`));
  mkdirSync(CARPETA_PDF, { recursive: true });
  const salida: Record<string, unknown>[] = [];
  const sinOphardt = [...objetivo].filter((k) => !lista.some((a) => `${a.season}|${a.competitionKey}` === k));
  await enParalelo(lista, 3, async (a) => {
    const url = `https://fencing.ophardt.online/en/search/results/${a.torneo}`;
    const html = texto(enCache(url)) ?? textoDe(await obtenerWeb(url));
    const fila: Record<string, unknown> = { season: a.season, competitionKey: a.competitionKey, grupo: a.grupo, torneo: a.torneo, seccion: a.seccion };
    if (!html) {
      salida.push({ ...fila, motivo: 'sin_pagina_ophardt' });
      return;
    }
    const pdf = pdfsPorSeccion(html).get((a.seccion ?? '').replace(/\s+/g, ' ').trim());
    if (!pdf) {
      salida.push({ ...fila, motivo: 'sin_pdf_en_seccion' });
      return;
    }
    const d = await obtenerWeb(pdf);
    if (d.status !== 200 || !d.bytes) {
      salida.push({ ...fila, pdf, motivo: `pdf_http_${d.status}` });
      return;
    }
    const base = join(CARPETA_PDF, `${a.season}-${a.competitionKey}`);
    writeFileSync(`${base}.pdf`, d.bytes);
    if (!existsSync(`${base}.txt`)) {
      try {
        execFileSync('pdftotext', ['-layout', `${base}.pdf`, `${base}.txt`], { stdio: 'ignore' });
      } catch {
        salida.push({ ...fila, pdf, motivo: 'pdftotext_fallo' });
        return;
      }
    }
    const txt = readFileSync(`${base}.txt`, 'utf8');
    salida.push({ ...fila, pdf, sha256: d.sha256, bytes: d.bytes.length, caracteres: txt.length, ...contenidoPdf(txt) });
  });
  salida.sort((x, y) => String(x.season).localeCompare(String(y.season)) || Number(x.competitionKey) - Number(y.competitionKey));
  writeFileSync(INVENTARIO_OPHARDT, `${JSON.stringify({ generado: new Date().toISOString(), pruebas: salida, sinOphardt }, null, 1)}\n`);
  const resumen: Record<string, number> = {};
  for (const s of salida) {
    const k = s.motivo ? String(s.motivo) : `${s.formato} poules=${s.poules} cuadro=${s.cuadro}`;
    resumen[k] = (resumen[k] ?? 0) + 1;
  }
  console.log(resumen, `sin torneo Ophardt: ${sinOphardt.length}`);
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'inventario') await inventario();
  else throw new Error('uso: fie-completar-ophardt.ts inventario');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
