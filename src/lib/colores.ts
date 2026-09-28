import type { TinteFondo } from '@/components/fondo/fondo';
import { CIRCUIT_SHORT, type Organismo, organismoDe } from '@/lib/utils';

/**
 * El color de quién organiza, en un solo sitio.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ ESTE FICHERO EXISTE
 * -------------------------------------------------------------------------
 *
 * El organismo sale en el calendario, en la ficha del torneo, en el ranking
 * y en las convocatorias. Si cada pantalla elige su tono acabamos con cuatro
 * paletas y con la sensación de «interfaz poco cuidada» que es justo lo que
 * se está arreglando. Aquí se decide una vez; las pantallas importan.
 *
 * -------------------------------------------------------------------------
 * Y POR QUÉ NO HAY UN COLOR POR CIRCUITO
 * -------------------------------------------------------------------------
 *
 * Porque hay veinticuatro circuitos y no hay veinticuatro colores que se
 * distingan. Intentarlo es exactamente lo que produjo el problema que el
 * usuario vio en el calendario:
 *
 *   «los colores parecen estados desactivados, no categorías»
 *
 * Tenía razón, y la causa era doble: tonos apagados (un color medio al 20 %
 * sobre casi negro se vuelve pardo) y demasiados. Así que:
 *
 * - El **color** dice el organismo. Son cuatro y están separados de verdad:
 *   RFEE acero claro, FIE azul marino, EFC petróleo, autonómicas grafito.
 *   Medido: 0,111 de distancia OKLab en el par peor, cuando la versión
 *   anterior tenía 0,05 y la FIE y la EFC salían iguales en una barra.
 * - El **circuito** lo dice el texto (`CIRCUIT_SHORT`) y, si hace falta más,
 *   la forma o el peso, nunca otro tono.
 *
 * El color además nunca va solo: cada barra lleva su etiqueta. Es requisito
 * del proyecto (`UI.md`, regla 6) y aquí es también lo que hace que
 * veinticuatro circuitos quepan en cuatro colores.
 */

/** Las clases de cada organismo. Escritas enteras para que se puedan buscar. */
export type ColorOrganismo = {
  /**
   * El color de identidad como texto. Vale sobre el fondo de la página y
   * sobre `card` (de 6,6:1 a 16,1:1). **No** sobre `superficie`.
   */
  texto: string;
  /** Relleno sólido de la barra. Sin alfa: es un color, no una veladura. */
  superficie: string;
  /**
   * El texto que va encima de `superficie`. Es blanco, siempre.
   *
   * No es el color de identidad, y este campo existe para que nadie tenga
   * que acordarse: identidad de la FIE sobre relleno de la FIE da 3,99:1 y
   * se queda por debajo de AA. En blanco, las cuatro barras van de 5,2:1
   * (RFEE) a 12,0:1 (autonómica).
   */
  textoSobreSuperficie: string;
  /**
   * Superficie **opaca** teñida con el color de identidad, para la pastilla
   * de circuito de la tarjeta del calendario («FIE · Copa del Mundo»).
   *
   * Va con `texto` encima, no con `textoSobreSuperficie`: es un tinte suave
   * sobre `--card`, no el relleno sólido, así que lo que se lee bien encima
   * es el color de identidad y no el blanco.
   *
   * No es `bg-org-fie/14`. El por qué —y el fallo que costó— está escrito en
   * `globals.css`, junto a los tokens: la tarjeta va sobre el lienzo con
   * textura y un alfa deja pasar la retícula de cruces por dentro de la
   * pastilla.
   */
  tintePastilla: string;
  /** El punto o el filete de la leyenda. */
  punto: string;
  /** Borde del mismo color, para el filete de 2 px de una barra. */
  borde: string;
  /** Tinte para `<Fondo tinte={…}>`: la cabecera sin foto. */
  tinte: TinteFondo;
  /** El mismo tinte como clase, para ponerlo junto a `.fondo-cabecera`. */
  tinteClase: string;
  /** Cómo se llama en la interfaz. Corto y largo, en castellano. */
  corto: string;
  largo: string;
};

/**
 * Medido con `npm run contraste`, sobre el fondo de la aplicación: el
 * relleno destaca entre 1,5:1 y 3,5:1 —se ve como una chapa— y el blanco
 * encima va de 5,2:1 a 12,0:1. Todo AA.
 *
 * Los cuatro rellenos están, además, a distancia perceptual suficiente
 * entre ellos (0,111 en OKLab en el par peor, FIE-EFC) para que se
 * distingan en una barra de 19 px. La versión anterior los tenía a 0,05 y
 * la FIE y la EFC salían iguales.
 */
