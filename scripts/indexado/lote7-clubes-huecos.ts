/**
 * Pruebas nacionales (desde 2017-08-01, ya celebradas) con clasificación y sin poules o sin cuadro
 * en ninguna lectura del evento (`huecosNacionales`), agrupadas por evento (fecha ±1 día y
 * edición). Sólo lectura de `nuevo7.sqlite`. Escribe `cache-lote7-clubes/_huecos.json`.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-clubes-huecos.ts [--desde 2017-08-01] [--hasta 2026-10-06]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { huecosNacionales } from './asaltos-rfee-engarde';
import { argumento } from './comun';
import { cargarPruebasNacionales, enlacesDelCatalogo, leerCatalogoNacional } from './dedupe-pruebas';
import { CACHE_CLUBES } from './lote7-clubes-red';
import { NUEVO7 } from './lote7-pdf-comun';

const desde = argumento('desde', '2017-08-01');
const hasta = argumento('hasta', new Date().toISOString().slice(0, 10));
const db = new DatabaseSync(NUEVO7, { readOnly: true });
const pruebas = cargarPruebasNacionales(db, desde);
const huecos = huecosNacionales(pruebas, enlacesDelCatalogo(pruebas, leerCatalogoNacional()), desde).filter((h) => h.fecha <= hasta);
const edicion = db.prepare('SELECT name, city, start_date, source_url FROM sport_edition WHERE id=?');
type Fila = { fecha: string; edicion: string; ciudad: string | null; url: string | null; pruebas: { id: string; source: string; arma: string; genero: string; categoria: string; resultados: number; faltan: string[]; url: string | null }[] };
const eventos = new Map<string, Fila>();
for (const h of huecos) {
  const e = edicion.get(h.edition_id) as { name: string; city: string | null; source_url: string | null } | undefined;
  const k = `${h.edition_id}`;
  const f = eventos.get(k) ?? { fecha: h.fecha, edicion: e?.name ?? '?', ciudad: e?.city ?? null, url: e?.source_url ?? null, pruebas: [] };
  if (h.fecha < f.fecha) f.fecha = h.fecha;
  f.pruebas.push({ id: h.id, source: h.source, arma: h.weapon, genero: h.gender, categoria: h.category, resultados: h.resultados, faltan: h.faltan, url: h.url });
  eventos.set(k, f);
}
const lista = [...eventos.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
mkdirSync(CACHE_CLUBES, { recursive: true });
writeFileSync(join(CACHE_CLUBES, '_huecos.json'), JSON.stringify(lista, null, 1));
for (const e of lista) {
  const n = e.pruebas.reduce((s, p) => s + p.resultados, 0);
  console.log(`${e.fecha} | ${n} | ${e.edicion.slice(0, 70)} | ${e.ciudad ?? ''} | ${e.pruebas.map((p) => `${p.arma[0]}${p.genero}${p.categoria}:${p.resultados}:${p.faltan.map((f) => f[0]).join('')}`).join(' ')}`);
}
console.log(`huecos ${huecos.length} pruebas en ${lista.length} ediciones`);
db.close();
