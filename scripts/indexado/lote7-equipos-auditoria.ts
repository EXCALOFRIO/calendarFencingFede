/**
 * Auditoría (sólo lectura) de las poules por equipos rfee_pdf ya guardadas: cada equipo de
 * cada poule debe cuadrar con la fila que imprime su PDF (tocados dados y recibidos o índice),
 * la misma comprobación que `lote7-equipos-pdf.ts` aplica a lo que lee. No escribe hechos: el
 * formato no puede borrar asaltos guardados, así que lo que no cuadra se informa.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-equipos-auditoria.ts [--db <nuevo7.sqlite>]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { argumento, CARPETA_TRABAJO } from './comun';
import { CACHE_EQUIPOS, NUEVO7, pruebasEquipos } from './lote7-equipos-comun';
import { filaCuadra, prepararLineas } from './lote7-equipos-pdf';

async function main(): Promise<void> {
  const db = new DatabaseSync(argumento('db', NUEVO7), { readOnly: true });
  const pruebas = pruebasEquipos(db, 'rfee_pdf').filter((p) => p.poules > 0);
  const asaltos = db.prepare(`SELECT round_key r, fencer_a_name an, fencer_b_name bn, score_a sa, score_b sb FROM sport_bout
    WHERE competition_id=? AND phase='POULE'`);
  const calidad = JSON.parse(readFileSync(join(CARPETA_TRABAJO, 'hechos', 'pdf-calidad.json'), 'utf8')) as { url: string; blobPath: string }[];
  const blob = new Map(calidad.map((c) => [c.url.split('#')[0], c.blobPath]));
  const { extractText, getDocumentProxy } = await import('unpdf');
  const textos = new Map<string, ReturnType<typeof prepararLineas>>();
  const salida: { prueba: string; url: string; poules: number; encuentros: number; filasNoCuadran: number; filasSinImprimir: number; filas: number }[] = [];
  for (const p of pruebas) {
    const url = (p.sourceUrl ?? '').split('#')[0];
    const ruta = blob.get(url);
    if (!ruta || !existsSync(ruta)) continue;
    if (!textos.has(url)) {
      const doc = await getDocumentProxy(new Uint8Array(readFileSync(ruta)));
      const { text } = await extractText(doc, { mergePages: false });
      await doc.loadingTask.destroy();
      textos.set(url, prepararLineas(text));
    }
    const lineas = textos.get(url)!;
    const filas = asaltos.all(p.id) as { r: string; an: string; bn: string; sa: number; sb: number }[];
    const tot = new Map<string, { n: string; d: number; r: number }>();
    for (const b of filas) {
      for (const [n, d, r] of [[b.an, b.sa, b.sb], [b.bn, b.sb, b.sa]] as const) {
        const k = `${b.r}\u0000${n}`;
        const t = tot.get(k) ?? { n, d: 0, r: 0 };
        t.d += d;
        t.r += r;
        tot.set(k, t);
      }
    }
    let mal = 0;
    let sin = 0;
    for (const t of tot.values()) {
      const c = filaCuadra(lineas, t.n, t.d, t.r);
      if (c === false) mal += 1;
      else if (c === null) sin += 1;
    }
    salida.push({
      prueba: p.competitionKey, url, poules: new Set(filas.map((f) => f.r)).size, encuentros: filas.length,
      filasNoCuadran: mal, filasSinImprimir: sin, filas: tot.size,
    });
  }
  const resumen = {
    pruebasConPoules: salida.length,
    todasCuadran: salida.filter((s) => s.filasNoCuadran === 0 && s.filasSinImprimir === 0).length,
    conFilasQueNoCuadran: salida.filter((s) => s.filasNoCuadran > 0).length,
    encuentrosEnPruebasQueNoCuadran: salida.filter((s) => s.filasNoCuadran > 0).reduce((n, s) => n + s.encuentros, 0),
  };
  writeFileSync(join(CACHE_EQUIPOS, 'auditoria-poules-guardadas.json'), JSON.stringify({ resumen, pruebas: salida }, null, 2));
  console.log(JSON.stringify(resumen, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
