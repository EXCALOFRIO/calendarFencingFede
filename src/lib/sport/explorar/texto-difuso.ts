/**
 * Texto para la búsqueda tolerante (competiciones y países): plegado,
 * sinónimos en varios idiomas y distancia de edición. Sin dependencias de
 * servidor: lo usan el índice de ediciones y el buscador de países del
 * navegador.
 */

/** Letras cirílicas que la FIE publica a veces en nombres latinos («Сhampionnats», con С). */
const HOMOGLIFOS: Record<string, string> = {
  А: 'a', В: 'b', С: 'c', Е: 'e', Н: 'h', К: 'k', М: 'm', О: 'o', Р: 'p', Т: 't', Х: 'x',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x',
};

/** Minúsculas sin tildes; todo lo que no es letra o cifra pasa a espacio. «M-20» y «Sub 20» quedan en «m20». */
export function plegarTexto(texto: string): string {
  return texto
    .replace(/[АВСЕНКМОРТХаеорсух]/g, (l) => HOMOGLIFOS[l] ?? l)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(?:m|sub|u)\s?(\d{1,2})\b/g, 'm$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palabras que no distinguen una competición de otra. */
export const VACIAS: ReadonlySet<string> = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'le', 'les', 'du', 'des', 'd', 'l', 'of', 'the', 'y', 'e', 'et',
  'and', 'a', 'en', 'di', 'da', 'der', 'die', 'das', 'par', 'por', 'al', 'au', 'aux', 'per', 'in',
]);

/**
 * Grupos de palabras equivalentes; la primera es la canónica. Las ciudades van
 * aquí también: la FIE publica sus nombres en francés (Le Caire, Varsovie).
 */
