/**
 * Objetivos de la relectura de PDF: pruebas nacionales principales (Cto. de España y
 * TNR, ABS/M23/M20/M17, desde 2017) con poules o cuadro incompletos según
 * `pdf-relectura-comun.ts`, con los PDF que las publican y las otras pruebas del
 * mismo evento que tienen asaltos (lecturas partidas que la fusión no unió). Sólo lee.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/pdf-relectura-objetivos.ts \
 *     --db <copia.sqlite> [--desde 2017-01-01] [--cache <cache-rfee-2018>] [--inventario <json>] \
 *     [--informe <json>] [--sin-pdf]
 *
 * Con PDF (por defecto), para cada prueba incompleta se lee el documento con el lector
 * local y se anota cuántos tiradores declara el cuadro, para medir la primera ronda.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { extraerPaginas } from '../../src/lib/ingest/sources/rfee-pdf/lectura';
import { leerResultadosPdf } from '../../src/lib/ingest/sources/rfee-pdf/resultados';
import type { PaginaTexto } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { esPrincipal } from './asaltos-rfee-diagnostico';
import { argumento, bandera, CARPETA_CACHES, NUEVO_POR_DEFECTO } from './comun';
import { cargarPruebasNacionales, enlacesDelCatalogo, INVENTARIO_NACIONAL, leerCatalogoNacional } from './dedupe-pruebas';
import { medirCuadro, medirPoules, tiradoresDeclarados, type AsaltoMedido, type MedidaCuadro, type MedidaPoules } from './pdf-relectura-comun';

const sinFragmento = (u: string) => u.split('#')[0];

export type UnidadCache = { id: string; url: string; sha256: string | null; estado: string; asociaciones?: { temporada: string }[] };

export function cargarManifiesto(cache: string): Map<string, UnidadCache> {
  const ruta = join(cache, 'manifest.json');
  const out = new Map<string, UnidadCache>();
  if (!existsSync(ruta)) return out;
  for (const u of (JSON.parse(readFileSync(ruta, 'utf8')).unidades ?? []) as UnidadCache[]) {
    if (u.estado === 'cached' && u.sha256) out.set(sinFragmento(u.url), u);
  }
  return out;
}

export const rutaBlob = (cache: string, u: UnidadCache) => join(cache, 'blobs', `${u.sha256}.bin`);

/** Texto plano de una página, por filas de arriba abajo. */
export function textoPagina(p: PaginaTexto): string {
  return [...p.items].sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.s).join(' ');
}

export type PruebaDocumento = {
  clave: string; cabecera: string; arma: string | null; genero: string | null; categoria: string | null;
  puestos: number; paginas: number[]; tiradoresCuadro: number | null;
  cuadro: { publicado: number | null; importado: number; estado: string };
  poules: { publicado: number | null; importado: number; estado: string };
};

/** Pruebas que el lector local reconoce en un PDF, con lo que declaran. */
export async function pruebasDelDocumento(bytes: Uint8Array, url: string): Promise<PruebaDocumento[]> {
  const { paginas } = await extraerPaginas(bytes);
  const l = leerResultadosPdf(paginas, { url, docId: 'doc' });
  const texto = new Map(paginas.map((p) => [p.numero, textoPagina(p)]));
  return l.pruebas.map((p) => ({
    clave: p.clave, cabecera: p.cabecera.join(' / '), arma: p.arma, genero: p.genero, categoria: p.categoria,
    puestos: p.puestos.length, paginas: p.paginas,
    tiradoresCuadro: tiradoresDeclarados(p.paginas.map((n) => texto.get(n) ?? '').join(' ')),
    cuadro: { publicado: p.cobertura.cuadro.publicado, importado: p.cobertura.cuadro.importado, estado: p.cobertura.cuadro.estado },
    poules: { publicado: p.cobertura.poules.publicado, importado: p.cobertura.poules.importado, estado: p.cobertura.poules.estado },
  }));
}

export type FilaObjetivo = {
  id: string; source: string; season: string; fecha: string; nombre: string; weapon: string; gender: string; category: string;
  resultados: number; poules: MedidaPoules; cuadro: MedidaCuadro;
  pdfs: string[];
  /** Otras pruebas del mismo evento (arma, género, ±2 días) con asaltos. */
  companeras: { id: string; source: string; clave: string; resultados: number; poules: number; cuadro: number }[];
  documento?: { url: string; pruebas: PruebaDocumento[] }[];
};

export type InformeObjetivos = {
  desde: string;
  principales: number;
  conPoules: number;
  poulesCompletas: number;
  conCuadro: number;
  cuadroCompleto: number;
  pctPoulesCompletas: number;
  pctCuadroCompleto: number;
  asaltosFaltantes: { poules: number; cuadro: number };
  incompletas: FilaObjetivo[];
};

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

