import type { CategoryCode } from '../categories';
import { ciudadCanonica } from '@/lib/calendario/ciudades';
import { nombrePrueba } from '@/lib/sport/explorar/presentacion';
import { clasificarCompeticion, plegarNombre } from '@/lib/sport/explorar/tipo-competicion';
import type { TipoCompeticion } from '@/lib/sport/explorar/tipos-social';
import { organismoDe } from '@/lib/utils';
import type { CompetitionView, EventView, Gender, Weapon } from './calendar';

/**
 * ===========================================================================
 * EL CALENDARIO HACIA ATRÁS: LO QUE YA SE TIRÓ, CRUZADO CON SUS RESULTADOS
 * ===========================================================================
 *
 * El calendario solo cargaba de hoy en adelante (`listEvents` filtra
 * `end_date >= hoy` salvo que se pida otra cosa), así que en cuanto pasaba un
 * mes se vaciaba: el 5 de octubre, septiembre de 2026 decía «Sin competiciones
 * cargadas» teniendo en la base 72 torneos nacionales e internacionales de ese
 * mes. Y los años anteriores no han estado nunca en las tablas del calendario
 * —empiezan en 2026—, pero sí en las de Explorar: `sport_edition` y
 * `sport_competition` traen la FIE desde los años cincuenta y la RFEE desde
 * 2018, con sus clasificaciones.
 *
 * Este módulo junta las dos cosas en un tramo de fechas ya pasado:
 *
 *  1. Los torneos del calendario que ya acabaron, con las pruebas de Explorar
 *     que son ellos (`cruces`, que vienen de una consulta por claves exactas).
 *  2. Las pruebas de Explorar que no son ningún torneo del calendario,
 *     agrupadas en torneos de solo lectura que enlazan a sus resultados.
 *
 * Todo lo de aquí es una función normal, sin base ni sesión, y se prueba en
 * `tests/calendario-pasado.test.ts`. La consulta vive en
 * `calendario-pasado.ts`.
 */

/** Una prueba de Explorar, ya resumida para el calendario. */
export type PruebaPasada = {
  /** `sport_competition.id`: lo que pide la clasificación de la edición. */
  id: string;
  edicionId: string;
  fuente: string;
  arma: Weapon;
  genero: Gender;
  categoria: string;
  /** Lo que escribió la fuente; en veteranos distingue «+40» de «+60». */
  categoriaRaw: string | null;
  formato: 'INDIVIDUAL' | 'EQUIPOS';
  fecha: string | null;
  /** Hay al menos un puesto importado. Sin él, «Resultados» no promete nada. */
  conResultados: boolean;
  /** Quien quedó primero según la fuente; `null` si no se publicó puesto 1. */
  ganador: { nombre: string; pais: string | null } | null;
  /** La página oficial de la prueba (o de su edición) en la fuente. */
  urlOficial: string | null;
};

/**
 * Lo que sale de la base para cada prueba de Explorar. `ganador` llega como
 * `nombre␟país` para no pagar dos subconsultas por fila.
 */
export type FilaPruebaImportada = {
  id: string;
  edicionId: string;
  fuente: string;
  /** `2027` en la FIE, `2018-2019` en la RFEE. */
  temporada?: string | null;
  arma: string;
  genero: string;
  categoria: string;
  categoriaRaw?: string | null;
  formato: string;
  fecha: string | null;
  url: string | null;
  edicion: string;
  inicio: string | null;
  fin: string | null;
  ciudad: string | null;
  pais: string | null;
  urlEdicion: string | null;
  conResultados: number | boolean | null;
  ganador: string | null;
};

/** Una prueba de Explorar atada a un torneo del calendario por una clave exacta. */
export type FilaCruce = FilaPruebaImportada & { evento: string };

export type TramoPasado = {
  /** Primer y último día pedidos, los dos incluidos. */
  desde: string;
  hasta: string;
  /** `false` = la base no tiene las tablas de Explorar; solo hay calendario. */
  disponible: boolean;
  /** Torneos del calendario ya acabados y los de solo lectura de Explorar. */
  eventos: EventView[];
  /** Ids de `eventos` que no son del calendario: se abren en Explorar. */
  importados: string[];
  /**
   * Pruebas de Explorar de cada torneo, por id. Un torneo del calendario sin
   * nada cruzado lleva la lista vacía, que es distinto de no saberlo aún.
   */
  resultados: Record<string, PruebaPasada[]>;
};

