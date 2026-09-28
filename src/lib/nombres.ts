/**
 * Comparar un nombre escrito a mano con un nombre publicado.
 *
 * Vive en `src/lib/` y no dentro de un componente a propósito: lo usan a la vez
 * el filtro de las tablas del ranking (que es cliente) y la búsqueda de
 * `/alta` (que es servidor). `nombreCasa` estaba en
 * `src/components/ranking/selectores-grupo.tsx`, que lleva `'use client'`, así
 * que importarlo desde el servidor se habría llevado por delante media
 * biblioteca de React. Aquí no hay ni una importación: es texto y aritmética.
 *
 * -------------------------------------------------------------------------
 * LAS DOS FUENTES ESCRIBEN LOS NOMBRES AL REVÉS ENTRE SÍ
 * -------------------------------------------------------------------------
 * Medido en la base el 28/09/2026:
 *
 *   official_ranking_entry  «JORGE CASAUS PIELAGO»   (nombre primero, MAYÚSCULAS)
 *   fie_fencer              «CASAUS PIELAGO Jorge»   (apellidos primero)
 *   fie_clasificacion       «LLAVADOR Carlos»        (apellidos primero)
 *
 * Por eso aquí NO se compara nunca la cadena entera, ni por prefijo: se parte
 * en palabras y se empareja cada palabra de lo que se escribió con la palabra
 * del nombre publicado que mejor le vaya, sin mirar el orden. Así «jorge
 * casaus» encuentra a Casaus en las tres tablas, y «llavador carlos» encuentra
 * a «CARLOS LLAVADOR FERNANDEZ».
 */

/**
 * Acentos fuera y todo a minúsculas.
 *
 * La fuente sí publica acentos («ABRIL RODÉS TORÀ», «HÉCTOR RIVAS JIMÉNEZ») y
 * quien teclea su propio apellido en un móvil muchas veces no los pone.
 */
export function sinAcentos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Las palabras de un nombre.
 *
 * Los guiones cuentan como separador porque las dos fuentes no se ponen de
 * acuerdo: la FIE publica «MARTIN-PORTUGUES Lucia» y «LETE MUNOZ-REPISO Mateo»
 * con guion, y la RFEE los mismos apellidos separados por un espacio. Si el
 * guion no partiera, «munoz repiso» no encontraría a «MUNOZ-REPISO».
 */
export function palabrasNombre(texto: string): string[] {
  return sinAcentos(texto)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

/**
 * Partículas que no identifican a nadie.
 *
 * «MANUEL DE LA CAL ALMENDARIZ» y «MANUEL DE LAS HERAS MORENO» comparten el
 * «de la», así que exigir que casen no aporta nada, y que falten tampoco tiene
 * que penalizar: quien escribe «manuel de la cal» y quien escribe «manuel cal»
 * son la misma persona buscándose.
 */
const PARTICULAS = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'el',
  'y',
  'i',
  'da',
  'do',
  'dos',
  'san',
  'van',
  'von',
]);

/**
 * El mismo sonido escrito de las dos maneras posibles en español.
 *
 * Esto no es fonética de verdad: es la lista corta de confusiones que comete
 * quien escribe su propio apellido de oído o con prisa, y es lo que hace que
 * «carlos yavador» encuentre a «CARLOS LLAVADOR FERNANDEZ» —que con una
 * distancia de edición cruda queda a 2 y se confundiría con medio mundo—.
 *
 * Reglas, en este orden y no en otro:
 *   ch → 1 (sentinela, para que la «c» de «ch» no se convierta en «s» ni «k»)
 *   ll → y → i  (yeísmo: «llavador» y «yavador» acaban iguales)
 *   qu, q → k;  c ante e/i → s;  resto de c → k  («kim» = «quim», «zeta» = «ceta»)
 *   g ante e/i → j  («gines» = «jines»)
 *   z, ç → s;  v, w → b;  h → nada
 *   letras repetidas → una sola  («rr» = «r»)
 *
 * La «x» se queda como está, y es una decisión mirando los nombres reales: en
 * la base hay «XAVIER VEA FALGUERA», «XOEL CASTRELOS DE DIOS», «UXUE DÍEZ
 * MANRIQUE», «MANEX ARRIARAN GONZALEZ» y catorce «ALEX». En español la «x»
 * suena de tres maneras distintas según la palabra (/ks/ en «Alex», /j/ en
 * «Xavier», /s/ en «Xoel»), así que cualquier regla única inventaría
 * emparejados en vez de arreglarlos.
 */
