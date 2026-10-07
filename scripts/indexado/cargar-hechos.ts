/**
 * Carga los ficheros de hechos (`src/lib/ingest/hechos/formato.ts`) en un SQLite
 * de trabajo, por claves naturales y sin tocar el remoto.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/cargar-hechos.ts \
 *     [--db <nuevo.sqlite>] [--base <base.sqlite>] [--hechos <carpeta>] \
 *     [--carpetas fie,fie-antiguo,pdf-lector,pdf-droid] [--informe <json>] [--sin-genero-clave]
 *
 * Si `--db` no existe se crea copiando `--base`. Reglas:
 *  - Upsert por (source, season, tournament_key), (source, season, competition_key),
 *    (competition_id, source, source_fact_key) y la clave de asalto con
 *    fencer_a_ref < fencer_b_ref. Los IDs y los vínculos a persona existentes se
 *    conservan siempre.
 *  - `content_hash` = sha256 del hecho canónico; la revisión sólo sube si cambia
 *    algún valor guardado.
 *  - Varias extracciones de la misma prueba: por sección se elige la de mayor
 *    rango (lector_fie > lector_pdf completo > droid > lector_pdf parcial), luego
 *    mejor estado y más filas.
 *  - Una sección con filas previas sólo se sustituye (borrando lo que sobra) si la
 *    nueva es `completo` y tiene al menos tantas filas. Con claves estables (ID
 *    FIE, licencia) una extracción parcial se fusiona sin borrar; con claves de
 *    posición en el PDF se conserva lo existente.
 *  - Engarde: el sexo del fichero se contrasta con el código de la clave (`genero-clave.ts`);
 *    sólo se cambia al del código si los nombres de pila de la clasificación lo confirman, y
 *    queda anotado en `generoClave` del informe (con `--sin-genero-clave` no se contrasta).
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  hechosPrueba,
  type AsaltoHecho,
  type HechosPrueba,
  type ResultadoHecho,
} from '../../src/lib/ingest/hechos/formato';
import {
  ahora,
  argumento,
  bandera,
  BASE_POR_DEFECTO,
  CARPETA_TRABAJO,
  contar,
  type Contadores,
  jsonCanonico,
  normalizarNombre,
  palabrasNombre,
  NUEVO_POR_DEFECTO,
  prepararCopiaTrabajo,
  quitarGuardia,
  restaurarGuardia,
  sha256,
  uuid,
} from './comun';
import { consistenciaCuadro, pesoCuadro, type AsaltoCuadro } from './cuadro-consistencia';
import { decidirGeneroClave, diccionarioGeneroDeBase, type AccionGeneroClave, type DecisionGeneroClave } from './genero-clave';

import {
  ambitoFirma,
  CLAVES_FIJAS,
  clavesEstables,
  estadoCobertura,
  estadosDocumento,
  firmaAsalto,
  lecturaUnica,
  mejorEstado,
  mismoAsaltoOtraLectura,
  mismosPuntos,
  nombresCompatibles,
  repetidosEntreRondas,
} from '../../src/lib/ingest/hechos/reglas-carga';

export {
  ambitoFirma,
  CLAVES_FIJAS,
  estadosDocumento,
  firmaAsalto,
  lecturaUnica,
  mismoAsaltoOtraLectura,
  nombresCompatibles,
  repetidosEntreRondas,
};

export type EntradaHechos = { ruta: string; carpeta: string; leer: () => unknown };

export type Seccion = 'results' | 'pools' | 'tableau';
const SECCIONES: readonly Seccion[] = ['results', 'pools', 'tableau'];
type Estado = HechosPrueba['status']['results'];
type Modo = 'nuevo' | 'reemplazo' | 'fusion' | 'deduplicado' | 'conservado' | 'vacio';

/** Asaltos rfee_pdf repetidos dentro de la misma prueba y ámbito (misma firma). */
export function contarAsaltosPdfDuplicados(db: DatabaseSync): number {
  const vistos = new Set<string>();
  let repetidos = 0;
  for (const b of db.prepare(
    `SELECT competition_id c, phase f, round_key r, fencer_a_name an, score_a sa, fencer_b_name bn, score_b sb
       FROM sport_bout WHERE source='rfee_pdf'`,
  ).iterate() as unknown as Iterable<{ c: string; f: string; r: string; an: string; sa: number; bn: string; sb: number }>) {
    const k = `${b.c}\u0000${ambitoFirma(b.f, b.r)}\u0000${firmaAsalto(b.an, b.sa, b.bn, b.sb)}`;
    if (vistos.has(k)) repetidos += 1;
    else vistos.add(k);
  }
  return repetidos;
}

const RANGO_ESTADO: Record<Estado, number> = { completo: 3, parcial: 2, sin_resultados: 1, ilegible: 0 };

/** lector_fie > lector_pdf (completo) > droid > lector_pdf parcial > desconocido. */
export function rangoExtractor(extractor: string, estado: Estado): number {
  if (extractor === 'lector_fie') return 4;
  if (extractor === 'lector_pdf') return estado === 'completo' ? 3 : 1;
  if (extractor === 'droid' || extractor.startsWith('droid:')) return 2;
  return 0;
}

type Meta = {
  entrada: EntradaHechos;
  source: HechosPrueba['source'];
  season: string;
  competitionKey: string;
  extractor: string;
  status: HechosPrueba['status'];
  filas: Record<Seccion, number>;
};

export type InformeCarga = {
  ficheros: { leidos: number; validos: number; rechazados: number; porCarpeta: Record<string, number> };
  rechazados: { ruta: string; error: string }[];
  pruebas: number;
  tablas: Contadores;
  secciones: Contadores;
  avisos: Record<string, number>;
  asaltosPdfDuplicados: { antes: number; despues: number };
  /** Pruebas de Engarde con el sexo del fichero contrario al código de la clave (`genero-clave.ts`). */
  generoClave: InformeGeneroClave[];
  segundos: number;
};

export type InformeGeneroClave = {
  season: string; competitionKey: string; accion: AccionGeneroClave; fichero: string; genero: string; codigo: string | null;
  votos: DecisionGeneroClave['votos'];
};

function filasSeccion(h: HechosPrueba, s: Seccion): number {
  if (s === 'results') return h.results.length;
  const fase = s === 'pools' ? 'POULE' : 'TABLEAU';
  return h.bouts.filter((b) => b.phase === fase).length;
}