export function medirPrincipales(db: DatabaseSync, opciones: {
  desde: string; hasta?: string; catalogo?: ReturnType<typeof leerCatalogoNacional>;
  tiradoresPorId?: ReadonlyMap<string, Partial<Record<'A' | 'B', number>>>;
}): { filas: FilaObjetivo[]; informe: Omit<InformeObjetivos, 'incompletas'> } {
  const hasta = opciones.hasta ?? new Date().toISOString().slice(0, 10);
  const todas = cargarPruebasNacionales(db, opciones.desde);
  const nombres = new Map((db.prepare(`SELECT c.id, e.name n FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id`)
    .all() as { id: string; n: string }[]).map((r) => [r.id, r.n]));
  const pruebas = todas.filter((p) => p.resultados > 0 && p.fecha < hasta && esPrincipal(nombres.get(p.id) ?? '', p.category));
  const enlaces = enlacesDelCatalogo(pruebas, opciones.catalogo ?? []);
  const asaltosDe = db.prepare(
    `SELECT phase, round_key roundKey, fencer_a_name aName, fencer_b_name bName, score_a scoreA, score_b scoreB, source_url u
       FROM sport_bout WHERE competition_id=?`,
  );
  const dia = (f: string) => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);
  const filas: FilaObjetivo[] = [];
  for (const p of pruebas) {
    const asaltos = asaltosDe.all(p.id) as (AsaltoMedido & { u: string | null })[];
    const poules = medirPoules(asaltos);
    const cuadro = medirCuadro(asaltos, {
      resultados: p.resultados, conPoules: poules.poules > 0, tiradoresCuadro: opciones.tiradoresPorId?.get(p.id),
    });
    const pdfs = new Set<string>();
    if (p.source === 'rfee_pdf' && p.url) pdfs.add(p.url);
    for (const u of enlaces.get(p.id) ?? []) pdfs.add(u);
    for (const b of asaltos) if (b.u && /\.pdf(#|$)/i.test(b.u)) pdfs.add(sinFragmento(b.u));
    const companeras = todas
      .filter((o) => o.id !== p.id && o.weapon === p.weapon && o.gender === p.gender && Math.abs(dia(o.fecha) - dia(p.fecha)) <= 2 &&
        o.asaltos.POULE + o.asaltos.TABLEAU > 0 && (o.source !== 'skermo_rfee'))
      .map((o) => ({ id: o.id, source: o.source, clave: o.competition_key, resultados: o.resultados, poules: o.asaltos.POULE, cuadro: o.asaltos.TABLEAU }));
    for (const c of todas.filter((o) => companeras.some((x) => x.id === o.id))) if (c.source === 'rfee_pdf' && c.url) pdfs.add(c.url);
    filas.push({
      id: p.id, source: p.source, season: p.season, fecha: p.fecha, nombre: nombres.get(p.id) ?? '', weapon: p.weapon,
      gender: p.gender, category: p.category, resultados: p.resultados, poules, cuadro, pdfs: [...pdfs], companeras,
    });
  }
  const conPoules = filas.filter((f) => f.poules.poules > 0);
  const conCuadro = filas.filter((f) => f.cuadro.tramos.length > 0);
  return {
    filas,
    informe: {
      desde: opciones.desde,
      principales: filas.length,
      conPoules: conPoules.length,
      poulesCompletas: conPoules.filter((f) => f.poules.completo).length,
      conCuadro: conCuadro.length,
      cuadroCompleto: conCuadro.filter((f) => f.cuadro.completo).length,
      pctPoulesCompletas: pct(filas.filter((f) => f.poules.completo).length, filas.length),
      pctCuadroCompleto: pct(filas.filter((f) => f.cuadro.completo).length, filas.length),
      asaltosFaltantes: {
        poules: filas.reduce((n, f) => n + f.poules.esperados - Math.min(f.poules.asaltos, f.poules.esperados), 0),
        cuadro: filas.reduce((n, f) => n + f.cuadro.esperados - f.cuadro.asaltos, 0),
      },
    },
  };
}

async function main(): Promise<void> {
  const db = new DatabaseSync(argumento('db', NUEVO_POR_DEFECTO), { readOnly: true });
  const cache = argumento('cache', join(CARPETA_CACHES, 'cache-rfee-2018'));
  const catalogo = leerCatalogoNacional(argumento('inventario', INVENTARIO_NACIONAL));
  const desde = argumento('desde', '2017-01-01');
  let { filas, informe } = medirPrincipales(db, { desde, catalogo });
  const incompletas = filas.filter((f) => !f.poules.completo || !f.cuadro.completo);
  if (!bandera('sin-pdf')) {
    const manifiesto = cargarManifiesto(cache);
    const leidos = new Map<string, PruebaDocumento[] | null>();
    const tiradores = new Map<string, Partial<Record<'A' | 'B', number>>>();
    for (const f of incompletas) {
      f.documento = [];
      for (const url of f.pdfs) {
        if (!leidos.has(url)) {
          const u = manifiesto.get(url);
          leidos.set(url, u && existsSync(rutaBlob(cache, u))
            ? await pruebasDelDocumento(new Uint8Array(readFileSync(rutaBlob(cache, u))), url).catch(() => null)
            : null);
        }
        const pruebas = leidos.get(url);
        if (!pruebas) continue;
        const suyas = pruebas.filter((p) => p.arma === f.weapon && p.genero === f.gender);
        f.documento.push({ url, pruebas: suyas });
        // Una sola prueba del arma y género en el documento: lo que declara es de esta prueba.
        if (suyas.length === 1 && suyas[0].tiradoresCuadro) tiradores.set(f.id, { A: suyas[0].tiradoresCuadro });
      }
    }
    const documentos = new Map(incompletas.map((f) => [f.id, f.documento]));
    ({ filas, informe } = medirPrincipales(db, { desde, catalogo, tiradoresPorId: tiradores }));
    for (const f of filas) if (documentos.has(f.id)) f.documento = documentos.get(f.id);
  }
  db.close();
  const salida: InformeObjetivos = { ...informe, incompletas: filas.filter((f) => !f.poules.completo || !f.cuadro.completo) };
  const ruta = argumento('informe', '');
  if (ruta) writeFileSync(ruta, JSON.stringify(salida, null, 1));
  console.log(JSON.stringify({ ...salida, incompletas: salida.incompletas.length }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
