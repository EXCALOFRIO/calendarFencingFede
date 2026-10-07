/**
 * Lote 12: auditoría de invariantes de calidad de la base deportiva y correcciones decisivas.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote12-calidad.ts --db <copia.sqlite> \
 *     [--aplicar] [--informe <calidad.json>] [--markdown <calidad.md>] [--sin-nacimientos] \
 *     [--fie-atletas <jsonl>] [--cache-skermo <dir>]
 *
 * Sin `--aplicar` la copia se abre en sólo lectura: se miden los invariantes y se listan las
 * correcciones que se harían. Con `--aplicar` se escriben sólo las correcciones decisivas, en una
 * transacción, y nunca sobre las copias exactas de producción (nuevo11, nuevo12, base, remoto).
 *
 * Correcciones decisivas (todo lo demás queda para revisión humana en el informe):
 * - `union_misma_licencia`: dos raíces con la misma licencia (RFEE, Engarde o EFC) que nunca
 *   coinciden en una prueba, con el mismo género y país, nombres compatibles (mismo, recortado, compuesto o
 *   una errata; también tras reparar el mojibake «Ä°» → «İ»), años de nacimiento a 1 año como mucho,
 *   sin dos ID FIE y sin un rechazo previo entre ellas. Candidato CONFIRMADO `fusion_calidad`,
 *   evidencia `misma_licencia_<esquema>:<valor>` (identidad para `separar-uniones.ts`).
 * - `genero_prueba` / `genero_ficha`: una prueba individual cuyo código dice el otro género (la
 *   misma arma y «sf», «ef», «fm»…: `engarde:rfee/191026tnrsable/sfabs`) y en la que más de 3/4 de
 *   los tiradores con otras pruebas son, en ellas, del otro género. Pasa al género del código, y las
 *   fichas creadas desde ella con el género equivocado (sin otras pruebas de ese género) también. Y
 *   una raíz con 3 o más pruebas individuales, todas del otro género y ninguna sospechosa, pasa a él.
 * - `anio_comodin`: el año 1920 es el comodín de la FIE (`1920-01-01`); si además choca con la
 *   categoría de alguna prueba de la persona (M20 con 85 años), se borra (`birth_year = NULL`, y
 *   también en `perfil_deportista`). Sin año, la app trata la ficha como posible menor (más prudente).
 * - `asalto_contra_si_mismo`: un asalto cuyos dos lados acaban en la misma raíz; pierde la persona
 *   el lado cuyo nombre no casa con un puesto de esa raíz en la prueba (o los dos).
 * - `asalto_leido_dos_veces`: el mismo par de raíces, misma fuente, fase, ronda y marcador dos veces
 *   en una prueba (el PDF repite el cuadro con los nombres recortados): se borra la lectura de
 *   nombres más cortos. Con otro marcador u otra ronda no se toca.
 * - `puesto_duplicado_misma_fuente`: la misma raíz dos veces en una prueba con la misma fuente,
 *   puesto y nombre: se borra la copia más reciente.
 * - `fusion_nacimiento_incompatible`: una ficha fundida sólo por nombre (sin licencia, ID FIE,
 *   cuadro, fecha de nacimiento ni revisión manual) cuyos nacimientos conocidos están a más de 2
 *   años de los de su raíz vuelve a ser raíz, con un candidato `separacion_calidad` RECHAZADO. Es la
 *   misma regla que `vincular-asaltos.ts` aplica al fundir.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  ahora, argumento, bandera, CARPETA_TRABAJO, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia, uuid,
} from './comun';
import { CACHE_SKERMO, FIE_ATLETAS, leerFechasNacimiento, nacimientosPorPersona } from './dedupe-nacimientos';
import { mejorRelacion, nivelUnion, type NombrePublicado } from './nombres-union';
import { FUSION_REVISION_MANUAL } from './separar-uniones';

export const BASES_PROTEGIDAS: ReadonlySet<string> = new Set(['base.sqlite', 'remoto.sqlite', 'nuevo11.sqlite', 'nuevo12.sqlite']);
export const FUENTE_SEPARACION = 'separacion_calidad';
export const FUENTE_UNION = 'fusion_calidad';
/** La FIE publica `1920-01-01` cuando no conoce la fecha. */
export const ANIO_COMODIN = 1920;
const FECHA_COMODIN = '1920-01-01';
const MAX_EJEMPLOS = 25;

export const corto = (id: string | null | undefined): string => (id ? id.slice(0, 8) : '-');

export type Prioridad = 1 | 2 | 3;
export interface Ejemplo { texto: string; ids: string[]; decisivo: boolean; peso: number }
export interface Hallazgo {
  id: string;
  titulo: string;
  prioridad: Prioridad;
  /** Qué ve el usuario afectado: perfil, ranking, cara a cara, ficha de prueba. */
  afecta: string;
  recuento: number;
  decisivos: number;
  revision: number;
  nota: string;
  ejemplos: Ejemplo[];
}

export type TipoCorreccion =
  | 'union_misma_licencia' | 'genero_prueba' | 'genero_ficha' | 'anio_comodin' | 'asalto_contra_si_mismo'
  | 'asalto_leido_dos_veces' | 'puesto_duplicado_misma_fuente' | 'fusion_nacimiento_incompatible';

export interface Correccion {
  tipo: TipoCorreccion;
  /** Fila que cambia (persona, prueba, asalto o puesto). */
  fila: string;
  /**
   * union: raíz destino; genero_*: género nuevo; asalto_contra_si_mismo: lado ('a' | 'b');
   * puesto/asalto duplicado: fila que se conserva; fusion_nacimiento_incompatible: raíz anterior.
   */
  valor: string;
  antes: string | null;
  motivo: string;
}

export interface InformeCalidad {
  base: string;
  generado: string;
  totales: Record<string, number>;
  hallazgos: Hallazgo[];
  correcciones: Correccion[];
  aplicado: boolean;
  aplicadas: Record<string, number>;
}

type Persona = { id: string; n: string; nn: string; m: string | null; g: string | null; pais: string | null; anio: number | null };
type Prueba = {
  id: string; k: string; src: string; season: string; w: string; g: string; cat: string; f: string;
  fecha: string | null; ed: string;
};
type Puesto = { id: string; c: string; p: string | null; pos: number | null; src: string; k: string; n: string; t: number };

const CATEGORIA_MAX: Readonly<Record<string, number>> = {
  M7: 7, M9: 9, M10: 10, M11: 11, M12: 12, M13: 13, M14: 14, M15: 15, M17: 17, M20: 20, M23: 23,
};
/** Tolerancia de edad: dos años sobre el límite de la categoría (fechas de corte y temporadas a caballo). */
export const TOLERANCIA_EDAD = 2;
export const EDAD_MIN_VET = 35;
/** Puestos ≥ 998: la FIE marca así a los excluidos o no clasificados. */
export const PUESTO_CENTINELA = 998;

export function anioFinTemporada(season: string): number | null {
  const m = /(\d{4})\D*$/.exec(season);
  return m ? Number(m[1]) : null;
}

/** Motivo por el que una edad no es posible en la categoría, o null. */
export function edadImposible(categoria: string, edad: number): string | null {
  if (edad < 5) return 'menor_de_5';
  if (edad > 95) return 'mayor_de_95';
  const max = CATEGORIA_MAX[categoria];
  if (max !== undefined && edad > max + TOLERANCIA_EDAD) return `edad_${edad}_en_${categoria}`;
  if (categoria === 'VET' && edad < EDAD_MIN_VET) return `edad_${edad}_en_VET`;
  if (categoria === 'ABS' && edad < 9) return `edad_${edad}_en_ABS`;
  return null;
}

/** Marcador imposible según formato y fase (null si es posible). */
export function marcadorImposible(formato: string, fase: string, a: number, b: number): string | null {
  if (formato === 'EQUIPOS') {
    if (Math.max(a, b) > 45) return 'equipos_mas_de_45';
    if (a === b && a > 0) return 'empate';
    return null;
  }
  if (fase === 'POULE' && Math.max(a, b) > 5) return 'poule_mas_de_5';
  if (fase === 'TABLEAU' && Math.max(a, b) > 15) return 'directa_mas_de_15';
  if (a === b) return a === 0 ? 'cero_a_cero' : 'empate';
  return null;
}

/** Huecos de una clasificación: posiciones que faltan tras contar los empates (1,2,3,3,5 no tiene huecos). */
export function huecosClasificacion(posiciones: readonly number[]): { primera: number; huecos: number; ganadores: number } {
  const ps = [...posiciones].sort((a, b) => a - b);
  if (!ps.length) return { primera: 0, huecos: 0, ganadores: 0 };
  let huecos = 0;
  let i = 0;
  while (i < ps.length) {
    let j = i;
    while (j < ps.length && ps[j] === ps[i]) j += 1;
    if (j < ps.length) huecos += Math.max(0, ps[j] - (ps[i] + (j - i)));
    i = j;
  }
  return { primera: ps[0], huecos, ganadores: ps.filter((p) => p === 1).length };
}

const ARMA_LETRA: Readonly<Record<string, string>> = { e: 'ESPADA', f: 'FLORETE', s: 'SABLE' };
/**
 * Género que dice el código de una prueba («sfabs», «FIESTA_SF-12», «CTOESP-EFCATI», «_em2»): arma y
 * género en dos letras, sólo si la letra del arma es la de la prueba. Null si no lo dice o se contradice.
 */
export function generoDeClave(clave: string, arma: string): 'M' | 'F' | null {
  const ultima = clave.toLowerCase().split('/').pop() ?? '';
  const vistos = new Set<'M' | 'F'>();
  for (const m of ultima.matchAll(/(?<![a-z])([efs])([mf])(?=abs|ind|eq|vet|cad|jun|inf|cat|[^a-z]|$)/g)) {
    if (ARMA_LETRA[m[1]] === arma) vistos.add(m[2] === 'm' ? 'M' : 'F');
  }
  return vistos.size === 1 ? [...vistos][0] : null;
}