function elegir(metas: Meta[], s: Seccion): Meta | null {
  const validas = metas.filter((m) => m.filas[s] > 0 || m.status[s] === 'sin_resultados');
  if (validas.length === 0) return null;
  const clave = (m: Meta) => [rangoExtractor(m.extractor, m.status[s]), RANGO_ESTADO[m.status[s]], m.filas[s]];
  return validas.sort((x, y) => {
    const a = clave(x);
    const b = clave(y);
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return b[i] - a[i];
    return x.entrada.ruta < y.entrada.ruta ? -1 : 1;
  })[0];
}

/**
 * Cuadro de una prueba individual rfee_pdf: sale de una sola lectura, la de más asaltos coherentes
 * (y después más ganadores confirmados en la ronda siguiente); a igualdad, el rango de
 * siempre. Sin esto un droid con más filas pero cruces imposibles ganaba al lector.
 */
export function elegirCuadroPdf<M extends Pick<Meta, 'extractor' | 'status' | 'filas'> & { entrada: { ruta: string } }>(
  metas: M[],
  asaltosDe: (m: M) => readonly AsaltoHecho[],
): M | null {
  const validas = metas.filter((m) => m.filas.tableau > 0 || m.status.tableau === 'sin_resultados');
  if (validas.length === 0) return null;
  const claves = new Map(validas.map((m) => [m, [
    ...pesoCuadro(asaltosDe(m).filter((b) => b.phase === 'TABLEAU')),
    rangoExtractor(m.extractor, m.status.tableau), RANGO_ESTADO[m.status.tableau], m.filas.tableau,
  ]]));
  return validas.sort((x, y) => {
    const a = claves.get(x)!;
    const b = claves.get(y)!;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return b[i] - a[i];
    return x.entrada.ruta < y.entrada.ruta ? -1 : 1;
  })[0];
}

function cargar(m: Meta): HechosPrueba {
  return hechosPrueba.parse(m.entrada.leer());
}

type FilaResultado = {
  id: string;
  source_fact_key: string;
  person_id: string | null;
  source_name: string;
  source_country_code: string | null;
  source_club: string | null;
  position: number | null;
  position_raw: string | null;
  official_points: string | null;
  occurred_on: string | null;
  source_url: string | null;
  content_hash: string;
};

type FilaAsalto = {
  id: string;
  round_key: string;
  fencer_a_ref: string;
  fencer_b_ref: string;
  fencer_a_person_id: string | null;
  fencer_b_person_id: string | null;
  fencer_a_name: string;
  fencer_b_name: string;
  score_a: number;
  score_b: number;
  occurred_on: string | null;
  source_url: string | null;
  content_hash: string;
};

type Competicion = { id: string; edition_id: string; competition_key: string; source: string; season: string };

class Cargador {
  readonly tablas: Contadores = {};
  readonly secciones: Contadores = {};
  readonly avisos: Record<string, number> = {};
  private pendientes = 0;
  private readonly st: Record<string, StatementSync> = {};
  private readonly competicionesUsadas = new Set<string>();
  /** edition_id → secciones de resultados elegidas, para la cobertura `pdf` por documento. */
  private readonly documentos = new Map<
    string,
    { season: string; url: string; competiciones: Set<string>; estados: Estado[] }
  >();

  /**
   * `pruebasConHechos`: claves `source\0season\0competitionKey` presentes en esta carga.
   * El lector actual también emite `~n` cuando un documento trae varias tablas de la
   * misma prueba (1ª fase y fase final); esas partes tienen fichero propio y no se absorben.
   */
  /** Pruebas de Engarde cuyo género no coincide con el código de la clave (`genero-clave.ts`). */
  readonly generosClave: InformeGeneroClave[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly loteFilas = 25_000,
    private readonly pruebasConHechos: ReadonlySet<string> = new Set(),
    private readonly diccionarioGenero: ReadonlyMap<string, 'M' | 'F'> | null = null,
  ) {}

  /**
   * El sexo del fichero de Engarde contra el código de la clave: con `corregido` (los nombres de
   * pila confirman el código) se usa el del código; con `dudoso` o `desmentido` se deja y se avisa.
   */
  private revisarGeneroClave(h: HechosPrueba): HechosPrueba {
    if (!this.diccionarioGenero || h.source !== 'engarde') return h;
    const c = h.competition;
    const d = decidirGeneroClave({ competitionKey: c.competitionKey, weapon: c.weapon, gender: c.gender, nombres: h.results.map((r) => r.name) },
      this.diccionarioGenero);
    if (d.accion !== 'corregido' && d.accion !== 'dudoso' && d.accion !== 'desmentido') return h;
    this.aviso(`genero_clave_${d.accion}`);
    this.generosClave.push({ season: h.edition.season, competitionKey: c.competitionKey, accion: d.accion, fichero: d.fichero, genero: d.genero,
      codigo: d.codigo?.codigo ?? null, votos: d.votos });
    return d.accion === 'corregido' ? { ...h, competition: { ...c, gender: d.genero as HechosPrueba['competition']['gender'] } } : h;
  }

  private q(sql: string): StatementSync {
    return (this.st[sql] ??= this.db.prepare(sql));
  }

  private aviso(clave: string, n = 1): void {
    this.avisos[clave] = (this.avisos[clave] ?? 0) + n;
  }

  empezar(): void {
    this.db.exec('BEGIN');
  }

  private escrito(n = 1): void {
    this.pendientes += n;
    if (this.pendientes >= this.loteFilas) {
      this.db.exec('COMMIT');
      this.db.exec('BEGIN');
      this.pendientes = 0;
    }
  }

  terminar(): void {
    this.db.exec('COMMIT');
  }

  abortar(): void {
    if (this.db.isTransaction) this.db.exec('ROLLBACK');
  }

