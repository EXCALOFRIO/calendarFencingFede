'use client';

import { CircleCheck } from 'lucide-react';
import * as React from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  colorDeOrganismo,
  jerarquiaDeCircuito,
  nombreDeCircuito,
} from '@/lib/colores';
import type { EventView, Weapon } from '@/lib/queries/calendar';
import {
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  CIRCUIT_LABEL,
  GENDER_SHORT,
  WEAPON_LABEL,
  cn,
  formatDateRangeEs,
  organismoDe,
  titular,
  titularTorneo,
  type Organismo,
} from '@/lib/utils';
import { MarcaArma } from './iconos-arma';
import { hoyMadrid } from '@/lib/callups/fechas';

/**
 * Rejilla de un mes: densidad progresiva.
 *
 * -------------------------------------------------------------------------
 * EL DATO QUE MANDA SOBRE TODO EL DISEÑO
 * -------------------------------------------------------------------------
 * Se contaron los 274 eventos de la temporada por día de la semana:
 *
 *   L 7,3 %   M 4,5 %   X 4,6 %   J 12,9 %   V 16,8 %   S 27,9 %   D 25,9 %
 *
 * Es decir: **lunes, martes y miércoles se llevan el 16 % de los días de
 * competición y el 43 % del ancho** en una rejilla de siete columnas iguales.
 * Y de los 274 arranques, 248 caen en jueves, viernes o sábado.
 *
 * De ahí las dos decisiones que cambian la pantalla:
 *
 * 1. **Las columnas no miden lo mismo.** L-M-X se quedan en lo justo para su
 *    número y J-V-S-D se reparten el resto. Una barra de sábado a domingo pasa
 *    de 112 a 148 px en un iPhone: la diferencia entre «Copa Mu…» y «Copa del
 *    Mundo».
 * 2. **No hay densidad, así que la barra fina no se paga.** La mayoría de
 *    semanas tienen una competición o ninguna. Cuando sobra alto, la barra se
 *    convierte en **tarjeta** y enseña circuito, arma, género, categoría, sede
 *    y plazo; cuando la semana va cargada, se degrada a barra de una línea y
 *    lo que no cabe se resume en un «+N» de la semana. Es el mismo reparto
 *    medido de antes, con techo por semana en vez de un único alto para todas.
 *
 * -------------------------------------------------------------------------
 * LO QUE NO SE TOCA, PORQUE COSTÓ ENCONTRARLO
 * -------------------------------------------------------------------------
 * - El alto se resuelve **a partir del espacio medido**, nunca al revés.
 * - La medida va en **dos capas**: un contenedor `relative` que mide y un
 *   interior `absolute inset-0`. Midiendo la caja que contiene las semanas,
 *   las semanas la estiraban, la medida crecía y nunca se concluía que no
 *   cabía: el mes se salía por abajo y la última semana salía rebanada.
 * - Las barras llevan `.objetivo-libre` para saltarse la regla de 44 px de
 *   puntero grueso de `globals.css`: su alto lo calcula esta función.
 *
 * -------------------------------------------------------------------------
 * Y UNA COSA QUE ERA UN FALLO VISIBLE
 * -------------------------------------------------------------------------
 * Tres semanas seguidas sin competición ocupaban 216 px enseñando veintiún
 * números y nada más. Ahora una racha de dos o más semanas vacías se funde en
 * **una franja** que dice de cuándo a cuándo no hay nada. Una semana vacía
 * suelta sí conserva sus siete celdas: hace falta para leer el mes.
 */

const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/**
 * Ancho relativo de cada columna. Sale del reparto real de días de
 * competición (ver cabecera): L-M-X no necesitan más que su número.
 */
const PESO_COLUMNA = [0.6, 0.6, 0.6, 1.4, 1.4, 1.4, 1.4];
const SUMA_COLUMNAS = PESO_COLUMNA.reduce((a, b) => a + b, 0);

/** Borde izquierdo de cada columna en tanto por uno. Tiene 8 elementos. */
const BORDE_COLUMNA = PESO_COLUMNA.reduce<number[]>(
  (acc, p) => [...acc, acc[acc.length - 1] + p / SUMA_COLUMNAS],
  [0],
);

const PLANTILLA_COLUMNAS = PESO_COLUMNA.map((p) => `${p}fr`).join(' ');

/**
 * NO HAY MAPA DE COLOR AQUÍ, Y ES A PROPÓSITO.
 *
 * El color de quién organiza vive en `src/lib/colores.ts`, que es su dueño:
 * el organismo sale en el calendario, en la ficha, en el ranking y en las
 * convocatorias, y si cada pantalla elige su tono acabamos con cuatro
 * paletas. Aquí solo se importa.
 *
 * Lo que sí importa saber de esa decisión, porque condiciona este fichero:
 *
 * - La superficie de la barra es un color **sólido** (`--org-x-suave`), no un
 *   `--org-x` al 20 %. La versión anterior era translúcida y se veía sin
 *   esfuerzo lo que fallaba: **los separadores de columna atravesaban las
 *   barras**. Un relleno con alfa baja sobre una rejilla con bordes visibles
 *   nunca se lee como un objeto; se lee como un subrayado sobre una hoja de
 *   cálculo. Y un color medio al 20 % sobre casi negro se vuelve pardo, que
 *   es lo que el usuario llamó «parecen estados desactivados».
 * - Y **nada de `backdrop-filter`**: son cientos de barras en un móvil, el
 *   desenfoque es caro y detrás no hay ninguna imagen que desenfocar. El
 *   acrílico es para los paneles que flotan sobre una foto
 *   (`REFERENCIAS.md`, sección 10).
 * - Hay cuatro colores, uno por organismo, y **el circuito no lleva color**:
 *   se distingue con su sigla y con el peso del titular
 *   (`jerarquiaDeCircuito`). Veinte circuitos no dan veinte colores
 *   distinguibles, y el verde, el ámbar y el rojo están cogidos por el
 *   semáforo de plazos.
 */

/** Separación vertical entre franjas, en píxeles. */
const HUECO_BARRA = 3;

/** Sitio reservado arriba de cada semana para el número del día. */
const CABECERA = { normal: 21, compacta: 16 };

/**
 * Alto mínimo con el que una barra de una línea sigue legible.
 *
 * Medido en un escritorio de 1440x900 con la dirección técnica y los filtros
 * abiertos, que es el caso más cargado que existe: a 21 px caben tres barras
 * y un «+9» por semana; a 19 px caben cuatro y un «+6». Dos píxeles menos por
 * barra son una competición más a la vista en cada semana del mes, y a 19 px
 * la pastilla del arma y el nombre siguen leyéndose enteros.
 */
const MIN_BARRA = { normal: 19, compacta: 15 };

/** Suelo absoluto. Por debajo no se lee ni la sigla del arma. */
const SUELO_BARRA = 12;

/**
 * Lo que necesita cada aspecto para no salirse de su barra.
 *
 * -------------------------------------------------------------------------
 * ESTO ES LO QUE ARREGLA EL TÍTULO REBANADO
 * -------------------------------------------------------------------------
 * Los umbrales de antes (`alto >= 48` para tarjeta, `>= 30` para doble) eran
 * más bajos que lo que el contenido ocupa de verdad, así que la tarjeta se
 * pintaba en huecos donde no cabía: el `flex` apretaba sus tres filas y el
 * `overflow` del `line-clamp` cortaba la segunda línea del título por la
 * mitad. En producción se veía **«Eurofence / League» con los palos de las
 * letras rebanados**, que es el mismo fallo que ya se había corregido una vez
 * en las barras de un día y que aquí se había colado por otra puerta.
 *
 * Los números salen de medir, no de estimar: se clona cada barra en una caja
 * sin restricción de alto y se le pide su `getBoundingClientRect`, en un
 * iPhone 14 Pro (raíz a 18 px, el caso peor) y en un escritorio de 1440
 * (raíz a 16 px):
 *
 * | aspecto           | natural móvil | natural escritorio |
 * |-------------------|---------------|--------------------|
 * | tarjeta, 1 línea  | 64,8          | 57,9               |
 * | tarjeta, 2 líneas | 89,8          | 67,1               |
 * | doble             | 42,7          | 45,3               |
 * | una línea         | 27            | 24                 |
 *
 * Con los umbrales puestos en lo medido, una barra **o tiene sitio para su
 * aspecto o baja al siguiente**, y entonces no hay nada que apretar. La
 * excepción es «una línea»: ahí todo va en una fila con `items-center`, lo que
 * sobra del alto natural es interlínea y se puede apretar sin tocar un trazo.
 * Se comprobó con la lupa a 4×: una barra de 20 px con 27 px naturales se lee
 * perfecta.
 */
const ASPECTO = {
  tarjeta: 68,
  tarjetaDosLineas: 92,
  doble: 46,
  linea: 19,
};

/**
 * Alto de una línea del título en una barra de un día.
 *
 * Medido: `0.68rem` con la raíz a 18 px son 12,2 px y con `leading-[1.15]` la
 * línea ocupa 14,1. Se redondea a 14,5 para no quedarse en el filo.
 */
const LINEA_ESTRECHA = 14.5;

/**
 * Alto de una línea del título en una barra de una línea.
 *
 * `text-xs` con la raíz a 18 px son 13,5 px y con `leading-[1.15]` la línea
 * ocupa 15,5. Se redondea a 17 para dejar margen: el freno tiene que fallar
 * hacia «una línea y puntos», nunca hacia «dos líneas rebanadas».
 */
const LINEA_XS = 17;

/**
 * Techo del alto de barra de una semana.
 *
 * Esta función ES la densidad progresiva, y tiene tres frenos porque hicieron
 * falta los tres. Se vieron los tres fallos renderizados.
 *
 * 1. **Por franjas.** Una semana con una competición puede gastarse 84 px en
 *    ella y enseñarlo todo; una con cinco no puede gastar más de 22 en cada
 *    una y se queda en una línea. Sin este freno, el reparto daba el mismo
 *    alto a todas las semanas y salía lo peor de los dos mundos: ni tarjeta
 *    ni barra.
 *
 * 2. **Por anchura, y manda el freno.** Se mira la barra **más estrecha** de
 *    la semana, no la más ancha. En un septiembre con cinco jornadas de Liga
 *    Nacional el mismo sábado, el reparto le daba 112 px de alto a cada una:
 *    barras de un día, 78 px de ancho en un móvil y 129 en un escritorio,
 *    estiradas hasta 112 px de alto para enseñar dos líneas de nombre y nada
 *    más. Un rectángulo alto y vacío. Una barra de un día no tiene sitio
 *    horizontal para ser tarjeta por mucho alto que se le dé, así que no se
 *    le da.
 *
 * 3. **Por reparto justo.** Si el mes solo tiene una o dos semanas con
 *    competiciones, esas semanas tienen derecho a más que la tabla base: es
 *    lo que convierte un mes flojo en tarjetas en vez de en barras finas con
 *    medio metro de hueco debajo.
 */
