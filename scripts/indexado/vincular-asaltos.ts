/**
 * Vincula a personas los lados de asaltos que la unificación dejó sin persona
 * (o colgados de una persona creada sólo por un nombre truncado) y funde
 * duplicados con evidencia fuerte. Se ejecuta DESPUÉS de `unificar-personas.ts`
 * sobre la copia de trabajo (idempotente):
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/vincular-asaltos.ts \
 *     --db <copia.sqlite> [--informe <vinculo-informe.json>] [--revision <vinculo-revision.json>]
 *     [--externas <propuestas.jsonl>] [--simular]
 *
 * Pasos, en este orden:
 *  1) Licencia Engarde (`lic:N-…`): una referencia de licencia cuyos puestos y
 *     asaltos vinculados apuntan a una sola persona raíz vincula los demás lados
 *     y puestos Engarde con esa referencia.
 *  2) Misma prueba: el nombre publicado en el asalto se compara con los puestos
 *     de su prueba (palabras iguales, subconjunto o la última palabra truncada,
 *     «RAMIREZ LARENA Al» ↔ «RAMIREZ LARENA Alejandro»), también con los otros
 *     nombres conocidos de la persona del puesto. Sólo se vincula si un único
 *     puesto casa, ningún otro tirador de la prueba podría ser ese puesto, y la
 *     persona no acaba dos veces en la misma ronda. Un lado sin persona hereda la
 *     de la misma referencia en otro asalto de la prueba.
 *  2b) Continuidad del cuadro (`dedupe-cuadro.ts`, se desactiva con `cuadro: false`): el
 *     ganador de una ronda de directa sigue en la siguiente, quien entra en la directa
 *     viene de la poule y quien tira tiene puesto. Cada tirador es una cadena; sus lados y
 *     puestos vacíos reciben la persona de la cadena, y si la cadena lleva dos personas, lo
 *     de la creada por nombre (o la que no tiene el puesto) pasa a la otra. Si así se queda
 *     sin hechos y tiene identificador, se funde en ella (`fusion_cuadro`) salvo género,
 *     fechas de nacimiento, dos IDs FIE, dos fichas o dos licencias a la vez; una creada por
 *     nombre se queda vacía (sin pasar su nombre a nadie); si conserva hechos fuera, queda
 *     como propuesta `cuadro_misma_persona`.
 *  3) Fusiones automáticas (reversibles, `merged_into_person_id`): misma licencia
 *     Engarde con nombres compatibles, o el mismo nombre de 3+ palabras, mismo
 *     género y país, sin coincidir nunca en una prueba y sin dos licencias RFEE
 *     en la misma temporada. Nunca si sus fechas de nacimiento conocidas (ficha FIE,
 *     clasificación Skermo; ver `dedupe-nacimientos.ts`) difieren en más de un año: queda
 *     como propuesta `fecha_nacimiento_distinta`.
 *  4) Propuestas para revisión (no se aplican): apellido FIE contenido en un
 *     nombre nacional, persona de nombre truncado con un único destino, misma
 *     licencia Engarde con nombres distintos.
 *  5) Propuestas externas (`--externas`, p. ej. misma fecha de nacimiento FIE/RFEE):
 *     se validan contra género, coincidencias y nombre, y se marcan válidas o
 *     rechazadas; tampoco se aplican.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { distanciaEdicion } from '../../src/lib/nombres';
import {
  ahora,
  argumento,
  bandera,
  CARPETA_TRABAJO,
  NUEVO_POR_DEFECTO,
  palabrasNombre,
  prepararCopiaTrabajo,
  quitarGuardia,
  restaurarGuardia,
  uuid,
} from './comun';
import { desvincularPuestosConjuntas } from './dedupe-conjuntas';
import { type Arista, type AsaltoCuadro, planCuadro } from './dedupe-cuadro';
import { CACHE_SKERMO, FIE_ATLETAS, fechasChocan, leerFechasNacimiento, nacimientosPorPersona } from './dedupe-nacimientos';
import { leerNacimientosEfc, medir, type Medida } from './unificar-personas';
import { motivoNoUnir } from './nombres-union';

/** Mismas partículas que `src/lib/nombres.ts`: no cuentan como palabra que identifica. */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'i', 'da', 'do', 'dos', 'san', 'van', 'von']);
/**
 * Fuentes cuyas personas nacen sólo de un nombre publicado (las de `unificar-personas.ts`). Las
 * personas de licencia EFC llevan el alias `efc_licencia`, que no está aquí: no son «sólo nombre».
 */
const FUENTES_NOMBRE = ['rfee_pdf', 'engarde', 'efc'];
const FUENTES_NOMBRE_SQL = FUENTES_NOMBRE.map((f) => `'${f}'`).join(', ');

export type Nivel = 'exacto' | 'subconjunto' | 'prefijo';
/** Cómo se decidió un vínculo en la prueba: por nombre o por la misma referencia ya vinculada. */
type Via = Nivel | 'referencia';
const ORDEN: Record<Nivel, number> = { exacto: 3, subconjunto: 2, prefijo: 1 };

export type Coincidencia = { nivel: Nivel; /** Palabras significativas emparejadas. */ fuerza: number };

const significativas = (ws: readonly string[]) => ws.filter((w) => !PARTICULAS.has(w));

/**
 * Cómo casan dos nombres ya partidos en palabras (sin acentos, minúsculas).
 * - exacto: las mismas palabras en cualquier orden («ROMERO ORTIN» = «ORTIN ROMERO»).
 * - subconjunto: todas las palabras del corto están en el largo, con 2+ significativas
 *   («ZABALA GUTIERREZ» ⊂ «ZABALA GUTIERREZ Juan»).
 * - prefijo: igual que subconjunto pero UNA palabra del corto es el comienzo (2+ letras)
 *   de una del largo o al revés, y al menos 2 significativas casan enteras
 *   («RAMIREZ LARENA Al», «RAMIREZ LARENA Aleja»).
 */
export function coincidencia(a: readonly string[], b: readonly string[]): Coincidencia | null {
  if (a.length === 0 || b.length === 0) return null;
  const sa = [...a].sort().join(' ');
  const sb = [...b].sort().join(' ');
  if (sa === sb) return { nivel: 'exacto', fuerza: significativas(a).length };
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  const libres = [...largo];
  const pendientes: string[] = [];
  let enteras = 0;
  for (const w of corto) {
    const i = libres.indexOf(w);
    if (i >= 0) {
      libres.splice(i, 1);
      if (!PARTICULAS.has(w)) enteras += 1;
    } else pendientes.push(w);
  }
  if (enteras < 2) return null;
  if (pendientes.length === 0) return { nivel: 'subconjunto', fuerza: enteras };
  if (pendientes.length > 1) return null;
  const w = pendientes[0];
  if (PARTICULAS.has(w)) return null;
  const truncada = libres.some(
    (x) => !PARTICULAS.has(x) && Math.min(x.length, w.length) >= 2 && x !== w && (x.startsWith(w) || w.startsWith(x)),
  );
  return truncada ? { nivel: 'prefijo', fuerza: enteras + 1 } : null;
}

/** Nombres que sólo pueden ser de la misma persona salvo una errata («ALMANCHA» / «ALMARCHA»). */
export function nombresCompatibles(a: readonly string[], b: readonly string[]): boolean {
  if (coincidencia(a, b)) return true;
  if (a.length !== b.length) return false;
  const libres = [...b];
  const sobran: string[] = [];
  for (const w of a) {
    const i = libres.indexOf(w);
    if (i >= 0) libres.splice(i, 1);
    else sobran.push(w);
  }
  if (sobran.length !== 1 || significativas(a).length - 1 < 2) return false;
  const [x, y] = [sobran[0], libres[0]];
  return Math.min(x.length, y.length) >= 4 && distanciaEdicion(x, y, 2) <= 2;
}

/**
 * Un puesto de la prueba. `variantes`: otros nombres conocidos de su persona (alias
 * de otras fuentes), para que «NAVARRO Araceli» case exacto con el puesto Skermo
 * «ARACELI NAVARRO LASO» cuya persona ya se llama así en la FIE.
 */
