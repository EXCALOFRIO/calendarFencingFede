import { fieCountryToIso2 } from './mappers';
import { claveNombre, cargoFila, uuidDeClave } from './ranking-skermo-historico';
import { lit } from './rankings-internacionales/sql';

/**
 * Relevos de las pruebas por equipos: enlace de cada tirador con una persona
 * y sentencias de carga en `sport_team_match` / `sport_relay` (migración 0010).
 *
 * Entrada: los JSON de `calendario-trabajo/relevos/<fuente>/` (esquema v1 en
 * su ESQUEMA.md). La fuente no publica identificadores de tirador, así que el
 * enlace es SIEMPRE dentro de la prueba:
 *
 * 1. Componentes del equipo guardados en la propia prueba de equipos
 *    (`sport_result` con persona): mismo nombre y un único candidato.
 * 2. Si no, personas con resultado individual en el mismo torneo (edición),
 *    arma y género, con el mismo nombre y del mismo club o país que el
 *    equipo (en una selección, el país del equipo basta si la persona no
 *    publica ninguno). Sólo con un único candidato.
 * 3. Si el torneo no da ningún candidato por nombre: personas con resultado
 *    individual en la misma temporada o la anterior, mismo arma y género,
 *    del mismo club (o país, en una selección) y nombre completo idéntico;
 *    con el nombre incompleto, sólo si sus apellidos son de una única
 *    persona de ese club en esas temporadas.
 *
 * Nunca se busca por nombre en toda la base. Lo que no se enlaza queda con
 * la persona a `NULL` y su motivo va al informe.
 */

export type MarcadorJson = { a: number; b: number };
export type RelevoJson = {
  n: number;
  fencerA: { name: string | null; team: string | null };
  fencerB: { name: string | null; team: string | null };
  before: MarcadorJson;
  after: MarcadorJson;
  touches: MarcadorJson;
  consistent: boolean;
};
export type EncuentroJson = {
  phase: 'TABLEAU' | 'POULE';
  anchor: string;
  tableId?: string;
  matchNumber?: number;
  roundKey: string | null;
  roundLabel: string | null;
  teamA: { name: string; ref: string | null };
  teamB: { name: string; ref: string | null };
  finalScore: MarcadorJson;
  relays: RelevoJson[];
  consistent: boolean;
  sourceUrl: string | null;
};
export type PruebaRelevosJson = {
  schemaVersion: 1;
  source: string;
  season: string;
  competitionKey: string;
  tournamentKey: string;
  edition?: string;
  weapon?: string;
  gender?: string;
  category?: string;
  date?: string;
  matches: EncuentroJson[];
};

/** Persona candidata dentro de la prueba, ya canónica (fusiones seguidas). */
export type CandidatoRelevo = {
  personId: string;
  nombres: readonly string[];
  clubes: readonly string[];
  paises: readonly string[];
};

/** Equipo tal como está en la clasificación de la prueba (`sport_result`). */
export type EquipoPrueba = { nombre: string; club: string | null; pais: string | null };

export type ContextoEnlace = {
  /** Equipos de la clasificación por `source_fact_key`. */
  equiposPorRef: ReadonlyMap<string, EquipoPrueba>;
  /** Componentes guardados en la propia prueba de equipos (hoy casi nunca hay). */
  componentes: readonly CandidatoRelevo[];
  /** Resultados individuales del mismo torneo, arma y género. */
  torneo: readonly CandidatoRelevo[];
  /**
   * Segundo nivel: resultados individuales de la misma temporada o la
   * anterior (`temporadasVecinas`), mismo arma y género. Sólo se mira si el
   * torneo no da ningún candidato por nombre.
   */
  temporada?: readonly CandidatoRelevo[];
};

export type ViaEnlace = 'componente' | 'club' | 'pais';
/** De dónde sale la persona: componentes del equipo, el mismo torneo o la temporada. */
export type NivelEnlace = 'componente' | 'torneo' | 'temporada';
export type MotivoSinEnlace =
  | 'sin_nombre'
  | 'sin_candidato'
  | 'sin_club_ni_pais'
  | 'club_distinto'
  | 'ambiguo'
  | 'apellido_repetido'
  | 'persona_repetida'
  | 'mismo_tirador';

