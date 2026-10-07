/**
 * Propuestas de unión (`sport_link_candidate` PROPUESTO, «nombre_varias_candidatas») que la
 * unificación dejó sin aplicar porque el nombre llevaba a varias personas. Se decide cada
 * hecho pendiente (puesto o lado de asalto sin persona) con lo que cuentan las candidatas:
 *
 *  - `identidad`: la misma licencia de Engarde («lic:N-000440») en el puesto y en otro de la candidata.
 *  - `continuidad`: en la misma prueba, el puesto y los asaltos enlazan el nombre con la candidata.
 *  - `club_y_anio`: el mismo club (±1 temporada) y un año de nacimiento conocido que cabe en la
 *    categoría; las demás candidatas, descartadas o con otro club conocido en esas temporadas.
 *  - `nombre_unico`: el mismo nombre, palabra por palabra, y todas las demás candidatas descartadas
 *    por una contradicción dura (género, edad, ya en la prueba).
 *  - `duplicada_club_anio`: dos candidatas con el mismo nombre, género y año de nacimiento, el
 *    mismo club y nunca en la misma prueba (fichas duplicadas de Skermo): se funden.
 *  - `nombre_y_anio` (FIE ↔ RFEE): la única pareja compatible, con el mismo año de nacimiento.
 *
 * Las reglas de nombre son las de `nombres-union.ts`: apellidos cruzados sólo con club y año o
 * continuidad; hermanos y primos, nunca. Lo demás sólo se lista (dudosas, descartadas, obsoletas).
 *
 * Ensayo (por defecto, base en sólo lectura) o `--aplicar` sobre una COPIA de trabajo:
 *   npx tsx scripts/indexado/lote11-uniones-evidencia.ts --db <copia.sqlite> [--aplicar] [--informe <json>]
 */
import { existsSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  ahora, argumento, bandera, normalizarNombre, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia, uuid,
} from './comun';
import { anioTemporada, mismoClub, nacimientoPorCategoria, normalizarClub } from './dedupe-evidencia';
import { firmaApellidos, formatoDeFuente, mejorRelacion, motivoNoUnir, type Relacion } from './nombres-union';

const BASES_PROTEGIDAS = new Set(['base.sqlite', 'remoto.sqlite', 'nuevo11.sqlite']);
const FUENTES_NOMBRE = ['rfee_pdf', 'engarde', 'efc'] as const;
const FUENTES_SQL = FUENTES_NOMBRE.map((f) => `'${f}'`).join(', ');
const FUENTE_FUSION = 'fusion_lote11_evidencia';
const LIBRES: ReadonlySet<Relacion> = new Set(['mismo', 'recortado', 'compuesto_simple']);

export type TipoDecisiva = 'identidad' | 'continuidad' | 'club_y_anio' | 'nombre_unico' | 'duplicada_club_anio' | 'nombre_y_anio';

type Persona = { id: string; m: string | null; nombre: string; genero: string | null; anio: number | null; atleta: boolean };
type Puesto = { comp: string; anio: number | null; club: string | null; clave: string; fuente: string; nombre: string; ronda?: string };
type Fila = {
  tipo: 'puesto' | 'asalto'; id: string; lado?: 'a' | 'b'; otro?: string | null; comp: string; fuente: string; nombre: string;
  club: string | null; clave: string; temporada: string; categoria: string; genero: string; prueba: string; url: string | null;
};

export type Lado = { id: string; nombre: string; detalle?: string };
export type Decisiva = {
  tipo: TipoDecisiva; accion: 'vincular_puesto' | 'vincular_asalto' | 'fundir';
  origen: Lado; destino: Lado; prueba?: string; evidencia: string; fila?: { id: string; lado?: 'a' | 'b' };
};
export type Listada = { motivo: string; origen: Lado; candidatas: Lado[]; prueba?: string; evidencia?: string };

export type InformeLote11 = {
  propuestas: number;
  grupos: { nombre: number; fie: number };
  /** Cada fila PROPUESTO por la mejor evidencia que tiene su candidata. */
  porEvidencia: Record<string, number>;
  /** Cada fila PROPUESTO por lo que se hace con ella. */
  porDecision: Record<string, number>;
  /** Hechos pendientes (puestos y lados de asalto) de los grupos de nombre. */
  hechosPendientes: { puestos: number; asaltos: number };
  decisivas: Decisiva[];
  porTipo: Record<string, number>;
  dudosas: Listada[];
  descartadas: Listada[];
  obsoletas: { yaUnidas: number; sinPendientes: number; ejemplos: string[] };
  /**
   * Filas de `sport_link_candidate` que se cierran: la elegida, CONFIRMADO (id → tipo); las demás
   * del grupo, RECHAZADO sólo si todos los hechos pendientes del grupo quedan decididos.
   */
  candidatos: { confirmar: Record<string, string>; rechazar: string[] };
  aplicado: { fusiones: number; puestos: number; asaltos: number; candidatosConfirmados: number; candidatosRechazados: number } | null;
};

const sumar = (r: Record<string, number>, k: string, n = 1) => { r[k] = (r[k] ?? 0) + n; };
const RANGO_EVIDENCIA = ['identidad', 'continuidad', 'club_y_anio', 'nombre_y_anio', 'duplicada_club_anio', 'club_sin_anio', 'orden_cruzado', 'nombre_identico', 'ninguna'];