export type Puesto = { id: string; palabras: string[]; raiz: string | null; variantes?: readonly string[][] };

function mejorCoincidencia(palabras: readonly string[], p: Puesto): Coincidencia | null {
  let mejor: Coincidencia | null = null;
  for (const v of [p.palabras, ...(p.variantes ?? [])]) {
    const c = coincidencia(palabras, v);
    if (c && (!mejor || ORDEN[c.nivel] > ORDEN[mejor.nivel] || (c.nivel === mejor.nivel && c.fuerza > mejor.fuerza))) mejor = c;
  }
  return mejor;
}
export type Eleccion =
  | { tipo: 'unico'; puesto: Puesto; nivel: Nivel; fuerza: number }
  | { tipo: 'ambiguo'; candidatos: number }
  | { tipo: 'ninguno' };

/**
 * El puesto de la prueba que corresponde a un nombre de asalto. Se queda el mejor
 * nivel; si en él hay dos personas distintas es ambiguo. Un exacto débil (2
 * palabras) con otros candidatos parciales también es ambiguo: «GARCIA LOPEZ» puede
 * ser el truncado de «GARCIA LOPEZ Ana».
 */
export function elegirPuesto(palabras: readonly string[], puestos: readonly Puesto[]): Eleccion {
  const casan: { p: Puesto; c: Coincidencia }[] = [];
  for (const p of puestos) {
    const c = mejorCoincidencia(palabras, p);
    if (c) casan.push({ p, c });
  }
  if (casan.length === 0) return { tipo: 'ninguno' };
  const mejor = Math.max(...casan.map((x) => ORDEN[x.c.nivel]));
  const arriba = casan.filter((x) => ORDEN[x.c.nivel] === mejor);
  const claves = new Set(arriba.map((x) => x.p.raiz ?? `puesto:${x.p.id}`));
  if (claves.size > 1) return { tipo: 'ambiguo', candidatos: claves.size };
  const [{ p, c }] = arriba;
  const otras = new Set(casan.map((x) => x.p.raiz ?? `puesto:${x.p.id}`));
  if (otras.size > 1 && !(c.nivel === 'exacto' && c.fuerza >= 3)) return { tipo: 'ambiguo', candidatos: otras.size };
  return { tipo: 'unico', puesto: p, nivel: c.nivel, fuerza: c.fuerza };
}

type AsaltoFila = {
  id: string; comp: string; fase: string; ronda: string;
  ar: string; an: string; ap: string | null; br: string; bn: string; bp: string | null;
};

export type InformeVinculo = {
  antes: Medida;
  despues: Medida;
  licencias: { refs: number; refsUnaPersona: number; refsVariasPersonas: number; ladosVinculados: number; puestosVinculados: number };
  prueba: {
    pruebas: number;
    nombres: number;
    /** Referencias de la prueba vinculadas, por la vía que lo decidió. */
    vinculados: Record<Via, number>;
    ladosVinculados: number;
    ladosRevinculados: number;
    ambiguos: number;
    sinPuesto: number;
    puestoSinPersona: number;
    /** Otro nombre de la prueba podría ser el mismo puesto: no se elige entre ellos. */
    descartadosHomonimo: number;
    descartadosRonda: number;
    /** Muestra de vínculos por nombre para revisar a mano: «nombre del asalto → puesto». */
    ejemplos: Partial<Record<Nivel, string[]>>;
  };
  fusiones: { licenciaEngarde: number; nombreIdentico: number; omitidasAtleta: number };
  /** Continuidad del cuadro (`dedupe-cuadro.ts`). */
  cuadro: InformeCuadro;
  propuestas: Record<string, number>;
  /** Puestos de pruebas conjuntas que algún paso vinculó y vuelven a quedar sin persona. */
  puestosConjuntasDesvinculados: number;
  asaltosAmbosAntes: number;
  asaltosAmbosDespues: number;
  segundos: number;
};

export type InformeCuadro = {
  pruebas: number;
  aristas: Record<Arista, number>;
  ladosVinculados: number;
  ladosRevinculados: number;
  puestosVinculados: number;
  /** Lados que dejarían a la misma persona a los dos lados de un asalto: no se cambian. */
  omitidosMismoAsalto: number;
  /** Cadenas con dos personas (lados de la otra pasados a la del puesto) y sin puesto que decida. */
  conflictos: number;
  sinPrincipal: number;
  /** La persona de más quedó sin hechos: se funde en la de su cadena (o se propone si una salvaguarda lo impide). */
  fusiones: number;
  fusionesOmitidas: Record<string, number>;
  /** Personas creadas por un nombre que se quedaron sin hechos: no se funden (ver `fundirCuadro`). */
  vaciasPorNombre: number;
  ejemplos: string[];
};

/** Fusión aplicada (`aplicada`) o propuesta para revisión. */
export type Propuesta = {
  tipo:
    | 'licencia_engarde' | 'nombre_identico'
    | 'apellido_fie' | 'nombre_truncado' | 'licencia_engarde_nombre_distinto' | 'nombre_identico_con_coincidencia'
    | 'nombre_identico_orden' | 'nombre_identico_efc_sin_anio'
    | 'fecha_nacimiento_distinta'
    | 'cuadro' | 'cuadro_misma_persona'
    | 'externa_valida' | 'externa_rechazada';
  aplicada: boolean;
  origen: { id: string; nombre: string; puestos: number; asaltos: number };
  destino: { id: string; nombre: string; puestos: number; asaltos: number };
  evidencia: string;
};

type Raiz = {
  id: string; nombre: string; genero: string | null; pais: string | null; atleta: string | null;
  variantes: Set<string>; fie: boolean; licencias: Map<string, Set<string>>;
  /** Pruebas con puesto propio, y rondas (prueba, fase, ronda) en las que tiró. */
  compsPuesto: Set<number>; rondas: Set<number>;
  puestos: number; asaltos: number;
  /** Sin ID FIE, licencia ni ficha, y todos sus alias de fuentes por nombre. */
  soloNombre: boolean;
  /** Fechas de nacimiento conocidas (FIE, Skermo): dos raíces cuyas fechas chocan no se funden. */
  fechas: Set<string>;
  /** Nombres tal cual los publicó cada fuente (nombre visible y alias), con el orden de los apellidos. */
  publicados: { nombre: string; fuente: string | null }[];
  /** Persona de licencia EFC (alias `efc_licencia`) y años de nacimiento que publica la EFC para sus licencias. */
  efc: boolean;
  aniosEfc: Set<number>;
};

class Vinculador {
  readonly raizDe = new Map<string, string>();
  private readonly st = new Map<string, StatementSync>();
  constructor(
    private readonly db: DatabaseSync,
    private readonly nacimientos?: ReadonlyMap<string, readonly string[]>,
    /** Licencia EFC → año de nacimiento (`unificar-personas.ts#leerNacimientosEfc`). */
    private readonly nacimientosEfc?: ReadonlyMap<string, number>,
  ) {
    this.cargarRaices();
  }

  private q(sql: string): StatementSync {
    let s = this.st.get(sql);
    if (!s) this.st.set(sql, (s = this.db.prepare(sql)));
    return s;
  }

  cargarRaices(): void {
    this.raizDe.clear();
    const filas = this.db.prepare('SELECT id, merged_into_person_id m FROM sport_person').all() as { id: string; m: string | null }[];
    const destino = new Map(filas.map((f) => [f.id, f.m]));
    for (const f of filas) {
      let actual = f.id;
      for (let i = 0; i < 4; i += 1) {
        const m = destino.get(actual);
        if (!m) break;
        actual = m;
      }
      this.raizDe.set(f.id, actual);
    }
  }

  raiz(id: string | null): string | null {
    return id ? this.raizDe.get(id) ?? id : null;
  }

