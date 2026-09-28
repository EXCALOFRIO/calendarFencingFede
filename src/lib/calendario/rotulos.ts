import { nombreDeCircuito } from '@/lib/colores';
import type { EventView, Weapon } from '@/lib/queries/calendar';
import {
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  CIRCUIT_LABEL,
  GENDER_SHORT,
  WEAPON_SHORT,
  titular,
  titularTorneo,
} from '@/lib/utils';

/**
 * Los rótulos de un torneo: arma, género, categoría, circuito y sede.
 *
 * Esto vivía dentro de `rejilla-mes.tsx`, que era el único sitio que lo
 * pintaba. Con el paso a bloques de competición lo pintan tres sitios —la
 * tarjeta de escritorio, la tarjeta del móvil y las filas de un bloque
 * múltiple—, así que sale del componente y se queda donde se puede probar sin
 * un navegador. Cada decisión de aquí costó una captura; van los por qués.
 */

/**
 * Géneros que se tiran en un torneo.
 *
 * **Una tarjeta con los dos badges, nunca dos tarjetas.** El usuario lo
 * señaló expresamente: el mismo torneo con prueba masculina y femenina salía
 * dos veces seguidas, con el mismo nombre y la misma fecha, y lo único que
 * cambiaba era una letra. Eso no es información, es el mismo torneo contado
 * dos veces.
 *
 * Las pruebas por equipos mixtos se marcan «Mx» y no se reparten en M y F:
 * son una prueba distinta, no las dos a la vez.
 */
export function generosDe(evento: EventView): { codigo: string; largo: string }[] {
  const hay = new Set(evento.competitions.map((c) => c.gender));
  const marcas: { codigo: string; largo: string }[] = [];
  if (hay.has('M')) marcas.push({ codigo: GENDER_SHORT.M, largo: 'Masculino' });
  if (hay.has('F')) marcas.push({ codigo: GENDER_SHORT.F, largo: 'Femenino' });
  if (hay.has('MIXTO')) {
    marcas.push({ codigo: GENDER_SHORT.MIXTO, largo: 'Equipos mixtos' });
  }
  return marcas;
}

/** Categorías del torneo, abreviadas. La abreviatura vive en `lib/utils`
 * porque la tira de pruebas de la ficha usa la misma. */
export function categoriasDe(evento: EventView): string[] {
  const orden = Object.keys(CATEGORY_LABEL);
  return [...new Set(evento.competitions.map((c) => c.category))]
    .sort((a, b) => orden.indexOf(a) - orden.indexOf(b))
    .map((c) => CATEGORY_SHORT[c] ?? c);
}

export function armasDe(evento: EventView): Weapon[] {
  const orden: Weapon[] = ['FLORETE', 'ESPADA', 'SABLE'];
  const hay = new Set(evento.competitions.map((c) => c.weapon));
  return orden.filter((a) => hay.has(a));
}

/**
 * El circuito para la pastilla teñida, y SIEMPRE.
 *
 * La rejilla tenía aquí un `circuitoDe()` que se callaba cuando el nombre del
 * torneo ya decía el circuito: «Copa del Mundo Júnior» con la etiqueta «C.
 * Mundo Júnior» encima es la misma frase dos veces y en una barra de un día
 * ocupaba la única línea que había.
 *
 * En la tarjeta de bloque esa regla **no vale**, y por eso la función se ha
 * ido. La pastilla teñida no es una línea de texto más: es **la señal de color
 * del organismo**, y si desaparece cuando el nombre coincide, la tarjeta de una
 * Copa del Mundo vuelve al «todo gris sobre negro» que el usuario señaló,
 * justo en el torneo más importante del mes. Así que la pastilla siempre está;
 * lo que cuesta es una repetición de tres palabras, y a cambio se lee el tipo
 * de competición sin leer.
 */
export function pastillaDeCircuito(evento: EventView): string | null {
  return nombreDeCircuito(evento.circuit) ?? CIRCUIT_LABEL[evento.circuit] ?? null;
}

