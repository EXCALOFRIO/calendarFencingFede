/**
 * Pruebas RFEE que la foto «lote7» de `cobertura.ts` da por completas (o con clasificación) y la
 * foto «antes» no, sobre una base que ya tiene el lote 7 cargado. Sólo lectura.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote9-rfee-perdidas-diagnostico.ts \
 *     --db <nuevo9.sqlite> [--hechos <carpeta>] [--hoy 2026-10-07] [--salida <json>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { argumento, CARPETA_CACHES, CARPETA_TRABAJO } from './comun';
import {
  claveRegistro, construirUnidades, evaluarUnidades, filasCatalogo, registrosDeCarpetas, registrosNuevo7, type Registro,
} from './cobertura';

function main(): void {
  const hoy = argumento('hoy', '2026-10-07');
  const rutaDb = argumento('db', join(CARPETA_TRABAJO, 'nuevo9.sqlite'));
  const raiz = argumento('hechos', join(CARPETA_TRABAJO, 'hechos'));
  const db = new DatabaseSync(rutaDb, { readOnly: true });
  const nuevo7 = registrosNuevo7(db);
  const lote7 = registrosDeCarpetas(raiz, 'lote7-', 'lote7');
  const inv = JSON.parse(readFileSync(join(CARPETA_CACHES, 'history-national', 'national-inventory.json'), 'utf8'));
  const us = evaluarUnidades(construirUnidades({ nuevo7, lote7, lote8: [], catalogo: filasCatalogo(inv, hoy), efcPendientes: [], hoy }));
  const enBase = new Map(nuevo7.map((r) => [claveRegistro(r), r] as const));
  const comp = db.prepare(`SELECT id, edition_id FROM sport_competition WHERE source=? AND season=? AND competition_key=?`);
  const cob = db.prepare(`SELECT fact_kind, status, imported_total, published_total, competition_id FROM sport_import_coverage
    WHERE source=? AND season=? AND competition_key=?`);
  const cobPorClave = db.prepare(`SELECT v.fact_kind, v.status, v.imported_total, v.competition_id, c.source, c.season, c.competition_key
    FROM sport_import_coverage v LEFT JOIN sport_competition c ON c.id = v.competition_id WHERE v.source=? AND v.competition_key=?`);
  const hayConjuntas = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE name='sport_competition_combined'`).get();
  const conjunta = hayConjuntas
    ? db.prepare(`SELECT 'parte' papel, rule, combined_competition_id otra FROM sport_competition_combined WHERE part_competition_id=?1
        UNION ALL SELECT 'conjunta', rule, part_competition_id FROM sport_competition_combined WHERE combined_competition_id=?1`)
    : null;
  const filas = db.prepare(`SELECT (SELECT count(*) FROM sport_result WHERE competition_id=?1) res,
    (SELECT count(*) FROM sport_bout WHERE competition_id=?1 AND phase='POULE') pb, (SELECT count(*) FROM sport_bout WHERE competition_id=?1 AND phase='TABLEAU') tb,
    (SELECT group_concat(DISTINCT source) FROM sport_bout WHERE competition_id=?1) fuentesAsaltos`);
  const destinoDe = (source: string, key: string) => {
    const v = cobPorClave.all(source, key) as { competition_id: string | null; source: string | null; season: string; competition_key: string; fact_kind: string; status: string }[];
    const ids = [...new Set(v.map((x) => x.competition_id).filter((x): x is string => !!x))];
    return {
      cobertura: v.map((x) => `${x.fact_kind}:${x.status}->${x.source ?? '-'}:${x.competition_key ?? '-'}`),
      destinos: ids.map((id) => {
        const c = db.prepare(`SELECT source, season, competition_key FROM sport_competition WHERE id=?`).get(id) as
          { source: string; season: string; competition_key: string };
        return { id, ...c, ...(filas.get(id) as object), conjunta: conjunta?.all(id) ?? [] };
      }),
    };
  };
  const resumen = (r: Registro | undefined) => (r ? { res: r.res, puestos: r.conPuesto, pb: r.pb, tb: r.tb, parcial: r.parcial } : null);
  const unidadesDeClave = new Map<string, { id: string; completa: boolean; clasificacion: boolean }[]>();
  for (const u of us) {
    if (u.fuente !== 'RFEE') continue;
    for (const r of u.registros.antes) {
      const k = claveRegistro(r);
      (unidadesDeClave.get(k) ?? unidadesDeClave.set(k, []).get(k)!).push({ id: u.id, completa: u.ev.antes.completa, clasificacion: u.ev.antes.clasificacion });
    }
  }
  const out = [];
  for (const u of us) {
    if (u.fuente !== 'RFEE') continue;
    const a = u.ev.antes;
    const b = u.ev.lote7;
    const ganaCompleta = b.completa && !a.completa;
    const ganaClasif = b.clasificacion && !a.clasificacion;
    if (!ganaCompleta && !ganaClasif) continue;
    const lecturas = u.registros.lote7.filter((r) => r.origen.includes('lote7-')).map((r) => {
      const k = claveRegistro(r);
      const c = comp.get(r.source, r.season, r.key) as { id: string; edition_id: string } | undefined;
      // `fundir` ya mezcla base y fichero: la lectura del fichero sola se rehace restando la base.
      return {
        clave: k, origen: r.origen, enBase: resumen(enBase.get(k)), fundida: resumen(r), competicion: c?.id ?? null,
        cobertura: c ? cob.all(r.source, r.season, r.key) : [],
        conjunta: c && conjunta ? conjunta.all(c.id) : [],
        ...(c ? {} : destinoDe(r.source, r.key)),
      };
    });
    const propias = new Set(u.registros.antes.map(claveRegistro));
    const ubicaciones = lecturas.map((l) => {
      const casas = l.competicion
        ? [l.clave]
        : (l.destinos ?? []).map((d) => `${d.source}|${d.season}|${d.competition_key}`);
      if (casas.length === 0) return { clave: l.clave, donde: 'perdida' as const, otras: [] };
      if (casas.some((c) => propias.has(c))) return { clave: l.clave, donde: 'en_unidad' as const, otras: [] };
      return { clave: l.clave, donde: 'otra_unidad' as const, otras: casas.flatMap((c) => unidadesDeClave.get(c) ?? []) };
    });
    const causa = ubicaciones.some((x) => x.donde === 'perdida') ? 'borrada'
      : ubicaciones.every((x) => x.donde === 'otra_unidad') ? 'proyeccion_otra_fila' : 'en_unidad';
    out.push({
      causa, ubicaciones,
      id: u.id, nombre: u.nombre, temporada: u.temporada, fecha: u.fecha, arma: u.weapon, genero: u.gender, categoria: u.category, formato: u.format,
      ganaCompleta, ganaClasif, antes: a, lote7: b,
      lecturasBase: u.registros.antes.map((r) => {
        const c = comp.get(r.source, r.season, r.key) as { id: string } | undefined;
        return { clave: claveRegistro(r), ...resumen(r), conjunta: c && conjunta ? conjunta.all(c.id) : [] };
      }), lecturas,
    });
  }
  db.close();
  const salida = argumento('salida', '');
  if (salida) writeFileSync(salida, JSON.stringify(out, null, 1));
  console.log(`unidades: ${out.length}, completas: ${out.filter((x) => x.ganaCompleta).length}, clasif.: ${out.filter((x) => x.ganaClasif).length}`);
  const porCausa: Record<string, { unidades: number; completas: number; clasificacion: number }> = {};
  for (const x of out) {
    const c = (porCausa[x.causa] ??= { unidades: 0, completas: 0, clasificacion: 0 });
    c.unidades += 1;
    if (x.ganaCompleta) c.completas += 1;
    if (x.ganaClasif) c.clasificacion += 1;
  }
  console.log(JSON.stringify(porCausa));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