  pasoLicencias(inf: InformeVinculo['licencias'], conflictos: Map<string, Set<string>>): void {
    const porRef = new Map<string, Set<string>>();
    const anotar = (ref: string, persona: string | null) => {
      const s = porRef.get(ref) ?? porRef.set(ref, new Set()).get(ref)!;
      const r = this.raiz(persona);
      if (r) s.add(r);
    };
    for (const b of this.db.prepare(
      `SELECT fencer_a_ref a, fencer_a_person_id ap, fencer_b_ref b, fencer_b_person_id bp FROM sport_bout
        WHERE source='engarde' AND (fencer_a_ref LIKE 'lic:%' OR fencer_b_ref LIKE 'lic:%')`,
    ).iterate() as Iterable<{ a: string; ap: string | null; b: string; bp: string | null }>) {
      if (b.a.startsWith('lic:')) anotar(b.a, b.ap);
      if (b.b.startsWith('lic:')) anotar(b.b, b.bp);
    }
    for (const r of this.db.prepare(
      `SELECT source_fact_key k, person_id p FROM sport_result WHERE source='engarde' AND source_fact_key LIKE 'lic:%'`,
    ).iterate() as Iterable<{ k: string; p: string | null }>) anotar(r.k, r.p);
    inf.refs = porRef.size;
    const mapa = new Map<string, string>();
    for (const [ref, raices] of porRef) {
      if (raices.size === 1) {
        inf.refsUnaPersona += 1;
        mapa.set(ref, [...raices][0]);
      } else if (raices.size > 1) {
        inf.refsVariasPersonas += 1;
        conflictos.set(ref, raices);
      }
    }
    if (mapa.size === 0) return;
    // Una persona no puede tener dos puestos en la misma prueba ni enfrentarse a sí misma.
    const yaEnPrueba = this.q(
      `SELECT 1 FROM sport_result r JOIN sport_person p ON p.id = r.person_id
        WHERE r.competition_id = ? AND (p.id = ? OR p.merged_into_person_id = ?) LIMIT 1`,
    );
    const puestos = this.db.prepare(
      `SELECT id, competition_id c, source_fact_key k FROM sport_result
        WHERE source='engarde' AND person_id IS NULL AND source_fact_key LIKE 'lic:%'`,
    ).all() as { id: string; c: string; k: string }[];
    const ponPuesto = this.q('UPDATE sport_result SET person_id = ? WHERE id = ? AND person_id IS NULL');
    for (const p of puestos) {
      const r = mapa.get(p.k);
      if (!r || yaEnPrueba.get(p.c, r, r)) continue;
      inf.puestosVinculados += Number(ponPuesto.run(r, p.id).changes);
    }
    const lados = this.db.prepare(
      `SELECT id, fencer_a_ref a, fencer_a_person_id ap, fencer_b_ref b, fencer_b_person_id bp FROM sport_bout
        WHERE source='engarde' AND ((fencer_a_person_id IS NULL AND fencer_a_ref LIKE 'lic:%')
           OR (fencer_b_person_id IS NULL AND fencer_b_ref LIKE 'lic:%'))`,
    ).all() as { id: string; a: string; ap: string | null; b: string; bp: string | null }[];
    const pon = this.q(
      `UPDATE sport_bout SET fencer_a_person_id = coalesce(fencer_a_person_id, ?), fencer_b_person_id = coalesce(fencer_b_person_id, ?)
        WHERE id = ?`,
    );
    for (const l of lados) {
      const na = l.ap ? null : mapa.get(l.a) ?? null;
      const nb = l.bp ? null : mapa.get(l.b) ?? null;
      const ra = na ?? this.raiz(l.ap);
      const rb = nb ?? this.raiz(l.bp);
      if (ra && rb && ra === rb) continue;
      if (!na && !nb) continue;
      pon.run(na, nb, l.id);
      inf.ladosVinculados += (na ? 1 : 0) + (nb ? 1 : 0);
    }
  }

  /**
   * Personas (con todo su grupo) que sólo existen por un nombre publicado: sin ID
   * FIE, licencia ni ficha, y con alias sólo de fuentes por nombre. Un lado de
   * asalto colgado de una de ellas se puede reasignar al puesto de su prueba
   * («RAMIREZ LARENA Al», «TORREGO ALVAREZ», que el PDF trunca).
   */
  soloNombre(): Set<string> {
    const conId = new Set<string>();
    const conAlias = new Set<string>();
    for (const x of this.db.prepare('SELECT person_id p FROM sport_external_id WHERE person_id IS NOT NULL').iterate() as Iterable<{ p: string }>) conId.add(this.raiz(x.p)!);
    for (const p of this.db.prepare('SELECT id FROM sport_person WHERE athlete_id IS NOT NULL').iterate() as Iterable<{ id: string }>) conId.add(this.raiz(p.id)!);
    for (const a of this.db.prepare('SELECT person_id p, source s FROM sport_person_alias').iterate() as Iterable<{ p: string; s: string }>) {
      const r = this.raiz(a.p)!;
      if (FUENTES_NOMBRE.includes(a.s)) conAlias.add(r);
      else conId.add(r);
    }
    const ids = new Set<string>();
    for (const [id, r] of this.raizDe) if (conAlias.has(r) && !conId.has(r)) ids.add(id);
    return ids;
  }

