/**
 * Índice de los torneos de Fencing Time Live archivados en la Wayback Machine.
 * fencingtimelive.com exige iniciar sesión desde 2026, así que sus resultados
 * sólo se pueden leer de capturas públicas anteriores.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-huecos-ftl-indice.ts [--filtro <regex de nombre>]
 *
 * Lee de la Wayback la última captura de cada `tournaments/eventSchedule/<id>` y
 * escribe `fie-huecos/ftl-indice.json` con nombre, días y pruebas (id y nombre)
 * de cada torneo, más los tipos de captura disponibles por prueba
 * (`download` CSV, `data` JSON, `pools`, `tableaus`).
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumento } from './comun';
import { CARPETA_HUECOS, cdx, desentidad, limpiar, obtener, texto, ultimasCapturas, urlWayback, type Captura } from './fie-huecos-comun';

export const INDICE_FTL = join(CARPETA_HUECOS, 'ftl-indice.json');
const ID = /[0-9A-Fa-f]{32}/;

export type PruebaFtl = { id: string; nombre: string; dia: string | null; capturas: Record<string, Captura[]> };
export type TorneoFtl = { id: string; nombre: string; captura: Captura; dias: string[]; pruebas: PruebaFtl[] };

export const TIPOS_CAPTURA = {
  download: 'fencingtimelive.com/events/results/download/',
  data: 'fencingtimelive.com/events/results/data/',
  pools: 'fencingtimelive.com/pools/scores/',
  tableaus: 'fencingtimelive.com/tableaus/scores/',
} as const;

/** Todas las capturas 200 de un prefijo, agrupadas por ID de prueba FTL. */
export async function capturasPorPrueba(prefijo: string): Promise<Map<string, Captura[]>> {
  const m = new Map<string, Captura[]>();
  for (const c of await cdx(prefijo, { matchType: 'prefix', filter: 'statuscode:200' })) {
    const id = new RegExp(`${prefijo.split('/').slice(1).join('/')}(${ID.source})`, 'i').exec(c.original)?.[1]?.toUpperCase();
    if (!id) continue;
    (m.get(id) ?? m.set(id, []).get(id)!).push(c);
  }
  return m;
}

export function parsearCalendarioFtl(html: string): { nombre: string; dias: string[]; pruebas: { id: string; nombre: string; dia: string | null }[] } {
  const nombre = limpiar(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const dias: string[] = [];
  const pruebas: { id: string; nombre: string; dia: string | null }[] = [];
  const partes = html.split(/<h5>/i);
  for (const parte of partes.slice(1)) {
    const dia = limpiar(parte.slice(0, parte.indexOf('</h5>')));
    dias.push(dia);
    for (const m of parte.matchAll(/<a href="\/events\/view\/([0-9A-F]{32})">([\s\S]*?)<\/a>/gi)) {
      pruebas.push({ id: m[1].toUpperCase(), nombre: limpiar(desentidad(m[2])), dia });
    }
  }
  return { nombre, dias, pruebas };
}

async function main() {
  const filtro = new RegExp(argumento('filtro', '.'), 'i');
  const calendarios = ultimasCapturas(
    await cdx('fencingtimelive.com/tournaments/eventSchedule/', { matchType: 'prefix', filter: 'statuscode:200' }),
    (c) => ID.exec(c.original)?.[0]?.toUpperCase() ?? c.original,
  );
  const capturas: Record<string, Map<string, Captura[]>> = {};
  for (const [tipo, prefijo] of Object.entries(TIPOS_CAPTURA)) capturas[tipo] = await capturasPorPrueba(prefijo);
  const torneos: TorneoFtl[] = [];
  let n = 0;
  for (const [id, c] of calendarios) {
    n += 1;
    const d = await obtener(urlWayback(c.timestamp, c.original));
    const html = texto(d);
    if (d.status !== 200 || html === null) {
      console.log(`${n}/${calendarios.size} ${id} HTTP ${d.status}`);
      continue;
    }
    const cal = parsearCalendarioFtl(html);
    if (!filtro.test(cal.nombre)) continue;
    torneos.push({
      id, nombre: cal.nombre, captura: c, dias: cal.dias,
      pruebas: cal.pruebas.map((p) => ({
        ...p,
        capturas: Object.fromEntries(Object.keys(TIPOS_CAPTURA).map((t) => [t, capturas[t].get(p.id) ?? []])),
      })),
    });
    if (n % 50 === 0) console.log(`${n}/${calendarios.size}`);
  }
  writeFileSync(INDICE_FTL, `${JSON.stringify(torneos, null, 1)}\n`);
  console.log(`${torneos.length} torneos en ${INDICE_FTL}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
