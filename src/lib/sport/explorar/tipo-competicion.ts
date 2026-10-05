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
  CTO_EUROPA: { etiqueta: 'Campeonato de Europa', corta: 'Europeo', tono: 'org-efc', ambito: 'internacional' },
  CTO_CONTINENTAL: { etiqueta: 'Campeonato continental', corta: 'Continental', tono: 'org-fie', ambito: 'internacional' },
  JUEGOS_MULTIDEPORTE: { etiqueta: 'Juegos multideporte', corta: 'Juegos', tono: 'org-fie', ambito: 'internacional' },
  COPA_MUNDO: { etiqueta: 'Copa del Mundo', corta: 'Copa del Mundo', tono: 'org-fie', ambito: 'internacional' },
  GRAN_PREMIO: { etiqueta: 'Gran Premio FIE', corta: 'Gran Premio', tono: 'org-fie', ambito: 'internacional' },
  SATELITE: { etiqueta: 'Satélite FIE', corta: 'Satélite', tono: 'org-fie', ambito: 'internacional' },
  CIRCUITO_EUROPEO: { etiqueta: 'Circuito europeo', corta: 'Circ. europeo', tono: 'org-efc', ambito: 'internacional' },
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
  [/\b(champ\w* d ?europe|european (fencing )?championships?|campeonatos? de europa)\b/, 'CTO_EUROPA'],
  [/\b(champ\w* (d ?afrique|africains?|asiatiques?|panamericains?|de la mediterranee|d ?oceanie|sud ?americains?|zonaux)|(asian|african|pan ?american|oceanian|mediterranean|south american) championships?|campeonatos? (panamericano|asiatico|africano|iberoamericano|mediterraneo|sudamericano))\b/, 'CTO_CONTINENTAL'],
  [/\b(universiades?|university games|jeux|juegos (europeos|mediterraneos|panamericanos|del mediterraneo))\b/, 'JUEGOS_MULTIDEPORTE'],
  [/\b(coupe du monde|world cup|copa del mundo)\b/, 'COPA_MUNDO'],
  [/\b(grand prix|gran premio)\b/, 'GRAN_PREMIO'],
  [/\b(satel+ite|satelite)\b/, 'SATELITE'],
  [/\b(european circuit|circuit europeen|circuito europeo|eurofence|efc|u ?23 circuit)\b/, 'CIRCUITO_EUROPEO'],
  [/\b(campeonato|cto)( de)? espana\b/, 'CTO_ESPANA'],
  [/\b(tnr|torneo nacional( de)? ranking)\b/, 'TNR'],
  [/\b(liga master|tlm)\b/, 'LIGA_MASTER'],
  [/\b(liga|division)\b/, 'LIGA_CLUBES'],
  [/\bcriteri(um|un)\b/, 'CRITERIUM'],
  [/\b(autonomic[oa]|territorial|regional|campeonato de (madrid|andalucia|cataluny?a|catalunya|valencia|galicia|aragon|asturias|castilla|euskadi|pais vasco|canarias|baleares|murcia|navarra|extremadura|cantabria|la rioja))\b/, 'AUTONOMICO'],
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

function tipoDe(d: DatosCompeticion): TipoCompeticion {
  const documentado = tipoConProcedencia(d.fuenteEvento ?? null, d.circuitoEvento ?? null);
  if (documentado && POR_CIRCUITO[documentado]) return POR_CIRCUITO[documentado];
  const texto = plegarNombre(d.nombre);
  for (const [patron, tipo] of REGLAS) if (patron.test(texto)) return tipo;
  if (d.fuente === 'skermo_regional' || d.ambitoEvento === 'AUTONOMICO') return 'AUTONOMICO';
  if (d.fuente === 'fie' || d.ambitoEvento === 'INTERNACIONAL') return 'INTERNACIONAL_OTRO';
  if (d.pais && d.pais !== 'ESP') return 'INTERNACIONAL_OTRO';
  if (d.fuente === 'rfee_pdf' || d.fuente.startsWith('skermo') || d.ambitoEvento === 'NACIONAL') return 'NACIONAL_OTRO';
  return 'OTRO';
}

function ambitoDe(tipo: TipoCompeticion, d: DatosCompeticion): AmbitoCompeticion {
  const propio = TIPOS_COMPETICION[tipo].ambito;
  if (propio) return propio;
  if (d.fuente === 'fie' || d.ambitoEvento === 'INTERNACIONAL' || (d.pais && d.pais !== 'ESP')) {
    return 'internacional';
  }
  return 'nacional';
}

export function clasificarCompeticion(d: DatosCompeticion): ClasificacionCompeticion {
  const tipo = tipoDe(d);
  const def = TIPOS_COMPETICION[tipo];
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
  M23: 'Sub-23',
  M20: 'Júnior (M20)',
  M17: 'Cadete (M17)',
  M15: 'Infantil (M15)',
  M14: 'M14',
  M13: 'Alevín (M13)',
  M12: 'M12',
  M11: 'Benjamín (M11)',
  M10: 'M10',
  M9: 'Prebenjamín (M9)',
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
