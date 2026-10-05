/**
 * Corrige en el SQLite de trabajo las fechas de pruebas `rfee_pdf` cuyo PDF imprime una
 * fecha con una errata evidente frente al catálogo nacional que enlaza ese mismo PDF.
 * Se ejecuta después de `unificar-personas.ts`; es idempotente.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/corregir-fechas-pdf.ts \
 *     [--db <nuevo.sqlite>] [--inventario <national-inventory.json>] [--informe <json>] [--simular]
 *
 * El cargador conserva la fecha ya guardada de una prueba (`previa ?? nueva`), así que
 * corregir el fichero de hechos no basta: se corrige la fila.
 *
 * Sólo se corrige cuando la fila del catálogo es única para el PDF, la temporada, el arma,
 * el género y el formato, su fecha cae en la temporada, y la diferencia es una errata:
 * el año desplazado en uno (±1 día), el día y el mes intercambiados, o el año con las
 * cifras permutadas («2109» por «2019»). Diferencias de meses en el mismo año (jornadas
 * de liga, PDF del catálogo equivocado) no se tocan.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  ahora,
  argumento,
  bandera,
  CARPETA_CACHES,
  CARPETA_TRABAJO,
  NUEVO_POR_DEFECTO,
  prepararCopiaTrabajo,
  quitarGuardia,
  restaurarGuardia,
} from './comun';

type FilaCatalogo = {
  temporada: string;
  fecha?: string | null;
  arma?: string | null;
  genero?: string | null;
  formato?: string | null;
  enlaces?: { url: string }[];
};

export type Correccion = {
  competicion: string;
  edicion: string;
  temporada: string;
  antes: string;
  despues: string;
  motivo: 'anio_desplazado' | 'dia_mes_intercambiados' | 'anio_permutado';
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;
const dias = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA_MS;

function enTemporada(fecha: string, temporada: string): boolean {
  const m = /^(\d{4})-(\d{4})$/.exec(temporada);
  if (!m) return false;
  return fecha >= `${m[1]}-08-01` && fecha <= `${m[2]}-07-31`;
}

/** Tipo de errata que lleva de `impresa` a `catalogo`, o null si no es una errata clara. */
export function errata(impresa: string, catalogo: string): Correccion['motivo'] | null {
  if (!FECHA.test(impresa) || !FECHA.test(catalogo) || dias(impresa, catalogo) <= 3) return null;
  const [ai, mi, di] = impresa.split('-');
  const [ac] = catalogo.split('-');
  if (Math.abs(Number(ai) - Number(ac)) === 1 && dias(`${ac}-${mi}-${di}`, catalogo) <= 1) return 'anio_desplazado';
  if (ai === ac && `${ai}-${di}-${mi}` === catalogo) return 'dia_mes_intercambiados';
  const cifras = (s: string) => [...s].sort().join('');
  if (ai !== ac && cifras(ai) === cifras(ac) && dias(`${ac}-${mi}-${di}`, catalogo) <= 31) return 'anio_permutado';
  return null;
}

/** `hash del PDF` → filas del catálogo que lo enlazan. */
function catalogoPorPdf(filas: FilaCatalogo[]): Map<string, FilaCatalogo[]> {
  const indice = new Map<string, FilaCatalogo[]>();
  for (const f of filas) {
    for (const e of f.enlaces ?? []) {
      const m = /\/client\/\d+\/([0-9a-f]{32})\.pdf/i.exec(e.url);
      if (!m) continue;
      const h = m[1].toLowerCase();
      const lista = indice.get(h) ?? [];
      if (!lista.includes(f)) lista.push(f);
      indice.set(h, lista);
    }
  }
  return indice;
}

