/**
 * Clasificaciones que faltan en pruebas `rfee_pdf` individuales ya creadas (sin un solo puesto),
 * leídas con droids del PDF que las publica.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-pdf-droids.ts \
 *     [--db <calendario-trabajo/nuevo7.sqlite>] [--hasta 2026-10-06] [--concurrencia 4]
 *     [--modelo gpt-6-luna] [--modelo-fuerte gpt-6-sol] [--solo sha,sha] [--revalidar] [--seco]
 *
 * 1. Objetivos: pruebas `rfee_pdf` INDIVIDUAL sin puestos cuyo PDF está en la caché del lector
 *    (`pdf-calidad.json`) y tiene capa de texto en las páginas de la prueba. Se agrupan por
 *    contenido (SHA-256): el mismo PDF publicado en varias URL es una llamada.
 * 2. Por PDF se pide al droid (sólo Read, sin red; `pdf-droid-prompt.md` con un alcance que nombra
 *    las tablas que faltan) la clasificación de esas tablas; primero `--modelo`, y `--modelo-fuerte`
 *    si la validación lo pide (`necesitaEscalar`).
 * 3. Se valida con `validarExtraccion` de `pdf-droids.ts` contra el texto del PDF (nombres y
 *    clubes en el texto, puestos monótonos, listas de ganadores/finalistas sin puesto inventado).
 * 4. Cada prueba validada se asigna a la prueba existente con el mismo arma, sexo, categoría y
 *    año de nacimiento (el que la clave de la cabecera lleva); el código pone la clave existente
 *    (`competition_key`, `tournament_key`) y reescribe las de puesto con ese prefijo. Nada nuevo se crea.
 *
 * Salida: `hechos/lote7-pdf/droid/`. Crudos en `cache-lote7-pdf/droid-raw/`. Sin nombres en el registro.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import { CACHE_LOTE7_PDF, HECHOS_LOTE7_PDF, NUEVO7 } from './lote7-pdf-comun';
import {
  extraerJson, lanzarDroid, necesitaEscalar, puntuar, RUTAS, textoPdf, validarExtraccion,
  type ResultadoValidacion,
} from './pdf-droids';

export type Objetivo = {
  id: string; season: string; competitionKey: string; tournamentKey: string; editionName: string;
  editionStart: string | null; editionEnd: string | null; fecha: string | null;
  weapon: string; gender: string; category: string; categoryRaw: string | null; url: string; anio: string | null;
};

const ARMA_TEXTO: Record<string, string> = { ESPADA: 'ESPADA', FLORETE: 'FLORETE', SABLE: 'SABLE' };
const GENERO_TEXTO: Record<string, string> = { M: 'MASCULINO', F: 'FEMENINO', MIXTO: 'MIXTO' };

/** Año de nacimiento (cohorte) que lleva la última parte de la clave: `...:M13:201321062025COLMENARVIEJ` → 2013. */
export function anioDeClave(clave: string): string | null {
  const cola = clave.split(':').pop() ?? '';
  return cola.match(/(20[0-2]\d|19\d\d)/)?.[1] ?? null;
}

/** Igual que `anioDeClave` pero sobre la clave que calcula `validarExtraccion`. */
export const anioDeHechos = (h: Pick<HechosPrueba, 'competition'>) => anioDeClave(h.competition.competitionKey);

/** Prefijo de la clave de prueba sustituido en puestos y referencias de asalto. */
export function reclavar(h: HechosPrueba, o: Pick<Objetivo, 'competitionKey' | 'tournamentKey' | 'season'>): HechosPrueba {
  const viejo = h.competition.competitionKey;
  const cambia = (k: string) => (k.startsWith(`${viejo}:`) ? `${o.competitionKey}${k.slice(viejo.length)}` : k);
  return hechosPrueba.parse({
    ...h,
    edition: { ...h.edition, tournamentKey: o.tournamentKey, season: o.season },
    competition: { ...h.competition, competitionKey: o.competitionKey },
    results: h.results.map((r) => ({ ...r, factKey: cambia(r.factKey) })),
    bouts: h.bouts.map((b) => ({ ...b, aRef: cambia(b.aRef), bRef: cambia(b.bRef) })),
  });
}

/**
 * Empareja las pruebas validadas con los objetivos: mismo arma, sexo y categoría, y mismo año de
 * cohorte si el objetivo lo lleva. Cada objetivo toma como mucho una prueba, y sólo si es única.
 */
export function asignar(hechos: readonly HechosPrueba[], objetivos: readonly Objetivo[]): Map<Objetivo, HechosPrueba> {
  const out = new Map<Objetivo, HechosPrueba>();
  for (const o of objetivos) {
    const c = hechos.filter((h) =>
      h.competition.weapon === o.weapon && h.competition.gender === o.gender && h.competition.category === o.category &&
      h.results.length > 0 && (o.anio === null || anioDeHechos(h) === o.anio));
    if (c.length === 1) out.set(o, c[0]);
  }
  return out;
}

