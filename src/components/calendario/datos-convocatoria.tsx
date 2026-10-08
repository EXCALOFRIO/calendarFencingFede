import type { DatoExtraidoView } from '@/lib/queries/calendar';

/**
 * ===========================================================================
 * LO QUE DICE LA CONVOCATORIA
 * ===========================================================================
 *
 * El calendario de la RFEE y el de la FIE publican muy poco: de 274 eventos,
 * 246 no traen pabellón; de 484 pruebas, 23 traen hora de inicio y NINGUNA
 * trae cuota. El PDF de la convocatoria sí lo dice, y ya está leído. Cada dato
 * leído va **en el hueco que le toca**: el pabellón donde está el pabellón,
 * las horas en el horario, la cuota en las condiciones. No es una tabla de
 * «campos extraídos», que sería el PDF otra vez con otra tipografía.
 *
 * TRES REGLAS QUE NO SON ESTÉTICAS
 * --------------------------------
 *  1. `pisadoPorPublicado` → **manda el publicado**. El valor extraído no se
 *     pinta como el bueno.
 *  2. `estado: 'sin_revisar'` → nadie lo ha comprobado, y se dice con una
 *     pastilla junto a su cita.
 *  3. La **cita viaja siempre y tiene que poder verse**. Un dato sacado de un
 *     PDF sin la frase de la que sale no se puede comprobar.
 *
 * CÓMO SE ENSEÑA LA CITA SIN ENSUCIAR
 * -----------------------------------
 * Ni un icono pegado detrás de cada valor («80 € ⧉» se leía como parte del
 * precio) ni un valor que es un botón: cada apartado de la ficha lleva UN
 * botón discreto, «Según la convocatoria», que abre una hoja con las frases
 * literales de lo que ese apartado ha leído (`ficha/segun-convocatoria.tsx`).
 */

// ---------------------------------------------------------------------------
// Elegir qué dato extraído ocupa cada hueco
// ---------------------------------------------------------------------------

/**
 * ¿Este dato puede ocupar el hueco principal de su campo?
 *
 * Dos filtros, los dos con un falso positivo real detrás:
 *
 *  · **Importes sin moneda en la cita.** El modelo sacó
 *    `fee_eur.equipos = 2,00 €` de la frase «un máximo de 2 equipos por
 *    arma». La cifra es correcta y el campo es un disparate. Si la frase de
 *    la que sale no menciona euros, no se enseña como precio.
 *  · **Pabellón que es la ciudad.** «Pabellón: Madrid» no es un pabellón; es
 *    lo que queda cuando la circular no lo dice. Un botón que promete el
 *    pabellón y abre el centro de una ciudad es peor que no tener botón.
 *
 * Lo descartado **no se esconde**: sigue en «Otros datos de la convocatoria»,
 * con su cita. Lo que no hace es ocupar el sitio del dato bueno.
 */
export function creible(dato: DatoExtraidoView, ciudad: string | null): boolean {
  /*
    La moneda, también como código ISO: las convocatorias de la FIE escriben
    «Individual entry: 80 EUR» y «Individual competition: EUR 80», sin el
    símbolo y sin la palabra. Pidiendo solo «€» o «euro» se tiraba la cuota
    buena —leída, atribuida y con su cita— y la ficha decía «cuota no
    publicada» en las Copas del Mundo. Medido en las convocatorias ya leídas:
    de siete citas de cuota de la FIE, cuatro lo escriben así.
  */
  if (dato.campo.startsWith('fee_eur') && !/€|\beur\b|euros?/i.test(dato.cita)) {
    return false;
  }
  if (dato.campo === 'venue' && ciudad && aplanado(dato.valor) === aplanado(ciudad)) {
    return false;
  }
  return true;
}