function techoDeBarra(
  franjas: number,
  anchoMinimo: number,
  porFila: number,
  fijo: number,
  compacta: boolean,
): number {
  /*
    Los dos techos de arriba salen de lo que el contenido necesita, no de un
    número redondo. Estaban en 44 y 84, y los dos se quedaban justo por
    debajo de lo que hacía falta:

    - Un torneo de **dos días** con la tarjeta a dos líneas de título ocupa
      89,8 px en un móvil (ver `ASPECTO`). Con el techo en 84 la tarjeta se
      pintaba igual y el título salía rebanado; con 96 cabe entera.
    - Una barra de **un día** pinta el nombre a varias líneas, porque a 61 px
      de ancho es lo único que distingue «Liga Nacional Oro 1ª Jornada» de
      «Liga Nacional Plata 1ª Jornada». Tres líneas son 43,5 px, así que con
      el techo en 44 se quedaba en dos y las tres barras del mismo sábado se
      leían las tres «Liga Nacion…». Con 48 entra la tercera línea.

    Son techos, no altos: si la semana va cargada manda `porFranjas`, y si el
    mes no da de sí manda el reparto justo. Subirlos solo cambia lo que pasa
    cuando hay sitio de sobra.
  */
  const porAncho = compacta
    ? anchoMinimo <= 1
      ? 30
      : 52
    : anchoMinimo <= 1
      ? 48
      : anchoMinimo === 2
        ? 96
        : 112;

  const porFranjas = compacta
    ? franjas <= 1
      ? 52
      : franjas === 2
        ? 34
        : franjas === 3
          ? 22
          : 17
    : franjas <= 1
      ? 84
      : franjas === 2
        ? 56
        : franjas === 3
          ? 34
          : franjas === 4
            ? 26
            : 22;

  const justo = franjas > 0 ? (porFila - fijo) / franjas : 0;
  return Math.min(porAncho, Math.max(porFranjas, justo));
}

/**
 * Alto de una semana sin competición: el natural y el mínimo.
 *
 * Bajo a propósito. Lo único que tiene que decir una semana vacía es «aquí no
 * hay nada», y para eso basta que se vean sus números: cada píxel que se le da
 * se lo quita a la semana que sí tiene competiciones, que es la que hay que
 * poder leer.
 */
const VACIA = {
  normal: { natural: 24, min: 15 },
  compacta: { natural: 19, min: 12 },
};

/** Alto de una racha de semanas vacías fundidas en una franja. */
const TRAMO = {
  normal: { natural: 38, min: 26 },
  compacta: { natural: 28, min: 20 },
};

/** Qué aspecto tiene una barra según el alto y el ancho que le han tocado. */
type Registro = 'tarjeta' | 'doble' | 'linea' | 'apretada';

function registroDe(alto: number, columnas: number): Registro {
  if (alto >= ASPECTO.tarjeta && columnas >= 2) return 'tarjeta';
  if (alto >= ASPECTO.doble) return 'doble';
  if (alto >= ASPECTO.linea) return 'linea';
  return 'apretada';
}

/**
 * Géneros que se tiran en un torneo.
 *
 * Las pruebas por equipos mixtos se marcan «Mx» y no se reparten en M y F: son
 * una prueba distinta, no las dos a la vez.
 */
function generosDe(evento: EventView): { codigo: string; largo: string }[] {
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
function categoriasDe(evento: EventView): string[] {
  const orden = Object.keys(CATEGORY_LABEL);
  return [...new Set(evento.competitions.map((c) => c.category))]
    .sort((a, b) => orden.indexOf(a) - orden.indexOf(b))
    .map((c) => CATEGORY_SHORT[c] ?? c);
}

function armasDe(evento: EventView): Weapon[] {
  const orden: Weapon[] = ['FLORETE', 'ESPADA', 'SABLE'];
  const hay = new Set(evento.competitions.map((c) => c.weapon));
  return orden.filter((a) => hay.has(a));
}

/**
 * Circuito, y solo cuando dice algo que el nombre del torneo no diga ya.
 *
 * «Copa del Mundo Júnior» con la etiqueta «C. Mundo Júnior» encima es la misma
 * frase dos veces y ocupa una línea de la tarjeta. Si la sigla corta del
 * circuito ya está dentro del nombre, se calla.
 */
function circuitoDe(evento: EventView): string | null {
  const corto = nombreDeCircuito(evento.circuit) ?? CIRCUIT_LABEL[evento.circuit];
  if (!corto) return null;
  const nombre = titularTorneo(evento.name).toLowerCase();
  const clave = corto.toLowerCase().replace(/[.\s]+/g, ' ').trim();
  const nucleo = clave.split(' ').filter((p) => p.length > 3);
  if (nucleo.length > 0 && nucleo.every((p) => nombre.includes(p))) return null;
  if (nombre.includes(clave)) return null;
  return corto;
}

/**
 * EL NOMBRE APRETADO, PARA QUE QUEPA ENTERO EN UNA COLUMNA DE UN DÍA.
 *
 * Medido en un iPhone: una columna de un día mide 61 px y al nombre le quedan
 * 49 de texto, que a `0.68rem` son unos ocho caracteres por línea. A tres
 * líneas caben veinticuatro, y «Liga Nacional Iberdrola 1ª Jornada» tiene
 * treinta y cuatro. Resultado en producción: las tres jornadas del mismo
 * sábado se leían **«Liga Nacion…», «Liga Nacion…» y «Liga Nacion…»**, tres
 * barras idénticas para tres competiciones distintas, porque lo que las
 * distingue —Iberdrola, Oro, Plata— está justo detrás del corte.
 *
 * Lo que sobra son las palabras que **comparten todas**. Apretadas, quedan en
 * «Liga Iberdrola 1ª J.», «Liga Oro 1ª J.» y «Liga Plata 1ª J.»: veinte
 * caracteres o menos, caben, y se distinguen a la primera.
 *
 * Dos condiciones:
 *
 * - **No se inventa ninguna abreviatura.** Las de la tabla son las que la
 *   aplicación ya publica en `CIRCUIT_SHORT` («Cto. España», «C. Mundo
 *   Cadete»), así que el vocabulario es el mismo que se ve en el resto de la
 *   interfaz.
 * - **Solo se acortan las palabras que no distinguen.** Ninguna regla toca un
 *   nombre propio ni un número: «Iberdrola», «Oro», «Plata», «PFCAR», «1ª» y
 *   «M-14» salen intactos. Y solo se aplica en el móvil: a partir de `sm` la
 *   columna mide 237 px y el nombre entero cabe de sobra.
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

function apretarNombre(nombre: string): string {
  return APRETAR.reduce((n, [de, a]) => n.replace(de, a), nombre)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * El nombre del torneo: apretado en el móvil, entero a partir de `sm`.
 *
 * Se resuelve con dos nodos y una clase en vez de midiendo, porque lo que
 * decide si cabe es la anchura de la columna y esa la pone el `grid`: en un
 * teléfono son 61 px y en un escritorio 237. Si la versión apretada coincide
 * con la entera —lo normal, la tabla solo pilla unos cuantos nombres— se
 * pinta un solo nodo.
 */
function NombreApretado({
  nombre,
  siempre = false,
}: {
  nombre: string;
  /**
   * Apretado en todos los tamaños.
   *
   * Es el caso del **trimestre**, donde lo que aprieta no es la pantalla sino
   * la vista: a 1440 px los tres meses se reparten 1288, así que una columna
   * de sábado mide 84 px en un escritorio, menos que el sábado del móvil en la
   * vista de un mes. Medido en la auditoría, con el nombre entero salía «Liga
   * Nacional Oro 1ª ...» y las tres jornadas del mismo día se leían iguales.
   * Apretado cabe «Liga Oro 1ª J.», que es lo que las distingue.
   */
  siempre?: boolean;
}) {
  const corto = apretarNombre(nombre);
  if (corto === nombre) return <>{nombre}</>;
  if (siempre) return <>{corto}</>;
  return (
    <>
      <span className="sm:hidden">{corto}</span>
      <span className="hidden sm:inline">{nombre}</span>
    </>
  );
}

/**
 * Cuánto queda de plazo, con su tono del semáforo.
 *
 * Se coge el plazo que antes cierra de todas las pruebas: es el que aprieta.
 * Si la fuente no publica plazo **no se dice nada**; inventar «cierra pronto»
 * sería peor que el silencio.
 */
function plazoDe(evento: EventView): { texto: string; tono: string } | null {
  const abiertas = evento.competitions.filter((c) => !c.status.closed);
  const dias = abiertas
    .map((c) => c.status.daysLeft)
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b)[0];

  if (dias === undefined) {
    if (abiertas.length === 0 && evento.competitions.length > 0) {
      return { texto: 'Inscripción cerrada', tono: 'text-muted-foreground' };
    }
    return null;
  }

  const tono =
    dias <= 3 ? 'text-danger' : dias <= 10 ? 'text-warn' : 'text-muted-foreground';
  if (dias === 0) return { texto: 'cierra hoy', tono: 'text-danger' };
  return { texto: `cierra en ${dias} ${dias === 1 ? 'día' : 'días'}`, tono };
}

/**
 * Dónde se tira.
 *
 * Con el país, porque «Padua» y «Plovdiv» no le dicen a nadie a qué distancia
 * están, y a la hora de pedir días y billetes eso es justo lo que se está
 * decidiendo. Si no hay sitio para el país, se queda la ciudad sola.
 */
function sede(evento: EventView, conPais: boolean): string {
  const ciudad = evento.city ? titular(evento.city) : '';
  if (!conPais || !evento.country) return ciudad;
  return ciudad ? `${ciudad}, ${evento.country}` : evento.country;
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function sumarDias(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const DIA_MES = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });

/** «31 ago» sin el punto que Intl pone en algunos meses. */
function diaYMes(iso: string): string {
  return DIA_MES.format(new Date(`${iso}T12:00:00`)).replace('.', '');
}

type Barra = {
  evento: EventView;
  /** Columna 0-6 donde empieza dentro de esta semana. */
  desde: number;
  /** Cuántas columnas ocupa. */
  ancho: number;
  carril: number;
  /** Si el torneo viene de la semana anterior o sigue en la siguiente. */
  continuaAntes: boolean;
  continuaDespues: boolean;
};

type Semana = {
  dias: { iso: string; dia: number; delMes: boolean; esHoy: boolean; pasado: boolean }[];
  barras: Barra[];
  carriles: number;
};

/** Una fila de la rejilla: o una semana, o una racha de semanas vacías. */
type Fila =
  | { tipo: 'semana'; semana: Semana }
  | { tipo: 'tramo'; desde: string; hasta: string; cuantas: number; clave: string };

/**
 * Reparte los eventos de una semana en carriles.
 *
 * Se ordenan por inicio y, a igualdad, por duración descendente: los torneos
 * largos se llevan el carril de arriba y los cortos rellenan los huecos, que
 * es como se lee mejor.
 */