export type Enlace = { personId: string; via: ViaEnlace; nivel: NivelEnlace } | { personId: null; motivo: MotivoSinEnlace };

/** Mayúsculas sin acentos ni signos: «SAES-BU» → «SAESBU». */
export function claveEquipo(texto: string | null | undefined): string {
  return (texto ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

const MIN_CLAVE_CLUB = 3;

/** Selecciones que Engarde publica con el nombre del país (inglés, español o catalán). */
const PAISES: Record<string, string> = {
  SPAIN: 'ESP', ESPANA: 'ESP', ESPANYA: 'ESP', ITALY: 'ITA', ITALIA: 'ITA', FRANCE: 'FRA', FRANCIA: 'FRA', FRANCA: 'FRA',
  GERMANY: 'GER', ALEMANIA: 'GER', ALEMANYA: 'GER', HUNGARY: 'HUN', HUNGRIA: 'HUN', POLAND: 'POL', POLONIA: 'POL',
  JAPAN: 'JPN', JAPON: 'JPN', JAPO: 'JPN', CHINA: 'CHN', XINA: 'CHN', SWITZERLAND: 'SUI', SUIZA: 'SUI', SUISSA: 'SUI',
  GREATBRITAIN: 'GBR', GRANBRETANA: 'GBR', GRANBRETANYA: 'GBR', UKRAINE: 'UKR', UCRANIA: 'UKR', UCRAINA: 'UKR',
  SWEDEN: 'SWE', SUECIA: 'SWE', NETHERLANDS: 'NED', PAISESBAJOS: 'NED', HOLANDA: 'NED', PORTUGAL: 'POR',
  USA: 'USA', ESTADOSUNIDOS: 'USA', ISRAEL: 'ISR', ROMANIA: 'ROU', RUMANIA: 'ROU', AUSTRIA: 'AUT', BELGIUM: 'BEL',
  BELGICA: 'BEL', RUSSIA: 'RUS', RUSIA: 'RUS', KOREA: 'KOR', COREA: 'KOR', CANADA: 'CAN', MEXICO: 'MEX', ARGENTINA: 'ARG',
  ANDORRA: 'AND', IRELAND: 'IRL', IRLANDA: 'IRL', CZECHREPUBLIC: 'CZE', CHEQUIA: 'CZE', DENMARK: 'DEN', DINAMARCA: 'DEN',
  NORWAY: 'NOR', NORUEGA: 'NOR', FINLAND: 'FIN', FINLANDIA: 'FIN', GREECE: 'GRE', GRECIA: 'GRE', TURKEY: 'TUR', TURQUIA: 'TUR',
};
const VACIAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'I', 'D', 'L']);

