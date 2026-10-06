/**
 * Fechas de nacimiento publicadas y lo que se decide con ellas en `unificar-personas.ts`:
 *
 *  - FIE: `fechaNacimiento` de la ficha del tirador (`perfiles/fie-atletas-completo.jsonl`,
 *    por ID FIE). Skermo: la fecha de cada fila de la clasificación de cada prueba
 *    (`cache-skermo-competiciones/<id>.html.gz`, la misma caché que `perfiles-nacional.ts`;
 *    sin red), por licencia y nombre.
 *  - Partir (`partirPorFechaNacimiento`): las filas nacionales con fecha publicada que no
 *    son de la persona a la que están vinculadas (más de un año de diferencia con su fecha
 *    FIE o, sin FIE, dos grupos de fechas con nombres de pila distintos) salen de ella, con
 *    sus asaltos y los alias y filas por nombre que sólo pueden ser de ese tirador.
 *  - Fundir (`fundirPorFechaNacimiento`): una persona nacional y una FIE española con la
 *    misma fecha exacta, mismo género, nombres compatibles, sin coincidir en ninguna prueba
 *    y sin otra candidata con esa fecha.
 *  - Salvaguarda: dos personas cuyas fechas conocidas chocan no se funden (`fechasChocan`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { distanciaEdicion } from '../../src/lib/nombres';
import { ahora, CARPETA_TRABAJO, normalizarNombre, palabrasNombre, uuid } from './comun';
import { cabe } from './dedupe-pruebas';
import { leerClasificacionSkermo } from './perfiles-datos';

export const CACHE_SKERMO = join(CARPETA_TRABAJO, 'cache-skermo-competiciones');
export const FIE_ATLETAS = join(CARPETA_TRABAJO, 'perfiles', 'fie-atletas-completo.jsonl');
/** Más de un año entre dos fechas: no es una errata de día o mes, son dos personas. */
export const DIAS_TOLERANCIA = 366;

/** Mismas partículas que `src/lib/nombres.ts`: no cuentan como apellido ni nombre de pila. */
export const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'i', 'da', 'do', 'dos', 'san', 'van', 'von']);
export const significativasDe = (ws: readonly string[]) => ws.filter((w) => !PARTICULAS.has(w));

export type FilaSkermoFecha = { licencia: string; nombre: string; apellidos: string; fecha: string };
export type FechasNacimiento = {
  /** ID FIE → fecha. */
  fie: Map<string, string>;
  /** ID de prueba Skermo → filas de su clasificación con fecha. */
  skermo: Map<string, FilaSkermoFecha[]>;
};

const esFecha = (f: unknown): f is string => typeof f === 'string' && /^(19|20)\d\d-\d\d-\d\d$/.test(f);

export function leerFechasNacimiento(opciones: { cacheSkermo?: string; fieAtletas?: string } = {}): FechasNacimiento {
  const fechas: FechasNacimiento = { fie: new Map(), skermo: new Map() };
  const rutaFie = opciones.fieAtletas ?? FIE_ATLETAS;
  if (existsSync(rutaFie)) {
    for (const linea of readFileSync(rutaFie, 'utf8').split('\n')) {
      if (!linea.trim()) continue;
      const o = JSON.parse(linea) as { fieId?: number | string; fechaNacimiento?: string };
      if (o.fieId !== undefined && esFecha(o.fechaNacimiento)) fechas.fie.set(String(o.fieId), o.fechaNacimiento);
    }
  }
  const cache = opciones.cacheSkermo ?? CACHE_SKERMO;
  if (existsSync(cache)) {
    for (const f of readdirSync(cache)) {
      const id = f.match(/^(\d+)\.html\.gz$/)?.[1];
      if (!id) continue;
      const filas = leerClasificacionSkermo(gunzipSync(readFileSync(join(cache, f))).toString('utf8'))
        .filter((r) => esFecha(r.fechaNacimiento))
        .map((r) => ({ licencia: r.licencia, nombre: r.nombre, apellidos: r.apellidos, fecha: r.fechaNacimiento! }));
      if (filas.length > 0) fechas.skermo.set(id, filas);
    }
  }
  return fechas;
}

const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);
export const fechasEnConflicto = (a: string, b: string) => Math.abs(dia(a) - dia(b)) > DIAS_TOLERANCIA;
/** Las dos personas tienen fechas conocidas y ninguna de una casa con alguna de la otra. */
export function fechasChocan(a: Iterable<string> | undefined, b: Iterable<string> | undefined): boolean {
  const xs = [...(a ?? [])];
  const ys = [...(b ?? [])];
  return xs.length > 0 && ys.length > 0 && xs.every((x) => ys.every((y) => fechasEnConflicto(x, y)));
}

/**
 * Fila de la clasificación Skermo que publicó un puesto `skermo_rfee`: la prueba sale de la
 * URL y la licencia de la clave (`lic:CAD01100`, `lic:CAD01100#2`). Si dos filas comparten
 * licencia (Skermo repite el código en hermanas), decide el nombre.
 */
