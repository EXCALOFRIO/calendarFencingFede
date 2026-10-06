/**
 * Repara los nombres con «\uFFFD» (U+FFFD) de una copia de trabajo: personas, alias, nombres y
 * clubes de fuente en resultados, nombres de asaltos y candidatos de vínculo. Las reglas están en
 * `src/lib/sport/nombres/reparar-caracteres.ts`. En el lote 7 va después de `cargar-hechos.ts`
 * y antes de `unificar-personas.ts`, para que la unión de personas ya vea los nombres buenos:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/reparar-caracteres.ts --base <copia.sqlite> \
 *     [--aplicar] [--salida <carpeta>]
 *
 * Sin `--aplicar` es un ensayo con la base abierta en sólo lectura. El informe (JSON y CSV) queda
 * en `<salida>` (por defecto `calendario-trabajo/reparar-caracteres/`). Las claves
 * (`source_fact_key`, `source_ref`) y `content_hash` no se tocan: una recarga del mismo hecho no
 * vuelve a escribir el nombre roto, y la clave sigue casando con la del hecho original.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  construirDiccionario, proponer, tieneSustitucion, type Diccionario, type Propuesta, type Variante,
} from '../../src/lib/sport/nombres/reparar-caracteres';
import {
  ahora, argumento, bandera, CARPETA_TRABAJO, normalizarNombre, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia,
} from './comun';

const FFFD = "char(65533)";
const BASES_PROTEGIDAS = new Set(['base.sqlite', 'remoto.sqlite']);

type Tipo = 'nombre' | 'club';
type Contexto = { personas: Set<string>; competiciones: Set<string> };
type Filas = { personas: number; alias: number; resultados: number; asaltos: number; candidatos: number };

export type Decision = Propuesta & { tipo: Tipo; filas: Filas };

export type InformeReparar = {
  base: string;
  aplicado: boolean;
  generado: string;
  resumen: {
    distintos: number;
    reparados: number;
    porVia: Record<'a' | 'b' | 'c', number>;
    pendientes: number;
    filas: Record<string, number>;
  };
  decisiones: Decision[];
  /** Columnas con «\uFFFD» que no son nombres (cursores, contextos): se listan, no se tocan. */
  noTratados: { tabla: string; columna: string; filas: number }[];
  escritura: Record<string, number> | null;
  /** Al final a propósito: lo que hay que mirar a mano. */
  revisionManual: RevisionManual[];
};

type Persona = { id: string; display_name: string; first_name: string | null; last_name: string | null };
type Alias = { id: string; person_id: string; source: string; name_original: string };
type Resultado = { id: string; competition_id: string; person_id: string | null; source_name: string; source_club: string | null };
type Candidato = { id: string; source_ref: string; person_id: string; source_name: string };

type Asalto = { id: string; competition_id: string; a_person: string | null; b_person: string | null; a_name: string | null; b_name: string | null };

export type Afectados = { personas: Persona[]; alias: Alias[]; resultados: Resultado[]; asaltos: Asalto[]; candidatos: Candidato[] };

export function recogerAfectados(db: DatabaseSync): Afectados {
  return {
    personas: db.prepare(`SELECT id, display_name, first_name, last_name FROM sport_person
      WHERE instr(display_name, ${FFFD})>0 OR instr(coalesce(first_name,''), ${FFFD})>0 OR instr(coalesce(last_name,''), ${FFFD})>0`).all() as Persona[],
    alias: db.prepare(`SELECT id, person_id, source, name_original FROM sport_person_alias WHERE instr(name_original, ${FFFD})>0`).all() as Alias[],
    resultados: db.prepare(`SELECT id, competition_id, person_id, source_name, source_club FROM sport_result
      WHERE instr(source_name, ${FFFD})>0 OR instr(coalesce(source_club,''), ${FFFD})>0`).all() as Resultado[],
    asaltos: db.prepare(`SELECT id, competition_id, fencer_a_person_id a_person, fencer_b_person_id b_person, fencer_a_name a_name, fencer_b_name b_name
      FROM sport_bout WHERE instr(coalesce(fencer_a_name,''), ${FFFD})>0 OR instr(coalesce(fencer_b_name,''), ${FFFD})>0`).all() as Asalto[],
    candidatos: db.prepare(`SELECT id, source_ref, person_id, source_name FROM sport_link_candidate WHERE instr(source_name, ${FFFD})>0`).all() as Candidato[],
  };
}

