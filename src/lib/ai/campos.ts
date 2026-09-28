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
  /**
   * Por dónde se entra. NO es la dirección, y ese es todo el motivo de que sea
   * un campo aparte: en Lima el pabellón es «VELODROMO - CAR VIDENA (GATE 7)»
   * y la entrada está en «Av. San Luis N° 1308», que es otro barrio. Quien
   * llegue a la dirección del recinto se queda fuera.
   */
  venue_access: 'Acceso al pabellón',
  /**
   * El código de Google Maps del pabellón. Se llama «Código de Google Maps» y
   * no «Plus code» porque nadie sabe qué es un plus code, y lo que hay que
   * entender de un vistazo es que eso lleva al sitio.
   */
  venue_plus_code: 'Código de Google Maps',
  venue_map_place: 'Sitio en el mapa',
  venue_pistas: 'Pistas',
  venue_aforo: 'Aforo',
  venue_condiciones: 'Condiciones del pabellón',
  venue_pista_central: 'Pista central',
  venue_entrenamiento: 'Sala de entrenamiento',
  min_age: 'Edad mínima',
  organizer: 'Organiza',
  organizer_address: 'Dirección del organizador',
  fee_eur: 'Cuota',
  'fee_eur.equipos': 'Cuota por equipos',
  'fee_eur.extranjeros': 'Cuota de tiradores extranjeros',
  'fee_eur.acompanante': 'Cuota de acompañante',
  'fee_eur.arbitro': 'Cuota de árbitro',
  fee_concept: 'Concepto de la cuota',
  payment_method: 'Forma de pago',
  entry_quota: 'Cupo por federación',
  'entry_quota.anfitrion': 'Cupo del país anfitrión',
  'entry_quota.equipos': 'Cupo de equipos',
  referee_fine_eur: 'Multa por árbitro que falte',
  installation_open: 'Apertura de la instalación',
  call_time: 'Llamada',
  scratch_time: 'Scratch',
  start_time: 'Inicio',
  accreditation: 'Acreditación',
  weapon_control: 'Control de armas',
  pools_start: 'Poules',
  semifinals_start: 'Semifinales',
  final_start: 'Final',
  teams_start: 'Prueba por equipos',
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
  /**
   * Las formas de pago se reparten en `payment_method` y
   * `payment_method.<forma>` cuando el documento admite varias (Orán acepta
   * efectivo O transferencia). Las dos se rotulan IGUAL, «Forma de pago», sin
   * añadir el sufijo: el sufijo es el método y el método ya está en el valor
   * («Por transferencia»), así que pintarlo daría «Forma de pago ·
   * transferencia: Por transferencia».
   */
  ['payment_method.', 'Forma de pago'],
  /**
   * `fee_eur.` dice «Cuota» y no «Importe», que es lo que decía antes.
   *
   * Cambió porque ahora la categoría va en la clave: la cuota cadete de Lima
   * es `fee_eur.m17`, y «Importe · cadete» se lee como un cargo cualquiera
   * mientras que «Cuota · cadete» se lee como lo que es. El precio del hotel,
   * que era el otro habitante de este prefijo, ya no llega hasta aquí:
   * `pareceAlojamiento` lo descarta antes.
   */
  ['fee_eur.', 'Cuota'],
  ['fee_concept.', 'Concepto'],
  ['entry_quota.', 'Cupo'],
  ['entry_requirement', 'Requisito'],
  ['referee_quota.', 'Árbitros obligatorios'],
  ['category_allowed.', 'Categoría admitida'],
  ['link.', 'Enlace'],
  ['installation_open.', 'Apertura de la instalación'],
  ['call_time.', 'Llamada'],
  ['scratch_time.', 'Scratch'],
  ['start_time.', 'Inicio'],
  ['accreditation.', 'Acreditación'],
  ['weapon_control.', 'Control de armas'],
  ['pools_start.', 'Poules'],
  ['semifinals_start.', 'Semifinales'],
  ['final_start.', 'Final'],
  ['teams_start.', 'Prueba por equipos'],
];