export function alcanceObjetivos(objetivos: readonly Objetivo[]): string {
  const vistos = new Set<string>();
  const lineas: string[] = [];
  for (const o of objetivos) {
    const l = `- ${ARMA_TEXTO[o.weapon]} ${GENERO_TEXTO[o.gender]} category ${o.category}${o.anio ? `, birth year ${o.anio}` : ''}${o.categoryRaw ? ` (printed category: "${o.categoryRaw}")` : ''}`;
    if (!vistos.has(l)) lineas.push(l);
    vistos.add(l);
  }
  return [
    'SCOPE OF THIS PASS: extract ONLY the final classification (results) of these competitions, which a previous pass missed:',
    ...lineas,
    'Each one is a separate table, usually under a heading with the weapon, gender, birth year, date and venue. The table can be split across two pages or printed in a column next to another table: read every page. Copy each row with its printed rank or label (e.g. "CAMPEONA", "FINALISTA", "Ganador": position null and that text in positionRaw; numbers as position). Put the heading lines of that table, including the birth year line, in headerLines. Return empty "pools" and "tableau" lists with status "sin_resultados". Do not return the other competitions of the document.',
  ].join('\n');
}

type Calidad = { url: string; sha256: string; blobPath: string; pages?: number | null };

function objetivos(rutaDb: string, hasta: string): Objetivo[] {
  const db = new DatabaseSync(rutaDb, { readOnly: true });
  const filas = db.prepare(
    `SELECT c.id, c.season, c.competition_key k, e.tournament_key tk, e.name en, e.start_date es, e.end_date ee,
       coalesce(c.competition_date, e.start_date) f, c.weapon w, c.gender g, c.category cat, c.category_raw cr,
       coalesce(c.source_url, e.source_url) u
     FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE c.source = 'rfee_pdf' AND c.format = 'INDIVIDUAL' AND coalesce(c.competition_date, e.start_date) < ?
       AND NOT EXISTS (SELECT 1 FROM sport_result r WHERE r.competition_id = c.id)
       AND c.competition_key NOT GLOB '*~[0-9]*'`,
  ).all(hasta) as Record<string, string | null>[];
  db.close();
  return filas.filter((r) => r.u).map((r) => ({
    id: r.id!, season: r.season!, competitionKey: r.k!, tournamentKey: r.tk!, editionName: r.en!, editionStart: r.es, editionEnd: r.ee,
    fecha: r.f, weapon: r.w!, gender: r.g!, category: r.cat!, categoryRaw: r.cr, url: r.u!, anio: anioDeClave(r.k!),
  }));
}

