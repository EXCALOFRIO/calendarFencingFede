import { tipoConProcedencia } from './estadisticas-tipo';
import type {
  AmbitoCompeticion,
  ClasificacionCompeticion,
  TipoCompeticion,
  TonoTipo,
} from './tipos-social';

/**
 * Tipo de competición para pintar pastillas de color. Se deduce del circuito
 * documentado por el calendario (sólo los códigos fiables, ver
 * `tipoConProcedencia`), y si no del nombre de la edición, la fuente y el país.
 * Es una etiqueta de lectura, no un dato oficial: lo que no se reconoce queda
 * como «Torneo internacional», «Otra prueba nacional» u «Otra prueba».
 *
 * No lee la base ni la sesión: se puede usar también en componentes cliente.
 */

type Definicion = { etiqueta: string; corta: string; tono: TonoTipo; ambito: AmbitoCompeticion | null };

export const TIPOS_COMPETICION: Record<TipoCompeticion, Definicion> = {
  JUEGOS_OLIMPICOS: { etiqueta: 'Juegos Olímpicos', corta: 'JJOO', tono: 'gold', ambito: 'internacional' },
  CTO_MUNDO: { etiqueta: 'Campeonato del Mundo', corta: 'Mundial', tono: 'primary', ambito: 'internacional' },
  CTO_EUROPA: { etiqueta: 'Campeonato de Europa', corta: 'Cto. de Europa', tono: 'org-efc', ambito: 'internacional' },
  CTO_CONTINENTAL: { etiqueta: 'Campeonato continental', corta: 'Continental', tono: 'org-fie', ambito: 'internacional' },
  JUEGOS_MULTIDEPORTE: { etiqueta: 'Juegos multideporte', corta: 'Juegos', tono: 'org-fie', ambito: 'internacional' },
  COPA_MUNDO: { etiqueta: 'Copa del Mundo', corta: 'Copa del Mundo', tono: 'org-fie', ambito: 'internacional' },
  GRAN_PREMIO: { etiqueta: 'Gran Premio', corta: 'Gran Premio', tono: 'org-fie', ambito: 'internacional' },
  SATELITE: { etiqueta: 'Satélite', corta: 'Satélite', tono: 'org-fie', ambito: 'internacional' },
  CIRCUITO_EUROPEO: { etiqueta: 'Circuito europeo', corta: 'Circuito europeo', tono: 'org-efc', ambito: 'internacional' },
  INTERNACIONAL_OTRO: { etiqueta: 'Torneo internacional', corta: 'Internacional', tono: 'off', ambito: 'internacional' },
  CTO_ESPANA: { etiqueta: 'Campeonato de España', corta: 'Cto. España', tono: 'org-rfee', ambito: 'nacional' },
  TNR: { etiqueta: 'Torneo Nacional de Ranking', corta: 'TNR', tono: 'org-rfee', ambito: 'nacional' },
  LIGA_CLUBES: { etiqueta: 'Liga de clubes', corta: 'Liga', tono: 'org-rfee', ambito: 'nacional' },
  LIGA_MASTER: { etiqueta: 'Liga Máster (veteranos)', corta: 'Liga Máster', tono: 'org-rfee', ambito: 'nacional' },
  CRITERIUM: { etiqueta: 'Criterium nacional', corta: 'Criterium', tono: 'org-rfee', ambito: 'nacional' },
  NACIONAL_OTRO: { etiqueta: 'Otra prueba nacional', corta: 'Nacional', tono: 'off', ambito: 'nacional' },
  AUTONOMICO: { etiqueta: 'Campeonato autonómico', corta: 'Autonómico', tono: 'org-aut', ambito: 'nacional' },
  OTRO: { etiqueta: 'Otra prueba', corta: 'Otra', tono: 'off', ambito: null },
};

const ORDEN = Object.keys(TIPOS_COMPETICION) as TipoCompeticion[];