/**
 * Trozos de clave que tienen nombre propio en castellano.
 *
 * Sin esta tabla, la cuota cadete se pintaba «Cuota · m17» y el tramo de
 * árbitros «Árbitros obligatorios · 10 mas». Son claves internas asomando por
 * la pantalla: correctas y ilegibles. Aquí se traducen los trozos que se
 * repiten; lo que no está se pinta tal cual, que es el comportamiento de
 * siempre y no miente.
 */
const NOMBRES_DE_TROZO: Record<string, string> = {
  m9: 'M9',
  m11: 'M11',
  m13: 'M13',
  m14: 'infantil',
  m15: 'M15',
  m17: 'cadete',
  m20: 'júnior',
  m23: 'sub-23',
  abs: 'absoluto',
  vet: 'veteranos',
  equipos: 'equipos',
  extranjeros: 'tiradores extranjeros',
  acompanante: 'acompañante',
  arbitro: 'árbitro',
  anfitrion: 'país anfitrión',
  federacion: 'por federación',
};

/**
 * Prefijos cuyo sufijo NO se pinta.
 *
 * El sufijo de un requisito sale de su propio texto —hace falta para que la
 * clave sea estable entre pasadas, ver `aPropuestas`— así que enseñarlo
 * repetiría el valor en la etiqueta: «Requisito · licencia fie 2026 2027 en
 * vigor: Licencia FIE 2026-2027 en vigor». La clave es un identificador, no un
 * rótulo.
 */
const PREFIJOS_SIN_COLA = new Set(['entry_requirement', 'payment_method.']);

/** Un tramo de árbitros: `1-4` y `10-mas` son rangos, no palabras. */
const RE_TRAMO = /^(\d+)-(\d+)$/;
const RE_TRAMO_ABIERTO = /^(\d+)-mas$/;
/** Una fecha ISO no se despedaza: `2026-10-08` es un día, no tres números. */
const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Traduce el sufijo de una clave a algo que se pueda leer.
 *
 * Se parte por PUNTOS, no por puntos y guiones, que es lo que hacía antes: el
 * guion separa dentro de un trozo («1-4», «2026-10-08», «florete-masculino») y
 * romperlo convertía una fecha en «2026 10 08». Cada trozo se traduce entero
 * si se le conoce nombre, y si no se deja tal cual.
 */
function legible(resto: string): string {
  return resto
    .split('.')
    .filter(Boolean)
    .map((trozo) => {
      const conocido = NOMBRES_DE_TROZO[trozo];
      if (conocido) return conocido;
      const abierto = trozo.match(RE_TRAMO_ABIERTO);
      if (abierto) return `${abierto[1]} o más`;
      const tramo = trozo.match(RE_TRAMO);
      if (tramo) return `de ${tramo[1]} a ${tramo[2]}`;
      if (RE_FECHA_ISO.test(trozo)) return trozo;
      return trozo.replace(/-+/g, ' ');
    })
    .join(' ');
}