/** «SAGARDÄ° DÄ°AZ» → «SAGARDİ DİAZ»: UTF-8 leído como Latin-1. Sin cambios si no lo parece. */
export function repararMojibake(texto: string): string {
  if (!/[ÃÄÅÂ][\u0080-\u00BF]/.test(texto)) return texto;
  const r = Buffer.from(texto, 'latin1').toString('utf8');
  return r.includes('\uFFFD') ? texto : r;
}

export const tieneMojibake = (texto: string): boolean => repararMojibake(texto) !== texto;

class Auditor {
  readonly personas = new Map<string, Persona>();
  readonly miembros = new Map<string, string[]>();
  readonly pruebas = new Map<string, Prueba>();
  readonly puestosPorPrueba = new Map<string, Puesto[]>();
  readonly hallazgos: Hallazgo[] = [];
  readonly correcciones: Correccion[] = [];
  readonly totales: Record<string, number> = {};
  /** Pruebas individuales M/F por raíz, a partir de los puestos. */
  pruebasRaiz = new Map<string, Set<string>>();
  /** Pruebas cuyo género contradice a sus tiradores (2c), para no corregir fichas a partir de ellas. */
  readonly pruebasSospechosas = new Set<string>();
  /** Raíces cuyo género ya cambia una corrección. */
  readonly generoCorregido = new Set<string>();

  constructor(readonly db: DatabaseSync, readonly nacimientos: ReadonlyMap<string, readonly string[]>) {}

  raiz(id: string | null): string | null {
    if (!id) return null;
    let a = id;
    for (let i = 0; i < 8; i += 1) {
      const m = this.personas.get(a)?.m;
      if (!m) return a;
      a = m;
    }
    return a;
  }

  nombre(id: string | null): string {
    return (id && this.personas.get(id)?.n) || '?';
  }

  prueba(id: string): string {
    const p = this.pruebas.get(id);
    return p ? `${p.k} (${p.src} ${p.season} ${p.w} ${p.g} ${p.cat}${p.fecha ? ` ${p.fecha}` : ''}) [${corto(id)}]` : corto(id);
  }

  persona(id: string | null): string {
    const p = id ? this.personas.get(id) : undefined;
    return p ? `${p.n} [${corto(p.id)}${p.anio ? ` ${p.anio}` : ''}${p.g ? ` ${p.g}` : ''}${p.pais ? ` ${p.pais}` : ''}]` : '?';
  }

  corregir(c: Correccion): void {
    this.correcciones.push(c);
  }

  nuevo(h: Omit<Hallazgo, 'recuento' | 'decisivos' | 'revision' | 'ejemplos'>, ejemplos: Ejemplo[], recuento = ejemplos.length): Hallazgo {
    const decisivos = ejemplos.filter((e) => e.decisivo).length;
    const x: Hallazgo = {
      ...h,
      recuento,
      decisivos,
      revision: recuento - decisivos,
      ejemplos: [...ejemplos].sort((a, b) => Number(b.decisivo) - Number(a.decisivo) || b.peso - a.peso).slice(0, MAX_EJEMPLOS),
    };
    this.hallazgos.push(x);
    return x;
  }

  cargar(): void {
    for (const p of this.db.prepare(
      `SELECT id, display_name n, name_normalized nn, merged_into_person_id m, gender g, country_code pais, birth_year anio FROM sport_person`,
    ).iterate() as Iterable<Persona>) this.personas.set(p.id, { ...p, anio: p.anio === null ? null : Number(p.anio) });
    for (const p of this.personas.values()) {
      const r = this.raiz(p.id)!;
      (this.miembros.get(r) ?? this.miembros.set(r, []).get(r)!).push(p.id);
    }
    for (const c of this.db.prepare(
      `SELECT id, competition_key k, source src, season, weapon w, gender g, category cat, format f, competition_date fecha, edition_id ed FROM sport_competition`,
    ).iterate() as Iterable<Prueba>) this.pruebas.set(c.id, c);
    for (const r of this.db.prepare(
      `SELECT id, competition_id c, person_id p, position pos, source src, source_fact_key k, source_name n, first_seen_at t FROM sport_result`,
    ).iterate() as Iterable<Puesto>) {
      (this.puestosPorPrueba.get(r.c) ?? this.puestosPorPrueba.set(r.c, []).get(r.c)!).push({ ...r, t: Number(r.t) });
    }
    for (const [c, xs] of this.puestosPorPrueba) {
      const p = this.pruebas.get(c);
      if (!p || p.f !== 'INDIVIDUAL' || (p.g !== 'M' && p.g !== 'F')) continue;
      for (const x of xs) {
        const r = this.raiz(x.p);
        if (r) (this.pruebasRaiz.get(r) ?? this.pruebasRaiz.set(r, new Set()).get(r)!).add(c);
      }
    }
    this.totales.personas = this.personas.size;
    this.totales.raices = this.miembros.size;
    this.totales.pruebas = this.pruebas.size;
    this.totales.puestos = [...this.puestosPorPrueba.values()].reduce((a, x) => a + x.length, 0);
  }

  generosDe(r: string, excluir?: string): { M: number; F: number } {
    const e = { M: 0, F: 0 };
    for (const c of this.pruebasRaiz.get(r) ?? []) {
      if (c === excluir) continue;
      const g = this.pruebas.get(c)!.g;
      if (g === 'M' || g === 'F') e[g] += 1;
    }
    return e;
  }