export function fechaPublicada(
  fechas: FechasNacimiento, fila: { source_url: string | null; source_fact_key: string; source_name: string },
): FilaSkermoFecha | null {
  const prueba = fila.source_url?.match(/\/competition\/(\d+)/)?.[1];
  const licencia = fila.source_fact_key.match(/^lic:([A-Z0-9]+)/i)?.[1]?.toUpperCase();
  if (!prueba || !licencia) return null;
  const filas = (fechas.skermo.get(prueba) ?? []).filter((r) => r.licencia === licencia);
  if (filas.length <= 1) return filas[0] ?? null;
  const norm = normalizarNombre(fila.source_name);
  const iguales = filas.filter((r) => normalizarNombre(`${r.nombre} ${r.apellidos}`) === norm);
  return iguales.length === 1 ? iguales[0] : null;
}

/** Fechas conocidas por persona (sin resolver fusiones): FIE por su ID, Skermo por sus puestos. */
export function nacimientosPorPersona(db: DatabaseSync, fechas: FechasNacimiento): Map<string, string[]> {
  const m = new Map<string, Set<string>>();
  const anotar = (p: string, f: string) => (m.get(p) ?? m.set(p, new Set()).get(p)!).add(f);
  for (const x of db.prepare(
    `SELECT person_id p, value v FROM sport_external_id WHERE scheme = 'fie_addr_id' AND link_status = 'CONFIRMADO' AND person_id IS NOT NULL`,
  ).iterate() as Iterable<{ p: string; v: string }>) {
    const f = fechas.fie.get(x.v.trim());
    if (f) anotar(x.p, f);
  }
  if (fechas.skermo.size > 0) {
    for (const r of db.prepare(
      `SELECT person_id p, source_url, source_fact_key, source_name FROM sport_result WHERE source = 'skermo_rfee' AND person_id IS NOT NULL`,
    ).iterate() as Iterable<{ p: string; source_url: string | null; source_fact_key: string; source_name: string }>) {
      const f = fechaPublicada(fechas, r);
      if (f) anotar(r.p, f.fecha);
    }
  }
  return new Map([...m].map(([k, v]) => [k, [...v]]));
}

// ------------------------------------------------------------------ nombres

/**
 * Nombre publicado por la FIE partido en apellidos (en mayúsculas, delante) y nombre de
 * pila: «DIAZ Maria Teresa» → [diaz] + [maria, teresa]. Null si no se distinguen.
 */
export function partirNombreFie(nombre: string): { apellidos: string[]; nombre: string[] } | null {
  const tokens = nombre.trim().split(/\s+/);
  const mayusculas = (t: string) => t === t.toUpperCase() && t !== t.toLowerCase();
  let i = 0;
  while (i < tokens.length && mayusculas(tokens[i])) i += 1;
  if (i === 0 || i === tokens.length || tokens.slice(i).some(mayusculas)) return null;
  const apellidos = palabrasNombre(tokens.slice(0, i).join(' '));
  const pila = palabrasNombre(tokens.slice(i).join(' '));
  return apellidos.length > 0 && pila.length > 0 ? { apellidos, nombre: pila } : null;
}

/** Cada palabra de `pila` es (el comienzo de) una de `nombre` o al revés: «M», «Maria T» con «Maria Teresa». */
export function pilaCompatible(pila: readonly string[], nombre: readonly string[]): boolean {
  return significativasDe(pila).every((w) => nombre.some((n) => n.startsWith(w) || w.startsWith(n)));
}

export type NombrePartido = { apellidos: string[]; nombre: string[] };
const letras = (w: string) => w.replace(/[^a-z]/g, '');
const parecidas = (a: string, b: string, prefijoMinimo: number) => {
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= prefijoMinimo && (a.startsWith(b) || b.startsWith(a))) return true;
  return Math.min(a.length, b.length) >= 5 && distanciaEdicion(a, b, 1) <= 1;
};

/**
 * Nombres compatibles cuando la fecha de nacimiento ya identifica: cada apellido FIE está
 * entre los nacionales (con una errata o un final de más, «MIRAVALLE» / «MIRAVALLES»; los
 * compuestos «LOPEZ-MINGO» cuentan como dos), al menos uno igual, y cada nombre de pila FIE
 * es (el comienzo de) uno nacional («M.jose» ~ «María José»).
 */
export function nombresCompatiblesPorFecha(fie: NombrePartido, nacional: NombrePartido): boolean {
  const fa = significativasDe(fie.apellidos).map(letras).filter(Boolean);
  const na = significativasDe(nacional.apellidos).map(letras).filter(Boolean);
  const fn = significativasDe(fie.nombre).map(letras).filter(Boolean);
  const nn = significativasDe(nacional.nombre).map(letras).filter(Boolean);
  if (fa.length === 0 || na.length === 0 || fn.length === 0 || nn.length === 0) return false;
  if (!fa.some((a) => na.includes(a))) return false;
  if (!fa.every((a) => na.some((b) => parecidas(a, b, 4)))) return false;
  return fn.every((g) => nn.some((n) => n.startsWith(g) || g.startsWith(n) || parecidas(g, n, 4)));
}

// ------------------------------------------------------------------ datos de la base