  pasoPrueba(inf: InformeVinculo['prueba']): void {
    const deNombre = this.soloNombre();
    const variantes = new Map<string, string[][]>();
    const anotar = (id: string, n: string | null) => {
      if (!n) return;
      const r = this.raiz(id)!;
      const l = variantes.get(r) ?? variantes.set(r, []).get(r)!;
      if (!l.some((v) => v.join(' ') === n)) l.push(n.split(' '));
    };
    for (const p of this.db.prepare('SELECT id, name_normalized n FROM sport_person').iterate() as Iterable<{ id: string; n: string | null }>) anotar(p.id, p.n);
    for (const a of this.db.prepare('SELECT person_id id, name_normalized n FROM sport_person_alias').iterate() as Iterable<{ id: string; n: string | null }>) anotar(a.id, a.n);
    const comps = new Set<string>();
    for (const b of this.db.prepare(
      `SELECT b.competition_id c, b.fencer_a_person_id a, b.fencer_b_person_id b FROM sport_bout b`,
    ).iterate() as Iterable<{ c: string; a: string | null; b: string | null }>) {
      if (!b.a || !b.b || deNombre.has(b.a) || deNombre.has(b.b)) comps.add(b.c);
    }
    const individual = this.q(`SELECT format FROM sport_competition WHERE id = ?`);
    const asaltosDe = this.q(
      `SELECT id, competition_id comp, phase fase, round_key ronda, fencer_a_ref ar, fencer_a_name an, fencer_a_person_id ap,
              fencer_b_ref br, fencer_b_name bn, fencer_b_person_id bp
         FROM sport_bout WHERE competition_id = ?`,
    );
    const puestosDe = this.q(`SELECT id, source_name n, person_id p FROM sport_result WHERE competition_id = ?`);
    const pon = this.q(
      `UPDATE sport_bout SET fencer_a_person_id = coalesce(?, fencer_a_person_id),
                             fencer_b_person_id = coalesce(?, fencer_b_person_id) WHERE id = ?`,
    );
    for (const comp of comps) {
      if ((individual.get(comp) as { format: string } | undefined)?.format !== 'INDIVIDUAL') continue;
      const asaltos = asaltosDe.all(comp) as AsaltoFila[];
      const puestos: Puesto[] = (puestosDe.all(comp) as { id: string; n: string; p: string | null }[])
        .map((r) => {
          const raiz = this.raiz(r.p);
          return { id: r.id, palabras: palabrasNombre(r.n), raiz, variantes: raiz ? variantes.get(raiz) : undefined };
        })
        .filter((p) => p.palabras.length > 0);
      if (puestos.length === 0) continue;
      inf.pruebas += 1;

      // Por referencia: nombre publicado, personas reales ya vinculadas y si le falta algún lado.
      const nombreDe = new Map<string, string>();
      const reales = new Map<string, Set<string>>();
      const porNombre = new Map<string, Set<string>>();
      const pendiente = new Set<string>();
      const conNulo = new Set<string>();
      for (const b of asaltos) {
        for (const [ref, nombre, p] of [[b.ar, b.an, b.ap], [b.br, b.bn, b.bp]] as const) {
          nombreDe.set(ref, nombre);
          const s = reales.get(ref) ?? reales.set(ref, new Set()).get(ref)!;
          if (p && !deNombre.has(p)) s.add(this.raiz(p)!);
          else {
            pendiente.add(ref);
            if (p) (porNombre.get(ref) ?? porNombre.set(ref, new Set()).get(ref)!).add(this.raiz(p)!);
            else conNulo.add(ref);
          }
        }
      }
      /** El vínculo no cambia nada: todos los lados ya son de esa persona. */
      const yaEs = (ref: string, raiz: string) => !conNulo.has(ref) && porNombre.get(ref)?.size === 1 && porNombre.get(ref)!.has(raiz);
      const elecciones = new Map<string, Eleccion>();
      for (const [ref, nombre] of nombreDe) elecciones.set(ref, elegirPuesto(palabrasNombre(nombre), puestos));
      // Todos los que tiraron están entre los nombres de asalto, tengan puesto o no (la
      // clasificación Skermo omite a los extranjeros). Si otro nombre de la prueba casa con
      // el nuestro pero no con el puesto elegido («ZABALA GUTIERREZ Pedro» frente a
      // «… Juan»), «ZABALA GUTIERREZ» puede ser cualquiera de los dos.
      const homonimo = (ref: string, puesto: Puesto) => {
        const nombre = nombreDe.get(ref)!;
        const ws = palabrasNombre(nombre);
        const delPuesto = [puesto.palabras, ...(puesto.variantes ?? [])];
        for (const [otra, n2] of nombreDe) {
          if (otra === ref || n2 === nombre) continue;
          const w2 = palabrasNombre(n2);
          if (coincidencia(ws, w2) && !delPuesto.some((v) => coincidencia(w2, v))) return true;
        }
        return false;
      };

      const nueva = new Map<string, { raiz: string; via: Via }>();
      for (const ref of pendiente) {
        const ya = reales.get(ref)!;
        // La misma referencia en la misma prueba es el mismo tirador: hereda la persona
        // de sus otros asaltos (lados que la unificación dejó a medias).
        if (ya.size === 1) {
          nueva.set(ref, { raiz: [...ya][0], via: 'referencia' });
          continue;
        }
        if (ya.size > 1) continue;
        const e = elecciones.get(ref)!;
        inf.nombres += 1;
        if (e.tipo === 'ninguno') { inf.sinPuesto += 1; continue; }
        if (e.tipo === 'ambiguo') { inf.ambiguos += 1; continue; }
        if (!e.puesto.raiz) { inf.puestoSinPersona += 1; continue; }
        if (yaEs(ref, e.puesto.raiz)) continue;
        if (homonimo(ref, e.puesto)) { inf.descartadosHomonimo += 1; continue; }
        nueva.set(ref, { raiz: e.puesto.raiz, via: e.nivel });
        const ej = (inf.ejemplos[e.nivel] ??= []);
        if (ej.length < 25) ej.push(`${nombreDe.get(ref)} → ${e.puesto.palabras.join(' ')}`);
      }
      if (nueva.size === 0) continue;

      // Nadie aparece dos veces en una ronda: si dos referencias de la misma ronda acaban
      // en la misma persona, se descartan los vínculos nuevos de esas referencias.
      const raizRef = (ref: string) => {
        const n = nueva.get(ref)?.raiz;
        if (n) return n;
        const ya = reales.get(ref);
        if (ya && ya.size === 1) return [...ya][0];
        const nombre = porNombre.get(ref);
        return nombre && nombre.size === 1 ? [...nombre][0] : null;
      };
      const descartar = new Set<string>();
      const porRonda = new Map<string, Set<string>>();
      for (const b of asaltos) {
        const k = `${b.fase}|${b.ronda}`;
        const s = porRonda.get(k) ?? porRonda.set(k, new Set()).get(k)!;
        s.add(b.ar);
        s.add(b.br);
      }
      for (const refs of porRonda.values()) {
        const vistos = new Map<string, string[]>();
        for (const ref of refs) {
          const r = raizRef(ref);
          if (r) vistos.set(r, [...(vistos.get(r) ?? []), ref]);
        }
        for (const lista of vistos.values()) {
          if (lista.length > 1) for (const ref of lista) if (nueva.has(ref)) descartar.add(ref);
        }
      }
      for (const ref of descartar) {
        nueva.delete(ref);
        inf.descartadosRonda += 1;
      }
      for (const n of nueva.values()) inf.vinculados[n.via] += 1;
      for (const b of asaltos) {
        const na = nueva.get(b.ar)?.raiz ?? null;
        const nb = nueva.get(b.br)?.raiz ?? null;
        if (!na && !nb) continue;
        const ra = na ?? this.raiz(b.ap);
        const rb = nb ?? this.raiz(b.bp);
        if (ra && rb && ra === rb) continue;
        // Sólo se reescribe un lado vacío o de una persona por nombre; uno con persona real no se toca.
        const cambia = (nueva: string | null, previa: string | null) =>
          nueva && (!previa || (deNombre.has(previa) && this.raiz(previa) !== nueva)) ? nueva : null;
        const fa = cambia(na, b.ap);
        const fb = cambia(nb, b.bp);
        if (!fa && !fb) continue;
        pon.run(fa, fb, b.id);
        for (const [n, previa] of [[fa, b.ap], [fb, b.bp]] as const) {
          if (!n) continue;
          if (previa) inf.ladosRevinculados += 1;
          else inf.ladosVinculados += 1;
        }
      }
    }
  }