function repartirEnCarriles(
  eventos: EventView[],
  inicioSemana: Date,
  finSemana: Date,
): { barras: Barra[]; carriles: number } {
  const isoInicio = isoLocal(inicioSemana);
  const isoFin = isoLocal(finSemana);

  const enLaSemana = eventos
    .filter((e) => e.startDate <= isoFin && e.endDate >= isoInicio)
    .sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
      const durA = a.endDate.localeCompare(a.startDate);
      const durB = b.endDate.localeCompare(b.startDate);
      return durB - durA;
    });

  const ocupacion: boolean[][] = [];
  const barras: Barra[] = [];

  for (const evento of enLaSemana) {
    const desde = Math.max(
      0,
      Math.round(
        (new Date(`${evento.startDate}T12:00:00`).getTime() -
          new Date(`${isoInicio}T12:00:00`).getTime()) /
          86_400_000,
      ),
    );
    const hasta = Math.min(
      6,
      Math.round(
        (new Date(`${evento.endDate}T12:00:00`).getTime() -
          new Date(`${isoInicio}T12:00:00`).getTime()) /
          86_400_000,
      ),
    );
    const ancho = Math.max(1, hasta - desde + 1);

    let carril = 0;
    for (;;) {
      ocupacion[carril] ??= Array.from({ length: 7 }, () => false);
      const libre = ocupacion[carril]
        .slice(desde, desde + ancho)
        .every((ocupado) => !ocupado);
      if (libre) break;
      carril += 1;
    }
    for (let i = desde; i < desde + ancho; i += 1) ocupacion[carril][i] = true;

    barras.push({
      evento,
      desde,
      ancho,
      carril,
      continuaAntes: evento.startDate < isoInicio,
      continuaDespues: evento.endDate > isoFin,
    });
  }

  return { barras, carriles: ocupacion.length };
}

/**
 * Último día que se ve en la rejilla de un mes.
 *
 * No es el 30 ni el 31: la rejilla empieza el lunes anterior al día 1 y acaba
 * el domingo de su última semana, así que un septiembre enseña hasta el 4 de
 * octubre. Hace falta saberlo fuera de aquí para no repetir en «lo que viene
 * después» un torneo que ya se está viendo en la rejilla.
 *
 * La regla de la sexta semana es la misma que en `construirSemanas`: solo se
 * pinta si alguno de sus días es del mes.
 */
export function finDeLaRejilla(ancla: Date): string {
  const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1);
  const inicio = sumarDias(primero, -((primero.getDay() + 6) % 7));
  return isoLocal(sumarDias(inicio, (haySextaSemana(ancla) ? 6 : 5) * 7 - 1));
}

/**
 * Primer día que se ve en la rejilla de un mes: el lunes anterior al día 1.
 *
 * Lo necesita la agenda del móvil, que pinta exactamente el mismo tramo que la
 * rejilla del escritorio. Si los dos no coincidieran, cambiar de tamaño de
 * pantalla cambiaría **qué competiciones hay**, que es lo último que puede
 * pasar en un calendario.
 */
export function inicioDeLaRejilla(ancla: Date): string {
  const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1);
  return isoLocal(sumarDias(primero, -((primero.getDay() + 6) % 7)));
}

/** La sexta semana solo se pinta si alguno de sus días es del mes. */
function haySextaSemana(ancla: Date): boolean {
  const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1);
  const inicio = sumarDias(primero, -((primero.getDay() + 6) % 7));
  const sexta = sumarDias(inicio, 5 * 7);
  return (
    sexta.getMonth() === ancla.getMonth() ||
    sumarDias(sexta, 6).getMonth() === ancla.getMonth()
  );
}

function construirSemanas(ancla: Date, eventos: EventView[]): Semana[] {
  // Hoy en hora española, no en la del que ejecuta: ver `hoyMadrid`.
  const hoy = hoyMadrid();
  const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1);
  // getDay() da 0 para domingo; aquí la semana empieza en lunes.
  const inicio = sumarDias(primero, -((primero.getDay() + 6) % 7));

  const semanas: Semana[] = [];
  for (let s = 0; s < 6; s += 1) {
    const inicioSemana = sumarDias(inicio, s * 7);
    const finSemana = sumarDias(inicioSemana, 6);

    const dias = Array.from({ length: 7 }, (_, i) => {
      const d = sumarDias(inicioSemana, i);
      const iso = isoLocal(d);
      return {
        iso,
        dia: d.getDate(),
        delMes: d.getMonth() === ancla.getMonth(),
        esHoy: iso === hoy,
        pasado: iso < hoy,
      };
    });

    // Una sexta semana entera fuera del mes no aporta nada y obliga a hacer
    // scroll en el móvil.
    if (s === 5 && dias.every((d) => !d.delMes)) break;

    const { barras, carriles } = repartirEnCarriles(eventos, inicioSemana, finSemana);
    semanas.push({ dias, barras, carriles });
  }

  return semanas;
}

/**
 * Funde las rachas de dos o más semanas vacías en una sola franja.
 *
 * Una sola semana vacía se queda con sus siete celdas: hace falta para leer el
 * mes y cuesta 30 px. Tres seguidas costaban 216 px para decir «no hay nada»,
 * y eso es exactamente lo que el usuario llamó «no aprovechas nada bien los
 * espacios».
 */
function agruparFilas(semanas: Semana[]): Fila[] {
  const filas: Fila[] = [];
  let i = 0;
  while (i < semanas.length) {
    if (semanas[i].carriles > 0) {
      filas.push({ tipo: 'semana', semana: semanas[i] });
      i += 1;
      continue;
    }
    let j = i;
    while (j < semanas.length && semanas[j].carriles === 0) j += 1;
    const cuantas = j - i;
    if (cuantas >= 2) {
      filas.push({
        tipo: 'tramo',
        desde: semanas[i].dias[0].iso,
        hasta: semanas[j - 1].dias[6].iso,
        cuantas,
        clave: `tramo-${semanas[i].dias[0].iso}`,
      });
    } else {
      filas.push({ tipo: 'semana', semana: semanas[i] });
    }
    i = j;
  }
  return filas;
}

/**
 * Mide una caja y devuelve su alto en píxeles.
 *
 * EL SALTO AL CARGAR, Y POR QUÉ ESTABAN MAL LAS DOS COSAS
 * -------------------------------------------------------
 * Aquí había un comentario que decía: «devuelve 0 hasta el primer dibujado, y
 * con 0 se usa el mínimo… así no hay salto feo en la primera pintada». Era al
 * revés: **eso ERA el salto**, y el usuario lo notó sin saber nombrarlo —*«al
 * cargar hace algo raro, como que cambia de tamaño el calendario»*—. Medido:
 *
 *   1440×900   barras 19 → 21 px,  caja del mes 574 → 644 px   (CLS 0,019)
 *   2560×1400  barras 19 → 41 px,  caja del mes 574 → 1144 px  (CLS 0,085)
 *   iPhone     barras 19 → 20 px,  y **25 barras se replegaron a 11**
 *
 * En una pantalla grande el mes crecía **570 píxeles** entre la primera
 * pintada y la segunda. En el móvil era peor de otra forma: se pintaban 25
 * barras y luego catorce desaparecían dentro del «+N».
 *
 * Y hacían falta **dos** arreglos, no uno:
 *
 * 1. `useLayoutEffect` en vez de `useEffect`, para medir antes de que el
 *    navegador pinte.
 * 2. **Una medida a mano antes de observar.** Con solo lo primero el salto no
 *    desaparece, porque el callback de `ResizeObserver` es asíncrono *siempre*:
 *    se ejecuta después del primer pintado por definición, así que sin esta
 *    lectura sincrónica la primera pasada sigue yendo con 0.
 *
 * `useLayoutEffect` no existe en el servidor y React avisa por consola, así
 * que se elige según el entorno: en el servidor no hay nada que medir.
 */
const useEfectoDeMedida =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

