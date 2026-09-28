/**
 * Las dos reglas puras de «Mi estado», fuera de la consulta para poder probarlas.
 *
 * Están aquí y no dentro de `consultas.ts` porque ese fichero abre la conexión
 * a la base: importarlo desde una prueba arrastraría el módulo de Neon, y
 * además las dos reglas se leen también desde un componente de cliente. Es la
 * misma separación que ya hace `src/lib/callups/tipos.ts`.
 *
 * Y están fuera porque son **reglas de visibilidad**, que es la clase de código
 * que se rompe en silencio: nadie ve un error, simplemente alguien lee «no
 * estás» cuando sí está, y se entera al llegar al pabellón. Las cubre
 * `tests/estado.test.ts`.
 */

/**
 * Qué dice la lista OFICIAL de una prueba sobre uno de mis tiradores.
 *
 *   `dentro`        su ficha figura en la lista publicada. Manda esto.
 *   `sin_emparejar` la fuente publica la lista pero ninguna fila trae licencia,
 *                   así que la aplicación **no puede afirmar nada**.
 *   `sin_publicar`  la fuente todavía no ha publicado inscritos.
 *
 * El estado del medio existe porque hoy es el normal: hay miles de filas de
 * listas oficiales en la base y ninguna trae licencia, que es lo único por lo
 * que se empareja (`src/lib/ingest/upsert.ts`: «lo que no se hace jamás es
 * emparejar por nombre»). **Decirle a alguien «no estás» cuando su nombre sí
 * aparece en la lista es tan dañino como lo contrario**, así que no se dice: se
 * dice «sin confirmar» y se da el enlace a la lista de la fuente.
 */
export type EstadoOficial = 'dentro' | 'sin_emparejar' | 'sin_publicar';

export function estadoDeListaOficial(entrada: {
  /** ¿Hay una fila de la lista oficial emparejada con su ficha? */
  emparejado: boolean;
  /** Cuántos inscritos publica la fuente en esa prueba. */
  publicados: number;
}): EstadoOficial {
  if (entrada.emparejado) return 'dentro';
  return entrada.publicados > 0 ? 'sin_emparejar' : 'sin_publicar';
}

/**
 * Días naturales entre dos fechas ISO (`YYYY-MM-DD`), contados en UTC.
 *
 * En UTC a propósito: el mismo número en el servidor y en el navegador, aunque
 * el móvil esté en otro huso o haya pasado la medianoche entre el renderizado y
 * la hidratación. Con `new Date(iso)` y aritmética local, React avisaba de una
 * discrepancia justo en la cifra más grande de la pantalla.
 */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * ¿Se pinta la barra de tramos en esta fila?
 *
 * **Solo en la primera, y solo si el plazo aprieta.** La barra es la mejor
 * respuesta que tiene la aplicación a «¿cuánto me queda?» —dice el tramo en el
 * que estás, el recargo de cada ventana y la fecha de cada hito— pero ocupa
 * cuatro líneas y arrastra su propio aviso de fechas estimadas, que no se puede
 * apagar desde fuera (y está bien que no se pueda: un plazo deducido de la
 * normativa no se presenta igual que uno publicado).
 *
 * Repetida en las cinco filas, medido en `capturas/nuevo-tutora-*-estado.png`:
 * la pantalla se iba a 3.502 px en un iPhone y el mismo párrafo de fechas
 * estimadas salía cinco veces. Eso no informa, ocupa.
 *
 * Así que se pinta una vez, en la fila que antes cierra, que es la única en la
 * que el tramo y el recargo cambian una decisión hoy. En las demás van la cifra
 * de días, la fecha de cierre y el recargo posterior en sus rótulos, que es
 * exactamente lo que hay que saber para decidir «esto todavía no corre prisa».
 */
export function conBarraDePlazos(
  estado: { state: 'verde' | 'ambar' | 'rojo' | 'cerrado' | 'sin_datos' },
  /** `true` solo en la primera fila de la lista, que va ordenada por urgencia. */
  destacada: boolean,
): boolean {
  return destacada && (estado.state === 'rojo' || estado.state === 'ambar');
}