export function buscarCorrecciones(db: DatabaseSync, catalogo: FilaCatalogo[]): Correccion[] {
  const porPdf = catalogoPorPdf(catalogo);
  const pruebas = db.prepare(
    `SELECT id, edition_id, season, competition_key k, weapon, gender, format, competition_date d
       FROM sport_competition WHERE source = 'rfee_pdf' AND competition_date IS NOT NULL`,
  ).all() as { id: string; edition_id: string; season: string; k: string; weapon: string; gender: string; format: string; d: string }[];
  const correcciones: Correccion[] = [];
  for (const p of pruebas) {
    const m = /^pdf:([0-9a-f]{32})/.exec(p.k);
    if (!m) continue;
    const filas = (porPdf.get(m[1]) ?? []).filter((f) =>
      f.temporada === p.season && f.arma === p.weapon && f.genero === p.gender && f.formato === p.format);
    if (filas.length !== 1) continue;
    const fecha = filas[0].fecha;
    if (!fecha || !FECHA.test(fecha) || !enTemporada(fecha, p.season)) continue;
    const motivo = errata(p.d, fecha);
    if (motivo) correcciones.push({ competicion: p.id, edicion: p.edition_id, temporada: p.season, antes: p.d, despues: fecha, motivo });
  }
  return correcciones;
}

export function aplicarCorrecciones(db: DatabaseSync, correcciones: Correccion[]): { puestos: number; asaltos: number; ediciones: number } {
  const n = { puestos: 0, asaltos: 0, ediciones: 0 };
  if (correcciones.length === 0) return n;
  const t = ahora();
  const prueba = db.prepare('UPDATE sport_competition SET competition_date = ?, updated_at = ? WHERE id = ? AND competition_date = ?');
  const puestos = db.prepare('UPDATE sport_result SET occurred_on = ? WHERE competition_id = ? AND occurred_on = ?');
  const asaltos = db.prepare('UPDATE sport_bout SET occurred_on = ? WHERE competition_id = ? AND occurred_on = ?');
  // La edición abarca las fechas de sus pruebas; sin pruebas fechadas se queda como está.
  const edicion = db.prepare(
    `UPDATE sport_edition SET start_date = x.inicio, end_date = x.fin, updated_at = ?
       FROM (SELECT min(competition_date) inicio, max(competition_date) fin FROM sport_competition
              WHERE edition_id = ? AND competition_date IS NOT NULL) x
      WHERE sport_edition.id = ? AND x.inicio IS NOT NULL
        AND (sport_edition.start_date IS NOT x.inicio OR sport_edition.end_date IS NOT x.fin)`,
  );
  db.exec('BEGIN');
  try {
    for (const c of correcciones) {
      prueba.run(c.despues, t, c.competicion, c.antes);
      n.puestos += Number(puestos.run(c.despues, c.competicion, c.antes).changes);
      n.asaltos += Number(asaltos.run(c.despues, c.competicion, c.antes).changes);
    }
    for (const e of new Set(correcciones.map((c) => c.edicion))) n.ediciones += Number(edicion.run(t, e, e).changes);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return n;
}

function main(): void {
  const rutaDb = argumento('db', NUEVO_POR_DEFECTO);
  const rutaInventario = argumento('inventario', join(CARPETA_CACHES, 'history-national', 'national-inventory.json'));
  const salida = argumento('informe', join(CARPETA_TRABAJO, 'fechas-pdf-informe.json'));
  const inventario = JSON.parse(readFileSync(rutaInventario, 'utf8')) as { ownRfeeCatalog?: FilaCatalogo[] };
  const db = new DatabaseSync(rutaDb);
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  try {
    const correcciones = buscarCorrecciones(db, inventario.ownRfeeCatalog ?? []);
    const aplicado = bandera('simular') ? null : aplicarCorrecciones(db, correcciones);
    const informe = { correcciones, aplicado };
    writeFileSync(salida, JSON.stringify(informe, null, 2));
    for (const c of correcciones) console.log(`${c.temporada} ${c.antes} -> ${c.despues} (${c.motivo}) ${c.competicion}`);
    console.log(JSON.stringify({ pruebas: correcciones.length, aplicado }));
  } finally {
    restaurarGuardia(db);
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