function palabras(texto: string | null | undefined): string[] {
  return (texto ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().match(/[A-Z0-9]+/g) ?? [];
}

/**
 * Formas de escribir el club de un equipo: la clave entera, sin el número o
 * la letra de equipo del final («SAM-1» → «SAM», «SEA3» → «SEA»), el primer
 * segmento («CEB_1-M» → «CEB») y las iniciales («GUARDIA CIVIL 2» → «GC»).
 */
function primerCodigo(ps: readonly string[]): string {
  // «SAM-1», «CEB_1-M», «SASLE 2»: un código y sufijos cortos. «GUARDIA CIVIL» no es un código.
  return ps.length > 0 && ps.slice(1).every((p) => p.length <= 2) ? ps[0] : '';
}

function formasEquipo(texto: string | null | undefined): { claves: string[]; cortas: string[] } {
  const clave = claveEquipo(texto);
  const ps = palabras(texto);
  const significativas = ps.filter((p) => !VACIAS.has(p) && !/^\d+$/.test(p));
  const iniciales = significativas.length >= 2 ? significativas.map((p) => p[0]).join('') : '';
  const base = clave.replace(/\d+$/, '');
  return {
    claves: [clave, base].filter((k) => k.length >= MIN_CLAVE_CLUB),
    cortas: [primerCodigo(ps), base, iniciales].filter((k) => k.length >= 2),
  };
}

/**
 * ¿El candidato es del club o del país del equipo? `null` si el candidato no
 * tiene ni club ni país publicados (no se puede comprobar).
 *
 * Club: la clave de uno contiene la del otro («SAE-M» y «SAE», «SAESBU ORO» y
 * «SAES-BU»), con al menos tres letras para que «CE» no case con todo; o el
 * primer segmento del club es el del equipo, su base sin número o sus
 * iniciales («SAM-B» y «SAM-1», «ET» y «EJÉRCITO DE TIERRA 3»).
 * País: el código del candidato es el del equipo o una palabra de su nombre
 * («ESP», «ITA 2»).
 */
export function mismoClubOPais(equipo: EquipoPrueba, c: Pick<CandidatoRelevo, 'clubes' | 'paises'>): boolean | null {
  if (c.clubes.length === 0 && c.paises.length === 0) return null;
  if (clubDelEquipo(equipo)(c.clubes)) return true;
  const delNombre = new Set(palabras(equipo.nombre));
  const seleccion = paisDeEquipo(equipo);
  if (seleccion) delNombre.add(seleccion);
  const paisEquipo = equipo.pais?.toUpperCase() ?? null;
  for (const pais of c.paises.map((p) => p.toUpperCase())) {
    if (pais === paisEquipo || delNombre.has(pais)) return true;
  }
  return false;
}

/** ¿Alguno de estos clubes es el del equipo? Las formas del equipo se calculan una vez. */
function clubDelEquipo(equipo: EquipoPrueba): (clubes: readonly string[]) => boolean {
  const formas = [formasEquipo(equipo.nombre), formasEquipo(equipo.club)];
  const claves = formas.flatMap((f) => f.claves);
  const cortas = new Set(formas.flatMap((f) => f.cortas));
  return (clubes) => clubes.some((club) => {
    const k = claveEquipo(club);
    if (k.length >= MIN_CLAVE_CLUB && claves.some((e) => e.includes(k) || k.includes(e))) return true;
    const primero = primerCodigo(palabras(club));
    return (primero.length >= 2 && cortas.has(primero)) || (k.length >= 2 && cortas.has(k));
  });
}

const CODIGOS_PAIS = new Set(Object.values(PAISES));

/**
 * País de una selección: el publicado en la clasificación, el nombre del país
 * («GERMANY 1», «JAPAN A», «HUNGRIA») o su código («ITA 2»). `null` si el
 * equipo es un club.
 */
export function paisDeEquipo(equipo: EquipoPrueba): string | null {
  // Algunas clasificaciones guardan el código del club como país («SAM», «EHB»): sólo vale un código de país real.
  const publicado = equipo.pais?.trim().toUpperCase() ?? '';
  if (publicado.length === 3 && fieCountryToIso2(publicado)) return publicado;
  const ps = palabras(equipo.nombre);
  while (ps.length > 1 && /^(\d+|[A-Z])$/.test(ps[ps.length - 1])) ps.pop();
  const junto = ps.join('');
  return PAISES[junto] ?? (CODIGOS_PAIS.has(junto) ? junto : null);
}

/**
 * Temporadas del segundo nivel: la misma y la anterior, en los dos formatos
 * de la base (RFEE `2016-2017`, FIE `2017` para la misma temporada).
 */
export function temporadasVecinas(temporada: string): string[] {
  const doble = /^(\d{4})-(\d{4})$/.exec(temporada);
  const fin = doble ? Number(doble[2]) : /^\d{4}$/.test(temporada) ? Number(temporada) : null;
  if (fin === null) return [temporada];
  return [`${fin - 1}-${fin}`, `${fin - 2}-${fin - 1}`, String(fin), String(fin - 1)];
}

/**
 * Apellidos tal como publica Engarde («APELLIDOS Nombre»): las palabras en
 * mayúsculas del principio. `null` si no se distinguen del nombre.
 */
export function apellidosDe(nombre: string): string[] | null {
  const ps = nombre.trim().split(/\s+/);
  const mayus = (p: string) => /\p{L}/u.test(p) && p === p.toUpperCase();
  let i = 0;
  while (i < ps.length && mayus(ps[i])) i += 1;
  if (i === 0 || i === ps.length) return null;
  // En orden, no como `claveNombre`: el primer apellido va primero.
  const apellidos = ps.slice(0, i).join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-zñç]+/u).filter(Boolean);
  return apellidos.length ? apellidos : null;
}

