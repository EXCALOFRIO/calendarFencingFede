/**
 * Une identidades deportivas en el SQLite de trabajo (idempotente). Se ejecuta
 * después de `cargar-hechos.ts`.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/unificar-personas.ts \
 *     [--db <nuevo.sqlite>] [--informe <unificacion-informe.json>] [--inventario <national-inventory.json>]
 *     [--hechos-efc <hechos/lote7-efc>]
 *
 * Pasos, en este orden:
 *  a) FIE: una persona por ID FIE publicado (reutiliza `fie_addr_id` existentes)
 *     y se rellenan `person_id` de puestos y asaltos FIE.
 *  a2) Fecha de nacimiento (`dedupe-nacimientos.ts`; ficha FIE y clasificación Skermo en
 *     caché, `--fie-atletas`, `--cache-skermo`): los puestos nacionales con una fecha
 *     publicada de otra persona salen de la suya, y una persona nacional y una FIE con la
 *     misma fecha exacta y nombres compatibles se funden. Después, ningún paso funde dos
 *     personas cuyas fechas conocidas difieren en más de un año.
 *  c0) Personas con la misma licencia RFEE (una por temporada en Skermo) se
 *     funden en una, si comparten nombre normalizado y género.
 *  c1) FIE(ESP) ↔ licencia RFEE: fusión por nombre normalizado idéntico o
 *     superconjunto único en ambos sentidos, mismo género. La persona RFEE apunta
 *     a la FIE (`merged_into_person_id`, reversible, sin cadenas).
 *  c3) EFC extranjeros por licencia (`pasoEfc`): con la FIE de la misma nación, nombre completo
 *     y género si es única y las guardas (misma prueba, año de nacimiento, categoría) pasan; si
 *     no, una persona por licencia (alias `efc_licencia`, año de `--hechos-efc`).
 *  e0) Pruebas conjuntas (`dedupe-conjuntas.ts`): la lectura de Engarde de un evento que el PDF
 *     parte por franjas, sexo o año queda como prueba propia, enlazada con sus partes, con sus
 *     puestos sin persona; e y d no la tocan.
 *  e) Pruebas Engarde que ya existen en skermo_rfee, rfee_pdf o FIE
 *     (`depurarSolapesEngarde`): se retiran sus puestos; sus asaltos sólo se
 *     quedan, trasladados a la prueba existente, si traen más que ella (nunca
 *     frente a FIE). Va antes de b para no crear personas de pruebas retiradas.
 *  e2) Pruebas por equipos de PDF y Engarde: cada fila es un equipo, así que sus
 *     puestos y asaltos se desvinculan de cualquier persona (`desvincularEquipos`);
 *     al final se borran las personas por nombre que sólo existían por esas filas.
 *  b) Puestos de PDF RFEE y de Engarde (sin IDs): vínculo por nombre normalizado
 *     único entre personas con licencia RFEE / país ESP / creadas desde PDF,
 *     contadas por su persona raíz; si no hay candidata, persona nueva por
 *     (nombre, género). En Engarde sólo puestos individuales de nación ESP o sin
 *     nación. Los asaltos heredan la persona del puesto de la misma prueba.
 *  c2) Personas creadas desde PDF que casan de forma única con una persona
 *     FIE/RFEE se funden en ella.
 *  d) Tras `depurarSolapes`: las copias nacionales del mismo evento (clasificación de
 *     Skermo y lectura del PDF o de Engarde con los asaltos) se funden en una prueba
 *     (`dedupe-pruebas.ts#fundirDuplicados`) y los asaltos por nombre de cada prueba
 *     nacional se vinculan con el puesto de su nombre, aunque esté recortado
 *     (`revincularAsaltosPorPuesto`).
 *  f) Fusiones por nombre recortado y por apellido FIE con salvaguardas (`pasoFusionNombres`),
 *     y segunda pasada de b que sólo vincula con personas existentes.
 *  g) Las fusiones por nombre que el nombre solo no decide, con la evidencia de los puestos
 *     (club normalizado en temporadas cercanas, arma, carrera, edad por categoría; una sola
 *     candidata posible): `dedupe-evidencia.ts#fundirPorEvidencia`.
 * En b, un nombre de 3+ palabras no se separa por el género de la prueba, y un nombre que
 * sólo sale en asaltos y cabe en un puesto de cada prueba donde sale no crea persona.
 * Después se ejecuta `vincular-asaltos.ts` (licencias Engarde, asaltos por puesto con
 * nombre recortado, fusiones por licencia Engarde y propuestas para revisión).
 * c1 va antes que b para que una persona FIE y su ficha RFEE no cuenten como dos
 * candidatas del mismo nombre. Skermo (enlazado por licencia) no se toca.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  cabe as cabeRecortado,
  fundirDuplicados,
  INVENTARIO_NACIONAL,
  leerCatalogoNacional,
  prepararNombre,
  revincularAsaltosPorPuesto,
  type FilaCatalogoNacional,
  type InformeDuplicados,
  type InformeRevinculo,
  type NombrePreparado,
} from './dedupe-pruebas';
import { anioTemporada, fundirPorEvidencia, nacimientoPorCategoria, type InformeEvidencia } from './dedupe-evidencia';
import {
  desvincularPuestosConjuntas,
  hayTablaConjuntas,
  registrarConjuntas,
  TABLA_CONJUNTAS,
  vincularAsaltosConjuntas,
  type InformeAsaltosConjuntas,
  type InformeConjuntas,
} from './dedupe-conjuntas';
import { depurarSolapes, depurarSolapesEngarde, type InformeDepuracion, type InformeSolapesEngarde } from './medir-solapes';
import {
  ahora,
  argumento,
  CARPETA_TRABAJO,
  normalizarNombre,
  NUEVO_POR_DEFECTO,
  palabrasNombre,
  prepararCopiaTrabajo,
  quitarGuardia,
  restaurarGuardia,
  uuid,
} from './comun';
import {
  CACHE_SKERMO,
  FIE_ATLETAS,
  fechasChocan,
  fundirPorFechaNacimiento,
  leerFechasNacimiento,
  nacimientosPorPersona,
  PARTICULAS,
  partirNombreFie,
  partirPorFechaNacimiento,
  pilaCompatible,
  significativasDe,
  type FechasNacimiento,
  type InformeFusionFecha,
  type InformeParticion,
} from './dedupe-nacimientos';
export { partirNombreFie, pilaCompatible };
// Import circular (vincular-asaltos importa `medir` de aquí): seguro porque ambos módulos sólo
// usan las funciones del otro al ejecutarse, nunca al cargarse.
import { coincidencia } from './vincular-asaltos';
import {
  anotarBloqueo, firmaApellidos, formatoDeFuente, motivoNoUnir, nuevoInformeOrden, prioridadFuente, sumarOrden, type InformeOrden,
} from './nombres-union';

type Genero = 'M' | 'F' | 'MIXTO';

/**
 * Fuentes sin identificadores publicados, cuyos puestos se vinculan por nombre (paso b). La EFC
 * (circuito europeo) publica la licencia EFC, que no es un ID FIE ni RFEE: como en Engarde, sólo
 * se vinculan por nombre los tiradores de nación española y los asaltos heredan el puesto.
 */
export const FUENTES_NOMBRE = ['rfee_pdf', 'engarde', 'efc'] as const;
/** Fuentes internacionales: sólo puestos ESP (o sin nación) por nombre; asaltos, sólo por el puesto de su prueba. */
export const FUENTES_SOLO_EN_PRUEBA: ReadonlySet<string> = new Set(['engarde', 'efc']);
type FuenteNombre = (typeof FUENTES_NOMBRE)[number];
const FUENTES_NOMBRE_SQL = FUENTES_NOMBRE.map((f) => `'${f}'`).join(', ');
/**
 * Alias de las personas creadas por licencia EFC (`pasoEfc`). No es una fuente por nombre: esas
 * personas no entran en el grupo de candidatas por nombre (son extranjeras), ni se funden por
 * nombre recortado o por evidencia, ni cuentan como «sólo nombre» en `vincular-asaltos.ts`.
 */
export const ALIAS_EFC = 'efc_licencia';
const ALIAS_BORRABLES_SQL = [...FUENTES_NOMBRE, ALIAS_EFC].map((f) => `'${f}'`).join(', ');

export type InformeEfc = {
  /** Puestos EFC individuales de nación extranjera. */
  filas: number;
  licencias: number;
  /** Licencias vinculadas a una persona FIE por primera vez. */
  licenciasFie: number;
  /** Licencias con persona propia nueva. */
  licenciasNuevas: number;
  /** Licencias que ya tenían persona (de otra pasada). */
  licenciasExistentes: number;
  /** Personas de licencia EFC fundidas en la FIE que ahora casa. */
  fusionesFie: number;
  filasVinculadas: number;
  /** Filas no vinculadas porque su persona ya tiene otro puesto en esa prueba. */
  filasMismaPrueba: number;
  sinLicencia: { grupos: number; fie: number; efc: number; sinVincular: number };
  /** Por qué una licencia no fue a la FIE (`fie_ambigua`, `misma_prueba`, `nacimiento`, `categoria`, ...). */
  rechazos: Record<string, number>;
};

/** Año de nacimiento que la EFC publica por licencia (`birthYear` de los hechos `efc`); se descartan las licencias con dos años. */
export function leerNacimientosEfc(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const conflicto = new Set<string>();
  if (!existsSync(dir)) return out;
  const recorrer = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const ruta = join(d, e.name);
      if (e.isDirectory()) { recorrer(ruta); continue; }
      if (!e.isFile() || !e.name.endsWith('.json') || e.name.startsWith('_')) continue;
      let h: { source?: string; results?: { factKey?: string; birthYear?: number | null }[] };
      try { h = JSON.parse(readFileSync(ruta, 'utf8')); } catch { continue; }
      if (h.source !== 'efc') continue;
      for (const r of h.results ?? []) {
        const lic = /^efc:lic:(\d+)/.exec(r.factKey ?? '')?.[1];
        if (!lic || !Number.isInteger(r.birthYear)) continue;
        const previo = out.get(lic);
        if (previo !== undefined && previo !== r.birthYear) conflicto.add(lic);
        out.set(lic, r.birthYear!);
      }
    }
  };
  recorrer(dir);
  for (const lic of conflicto) out.delete(lic);
  return out;
}

type Persona = {
  id: string;
  nombre: string;
  norm: string;
  genero: Genero | null;
  pais: string | null;
  fusionada: string | null;
  atleta: string | null;
  variantes: Set<string>;
  fuentesAlias: Set<string>;
  /** Nombres tal cual los publicó cada fuente (nombre visible y alias), con el orden de los apellidos. */
  publicados: { nombre: string; fuente: string | null }[];
};

export type Medida = {
  resultados: Record<string, { total: number; vinculados: number; pct: number }>;
  asaltos: Record<string, { total: number; ambos: number; pct: number }>;
  personas: number;
  fusionadas: number;
};