  aplicarGrupo(metas: Meta[]): void {
    const principal = [...metas].sort((x, y) => {
      const a = rangoExtractor(x.extractor, x.status.results);
      const b = rangoExtractor(y.extractor, y.status.results);
      if (a !== b) return b - a;
      const fx = x.filas.results + x.filas.pools + x.filas.tableau;
      const fy = y.filas.results + y.filas.pools + y.filas.tableau;
      if (fx !== fy) return fy - fx;
      return x.entrada.ruta < y.entrada.ruta ? -1 : 1;
    })[0];
    const cache = new Map<string, HechosPrueba>();
    const leer = (m: Meta) => {
      let h = cache.get(m.entrada.ruta);
      if (!h) {
        h = cargar(m);
        cache.set(m.entrada.ruta, h);
      }
      return h;
    };
    const h0 = this.revisarGeneroClave(leer(principal));
    const edicionId = this.upsertEdicion(h0);
    const comp = this.upsertCompeticion(h0, edicionId);
    const divisiones = h0.source === 'rfee_pdf' ? this.absorberDivisiones(comp) : [];
    for (const s of SECCIONES) {
      const m = s === 'tableau' && h0.source === 'rfee_pdf' && h0.competition.format === 'INDIVIDUAL'
        ? elegirCuadroPdf(metas, (x) => leer(x).bouts)
        : elegir(metas, s);
      if (!m) continue;
      const h = leer(m);
      const r =
        s === 'results'
          ? this.aplicarResultados(comp, h)
          : this.aplicarAsaltos(comp, h, s === 'pools' ? 'POULE' : 'TABLEAU');
      contar(this.secciones, s, h.source, r.modo);
      contar(this.secciones, s, h.source, `extractor:${m.extractor}`);
      this.cobertura(comp, h, s, r.modo);
      if (s === 'results' && h.source === 'rfee_pdf') {
        const d = this.documentos.get(edicionId) ?? {
          season: h.edition.season,
          url: h.sourceUrl,
          competiciones: new Set<string>(),
          estados: [],
        };
        d.competiciones.add(comp.id);
        d.estados.push(h.status.results);
        this.documentos.set(edicionId, d);
      }
    }
    if (divisiones.length > 0) this.cerrarDivisiones(comp, divisiones);
  }

  /**
   * El lector antiguo partía a veces una prueba en dos (`<clave>~2`, `<clave>~3`)
   * y el nuevo la lee entera bajo `<clave>`. Antes de aplicar las secciones, los
   * asaltos de las partes pasan a la prueba unida, para que la regla de sustitución
   * o de deduplicado los trate como asaltos previos de esa misma prueba.
   */
  private absorberDivisiones(comp: Competicion): Competicion[] {
    const partes = (this.q(
      `SELECT id, edition_id, competition_key, source, season FROM sport_competition
        WHERE source=? AND season=? AND edition_id=? AND id<>? AND substr(competition_key, 1, ?) = ?`,
    ).all(comp.source, comp.season, comp.edition_id, comp.id, comp.competition_key.length, comp.competition_key) as
      Competicion[]).filter((p) => /^~\d+$/.test(p.competition_key.slice(comp.competition_key.length)));
    const T = 'divisiones';
    const sinHechos = partes.filter((p) => {
      if (!this.pruebasConHechos.has(`${p.source}\u0000${p.season}\u0000${p.competition_key}`)) return true;
      contar(this.tablas, T, comp.source, 'conFicheroPropio');
      return false;
    });
    for (const p of sinHechos) {
      contar(this.tablas, T, comp.source, 'encontradas');
      this.competicionesUsadas.add(p.id);
      const asaltos = this.q(
        `SELECT id, phase, round_key, fencer_a_ref, fencer_b_ref FROM sport_bout WHERE competition_id=? AND source=?`,
      ).all(p.id, comp.source) as { id: string; phase: string; round_key: string; fencer_a_ref: string; fencer_b_ref: string }[];
      for (const b of asaltos) {
        const choca = this.q(
          `SELECT 1 FROM sport_bout WHERE competition_id=? AND source=? AND phase=? AND round_key=? AND fencer_a_ref=?
             AND fencer_b_ref=?`,
        ).get(comp.id, comp.source, b.phase, b.round_key, b.fencer_a_ref, b.fencer_b_ref);
        if (choca) {
          this.q('DELETE FROM sport_bout WHERE id=?').run(b.id);
          contar(this.tablas, T, comp.source, 'asaltosMismaClaveBorrados');
        } else {
          this.q('UPDATE sport_bout SET competition_id=? WHERE id=?').run(comp.id, b.id);
          contar(this.tablas, T, comp.source, 'asaltosMovidos');
        }
        this.escrito();
      }
    }
    return sinHechos;
  }

  /**
   * Tras escribir la prueba unida: un puesto de una parte cuyo nombre ya está en la
   * prueba unida es el mismo puesto (su vínculo pasa si allí falta); la parte que
   * queda sin puestos ni asaltos se borra junto con su cobertura.
   */
  private cerrarDivisiones(comp: Competicion, partes: Competicion[]): void {
    const T = 'divisiones';
    const unidos = new Map<string, { id: string; person_id: string | null }>();
    for (const r of this.q(`SELECT id, source_name, person_id FROM sport_result WHERE competition_id=? AND source=?`)
      .all(comp.id, comp.source) as { id: string; source_name: string; person_id: string | null }[]) {
      unidos.set(normalizarNombre(r.source_name), r);
    }
    for (const p of partes) {
      for (const r of this.q(`SELECT id, source_name, person_id FROM sport_result WHERE competition_id=? AND source=?`)
        .all(p.id, comp.source) as { id: string; source_name: string; person_id: string | null }[]) {
        const destino = unidos.get(normalizarNombre(r.source_name));
        if (!destino) continue;
        if (r.person_id && !destino.person_id) {
          this.q('UPDATE sport_result SET person_id=? WHERE id=? AND person_id IS NULL').run(r.person_id, destino.id);
          destino.person_id = r.person_id;
        }
        this.q('DELETE FROM sport_result WHERE id=?').run(r.id);
        contar(this.tablas, T, comp.source, 'resultadosDuplicadosBorrados');
        this.escrito();
      }
      const quedan = this.q(
        `SELECT (SELECT count(*) FROM sport_result WHERE competition_id=?) + (SELECT count(*) FROM sport_bout WHERE competition_id=?) n`,
      ).get(p.id, p.id) as { n: number };
      if (Number(quedan.n) > 0) {
        contar(this.tablas, T, comp.source, 'conservadasConHechos');
        continue;
      }
      const cob = this.q(
        `DELETE FROM sport_import_coverage WHERE competition_id=? OR (source=? AND season=? AND competition_key=?)`,
      ).run(p.id, p.source, p.season, p.competition_key);
      contar(this.tablas, T, comp.source, 'coberturasBorradas', Number(cob.changes));
      this.q('DELETE FROM sport_competition WHERE id=?').run(p.id);
      contar(this.tablas, T, comp.source, 'competicionesBorradas');
      this.escrito();
    }
  }