class Base {
  readonly personas = new Map<string, Persona>();
  /** Fusiones decididas en esta ejecución (en ensayo no se escriben). */
  readonly fusionLocal = new Map<string, string>();
  private readonly hijos = new Map<string, string[]>();
  private readonly cPuestos = new Map<string, Puesto[]>();
  private readonly cLados = new Map<string, Puesto[]>();
  private readonly cNombres = new Map<string, { nombre: string; fuente: string | null }[]>();
  private readonly cExt = new Map<string, { scheme: string; value: string }[]>();
  private readonly qPuestos; private readonly qLadosA; private readonly qLadosB; private readonly qAlias; private readonly qExt;
  private readonly qExacto; private readonly qEnPrueba;

  constructor(readonly db: DatabaseSync) {
    for (const p of db.prepare(
      `SELECT id, merged_into_person_id m, display_name n, gender g, birth_year y, athlete_id a FROM sport_person`,
    ).iterate() as Iterable<{ id: string; m: string | null; n: string; g: string | null; y: number | null; a: string | null }>) {
      this.personas.set(p.id, { id: p.id, m: p.m, nombre: p.n, genero: p.g, anio: p.y, atleta: !!p.a });
      if (p.m) (this.hijos.get(p.m) ?? this.hijos.set(p.m, []).get(p.m)!).push(p.id);
    }
    const sel = `SELECT r.competition_id comp, c.season t, r.source_club club, r.source_fact_key clave, r.source fuente, r.source_name nombre
                   FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id`;
    this.qPuestos = db.prepare(`${sel} WHERE r.person_id = ?`);
    const lados = (l: 'a' | 'b') => db.prepare(
      `SELECT b.competition_id comp, c.season t, b.fencer_${l}_name nombre, b.source fuente, b.phase || '|' || b.round_key ronda
         FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id WHERE b.fencer_${l}_person_id = ?`,
    );
    this.qLadosA = lados('a');
    this.qLadosB = lados('b');
    this.qAlias = db.prepare(`SELECT source, name_original n FROM sport_person_alias WHERE person_id = ?`);
    this.qExt = db.prepare(`SELECT scheme, value FROM sport_external_id WHERE person_id = ? AND link_status = 'CONFIRMADO'`);
    this.qExacto = db.prepare(
      `SELECT id FROM sport_person WHERE name_normalized = ? UNION SELECT person_id FROM sport_person_alias WHERE name_normalized = ?`,
    );
    this.qEnPrueba = db.prepare(`SELECT source_name n, person_id p FROM sport_result WHERE competition_id = ?`);
  }

  raiz(id: string, conLocales = true): string {
    let a = id;
    for (let i = 0; i < 20; i += 1) {
      const m = (conLocales ? this.fusionLocal.get(a) : undefined) ?? this.personas.get(a)?.m;
      if (!m) break;
      a = m;
    }
    return a;
  }

  miembros(r: string): string[] {
    const out: string[] = [];
    const pila = [r];
    while (pila.length) {
      const x = pila.pop()!;
      out.push(x);
      pila.push(...(this.hijos.get(x) ?? []));
    }
    return out;
  }

  fundir(origen: string, destino: string): void {
    this.fusionLocal.set(origen, destino);
    (this.hijos.get(destino) ?? this.hijos.set(destino, []).get(destino)!).push(origen);
    for (const c of [this.cPuestos, this.cLados, this.cNombres, this.cExt]) { c.delete(origen); c.delete(destino); }
  }

  private junto<T>(cache: Map<string, T[]>, r: string, leer: (id: string) => T[]): T[] {
    let v = cache.get(r);
    if (!v) cache.set(r, (v = this.miembros(r).flatMap(leer)));
    return v;
  }

  puestos(r: string): Puesto[] {
    return this.junto(this.cPuestos, r, (id) => (this.qPuestos.all(id) as { comp: string; t: string; club: string | null; clave: string; fuente: string; nombre: string }[])
      .map((x) => ({ comp: x.comp, anio: anioTemporada(x.t), club: normalizarClub(x.club), clave: x.clave, fuente: x.fuente, nombre: x.nombre })));
  }

  lados(r: string): Puesto[] {
    return this.junto(this.cLados, r, (id) => [...this.qLadosA.all(id), ...this.qLadosB.all(id)].map((x) => {
      const y = x as { comp: string; t: string; nombre: string; fuente: string; ronda: string };
      return { comp: y.comp, anio: anioTemporada(y.t), club: null, clave: '', fuente: y.fuente, nombre: y.nombre, ronda: `${y.comp}|${y.ronda}` };
    }));
  }

  nombres(r: string): { nombre: string; fuente: string | null }[] {
    return this.junto(this.cNombres, r, (id) => [
      { nombre: this.personas.get(id)!.nombre, fuente: null },
      ...(this.qAlias.all(id) as { source: string; n: string }[]).map((a) => ({ nombre: a.n, fuente: a.source })),
    ]);
  }

  ext(r: string): { scheme: string; value: string }[] {
    return this.junto(this.cExt, r, (id) => this.qExt.all(id) as { scheme: string; value: string }[]);
  }

  /** Género y año de la persona: los de la raíz o, si faltan, los que comparten todos sus miembros. */
  datos(r: string): { genero: string | null; anio: number | null; atleta: boolean } {
    const ms = this.miembros(r).map((id) => this.personas.get(id)!);
    const uno = <T>(xs: (T | null)[]) => { const s = new Set(xs.filter((x): x is T => x !== null)); return s.size === 1 ? [...s][0] : null; };
    const p = this.personas.get(r)!;
    return { genero: p.genero ?? uno(ms.map((x) => x.genero)), anio: p.anio ?? uno(ms.map((x) => x.anio)), atleta: ms.some((x) => x.atleta) };
  }