async function main(): Promise<void> {
  const rutaDb = argumento('db', NUEVO7);
  const hasta = argumento('hasta', '2026-10-06');
  const modelo = argumento('modelo', 'gpt-6-luna');
  const fuerte = argumento('modelo-fuerte', 'gpt-6-sol');
  const concurrencia = Math.min(4, Math.max(1, Number(argumento('concurrencia', '4'))));
  const solo = argumento('solo', '').split(',').filter(Boolean);
  const revalidar = bandera('revalidar');
  // Instrucciones añadidas al alcance y etiqueta de los crudos, para repetir un PDF con un prompt más estricto.
  const nota = argumento('nota', '');
  const etiqueta = argumento('etiqueta', '');
  const soloClaves = argumento('claves', '').split(',').filter(Boolean);
  const salida = join(HECHOS_LOTE7_PDF, 'droid');
  const crudos = join(CACHE_LOTE7_PDF, 'droid-raw');
  const trabajo = join(CACHE_LOTE7_PDF, 'droid-work');
  for (const d of [salida, crudos, trabajo]) await mkdir(d, { recursive: true });

  const calidad = JSON.parse(await readFile(join(CARPETA_TRABAJO, 'hechos', 'pdf-calidad.json'), 'utf8')) as Calidad[];
  const porUrl = new Map(calidad.map((c) => [c.url.split('#')[0], c]));
  const grupos = new Map<string, { c: Calidad; objetivos: Objetivo[] }>();
  const sinPdf: string[] = [];
  for (const o of objetivos(rutaDb, hasta)) {
    const c = porUrl.get(o.url.split('#')[0]);
    if (!c || !existsSync(c.blobPath)) {
      sinPdf.push(o.competitionKey);
      continue;
    }
    if (solo.length > 0 && !solo.some((s) => c.sha256.startsWith(s))) continue;
    if (soloClaves.length > 0 && !soloClaves.some((s) => o.competitionKey.endsWith(s))) continue;
    const g = grupos.get(c.sha256) ?? { c, objetivos: [] };
    g.objetivos.push(o);
    grupos.set(c.sha256, g);
  }
  console.log(`objetivos con PDF: ${[...grupos.values()].reduce((n, g) => n + g.objetivos.length, 0)} en ${grupos.size} PDF; sin PDF en caché: ${sinPdf.length}`);
  const informe: Record<string, unknown>[] = [];
  if (bandera('seco')) {
    for (const [sha, g] of grupos) console.log(sha.slice(0, 12), g.objetivos.length, alcanceObjetivos(g.objetivos).split('\n').slice(1, -1).join(' | '));
    return;
  }
  const plantillaBase = await readFile(RUTAS.prompt, 'utf8');

  const procesar = async (sha: string, g: { c: Calidad; objetivos: Objetivo[] }) => {
    const bytes = new Uint8Array(await readFile(g.c.blobPath));
    if (createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error('sha256_no_coincide');
    const paginas = await textoPdf(bytes);
    const carpeta = join(trabajo, sha);
    const pdf = join(carpeta, 'documento.pdf');
    const alcance = [alcanceObjetivos(g.objetivos), nota].filter(Boolean).join('\n');
    const pedir = async (m: string): Promise<unknown | null> => {
      const crudo = join(crudos, `${sha}__${m}${etiqueta ? `__${etiqueta}` : ''}.json`);
      let stdout: string | null = null;
      if (revalidar) stdout = existsSync(crudo) ? await readFile(crudo, 'utf8') : null;
      else {
        await mkdir(carpeta, { recursive: true });
        await writeFile(pdf, bytes);
        const prompt = join(carpeta, `prompt-${m}.md`);
        await writeFile(prompt, plantillaBase.replaceAll('{{PDF_PATH}}', pdf).replaceAll('{{PAGES}}', String(paginas.length)).replaceAll('{{ALCANCE}}', alcance), 'utf8');
        const r = await lanzarDroid(m, carpeta, prompt, 900_000);
        await writeFile(crudo, r.stdout, 'utf8');
        stdout = r.ok ? r.stdout : null;
      }
      if (!stdout) return null;
      try {
        const sobre = JSON.parse(stdout) as { is_error?: boolean; result?: string };
        return sobre.is_error || typeof sobre.result !== 'string' ? null : extraerJson(sobre.result);
      } catch {
        return null;
      }
    };
    const o0 = g.objetivos[0];
    const ctx = {
      url: o0.url, sha256: sha, docId: o0.tournamentKey.replace(/^pdf:/, ''), season: o0.season, editionName: o0.editionName,
      editionStart: o0.editionStart, editionEnd: o0.editionEnd, paginas, fechaCatalogo: () => o0.fecha,
    };
    const validar = (crudo: unknown, m: string) => validarExtraccion(crudo, { ...ctx, extractor: `droid:${m}` });
    let elegido: { v: ResultadoValidacion; crudo: unknown; m: string } | null = null;
    for (const m of [...new Set([modelo, fuerte])]) {
      const crudo = await pedir(m);
      if (crudo !== null) {
        const v = validar(crudo, m);
        const asignadas = asignar(v.hechos, g.objetivos).size;
        if (!elegido || puntuar(v) > puntuar(elegido.v)) elegido = { v, crudo, m };
        if (asignadas === g.objetivos.length && !necesitaEscalar(v)) break;
      }
      if (m === fuerte) break;
    }
    await rm(carpeta, { recursive: true, force: true }).catch(() => undefined);
    const fila: Record<string, unknown> = { sha: sha.slice(0, 12), objetivos: g.objetivos.length, modelo: elegido?.m ?? null };
    if (!elegido) {
      fila.error = 'sin_respuesta_valida';
      informe.push(fila);
      return;
    }
    // La validación se repite por URL: el mismo PDF en otra URL tiene su propio docId y su propia clave.
    let escritas = 0;
    let puestos = 0;
    const porUrlObj = new Map<string, Objetivo[]>();
    for (const o of g.objetivos) porUrlObj.set(o.url, [...(porUrlObj.get(o.url) ?? []), o]);
    for (const [url, os] of porUrlObj) {
      const v = validarExtraccion(elegido.crudo, {
        ...ctx, url, docId: os[0].tournamentKey.replace(/^pdf:/, ''), season: os[0].season, editionName: os[0].editionName,
        extractor: `droid:${elegido.m}`,
      });
      for (const [o, h] of asignar(v.hechos, os)) {
        const hh = reclavar({ ...h, competition: { ...h.competition, date: h.competition.date ?? o.fecha } }, o);
        await writeFile(join(salida, ficheroHechos(hh)), `${JSON.stringify(hh, null, 2)}\n`, 'utf8');
        escritas += 1;
        puestos += hh.results.length;
      }
    }
    Object.assign(fila, {
      escritas, puestos, aceptadas: elegido.v.aceptadas, propuestas: elegido.v.propuestas, descartes: elegido.v.descartes,
      problemas: elegido.v.problemas,
    });
    informe.push(fila);
    console.log(`${sha.slice(0, 12)} modelo=${elegido.m} objetivos=${g.objetivos.length} escritas=${escritas} puestos=${puestos}`);
  };

  const cola = [...grupos.entries()];
  await Promise.all(Array.from({ length: concurrencia }, async () => {
    for (let x = cola.shift(); x; x = cola.shift()) {
      try {
        await procesar(x[0], x[1]);
      } catch (e) {
        informe.push({ sha: x[0].slice(0, 12), error: (e as Error).message.slice(0, 200) });
      }
    }
  }));
  await writeFile(join(salida, `_informe${etiqueta ? `-${etiqueta}` : ''}.json`), JSON.stringify({ generado: new Date().toISOString(), sinPdf, pdfs: informe }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