function useAltoDisponible<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [alto, setAlto] = React.useState(0);

  useEfectoDeMedida(() => {
    const el = ref.current;
    if (!el) return;

    // La medida sincrónica: esta es la que quita el salto.
    setAlto(el.getBoundingClientRect().height);

    const ro = new ResizeObserver(([entrada]) => {
      setAlto(entrada.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, alto] as const;
}

type Plan = {
  /** Alto de barra de cada fila. Una por fila, no una para todo el mes. */
  altos: number[];
  /** Franjas que puede pintar cada fila (barras + la del «+N»). */
  topes: number[];
  altoVacia: number;
  altoTramo: number;
  /**
   * Píxeles que sobran cuando todo ha llegado a su techo.
   *
   * Hace falta porque el sobrante NO puede repartirse con `flex-grow` entre
   * las filas con competiciones: se vio renderizado y era el peor hueco de
   * todos. En un septiembre con un solo torneo, la fila de la última semana
   * crecía a 600 px para pintar una tarjeta de 84 y quedaba medio metro de
   * vacío dentro del recuadro, que parecía un fallo de dibujado. El sobrante
   * se lo quedan las franjas de «aquí no hay nada», que es donde crecer
   * significa algo: que ese mes está libre.
   */
  holgura: number;
};

/**
 * Reparte el alto medido entre las filas del mes.
 *
 * Dos direcciones:
 *
 * - **Si no cabe**, ceden por este orden: las semanas vacías y las franjas de
 *   «no hay nada» (donde no se pierde información), luego las franjas de las
 *   semanas más cargadas —lo que se queda fuera va al «+N» de la semana—, y
 *   por último el alto de barra baja de su mínimo hasta el suelo. Con eso la
 *   rejilla **no se puede salir por abajo**, que era un fallo visible: el
 *   `overflow-hidden` rebanaba la última semana por la mitad.
 * - **Si cabe**, se sube el alto de todas las filas a la vez con un único
 *   mando `k`, desde el mínimo hasta el techo de cada una. Como el techo
 *   depende de cuántas franjas tiene la semana, las semanas flojas se llevan
 *   el sitio que sobra y se convierten en tarjetas, y las cargadas se quedan
 *   en barra. `k` se busca por bisección: `coste(k)` crece con `k`, así que
 *   veinte pasadas bastan y no hace falta iterar píxel a píxel.
 */
function planificar(filas: Fila[], disponible: number, compacta: boolean): Plan {
  const min = compacta ? MIN_BARRA.compacta : MIN_BARRA.normal;
  const cabecera = compacta ? CABECERA.compacta : CABECERA.normal;
  const vacia = compacta ? VACIA.compacta : VACIA.normal;
  const tramo = compacta ? TRAMO.compacta : TRAMO.normal;

  /** Carriles reales de cada fila. 0 = vacía o franja de «no hay nada». */
  const carriles = filas.map((f) => (f.tipo === 'semana' ? f.semana.carriles : 0));
  const topes = [...carriles];

  let altoVacia = vacia.natural;
  let altoTramo = tramo.natural;

  const fijo = (t: number) => cabecera + t * HUECO_BARRA + 4;

  const coste = (altos: number[]) =>
    filas.reduce((n, f, i) => {
      if (f.tipo === 'tramo') return n + altoTramo;
      if (carriles[i] === 0) return n + altoVacia;
      return n + fijo(topes[i]) + topes[i] * altos[i];
    }, 0);

  const plano = (v: number) => filas.map(() => v);

  if (disponible <= 0) {
    return { altos: plano(min), topes, altoVacia, altoTramo, holgura: 0 };
  }

  // ---------------------------------------------------------------- no cabe
  if (coste(plano(min)) > disponible) {
    // 1) Lo primero que cede es lo que no lleva información: las vacías.
    const vacias = filas.filter((f, i) => f.tipo === 'semana' && carriles[i] === 0).length;
    const tramos = filas.filter((f) => f.tipo === 'tramo').length;
    const cede = vacias * (vacia.natural - vacia.min) + tramos * (tramo.natural - tramo.min);
    if (cede > 0) {
      const f = Math.min(1, (coste(plano(min)) - disponible) / cede);
      altoVacia = vacia.natural - f * (vacia.natural - vacia.min);
      altoTramo = tramo.natural - f * (tramo.natural - tramo.min);
    }

    // 2) Luego se recortan franjas, empezando por las semanas más cargadas,
    //    de modo que el recorte se reparta y ninguna se quede con un torneo
    //    mientras otra enseña ocho. Nunca por debajo de dos: una barra y el
    //    «+N».
    let guarda = 0;
    while (coste(plano(min)) > disponible && guarda < 800) {
      guarda += 1;
      let peor = -1;
      for (let i = 0; i < topes.length; i += 1) {
        if (topes[i] > 2 && (peor === -1 || topes[i] > topes[peor])) peor = i;
      }
      if (peor === -1) break;
      topes[peor] -= 1;
    }

    /**
     * 3) Antes de esconder una semana entera, la barra baja de su mínimo.
     *
     *    Este orden importa y se decidió mirando la captura. Con el orden
     *    contrario —recortar hasta una sola franja y luego encoger— la
     *    dirección técnica en un iPhone con los filtros abiertos veía un mes
     *    con **cinco franjas de «+13, +11, +7, +12, +4» y ni un torneo**. Un
     *    calendario que no enseña ninguna competición no es un calendario.
     *    Con este orden, cada semana conserva una barra legible de 15 px y su
     *    «+N» al lado, que responde a algo.
     */
    const franjas = topes.reduce((n, t) => n + t, 0);
    if (franjas > 0 && coste(plano(min)) > disponible) {
      const fijoTotal = coste(plano(0));
      const cabe = (disponible - fijoTotal) / franjas;
      if (cabe >= SUELO_BARRA) {
        return { altos: plano(cabe), topes, altoVacia, altoTramo, holgura: 0 };
      }
    }

    /**
     * 4) Y si ni con la barra en el suelo cabe, entonces sí: una semana se
     *    queda solo con su «+N». Es el último recurso, y sigue siendo mejor
     *    que media semana rebanada por el `overflow`, que parecía un error de
     *    dibujado.
     */
    guarda = 0;
    while (coste(plano(SUELO_BARRA)) > disponible && guarda < 800) {
      guarda += 1;
      let peor = -1;
      for (let i = 0; i < topes.length; i += 1) {
        if (topes[i] >= 2 && (peor === -1 || topes[i] > topes[peor])) peor = i;
      }
      if (peor === -1) break;
      topes[peor] = 1;
    }

    const restantes = topes.reduce((n, t) => n + t, 0);
    if (restantes > 0) {
      const fijoTotal = coste(plano(0));
      return {
        altos: plano(Math.max(SUELO_BARRA, (disponible - fijoTotal) / restantes)),
        topes,
        altoVacia,
        altoTramo,
        holgura: 0,
      };
    }

    return { altos: plano(min), topes, altoVacia, altoTramo, holgura: 0 };
  }

  // ------------------------------------------------------------------- cabe
  /**
   * Cuánto le toca a cada semana con competiciones, descontando lo que ya
   * tienen apalabrado las vacías. Es la base del reparto justo del techo.
   */
  const conBarras = topes.filter((t) => t > 0).length;
  const paraBarras =
    disponible -
    filas.reduce((n, f, i) => {
      if (f.tipo === 'tramo') return n + altoTramo;
      if (carriles[i] === 0) return n + altoVacia;
      return n;
    }, 0);
  const porFila = conBarras > 0 ? paraBarras / conBarras : 0;

  const techos = topes.map((t, i) => {
    if (t === 0) return min;
    const fila = filas[i];
    const anchoMinimo =
      fila.tipo === 'semana' && fila.semana.barras.length > 0
        ? Math.min(...fila.semana.barras.map((b) => b.ancho))
        : 1;
    return Math.max(min, techoDeBarra(t, anchoMinimo, porFila, fijo(t), compacta));
  });

  let bajo = 0;
  let alto = 1;
  for (let it = 0; it < 20; it += 1) {
    const k = (bajo + alto) / 2;
    const prueba = techos.map((tc) => min + k * (tc - min));
    if (coste(prueba) <= disponible) bajo = k;
    else alto = k;
  }
  const altos = techos.map((tc) => min + bajo * (tc - min));

  /**
   * Y si aun con todo al techo sobra sitio, las franjas de «aquí no hay nada»
   * crecen, pero **poco**: hasta el doble de su alto natural y no más.
   *
   * El límite viene de haberlo mirado sin él: en un septiembre de escritorio
   * con una sola semana con competiciones, la franja de «sin competiciones
   * del 31 ago al 27 sept» se llevó 480 px y quedó un socavón con una línea
   * de texto flotando en el medio. Una franja que dice que no hay nada no
   * mejora por ser más alta. Lo que sobre después se queda **fuera** del
   * recuadro de la rejilla, que por eso se ajusta a su contenido.
   */
  let holgura = Math.max(0, disponible - coste(altos));
  if (holgura > 8) {
    const huecas = filas.filter((f, i) => f.tipo === 'tramo' || carriles[i] === 0).length;
    if (huecas > 0) {
      const reparto = holgura / huecas;
      const antes = altoVacia + altoTramo;
      altoVacia = Math.min(vacia.natural * 2, altoVacia + reparto);
      altoTramo = Math.min(tramo.natural * 2, altoTramo + reparto);
      holgura = Math.max(0, holgura - (altoVacia + altoTramo - antes) * huecas);
    }
  }

  return { altos, topes, altoVacia, altoTramo, holgura };
}

export function RejillaMes({
  ancla,
  eventos,
  compacta = false,
  inscripciones,
  resaltados,
  proximo,
  mostrarArma = true,
  mostrarGenero = true,
  mostrarCategoria = true,
  relleno,
  onHueco,
  onAbrirEvento,
}: {
  ancla: Date;
  eventos: EventView[];
  /** En trimestre las barras son más bajas, pero siguen llevando texto. */
  compacta?: boolean;
  /** competitionId -> estado, para marcar en qué estás inscrito. */
  inscripciones: Record<string, string>;
  /**
   * Torneos que coinciden con la búsqueda. Buscar no esconde nada: lleva al
   * mes y resalta el que se buscaba, así que al llegar se ve cuál era.
   */
  resaltados?: Set<string>;
  /** El torneo del marcador de arriba, para que el ojo una las dos cosas. */
  proximo?: string | null;
  /**
   * Arma, género y categoría en la barra: solo cuando el filtro abarca más de
   * uno.
   *
   * Una tiradora que ve el calendario filtrado por espada femenina absoluto no
   * necesita «ESP F Abs» repetido en cada barra: es el 100 % de lo que está
   * mirando, así que no informa de nada y se lleva 80 px del nombre del torneo
   * justo donde menos sitio hay, que es el móvil. Medido en una barra de
   * sábado a domingo en un iPhone: con las tres pastillas el nombre se queda
   * en «Eurofen…»; sin ellas cabe «Eurofence League» entero.
   *
   * Para la dirección técnica, que mira las tres armas y los dos géneros, las
   * pastillas aparecen, porque ahí sí distinguen una barra de otra.
   */
  mostrarArma?: boolean;
  mostrarGenero?: boolean;
  mostrarCategoria?: boolean;
  /**
   * Qué pintar debajo del recuadro cuando el mes no llena la pantalla.
   *
   * La rejilla no decide **qué** va ahí —no es asunto suyo—, solo dice cuánto
   * sitio le sobra (`onHueco`) y lo coloca. Con el mes lleno no se pinta nada.
   */
  relleno?: React.ReactNode;
  /** Píxeles que le sobran al mes después de repartir el alto. */
  onHueco?: (px: number) => void;
  onAbrirEvento: (e: EventView) => void;
}) {
  const semanas = React.useMemo(
    () => construirSemanas(ancla, eventos),
    [ancla, eventos],
  );
  const filas = React.useMemo(() => agruparFilas(semanas), [semanas]);

  const [caja, disponible] = useAltoDisponible<HTMLDivElement>();
  const plan = planificar(filas, disponible, compacta);

  /*
    El hueco se avisa en un efecto y redondeado: el plan se recalcula en cada
    dibujado y un `holgura` con decimales haría que el aviso se disparara
    siempre, aunque el hueco fuera el mismo.
  */
  const hueco = Math.round(plan.holgura);
  React.useEffect(() => {
    onHueco?.(hueco);
  }, [onHueco, hueco]);

  return (
    <TooltipProvider delayDuration={180} skipDelayDuration={400}>
      <div className="flex min-h-0 flex-1 flex-col">
        {/*
          Cabecera de días, alineada con las columnas desiguales.

          POR QUÉ YA NO SE APAGAN LUNES A MIÉRCOLES
          -----------------------------------------
          Aquí L-M-X iban al 45 % de opacidad, y la idea era buena: son las
          columnas estrechas —lunes a miércoles se llevan el 16 % de las
          competiciones— y apagarlas decía que la anchura es a propósito y no
          un descuadre.

          Salió al revés. El usuario mandó una captura de móvil preguntando
          **qué pasaba con los días de la semana**: a ese contraste, sobre
          negro y a 12 px, simplemente no se ven. Un rótulo de columna que no
          se lee no informa de nada, y menos aún de una intención.

          Así que todos se leen igual, y lo que se distingue ahora es **el fin
          de semana**, que es la información útil de verdad: el 70 % de las
          competiciones caen en sábado o domingo.

          Y va con superficie y filete, unida al recuadro de abajo. Antes
          flotaba sobre el lienzo, separada de la rejilla que encabeza, y por
          eso no se leía como su cabecera.
        */}
        <div
          className="grid rounded-t-lg border border-b-0 border-border/50 bg-card pt-1.5 pb-1.5"
          style={{ gridTemplateColumns: PLANTILLA_COLUMNAS }}
          aria-hidden
        >
          {DIAS.map((d, i) => (
            <div
              key={d}
              className={cn(
                'text-center text-xs font-semibold',
                // Sábado y domingo, donde de verdad se compite.
                i >= 5 ? 'text-foreground/85' : 'text-muted-foreground',
              )}
            >
              {d}
            </div>
          ))}
        </div>

        {/*
          Dos capas a propósito, y el recuadro va en la de DENTRO.

          La de fuera es la que MIDE: como las filas van dentro de una capa
          absoluta, no pueden estirarla, y por eso su alto es el hueco de
          verdad que hay en pantalla. Midiendo la caja que contiene las filas,
          las filas la estiraban, la medida crecía y nunca se concluía que no
          cabía: el mes se salía por abajo y la última semana salía rebanada.

          El recuadro y el filete van en la capa de dentro, que se ancla arriba
          y crece hasta `max-h-full`. Así, cuando el mes no da para llenar la
          pantalla —un septiembre con una sola semana con competiciones—, la
          rejilla **acaba donde acaba el mes** y lo que sobra se queda fuera,
          con el fondo de la aplicación y su textura. Con el recuadro en la
          capa de fuera, ese sobrante quedaba DENTRO del borde y se veía como
          un socavón de medio metro dentro de una caja: parecía un fallo.

          -------------------------------------------------------------------
          Y LLEVA SUPERFICIE OPACA. LA TEXTURA SE QUEDA FUERA.
          -------------------------------------------------------------------
          Antes no tenía fondo propio, a propósito: la idea era que la rejilla
          fuera «bandas separadas por filetes sobre el fondo de la
          aplicación». Visto en la captura de producción, no se sostiene: las
          cuñas diagonales y la retícula de cruces del lienzo cruzan las
          celdas vacías y se llevan la mirada antes que las competiciones. El
          usuario lo dijo así: «los fondos esos del calendario son horribles,
          llama mucho la atención en el fondo del calendario».

          Y es la regla que ya estaba escrita: la textura va «todo por debajo
          del contenido y con opacidad baja; **si tapa una letra, sobra**»
          (`REFERENCIAS.md` § 1). Dentro de una rejilla de datos, la textura
          es ruido. Con `bg-card` el relieve del lienzo se ve **alrededor**
          —en los márgenes, detrás de la cabecera, detrás del marcador— y el
          calendario se lee sobre una superficie limpia.
        */}
        <div
          ref={caja}
          /*
            Gancho estable para los guiones de `tests/ui`, igual que
            `data-barra="torneo"`: esta caja ES el alto que reparte
            `planificar()`, así que es el número que hay que poder medir desde
            fuera para comparar un rediseño con el anterior. Localizarla por
            su clase de maquetación ya se rompió una vez.
          */
          data-rejilla="hueco"
          className="relative min-h-0 flex-1"
        >
          <div className="absolute inset-0 flex flex-col gap-2 sm:gap-3">
          <div
            className={cn(
              'flex min-h-0 flex-col overflow-hidden rounded-b-lg border border-t-0 border-border/50 bg-card',
              /*
                EL SUELO DEL TRIMESTRE, QUE ESTABA ROTO.
                Los tres meses acababan a alturas distintas —medido en la
                auditoría: 600, 580 y 715 px— porque la caja se ajustaba a su
                contenido y cada mes tiene sus semanas. Tres recuadros
                desalineados se leen como tres tarjetas mal puestas, no como
                un trimestre.

                Con `flex-1` la caja llena su columna y el sobrante se lo
                quedan las semanas vacías y las franjas de «aquí no hay nada»,
                que es exactamente el reparto que ya hace `planificar()` con
                la holgura. En la vista de un mes NO se pone, porque ahí el
                sobrante es de la pantalla y no del mes: estirarlo dejaba un
                socavón de medio metro dentro del recuadro.
              */
              compacta && 'flex-1',
            )}
          >
            {filas.map((fila, i) =>
              fila.tipo === 'tramo' ? (
                <TramoVacio
                  key={fila.clave}
                  fila={fila}
                  alto={plan.altoTramo}
                  absorbe={plan.holgura > 8}
                  ultima={i === filas.length - 1}
                />
              ) : (
                <FilaSemana
                  key={fila.semana.dias[0].iso}
                  semana={fila.semana}
                  compacta={compacta}
                  altoBarra={plan.altos[i]}
                  altoVacia={plan.altoVacia}
                  tope={plan.topes[i]}
                  holgura={plan.holgura > 8}
                  ultima={i === filas.length - 1}
                  inscripciones={inscripciones}
                  resaltados={resaltados}
                  proximo={proximo}
                  mostrarArma={mostrarArma}
                  mostrarGenero={mostrarGenero}
                  mostrarCategoria={mostrarCategoria}
                  onAbrirEvento={onAbrirEvento}
                />
              ),
            )}
          </div>

            {/*
              EL SITIO QUE EL MES NO USA.

              Un septiembre de espada femenina tiene una competición, así que
              la rejilla acaba a los 190 px y en un escritorio quedaban **463
              px de nada** entre el recuadro y la leyenda. Ese hueco no se
              arregla estirando las filas —se probó y dejaba un socavón dentro
              del recuadro, que es peor— sino dándoselo a algo que responda a
              una pregunta. Quien mira un mes vacío está preguntando
              exactamente una cosa: «¿y entonces cuándo compito?».

              Va aquí dentro, en la capa absoluta, y no como hermano de la
              rejilla, por una razón de medida: así no puede cambiar el alto
              disponible y por tanto no puede cambiar el plan del mes. Si
              estuviera en el flujo, el relleno le quitaría sitio a la rejilla,
              la rejilla dejaría menos hueco, el relleno encogería… y el
              tamaño no pararía nunca de recalcularse.
            */}
            {relleno && plan.holgura > 8 ? (
              <div className="min-h-0 flex-1 overflow-hidden">{relleno}</div>
            ) : null}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

/**
 * Franja de «aquí no hay nada».
 *
 * Dice de cuándo a cuándo, que es la información que de verdad hacía falta y
 * que veintiún números en veintiuna celdas no daban: «sin competiciones del 31
 * ago al 20 sep» se lee de un tirón.
 */
function TramoVacio({
  fila,
  alto,
  absorbe,
  ultima,
}: {
  fila: { desde: string; hasta: string; cuantas: number };
  alto: number;
  /** Hay sobrante en el mes y es esta franja la que se lo queda. */
  absorbe: boolean;
  ultima: boolean;
}) {
  return (
    <div
      className={cn(
        /*
          `bg-background` y no `bg-black/20`: la franja tiene que leerse más
          hundida que el resto de la rejilla, y con el lienzo texturado debajo
          un negro al 20 % no es «un poco más oscuro», es **una ventana a la
          textura**: por ahí se colaba la cuña diagonal. El fondo de la
          aplicación es 0,17 de luminosidad contra el 0,215 de la superficie
          de la rejilla, así que hunde igual y es opaco.
        */
        'flex items-center gap-2 bg-background px-2.5',
        !ultima && 'border-b border-border/40',
      )}
      style={{ minHeight: alto, flex: absorbe ? '1 1 auto' : '0.45 1 0%' }}
    >
      <span className="h-px flex-1 bg-border" aria-hidden />
      {/*
        CUÁNTAS SEMANAS SON, Y NO SOLO ENTRE QUÉ FECHAS.

        La franja decía «Sin competiciones, del 31 ago al 27 sept» y había que
        contar con los dedos para saber que eso son cuatro semanas, justo en el
        sitio donde el resto de la rejilla sí enseña sus filas de días. La
        cifra delante responde a la pregunta —cuánto tiempo estoy sin
        competir— y la hace la parte que pesa, que es el recurso de la casa: la
        cifra grande con la palabra pequeña al lado.
      */}
      <span className="shrink-0 text-xs text-muted-foreground">
        <span className="cifra text-[1.05em] text-foreground">{fila.cuantas}</span>{' '}
        semanas sin competiciones, del{' '}
        <span className="cifra text-[0.95em] text-foreground/70">
          {diaYMes(fila.desde)}
        </span>{' '}
        al{' '}
        <span className="cifra text-[0.95em] text-foreground/70">
          {diaYMes(fila.hasta)}
        </span>
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

function FilaSemana({
  semana,
  compacta,
  altoBarra,
  altoVacia,
  tope,
  holgura,
  ultima,
  inscripciones,
  resaltados,
  proximo,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
  onAbrirEvento,
}: {
  semana: Semana;
  compacta: boolean;
  altoBarra: number;
  /** Alto de una semana sin competición, ya apretado si hacía falta. */
  altoVacia: number;
  /** Franjas que caben. Lo que pase de aquí se resume en un «+N». */
  tope: number;
  /**
   * El mes no llena la pantalla. Entonces esta fila se queda con lo que mide
   * su contenido y no crece: crecer una fila con competiciones deja un
   * boquete debajo de las barras, y eso se vio renderizado y parecía un fallo.
   * El sobrante se lo quedan las semanas vacías.
   */
  holgura: boolean;
  ultima: boolean;
  inscripciones: Record<string, string>;
  resaltados?: Set<string>;
  proximo?: string | null;
  mostrarArma: boolean;
  mostrarGenero: boolean;
  mostrarCategoria: boolean;
  onAbrirEvento: (e: EventView) => void;
}) {
  const cabecera = compacta ? CABECERA.compacta : CABECERA.normal;
  const vacia = semana.barras.length === 0;
  const recorta = semana.carriles > tope;
  // Con recorte, la última franja se reserva para el «+N».
  const carrilesPintados = recorta ? Math.max(0, tope - 1) : semana.carriles;

  const visibles = semana.barras.filter((b) => b.carril < carrilesPintados);
  const ocultas = semana.barras.filter((b) => b.carril >= carrilesPintados);

  /**
   * Alto de la fila.
   *
   * El **suelo** es exactamente lo que ocupan sus franjas con el alto que se
   * acaba de calcular, así que una barra nunca se sale de su semana. El
   * **sobrante** se reparte con `flex-grow` en proporción a lo que pasa esa
   * semana, para que el calendario llene el alto de la pantalla en vez de
   * dejar un hueco debajo.
   */
  const franjas = vacia ? 0 : carrilesPintados + (recorta ? 1 : 0);
  const altoMinimo = vacia ? altoVacia : cabecera + franjas * (altoBarra + HUECO_BARRA) + 4;
  const peso = vacia ? 0.7 : 1.35 + (franjas - 1) * 0.5;

  return (
    <div
      className={cn('relative grid', !ultima && 'border-b border-border/40')}
      style={{
        gridTemplateColumns: PLANTILLA_COLUMNAS,
        minHeight: altoMinimo,
        flex: holgura ? (vacia ? '1 1 auto' : '0 0 auto') : `${peso} 1 0%`,
      }}
    >
      {semana.dias.map((d, col) => (
        <div
          key={d.iso}
          aria-current={d.esHoy ? 'date' : undefined}
          className={cn(
            'relative',
            /* Filetes finisimos. Con el borde marcado, la rejilla se leia
               como una hoja de calculo y competia con las barras; ahora solo
               esta lo justo para localizar el dia. */
            col < 6 && 'border-r border-border/25',
            /*
              TRES NIVELES DE SUPERFICIE, LOS TRES OPACOS.

              La rejilla va sobre `bg-card` (0,215). Una semana sin
              competición y los días que no son de este mes bajan a
              `bg-background` (0,17), que hunde igual que el `bg-black/20` de
              antes pero **sin dejar pasar la textura del lienzo**: con el
              alfa, la cuña diagonal cruzaba las celdas vacías y se leía antes
              que las competiciones.

              Y el día de hoy sube a `bg-secondary` (0,27) en vez de teñirse
              de carmesí al 9 %. El rojo sigue estando donde se lee —la cifra
              y su filete de dos píxeles—, así que no se pierde ninguna señal;
              lo que se pierde es un velo translúcido sobre la textura.
            */
            vacia && 'bg-background',
            !d.delMes && 'bg-background',
            // Lo que ya pasó se apaga. En el mes en curso, media pantalla es
            // pasado: apagarlo es lo que hace que resalte lo que queda.
            d.pasado && !d.esHoy && 'opacity-45',
            d.esHoy && 'bg-secondary',
          )}
        >
          {/*
            HOY, SIN EL DISCO ROJO.

            Antes era un círculo relleno de carmesí pegado al número: se comía
            la esquina de la celda justo donde empieza la primera barra y a
            tamaño de móvil parecía un aviso de error. Lo que hay ahora es el
            recurso de la casa: la cifra en carmesí con un filete de dos
            píxeles debajo, como la línea de la pista. Y no depende solo del
            color: lleva el filete y su «(hoy)» para el lector de pantalla.
          */}
          <span
            className={cn(
              'cifra absolute left-1.5 top-0.5 leading-none',
              compacta ? 'text-xs' : 'text-sm sm:text-[0.8125rem]',
              d.esHoy
                ? 'font-semibold text-primary-text'
                : !d.delMes
                  ? 'text-muted-foreground/40'
                  : vacia
                    ? 'text-muted-foreground/70'
                    : 'text-foreground',
            )}
          >
            {d.dia}
            {d.esHoy ? (
              <>
                <span
                  className="absolute -bottom-[3px] left-0 h-[2px] w-full rounded-full bg-primary"
                  aria-hidden
                />
                <span className="sr-only"> (hoy)</span>
              </>
            ) : null}
          </span>
        </div>
      ))}

      {/* Las barras van por encima de la rejilla de días, no dentro. */}
      {visibles.map((barra) => (
        <BarraTorneo
          key={`${barra.evento.id}-${barra.desde}`}
          barra={barra}
          compacta={compacta}
          alto={altoBarra}
          cabecera={cabecera}
          inscripciones={inscripciones}
          resaltado={resaltados?.has(barra.evento.id) ?? false}
          atenuado={Boolean(resaltados?.size) && !resaltados?.has(barra.evento.id)}
          esProximo={barra.evento.id === proximo}
          mostrarArma={mostrarArma}
          mostrarGenero={mostrarGenero}
          mostrarCategoria={mostrarCategoria}
          onAbrir={onAbrirEvento}
        />
      ))}

      {recorta && ocultas.length > 0 ? (
        <MasDeLaSemana
          barras={ocultas}
          alto={altoBarra}
          carril={carrilesPintados}
          cabecera={cabecera}
          inscripciones={inscripciones}
          onAbrir={onAbrirEvento}
        />
      ) : null}
    </div>
  );
}

/**
 * «+N torneos» de la semana.
 *
 * Antes era un «+N» por día, y con cuatro días del mismo torneo largo salían
 * cuatro pastillas grises diciendo «+7 +7 +9 +7» sobre los mismos siete
 * torneos: parecía que había treinta escondidos. Ahora es **una franja por
 * semana** que dice cuántos torneos distintos faltan y se abre en una lista
 * legible. Menos trastos y una cuenta honesta.
 *
 * La franja no cruza la semana entera: empieza en el primer día que esconde
 * algo. Ocupando también el lunes, el martes y el miércoles —que en esgrima
 * están vacíos— parecía que había competiciones ahí.
 */
function MasDeLaSemana({
  barras,
  alto,
  carril,
  cabecera,
  inscripciones,
  onAbrir,
}: {
  barras: Barra[];
  alto: number;
  carril: number;
  cabecera: number;
  inscripciones: Record<string, string>;
  onAbrir: (e: EventView) => void;
}) {
  const unicos = [...new Map(barras.map((b) => [b.evento.id, b.evento])).values()].sort(
    (a, b) => a.startDate.localeCompare(b.startDate),
  );

  const primera = Math.min(...barras.map((b) => b.desde));
  const ultima = Math.max(...barras.map((b) => b.desde + b.ancho));
  const columnas = ultima - primera;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          /*
            Gancho estable para los guiones, con la cuenta dentro. Sin él no se
            puede medir desde fuera **a cuántos torneos se puede llegar** en un
            móvil, que es el fallo que se nos escapó: se pintaban 7 barras de
            39 y `npm run barrido` daba el visto bueno porque no había desborde
            ni texto cortado. Un torneo al que no se puede llegar no aparece en
            ninguna métrica de maquetación.
          */
          data-mas="semana"
          data-cuantos={unicos.length}
          /* `bg-background` sólido: al 40 % dejaba pasar la retícula del
             lienzo por dentro de la franja del «+N». */
          className="objetivo-libre absolute flex cursor-pointer items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm border border-dashed border-border bg-background text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            left: `calc(${BORDE_COLUMNA[primera] * 100}% + 3px)`,
            width: `calc(${
              (BORDE_COLUMNA[ultima] - BORDE_COLUMNA[primera]) * 100
            }% - 6px)`,
            top: cabecera + carril * (alto + HUECO_BARRA),
            height: alto,
          }}
        >
          <span className="cifra text-sm text-foreground">+{unicos.length}</span>
          {/*
            El rotulo se acorta con el sitio que hay.

            La franja no cruza la semana entera: ocupa solo los dias que
            esconden algo, y en un iPhone dos columnas son 156 px. Con el texto
            entero, «torneos mas esta semana» se partia en tres renglones y se
            salia de su banda de 21 px pisando las barras de arriba y de abajo.
            Se vio en la captura. Con menos de cuatro columnas se queda en
            «+11 mas», y con una, solo la cifra.
          */}
          {columnas >= 4
            ? unicos.length === 1
              ? 'torneo más esta semana'
              : 'torneos más esta semana'
            : columnas >= 2
              ? 'más'
              : null}
        </button>
      </PopoverTrigger>

      <PopoverContent align="center" className="max-h-80 w-[19rem] overflow-y-auto p-1.5">
        <ul className="flex flex-col gap-0.5">
          {unicos.map((evento) => {
            const o = organismoDe(evento.source, evento.scope, evento.circuit);
            const inscrito = evento.competitions.some((c) => inscripciones[c.id]);
            return (
              <li key={evento.id}>
                <button
                  type="button"
                  onClick={() => onAbrir(evento)}
                  className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                >
                  <span
                    className={cn(
                      'mt-1 w-[3px] shrink-0 self-stretch rounded-full',
                      colorDeOrganismo(o).punto,
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {titularTorneo(evento.name)}
                      </span>
                      {inscrito ? (
                        <CircleCheck className="size-3.5 shrink-0" aria-label="Ya estás inscrito" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1">
                      <Pastilla clase={cn(colorDeOrganismo(o).punto, 'text-background')}>
                        {colorDeOrganismo(o).corto}
                      </Pastilla>
                      <MarcaArma armas={armasDe(evento)} px={14} className="text-foreground/90" />
                      {generosDe(evento).map((g) => (
                        <Pastilla key={g.codigo} titulo={g.largo}>
                          {g.codigo}
                        </Pastilla>
                      ))}
                      {categoriasDe(evento).slice(0, 3).map((c) => (
                        <Pastilla key={c}>{c}</Pastilla>
                      ))}
                    </span>
                    <span className="mt-0.5 flex items-baseline gap-2 text-xs text-muted-foreground">
                      <span className="cifra text-foreground/70">
                        {formatDateRangeEs(evento.startDate, evento.endDate)}
                      </span>
                      <span className="truncate">
                        {evento.city ? sede(evento, true) : 'Sede sin publicar'}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Pastilla de etiqueta: arma, género, categoría, organismo.
 *
 * Es la pieza que responde al «no sé si es verano, si es absoluto, si es…».
 * El dato estaba en la base y no se pintaba en ninguna parte del mes; ahora
 * cada barra lleva su arma, su género y su categoría escritos, no solo
 * insinuados por un color.
 */
function Pastilla({
  children,
  clase,
  estilo,
  titulo,
}: {
  children: React.ReactNode;
  clase?: string;
  estilo?: React.CSSProperties;
  titulo?: string;
}) {
  return (
    <span
      title={titulo}
      style={estilo}
      className={cn(
        'cifra shrink-0 rounded-[3px] px-1 py-px text-[0.65rem] leading-[1.25] tracking-tight',
        /*
          `bg-secondary` sólido en vez de `bg-foreground/15`.
          La pastilla va siempre encima de una superficie opaca —la barra del
          organismo o el panel del «+N»—, así que aquí el alfa no dejaba pasar
          la textura del lienzo. Se cambia igual porque la regla del proyecto
          es que en el calendario no hay transparencias, y porque un gris con
          nombre se comporta igual encima de los cuatro rellenos de organismo,
          mientras que un blanco al 15 % da un tono distinto sobre cada uno.
        */
        clase ?? 'bg-secondary text-secondary-foreground',
      )}
    >
      {children}
    </span>
  );
}

function BarraTorneo({
  barra,
  compacta,
  alto,
  cabecera,
  inscripciones,
  resaltado = false,
  atenuado = false,
  esProximo = false,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
  onAbrir,
}: {
  barra: Barra;
  compacta: boolean;
  alto: number;
  cabecera: number;
  inscripciones: Record<string, string>;
  /** Es el torneo que se estaba buscando. */
  resaltado?: boolean;
  /** Se está buscando y este no es: se aparta sin desaparecer. */
  atenuado?: boolean;
  /** Es el del marcador de arriba. */
  esProximo?: boolean;
  mostrarArma: boolean;
  mostrarGenero: boolean;
  mostrarCategoria: boolean;
  onAbrir: (e: EventView) => void;
}) {
  const evento = barra.evento;
  const organismo = organismoDe(evento.source, evento.scope, evento.circuit);
  const color = colorDeOrganismo(organismo);

  /**
   * Peso del titular según la importancia del circuito.
   *
   * Es la otra mitad de la señal, la que no es color: un Campeonato del Mundo
   * entra en negrita y una concentración se queda callada. Sirve para lo que
   * se pedía —que la pantalla no pese toda igual— sin gastar un tono más, que
   * es justo lo que no hay.
   */
  const jerarquia = jerarquiaDeCircuito(evento.circuit);
  const pesoTitular =
    jerarquia === 1 ? 'font-bold' : jerarquia === 4 ? 'font-medium' : 'font-semibold';

  const armas = armasDe(evento);
  const generos = generosDe(evento);
  const categorias = categoriasDe(evento);
  const inscrito = evento.competitions.some((c) => inscripciones[c.id]);
  const circuito = circuitoDe(evento);
  const plazo = plazoDe(evento);

  const registro = registroDe(alto, barra.ancho);
  const ancho = barra.ancho;

  /**
   * Barra de UN día: manda el nombre y se callan las etiquetas.
   *
   * Se vio en la captura y era lo peor de la pantalla: el sábado 3 de octubre
   * hay cinco jornadas de Liga Nacional, cada una de un solo día, y en un
   * iPhone una columna mide 78 px. Con el canto, las dos pastillas de género
   * y los márgenes, al nombre le quedaban 25 px y las cinco barras ponían
   * **«Li…», «Li…», «L», «T»**. Eso no es información, es ruido con forma de
   * dato.
   *
   * Aquí el reparto se invierte: fuera las pastillas, y el nombre a dos
   * líneas si hay alto. Pasa de dos caracteres a unos dieciséis —«Liga
   * Nacional B…»—, que ya distingue una jornada de otra. El arma, el género,
   * la categoría y la sede siguen a un dedo de distancia, en el globo y en la
   * ficha; el nombre no tenía dónde estar.
   */
  const estrecha = ancho === 1;

  /**
   * Las etiquetas de la barra: arma, género y categoría.
   *
   * -----------------------------------------------------------------------
   * POR QUÉ «FLO» CON UN ARMA Y «FES» CON VARIAS
   * -----------------------------------------------------------------------
   * Se miró la barra ampliada al triple y ponía **«F M F M17»**. Las dos
   * primeras letras son florete y masculino; la tercera es femenino. La «F»
   * de florete y la «F» de femenino son la misma letra pegada una a la otra,
   * y ni con fondos distintos se distinguen a 10 px: hay que saber el orden
   * para leerlo, y entonces no se lee, se descifra.
   *
   * Así que con **un** arma va la abreviatura de tres letras —«FLO», «ESP»,
   * «SAB»—, que no se confunde con nada y cuesta doce píxeles. Y con **dos o
   * tres**, las iniciales juntas en una pastilla —«FES»—, porque ahí sí hacen
   * falta los píxeles (tres pastillas de tres letras son 66 px del nombre del
   * torneo) y «FES» no se puede leer como un género.
   */
  const etiquetas = (
    <>
      {mostrarArma ? (
        <MarcaArma
          armas={armas}
          /*
            Se le dicen los píxeles que hay y elige: en una tarjeta caben 26 y
            sale el dibujo del arma —que es lo que el usuario echaba en falta:
            «no aparece nada de deporte, esgrima»—; en una barra de una línea
            hay 14 y salen FLO/ESP/SAB, porque a ese tamaño los tres dibujos
            son la misma mancha. El umbral no se elige aquí: lo pone
            `UMBRAL_DIBUJO` en `iconos-arma.tsx`, que es su dueño y lo midió.
          */
          px={registro === 'tarjeta' ? 26 : 14}
          className="text-foreground/90"
        />
      ) : null}
      {mostrarGenero
        ? generos.map((g) => (
            <Pastilla key={g.codigo} titulo={g.largo}>
              {g.codigo}
            </Pastilla>
          ))
        : null}
      {mostrarCategoria
        ? categorias.slice(0, ancho >= 3 ? 3 : 1).map((c) => (
            <Pastilla key={c}>{c}</Pastilla>
          ))
        : null}
    </>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          /*
            Gancho estable para los guiones de `tests/ui`. Antes se localizaban
            las barras por su clase (`div.relative.grid.grid-cols-7 > button`),
            y al dejar de ser siete columnas iguales el `npm run ficha` se
            quedó sin encontrar ninguna y dejó de capturar nada. Una clase de
            maquetación no es un contrato; esto sí.
          */
          data-barra="torneo"
          /* El identificador, para poder contar desde fuera a cuántos torneos
             distintos se llega: el nombre no sirve, porque en octubre hay seis
             «Copa del Mundo» y lo que las separa es la sede. */
          data-evento={evento.id}
          onClick={() => onAbrir(evento)}
          className={cn(
            'objetivo-libre absolute flex cursor-pointer overflow-hidden text-left',
            'transition-[filter] duration-150 hover:brightness-[1.28]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            color.superficie,
            // Si viene de antes o sigue después, ese lado se queda recto: se
            // ve que el torneo continúa.
            barra.continuaAntes ? 'rounded-l-none' : 'rounded-l-md',
            barra.continuaDespues ? 'rounded-r-none' : 'rounded-r-md',
            // Inscrito: filete blanco. No es solo color: va también el icono
            // de la derecha y el texto del globo.
            inscrito && 'ring-1 ring-inset ring-foreground/35',
            // El del marcador de arriba: el ojo tiene que unir las dos cosas.
            esProximo && !inscrito && 'ring-1 ring-inset ring-foreground/25',
            // El que se buscaba: se le pone el foco encima. Los demás se
            // apagan a la mitad, pero siguen ahí y siguen abriéndose.
            resaltado && 'ring-2 ring-inset ring-foreground brightness-125',
            atenuado && 'opacity-40',
          )}
          style={{
            left: `calc(${BORDE_COLUMNA[barra.desde] * 100}% + ${
              barra.continuaAntes ? 0 : 3
            }px)`,
            width: `calc(${
              (BORDE_COLUMNA[barra.desde + barra.ancho] - BORDE_COLUMNA[barra.desde]) * 100
            }% - ${(barra.continuaAntes ? 0 : 3) + (barra.continuaDespues ? 0 : 3)}px)`,
            top: cabecera + barra.carril * (alto + HUECO_BARRA),
            height: alto,
          }}
        >
          {/*
            El canto de color.

            Es donde vive el color del organismo, saturado del todo. Antes el
            color estaba repartido por todo el relleno y el nombre iba pintado
            de ese mismo color apagado: el usuario lo leyó como «estados
            desactivados». Concentrado en tres píxeles satura, distingue y deja
            el nombre en blanco, que es donde tiene que haber contraste.
          */}
          <span
            className={cn(
              'w-[3px] shrink-0',
              color.punto,
              !barra.continuaAntes && 'rounded-l-md',
            )}
            aria-hidden
          />

          {registro === 'tarjeta' ? (
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2 py-1">
              <span className="flex items-center gap-1.5">
                <Pastilla clase={cn(color.punto, 'text-background')}>
                  {color.corto}
                </Pastilla>
                {circuito ? (
                  <span className="min-w-0 truncate text-[0.7rem] text-muted-foreground">
                    {circuito}
                  </span>
                ) : null}
                {inscrito ? (
                  <CircleCheck
                    className="ml-auto size-4 shrink-0"
                    aria-label="Ya estás inscrito"
                  />
                ) : null}
              </span>

              {/*
                El titulo a DOS lineas, pero **solo si las dos caben**.

                Con una sola, «Liga Nacional Iberdrola 1a Jornada» salia como
                «Liga Nacional Ib...» en una tarjeta de 140 px, que es la queja
                literal de que el calendario «no dice nada»: el dato esta y no
                se lee. Dos lineas de doce caracteres son veinticuatro.

                Y el guarda, que es lo que faltaba: una tarjeta de 84 px con el
                titulo a dos lineas necesita 89,8 (ver `ASPECTO`), asi que el
                `flex` apretaba la caja del titulo de 39 a 34 px y el
                `line-clamp` cortaba la segunda linea por la mitad. En
                produccion se leia «Eurofence / League» con los palos
                rebanados. Por debajo del umbral, una linea con puntos
                suspensivos: truncar se entiende, rebanar parece un fallo de
                dibujado.

                `shrink-0` para que no vuelva a pasar por otro camino: si algun
                dia el contenido no cupiera, lo que cede es la sede, no las
                letras del titulo.
              */}
              <span
                className={cn(
                  'shrink-0 text-sm leading-tight text-foreground',
                  alto >= ASPECTO.tarjetaDosLineas ? 'line-clamp-2' : 'truncate',
                  pesoTitular,
                )}
              >
                {titularTorneo(evento.name)}
              </span>

              <span className="flex min-w-0 items-center gap-1">
                {etiquetas}
                <span className="min-w-0 flex-1 truncate text-[0.7rem] text-muted-foreground">
                  {evento.city ? sede(evento, true) : 'Sede sin publicar'}
                </span>
                {/*
                  El plazo, que es lo que decide si todavia se puede hacer
                  algo, se calla solo cuando de verdad no cabe.

                  Antes se decidia por columnas: con menos de tres, fuera. Pero
                  «dos columnas» son 128 px en un iPhone y **670 en un
                  escritorio de 1440**, donde la tarjeta salia con medio metro
                  de color liso a la derecha del nombre. La columna no mide el
                  sitio; el ancho de pantalla, si. Asi que por debajo de `sm`
                  se mantiene la regla de las tres columnas y a partir de ahi
                  sale siempre.
                */}
                {plazo ? (
                  <span
                    className={cn(
                      'shrink-0 text-[0.7rem]',
                      plazo.tono,
                      ancho < 3 && 'hidden sm:inline',
                    )}
                  >
                    {plazo.texto}
                  </span>
                ) : null}
              </span>
            </span>
          ) : estrecha && registro !== 'apretada' ? (
            /*
              `px-0.5` en el móvil, y son 4,5 px que importan: en una columna
              de un día el texto se queda en 49 px con `px-1`, y «Iberdrola»
              mide 50. Una letra cortada por el canto derecho es el mismo
              defecto que la línea rebanada por abajo, en horizontal. Con
              `px-0.5` hay 53,5 y la palabra entra entera. A partir de `sm` la
              columna mide 237 px y el aire se puede pagar.
            */
            <span className="flex min-w-0 flex-1 items-center gap-1 px-0.5 sm:px-1.5">
              {/*
                Las etiquetas vuelven a partir de `sm`, y no es un capricho: una
                columna de un dia mide 78 px en un iPhone y 237 en un escritorio
                de 1440. En 78 px las pastillas se comen el nombre; en 237 caben
                las dos cosas de sobra. Es la misma barra y el mismo dato, con el
                reparto que le toca a cada anchura.
              */}
              {/*
                Y EN EL TRIMESTRE NO VUELVEN, PORQUE AHÍ NO HAY 237 PX.

                Se vio en `capturas/arq/tri3-esc1440.png` y era el peor defecto
                de esa vista: en septiembre, el bloque de barras de un día
                salía **«SAB F Abs», «FLO M F», «ESP M17»… sin una sola letra
                del nombre**. Insignias solas. La regla de abajo se escribió
                para el móvil —«en 78 px las pastillas se comen el nombre; en
                237 caben las dos cosas»— y a partir de `sm` las devolvía
                siempre, sin mirar que en el trimestre una columna de un día
                mide 36 px, la mitad que en un teléfono.
              */}
              {!compacta ? (
                <span className="hidden shrink-0 items-center gap-1 sm:flex">{etiquetas}</span>
              ) : null}
              {/*
                Tantas líneas como quepan, y ni una más.

                Medido: `0.68rem` en un móvil son 12,2 px y con
                `leading-[1.15]` cada línea ocupa 14,1. Dos necesitan 29 y tres
                43,5; se pinta lo que entra en el alto que le ha tocado. Sin
                este guarda quedaba «Liga / Nacio» con los palos de las letras
                rebanados, que es peor que truncar: parece un fallo de
                dibujado.

                La tercera línea no es un capricho, es lo que distingue una
                barra de otra. En el mismo sábado hay tres jornadas de liga:
                «Liga Nacional Iberdrola 1ª Jornada», «Liga Nacional Oro 1ª
                Jornada» y «Liga Nacional Plata 1ª Jornada». A dos líneas de
                ocho caracteres las tres se leen **«Liga Nacion…»**: tres
                barras idénticas para tres competiciones distintas. Lo que las
                separa —Iberdrola, Oro, Plata— está en la tercera línea, así
                que ahí es donde hay que llegar. Las pastillas no servían de
                nada para esto: las tres son florete y las tres son el mismo
                día.
              */}
              <span
                className={cn(
                  'min-w-0 flex-1 text-[0.68rem] leading-[1.15] text-foreground',
                  alto >= 3 * LINEA_ESTRECHA
                    ? 'line-clamp-3'
                    : alto >= 2 * LINEA_ESTRECHA
                      ? 'line-clamp-2'
                      : 'truncate',
                  pesoTitular,
                )}
              >
                <NombreApretado nombre={titularTorneo(evento.name)} siempre={compacta} />
              </span>
              {inscrito ? (
                <CircleCheck className="ml-0.5 size-3 shrink-0" aria-label="Ya estás inscrito" />
              ) : null}
            </span>
          ) : registro === 'doble' && compacta ? (
            /*
              EN EL TRIMESTRE, LA BARRA ES EL NOMBRE Y EL ARMA. NADA MÁS.
              -----------------------------------------------------------------
              Con el reparto normal —nombre arriba, insignias y sede debajo— el
              trimestre salía con **trece nombres cortados en un escritorio de
              1440 y quince en uno de 2560**: «Copa Mundo Cadete», «Circuito
              Europeo Cadete», «Liga Oro 1ª J.»… Es la queja literal del
              usuario sobre esta vista, medida.

              La cuenta explica por qué no se arreglaba abreviando: a 1440 los
              tres meses se reparten 1288 px, así que una columna de sábado
              mide 83. De esos 83, las insignias «ESP M F M17» se llevan 60 y
              al nombre le quedan 20, que no es una palabra. Lo mismo que ya
              estaba escrito para las barras de un día en el móvil, otra vez:
              las insignias se comen el ancho antes que el texto.

              Así que en el trimestre cede lo que se puede recuperar a un clic
              —género, categoría, sede y plazo, que están en la ficha— y se
              queda lo que no: **el nombre, a dos líneas**, y el arma, que es
              el filtro con el que se mira esta pantalla y cuesta 22 px. El
              color de la barra sigue diciendo quién organiza.
            */
            <span className="flex min-w-0 flex-1 items-center gap-1 px-1.5">
              {mostrarArma ? (
                <MarcaArma armas={armas} px={14} className="self-start text-foreground/90" />
              ) : null}
              <span
                className={cn(
                  'min-w-0 flex-1 text-[0.8125rem] leading-[1.2] text-foreground',
                  alto >= 2 * LINEA_XS ? 'line-clamp-2' : 'truncate',
                  pesoTitular,
                )}
              >
                <NombreApretado nombre={titularTorneo(evento.name)} siempre />
              </span>
              {inscrito ? (
                <CircleCheck
                  className="size-3.5 shrink-0 self-start"
                  aria-label="Ya estás inscrito"
                />
              ) : null}
            </span>
          ) : registro === 'doble' ? (
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-px px-1.5 py-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[0.8125rem] leading-tight text-foreground',
                    pesoTitular,
                  )}
                >
                  {titularTorneo(evento.name)}
                </span>
                {inscrito ? (
                  <CircleCheck className="size-3.5 shrink-0" aria-label="Ya estás inscrito" />
                ) : null}
              </span>
              <span className="flex min-w-0 items-center gap-1">
                {etiquetas}
                <span className="min-w-0 flex-1 truncate text-[0.7rem] text-muted-foreground">
                  {evento.city ? sede(evento, ancho >= 3) : 'Sede sin publicar'}
                </span>
                {plazo && ancho >= 4 ? (
                  <span className={cn('shrink-0 text-[0.7rem]', plazo.tono)}>
                    {plazo.texto}
                  </span>
                ) : null}
              </span>
            </span>
          ) : registro === 'linea' ? (
            <span className="flex min-w-0 flex-1 items-center gap-1 px-1.5">
              {/* En el trimestre, solo el arma: el resto de las insignias se
                  llevan 60 de los 83 px que mide una columna de sábado, y
                  entonces no cabe el nombre. Ver el registro «doble». */}
              {compacta ? (
                mostrarArma ? (
                  <MarcaArma armas={armas} px={14} className="text-foreground/90" />
                ) : null
              ) : (
                etiquetas
              )}
              {/*
                DOS LÍNEAS TAMBIÉN AQUÍ, CUANDO EL ALTO DA.

                Con las pastillas de género puestas —un seleccionador ve los
                dos—, una barra de fin de semana de 128 px le deja 60 al
                nombre y «Eurofence League» salía «Eurofence…». El alto sí
                sobraba: 38 px para una línea de 15,5. Una línea de `text-xs`
                con `leading-[1.15]` son 15,5 px, así que a partir de 34 de
                barra caben dos y el nombre entra entero. Por debajo, una
                línea con puntos: el guarda es el mismo que en la tarjeta y en
                la barra de un día, porque el fallo que evita es el mismo —una
                segunda línea rebanada por la mitad—.
              */}
              <span
                className={cn(
                  'min-w-0 shrink text-foreground',
                  /* En el trimestre, un punto menos: una columna de sábado mide
                     83 px y a `text-xs` caben doce caracteres, a `0.7rem`
                     quince. Son tres letras, y tres letras son la diferencia
                     entre «Liga Oro 1ª J.» y «Liga Oro 1ª…». */
                  compacta ? 'text-[0.7rem]' : 'text-xs',
                  alto >= 2 * LINEA_XS ? 'line-clamp-2 leading-[1.15]' : 'truncate',
                  pesoTitular,
                )}
              >
                <NombreApretado nombre={titularTorneo(evento.name)} siempre={compacta} />
              </span>
              {!compacta && ancho >= 3 && evento.city ? (
                <span className="min-w-0 truncate text-[0.7rem] text-muted-foreground">
                  {sede(evento, ancho >= 4)}
                </span>
              ) : null}
              {inscrito ? (
                <CircleCheck
                  className="ml-auto size-3.5 shrink-0"
                  aria-label="Ya estás inscrito"
                />
              ) : null}
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-1 px-1">
              {/* En el trimestre, ni el arma: una barra apretada de un día son
                  36 px y la marca se lleva 22. El color dice el organismo y el
                  globo y la ficha dicen el resto. */}
              {mostrarArma && !compacta ? (
                <MarcaArma armas={armas} px={11} className="text-[0.6rem] text-foreground/90" />
              ) : null}
              <span
                className={cn('min-w-0 flex-1 truncate text-[0.68rem] text-foreground', pesoTitular)}
              >
                {/* En una barra de un día, en el registro más apretado, solo
                    hay sitio para ocho caracteres: ahí el nombre va apretado
                    o no dice nada. Y en el trimestre, siempre. */}
                {estrecha || compacta ? (
                  <NombreApretado nombre={titularTorneo(evento.name)} siempre={compacta} />
                ) : (
                  titularTorneo(evento.name)
                )}
              </span>
              {inscrito ? (
                <CircleCheck className="size-2.5 shrink-0" aria-label="Ya estás inscrito" />
              ) : null}
            </span>
          )}
        </button>
      </TooltipTrigger>

      <ContenidoGlobo evento={evento} inscrito={inscrito} />
    </Tooltip>
  );
}

/**
 * Globo de información.
 *
 * En una barra de una línea caben el nombre y poco más, así que al pasar por
 * encima se enseña lo que de verdad hace falta para decidir si abrir la ficha:
 * dónde es, qué pruebas hay y cuánto queda de plazo.
 */
function ContenidoGlobo({
  evento,
  inscrito,
}: {
  evento: EventView;
  inscrito: boolean;
}) {
  const plazo = plazoDe(evento);

  const porArma = new Map<Weapon, Set<string>>();
  for (const c of evento.competitions) {
    const clave = `${c.gender === 'M' ? 'M' : c.gender === 'F' ? 'F' : 'Mixto'} ${
      CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ?? c.category
    }`;
    const set = porArma.get(c.weapon) ?? new Set<string>();
    set.add(clave);
    porArma.set(c.weapon, set);
  }

  return (
    <TooltipContent side="top" className="max-w-72 flex-col items-start gap-1.5 p-2.5">
      <p className="text-sm font-semibold leading-tight">{titularTorneo(evento.name)}</p>

      {/*
        Dónde y cuándo con su rótulo, no pegados con un punto medio. Cuesta dos
        líneas de marcado y es la diferencia entre leerlo y analizarlo.
      */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
        <dt className="opacity-70">Dónde</dt>
        <dd>
          {evento.city ? titular(evento.city) : 'Sede sin publicar'}
          {evento.country ? `, ${evento.country}` : ''}
        </dd>
        <dt className="opacity-70">Cuándo</dt>
        <dd className="cifra text-[0.95em]">
          {formatDateRangeEs(evento.startDate, evento.endDate)}
        </dd>
        <dt className="opacity-70">Circuito</dt>
        <dd>{CIRCUIT_LABEL[evento.circuit] ?? evento.circuit}</dd>
      </dl>

      <ul className="flex flex-col gap-0.5 text-xs">
        {[...porArma.entries()].map(([arma, claves]) => (
          <li key={arma} className="flex items-center gap-2">
            {/* 24 px: por encima del umbral de 22, así que aquí sí va el
                dibujo del arma, que es donde se puede distinguir. */}
            <MarcaArma armas={[arma]} px={24} />
            <span className="font-medium">{WEAPON_LABEL[arma]}</span>
            <span className="opacity-70">{[...claves].sort().join(', ')}</span>
          </li>
        ))}
      </ul>

      {plazo ? <p className={cn('text-xs', plazo.tono)}>{plazo.texto}</p> : null}

      {inscrito ? (
        <p className="flex items-center gap-1 text-xs font-medium">
          <CircleCheck className="size-3" aria-hidden /> Ya estás inscrito
        </p>
      ) : null}
    </TooltipContent>
  );
}