const casaNombre = (c: CandidatoRelevo, clave: string) => c.nombres.some((n) => claveNombre(n) === clave);

/**
 * Nombre incompleto en uno de los dos lados («ANDREU Marc» y «ANDREU ALMASA
 * Marc»): todas las palabras del más corto, al menos dos, están en el otro.
 */
function contieneNombre(c: CandidatoRelevo, clave: string): boolean {
  const mias = clave.split(' ');
  return c.nombres.some((n) => {
    const suyas = claveNombre(n).split(' ').filter(Boolean);
    const [corto, largo] = mias.length <= suyas.length ? [mias, suyas] : [suyas, mias];
    return corto.length >= 2 && corto.length < largo.length && corto.every((p) => largo.includes(p));
  });
}

function unicos(cs: readonly CandidatoRelevo[]): CandidatoRelevo[] {
  const porId = new Map<string, CandidatoRelevo>();
  for (const c of cs) {
    const previo = porId.get(c.personId);
    porId.set(c.personId, previo
      ? { personId: c.personId, nombres: [...previo.nombres, ...c.nombres], clubes: [...previo.clubes, ...c.clubes], paises: [...previo.paises, ...c.paises] }
      : c);
  }
  return [...porId.values()];
}

/** Un tirador de un equipo, sin mirar los demás relevos. */
export function enlazarTirador(nombre: string | null, equipo: EquipoPrueba, ctx: ContextoEnlace): Enlace {
  const clave = nombre ? claveNombre(nombre) : '';
  if (!clave) return { personId: null, motivo: 'sin_nombre' };
  const componentes = unicos(ctx.componentes.filter((c) => casaNombre(c, clave)));
  if (componentes.length === 1) return { personId: componentes[0].personId, via: 'componente', nivel: 'componente' };
  if (componentes.length > 1) return { personId: null, motivo: 'ambiguo' };

  const torneo = enTorneo(clave, equipo, ctx.torneo);
  if (torneo.personId !== null || torneo.motivo !== 'sin_candidato' || !ctx.temporada) return torneo;
  return enTemporada(nombre!, clave, equipo, ctx.temporada);
}

function enTorneo(clave: string, equipo: EquipoPrueba, torneo: readonly CandidatoRelevo[]): Enlace {
  let porNombre = unicos(torneo.filter((c) => casaNombre(c, clave)));
  if (porNombre.length === 0) porNombre = unicos(torneo.filter((c) => contieneNombre(c, clave)));
  if (porNombre.length === 0) return { personId: null, motivo: 'sin_candidato' };
  const seleccion = paisDeEquipo(equipo);
  const juicios = porNombre.map((c) => ({
    c,
    // En una selección el país es el del equipo aunque el tirador no lo publique en la individual.
    mismo: seleccion && c.paises.length === 0 && c.clubes.length === 0 ? true : mismoClubOPais(equipo, c),
  }));
  const compatibles = juicios.filter((j) => j.mismo === true);
  if (compatibles.length > 1) return { personId: null, motivo: 'ambiguo' };
  if (compatibles.length === 1) {
    const c = compatibles[0].c;
    const porClub = mismoClubOPais(equipo, { clubes: c.clubes, paises: [] }) === true;
    return { personId: c.personId, via: porClub ? 'club' : 'pais', nivel: 'torneo' };
  }
  return { personId: null, motivo: juicios.every((j) => j.mismo === null) ? 'sin_club_ni_pais' : 'club_distinto' };
}