export const SEPARADOR_GANADOR = '\u001f';

/**
 * Fuentes de Explorar que entran en el calendario: la FIE, la EFC y la RFEE
 * (Skermo, sus PDF y los torneos nacionales que sólo están en Engarde, que son
 * casi todo lo de 2009 a 2019).
 */
export const FUENTES_IMPORTADAS = ['fie', 'efc', 'skermo_rfee', 'rfee_pdf', 'engarde'] as const;

/**
 * Cuando dos fuentes publican la misma prueba se queda la primera: Skermo trae
 * sede y clave estable; el PDF de la RFEE y Engarde, solo la clasificación.
 */
const PRIORIDAD_FUENTE: Record<string, number> = { skermo_rfee: 0, fie: 1, efc: 1, rfee_pdf: 2, engarde: 3 };

/** Fuentes nacionales que sólo cuentan si Skermo no trae ya esa prueba ese día. */
const FUENTES_SECUNDARIAS: readonly string[] = ['rfee_pdf', 'engarde'];

type Familia = 'INT' | 'NAC';

function familiaDeFuente(fuente: string): Familia {
  return fuente === 'fie' || fuente === 'efc' ? 'INT' : 'NAC';
}

function familiaDeEvento(e: EventView): Familia {
  const o = organismoDe(e.source, e.scope, e.circuit);
  return o === 'FIE' || o === 'EFC' ? 'INT' : 'NAC';
}

const ARMAS: readonly string[] = ['FLORETE', 'ESPADA', 'SABLE'];
const GENEROS: readonly string[] = ['M', 'F', 'MIXTO'];

/**
 * La FIE copia en la temporada siguiente pruebas aún sin sede con las fechas
 * de la anterior (temporada 2027 fechada en febrero de 2026, sede «TBD»). La
 * temporada N va del 1 de agosto de N−1 al 31 de julio de N: una fecha
 * anterior a ese arranque es un hueco reservado, no una prueba celebrada.
 * Misma regla que `esMarcadorFie` de `scripts/indexado/fie-huecos-objetivos.ts`.
 */
export function esMarcadorFie(f: {
  fuente: string;
  temporada?: string | null;
  fecha: string | null;
  inicio?: string | null;
}): boolean {
  if (f.fuente !== 'fie') return false;
  const anio = Number(f.temporada);
  if (!Number.isInteger(anio) || anio < 1900) return false;
  const fecha = f.fecha ?? f.inicio;
  if (!fecha) return true;
  return fecha.slice(0, 10) < `${anio - 1}-08-01`;
}

/** Una fila con arma o género que el calendario no sabe pintar no entra. */
function esPintable(f: FilaPruebaImportada): boolean {
  return ARMAS.includes(f.arma) && GENEROS.includes(f.genero) && !esMarcadorFie(f);
}

export function aPruebaPasada(f: FilaPruebaImportada): PruebaPasada {
  const [nombre, pais] = f.ganador ? f.ganador.split(SEPARADOR_GANADOR) : [];
  return {
    id: f.id,
    edicionId: f.edicionId,
    fuente: f.fuente,
    arma: f.arma as Weapon,
    genero: f.genero as Gender,
    categoria: f.categoria,
    categoriaRaw: f.categoriaRaw ?? null,
    formato: f.formato === 'EQUIPOS' ? 'EQUIPOS' : 'INDIVIDUAL',
    fecha: f.fecha?.slice(0, 10) ?? null,
    conResultados: Boolean(Number(f.conResultados ?? 0)),
    ganador: nombre ? { nombre, pais: pais || null } : null,
    urlOficial: urlPublica(f.url ?? f.urlEdicion),
  };
}

/**
 * La importación de la FIE guarda la dirección de su API, que devuelve JSON.
 * La página que lee una persona es la misma ruta sin `/api/fie`: se enlaza esa.
 */