function noTratados(db: DatabaseSync): InformeReparar['noTratados'] {
  const tratadas = new Set(['sport_person.display_name', 'sport_person.first_name', 'sport_person.last_name', 'sport_person_alias.name_original',
    'sport_result.source_name', 'sport_result.source_club', 'sport_bout.fencer_a_name', 'sport_bout.fencer_b_name', 'sport_link_candidate.source_name']);
  const salida: InformeReparar['noTratados'] = [];
  const tablas = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`).all() as { name: string }[];
  for (const { name } of tablas) {
    const cols = (db.prepare(`SELECT name, type FROM pragma_table_info(?)`).all(name) as { name: string; type: string }[]).filter((c) => /TEXT|^$/i.test(c.type));
    for (const c of cols) {
      if (tratadas.has(`${name}.${c.name}`)) continue;
      const n = Number((db.prepare(`SELECT count(*) n FROM "${name}" WHERE instr("${c.name}", ${FFFD})>0`).get() as { n: number }).n);
      if (n > 0) salida.push({ tabla: name, columna: c.name, filas: n });
    }
  }
  return salida;
}

/** Diccionarios de palabras bien escritas: uno de nombres de personas y otro de clubes. */
export function diccionariosDeBase(db: DatabaseSync): { nombres: Diccionario; clubes: Diccionario } {
  function* nombres() {
    for (const s of [
      `SELECT DISTINCT display_name n FROM sport_person`,
      `SELECT DISTINCT name_original n FROM sport_person_alias`,
      `SELECT DISTINCT source_name n FROM sport_result`,
      `SELECT DISTINCT fencer_a_name n FROM sport_bout UNION SELECT DISTINCT fencer_b_name FROM sport_bout`,
    ]) for (const r of db.prepare(s).iterate() as Iterable<{ n: string | null }>) if (r.n) yield r.n;
  }
  function* clubes() {
    for (const r of db.prepare(`SELECT DISTINCT source_club n FROM sport_result WHERE source_club IS NOT NULL`).iterate() as Iterable<{ n: string }>) yield r.n;
  }
  return { nombres: construirDiccionario(nombres()), clubes: construirDiccionario(clubes()) };
}

/** Todas las fichas de la misma persona: la raíz de sus fusiones y lo fusionado en ella. */
function grupo(db: DatabaseSync, id: string): string[] {
  return (db.prepare(`WITH RECURSIVE sube(id) AS (SELECT ? UNION SELECT p.merged_into_person_id FROM sport_person p JOIN sube s ON p.id=s.id
      WHERE p.merged_into_person_id IS NOT NULL),
    baja(id) AS (SELECT id FROM sube UNION SELECT p.id FROM sport_person p JOIN baja b ON p.merged_into_person_id=b.id)
    SELECT id FROM baja`).all(id) as { id: string }[]).map((r) => r.id);
}

type VarianteCompleta = Variante & { mismaPersona: boolean };

/** Variantes de la misma persona (alias, fusiones, licencia o id FIE) y de la misma prueba. */
function variantes(db: DatabaseSync, ctx: Contexto, tipo: Tipo): VarianteCompleta[] {
  const miembros = new Set<string>();
  for (const p of ctx.personas) for (const m of grupo(db, p)) miembros.add(m);
  for (const m of [...miembros]) {
    const otros = db.prepare(`SELECT DISTINCT x2.person_id id FROM sport_external_id x1 JOIN sport_external_id x2
        ON x2.scheme=x1.scheme AND x2.value=x1.value AND x2.person_id<>x1.person_id WHERE x1.person_id=?`).all(m) as { id: string }[];
    for (const o of otros) for (const g of grupo(db, o.id)) miembros.add(g);
  }
  const salida: VarianteCompleta[] = [];
  const ids = [...miembros];
  const enLotes = <T>(sql: (marcas: string) => string, f: (filas: T[]) => void) => {
    for (let i = 0; i < ids.length; i += 200) {
      const lote = ids.slice(i, i + 200);
      f(db.prepare(sql(lote.map(() => '?').join(','))).all(...lote) as T[]);
    }
  };
  const competiciones = new Set(ctx.competiciones);
  if (tipo === 'club') {
    enLotes<{ n: string }>((m) => `SELECT DISTINCT source_club n FROM sport_result WHERE person_id IN (${m}) AND source_club IS NOT NULL`,
      (f) => f.forEach((r) => salida.push({ nombre: r.n, origen: 'club de la misma persona', mismaPersona: false })));
    return salida;
  }
  enLotes<{ n: string; m: string | null }>((m) => `SELECT display_name n, merged_into_person_id m FROM sport_person WHERE id IN (${m})`,
    (f) => f.forEach((r) => salida.push({ nombre: r.n, origen: 'ficha de la persona', mismaPersona: true })));
  enLotes<{ n: string; s: string }>((m) => `SELECT name_original n, source s FROM sport_person_alias WHERE person_id IN (${m})`,
    (f) => f.forEach((r) => salida.push({ nombre: r.n, origen: `alias ${r.s}`, mismaPersona: true })));
  enLotes<{ n: string; s: string; c: string }>((m) => `SELECT source_name n, source s, competition_id c FROM sport_result WHERE person_id IN (${m})`,
    (f) => f.forEach((r) => {
      salida.push({ nombre: r.n, origen: `resultado ${r.s}`, mismaPersona: true });
      competiciones.add(r.c);
    }));
  // Otras lecturas de la misma prueba: misma arma, sexo, categoría, formato y día.
  const hermanas = new Set<string>();
  const hermanasDe = db.prepare(`SELECT d.id FROM sport_competition c JOIN sport_edition ec ON ec.id=c.edition_id
      JOIN sport_competition d ON d.weapon IS c.weapon AND d.gender IS c.gender AND d.category IS c.category AND d.format IS c.format
      JOIN sport_edition ed ON ed.id=d.edition_id
    WHERE c.id=? AND coalesce(d.competition_date, ed.start_date) = coalesce(c.competition_date, ec.start_date)`);
  for (const c of competiciones) {
    hermanas.add(c);
    for (const r of hermanasDe.all(c) as { id: string }[]) hermanas.add(r.id);
  }
  const nombresPrueba = db.prepare(`SELECT source_name n, source s FROM sport_result WHERE competition_id=?
    UNION SELECT fencer_a_name, source FROM sport_bout WHERE competition_id=? UNION SELECT fencer_b_name, source FROM sport_bout WHERE competition_id=?`);
  for (const c of hermanas) {
    for (const r of nombresPrueba.all(c, c, c) as { n: string | null; s: string }[]) {
      if (r.n && !tieneSustitucion(r.n)) salida.push({ nombre: r.n, origen: `misma prueba (${r.s})`, mismaPersona: false });
    }
  }
  return salida;
}

/** Nombre pendiente con su persona y sus pruebas, para revisarlo a mano. */
export type RevisionManual = {
  tipo: Tipo;
  original: string;
  palabrasSinDecidir: { palabra: string; motivo: string }[];
  personas: { id: string; nombre: string }[];
  pruebas: { id: string; fuente: string; clave: string; fecha: string | null; edicion: string | null; arma: string | null; sexo: string | null; categoria: string | null; url: string | null }[];
};

export type Plan = { decisiones: Map<string, Decision>; afectados: Afectados; revisionManual: RevisionManual[] };

const clave = (tipo: Tipo, s: string) => `${tipo}\u0000${s}`;

export function planificar(db: DatabaseSync, dic = diccionariosDeBase(db)): Plan {
  const afectados = recogerAfectados(db);
  const contextos = new Map<string, { tipo: Tipo; original: string; ctx: Contexto; filas: Filas }>();
  const anotar = (tipo: Tipo, original: string | null, personas: (string | null)[], competiciones: string[], fila: keyof Filas) => {
    if (!tieneSustitucion(original)) return;
    const k = clave(tipo, original);
    const e = contextos.get(k) ?? { tipo, original, ctx: { personas: new Set(), competiciones: new Set() }, filas: { personas: 0, alias: 0, resultados: 0, asaltos: 0, candidatos: 0 } };
    personas.forEach((p) => p && e.ctx.personas.add(p));
    competiciones.forEach((c) => e.ctx.competiciones.add(c));
    e.filas[fila] += 1;
    contextos.set(k, e);
  };
  const existe = db.prepare(`SELECT 1 FROM sport_person WHERE id=?`);
  for (const p of afectados.personas) for (const v of [p.display_name, p.first_name, p.last_name]) anotar('nombre', v, [p.id], [], 'personas');
  for (const a of afectados.alias) anotar('nombre', a.name_original, [a.person_id], [], 'alias');
  for (const r of afectados.resultados) {
    anotar('nombre', r.source_name, [r.person_id], [r.competition_id], 'resultados');
    anotar('club', r.source_club, [r.person_id], [], 'resultados');
  }
  for (const b of afectados.asaltos) {
    anotar('nombre', b.a_name, [b.a_person], [b.competition_id], 'asaltos');
    anotar('nombre', b.b_name, [b.b_person], [b.competition_id], 'asaltos');
  }
  for (const c of afectados.candidatos) {
    anotar('nombre', c.source_name, [c.person_id, existe.get(c.source_ref) ? c.source_ref : null], [], 'candidatos');
  }
  const decisiones = new Map<string, Decision>();
  const revisionManual: RevisionManual[] = [];
  const ficha = db.prepare(`SELECT id, display_name nombre FROM sport_person WHERE id=?`);
  const pruebasDe = db.prepare(`SELECT DISTINCT competition_id c FROM sport_result WHERE person_id=?`);
  const prueba = db.prepare(`SELECT c.id, c.source fuente, c.competition_key clave, coalesce(c.competition_date, e.start_date) fecha, e.name edicion,
      c.weapon arma, c.gender sexo, c.category categoria, c.source_url url
    FROM sport_competition c JOIN sport_edition e ON e.id=c.edition_id WHERE c.id=?`);
  for (const [k, e] of contextos) {
    const p = proponer(e.original, variantes(db, e.ctx, e.tipo), e.tipo === 'club' ? dic.clubes : dic.nombres);
    decisiones.set(k, { ...p, tipo: e.tipo, filas: e.filas });
    if (p.propuesta !== null) continue;
    const comps = new Set(e.ctx.competiciones);
    for (const id of e.ctx.personas) for (const r of pruebasDe.all(id) as { c: string }[]) comps.add(r.c);
    revisionManual.push({
      tipo: e.tipo,
      original: e.original,
      palabrasSinDecidir: p.palabras.filter((w) => w.reparada === null).map((w) => ({ palabra: w.palabra, motivo: w.evidencia })),
      personas: [...e.ctx.personas].map((id) => ficha.get(id) as RevisionManual['personas'][number] | undefined).filter((x) => x !== undefined),
      pruebas: [...comps].map((id) => prueba.get(id) as RevisionManual['pruebas'][number] | undefined).filter((x) => x !== undefined),
    });
  }
  revisionManual.sort((x, y) => x.original.localeCompare(y.original));
  return { decisiones, afectados, revisionManual };
}

/** Escribe las propuestas decididas. Debe llamarse dentro de una transacción y sin la guardia. */
export function aplicarPlan(db: DatabaseSync, plan: Plan): Record<string, number> {
  const t = ahora();
  const n: Record<string, number> = { personas: 0, alias: 0, aliasDuplicadosBorrados: 0, resultados: 0, asaltos: 0, candidatos: 0 };
  const nuevo = (tipo: Tipo, s: string | null) => (tieneSustitucion(s) ? plan.decisiones.get(clave(tipo, s))?.propuesta ?? s : s);
  const updPersona = db.prepare(`UPDATE sport_person SET display_name=?, first_name=?, last_name=?, name_normalized=?, updated_at=? WHERE id=?`);
  for (const p of plan.afectados.personas) {
    const v = { d: nuevo('nombre', p.display_name)!, f: nuevo('nombre', p.first_name), l: nuevo('nombre', p.last_name) };
    if (v.d === p.display_name && v.f === p.first_name && v.l === p.last_name) continue;
    updPersona.run(v.d, v.f, v.l, normalizarNombre(v.d), t, p.id);
    n.personas += 1;
  }
  const choque = db.prepare(`SELECT id FROM sport_person_alias WHERE person_id=? AND source=? AND name_normalized=? AND id<>?`);
  const borrarAlias = db.prepare(`DELETE FROM sport_person_alias WHERE id=?`);
  const updAlias = db.prepare(`UPDATE sport_person_alias SET name_original=?, name_normalized=? WHERE id=?`);
  for (const a of plan.afectados.alias) {
    const v = nuevo('nombre', a.name_original)!;
    if (v === a.name_original) continue;
    const norm = normalizarNombre(v);
    if (choque.get(a.person_id, a.source, norm, a.id)) {
      borrarAlias.run(a.id);
      n.aliasDuplicadosBorrados += 1;
    } else {
      updAlias.run(v, norm, a.id);
      n.alias += 1;
    }
  }
  const updResultado = db.prepare(`UPDATE sport_result SET source_name=?, source_club=?, revision=revision+1, revised_at=? WHERE id=?`);
  for (const r of plan.afectados.resultados) {
    const v = { s: nuevo('nombre', r.source_name)!, c: nuevo('club', r.source_club) };
    if (v.s === r.source_name && v.c === r.source_club) continue;
    updResultado.run(v.s, v.c, t, r.id);
    n.resultados += 1;
  }
  const updAsalto = db.prepare(`UPDATE sport_bout SET fencer_a_name=?, fencer_b_name=?, revision=revision+1, revised_at=? WHERE id=?`);
  for (const b of plan.afectados.asaltos) {
    const v = { a: nuevo('nombre', b.a_name), b: nuevo('nombre', b.b_name) };
    if (v.a === b.a_name && v.b === b.b_name) continue;
    updAsalto.run(v.a, v.b, t, b.id);
    n.asaltos += 1;
  }
  const updCandidato = db.prepare(`UPDATE sport_link_candidate SET source_name=? WHERE id=?`);
  for (const c of plan.afectados.candidatos) {
    const v = nuevo('nombre', c.source_name)!;
    if (v === c.source_name) continue;
    updCandidato.run(v, c.id);
    n.candidatos += 1;
  }
  return n;
}

export function informe(base: string, plan: Plan, extra: { aplicado: boolean; noTratados: InformeReparar['noTratados']; escritura: Record<string, number> | null }): InformeReparar {
  const decisiones = [...plan.decisiones.values()].sort((x, y) => (x.via ?? 'z').localeCompare(y.via ?? 'z') || x.original.localeCompare(y.original));
  const porVia = { a: 0, b: 0, c: 0 };
  for (const d of decisiones) if (d.via) porVia[d.via] += 1;
  const reparados = decisiones.filter((d) => d.propuesta);
  const suma = (k: keyof Filas, ds: Decision[]) => ds.reduce((s, d) => s + d.filas[k], 0);
  return {
    base,
    aplicado: extra.aplicado,
    generado: new Date().toISOString(),
    resumen: {
      distintos: decisiones.length,
      reparados: reparados.length,
      porVia,
      pendientes: decisiones.length - reparados.length,
      filas: Object.fromEntries((['personas', 'alias', 'resultados', 'asaltos', 'candidatos'] as const).flatMap((k) => [[`${k}Reparables`, suma(k, reparados)], [`${k}Total`, suma(k, decisiones)]])),
    },
    decisiones,
    noTratados: extra.noTratados,
    escritura: extra.escritura,
    revisionManual: plan.revisionManual,
  };
}

const celda = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csv(inf: InformeReparar): string {
  const filas = [['tipo', 'original', 'propuesta', 'via', 'evidencia', 'personas', 'alias', 'resultados', 'asaltos', 'candidatos']];
  for (const d of inf.decisiones) {
    filas.push([d.tipo, d.original, d.propuesta ?? '', d.via ?? '', d.palabras.map((p) => `${p.palabra} → ${p.reparada ?? '?'} [${p.via ?? '-'}] ${p.evidencia}`).join(' | '),
      String(d.filas.personas), String(d.filas.alias), String(d.filas.resultados), String(d.filas.asaltos), String(d.filas.candidatos)]);
  }
  filas.push([], ['revisión manual', 'original', 'palabras sin decidir', 'personas', 'pruebas']);
  for (const r of inf.revisionManual) {
    filas.push([r.tipo, r.original, r.palabrasSinDecidir.map((w) => `${w.palabra}: ${w.motivo}`).join(' | '),
      r.personas.map((p) => `${p.nombre} (${p.id})`).join(' | '),
      r.pruebas.map((p) => `${p.fecha ?? '?'} ${p.edicion ?? ''} ${[p.arma, p.sexo, p.categoria].filter(Boolean).join(' ')} [${p.fuente} ${p.clave}] ${p.url ?? ''}`.trim()).join(' | ')]);
  }
  // BOM para que Excel abra el CSV como UTF-8.
  return `\uFEFF${filas.map((f) => f.map(celda).join(';')).join('\r\n')}\r\n`;
}

/** Ensayo o escritura sobre una base ya abierta (en escritura sólo si `aplicar`). */
export function reparar(db: DatabaseSync, ruta: string, aplicar: boolean): InformeReparar {
  let escritura: Record<string, number> | null = null;
  let plan: Plan;
  if (!aplicar) plan = planificar(db);
  else {
    prepararCopiaTrabajo(db);
    restaurarGuardia(db);
    quitarGuardia(db);
    try {
      plan = planificar(db);
      db.exec('BEGIN');
      try {
        escritura = aplicarPlan(db, plan);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    } finally {
      restaurarGuardia(db);
    }
  }
  return informe(ruta, plan, { aplicado: aplicar, noTratados: noTratados(db), escritura });
}

function main(): void {
  const ruta = argumento('base', '');
  if (!ruta || !existsSync(ruta)) throw new Error('Uso: --base <copia de trabajo .sqlite> [--aplicar] [--salida <carpeta>]');
  const aplicar = bandera('aplicar');
  if (aplicar && BASES_PROTEGIDAS.has(basename(ruta).toLowerCase())) throw new Error(`${basename(ruta)} es de sólo lectura; aplica sobre una copia de trabajo`);
  const salida = argumento('salida', join(CARPETA_TRABAJO, 'reparar-caracteres'));
  const db = new DatabaseSync(ruta, aplicar ? {} : { readOnly: true });
  const inf = reparar(db, ruta, aplicar);
  const escritura = inf.escritura;
  db.close();
  mkdirSync(salida, { recursive: true });
  writeFileSync(join(salida, 'informe.json'), JSON.stringify(inf, null, 2));
  writeFileSync(join(salida, 'informe.csv'), csv(inf));
  console.log(JSON.stringify({ ...inf.resumen, noTratados: inf.noTratados, escritura, revisionManual: inf.revisionManual.map((r) => r.original), salida }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