  exactas(norm: string): string[] {
    return (this.qExacto.all(norm, norm) as { id: string }[]).map((x) => x.id);
  }

  enPrueba(comp: string): { n: string; p: string | null }[] {
    return (this.qEnPrueba.all(comp) as { n: string; p: string | null }[]).map((x) => ({ n: x.n, p: x.p ? this.raiz(x.p) : null }));
  }

  etiqueta(r: string): Lado {
    const d = this.datos(r);
    const nombres = [...new Set(this.nombres(r).map((x) => (x.fuente ? `${x.nombre} (${x.fuente})` : x.nombre)))];
    const lic = [...new Set(this.ext(r).map((x) => `${x.scheme}:${x.value}`))];
    return {
      id: r, nombre: this.personas.get(r)!.nombre,
      detalle: [d.genero ?? '?', d.anio ?? 'año ?', `${this.puestos(r).length} puestos`, lic.join(' ') || 'sin ID', `nombres: ${nombres.join(' | ')}`].join(' · '),
    };
  }
}

function clubEnTemporadas(ps: readonly Puesto[], club: string, anio: number): boolean {
  return ps.some((p) => p.club && p.anio !== null && Math.abs(p.anio - anio) <= 1 && mismoClub(p.club, club));
}
function otroClubEnTemporadas(ps: readonly Puesto[], club: string, anio: number): boolean {
  const cerca = ps.filter((p) => p.club && p.anio !== null && Math.abs(p.anio - anio) <= 1);
  return cerca.length > 0 && !cerca.some((p) => mismoClub(p.club!, club));
}

type Evaluacion = {
  r: string; contra: string | null; relacion: Relacion | null;
  identidad: boolean; continuidad: boolean; club: boolean; clubYAnio: boolean; otroClub: boolean;
};

function evaluar(b: Base, f: Fila, r: string): Evaluacion {
  const d = b.datos(r);
  const ps = b.puestos(r);
  const anio = anioTemporada(f.temporada);
  const publicado = [{ nombre: f.nombre, fuente: f.fuente }];
  const rel = mejorRelacion(publicado, b.nombres(r));
  const e: Evaluacion = { r, contra: null, relacion: rel?.relacion ?? null, identidad: false, continuidad: false, club: false, clubYAnio: false, otroClub: false };
  if ((f.genero === 'M' || f.genero === 'F') && d.genero && d.genero !== 'MIXTO' && d.genero !== f.genero) e.contra = 'genero';
  else if (f.tipo === 'puesto' && ps.some((p) => p.comp === f.comp)) e.contra = 'ya_en_la_prueba';
  else if (f.tipo === 'asalto' && f.otro && b.raiz(f.otro) === r) e.contra = 'es_el_rival';
  else if (d.anio !== null && anio !== null) {
    const [lo, hi] = nacimientoPorCategoria(f.categoria, anio);
    if (d.anio < lo || d.anio > hi) e.contra = 'edad';
  }
  if (!e.relacion || e.relacion === 'distinto') e.contra ??= 'nombre_distinto';

  e.identidad = f.clave.startsWith('lic:') && ps.some((p) => p.fuente === 'engarde' && p.clave === f.clave);
  const club = normalizarClub(f.club);
  if (club && anio !== null) {
    e.club = clubEnTemporadas(ps, club, anio);
    e.otroClub = otroClubEnTemporadas(ps, club, anio);
    const acotada = /^M\d+$/.test(f.categoria) || f.categoria === 'VET';
    e.clubYAnio = e.club && d.anio !== null && acotada;
  }
  const casa = (n: string) => { const m = mejorRelacion([{ nombre: n, fuente: f.fuente }], publicado); return !!m && LIBRES.has(m.relacion); };
  if (f.tipo === 'puesto') {
    e.continuidad = !ps.some((p) => p.comp === f.comp) && b.lados(r).some((l) => l.comp === f.comp && casa(l.nombre));
  } else {
    const compatibles = b.enPrueba(f.comp).filter((x) => casa(x.n));
    e.continuidad = compatibles.length === 1 && compatibles[0].p === r;
  }
  if (!e.contra) {
    const m = motivoNoUnir(publicado, b.nombres(r), { identidad: e.identidad, clubYAnio: e.clubYAnio, continuidad: e.continuidad });
    if (m) e.contra = `nombre_${m.relacion}`;
  }
  return e;
}

/** La mejor evidencia que tiene una candidata, para el recuento. */
function evidenciaDe(e: Evaluacion): string {
  if (e.identidad) return 'identidad';
  if (e.continuidad) return 'continuidad';
  if (e.clubYAnio) return 'club_y_anio';
  if (e.club) return 'club_sin_anio';
  if (e.relacion === 'orden_cruzado') return 'orden_cruzado';
  if (e.relacion === 'mismo') return 'nombre_identico';
  return 'ninguna';
}

type Eleccion = { r: string; tipo: TipoDecisiva; evidencia: string } | { r: null; motivo: string };