export function fonetico(palabra: string): string {
  let p = sinAcentos(palabra).replace(/[^\p{L}\p{N}]+/gu, '');
  p = p.replace(/ch/g, '1');
  p = p.replace(/ll/g, 'y');
  p = p.replace(/qu/g, 'k').replace(/q/g, 'k');
  p = p.replace(/c([ei])/g, 's$1').replace(/c/g, 'k');
  p = p.replace(/g([ei])/g, 'j$1');
  p = p.replace(/[zç]/g, 's');
  p = p.replace(/[vw]/g, 'b');
  p = p.replace(/h/g, '');
  p = p.replace(/y/g, 'i');
  p = p.replace(/(.)\1+/g, '$1');
  return p.replace(/1/g, 'ch');
}

/**
 * Distancia de edición, con corte.
 *
 * El corte no es una optimización: es parte de la regla. A nadie le interesa
 * saber que «garcia» está a 5 de «fernandez»; interesa saber si está a 1 o a
 * 2, y en cuanto se pasa se puede dejar de contar. Con el corte, comparar una
 * palabra contra las 1.237 filas del ranking sale en microsegundos y la
 * búsqueda entera se puede hacer en memoria sin índice de trigramas.
 */
export function distanciaEdicion(a: string, b: string, corte = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > corte) return corte + 1;

  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const actual = [i];
    let minimo = i;
    for (let j = 1; j <= b.length; j += 1) {
      const coste = a[i - 1] === b[j - 1] ? 0 : 1;
      const valor = Math.min(
        previa[j] + 1,
        actual[j - 1] + 1,
        previa[j - 1] + coste,
      );
      actual.push(valor);
      if (valor < minimo) minimo = valor;
    }
    // Toda la fila se ha pasado del corte: ya no puede bajar. Se abandona.
    if (minimo > corte) return corte + 1;
    previa = actual;
  }
  return previa[b.length];
}

/**
 * Cuánto se parecen una palabra escrita y una palabra publicada, de 0 a 1.
 *
 * Devuelve 0 cuando no se parecen lo suficiente para que cuente como la misma
 * palabra. Los tramos están puestos para que una inicial («C. Llavador») valga
 * poco pero cuente, y para que las erratas largas no abran la puerta a
 * cualquier cosa: dos letras de diferencia solo se perdonan a partir de siete
 * letras, donde «llavador»/«yavador» es una errata y no otro apellido.
 */
export function parecidoPalabra(escrita: string, publicada: string): number {
  if (escrita === publicada) return 1;

  // Una sola letra es una inicial, no una palabra: «C. Llavador», «M.ª».
  if (escrita.length === 1) return publicada.startsWith(escrita) ? 0.5 : 0;

  const fe = fonetico(escrita);
  const fp = fonetico(publicada);
  if (fe === fp) return 0.95;

  /**
   * Prefijo solo desde cuatro letras. Con tres, «gar» se traería a todos los
   * García, los Garay y los Garrido: sería una forma de sacar el censo a
   * tirones, que es justo lo que este buscador no puede ser.
   */
  if (escrita.length >= 4 && publicada.startsWith(escrita)) return 0.9;
  if (fe.length >= 4 && fp.startsWith(fe)) return 0.85;

  const corta = Math.min(fe.length, fp.length);
  const distancia = distanciaEdicion(fe, fp, corta >= 7 ? 2 : 1);
  if (distancia === 0) return 0.95;
  if (distancia === 1 && corta >= 4) return 0.8;
  if (distancia === 2 && corta >= 7) return 0.65;

  return 0;
}