/**
 * Peso deportivo de cada tipo para ordenar «mejores competiciones» (menor es
 * más importante). No sigue el orden de las pastillas: un Gran Premio FIE
 * puntúa como un Europeo y más que una Copa del Mundo, y cualquier prueba
 * internacional pesa más que una nacional.
 */
const IMPORTANCIA: Record<TipoCompeticion, number> = {
  JUEGOS_OLIMPICOS: 0,
  CTO_MUNDO: 1,
  CTO_EUROPA: 2,
  GRAN_PREMIO: 2,
  CTO_CONTINENTAL: 3,
  COPA_MUNDO: 3,
  JUEGOS_MULTIDEPORTE: 4,
  CIRCUITO_EUROPEO: 5,
  SATELITE: 5,
  INTERNACIONAL_OTRO: 6,
  CTO_ESPANA: 7,
  TNR: 8,
  LIGA_CLUBES: 9,
  CRITERIUM: 9,
  LIGA_MASTER: 10,
  NACIONAL_OTRO: 10,
  AUTONOMICO: 11,
  OTRO: 12,
};

export function importanciaCompeticion(tipo: TipoCompeticion): number {
  return IMPORTANCIA[tipo];
}

/** La FIE publica 998, 999 y 9999 para quien no termina (abandono, exclusión): no son puestos. */
export const PUESTO_SIN_CLASIFICAR = 998;

/** Circuito documentado del calendario → tipo. */
const POR_CIRCUITO: Record<string, TipoCompeticion> = {
  CTO_MUNDO: 'CTO_MUNDO',
  CTO_EUROPA: 'CTO_EUROPA',
  SEN_WC: 'COPA_MUNDO',
  JUN_WC: 'COPA_MUNDO',
  CAD_WC: 'COPA_MUNDO',
  SEN_GP: 'GRAN_PREMIO',
  SATELITE: 'SATELITE',
  CTO_ESPANA: 'CTO_ESPANA',
  TNR: 'TNR',
  LIGA_CLUBES: 'LIGA_CLUBES',
  TLM: 'LIGA_MASTER',
  CONCENTRACION: 'NACIONAL_OTRO',
};

/** El orden importa: la primera regla que coincide gana. */
const REGLAS: [RegExp, TipoCompeticion][] = [
  [/\b(jeux olympiques de la jeunesse|youth olympic|juegos olimpicos de la juventud)\b/, 'JUEGOS_MULTIDEPORTE'],
  [/\b(jeux olympiques|olympic games|juegos olimpicos)\b/, 'JUEGOS_OLIMPICOS'],
  [/\b(champ\w* du monde|world (fencing )?championships?|campeonatos? del mundo|mundial)\b/, 'CTO_MUNDO'],
  [/\b(champ\w* d ?europe|european ((cadets?|juniors?|u ?23|veterans?) )?(fencing )?championships?|campeonatos? de europa)\b/, 'CTO_EUROPA'],
  [/\b(champ\w* (d ?afrique|africains?|asiatiques?|panamericains?|de la mediterranee|d ?oceanie|sud ?americains?|zonaux)|(asian|african|pan ?american|oceanian|mediterranean|south american) championships?|campeonatos? (panamericano|asiatico|africano|iberoamericano|mediterraneo|sudamericano))\b/, 'CTO_CONTINENTAL'],
  [/\b(universiades?|university games|jeux|juegos (europeos|mediterraneos|panamericanos|del mediterraneo))\b/, 'JUEGOS_MULTIDEPORTE'],
  [/\b(coupe du monde|world cup|copa del mundo)\b/, 'COPA_MUNDO'],
  [/\b(grand prix|gran premio)\b/, 'GRAN_PREMIO'],
  [/\b(satel+ite|satelite)\b/, 'SATELITE'],
  [/\b(european circuit|circuit europeen|circuito europeo|eurofence|efc|u ?23 circuit|cadets? circuit|european cadet cup|ecc)\b/, 'CIRCUITO_EUROPEO'],
  [/\b(campeonato|cto)( de)? esp(ana)?\b/, 'CTO_ESPANA'],
  [/\b(tnr|torneo nacional( de)? ranking)\b/, 'TNR'],
  [/\b(liga master|tlm)\b/, 'LIGA_MASTER'],
  [/\b(liga|division)\b/, 'LIGA_CLUBES'],
  [/\bcriteri(um|un)\b/, 'CRITERIUM'],
  [/\b(autonomic[oa]|territorial|regional|campeonato de (madrid|andalucia|cataluny?a|catalunya|valencia|galicia|aragon|asturias|castilla|euskadi|pais vasco|canarias|baleares|murcia|navarra|extremadura|cantabria|la rioja))\b/, 'AUTONOMICO'],
];