export function decidirFila(evs: readonly Evaluacion[], tipo: Fila['tipo'] = 'puesto', duplicadasFundidas = false): Eleccion {
  const viables = evs.filter((e) => !e.contra);
  if (viables.length === 0) return { r: null, motivo: 'todas_contradichas' };
  const unica = (xs: Evaluacion[]) => (new Set(xs.map((x) => x.r)).size === 1 ? xs[0] : null);
  const id = unica(viables.filter((e) => e.identidad));
  if (id) return { r: id.r, tipo: 'identidad', evidencia: 'misma licencia Engarde' };
  const ids = viables.filter((e) => e.identidad);
  if (ids.length > 1) return { r: null, motivo: 'varias_con_licencia' };
  const cont = viables.filter((e) => e.continuidad);
  if (cont.length === 1) return { r: cont[0].r, tipo: 'continuidad', evidencia: 'puesto y asaltos de la misma prueba' };
  if (cont.length > 1) return { r: null, motivo: 'varias_con_continuidad' };
  // Un asalto sin puesto de la misma persona en su prueba no se resuelve con el nombre de otras
  // pruebas (como en `unificar-personas.ts` para Engarde): sólo la continuidad lo decide.
  if (tipo === 'asalto') return { r: null, motivo: viables.length > 1 ? 'asalto_sin_continuidad_varias' : 'asalto_sin_continuidad' };
  const ca = viables.filter((e) => e.clubYAnio);
  if (ca.length === 1 && viables.every((e) => e === ca[0] || e.otroClub)) {
    return { r: ca[0].r, tipo: 'club_y_anio', evidencia: 'mismo club (±1 temporada) y año de nacimiento compatible con la categoría' };
  }
  if (ca.length >= 1) return { r: null, motivo: ca.length > 1 ? 'varias_con_club_y_anio' : 'club_y_anio_con_otra_posible' };
  if (viables.length === 1 && viables[0].relacion === 'mismo' && evs.length > 1) {
    return { r: viables[0].r, tipo: 'nombre_unico', evidencia: `mismo nombre; las demás descartadas (${[...new Set(evs.filter((e) => e.contra).map((e) => e.contra))].join(', ')})` };
  }
  if (viables.length === 1 && viables[0].relacion === 'mismo' && duplicadasFundidas) {
    return { r: viables[0].r, tipo: 'nombre_unico', evidencia: 'mismo nombre; las otras candidatas eran fichas duplicadas de esta persona' };
  }
  if (viables.length === 1 && viables[0].relacion === 'mismo') return { r: null, motivo: 'unica_candidata_sin_otra_pista' };
  if (viables.some((e) => e.club)) return { r: null, motivo: 'solo_club_sin_anio' };
  return { r: null, motivo: viables.length > 1 ? 'varias_sin_apoyo' : 'sin_apoyo' };
}

type GrupoNombre = { clave: string; norm: string; firma: string; visible: string; props: Prop[]; filas: Fila[] };
type Prop = { id: string; source: string; ref: string; nombre: string; persona: string };

function cargarFilas(db: DatabaseSync, grupos: Map<string, GrupoNombre>): void {
  const porNorm = new Map<string, GrupoNombre[]>();
  for (const g of grupos.values()) (porNorm.get(g.norm) ?? porNorm.set(g.norm, []).get(g.norm)!).push(g);
  const cache = new Map<string, string>();
  const nn = (s: string) => { let v = cache.get(s); if (v === undefined) cache.set(s, (v = normalizarNombre(s))); return v; };
  const grupoDe = (nombre: string, fuente: string) => {
    const gs = porNorm.get(nn(nombre));
    if (!gs) return null;
    const firma = firmaApellidos(nombre, formatoDeFuente(fuente));
    return gs.find((g) => g.firma === firma) ?? null;
  };
  const comp = `c.season temporada, c.category categoria, c.gender genero, e.name || ' · ' || c.weapon || ' ' || c.gender || ' ' || c.category prueba`;
  for (const r of db.prepare(
    `SELECT r.id, r.competition_id comp, r.source fuente, r.source_name nombre, r.source_club club, r.source_fact_key clave, r.source_url url, ${comp}
       FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id JOIN sport_edition e ON e.id = c.edition_id
      WHERE r.person_id IS NULL AND r.source IN (${FUENTES_SQL}) AND c.format <> 'EQUIPOS'
        AND NOT (r.source IN ('engarde', 'efc') AND coalesce(r.source_country_code, 'ESP') <> 'ESP')`,
  ).iterate() as Iterable<Omit<Fila, 'tipo'>>) {
    const g = grupoDe(r.nombre, r.fuente);
    if (g) g.filas.push({ ...r, tipo: 'puesto' });
  }
  for (const b of db.prepare(
    `SELECT b.id, b.competition_id comp, b.source fuente, b.fencer_a_name an, b.fencer_a_person_id ap, b.fencer_b_name bn, b.fencer_b_person_id bp,
            b.source_url url, ${comp}
       FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id JOIN sport_edition e ON e.id = c.edition_id
      WHERE b.source IN (${FUENTES_SQL}) AND c.format <> 'EQUIPOS' AND (b.fencer_a_person_id IS NULL OR b.fencer_b_person_id IS NULL)`,
  ).iterate() as Iterable<{
    id: string; comp: string; fuente: string; an: string; ap: string | null; bn: string; bp: string | null; url: string | null;
    temporada: string; categoria: string; genero: string; prueba: string;
  }>) {
    for (const [lado, n, p, otro] of [['a', b.an, b.ap, b.bp], ['b', b.bn, b.bp, b.ap]] as const) {
      if (p) continue;
      const g = grupoDe(n, b.fuente);
      if (g) {
        g.filas.push({
          tipo: 'asalto', id: b.id, lado, otro, comp: b.comp, fuente: b.fuente, nombre: n, club: null, clave: '', url: b.url,
          temporada: b.temporada, categoria: b.categoria, genero: b.genero, prueba: b.prueba,
        });
      }
    }
  }
}

