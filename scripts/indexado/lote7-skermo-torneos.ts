/**
 * Lista de torneos de TODOS los organizadores de engarde-service.com (no sólo los españoles
 * conocidos), para buscar dónde se publicaron las poules y cuadros de las pruebas de Skermo que
 * no aparecen en las listas cacheadas. Deja `torneos-engarde.json` en la caché del lote 7.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-skermo-torneos.ts \
 *     [--organismos <json de prog/getOrganism.php>] [--desde 2021-08-01] [--sin-red]
 *
 * El índice global (`getCompeForDisplay.php` sin organizador) no filtra por fecha, así que la
 * única forma de ver todos los torneos es pedir la lista de cada organizador.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import { fechaTorneoLista, type TorneoLista } from './engarde-historico-descargar';
import { CACHE_LOTE7_SKERMO, obtener, textoDe } from './lote7-skermo-comun';

export const RUTA_TORNEOS_ENGARDE = join(CACHE_LOTE7_SKERMO, 'torneos-engarde.json');
export type TorneoGlobal = { org: string; evt: string; fecha: string; titulo: string };

export function leerTorneosGlobales(ruta = RUTA_TORNEOS_ENGARDE): TorneoGlobal[] {
  return existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as TorneoGlobal[]) : [];
}

async function organismos(rutaLocal: string, sinRed: boolean): Promise<string[]> {
  let texto: string | null = null;
  if (existsSync(rutaLocal)) texto = readFileSync(rutaLocal, 'utf8');
  else {
    const d = await obtener('https://engarde-service.com/prog/getOrganism.php', {
      sub: 'engarde-global', sinRed, formulario: { option: 'organism', nrows: '5000' },
    });
    if (d.bytes) texto = textoDe(d.bytes);
  }
  if (!texto) throw new Error('Sin lista de organizadores de Engarde');
  const j = JSON.parse(texto.replace(/^\uFEFF/, '')) as { result: { Organisme: string }[] };
  return [...new Set(j.result.map((o) => o.Organisme.trim()).filter(Boolean))];
}

async function main() {
  const sinRed = bandera('sin-red');
  const desde = argumento('desde', '2021-08-01');
  const orgs = await organismos(argumento('organismos', join(CARPETA_TRABAJO, 'cache-lote7-pdf', 'engarde-organismos.json')), sinRed);
  const out: TorneoGlobal[] = [];
  let n = 0;
  for (const org of orgs) {
    n += 1;
    for (let pagina = 1, total = 1; pagina <= Math.min(total, 40); pagina += 1) {
      const d = await obtener('https://engarde-service.com/prog/getTournois.php', {
        sub: 'engarde-torneos', sinRed, pausaMs: 600,
        formulario: { option: 'tournois', organism: org, nrows: '50', order: 'asc', page: String(pagina) },
      });
      if (!d.bytes) break;
      let j: { result?: TorneoLista[]; totalPages?: number | string };
      try {
        j = JSON.parse(textoDe(d.bytes).replace(/^\uFEFF/, ''));
      } catch {
        break;
      }
      total = Number(j.totalPages ?? 1) || 1;
      for (const t of j.result ?? []) {
        if (t.Organisme?.toLowerCase() !== org.toLowerCase()) continue;
        const fecha = fechaTorneoLista(t);
        if (fecha && fecha >= desde) out.push({ org: org.toLowerCase(), evt: t.Event, fecha, titulo: t.Titre ?? '' });
      }
    }
    if (n % 50 === 0) console.log(`${n}/${orgs.length} organizadores, ${out.length} torneos`);
  }
  mkdirSync(CACHE_LOTE7_SKERMO, { recursive: true });
  writeFileSync(RUTA_TORNEOS_ENGARDE, JSON.stringify(out, null, 1));
  console.log(`${orgs.length} organizadores, ${out.length} torneos desde ${desde}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