  private upsertEdicion(h: HechosPrueba): string {
    const e = h.edition;
    const previa = this.q(
      `SELECT id, start_date, end_date, city, country_code, source_url FROM sport_edition
        WHERE source=? AND season=? AND tournament_key=?`,
    ).get(h.source, e.season, e.tournamentKey) as
      | { id: string; start_date: string | null; end_date: string | null; city: string | null;
          country_code: string | null; source_url: string | null }
      | undefined;
    if (!previa) {
      const id = uuid();
      this.q(
        `INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date, end_date, city,
           country_code, source_url, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, h.source, e.season, e.tournamentKey, e.name, e.startDate, e.endDate, e.city, e.countryCode,
        h.sourceUrl, ahora());
      contar(this.tablas, 'sport_edition', h.source, 'insertadas');
      this.escrito();
      return id;
    }
    // Sólo se rellenan huecos: el nombre y la sede publicados en producción mandan.
    const nuevo = {
      start_date: previa.start_date ?? e.startDate,
      end_date: previa.end_date ?? e.endDate,
      city: previa.city ?? e.city,
      country_code: previa.country_code ?? e.countryCode,
      source_url: previa.source_url ?? h.sourceUrl,
    };
    const cambia = (Object.keys(nuevo) as (keyof typeof nuevo)[]).some((k) => nuevo[k] !== previa[k]);
    if (cambia) {
      this.q(
        `UPDATE sport_edition SET start_date=?, end_date=?, city=?, country_code=?, source_url=?, updated_at=?
          WHERE id=?`,
      ).run(nuevo.start_date, nuevo.end_date, nuevo.city, nuevo.country_code, nuevo.source_url, ahora(), previa.id);
      contar(this.tablas, 'sport_edition', h.source, 'actualizadas');
      this.escrito();
    } else contar(this.tablas, 'sport_edition', h.source, 'sinCambios');
    return previa.id;
  }

  private upsertCompeticion(h: HechosPrueba, edicionId: string): Competicion {
    const c = h.competition;
    type Previa = Competicion & {
      weapon: string; gender: string; category: string; format: string;
      category_raw: string | null; competition_date: string | null; source_url: string | null;
    };
    const columnas = `id, edition_id, competition_key, source, season, weapon, gender, category, format,
      category_raw, competition_date, source_url`;
    let previa = this.q(`SELECT ${columnas} FROM sport_competition WHERE source=? AND season=? AND competition_key=?`)
      .get(h.source, h.edition.season, c.competitionKey) as Previa | undefined;
    // FIE, Engarde y EFC tienen un único extractor con claves fijas; en Engarde, además, la depuración de
    // solapes borra pruebas y la búsqueda por atributos pegaría su recarga a otra prueba de la edición.
    if (!previa && !CLAVES_FIJAS.has(h.source)) {
      // Otro extractor puede haber construido la clave de otra forma para la misma prueba.
      const candidatas = (this.q(
        `SELECT ${columnas} FROM sport_competition
          WHERE edition_id=? AND source=? AND weapon=? AND gender=? AND category=? AND format=?`,
      ).all(edicionId, h.source, c.weapon, c.gender, c.category, c.format) as Previa[]).filter(
        (p) =>
          !this.competicionesUsadas.has(p.id) &&
          (p.category_raw === null || c.categoryRaw === null || p.category_raw === c.categoryRaw),
      );
      if (candidatas.length === 1) {
        previa = candidatas[0];
        this.aviso('competicion_por_atributos');
      } else if (candidatas.length > 1) this.aviso('competicion_ambigua_insertada');
    }
    if (!previa) {
      const id = uuid();
      this.q(
        `INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category,
           category_raw, format, competition_date, source_url, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, edicionId, h.source, h.edition.season, c.competitionKey, c.weapon, c.gender, c.category,
        c.categoryRaw, c.format, c.date, h.sourceUrl, ahora());
      contar(this.tablas, 'sport_competition', h.source, 'insertadas');
      this.escrito();
      this.competicionesUsadas.add(id);
      return { id, edition_id: edicionId, competition_key: c.competitionKey, source: h.source, season: h.edition.season };
    }
    this.competicionesUsadas.add(previa.id);
    if (previa.weapon !== c.weapon || previa.gender !== c.gender || previa.category !== c.category ||
      previa.format !== c.format) this.aviso('competicion_atributos_distintos_conservados');
    const nuevo = {
      category_raw: previa.category_raw ?? c.categoryRaw,
      competition_date: previa.competition_date ?? c.date,
      source_url: previa.source_url ?? h.sourceUrl,
    };
    if (nuevo.category_raw !== previa.category_raw || nuevo.competition_date !== previa.competition_date ||
      nuevo.source_url !== previa.source_url) {
      this.q(`UPDATE sport_competition SET category_raw=?, competition_date=?, source_url=?, updated_at=? WHERE id=?`)
        .run(nuevo.category_raw, nuevo.competition_date, nuevo.source_url, ahora(), previa.id);
      contar(this.tablas, 'sport_competition', h.source, 'actualizadas');
      this.escrito();
    } else contar(this.tablas, 'sport_competition', h.source, 'sinCambios');
    return previa;
  }

  private decidirModo(estado: Estado, existentes: number, nuevas: number, estables: boolean): Modo {
    if (nuevas === 0) return 'vacio';
    if (existentes === 0) return 'nuevo';
    if (estado === 'completo' && nuevas >= existentes) return 'reemplazo';
    return estables ? 'fusion' : 'conservado';
  }