/** Dos candidatas que son la misma ficha duplicada: mismo nombre, género, año y club, nunca juntas. */
function duplicadas(b: Base, a: string, c: string): { decisiva: boolean; motivo: string } | null {
  const da = b.datos(a);
  const dc = b.datos(c);
  if (!da.genero || da.genero !== dc.genero || da.anio === null || da.anio !== dc.anio) return null;
  const rel = mejorRelacion(b.nombres(a), b.nombres(c));
  if (rel?.relacion !== 'mismo') return null;
  const pa = b.puestos(a);
  const pc = b.puestos(c);
  const compsA = new Set(pa.map((p) => p.comp));
  if (pc.some((p) => compsA.has(p.comp))) return { decisiva: false, motivo: 'duplicada_coinciden_en_prueba' };
  const rondas = new Set(b.lados(a).map((l) => l.ronda));
  if (b.lados(c).some((l) => rondas.has(l.ronda))) return { decisiva: false, motivo: 'duplicada_coinciden_en_ronda' };
  const fie = (r: string) => new Set(b.ext(r).filter((x) => x.scheme === 'fie_addr_id').map((x) => x.value));
  const fa = fie(a);
  const fc = fie(c);
  if (fa.size && fc.size && ![...fa].some((x) => fc.has(x))) return { decisiva: false, motivo: 'duplicada_dos_id_fie' };
  if (da.atleta && dc.atleta) return { decisiva: false, motivo: 'duplicada_dos_fichas' };
  const club = pa.some((x) => x.club && x.anio !== null && clubEnTemporadas(pc, x.club, x.anio));
  return club ? { decisiva: true, motivo: 'duplicada_club_anio' } : { decisiva: false, motivo: 'duplicada_sin_club_comun' };
}

