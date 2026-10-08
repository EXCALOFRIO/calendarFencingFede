/**
 * Cargador asíncrono de UN fichero de hechos sobre D1, para la ingesta automática.
 *
 * Es la traducción de `Cargador` (scripts/indexado/cargar-hechos.ts) a D1 con las mismas reglas
 * (`hechos/reglas-carga.ts`): mismas claves naturales, mismo `content_hash`, mismos modos
 * (nuevo / reemplazo / fusión / deduplicado / conservado / vacío) y la misma cobertura. Una
 * prueba cargada aquí queda igual que si la hubiera cargado el lote manual, más el enlace
 * conservador de personas (`personas.ts`), que en el lote hace la unificación posterior.
 *
 * Diferencias deliberadas, todas por prudencia:
 *  - lee todo lo previo de la prueba, decide en memoria y escribe al final en lotes atómicos;
 *    una lectura igual a lo guardado no genera ninguna sentencia (ni cobertura);
 *  - las pruebas partidas por un lector antiguo (`<clave>~2`) no se reabsorben: se devuelven
 *    como conflicto para revisión y no se escribe nada;
 *  - `destino`: asaltos de Engarde que pertenecen a una prueba de Skermo ya guardada (la unión
 *    de copias de `dedupe-pruebas.ts`), sin crear la prueba de Engarde.
 */
import type { AsaltoHecho, HechosPrueba, ResultadoHecho } from '../hechos/formato';
import {
  ambitoFirma,
  CLAVES_FIJAS,
  clavesEstables,
  decidirModo,
  estadosDocumento,
  estadoTrasModo,
  filasSeccion,
  firmaAsalto,
  hashHecho,
  lecturaUnica,
  mejorEstado,
  mismoAsaltoOtraLectura,
  mismosPuntos,
  normalizarNombre,
  repetidosEntreRondas,
  SECCIONES,
  type Modo,
  type Seccion,
} from '../hechos/reglas-carga';
import { consistenciaCuadro, pesoCuadro, type AsaltoCuadro } from '../hechos/cuadro-consistencia';
import { casarUnico, prepararNombre } from '../hechos/nombres-prueba';
import type { BaseResultados, Sentencia } from './sql';
import { resolverPersonas, type DecisionPersona } from './personas';

export type DestinoAsaltos = { competitionId: string; season: string };

export type OpcionesCarga = {
  ahora: number;
  uuid: () => string;
  destino?: DestinoAsaltos;
  /** false: no se crean personas ni se enlazan (prueba del cargador frente al lote). */
  enlazarPersonas?: boolean;
  /** Pruebas ya usadas en esta carga (varias pruebas de un PDF): la búsqueda por atributos no las repite. */
  usadas?: Set<string>;
};

export type CambioPuesto = { factKey: string; personId: string | null; position: number | null; nuevo: boolean };

export type PlanCarga = {
  estado: 'ok' | 'conflicto';
  motivo?: string;
  competitionId: string;
  competitionKey: string;
  edicionId: string | null;
  nuevaPrueba: boolean;
  modos: Partial<Record<Seccion, Modo>>;
  sentencias: Sentencia[];
  /** Puestos nuevos o enlazados en esta carga (para eventos y perfiles). */
  puestos: CambioPuesto[];
  personasNuevas: string[];
  decisiones: Map<string, DecisionPersona>;
  /** Filas (puestos + asaltos) que quedarán en la prueba para cada sección. */
  filasFinales: Record<Seccion, number>;
  previas: Record<Seccion, number>;
  coberturaResultados: string | null;
};

type FilaResultado = {
  id: string; source_fact_key: string; person_id: string | null; source_name: string;
  source_country_code: string | null; source_club: string | null; position: number | null;
  position_raw: string | null; official_points: string | null; occurred_on: string | null;
  source_url: string | null; content_hash: string;
};
type FilaAsalto = {
  id: string; round_key: string; fencer_a_ref: string; fencer_b_ref: string;
  fencer_a_person_id: string | null; fencer_b_person_id: string | null; fencer_a_name: string;
  fencer_b_name: string; score_a: number; score_b: number; occurred_on: string | null;
  source_url: string | null; content_hash: string;
};

const COL_RESULTADO = ['id', 'competition_id', 'source', 'source_fact_key', 'person_id', 'source_name',
  'source_country_code', 'source_club', 'position', 'position_raw', 'official_points', 'occurred_on', 'source_url',
  'content_hash', 'revision', 'first_seen_at', 'revised_at'];