const GRUPOS: readonly (readonly string[])[] = [
  ['campeonato', 'campeonatos', 'championnats', 'championnat', 'champ', 'championships', 'championship', 'campionati', 'campionato', 'cto', 'cpto', 'meisterschaft', 'meisterschaften', 'chpt', 'chpts'],
  ['copa', 'coupe', 'cup', 'coppa', 'pokal', 'kupa', 'copas', 'coupes'],
  ['mundo', 'monde', 'world', 'mondo', 'welt'],
  ['mundial', 'mundiales', 'mondial', 'mondiali', 'mondiaux', 'worlds'],
  ['europa', 'europe', 'european', 'europeen', 'europeenne', 'europeens', 'europeennes'],
  ['europeo', 'europeos', 'europea', 'europeas', 'europei', 'euro', 'euros'],
  ['gp', 'grandprix', 'granpremio'],
  ['torneo', 'tournoi', 'tournament', 'turnier', 'torneio', 'torneos', 'tournois'],
  ['satelite', 'satellite', 'satelites', 'satellites', 'satelite'],
  ['junior', 'juniors', 'jr', 'm20', 'juniores', 'juniorinnen'],
  ['cadete', 'cadetes', 'cadet', 'cadets', 'm17', 'cadetti'],
  ['infantil', 'infantiles', 'm15'],
  ['veterano', 'veteranos', 'veteranas', 'veterana', 'veteran', 'veterans', 'vet', 'vets', 'veterani'],
  ['absoluto', 'absolutos', 'absoluta', 'absolutas', 'senior', 'seniors', 'abs'],
  ['equipos', 'equipo', 'equipes', 'equipe', 'team', 'teams', 'squadre', 'squadra', 'mannschaft'],
  ['individual', 'individuel', 'individuelle', 'individuale', 'individuales'],
  ['espada', 'espadas', 'epee', 'epees', 'spada', 'degen'],
  ['florete', 'floretes', 'fleuret', 'fleurets', 'foil', 'fioretto'],
  ['sable', 'sables', 'sabre', 'sabres', 'sciabola', 'saber'],
  ['masculino', 'masculina', 'masculinos', 'masculin', 'masculine', 'men', 'mens', 'hombres', 'male', 'maschile', 'herren'],
  ['femenino', 'femenina', 'femeninos', 'feminin', 'feminine', 'women', 'womens', 'mujeres', 'female', 'femminile', 'damen', 'ladies'],
  ['olimpico', 'olimpicos', 'olimpica', 'olimpicas', 'olympique', 'olympiques', 'olympic', 'olympics', 'olimpiadas', 'olimpiada', 'olympiad', 'jjoo', 'olimpiadi'],
  ['juegos', 'jeux', 'games', 'giochi', 'spiele'],
  ['asiatico', 'asiaticos', 'asiatica', 'asiatique', 'asiatiques', 'asian', 'asia'],
  ['africano', 'africanos', 'africana', 'afrique', 'african', 'africa'],
  ['panamericano', 'panamericanos', 'panamericana', 'panamericains', 'panamericain', 'panamerican', 'panam'],
  ['mediterraneo', 'mediterraneos', 'mediterranea', 'mediterranee', 'mediterranean', 'mediterranei'],
  ['sudamericano', 'sudamericanos', 'sudamericains', 'sudamericain', 'suramericano', 'southamerican'],
  ['universiada', 'universiadas', 'universiade', 'universiades'],
  ['circuito', 'circuit', 'circuits', 'circuitos'],
  ['nacional', 'national', 'nationale', 'nazionale', 'nacionales'],
  ['internacional', 'international', 'internationale', 'internazionale', 'internacionales'],
  ['trofeo', 'trophee', 'trophy', 'trofei'],
  ['liga', 'league', 'ligue'],
  ['espana', 'spain', 'espagne', 'spagna', 'spanien'],
  // Ciudades
  ['turin', 'torino', 'turim'],
  ['varsovia', 'warsaw', 'varsovie', 'warszawa', 'varsavia'],
  ['londres', 'london', 'londra'],
  ['cairo', 'caire'],
  ['argel', 'alger', 'algiers', 'algeri'],
  ['habana', 'havana', 'havane'],
  ['barcelona', 'barcelone'],
  ['copenhague', 'copenhagen', 'kobenhavn', 'copenaghen'],
  ['atenas', 'athenes', 'athens', 'atene', 'athina'],
  ['gante', 'gand', 'gent', 'ghent'],
  ['moscu', 'moscow', 'moscou', 'moskva', 'mosca'],
  ['belgrado', 'belgrade', 'beograd'],
  ['bruselas', 'bruxelles', 'brussels', 'brussel'],
  ['ginebra', 'geneve', 'geneva', 'genf', 'ginevra'],
  ['viena', 'vienne', 'vienna', 'wien'],
  ['praga', 'prague', 'praha', 'prag'],
  ['roma', 'rome'],
  ['milan', 'milano'],
  ['napoles', 'naples', 'napoli'],
  ['florencia', 'florence', 'firenze'],
  ['venecia', 'venise', 'venice', 'venezia'],
  ['lisboa', 'lisbonne', 'lisbon'],
  ['estambul', 'istanbul'],
  ['seul', 'seoul'],
  ['pekin', 'beijing', 'peking'],
  ['tokio', 'tokyo'],
  ['teheran', 'tehran'],
  ['tunez', 'tunis'],
  ['cracovia', 'cracovie', 'krakow', 'cracow'],
  ['colonia', 'cologne', 'koln'],
  ['munich', 'munchen'],
  ['tiflis', 'tbilisi'],
  ['taskent', 'tashkent', 'tachkent'],
  ['bucarest', 'bucharest', 'bucuresti'],
  ['estocolmo', 'stockholm'],
  ['luxemburgo', 'luxembourg'],
  ['amberes', 'anvers', 'antwerp', 'antwerpen'],
  ['basilea', 'bale', 'basel'],
  ['marsella', 'marseille'],
  ['burdeos', 'bordeaux'],
  ['salonica', 'thessaloniki'],
  ['esmirna', 'izmir'],
  ['singapur', 'singapore'],
  ['tallin', 'tallinn'],
  ['vilna', 'vilnius'],
  ['kiev', 'kyiv', 'kiew'],
  ['hamburgo', 'hamburg', 'hambourg'],
  ['francfort', 'frankfurt'],
  ['nuremberg', 'nurnberg'],
  ['gdansk', 'danzig'],
  ['jerusalen', 'jerusalem'],
  ['marrakech', 'marrakesh'],
  ['lieja', 'liege', 'luik'],
  ['dubai', 'dubay'],
  ['sochi', 'sotchi'],
];