export type Parecido = {
  /** De 0 a 1. Cuanto más alto, más seguro es que sea la misma persona. */
  puntos: number;
  /** Cuántas palabras del nombre publicado ha reconocido. Rompe empates. */
  reconocidas: number;
};

/** Por debajo de esto no se enseña: es otra persona que se escribe parecido. */
export const UMBRAL = 0.62;

/** Tres letras. Ver `bastanteParaBuscar`. */
export const MINIMO_LETRAS = 3;

/**
 * ¿Hay bastante escrito para buscar a alguien?
 *
 * Con una o dos letras NO se busca, y es una regla de seguridad, no de
 * comodidad: un buscador de nombres al que se le puede pedir «a», «b», «c» es
 * una forma de sacar el censo a tirones, y en estas listas hay menores de
 * edad. Se cuentan letras, no caracteres del campo: «a b» son dos letras
 * aunque ocupen tres pulsaciones.
 */
export function bastanteParaBuscar(texto: string): boolean {
  return palabrasNombre(texto).join('').length >= MINIMO_LETRAS;
}

/**
 * Compara un nombre escrito a mano con un nombre publicado.
 *
 * Devuelve `null` si no llega al umbral. Las reglas, por orden de importancia:
 *
 * 1. **Sin orden**: cada palabra escrita busca su pareja entre las publicadas,
 *    y una publicada no se puede usar dos veces. Es lo que hace que funcione
 *    en las dos fuentes, que escriben el nombre al revés entre sí.
 * 2. **Todas las palabras escritas tienen que casar** (menos las partículas).
 *    Quien escribe dos apellidos está afinando la búsqueda; si uno de los dos
 *    no aparece, no es su ficha.
 * 3. **Hace falta un ancla**: al menos una palabra de cuatro letras o más que
 *    case fuerte (exacta, misma fonética o prefijo). Sin esto, «ana» + una
 *    inicial casaría con cualquiera.
 */
export function parecidoNombre(escrito: string, publicado: string): Parecido | null {
  const escritas = palabrasNombre(escrito);
  const publicadas = palabrasNombre(publicado);
  if (escritas.length === 0 || publicadas.length === 0) return null;

  const usadas = new Set<number>();
  const notas: number[] = [];
  let ancla = false;

  for (const palabra of escritas) {
    let mejor = 0;
    let mejorIndice = -1;
    for (let i = 0; i < publicadas.length; i += 1) {
      if (usadas.has(i)) continue;
      const nota = parecidoPalabra(palabra, publicadas[i]);
      if (nota > mejor) {
        mejor = nota;
        mejorIndice = i;
      }
    }

    if (mejor === 0) {
      // Una partícula que no aparece no descarta a nadie; una palabra sí.
      if (PARTICULAS.has(palabra)) continue;
      return null;
    }

    usadas.add(mejorIndice);
    notas.push(mejor);
    if (palabra.length >= 4 && mejor >= 0.85) ancla = true;
  }

  if (!ancla || notas.length === 0) return null;

  const puntos = notas.reduce((a, b) => a + b, 0) / notas.length;
  if (puntos < UMBRAL) return null;

  return { puntos, reconocidas: usadas.size };
}

/**
 * El filtro de las tablas del ranking: ¿aparecen todas las palabras escritas
 * dentro del nombre?
 *
 * Es deliberadamente más tonto que `parecidoNombre` y se queda así: ahí se
 * filtra una tabla que ya está en pantalla mientras se teclea, y lo que se
 * espera de un filtro es que enseñe justo lo que contiene lo escrito. Perdonar
 * erratas en un filtro mientras se escribe hace que la tabla parpadee con
 * filas que no se han pedido.
 */
export function nombreCasa(nombre: string, busqueda: string): boolean {
  const aguja = sinAcentos(busqueda).trim();
  if (!aguja) return true;
  const pajar = sinAcentos(nombre);
  return aguja.split(/\s+/).every((palabra) => pajar.includes(palabra));
}
