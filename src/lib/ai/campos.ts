/**
 * Nombres en castellano de los campos que salen de un PDF.
 *
 * POR QUÉ ESTÁ EN SU PROPIO FICHERO Y NO EN `extract.ts`
 * -----------------------------------------------------
 * Lo usan dos sitios muy distintos: la pantalla de revisión (que ya carga todo
 * el módulo de extracción) y `src/lib/queries/calendar.ts`, que es el camino
 * crítico del calendario y de la ficha. `extract.ts` importa
 * `getCloudflareContext`, `zod` y —por importación dinámica— la base de datos:
 * arrastrar todo eso hasta la consulta del calendario para traducir "venue" a
 * "Pabellón" sería pagar un módulo entero por una tabla de cadenas.
 *
 * Aquí no se importa nada. A propósito.
 *
 * Las claves son las mismas que produce `aPropuestas` en `extract.ts`, y las
 * mismas que las columnas de `event` y `event_competition`. Las dos listas
 * tienen que cambiar juntas: un campo nuevo sin etiqueta se pinta con su clave
 * cruda, que es fea pero no miente.
 */

const ETIQUETAS_CAMPO: Record<string, string> = {
  venue: 'Pabellón',
  venue_address: 'Dirección',
  venue_city: 'Localidad',
  fee_eur: 'Cuota',
  fee_concept: 'Concepto de la cuota',
  installation_open: 'Apertura de la instalación',
  call_time: 'Llamada',
  scratch_time: 'Scratch',
  start_time: 'Inicio',
};

/**
 * Prefijos, para los campos que llevan sufijo: `deadline.L2`,
 * `start_time.2026-10-04.florete-masculino`, `link.inscripcion`.
 *
 * El orden importa: se devuelve el PRIMERO que casa, así que los prefijos más
 * largos van antes que los más cortos cuando uno contiene al otro.
 */
const ETIQUETAS_PREFIJO: [string, string][] = [
  ['deadline.', 'Plazo'],
  ['fee_eur.', 'Importe'],
  ['fee_concept.', 'Concepto'],
  ['category_allowed.', 'Categoría admitida'],
  ['link.', 'Enlace'],
  ['installation_open.', 'Apertura de la instalación'],
  ['call_time.', 'Llamada'],
  ['scratch_time.', 'Scratch'],
  ['start_time.', 'Inicio'],
];

/**
 * Nombre legible de un campo extraído. Nunca devuelve cadena vacía: si el
 * campo no se reconoce se devuelve su clave.
 */
export function etiquetaDeCampo(campo: string): string {
  const exacta = ETIQUETAS_CAMPO[campo];
  if (exacta) return exacta;
  for (const [prefijo, etiqueta] of ETIQUETAS_PREFIJO) {
    if (campo.startsWith(prefijo)) {
      const resto = campo.slice(prefijo.length).replace(/[.-]+/g, ' ').trim();
      return resto ? `${etiqueta} · ${resto}` : etiqueta;
    }
  }
  return campo;
}