const CANONICA = new Map<string, string>();
for (const grupo of GRUPOS) for (const palabra of grupo) if (!CANONICA.has(palabra)) CANONICA.set(palabra, grupo[0]!);

/** Frases de varias palabras que equivalen a una. Se aplican sobre texto ya plegado. */
const FRASES: readonly [RegExp, string][] = [
  [/\bgrand prix\b|\bgran premio\b|\bgrand prix\b/g, 'gp'],
  [/\bpan american\b/g, 'panamericano'],
  [/\bsouth american\b|\bsud american\b/g, 'sudamericano'],
  [/\b(?:le|el|al) (?:caire|cairo|qahira)\b/g, 'cairo'],
  [/\bla (?:havane|habana)\b/g, 'habana'],
  [/\b(?:st|saint|san|sankt|santo) (?:petersbourg|petersburgo|petersburg|peterburg)\b/g, 'petersburgo'],
  [/\b(?:nueva|new) york\b/g, 'nuevayork'],
  [/\b(?:la|a) coruna\b/g, 'coruna'],
  [/\bjeux olympiques\b|\bjuegos olimpicos\b|\bolympic games\b/g, 'olimpico juegos'],
];

export function canonica(palabra: string): string {
  return CANONICA.get(palabra) ?? palabra;
}

/** Palabras de un texto ya plegado, con las frases sustituidas (sin quitar las vacías). */
function palabras(plegado: string): string[] {
  let texto = plegado;
  for (const [re, por] of FRASES) texto = texto.replace(re, por);
  return texto ? texto.split(' ') : [];
}

/**
 * Términos con los que se indexa un texto: las palabras tal cual y sus
 * canónicas, también las de las frases («grand prix» da «grand», «prix» y «gp»).
 */
export function terminosIndice(texto: string): Set<string> {
  const plegado = plegarTexto(texto);
  const salida = new Set<string>();
  const crudas = plegado ? plegado.split(' ') : [];
  for (const p of [...crudas, ...palabras(plegado)]) {
    if (!p || VACIAS.has(p)) continue;
    salida.add(p);
    salida.add(canonica(p));
  }
  return salida;
}

/** Conceptos que se deducen de varias palabras: «Championnats du Monde» también es «mundial». */
export function anadirConceptos(terminos: Set<string>): void {
  if (terminos.has('campeonato') && terminos.has('mundo')) terminos.add('mundial');
  if (terminos.has('campeonato') && terminos.has('europa')) terminos.add('europeo');
  if (terminos.has('juegos') && terminos.has('olimpico')) terminos.add('jjoo');
}

export type PalabraConsulta = {
  /** Lo escrito, plegado. */
  cruda: string;
  /** Su canónica (igual a `cruda` si no tiene sinónimos). */
  canonica: string;
  /** Es la última palabra: se está escribiendo y puede ser un prefijo con errata. */
  ultima: boolean;
};

/**
 * Palabras de una consulta: plegadas, con las frases sustituidas y sin las
 * vacías (salvo que la consulta sólo tenga vacías). Repetidas, una vez.
 */
