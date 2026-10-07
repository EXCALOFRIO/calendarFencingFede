/**
 * Buscador de competiciones contra una copia real de la base, sin servidor:
 * lee el índice de ediciones una vez (como hace la caché compartida por
 * versión de datos), lo construye y mide cada tecla de unas búsquedas
 * escritas letra a letra. Imprime los primeros resultados de cada una.
 *
 *   PERF_DB=<copia.sqlite> npx tsx tests/perf/buscador-competiciones.mts [consulta...]
 *
 * La base se abre en sólo lectura.
 */
import { DatabaseSync } from 'node:sqlite';
import { compactarEdiciones, construirIndiceEdiciones, buscarEnIndice, resumenDeIndice } from '@/lib/sport/explorar/indice-ediciones';
import { serializar, deserializar } from '@/lib/cache/serializar';

const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const sqlite = new DatabaseSync(BASE, { readOnly: true });

const t0 = performance.now();
const filas = sqlite.prepare(`
  SELECT e.id AS id, e.name AS nombre, e.season AS temporada, e.source AS fuente,
    e.city AS ciudad, e.country_code AS pais, e.start_date AS inicio, e.end_date AS fin,
    count(c.id) AS pruebas, group_concat(DISTINCT c.weapon) AS armas, group_concat(DISTINCT c.format) AS formatos,
    group_concat(DISTINCT c.gender) AS generos, group_concat(DISTINCT c.category) AS categorias
  FROM sport_edition e LEFT JOIN sport_competition c ON c.edition_id = e.id GROUP BY e.id`).all() as never[];
const tLeer = performance.now() - t0;
const datos = compactarEdiciones(filas);
const texto = serializar(datos);
const t1 = performance.now();
const indice = construirIndiceEdiciones(deserializar(texto));
const tConstruir = performance.now() - t1;
console.log(`${indice.total.toLocaleString('es-ES')} ediciones · ${(texto.length / 1024).toFixed(0)} K caracteres serializados · lectura ${tLeer.toFixed(0)} ms · deserializar y construir ${tConstruir.toFixed(1)} ms · ${indice.vocabulario.length} términos`);

const consultas = process.argv.slice(2).length ? process.argv.slice(2)
  : ['mndial', 'copa del mun', 'turin', 'torino', 'world cup', 'campeonato de europa', 'europeo m20', 'gp turin 2024', 'varsovia', 'budapest', 'mundial veteranos', 'tnr m15 espada', 'zzzzqq'];
const tiempos: number[] = [];
for (const q of consultas) {
  for (let n = 1; n <= q.length; n++) {
    const t = performance.now();
    buscarEnIndice(indice, { q: q.slice(0, n) });
    tiempos.push(performance.now() - t);
  }
  const t = performance.now();
  const r = buscarEnIndice(indice, { q });
  const ms = performance.now() - t;
  console.log(`\n«${q}» → ${r.posiciones.length} ediciones (${ms.toFixed(2)} ms)`);
  for (const e of r.posiciones.slice(0, 5).map((p) => resumenDeIndice(indice, p))) {
    console.log(`  ${e.inicio ?? '----------'}  ${e.nombre} · ${e.ciudad ?? ''} (${e.pais ?? ''}) [${e.fuente}]`);
  }
}
const orden = [...tiempos].sort((a, b) => a - b);
const pct = (p: number) => orden[Math.min(orden.length - 1, Math.floor(orden.length * p))]!.toFixed(2);
console.log(`\nPor tecla (${orden.length} pulsaciones): mediana ${pct(0.5)} ms · p95 ${pct(0.95)} ms · máx ${orden.at(-1)!.toFixed(2)} ms`);