export function analizarPropuestas(db: DatabaseSync): { inf: InformeLote11; base: Base } {
  const b = new Base(db);
  const props = (db.prepare(
    `SELECT id, source, source_ref ref, source_name nombre, person_id persona FROM sport_link_candidate WHERE status = 'PROPUESTO'`,
  ).all() as Prop[]);
  const inf: InformeLote11 = {
    propuestas: props.length, grupos: { nombre: 0, fie: 0 }, porEvidencia: {}, porDecision: {}, hechosPendientes: { puestos: 0, asaltos: 0 },
    decisivas: [], porTipo: {}, dudosas: [], descartadas: [], obsoletas: { yaUnidas: 0, sinPendientes: 0, ejemplos: [] },
    candidatos: { confirmar: {}, rechazar: [] }, aplicado: null,
  };
  const evidenciaProp = new Map<string, string>();
  const decisionProp = new Map<string, string>();
  const mejor = (id: string, ev: string) => {
    const prev = evidenciaProp.get(id);
    if (!prev || RANGO_EVIDENCIA.indexOf(ev) < RANGO_EVIDENCIA.indexOf(prev)) evidenciaProp.set(id, ev);
  };
  const marcar = (id: string, d: string, fuerte = false) => { if (fuerte || !decisionProp.has(id)) decisionProp.set(id, d); };

  // ---- FIE ↔ RFEE: aristas (ficha RFEE, persona FIE).
  const fie = props.filter((p) => !p.ref.startsWith('nombre:'));
  const aristas = fie.map((p) => ({ p, r: b.raiz(p.ref), f: b.raiz(p.persona) }));
  const viablesDe = new Map<string, number>();
  const evalFie = aristas.map((a) => {
    if (a.r === a.f) return { ...a, contra: 'ya_unidas' as string | null, igualAnio: false };
    const dr = b.datos(a.r);
    const df = b.datos(a.f);
    let contra: string | null = null;
    const compsR = new Set(b.puestos(a.r).map((x) => x.comp));
    if (dr.genero && df.genero && dr.genero !== df.genero) contra = 'genero';
    else if (dr.anio !== null && df.anio !== null && dr.anio !== df.anio) contra = `anio_${dr.anio}_${df.anio}`;
    else if (b.puestos(a.f).some((x) => compsR.has(x.comp))) contra = 'coinciden_en_prueba';
    else if (b.ext(a.r).some((x) => x.scheme === 'fie_addr_id') && b.ext(a.f).some((x) => x.scheme === 'fie_addr_id')) contra = 'dos_id_fie';
    else if (dr.atleta && df.atleta) contra = 'dos_fichas';
    else {
      const m = motivoNoUnir(b.nombres(a.r), b.nombres(a.f));
      if (m) contra = `nombre_${m.relacion}`;
    }
    if (!contra) for (const k of [`r:${a.r}`, `f:${a.f}`]) viablesDe.set(k, (viablesDe.get(k) ?? 0) + 1);
    return { ...a, contra, igualAnio: dr.anio !== null && dr.anio === df.anio };
  });
  inf.grupos.fie = new Set(aristas.map((a) => a.r)).size;
  const fusionesFie: { o: string; d: string; p: Prop }[] = [];
  for (const a of evalFie) {
    if (a.contra === 'ya_unidas') {
      inf.obsoletas.yaUnidas += 1;
      marcar(a.p.id, 'obsoleta_ya_unida');
      mejor(a.p.id, 'ninguna');
      continue;
    }
    mejor(a.p.id, a.igualAnio && !a.contra ? 'nombre_y_anio' : 'ninguna');
    const origen = b.etiqueta(a.r);
    const destino = b.etiqueta(a.f);
    if (a.contra) {
      // Un ID FIE en cada lado es una contradicción blanda: la FIE a veces duplica tiradores.
      const lista = a.contra === 'dos_id_fie' || a.contra === 'dos_fichas' ? inf.dudosas : inf.descartadas;
      lista.push({ motivo: `fie:${a.contra.replace(/_\d+_\d+$/, '')}`, origen, candidatas: [destino], evidencia: a.contra });
      marcar(a.p.id, `${lista === inf.dudosas ? 'dudosa' : 'descartada'}:fie_${a.contra.replace(/_\d+_\d+$/, '')}`);
      continue;
    }
    if (a.igualAnio && viablesDe.get(`r:${a.r}`) === 1 && viablesDe.get(`f:${a.f}`) === 1) {
      fusionesFie.push({ o: a.r, d: a.f, p: a.p });
      marcar(a.p.id, 'decisiva:nombre_y_anio', true);
      inf.candidatos.confirmar[a.p.id] = 'nombre_y_anio';
    } else {
      inf.dudosas.push({ motivo: a.igualAnio ? 'fie:varias_compatibles' : 'fie:sin_anio', origen, candidatas: [destino] });
      marcar(a.p.id, a.igualAnio ? 'dudosa:fie_varias_compatibles' : 'dudosa:fie_sin_anio');
    }
  }
  for (const { o, d } of fusionesFie) {
    if (b.raiz(o) === b.raiz(d)) continue;
    inf.decisivas.push({
      tipo: 'nombre_y_anio', accion: 'fundir', origen: b.etiqueta(b.raiz(o)), destino: b.etiqueta(b.raiz(d)),
      evidencia: 'única pareja FIE/RFEE compatible, mismo año de nacimiento, nombre compatible y nunca en la misma prueba',
    });
    b.fundir(b.raiz(o), b.raiz(d));
  }

  // ---- Grupos de nombre (Engarde, PDF): se unen las propuestas de ejecuciones distintas.
  const grupos = new Map<string, GrupoNombre>();
  for (const p of props) {
    if (!p.ref.startsWith('nombre:')) continue;
    const norm = p.ref.slice('nombre:'.length).replace(/\|[^|]*$/, '');
    const firma = firmaApellidos(p.nombre, formatoDeFuente(p.source));
    const clave = `${norm}|${firma}`;
    const g = grupos.get(clave) ?? grupos.set(clave, { clave, norm, firma, visible: p.nombre, props: [], filas: [] }).get(clave)!;
    g.props.push(p);
  }
  inf.grupos.nombre = grupos.size;
  cargarFilas(db, grupos);

  // Fichas duplicadas entre las candidatas: primero, para que el resto vea una sola persona.
  const ordenados = [...grupos.values()].sort((x, y) => (x.clave < y.clave ? -1 : 1));
  const vistasDup = new Set<string>();
  for (const g of ordenados) {
    const cands = [...new Set([...g.props.map((p) => b.raiz(p.persona)), ...b.exactas(g.norm)])];
    for (let i = 0; i < cands.length; i += 1) {
      for (let j = i + 1; j < cands.length; j += 1) {
        const [x, y] = [b.raiz(cands[i]), b.raiz(cands[j])];
        if (x === y) continue;
        const k = [x, y].sort().join('|');
        if (vistasDup.has(k)) continue;
        vistasDup.add(k);
        const dup = duplicadas(b, x, y);
        if (!dup) continue;
        if (!dup.decisiva) {
          inf.dudosas.push({ motivo: dup.motivo, origen: b.etiqueta(x), candidatas: [b.etiqueta(y)], evidencia: 'mismo nombre, género y año' });
          for (const p of g.props) if ([x, y].includes(b.raiz(p.persona))) mejor(p.id, 'nombre_identico');
          continue;
        }
        // Destino: la ficha con más puestos (la que ya reúne la carrera).
        const [o, d] = b.puestos(x).length > b.puestos(y).length ? [y, x] : [x, y];
        inf.decisivas.push({
          tipo: 'duplicada_club_anio', accion: 'fundir', origen: b.etiqueta(o), destino: b.etiqueta(d),
          evidencia: 'mismo nombre, género y año de nacimiento, mismo club (±1 temporada) y nunca en la misma prueba',
        });
        for (const p of g.props) {
          if ([o, d].includes(b.raiz(p.persona))) { mejor(p.id, 'duplicada_club_anio'); marcar(p.id, 'decisiva:duplicada_club_anio', true); }
        }
        b.fundir(o, d);
      }
    }
  }

  for (const g of ordenados) {
    const crudas = [...g.props.map((p) => p.persona), ...b.exactas(g.norm)];
    const cands = [...new Set(crudas.map((id) => b.raiz(id)))];
    // Las candidatas eran fichas duplicadas que este lote acaba de fundir.
    const colapsada = new Set(crudas.map((id) => b.raiz(id, false))).size > cands.length;
    if (g.filas.length === 0) {
      inf.obsoletas.sinPendientes += 1;
      if (inf.obsoletas.ejemplos.length < 30) inf.obsoletas.ejemplos.push(`${g.visible} (${g.norm})`);
      for (const p of g.props) { marcar(p.id, 'obsoleta_sin_pendientes'); mejor(p.id, 'ninguna'); }
      continue;
    }
    // Los puestos primero: un puesto decidido da continuidad a los asaltos de su prueba.
    const filas = [...g.filas].sort((x, y) => (x.tipo === y.tipo ? (x.id < y.id ? -1 : 1) : x.tipo === 'puesto' ? -1 : 1));
    const elegidasPorComp = new Map<string, string>();
    const elegidasGrupo = new Map<string, TipoDecisiva>();
    let sinDecidir = 0;
    for (const f of filas) {
      if (f.tipo === 'puesto') inf.hechosPendientes.puestos += 1;
      else inf.hechosPendientes.asaltos += 1;
      const evs = cands.map((r) => {
        const e = evaluar(b, f, r);
        if (f.tipo === 'asalto' && !e.contra && elegidasPorComp.get(f.comp) === r) e.continuidad = true;
        return e;
      });
      for (const e of evs) for (const p of g.props) if (b.raiz(p.persona) === e.r) mejor(p.id, e.contra ? 'ninguna' : evidenciaDe(e));
      const d = decidirFila(evs, f.tipo, colapsada);
      const origen: Lado = { id: f.id, nombre: f.nombre, detalle: `${f.tipo} ${f.fuente} · ${f.temporada} · ${f.prueba}${f.club ? ` · club ${f.club}` : ''}${f.clave.startsWith('lic:') ? ` · ${f.clave}` : ''}${f.url ? ` · ${f.url}` : ''}` };
      if (d.r !== null) {
        if (f.tipo === 'puesto') elegidasPorComp.set(f.comp, d.r);
        inf.decisivas.push({
          tipo: d.tipo, accion: f.tipo === 'puesto' ? 'vincular_puesto' : 'vincular_asalto', origen, destino: b.etiqueta(d.r), prueba: f.prueba,
          evidencia: d.evidencia, fila: { id: f.id, lado: f.lado },
        });
        for (const p of g.props) if (b.raiz(p.persona) === d.r) marcar(p.id, `decisiva:${d.tipo}`, true);
        if (!elegidasGrupo.has(d.r)) elegidasGrupo.set(d.r, d.tipo);
      } else {
        sinDecidir += 1;
        const lista = d.motivo === 'todas_contradichas' ? inf.descartadas : inf.dudosas;
        lista.push({
          motivo: d.motivo, origen, prueba: f.prueba,
          candidatas: evs.map((e) => ({ ...b.etiqueta(e.r), detalle: `${e.contra ? `descartada: ${e.contra}` : `evidencia: ${evidenciaDe(e)}`} · ${b.etiqueta(e.r).detalle}` })),
        });
        for (const p of g.props) marcar(p.id, `${lista === inf.dudosas ? 'dudosa' : 'descartada'}:${d.motivo}`);
      }
    }
    for (const p of g.props) {
      const tipo = elegidasGrupo.get(b.raiz(p.persona));
      if (tipo) inf.candidatos.confirmar[p.id] = tipo;
      else if (elegidasGrupo.size > 0 && sinDecidir === 0) {
        inf.candidatos.rechazar.push(p.id);
        marcar(p.id, 'otra_candidata_elegida');
      }
    }
  }
  for (const p of props) {
    const decision = decisionProp.get(p.id) ?? 'sin_clasificar';
    const evidencia = decision.startsWith('obsoleta') ? 'obsoleta' : decision.startsWith('descartada') ? 'contradicha' : evidenciaProp.get(p.id) ?? 'ninguna';
    sumar(inf.porEvidencia, evidencia);
    sumar(inf.porDecision, decision);
  }
  for (const d of inf.decisivas) sumar(inf.porTipo, `${d.tipo}:${d.accion}`);
  return { inf, base: b };
}

