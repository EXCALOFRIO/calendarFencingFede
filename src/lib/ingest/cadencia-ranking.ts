/**
 * ===========================================================================
 * CUÁNDO TOCA LEER EL RANKING NACIONAL
 * ===========================================================================
 *
 * El ranking oficial de la RFEE se leía **todas las noches**, y eso es gastar
 * por gastar: el ranking solo cambia cuando se disputa una competición que
 * puntúa, y en una temporada hay unas treinta. El resto de las noches se
 * descargaban las mismas 1.235 filas para no cambiar nada.
 *
 * La cadencia que pidió el usuario, literal: *«el ranking después de cada TNR
 * y eso 3 días seguidos, y después cada semana»*. Y tiene sentido operativo:
 * la federación no publica el ranking actualizado el mismo domingo por la
 * noche —lo sube en los días siguientes—, así que hay que insistir unos días
 * y luego bajar la guardia.
 *
 * O sea, dos motivos para leer:
 *
 *   1. **Acaba de haber competición.** Se lee los tres días siguientes al
 *      cierre de cualquier prueba que puntúe, porque no se sabe en cuál de
 *      ellos van a publicar.
 *   2. **Mantenimiento semanal.** Aunque no haya habido nada, se lee una vez
 *      por semana: por si la federación corrige una puntuación de una
 *      competición vieja, que pasa.
 *
 * POR QUÉ NO SE HACE CON LOS CRONS DE CLOUDFLARE
 * ----------------------------------------------
 * Porque los crons son fijos y esto depende del calendario, que cambia. No se
 * puede escribir «tres días después de un TNR» en una expresión cron: hay que
 * mirar cuándo fue la última competición. Así que el cron sigue disparando
 * cada noche —cuesta cero— y **la decisión de descargar se toma aquí**. Es el
 * mismo patrón que ya usa la ingestión de circulares con los hashes: el cron
 * se levanta, mira, y casi siempre no hace nada.
 *
 * Y por qué es una función pura, sin base de datos dentro: para poder probarla
 * con fechas concretas. Los fallos de calendario —el que empieza en domingo,
 * el cambio de hora, el año nuevo— no se encuentran razonando, se encuentran
 * con casos.
 */

/** Cuántos días seguidos se insiste después de una competición. */
export const DIAS_TRAS_COMPETICION = 3;

/** Cada cuánto se lee cuando no ha habido competición. */
export const DIAS_DE_MANTENIMIENTO = 7;

export type MotivoRanking =
  | 'tras_competicion'
  | 'mantenimiento_semanal'
  | 'primera_vez';

export type DecisionRanking =
  | { leer: true; motivo: MotivoRanking; explicacion: string }
  | { leer: false; explicacion: string };

/** Días naturales completos entre dos instantes, en positivo. */
function diasEntre(desde: Date, hasta: Date): number {
  return Math.floor((hasta.getTime() - desde.getTime()) / 86_400_000);
}

/**
 * ¿Toca leer el ranking?
 *
 * @param ahora           el instante de la ejecución.
 * @param ultimaLectura   cuándo se leyó con éxito por última vez. `null` = nunca.
 * @param finesRecientes  fechas de FIN de las pruebas que puntúan, de las más
 *                        recientes. No hace falta que estén ordenadas ni
 *                        filtradas: aquí se mira solo si alguna cae dentro de
 *                        la ventana.
 */
export function tocaLeerRanking(
  ahora: Date,
  ultimaLectura: Date | null,
  finesRecientes: Date[],
): DecisionRanking {
  /**
   * Nunca se ha leído: se lee, sin más preguntas. Esto cubre el primer
   * despliegue y el caso de que alguien borre la tabla.
   */
  if (!ultimaLectura) {
    return {
      leer: true,
      motivo: 'primera_vez',
      explicacion: 'No hay ninguna lectura anterior del ranking.',
    };
  }

  /**
   * ¿Hay alguna competición que haya terminado dentro de la ventana?
   *
   * Se cuenta desde el FIN de la prueba y no desde el inicio, porque el
   * ranking no puede cambiar hasta que la competición ha acabado. Y se
   * incluye el día 0 —el mismo día en que termina— porque un torneo que
   * acaba el domingo por la mañana puede estar publicado esa misma noche.
   */
  const recientes = finesRecientes.filter((fin) => {
    const dias = diasEntre(fin, ahora);
    return dias >= 0 && dias < DIAS_TRAS_COMPETICION;
  });

  if (recientes.length > 0) {
    /**
     * Aquí NO se mira cuándo fue la última lectura: la gracia es insistir
     * los tres días aunque ayer ya se leyera, porque lo que se espera es que
     * la federación publique, y no se sabe qué día lo hará.
     */
    const ultimoFin = recientes.reduce((a, b) => (a > b ? a : b));
    const dias = diasEntre(ultimoFin, ahora);
    return {
      leer: true,
      motivo: 'tras_competicion',
      explicacion:
        `Hubo una prueba que puntúa que terminó hace ${dias} ` +
        `${dias === 1 ? 'día' : 'días'}; se insiste durante ` +
        `${DIAS_TRAS_COMPETICION} días por si la federación acaba de publicar.`,
    };
  }

  const desdeLaUltima = diasEntre(ultimaLectura, ahora);
  if (desdeLaUltima >= DIAS_DE_MANTENIMIENTO) {
    return {
      leer: true,
      motivo: 'mantenimiento_semanal',
      explicacion:
        `Sin competiciones recientes, pero la última lectura fue hace ` +
        `${desdeLaUltima} días: toca la revisión semanal.`,
    };
  }

  return {
    leer: false,
    explicacion:
      `Ninguna prueba que puntúe ha terminado en los últimos ` +
      `${DIAS_TRAS_COMPETICION} días y el ranking se leyó hace ` +
      `${desdeLaUltima} ${desdeLaUltima === 1 ? 'día' : 'días'}. ` +
      `Se vuelve a mirar cuando pasen ${DIAS_DE_MANTENIMIENTO}.`,
  };
}