  /**
   * Continuidad del cuadro en cada prueba individual (`dedupe-cuadro.ts`): los lados y
   * puestos vacíos reciben la persona de su cadena, y en una cadena con dos personas los
   * lados de la que no tiene el puesto pasan a la que lo tiene. Devuelve esos pares para
   * fundir la de más si se quedó sin hechos.
   */
  pasoCuadro(inf: InformeCuadro): { principal: string; extra: string }[] {
    const variantes = new Map<string, string[]>();
    const anotar = (id: string, n: string | null) => {
      if (!n) return;
      const r = this.raiz(id)!;
      const l = variantes.get(r) ?? variantes.set(r, []).get(r)!;
      if (!l.includes(n)) l.push(n);
    };
    for (const p of this.db.prepare('SELECT id, display_name n FROM sport_person').iterate() as Iterable<{ id: string; n: string | null }>) anotar(p.id, p.n);
    for (const a of this.db.prepare('SELECT person_id id, name_original n FROM sport_person_alias').iterate() as Iterable<{ id: string; n: string | null }>) anotar(a.id, a.n);
    const deNombre = this.soloNombre();
    const puestosPor = new Map<string, number>();
    for (const r of this.db.prepare('SELECT person_id p FROM sport_result WHERE person_id IS NOT NULL').iterate() as Iterable<{ p: string }>) {
      const k = this.raiz(r.p)!;
      puestosPor.set(k, (puestosPor.get(k) ?? 0) + 1);
    }
    const info = (r: string) => ({ conId: !deNombre.has(r), peso: puestosPor.get(r) ?? 0 });
    const comps = (this.db.prepare(
      `SELECT c.id FROM sport_competition c WHERE c.format = 'INDIVIDUAL' AND EXISTS (SELECT 1 FROM sport_bout b WHERE b.competition_id = c.id)`,
    ).all() as { id: string }[]).map((c) => c.id);
    const asaltosDe = this.q(
      `SELECT id, phase fase, round_key ronda, fencer_a_ref ar, fencer_a_name an, fencer_a_person_id ap, score_a sa,
              fencer_b_ref br, fencer_b_name bn, fencer_b_person_id bp, score_b sb
         FROM sport_bout WHERE competition_id = ?`,
    );
    const puestosDe = this.q(`SELECT id, source_name nombre, person_id raiz FROM sport_result WHERE competition_id = ?`);
    const ponLados = this.q(
      `UPDATE sport_bout SET fencer_a_person_id = coalesce(?, fencer_a_person_id), fencer_b_person_id = coalesce(?, fencer_b_person_id) WHERE id = ?`,
    );
    const ponPuesto = this.q('UPDATE sport_result SET person_id = ? WHERE id = ?');
    const pares: { principal: string; extra: string }[] = [];
    const sinVariantes: string[] = [];
    for (const comp of comps) {
      const asaltos = (asaltosDe.all(comp) as AsaltoCuadro[]).map((b) => ({ ...b, ap: this.raiz(b.ap), bp: this.raiz(b.bp) }));
      const puestos = (puestosDe.all(comp) as { id: string; nombre: string; raiz: string | null }[]).map((p) => ({ ...p, raiz: this.raiz(p.raiz) }));
      const plan = planCuadro(asaltos, puestos, (r) => variantes.get(r) ?? sinVariantes, info);
      if (plan.lados.length === 0 && plan.puestos.length === 0) {
        inf.sinPrincipal += plan.sinPrincipal;
        continue;
      }
      inf.pruebas += 1;
      for (const k of Object.keys(plan.aristas) as Arista[]) inf.aristas[k] += plan.aristas[k];
      inf.sinPrincipal += plan.sinPrincipal;
      inf.conflictos += plan.conflictos.length;
      for (const c of plan.conflictos) pares.push({ principal: c.principal, extra: c.extra });
      const porAsalto = new Map<string, { a?: string; b?: string; previaA?: string | null; previaB?: string | null }>();
      for (const l of plan.lados) {
        const x = porAsalto.get(l.asalto) ?? porAsalto.set(l.asalto, {}).get(l.asalto)!;
        if (l.lado === 'a') Object.assign(x, { a: l.raiz, previaA: l.previa });
        else Object.assign(x, { b: l.raiz, previaB: l.previa });
      }
      const porId = new Map(asaltos.map((b) => [b.id, b]));
      for (const [id, x] of porAsalto) {
        const b = porId.get(id)!;
        const ra = x.a ?? b.ap;
        const rb = x.b ?? b.bp;
        if (ra && rb && ra === rb) {
          inf.omitidosMismoAsalto += 1;
          continue;
        }
        ponLados.run(x.a ?? null, x.b ?? null, id);
        for (const [n, previa] of [[x.a, x.previaA], [x.b, x.previaB]] as const) {
          if (!n) continue;
          if (previa) inf.ladosRevinculados += 1;
          else inf.ladosVinculados += 1;
        }
      }
      for (const p of plan.puestos) inf.puestosVinculados += Number(ponPuesto.run(p.raiz, p.id).changes);
      for (const c of plan.conflictos) {
        if (inf.ejemplos.length >= 80) break;
        const nombre = (r: string) => `${variantes.get(r)?.[0] ?? '?'} [${r.slice(0, 8)}]`;
        inf.ejemplos.push(`${comp.slice(0, 8)}: ${nombre(c.extra)} → ${nombre(c.principal)} (${c.nodos})`);
      }
    }
    return pares;
  }

  cargarGrupos(): Map<string, Raiz> {
    this.cargarRaices();
    const raices = new Map<string, Raiz>();
    const de = (id: string) => {
      const r = this.raiz(id)!;
      let x = raices.get(r);
      if (!x) {
        raices.set(r, (x = {
          id: r, nombre: '', genero: null, pais: null, atleta: null, variantes: new Set(), fie: false,
          licencias: new Map(), compsPuesto: new Set(), rondas: new Set(), puestos: 0, asaltos: 0, soloNombre: true,
          fechas: new Set(), publicados: [], efc: false, aniosEfc: new Set(),
        }));
      }
      return x;
    };
    for (const [id, fs] of this.nacimientos ?? []) {
      if (!this.raizDe.has(id)) continue;
      for (const f of fs) de(id).fechas.add(f);
    }
    const indiceComp = new Map<string, number>();
    const indiceRonda = new Map<string, number>();
    const idx = (m: Map<string, number>, k: string) => {
      let i = m.get(k);
      if (i === undefined) m.set(k, (i = m.size));
      return i;
    };
    for (const p of this.db.prepare(
      `SELECT id, display_name n, name_normalized nn, gender g, country_code pais, athlete_id atleta, merged_into_person_id m FROM sport_person`,
    ).iterate() as Iterable<{ id: string; n: string; nn: string | null; g: string | null; pais: string | null; atleta: string | null; m: string | null }>) {
      const x = de(p.id);
      if (!p.m) Object.assign(x, { nombre: p.n, genero: p.g, pais: p.pais, atleta: p.atleta });
      if (p.atleta) x.soloNombre = false;
      if (p.nn) x.variantes.add(p.nn);
      if (p.n) x.publicados.push({ nombre: p.n, fuente: null });
    }
    for (const a of this.db.prepare('SELECT person_id p, source s, name_original o, name_normalized n FROM sport_person_alias').iterate() as Iterable<{
      p: string; s: string; o: string | null; n: string;
    }>) {
      if (!this.raizDe.has(a.p)) continue;
      const x = de(a.p);
      if (a.n) x.variantes.add(a.n);
      if (a.o) x.publicados.push({ nombre: a.o, fuente: a.s });
      if (a.s === 'efc_licencia') x.efc = true;
      if (!FUENTES_NOMBRE.includes(a.s)) x.soloNombre = false;
    }
    if (this.nacimientosEfc?.size) {
      for (const r of this.db.prepare(
        `SELECT person_id p, source_fact_key k FROM sport_result WHERE source = 'efc' AND person_id IS NOT NULL AND source_fact_key LIKE 'efc:lic:%'`,
      ).iterate() as Iterable<{ p: string; k: string }>) {
        const anio = this.nacimientosEfc.get(/^efc:lic:(\d+)/.exec(r.k)?.[1] ?? '');
        if (anio !== undefined && this.raizDe.has(r.p)) de(r.p).aniosEfc.add(anio);
      }
    }
    for (const e of this.db.prepare(
      `SELECT person_id p, scheme s, value v, scope_season t FROM sport_external_id WHERE link_status='CONFIRMADO' AND person_id IS NOT NULL`,
    ).iterate() as Iterable<{ p: string; s: string; v: string; t: string | null }>) {
      if (!this.raizDe.has(e.p)) continue;
      const x = de(e.p);
      x.soloNombre = false;
      if (e.s === 'fie_addr_id') x.fie = true;
      if (e.s === 'rfee_license') {
        const s = x.licencias.get(e.v) ?? x.licencias.set(e.v, new Set()).get(e.v)!;
        if (e.t) s.add(e.t);
      }
    }
    for (const r of this.db.prepare('SELECT person_id p, competition_id c FROM sport_result WHERE person_id IS NOT NULL').iterate() as Iterable<{ p: string; c: string }>) {
      const x = de(r.p);
      x.compsPuesto.add(idx(indiceComp, r.c));
      x.puestos += 1;
    }
    for (const b of this.db.prepare(
      `SELECT fencer_a_person_id a, fencer_b_person_id b, competition_id || '|' || phase || '|' || round_key k FROM sport_bout
        WHERE fencer_a_person_id IS NOT NULL OR fencer_b_person_id IS NOT NULL`,
    ).iterate() as Iterable<{ a: string | null; b: string | null; k: string }>) {
      const ronda = idx(indiceRonda, b.k);
      for (const p of [b.a, b.b]) {
        if (!p) continue;
        const x = de(p);
        x.rondas.add(ronda);
        x.asaltos += 1;
      }
    }
    return raices;
  }