  // 1) Identidades: licencia RFEE, ID FIE, licencia Engarde y licencia EFC.
  identidades(): void {
    type Ident = { esquema: string; valor: string; persona: string; temporada: string };
    const ids: Ident[] = [];
    for (const e of this.db.prepare(
      `SELECT scheme s, value v, person_id p, scope_season t FROM sport_external_id
        WHERE link_status = 'CONFIRMADO' AND person_id IS NOT NULL AND scheme IN ('rfee_license', 'fie_addr_id')`,
    ).iterate() as Iterable<{ s: string; v: string; p: string; t: string }>) {
      ids.push({ esquema: e.s, valor: e.v, persona: e.p, temporada: e.t });
    }
    const comodines: Ejemplo[] = [];
    const anotarRef = (esquema: string, ref: string, persona: string | null, temporada: string, nombre: string, c: string) => {
      if (esquema === 'licencia_engarde' && /^N-0+$/.test(ref)) {
        comodines.push({ texto: `«${nombre}» con lic:${ref} en ${this.prueba(c)} → ${persona ? this.persona(this.raiz(persona)) : 'sin persona'}`, ids: [c], decisivo: false, peso: persona ? 1 : 0 });
        return;
      }
      if (persona) ids.push({ esquema, valor: ref, persona, temporada });
    };
    for (const [c, xs] of this.puestosPorPrueba) {
      const season = this.pruebas.get(c)?.season ?? '';
      for (const x of xs) {
        if (x.src === 'engarde' && x.k.startsWith('lic:')) anotarRef('licencia_engarde', x.k.slice(4), x.p, season, x.n, c);
        else if (x.src === 'efc' && x.k.startsWith('efc:lic:')) anotarRef('licencia_efc', x.k.slice(8), x.p, season, x.n, c);
      }
    }
    for (const b of this.db.prepare(
      `SELECT b.competition_id c, b.source s, b.fencer_a_ref a, b.fencer_a_person_id ap, b.fencer_a_name an, b.fencer_b_ref b, b.fencer_b_person_id bp,
              b.fencer_b_name bn, c.season t
         FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id
        WHERE (b.source = 'engarde' AND (b.fencer_a_ref LIKE 'lic:%' OR b.fencer_b_ref LIKE 'lic:%'))
           OR (b.source = 'efc' AND (b.fencer_a_ref LIKE 'efc:lic:%' OR b.fencer_b_ref LIKE 'efc:lic:%'))`,
    ).iterate() as Iterable<{ c: string; s: string; a: string; ap: string | null; an: string; b: string; bp: string | null; bn: string; t: string }>) {
      for (const [ref, p, n] of [[b.a, b.ap, b.an], [b.b, b.bp, b.bn]] as const) {
        if (b.s === 'engarde' && ref.startsWith('lic:')) anotarRef('licencia_engarde', ref.slice(4), p, b.t, n, b.c);
        if (b.s === 'efc' && ref.startsWith('efc:lic:')) anotarRef('licencia_efc', ref.slice(8), p, b.t, n, b.c);
      }
    }
    const nombresComodin = new Set(comodines.map((e) => e.texto.split('»')[0]));
    this.nuevo({
      id: '1c_licencia_engarde_comodin',
      titulo: 'Puestos y asaltos Engarde con la licencia comodín N-000000',
      prioridad: 2,
      afecta: 'cara a cara: vincular-asaltos.ts la trata como una licencia real y puede dar a una persona los asaltos de otras',
      nota: `${nombresComodin.size} nombres distintos. No es identidad: se excluye de 1a/1b.`,
    }, comodines);

    const porValor = new Map<string, Map<string, Set<string>>>();
    const porRaiz = new Map<string, Map<string, Map<string, Set<string>>>>();
    for (const i of ids) {
      const r = this.raiz(i.persona)!;
      const kv = `${i.esquema}|${i.valor}`;
      const v = porValor.get(kv) ?? porValor.set(kv, new Map()).get(kv)!;
      (v.get(r) ?? v.set(r, new Set()).get(r)!).add(i.persona);
      const pr = porRaiz.get(r) ?? porRaiz.set(r, new Map()).get(r)!;
      const pe = pr.get(i.esquema) ?? pr.set(i.esquema, new Map()).get(i.esquema)!;
      (pe.get(i.valor) ?? pe.set(i.valor, new Set()).get(i.valor)!).add(i.temporada);
    }

    const nombres: Record<string, string> = {
      rfee_license: 'licencia RFEE', fie_addr_id: 'ID FIE', licencia_engarde: 'licencia Engarde', licencia_efc: 'licencia EFC',
    };
    const evidencia: Record<string, string> = {
      rfee_license: 'misma_licencia_rfee', licencia_engarde: 'misma_licencia_engarde', licencia_efc: 'misma_licencia_efc',
    };
    const rechazos = new Set<string>();
    for (const r of this.db.prepare(`SELECT source_ref o, person_id p FROM sport_link_candidate WHERE status = 'RECHAZADO'`).all() as { o: string; p: string }[]) {
      const a = this.raiz(r.o);
      const b = this.raiz(r.p);
      if (a && b) { rechazos.add(`${a}|${b}`); rechazos.add(`${b}|${a}`); }
    }
    const identDe = (r: string, esquema: string) => porRaiz.get(r)?.get(esquema)?.size ?? 0;
    const nombresDe = this.db.prepare(
      `SELECT name_original n, source s FROM sport_person_alias WHERE person_id = ?
       UNION SELECT display_name n, NULL s FROM sport_person WHERE id = ?`,
    );
    const pruebasAsaltos = this.db.prepare(
      `SELECT competition_id c FROM sport_bout WHERE fencer_a_person_id = ? UNION SELECT competition_id c FROM sport_bout WHERE fencer_b_person_id = ?`,
    );
    const todasLasPruebas = (r: string) => {
      const s = new Set<string>();
      for (const m of this.miembros.get(r) ?? [r]) {
        for (const x of pruebasAsaltos.all(m, m) as { c: string }[]) s.add(x.c);
      }
      for (const [c, xs] of this.puestosPorPrueba) if (xs.some((x) => x.p && this.raiz(x.p) === r)) s.add(c);
      return s;
    };
    const publicados = (r: string): NombrePublicado[] => {
      const l: NombrePublicado[] = [];
      for (const m of this.miembros.get(r) ?? [r]) {
        for (const x of nombresDe.all(m, m) as { n: string; s: string | null }[]) l.push({ nombre: repararMojibake(x.n), fuente: x.s });
      }
      return l;
    };
    const peso = (r: string) => identDe(r, 'fie_addr_id') * 4e9 + identDe(r, 'rfee_license') * 2e9 + (this.pruebasRaiz.get(r)?.size ?? 0);

    /** Destino y motivo de no unir (null si la unión es decisiva). */
    const decidirUnion = (rs: string[]): string | null => {
      if (rs.length !== 2) return 'mas_de_dos_raices';
      const [a, b] = rs;
      const pa = this.personas.get(a)!;
      const pb = this.personas.get(b)!;
      if (pa.g && pb.g && pa.g !== pb.g) return 'genero';
      if (pa.pais && pb.pais && pa.pais !== pb.pais) return 'pais';
      if (pa.anio && pb.anio && Math.abs(pa.anio - pb.anio) > 1) return 'nacimiento';
      if (identDe(a, 'fie_addr_id') && identDe(b, 'fie_addr_id')) return 'dos_fie';
      if (rechazos.has(`${a}|${b}`)) return 'rechazo_previo';
      const ca = todasLasPruebas(a);
      for (const c of todasLasPruebas(b)) if (ca.has(c)) return 'coinciden_en_prueba';
      const rel = mejorRelacion(publicados(a), publicados(b));
      if (!rel) return 'sin_nombre';
      const nivel = nivelUnion(rel.relacion);
      if (nivel !== 'libre' && nivel !== 'pista') return `nombre_${rel.relacion}`;
      return null;
    };

    const unidas = new Set<string>();
    for (const esquema of ['rfee_license', 'fie_addr_id', 'licencia_engarde', 'licencia_efc']) {
      const ej: Ejemplo[] = [];
      for (const [kv, raices] of porValor) {
        if (!kv.startsWith(`${esquema}|`) || raices.size < 2) continue;
        const valor = kv.slice(esquema.length + 1);
        const rs = [...raices.keys()];
        const motivo = esquema === 'fie_addr_id' ? 'id_fie_repetido' : decidirUnion(rs);
        const decisivo = motivo === null && rs.every((r) => !unidas.has(r));
        if (decisivo) {
          const [destino, origen] = [...rs].sort((x, y) => peso(y) - peso(x) || x.localeCompare(y));
          unidas.add(destino);
          unidas.add(origen);
          this.corregir({
            tipo: 'union_misma_licencia', fila: origen, valor: destino, antes: null,
            motivo: `${evidencia[esquema]}:${valor}`,
          });
        }
        ej.push({
          texto: `${nombres[esquema]} ${valor} en ${rs.length} raíces: ${rs.map((r) => this.persona(r)).join(' | ')}${motivo ? ` (no se une: ${motivo})` : ' → unir'}`,
          ids: rs,
          decisivo,
          peso: rs.reduce((x, r) => x + (this.pruebasRaiz.get(r)?.size ?? 0), 0),
        });
      }
      this.nuevo({
        id: `1a_${esquema}_en_varias_raices`,
        titulo: `Misma ${nombres[esquema]} en dos o más raíces (posible unión que falta)`,
        prioridad: 1,
        afecta: 'perfil partido en dos fichas; rankings y cara a cara repartidos',
        nota: 'Decisivo con nombres compatibles, mismo género y país, nacimientos a ≤1 año, sin coincidir en ninguna prueba ni rechazo previo. Si coinciden en una prueba o el nombre no casa, son personas distintas con la misma referencia (licencia reasignada, hermanas en el mismo fichero).',
      }, ej);
    }

    for (const esquema of ['rfee_license', 'fie_addr_id', 'licencia_engarde', 'licencia_efc']) {
      const ej: Ejemplo[] = [];
      for (const [r, pr] of porRaiz) {
        const vals = pr.get(esquema);
        if (!vals || vals.size < 2) continue;
        const temporadas = [...vals.values()];
        // Una licencia nueva en otra temporada es un cambio de licencia, no otra persona.
        const simultaneas = esquema === 'fie_addr_id'
          || temporadas.some((x, i) => temporadas.slice(i + 1).some((y) => [...x].some((t) => t && y.has(t))));
        if (esquema === 'rfee_license' && !simultaneas) continue;
        const nombresMiembros = new Set((this.miembros.get(r) ?? []).map((m) => this.personas.get(m)!.nn));
        ej.push({
          texto: `${this.persona(r)} con ${vals.size} ${nombres[esquema]}: ${[...vals.keys()].join(', ')}${simultaneas ? ' (en la misma temporada)' : ''}`
            + `${nombresMiembros.size > 1 ? `; nombres de sus fichas: ${[...nombresMiembros].slice(0, 4).join(' / ')}` : ''}`,
          ids: [r],
          decisivo: false,
          peso: (simultaneas ? 1000 : 0) + (this.pruebasRaiz.get(r)?.size ?? 0) + nombresMiembros.size * 10,
        });
      }
      this.nuevo({
        id: `1b_${esquema}_varias_en_una_raiz`,
        titulo: `Raíz con dos o más ${nombres[esquema]} distintas${esquema === 'rfee_license' ? ' en la misma temporada' : ''} (posible unión indebida)`,
        prioridad: esquema === 'licencia_efc' ? 3 : 1,
        afecta: 'perfil que mezcla dos personas',
        nota: esquema === 'rfee_license'
          ? 'Se excluyen los cambios de licencia en temporadas distintas.'
          : esquema === 'fie_addr_id'
            ? 'La FIE a veces duplica la ficha de un tirador (cambio de nación, alta repetida): revisar fecha de nacimiento y nación.'
            : esquema === 'licencia_efc'
              ? 'La EFC cambió de numeración (00850982 → 411532): dos licencias en una raíz es lo normal; sólo es indicio con nombres o años discordantes.'
              : 'Las licencias de fichero Engarde cambian entre torneos; sólo es indicio si los nombres o años no casan.',
      }, ej);
    }
  }

