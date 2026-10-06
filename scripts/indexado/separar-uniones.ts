/**
 * Deshace uniones pasadas que las reglas de nombre de `nombres-union.ts` ya no permiten
 * (apellidos cruzados sin otra prueba, hermanos, primos), con informe. Idempotente; sin
 * `--aplicar` simula (todo en un SAVEPOINT que se deshace).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/separar-uniones.ts --db <copia.sqlite> \
 *     [--aplicar] [--informe <separar-uniones-informe.json>] [--fie-atletas …] [--cache-skermo …]
 *
 * 1) Personas fundidas: cada una se compara con los nombres que identifican a su raíz (los de la
 *    raíz y los de las fundidas con ID FIE, licencia o ficha; primero se revisan éstas). Si el
 *    nombre lo impide y la unión no tiene una prueba decisiva, vuelve a ser raíz
 *    (`merged_into_person_id = NULL`). Pruebas decisivas: la misma licencia o el mismo ID FIE
 *    (también una fusión `misma_licencia_*`), la continuidad del cuadro (`cadena_del_cuadro`), el
 *    mismo club con el mismo año de nacimiento, o la misma fecha de nacimiento exacta con ID FIE
 *    y licencia (`misma_fecha_nacimiento`). Hermanos y primos sólo se quedan con licencia o ID.
 * 2) Puestos y lados de asalto por nombre (PDF, Engarde y EFC sin licencia, nación ESP o sin
 *    nación) cuyo nombre tiene los apellidos cruzados respecto a su persona: se desvinculan
 *    (`person_id = NULL`) para que el paso por nombre los vuelva a resolver con el orden. Un lado
 *    de asalto se queda si su persona tiene en esa prueba un puesto con un nombre compatible
 *    (la prueba pesa más que el nombre global).
 * Sólo personas españolas o sin país: fuera, el orden de nombres y apellidos varía entre fuentes.
 *
 * Cada separación deja un candidato `separacion_nombre` RECHAZADO (origen → raíz anterior, con
 * los nombres y la relación); para deshacerla basta volver a poner `merged_into_person_id`.
 * Después se ejecutan `unificar-personas.ts` y `vincular-asaltos.ts` como siempre.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  ahora, argumento, bandera, CARPETA_TRABAJO, NUEVO_POR_DEFECTO, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia, uuid,
} from './comun';
import { CACHE_SKERMO, FIE_ATLETAS, leerFechasNacimiento, nacimientosPorPersona } from './dedupe-nacimientos';
import { mejorRelacion, motivoNoUnir, type NombrePublicado, type PruebasUnion, type Relacion } from './nombres-union';

const FUENTES_NOMBRE = ['rfee_pdf', 'engarde', 'efc'];
const FUENTES_NOMBRE_SQL = FUENTES_NOMBRE.map((f) => `'${f}'`).join(', ');

export type SeparacionMiembro = {
  persona: string; nombresPersona: string[]; raiz: string; nombresRaiz: string[];
  relacion: Relacion; par: [string, string]; fusion: string | null; identidad: boolean;
};

export type InformeSeparacion = {
  miembros: { revisados: number; separados: number; conservadosPorPrueba: number; porRelacion: Record<string, number>; porFusion: Record<string, number> };
  filas: { puestos: number; asaltosLado: number; porFuente: Record<string, number> };
  separaciones: SeparacionMiembro[];
  ejemplosFilas: string[];
};

type Fila = { id: string; n: string; m: string | null; atleta: string | null; pais: string | null };

/** Tipo de fusión del candidato (`misma_licencia_rfee:X` → `misma_licencia_rfee`). */
const tipoFusion = (evidencia: string | null) => (evidencia ?? '').split(':')[0] || null;