/**
 * CLAVES QUE EL EXTRACTOR YA NO PUEDE PRODUCIR.
 *
 * POR QUÉ HACE FALTA ESTA LISTA, con el caso que la provocó
 * -------------------------------------------------------
 * El usuario mirando una ficha:
 *
 *   «109 € cuota, de la convocatoria / 109 € · alojamiento / 0,99 € · otro —
 *    lo de la cuota quítalo de "otro", no me interesa»
 *
 * Tres importes y dos —en realidad los tres— eran basura. Y el filtro
 * anti-hotel estaba puesto y funcionando, así que la primera explicación
 * («algo se cuela por el filtro») era falsa. Lo que pasaba, medido en la base:
 *
 *  · Las 86 extracciones registradas eran todas de las versiones de esquema 1
 *    y 2, ninguna de la 3.
 *  · `fee_eur.alojamiento` es una clave que el esquema de hoy NO PUEDE generar:
 *    'alojamiento' se quitó de `TIPOS_CUOTA` en la versión 3. Las 8 filas que
 *    quedaban eran fósiles de la versión 2.
 *  · La de 109 € es «Precio habitación doble de uso individual + desayuno:
 *    109 €». Y como no había ninguna propuesta con la clave exacta `fee_eur`,
 *    esa fila ocupaba ADEMÁS el hueco de «Cuota» en la ficha, porque la ficha
 *    acepta cualquier `fee_eur.*` para rellenarlo.
 *  · La de 0,99 € es «Tasa turística no incluida: 0,99 euros/persona/noche»,
 *    con la clave `fee_eur.otro`. Esa sí se podía generar, y por eso se ha
 *    retirado también el tipo 'otro' (ver `TIPOS_CUOTA`).
 *
 * El filtro de extracción no puede arreglar nada de esto, porque actúa cuando
 * se LEE el documento y estas filas ya estaban escritas. Y reprocesar no basta:
 * una propuesta que alguien haya aprobado está exenta de la regla de «solo la
 * lectura más nueva» y sobreviviría para siempre.
 *
 * Así que la regla es esta, y es la honesta: **una propuesta cuya clave el
 * extractor actual no sabe generar no es un dato pendiente de revisar, es el
 * resto de una versión retirada.** No se puede aprobar (no hay nada con lo que
 * compararla) y no se debe pintar. No se borra —el historial de qué sacaba cada
 * versión es justo lo que permite comparar— simplemente deja de salir.
 *
 * Es una lista NEGRA y no una lista blanca a propósito. Una lista blanca
 * tendría que enumerar todas las formas de clave válidas, incluidas las que
 * llevan sufijos libres (`entry_requirement.<texto>`,
 * `start_time.<fecha>.<prueba>`, `referee_quota.1-4`), y el día que se añada
 * un campo y se olvide la entrada, el dato bueno desaparecería de la ficha sin
 * que fallara ningún test. Una lista negra falla al contrario: si se olvida
 * algo, se sigue viendo. De los dos fallos posibles, este es el que se nota.
 */
const CAMPOS_RETIRADOS: RegExp[] = [
  /**
   * El tipo de cuota y el tipo de enlace 'alojamiento', retirados en la
   * versión de esquema 3. En la base quedaban `fee_eur.alojamiento` (8),
   * `fee_concept.alojamiento` (2) y `link.alojamiento`.
   */
  /^(?:fee_eur|fee_concept|link)\.alojamiento(?:\.|$)/,
  /**
   * El tipo de cuota 'otro', retirado en la versión 4. Solo el de CUOTA: el
   * 'otro' de las formas de pago (`payment_method`) y el de los enlaces
   * (`link.otro`) siguen vivos y significan algo.
   */
  /^(?:fee_eur|fee_concept)\.otro(?:\.|$)/,
];

/**
 * ¿Esta clave la puede producir el extractor de hoy?
 *
 * Se consulta en la CONSULTA de la ficha (`src/lib/queries/calendar.ts`), que
 * es el único sitio por el que un dato extraído llega a una pantalla. Vive
 * aquí y no en `extract.ts` por lo que explica la cabecera de este fichero:
 * este módulo no importa nada y se puede llamar desde el camino crítico del
 * calendario sin arrastrar Zod ni la base de datos.
 */
export function esCampoExtraidoVigente(campo: string): boolean {
  return !CAMPOS_RETIRADOS.some((patron) => patron.test(campo));
}

/**
 * Los patrones de campo retirado como texto, para poder filtrarlos en SQL.
 *
 * Se derivan de la MISMA lista de arriba para que no puedan desincronizarse:
 * un filtro en SQL y otro en JavaScript que digan cosas distintas es peor que
 * no tener ninguno, porque parecería que está resuelto.
 */
export const PATRONES_CAMPO_RETIRADO_SQL = [
  'fee_eur.alojamiento%',
  'fee_concept.alojamiento%',
  'link.alojamiento%',
  'fee_eur.otro%',
  'fee_concept.otro%',
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
      if (PREFIJOS_SIN_COLA.has(prefijo)) return etiqueta;
      const resto = legible(campo.slice(prefijo.length));
      return resto ? `${etiqueta} · ${resto}` : etiqueta;
    }
  }
  return campo;
}