  // 2) Género.
  genero(): void {
    const conflicto: Ejemplo[] = [];
    const minoria: Ejemplo[] = [];

    // 2c primero: las pruebas sospechosas no cuentan para decidir el género de una ficha.
    const pruebasMal: Ejemplo[] = [];
    for (const [c, xs] of this.puestosPorPrueba) {
      const p = this.pruebas.get(c);
      if (!p || p.f !== 'INDIVIDUAL' || (p.g !== 'M' && p.g !== 'F')) continue;
      const otro = p.g === 'M' ? 'F' : 'M';
      const raices = new Set(xs.map((x) => this.raiz(x.p)).filter((r): r is string => !!r));
      let votosOtro = 0;
      let votosMismo = 0;
      let soloEsta = 0;
      for (const r of raices) {
        const e = this.generosDe(r, c);
        if (e.M + e.F === 0) { soloEsta += 1; continue; }
        if (e[otro] > e[p.g as 'M' | 'F']) votosOtro += 1;
        else if (e[otro] < e[p.g as 'M' | 'F']) votosMismo += 1;
      }
      if (votosOtro + votosMismo < 3 || votosOtro * 4 <= (votosOtro + votosMismo) * 3) continue;
      this.pruebasSospechosas.add(c);
      const clave = generoDeClave(p.k, p.w);
      const decisivo = clave === otro;
      if (decisivo) {
        this.corregir({ tipo: 'genero_prueba', fila: c, valor: otro, antes: p.g, motivo: `${p.k}: código ${otro}, ${votosOtro} de ${votosOtro + votosMismo} tiradores son ${otro} en sus otras pruebas` });
        for (const r of raices) {
          const e = this.generosDe(r, c);
          const pr = this.personas.get(r)!;
          if (pr.g !== p.g || e[p.g as 'M' | 'F'] > 0 || this.generoCorregido.has(r)) continue;
          this.generoCorregido.add(r);
          for (const m of this.miembros.get(r) ?? [r]) {
            if (this.personas.get(m)!.g === p.g) {
              this.corregir({ tipo: 'genero_ficha', fila: m, valor: otro, antes: p.g, motivo: `${this.nombre(m)}: creada desde ${p.k}, sin otras pruebas ${p.g}` });
            }
          }
        }
        // Fichas fundidas con el género de la prueba en raíces que ya son del otro género.
        for (const x of xs) {
          const r = this.raiz(x.p);
          if (!x.p || !r || x.p === r || this.personas.get(r)!.g !== otro || this.personas.get(x.p)!.g !== p.g) continue;
          if (this.correcciones.some((k) => k.tipo === 'genero_ficha' && k.fila === x.p)) continue;
          this.corregir({ tipo: 'genero_ficha', fila: x.p, valor: otro, antes: p.g, motivo: `${this.nombre(x.p)}: ficha fundida en una raíz ${otro}, creada desde ${p.k}` });
        }
      }
      pruebasMal.push({
        texto: `${this.prueba(c)}: ${votosOtro} tiradores son ${otro} en sus otras pruebas frente a ${votosMismo}; ${soloEsta} sólo tienen esta`
          + `${clave ? `; el código dice ${clave}` : ''}${decisivo ? ` → pasa a ${otro}` : ''}`,
        ids: [c],
        decisivo,
        peso: votosOtro,
      });
    }

    for (const [r, cs] of this.pruebasRaiz) {
      const e = this.generosDe(r);
      const g = this.personas.get(r)?.g ?? null;
      if (e.M && e.F) {
        const menor = e.M < e.F ? 'M' : 'F';
        const ejs = [...cs].filter((c) => this.pruebas.get(c)!.g === menor).slice(0, 2);
        conflicto.push({
          texto: `${this.persona(r)}: ${e.M} pruebas M y ${e.F} F; en ${menor}: ${ejs.map((c) => `${this.prueba(c)}${this.pruebasSospechosas.has(c) ? ' [prueba sospechosa 2c]' : ''}`).join('; ')}`,
          ids: [r, ...ejs],
          decisivo: [...cs].filter((c) => this.pruebas.get(c)!.g === menor)
            .every((c) => this.correcciones.some((k) => k.tipo === 'genero_prueba' && k.fila === c)),
          peso: Math.min(e.M, e.F) * 100 + e.M + e.F,
        });
      }
      const total = e.M + e.F;
      const mayoria = e.M > e.F ? 'M' : e.F > e.M ? 'F' : null;
      if (g && mayoria && g !== mayoria && total >= 2) {
        const limpias = [...cs].every((c) => !this.pruebasSospechosas.has(c));
        const decisivo = limpias && total >= 3 && e[g as 'M' | 'F'] === 0 && !this.generoCorregido.has(r);
        if (decisivo) {
          this.generoCorregido.add(r);
          for (const m of this.miembros.get(r) ?? [r]) {
            if (this.personas.get(m)!.g === g) {
              this.corregir({ tipo: 'genero_ficha', fila: m, valor: mayoria, antes: g, motivo: `${this.nombre(m)}: sus ${total} pruebas individuales son ${mayoria}` });
            }
          }
        }
        minoria.push({
          texto: `${this.persona(r)} es ${g} pero ${Math.max(e.M, e.F)} de ${total} pruebas son ${mayoria}${decisivo ? ` → pasa a ${mayoria}` : ''}`,
          ids: [r],
          decisivo,
          peso: Math.max(e.M, e.F) * 10 - Math.min(e.M, e.F),
        });
      }
    }
    this.nuevo({
      id: '2a_raiz_en_pruebas_m_y_f',
      titulo: 'Raíz con puestos en pruebas individuales masculinas y femeninas',
      prioridad: 1,
      afecta: 'perfil con resultados del otro género (unión indebida o prueba mal etiquetada)',
      nota: 'Hay participaciones reales de mujeres en pruebas masculinas (veteranos, provinciales, pruebas abiertas). Decisivo sólo cuando todas las pruebas del género minoritario son pruebas mal etiquetadas que se corrigen (2c).',
    }, conflicto);
    this.nuevo({
      id: '2b_genero_contra_sus_pruebas',
      titulo: 'Persona cuyo género es distinto del de la mayoría de sus pruebas',
      prioridad: 1,
      afecta: 'filtros y rankings por género del perfil',
      nota: 'Decisivo con 3 o más pruebas, todas del otro género y ninguna sospechosa (2c).',
    }, minoria);
    this.nuevo({
      id: '2c_prueba_contra_sus_tiradores',
      titulo: 'Prueba cuyo género contradice a más de 3/4 de sus tiradores (por sus otras pruebas)',
      prioridad: 1,
      afecta: 'ficha de prueba, filtros por género y género de las fichas creadas desde ella',
      nota: 'Lote 11 corrigió 619/CTOESP-EFCATI y 824/FIESTA_SF-12. Decisivo si además el código de la prueba dice el otro género con la misma arma.',
    }, pruebasMal);
  }

  // 3) Edad imposible en la categoría.
  edad(): void {
    const ej: Ejemplo[] = [];
    const porRaiz = new Map<string, number>();
    const comodinMal = new Set<string>();
    for (const [c, xs] of this.puestosPorPrueba) {
      const p = this.pruebas.get(c);
      if (!p || p.f !== 'INDIVIDUAL') continue;
      const fin = anioFinTemporada(p.season);
      if (!fin) continue;
      const malas: { x: Puesto; motivo: string; r: string }[] = [];
      let validas = 0;
      for (const x of xs) {
        const r = this.raiz(x.p);
        const anio = r ? this.personas.get(r)?.anio : null;
        if (!r || !anio) continue;
        validas += 1;
        const motivo = edadImposible(p.cat, fin - anio);
        if (motivo) malas.push({ x, motivo, r });
      }
      for (const m of malas) {
        porRaiz.set(m.r, (porRaiz.get(m.r) ?? 0) + 1);
        const raizAnio = this.personas.get(m.r)?.anio ?? null;
        const comodin = raizAnio === ANIO_COMODIN;
        if (comodin) comodinMal.add(m.r);
        ej.push({
          texto: `${this.persona(m.r)} ${m.motivo} en ${this.prueba(c)}; puesto ${m.x.pos ?? '?'} «${m.x.n}» (${m.x.src})`
            + `${m.x.p !== m.r ? ` vía ficha ${corto(m.x.p)}` : ''}`
            + `${comodin ? ' [año comodín FIE 1920 → se borra]' : ''}`
            + `${malas.length > validas / 2 ? ' [la mayoría de la prueba tampoco cuadra: categoría mal puesta]' : ''}`,
          ids: [m.r, m.x.id, c],
          decisivo: comodin,
          peso: Math.abs(fin - (raizAnio ?? fin) - (CATEGORIA_MAX[p.cat] ?? 40)) + (malas.length > validas / 2 ? -100 : 0),
        });
      }
    }
    for (const r of comodinMal) {
      this.corregir({ tipo: 'anio_comodin', fila: r, valor: '', antes: String(ANIO_COMODIN), motivo: `${this.nombre(r)}: 1920 choca con la categoría de sus pruebas` });
    }
    const otrasConComodin = [...this.miembros.keys()].filter((r) => this.personas.get(r)!.anio === ANIO_COMODIN && !comodinMal.has(r));
    const sinComodin = new Set([...porRaiz.keys()].filter((r) => !comodinMal.has(r)));
    this.nuevo({
      id: '3_edad_imposible_en_categoria',
      titulo: `Año de nacimiento incompatible con la categoría (tolerancia ${TOLERANCIA_EDAD} años; VET desde ${EDAD_MIN_VET})`,
      prioridad: 2,
      afecta: 'perfil con un resultado de otra persona (homónimo) o año de nacimiento erróneo (visible y usado para la privacidad)',
      nota: `Afecta a ${porRaiz.size} raíces: ${comodinMal.size} con el año comodín 1920 (decisivo, se borra) y ${sinComodin.size} con otro año (revisión: año de nacimiento erróneo en la FIE o puesto de un homónimo). Otras ${otrasConComodin.length} raíces tienen 1920 sin contradicción visible (revisión).`,
    }, ej);
  }