export type InformeUnificacion = {
  antes: Medida;
  despues: Medida;
  fie: {
    idsDistintos: number;
    personasReutilizadas: number;
    personasCreadas: number;
    aliasNuevos: number;
    resultadosVinculados: number;
    asaltosLadoVinculados: number;
  };
  fusionLicencia: { licenciasConVarias: number; fusiones: number; omitidas: number };
  fusionFieRfee: {
    fusiones: number; exactas: number; superconjunto: number; ambiguas: number; omitidasPorAtleta: number;
    /** Candidatas descartadas porque sus fechas de nacimiento no casan con la FIE. */
    omitidasPorFecha: number;
    /** Personas FIE que ya tienen fundida una ficha de licencia con su nombre. */
    omitidasYaVinculada: number;
    /** Candidatas por superconjunto cuyo primer apellido no es el apellido FIE. */
    omitidasPorOrden: number;
  };
  /** Puestos nacionales sacados de una persona cuya fecha de nacimiento no es la suya. */
  particionFecha: InformeParticion;
  /** Personas nacionales fundidas en la FIE con la misma fecha de nacimiento exacta. */
  fusionFecha: InformeFusionFecha;
  pdf: {
    gruposNombre: number;
    vinculadosExacto: number;
    vinculadosSuperconjunto: number;
    personasCreadas: number;
    ambiguos: number;
    nombresCortos: number;
    resultadosVinculados: number;
    asaltosLadoVinculados: number;
    /** Puestos sin vincular porque su grupo de nombre se repite en la misma prueba individual. */
    puestosAmbiguosEnPrueba: number;
    /** Nombres sólo de asaltos que caben en un puesto de cada prueba donde salen: sin persona propia. */
    recortadosSinPersona: number;
    /** Segunda pasada: puestos no vinculados porque su persona ya tiene otro en esa prueba. */
    puestosYaEnPrueba: number;
  };
  fusionPdf: { fusiones: number; ambiguas: number };
  /** Vínculos por nombre deshechos: la misma persona dos veces en una prueba individual rfee_pdf. */
  colisionesPdf: { pruebas: number; resultados: number; asaltosLado: number };
  /**
   * Filas de pruebas por equipos vinculadas por nombre a una persona (el nombre es el del
   * equipo, «SAMA-M 1») y personas que sólo existían por esas filas, ya borradas.
   */
  equipos: { resultados: number; asaltosLado: number; personasBorradas: number };
  /** Puestos y asaltos rfee_pdf que ya estaban en la misma prueba de skermo_rfee. */
  solapes: InformeDepuracion;
  /** Pruebas engarde que ya existían en otra fuente: puestos retirados, asaltos sólo si traen más. */
  solapesEngarde: InformeSolapesEngarde;
  /** Copias nacionales del mismo evento fundidas en una prueba (puestos + asaltos). */
  duplicados: InformeDuplicados;
  /** Asaltos nacionales vinculados con el puesto de su nombre (recortado o no) en la misma prueba. */
  revinculo: InformeRevinculo;
  /** Fusiones por nombre recortado y por apellido FIE (`pasoFusionNombres`). */
  fusionNombres: InformeFusionNombres;
  /** Segunda pasada del paso por nombre tras las fusiones: sólo vincula con personas que ya existen. */
  pdfTrasFusiones: InformeUnificacion['pdf'];
  /** Fusiones por nombre decididas con club, arma, carrera y edad (`dedupe-evidencia.ts`). */
  fusionEvidencia: InformeEvidencia;
  /** Tiradores extranjeros de la EFC por licencia (`pasoEfc`). */
  efc: InformeEfc;
  /** Pruebas conjuntas detectadas y registradas (`dedupe-conjuntas.ts`). */
  conjuntas: InformeConjuntas;
  /** Lados de asaltos de las conjuntas vinculados con el puesto de su nombre en las partes. */
  asaltosConjuntas: InformeAsaltosConjuntas;
  /** Uniones por nombre impedidas por el orden de los apellidos, hermanos o primos (`nombres-union.ts`). */
  orden: InformeOrden;
  /** Ediciones que se quedaron sin ninguna prueba (por cualquier paso, de esta pasada o de antes). */
  edicionesVacias: number;
  candidatosRegistrados: number;
  segundos: number;
};

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 10000) / 100);

export function medir(db: DatabaseSync): Medida {
  const resultados: Medida['resultados'] = {};
  for (const r of db.prepare(
    `SELECT source, count(*) n, sum(person_id IS NOT NULL) v FROM sport_result GROUP BY source ORDER BY source`,
  ).all() as { source: string; n: number; v: number }[]) {
    resultados[r.source] = { total: Number(r.n), vinculados: Number(r.v), pct: pct(Number(r.v), Number(r.n)) };
  }
  const asaltos: Medida['asaltos'] = {};
  for (const r of db.prepare(
    `SELECT source, count(*) n, sum(fencer_a_person_id IS NOT NULL AND fencer_b_person_id IS NOT NULL) v
       FROM sport_bout GROUP BY source ORDER BY source`,
  ).all() as { source: string; n: number; v: number }[]) {
    asaltos[r.source] = { total: Number(r.n), ambos: Number(r.v), pct: pct(Number(r.v), Number(r.n)) };
  }
  const p = db.prepare(`SELECT count(*) n, sum(merged_into_person_id IS NOT NULL) f FROM sport_person`).get() as {
    n: number; f: number | null;
  };
  return { resultados, asaltos, personas: Number(p.n), fusionadas: Number(p.f ?? 0) };
}

const generoDe = (g: string | null): Genero | null => (g === 'M' || g === 'F' || g === 'MIXTO' ? g : null);

/**
 * Clave del grupo de nombre del paso por nombre. Un nombre de 3+ palabras no se parte por
 * el género de la prueba: es el mismo tirador en una prueba mixta o mal etiquetada.
 */
export function claveGrupoNombre(palabrasOrdenadas: readonly string[], genero: string | null): string {
  const norm = palabrasOrdenadas.join(' ');
  return palabrasOrdenadas.length >= 3 ? `${norm}|*` : `${norm}|${generoDe(genero) ?? 'MIXTO'}`;
}

function esSubconjunto(pequeno: readonly string[], grande: ReadonlySet<string>): boolean {
  for (const w of pequeno) if (!grande.has(w)) return false;
  return true;
}

class Unificador {
  readonly personas = new Map<string, Persona>();
  /** Valor `fie_addr_id` confirmado → persona. */
  readonly fieDe = new Map<string, string>();
  readonly conFie = new Set<string>();
  readonly conLicencia = new Set<string>();
  readonly conIdExterno = new Set<string>();
  private readonly st: Record<string, StatementSync> = {};
  candidatos = 0;
  /** Fechas de nacimiento conocidas por raíz (FIE y Skermo); se juntan al fundir. */
  readonly fechas = new Map<string, Set<string>>();

  constructor(private readonly db: DatabaseSync, nacimientos?: ReadonlyMap<string, readonly string[]>) {
    for (const p of db.prepare(
      `SELECT id, display_name, name_normalized, gender, country_code, merged_into_person_id, athlete_id FROM sport_person`,
    ).all() as Record<string, string | null>[]) {
      this.personas.set(p.id!, {
        id: p.id!,
        nombre: p.display_name!,
        norm: p.name_normalized!,
        genero: generoDe(p.gender),
        pais: p.country_code,
        fusionada: p.merged_into_person_id,
        atleta: p.athlete_id,
        variantes: new Set(p.name_normalized ? [p.name_normalized] : []),
        fuentesAlias: new Set(),
        publicados: p.display_name ? [{ nombre: p.display_name, fuente: null }] : [],
      });
    }
    for (const a of db.prepare(`SELECT person_id, source, name_original, name_normalized FROM sport_person_alias`).all() as {
      person_id: string; source: string; name_original: string | null; name_normalized: string;
    }[]) {
      const p = this.personas.get(a.person_id);
      if (!p) continue;
      if (a.name_normalized) p.variantes.add(a.name_normalized);
      p.fuentesAlias.add(a.source);
      if (a.name_original) p.publicados.push({ nombre: a.name_original, fuente: a.source });
    }
    for (const e of db.prepare(
      `SELECT person_id, scheme, value, scope_source, scope_season FROM sport_external_id
        WHERE link_status='CONFIRMADO' AND person_id IS NOT NULL`,
    ).all() as { person_id: string; scheme: string; value: string; scope_source: string; scope_season: string }[]) {
      this.conIdExterno.add(e.person_id);
      if (e.scheme === 'fie_addr_id' && e.scope_source === 'fie') {
        this.fieDe.set(e.value.trim(), e.person_id);
        this.conFie.add(e.person_id);
      }
      if (e.scheme === 'rfee_license') {
        this.conLicencia.add(e.person_id);
        const v = e.value.trim().toUpperCase();
        const g = this.porLicencia.get(v) ?? new Map<string, string>();
        if ((g.get(e.person_id) ?? '') < e.scope_season) g.set(e.person_id, e.scope_season);
        this.porLicencia.set(v, g);
      }
    }
    for (const [id, fs] of nacimientos ?? []) {
      if (!this.personas.has(id)) continue;
      const r = this.raiz(id);
      const s = this.fechas.get(r) ?? this.fechas.set(r, new Set()).get(r)!;
      for (const f of fs) s.add(f);
    }
  }

  /** Las dos raíces tienen fechas de nacimiento conocidas y no casan (más de un año). */
  chocan(a: string, b: string): boolean {
    return fechasChocan(this.fechas.get(this.raiz(a)), this.fechas.get(this.raiz(b)));
  }

  /** Licencia RFEE → (persona → temporada más reciente en la que se publicó). */
  readonly porLicencia = new Map<string, Map<string, string>>();

  private q(sql: string): StatementSync {
    return (this.st[sql] ??= this.db.prepare(sql));
  }

  transaccion<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Raíz de la fusión; las cadenas de más de 3 saltos no se resuelven (igual que la app). */
  raiz(id: string): string {
    let actual = id;
    for (let i = 0; i < 4; i += 1) {
      const p = this.personas.get(actual);
      if (!p?.fusionada) return actual;
      actual = p.fusionada;
    }
    return actual;
  }