type PersonaFila = { id: string; n: string; nn: string | null; g: string | null; pais: string | null; m: string | null; a: string | null };

class Grupos {
  readonly personas = new Map<string, PersonaFila>();
  readonly raizDe = new Map<string, string>();
  readonly miembros = new Map<string, string[]>();
  readonly fieDe = new Map<string, string>();
  readonly licenciasDe = new Map<string, { lic: string; temporada: string }[]>();
  readonly alias = new Map<string, { original: string; norm: string; fuente: string }[]>();

  constructor(private readonly db: DatabaseSync) {
    for (const p of db.prepare(
      `SELECT id, display_name n, name_normalized nn, gender g, country_code pais, merged_into_person_id m, athlete_id a FROM sport_person`,
    ).all() as PersonaFila[]) this.personas.set(p.id, p);
    for (const id of this.personas.keys()) {
      let r = id;
      for (let i = 0; i < 4; i += 1) {
        const m = this.personas.get(r)?.m;
        if (!m) break;
        r = m;
      }
      this.raizDe.set(id, r);
      (this.miembros.get(r) ?? this.miembros.set(r, []).get(r)!).push(id);
    }
    for (const x of db.prepare(
      `SELECT person_id p, scheme s, value v, coalesce(scope_season, '') t FROM sport_external_id
        WHERE link_status = 'CONFIRMADO' AND person_id IS NOT NULL AND scheme IN ('fie_addr_id', 'rfee_license')`,
    ).all() as { p: string; s: string; v: string; t: string }[]) {
      if (x.s === 'fie_addr_id') this.fieDe.set(x.p, x.v.trim());
      else (this.licenciasDe.get(x.p) ?? this.licenciasDe.set(x.p, []).get(x.p)!).push({ lic: x.v.trim().toUpperCase(), temporada: x.t });
    }
    for (const a of db.prepare(`SELECT person_id p, name_original o, name_normalized n, source f FROM sport_person_alias`).all() as {
      p: string; o: string; n: string; f: string;
    }[]) (this.alias.get(a.p) ?? this.alias.set(a.p, []).get(a.p)!).push({ original: a.o, norm: a.n, fuente: a.f });
  }

  raiz(id: string): string {
    return this.raizDe.get(id) ?? id;
  }

  grupo(r: string): string[] {
    return this.miembros.get(r) ?? [r];
  }

  /** Fecha FIE de la raíz, si todos sus IDs FIE dicen la misma. */
  fechaFie(r: string, fechas: FechasNacimiento): string | null {
    const fs = new Set(this.grupo(r).flatMap((id) => {
      const v = this.fieDe.get(id);
      const f = v ? fechas.fie.get(v) : undefined;
      return f ? [f] : [];
    }));
    return fs.size === 1 ? [...fs][0] : null;
  }

  nombresFie(r: string): NombrePartido[] {
    return this.grupo(r).filter((id) => this.fieDe.has(id)).flatMap((id) => {
      const p = partirNombreFie(this.personas.get(id)!.n);
      return p ? [p] : [];
    });
  }

  conFie(r: string): boolean {
    return this.grupo(r).some((id) => this.fieDe.has(id));
  }

  /** Variantes (nombre publicado y normalizado) de un miembro. */
  variantes(id: string): { original: string; norm: string }[] {
    const p = this.personas.get(id)!;
    return [{ original: p.n, norm: p.nn ?? normalizarNombre(p.n) }, ...(this.alias.get(id) ?? [])];
  }

  /**
   * Cuelga `id` de la raíz `destino` (null: `id` pasa a ser raíz). Si `id` era raíz, su
   * grupo entero va con ella; nunca quedan cadenas.
   */
  reapuntar(id: string, destino: string | null): void {
    const t = ahora();
    const anterior = this.raiz(id);
    const esRaiz = anterior === id;
    const arrastra = esRaiz ? this.grupo(id) : [id];
    this.db.prepare(`UPDATE sport_person SET merged_into_person_id = ?, updated_at = ? WHERE id = ?`).run(destino, t, id);
    if (destino) this.db.prepare(`UPDATE sport_person SET merged_into_person_id = ?, updated_at = ? WHERE merged_into_person_id = ?`).run(destino, t, id);
    const nuevo = destino ?? id;
    if (esRaiz) this.miembros.delete(id);
    else this.miembros.set(anterior, this.grupo(anterior).filter((x) => x !== id));
    for (const x of arrastra) {
      this.raizDe.set(x, nuevo);
      if (x === id || destino) this.personas.get(x)!.m = x === nuevo ? null : nuevo;
    }
    this.miembros.set(nuevo, [...new Set([...(this.miembros.get(nuevo) ?? [nuevo]), ...arrastra])]);
  }
}

const candidato = (db: DatabaseSync, fuente: string, ref: string, nombre: string, persona: string, evidencia: string): number => {
  const t = ahora();
  return Number(db.prepare(
    `INSERT OR IGNORE INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence, decided_at, created_at)
     VALUES (?,?,?,?,?,'CONFIRMADO',?,?,?)`,
  ).run(uuid(), fuente, ref, nombre, persona, evidencia, t, t).changes);
};