  // 4) Puestos, asaltos y clasificaciones.
  estructura(): void {
    const dobles: Ejemplo[] = [];
    for (const [c, xs] of this.puestosPorPrueba) {
      const p = this.pruebas.get(c);
      if (!p || p.f !== 'INDIVIDUAL') continue;
      const porR = new Map<string, Puesto[]>();
      for (const x of xs) {
        const r = this.raiz(x.p);
        if (r) (porR.get(r) ?? porR.set(r, []).get(r)!).push(x);
      }
      for (const [r, ys] of porR) {
        if (ys.length < 2) continue;
        const ordenadas = [...ys].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
        const copias = ordenadas.slice(1).filter((y) =>
          y.src === ordenadas[0].src && y.pos === ordenadas[0].pos && y.n === ordenadas[0].n);
        for (const y of copias) {
          this.corregir({ tipo: 'puesto_duplicado_misma_fuente', fila: y.id, valor: ordenadas[0].id, antes: null, motivo: `${p.k}: «${y.n}» puesto ${y.pos ?? '?'} repetido` });
        }
        dobles.push({
          texto: `${this.persona(r)} en ${ys.length} puestos de ${this.prueba(c)}: ${ys.map((y) => `${y.pos ?? '?'} «${y.n}» (${y.src}, ${corto(y.p)})`).join('; ')}`,
          ids: [r, c, ...ys.map((y) => y.id)],
          decisivo: copias.length === ys.length - 1,
          peso: 100 - Math.min(...ys.map((y) => y.pos ?? 99)),
        });
      }
    }
    this.nuevo({
      id: '4a_raiz_en_dos_puestos',
      titulo: 'Misma raíz en dos puestos de una prueba individual',
      prioridad: 1,
      afecta: 'perfil (resultado repetido o puesto de otra persona) y medallero',
      nota: 'Decisivo sólo si es una copia exacta (misma fuente, puesto y nombre); si no, suele ser una unión indebida de dos tiradores de la prueba.',
    }, dobles);

    const contraSi: Ejemplo[] = [];
    const marcadores = new Map<string, Ejemplo[]>();
    const marcadoresN = new Map<string, number>();
    const duplicados: Ejemplo[] = [];
    let dupN = 0;
    let dupDecisivos = 0;
    let asaltos = 0;
    type Visto = { id: string; src: string; rk: string; sa: number; sb: number; largo: number };
    const vistos = new Map<string, Visto>();
    let compActual = '';
    const nombresPuesto = (c: string, r: string) =>
      new Set((this.puestosPorPrueba.get(c) ?? []).filter((x) => this.raiz(x.p) === r).map((x) => x.n.toLowerCase()));
    for (const b of this.db.prepare(
      `SELECT id, competition_id c, phase f, round_key rk, fencer_a_person_id ap, fencer_b_person_id bp,
              fencer_a_name an, fencer_b_name bn, score_a sa, score_b sb, source src
         FROM sport_bout ORDER BY competition_id`,
    ).iterate() as Iterable<{
      id: string; c: string; f: string; rk: string; ap: string | null; bp: string | null;
      an: string; bn: string; sa: number; sb: number; src: string;
    }>) {
      asaltos += 1;
      if (b.c !== compActual) { vistos.clear(); compActual = b.c; }
      const p = this.pruebas.get(b.c);
      const ra = this.raiz(b.ap);
      const rb = this.raiz(b.bp);
      if (ra && ra === rb) {
        const nombres = nombresPuesto(b.c, ra);
        const casaA = nombres.has(b.an.toLowerCase());
        const casaB = nombres.has(b.bn.toLowerCase());
        const lados = casaA === casaB ? ['a', 'b'] : casaA ? ['b'] : ['a'];
        for (const l of lados) {
          this.corregir({ tipo: 'asalto_contra_si_mismo', fila: b.id, valor: l, antes: l === 'a' ? b.ap : b.bp, motivo: `${p?.k ?? b.c} ${b.f} ${b.rk}: «${b.an}» contra «${b.bn}» en ${corto(ra)}` });
        }
        contraSi.push({
          texto: `${this.persona(ra)} contra sí mismo en ${this.prueba(b.c)} ${b.f} ${b.rk}: «${b.an}» ${b.sa}-${b.sb} «${b.bn}»`,
          ids: [ra, b.id, b.c],
          decisivo: true,
          peso: 1,
        });
      }
      if (p) {
        const m = marcadorImposible(p.f, b.f, b.sa, b.sb);
        if (m) {
          const k = `${p.f}:${m}`;
          marcadoresN.set(k, (marcadoresN.get(k) ?? 0) + 1);
          const l = marcadores.get(k) ?? marcadores.set(k, []).get(k)!;
          if (l.length < MAX_EJEMPLOS) {
            l.push({ texto: `${this.prueba(b.c)} ${b.f} ${b.rk}: «${b.an}» ${b.sa}-${b.sb} «${b.bn}» (${b.src})`, ids: [b.id, b.c], decisivo: false, peso: Math.max(b.sa, b.sb) });
          }
        }
      }
      if (ra && rb && ra !== rb) {
        const [sa, sb] = ra < rb ? [b.sa, b.sb] : [b.sb, b.sa];
        const par = ra < rb ? `${ra}|${rb}` : `${rb}|${ra}`;
        const clave = b.f === 'POULE' ? `P|${b.rk}|${par}` : `T|${par}`;
        const actual: Visto = { id: b.id, src: b.src, rk: b.rk, sa, sb, largo: b.an.length + b.bn.length };
        const otro = vistos.get(clave);
        if (otro) {
          dupN += 1;
          const misma = otro.src === actual.src && otro.rk === actual.rk && otro.sa === actual.sa && otro.sb === actual.sb;
          if (misma) {
            dupDecisivos += 1;
            const [borra, queda] = actual.largo > otro.largo ? [otro, actual] : [actual, otro];
            this.corregir({ tipo: 'asalto_leido_dos_veces', fila: borra.id, valor: queda.id, antes: null, motivo: `${p?.k ?? b.c} ${b.f} ${b.rk}: ${corto(ra)} contra ${corto(rb)} ${sa}-${sb}` });
            if (queda === actual) vistos.set(clave, actual);
          }
          if (duplicados.length < 3000) {
            duplicados.push({
              texto: `${this.persona(ra)} contra ${this.persona(rb)} dos veces en ${this.prueba(b.c)} ${b.f}: ${otro.rk} ${otro.sa}-${otro.sb} [${corto(otro.id)}] y ${actual.rk} ${sa}-${sb} [${corto(b.id)}]${misma ? ' → misma lectura repetida, se borra una' : ''}`,
              ids: [otro.id, b.id, b.c],
              decisivo: misma,
              peso: b.f === 'TABLEAU' ? 2 : 1,
            });
          }
        } else vistos.set(clave, actual);
      }
    }
    this.totales.asaltos = asaltos;
    this.nuevo({
      id: '4b_asalto_contra_si_mismo',
      titulo: 'Asalto con la misma raíz en los dos lados',
      prioridad: 1,
      afecta: 'cara a cara y balance de victorias del perfil',
      nota: 'Decisivo: se quita la persona del lado que no casa con su puesto en la prueba (o de los dos).',
    }, contraSi);
    const dupH = this.nuevo({
      id: '4c_asalto_duplicado',
      titulo: 'El mismo par de raíces dos veces en la misma poule o en el cuadro de una prueba',
      prioridad: 1,
      afecta: 'cara a cara (asalto contado dos veces) y estadísticas de rivales',
      nota: 'Decisivo si es la misma lectura repetida (misma fuente, ronda y marcador): el PDF repite el cuadro con nombres recortados. Con otra ronda u otro marcador puede ser una repesca o un error de lectura: revisión.',
    }, duplicados, dupN);
    dupH.decisivos = dupDecisivos;
    dupH.revision = dupN - dupDecisivos;
    for (const [k, l] of [...marcadores].sort()) {
      const empate = k.includes('empate') || k.includes('cero');
      this.nuevo({
        id: `4d_marcador_${k.toLowerCase().replace(':', '_')}`,
        titulo: `Marcador imposible o sin ganador: ${k}`,
        prioridad: empate ? 3 : 2,
        afecta: empate
          ? 'el cara a cara descarta los empates; el asalto se ve sin ganador en la ficha de la prueba'
          : 'ficha de la prueba y tantos a favor/en contra del perfil',
        nota: empate
          ? 'No hay campo de prioridad: un empate en individual no tiene ganador registrado (0-0 suele ser un abandono o exento). Revisión de la lectura.'
          : 'Errata de la fuente (FIE 0-1512) o asalto de equipos (a 45) cargado en una prueba individual. Revisión de la lectura.',
      }, l, marcadoresN.get(k) ?? l.length);
    }

    const huecos: Ejemplo[] = [];
    const centinelas: Ejemplo[] = [];
    const cobertura = new Map<string, string>();
    for (const r of this.db.prepare(
      `SELECT competition_id c, group_concat(DISTINCT status) s FROM sport_import_coverage WHERE competition_id IS NOT NULL GROUP BY competition_id`,
    ).iterate() as Iterable<{ c: string; s: string }>) cobertura.set(r.c, r.s);
    let huecosN = 0;
    let dosGanadores = 0;
    let centinelasN = 0;
    for (const [c, xs] of this.puestosPorPrueba) {
      const p = this.pruebas.get(c);
      if (!p || p.f !== 'INDIVIDUAL') continue;
      const cen = xs.filter((x) => x.pos !== null && x.pos >= PUESTO_CENTINELA);
      centinelasN += cen.length;
      if (cen.length && centinelas.length < 200) {
        centinelas.push({ texto: `${this.prueba(c)}: ${cen.length} puestos ${[...new Set(cen.map((x) => x.pos))].join('/')} (p. ej. «${cen[0].n}»)`, ids: [c], decisivo: false, peso: cen.length });
      }
      const pos = xs.map((x) => x.pos).filter((x): x is number => x !== null && x < PUESTO_CENTINELA);
      if (pos.length < 4) continue;
      const h = huecosClasificacion(pos);
      if (h.primera === 1 && h.huecos === 0 && h.ganadores <= 1) continue;
      huecosN += 1;
      if (h.ganadores > 1) dosGanadores += 1;
      const cob = cobertura.get(c) ?? 'sin cobertura';
      huecos.push({
        texto: `${this.prueba(c)}: ${pos.length} puestos, empieza en ${h.primera}, ${h.huecos} huecos${h.ganadores > 1 ? `, ${h.ganadores} primeros` : ''}; cobertura ${cob}`,
        ids: [c],
        decisivo: false,
        peso: (h.ganadores > 1 ? 1000 : 0) + (h.primera !== 1 ? 500 : 0) + (cob.includes('parcial') ? 0 : 100) + Math.min(h.huecos, 99),
      });
    }
    this.nuevo({
      id: '4e_clasificacion_con_huecos',
      titulo: 'Clasificación individual que no empieza en 1, con huecos tras los empates o con varios primeros',
      prioridad: 2,
      afecta: 'ficha de la prueba y medallas del perfil',
      nota: `${dosGanadores} con más de un primero (dos oros visibles). Los huecos son normales en pruebas parciales (cobertura parcial, PDF con páginas sin leer, Skermo con sólo españoles en pruebas internacionales). Se ignoran los puestos ≥ ${PUESTO_CENTINELA}.`,
    }, huecos, huecosN);
    this.nuevo({
      id: '4g_puesto_centinela',
      titulo: `Puestos ≥ ${PUESTO_CENTINELA} (excluidos o no clasificados de la FIE)`,
      prioridad: 2,
      afecta: 'el perfil puede mostrar «puesto 9999»',
      nota: 'Revisar cómo los pinta la app; no son puestos reales.',
    }, centinelas, centinelasN);

    const rankings: Ejemplo[] = [];
    for (const r of this.db.prepare(
      `SELECT e.publication_id pub, coalesce(p.merged_into_person_id, p.id) raiz, count(*) n, group_concat(e.position) pos, group_concat(e.source_name, ' / ') nombres,
              pub.source src, pub.season season, pub.weapon w, pub.gender g, pub.category cat
         FROM sport_ranking_entry e JOIN sport_person p ON p.id = e.person_id JOIN sport_ranking_publication pub ON pub.id = e.publication_id
        GROUP BY e.publication_id, raiz HAVING count(*) > 1`,
    ).iterate() as Iterable<{ pub: string; raiz: string; n: number; pos: string; nombres: string; src: string; season: string; w: string; g: string; cat: string }>) {
      rankings.push({
        texto: `${this.persona(r.raiz)} ${r.n} veces en el ranking ${r.src} ${r.season} ${r.w} ${r.g} ${r.cat} [${corto(r.pub)}]: puestos ${r.pos} («${r.nombres}»)`,
        ids: [r.raiz, r.pub],
        decisivo: false,
        peso: 100 - Math.min(...String(r.pos).split(',').map(Number)),
      });
    }
    this.nuevo({
      id: '4f_raiz_dos_veces_en_un_ranking',
      titulo: 'Misma raíz en dos entradas de una publicación de ranking',
      prioridad: 1,
      afecta: 'ranking (la persona sale dos veces, con dos puestos)',
      nota: 'Unión indebida de dos tiradores del ranking o entrada repetida en la fuente.',
    }, rankings);
  }

