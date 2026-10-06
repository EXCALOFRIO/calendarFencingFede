/**
 * Poules impresas como imagen (sin capa de texto) en los PDF RFEE, leídas por dos modelos distintos.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-pdf-poules-imagen.ts --solo <sha,sha>
 *     [--db <nuevo7.sqlite>] [--modelos gpt-6-luna,gpt-6-sol] [--revalidar]
 *
 * Como los nombres no están en el texto del PDF no se pueden validar contra él. Una poule sólo se
 * acepta si:
 *  1. los dos modelos devuelven exactamente la misma poule (cabecera, tiradores, cada celda de la
 *     matriz y las columnas V/M, TD-TR y TD impresas);
 *  2. la matriz es coherente: en cada pareja exactamente una celda es victoria («V» = 5 tocados en
 *     poule a 5, «V4» = 4) y la otra un número menor; V/M, TD y TD-TR de cada fila salen de los asaltos;
 *  3. la «Clasificación de poules» impresa (también idéntica en los dos modelos) trae a cada tirador
 *     de las poules de esa prueba con el mismo V/M, índice y TD, y su orden es el de V/M, índice, TD.
 * Las claves nunca salen del modelo: cada prueba se asigna a la prueba `rfee_pdf` existente del mismo
 * documento con igual arma, sexo y año (de la cabecera transcrita por los dos modelos), y las
 * referencias de los asaltos son las de sus puestos ya cargados (por nombre) o `<clave>:pdfd:n:<nombre>`.
 *
 * Salida: `hechos/lote7-pdf/poules-imagen/`. Crudos en `cache-lote7-pdf/poules-imagen-raw/`.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { metadatosDeCabecera } from '../../src/lib/ingest/sources/rfee-pdf/cabecera';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import { anioDeClave } from './lote7-pdf-droids';
import { CACHE_LOTE7_PDF, HECHOS_LOTE7_PDF, NUEVO7 } from './lote7-pdf-comun';
import { claveNombre, compacto, extraerJson, lanzarDroid, textoPdf } from './pdf-droids';

export type FilaMatriz = { name: string; club: string | null; cells: string[]; vm: string; tdtr: string; td: string };
export type PouleCruda = { pool: number; rows: FilaMatriz[] };
export type FilaClasif = { rank: number; surname: string; firstName: string; vm: string; ind: string; td: string };
export type PruebaCruda = { headerLines: string[]; pools: PouleCruda[]; ranking: FilaClasif[] };

const PROMPT = `You are a data-extraction tool. Read the fencing results PDF at this path with your Read tool:

{{PDF_PATH}}

It has {{PAGES}} pages. Many pages are images. Read EVERY page.

Extract ONLY the pool sheets ("Poules", "Poule No N") and the pool ranking tables ("Clasificación de poules"). Ignore tableaus, winner/finalist lists and everything else.

Copy everything EXACTLY as printed. Never correct, complete, compute or guess. If a cell is unreadable, write "?".

Answer with ONE JSON object and nothing else:
{
  "competitions": [
    {
      "headerLines": [string],            // the title lines above the pools, verbatim (e.g. "CRITERIUM NACIONAL 2022", "SABLE FEMENINO M13 AÑO 2009", "04.06.2022", "Las Rozas")
      "pools": [
        {
          "pool": number,                 // N of "Poule No N"
          "rows": [
            {
              "name": string,             // fencer as printed in the pool row ("SURNAME Firstname")
              "club": string | null,
              "cells": [string],          // one string per opponent column, in column order, INCLUDING the grey diagonal cell as ""; e.g. ["", "V", "3", "V4", ...]
              "vm": string,               // V/M column as printed, e.g. "0.600"
              "tdtr": string,             // TD-TR column as printed, e.g. "-4"
              "td": string                // TD column as printed
            }
          ]
        }
      ],
      "ranking": [                        // the "Clasificación de poules" table of this competition, every row
        { "rank": number, "surname": string, "firstName": string, "vm": string, "ind": string, "td": string }
      ]
    }
  ]
}`;

const num = (s: string) => Number(String(s).replace(',', '.').trim());

/** Celda de la matriz → tocados y si es victoria; null si no se entiende. */
export function celda(s: string, maximo: number): { tocados: number; victoria: boolean } | null {
  const t = String(s).trim().toUpperCase();
  const v = t.match(/^V(\d{0,2})$/);
  if (v) return { tocados: v[1] ? Number(v[1]) : maximo, victoria: true };
  if (/^\d{1,2}$/.test(t)) return { tocados: Number(t), victoria: false };
  return null;
}