function transaccion<T>(db: DatabaseSync, simular: boolean, fn: () => T): T {
  db.exec('SAVEPOINT nacimientos');
  try {
    const r = fn();
    if (simular) db.exec('ROLLBACK TO nacimientos');
    db.exec('RELEASE nacimientos');
    return r;
  } catch (e) {
    db.exec('ROLLBACK TO nacimientos');
    db.exec('RELEASE nacimientos');
    throw e;
  }
}

// ------------------------------------------------------------------ partir

export type InformeParticion = {
  /** Personas con puestos Skermo cuya fecha publicada no es la suya. */
  personasPartidas: number;
  /** Tiradores distintos sacados de ellas (uno por nombre publicado). */
  grupos: number;
  /** La misma licencia y nombre también salen con una fecha que casa: errata, no se parte. */
  omitidosErrata: number;
  aPersonaExistente: number;
  personasNuevas: number;
  miembrosMovidos: number;
  resultadosMovidos: number;
  /** Puestos que no se pudieron pasar porque el destino ya tiene puesto en esa prueba. */
  resultadosDesvinculados: number;
  aliasMovidos: number;
  ladosAsaltoMovidos: number;
  /** Puestos Skermo sin persona (licencia repetida en hermanas) vinculados por fecha y nombre. */
  sinPersonaVinculados: number;
  ejemplos: string[];
};

type FilaFechada = { id: string; comp: string; p: string; pub: FilaSkermoFecha; norm: string };

/**
 * Los puestos nacionales con fecha publicada que no pueden ser de la persona a la que
 * están vinculados salen de ella:
 *  - con fecha FIE, los que difieren en más de un año;
 *  - sin FIE, los de un grupo de fechas (a más de un año del principal) cuyo nombre de pila
 *    no es compatible con el del grupo principal (el de más puestos).
 * Por cada nombre publicado se busca la única persona con esa fecha exacta y nombre
 * compatible; si no la hay, la persona nueva es la ficha de licencia más reciente que se va
 * entera (o una creada con el nombre de Skermo). Se van con ella: los miembros cuyos puestos
 * fechados son todos de ese tirador, los miembros, alias, puestos y lados de asalto cuyo
 * nombre cabe en el suyo y no en los de la persona que queda, y los lados de asalto de las
 * pruebas cuyos puestos se fueron. Favoritos y rankings siguen en la persona que los tenía.
 */