  /** Funde la raíz `origen` en `destino` (sin cadenas: las fundidas en origen pasan a destino). */
  fundir(origen: string, destino: string, evidencia: string, fuente = 'fusion_vincular_asaltos'): boolean {
    if (origen === destino) return false;
    const t = ahora();
    const r = this.q(`UPDATE sport_person SET merged_into_person_id = ?, updated_at = ? WHERE id = ? AND merged_into_person_id IS NULL`)
      .run(destino, t, origen);
    if (Number(r.changes) === 0) return false;
    this.q(`UPDATE sport_person SET merged_into_person_id = ?, updated_at = ? WHERE merged_into_person_id = ?`).run(destino, t, origen);
    this.q(
      `INSERT OR IGNORE INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence, decided_at, created_at)
       SELECT ?, ?, id, display_name, ?, 'CONFIRMADO', ?, ?, ? FROM sport_person WHERE id = ?`,
    ).run(uuid(), fuente, destino, evidencia, t, t, origen);
    for (const [id, r2] of this.raizDe) if (r2 === origen || id === origen) this.raizDe.set(id, destino);
    return true;
  }
}

const cortan = (a: Set<number>, b: Set<number>) => {
  const [p, g] = a.size <= b.size ? [a, b] : [b, a];
  for (const c of p) if (g.has(c)) return true;
  return false;
};
/**
 * Dos personas distintas: puesto en la misma prueba o la misma ronda. Aparecer en
 * rondas distintas de una prueba no cuenta: el PDF trunca el nombre en la poule
 * («RAMIREZ LARENA Al») y lo da entero en la directa.
 */
const coinciden = (a: Raiz, b: Raiz) => cortan(a.compsPuesto, b.compsPuesto) || cortan(a.rondas, b.rondas);
const conHechos = (x: Raiz) => x.puestos + x.asaltos > 0;
const generoCompatible = (a: Raiz, b: Raiz) => !a.genero || !b.genero || a.genero === b.genero;
const paisDe = (x: Raiz) => x.pais ?? 'ESP';
/** Dos licencias RFEE distintas activas la misma temporada son dos personas. */
const licenciasSimultaneas = (a: Raiz, b: Raiz) => {
  for (const [la, ta] of a.licencias) {
    for (const [lb, tb] of b.licencias) {
      if (la === lb) continue;
      for (const t of ta) if (tb.has(t)) return true;
    }
  }
  return false;
};
/** Años de nacimiento conocidos: de las fechas FIE/Skermo y de las licencias EFC. */
const aniosDe = (x: Raiz) => new Set([...[...x.fechas].map((f) => Number(f.slice(0, 4))).filter(Number.isFinite), ...x.aniosEfc]);
const aniosCasan = (a: Raiz, b: Raiz) => {
  const ya = [...aniosDe(a)];
  const yb = [...aniosDe(b)];
  return ya.length > 0 && yb.length > 0 && ya.some((x) => yb.some((y) => Math.abs(x - y) <= 1));
};
/** Destino de una fusión: FIE, licencia RFEE, ficha, más hechos. */
const peso = (x: Raiz) => (x.fie ? 4e9 : 0) + (x.licencias.size ? 2e9 : 0) + (x.atleta ? 1e9 : 0) + x.puestos * 1000 + x.asaltos;
const resumen = (x: Raiz) => ({ id: x.id, nombre: x.nombre, puestos: x.puestos, asaltos: x.asaltos });

/**
 * Propuesta de otra fuente de evidencia (p. ej. la misma fecha de nacimiento en la
 * ficha FIE y en la RFEE). No se aplica: se comprueba contra los hechos y se
 * devuelve como válida o rechazada, con el motivo.
 */
export type PropuestaExterna = { origen: string; destino: string; evidencia: string };

/** Nombres que comparten 2+ palabras significativas, contando una inicial o un truncado («M.jose» / «MARIA JOSE»). */
function compartenNombre(a: readonly string[], b: readonly string[]): boolean {
  const libres = [...b];
  let n = 0;
  for (const w of significativas(a)) {
    const i = libres.findIndex((x) => x === w || x.startsWith(w) || w.startsWith(x));
    if (i < 0) continue;
    libres.splice(i, 1);
    n += 1;
  }
  return n >= 2;
}