export type Comprobacion = { ok: true; asaltos: { a: string; b: string; sa: number; sb: number; w: 'A' | 'B' | null }[] } | { ok: false; motivo: string };

/** Coherencia interna de una poule: parejas, V/M, TD y TD-TR de cada fila. */
export function comprobarPoule(p: PouleCruda, maximo = 5): Comprobacion {
  const n = p.rows.length;
  if (n < 3) return { ok: false, motivo: 'poule_pequena' };
  if (new Set(p.rows.map((r) => compacto(r.name))).size !== n) return { ok: false, motivo: 'nombres_repetidos' };
  if (p.rows.some((r) => r.cells.length !== n)) return { ok: false, motivo: 'matriz_no_cuadrada' };
  const asaltos: { a: string; b: string; sa: number; sb: number; w: 'A' | 'B' | null }[] = [];
  const v = new Array(n).fill(0);
  const td = new Array(n).fill(0);
  const tr = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    if (String(p.rows[i].cells[i]).trim() !== '') return { ok: false, motivo: 'diagonal_no_vacia' };
    for (let j = i + 1; j < n; j += 1) {
      const x = celda(p.rows[i].cells[j], maximo);
      const y = celda(p.rows[j].cells[i], maximo);
      if (!x || !y) return { ok: false, motivo: 'celda_ilegible' };
      if (x.victoria === y.victoria) return { ok: false, motivo: 'pareja_sin_un_ganador' };
      const [g, pe] = x.victoria ? [x, y] : [y, x];
      if (g.tocados > maximo) return { ok: false, motivo: 'marcador_imposible' };
      if (pe.tocados > g.tocados) return { ok: false, motivo: 'perdedor_con_mas_tocados' };
      asaltos.push({ a: p.rows[i].name, b: p.rows[j].name, sa: x.tocados, sb: y.tocados, w: x.tocados === y.tocados ? (x.victoria ? 'A' : 'B') : null });
      if (x.victoria) v[i] += 1;
      else v[j] += 1;
      td[i] += x.tocados;
      tr[i] += y.tocados;
      td[j] += y.tocados;
      tr[j] += x.tocados;
    }
  }
  for (let i = 0; i < n; i += 1) {
    const r = p.rows[i];
    if (Math.abs(num(r.vm) - v[i] / (n - 1)) > 0.0006) return { ok: false, motivo: 'vm_no_cuadra' };
    if (num(r.td) !== td[i]) return { ok: false, motivo: 'td_no_cuadra' };
    if (num(r.tdtr) !== td[i] - tr[i]) return { ok: false, motivo: 'indice_no_cuadra' };
  }
  return { ok: true, asaltos };
}