export function urlPublica(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^https:\/\/fie\.org\/api\/fie\/competition\//, 'https://fie.org/competitions/');
}

/** Arma, género, categoría y formato: lo que hace que dos pruebas sean «la misma». */
function claveDePrueba(p: {
  arma: string;
  genero: string;
  categoria: string;
  formato: string;
}): string {
  return `${p.arma}|${p.genero}|${p.categoria}|${p.formato}`;
}

/**
 * La ciudad, plegada, para comparar la de la FIE («Bogota», «Le Caire») con la
 * del calendario («BOGOTÁ»). Solo casa lo que se escribe igual sin acentos: un
 * «Gand» frente a «Gante» no se empareja, y es lo prudente.
 */
function ciudadPlegada(ciudad: string | null | undefined): string {
  return ciudad ? ciudadCanonica(plegarNombre(ciudad)) : '';
}

function ordenPruebas(a: PruebaPasada, b: PruebaPasada): number {
  return (
    (a.fecha ?? '9999').localeCompare(b.fecha ?? '9999') ||
    a.formato.localeCompare(b.formato) ||
    ARMAS.indexOf(a.arma) - ARMAS.indexOf(b.arma) ||
    a.genero.localeCompare(b.genero) ||
    a.categoria.localeCompare(b.categoria) ||
    (a.categoriaRaw ?? '').localeCompare(b.categoriaRaw ?? '') ||
    a.id.localeCompare(b.id)
  );
}

/** Mejor candidata primero: con resultados, de la fuente preferida y estable. */
function ordenCandidatas(a: FilaPruebaImportada, b: FilaPruebaImportada): number {
  return (
    Number(Boolean(Number(b.conResultados ?? 0))) - Number(Boolean(Number(a.conResultados ?? 0))) ||
    (PRIORIDAD_FUENTE[a.fuente] ?? 9) - (PRIORIDAD_FUENTE[b.fuente] ?? 9) ||
    a.id.localeCompare(b.id)
  );
}

const DIA = 86_400_000;
const msDe = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);

/**
 * El nombre de una edición sin lo que cambia entre sus pruebas: el «par
 * équipes», los «_equipos», la jornada «(1/3)» o la categoría repetida. Es la
 * clave con la que se juntan en un torneo las ediciones de la misma sede.
 *
 * Hace falta porque las dos fuentes publican **una edición por prueba**: la
 * Copa del Mundo de El Cairo de 2019 son cuatro ediciones de la FIE, y el TLM
 * de Madrid de noviembre de 2024 son veinticinco de Skermo. Pintadas una a una
 * serían veinticinco tarjetas iguales.
 */