function pasoFusiones(
  v: Vinculador,
  inf: InformeVinculo,
  conflictosLicencia: Map<string, Set<string>>,
  propuestas: Propuesta[],
  externas: readonly PropuestaExterna[] = [],
): void {
  let raices = v.cargarGrupos();
  const actual = (x: Raiz) => raices.get(v.raiz(x.id)!);
  const proponer = (tipo: Propuesta['tipo'], o: Raiz, d: Raiz, evidencia: string) => {
    propuestas.push({ tipo, aplicada: false, origen: resumen(o), destino: resumen(d), evidencia });
    inf.propuestas[tipo] = (inf.propuestas[tipo] ?? 0) + 1;
  };
  const intentar = (a: Raiz, b: Raiz, tipo: Propuesta['tipo'], evidencia: string): boolean => {
    if (a.atleta && b.atleta) {
      inf.fusiones.omitidasAtleta += 1;
      return false;
    }
    const [d, o] = peso(a) >= peso(b) ? [a, b] : [b, a];
    if (fechasChocan(a.fechas, b.fechas)) {
      proponer('fecha_nacimiento_distinta', o, d, `${evidencia}:${[...o.fechas].join(',')}≠${[...d.fechas].join(',')}`);
      return false;
    }
    if (!v.fundir(o.id, d.id, evidencia)) return false;
    propuestas.push({ tipo, aplicada: true, origen: resumen(o), destino: resumen(d), evidencia });
    for (const c of o.compsPuesto) d.compsPuesto.add(c);
    for (const c of o.rondas) d.rondas.add(c);
    for (const n of o.variantes) d.variantes.add(n);
    for (const f of o.fechas) d.fechas.add(f);
    for (const y of o.aniosEfc) d.aniosEfc.add(y);
    d.publicados.push(...o.publicados);
    d.efc ||= o.efc;
    for (const [l, t] of o.licencias) d.licencias.set(l, new Set([...(d.licencias.get(l) ?? []), ...t]));
    d.fie ||= o.fie;
    d.soloNombre &&= o.soloNombre;
    d.puestos += o.puestos;
    d.asaltos += o.asaltos;
    raices.delete(o.id);
    return true;
  };
  const palabrasDe = (x: Raiz) => [...x.variantes].map((n) => n.split(' '));

  // 3a) Misma licencia Engarde con nombres compatibles.
  for (const [ref, ids] of conflictosLicencia) {
    const grupo = [...new Set([...ids].map((id) => v.raiz(id)!))]
      .map((id) => raices.get(id))
      .filter((x): x is Raiz => !!x)
      .sort((a, b) => peso(b) - peso(a));
    for (const o0 of grupo.slice(1)) {
      const d = actual(grupo[0]);
      const o = actual(o0);
      if (!d || !o || d.id === o.id) continue;
      // Con la misma licencia y el mismo nombre, un género distinto es el de la prueba
      // (mixta o mal etiquetada), no otra persona.
      const mismoNombre = [...d.variantes].some((n) => o.variantes.has(n));
      const motivo = !palabrasDe(d).some((x) => palabrasDe(o).some((y) => nombresCompatibles(x, y))) ? 'nombre'
        : !mismoNombre && !generoCompatible(d, o) ? 'genero'
          : coinciden(d, o) ? 'coinciden'
            : d.fie && o.fie ? 'dos_fie' : null;
      if (motivo) proponer('licencia_engarde_nombre_distinto', o, d, `misma_licencia_engarde:${ref}:${motivo}`);
      else if (intentar(d, o, 'licencia_engarde', `misma_licencia_engarde:${ref}`)) inf.fusiones.licenciaEngarde += 1;
    }
  }

  // 3b) El mismo nombre de 3+ palabras significativas (dos apellidos y nombre).
  const porNombre = new Map<string, Set<Raiz>>();
  for (const x of raices.values()) {
    if (!conHechos(x)) continue;
    for (const n of x.variantes) {
      if (significativas(n.split(' ')).length < 3) continue;
      const k = `${n}|${paisDe(x)}`;
      (porNombre.get(k) ?? porNombre.set(k, new Set()).get(k)!).add(x);
    }
  }
  for (const [k, xs] of porNombre) {
    if (xs.size < 2 || xs.size > 4) continue;
    const lista = [...xs];
    for (let i = 0; i < lista.length; i += 1) {
      for (let j = i + 1; j < lista.length; j += 1) {
        const a = actual(lista[i]);
        const b = actual(lista[j]);
        if (!a || !b || a.id === b.id || !generoCompatible(a, b)) continue;
        if ((a.fie && b.fie) || licenciasSimultaneas(a, b)) continue;
        // Las mismas palabras en otro orden no son el mismo nombre («ORTIN ROMERO Héctor» / «ROMERO ORTIN Héctor»).
        // Sólo con nombres españoles: fuera, el orden de los nombres y apellidos varía de una fuente a otra.
        const orden = paisDe(a) === 'ESP' ? motivoNoUnir(a.publicados, b.publicados) : null;
        if (orden) {
          const [o, d] = peso(a) <= peso(b) ? [a, b] : [b, a];
          proponer('nombre_identico_orden', o, d, `nombre:${k}:${orden.relacion}:«${orden.a}»≠«${orden.b}»`);
          continue;
        }
        // Una persona de licencia EFC ya pasó por las guardas de `pasoEfc` (misma prueba, año,
        // categoría) y no casó: por el nombre solo, sólo con años de nacimiento conocidos y a un año.
        if ((a.efc || b.efc) && !aniosCasan(a, b)) {
          const [o, d] = peso(a) <= peso(b) ? [a, b] : [b, a];
          proponer('nombre_identico_efc_sin_anio', o, d, `nombre:${k}:anios:${[...aniosDe(o)].join(',') || '?'}/${[...aniosDe(d)].join(',') || '?'}`);
          continue;
        }
        if (coinciden(a, b)) {
          const [o, d] = peso(a) <= peso(b) ? [a, b] : [b, a];
          proponer('nombre_identico_con_coincidencia', o, d, `nombre:${k}`);
        } else if (intentar(a, b, 'nombre_identico', `nombre_identico_sin_coincidencia:${k}`)) inf.fusiones.nombreIdentico += 1;
      }
    }
  }

  // 4) Propuestas (no se aplican): un nombre contenido en otro, único en los dos sentidos.
  raices = v.cargarGrupos();
  const lista = [...raices.values()].filter((x) => conHechos(x) && paisDe(x) === 'ESP');
  const palabra = new Map<string, Raiz[]>();
  for (const x of lista) {
    const ws = new Set([...x.variantes].flatMap((n) => significativas(n.split(' '))));
    for (const w of ws) (palabra.get(w) ?? palabra.set(w, []).get(w)!).push(x);
  }
  const comparten = (ws: readonly string[]) => {
    const cuenta = new Map<Raiz, number>();
    for (const w of new Set(significativas(ws))) for (const y of palabra.get(w) ?? []) cuenta.set(y, (cuenta.get(y) ?? 0) + 1);
    return [...cuenta].filter(([, n]) => n >= 2).map(([y]) => y);
  };
  /** `corto` cabe en `largo` con menos información (menos palabras o la misma truncada). */
  const contenido = (corto: readonly string[], largo: readonly string[]) => {
    const c = coincidencia(corto, largo);
    if (!c || c.nivel === 'exacto') return null;
    const menor = corto.length < largo.length || (corto.length === largo.length && corto.join('').length < largo.join('').length);
    return menor ? c : null;
  };
  const contenidaEn = (l: Raiz, m: Raiz) => palabrasDe(l).some((wl) => palabrasDe(m).some((wm) => contenido(wl, wm)));
  const compatibles = (a: Raiz, b: Raiz) => palabrasDe(a).some((wa) => palabrasDe(b).some((wb) => coincidencia(wa, wb)));
  /**
   * Varios candidatos pueden ser truncados unos de otros («ZABALA GUTIERREZ Ju»,
   * «… Jua», «… Juan»): vale el único que contiene a todos los demás.
   */
  const cabeza = (ys: readonly Raiz[]): Raiz | null => {
    if (ys.length === 1) return ys[0];
    const c = ys.filter((m) => ys.every((l) => l === m || contenidaEn(l, m)));
    return c.length === 1 ? c[0] : null;
  };
  const vistas = new Set<string>();
  for (const x of lista) {
    const fieSinLicencia = x.fie && x.licencias.size === 0;
    if (!fieSinLicencia && !x.soloNombre) continue;
    for (const ws of palabrasDe(x)) {
      const largos = comparten(ws).filter((y) => y !== x && generoCompatible(x, y)
        && !(fieSinLicencia && y.fie) && palabrasDe(y).some((wy) => contenido(ws, wy)));
      const y = cabeza(largos);
      if (!y || largos.some((l) => coinciden(x, l))) continue;
      // Único en el otro sentido: otra persona con ID cuyo nombre también cabe en `y` y no
      // es compatible con `x` («ZABALA Juan» y «GUTIERREZ Juan» en «ZABALA GUTIERREZ Juan»)
      // deja la elección abierta. Los demás truncados sin ID no compiten.
      const cortos = [...new Set(palabrasDe(y).flatMap((wy) => comparten(wy).filter((z) => z !== y && generoCompatible(y, z)
        && palabrasDe(z).some((wz) => contenido(wz, wy)))))];
      if (!cortos.includes(x) || !cortos.every((z) => z === x || z.soloNombre || compatibles(x, z))) continue;
      const k = `${x.id}|${y.id}`;
      if (vistas.has(k)) continue;
      vistas.add(k);
      const nivel = palabrasDe(y).map((wy) => contenido(ws, wy)).find(Boolean)!.nivel;
      if (fieSinLicencia) proponer('apellido_fie', y, x, `fie_${nivel}:${ws.join(' ')}`);
      else {
        const [o, d] = peso(x) <= peso(y) ? [x, y] : [y, x];
        proponer('nombre_truncado', o, d, `${nivel}:${ws.join(' ')}`);
      }
    }
  }

  // 5) Propuestas externas: se validan, nunca se aplican.
  for (const e of externas) {
    const o = raices.get(v.raiz(e.origen) ?? e.origen);
    const d = raices.get(v.raiz(e.destino) ?? e.destino);
    if (!o || !d) continue;
    const motivo = o.id === d.id ? 'ya_fundidas'
      : !generoCompatible(o, d) ? 'genero'
        : o.fie && d.fie ? 'dos_fie'
          : licenciasSimultaneas(o, d) ? 'licencias_simultaneas'
            : coinciden(o, d) ? 'coinciden'
              : !palabrasDe(o).some((a) => palabrasDe(d).some((b) => compartenNombre(a, b))) ? 'nombre'
                : null;
    proponer(motivo ? 'externa_rechazada' : 'externa_valida', o, d, motivo ? `${e.evidencia}:${motivo}` : e.evidencia);
  }
}

/**
 * Tras `pasoCuadro`: la persona de más de una cadena que se quedó sin puestos ni asaltos
 * (todo lo suyo estaba en esas cadenas) y tiene identificador se funde en la de su cadena, salvo que el género,
 * las fechas de nacimiento, dos IDs FIE, dos fichas o dos licencias simultáneas digan que
 * son dos personas: entonces queda como propuesta `cuadro`. Si aún tiene hechos fuera, la
 * propuesta es `cuadro_misma_persona`.
 */