type IndiceTemporada = {
  porClave: Map<string, CandidatoRelevo[]>;
  porEquipo: Map<string, CandidatoRelevo[]>;
  personas: CandidatoRelevo[];
};
const INDICES = new WeakMap<readonly CandidatoRelevo[], IndiceTemporada>();

function indiceTemporada(pool: readonly CandidatoRelevo[]): IndiceTemporada {
  let indice = INDICES.get(pool);
  if (!indice) {
    const porClave = new Map<string, CandidatoRelevo[]>();
    for (const c of pool) {
      for (const k of new Set(c.nombres.map(claveNombre))) porClave.set(k, [...(porClave.get(k) ?? []), c]);
    }
    indice = { porClave, porEquipo: new Map(), personas: unicos(pool) };
    INDICES.set(pool, indice);
  }
  return indice;
}

/**
 * Del mismo club que el equipo o, en una selección, del mismo país. Sin la
 * comprobación del torneo, aquí no vale «no publica club»: hace falta que case.
 */
function deEquipo(equipo: EquipoPrueba, seleccion: string | null) {
  const club = clubDelEquipo(equipo);
  return (c: CandidatoRelevo) => (seleccion ? c.paises.some((p) => p.toUpperCase() === seleccion) : club(c.clubes));
}

/**
 * Segundo nivel, sólo si el torneo no da ningún candidato: personas con
 * resultado individual en la temporada (o la anterior), mismo arma y género,
 * del mismo club o país, con el nombre completo idéntico. Con el nombre
 * incompleto en un lado sólo vale si sus apellidos son de una única persona
 * de ese club en esas temporadas: dos hermanos no se distinguen así.
 */
function enTemporada(nombre: string, clave: string, equipo: EquipoPrueba, pool: readonly CandidatoRelevo[]): Enlace {
  const seleccion = paisDeEquipo(equipo);
  const via: ViaEnlace = seleccion ? 'pais' : 'club';
  const casa = deEquipo(equipo, seleccion);
  const indice = indiceTemporada(pool);
  const exactos = unicos(indice.porClave.get(clave) ?? []).filter(casa);
  if (exactos.length === 1) return { personId: exactos[0].personId, via, nivel: 'temporada' };
  if (exactos.length > 1) return { personId: null, motivo: 'ambiguo' };

  const claveEq = `${seleccion ?? ''}|${claveEquipo(equipo.nombre)}|${claveEquipo(equipo.club)}`;
  let delEquipo = indice.porEquipo.get(claveEq);
  if (!delEquipo) {
    delEquipo = indice.personas.filter(casa);
    indice.porEquipo.set(claveEq, delEquipo);
  }
  const parciales = delEquipo.filter((c) => contieneNombre(c, clave));
  if (parciales.length === 0) return { personId: null, motivo: 'sin_candidato' };
  if (parciales.length > 1) return { personId: null, motivo: 'ambiguo' };
  const apellidos = apellidosDe(nombre);
  if (!apellidos) return { personId: null, motivo: 'apellido_repetido' };
  // Apellidos compatibles: los de uno empiezan por los del otro («DOCAVO» y «DOCAVO GARCIA»).
  const conApellidos = delEquipo.filter((c) => c.nombres.some((n) => {
    const suyos = apellidosDe(n);
    if (!suyos) return false;
    const [corto, largo] = suyos.length <= apellidos.length ? [suyos, apellidos] : [apellidos, suyos];
    return corto.every((a, i) => largo[i] === a);
  }));
  if (conApellidos.length !== 1 || conApellidos[0].personId !== parciales[0].personId) {
    return { personId: null, motivo: 'apellido_repetido' };
  }
  return { personId: parciales[0].personId, via, nivel: 'temporada' };
}

export type RelevoEnlazado = { a: Enlace; b: Enlace };

/**
 * Enlaces de todos los relevos de una prueba. Cada (equipo, nombre) se decide
 * una vez. Si una persona sale para dos tiradores distintos de la prueba, o
 * para los dos lados de un relevo, ninguno se enlaza: una de las dos lecturas
 * está mal y no se sabe cuál.
 */
