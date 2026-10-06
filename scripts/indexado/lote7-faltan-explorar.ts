/**
 * Diagnóstico de páginas cacheadas del lote 7 (pruebas que faltan).
 *
 *   lote7-faltan-explorar.ts engarde <ruta.html>...     página Engarde
 *   lote7-faltan-explorar.ts ophardt-listado <ruta>...  listado de torneos de Ophardt
 *   lote7-faltan-explorar.ts ophardt <ruta>...          secciones de resultados de Ophardt
 *   lote7-faltan-explorar.ts hueco <texto>              huecos del catálogo cuyo nombre o enlace contiene el texto
 */
import { readFileSync } from 'node:fs';
import { parsearPaginaEngarde } from '../../src/lib/ingest/sources/engarde';
import { CARPETA_ENGARDE } from './engarde-descargar';
import { parsearListado, parsearResultados } from './fie-huecos-ophardt';
import { abrirNuevo7, INVENTARIO_NACIONAL } from './lote7-faltan-comun';
import { engardeSinDatos, huecosCatalogo, pruebasDeBase } from './lote7-faltan-huecos';

const [modo, ...rutas] = process.argv.slice(2);
if (modo === 'hueco') {
  const db = abrirNuevo7();
  const inv = JSON.parse(readFileSync(INVENTARIO_NACIONAL, 'utf8'));
  const sin = engardeSinDatos(CARPETA_ENGARDE);
  const huecos = huecosCatalogo(inv, pruebasDeBase(db), [], sin, new Date().toISOString().slice(0, 10));
  for (const h of huecos) if (JSON.stringify(h).includes(rutas[0])) console.log(JSON.stringify(h));
  console.log('sinDatos contiene', rutas[0], [...sin].filter((s) => s.includes(rutas[0])));
}
for (const ruta of modo === 'hueco' ? [] : rutas) {
  const html = readFileSync(ruta, 'utf8');
  if (modo === 'engarde') {
    const p = parsearPaginaEngarde(html);
    console.log(JSON.stringify({ ruta, tipo: p.tipo, titulo: p.titulo, encabezado: p.encabezado, fecha: p.fecha, publicado: p.publicado, equipos: p.equipos, filas: p.filas.length, anomalias: p.anomalias, primeras: p.filas.slice(0, 3) }));
  } else if (modo === 'ophardt-listado') {
    const r = parsearListado(html);
    console.log(ruta, r.paginas);
    for (const t of r.torneos) console.log(`  ${t.id} ${t.desde} ${t.nacion} ${t.ciudad} | ${t.titulo} | ${t.edades}`);
  } else if (modo === 'ophardt') {
    for (const s of parsearResultados(html)) {
      console.log(`  ${s.titulo} -> ${s.weapon} ${s.gender} ${s.category} ${s.format} ind=${s.individuales.length} eq=${s.equipos.length}${s.equiposDeducidos ? ' (deducidos)' : ''}`);
    }
  }
}