function aplicar(db: DatabaseSync, b: Base, inf: InformeLote11): NonNullable<InformeLote11['aplicado']> {
  const t = ahora();
  const out = { fusiones: 0, puestos: 0, asaltos: 0, candidatosConfirmados: 0, candidatosRechazados: 0 };
  const fundir = db.prepare(`UPDATE sport_person SET merged_into_person_id = ?, updated_at = ? WHERE id = ? AND merged_into_person_id IS NULL`);
  const reapuntar = db.prepare(`UPDATE sport_person SET merged_into_person_id = ?, updated_at = ? WHERE merged_into_person_id = ?`);
  const candidato = db.prepare(
    `INSERT OR IGNORE INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence, decided_at, created_at)
     VALUES (?, '${FUENTE_FUSION}', ?, ?, ?, 'CONFIRMADO', ?, ?, ?)`,
  );
  const puesto = db.prepare(`UPDATE sport_result SET person_id = ? WHERE id = ? AND person_id IS NULL`);
  const asaltoA = db.prepare(`UPDATE sport_bout SET fencer_a_person_id = ? WHERE id = ? AND fencer_a_person_id IS NULL AND coalesce(fencer_b_person_id, '') <> ?`);
  const asaltoB = db.prepare(`UPDATE sport_bout SET fencer_b_person_id = ? WHERE id = ? AND fencer_b_person_id IS NULL AND coalesce(fencer_a_person_id, '') <> ?`);
  for (const d of inf.decisivas) {
    if (d.accion !== 'fundir') continue;
    if (Number(fundir.run(d.destino.id, t, d.origen.id).changes) === 0) continue;
    reapuntar.run(d.destino.id, t, d.origen.id);
    candidato.run(uuid(), d.origen.id, d.origen.nombre, d.destino.id, `lote11:${d.tipo}`, t, t);
    out.fusiones += 1;
  }
  for (const d of inf.decisivas) {
    if (!d.fila) continue;
    const destino = b.raiz(d.destino.id);
    if (d.accion === 'vincular_puesto') out.puestos += Number(puesto.run(destino, d.fila.id).changes);
    else out.asaltos += Number((d.fila.lado === 'a' ? asaltoA : asaltoB).run(destino, d.fila.id, destino).changes);
  }
  const confirmar = db.prepare(`UPDATE sport_link_candidate SET status = 'CONFIRMADO', evidence = ?, decided_at = ? WHERE id = ? AND status = 'PROPUESTO'`);
  const rechazar = db.prepare(`UPDATE sport_link_candidate SET status = 'RECHAZADO', evidence = ?, decided_at = ? WHERE id = ? AND status = 'PROPUESTO'`);
  for (const [id, tipo] of Object.entries(inf.candidatos.confirmar)) out.candidatosConfirmados += Number(confirmar.run(`lote11:${tipo}`, t, id).changes);
  for (const id of inf.candidatos.rechazar) out.candidatosRechazados += Number(rechazar.run('lote11:otra_candidata_elegida', t, id).changes);
  return out;
}

