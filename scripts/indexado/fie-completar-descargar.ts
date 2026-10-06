/**
 * Descarga (con caché) metadata, poules y cuadro de la API FIE de cada prueba
 * individual FIE con puestos desde 2017, para auditar la completitud de asaltos:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-completar-descargar.ts \
 *     [--base <sqlite>] [--concurrencia 4] [--limite N] [--refrescar 1]
 *
 * Reutiliza lo ya leído por `fie-huecos` (relectura) y `fie-dirigido`; lo nuevo
 * queda en `cache-fie-completar/fie/<season>-<id>-<parte>.json`. Una respuesta
 * 404 se anota en `_registro.jsonl` y no se vuelve a pedir.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { urlCuadro, urlPoules, urlPrueba } from '../../src/lib/ingest/sources/fie-resultados';
import { argumento } from './comun';
import {
  abrirBase, BASE_PRODUCCION, CACHE_FIE, enParalelo, ficheroFie, leerFieCache, pruebasFieIndividuales, USER_AGENT,
  type ParteFie,
} from './fie-completar-comun';

const REGISTRO = join(CACHE_FIE, '_registro.jsonl');
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function registrados(): Map<string, number> {
  const m = new Map<string, number>();
  if (!existsSync(REGISTRO)) return m;
  for (const l of readFileSync(REGISTRO, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l) as { f: string; status: number };
      m.set(r.f, r.status);
    } catch {
      /* línea truncada */
    }
  }
  return m;
}

async function pedir(url: string): Promise<{ status: number; cuerpo: string | null }> {
  let espera = 5000;
  for (let intento = 1; intento <= 6; intento += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel();
        await dormir(espera);
        espera = Math.min(espera * 2, 120_000);
        continue;
      }
      return { status: res.status, cuerpo: res.status === 200 ? await res.text() : null };
    } catch {
      await dormir(espera);
      espera = Math.min(espera * 2, 120_000);
    }
  }
  return { status: -1, cuerpo: null };
}

async function main() {
  const base = argumento('base', BASE_PRODUCCION);
  const concurrencia = Number(argumento('concurrencia', '4'));
  const limite = Number(argumento('limite', 'Infinity'));
  const refrescar = argumento('refrescar', '0') === '1';
  const db = abrirBase(base);
  const hoy = new Date().toISOString().slice(0, 10);
  const pruebas = pruebasFieIndividuales(db).filter((p) => p.resultados > 0 && (p.date ?? p.startDate ?? '9999') < hoy).slice(0, limite);
  db.close();
  mkdirSync(CACHE_FIE, { recursive: true });
  const reg = registrados();
  const tareas: { season: string; id: string; parte: ParteFie; url: string }[] = [];
  for (const p of pruebas) {
    for (const parte of ['meta', 'pools', 'tableau'] as const) {
      const f = ficheroFie(p.season, p.competitionKey, parte);
      if (!refrescar && (leerFieCache(p.season, p.competitionKey, parte) || reg.get(f) === 404)) continue;
      const s = Number(p.season);
      const url = parte === 'meta' ? urlPrueba(s, Number(p.competitionKey))
        : parte === 'pools' ? urlPoules(s, Number(p.competitionKey)) : urlCuadro(s, Number(p.competitionKey));
      tareas.push({ season: p.season, id: p.competitionKey, parte, url });
    }
  }
  console.log(`${pruebas.length} pruebas; ${tareas.length} documentos por pedir`);
  let hechas = 0;
  let fallos = 0;
  const inicio = Date.now();
  await enParalelo(tareas, concurrencia, async (t) => {
    const r = await pedir(t.url);
    const f = ficheroFie(t.season, t.id, t.parte);
    if (r.cuerpo !== null) {
      const ruta = join(CACHE_FIE, f);
      writeFileSync(`${ruta}.tmp`, r.cuerpo);
      renameSync(`${ruta}.tmp`, ruta);
    } else fallos += 1;
    appendFileSync(REGISTRO, `${JSON.stringify({ f, url: t.url, status: r.status, ts: new Date().toISOString() })}\n`);
    hechas += 1;
    if (hechas % 100 === 0) {
      console.log(`${new Date().toISOString()} ${hechas}/${tareas.length} fallos=${fallos} ${Math.round((Date.now() - inicio) / 1000)}s`);
    }
  });
  console.log(`FIN ${hechas}/${tareas.length} fallos=${fallos} ${Math.round((Date.now() - inicio) / 1000)}s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