export function baseDeNombre(nombre: string): string {
  const palabras = plegarNombre(nombre)
    .replace(/\bm (\d{2})\b/g, 'm$1')
    .replace(
      /\b(par|equipes?|equipos?|team|teams|individual|individuel|individuales?)\b/g,
      ' ',
    )
    .replace(/\b\d+ \d+\b/g, ' ')
    // «TNR ABS 1 Sable Masculino» es la prueba de sable del «TNR ABS» de ese día: el PDF
    // de la RFEE titula cada prueba y Skermo, el torneo.
    .replace(/\b(espada|florete|sable|masculin[oa]s?|femenin[oa]s?|mixt[oa]s?|\d)\b/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return [...new Set(palabras)].join(' ') || plegarNombre(nombre);
}

/** «TNR M20 M20» y «TNR M20_equipos» se leen como el torneo que son. */
function nombreLimpio(nombre: string): string {
  const palabras = nombre.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  return palabras
    .filter((p, i) => i === 0 || p.toLowerCase() !== palabras[i - 1].toLowerCase())
    .join(' ');
}

/** «TNR ABS 1 Sable Femenino Individual» → «TNR ABS»: la tarjeta junta varias pruebas. */
function tituloDeTorneo(nombre: string): string {
  const limpio = nombreLimpio(nombre)
    .replace(/\b(espada|florete|sable|masculin[oa]s?|femenin[oa]s?|mixt[oa]s?|individual(es)?|\d)\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio || nombreLimpio(nombre);
}

/** Tipo de competición de Explorar → circuito del calendario, para el color y la pastilla. */
function circuitoDe(tipo: TipoCompeticion, categorias: string[], nombre: string): string {
  const unica = categorias.length === 1 ? categorias[0] : null;
  switch (tipo) {
    case 'COPA_MUNDO':
      return unica === 'M17' ? 'CAD_WC' : unica === 'M20' ? 'JUN_WC' : 'SEN_WC';
    case 'GRAN_PREMIO':
      return 'SEN_GP';
    case 'SATELITE':
      return 'SATELITE';
    case 'CTO_MUNDO':
      return 'CTO_MUNDO';
    case 'CTO_EUROPA':
      return 'CTO_EUROPA';
    case 'CIRCUITO_EUROPEO':
      if (unica === 'M17') return 'ECC';
      if (unica === 'M14') return 'U14_EFC';
      if (unica === 'M23') return 'SUB23_EFC';
      if (unica === 'VET') return 'EUV';
      return 'EFC_LEAGUE';
    case 'TNR':
      return 'TNR';
    case 'CTO_ESPANA':
      return 'CTO_ESPANA';
    case 'LIGA_CLUBES': {
      const n = plegarNombre(nombre);
      if (/\biberdrola\b/.test(n)) return 'LIGA_IBERDROLA';
      if (/\boro\b/.test(n)) return 'LIGA_ORO';
      if (/\bplata\b/.test(n)) return 'LIGA_PLATA';
      if (/\bbronce\b/.test(n)) return 'LIGA_BRONCE';
      return 'LIGA_CLUBES';
    }
    case 'LIGA_MASTER':
      return 'TLM';
    default:
      return 'OTRO';
  }
}

const TERMINADA: CompetitionView['status'] = {
  state: 'cerrado',
  label: 'Terminada',
  next: null,
  daysLeft: null,
  currentSurchargeEur: null,
  nextSurchargeEur: null,
  closed: true,
  hasEstimates: false,
};

type Grupo = {
  familia: Familia;
  clave: string;
  desde: string;
  hasta: string;
  filas: FilaPruebaImportada[];
};

/**
 * Un torneo de solo lectura hecho con ediciones de Explorar.
 *
 * Tiene la forma de `EventView` para que pase por los mismos filtros, bloques y
 * tarjetas que el resto del calendario —una cuarta forma de pintar un torneo
 * sería volver a lo que costó quitar—, pero no finge ser del calendario: su id
 * lleva el prefijo `ed-`, no tiene plazos ni documentos, y `importados` dice a
 * la vista que al tocarlo se abren sus resultados y no la ficha de inscripción.
 */
function eventoDeGrupo(g: Grupo): { evento: EventView; pruebas: PruebaPasada[] } {
  const filas = [...g.filas].sort(ordenCandidatas);
  const principal =
    filas.find((f) => !/equip|team/i.test(f.edicion)) ?? filas[0];
  const fuente = principal.fuente;
  const categorias = [...new Set(filas.map((f) => f.categoria))];
  const tipo = clasificarCompeticion({
    nombre: principal.edicion,
    fuente,
    pais: principal.pais,
  }).tipo;
  const nombre =
    fuente === 'fie' || fuente === 'efc'
      ? nombrePrueba({
          nombre: principal.edicion.replace(/[’`´]/g, "'"),
          formato: 'INDIVIDUAL',
          fuente,
        })
      : // El título más corto es el del torneo («TNR ABS»); el PDF titula cada prueba.
        tituloDeTorneo(
          [...filas]
            .filter((f) => !/equip|team/i.test(f.edicion))
            .sort((a, b) => a.edicion.length - b.edicion.length)[0]?.edicion ?? principal.edicion,
        );

  const pruebas = filas.map(aPruebaPasada).sort(ordenPruebas);
  const ciudad = filas.find((f) => f.ciudad)?.ciudad ?? null;
  const pais = filas.find((f) => f.pais)?.pais ?? null;
  const urls = new Set<string>();
  const sources: EventView['sources'] = [];
  for (const f of filas) {
    const url = urlPublica(f.urlEdicion ?? f.url);
    if (!url || urls.has(url)) continue;
    urls.add(url);
    sources.push({ source: f.fuente, name: f.edicion, url });
  }

  const evento: EventView = {
    id: `ed-${principal.edicionId}`,
    source: fuente === 'fie' || fuente === 'efc' ? fuente : 'skermo_rfee',
    sourceUrl: sources[0]?.url ?? null,
    name: nombre,
    startDate: g.desde,
    endDate: g.hasta,
    venue: null,
    venueAddress: null,
    city: ciudad,
    // ISO-3 de la FIE: `BanderaPais` ya sabe leerlo.
    country: pais,
    geoLat: null,
    geoLon: null,
    timezone: null,
    officialSite: null,
    imageUrl: null,
    circuit: circuitoDe(tipo, categorias, principal.edicion),
    scope: g.familia === 'INT' ? 'INTERNACIONAL' : 'NACIONAL',
    regionalFederation: null,
    notes: null,
    lastSeenAt: new Date(0),
    disappearedAt: null,
    competitions: pruebas.map((p) => ({
      id: p.id,
      weapon: p.arma,
      gender: p.genero,
      category: p.categoria as CategoryCode,
      categoryRaw: null,
      format: p.formato,
      competitionDate: p.fecha,
      installationOpen: null,
      callTime: null,
      scratchTime: null,
      startTime: null,
      registrationCount: null,
      feeEur: null,
      sourceUrl: p.urlOficial,
      deadlines: [],
      status: TERMINADA,
      datosExtraidos: [],
    })),
    documents: [],
    liveLinks: [],
    linkedEvents: [],
    sources,
    imageSource: null,
    circuitFie: null,
    datosExtraidos: [],
  };
  return { evento, pruebas };
}

/**
 * Las ediciones sueltas de Explorar, en torneos.
 *
 * Se juntan las de la misma familia (FIE o RFEE), el mismo nombre base y la
 * misma ciudad cuyas fechas se tocan o quedan a dos días: el individual del
 * viernes y el de equipos del domingo de una Copa del Mundo son un torneo; la
 * misma Copa del Mundo en la misma sede un año después, no.
 */
function agruparImportadas(filas: FilaPruebaImportada[]): Grupo[] {
  const ordenadas = [...filas].sort(
    (a, b) =>
      (a.inicio ?? a.fecha ?? '').localeCompare(b.inicio ?? b.fecha ?? '') ||
      a.edicionId.localeCompare(b.edicionId) ||
      a.id.localeCompare(b.id),
  );
  const abiertos = new Map<string, Grupo>();
  const grupos: Grupo[] = [];
  for (const f of ordenadas) {
    const inicio = (f.inicio ?? f.fecha)?.slice(0, 10);
    if (!inicio) continue;
    const fin = [f.fin, f.fecha, inicio]
      .filter((x): x is string => Boolean(x))
      .map((x) => x.slice(0, 10))
      .sort()
      .at(-1)!;
    const familia = familiaDeFuente(f.fuente);
    const clave = `${familia}|${baseDeNombre(f.edicion)}|${ciudadPlegada(f.ciudad)}`;
    const abierto = abiertos.get(clave);
    if (abierto && msDe(inicio) <= msDe(abierto.hasta) + 2 * DIA) {
      abierto.filas.push(f);
      if (fin > abierto.hasta) abierto.hasta = fin;
      continue;
    }
    const nuevo: Grupo = { familia, clave, desde: inicio, hasta: fin, filas: [f] };
    abiertos.set(clave, nuevo);
    grupos.push(nuevo);
  }
  return grupos;
}

/**
 * Compone el tramo pasado: los torneos del calendario ya acabados con sus
 * resultados, y las pruebas de Explorar que no son ninguno de ellos.
 *
 * Tres reglas, y las tres son para no enseñar nada dos veces ni atribuir un
 * resultado a quien no es:
 *
 *  1. **Las claves exactas mandan** (`cruces`): la edición vinculada, la clave
 *     de la FIE (`fie-2027-186` es la prueba 186 de la temporada 2027) o la de
 *     Skermo (`RFEE:10158`), con arma, género y categoría comprobados.
 *  2. **Sin clave, se empareja por la prueba y el día.** Una prueba del
 *     calendario sin cruce exacto se ata a la de Explorar del mismo día, arma,
 *     género, categoría y formato y de la misma familia; en la FIE, además, de
 *     la misma ciudad, porque un sábado hay tres satélites de espada a la vez.
 *     Es lo que trae los PDF de la RFEE, que no publican ninguna clave.
 *  3. **Una prueba de Explorar que ya está en una tarjeta no sale suelta**, y
 *     tampoco su copia de otra fuente: el PDF de la RFEE repite lo que publica
 *     Skermo y se descarta si Skermo ya lo trae para ese día.
 */
export function componerTramo({
  desde,
  hasta,
  calendario,
  cruces,
  importadas,
  disponible = true,
}: {
  desde: string;
  hasta: string;
  calendario: EventView[];
  cruces: FilaCruce[];
  importadas: FilaPruebaImportada[];
  disponible?: boolean;
}): TramoPasado {
  const resultados: Record<string, PruebaPasada[]> = {};
  const usadas = new Set<string>();
  const porEvento = new Map(calendario.map((e) => [e.id, e] as const));

  for (const e of calendario) resultados[e.id] = [];
  for (const c of cruces) {
    if (!porEvento.has(c.evento) || !esPintable(c)) continue;
    if (resultados[c.evento].some((p) => p.id === c.id)) continue;
    resultados[c.evento].push(aPruebaPasada(c));
    usadas.add(c.id);
  }

  const candidatas = importadas.filter(esPintable);
  const porDia = new Map<string, FilaPruebaImportada[]>();
  for (const f of candidatas) {
    if (!f.fecha) continue;
    const clave = `${familiaDeFuente(f.fuente)}|${f.fecha.slice(0, 10)}|${claveDePrueba(f)}`;
    const lista = porDia.get(clave) ?? [];
    lista.push(f);
    porDia.set(clave, lista);
  }
  for (const lista of porDia.values()) lista.sort(ordenCandidatas);

  // Lo que el calendario ya cuenta, por familia, día y prueba (y ciudad en la FIE).
  const cubiertas = new Set<string>();
  const claveCubierta = (familia: Familia, fecha: string, prueba: string, ciudad: string) =>
    familia === 'INT' ? `${familia}|${fecha}|${prueba}|${ciudad}` : `${familia}|${fecha}|${prueba}`;

  for (const e of calendario) {
    const familia = familiaDeEvento(e);
    const ciudades = new Set(
      [e.city, ...e.linkedEvents.map((l) => l.city)].map(ciudadPlegada).filter(Boolean),
    );
    const exactas = new Set(
      resultados[e.id].map((p) =>
        claveDePrueba({ arma: p.arma, genero: p.genero, categoria: p.categoria, formato: p.formato }),
      ),
    );
    for (const c of e.competitions) {
      const prueba = claveDePrueba({
        arma: c.weapon,
        genero: c.gender,
        categoria: c.category,
        formato: c.format,
      });
      const fecha = c.competitionDate?.slice(0, 10);
      if (!fecha) continue;
      for (const ciudad of familia === 'INT' ? ciudades : new Set([''])) {
        cubiertas.add(claveCubierta(familia, fecha, prueba, ciudad));
      }
      if (exactas.has(prueba)) continue;
      const elegida = (porDia.get(`${familia}|${fecha}|${prueba}`) ?? []).find(
        (f) =>
          !usadas.has(f.id) &&
          (familia === 'NAC' || ciudades.has(ciudadPlegada(f.ciudad))),
      );
      if (!elegida) continue;
      resultados[e.id].push(aPruebaPasada(elegida));
      usadas.add(elegida.id);
      exactas.add(prueba);
    }
    resultados[e.id].sort(ordenPruebas);
  }

  /*
    Una prueba internacional que el calendario fecha otro día (la EFC movió el
    individual al domingo y la RFEE lo dejó en sábado) se ata igual si la sede
    es la misma, cae en las fechas del torneo ±1 día y el torneo tiene esa
    misma arma, género y categoría en cualquier formato.
  */
  for (const e of calendario) {
    if (familiaDeEvento(e) !== 'INT') continue;
    const ciudades = new Set(
      [e.city, ...e.linkedEvents.map((l) => l.city)].map(ciudadPlegada).filter(Boolean),
    );
    if (ciudades.size === 0) continue;
    const desdeE = msDe(e.startDate) - DIA;
    const hastaE = msDe(e.endDate ?? e.startDate) + DIA;
    const tiradores = new Set(e.competitions.map((c) => `${c.weapon}|${c.gender}|${c.category}`));
    for (const f of candidatas) {
      if (usadas.has(f.id) || !f.fecha || familiaDeFuente(f.fuente) !== 'INT') continue;
      if (!ciudades.has(ciudadPlegada(f.ciudad))) continue;
      if (!tiradores.has(`${f.arma}|${f.genero}|${f.categoria}`)) continue;
      const dia = msDe(f.fecha);
      if (dia < desdeE || dia > hastaE) continue;
      resultados[e.id].push(aPruebaPasada(f));
      usadas.add(f.id);
    }
  }

  /*
    Una edición que ya está en una tarjeta entra entera si sus demás pruebas
    caen en las fechas del torneo: la EFC publica una edición por torneo y
    sus pruebas por equipos (o una prueba cambiada de día) no siempre están en
    el calendario de la RFEE. Sin esto saldrían en otra tarjeta del mismo
    torneo.
  */
  const edicionesDeEvento = new Map<string, Set<string>>();
  for (const e of calendario) {
    const ediciones = new Set(resultados[e.id].map((p) => p.edicionId));
    if (ediciones.size > 0) edicionesDeEvento.set(e.id, ediciones);
  }
  for (const [eventoId, ediciones] of edicionesDeEvento) {
    const e = porEvento.get(eventoId)!;
    const desdeE = msDe(e.startDate) - DIA;
    const hastaE = msDe(e.endDate ?? e.startDate) + DIA;
    for (const f of candidatas) {
      if (usadas.has(f.id) || !ediciones.has(f.edicionId) || !f.fecha) continue;
      const dia = msDe(f.fecha);
      if (dia < desdeE || dia > hastaE) continue;
      resultados[eventoId].push(aPruebaPasada(f));
      usadas.add(f.id);
    }
    resultados[eventoId].sort(ordenPruebas);
  }

  for (const f of candidatas) {
    if (!usadas.has(f.id) || !f.fecha) continue;
    cubiertas.add(
      claveCubierta(familiaDeFuente(f.fuente), f.fecha.slice(0, 10), claveDePrueba(f), ciudadPlegada(f.ciudad)),
    );
  }

  /*
    Copias entre fuentes de la RFEE. Skermo nunca se descarta contra sí misma:
    el TLM de veteranos publica varias pruebas de espada masculina el mismo día
    —una por tramo de edad— y son clasificaciones distintas. El PDF sí, contra
    Skermo y contra otro PDF que ya la trajera: la RFEE sube a veces el mismo
    resultado en dos documentos.
  */
  const sueltas = candidatas.filter((f) => {
    if (usadas.has(f.id)) return false;
    if (!f.fecha) return true;
    const clave = claveCubierta(
      familiaDeFuente(f.fuente),
      f.fecha.slice(0, 10),
      claveDePrueba(f),
      ciudadPlegada(f.ciudad),
    );
    return !cubiertas.has(clave);
  });
  const deSkermo = new Set(
    sueltas
      .filter((f) => f.fuente === 'skermo_rfee' && f.fecha)
      .map((f) => `${f.fecha!.slice(0, 10)}|${claveDePrueba(f)}`),
  );
  const duenoDePdf = new Map<string, string>();
  const pdfs = sueltas
    .filter((f) => FUENTES_SECUNDARIAS.includes(f.fuente))
    .sort(
      (a, b) =>
        (PRIORIDAD_FUENTE[a.fuente] ?? 9) - (PRIORIDAD_FUENTE[b.fuente] ?? 9) ||
        Number(Boolean(Number(b.conResultados ?? 0))) - Number(Boolean(Number(a.conResultados ?? 0))) ||
        a.edicionId.localeCompare(b.edicionId),
    );
  const pdfDescartados = new Set<string>();
  for (const f of pdfs) {
    if (!f.fecha) continue;
    const clave = `${f.fecha.slice(0, 10)}|${claveDePrueba(f)}`;
    const dueno = duenoDePdf.get(clave);
    if (deSkermo.has(clave) || (dueno && dueno !== f.edicionId)) {
      pdfDescartados.add(f.id);
      continue;
    }
    duenoDePdf.set(clave, f.edicionId);
  }

  const eventos: EventView[] = [...calendario];
  const importados: string[] = [];
  for (const grupo of agruparImportadas(sueltas.filter((f) => !pdfDescartados.has(f.id)))) {
    const { evento, pruebas } = eventoDeGrupo(grupo);
    if (resultados[evento.id]) continue;
    // Una edición importada sin un solo puesto no dice nada: ni ganador ni «Resultados».
    if (!pruebas.some((p) => p.conResultados)) continue;
    eventos.push(evento);
    importados.push(evento.id);
    resultados[evento.id] = pruebas;
  }
  for (const id of Object.keys(resultados)) resultados[id] = sinRepetidas(resultados[id]);

  return { desde, hasta, disponible, eventos, importados, resultados };
}

/**
 * Algunos PDF de la RFEE se importaron dos veces con claves distintas
 * («…TORNEOLIGAMASTER~2» y «~3»): misma prueba, mismo tramo de edad, mismo
 * ganador. Sin ganador no se puede afirmar que sean la misma y se dejan.
 */
function sinRepetidas(pruebas: PruebaPasada[]): PruebaPasada[] {
  const vistas = new Set<string>();
  return pruebas.filter((p) => {
    if (!p.ganador) return true;
    const clave = [
      p.edicionId,
      claveDePrueba(p),
      p.categoriaRaw ?? '',
      p.fecha ?? '',
      p.ganador.nombre,
    ].join('|');
    if (vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
}

/** Una edición de Explorar que es (parte de) un torneo del calendario. */
export type EdicionDeEvento = {
  edicionId: string;
  nombre: string;
  fuente: string;
  inicio: string | null;
  fin: string | null;
  ciudad: string | null;
  pais: string | null;
  urlOficial: string | null;
  /** Ordenadas por fecha, formato, arma, género y categoría. */
  pruebas: PruebaPasada[];
};

/**
 * Agrupa por edición las filas que `crucesExactos` ató a un torneo, con las
 * mismas exclusiones que el calendario: armas que no se pintan, marcadores de
 * la FIE y copias repetidas de un mismo PDF.
 */
export function edicionesDeCruces(filas: FilaPruebaImportada[]): EdicionDeEvento[] {
  const porEdicion = new Map<string, { cabecera: FilaPruebaImportada; pruebas: Map<string, PruebaPasada> }>();
  for (const f of filas) {
    if (!esPintable(f)) continue;
    const grupo = porEdicion.get(f.edicionId) ?? { cabecera: f, pruebas: new Map() };
    grupo.pruebas.set(f.id, aPruebaPasada(f));
    porEdicion.set(f.edicionId, grupo);
  }
  return [...porEdicion.values()]
    .map(({ cabecera: c, pruebas }) => ({
      edicionId: c.edicionId,
      nombre: c.edicion,
      fuente: c.fuente,
      inicio: c.inicio?.slice(0, 10) ?? null,
      fin: c.fin?.slice(0, 10) ?? null,
      ciudad: c.ciudad,
      pais: c.pais,
      urlOficial: urlPublica(c.urlEdicion),
      pruebas: sinRepetidas([...pruebas.values()].sort(ordenPruebas)),
    }))
    .sort(
      (a, b) =>
        (a.inicio ?? '9999').localeCompare(b.inicio ?? '9999') ||
        (PRIORIDAD_FUENTE[a.fuente] ?? 9) - (PRIORIDAD_FUENTE[b.fuente] ?? 9) ||
        a.edicionId.localeCompare(b.edicionId),
    );
}