/**
 * EL NOMBRE APRETADO, PARA QUE QUEPA EN UN CHIP.
 *
 * Viene del calendario de rejilla, donde una columna de un día medía 61 px en
 * un iPhone y las tres jornadas del mismo sábado se leían **«Liga Nacion…»,
 * «Liga Nacion…» y «Liga Nacion…»**: tres barras idénticas para tres
 * competiciones distintas, porque lo que las distingue —Iberdrola, Oro,
 * Plata— está justo detrás del corte.
 *
 * En bloques sigue haciendo falta, y en el mismo sitio: los chips horizontales
 * de un fin de semana con cinco competiciones. Un chip mide lo que mide su
 * texto y tres chips tienen que caber en 290 px. Apretados quedan «Liga
 * Iberdrola 1ª J.», «Liga Oro 1ª J.» y «Liga Plata 1ª J.».
 *
 * Dos condiciones que no cambian:
 *
 * - **No se inventa ninguna abreviatura.** Las de la tabla son las que la
 *   aplicación ya publica en `CIRCUIT_SHORT` («Cto. España», «C. Mundo
 *   Cadete»), así que el vocabulario es el mismo que en el resto de la
 *   interfaz.
 * - **Solo se acortan las palabras que no distinguen.** Ninguna regla toca un
 *   nombre propio ni un número: «Iberdrola», «Oro», «Plata», «PFCAR», «1ª» y
 *   «M-14» salen intactos.
 */
const APRETAR: [RegExp, string][] = [
  [/\bliga nacional\b/gi, 'Liga'],
  [/\bcopa del mundo\b/gi, 'C. Mundo'],
  [/\bcampeonato de\b/gi, 'Cto.'],
  [/\bcampeonato\b/gi, 'Cto.'],
  [/\bconcentración\b/gi, 'Conc.'],
  [/\binternacional\b/gi, 'Int.'],
  [/\bjornada\b/gi, 'J.'],
];

export function apretarNombre(nombre: string): string {
  return APRETAR.reduce((n, [de, a]) => n.replace(de, a), nombre)
    .replace(/\s+/g, ' ')
    .trim();
}

/*
  `etiquetasDeChips()` vivía aquí y se ha ido.

  Acortaba el nombre de un torneo para que cupiera en un chip, y le pegaba la
  ciudad o el arma cuando dos chips del mismo bloque se llamarían igual. Ya no
  hay chips: en un bloque múltiple todas las competiciones llevan su fila
  entera, con su nombre completo y su sede, así que no hay nada que acortar ni
  que desambiguar.
*/

/**
 * Dónde se tira.
 *
 * Con el país, porque «Padua» y «Plovdiv» no le dicen a nadie a qué distancia
 * están, y a la hora de pedir días y billetes eso es justo lo que se está
 * decidiendo.
 *
 * Y si no hay ciudad **se dice**: «Sede sin publicar». No es un hueco que
 * rellenar con algo que parezca oficial; de los 274 eventos, 246 no tienen
 * pabellón, así que esto se ve en nueve de cada diez tarjetas y tiene que ser
 * honesto.
 */
export function sedeDe(evento: EventView, conPais = true): string {
  const ciudad = evento.city ? titular(evento.city) : '';
  if (!ciudad) return 'Sede sin publicar';
  if (!conPais || !evento.country) return ciudad;
  return `${ciudad}, ${evento.country}`;
}

/**
 * Cuánto queda de plazo, con su tono del semáforo.
 *
 * Se coge el plazo que antes cierra de todas las pruebas: es el que aprieta.
 * Si la fuente no publica plazo **no se dice nada**; inventar «cierra pronto»
 * sería peor que el silencio, porque con eso se pierden inscripciones.
 *
 * Lee `competition.status` y no `competition.deadlines`: el listado del
 * calendario devuelve `deadlines` vacío a propósito —433 kB de los 1.200 del
 * JSON— y de `status` solo llegan los escalares (`state`, `closed`,
 * `daysLeft`), que es justo lo que hace falta aquí.
 */
export function plazoDe(
  evento: EventView,
): { texto: string; tono: string; cerrado: boolean } | null {
  const abiertas = evento.competitions.filter((c) => !c.status.closed);
  const dias = abiertas
    .map((c) => c.status.daysLeft)
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b)[0];

  if (dias === undefined) {
    if (abiertas.length === 0 && evento.competitions.length > 0) {
      return {
        texto: 'Inscripción cerrada',
        tono: 'text-muted-foreground',
        cerrado: true,
      };
    }
    return null;
  }

  if (dias === 0) {
    return { texto: 'Cierra hoy', tono: 'text-danger', cerrado: false };
  }
  const tono =
    dias <= 3 ? 'text-danger' : dias <= 10 ? 'text-warn' : 'text-muted-foreground';
  return {
    texto: `Cierra en ${dias} ${dias === 1 ? 'día' : 'días'}`,
    tono,
    cerrado: false,
  };
}