export function lote11(db: DatabaseSync, opciones: { aplicar?: boolean } = {}): InformeLote11 {
  if (!opciones.aplicar) return analizarPropuestas(db).inf;
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  try {
    db.exec('BEGIN');
    try {
      const { inf, base } = analizarPropuestas(db);
      inf.aplicado = aplicar(db, base, inf);
      db.exec('COMMIT');
      return inf;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    restaurarGuardia(db);
  }
}

const cuenta = (xs: readonly Listada[]) => {
  const r: Record<string, number> = {};
  for (const x of xs) sumar(r, x.motivo);
  return r;
};

/** Informe legible: cada decisión con los nombres originales de los dos lados. */
export function informeTexto(inf: InformeLote11): string {
  const l: string[] = [];
  const lado = (x: Lado) => `«${x.nombre}» [${x.id.slice(0, 8)}]${x.detalle ? ` (${x.detalle})` : ''}`;
  l.push(`Propuestas PROPUESTO: ${inf.propuestas} (grupos de nombre ${inf.grupos.nombre}, FIE↔RFEE ${inf.grupos.fie})`);
  l.push(`Hechos pendientes en los grupos de nombre: ${inf.hechosPendientes.puestos} puestos, ${inf.hechosPendientes.asaltos} lados de asalto`);
  l.push(`Por evidencia: ${JSON.stringify(inf.porEvidencia)}`);
  l.push(`Por decisión: ${JSON.stringify(inf.porDecision)}`);
  l.push(`Decisivas: ${inf.decisivas.length} ${JSON.stringify(inf.porTipo)}`);
  const decisivas = new Map<string, { d: Decisiva; n: number }>();
  for (const d of inf.decisivas) {
    const k = d.accion === 'vincular_asalto' ? `${d.tipo}|${d.origen.nombre}|${d.prueba}|${d.destino.id}` : `${d.accion}|${d.origen.id}|${d.fila?.lado ?? ''}`;
    const v = decisivas.get(k);
    if (v) v.n += 1;
    else decisivas.set(k, { d, n: 1 });
  }
  for (const { d, n } of decisivas.values()) {
    l.push(`  [${d.tipo}] ${d.accion}${n > 1 ? ` ×${n}` : ''}: ${lado(d.origen)}\n      → ${lado(d.destino)}\n      evidencia: ${d.evidencia}`);
  }
  // Los lados de asalto de un mismo nombre en una misma prueba se listan una vez, con su número.
  const agrupar = (xs: readonly Listada[], marca: string) => {
    const vistos = new Map<string, { d: Listada; n: number }>();
    for (const d of xs) {
      const k = `${d.motivo}|${d.origen.nombre}|${d.prueba ?? d.origen.id}|${d.candidatas.map((c) => c.id).join(',')}`;
      const v = vistos.get(k);
      if (v) v.n += 1;
      else vistos.set(k, { d, n: 1 });
    }
    for (const { d, n } of vistos.values()) {
      l.push(`  [${d.motivo}]${n > 1 ? ` ×${n}` : ''} ${lado(d.origen)}${d.evidencia ? ` · ${d.evidencia}` : ''}\n${d.candidatas.map((c) => `      ${marca} ${lado(c)}`).join('\n')}`);
    }
  };
  l.push(`Dudosas: ${inf.dudosas.length} ${JSON.stringify(cuenta(inf.dudosas))}`);
  agrupar(inf.dudosas, '?');
  l.push(`Descartadas: ${inf.descartadas.length} ${JSON.stringify(cuenta(inf.descartadas))}`);
  agrupar(inf.descartadas, '×');
  l.push(`Obsoletas: ya unidas ${inf.obsoletas.yaUnidas}, grupos sin hechos pendientes ${inf.obsoletas.sinPendientes}`);
  if (inf.aplicado) l.push(`Aplicado: ${JSON.stringify(inf.aplicado)}`);
  return l.join('\n');
}

function main(): void {
  const rutaDb = argumento('db', '');
  if (!rutaDb || !existsSync(rutaDb)) throw new Error('Uso: --db <copia de trabajo .sqlite> [--aplicar] [--informe <ruta.json>]');
  const aplicarCambios = bandera('aplicar');
  if (aplicarCambios && BASES_PROTEGIDAS.has(basename(rutaDb).toLowerCase())) throw new Error(`${basename(rutaDb)} es de sólo lectura: usa una copia`);
  const db = new DatabaseSync(rutaDb, aplicarCambios ? {} : { readOnly: true });
  const inf = lote11(db, { aplicar: aplicarCambios });
  db.close();
  const salida = argumento('informe', '');
  if (salida) {
    writeFileSync(salida, JSON.stringify(inf, null, 2));
    writeFileSync(salida.replace(/\.json$/i, '') + '.txt', informeTexto(inf));
  }
  console.log(informeTexto(inf));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