  // 5) Pruebas duplicadas, vacías y cobertura sin resultados.
  pruebasDuplicadas(): void {
    const conjuntas = new Set<string>();
    const hayConjuntas = !!this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sport_competition_combined'`).get();
    for (const r of (hayConjuntas ? this.db.prepare(`SELECT part_competition_id a, combined_competition_id b FROM sport_competition_combined`).all() : []) as { a: string; b: string }[]) {
      conjuntas.add(`${r.a}|${r.b}`);
      conjuntas.add(`${r.b}|${r.a}`);
    }
    const raicesDe = new Map<string, Set<string>>();
    for (const [c, xs] of this.puestosPorPrueba) {
      const s = new Set<string>();
      for (const x of xs) { const r = this.raiz(x.p); if (r) s.add(r); }
      if (s.size >= 4) raicesDe.set(c, s);
    }
    const dia = (f: string | null) => (f && /^\d{4}-\d{2}-\d{2}/.test(f) ? Date.parse(f.slice(0, 10)) / 86400000 : null);
    const grupos = new Map<string, { c: string; d: number }[]>();
    for (const p of this.pruebas.values()) {
      const d = dia(p.fecha);
      if (d === null || !raicesDe.has(p.id)) continue;
      const k = `${p.w}|${p.g}|${p.cat}|${p.f}`;
      (grupos.get(k) ?? grupos.set(k, []).get(k)!).push({ c: p.id, d });
    }
    const ej: Ejemplo[] = [];
    const nacionales = new Set(['rfee_pdf', 'skermo_rfee', 'engarde']);
    for (const xs of grupos.values()) {
      xs.sort((a, b) => a.d - b.d);
      for (let i = 0; i < xs.length; i += 1) {
        for (let j = i + 1; j < xs.length && xs[j].d - xs[i].d <= 3; j += 1) {
          const a = xs[i].c;
          const b = xs[j].c;
          if (conjuntas.has(`${a}|${b}`)) continue;
          const ra = raicesDe.get(a)!;
          const rb = raicesDe.get(b)!;
          const [menor, mayor] = ra.size <= rb.size ? [ra, rb] : [rb, ra];
          let comun = 0;
          for (const r of menor) if (mayor.has(r)) comun += 1;
          if (comun * 2 < menor.size) continue;
          const pa = this.pruebas.get(a)!;
          const pb = this.pruebas.get(b)!;
          const tipo = pa.src === pb.src ? 'misma fuente'
            : nacionales.has(pa.src) && nacionales.has(pb.src) ? (xs[j].d - xs[i].d > 2 ? 'nacionales a 3 días (fuera de la ventana de dedupe-pruebas)' : 'nacionales no fundidas')
              : 'internacional y nacional';
          ej.push({
            texto: `${this.prueba(a)} ≈ ${this.prueba(b)}: ${comun} de ${menor.size} tiradores en común (${ra.size}/${rb.size}) [${tipo}]`,
            ids: [a, b],
            decisivo: false,
            peso: comun + (tipo.startsWith('nacionales') ? 1000 : 0) + (comun === menor.size ? 500 : 0),
          });
        }
      }
    }
    this.nuevo({
      id: '5a_pruebas_duplicadas',
      titulo: 'Pruebas probablemente duplicadas (±3 días, misma arma, género, categoría y formato, mitad de tiradores en común)',
      prioridad: 1,
      afecta: 'perfil con el mismo resultado dos veces; ficha de evento duplicada',
      nota: 'dedupe-pruebas.ts sólo funde rfee_pdf, skermo_rfee y engarde a ±2 días: las nacionales a 3 días son las que se escapan. Internacional y nacional: Skermo publica a los españoles de pruebas FIE en España (mismo evento en dos fuentes, puestos distintos). Misma fuente: fases o pruebas hermanas. Revisión.',
    }, ej);

    const vacias = this.db.prepare(
      `SELECT e.id, e.source, e.season, e.name FROM sport_edition e WHERE NOT EXISTS (SELECT 1 FROM sport_competition c WHERE c.edition_id = e.id)`,
    ).all() as { id: string; source: string; season: string; name: string }[];
    this.nuevo({
      id: '5b_ediciones_vacias',
      titulo: 'Ediciones sin pruebas',
      prioridad: 3,
      afecta: 'nada visible salvo listados de eventos',
      nota: 'borrarEdicionesVacias() de unificar-personas.ts las borra en el siguiente lote.',
    }, vacias.map((e) => ({ texto: `${e.name} (${e.source} ${e.season}) [${corto(e.id)}]`, ids: [e.id], decisivo: false, peso: 0 })));

    const asaltosPorPrueba = new Map<string, number>();
    for (const r of this.db.prepare(`SELECT competition_id c, count(*) n FROM sport_bout GROUP BY competition_id`).all() as { c: string; n: number }[]) {
      asaltosPorPrueba.set(r.c, Number(r.n));
    }
    const sinNada: Ejemplo[] = [];
    for (const p of this.pruebas.values()) {
      if ((this.puestosPorPrueba.get(p.id)?.length ?? 0) === 0 && !asaltosPorPrueba.has(p.id)) {
        sinNada.push({ texto: `${this.prueba(p.id)} ${p.f}`, ids: [p.id], decisivo: false, peso: p.fecha && p.fecha > new Date().toISOString().slice(0, 10) ? -1 : 0 });
      }
    }
    const futuras = sinNada.filter((e) => e.peso < 0).length;
    this.nuevo({
      id: '5c_pruebas_vacias',
      titulo: 'Pruebas sin puestos ni asaltos',
      prioridad: 2,
      afecta: 'ficha de prueba vacía en el evento',
      nota: `${futuras} son futuras (calendario FIE). El resto: la carga falló o la fuente no publicó nada (equipos de PDF sin cuadro).`,
    }, sinNada);

    const completas: Ejemplo[] = [];
    for (const r of this.db.prepare(
      `SELECT v.competition_id c, v.fact_kind k, v.published_total t, v.source s FROM sport_import_coverage v
        WHERE v.status = 'completo' AND v.competition_id IS NOT NULL AND v.fact_kind IN ('results', 'pdf')`,
    ).iterate() as Iterable<{ c: string; k: string; t: number | null; s: string }>) {
      const n = this.puestosPorPrueba.get(r.c)?.length ?? 0;
      if (n === 0) {
        completas.push({ texto: `${this.prueba(r.c)}: cobertura ${r.k} completo (${r.s}, publicados ${r.t ?? '?'}) sin puestos`, ids: [r.c], decisivo: false, peso: r.t ?? 0 });
      }
    }
    const completasPools: Ejemplo[] = [];
    for (const r of this.db.prepare(
      `SELECT v.competition_id c, v.fact_kind k, v.source s FROM sport_import_coverage v
        WHERE v.status = 'completo' AND v.competition_id IS NOT NULL AND v.fact_kind IN ('pools', 'tableau')`,
    ).iterate() as Iterable<{ c: string; k: string; s: string }>) {
      if (!asaltosPorPrueba.has(r.c)) completasPools.push({ texto: `${this.prueba(r.c)}: cobertura ${r.k} completo (${r.s}) sin asaltos`, ids: [r.c], decisivo: false, peso: 0 });
    }
    this.nuevo({
      id: '5d_cobertura_completa_sin_puestos',
      titulo: 'Cobertura de clasificación «completo» en una prueba sin puestos',
      prioridad: 2,
      afecta: 'la prueba no se vuelve a cargar aunque esté vacía',
      nota: 'Revisión: pasar a «pendiente» para que el siguiente lote la recargue.',
    }, completas);
    this.nuevo({
      id: '5e_cobertura_completa_sin_asaltos',
      titulo: 'Cobertura de poules o cuadro «completo» en una prueba sin asaltos',
      prioridad: 3,
      afecta: 'la prueba no se vuelve a leer aunque no tenga asaltos',
      nota: 'Revisión: pasar a «pendiente».',
    }, completasPools);
  }