function fundirCuadro(v: Vinculador, inf: InformeVinculo, pares: readonly { principal: string; extra: string }[], propuestas: Propuesta[]): void {
  if (pares.length === 0) return;
  const raices = v.cargarGrupos();
  const vistos = new Set<string>();
  const omitir = (motivo: string) => (inf.cuadro.fusionesOmitidas[motivo] = (inf.cuadro.fusionesOmitidas[motivo] ?? 0) + 1);
  for (const par of pares) {
    const o = raices.get(v.raiz(par.extra)!);
    const d = raices.get(v.raiz(par.principal)!);
    if (!o || !d || o.id === d.id || vistos.has(o.id)) continue;
    vistos.add(o.id);
    // Una persona creada por un nombre recortado («FLOREZ DE VAR») que se queda vacía no se
    // funde: su nombre pasaría a la otra y el paso por nombre le daría los puestos de sus
    // hermanos. Se queda sin hechos y `borrarPersonasHuerfanas` la retira.
    if (!conHechos(o) && o.soloNombre) {
      inf.cuadro.vaciasPorNombre += 1;
      continue;
    }
    const motivo = conHechos(o) ? 'con_hechos'
      : !generoCompatible(o, d) ? 'genero'
        : fechasChocan(o.fechas, d.fechas) ? 'fecha_nacimiento'
          : o.fie && d.fie ? 'dos_fie'
            : o.atleta && d.atleta ? 'dos_fichas'
              : licenciasSimultaneas(o, d) ? 'licencias_simultaneas' : null;
    if (motivo) {
      omitir(motivo);
      const tipo = motivo === 'con_hechos' ? 'cuadro_misma_persona' : 'cuadro';
      propuestas.push({ tipo, aplicada: false, origen: resumen(o), destino: resumen(d), evidencia: `cadena_del_cuadro:${motivo}` });
      inf.propuestas[tipo] = (inf.propuestas[tipo] ?? 0) + 1;
      continue;
    }
    if (!v.fundir(o.id, d.id, 'cadena_del_cuadro', 'fusion_cuadro')) continue;
    for (const n of o.variantes) d.variantes.add(n);
    for (const f of o.fechas) d.fechas.add(f);
    for (const [l, t] of o.licencias) d.licencias.set(l, new Set([...(d.licencias.get(l) ?? []), ...t]));
    d.fie ||= o.fie;
    d.atleta ??= o.atleta;
    raices.delete(o.id);
    inf.cuadro.fusiones += 1;
    propuestas.push({ tipo: 'cuadro', aplicada: true, origen: resumen(o), destino: resumen(d), evidencia: 'cadena_del_cuadro' });
  }
}

export function vincularAsaltos(
  db: DatabaseSync,
  opciones: {
    externas?: readonly PropuestaExterna[]; nacimientos?: ReadonlyMap<string, readonly string[]>; cuadro?: boolean;
    /** Licencia EFC → año de nacimiento (`leerNacimientosEfc`). */
    nacimientosEfc?: ReadonlyMap<string, number>;
  } = {},
): { informe: InformeVinculo; propuestas: Propuesta[] } {
  const inicio = Date.now();
  const ambos = () => Number((db.prepare(
    `SELECT count(*) n FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id
      WHERE c.format = 'INDIVIDUAL' AND b.fencer_a_person_id IS NOT NULL AND b.fencer_b_person_id IS NOT NULL`,
  ).get() as { n: number }).n);
  const informe: InformeVinculo = {
    antes: medir(db),
    despues: undefined as unknown as Medida,
    licencias: { refs: 0, refsUnaPersona: 0, refsVariasPersonas: 0, ladosVinculados: 0, puestosVinculados: 0 },
    prueba: {
      pruebas: 0, nombres: 0, vinculados: { referencia: 0, exacto: 0, subconjunto: 0, prefijo: 0 }, ladosVinculados: 0,
      ladosRevinculados: 0, ambiguos: 0, sinPuesto: 0, puestoSinPersona: 0, descartadosHomonimo: 0, descartadosRonda: 0,
      ejemplos: {},
    },
    fusiones: { licenciaEngarde: 0, nombreIdentico: 0, omitidasAtleta: 0 },
    cuadro: {
      pruebas: 0, aristas: { cuadro: 0, poule: 0, clasificacion: 0 }, ladosVinculados: 0, ladosRevinculados: 0, puestosVinculados: 0,
      omitidosMismoAsalto: 0, conflictos: 0, sinPrincipal: 0, fusiones: 0, fusionesOmitidas: {}, vaciasPorNombre: 0, ejemplos: [],
    },
    propuestas: {},
    puestosConjuntasDesvinculados: 0,
    asaltosAmbosAntes: ambos(),
    asaltosAmbosDespues: 0,
    segundos: 0,
  };
  const propuestas: Propuesta[] = [];
  const v = new Vinculador(db, opciones.nacimientos, opciones.nacimientosEfc);
  const conflictos = new Map<string, Set<string>>();
  // SAVEPOINT y no BEGIN: anida dentro de la simulación de `main`.
  const transaccion = (fn: () => void) => {
    db.exec('SAVEPOINT paso');
    try {
      fn();
      db.exec('RELEASE paso');
    } catch (e) {
      db.exec('ROLLBACK TO paso');
      db.exec('RELEASE paso');
      throw e;
    }
  };
  transaccion(() => v.pasoLicencias(informe.licencias, conflictos));
  transaccion(() => v.pasoPrueba(informe.prueba));
  if (opciones.cuadro !== false) {
    transaccion(() => {
      const pares = v.pasoCuadro(informe.cuadro);
      v.cargarRaices();
      fundirCuadro(v, informe, pares, propuestas);
    });
  }
  transaccion(() => pasoFusiones(v, informe, conflictos, propuestas, opciones.externas));
  // El cuadro y las licencias Engarde rellenan puestos vacíos, también los de una prueba
  // conjunta, que no llevan persona (`dedupe-conjuntas.ts`).
  transaccion(() => { informe.puestosConjuntasDesvinculados = desvincularPuestosConjuntas(db); });
  informe.despues = medir(db);
  informe.asaltosAmbosDespues = ambos();
  informe.segundos = Math.round((Date.now() - inicio) / 100) / 10;
  return { informe, propuestas };
}

function main(): void {
  const rutaDb = argumento('db', NUEVO_POR_DEFECTO);
  const salida = argumento('informe', join(CARPETA_TRABAJO, 'vinculo-asaltos-informe.json'));
  const revision = argumento('revision', join(CARPETA_TRABAJO, 'vinculo-asaltos-revision.json'));
  const simular = bandera('simular');
  const fechas = leerFechasNacimiento({
    cacheSkermo: argumento('cache-skermo', CACHE_SKERMO),
    fieAtletas: argumento('fie-atletas', FIE_ATLETAS),
  });
  // JSONL de `perfiles-*`: {personaFie, personaRfee, fechaNacimiento}; la RFEE se propone hacia la FIE.
  const rutaExternas = argumento('externas', '');
  const externas: PropuestaExterna[] = rutaExternas
    ? readFileSync(rutaExternas, 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
      const p = JSON.parse(l) as { personaFie: string; personaRfee: string; fechaNacimiento?: string };
      return { origen: p.personaRfee, destino: p.personaFie, evidencia: `fecha_nacimiento:${p.fechaNacimiento ?? '?'}` };
    })
    : [];
  const nacimientosEfc = leerNacimientosEfc(argumento('hechos-efc', join(CARPETA_TRABAJO, 'hechos', 'lote7-efc')));
  const db = new DatabaseSync(rutaDb);
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  let r: ReturnType<typeof vincularAsaltos>;
  try {
    if (simular) db.exec('SAVEPOINT simulacion');
    try {
      r = vincularAsaltos(db, { externas, nacimientos: nacimientosPorPersona(db, fechas), nacimientosEfc });
    } finally {
      if (simular) {
        db.exec('ROLLBACK TO simulacion');
        db.exec('RELEASE simulacion');
      }
    }
  } finally {
    restaurarGuardia(db);
    db.close();
  }
  writeFileSync(salida, JSON.stringify(r.informe, null, 2));
  writeFileSync(revision, JSON.stringify(r.propuestas, null, 2));
  console.log(JSON.stringify(r.informe, null, 2));
  const pendientes = r.propuestas.filter((p) => !p.aplicada).length;
  console.log(`Informe: ${salida}\nRevisión (${r.propuestas.length - pendientes} fusiones aplicadas, ${pendientes} propuestas): ${revision}${simular ? '\n(simulación: nada guardado)' : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