export function separarUnionesPorNombre(db: DatabaseSync, nacimientos: ReadonlyMap<string, readonly string[]> = new Map()): InformeSeparacion {
  const inf: InformeSeparacion = {
    miembros: { revisados: 0, separados: 0, conservadosPorPrueba: 0, porRelacion: {}, porFusion: {} },
    filas: { puestos: 0, asaltosLado: 0, porFuente: {} },
    separaciones: [],
    ejemplosFilas: [],
  };
  const personas = new Map<string, Fila>();
  for (const p of db.prepare(`SELECT id, display_name n, merged_into_person_id m, athlete_id atleta, country_code pais FROM sport_person`).all() as Fila[]) {
    personas.set(p.id, p);
  }
  const raiz = (id: string) => {
    let a = id;
    for (let i = 0; i < 4; i += 1) {
      const m = personas.get(a)?.m;
      if (!m) return a;
      a = m;
    }
    return a;
  };
  const nombres = new Map<string, { nombre: string; fuente: string | null }[]>();
  const conIdentidad = new Set<string>();
  for (const p of personas.values()) {
    if (p.n) nombres.set(p.id, [{ nombre: p.n, fuente: null }]);
    if (p.atleta) conIdentidad.add(p.id);
  }
  for (const a of db.prepare(`SELECT person_id p, source s, name_original n FROM sport_person_alias`).iterate() as Iterable<{ p: string; s: string; n: string | null }>) {
    if (!personas.has(a.p)) continue;
    if (a.n) (nombres.get(a.p) ?? nombres.set(a.p, []).get(a.p)!).push({ nombre: a.n, fuente: a.s });
    if (!FUENTES_NOMBRE.includes(a.s)) conIdentidad.add(a.p);
  }
  const ids = new Map<string, Set<string>>();
  for (const e of db.prepare(
    `SELECT person_id p, scheme s, value v FROM sport_external_id WHERE link_status = 'CONFIRMADO' AND person_id IS NOT NULL`,
  ).iterate() as Iterable<{ p: string; s: string; v: string }>) {
    conIdentidad.add(e.p);
    (ids.get(e.p) ?? ids.set(e.p, new Set()).get(e.p)!).add(`${e.s}:${e.v.trim().toUpperCase()}`);
  }
  // La fusión más reciente de cada persona (origen → destino).
  const fusionDe = new Map<string, string>();
  for (const c of db.prepare(
    `SELECT source_ref o, evidence e FROM sport_link_candidate WHERE status = 'CONFIRMADO' AND source_ref IN (SELECT id FROM sport_person)
      ORDER BY created_at`,
  ).iterate() as Iterable<{ o: string; e: string | null }>) {
    if (c.e) fusionDe.set(c.o, c.e);
  }
  const miembros = new Map<string, string[]>();
  for (const p of personas.values()) {
    if (!p.m) continue;
    const r = raiz(p.id);
    (miembros.get(r) ?? miembros.set(r, []).get(r)!).push(p.id);
  }
  const anios = (id: string) => new Set((nacimientos.get(id) ?? []).map((f) => f.slice(0, 4)));
  const separados = new Set<string>();
  const t = ahora();
  const soltar = db.prepare(`UPDATE sport_person SET merged_into_person_id = NULL, updated_at = ? WHERE id = ? AND merged_into_person_id IS NOT NULL`);
  const anotar = db.prepare(
    `INSERT INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence, decided_at, created_at)
     VALUES (?, 'separacion_nombre', ?, ?, ?, 'RECHAZADO', ?, ?, ?)`,
  );

  const espanola = (r: string) => { const pais = personas.get(r)?.pais; return !pais || pais === 'ESP'; };
  const anclaDe = (r: string, sin: string | null) => [r, ...(miembros.get(r) ?? []).filter((m) => m !== sin && !separados.has(m) && conIdentidad.has(m))]
    .flatMap((m) => nombres.get(m) ?? []);

  db.exec('SAVEPOINT separar');
  try {
    // 1) Personas fundidas: primero las que tienen ID (son el ancla de las demás). Sólo personas
    // españolas (o sin país): fuera, el orden de nombres y apellidos varía de una fuente a otra.
    for (const [r, ms] of [...miembros].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (!espanola(r)) continue;
      const orden = [...ms].sort((a, b) => Number(conIdentidad.has(b)) - Number(conIdentidad.has(a)) || (a < b ? -1 : 1));
      for (const m of orden) {
        const propios = nombres.get(m) ?? [];
        if (propios.length === 0) continue;
        inf.miembros.revisados += 1;
        const ancla = anclaDe(r, m);
        const fusion = fusionDe.get(m) ?? null;
        const tipo = tipoFusion(fusion);
        const idsM = ids.get(m) ?? new Set();
        const compartido = [r, ...(miembros.get(r) ?? [])].some((x) => x !== m && [...(ids.get(x) ?? [])].some((v) => idsM.has(v)));
        const ar = anios(r);
        const pruebas: PruebasUnion = {
          identidad: compartido || tipo === 'misma_licencia_rfee' || tipo === 'misma_licencia_engarde',
          continuidad: tipo === 'cadena_del_cuadro',
          clubYAnio: tipo === 'misma_fecha_nacimiento' || (!!fusion?.includes('club:') && [...anios(m)].some((y) => ar.has(y))),
        };
        const sinPruebas = motivoNoUnir(propios, ancla);
        if (!sinPruebas) continue;
        const motivo = motivoNoUnir(propios, ancla, pruebas);
        if (!motivo) {
          inf.miembros.conservadosPorPrueba += 1;
          continue;
        }
        if (Number(soltar.run(t, m).changes) === 0) continue;
        separados.add(m);
        personas.get(m)!.m = null;
        inf.miembros.separados += 1;
        inf.miembros.porRelacion[motivo.relacion] = (inf.miembros.porRelacion[motivo.relacion] ?? 0) + 1;
        const k = tipo ?? 'sin_candidato';
        inf.miembros.porFusion[k] = (inf.miembros.porFusion[k] ?? 0) + 1;
        const nombresR = [...new Set(ancla.map((x) => x.nombre))];
        anotar.run(uuid(), m, personas.get(m)!.n, r,
          `${motivo.relacion}:«${motivo.a}»≠«${motivo.b}»${fusion ? `|fusion:${fusion}` : ''}`, t, t);
        inf.separaciones.push({
          persona: m, nombresPersona: [...new Set(propios.map((x) => x.nombre))], raiz: r, nombresRaiz: nombresR,
          relacion: motivo.relacion, par: [motivo.a, motivo.b], fusion, identidad: conIdentidad.has(m),
        });
      }
    }
    // Las fundidas en una separada (antes de aplanar) siguen en la raíz: se revisan con ella.

    // 2) Puestos y lados de asalto por nombre con los apellidos cruzados respecto a su persona.
    const anclas = new Map<string, NombrePublicado[]>();
    const anclaRaiz = (p: string) => {
      const r = raiz(p);
      let a = anclas.get(r);
      if (!a) anclas.set(r, (a = anclaDe(r, null)));
      return a;
    };
    const cruzado = (nombre: string, fuente: string, p: string) =>
      espanola(raiz(p)) && motivoNoUnir([{ nombre, fuente }], anclaRaiz(p))?.relacion === 'orden_cruzado';
    const quitarPuesto = db.prepare(`UPDATE sport_result SET person_id = NULL WHERE id = ?`);
    for (const r of db.prepare(
      `SELECT id, source s, source_name n, person_id p FROM sport_result
        WHERE source IN (${FUENTES_NOMBRE_SQL}) AND person_id IS NOT NULL AND coalesce(source_country_code, 'ESP') = 'ESP'
          AND source_fact_key NOT LIKE 'efc:lic:%'`,
    ).all() as { id: string; s: string; n: string; p: string }[]) {
      if (!cruzado(r.n, r.s, r.p)) continue;
      quitarPuesto.run(r.id);
      inf.filas.puestos += 1;
      inf.filas.porFuente[`puesto:${r.s}`] = (inf.filas.porFuente[`puesto:${r.s}`] ?? 0) + 1;
      if (inf.ejemplosFilas.length < 200) inf.ejemplosFilas.push(`puesto ${r.s}: «${r.n}» ≠ ${personas.get(raiz(r.p))?.n} [${raiz(r.p).slice(0, 8)}]`);
    }
    // Lo que dice la prueba pesa más que el nombre global: un lado de asalto se queda con su
    // persona si ésta tiene en la misma prueba un puesto cuyo nombre casa con el del lado.
    const puestosEn = db.prepare(`SELECT source s, source_name n, person_id p FROM sport_result WHERE competition_id = ? AND person_id IS NOT NULL`);
    const cachePuestos = new Map<string, { s: string; n: string; r: string }[]>();
    const continuidad = (comp: string, nombre: string, fuente: string, p: string) => {
      let l = cachePuestos.get(comp);
      if (!l) cachePuestos.set(comp, (l = (puestosEn.all(comp) as { s: string; n: string; p: string }[]).map((x) => ({ s: x.s, n: x.n, r: raiz(x.p) }))));
      const r = raiz(p);
      const propios = l.filter((x) => x.r === r).map((x) => ({ nombre: x.n, fuente: x.s }));
      if (propios.length === 0) return false;
      const m = mejorRelacion([{ nombre, fuente }], propios);
      return !!m && ['mismo', 'recortado', 'compuesto_simple', 'variante_caracter'].includes(m.relacion);
    };
    for (const lado of ['a', 'b'] as const) {
      const quitar = db.prepare(`UPDATE sport_bout SET fencer_${lado}_person_id = NULL WHERE id = ?`);
      for (const b of db.prepare(
        `SELECT id, competition_id c, source s, fencer_${lado}_name n, fencer_${lado}_person_id p FROM sport_bout
          WHERE source IN (${FUENTES_NOMBRE_SQL}) AND fencer_${lado}_person_id IS NOT NULL`,
      ).all() as { id: string; c: string; s: string; n: string; p: string }[]) {
        if (!b.n || !cruzado(b.n, b.s, b.p) || continuidad(b.c, b.n, b.s, b.p)) continue;
        quitar.run(b.id);
        inf.filas.asaltosLado += 1;
        inf.filas.porFuente[`asalto:${b.s}`] = (inf.filas.porFuente[`asalto:${b.s}`] ?? 0) + 1;
        if (inf.ejemplosFilas.length < 200) inf.ejemplosFilas.push(`asalto ${b.s}: «${b.n}» ≠ ${personas.get(raiz(b.p))?.n} [${raiz(b.p).slice(0, 8)}]`);
      }
    }
    db.exec('RELEASE separar');
  } catch (e) {
    db.exec('ROLLBACK TO separar');
    db.exec('RELEASE separar');
    throw e;
  }
  return inf;
}