export function partirPorFechaNacimiento(db: DatabaseSync, fechas: FechasNacimiento, opciones: { simular?: boolean } = {}): InformeParticion {
  const inf: InformeParticion = {
    personasPartidas: 0, grupos: 0, omitidosErrata: 0, aPersonaExistente: 0, personasNuevas: 0, miembrosMovidos: 0, resultadosMovidos: 0,
    resultadosDesvinculados: 0, aliasMovidos: 0, ladosAsaltoMovidos: 0, sinPersonaVinculados: 0, ejemplos: [],
  };
  if (fechas.skermo.size === 0) return inf;
  const g = new Grupos(db);
  const porRaiz = new Map<string, FilaFechada[]>();
  const sinPersona: (Omit<FilaFechada, 'p'> & { nombre: string })[] = [];
  for (const r of db.prepare(
    `SELECT id, competition_id comp, person_id p, source_url, source_fact_key, source_name FROM sport_result WHERE source = 'skermo_rfee'`,
  ).all() as { id: string; comp: string; p: string | null; source_url: string | null; source_fact_key: string; source_name: string }[]) {
    const pub = fechaPublicada(fechas, r);
    if (!pub) continue;
    const norm = normalizarNombre(`${pub.nombre} ${pub.apellidos}`);
    if (!r.p) { sinPersona.push({ id: r.id, comp: r.comp, pub, norm, nombre: r.source_name }); continue; }
    const raiz = g.raiz(r.p);
    (porRaiz.get(raiz) ?? porRaiz.set(raiz, []).get(raiz)!).push({ id: r.id, comp: r.comp, p: r.p, pub, norm });
  }

  // Personas por fecha exacta: FIE por su ficha; nacionales si todas sus fechas casan entre sí.
  const porFecha = new Map<string, Set<string>>();
  const anotarFecha = (f: string, r: string) => (porFecha.get(f) ?? porFecha.set(f, new Set()).get(f)!).add(r);
  const raicesFie = new Set([...g.fieDe.keys()].map((id) => g.raiz(id)));
  for (const r of raicesFie) {
    const f = g.fechaFie(r, fechas);
    if (f) anotarFecha(f, r);
  }
  const nombresNacionales = new Map<string, NombrePartido[]>();
  for (const [r, filas] of porRaiz) {
    if (raicesFie.has(r)) continue;
    const fs = [...new Set(filas.map((x) => x.pub.fecha))];
    if (fs.every((a) => fs.every((b) => !fechasEnConflicto(a, b)))) for (const f of fs) anotarFecha(f, r);
    nombresNacionales.set(r, filas.map((x) => ({ apellidos: palabrasNombre(x.pub.apellidos), nombre: palabrasNombre(x.pub.nombre) })));
  }
  const generoCompatible = (a: string, y: string | null) => {
    const x = g.personas.get(a)?.g;
    return !x || !y || x === 'MIXTO' || y === 'MIXTO' || x === y;
  };
  // El género de un puesto es el de su prueba, no el de la persona a la que estaba colgado
  // (hermanos con la misma licencia: «MARIO DIAZ ESCALONA» en la ficha de su hermana).
  const generoPrueba = new Map((db.prepare(`SELECT id, gender g FROM sport_competition`).all() as { id: string; g: string | null }[])
    .map((c) => [c.id, c.g]));
  const generoDe = (comps: readonly string[]): string | null => {
    const m = comps.filter((c) => generoPrueba.get(c) === 'M').length;
    const f = comps.filter((c) => generoPrueba.get(c) === 'F').length;
    return m > f ? 'M' : f > m ? 'F' : null;
  };
  /** Única persona (≠ `excluida`) con esa fecha exacta y un nombre compatible. */
  const buscarDestino = (fecha: string, nombre: NombrePartido, norm: string, excluida: string, genero: string | null): string | null => {
    const cands = [...(porFecha.get(fecha) ?? [])].filter((r) => r !== excluida && g.personas.has(r) && !g.personas.get(r)!.m
      && generoCompatible(r, genero) && (raicesFie.has(r)
        ? g.nombresFie(r).some((f) => nombresCompatiblesPorFecha(f, nombre))
        : (porRaiz.get(r) ?? []).some((x) => x.norm === norm) || (nombresNacionales.get(r) ?? []).some((n) => nombresCompatiblesPorFecha(n, nombre))));
    return cands.length === 1 ? cands[0] : null;
  };

  const tieneEnPrueba = db.prepare(
    `SELECT 1 FROM sport_result r JOIN sport_person p ON p.id = r.person_id WHERE r.competition_id = ? AND (p.id = ?2 OR p.merged_into_person_id = ?2) LIMIT 1`,
  );
  const ponPuesto = db.prepare(`UPDATE sport_result SET person_id = ? WHERE id = ?`);

  transaccion(db, !!opciones.simular, () => {
    for (const [r, filas] of [...porRaiz].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const fie = g.fechaFie(r, fechas);
      let fuera: FilaFechada[];
      if (fie) fuera = filas.filter((x) => fechasEnConflicto(x.pub.fecha, fie));
      else {
        // Grupos de fechas a más de un año entre sí.
        const grupos: FilaFechada[][] = [];
        for (const x of [...filas].sort((a, b) => (a.pub.fecha < b.pub.fecha ? -1 : 1))) {
          const ultimo = grupos[grupos.length - 1];
          if (ultimo && !fechasEnConflicto(ultimo[ultimo.length - 1].pub.fecha, x.pub.fecha)) ultimo.push(x);
          else grupos.push([x]);
        }
        if (grupos.length < 2) continue;
        const principal = [...grupos].sort((a, b) => b.length - a.length || Number(b.some((x) => x.p === r)) - Number(a.some((x) => x.p === r)))[0];
        const pilas = (gr: FilaFechada[]) => [...new Set(gr.map((x) => palabrasNombre(x.pub.nombre).join(' ')))].map((s) => s.split(' '));
        const pilaPrincipal = pilas(principal);
        fuera = grupos.filter((gr) => gr !== principal
          && pilas(gr).every((a) => pilaPrincipal.every((b) => !pilaCompatible(a, b) && !pilaCompatible(b, a)))).flat();
      }
      if (fuera.length === 0) continue;
      inf.personasPartidas += 1;
      const porNombre = new Map<string, FilaFechada[]>();
      for (const x of fuera) (porNombre.get(x.norm) ?? porNombre.set(x.norm, []).get(x.norm)!).push(x);

      for (const [norm, filasG] of porNombre) {
        const cuenta = new Map<string, number>();
        for (const x of filasG) cuenta.set(x.pub.fecha, (cuenta.get(x.pub.fecha) ?? 0) + 1);
        const fecha = [...cuenta].sort((a, b) => b[1] - a[1])[0][0];
        const pub = filasG[0].pub;
        const visible = `${pub.nombre} ${pub.apellidos}`.replace(/\s+/g, ' ').trim();
        const nombreG: NombrePartido = { apellidos: palabrasNombre(pub.apellidos), nombre: palabrasNombre(pub.nombre) };
        const palabrasG = palabrasNombre(visible);
        const enG = new Set(filasG.map((x) => x.id));
        const fechadas = new Set(filas.map((x) => x.id));
        const fechadasDe = (id: string) => filas.filter((x) => x.p === id);
        // Misma licencia y mismo nombre con otra fecha que sí casa: errata de Skermo, no otra persona.
        const firma = (x: FilaFechada) => `${x.pub.licencia}|${x.norm}`;
        const firmasG = new Set(filasG.map(firma));
        if (filas.some((x) => !enG.has(x.id) && !fuera.includes(x) && firmasG.has(firma(x)))) { inf.omitidosErrata += 1; continue; }
        inf.grupos += 1;

        // Un nombre es «de G» si cabe en el suyo y no en ningún nombre de lo que se queda. Los
        // nombres FIE siempre se quedan («CONDE Alejandro» cabe en «ZEUXIS ALEJANDRO CONDE…»).
        const deG = (ws: readonly string[]) => [...ws].sort().join(' ') === norm || cabe(ws, palabrasG);
        const grupoR = g.grupo(r).filter((id) => id !== r);
        const enteros = new Set(grupoR.filter((id) => !g.fieDe.has(id) && fechadasDe(id).length > 0 && fechadasDe(id).every((x) => enG.has(x.id))));
        const quedan = () => g.grupo(r).filter((id) => !enteros.has(id));
        let queda: string[][] = [];
        const calcularQueda = () => {
          queda = quedan().flatMap((id) => g.variantes(id)
            .filter((v) => g.fieDe.has(id) || !deG(palabrasNombre(v.original)))
            .map((v) => v.norm.split(' ')));
        };
        calcularQueda();
        const esDeG = (nombre: string) => {
          const ws = palabrasNombre(nombre);
          const n = [...ws].sort().join(' ');
          return deG(ws) && !queda.some((k) => k.join(' ') === n || cabe(ws, k));
        };
        // Fichas de la misma licencia sin puestos fechados, y personas sólo-nombre de G.
        const licenciasG = new Set([...enteros].flatMap((id) => (g.licenciasDe.get(id) ?? []).map((l) => l.lic)));
        for (const id of grupoR) {
          if (enteros.has(id) || g.fieDe.has(id) || g.personas.get(id)!.a || fechadasDe(id).length > 0) continue;
          const lics = g.licenciasDe.get(id);
          if (lics ? lics.every((l) => licenciasG.has(l.lic)) && esDeG(g.personas.get(id)!.n) : g.variantes(id).every((v) => esDeG(v.original))) {
            enteros.add(id);
          }
        }
        calcularQueda();

        const comps = new Set<string>();
        for (const id of enteros) {
          for (const c of db.prepare(`SELECT competition_id c FROM sport_result WHERE person_id = ?`).all(id) as { c: string }[]) {
            comps.add(c.c);
            inf.resultadosMovidos += 1;
          }
          inf.ladosAsaltoMovidos += Number((db.prepare(
            `SELECT count(*) n FROM sport_bout WHERE fencer_a_person_id = ?1 OR fencer_b_person_id = ?1`,
          ).get(id) as { n: number }).n);
        }
        const generoG = generoDe(filasG.map((x) => x.comp)) ?? g.personas.get(r)!.g;
        let destino = buscarDestino(fecha, nombreG, norm, r, generoG);
        const evidencia = `fecha_publicada:${fecha}${fie ? `≠fie:${fie}` : ''}`;
        const deshacer = (id: string) => db.prepare(
          `UPDATE sport_link_candidate SET status = 'RECHAZADO', evidence = coalesce(evidence, '') || ' | deshecha:' || ?
            WHERE status = 'CONFIRMADO' AND source_ref = ? AND person_id = ? AND source <> 'particion_fecha_nacimiento'`,
        ).run(evidencia, id, r);
        if (destino) inf.aPersonaExistente += 1;
        else {
          const fichas = [...enteros].filter((id) => g.licenciasDe.has(id))
            .sort((a, b) => Math.max(...g.licenciasDe.get(b)!.map((l) => Number(l.temporada.slice(0, 4)) || 0))
              - Math.max(...g.licenciasDe.get(a)!.map((l) => Number(l.temporada.slice(0, 4)) || 0)) || (a < b ? -1 : 1));
          if (fichas.length > 0) {
            destino = fichas[0];
            g.reapuntar(destino, null);
            enteros.delete(destino);
            deshacer(destino);
            inf.miembrosMovidos += 1;
          } else {
            destino = uuid();
            const t = ahora();
            db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
              .run(destino, visible, norm, generoG === 'MIXTO' ? null : generoG, t, t);
            db.prepare(`INSERT OR IGNORE INTO sport_person_alias (id, person_id, source, name_original, name_normalized, first_seen_at)
              VALUES (?,?,'skermo_rfee',?,?,?)`).run(uuid(), destino, visible, norm, t);
            g.personas.set(destino, { id: destino, n: visible, nn: norm, g: generoG, pais: null, m: null, a: null });
            g.raizDe.set(destino, destino);
            g.miembros.set(destino, [destino]);
          }
          inf.personasNuevas += 1;
          candidato(db, 'particion_fecha_nacimiento', destino, visible, destino, `${evidencia}:sale_de:${r}`);
        }
        const d = destino;
        if (inf.ejemplos.length < 40) inf.ejemplos.push(`${g.personas.get(r)!.n} → ${visible} (${fecha}) → ${g.personas.get(d)!.n}`);
        for (const id of enteros) {
          g.reapuntar(id, d);
          inf.miembrosMovidos += 1;
          candidato(db, 'particion_fecha_nacimiento', id, g.personas.get(id)!.n, d, evidencia);
          deshacer(id);
        }
        const restantes = quedan();
        const lista = restantes.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
        // Puestos: los fechados de G y los publicados con un nombre que sólo es de G.
        const puestos = db.prepare(
          `SELECT id, competition_id c, source_name n, source FROM sport_result WHERE person_id IN (${lista}) AND source <> 'fie'`,
        ).all() as { id: string; c: string; n: string; source: string }[];
        for (const p of puestos) {
          if (fechadas.has(p.id) ? !enG.has(p.id) : !esDeG(p.n)) continue;
          comps.add(p.c);
          if (tieneEnPrueba.get(p.c, d)) {
            ponPuesto.run(null, p.id);
            inf.resultadosDesvinculados += 1;
          } else {
            ponPuesto.run(d, p.id);
            inf.resultadosMovidos += 1;
          }
        }
        // Alias con un nombre que sólo es de G.
        for (const id of restantes) {
          for (const a of db.prepare(`SELECT id, source, name_original o, name_normalized n FROM sport_person_alias WHERE person_id = ?`).all(id) as {
            id: string; source: string; o: string; n: string;
          }[]) {
            if (a.source === 'fie' || !esDeG(a.o)) continue;
            db.prepare(`INSERT OR IGNORE INTO sport_person_alias (id, person_id, source, name_original, name_normalized, first_seen_at)
              VALUES (?,?,?,?,?,?)`).run(uuid(), d, a.source, a.o, a.n, ahora());
            db.prepare(`DELETE FROM sport_person_alias WHERE id = ?`).run(a.id);
            inf.aliasMovidos += 1;
          }
        }
        // Lados de asalto: en las pruebas que se fueron (si allí no queda puesto propio) o con un nombre sólo de G.
        const quedaEnPrueba = (c: string) => restantes.length > 0 && !!db.prepare(
          `SELECT 1 FROM sport_result WHERE competition_id = ? AND person_id IN (${lista}) LIMIT 1`,
        ).get(c);
        const conPuesto = new Map<string, boolean>();
        const raizDeLado = (p: string | null) => (p ? g.raiz(p) : null);
        for (const b of db.prepare(
          `SELECT id, competition_id c, fencer_a_person_id a, fencer_b_person_id b, fencer_a_name an, fencer_b_name bn FROM sport_bout
            WHERE source <> 'fie' AND (fencer_a_person_id IN (${lista}) OR fencer_b_person_id IN (${lista}))`,
        ).all() as { id: string; c: string; a: string | null; b: string | null; an: string; bn: string }[]) {
          const mover = (p: string | null, nombre: string) => {
            if (!p || !restantes.includes(p)) return false;
            if (esDeG(nombre)) return true;
            if (!comps.has(b.c)) return false;
            if (!conPuesto.has(b.c)) conPuesto.set(b.c, quedaEnPrueba(b.c));
            return !conPuesto.get(b.c);
          };
          const ma = mover(b.a, b.an) && raizDeLado(b.b) !== d;
          const mb = mover(b.b, b.bn) && raizDeLado(b.a) !== d;
          if (!ma && !mb) continue;
          db.prepare(`UPDATE sport_bout SET fencer_a_person_id = ?, fencer_b_person_id = ? WHERE id = ?`).run(ma ? d : b.a, mb ? d : b.b, b.id);
          inf.ladosAsaltoMovidos += Number(ma) + Number(mb);
        }
      }
    }

    // Puestos Skermo sin persona (dos hermanas con la misma licencia en la misma prueba).
    const porNorm = new Map<string, Set<string>>();
    for (const [id, p] of g.personas) {
      const r = g.raiz(id);
      for (const v of g.variantes(id)) (porNorm.get(v.norm) ?? porNorm.set(v.norm, new Set()).get(v.norm)!).add(r);
      if (p.nn) (porNorm.get(p.nn) ?? porNorm.set(p.nn, new Set()).get(p.nn)!).add(r);
    }
    const fechasRaiz = new Map<string, Set<string>>();
    for (const [r, filas] of porRaiz) fechasRaiz.set(g.raiz(r), new Set([...(fechasRaiz.get(g.raiz(r)) ?? []), ...filas.map((x) => x.pub.fecha)]));
    for (const x of sinPersona) {
      const nombre: NombrePartido = { apellidos: palabrasNombre(x.pub.apellidos), nombre: palabrasNombre(x.pub.nombre) };
      let d = buscarDestino(x.pub.fecha, nombre, x.norm, '', generoDe([x.comp]));
      if (!d) {
        const mismos = [...(porNorm.get(x.norm) ?? [])].map((r) => g.raiz(r)).filter((r) => {
          const f = g.fechaFie(r, fechas);
          return !fechasChocan(f ? [f] : fechasRaiz.get(r), [x.pub.fecha]);
        });
        d = new Set(mismos).size === 1 ? mismos[0] : null;
      }
      if (!d || tieneEnPrueba.get(x.comp, d)) continue;
      ponPuesto.run(d, x.id);
      inf.sinPersonaVinculados += 1;
      candidato(db, 'particion_fecha_nacimiento', `resultado:${x.id}`, x.nombre, d, `fecha_publicada:${x.pub.fecha}:nombre`);
    }
  });
  return inf;
}

