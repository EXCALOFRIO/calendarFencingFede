/**
 * Clasificaciones de Skermo (ranking público RFEE) de pruebas nacionales ya celebradas que
 * nuevo7 no tiene como `skermo_rfee`: las del calendario de la app (`event_competition`
 * de eventos `skermo_rfee` de ámbito NACIONAL ya terminados) y las del catálogo nacional
 * con `clavePrueba` `RFEE:<id>`. Mismas claves que la ingesta de Skermo y que
 * `rfee-tnr-2026-10.ts` (edición `competition:RFEE:<id>`, prueba `RFEE:<id>`).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-faltan-skermo.ts [--db <nuevo7.sqlite>] [--ids 10347,10350]
 *
 * Skermo publica la clasificación con licencia, no los asaltos. Una prueba cuya página aún
 * no trae clasificación se anota en el informe y no produce fichero.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { argumento } from './comun';
import { abrirNuevo7, EscritorHechos, INVENTARIO_NACIONAL, NUEVO7 } from './lote7-faltan-comun';
import { Red } from './lote7-faltan-red';
import { hechosSkermo } from './rfee-tnr-2026-10';

const urlPrueba = (id: string) => `https://app.skermo.org/ranking/public/RFEE/competition/${id}?setLang=es`;

export type Pendiente = { id: string; origen: string; nombre: string; fecha: string | null };

export function pendientesSkermo(db: ReturnType<typeof abrirNuevo7>, catalogo: { clavePrueba?: string | null; nombre: string; fecha?: string | null }[], hoy: string): Pendiente[] {
  const existe = db.prepare(`SELECT 1 FROM sport_competition WHERE source = 'skermo_rfee' AND competition_key = ?`);
  const out = new Map<string, Pendiente>();
  const filas = db.prepare(`
    SELECT ec.source_id id, e.name, coalesce(ec.competition_date, e.start_date) fecha
      FROM event e JOIN event_competition ec ON ec.event_id = e.id
     WHERE e.source = 'skermo_rfee' AND e.scope = 'NACIONAL' AND e.cancelled = 0 AND e.end_date < ?
       AND ec.source_id IS NOT NULL`).all(hoy) as { id: string; name: string; fecha: string | null }[];
  for (const f of filas) {
    if (!/^\d+$/.test(f.id) || existe.get(`RFEE:${f.id}`)) continue;
    out.set(f.id, { id: f.id, origen: 'calendario', nombre: f.name, fecha: f.fecha });
  }
  for (const c of catalogo) {
    const id = /^RFEE:(\d+)$/.exec(c.clavePrueba ?? '')?.[1];
    if (!id || out.has(id) || existe.get(`RFEE:${id}`) || (c.fecha && c.fecha >= hoy)) continue;
    out.set(id, { id, origen: 'catalogo', nombre: c.nombre, fecha: c.fecha ?? null });
  }
  return [...out.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

async function main(): Promise<void> {
  const hoy = new Date().toISOString().slice(0, 10);
  const db = abrirNuevo7(argumento('db', NUEVO7));
  const inv = JSON.parse(readFileSync(argumento('inventario', INVENTARIO_NACIONAL), 'utf8')) as { ownRfeeCatalog: { clavePrueba?: string | null; nombre: string; fecha?: string | null }[] };
  const ids = argumento('ids', '');
  const pendientes = ids
    ? ids.split(',').map((id) => ({ id: id.trim(), origen: 'argumento', nombre: '', fecha: null }))
    : pendientesSkermo(db, inv.ownRfeeCatalog, hoy);
  db.close();
  const red = new Red();
  const escritor = new EscritorHechos('skermo_resultados');
  const detalle: Record<string, unknown>[] = [];
  for (const p of pendientes) {
    const r = await red.get(urlPrueba(p.id));
    if (r.status !== 200) {
      detalle.push({ ...p, estado: `http_${r.status}` });
      continue;
    }
    const h = hechosSkermo(p.id, r.body.toString('utf8'), r.sha256);
    if (!h) {
      detalle.push({ ...p, estado: 'sin_clasificacion_publicada' });
      continue;
    }
    escritor.escribir(h);
    detalle.push({ ...p, estado: h.status.results, puestos: h.results.length, conLicencia: h.results.filter((x) => x.license).length, prueba: `${h.competition.weapon} ${h.competition.gender} ${h.competition.category} ${h.competition.format} ${h.competition.date}` });
  }
  if (!ids) escritor.limpiarAntiguos();
  const resumen = { generado: new Date().toISOString(), pendientes: pendientes.length, ficheros: escritor.total, peticiones: red.peticiones, detalle };
  escritor.informe('skermo', resumen);
  console.log(JSON.stringify(resumen, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