  private aplicarResultados(comp: Competicion, h: HechosPrueba): { modo: Modo } {
    const T = 'sport_result';
    const previas = this.q(
      `SELECT id, source_fact_key, person_id, source_name, source_country_code, source_club, position, position_raw,
         official_points, occurred_on, source_url, content_hash FROM sport_result WHERE competition_id=? AND source=?`,
    ).all(comp.id, h.source) as FilaResultado[];
    const porClave = new Map(previas.map((p) => [p.source_fact_key, p]));
    const nuevas = new Map<string, ResultadoHecho>();
    for (const r of h.results) {
      if (nuevas.has(r.factKey)) this.aviso('resultado_clave_duplicada');
      else nuevas.set(r.factKey, r);
    }
    const modo = this.decidirModo(h.status.results, previas.length, nuevas.size,
      clavesEstables(nuevas.keys()) && clavesEstables(porClave.keys()));
    if (modo === 'vacio' || modo === 'conservado') {
      contar(this.tablas, T, h.source, 'conservadas', previas.length);
      if (modo === 'conservado') contar(this.tablas, T, h.source, 'descartadas', nuevas.size);
      return { modo };
    }

    // Al sustituir, un vínculo de persona no se pierde: pasa a la fila nueva con el mismo nombre.
    const heredables = new Map<string, string | null>();
    if (modo === 'reemplazo') {
      for (const p of previas) {
        if (nuevas.has(p.source_fact_key) || !p.person_id) continue;
        const n = normalizarNombre(p.source_name);
        heredables.set(n, heredables.has(n) && heredables.get(n) !== p.person_id ? null : p.person_id);
      }
    }
    const fecha = h.competition.date ?? h.edition.startDate;
    const t = ahora();
    for (const r of nuevas.values()) {
      const previa = porClave.get(r.factKey);
      const hash = sha256(jsonCanonico({ source: h.source, competitionKey: comp.competition_key, fact: r }));
      const v = {
        source_name: r.name,
        source_country_code: r.countryCode ?? previa?.source_country_code ?? null,
        source_club: r.club ?? previa?.source_club ?? null,
        position: r.position,
        position_raw: r.positionRaw ?? previa?.position_raw ?? null,
        official_points: mismosPuntos(previa?.official_points ?? null, r.points)
          ? previa!.official_points
          : r.points ?? previa?.official_points ?? null,
        occurred_on: fecha ?? previa?.occurred_on ?? null,
        source_url: previa?.source_url ?? h.sourceUrl,
      };
      if (!previa) {
        const persona = heredables.get(normalizarNombre(r.name)) ?? null;
        this.q(
          `INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name,
             source_country_code, source_club, position, position_raw, official_points, occurred_on, source_url,
             content_hash, revision, first_seen_at, revised_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        ).run(uuid(), comp.id, h.source, r.factKey, persona, v.source_name, v.source_country_code, v.source_club,
          v.position, v.position_raw, v.official_points, v.occurred_on, v.source_url, hash, t, t);
        contar(this.tablas, T, h.source, 'insertadas');
        if (persona) contar(this.tablas, T, h.source, 'personaHeredada');
        this.escrito();
        continue;
      }
      const igual = previa.content_hash === hash ||
        (Object.keys(v) as (keyof typeof v)[]).every((k) => v[k] === previa[k]);
      if (igual) {
        contar(this.tablas, T, h.source, 'sinCambios');
        continue;
      }
      this.q(
        `UPDATE sport_result SET source_name=?, source_country_code=?, source_club=?, position=?, position_raw=?,
           official_points=?, occurred_on=?, source_url=?, content_hash=?, revision=revision+1, revised_at=?
         WHERE id=?`,
      ).run(v.source_name, v.source_country_code, v.source_club, v.position, v.position_raw, v.official_points,
        v.occurred_on, v.source_url, hash, t, previa.id);
      contar(this.tablas, T, h.source, 'actualizadas');
      this.escrito();
    }
    if (modo === 'reemplazo') {
      const borrar = this.q('DELETE FROM sport_result WHERE id=?');
      for (const p of previas) {
        if (nuevas.has(p.source_fact_key)) continue;
        borrar.run(p.id);
        contar(this.tablas, T, h.source, 'borradas');
        this.escrito();
      }
    }
    return { modo };
  }

  private aplicarAsaltos(comp: Competicion, h: HechosPrueba, fase: 'POULE' | 'TABLEAU'): { modo: Modo } {
    const T = 'sport_bout';
    const seccion: Seccion = fase === 'POULE' ? 'pools' : 'tableau';
    const individual = h.competition.format === 'INDIVIDUAL';
    const previas = this.q(
      `SELECT id, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id, fencer_b_person_id, fencer_a_name,
         fencer_b_name, score_a, score_b, occurred_on, source_url, content_hash
       FROM sport_bout WHERE competition_id=? AND source=? AND phase=?`,
    ).all(comp.id, h.source, fase) as FilaAsalto[];
    const clave = (ronda: string, a: string, b: string) => `${ronda}\u0000${a}\u0000${b}`;
    const porClave = new Map(previas.map((p) => [clave(p.round_key, p.fencer_a_ref, p.fencer_b_ref), p]));
    const nuevas = new Map<string, AsaltoHecho>();
    for (const original of h.bouts) {
      if (original.phase !== fase) continue;
      if (original.aRef === original.bRef) {
        this.aviso('asalto_mismo_tirador');
        continue;
      }
      const b =
        original.aRef < original.bRef
          ? original
          : {
              ...original,
              aRef: original.bRef, bRef: original.aRef,
              aName: original.bName, bName: original.aName,
              scoreA: original.scoreB, scoreB: original.scoreA,
              winner: original.winner === null ? null : original.winner === 'A' ? ('B' as const) : ('A' as const),
            };
      const k = clave(b.roundKey, b.aRef, b.bRef);
      if (nuevas.has(k)) this.aviso('asalto_clave_duplicada');
      else nuevas.set(k, b);
    }
    if (h.source === 'rfee_pdf' && fase === 'TABLEAU') {
      const sobran = repetidosEntreRondas([...nuevas.values()]);
      for (const b of sobran) nuevas.delete(clave(b.roundKey, b.aRef, b.bRef));
      if (sobran.length > 0) contar(this.tablas, T, h.source, 'repetidasEntreRondas', sobran.length);
      // Una pareja que se cruza dos veces o un perdedor que sigue: algún asalto está mal leído y no
      // se sabe cuál. En equipos se tiran los puestos y el perdedor sigue legítimamente.
      const lista = individual ? [...nuevas.entries()] : [];
      const coherencia = consistenciaCuadro(lista.map(([, b]) => b));
      for (const i of coherencia.incoherentes) nuevas.delete(lista[i][0]);
      if (coherencia.incoherentes.size > 0) contar(this.tablas, T, h.source, 'incoherentesDescartadas', coherencia.incoherentes.size);
    }
    const estables =
      clavesEstables([...nuevas.values()].flatMap((b) => [b.aRef, b.bRef])) &&
      clavesEstables(previas.flatMap((p) => [p.fencer_a_ref, p.fencer_b_ref]));
    // En rfee_pdf las referencias antiguas (`<doc>:<clave>:p0023`) nunca casan con las
    // nuevas (factKey del puesto). El cuadro sale de una sola lectura: la nueva sustituye
    // la fase entera salvo que lo guardado sea una sola lectura con más asaltos coherentes.
    // En poules, con tantas o más filas nuevas se sustituye; con menos, se quitan los repetidos.
    const peso = (l: AsaltoCuadro[]): [number, number] => (individual ? pesoCuadro(l) : [l.length, 0]);
    const pesoPrevias = () => peso(previas.map((p) => ({
      roundKey: p.round_key, aRef: p.fencer_a_ref, bRef: p.fencer_b_ref, scoreA: p.score_a, scoreB: p.score_b,
    })));
    const pesoNuevas = () => peso([...nuevas.values()]);
    const mejorGuardado = () => {
      const [a, b] = [pesoPrevias(), pesoNuevas()];
      return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
    };
    const modo: Modo = h.source === 'rfee_pdf'
      ? nuevas.size === 0 ? 'vacio'
        : previas.length === 0 ? 'nuevo'
        : fase === 'TABLEAU' ? (lecturaUnica(previas) && mejorGuardado() ? 'conservado' : 'reemplazo')
        : nuevas.size >= previas.length ? 'reemplazo' : 'deduplicado'
      : this.decidirModo(h.status[seccion], previas.length, nuevas.size, estables);
    if (modo === 'vacio' || modo === 'conservado') {
      // Lo guardado puede venir de una carga anterior a la comprobación de coherencia.
      let borradas = 0;
      if (h.source === 'rfee_pdf' && fase === 'TABLEAU' && individual) {
        const incoherentes = consistenciaCuadro(previas.map((p) => ({
          roundKey: p.round_key, aRef: p.fencer_a_ref, bRef: p.fencer_b_ref, scoreA: p.score_a, scoreB: p.score_b,
        }))).incoherentes;
        const borrar = this.q('DELETE FROM sport_bout WHERE id=?');
        for (const i of incoherentes) {
          borrar.run(previas[i].id);
          borradas += 1;
          this.escrito();
        }
        if (borradas > 0) contar(this.tablas, T, h.source, 'incoherentesGuardadasBorradas', borradas);
      }
      contar(this.tablas, T, h.source, 'conservadas', previas.length - borradas);
      if (modo === 'conservado') contar(this.tablas, T, h.source, 'descartadas', nuevas.size);
      return { modo };
    }

    // Personas de la prueba: por referencia (factKey del puesto) y, si no, por nombre único.
    const porRef = new Map<string, string>();
    const porNombre = new Map<string, string | null>();
    const anotarNombre = (nombre: string, persona: string) => {
      const n = normalizarNombre(nombre);
      porNombre.set(n, porNombre.has(n) && porNombre.get(n) !== persona ? null : persona);
    };
    for (const r of this.q(
      `SELECT source_fact_key, source_name, person_id FROM sport_result
        WHERE competition_id=? AND source=? AND person_id IS NOT NULL`,
    ).all(comp.id, h.source) as { source_fact_key: string; source_name: string; person_id: string }[]) {
      porRef.set(r.source_fact_key, r.person_id);
      anotarNombre(r.source_name, r.person_id);
    }
    if (modo === 'reemplazo' || modo === 'deduplicado') {
      for (const p of previas) {
        if (nuevas.has(clave(p.round_key, p.fencer_a_ref, p.fencer_b_ref))) continue;
        if (p.fencer_a_person_id) anotarNombre(p.fencer_a_name, p.fencer_a_person_id);
        if (p.fencer_b_person_id) anotarNombre(p.fencer_b_name, p.fencer_b_person_id);
      }
    }
    const persona = (ref: string, nombre: string) =>
      porRef.get(ref) ?? porNombre.get(normalizarNombre(nombre)) ?? null;

    const fecha = h.competition.date ?? h.edition.startDate;
    const t = ahora();
    for (const [k, b] of nuevas) {
      const previa = porClave.get(k);
      const hash = sha256(jsonCanonico({ source: h.source, competitionKey: comp.competition_key, fact: b }));
      const v = {
        fencer_a_name: b.aName,
        fencer_b_name: b.bName,
        score_a: b.scoreA,
        score_b: b.scoreB,
        occurred_on: fecha ?? previa?.occurred_on ?? null,
        source_url: previa?.source_url ?? h.sourceUrl,
      };
      if (!previa) {
        const pa = persona(b.aRef, b.aName);
        let pb = persona(b.bRef, b.bName);
        if (pa !== null && pa === pb) pb = null;
        this.q(
          `INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref,
             fencer_a_person_id, fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, occurred_on,
             source_url, content_hash, revision, first_seen_at, revised_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        ).run(uuid(), comp.id, h.source, fase, b.roundKey, b.aRef, b.bRef, pa, pb, v.fencer_a_name, v.fencer_b_name,
          v.score_a, v.score_b, v.occurred_on, v.source_url, hash, t, t);
        contar(this.tablas, T, h.source, 'insertadas');
        this.escrito();
        continue;
      }
      const igual = previa.content_hash === hash ||
        (Object.keys(v) as (keyof typeof v)[]).every((c) => v[c] === previa[c]);
      if (igual) {
        contar(this.tablas, T, h.source, 'sinCambios');
        continue;
      }
      this.q(
        `UPDATE sport_bout SET fencer_a_name=?, fencer_b_name=?, score_a=?, score_b=?, occurred_on=?, source_url=?,
           content_hash=?, revision=revision+1, revised_at=? WHERE id=?`,
      ).run(v.fencer_a_name, v.fencer_b_name, v.score_a, v.score_b, v.occurred_on, v.source_url, hash, t, previa.id);
      contar(this.tablas, T, h.source, 'actualizadas');
      this.escrito();
    }
    if (modo === 'fusion' && fase === 'TABLEAU') {
      // La API FIE llegó a publicar el mismo cuadro dos veces (A64..A2 y F64..F1, o rondas «1»..«4»);
      // el lector ya lo cuenta una vez, y la copia guardada con la otra ronda sobra.
      const firma = (ronda: string, a: string, b: string, sa: number, sb: number) => ({ ronda, k: `${a}|${b}|${sa}|${sb}` });
      const nuevasPorFirma = new Map<string, Set<string>>();
      for (const b of nuevas.values()) {
        const f = firma(b.roundKey, b.aRef, b.bRef, b.scoreA, b.scoreB);
        nuevasPorFirma.set(f.k, (nuevasPorFirma.get(f.k) ?? new Set()).add(f.ronda));
      }
      const borrar = this.q('DELETE FROM sport_bout WHERE id=?');
      for (const [k, p] of porClave) {
        if (nuevas.has(k)) continue;
        const f = firma(p.round_key, p.fencer_a_ref, p.fencer_b_ref, p.score_a, p.score_b);
        const rondas = nuevasPorFirma.get(f.k);
        if (!rondas || rondas.has(f.ronda)) continue;
        borrar.run(p.id);
        contar(this.tablas, T, h.source, 'repetidasOtraRondaBorradas');
        this.escrito();
      }
    }
    if (modo === 'reemplazo') {
      const borrar = this.q('DELETE FROM sport_bout WHERE id=?');
      for (const [k, p] of porClave) {
        if (nuevas.has(k)) continue;
        borrar.run(p.id);
        contar(this.tablas, T, h.source, 'borradas');
        this.escrito();
      }
    }
    if (modo === 'deduplicado') {
      const nuevasFirmas = new Set([...nuevas.values()].map((b) =>
        `${ambitoFirma(fase, b.roundKey)}|${firmaAsalto(b.aName, b.scoreA, b.bName, b.scoreB)}`));
      const nuevasPorAmbito = new Map<string, AsaltoHecho[]>();
      for (const b of nuevas.values()) {
        const a = ambitoFirma(fase, b.roundKey);
        nuevasPorAmbito.set(a, [...(nuevasPorAmbito.get(a) ?? []), b]);
      }
      const borrar = this.q('DELETE FROM sport_bout WHERE id=?');
      for (const [k, p] of porClave) {
        if (nuevas.has(k)) continue;
        const ambito = ambitoFirma(fase, p.round_key);
        const exacta = nuevasFirmas.has(`${ambito}|${firmaAsalto(p.fencer_a_name, p.score_a, p.fencer_b_name, p.score_b)}`);
        const otraLectura = !exacta && (nuevasPorAmbito.get(ambito) ?? []).some((b) => mismoAsaltoOtraLectura(p, b));
        if (!exacta && !otraLectura) {
          contar(this.tablas, T, h.source, 'conservadas');
          continue;
        }
        borrar.run(p.id);
        contar(this.tablas, T, h.source, exacta ? 'duplicadasBorradas' : 'otraLecturaBorradas');
        this.escrito();
      }
    }
    return { modo };
  }