// ------------------------------------------------------------------ fundir

export type InformeFusionFecha = { candidatas: number; fusiones: number; rechazos: Record<string, number>; ejemplos: string[] };

/**
 * Persona nacional (sin ID FIE) y persona FIE española con la misma fecha de nacimiento
 * exacta (ficha FIE y clasificación Skermo), mismo género, nombres compatibles
 * (`nombresCompatiblesPorFecha`), sin coincidir en ninguna prueba y sin otra candidata con
 * esa fecha en ninguno de los dos sentidos: la nacional se funde en la FIE.
 */
export function fundirPorFechaNacimiento(db: DatabaseSync, fechas: FechasNacimiento, opciones: { simular?: boolean } = {}): InformeFusionFecha {
  const inf: InformeFusionFecha = { candidatas: 0, fusiones: 0, rechazos: {}, ejemplos: [] };
  if (fechas.skermo.size === 0 || fechas.fie.size === 0) return inf;
  const g = new Grupos(db);
  const nacionales = new Map<string, { fechas: Set<string>; nombres: NombrePartido[] }>();
  for (const r of db.prepare(
    `SELECT person_id p, source_url, source_fact_key, source_name FROM sport_result WHERE source = 'skermo_rfee' AND person_id IS NOT NULL`,
  ).all() as { p: string; source_url: string | null; source_fact_key: string; source_name: string }[]) {
    const pub = fechaPublicada(fechas, r);
    if (!pub) continue;
    const raiz = g.raiz(r.p);
    if (g.conFie(raiz)) continue;
    const x = nacionales.get(raiz) ?? nacionales.set(raiz, { fechas: new Set(), nombres: [] }).get(raiz)!;
    x.fechas.add(pub.fecha);
    x.nombres.push({ apellidos: palabrasNombre(pub.apellidos), nombre: palabrasNombre(pub.nombre) });
  }
  const nacPorFecha = new Map<string, string[]>();
  for (const [r, x] of nacionales) {
    const fs = [...x.fechas];
    if (fs.some((a) => fs.some((b) => fechasEnConflicto(a, b)))) continue;
    for (const f of fs) (nacPorFecha.get(f) ?? nacPorFecha.set(f, []).get(f)!).push(r);
  }
  const fiePorFecha = new Map<string, string[]>();
  for (const r of new Set([...g.fieDe.keys()].map((id) => g.raiz(id)))) {
    const p = g.personas.get(r)!;
    const f = g.fechaFie(r, fechas);
    if (!f || p.pais !== 'ESP' || (p.g !== 'M' && p.g !== 'F')) continue;
    (fiePorFecha.get(f) ?? fiePorFecha.set(f, []).get(f)!).push(r);
  }
  const compatibles = (fie: string, nac: string) => g.personas.get(fie)!.g === g.personas.get(nac)!.g
    && g.nombresFie(fie).some((f) => nacionales.get(nac)!.nombres.some((n) => nombresCompatiblesPorFecha(f, n)));
  const pruebas = (r: string) => {
    const ids = g.grupo(r).map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
    return `SELECT competition_id FROM sport_result WHERE person_id IN (${ids})
      UNION SELECT competition_id FROM sport_bout WHERE fencer_a_person_id IN (${ids}) OR fencer_b_person_id IN (${ids})`;
  };
  const rechazar = (m: string) => { inf.rechazos[m] = (inf.rechazos[m] ?? 0) + 1; };
  transaccion(db, !!opciones.simular, () => {
    for (const [fecha, fies] of [...fiePorFecha].sort(([a], [b]) => (a < b ? -1 : 1))) {
      for (const f of fies) {
        const cands = (nacPorFecha.get(fecha) ?? []).filter((n) => compatibles(f, n));
        if (cands.length === 0) continue;
        inf.candidatas += 1;
        if (cands.length > 1) { rechazar('varias_nacionales'); continue; }
        const [n] = cands;
        if (fies.filter((otra) => compatibles(otra, n)).length > 1) { rechazar('varias_fie'); continue; }
        const pf = g.personas.get(f)!;
        const pn = g.personas.get(n)!;
        if (g.grupo(f).some((id) => g.personas.get(id)!.a) && g.grupo(n).some((id) => g.personas.get(id)!.a)) { rechazar('dos_fichas'); continue; }
        // Cada lado entre paréntesis: UNION e INTERSECT tienen la misma precedencia.
        const comun = `SELECT competition_id FROM (${pruebas(f)}) INTERSECT SELECT competition_id FROM (${pruebas(n)})`;
        if (db.prepare(`SELECT 1 FROM (${comun}) LIMIT 1`).get()) { rechazar('coinciden'); continue; }
        g.reapuntar(n, f);
        candidato(db, 'fusion_fecha_nacimiento', n, pn.n, f, `misma_fecha_nacimiento:${fecha}`);
        inf.fusiones += 1;
        if (inf.ejemplos.length < 40) inf.ejemplos.push(`${pn.n} → ${pf.n} (${fecha})`);
      }
    }
  });
  return inf;
}