  crearPersona(nombre: string, norm: string, genero: Genero | null, pais: string | null, fuenteAlias: string): Persona {
    const t = ahora();
    const p: Persona = {
      id: uuid(), nombre, norm, genero: genero === 'MIXTO' ? null : genero, pais,
      fusionada: null, atleta: null, variantes: new Set([norm]), fuentesAlias: new Set([fuenteAlias]),
      publicados: [],
    };
    this.q(
      `INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(p.id, nombre, norm, p.genero, pais, t, t);
    this.alias(p, fuenteAlias, nombre, norm);
    this.personas.set(p.id, p);
    this.miembrosDe?.set(p.id, [p.id]);
    return p;
  }

  alias(p: Persona, fuente: string, nombre: string, norm: string): boolean {
    const r = this.q(
      `INSERT OR IGNORE INTO sport_person_alias (id, person_id, source, name_original, name_normalized, first_seen_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(uuid(), p.id, fuente, nombre, norm, ahora());
    p.variantes.add(norm);
    p.fuentesAlias.add(fuente);
    if (Number(r.changes) > 0) p.publicados.push({ nombre, fuente });
    return Number(r.changes) > 0;
  }

  /**
   * Nombres publicados que identifican al grupo de `id`: los de la raíz y los de las fundidas
   * con ID FIE, licencia o ficha. Los de una fundida sólo por nombre no cuentan: si una unión
   * pasada fue mala, su nombre abriría la puerta a otras.
   */
  publicadosGrupo(id: string): { nombre: string; fuente: string | null }[] {
    const r = this.raiz(id);
    if (!this.miembrosDe) {
      this.miembrosDe = new Map();
      for (const p of this.personas.values()) {
        const k = this.raiz(p.id);
        (this.miembrosDe.get(k) ?? this.miembrosDe.set(k, []).get(k)!).push(p.id);
      }
    }
    const ids = this.miembrosDe.get(r) ?? [r];
    return ids.filter((m) => m === r || this.conIdExterno.has(m) || this.personas.get(m)?.atleta || this.personas.get(m)?.fuentesAlias.has(ALIAS_EFC))
      .flatMap((m) => this.personas.get(m)?.publicados ?? []);
  }

  /** Miembros por raíz para `publicadosGrupo`; `fundir` lo mantiene. */
  private miembrosDe: Map<string, string[]> | null = null;

  /**
   * El nombre impide unir `a` y `b` (`nombres-union.ts#motivoNoUnir`): se anota y se devuelve true.
   * `soloPersona`: compara sólo los nombres de esas personas, no los de todo su grupo.
   */
  bloqueaNombre(paso: string, a: string, b: string, soloPersona = false): boolean {
    const na = soloPersona ? this.personas.get(a)?.publicados ?? [] : this.publicadosGrupo(a);
    const nb = soloPersona ? this.personas.get(b)?.publicados ?? [] : this.publicadosGrupo(b);
    const m = motivoNoUnir(na, nb);
    if (!m) return false;
    anotarBloqueo(this.orden, paso, m, `[${a.slice(0, 8)} / ${b.slice(0, 8)}]`);
    return true;
  }

  readonly orden: InformeOrden = nuevoInformeOrden();

  candidato(fuente: string, ref: string, nombre: string, personaId: string, estado: 'PROPUESTO' | 'CONFIRMADO', evidencia: string): void {
    const t = ahora();
    const r = this.q(
      `INSERT OR IGNORE INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence,
         decided_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(uuid(), fuente, ref, nombre, personaId, estado, evidencia, estado === 'CONFIRMADO' ? t : null, t);
    this.candidatos += Number(r.changes);
  }

  /** Funde `origen` en la raíz de `destino`; las fundidas en `origen` pasan a apuntar a esa raíz. */
  fundir(origenId: string, destinoId: string): boolean {
    const destino = this.raiz(destinoId);
    const origen = this.personas.get(origenId);
    if (!origen || origen.fusionada || destino === origenId) return false;
    const t = ahora();
    this.q(`UPDATE sport_person SET merged_into_person_id=?, updated_at=? WHERE id=? AND merged_into_person_id IS NULL`)
      .run(destino, t, origenId);
    origen.fusionada = destino;
    this.q(`UPDATE sport_person SET merged_into_person_id=?, updated_at=? WHERE merged_into_person_id=?`)
      .run(destino, t, origenId);
    const fo = this.fechas.get(origenId);
    if (fo) {
      const fd = this.fechas.get(destino) ?? this.fechas.set(destino, new Set()).get(destino)!;
      for (const f of fo) fd.add(f);
      this.fechas.delete(origenId);
    }
    for (const p of this.personas.values()) if (p.fusionada === origenId) p.fusionada = destino;
    if (this.miembrosDe) {
      const movidos = this.miembrosDe.get(origenId) ?? [origenId];
      this.miembrosDe.delete(origenId);
      (this.miembrosDe.get(destino) ?? this.miembrosDe.set(destino, [destino]).get(destino)!).push(...movidos.filter((m) => m !== destino));
    }
    return true;
  }

  pasoFie(inf: InformeUnificacion['fie']): void {
    type Agregado = {
      nombre: string; fecha: string; paises: Map<string, number>; m: number; f: number;
      nombres: Map<string, string>; deResultados: boolean;
    };
    const agregados = new Map<string, Agregado>();
    const anotar = (ref: string, nombre: string, pais: string | null, fecha: string | null, genero: string | null, deResultados: boolean) => {
      if (!/^\d+$/.test(ref)) return;
      let a = agregados.get(ref);
      if (!a) {
        a = { nombre, fecha: fecha ?? '', paises: new Map(), m: 0, f: 0, nombres: new Map(), deResultados };
        agregados.set(ref, a);
      } else if (a.deResultados && !deResultados) return;
      else if (!a.deResultados && deResultados) {
        a.deResultados = true;
        a.nombre = nombre;
        a.fecha = fecha ?? '';
      } else if ((fecha ?? '') >= a.fecha) {
        a.nombre = nombre;
        a.fecha = fecha ?? '';
      }
      if (pais) a.paises.set(pais, (a.paises.get(pais) ?? 0) + 1);
      if (genero === 'M') a.m += 1;
      if (genero === 'F') a.f += 1;
      const n = normalizarNombre(nombre);
      if (n && !a.nombres.has(n)) a.nombres.set(n, nombre);
    };
    for (const r of this.db.prepare(
      `SELECT r.source_fact_key ref, r.source_name nombre, r.source_country_code pais, r.occurred_on fecha, c.gender genero
         FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id WHERE r.source='fie'`,
    ).iterate() as Iterable<{ ref: string; nombre: string; pais: string | null; fecha: string | null; genero: string }>) {
      anotar(r.ref.trim(), r.nombre, r.pais, r.fecha, r.genero, true);
    }
    for (const b of this.db.prepare(
      `SELECT b.fencer_a_ref a, b.fencer_a_name an, b.fencer_b_ref b, b.fencer_b_name bn, b.occurred_on fecha,
              c.gender genero
         FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id
        WHERE b.source='fie' AND (b.fencer_a_person_id IS NULL OR b.fencer_b_person_id IS NULL)`,
    ).iterate() as Iterable<{ a: string; an: string; b: string; bn: string; fecha: string | null; genero: string }>) {
      anotar(b.a.trim(), b.an, null, b.fecha, b.genero, false);
      anotar(b.b.trim(), b.bn, null, b.fecha, b.genero, false);
    }
    inf.idsDistintos = agregados.size;

    this.transaccion(() => {
      this.db.exec('DROP TABLE IF EXISTS temp._mapa_fie');
      this.db.exec('CREATE TEMP TABLE _mapa_fie (ref TEXT PRIMARY KEY, person_id TEXT NOT NULL)');
      const mapa = this.db.prepare('INSERT INTO temp._mapa_fie (ref, person_id) VALUES (?, ?)');
      const t = ahora();
      for (const [ref, a] of agregados) {
        let personaId = this.fieDe.get(ref);
        let persona = personaId ? this.personas.get(personaId) : undefined;
        if (persona) inf.personasReutilizadas += 1;
        else {
          const norm = normalizarNombre(a.nombre);
          if (!norm) continue;
          let pais: string | null = null;
          let max = 0;
          for (const [k, v] of a.paises) if (v > max || (v === max && pais !== null && k < pais)) [pais, max] = [k, v];
          const genero: Genero | null = a.m > a.f ? 'M' : a.f > a.m ? 'F' : null;
          persona = this.crearPersona(a.nombre, norm, genero, pais, 'fie');
          personaId = persona.id;
          this.q(
            `INSERT INTO sport_external_id (id, person_id, scheme, value, scope_source, link_status, linked_via,
               linked_at, evidence, created_at, updated_at)
             VALUES (?,?,'fie_addr_id',?,'fie','CONFIRMADO','fie_id_publicado',?,?,?,?)`,
          ).run(uuid(), personaId, ref, t, 'ID FIE publicado en resultados/asaltos FIE', t, t);
          this.fieDe.set(ref, personaId);
          this.conFie.add(personaId);
          this.conIdExterno.add(personaId);
          inf.personasCreadas += 1;
        }
        for (const [n, original] of a.nombres) {
          if (!persona.variantes.has(n) && this.alias(persona, 'fie', original, n)) inf.aliasNuevos += 1;
        }
        mapa.run(ref, personaId!);
      }
      inf.resultadosVinculados = Number(this.db.prepare(
        `UPDATE sport_result SET person_id = m.person_id FROM temp._mapa_fie m
          WHERE sport_result.source='fie' AND sport_result.person_id IS NULL AND m.ref = sport_result.source_fact_key`,
      ).run().changes);
      const a = this.db.prepare(
        `UPDATE sport_bout SET fencer_a_person_id = m.person_id FROM temp._mapa_fie m
          WHERE sport_bout.source='fie' AND sport_bout.fencer_a_person_id IS NULL AND m.ref = sport_bout.fencer_a_ref
            AND (sport_bout.fencer_b_person_id IS NULL OR sport_bout.fencer_b_person_id <> m.person_id)`,
      ).run().changes;
      const b = this.db.prepare(
        `UPDATE sport_bout SET fencer_b_person_id = m.person_id FROM temp._mapa_fie m
          WHERE sport_bout.source='fie' AND sport_bout.fencer_b_person_id IS NULL AND m.ref = sport_bout.fencer_b_ref
            AND (sport_bout.fencer_a_person_id IS NULL OR sport_bout.fencer_a_person_id <> m.person_id)`,
      ).run().changes;
      inf.asaltosLadoVinculados = Number(a) + Number(b);
      this.db.exec('DROP TABLE temp._mapa_fie');
    });
  }

  /** Índices de nombre (exacto y por palabra) sobre un conjunto de personas. */
  private indice(ids: Iterable<string>) {
    const exacto = new Map<string, Set<string>>();
    const palabra = new Map<string, Set<string>>();
    const palabrasDe = new Map<string, Set<string>[]>();
    for (const id of ids) {
      const p = this.personas.get(id)!;
      const conjuntos: Set<string>[] = [];
      for (const v of p.variantes) {
        if (!v) continue;
        (exacto.get(v) ?? exacto.set(v, new Set()).get(v)!).add(id);
        const ws = new Set(v.split(' '));
        conjuntos.push(ws);
        for (const w of ws) (palabra.get(w) ?? palabra.set(w, new Set()).get(w)!).add(id);
      }
      palabrasDe.set(id, conjuntos);
    }
    /** Personas con alguna variante que contiene todas las `palabras`. */
    const superconjunto = (palabras: readonly string[]): string[] => {
      let menor: Set<string> | undefined;
      for (const w of palabras) {
        const s = palabra.get(w);
        if (!s) return [];
        if (!menor || s.size < menor.size) menor = s;
      }
      if (!menor) return [];
      return [...menor].filter((id) => palabrasDe.get(id)!.some((ws) => esSubconjunto(palabras, ws)));
    };
    return { exacto, palabra, palabrasDe, superconjunto };
  }

  /**
   * La importación Skermo creó una persona por (licencia, temporada): 8.825
   * personas para 3.611 licencias. La licencia publicada identifica a la misma
   * persona, así que se funden en una, salvo que bajo la misma licencia aparezcan
   * nombres o géneros distintos (licencia reasignada: se deja para revisión).
   */
  pasoFusionLicencia(inf: InformeUnificacion['fusionLicencia']): void {
    this.transaccion(() => {
      for (const [licencia, miembros] of this.porLicencia) {
        const ids = [...miembros.keys()].map((id) => this.raiz(id));
        const unicos = [...new Set(ids)];
        if (unicos.length < 2) continue;
        inf.licenciasConVarias += 1;
        const firmas = new Set(unicos.map((id) => {
          const p = this.personas.get(id)!;
          return `${p.norm}|${p.genero ?? ''}`;
        }));
        const atletas = unicos.filter((id) => this.personas.get(id)!.atleta);
        const chocan = unicos.some((a) => unicos.some((b) => a < b && this.chocan(a, b)));
        if (firmas.size > 1 || atletas.length > 1 || chocan) {
          inf.omitidas += 1;
          continue;
        }
        const temporada = (id: string) =>
          Math.max(...[...miembros].filter(([m]) => this.raiz(m) === id).map(([, s]) => Number(s.slice(0, 4)) || 0));
        const raiz = atletas[0] ?? [...unicos].sort((a, b) => temporada(b) - temporada(a) || (a < b ? -1 : 1))[0];
        for (const id of unicos) {
          if (id === raiz) continue;
          if (this.fundir(id, raiz)) {
            inf.fusiones += 1;
            this.candidato('fusion_licencia_rfee', id, this.personas.get(id)!.nombre, raiz, 'CONFIRMADO',
              `misma_licencia_rfee:${licencia}`);
          }
        }
      }
    });
  }

  pasoFusionFieRfee(inf: InformeUnificacion['fusionFieRfee']): void {
    const fies = [...this.conFie].filter((id) => {
      const p = this.personas.get(id);
      return p && !p.fusionada && p.pais === 'ESP' && (p.genero === 'M' || p.genero === 'F');
    });
    const rfees = [...this.conLicencia].filter((id) => {
      const p = this.personas.get(id);
      return p && !p.fusionada && !this.conFie.has(id) && (p.genero === 'M' || p.genero === 'F');
    });
    const iF = this.indice(fies);
    const iR = this.indice(rfees);
    const genero = (id: string) => this.personas.get(id)!.genero;
    type Cand = Map<string, boolean>;
    const deF = new Map<string, Cand>();
    // Fichas de licencia ya fundidas en cada raíz FIE.
    const licenciasDe = new Map<string, string[]>();
    for (const id of this.conLicencia) {
      const r = this.raiz(id);
      if (r !== id) (licenciasDe.get(r) ?? licenciasDe.set(r, []).get(r)!).push(id);
    }
    const contieneA = (corto: string, largo: string) => esSubconjunto(corto.split(' '), new Set(largo.split(' ')));
    for (const f of fies) {
      const pf = this.personas.get(f)!;
      // La persona FIE ya tiene su ficha nacional («FLOREZ Carlos» ← «CARLOS FLOREZ DE VARGAS»):
      // otra licencia cuyo nombre también contiene el suyo es otra persona.
      const propias = licenciasDe.get(f) ?? [];
      if (propias.some((id) => [...this.personas.get(id)!.variantes].some((v) => [...pf.variantes].some((w) => contieneA(w, v))))) {
        inf.omitidasYaVinculada += 1;
        continue;
      }
      const partido = partirNombreFie(pf.nombre);
      const c: Cand = new Map();
      for (const v of pf.variantes) {
        for (const r of iR.exacto.get(v) ?? []) if (genero(r) === genero(f)) c.set(r, true);
        const ws = v.split(' ');
        if (ws.length >= 2) for (const r of iR.superconjunto(ws)) if (genero(r) === genero(f) && !c.has(r)) c.set(r, false);
      }
      for (const [r, exacta] of [...c]) {
        if (this.chocan(r, f)) {
          c.delete(r);
          inf.omitidasPorFecha += 1;
          continue;
        }
        // La FIE publica el primer apellido: «ESCOBAR Javier» no es «JAVIER ALONSO ESCOBAR».
        if (!exacta && partido) {
          const resto = significativasDe(palabrasNombre(this.personas.get(r)!.nombre).filter((w) => !partido.nombre.includes(w)));
          if (resto[0] !== significativasDe(partido.apellidos)[0]) {
            c.delete(r);
            inf.omitidasPorOrden += 1;
            continue;
          }
        }
        // Las mismas palabras no bastan: «ORTIN ROMERO Héctor» no es «ROMERO ORTIN Héctor».
        if (this.bloqueaNombre('fusion_fie_rfee', r, f)) {
          c.delete(r);
          inf.omitidasPorOrden += 1;
        }
      }
      deF.set(f, c);
    }
    const deR = new Map<string, Set<string>>();
    for (const [f, c] of deF) for (const r of c.keys()) (deR.get(r) ?? deR.set(r, new Set()).get(r)!).add(f);

    this.transaccion(() => {
      for (const [f, c] of deF) {
        if (c.size === 0) continue;
        const pf = this.personas.get(f)!;
        if (c.size > 1) {
          inf.ambiguas += 1;
          for (const r of [...c.keys()].slice(0, 10)) {
            this.candidato('fusion_fie_rfee', r, this.personas.get(r)!.nombre, f, 'PROPUESTO', 'nombre_varias_candidatas');
          }
          continue;
        }
        const [[r, exacta]] = [...c];
        if (deR.get(r)!.size !== 1) {
          inf.ambiguas += 1;
          for (const otra of [...deR.get(r)!].slice(0, 10)) {
            this.candidato('fusion_fie_rfee', r, this.personas.get(r)!.nombre, otra, 'PROPUESTO', 'nombre_varias_candidatas');
          }
          continue;
        }
        const pr = this.personas.get(r)!;
        if (pr.atleta && pf.atleta) {
          inf.omitidasPorAtleta += 1;
          continue;
        }
        const evidencia = exacta ? 'nombre_normalizado_unico' : 'nombre_superconjunto_unico';
        if (this.fundir(r, f)) {
          inf.fusiones += 1;
          if (exacta) inf.exactas += 1;
          else inf.superconjunto += 1;
          this.candidato('fusion_fie_rfee', r, pr.nombre, this.raiz(f), 'CONFIRMADO', evidencia);
        }
      }
    });
  }

  /**
   * Tiradores extranjeros de la EFC (nación publicada y distinta de ESP; los españoles van por
   * el paso por nombre). Por licencia EFC (`efc:lic:N`): con la persona FIE de la misma nación
   * cuyo nombre normalizado completo (palabras ordenadas) y género casan con exactamente una
   * persona raíz, si ninguna fila de esa persona está ya en una prueba de la licencia, su año
   * de nacimiento FIE no se aleja más de un año del que publica la EFC y cabe en la categoría
   * de cada prueba de la licencia; si no, una persona por licencia (alias `efc_licencia`), que
   * en otra pasada se funde en la FIE por la misma regla. Las filas sin licencia sólo se
   * vinculan con una FIE o una persona de licencia EFC única por nación, nombre y género.
   */
  pasoEfc(inf: InformeEfc, nacimientos: ReadonlyMap<string, number> = new Map()): void {
    type Fila = { id: string; comp: string; k: string; n: string; pais: string; p: string | null; g: string; cat: string; t: string };
    const filas = this.db.prepare(
      `SELECT r.id, r.competition_id comp, r.source_fact_key k, r.source_name n, r.source_country_code pais,
              r.person_id p, c.gender g, c.category cat, c.season t
         FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id
        WHERE r.source = 'efc' AND c.format = 'INDIVIDUAL'
          AND r.source_country_code IS NOT NULL AND r.source_country_code <> 'ESP'`,
    ).all() as Fila[];
    inf.filas = filas.length;
    if (filas.length === 0) return;
    const rechazo = (m: string) => { inf.rechazos[m] = (inf.rechazos[m] ?? 0) + 1; };

    // Quién tiene ya puesto en cada prueba EFC (por raíz), para no repetir persona en una prueba.
    const enPrueba = new Map<string, Map<string, Set<string>>>();
    const anotar = (comp: string, raiz: string, fila: string) => {
      const m = enPrueba.get(comp) ?? enPrueba.set(comp, new Map()).get(comp)!;
      (m.get(raiz) ?? m.set(raiz, new Set()).get(raiz)!).add(fila);
    };
    const comps = [...new Set(filas.map((f) => f.comp))];
    const deComp = this.db.prepare(`SELECT id, person_id p FROM sport_result WHERE competition_id = ? AND person_id IS NOT NULL`);
    for (const c of comps) for (const r of deComp.all(c) as { id: string; p: string }[]) anotar(c, this.raiz(r.p), r.id);
    const ocupada = (raiz: string, propias: readonly Fila[]) => {
      const ids = new Set(propias.map((f) => f.id));
      return propias.some((f) => [...(enPrueba.get(f.comp)?.get(raiz) ?? [])].some((id) => !ids.has(id)));
    };

    const fies = new Map<string, Set<string>>();
    for (const p of this.personas.values()) {
      if (!this.conFie.has(p.id)) continue;
      for (const v of p.variantes) if (v) (fies.get(v) ?? fies.set(v, new Set()).get(v)!).add(p.id);
    }
    const mayoritario = (xs: readonly string[]) => {
      const n = new Map<string, number>();
      for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
      return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    };
    const generoDeFilas = (g: readonly Fila[]): Genero | null | 'varios' => {
      const s = new Set(g.map((f) => f.g).filter((x) => x === 'M' || x === 'F'));
      return s.size > 1 ? 'varios' : s.size === 1 ? ([...s][0] as Genero) : null;
    };
    /** La FIE raíz única para estas filas, o el motivo por el que no la hay. */
    const fiePara = (g: readonly Fila[], anio: number | null): { raiz: string } | { motivo: string } => {
      const genero = generoDeFilas(g);
      if (genero === 'varios') return { motivo: 'genero_varios' };
      const pais = mayoritario(g.map((f) => f.pais));
      const raices = new Set<string>();
      for (const n of new Set(g.map((f) => normalizarNombre(f.n)).filter(Boolean))) {
        for (const id of fies.get(n) ?? []) {
          const p = this.personas.get(id)!;
          if (p.pais !== pais || (genero && p.genero && p.genero !== genero)) continue;
          raices.add(this.raiz(id));
        }
      }
      if (raices.size === 0) return { motivo: 'sin_fie' };
      if (raices.size > 1) return { motivo: 'fie_ambigua' };
      const raiz = [...raices][0];
      if (ocupada(raiz, g)) return { motivo: 'misma_prueba' };
      const anios = [...(this.fechas.get(raiz) ?? [])].map((f) => Number(f.slice(0, 4))).filter(Number.isFinite);
      if (anio !== null && anios.length > 0 && anios.every((y) => Math.abs(y - anio) > 1)) return { motivo: 'nacimiento' };
      if (anios.length > 0) {
        for (const f of g) {
          const t = anioTemporada(f.t);
          if (t === null) continue;
          const [lo, hi] = nacimientoPorCategoria(f.cat, t);
          if (anios.every((y) => y < lo || y > hi)) return { motivo: 'categoria' };
        }
      }
      return { raiz };
    };
    const poner = this.q('UPDATE sport_result SET person_id = ? WHERE id = ? AND person_id IS NULL');
    const vincular = (g: readonly Fila[], persona: string) => {
      const raiz = this.raiz(persona);
      for (const f of g) {
        if (f.p) continue;
        // Una fila de la misma persona ya en esa prueba (otra licencia, otra lectura): ésta no.
        if ([...(enPrueba.get(f.comp)?.get(raiz) ?? [])].length > 0) {
          inf.filasMismaPrueba += 1;
          continue;
        }
        if (Number(poner.run(persona, f.id).changes) === 0) continue;
        f.p = persona;
        anotar(f.comp, raiz, f.id);
        inf.filasVinculadas += 1;
      }
    };

    const licencias = new Map<string, Fila[]>();
    const sinLicencia = new Map<string, Fila[]>();
    for (const f of filas) {
      const lic = /^efc:lic:(\d+)/.exec(f.k)?.[1];
      const [m, k] = lic ? [licencias, lic] : [sinLicencia, `${f.pais}|${normalizarNombre(f.n)}|${f.g}`];
      (m.get(k) ?? m.set(k, []).get(k)!).push(f);
    }
    inf.licencias = licencias.size;
    this.transaccion(() => {
      for (const [lic, g] of [...licencias].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const anio = nacimientos.get(lic) ?? null;
        const raices = new Set(g.filter((f) => f.p).map((f) => this.raiz(f.p!)));
        if (raices.size > 1) {
          rechazo('licencia_varias_personas');
          continue;
        }
        const previa = raices.size === 1 ? [...raices][0] : null;
        if (previa && this.conFie.has(previa)) {
          inf.licenciasExistentes += 1;
          vincular(g, previa);
          continue;
        }
        const fie = fiePara(g, anio);
        if ('raiz' in fie) {
          if (previa) {
            if (this.chocan(previa, fie.raiz) || !this.fundir(previa, fie.raiz)) {
              rechazo('fusion_fie_imposible');
              vincular(g, previa);
              continue;
            }
            inf.fusionesFie += 1;
          } else inf.licenciasFie += 1;
          for (const f of g) if (f.p && previa && this.raiz(f.p) === fie.raiz) anotar(f.comp, fie.raiz, f.id);
          vincular(g, fie.raiz);
          continue;
        }
        if (fie.motivo !== 'sin_fie') rechazo(fie.motivo);
        if (previa) {
          inf.licenciasExistentes += 1;
          vincular(g, previa);
          continue;
        }
        const genero = generoDeFilas(g);
        const nombre = mayoritario(g.map((f) => f.n));
        const p = this.crearPersona(nombre, normalizarNombre(nombre), genero === 'varios' ? null : genero, mayoritario(g.map((f) => f.pais)), ALIAS_EFC);
        inf.licenciasNuevas += 1;
        vincular(g, p.id);
      }

      // Sin licencia: una FIE, o una persona de licencia EFC, únicas por nación, nombre y género.
      const deLicencia = new Map<string, Set<string>>();
      for (const p of this.personas.values()) {
        if (!p.fuentesAlias.has(ALIAS_EFC) || !p.pais) continue;
        const r = this.raiz(p.id);
        if (this.conFie.has(r)) continue;
        for (const v of p.variantes) {
          const k = `${p.pais}|${v}`;
          (deLicencia.get(k) ?? deLicencia.set(k, new Set()).get(k)!).add(r);
        }
      }
      inf.sinLicencia.grupos = sinLicencia.size;
      for (const g of sinLicencia.values()) {
        if (g.every((f) => f.p)) continue;
        const fie = fiePara(g, null);
        if ('raiz' in fie) {
          inf.sinLicencia.fie += 1;
          vincular(g, fie.raiz);
          continue;
        }
        const genero = generoDeFilas(g);
        const cands = [...(deLicencia.get(`${g[0].pais}|${normalizarNombre(g[0].n)}`) ?? [])].filter((r) => {
          const pg = this.personas.get(r)?.genero ?? null;
          return !genero || genero === 'varios' || !pg || pg === genero;
        });
        if (cands.length === 1 && !ocupada(cands[0], g)) {
          inf.sinLicencia.efc += 1;
          vincular(g, cands[0]);
          continue;
        }
        inf.sinLicencia.sinVincular += 1;
      }
    });
  }

  /**
   * `soloExistentes`: segunda pasada, tras las fusiones. Sólo vincula con personas que ya
   * existen, nunca crea, y no vincula un puesto con una persona que ya tiene otro en la
   * misma prueba (`desvincularColisionesPdf` deshace los dos, también el bueno).
   */
  pasoPdf(inf: InformeUnificacion['pdf'], opciones: { soloExistentes?: boolean } = {}): Map<string, string> {
    type Grupo = {
      clave: string; norm: string; genero: Genero; palabras: string[]; nombres: Map<string, number>;
      /** Fuente de cada nombre publicado del grupo (la primera que lo trajo). */
      fuentes: Map<string, string>;
      persona?: string; resultados: { id: string; comp: string }[]; fuente: FuenteNombre;
      m: number; f: number; compsAsalto: Set<string>;
    };
    const grupos = new Map<string, Grupo>();
    // El orden de los apellidos separa grupos: «ORTIN ROMERO» y «ROMERO ORTIN» tienen las mismas
    // palabras y son dos personas (`nombres-union.ts#firmaApellidos`).
    const claveDe = (nombre: string, genero: string, fuente: string) => {
      const palabras = palabrasNombre(nombre).sort();
      return { palabras, k: `${claveGrupoNombre(palabras, genero)}|${firmaApellidos(nombre, formatoDeFuente(fuente))}` };
    };
    const grupoDe = (nombre: string, genero: string, fuente: string): Grupo | null => {
      const { palabras, k } = claveDe(nombre, genero, fuente);
      const norm = palabras.join(' ');
      if (!norm) return null;
      let gr = grupos.get(k);
      if (!gr) {
        gr = {
          clave: k, norm, genero: generoDe(genero) ?? 'MIXTO', palabras, nombres: new Map(), fuentes: new Map(), resultados: [],
          fuente: fuente as FuenteNombre, m: 0, f: 0, compsAsalto: new Set(),
        };
        grupos.set(k, gr);
      }
      if (genero === 'M') gr.m += 1;
      if (genero === 'F') gr.f += 1;
      if (fuente === 'rfee_pdf') gr.fuente = 'rfee_pdf';
      gr.nombres.set(nombre, (gr.nombres.get(nombre) ?? 0) + 1);
      if (!gr.fuentes.has(nombre)) gr.fuentes.set(nombre, fuente);
      return gr;
    };
    // Engarde publica tiradores extranjeros con su nación: sólo se vinculan por nombre los
    // de nación española o sin nación, igual que el resto del grupo de candidatas (RFEE/ESP).
    // Dos puestos de la misma prueba individual con el mismo grupo de nombre son dos personas
    // («LACASTA AREN» trunca a Sergio y a Daniel): ninguno se vincula por nombre en esa prueba.
    const puestosEnPrueba = new Map<string, Map<string, string[]>>();
    const resultadoAmbiguo = new Set<string>();
    // Los puestos de una prueba conjunta no llevan persona: los oficiales son los de sus partes.
    const sinConjuntas = hayTablaConjuntas(this.db)
      ? `AND NOT EXISTS (SELECT 1 FROM ${TABLA_CONJUNTAS} k WHERE k.combined_competition_id = r.competition_id)`
      : '';
    for (const r of this.db.prepare(
      `SELECT r.id, r.source_name nombre, c.gender genero, r.source fuente, r.competition_id comp, c.format formato
         FROM sport_result r
         JOIN sport_competition c ON c.id = r.competition_id
        WHERE r.source IN (${FUENTES_NOMBRE_SQL}) AND r.person_id IS NULL AND c.format <> 'EQUIPOS'
          AND NOT (r.source IN ('engarde', 'efc') AND coalesce(r.source_country_code, 'ESP') <> 'ESP') ${sinConjuntas}`,
    ).all() as { id: string; nombre: string; genero: string; fuente: string; comp: string; formato: string }[]) {
      const g = grupoDe(r.nombre, r.genero, r.fuente);
      if (!g) continue;
      g.resultados.push({ id: r.id, comp: r.comp });
      if (r.formato !== 'INDIVIDUAL') continue;
      const k = g.clave;
      const m = puestosEnPrueba.get(k) ?? puestosEnPrueba.set(k, new Map()).get(k)!;
      m.set(r.comp, [...(m.get(r.comp) ?? []), r.id]);
    }
    const pruebasAmbiguas = new Map<string, Set<string>>();
    for (const [k, m] of puestosEnPrueba) {
      for (const [comp, ids] of m) {
        if (ids.length < 2) continue;
        (pruebasAmbiguas.get(k) ?? pruebasAmbiguas.set(k, new Set()).get(k)!).add(comp);
        for (const id of ids) resultadoAmbiguo.add(id);
      }
    }
    inf.puestosAmbiguosEnPrueba = resultadoAmbiguo.size;
    type Asalto = {
      id: string; competicion: string; a: string; an: string; ap: string | null; b: string; bn: string; bp: string | null;
      genero: string; fuente: string;
    };
    const asaltos = this.db.prepare(
      `SELECT b.id, b.competition_id competicion, b.fencer_a_ref a, b.fencer_a_name an, b.fencer_a_person_id ap,
              b.fencer_b_ref b, b.fencer_b_name bn, b.fencer_b_person_id bp, c.gender genero, b.source fuente
         FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id
        WHERE b.source IN (${FUENTES_NOMBRE_SQL}) AND c.format <> 'EQUIPOS'
          AND (b.fencer_a_person_id IS NULL OR b.fencer_b_person_id IS NULL)`,
    ).all() as Asalto[];
    for (const b of asaltos) {
      // En Engarde el asalto hereda la persona del puesto de su prueba; no abre grupos de nombre propios.
      if (FUENTES_SOLO_EN_PRUEBA.has(b.fuente)) continue;
      if (!b.ap) grupoDe(b.an, b.genero, b.fuente)?.compsAsalto.add(b.competicion);
      if (!b.bp) grupoDe(b.bn, b.genero, b.fuente)?.compsAsalto.add(b.competicion);
    }
    inf.gruposNombre = grupos.size;
    for (const g of grupos.values()) {
      if (g.clave.endsWith('|*')) g.genero = g.m > 0 && g.f === 0 ? 'M' : g.f > 0 && g.m === 0 ? 'F' : 'MIXTO';
    }
    // Un nombre que sólo sale en asaltos y que, en cada prueba donde sale, cabe en el de un
    // puesto («RAMIREZ LARENA Al» en la poule, «ALEJANDRO RAMIREZ LARENA» clasificado) es ese
    // puesto recortado: no se crea persona, el asalto se vincula después con el puesto.
    const nombresPuesto = this.db.prepare(`SELECT source_name n FROM sport_result WHERE competition_id = ?`);
    const cachePuestos = new Map<string, NombrePreparado[]>();
    const puestosDe = (comp: string) => {
      let l = cachePuestos.get(comp);
      if (!l) cachePuestos.set(comp, (l = (nombresPuesto.all(comp) as { n: string }[]).map((r) => prepararNombre(r.n))));
      return l;
    };
    const recortadoDePuesto = (g: Grupo) => g.resultados.length === 0 && g.compsAsalto.size > 0 && [...g.compsAsalto].every((comp) => {
      const ps = puestosDe(comp);
      return [...g.nombres.keys()].some((n) => {
        const p = prepararNombre(n);
        return ps.some((x) => x.norm !== p.norm && cabeRecortado(p.palabras, x.palabras));
      });
    });

    // Las fundidas también cuentan: su nombre (p. ej. el de la ficha RFEE) lleva a la raíz FIE.
    const pool = [...this.personas.values()]
      .filter((p) => this.conLicencia.has(p.id) || p.pais === 'ESP' || FUENTES_NOMBRE.some((f) => p.fuentesAlias.has(f)))
      .map((p) => p.id);
    const idx = this.indice(pool);
    const compatible = (id: string, g: Genero) => {
      const pg = this.personas.get(id)!.genero;
      return g === 'MIXTO' || pg === null || pg === g;
    };
    const raices = (ids: Iterable<string>, g: Genero) =>
      [...new Set([...ids].filter((id) => compatible(id, g)).map((id) => this.raiz(id)))];

    const resolucion = new Map<string, string>();
    const yaEnPrueba = this.db.prepare(
      `SELECT 1 FROM sport_result r JOIN sport_person p ON p.id = r.person_id
        WHERE r.competition_id = ? AND coalesce(p.merged_into_person_id, p.id) = ? LIMIT 1`,
    );
    this.transaccion(() => {
      this.db.exec('DROP TABLE IF EXISTS temp._mapa_pdf');
      this.db.exec('CREATE TEMP TABLE _mapa_pdf (id TEXT PRIMARY KEY, person_id TEXT NOT NULL)');
      const mapa = this.db.prepare('INSERT INTO temp._mapa_pdf (id, person_id) VALUES (?, ?)');
      // Un puesto que llevaría a una persona que ya tiene puesto en esa prueba, o dos grupos de
      // nombre que llevarían a la misma persona en la misma prueba, son dos tiradores: no se
      // vinculan (si no, `desvincularColisionesPdf` soltaría también el puesto bueno).
      const asignados: { id: string; comp: string; persona: string; existente: boolean }[] = [];
      const ordenados = [...grupos.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [k, g] of ordenados) {
        if (g.palabras.length < 2) {
          inf.nombresCortos += 1;
          continue;
        }
        // El nombre visible conserva el orden de la fuente más fiable (nunca palabras ordenadas).
        const visible = [...g.nombres].sort((x, y) => prioridadFuente(g.fuentes.get(x[0])) - prioridadFuente(g.fuentes.get(y[0]))
          || y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0][0];
        const ref = `nombre:${g.norm}|${g.genero}`;
        const publicadosG = [...g.nombres.keys()].map((nombre) => ({ nombre, fuente: g.fuentes.get(nombre) ?? null }));
        const porNombre = (rs: string[]) => rs.filter((r) => {
          const m = motivoNoUnir(publicadosG, this.publicadosGrupo(r));
          if (m) anotarBloqueo(this.orden, opciones.soloExistentes ? 'pdf_tras_fusiones' : 'pdf', m, `[${r.slice(0, 8)}]`);
          return !m;
        });
        const exactas = raices(idx.exacto.get(g.norm) ?? [], g.genero);
        let cands = porNombre(exactas);
        let evidencia = 'nombre_normalizado_unico';
        if (cands.length === 0 && g.palabras.length >= 3) {
          cands = porNombre(raices(idx.superconjunto(g.palabras), g.genero).filter((r) => !exactas.includes(r)));
          evidencia = 'nombre_superconjunto_unico';
        }
        if (cands.length > 1) {
          inf.ambiguos += 1;
          for (const c of cands.slice(0, 10)) this.candidato(g.fuente, ref, visible, c, 'PROPUESTO', 'nombre_varias_candidatas');
          continue;
        }
        if (cands.length === 1) {
          g.persona = cands[0];
          if (evidencia === 'nombre_normalizado_unico') inf.vinculadosExacto += 1;
          else inf.vinculadosSuperconjunto += 1;
          this.candidato(g.fuente, ref, visible, g.persona, 'CONFIRMADO', evidencia);
        } else if (opciones.soloExistentes) {
          continue;
        } else if (recortadoDePuesto(g)) {
          inf.recortadosSinPersona += 1;
          continue;
        } else {
          g.persona = this.crearPersona(visible, g.norm, g.genero, null, g.fuente).id;
          inf.personasCreadas += 1;
        }
        resolucion.set(k, g.persona);
        for (const { id, comp } of g.resultados) {
          if (resultadoAmbiguo.has(id)) continue;
          asignados.push({ id, comp, persona: g.persona, existente: cands.length === 1 });
        }
      }
      const porPrueba = new Map<string, number>();
      for (const a of asignados) porPrueba.set(`${a.comp}|${a.persona}`, (porPrueba.get(`${a.comp}|${a.persona}`) ?? 0) + 1);
      for (const a of asignados) {
        if ((a.existente && yaEnPrueba.get(a.comp, a.persona)) || porPrueba.get(`${a.comp}|${a.persona}`)! > 1) {
          inf.puestosYaEnPrueba += 1;
          continue;
        }
        mapa.run(a.id, a.persona);
      }
      inf.resultadosVinculados = Number(this.db.prepare(
        `UPDATE sport_result SET person_id = m.person_id FROM temp._mapa_pdf m
          WHERE m.id = sport_result.id AND sport_result.person_id IS NULL`,
      ).run().changes);
      this.db.exec('DROP TABLE temp._mapa_pdf');

      // Asaltos: misma referencia o mismo nombre en la misma prueba; si no, el grupo de nombre.
      type EnPrueba = { p: string | null; n: string; fuente: string };
      const porComp = new Map<string, { ref: Map<string, string>; nombre: Map<string, EnPrueba>; orden: Map<string, string | null> }>();
      const claveOrden = (n: string, fuente: string) => `${normalizarNombre(n)}|${firmaApellidos(n, formatoDeFuente(fuente))}`;
      for (const r of this.db.prepare(
        `SELECT competition_id c, source_fact_key k, source_name n, person_id p, source s FROM sport_result
          WHERE person_id IS NOT NULL AND (source IN (${FUENTES_NOMBRE_SQL}) OR competition_id IN (
            -- Asaltos de Engarde trasladados a una prueba skermo_rfee: se vinculan con sus puestos.
            SELECT competition_id FROM sport_bout
             WHERE source='engarde' AND (fencer_a_person_id IS NULL OR fencer_b_person_id IS NULL)))`,
      ).iterate() as Iterable<{ c: string; k: string; n: string; p: string; s: string }>) {
        let m = porComp.get(r.c);
        if (!m) porComp.set(r.c, (m = { ref: new Map(), nombre: new Map(), orden: new Map() }));
        m.ref.set(r.k, r.p);
        const n = normalizarNombre(r.n);
        const previo = m.nombre.get(n);
        m.nombre.set(n, previo && previo.p !== r.p ? { ...previo, p: null } : { p: r.p, n: r.n, fuente: r.s });
        const o = claveOrden(r.n, r.s);
        m.orden.set(o, m.orden.has(o) && m.orden.get(o) !== r.p ? null : r.p);
      }
      const persona = (comp: string, ref: string, nombre: string, genero: string, fuente: string): string | null => {
        const m = porComp.get(comp);
        const norm = normalizarNombre(nombre);
        // Con las mismas palabras en otro orden sólo si es el único puesto así de la prueba y el
        // nombre no lo impide (hermanos, primos o apellidos cruzados).
        const mismas = m?.nombre.get(norm);
        const porPalabras = mismas?.p && !motivoNoUnir([{ nombre, fuente }], [{ nombre: mismas.n, fuente: mismas.fuente }]) ? mismas.p : null;
        const enPrueba = m?.ref.get(ref) ?? (m?.orden.has(claveOrden(nombre, fuente)) ? m.orden.get(claveOrden(nombre, fuente))! : porPalabras);
        // Un tirador de Engarde sin puesto vinculado en su prueba (extranjero, nombre repetido)
        // no se resuelve por el nombre de otras pruebas.
        if (FUENTES_SOLO_EN_PRUEBA.has(fuente)) return enPrueba;
        const { k } = claveDe(nombre, genero, fuente);
        if (pruebasAmbiguas.get(k)?.has(comp)) return enPrueba;
        return enPrueba ?? resolucion.get(k) ?? null;
      };
      this.db.exec('DROP TABLE IF EXISTS temp._mapa_asalto');
      this.db.exec('CREATE TEMP TABLE _mapa_asalto (id TEXT PRIMARY KEY, a TEXT, b TEXT)');
      const ma = this.db.prepare('INSERT INTO temp._mapa_asalto (id, a, b) VALUES (?, ?, ?)');
      let lados = 0;
      for (const b of asaltos) {
        const a = b.ap ?? persona(b.competicion, b.a, b.an, b.genero, b.fuente);
        let bb = b.bp ?? persona(b.competicion, b.b, b.bn, b.genero, b.fuente);
        if (a !== null && bb === a) bb = b.bp;
        const nuevaA = b.ap ? null : a;
        const nuevaB = b.bp ? null : bb;
        if (nuevaA === null && nuevaB === null) continue;
        if (nuevaA !== null && nuevaA === (b.bp ?? nuevaB)) continue;
        ma.run(b.id, nuevaA, nuevaB);
        lados += (nuevaA ? 1 : 0) + (nuevaB ? 1 : 0);
      }
      this.db.prepare(
        `UPDATE sport_bout SET fencer_a_person_id = coalesce(sport_bout.fencer_a_person_id, m.a),
                               fencer_b_person_id = coalesce(sport_bout.fencer_b_person_id, m.b)
           FROM temp._mapa_asalto m WHERE m.id = sport_bout.id`,
      ).run();
      inf.asaltosLadoVinculados = lados;
      this.db.exec('DROP TABLE temp._mapa_asalto');
    });
    return resolucion;
  }

  pasoFusionPdf(inf: InformeUnificacion['fusionPdf']): void {
    const creadas = [...this.personas.values()].filter(
      (p) => !p.fusionada && FUENTES_NOMBRE.some((f) => p.fuentesAlias.has(f)) && !this.conIdExterno.has(p.id),
    );
    if (creadas.length === 0) return;
    // Destinos: raíces con ID FIE (ESP) o licencia RFEE, con las variantes de todo su grupo.
    const grupos = new Map<string, { genero: Genero | null; variantes: Set<string> }>();
    for (const p of this.personas.values()) {
      if (!(this.conLicencia.has(p.id) || (this.conFie.has(p.id) && p.pais === 'ESP'))) continue;
      const r = this.raiz(p.id);
      const raiz = this.personas.get(r)!;
      const g = grupos.get(r) ?? { genero: raiz.genero, variantes: new Set<string>() };
      for (const v of p.variantes) g.variantes.add(v);
      for (const v of raiz.variantes) g.variantes.add(v);
      grupos.set(r, g);
    }
    const exacto = new Map<string, Set<string>>();
    const palabra = new Map<string, Set<string>>();
    const conjuntos = new Map<string, Set<string>[]>();
    for (const [r, g] of grupos) {
      const cs: Set<string>[] = [];
      for (const v of g.variantes) {
        (exacto.get(v) ?? exacto.set(v, new Set()).get(v)!).add(r);
        const ws = new Set(v.split(' '));
        cs.push(ws);
        for (const w of ws) (palabra.get(w) ?? palabra.set(w, new Set()).get(w)!).add(r);
      }
      conjuntos.set(r, cs);
    }
    const compatible = (r: string, g: Genero | null) => {
      const rg = grupos.get(r)!.genero;
      return g === null || rg === null || rg === g;
    };
    const propuestas = new Map<string, { destino: string; exacta: boolean }>();
    const porDestino = new Map<string, number>();
    for (const p of creadas) {
      let cands = [...(exacto.get(p.norm) ?? [])].filter((r) => compatible(r, p.genero));
      let exacta = true;
      const ws = p.norm.split(' ');
      if (cands.length === 0 && ws.length >= 3) {
        exacta = false;
        let menor: Set<string> | undefined;
        for (const w of ws) {
          const s = palabra.get(w);
          if (!s) { menor = new Set(); break; }
          if (!menor || s.size < menor.size) menor = s;
        }
        cands = [...(menor ?? [])].filter(
          (r) => compatible(r, p.genero) && conjuntos.get(r)!.some((c) => esSubconjunto(ws, c)),
        );
      }
      cands = cands.filter((r) => !this.chocan(r, p.id) && !this.bloqueaNombre('fusion_rfee_pdf', p.id, r));
      if (cands.length > 1) {
        inf.ambiguas += 1;
        this.transaccion(() => {
          for (const c of cands.slice(0, 10)) this.candidato('fusion_rfee_pdf', p.id, p.nombre, c, 'PROPUESTO', 'nombre_varias_candidatas');
        });
        continue;
      }
      if (cands.length === 1) {
        propuestas.set(p.id, { destino: cands[0], exacta });
        porDestino.set(cands[0], (porDestino.get(cands[0]) ?? 0) + 1);
      }
    }
    this.transaccion(() => {
      for (const [pid, { destino, exacta }] of propuestas) {
        if (!exacta && porDestino.get(destino)! > 1) {
          inf.ambiguas += 1;
          continue;
        }
        if (this.fundir(pid, destino)) {
          inf.fusiones += 1;
          this.candidato('fusion_rfee_pdf', pid, this.personas.get(pid)!.nombre, this.raiz(destino), 'CONFIRMADO',
            exacta ? 'nombre_normalizado_unico' : 'nombre_superconjunto_unico');
        }
      }
    });
  }

  /** Grupos de fusión con lo que hace falta para decidir si dos son la misma persona. */
  private grupos(): Map<string, GrupoPersona> {
    const grupos = new Map<string, GrupoPersona>();
    for (const p of this.personas.values()) {
      const r = this.raiz(p.id);
      let x = grupos.get(r);
      if (!x) {
        const rp = this.personas.get(r) ?? p;
        x = {
          id: r, nombre: rp.nombre, genero: rp.genero, pais: rp.pais, variantes: [], fie: false, licencia: false,
          atleta: false, soloNombre: true, nombresFie: [], comps: new Set(), compsPuesto: new Set(), rondas: new Set(),
          fechas: new Set(this.fechas.get(r) ?? []),
        };
        grupos.set(r, x);
      }
      for (const v of p.variantes) if (v && !x.variantes.some((w) => w.join(' ') === v)) x.variantes.push(v.split(' '));
      if (this.conFie.has(p.id)) x.fie = true;
      if (this.conLicencia.has(p.id)) x.licencia = true;
      if (p.atleta) x.atleta = true;
      if (this.conIdExterno.has(p.id) || p.atleta || [...p.fuentesAlias].some((f) => !(FUENTES_NOMBRE as readonly string[]).includes(f))) {
        x.soloNombre = false;
      }
    }
    for (const a of this.db.prepare(`SELECT person_id p, name_original n FROM sport_person_alias WHERE source = 'fie'`).iterate() as Iterable<{
      p: string; n: string;
    }>) {
      const x = grupos.get(this.raiz(a.p));
      const partido = partirNombreFie(a.n);
      if (!x || !partido) continue;
      const k = `${partido.apellidos.join(' ')}|${partido.nombre.join(' ')}`;
      if (!x.nombresFie.some((y) => `${y.apellidos.join(' ')}|${y.nombre.join(' ')}` === k)) x.nombresFie.push(partido);
    }
    const indice = (m: Map<string, number>, k: string) => {
      let i = m.get(k);
      if (i === undefined) m.set(k, (i = m.size));
      return i;
    };
    const comps = new Map<string, number>();
    const rondas = new Map<string, number>();
    const raizDe = new Map<string, GrupoPersona | undefined>();
    const de = (id: string) => {
      if (!raizDe.has(id)) raizDe.set(id, grupos.get(this.raiz(id)));
      return raizDe.get(id);
    };
    for (const r of this.db.prepare(`SELECT person_id p, competition_id c FROM sport_result WHERE person_id IS NOT NULL`).iterate() as Iterable<{
      p: string; c: string;
    }>) {
      const x = de(r.p);
      if (!x) continue;
      const c = indice(comps, r.c);
      x.comps.add(c);
      x.compsPuesto.add(c);
    }
    for (const b of this.db.prepare(
      `SELECT fencer_a_person_id a, fencer_b_person_id b, competition_id c, phase || '|' || round_key k FROM sport_bout
        WHERE fencer_a_person_id IS NOT NULL OR fencer_b_person_id IS NOT NULL`,
    ).iterate() as Iterable<{ a: string | null; b: string | null; c: string; k: string }>) {
      const c = indice(comps, b.c);
      const ronda = indice(rondas, `${b.c}|${b.k}`);
      for (const p of [b.a, b.b]) {
        const x = p ? de(p) : undefined;
        if (!x) continue;
        x.comps.add(c);
        x.rondas.add(ronda);
      }
    }
    return grupos;
  }

  /**
   * Fusiones por nombre con varias salvaguardas, después de juntar las pruebas duplicadas
   * (así dos tiradores distintos se ven en la misma prueba):
   *  1) Nombre recortado: una persona que sólo existe por un nombre publicado («MARCOS
   *     MUÑOZ Miguel An», «RAMIREZ LARENA Al») cuyo nombre cabe en el de otra con más
   *     información (última palabra truncada, o 3+ palabras contenidas), si esa otra es la
   *     única cabeza de todas las candidatas, no coinciden en ninguna prueba ni ronda y
   *     ninguna persona con identificador cabe también en la cabeza sin ser compatible.
   *  2) Apellido FIE: una persona FIE española sin licencia publicada con un solo apellido
   *     («DIAZ Maria Teresa») y una sola persona nacional del mismo género con ese nombre y
   *     un apellido más («DIAZ ESCALONA Maria Teresa»), si ninguna otra persona FIE cabe en
   *     la nacional, no hay hermanos (los dos apellidos con otro nombre de pila), no
   *     coinciden en ninguna prueba y las fechas de nacimiento conocidas no se contradicen.
   */
  pasoFusionNombres(inf: InformeFusionNombres): void {
    const grupos = this.grupos();
    const conHechos = [...grupos.values()].filter((x) => x.comps.size > 0).sort((a, b) => (a.id < b.id ? -1 : 1));
    const porPalabra = new Map<string, Set<GrupoPersona>>();
    for (const x of conHechos) {
      for (const w of new Set(x.variantes.flat())) {
        if (!PARTICULAS.has(w)) (porPalabra.get(w) ?? porPalabra.set(w, new Set()).get(w)!).add(x);
      }
    }
    const vivo = (x: GrupoPersona) => grupos.get(x.id) === x;
    /** Grupos que comparten al menos `minimo` palabras significativas con `ws`. */
    const comparten = (ws: readonly string[], minimo = 2) => {
      const cuenta = new Map<GrupoPersona, number>();
      for (const w of new Set(ws)) {
        if (PARTICULAS.has(w)) continue;
        for (const y of porPalabra.get(w) ?? []) cuenta.set(y, (cuenta.get(y) ?? 0) + 1);
      }
      return [...cuenta].filter(([y, n]) => n >= minimo && vivo(y)).map(([y]) => y);
    };
    const generoCompatible = (a: GrupoPersona, b: GrupoPersona) => !a.genero || !b.genero || a.genero === b.genero;
    const espanola = (x: GrupoPersona) => !x.pais || x.pais === 'ESP';
    const cortan = (a: ReadonlySet<number>, b: ReadonlySet<number>) => {
      const [p, g] = a.size <= b.size ? [a, b] : [b, a];
      for (const c of p) if (g.has(c)) return true;
      return false;
    };
    const aniosContradicen = (a: GrupoPersona, b: GrupoPersona) => fechasChocan(a.fechas, b.fechas);
    const compatibles = (a: GrupoPersona, b: GrupoPersona) => a.variantes.some((wa) => b.variantes.some((wb) => coincidencia(wa, wb)));
    const contenidaEn = (l: GrupoPersona, m: GrupoPersona) => l.variantes.some((wl) => m.variantes.some((wm) => contenidoEn(wl, wm)));
    const publicados = this.db.prepare(
      `SELECT display_name n FROM sport_person WHERE id = ?1 OR merged_into_person_id = ?2
       UNION SELECT a.name_original FROM sport_person_alias a JOIN sport_person p ON p.id = a.person_id
        WHERE (p.id = ?1 OR p.merged_into_person_id = ?2) AND a.source <> 'fie'`,
    );
    type Motivo = { tipo: string; texto: string } | null;
    const rechazar = (r: RechazosFusion, m: NonNullable<Motivo>) => {
      r.rechazos[m.tipo] = (r.rechazos[m.tipo] ?? 0) + 1;
      const ej = (r.ejemplosRechazo[m.tipo] ??= []);
      if (ej.length < 8) ej.push(m.texto);
    };
    const fundir = (o: GrupoPersona, d: GrupoPersona, fuente: string, evidencia: string): boolean => {
      if (!this.fundir(o.id, d.id)) return false;
      this.candidato(fuente, o.id, o.nombre, d.id, 'CONFIRMADO', evidencia);
      for (const c of o.comps) d.comps.add(c);
      for (const c of o.compsPuesto) d.compsPuesto.add(c);
      for (const c of o.rondas) d.rondas.add(c);
      for (const a of o.fechas) d.fechas.add(a);
      for (const v of o.variantes) if (!d.variantes.some((w) => w.join(' ') === v.join(' '))) d.variantes.push(v);
      d.licencia ||= o.licencia;
      d.atleta ||= o.atleta;
      d.soloNombre &&= o.soloNombre;
      grupos.delete(o.id);
      if (inf.ejemplos.length < 40) inf.ejemplos.push(`${fuente}: ${o.nombre} → ${d.nombre}`);
      return true;
    };

    this.transaccion(() => {
      // 1) Nombre recortado.
      for (const x of conHechos) {
        if (!vivo(x) || !x.soloNombre || !espanola(x)) continue;
        let motivo: Motivo = null;
        let fundida = false;
        for (const ws of x.variantes) {
          const largos = comparten(ws).filter((y) => y !== x && espanola(y) && generoCompatible(x, y) && y.variantes.some((wy) => {
            const c = contenidoEn(ws, wy);
            return c !== null && (c.nivel === 'prefijo' || c.fuerza >= 3);
          }) && !this.bloqueaNombre('fusion_nombre_recortado', x.id, y.id));
          if (largos.length === 0) continue;
          const texto = (extra = '') => `${x.nombre} → ${largos.slice(0, 3).map((l) => l.nombre).join(' | ')}${extra}`;
          const cabezas = largos.filter((m) => largos.every((l) => l === m || contenidaEn(l, m)));
          if (cabezas.length !== 1) { motivo = { tipo: 'varias_cabezas', texto: texto() }; continue; }
          const [y] = cabezas;
          if (largos.some((l) => cortan(x.compsPuesto, l.compsPuesto) || cortan(x.rondas, l.rondas))) {
            motivo = { tipo: 'coinciden', texto: texto() };
            continue;
          }
          const competidor = y.variantes.flatMap((wy) => comparten(wy)).find((z) => z !== x && z !== y && !z.soloNombre
            && generoCompatible(y, z) && z.variantes.some((wz) => y.variantes.some((wy) => contenidoEn(wz, wy))) && !compatibles(x, z));
          if (competidor) { motivo = { tipo: 'otra_persona_con_id_cabe', texto: texto(` / ${competidor.nombre}`) }; continue; }
          if (aniosContradicen(x, y)) { motivo = { tipo: 'fecha_nacimiento', texto: texto() }; continue; }
          const nivel = y.variantes.map((wy) => contenidoEn(ws, wy)).find(Boolean)!.nivel;
          if (fundir(x, y, 'fusion_nombre_recortado', `${nivel}:${ws.join(' ')}`)) {
            inf.recortado.fusiones += 1;
            fundida = true;
            break;
          }
        }
        if (fundida || motivo) inf.recortado.candidatos += 1;
        if (!fundida && motivo) rechazar(inf.recortado, motivo);
      }

      // 2) Apellido FIE.
      for (const f of conHechos) {
        if (!vivo(f) || !f.fie || f.licencia || f.pais !== 'ESP' || (f.genero !== 'M' && f.genero !== 'F')) continue;
        let motivo: Motivo = null;
        let fundida = false;
        for (const { apellidos, nombre } of f.nombresFie) {
          if (significativasDe(apellidos).length !== 1) continue;
          const base = [...apellidos, ...nombre];
          // Ya tiene fundido su nombre nacional: otro con un apellido más es otra persona.
          if (f.variantes.some((v) => apellidoDeMas(base, v))) { motivo = { tipo: 'ya_tiene_nacional', texto: f.nombre }; continue; }
          const cands = new Map<GrupoPersona, string>();
          for (const y of comparten(base, significativasDe(base).length)) {
            if (y === f || y.fie || !espanola(y) || y.genero !== f.genero) continue;
            for (const wy of y.variantes) {
              const extra = apellidoDeMas(base, wy);
              if (extra) cands.set(y, extra);
            }
          }
          if (cands.size === 0) continue;
          const texto = (extra = '') => `${f.nombre} ← ${[...cands.keys()].slice(0, 3).map((y) => y.nombre).join(' | ')}${extra}`;
          if (cands.size > 1) { motivo = { tipo: 'varias_nacionales', texto: texto() }; continue; }
          const [[y, extra]] = [...cands];
          // La FIE publica el primer apellido: «LOPEZ Ana» no es «ANA GALLARIN LOPEZ».
          const [apellido] = significativasDe(apellidos);
          const primero = (publicados.all(y.id, y.id) as { n: string }[]).some(({ n: publicado }) => {
            const ws = palabrasNombre(publicado).filter((w) => !nombre.includes(w));
            const i = ws.indexOf(apellido);
            const j = ws.indexOf(extra);
            return i >= 0 && j > i;
          });
          if (!primero) { motivo = { tipo: 'no_es_el_primer_apellido', texto: texto() }; continue; }
          if (this.bloqueaNombre('fusion_apellido_fie', y.id, f.id)) { motivo = { tipo: 'orden_nombre', texto: texto() }; continue; }
          const otraFie = y.variantes.flatMap((wy) => comparten(wy).filter((z) => z !== f && z.fie && generoCompatible(y, z)
            && z.variantes.some((wz) => significativasDe(wz).length >= 2 && contiene(wy, wz))))[0];
          if (otraFie) { motivo = { tipo: 'otra_fie_cabe', texto: texto(` / ${otraFie.nombre}`) }; continue; }
          // Hermanos: los dos apellidos con otro nombre de pila. Una inicial o un nombre
          // recortado («DIAZ ESCALONA M», «… Maria T») es la misma persona, no cuenta.
          const apellidosNacionales = [...apellidos, extra];
          const hermano = comparten(apellidosNacionales, significativasDe(apellidosNacionales).length).find((z) => z !== y && z !== f
            && z.variantes.some((wz) => {
              const pila = quitar(wz, apellidosNacionales);
              return pila !== null && significativasDe(pila).length > 0 && !pilaCompatible(pila, nombre);
            }));
          if (hermano) { motivo = { tipo: 'hermanos', texto: texto(` / ${hermano.nombre}`) }; continue; }
          if (cortan(f.comps, y.comps)) { motivo = { tipo: 'coinciden', texto: texto() }; continue; }
          if (f.atleta && y.atleta) { motivo = { tipo: 'dos_fichas', texto: texto() }; continue; }
          if (aniosContradicen(f, y)) {
            motivo = { tipo: 'fecha_nacimiento', texto: texto(` / ${[...f.fechas].join(',')} ≠ ${[...y.fechas].join(',')}`) };
            continue;
          }
          const mismaFecha = f.fechas.size > 0 && y.fechas.size > 0;
          if (fundir(y, f, 'fusion_apellido_fie', `fie_un_apellido:${base.join(' ')}+${extra}${mismaFecha ? ':fecha_casa' : ''}`)) {
            inf.apellidoFie.fusiones += 1;
            if (mismaFecha) inf.apellidoFie.fechaNacimientoCasa += 1;
            fundida = true;
            break;
          }
        }
        if (fundida || motivo) inf.apellidoFie.candidatos += 1;
        if (!fundida && motivo) rechazar(inf.apellidoFie, motivo);
      }
    });
  }
}

type GrupoPersona = {
  id: string; nombre: string; genero: Genero | null; pais: string | null;
  /** Variantes normalizadas del grupo, partidas en palabras. */
  variantes: string[][];
  fie: boolean; licencia: boolean; atleta: boolean;
  /** Sin ID externo ni ficha, y alias sólo de fuentes por nombre. */
  soloNombre: boolean;
  nombresFie: { apellidos: string[]; nombre: string[] }[];
  /** Índices de prueba (con puesto o asalto), de prueba con puesto y de ronda (prueba, fase, ronda). */
  comps: Set<number>; compsPuesto: Set<number>; rondas: Set<number>;
  /** Fechas de nacimiento conocidas (FIE, Skermo). */
  fechas: Set<string>;
};

type RechazosFusion = { rechazos: Record<string, number>; ejemplosRechazo: Record<string, string[]> };

export type InformeFusionNombres = {
  recortado: { candidatos: number; fusiones: number } & RechazosFusion;
  /** `fechaNacimientoCasa`: fusiones con fecha conocida en los dos lados (y compatible). */
  apellidoFie: { candidatos: number; fusiones: number; fechaNacimientoCasa: number } & RechazosFusion;
  ejemplos: string[];
};

const nuevoInformeFusionNombres = (): InformeFusionNombres => ({
  recortado: { candidatos: 0, fusiones: 0, rechazos: {}, ejemplosRechazo: {} },
  apellidoFie: { candidatos: 0, fusiones: 0, fechaNacimientoCasa: 0, rechazos: {}, ejemplosRechazo: {} },
  ejemplos: [],
});

/** `grande` tiene todas las palabras de `pequeno` (con repetición). */
function contiene(grande: readonly string[], pequeno: readonly string[]): boolean {
  const libres = [...grande];
  for (const w of pequeno) {
    const i = libres.indexOf(w);
    if (i < 0) return false;
    libres.splice(i, 1);
  }
  return true;
}

/** `grande` sin las palabras de `pequeno` (con repetición), o null si no las tiene todas. */
function quitar(grande: readonly string[], pequeno: readonly string[]): string[] | null {
  const libres = [...grande];
  for (const w of pequeno) {
    const i = libres.indexOf(w);
    if (i < 0) return null;
    libres.splice(i, 1);
  }
  return libres;
}

/** La única palabra significativa que `nacional` tiene de más sobre `fie`, o null. */
export function apellidoDeMas(fie: readonly string[], nacional: readonly string[]): string | null {
  if (nacional.length !== fie.length + 1 || !contiene(nacional, fie)) return null;
  const libres = [...nacional];
  for (const w of fie) libres.splice(libres.indexOf(w), 1);
  return PARTICULAS.has(libres[0]) ? null : libres[0];
}

/** `corto` casa con `largo` con menos información (menos palabras o la misma truncada). */
export function contenidoEn(corto: readonly string[], largo: readonly string[]) {
  const c = coincidencia(corto, largo);
  if (!c || c.nivel === 'exacto') return null;
  const menor = corto.length < largo.length || (corto.length === largo.length && corto.join('').length < largo.join('').length);
  return menor ? c : null;
}

/** Fusiones por nombre de `pasoFusionNombres` sobre una base ya unificada. */
export function fusionarPorNombre(db: DatabaseSync, nacimientos?: ReadonlyMap<string, readonly string[]>): InformeFusionNombres {
  const inf = nuevoInformeFusionNombres();
  new Unificador(db, nacimientos).pasoFusionNombres(inf);
  return inf;
}

/**
 * Una persona no puede tener dos puestos en la misma prueba individual. En rfee_pdf todo
 * vínculo es por nombre, así que dos puestos con la misma raíz son dos tiradores que el
 * nombre (truncado o con los apellidos en otro orden) no distingue: se desvinculan los
 * puestos y los asaltos de esa persona en esa prueba.
 */
export function desvincularColisionesPdf(db: DatabaseSync): InformeUnificacion['colisionesPdf'] {
  const inf = { pruebas: 0, resultados: 0, asaltosLado: 0 };
  const colisiones = db.prepare(
    `SELECT r.competition_id comp, coalesce(p.merged_into_person_id, p.id) raiz, group_concat(r.id, ',') ids
       FROM sport_result r JOIN sport_person p ON p.id = r.person_id JOIN sport_competition c ON c.id = r.competition_id
      WHERE r.source = 'rfee_pdf' AND c.format = 'INDIVIDUAL'
      GROUP BY 1, 2 HAVING count(*) > 1`,
  ).all() as { comp: string; raiz: string; ids: string }[];
  if (colisiones.length === 0) return inf;
  const resultado = db.prepare('UPDATE sport_result SET person_id = NULL WHERE id = ?');
  const ladoA = db.prepare(
    `UPDATE sport_bout SET fencer_a_person_id = NULL WHERE competition_id = ? AND source = 'rfee_pdf' AND fencer_a_person_id IN
       (SELECT id FROM sport_person WHERE id = ? OR merged_into_person_id = ?)`,
  );
  const ladoB = db.prepare(
    `UPDATE sport_bout SET fencer_b_person_id = NULL WHERE competition_id = ? AND source = 'rfee_pdf' AND fencer_b_person_id IN
       (SELECT id FROM sport_person WHERE id = ? OR merged_into_person_id = ?)`,
  );
  db.exec('BEGIN');
  try {
    for (const c of colisiones) {
      inf.pruebas += 1;
      for (const id of c.ids.split(',')) inf.resultados += Number(resultado.run(id).changes);
      inf.asaltosLado += Number(ladoA.run(c.comp, c.raiz, c.raiz).changes) + Number(ladoB.run(c.comp, c.raiz, c.raiz).changes);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return inf;
}

/**
 * En las pruebas por equipos de las fuentes por nombre cada fila es un equipo, no un
 * tirador: se desvinculan sus puestos y asaltos de cualquier persona.
 */
export function desvincularEquipos(db: DatabaseSync): Pick<InformeUnificacion['equipos'], 'resultados' | 'asaltosLado'> {
  const equipos = `SELECT id FROM sport_competition WHERE format = 'EQUIPOS'`;
  const resultados = Number(db.prepare(
    `UPDATE sport_result SET person_id = NULL
      WHERE person_id IS NOT NULL AND source IN (${FUENTES_NOMBRE_SQL}) AND competition_id IN (${equipos})`,
  ).run().changes);
  const ladoA = Number(db.prepare(
    `UPDATE sport_bout SET fencer_a_person_id = NULL
      WHERE fencer_a_person_id IS NOT NULL AND source IN (${FUENTES_NOMBRE_SQL}) AND competition_id IN (${equipos})`,
  ).run().changes);
  const ladoB = Number(db.prepare(
    `UPDATE sport_bout SET fencer_b_person_id = NULL
      WHERE fencer_b_person_id IS NOT NULL AND source IN (${FUENTES_NOMBRE_SQL}) AND competition_id IN (${equipos})`,
  ).run().changes);
  return { resultados, asaltosLado: ladoA + ladoB };
}

/**
 * Borra las personas creadas por nombre que ya no tienen nada: sin puestos, asaltos, ID
 * externo, ficha de deportista, seguidores, ranking ni personas fundidas en ellas, y cuyos
 * alias son todos de fuentes por nombre. Sólo quedan así las que nacieron de filas de equipo.
 */
export function borrarPersonasHuerfanas(db: DatabaseSync): number {
  const huerfanas = db.prepare(
    `SELECT p.id FROM sport_person p
      WHERE p.athlete_id IS NULL AND p.merged_into_person_id IS NULL
        AND EXISTS (SELECT 1 FROM sport_person_alias a WHERE a.person_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM sport_person_alias a WHERE a.person_id = p.id AND a.source NOT IN (${ALIAS_BORRABLES_SQL}))
        AND NOT EXISTS (SELECT 1 FROM sport_result r WHERE r.person_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM sport_bout b WHERE b.fencer_a_person_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM sport_bout b WHERE b.fencer_b_person_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM sport_external_id x WHERE x.person_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM sport_favorite f WHERE f.person_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM sport_ranking_entry e WHERE e.person_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM sport_person h WHERE h.merged_into_person_id = p.id)`,
  ).all() as { id: string }[];
  if (huerfanas.length === 0) return 0;
  const borrar = db.prepare('DELETE FROM sport_person WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const { id } of huerfanas) borrar.run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return huerfanas.length;
}

/**
 * Borra las ediciones sin ninguna prueba. Una edición vacía no se enseña a nadie y su
 * clave única bloquea la sincronización cuando otra edición nueva la reutiliza.
 */
export function borrarEdicionesVacias(db: DatabaseSync): number {
  return Number(db.prepare(
    `DELETE FROM sport_edition WHERE NOT EXISTS (SELECT 1 FROM sport_competition c WHERE c.edition_id = sport_edition.id)`,
  ).run().changes);
}

export function unificarPersonas(
  db: DatabaseSync,
  opciones: {
    catalogo?: readonly FilaCatalogoNacional[];
    fechas?: FechasNacimiento;
    /** Licencia EFC → año de nacimiento publicado (`leerNacimientosEfc`). */
    nacimientosEfc?: ReadonlyMap<string, number>;
  } = {},
): InformeUnificacion {
  const fechas: FechasNacimiento = opciones.fechas ?? { fie: new Map(), skermo: new Map() };
  const inicio = Date.now();
  const informePdf = (): InformeUnificacion['pdf'] => ({
    gruposNombre: 0, vinculadosExacto: 0, vinculadosSuperconjunto: 0, personasCreadas: 0, ambiguos: 0,
    nombresCortos: 0, resultadosVinculados: 0, asaltosLadoVinculados: 0, puestosAmbiguosEnPrueba: 0,
    recortadosSinPersona: 0, puestosYaEnPrueba: 0,
  });
  const informe: InformeUnificacion = {
    antes: medir(db),
    despues: undefined as unknown as Medida,
    fie: { idsDistintos: 0, personasReutilizadas: 0, personasCreadas: 0, aliasNuevos: 0, resultadosVinculados: 0, asaltosLadoVinculados: 0 },
    fusionLicencia: { licenciasConVarias: 0, fusiones: 0, omitidas: 0 },
    fusionFieRfee: { fusiones: 0, exactas: 0, superconjunto: 0, ambiguas: 0, omitidasPorAtleta: 0, omitidasPorFecha: 0, omitidasYaVinculada: 0, omitidasPorOrden: 0 },
    particionFecha: undefined as unknown as InformeParticion,
    fusionFecha: undefined as unknown as InformeFusionFecha,
    pdf: informePdf(),
    fusionPdf: { fusiones: 0, ambiguas: 0 },
    colisionesPdf: { pruebas: 0, resultados: 0, asaltosLado: 0 },
    equipos: { resultados: 0, asaltosLado: 0, personasBorradas: 0 },
    solapes: undefined as unknown as InformeDepuracion,
    solapesEngarde: undefined as unknown as InformeSolapesEngarde,
    duplicados: undefined as unknown as InformeDuplicados,
    revinculo: undefined as unknown as InformeRevinculo,
    fusionNombres: nuevoInformeFusionNombres(),
    pdfTrasFusiones: informePdf(),
    fusionEvidencia: undefined as unknown as InformeEvidencia,
    efc: {
      filas: 0, licencias: 0, licenciasFie: 0, licenciasNuevas: 0, licenciasExistentes: 0, fusionesFie: 0, filasVinculadas: 0,
      filasMismaPrueba: 0, sinLicencia: { grupos: 0, fie: 0, efc: 0, sinVincular: 0 }, rechazos: {},
    },
    conjuntas: undefined as unknown as InformeConjuntas,
    asaltosConjuntas: undefined as unknown as InformeAsaltosConjuntas,
    orden: nuevoInformeOrden(),
    edicionesVacias: 0,
    candidatosRegistrados: 0,
    segundos: 0,
  };
  const deFie = new Unificador(db);
  deFie.pasoFie(informe.fie);
  // Antes de cualquier fusión por nombre: los puestos con fecha publicada de otra persona
  // salen de la suya, y la fecha exacta une lo que el nombre no basta para unir.
  informe.particionFecha = partirPorFechaNacimiento(db, fechas);
  informe.fusionFecha = fundirPorFechaNacimiento(db, fechas);
  const u = new Unificador(db, nacimientosPorPersona(db, fechas));
  u.candidatos = deFie.candidatos;
  u.pasoFusionLicencia(informe.fusionLicencia);
  u.pasoFusionFieRfee(informe.fusionFieRfee);
  u.pasoEfc(informe.efc, opciones.nacimientosEfc);
  // Antes de los solapes y duplicados, que meterían una conjunta entera en una de sus partes.
  const conjuntas = registrarConjuntas(db);
  informe.conjuntas = conjuntas.informe;
  // Antes del paso por nombre: las pruebas Engarde repetidas no deben crear personas.
  informe.solapesEngarde = depurarSolapesEngarde(db, 0.5, conjuntas.ids);
  informe.equipos = { ...desvincularEquipos(db), personasBorradas: 0 };
  u.pasoPdf(informe.pdf);
  u.pasoFusionPdf(informe.fusionPdf);
  informe.colisionesPdf = desvincularColisionesPdf(db);
  informe.solapes = depurarSolapes(db);
  informe.duplicados = fundirDuplicados(db, { catalogo: opciones.catalogo, excluir: conjuntas.ids });
  informe.revinculo = revincularAsaltosPorPuesto(db);
  u.pasoFusionNombres(informe.fusionNombres);
  // Con las fusiones, nombres que tenían varias candidatas pueden tener ya una sola.
  u.pasoPdf(informe.pdfTrasFusiones, { soloExistentes: true });
  const colisiones = desvincularColisionesPdf(db);
  for (const k of Object.keys(colisiones) as (keyof typeof colisiones)[]) informe.colisionesPdf[k] += colisiones[k];
  informe.asaltosConjuntas = vincularAsaltosConjuntas(db);
  informe.conjuntas.puestosDesvinculados += desvincularPuestosConjuntas(db);
  informe.equipos.personasBorradas = borrarPersonasHuerfanas(db);
  // Al final (fuera del `Unificador`, que ya no se usa) y tras retirar las personas vacías,
  // que contarían como candidatas. Una fusión puede dejar sola a otra candidata: se repite.
  const nacimientos = nacimientosPorPersona(db, fechas);
  informe.fusionEvidencia = fundirPorEvidencia(db, nacimientos);
  for (let i = 0; i < 3; i += 1) {
    const otra = fundirPorEvidencia(db, nacimientos);
    if (otra.recortado.fusiones + otra.fie.fusiones === 0) break;
    for (const m of ['recortado', 'fie'] as const) informe.fusionEvidencia[m].fusiones += otra[m].fusiones;
    informe.fusionEvidencia.ejemplos.push(...otra.ejemplos);
  }
  informe.orden = u.orden;
  sumarOrden(informe.orden, informe.fusionEvidencia.orden);
  informe.edicionesVacias = borrarEdicionesVacias(db);
  informe.candidatosRegistrados = u.candidatos;
  informe.despues = medir(db);
  informe.segundos = Math.round((Date.now() - inicio) / 100) / 10;
  return informe;
}

function main(): void {
  const rutaDb = argumento('nuevo', argumento('db', NUEVO_POR_DEFECTO));
  const salida = argumento('informe', join(CARPETA_TRABAJO, 'unificacion-informe.json'));
  const catalogo = leerCatalogoNacional(argumento('inventario', INVENTARIO_NACIONAL));
  const fechas = leerFechasNacimiento({
    cacheSkermo: argumento('cache-skermo', CACHE_SKERMO),
    fieAtletas: argumento('fie-atletas', FIE_ATLETAS),
  });
  const nacimientosEfc = leerNacimientosEfc(argumento('hechos-efc', join(CARPETA_TRABAJO, 'hechos', 'lote7-efc')));
  const db = new DatabaseSync(rutaDb);
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  let informe: InformeUnificacion;
  try {
    informe = unificarPersonas(db, { catalogo, fechas, nacimientosEfc });
  } finally {
    restaurarGuardia(db);
    db.close();
  }
  writeFileSync(salida, JSON.stringify(informe, null, 2));
  console.log(JSON.stringify({ ...informe, duplicados: { ...informe.duplicados, ejemplos: informe.duplicados.ejemplos.slice(0, 5) } }, null, 2));
  console.log(`Informe: ${salida}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