  // 6) Uniones sospechosas.
  uniones(): void {
    const evidencia = new Map<string, string[]>();
    for (const c of this.db.prepare(
      `SELECT source_ref o, source s, evidence e FROM sport_link_candidate WHERE status = 'CONFIRMADO' AND source NOT IN ('engarde', 'efc', 'rfee_pdf')`,
    ).iterate() as Iterable<{ o: string; s: string; e: string | null }>) {
      (evidencia.get(c.o) ?? evidencia.set(c.o, []).get(c.o)!).push(`${c.s}:${c.e ?? ''}`);
    }
    const conIdentidad = new Set<string>();
    for (const r of this.db.prepare(
      `SELECT DISTINCT person_id p FROM sport_external_id WHERE link_status = 'CONFIRMADO' AND person_id IS NOT NULL`,
    ).all() as { p: string }[]) conIdentidad.add(r.p);
    const efcLicencia = new Set<string>();
    for (const r of this.db.prepare(`SELECT DISTINCT person_id p FROM sport_person_alias WHERE source = 'efc_licencia'`).all() as { p: string }[]) {
      efcLicencia.add(r.p);
    }
    const aniosDe = (id: string) => {
      const p = this.personas.get(id)!;
      const s = new Set<number>();
      if (p.anio && p.anio !== ANIO_COMODIN) s.add(p.anio);
      for (const f of this.nacimientos.get(id) ?? []) if (f !== FECHA_COMODIN) s.add(Number(f.slice(0, 4)));
      return s;
    };
    const lejos = (a: Set<number>, b: Set<number>) => a.size > 0 && b.size > 0 && [...a].every((x) => [...b].every((y) => Math.abs(x - y) > 2));
    const anioActual = new Date().getUTCFullYear();
    const nacimientos: Ejemplo[] = [];
    const paises: Ejemplo[] = [];
    const generos: Ejemplo[] = [];
    for (const [r, ms] of this.miembros) {
      if (ms.length < 2) continue;
      const raiz = this.personas.get(r)!;
      const deRaiz = aniosDe(r);
      const conAnio = ms.map((m) => ({ p: this.personas.get(m)!, a: aniosDe(m) })).filter((x) => x.a.size > 0);
      const todos = conAnio.flatMap((x) => [...x.a]);
      if (todos.length >= 2 && Math.max(...todos) - Math.min(...todos) > 2) {
        const menor = todos.some((a) => anioActual - a <= 18);
        const separables: string[] = [];
        for (const { p, a } of conAnio) {
          if (p.id === r || !lejos(a, deRaiz)) continue;
          const ev = evidencia.get(p.id) ?? [];
          const decisiva = ev.some((e) => /misma_licencia|misma_fecha|fecha_nacimiento|cuadro|fusion_evidencia:fie/.test(e) || e.includes(FUSION_REVISION_MANUAL));
          if (decisiva || conIdentidad.has(p.id) || efcLicencia.has(p.id)) continue;
          separables.push(p.id);
          this.corregir({
            tipo: 'fusion_nacimiento_incompatible', fila: p.id, valor: r, antes: r,
            motivo: `${p.n} (${[...a].join('/')}) fundida en ${raiz.n} (${[...deRaiz].join('/')}) sin prueba decisiva (${ev.join(', ') || 'sin candidato'})`,
          });
        }
        nacimientos.push({
          texto: `${this.persona(r)}: fichas con años ${conAnio.map((x) => `${[...x.a].join('/')} «${x.p.n}» ${corto(x.p.id)}`).join(', ')}`
            + `${menor ? ' [posible menor mezclado]' : ''}${separables.length ? ` → se separa: ${separables.map(corto).join(', ')}` : ''}`,
          ids: [r, ...conAnio.map((x) => x.p.id)],
          decisivo: separables.length > 0,
          peso: Math.max(...todos) - Math.min(...todos) + (menor ? 100 : 0),
        });
      }
      const ps = new Set(ms.map((m) => this.personas.get(m)!.pais).filter(Boolean));
      if (ps.size > 1) {
        paises.push({
          texto: `${this.persona(r)}: países ${[...ps].join(', ')} en ${ms.length} fichas (${ms.slice(0, 4).map((m) => `«${this.nombre(m)}» ${this.personas.get(m)!.pais ?? '-'}`).join(', ')})`,
          ids: [r, ...ms],
          decisivo: false,
          peso: ms.length,
        });
      }
      const gs = new Set(ms.map((m) => this.personas.get(m)!.g).filter(Boolean));
      if (gs.size > 1) {
        const arreglada = ms.every((m) => {
          const p = this.personas.get(m)!;
          return p.g === raiz.g || this.correcciones.some((c) => c.tipo === 'genero_ficha' && c.fila === m && c.valor === raiz.g);
        });
        generos.push({
          texto: `${this.persona(r)}: fichas de géneros ${[...gs].join(', ')} (${ms.slice(0, 4).map((m) => `«${this.nombre(m)}» ${this.personas.get(m)!.g ?? '-'}`).join(', ')})${arreglada ? ' → lo corrige genero_ficha' : ''}`,
          ids: [r, ...ms],
          decisivo: arreglada,
          peso: ms.length,
        });
      }
    }
    this.nuevo({
      id: '6a_union_nacimientos_incompatibles',
      titulo: 'Raíz cuyas fichas tienen nacimientos a más de 2 años (año de la ficha, fecha FIE o Skermo)',
      prioridad: 1,
      afecta: 'perfil que mezcla dos personas (y su edad pública; los posibles menores se marcan)',
      nota: 'Decisivo cuando la ficha discordante se fundió sólo por nombre (sin licencia, ID FIE, cuadro, fecha de nacimiento ni revisión manual): se separa. Se ignora el comodín FIE 1920-01-01.',
    }, nacimientos);
    this.nuevo({
      id: '6b_union_paises_distintos',
      titulo: 'Raíz cuyas fichas tienen países distintos',
      prioridad: 2,
      afecta: 'bandera del perfil y filtros por país',
      nota: 'Los cambios de nación existen (FIE); revisar sólo los que además tienen nombres o años discordantes.',
    }, paises);
    this.nuevo({
      id: '6c_union_generos_distintos',
      titulo: 'Raíz cuyas fichas tienen géneros distintos',
      prioridad: 1,
      afecta: 'perfil que puede mezclar a un hombre y una mujer',
      nota: 'Casi todas son fichas creadas desde una prueba mal etiquetada (2c); el lote 11 ya corrigió las de 619/CTOESP-EFCATI y 824/FIESTA_SF-12.',
    }, generos);
  }

  // 7) Nombres visibles e integridad del grafo de uniones.
  integridad(): void {
    const ej: Ejemplo[] = [];
    for (const p of this.personas.values()) {
      if (p.m && !this.personas.has(p.m)) ej.push({ texto: `${this.persona(p.id)} fundida en ${corto(p.m)}, que no existe`, ids: [p.id], decisivo: false, peso: 1 });
      else if (p.m && this.personas.get(p.m)!.m) ej.push({ texto: `${this.persona(p.id)} fundida en otra fundida ${corto(p.m)} (cadena)`, ids: [p.id], decisivo: false, peso: 1 });
    }
    this.nuevo({
      id: '0_cadenas_de_fusion',
      titulo: 'Fusiones que apuntan a una ficha inexistente o a otra fundida',
      prioridad: 1,
      afecta: 'la app sólo resuelve un nivel de fusión',
      nota: 'Debe ser 0.',
    }, ej);
    const moji: Ejemplo[] = [];
    for (const [r] of this.miembros) {
      const p = this.personas.get(r)!;
      if (tieneMojibake(p.n)) moji.push({ texto: `«${p.n}» → «${repararMojibake(p.n)}» [${corto(r)}]`, ids: [r], decisivo: false, peso: this.pruebasRaiz.get(r)?.size ?? 0 });
    }
    this.nuevo({
      id: '7_nombre_con_mojibake',
      titulo: 'Raíz cuyo nombre visible tiene mojibake (UTF-8 leído como Latin-1)',
      prioridad: 2,
      afecta: 'nombre del perfil y búsqueda',
      nota: 'reparar-caracteres.ts decide el nombre bueno con su diccionario; aquí sólo se cuentan (y se reparan para comparar nombres en 1a).',
    }, moji);
  }
}

export function auditarCalidad(
  db: DatabaseSync, base = '', nacimientos: ReadonlyMap<string, readonly string[]> = new Map(),
): InformeCalidad {
  const a = new Auditor(db, nacimientos);
  a.cargar();
  a.integridad();
  a.genero();
  a.identidades();
  a.edad();
  a.estructura();
  a.pruebasDuplicadas();
  a.uniones();
  return {
    base,
    generado: new Date().toISOString(),
    totales: a.totales,
    hallazgos: a.hallazgos,
    correcciones: a.correcciones,
    aplicado: false,
    aplicadas: {},
  };
}