const COL_ASALTO = ['id', 'competition_id', 'source', 'phase', 'round_key', 'fencer_a_ref', 'fencer_b_ref',
  'fencer_a_person_id', 'fencer_b_person_id', 'fencer_a_name', 'fencer_b_name', 'score_a', 'score_b', 'occurred_on',
  'source_url', 'content_hash', 'revision', 'first_seen_at', 'revised_at'];

/** INSERT de varias filas sin pasar de 100 parámetros por sentencia (límite de D1). */
export function insertarFilas(tabla: string, columnas: readonly string[], filas: readonly unknown[][]): Sentencia[] {
  const porSentencia = Math.max(1, Math.floor(100 / columnas.length));
  const out: Sentencia[] = [];
  for (let i = 0; i < filas.length; i += porSentencia) {
    const trozo = filas.slice(i, i + porSentencia);
    const fila = `(${columnas.map(() => '?').join(',')})`;
    out.push({
      sql: `insert into ${tabla} (${columnas.join(', ')}) values ${trozo.map(() => fila).join(', ')}`,
      params: trozo.flat(),
      filas: trozo.length,
    });
  }
  return out;
}

const clave = (ronda: string, a: string, b: string) => `${ronda}\u0000${a}\u0000${b}`;

export async function planificarCarga(base: BaseResultados, h: HechosPrueba, o: OpcionesCarga): Promise<PlanCarga> {
  const sentenciasPersonas: Sentencia[] = [];
  const sentencias: Sentencia[] = [];
  const puestos: CambioPuesto[] = [];
  const t = o.ahora;
  let decisiones = new Map<string, DecisionPersona>();
  let personasNuevas: string[] = [];

  // ---- edición y prueba
  let edicionId: string | null = null;
  let competitionId: string;
  let competitionKey: string;
  let season: string;
  let nuevaPrueba = false;
  if (o.destino) {
    competitionId = o.destino.competitionId;
    competitionKey = h.competition.competitionKey;
    season = o.destino.season;
  } else {
    const e = h.edition;
    const [previaEd] = await base.leer<{ id: string; start_date: string | null; end_date: string | null; city: string | null;
      country_code: string | null; source_url: string | null }>(
      `select id, start_date, end_date, city, country_code, source_url from sport_edition where source=? and season=? and tournament_key=?`,
      [h.source, e.season, e.tournamentKey]);
    if (!previaEd) {
      edicionId = o.uuid();
      sentencias.push({
        sql: `insert into sport_edition (id, source, season, tournament_key, name, start_date, end_date, city, country_code,
          source_url, updated_at) values (?,?,?,?,?,?,?,?,?,?,?)`,
        params: [edicionId, h.source, e.season, e.tournamentKey, e.name, e.startDate, e.endDate, e.city, e.countryCode, h.sourceUrl, t],
        filas: 1,
      });
    } else {
      edicionId = previaEd.id;
      const nuevo = {
        start_date: previaEd.start_date ?? e.startDate, end_date: previaEd.end_date ?? e.endDate,
        city: previaEd.city ?? e.city, country_code: previaEd.country_code ?? e.countryCode,
        source_url: previaEd.source_url ?? h.sourceUrl,
      };
      if ((Object.keys(nuevo) as (keyof typeof nuevo)[]).some((k) => nuevo[k] !== previaEd[k])) {
        sentencias.push({
          sql: `update sport_edition set start_date=?, end_date=?, city=?, country_code=?, source_url=?, updated_at=? where id=?`,
          params: [nuevo.start_date, nuevo.end_date, nuevo.city, nuevo.country_code, nuevo.source_url, t, previaEd.id],
          filas: 1,
        });
      }
    }
    const c = h.competition;
    type Previa = { id: string; edition_id: string; competition_key: string; category_raw: string | null;
      competition_date: string | null; source_url: string | null };
    const columnas = 'id, edition_id, competition_key, category_raw, competition_date, source_url';
    let [previa] = await base.leer<Previa>(
      `select ${columnas} from sport_competition where source=? and season=? and competition_key=?`,
      [h.source, e.season, c.competitionKey]);
    if (!previa && previaEd && !CLAVES_FIJAS.has(h.source)) {
      const candidatas = (await base.leer<Previa>(
        `select ${columnas} from sport_competition where edition_id=? and source=? and weapon=? and gender=? and category=? and format=?`,
        [previaEd.id, h.source, c.weapon, c.gender, c.category, c.format]))
        .filter((p) => !o.usadas?.has(p.id) &&
          (p.category_raw === null || c.categoryRaw === null || p.category_raw === c.categoryRaw));
      // Ambiguous: like the batch loader, a new competition is inserted instead of guessing.
      if (candidatas.length === 1) previa = candidatas[0];
    }
    if (previa && h.source === 'rfee_pdf') {
      const partes = await base.leer<{ k: string }>(
        `select competition_key k from sport_competition where source=? and season=? and edition_id=? and id<>?
           and substr(competition_key, 1, ?) = ?`,
        [h.source, e.season, previa.edition_id, previa.id, previa.competition_key.length, previa.competition_key]);
      if (partes.some((p) => /^~\d+$/.test(p.k.slice(previa!.competition_key.length)))) {
        return conflicto('prueba_partida_por_lector_antiguo', previa.id, previa.competition_key, edicionId);
      }
    }
    if (!previa) {
      competitionId = o.uuid();
      competitionKey = c.competitionKey;
      nuevaPrueba = true;
      sentencias.push({
        sql: `insert into sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category,
          category_raw, format, competition_date, source_url, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [competitionId, edicionId, h.source, e.season, c.competitionKey, c.weapon, c.gender, c.category,
          c.categoryRaw, c.format, c.date, h.sourceUrl, t],
        filas: 1,
      });
    } else {
      competitionId = previa.id;
      competitionKey = previa.competition_key;
      const nuevo = {
        category_raw: previa.category_raw ?? c.categoryRaw,
        competition_date: previa.competition_date ?? c.date,
        source_url: previa.source_url ?? h.sourceUrl,
      };
      if (nuevo.category_raw !== previa.category_raw || nuevo.competition_date !== previa.competition_date ||
        nuevo.source_url !== previa.source_url) {
        sentencias.push({
          sql: `update sport_competition set category_raw=?, competition_date=?, source_url=?, updated_at=? where id=?`,
          params: [nuevo.category_raw, nuevo.competition_date, nuevo.source_url, t, previa.id],
          filas: 1,
        });
      }
    }
    season = e.season;
    o.usadas?.add(competitionId);
  }

  const individual = h.competition.format === 'INDIVIDUAL';
  const fecha = h.competition.date ?? h.edition.startDate;
  const modos: PlanCarga['modos'] = {};
  const filasFinales: Record<Seccion, number> = { results: 0, pools: 0, tableau: 0 };
  const previasCuenta: Record<Seccion, number> = { results: 0, pools: 0, tableau: 0 };
  let coberturaResultados: string | null = null;

  // ---- puestos (siempre antes que los asaltos: los asaltos toman la persona del puesto)
  const prevRes = nuevaPrueba ? [] : await base.leer<FilaResultado>(
    `select id, source_fact_key, person_id, source_name, source_country_code, source_club, position, position_raw,
       official_points, occurred_on, source_url, content_hash from sport_result where competition_id=? and source=?`,
    [competitionId, h.source]);
  previasCuenta.results = prevRes.length;
  const personaDePuesto = new Map<string, string>();
  const nombreDePuesto: { nombre: string; personId: string }[] = [];
  for (const p of prevRes) if (p.person_id) personaDePuesto.set(p.source_fact_key, p.person_id);
  const quedanRes = new Map(prevRes.map((p) => [p.source_fact_key, p]));

  const usar = (s: Seccion) => filasSeccion(h, s) > 0 || h.status[s] === 'sin_resultados';
  if (!o.destino && usar('results')) {
    const porClave = new Map(prevRes.map((p) => [p.source_fact_key, p]));
    const nuevas = new Map<string, ResultadoHecho>();
    for (const r of h.results) if (!nuevas.has(r.factKey)) nuevas.set(r.factKey, r);
    const modo = decidirModo(h.status.results, prevRes.length, nuevas.size,
      clavesEstables(nuevas.keys()) && clavesEstables(porClave.keys()));
    modos.results = modo;
    if (modo !== 'vacio' && modo !== 'conservado') {
      const heredables = new Map<string, string | null>();
      if (modo === 'reemplazo') {
        for (const p of prevRes) {
          if (nuevas.has(p.source_fact_key) || !p.person_id) continue;
          const n = normalizarNombre(p.source_name);
          heredables.set(n, heredables.has(n) && heredables.get(n) !== p.person_id ? null : p.person_id);
        }
      }
      // Persons: new rows without an inherited link, and kept rows that are still unlinked.
      const necesitan = [...nuevas.values()].filter((r) => {
        const previa = porClave.get(r.factKey);
        if (previa) return previa.person_id === null;
        return (heredables.get(normalizarNombre(r.name)) ?? null) === null;
      });
      let resueltas = new Map<string, string | null>();
      if (individual && o.enlazarPersonas !== false && necesitan.length) {
        const ya = new Set<string>();
        for (const p of prevRes) if (p.person_id && nuevas.has(p.source_fact_key)) ya.add(p.person_id);
        for (const r of nuevas.values()) {
          const her = porClave.has(r.factKey) ? null : heredables.get(normalizarNombre(r.name));
          if (her) ya.add(her);
        }
        const rp = await resolverPersonas(base, {
          source: h.source, season, fecha, gender: h.competition.gender, competitionKey,
          yaEnPrueba: ya, ahora: t, uuid: o.uuid,
        }, necesitan);
        resueltas = rp.personas;
        decisiones = rp.decisiones;
        personasNuevas = rp.nuevas;
        sentenciasPersonas.push(...rp.sentencias);
      }
      const inserciones: unknown[][] = [];
      for (const r of nuevas.values()) {
        const previa = porClave.get(r.factKey);
        const hash = hashHecho(h.source, competitionKey, r);
        const v = {
          source_name: r.name,
          source_country_code: r.countryCode ?? previa?.source_country_code ?? null,
          source_club: r.club ?? previa?.source_club ?? null,
          position: r.position,
          position_raw: r.positionRaw ?? previa?.position_raw ?? null,
          official_points: mismosPuntos(previa?.official_points ?? null, r.points)
            ? previa!.official_points : r.points ?? previa?.official_points ?? null,
          occurred_on: fecha ?? previa?.occurred_on ?? null,
          source_url: previa?.source_url ?? h.sourceUrl,
        };
        if (!previa) {
          const persona = heredables.get(normalizarNombre(r.name)) ?? resueltas.get(r.factKey) ?? null;
          inserciones.push([o.uuid(), competitionId, h.source, r.factKey, persona, v.source_name, v.source_country_code,
            v.source_club, v.position, v.position_raw, v.official_points, v.occurred_on, v.source_url, hash, 1, t, t]);
          if (persona) personaDePuesto.set(r.factKey, persona);
          puestos.push({ factKey: r.factKey, personId: persona, position: r.position, nuevo: true });
          quedanRes.set(r.factKey, previaVacia(r.factKey, { person_id: persona, source_name: r.name }));
          continue;
        }
        const enlazada = previa.person_id === null ? resueltas.get(r.factKey) ?? null : null;
        const igual = previa.content_hash === hash ||
          (Object.keys(v) as (keyof typeof v)[]).every((k) => v[k] === previa[k]);
        if (!igual) {
          sentencias.push({
            sql: `update sport_result set source_name=?, source_country_code=?, source_club=?, position=?, position_raw=?,
              official_points=?, occurred_on=?, source_url=?, content_hash=?, revision=revision+1, revised_at=?${enlazada ? ', person_id=?' : ''}
              where id=?`,
            params: [v.source_name, v.source_country_code, v.source_club, v.position, v.position_raw, v.official_points,
              v.occurred_on, v.source_url, hash, t, ...(enlazada ? [enlazada] : []), previa.id],
            filas: 1,
          });
        } else if (enlazada) {
          sentencias.push({ sql: `update sport_result set person_id=? where id=? and person_id is null`, params: [enlazada, previa.id], filas: 1 });
        }
        if (enlazada) {
          personaDePuesto.set(r.factKey, enlazada);
          quedanRes.set(r.factKey, { ...previa, person_id: enlazada });
          puestos.push({ factKey: r.factKey, personId: enlazada, position: r.position, nuevo: false });
        }
      }
      sentencias.push(...insertarFilas('sport_result', COL_RESULTADO, inserciones));
      if (modo === 'reemplazo') {
        const borrar = prevRes.filter((p) => !nuevas.has(p.source_fact_key)).map((p) => p.id);
        for (const id of borrar) quedanRes.delete(prevRes.find((p) => p.id === id)!.source_fact_key);
        sentencias.push(...borrarPorId('sport_result', borrar));
      }
    }
    filasFinales.results = quedanRes.size;
    coberturaResultados = estadoTrasModo(modo, h.status.results, null);
  } else {
    filasFinales.results = quedanRes.size;
  }

  // Persons of this competition by result, for the bouts.
  let resultadosDestino: { source_fact_key: string; source_name: string; person_id: string | null }[] = [];
  if (o.destino) {
    resultadosDestino = await base.leer(
      `select source_fact_key, source_name, person_id from sport_result where competition_id=? and person_id is not null`,
      [competitionId]);
  } else {
    for (const r of quedanRes.values()) if (r.person_id) nombreDePuesto.push({ nombre: r.source_name, personId: r.person_id });
  }

  // ---- asaltos
  for (const s of ['pools', 'tableau'] as const) {
    if (!usar(s)) {
      const fase = s === 'pools' ? 'POULE' : 'TABLEAU';
      filasFinales[s] = nuevaPrueba ? 0 : Number((await base.leer<{ n: number }>(
        `select count(*) n from sport_bout where competition_id=? and source=? and phase=?`, [competitionId, h.source, fase]))[0]?.n ?? 0);
      continue;
    }
    const fase = s === 'pools' ? 'POULE' : 'TABLEAU';
    const r = await planAsaltos(base, h, fase, competitionId, competitionKey, nuevaPrueba, fecha, individual, t, o,
      personaDePuesto, o.destino ? resultadosDestino.map((x) => ({ nombre: x.source_name, personId: x.person_id! })) : nombreDePuesto);
    modos[s] = r.modo;
    previasCuenta[s] = r.previas;
    filasFinales[s] = r.finales;
    sentencias.push(...r.sentencias);
  }

  // ---- cobertura
  for (const s of SECCIONES) {
    if (o.destino && s === 'results') continue;
    const modo = modos[s];
    if (modo === undefined) continue;
    const kind = s === 'results' ? (h.source === 'fie' ? 'ranking' : 'results') : s;
    const publicado = s === 'results' ? h.status.publishedParticipants : null;
    const cob = await planCobertura(base, h.source, season, kind, competitionKey, competitionId,
      (previo) => estadoTrasModo(modo, h.status[s], previo), publicado, filasFinales[s], h.sourceUrl, t, o.uuid);
    if (s === 'results') coberturaResultados = cob.estado;
    sentencias.push(...cob.sentencias);
  }

  return {
    estado: 'ok', competitionId, competitionKey, edicionId, nuevaPrueba, modos,
    sentencias: [...sentenciasPersonas, ...sentencias], puestos, personasNuevas, decisiones,
    filasFinales, previas: previasCuenta, coberturaResultados,
  };

  function conflicto(motivo: string, id: string, k: string, ed: string | null): PlanCarga {
    return {
      estado: 'conflicto', motivo, competitionId: id, competitionKey: k, edicionId: ed, nuevaPrueba: false, modos: {},
      sentencias: [], puestos: [], personasNuevas: [], decisiones: new Map(),
      filasFinales: { results: 0, pools: 0, tableau: 0 }, previas: { results: 0, pools: 0, tableau: 0 }, coberturaResultados: null,
    };
  }
}

function previaVacia(k: string, d: Partial<Pick<FilaResultado, 'person_id' | 'source_name'>> = {}): FilaResultado {
  return { id: '', source_fact_key: k, person_id: d.person_id ?? null, source_name: d.source_name ?? '', source_country_code: null,
    source_club: null, position: null, position_raw: null, official_points: null, occurred_on: null, source_url: null, content_hash: '' };
}

function borrarPorId(tabla: string, ids: readonly string[]): Sentencia[] {
  const out: Sentencia[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const t = ids.slice(i, i + 90);
    out.push({ sql: `delete from ${tabla} where id in (${t.map(() => '?').join(',')})`, params: t, filas: t.length });
  }
  return out;
}

async function planAsaltos(
  base: BaseResultados, h: HechosPrueba, fase: 'POULE' | 'TABLEAU', competitionId: string, competitionKey: string,
  nuevaPrueba: boolean, fecha: string | null, individual: boolean, t: number, o: OpcionesCarga,
  personaDePuesto: ReadonlyMap<string, string>, nombresPuesto: readonly { nombre: string; personId: string }[],
): Promise<{ modo: Modo; previas: number; finales: number; sentencias: Sentencia[] }> {
  const sentencias: Sentencia[] = [];
  const seccion = fase === 'POULE' ? 'pools' : 'tableau';
  const previas = nuevaPrueba ? [] : await base.leer<FilaAsalto>(
    `select id, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id, fencer_b_person_id, fencer_a_name,
       fencer_b_name, score_a, score_b, occurred_on, source_url, content_hash
     from sport_bout where competition_id=? and source=? and phase=?`, [competitionId, h.source, fase]);
  const porClave = new Map(previas.map((p) => [clave(p.round_key, p.fencer_a_ref, p.fencer_b_ref), p]));
  const nuevas = new Map<string, AsaltoHecho>();
  for (const original of h.bouts) {
    if (original.phase !== fase || original.aRef === original.bRef) continue;
    const b = original.aRef < original.bRef ? original : {
      ...original, aRef: original.bRef, bRef: original.aRef, aName: original.bName, bName: original.aName,
      scoreA: original.scoreB, scoreB: original.scoreA,
      winner: original.winner === null ? null : original.winner === 'A' ? ('B' as const) : ('A' as const),
    };
    const k = clave(b.roundKey, b.aRef, b.bRef);
    if (!nuevas.has(k)) nuevas.set(k, b);
  }
  if (h.source === 'rfee_pdf' && fase === 'TABLEAU') {
    for (const b of repetidosEntreRondas([...nuevas.values()])) nuevas.delete(clave(b.roundKey, b.aRef, b.bRef));
    const lista = individual ? [...nuevas.entries()] : [];
    const coherencia = consistenciaCuadro(lista.map(([, b]) => b));
    for (const i of coherencia.incoherentes) nuevas.delete(lista[i][0]);
  }
  const estables = clavesEstables([...nuevas.values()].flatMap((b) => [b.aRef, b.bRef])) &&
    clavesEstables(previas.flatMap((p) => [p.fencer_a_ref, p.fencer_b_ref]));
  const peso = (l: AsaltoCuadro[]): [number, number] => (individual ? pesoCuadro(l) : [l.length, 0]);
  const comoCuadro = (p: FilaAsalto): AsaltoCuadro => ({ roundKey: p.round_key, aRef: p.fencer_a_ref, bRef: p.fencer_b_ref, scoreA: p.score_a, scoreB: p.score_b });
  const mejorGuardado = () => {
    const [a, b] = [peso(previas.map(comoCuadro)), peso([...nuevas.values()])];
    return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  };
  const modo: Modo = h.source === 'rfee_pdf'
    ? nuevas.size === 0 ? 'vacio'
      : previas.length === 0 ? 'nuevo'
      : fase === 'TABLEAU' ? (lecturaUnica(previas) && mejorGuardado() ? 'conservado' : 'reemplazo')
      : nuevas.size >= previas.length ? 'reemplazo' : 'deduplicado'
    : decidirModo(h.status[seccion], previas.length, nuevas.size, estables);
  if (modo === 'vacio' || modo === 'conservado') {
    let borradas: string[] = [];
    if (h.source === 'rfee_pdf' && fase === 'TABLEAU' && individual) {
      borradas = [...consistenciaCuadro(previas.map(comoCuadro)).incoherentes].map((i) => previas[i].id);
      sentencias.push(...borrarPorId('sport_bout', borradas));
    }
    return { modo, previas: previas.length, finales: previas.length - borradas.length, sentencias };
  }

  // Persona of each side: the result with the same reference, else a unique compatible name.
  const porNombre = new Map<string, string | null>();
  const anotarNombre = (nombre: string, persona: string) => {
    const n = normalizarNombre(nombre);
    porNombre.set(n, porNombre.has(n) && porNombre.get(n) !== persona ? null : persona);
  };
  for (const r of nombresPuesto) anotarNombre(r.nombre, r.personId);
  if (modo === 'reemplazo' || modo === 'deduplicado') {
    for (const p of previas) {
      if (nuevas.has(clave(p.round_key, p.fencer_a_ref, p.fencer_b_ref))) continue;
      if (p.fencer_a_person_id) anotarNombre(p.fencer_a_name, p.fencer_a_person_id);
      if (p.fencer_b_person_id) anotarNombre(p.fencer_b_name, p.fencer_b_person_id);
    }
  }
  const preparados = o.destino ? nombresPuesto.map((x) => prepararNombre(x.nombre)) : [];
  const persona = (ref: string, nombre: string): string | null => {
    const directa = personaDePuesto.get(ref) ?? porNombre.get(normalizarNombre(nombre)) ?? null;
    if (directa || !o.destino) return directa;
    // Engarde names inside a Skermo competition: same rule as revincularAsaltosPorPuesto.
    const i = casarUnico(prepararNombre(nombre), preparados);
    return i === null ? null : nombresPuesto[i].personId;
  };

  const inserciones: unknown[][] = [];
  for (const [k, b] of nuevas) {
    const previa = porClave.get(k);
    const hash = hashHecho(h.source, competitionKey, b);
    const v = {
      fencer_a_name: b.aName, fencer_b_name: b.bName, score_a: b.scoreA, score_b: b.scoreB,
      occurred_on: fecha ?? previa?.occurred_on ?? null, source_url: previa?.source_url ?? h.sourceUrl,
    };
    if (!previa) {
      const pa = persona(b.aRef, b.aName);
      let pb = persona(b.bRef, b.bName);
      if (pa !== null && pa === pb) pb = null;
      inserciones.push([o.uuid(), competitionId, h.source, fase, b.roundKey, b.aRef, b.bRef, pa, pb, v.fencer_a_name,
        v.fencer_b_name, v.score_a, v.score_b, v.occurred_on, v.source_url, hash, 1, t, t]);
      continue;
    }
    const igual = previa.content_hash === hash || (Object.keys(v) as (keyof typeof v)[]).every((c) => v[c] === previa[c]);
    // Link sides that are still empty when the result now has a person (never re-link a set side).
    const enlazar = o.enlazarPersonas !== false;
    const na = previa.fencer_a_person_id ?? (enlazar ? persona(b.aRef, b.aName) : null);
    let nb = previa.fencer_b_person_id ?? (enlazar ? persona(b.bRef, b.bName) : null);
    if (na !== null && na === nb) nb = previa.fencer_b_person_id;
    const enlaza = na !== previa.fencer_a_person_id || nb !== previa.fencer_b_person_id;
    if (!igual) {
      sentencias.push({
        sql: `update sport_bout set fencer_a_name=?, fencer_b_name=?, score_a=?, score_b=?, occurred_on=?, source_url=?,
          content_hash=?, revision=revision+1, revised_at=?, fencer_a_person_id=?, fencer_b_person_id=? where id=?`,
        params: [v.fencer_a_name, v.fencer_b_name, v.score_a, v.score_b, v.occurred_on, v.source_url, hash, t, na, nb, previa.id],
        filas: 1,
      });
    } else if (enlaza && o.enlazarPersonas !== false) {
      sentencias.push({ sql: `update sport_bout set fencer_a_person_id=?, fencer_b_person_id=? where id=?`, params: [na, nb, previa.id], filas: 1 });
    }
  }
  sentencias.push(...insertarFilas('sport_bout', COL_ASALTO, inserciones));
  let borradas = 0;
  const borrar: string[] = [];
  if (modo === 'fusion' && fase === 'TABLEAU') {
    const nuevasPorFirma = new Map<string, Set<string>>();
    for (const b of nuevas.values()) {
      const kf = `${b.aRef}|${b.bRef}|${b.scoreA}|${b.scoreB}`;
      nuevasPorFirma.set(kf, (nuevasPorFirma.get(kf) ?? new Set()).add(b.roundKey));
    }
    for (const [k, p] of porClave) {
      if (nuevas.has(k)) continue;
      const rondas = nuevasPorFirma.get(`${p.fencer_a_ref}|${p.fencer_b_ref}|${p.score_a}|${p.score_b}`);
      if (!rondas || rondas.has(p.round_key)) continue;
      borrar.push(p.id);
    }
  }
  if (modo === 'reemplazo') for (const [k, p] of porClave) if (!nuevas.has(k)) borrar.push(p.id);
  if (modo === 'deduplicado') {
    const nuevasFirmas = new Set([...nuevas.values()].map((b) =>
      `${ambitoFirma(fase, b.roundKey)}|${firmaAsalto(b.aName, b.scoreA, b.bName, b.scoreB)}`));
    const nuevasPorAmbito = new Map<string, AsaltoHecho[]>();
    for (const b of nuevas.values()) {
      const a = ambitoFirma(fase, b.roundKey);
      nuevasPorAmbito.set(a, [...(nuevasPorAmbito.get(a) ?? []), b]);
    }
    for (const [k, p] of porClave) {
      if (nuevas.has(k)) continue;
      const ambito = ambitoFirma(fase, p.round_key);
      const exacta = nuevasFirmas.has(`${ambito}|${firmaAsalto(p.fencer_a_name, p.score_a, p.fencer_b_name, p.score_b)}`);
      const otraLectura = !exacta && (nuevasPorAmbito.get(ambito) ?? []).some((b) => mismoAsaltoOtraLectura(p, b));
      if (exacta || otraLectura) borrar.push(p.id);
    }
  }
  borradas = borrar.length;
  sentencias.push(...borrarPorId('sport_bout', borrar));
  const insertadas = inserciones.length;
  return { modo, previas: previas.length, finales: previas.length - borradas + insertadas, sentencias };
}

export async function planCobertura(
  base: BaseResultados, source: string, season: string, kind: string, clave: string, competitionId: string | null,
  estado: (previo: string | null) => string, publicado: number | null, importadas: number, url: string, t: number,
  uuid: () => string,
): Promise<{ estado: string; sentencias: Sentencia[] }> {
  const [previa] = await base.leer<{ id: string; status: string; published_total: number | null; imported_total: number;
    competition_id: string | null }>(
    `select id, status, published_total, imported_total, competition_id from sport_import_coverage
      where source=? and season=? and fact_kind=? and competition_key=?`, [source, season, kind, clave]);
  if (!previa) {
    const st = estado(null);
    return {
      estado: st,
      sentencias: [{
        sql: `insert into sport_import_coverage (id, source, season, fact_kind, competition_key, competition_id, status,
          published_total, imported_total, attempts, source_url, last_checked_at, updated_at) values (?,?,?,?,?,?,?,?,?,1,?,?,?)`,
        params: [uuid(), source, season, kind, clave, competitionId, st, publicado, importadas, url, t, t],
        filas: 1,
      }],
    };
  }
  // 'conflicto' is a human-review marker (backfill/plan.ts skips it); an automatic pass never clears it.
  const status = previa.status === 'conflicto' ? 'conflicto' : estado(previa.status);
  const pub = publicado ?? previa.published_total;
  const cid = competitionId ?? previa.competition_id;
  if (status === previa.status && pub === previa.published_total && importadas === Number(previa.imported_total) &&
    cid === previa.competition_id) return { estado: status, sentencias: [] };
  return {
    estado: status,
    sentencias: [{
      sql: `update sport_import_coverage set status=?, published_total=?, imported_total=?, competition_id=?,
        attempts=max(attempts,1), last_checked_at=?, updated_at=?,
        last_error=case when ?='completo' then null else last_error end where id=?`,
      params: [status, pub, importadas, cid, t, t, status, previa.id],
      filas: 1,
    }],
  };
}

/**
 * Cobertura `pdf` por documento (`doc:<fichero>`), como `coberturaDocumentos` del lote: se
 * calcula DESPUÉS de escribir las pruebas del documento, con lo que queda en la base.
 */
export async function planCoberturaDocumento(
  base: BaseResultados, edicionId: string, season: string, url: string, t: number, uuid: () => string,
): Promise<Sentencia[]> {
  const fichero = /\/([^/?#]+?)(\.pdf)?(?:[?#].*)?$/i.exec(url)?.[1];
  if (!fichero) return [];
  const comps = await base.leer<{ id: string; source: string; season: string; competition_key: string }>(
    `select id, source, season, competition_key from sport_competition where edition_id=?`, [edicionId]);
  const estados: (string | null)[] = [];
  let importadas = 0;
  for (const c of comps) {
    if (c.source === 'rfee_pdf') {
      const [f] = await base.leer<{ status: string }>(
        `select status from sport_import_coverage where source='rfee_pdf' and fact_kind='results' and season=? and competition_key=?`,
        [c.season, c.competition_key]);
      estados.push(f?.status ?? null);
    }
    const [n] = await base.leer<{ n: number }>(
      `select (select count(*) from sport_result where competition_id=? and source=?) +
              (select count(*) from sport_bout where competition_id=? and source=?) n`, [c.id, c.source, c.id, c.source]);
    importadas += Number(n?.n ?? 0);
  }
  const doc = estadosDocumento(estados);
  return (await planCobertura(base, 'rfee_pdf', season, 'pdf', `doc:${fichero}`, null,
    (previo) => mejorEstado(previo, doc), null, importadas, url, t, uuid)).sentencias;
}