/** La clasificación de poules impresa cuadra con las poules: mismos tiradores y valores, y su orden. */
export function comprobarClasificacion(pools: readonly PouleCruda[], ranking: readonly FilaClasif[]): string | null {
  const filas = pools.flatMap((p) => p.rows);
  if (ranking.length !== filas.length) return 'clasificacion_otro_numero_de_tiradores';
  const porNombre = new Map(filas.map((r) => [compacto(r.name), r]));
  for (const c of ranking) {
    const r = porNombre.get(compacto(`${c.surname} ${c.firstName}`));
    if (!r) return 'clasificacion_tirador_no_en_poules';
    if (Math.abs(num(r.vm) - num(c.vm)) > 0.0006 || num(r.tdtr) !== num(c.ind) || num(r.td) !== num(c.td)) return 'clasificacion_valores_distintos';
  }
  for (let i = 1; i < ranking.length; i += 1) {
    const a = [num(ranking[i - 1].vm), num(ranking[i - 1].ind), num(ranking[i - 1].td)];
    const b = [num(ranking[i].vm), num(ranking[i].ind), num(ranking[i].td)];
    const k = a.findIndex((x, j) => x !== b[j]);
    if (k >= 0 && a[k] < b[k]) return 'clasificacion_orden_incoherente';
  }
  return null;
}

/** Forma canónica de una prueba para comparar las dos lecturas. */
export function canonica(p: PruebaCruda): string {
  const s = (x: unknown) => String(x ?? '').trim();
  return JSON.stringify({
    h: (p.headerLines ?? []).map((l) => compacto(s(l))),
    p: (p.pools ?? []).map((q) => ({ n: q.pool, r: (q.rows ?? []).map((r) => [compacto(s(r.name)), (r.cells ?? []).map((c) => s(c).toUpperCase()), num(s(r.vm)), num(s(r.tdtr)), num(s(r.td))]) })),
    c: (p.ranking ?? []).map((c) => [c.rank, compacto(`${s(c.surname)} ${s(c.firstName)}`), num(s(c.vm)), num(s(c.ind)), num(s(c.td))]),
  });
}

/** Firma de una prueba (arma, sexo, año) desde la cabecera transcrita. */
export function firmaCabecera(lineas: readonly string[]): { arma: string | null; genero: string | null; anio: string | null } {
  const meta = metadatosDeCabecera([...lineas]);
  const texto = lineas.join(' ').toUpperCase();
  const genero = /\bMIXT[OA]\b/.test(texto) ? 'MIXTO' : meta.genero;
  const anio = lineas.slice(1).join(' ').match(/\b(20[01]\d)\b/)?.[1] ?? null;
  return { arma: meta.arma, genero, anio };
}

type Destino = { competitionKey: string; tournamentKey: string; season: string; url: string; fecha: string | null; weapon: string; gender: string; category: string; categoryRaw: string | null; editionName: string; refs: Map<string, string> };