function aplanado(v: string) {
  return v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/**
 * El dato leído que ocupa un hueco, o `null` si no hay ninguno utilizable.
 *
 * `campo` casa por prefijo porque los horarios llevan sufijo de día y de
 * prueba (`start_time.2026-10-04.florete-masculino`), pero **el campo exacto
 * gana**: `fee_eur` es la cuota y `fee_eur.alojamiento` es otra cosa, y sin
 * este orden el hotel se colaba en el hueco de la inscripción.
 *
 * Si el mismo campo viene varias veces —dos documentos que dicen cosas
 * distintas— gana lo revisado por una persona; a igualdad, el primero, y los
 * demás siguen visibles en el desplegable del final. Aquí no se promedia ni
 * se elige «el más probable»: eso sería inventar.
 */
export function huecoDe(
  datos: DatoExtraidoView[],
  campo: string,
  ciudad: string | null = null,
): DatoExtraidoView | null {
  const candidatos = datos
    .filter(
      (d) =>
        (d.campo === campo || d.campo.startsWith(`${campo}.`)) &&
        !d.pisadoPorPublicado &&
        creible(d, ciudad),
    )
    .sort((a, b) => {
      const exacto = Number(b.campo === campo) - Number(a.campo === campo);
      if (exacto !== 0) return exacto;
      return Number(b.estado === 'aprobado') - Number(a.estado === 'aprobado');
    });
  return candidatos[0] ?? null;
}

/**
 * Los importes que NO son la cuota de inscripción: alojamiento, extranjeras,
 * media pensión. Llevan su concepto en la clave (`fee_eur.alojamiento`), y ese
 * concepto es justo lo que hace falta para que la cifra signifique algo.
 */
export function importesExtra(datos: DatoExtraidoView[]): DatoExtraidoView[] {
  return datos.filter(
    (d) =>
      d.campo.startsWith('fee_eur.') && !d.pisadoPorPublicado && creible(d, null),
  );
}

/** Lo que la convocatoria dice de un plazo, que nunca sustituye al oficial. */
export function plazosDeConvocatoria(
  datos: DatoExtraidoView[],
): DatoExtraidoView[] {
  return datos.filter((d) => d.campo.startsWith('deadline.'));
}

/**
 * Lo que la convocatoria dice de un campo QUE YA PUBLICA la fuente.
 *
 * Solo interesa cuando dice algo **distinto**: si coincide, repetirlo es
 * ruido. Cuando difiere no se cambia el valor —manda el publicado— pero se
 * puede decir, y decirlo es información: alguien tiene que enterarse de que
 * el papel y el calendario no cuadran.
 */
export function contradiccion(
  datos: DatoExtraidoView[],
  campo: string,
  publicado: string | null,
): DatoExtraidoView | null {
  if (!publicado) return null;
  return (
    datos.find(
      (d) =>
        (d.campo === campo || d.campo.startsWith(`${campo}.`)) &&
        d.pisadoPorPublicado &&
        aplanado(d.valor) !== aplanado(publicado),
    ) ?? null
  );
}

/**
 * Los enlaces de la convocatoria que MERECEN un botón.
 *
 * Y no son todos, que es lo que se vio al mirar la captura: en la ficha del
 * TNR M17 de Alcobendas salían cinco filas iguales —`esgrimaalcobendas.org`,
 * `engarde-service.com`, `g.co`, `crtm.es`, `uvehoteles.com`— con el mismo
 * peso que la convocatoria oficial. Cinco botones al mismo nivel para un
 * acortador de Google Maps y la web del transporte de Madrid: eso es la lista
 * de campos extraídos que había que evitar, con otro aspecto.
 *
 * El criterio sale de la propia clave. Cuando la extracción **sabe qué es** el
 * enlace, la clave tiene un solo tramo (`link.web`, `link.inscripcion`,
 * `link.alojamiento`). Cuando solo ha visto una URL suelta en el texto, le
 * cuelga el dominio como sufijo (`link.web.https-g-co-kgs-8nfl7gj`): eso es
 * «he encontrado una dirección y no sé de qué es», y no da para un botón.
 *
 * Lo demás no se pierde: sigue en el desplegable con su cita, que es donde se
 * puede juzgar si vale algo.
 */
export function enlacesDeConvocatoria(
  datos: DatoExtraidoView[],
): DatoExtraidoView[] {
  const vistos = new Set<string>();
  const salida: DatoExtraidoView[] = [];
  for (const d of datos) {
    if (!d.campo.startsWith('link.')) continue;
    if (d.campo.split('.').length !== 2) continue;
    const destino = d.valor.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (vistos.has(destino)) continue;
    vistos.add(destino);
    salida.push(d);
  }
  return salida;
}

/** Cómo se llama en pantalla un enlace de la convocatoria. */
const NOMBRE_ENLACE: Record<string, string> = {
  'link.web': 'Web del organizador',
  'link.inscripcion': 'Inscripción',
  'link.alojamiento': 'Alojamiento',
  'link.resultados': 'Resultados',
  'link.reglamento': 'Reglamento',
};

export function nombreDeEnlace(d: DatoExtraidoView): string {
  return NOMBRE_ENLACE[d.campo] ?? dominioDe(d.valor);
}

/** Nombre corto del destino de un enlace, para ponerlo en un botón. */
export function dominioDe(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(
      /^www\./,
      '',
    );
  } catch {
    return url;
  }
}

/**
 * ¿Este campo habla de dinero o de árbitros?
 *
 * Es el filtro que quita de la tarjeta la cuota de inscripción, la de equipos,
 * las de cadete y júnior, la multa por árbitro que falte y los tramos de
 * árbitros obligatorios. Petición literal del usuario sobre la ficha de Lima:
 * *«lo del precio porfa quítalo que no lo quiero mostrar, lo de la inscripción
 * y lo de los equipos cuánto cuesta, ni el árbitro; lo de cuotas ocúltalo de
 * las tarjetas»*.
 *
 * La ficha enseña UNA cifra: la cuota de la prueba elegida, limpia, en
 * «Condiciones». Todo lo demás que pase este filtro (la cuota de la otra
 * modalidad, alojamiento, cadete, multas y tramos de árbitros) no sale ni en
 * las condiciones ni en «Más datos» (`inscripcionDe` lo da por usado). Está en
 * un solo sitio porque media ocultación es peor que ninguna: deja el importe
 * asomando por el sitio que nadie revisó.
 *
 * **No se deja de extraer.** Los importes se siguen leyendo, se guardan con su
 * cita y se ven en Gestión › Extracción, que es donde los mira quien tramita.
 */
export function esImporte(campo: string): boolean {
  return (
    campo === 'fee_eur' ||
    campo.startsWith('fee_eur.') ||
    campo === 'fee_concept' ||
    campo.startsWith('fee_concept.') ||
    campo === 'referee_fine_eur' ||
    campo.startsWith('referee_quota.')
  );
}