export function enlazarPrueba(prueba: Pick<PruebaRelevosJson, 'matches'>, ctx: ContextoEnlace): RelevoEnlazado[][] {
  const decididos = new Map<string, Enlace>();
  const equipoDe = (e: { name: string; ref: string | null }): EquipoPrueba =>
    (e.ref ? ctx.equiposPorRef.get(e.ref) : undefined) ?? { nombre: e.name, club: null, pais: null };
  const claveTirador = (equipo: string, nombre: string | null) => `${claveEquipo(equipo)}|${nombre ? claveNombre(nombre) : ''}`;
  const decidir = (nombre: string | null, equipo: { name: string; ref: string | null }) => {
    const k = claveTirador(equipo.name, nombre);
    let e = decididos.get(k);
    if (!e) {
      e = enlazarTirador(nombre, equipoDe(equipo), ctx);
      decididos.set(k, e);
    }
    return k;
  };
  const claves = prueba.matches.map((m) => m.relays.map((r) => ({ a: decidir(r.fencerA.name, m.teamA), b: decidir(r.fencerB.name, m.teamB) })));

  const tiradoresDe = new Map<string, Set<string>>();
  for (const [k, e] of decididos) {
    if (e.personId) tiradoresDe.set(e.personId, (tiradoresDe.get(e.personId) ?? new Set()).add(k));
  }
  for (const [k, e] of decididos) {
    if (e.personId && tiradoresDe.get(e.personId)!.size > 1) decididos.set(k, { personId: null, motivo: 'persona_repetida' });
  }
  return claves.map((rs) => rs.map(({ a, b }) => {
    const ea = decididos.get(a)!;
    const eb = decididos.get(b)!;
    if (ea.personId && ea.personId === eb.personId) {
      return { a: { personId: null, motivo: 'mismo_tirador' }, b: { personId: null, motivo: 'mismo_tirador' } };
    }
    return { a: ea, b: eb };
  }));
}

export type PruebaResuelta = { fichero: string; competitionKey: string; competitionId: string; relevos: number };

/**
 * Dos JSON que resuelven a la misma `sport_competition` (respaldo por clave
 * sola, o dos pruebas fundidas) chocarían en el índice único
 * (competition_id, source, source_key), que `ON CONFLICT(id)` no cubre, y el
 * fichero entero abortaría. Se queda una por prueba: la de más relevos y, a
 * igualdad, la de clave menor (y fichero menor). `descartadas` dice cuál
 * se quedó en su lugar.
 */
export function unaPorCompeticion(pruebas: readonly PruebaResuelta[]): {
  elegidas: Set<string>;
  descartadas: Map<string, PruebaResuelta>;
} {
  const mejor = new Map<string, PruebaResuelta>();
  const antes = (a: PruebaResuelta, b: PruebaResuelta) =>
    a.relevos !== b.relevos ? a.relevos > b.relevos
      : a.competitionKey !== b.competitionKey ? a.competitionKey < b.competitionKey
        : a.fichero < b.fichero;
  for (const p of pruebas) {
    const actual = mejor.get(p.competitionId);
    if (!actual || antes(p, actual)) mejor.set(p.competitionId, p);
  }
  const elegidas = new Set([...mejor.values()].map((p) => p.fichero));
  const descartadas = new Map(pruebas.filter((p) => !elegidas.has(p.fichero)).map((p) => [p.fichero, mejor.get(p.competitionId)!]));
  return { elegidas, descartadas };
}

// ------------------------------------------------------------------- SQL ---

export function idEncuentro(p: Pick<PruebaRelevosJson, 'source' | 'season' | 'competitionKey'>, anchor: string): string {
  return uuidDeClave(['sport_team_match', p.source, p.season, p.competitionKey, anchor].join('|'));
}

export function idRelevo(encuentroId: string, n: number): string {
  return uuidDeClave(`sport_relay|${encuentroId}|${n}`);
}