  private contarFilas(comp: Competicion, s: Seccion): number {
    if (s === 'results') {
      return Number((this.q('SELECT count(*) n FROM sport_result WHERE competition_id=? AND source=?')
        .get(comp.id, comp.source) as { n: number }).n);
    }
    return Number((this.q('SELECT count(*) n FROM sport_bout WHERE competition_id=? AND source=? AND phase=?')
      .get(comp.id, comp.source, s === 'pools' ? 'POULE' : 'TABLEAU') as { n: number }).n);
  }

  private escribirCobertura(
    source: string, season: string, kind: string, clave: string, competitionId: string | null,
    estado: (previo: string | null) => string, publicado: number | null, importadas: number, url: string,
  ): void {
    const T = 'sport_import_coverage';
    const previa = this.q(
      `SELECT id, status, published_total, imported_total, competition_id FROM sport_import_coverage
        WHERE source=? AND season=? AND fact_kind=? AND competition_key=?`,
    ).get(source, season, kind, clave) as
      | { id: string; status: string; published_total: number | null; imported_total: number; competition_id: string | null }
      | undefined;
    const t = ahora();
    if (!previa) {
      this.q(
        `INSERT INTO sport_import_coverage (id, source, season, fact_kind, competition_key, competition_id, status,
           published_total, imported_total, attempts, source_url, last_checked_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      ).run(uuid(), source, season, kind, clave, competitionId, estado(null), publicado, importadas, url, t, t);
      contar(this.tablas, T, `${source}:${kind}`, 'insertadas');
      this.escrito();
      return;
    }
    const status = estado(previa.status);
    const pub = publicado ?? previa.published_total;
    const cid = competitionId ?? previa.competition_id;
    if (status === previa.status && pub === previa.published_total && importadas === previa.imported_total &&
      cid === previa.competition_id) {
      contar(this.tablas, T, `${source}:${kind}`, 'sinCambios');
      return;
    }
    this.q(
      `UPDATE sport_import_coverage SET status=?, published_total=?, imported_total=?, competition_id=?,
         attempts=max(attempts,1), last_checked_at=?, updated_at=?,
         last_error=CASE WHEN ?='completo' THEN NULL ELSE last_error END WHERE id=?`,
    ).run(status, pub, importadas, cid, t, t, status, previa.id);
    contar(this.tablas, T, `${source}:${kind}`, 'actualizadas');
    this.escrito();
  }

  private cobertura(comp: Competicion, h: HechosPrueba, s: Seccion, modo: Modo): void {
    const kind = s === 'results' ? (h.source === 'fie' ? 'ranking' : 'results') : s;
    const nuevo = estadoCobertura(h.status[s]);
    const estado = (previo: string | null): string => {
      if (modo === 'nuevo' || modo === 'reemplazo') return nuevo;
      if (modo === 'fusion' || modo === 'deduplicado') return mejorEstado(previo, nuevo);
      if (previo !== null) return previo;
      return modo === 'vacio' && h.status[s] === 'sin_resultados' ? 'sin_resultados' : 'parcial';
    };
    const publicado = s === 'results' ? h.status.publishedParticipants : null;
    this.escribirCobertura(h.source, comp.season, kind, comp.competition_key, comp.id, estado, publicado,
      this.contarFilas(comp, s), h.sourceUrl);
  }

  /**
   * Cobertura `pdf` por documento (clave `doc:<nombre del fichero>`), como la escribe el backfill de PDF.
   * El estado sale de la cobertura `results` de TODAS las pruebas rfee_pdf de la edición tal como
   * quedan en la base (las de esta carga ya escritas y las de cargas anteriores), no sólo de las
   * que trae esta carga: un lote con una sola prueba de un documento ya completo no lo deja en
   * `parcial`. Nunca baja de estado (`mejorEstado` con el que ya tenía).
   */
  coberturaDocumentos(): void {
    for (const [edicionId, d] of this.documentos) {
      const fichero = /\/([^/?#]+?)(\.pdf)?(?:[?#].*)?$/i.exec(d.url)?.[1];
      if (!fichero) continue;
      const comps = this.q(`SELECT id, source, season, competition_key FROM sport_competition WHERE edition_id=?`).all(edicionId) as {
        id: string; source: string; season: string; competition_key: string;
      }[];
      const estados = estadosDocumento(comps.filter((c) => c.source === 'rfee_pdf').map((c) => {
        const fila = this.q(
          `SELECT status FROM sport_import_coverage WHERE source='rfee_pdf' AND fact_kind='results' AND season=? AND competition_key=?`,
        ).get(c.season, c.competition_key) as { status: string } | undefined;
        return fila?.status ?? null;
      }));
      let importadas = 0;
      for (const c of comps) {
        const comp = { id: c.id, source: c.source } as Competicion;
        importadas += this.contarFilas(comp, 'results') + this.contarFilas(comp, 'pools') + this.contarFilas(comp, 'tableau');
      }
      this.escribirCobertura('rfee_pdf', d.season, 'pdf', `doc:${fichero}`, null, (previo) => mejorEstado(previo, estados), null,
        importadas, d.url);
    }
  }
}

/** Lee la cabecera de cada fichero, agrupa por prueba y aplica cada grupo. */
export function cargarHechos(
  db: DatabaseSync, entradas: readonly EntradaHechos[],
  /** `diccionarioGenero`: nombres de pila → género, para contrastar el sexo de Engarde con su clave (sin él no se contrasta). */
  opciones: { diccionarioGenero?: ReadonlyMap<string, 'M' | 'F'> | null } = {},
): InformeCarga {
  const inicio = Date.now();
  const informe: InformeCarga = {
    ficheros: { leidos: 0, validos: 0, rechazados: 0, porCarpeta: {} },
    rechazados: [],
    pruebas: 0,
    tablas: {},
    secciones: {},
    avisos: {},
    asaltosPdfDuplicados: { antes: contarAsaltosPdfDuplicados(db), despues: 0 },
    generoClave: [],
    segundos: 0,
  };
  const grupos = new Map<string, Meta[]>();
  for (const entrada of entradas) {
    informe.ficheros.leidos += 1;
    let h: HechosPrueba;
    try {
      const r = hechosPrueba.safeParse(entrada.leer());
      if (!r.success) throw new Error(r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      h = r.data;
    } catch (e) {
      informe.ficheros.rechazados += 1;
      if (informe.rechazados.length < 200) informe.rechazados.push({ ruta: entrada.ruta, error: String((e as Error).message ?? e).slice(0, 300) });
      continue;
    }
    informe.ficheros.validos += 1;
    informe.ficheros.porCarpeta[entrada.carpeta] = (informe.ficheros.porCarpeta[entrada.carpeta] ?? 0) + 1;
    const meta: Meta = {
      entrada,
      source: h.source,
      season: h.edition.season,
      competitionKey: h.competition.competitionKey,
      extractor: h.extractor,
      status: h.status,
      filas: { results: filasSeccion(h, 'results'), pools: filasSeccion(h, 'pools'), tableau: filasSeccion(h, 'tableau') },
    };
    const k = `${h.source}\u0000${h.edition.season}\u0000${h.competition.competitionKey}`;
    const g = grupos.get(k);
    if (g) g.push(meta);
    else grupos.set(k, [meta]);
  }
  informe.pruebas = grupos.size;

  const cargador = new Cargador(db, undefined, new Set(grupos.keys()), opciones.diccionarioGenero ?? null);
  cargador.empezar();
  try {
    for (const metas of grupos.values()) cargador.aplicarGrupo(metas);
    cargador.coberturaDocumentos();
    cargador.terminar();
  } catch (e) {
    cargador.abortar();
    throw e;
  }
  informe.tablas = cargador.tablas;
  informe.secciones = cargador.secciones;
  informe.avisos = cargador.avisos;
  informe.generoClave = cargador.generosClave;
  informe.asaltosPdfDuplicados.despues = contarAsaltosPdfDuplicados(db);
  informe.segundos = Math.round((Date.now() - inicio) / 100) / 10;
  return informe;
}

export function entradasDeCarpetas(raiz: string, carpetas: readonly string[]): EntradaHechos[] {
  const salida: EntradaHechos[] = [];
  for (const carpeta of carpetas) {
    const dir = join(raiz, carpeta);
    if (!existsSync(dir)) continue;
    const recorrer = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const ruta = join(d, e.name);
        if (e.isDirectory()) recorrer(ruta);
        // `_informe.json` y similares son resúmenes de los extractores, no hechos.
        else if (e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('_')) {
          salida.push({ ruta, carpeta, leer: () => JSON.parse(readFileSync(ruta, 'utf8')) });
        }
      }
    };
    recorrer(dir);
  }
  return salida.sort((a, b) => (a.ruta < b.ruta ? -1 : 1));
}

function main(): void {
  const rutaDb = argumento('nuevo', argumento('db', NUEVO_POR_DEFECTO));
  const base = argumento('base', BASE_POR_DEFECTO);
  const raiz = argumento('hechos', join(CARPETA_TRABAJO, 'hechos'));
  const carpetas = argumento('carpetas', 'fie,fie-antiguo,pdf-lector,pdf-droid').split(',').map((s) => s.trim()).filter(Boolean);
  const salida = argumento('informe', join(CARPETA_TRABAJO, 'carga-informe.json'));
  if (!existsSync(rutaDb)) {
    if (!existsSync(base)) throw new Error(`No existe ${rutaDb} ni la base ${base}`);
    copyFileSync(base, rutaDb);
    console.log(`Copiada ${base} -> ${rutaDb}`);
  }
  const entradas = entradasDeCarpetas(raiz, carpetas);
  console.log(`${entradas.length} ficheros de hechos en ${raiz} (${carpetas.join(', ')})`);
  const db = new DatabaseSync(rutaDb);
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  let informe: InformeCarga;
  try {
    const diccionarioGenero = bandera('sin-genero-clave') ? null : diccionarioGeneroDeBase(db);
    informe = cargarHechos(db, entradas, { diccionarioGenero });
  } finally {
    restaurarGuardia(db);
    db.close();
  }
  writeFileSync(salida, JSON.stringify(informe, null, 2));
  console.log(JSON.stringify({ ...informe, rechazados: informe.rechazados.slice(0, 10) }, null, 2));
  console.log(`Informe: ${salida}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