function main(): void {
  const rutaDb = argumento('db', NUEVO_POR_DEFECTO);
  const salida = argumento('informe', join(CARPETA_TRABAJO, 'separar-uniones-informe.json'));
  const aplicar = bandera('aplicar');
  const fechas = leerFechasNacimiento({
    cacheSkermo: argumento('cache-skermo', CACHE_SKERMO),
    fieAtletas: argumento('fie-atletas', FIE_ATLETAS),
  });
  const db = new DatabaseSync(rutaDb);
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  let inf: InformeSeparacion;
  try {
    if (!aplicar) db.exec('SAVEPOINT simulacion');
    try {
      inf = separarUnionesPorNombre(db, nacimientosPorPersona(db, fechas));
    } finally {
      if (!aplicar) {
        db.exec('ROLLBACK TO simulacion');
        db.exec('RELEASE simulacion');
      }
    }
  } finally {
    restaurarGuardia(db);
    db.close();
  }
  writeFileSync(salida, JSON.stringify(inf, null, 2));
  console.log(JSON.stringify({ ...inf, separaciones: inf.separaciones.slice(0, 15), ejemplosFilas: inf.ejemplosFilas.slice(0, 15) }, null, 2));
  console.log(`Informe: ${salida}${aplicar ? '' : '\n(simulación: nada guardado; --aplicar para escribir)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