const variantes = (prefijos: string[], nucleos: string[]) => prefijos.flatMap((p) => nucleos.map((n) => `${p}${n}`));
const CHAMPIONSHIP = ['championship', 'championships'];
const CATEGORIA_EUROPEO = ['', 'cadet ', 'cadets ', 'junior ', 'juniors ', 'u23 ', 'u 23 ', 'veteran ', 'veterans '];

/**
 * Las mismas `REGLAS`, en el mismo orden, escritas como frases sueltas sobre
 * el nombre plegado (`plegarNombre`), para poder evaluarlas en SQL con LIKE
 * (`sqlTipoPorNombre`). `%` es el `\w*` de la regla («champ%» = «championnats»).
 * Cada frase, sola, tiene que dar su tipo con `tipoPorNombre` (lo comprueba
 * un test); si se toca una regla, se toca su lista.
 */
export const FRASES_TIPO: readonly (readonly [TipoCompeticion, readonly string[]])[] = [
  ['JUEGOS_MULTIDEPORTE', ['jeux olympiques de la jeunesse', 'youth olympic', 'juegos olimpicos de la juventud']],
  ['JUEGOS_OLIMPICOS', ['jeux olympiques', 'olympic games', 'juegos olimpicos']],
  ['CTO_MUNDO', [
    'champ% du monde', ...variantes(['world ', 'world fencing '], CHAMPIONSHIP),
    'campeonato del mundo', 'campeonatos del mundo', 'mundial',
  ]],
  ['CTO_EUROPA', [
    'champ% d europe', 'champ% deurope',
    ...variantes(CATEGORIA_EUROPEO.flatMap((c) => [`european ${c}`, `european ${c}fencing `]), CHAMPIONSHIP),
    'campeonato de europa', 'campeonatos de europa',
  ]],
  ['CTO_CONTINENTAL', [
    ...variantes(['champ% '], [
      'd afrique', 'dafrique', 'africain', 'africains', 'asiatique', 'asiatiques', 'panamericain', 'panamericains',
      'de la mediterranee', 'd oceanie', 'doceanie', 'sud americain', 'sud americains', 'sudamericain', 'sudamericains', 'zonaux',
    ]),
    ...variantes(['asian ', 'african ', 'pan american ', 'panamerican ', 'oceanian ', 'mediterranean ', 'south american '], CHAMPIONSHIP),
    ...variantes(['campeonato ', 'campeonatos '], ['panamericano', 'asiatico', 'africano', 'iberoamericano', 'mediterraneo', 'sudamericano']),
  ]],
  ['JUEGOS_MULTIDEPORTE', [
    'universiade', 'universiades', 'university games', 'jeux',
    'juegos europeos', 'juegos mediterraneos', 'juegos panamericanos', 'juegos del mediterraneo',
  ]],
  ['COPA_MUNDO', ['coupe du monde', 'world cup', 'copa del mundo']],
  ['GRAN_PREMIO', ['grand prix', 'gran premio']],
  ['SATELITE', ['satelite', 'satellite', 'satelllite']],
  ['CIRCUITO_EUROPEO', [
    'european circuit', 'circuit europeen', 'circuito europeo', 'eurofence', 'efc', 'u23 circuit', 'u 23 circuit',
    'cadet circuit', 'cadets circuit', 'european cadet cup', 'ecc',
  ]],
  ['CTO_ESPANA', variantes(['campeonato ', 'campeonato de ', 'cto ', 'cto de '], ['esp', 'espana'])],
  ['TNR', ['tnr', 'torneo nacional ranking', 'torneo nacional de ranking']],
  ['LIGA_MASTER', ['liga master', 'tlm']],
  ['LIGA_CLUBES', ['liga', 'division']],
  ['CRITERIUM', ['criterium', 'criteriun']],
  ['AUTONOMICO', [
    'autonomico', 'autonomica', 'territorial', 'regional',
    ...variantes(['campeonato de '], [
      'madrid', 'andalucia', 'cataluna', 'catalunya', 'valencia', 'galicia', 'aragon', 'asturias', 'castilla',
      'euskadi', 'pais vasco', 'canarias', 'baleares', 'murcia', 'navarra', 'extremadura', 'cantabria', 'la rioja',
    ]),
  ]],
];