export const COLOR_ORGANISMO: Record<Organismo, ColorOrganismo> = {
  RFEE: {
    texto: 'text-org-rfee',
    superficie: 'bg-org-rfee-relleno',
    tintePastilla: 'bg-org-rfee-tinte',
    textoSobreSuperficie: 'text-foreground',
    punto: 'bg-org-rfee',
    borde: 'border-org-rfee',
    tinte: 'rfee',
    tinteClase: 'tinte-rfee',
    corto: 'RFEE',
    largo: 'Nacional (RFEE)',
  },
  FIE: {
    texto: 'text-org-fie',
    superficie: 'bg-org-fie-relleno',
    tintePastilla: 'bg-org-fie-tinte',
    textoSobreSuperficie: 'text-foreground',
    punto: 'bg-org-fie',
    borde: 'border-org-fie',
    tinte: 'fie',
    tinteClase: 'tinte-fie',
    corto: 'FIE',
    largo: 'Internacional (FIE)',
  },
  EFC: {
    texto: 'text-org-efc',
    superficie: 'bg-org-efc-relleno',
    tintePastilla: 'bg-org-efc-tinte',
    textoSobreSuperficie: 'text-foreground',
    punto: 'bg-org-efc',
    borde: 'border-org-efc',
    tinte: 'efc',
    tinteClase: 'tinte-efc',
    corto: 'EFC',
    largo: 'Europeo (EFC)',
  },
  AUT: {
    texto: 'text-org-aut',
    superficie: 'bg-org-aut-relleno',
    tintePastilla: 'bg-org-aut-tinte',
    textoSobreSuperficie: 'text-foreground',
    punto: 'bg-org-aut',
    borde: 'border-org-aut',
    tinte: 'aut',
    tinteClase: 'tinte-aut',
    corto: 'Autonómico',
    largo: 'Autonómica',
  },
};

/**
 * Qué organismo hay detrás de un circuito.
 *
 * **No hay aquí una segunda tabla a propósito.** La lista de qué circuitos
 * son de la FIE y cuáles de la EFC ya vive en `organismoDe()` de
 * `utils.ts`, y duplicarla aquí significa que dentro de tres semanas una de
 * las dos se queda atrás y el mismo torneo sale azul en el calendario y
 * blanco en el ranking. Así que se delega.
 *
 * `organismoDe()` quiere fuente y ámbito además del circuito, porque cuando
 * se tiene el evento entero son mejores datos: una autonómica se reconoce
 * por el ámbito, no por el circuito. Cuando solo hay el código del circuito
 * —una leyenda, un filtro, una cabecera de ranking— se le pasa el caso
 * nacional, que es la respuesta correcta para todo lo que no sea FIE ni
 * EFC. Si tienes el evento delante, llama a `colorDeOrganismo()` con
 * `organismoDe()`, que acierta más.
 */
export function organismoDeCircuito(circuito?: string | null): Organismo {
  if (!circuito) return 'RFEE';
  return organismoDe('skermo_rfee', 'NACIONAL', circuito);
}

/** Atajo: de un circuito a sus clases de color. */
export function colorDeCircuito(circuito?: string | null): ColorOrganismo {
  return COLOR_ORGANISMO[organismoDeCircuito(circuito)];
}

/** Atajo: de un organismo a sus clases de color. */
export function colorDeOrganismo(organismo: Organismo): ColorOrganismo {
  return COLOR_ORGANISMO[organismo];
}

/**
 * Cómo se nombra el circuito en la interfaz.
 *
 * Va aquí al lado del color para que quede claro que **son las dos mitades
 * de la misma señal**: el color dice el organismo, el texto dice el
 * circuito. Poner solo el color es incumplir `UI.md`.
 */
export function nombreDeCircuito(circuito?: string | null): string | null {
  if (!circuito) return null;
  return CIRCUIT_SHORT[circuito] ?? null;
}

/**
 * El orden de importancia de un circuito, de 1 (lo más) a 4.
 *
 * Es la otra forma de distinguir sin tocar el color: un Campeonato del Mundo
 * puede llevar la cifra más grande o el nombre en negrita, y una autonómica
 * la línea más callada. Se usa para elegir peso y tamaño, nunca tono.
 */
export function jerarquiaDeCircuito(circuito?: string | null): 1 | 2 | 3 | 4 {
  if (!circuito) return 3;
  if (['CTO_MUNDO', 'CTO_EUROPA', 'CTO_ESPANA'].includes(circuito)) return 1;
  if (['SEN_WC', 'JUN_WC', 'CAD_WC', 'SEN_GP', 'EFC_LEAGUE'].includes(circuito)) return 2;
  if (['TLM', 'CONCENTRACION', 'OTRO'].includes(circuito)) return 4;
  return 3;
}