export function palabrasConsulta(q: string): PalabraConsulta[] {
  const plegado = plegarTexto(q);
  const todas = palabras(plegado);
  const utiles = todas.filter((p) => !VACIAS.has(p));
  const elegidas = utiles.length ? utiles : todas;
  const vistas = new Set<string>();
  const salida: PalabraConsulta[] = [];
  elegidas.forEach((cruda, i) => {
    if (vistas.has(cruda)) return;
    vistas.add(cruda);
    salida.push({ cruda, canonica: canonica(cruda), ultima: i === elegidas.length - 1 });
  });
  return salida;
}

/** Errores admitidos según la longitud: nada hasta 3 letras, 1 hasta 6 y 2 a partir de 7. */
export function topeErrores(longitud: number): number {
  return longitud <= 3 ? 0 : longitud <= 6 ? 1 : 2;
}

/**
 * Distancia de Damerau-Levenshtein (alineación óptima: inserción, borrado,
 * sustitución y trasposición de dos letras vecinas) con corte: en cuanto la
 * distancia pasa de `tope` devuelve `tope + 1` sin terminar la tabla.
 */
export function distanciaEdicion(a: string, b: string, tope: number): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > tope) return tope + 1;
  if (n === 0 || m === 0) return Math.max(n, m) > tope ? tope + 1 : Math.max(n, m);
  let antes = new Array<number>(m + 1).fill(0);
  let previa = Array.from({ length: m + 1 }, (_, j) => j);
  let actual = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    actual[0] = i;
    let minimo = actual[0];
    for (let j = 1; j <= m; j++) {
      const coste = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(previa[j]! + 1, actual[j - 1]! + 1, previa[j - 1]! + coste);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        v = Math.min(v, antes[j - 2]! + 1);
      }
      actual[j] = v;
      if (v < minimo) minimo = v;
    }
    if (minimo > tope) return tope + 1;
    [antes, previa, actual] = [previa, actual, antes];
  }
  return previa[m]! > tope ? tope + 1 : previa[m]!;
}

/** Calidad de la coincidencia de una palabra: exacta, prefijo o con errata. */
export const EXACTA = 3;
export const PREFIJO = 2;
export const ERRATA = 1;

/**
 * Cómo casa una palabra de la consulta con los términos de un vocabulario.
 * Devuelve cada término que casa con su calidad. Las erratas sólo se buscan si
 * la palabra no existe tal cual ni como prefijo: «turin» no trae «turku» y
 * «budapest» no trae «bucarest».
 */
export function casarPalabra(
  palabra: PalabraConsulta,
  vocabulario: readonly string[],
): Map<string, number> {
  const salida = new Map<string, number>();
  const formas = palabra.canonica === palabra.cruda ? [palabra.cruda] : [palabra.cruda, palabra.canonica];
  const numerica = /^\d+$/.test(palabra.cruda);
  for (const termino of vocabulario) {
    for (const forma of formas) {
      if (termino === forma) { salida.set(termino, EXACTA); break; }
      if (!numerica && forma.length >= 2 && termino.length > forma.length && termino.startsWith(forma)) {
        if ((salida.get(termino) ?? 0) < PREFIJO) salida.set(termino, PREFIJO);
      }
    }
  }
  if (salida.size > 0 || numerica) return salida;
  const forma = palabra.cruda;
  const tope = topeErrores(forma.length);
  if (tope === 0) return salida;
  for (const termino of vocabulario) {
    if (distanciaEdicion(forma, termino, tope) <= tope) { salida.set(termino, ERRATA); continue; }
    // Lo que se está escribiendo puede ser el principio de una palabra con errata («mndia» → «mundial»).
    // Con la misma inicial: un prefijo corto con errata se parece a demasiado («turin» a «surinam»).
    if (palabra.ultima && forma.length >= 5 && termino.length > forma.length && termino[0] === forma[0]) {
      const t1 = Math.min(1, tope);
      for (const largo of [forma.length, forma.length + 1]) {
        if (largo <= termino.length && distanciaEdicion(forma, termino.slice(0, largo), t1) <= t1) {
          salida.set(termino, ERRATA);
          break;
        }
      }
    }
  }
  return salida;
}