/** Minúsculas sin acentos ni puntuación (y la «С» cirílica que publica la FIE). */
export function plegarNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\u0441/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type DatosCompeticion = {
  nombre: string;
  /** Fuente de la prueba (`fie`, `rfee_pdf`, `skermo_rfee`, `skermo_regional`…). */
  fuente: string;
  /** País de la edición (ISO-3 FIE), si se publica. */
  pais?: string | null;
  /** Ámbito del evento del calendario vinculado, si lo hay. */
  ambitoEvento?: string | null;
  circuitoEvento?: string | null;
  fuenteEvento?: string | null;
};

/** Tipo que dice el propio nombre, sin mirar calendario, fuente ni país; `null` si el nombre no lo dice. */
export function tipoPorNombre(nombre: string): TipoCompeticion | null {
  const texto = plegarNombre(nombre);
  for (const [patron, tipo] of REGLAS) if (patron.test(texto)) return tipo;
  return null;
}

function tipoDe(d: DatosCompeticion): TipoCompeticion {
  const documentado = tipoConProcedencia(d.fuenteEvento ?? null, d.circuitoEvento ?? null);
  if (documentado && POR_CIRCUITO[documentado]) return POR_CIRCUITO[documentado];
  const porNombre = tipoPorNombre(d.nombre);
  // La EFC sólo organiza Campeonatos de Europa y su circuito: un «Grand Prix» o
  // una «Cup» de su calendario es una prueba del circuito, no de la FIE.
  if (d.fuente === 'efc') return porNombre === 'CTO_EUROPA' ? 'CTO_EUROPA' : 'CIRCUITO_EUROPEO';
  if (porNombre) return porNombre;
  if (d.fuente === 'skermo_regional' || d.ambitoEvento === 'AUTONOMICO') return 'AUTONOMICO';
  if (esFuenteInternacional(d.fuente) || d.ambitoEvento === 'INTERNACIONAL') return 'INTERNACIONAL_OTRO';
  if (d.pais && d.pais !== 'ESP') return 'INTERNACIONAL_OTRO';
  if (d.fuente === 'rfee_pdf' || d.fuente.startsWith('skermo') || d.ambitoEvento === 'NACIONAL') return 'NACIONAL_OTRO';
  // Engarde aloja torneos de todo el mundo: sólo con sede española (o sin sede) es nacional.
  if (d.fuente === 'engarde') return 'NACIONAL_OTRO';
  return 'OTRO';
}

function ambitoDe(tipo: TipoCompeticion, d: DatosCompeticion): AmbitoCompeticion {
  const propio = TIPOS_COMPETICION[tipo].ambito;
  if (propio) return propio;
  if (esFuenteInternacional(d.fuente) || d.ambitoEvento === 'INTERNACIONAL' || (d.pais && d.pais !== 'ESP')) {
    return 'internacional';
  }
  return 'nacional';
}

/** Fuentes cuyas pruebas son siempre internacionales: la FIE y la confederación europea. */
const FUENTES_INTERNACIONALES = new Set(['fie', 'efc']);

export function esFuenteInternacional(fuente: string): boolean {
  return FUENTES_INTERNACIONALES.has(fuente);
}