async function main(): Promise<void> {
  const rutaDb = argumento('db', NUEVO7);
  const solo = argumento('solo', '').split(',').filter(Boolean);
  const modelos = argumento('modelos', 'gpt-6-luna,gpt-6-sol').split(',');
  const revalidar = bandera('revalidar');
  const repetirA = argumento('repetir-a', '').split(',').filter(Boolean);
  if (modelos.length !== 2 || modelos[0] === modelos[1]) throw new Error('hacen falta dos modelos distintos');
  const salida = join(HECHOS_LOTE7_PDF, 'poules-imagen');
  const crudos = join(CACHE_LOTE7_PDF, 'poules-imagen-raw');
  const trabajo = join(CACHE_LOTE7_PDF, 'poules-imagen-work');
  for (const d of [salida, crudos, trabajo]) await mkdir(d, { recursive: true });
  const calidad = JSON.parse(await readFile(join(CARPETA_TRABAJO, 'hechos', 'pdf-calidad.json'), 'utf8')) as { url: string; sha256: string; blobPath: string }[];
  const db = new DatabaseSync(rutaDb, { readOnly: true });
  const informe: Record<string, unknown>[] = [];

  for (const sha of solo) {
    const entradas = calidad.filter((c) => c.sha256.startsWith(sha));
    if (entradas.length === 0) continue;
    const bytes = new Uint8Array(await readFile(entradas[0].blobPath));
    const full = createHash('sha256').update(bytes).digest('hex');
    const paginas = await textoPdf(bytes);
    const carpeta = join(trabajo, full);
    // Lecturas: una por modelo y, con `--repetir-a r2,r3`, más lecturas del primer modelo (cada una
    // se compara igualmente con la del segundo: siempre hacen falta dos modelos distintos de acuerdo).
    const lecturas = [
      ...repetirA.map((e) => ({ m: modelos[0], e })), { m: modelos[0], e: '' }, { m: modelos[1], e: '' },
    ];
    const todas: (PruebaCruda[] | null)[] = await Promise.all(lecturas.map(async ({ m, e }) => {
      const crudo = join(crudos, `${full}__${m}${e ? `__${e}` : ''}.json`);
      let stdout: string | null = null;
      if (revalidar || existsSync(crudo)) stdout = existsSync(crudo) ? await readFile(crudo, 'utf8') : null;
      else {
        const dir = join(carpeta, `${m}${e}`);
        await mkdir(dir, { recursive: true });
        const pdf = join(dir, 'documento.pdf');
        await writeFile(pdf, bytes);
        const prompt = join(dir, 'prompt.md');
        await writeFile(prompt, PROMPT.replaceAll('{{PDF_PATH}}', pdf).replaceAll('{{PAGES}}', String(paginas.length)), 'utf8');
        const r = await lanzarDroid(m, dir, prompt, 1_200_000);
        await writeFile(crudo, r.stdout, 'utf8');
        stdout = r.ok ? r.stdout : null;
      }
      if (!stdout) return null;
      try {
        const sobre = JSON.parse(stdout) as { is_error?: boolean; result?: string };
        if (sobre.is_error || typeof sobre.result !== 'string') return null;
        return ((extraerJson(sobre.result) as { competitions?: PruebaCruda[] }).competitions ?? []) as PruebaCruda[];
      } catch {
        return null;
      }
    }));
    await rm(carpeta, { recursive: true, force: true }).catch(() => undefined);
    const fila: Record<string, unknown> = { sha: full.slice(0, 12), pruebas: [] as unknown[] };
    informe.push(fila);
    const b = todas.at(-1);
    const lecturasA = todas.slice(0, -1).filter((x): x is PruebaCruda[] => x !== null);
    if (!b || lecturasA.length === 0) {
      fila.error = 'sin_respuesta_de_algun_modelo';
      continue;
    }
    const deA = new Set(lecturasA.flat().map(canonica));
    // Se recorre la lectura del segundo modelo: una prueba vale si alguna lectura del primero es idéntica.
    const a = b;
    const deB = new Map([...b.filter((p) => deA.has(canonica(p)))].map((p) => [canonica(p), p]));
    // Destinos: pruebas rfee_pdf de cada URL con este contenido.
    const destinos: Destino[] = [];
    for (const e of entradas) {
      const doc = new URL(e.url).pathname.split('/').pop()!.replace(/\.pdf$/i, '');
      for (const c of db.prepare(
        `SELECT c.id, c.competition_key k, c.season s, e.tournament_key tk, e.name en, coalesce(c.competition_date, e.start_date) f,
           c.weapon w, c.gender g, c.category cat, c.category_raw cr
         FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
         WHERE c.source = 'rfee_pdf' AND c.format = 'INDIVIDUAL' AND e.tournament_key = ?`,
      ).all(`pdf:${doc}`) as Record<string, string>[]) {
        const refs = new Map<string, string>();
        for (const r of db.prepare('SELECT source_fact_key k, source_name n FROM sport_result WHERE competition_id = ?').all(c.id) as { k: string; n: string }[]) {
          const k = compacto(r.n);
          refs.set(k, refs.has(k) ? '' : r.k);
        }
        destinos.push({
          competitionKey: c.k, tournamentKey: c.tk, season: c.s, url: e.url, fecha: c.f, weapon: c.w, gender: c.g, category: c.cat,
          categoryRaw: c.cr, editionName: c.en, refs,
        });
      }
    }
    let escritas = 0;
    let asaltosEscritos = 0;
    for (const p of a) {
      const firma = firmaCabecera(p.headerLines ?? []);
      const reg: Record<string, unknown> = { cabecera: `${firma.arma}/${firma.genero}/${firma.anio}`, poules: (p.pools ?? []).length };
      (fila.pruebas as unknown[]).push(reg);
      if (!deB.has(canonica(p))) {
        reg.motivo = 'lecturas_distintas';
        continue;
      }
      const aceptadas: { pool: number; asaltos: { a: string; b: string; sa: number; sb: number; w: 'A' | 'B' | null }[] }[] = [];
      const motivos: string[] = [];
      for (const q of p.pools ?? []) {
        const c = comprobarPoule(q);
        if (c.ok) aceptadas.push({ pool: q.pool, asaltos: c.asaltos });
        else motivos.push(`P${q.pool}:${c.motivo}`);
      }
      const mc = (p.ranking ?? []).length > 0 ? comprobarClasificacion(p.pools ?? [], p.ranking) : 'sin_clasificacion_de_poules';
      if (mc) motivos.push(mc);
      if (motivos.length > 0 || aceptadas.length === 0) {
        reg.motivo = motivos.join(',') || 'sin_poules';
        continue;
      }
      if (!firma.arma || !firma.genero || !firma.anio) {
        reg.motivo = 'cabecera_sin_arma_sexo_o_anio';
        continue;
      }
      const suyos = destinos.filter((d) => d.weapon === firma.arma && d.gender === firma.genero && anioDeClave(d.competitionKey) === firma.anio);
      const porUrl = new Map<string, Destino[]>();
      for (const d of suyos) porUrl.set(d.url, [...(porUrl.get(d.url) ?? []), d]);
      reg.urls = porUrl.size;
      for (const [, ds] of porUrl) {
        if (ds.length !== 1) continue;
        const d = ds[0];
        const ref = (n: string) => d.refs.get(compacto(n)) || `${d.competitionKey}:pdfd:n:${claveNombre(n)}`;
        const bouts: AsaltoHecho[] = aceptadas.flatMap((q) => q.asaltos.map((x) => ({
          phase: 'POULE' as const, roundKey: `P${q.pool}`, aRef: ref(x.a), bRef: ref(x.b), aName: x.a, bName: x.b, scoreA: x.sa, scoreB: x.sb, winner: x.w,
        })));
        const h: HechosPrueba = hechosPrueba.parse({
          version: 1, source: 'rfee_pdf', extractor: `droid:${modelos.join('+')}`, sourceUrl: d.url, sourceSha256: full,
          edition: { season: d.season, tournamentKey: d.tournamentKey, name: d.editionName, startDate: d.fecha, endDate: d.fecha, city: null, countryCode: null },
          competition: { competitionKey: d.competitionKey, weapon: d.weapon, gender: d.gender, category: d.category, categoryRaw: d.categoryRaw, format: 'INDIVIDUAL', date: d.fecha },
          status: {
            results: 'sin_resultados', pools: 'completo', tableau: 'sin_resultados', publishedParticipants: null,
            notes: ['poules_de_imagen_dos_modelos_identicos_y_matriz_coherente'],
          },
          results: [],
          bouts,
        });
        await writeFile(join(salida, ficheroHechos(h)), `${JSON.stringify(h, null, 2)}\n`, 'utf8');
        escritas += 1;
        asaltosEscritos += bouts.length;
      }
      reg.aceptada = true;
      reg.asaltos = aceptadas.reduce((n, q) => n + q.asaltos.length, 0);
    }
    Object.assign(fila, { escritas, asaltosEscritos, lecturasModeloA: lecturasA.length, pruebasModeloB: b.length });
    console.log(`${full.slice(0, 12)} pruebas=${a.length}/${b.length} escritas=${escritas} asaltos=${asaltosEscritos}`);
  }
  db.close();
  await writeFile(join(salida, '_informe.json'), JSON.stringify({ generado: new Date().toISOString(), pdfs: informe }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