const FILAS_POR_INSERT = 80;
const bit = (v: boolean) => (v ? 1 : 0);

const COLUMNAS_ENCUENTRO = ['id', 'competition_id', 'source', 'source_key', 'phase', 'round_key', 'round_label', 'team_a_name',
  'team_b_name', 'team_a_ref', 'team_b_ref', 'score_a', 'score_b', 'consistent', 'source_url'] as const;
const COLUMNAS_RELEVO = ['id', 'match_id', 'relay_number', 'fencer_a_name', 'fencer_b_name', 'fencer_a_person_id', 'fencer_b_person_id',
  'touches_a', 'touches_b', 'before_a', 'before_b', 'after_a', 'after_b', 'consistent'] as const;

/**
 * Una nueva generación (p. ej. con más personas enlazadas tras otro lote)
 * reescribe las columnas que cambian; si nada cambia la fila no se toca y no
 * se carga capacidad.
 */
function upsert(tabla: string, columnas: readonly string[], fijas: readonly string[]): string {
  const cambian = columnas.filter((c) => !fijas.includes(c));
  return `ON CONFLICT(id) DO UPDATE SET ${cambian.map((c) => `${c}=excluded.${c}`).join(',')} ` +
    `WHERE ${cambian.map((c) => `${tabla}.${c} IS NOT excluded.${c}`).join(' OR ')}`;
}

export type SqlPrueba = { sentencias: string[]; cargo: number; encuentros: number; relevos: number };

/**
 * Sentencias idempotentes de una prueba, para ir dentro de un fichero con
 * lease y contexto de capacidad (`componerChunk`). Sólo entran si la prueba
 * sigue existiendo. `cargo` acota por arriba lo que cobran los triggers (una
 * actualización cobra sólo las columnas que cambian).
 */
export function sentenciasPrueba(
  prueba: PruebaRelevosJson,
  competitionId: string,
  enlaces: readonly RelevoEnlazado[][],
): SqlPrueba {
  const existe = `WHERE EXISTS (SELECT 1 FROM sport_competition WHERE id=${lit(competitionId)})`;
  const encuentros: (string | number | null)[][] = [];
  const relevos: (string | number | null)[][] = [];
  prueba.matches.forEach((m, i) => {
    const id = idEncuentro(prueba, m.anchor);
    encuentros.push([id, competitionId, prueba.source, m.anchor, m.phase, m.roundKey, m.roundLabel || null, m.teamA.name, m.teamB.name,
      m.teamA.ref, m.teamB.ref, m.finalScore.a, m.finalScore.b, bit(m.consistent), m.sourceUrl || null]);
    m.relays.forEach((r, j) => {
      const e = enlaces[i]?.[j];
      relevos.push([idRelevo(id, r.n), id, r.n, r.fencerA.name || null, r.fencerB.name || null, e?.a.personId ?? null, e?.b.personId ?? null,
        r.touches.a, r.touches.b, r.before.a, r.before.b, r.after.a, r.after.b, bit(r.consistent)]);
    });
  });
  const sentencias: string[] = [];
  let cargo = 0;
  const insertar = (tabla: string, columnas: readonly string[], fijas: readonly string[], filas: (string | number | null)[][]) => {
    for (let i = 0; i < filas.length; i += FILAS_POR_INSERT) {
      const lote = filas.slice(i, i + FILAS_POR_INSERT);
      for (const f of lote) cargo += cargoFila(f);
      sentencias.push(`INSERT INTO ${tabla}(${columnas.join(',')}) SELECT * FROM (VALUES ${lote.map((f) => `(${f.map(lit).join(',')})`).join(',')}) ` +
        `${existe} ${upsert(tabla, columnas, fijas)}`);
    }
  };
  insertar('sport_team_match', COLUMNAS_ENCUENTRO, ['id', 'source', 'source_key'], encuentros);
  insertar('sport_relay', COLUMNAS_RELEVO, ['id', 'match_id', 'relay_number'], relevos);
  return { sentencias, cargo, encuentros: encuentros.length, relevos: relevos.length };
}