/**
 * Nivel de una medalla para elegir la más valiosa (menor es mejor). No es
 * `IMPORTANCIA`: aquí un Europeo va por delante de un Gran Premio y el
 * circuito europeo por delante de cualquier prueba nacional.
 */
const NIVEL_MEDALLA: Record<TipoCompeticion, number> = {
  JUEGOS_OLIMPICOS: 0,
  CTO_MUNDO: 1,
  CTO_EUROPA: 2,
  CTO_CONTINENTAL: 2,
  COPA_MUNDO: 3,
  GRAN_PREMIO: 3,
  SATELITE: 3,
  JUEGOS_MULTIDEPORTE: 3,
  CIRCUITO_EUROPEO: 4,
  INTERNACIONAL_OTRO: 5,
  CTO_ESPANA: 6,
  TNR: 7,
  LIGA_CLUBES: 7,
  CRITERIUM: 7,
  LIGA_MASTER: 7,
  NACIONAL_OTRO: 7,
  AUTONOMICO: 8,
  OTRO: 9,
};

export function nivelMedalla(tipo: TipoCompeticion): number {
  return NIVEL_MEDALLA[tipo];
}

const MEDITERRANEO = /\b(mediterrane[oa]s?|mediterranee|mediterranean|mediterraneens?)\b/;

/**
 * Subtipos con nombre propio dentro de un tipo genérico. El `tipo` no cambia
 * (la unión `TipoCompeticion` es cerrada y la usan filtros y tablas): sólo la
 * etiqueta, para que el Campeonato y los Juegos del Mediterráneo no salgan
 * como «Continental» o «Juegos».
 */
export const SUBTIPOS_COMPETICION = {
  CTO_MEDITERRANEO: { etiqueta: 'Campeonato del Mediterráneo', corta: 'Mediterráneo' },
  JUEGOS_MEDITERRANEOS: { etiqueta: 'Juegos Mediterráneos', corta: 'J. Mediterráneos' },
} as const;

export type SubtipoCompeticion = keyof typeof SUBTIPOS_COMPETICION;

export function subtipoCompeticion(tipo: TipoCompeticion, nombre: string): SubtipoCompeticion | null {
  if (tipo !== 'CTO_CONTINENTAL' && tipo !== 'JUEGOS_MULTIDEPORTE') return null;
  if (!MEDITERRANEO.test(plegarNombre(nombre))) return null;
  return tipo === 'CTO_CONTINENTAL' ? 'CTO_MEDITERRANEO' : 'JUEGOS_MEDITERRANEOS';
}

export function clasificarCompeticion(d: DatosCompeticion): ClasificacionCompeticion {
  const tipo = tipoDe(d);
  const subtipo = subtipoCompeticion(tipo, d.nombre);
  const def = subtipo ? { ...TIPOS_COMPETICION[tipo], ...SUBTIPOS_COMPETICION[subtipo] } : TIPOS_COMPETICION[tipo];
  return {
    tipo,
    etiqueta: def.etiqueta,
    corta: def.corta,
    tono: def.tono,
    ambito: ambitoDe(tipo, d),
    orden: ORDEN.indexOf(tipo),
  };
}

/** Categorías de `sport_competition.category`, con nombre deportivo español. */
export const CATEGORIAS_DEPORTIVAS: Record<string, string> = {
  ABS: 'Absoluto',
  M23: 'M23',
  M20: 'M20',
  M17: 'M17',
  M15: 'M15',
  M14: 'M14',
  M13: 'M13',
  M12: 'M12',
  M11: 'M11',
  M10: 'M10',
  M9: 'M9',
  M7: 'M7',
  VET: 'Veteranos',
};

const ORDEN_CATEGORIAS = Object.keys(CATEGORIAS_DEPORTIVAS);

export function etiquetaCategoria(codigo: string): string {
  return CATEGORIAS_DEPORTIVAS[codigo] ?? codigo;
}

export function ordenCategoria(codigo: string): number {
  const i = ORDEN_CATEGORIAS.indexOf(codigo);
  return i < 0 ? ORDEN_CATEGORIAS.length : i;
}