/** Escribe las correcciones decisivas (dentro de la transacción del llamador). Cada una comprueba el estado previo. */
export function escribirCorrecciones(db: DatabaseSync, correcciones: readonly Correccion[]): Record<string, number> {
  const t = ahora();
  const hechas: Record<string, number> = {};
  const sumar = (k: string, n: number | bigint) => { hechas[k] = (hechas[k] ?? 0) + Number(n); };
  const hayPerfil = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'perfil_deportista'`).get();
  const q = {
    ladoA: db.prepare(`UPDATE sport_bout SET fencer_a_person_id = NULL WHERE id = ? AND fencer_a_person_id IS NOT NULL`),
    ladoB: db.prepare(`UPDATE sport_bout SET fencer_b_person_id = NULL WHERE id = ? AND fencer_b_person_id IS NOT NULL`),
    borrarAsalto: db.prepare(`DELETE FROM sport_bout WHERE id = ? AND EXISTS (SELECT 1 FROM sport_bout WHERE id = ?)`),
    borrarPuesto: db.prepare(`DELETE FROM sport_result WHERE id = ? AND EXISTS (SELECT 1 FROM sport_result WHERE id = ?)`),
    separar: db.prepare(`UPDATE sport_person SET merged_into_person_id = NULL, updated_at = ? WHERE id = ? AND merged_into_person_id = ?`),
    rechazo: db.prepare(
      `INSERT INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence, decided_at, created_at)
       SELECT ?, '${FUENTE_SEPARACION}', p.id, p.display_name, ?, 'RECHAZADO', ?, ?, ? FROM sport_person p WHERE p.id = ?`,
    ),
    fundir: db.prepare(
      `UPDATE sport_person SET merged_into_person_id = ?, updated_at = ?
        WHERE id = ? AND merged_into_person_id IS NULL AND EXISTS (SELECT 1 FROM sport_person d WHERE d.id = ? AND d.merged_into_person_id IS NULL)`,
    ),
    reapuntar: db.prepare(`UPDATE sport_person SET merged_into_person_id = ?, updated_at = ? WHERE merged_into_person_id = ?`),
    confirmar: db.prepare(
      `INSERT INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence, decided_at, created_at)
       SELECT ?, '${FUENTE_UNION}', p.id, p.display_name, ?, 'CONFIRMADO', ?, ?, ? FROM sport_person p WHERE p.id = ?`,
    ),
    generoPrueba: db.prepare(`UPDATE sport_competition SET gender = ?, updated_at = ? WHERE id = ? AND gender = ?`),
    generoFicha: db.prepare(`UPDATE sport_person SET gender = ?, updated_at = ? WHERE id = ? AND gender = ?`),
    anio: db.prepare(`UPDATE sport_person SET birth_year = NULL, updated_at = ? WHERE id = ? AND birth_year = ${ANIO_COMODIN}`),
    anioPerfil: hayPerfil ? db.prepare(`UPDATE perfil_deportista SET birth_year = NULL, updated_at = ? WHERE person_id = ? AND birth_year = ${ANIO_COMODIN}`) : null,
  };
  for (const c of correcciones) {
    switch (c.tipo) {
      case 'asalto_contra_si_mismo':
        sumar(c.tipo, (c.valor === 'a' ? q.ladoA : q.ladoB).run(c.fila).changes);
        break;
      case 'asalto_leido_dos_veces':
        sumar(c.tipo, q.borrarAsalto.run(c.fila, c.valor).changes);
        break;
      case 'puesto_duplicado_misma_fuente':
        sumar(c.tipo, q.borrarPuesto.run(c.fila, c.valor).changes);
        break;
      case 'fusion_nacimiento_incompatible': {
        const n = Number(q.separar.run(t, c.fila, c.valor).changes);
        sumar(c.tipo, n);
        if (n) q.rechazo.run(uuid(), c.valor, `nacimiento_incompatible:${c.motivo}`.slice(0, 500), t, t, c.fila);
        break;
      }
      case 'union_misma_licencia': {
        const n = Number(q.fundir.run(c.valor, t, c.fila, c.valor).changes);
        sumar(c.tipo, n);
        if (n) {
          q.reapuntar.run(c.valor, t, c.fila);
          q.confirmar.run(uuid(), c.valor, c.motivo, t, t, c.fila);
        }
        break;
      }
      case 'genero_prueba':
        sumar(c.tipo, q.generoPrueba.run(c.valor, t, c.fila, c.antes).changes);
        break;
      case 'genero_ficha':
        sumar(c.tipo, q.generoFicha.run(c.valor, t, c.fila, c.antes).changes);
        break;
      case 'anio_comodin':
        sumar(c.tipo, q.anio.run(t, c.fila).changes);
        q.anioPerfil?.run(t, c.fila);
        break;
    }
  }
  return hechas;
}

export function aplicarCalidad(db: DatabaseSync, base = '', nacimientos: ReadonlyMap<string, readonly string[]> = new Map()): InformeCalidad {
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  try {
    db.exec('BEGIN');
    try {
      const inf = auditarCalidad(db, base, nacimientos);
      inf.aplicadas = escribirCorrecciones(db, inf.correcciones);
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      if (fk.length) throw new Error(`foreign_key_check: ${fk.length} filas`);
      db.exec('COMMIT');
      inf.aplicado = true;
      return inf;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    restaurarGuardia(db);
  }
}

export function informeMarkdown(inf: InformeCalidad): string {
  const l: string[] = [];
  l.push('# Calidad de datos (lote 12)', '', `Base: \`${inf.base}\` · generado ${inf.generado}${inf.aplicado ? ' · correcciones APLICADAS' : ' · ensayo'}`, '');
  l.push(`Totales: ${Object.entries(inf.totales).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');
  l.push('| Invariante | Prioridad | Recuento | Decisivos | Revisión | Afecta |', '|---|---|---|---|---|---|');
  const orden = [...inf.hallazgos].sort((a, b) => a.prioridad - b.prioridad || a.id.localeCompare(b.id));
  for (const h of orden) l.push(`| ${h.id}: ${h.titulo} | ${h.prioridad} | ${h.recuento} | ${h.decisivos} | ${h.revision} | ${h.afecta} |`);
  l.push('');
  const porTipo = inf.correcciones.reduce<Record<string, number>>((a, c) => ({ ...a, [c.tipo]: (a[c.tipo] ?? 0) + 1 }), {});
  l.push(`Correcciones decisivas${inf.aplicado ? ` (aplicadas: ${JSON.stringify(inf.aplicadas)})` : ' (ensayo)'}: ${Object.entries(porTipo).map(([k, v]) => `${k} ${v}`).join(', ') || 'ninguna'}.`, '');
  for (const h of orden) {
    if (!h.recuento) continue;
    l.push(`## ${h.id}: ${h.titulo}`, '', `Recuento ${h.recuento} (decisivos ${h.decisivos}, revisión ${h.revision}). ${h.nota}`, '');
    for (const e of h.ejemplos.slice(0, 15)) l.push(`- ${e.decisivo ? '**[decisivo]** ' : ''}${e.texto}`);
    l.push('');
  }
  if (inf.correcciones.length) {
    l.push('## Correcciones', '', '| Tipo | Fila | Valor | Antes | Motivo |', '|---|---|---|---|---|');
    for (const c of inf.correcciones) l.push(`| ${c.tipo} | ${corto(c.fila)} | ${c.valor.length > 8 ? corto(c.valor) : c.valor || 'NULL'} | ${c.antes && c.antes.length > 8 ? corto(c.antes) : c.antes ?? ''} | ${c.motivo.replace(/\|/g, '/')} |`);
    l.push('');
  }
  return `${l.join('\n')}\n`;
}

function main(): void {
  const ruta = argumento('db', '');
  if (!ruta) throw new Error('falta --db <copia.sqlite>');
  const aplicar = bandera('aplicar');
  if (aplicar && BASES_PROTEGIDAS.has(basename(ruta).toLowerCase())) {
    throw new Error(`${basename(ruta)} es una copia exacta de producción: usa una copia de trabajo`);
  }
  const salida = argumento('informe', join(CARPETA_TRABAJO, 'lote12-informes', aplicar ? 'calidad-aplicada.json' : 'calidad.json'));
  const md = argumento('markdown', salida.replace(/\.json$/, '.md'));
  mkdirSync(dirname(salida), { recursive: true });
  const db = new DatabaseSync(ruta, aplicar ? {} : { readOnly: true });
  let inf: InformeCalidad;
  try {
    const fieAtletas = argumento('fie-atletas', FIE_ATLETAS);
    const cacheSkermo = argumento('cache-skermo', CACHE_SKERMO);
    const nacimientos = bandera('sin-nacimientos') || (!existsSync(fieAtletas) && !existsSync(cacheSkermo))
      ? new Map<string, string[]>()
      : nacimientosPorPersona(db, leerFechasNacimiento({ fieAtletas, cacheSkermo }));
    inf = aplicar ? aplicarCalidad(db, basename(ruta), nacimientos) : auditarCalidad(db, basename(ruta), nacimientos);
  } finally {
    db.close();
  }
  writeFileSync(salida, `${JSON.stringify(inf, null, 2)}\n`);
  writeFileSync(md, informeMarkdown(inf));
  for (const h of inf.hallazgos) console.log(`${h.id}: ${h.recuento} (decisivos ${h.decisivos})`);
  const porTipo = inf.correcciones.reduce<Record<string, number>>((a, c) => ({ ...a, [c.tipo]: (a[c.tipo] ?? 0) + 1 }), {});
  console.log(`Correcciones: ${JSON.stringify(porTipo)}${aplicar ? ` aplicadas ${JSON.stringify(inf.aplicadas)}` : ' (ensayo: nada guardado; --aplicar para escribir)'}`);
  console.log(`Informe: ${salida} y ${md}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
