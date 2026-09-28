/**
 * Rellena `official_document.file_hash`: el SHA-256 del PDF de cada circular.
 *
 *   npx tsx scripts/hashes-documentos.ts                 -> 60 documentos, de 4 en 4
 *   npx tsx scripts/hashes-documentos.ts --tope=300       -> hasta 300 en esta pasada
 *   npx tsx scripts/hashes-documentos.ts --tanda=8        -> 8 descargas a la vez
 *   npx tsx scripts/hashes-documentos.ts --dias=30        -> reintenta fallos de hace 30 días
 *   npx tsx scripts/hashes-documentos.ts --sin-vigencia   -> no recalcula la vigencia
 *
 * POR QUÉ HACE FALTA
 * ------------------
 * De los 278 documentos oficiales, 278 tienen una `pdf_url` distinta y solo 39
 * tenían hash. Sin el hash no se puede saber si dos entradas del muro de la
 * RFEE son el MISMO fichero subido dos veces, que es la base de todo lo demás:
 * «mismo hash = mismo documento». Es lo que permite marcar una circular como
 * `duplicada` en `documento_vigencia`, y lo que evita pagarle a un modelo la
 * lectura de un PDF que ya se leyó con otro nombre.
 *
 * LA REGLA QUE MANDA AQUÍ: CADA CONSULTA ES UN VIAJE DE RED
 * --------------------------------------------------------
 * El driver de Neon habla por HTTP. El comentario de los 116 segundos de
 * `src/lib/ingest/upsert.ts` cuenta lo que pasa cuando esto se olvida: un
 * SELECT por fila y un calendario tarda dos minutos. Aquí eso sería aún peor
 * porque además hay una descarga por documento, así que la aritmética es:
 *
 *   - UNA consulta para saber qué falta (con LEFT JOIN, no dos consultas).
 *   - Por tanda de `--tanda` documentos, DOS consultas: un `UPDATE … FROM
 *     (VALUES …)` con todos los hashes de la tanda y un `INSERT … ON CONFLICT`
 *     con toda la contabilidad. Nunca un UPDATE por documento.
 *   - UNA consulta final para contar duplicados.
 *
 * MEDIDO SOBRE LOS 237 PENDIENTES REALES, en tandas de 4:
 *
 *   237 documentos · 237 peticiones HTTP · 128 consultas · 84,2 MB
 *   11,8 s en total, 50 ms por documento, 144 ms de descarga media
 *
 * Un UPDATE por documento habrían sido 237 viajes más solo para escribir
 * sesenta caracteres cada vez, y la pasada habría tardado el triple.
 *
 * Y la segunda pasada seguida: 0 peticiones HTTP, 2 consultas, 0,5 s. Esa es
 * la medida de que esto está bien hecho, no la primera.
 *
 * POR QUÉ ES REANUDABLE, Y POR QUÉ ESO NO ES UN LUJO
 * --------------------------------------------------
 * 32 de los 278 documentos dan 404: son enlaces rotos en el muro de la propia
 * federación —se comprobó contra su API de WordPress, que devuelve EXACTAMENTE
 * la misma URL que tenemos guardada, así que el fichero ya no está en su
 * servidor y nuestra copia es fiel—. Sin memoria de los intentos, esos 32 se
 * reintentarían todas las noches para siempre. La memoria está en
 * `documento_vigencia` (`hash_intentado_en` y `hash_error`), y por eso la
 * consulta de pendientes es «hash a null Y sin intento en los últimos N días».
 *
 * `--tope` existe por la misma razón: una pasada no puede poder tumbar nada.
 * Con el tope puesto, lo peor que hace una ejecución es 60 descargas.
 *
 * LO QUE ESTE SCRIPT NO HACE
 * --------------------------
 * No manda nada a ningún modelo. Descarga bytes y los hashea; ni abre el PDF
 * ni le saca el texto. Por eso no le afectan ni el cortafuegos de datos
 * personales de `src/lib/ai/extract.ts` ni el coste por token: se puede lanzar
 * sobre los 278 sin pensarlo dos veces.
 */

import 'dotenv/config';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../src/db';
import { documentoVigencia, officialDocument } from '../src/db/schema';
import { descargarPdf, hashDocumento } from '../src/lib/ai/extract';
import { recalcularVigencia } from '../src/lib/documentos/recalcular';

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

function argumentoNumerico(nombre: string, porDefecto: number): number {
  const prefijo = `--${nombre}=`;
  const crudo = process.argv.find((a) => a.startsWith(prefijo));
  if (!crudo) return porDefecto;
  const valor = Number.parseInt(crudo.slice(prefijo.length), 10);
  if (!Number.isInteger(valor) || valor <= 0) {
    console.error(`--${nombre} tiene que ser un entero positivo.`);
    process.exit(1);
  }
  return valor;
}

/** Cuántas descargas simultáneas, y también cada cuántas se vuelca a la base. */
const TANDA = argumentoNumerico('tanda', 4);
/** Tope de documentos de ESTA ejecución. Se vuelve a lanzar y sigue donde iba. */
const TOPE = argumentoNumerico('tope', 60);
/** Cuánto se espera antes de reintentar un documento que ya falló. */
const DIAS_REINTENTO = argumentoNumerico('dias', 7);
/** Escape para cuando se está tocando `src/lib/documentos/` y no interesa. */
const SIN_VIGENCIA = process.argv.includes('--sin-vigencia');

// ---------------------------------------------------------------------------
// Contadores: el informe del final tiene que ser medido, no estimado
// ---------------------------------------------------------------------------

let consultas = 0;
let peticionesHttp = 0;
let bytesDescargados = 0;

const t0 = Date.now();

// ---------------------------------------------------------------------------
// 1. Una sola consulta: qué falta por hashear
// ---------------------------------------------------------------------------

const limiteReintento = new Date(Date.now() - DIAS_REINTENTO * 24 * 60 * 60 * 1000);

/**
 * `official_document` tiene 278 filas, así que se trae la lista ENTERA de
 * pendientes en un viaje y el `--tope` se aplica en memoria. Un `LIMIT` en SQL
 * ahorraría unos kilobytes pero costaría una segunda consulta para saber
 * cuántos quedan, que es justo el dato que hace falta para decidir si volver a
 * lanzarlo. Si esta tabla llegara a miles de filas habría que darle la vuelta.
 *
 * El `LEFT JOIN` es lo que hace que sea UNA consulta y no dos: hay documentos
 * sin fila de vigencia y tienen que salir igual (`hash_intentado_en` a null).
 * `published_at DESC` porque lo recién publicado es lo que alguien está
 * mirando ahora mismo en la aplicación.
 */
const pendientes = await db
  .select({
    id: officialDocument.id,
    titulo: officialDocument.title,
    url: officialDocument.pdfUrl,
    publicadoEn: officialDocument.publishedAt,
    // Se arrastran para poder reenviarlas en el `INSERT … ON CONFLICT` sin
    // inventarse nada: son los valores que YA tiene la fila.
    familia: documentoVigencia.familia,
    asunto: documentoVigencia.asunto,
    estado: documentoVigencia.estado,
  })
  .from(officialDocument)
  .leftJoin(documentoVigencia, eq(documentoVigencia.documentoId, officialDocument.id))
  .where(
    and(
      isNull(officialDocument.fileHash),
      or(
        isNull(documentoVigencia.hashIntentadoEn),
        lt(documentoVigencia.hashIntentadoEn, limiteReintento),
      ),
    ),
  )
  .orderBy(desc(officialDocument.publishedAt));
consultas += 1;

type Pendiente = (typeof pendientes)[number];

const aRevisar = pendientes.slice(0, TOPE);

// ---------------------------------------------------------------------------
// 2. La contabilidad necesita que su fila exista
// ---------------------------------------------------------------------------

/**
 * `documento_vigencia` tiene `familia`, `asunto` y `estado` como NOT NULL, así
 * que no se puede crear una fila «solo para apuntar el intento» sin inventarse
 * una decisión de vigencia que nadie ha calculado —y un `estado` inventado se
 * enseñaría en `/documentos` como si fuera un dato de la federación—. La salida
 * honesta es llamar a la función que el propio repositorio tiene para poblar
 * esa tabla: `recalcularVigencia()` no descarga nada, son tres consultas y
 * medio segundo, es idempotente y está escrita para NO pisar `hash_intentado_en`
 * ni `hash_error` (ver su comentario). Hecho esto, la contabilidad de la pasada
 * es un `ON CONFLICT DO UPDATE` sobre una fila que ya existe.
 *
 * VA DESPUÉS DE LA CONSULTA DE PENDIENTES, Y CONDICIONADO, A PROPÓSITO: la
 * ejecución que no tiene nada que hacer —la de todas las noches— no puede
 * gastar tres viajes de red en recalcular una tabla que no le hace falta. Así
 * el camino de «nada nuevo» son dos consultas y cero peticiones HTTP.
 *
 * No hace falta volver a leer los pendientes después: los valores de
 * `familia`/`asunto`/`estado` que esta pasada manda en el INSERT los descarta
 * el `ON CONFLICT` cuando la fila existe, que es el caso justo después de
 * recalcular. Solo se usan de verdad con `--sin-vigencia`.
 */
if (!SIN_VIGENCIA && aRevisar.some((f) => f.estado === null)) {
  const v = await recalcularVigencia();
  consultas += v.consultas;
  console.log(
    `Vigencia al día: ${v.total} documentos en ${v.familias} familias ` +
      `(${v.consultas} consultas, ${v.duracionMs} ms).`,
  );
}

// ---------------------------------------------------------------------------
// 3. Descarga y hash, con la concurrencia acotada
// ---------------------------------------------------------------------------

type ResultadoOk = { fila: Pendiente; ok: true; hash: string; bytes: number; ms: number };
type ResultadoFallo = { fila: Pendiente; ok: false; error: string; ms: number };
type Resultado = ResultadoOk | ResultadoFallo;

const LIMITE_MOTIVO = 300;

/** El motivo, en una línea y acotado: va a una columna que se enseña. */
function motivoDeError(error: unknown): string {
  const texto =
    error instanceof Error
      ? error.name && error.name !== 'Error'
        ? `${error.name}: ${error.message}`
        : error.message
      : String(error);
  return texto.replace(/\s+/g, ' ').trim().slice(0, LIMITE_MOTIVO);
}

/**
 * Comprueba que lo descargado es de verdad un PDF, y no es una pijada.
 *
 * WordPress responde a algunas rutas muertas con un 200 y una página de error
 * en HTML. Hashear eso sin mirar sería el peor resultado posible de esta
 * pasada: todas esas páginas comparten el mismo hash, así que aparecería una
 * familia de «duplicados exactos» de veinte circulares que no tienen nada que
 * ver entre ellas, y encima con el hash puesto, o sea, sin volver a intentarse.
 * Un fallo declarado es infinitamente mejor que un hash falso.
 *
 * La cabecera no se exige en el byte 0 a propósito: el formato permite basura
 * delante y los lectores la buscan dentro del primer kilobyte.
 */
function pareceUnPdf(bytes: Uint8Array): boolean {
  const cabeza = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return cabeza.includes('%PDF-');
}

/** Para poder decir en el error QUÉ llegó, si no llegó un PDF. */
function asomarse(bytes: Uint8Array): string {
  return new TextDecoder('latin1')
    .decode(bytes.subarray(0, 80))
    .replace(/[^\x20-\x7e]/g, '.')
    .trim();
}

let hechos = 0;

async function procesar(fila: Pendiente): Promise<Resultado> {
  const t = Date.now();
  // Se cuenta el INTENTO, no el acierto: un 404 también es un viaje de red y
  // el informe tiene que decir la verdad sobre lo que se ha pedido a la RFEE.
  peticionesHttp += 1;
  try {
    const pdf = await descargarPdf(fila.url);
    bytesDescargados += pdf.byteLength;
    if (pdf.byteLength === 0) throw new Error('El fichero vino vacío (0 bytes).');
    if (!pareceUnPdf(pdf)) {
      throw new Error(
        `La respuesta no es un PDF: ${pdf.byteLength} bytes que empiezan por «${asomarse(pdf)}».`,
      );
    }
    const hash = await hashDocumento(pdf);
    const ms = Date.now() - t;
    hechos += 1;
    console.log(
      `  [${String(hechos).padStart(3)}/${aRevisar.length}] ${hash.slice(0, 12)}… ` +
        `${(pdf.byteLength / 1024).toFixed(0).padStart(5)} kB ${String(ms).padStart(5)} ms  ` +
        recortar(fila.titulo, 60),
    );
    return { fila, ok: true, hash, bytes: pdf.byteLength, ms };
  } catch (error) {
    const ms = Date.now() - t;
    hechos += 1;
    const motivo = motivoDeError(error);
    console.log(
      `  [${String(hechos).padStart(3)}/${aRevisar.length}] FALLO ${String(ms).padStart(5)} ms  ` +
        `${recortar(fila.titulo, 40)} -> ${recortar(motivo, 80)}`,
    );
    return { fila, ok: false, error: motivo, ms };
  }
}

function recortar(texto: string, largo: number): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio.length <= largo ? limpio : `${limpio.slice(0, largo - 1)}…`;
}

// ---------------------------------------------------------------------------
// 4. Escrituras agrupadas: dos consultas por tanda, ni una más
// ---------------------------------------------------------------------------

/**
 * Cuando no se ha calculado la vigencia (`--sin-vigencia`) puede tocar CREAR la
 * fila de contabilidad, y entonces hay que poner algo en las columnas NOT NULL.
 * Se pone el propio título y un motivo que dice en voz alta que la vigencia no
 * está calculada, para que nadie lea ese `vigente` como una conclusión. En el
 * camino normal esta rama no se usa: la fila ya existe y el `ON CONFLICT` solo
 * toca las dos columnas del hash.
 */
const MOTIVO_SIN_CALCULAR = 'Vigencia sin calcular: fila creada por la pasada de hashes.';

async function volcarTanda(tanda: Resultado[]): Promise<void> {
  if (tanda.length === 0) return;
  const ahora = new Date();
  const conHash = tanda.filter((r): r is ResultadoOk => r.ok);

  /**
   * UN SOLO UPDATE para todos los hashes de la tanda. `UPDATE … FROM (VALUES …)`
   * en vez de N sentencias `UPDATE … WHERE id = …`: con 239 documentos eso
   * serían 239 viajes de red solo para escribir sesenta caracteres cada vez.
   *
   * Los valores van parametrizados con `${}` (nunca concatenados), y con el
   * `::uuid` y el `::text` explícitos porque Postgres no puede deducir el tipo
   * de las columnas de un `VALUES` suelto.
   */
  if (conHash.length > 0) {
    const valores = sql.join(
      conHash.map((r) => sql`(${r.fila.id}::uuid, ${r.hash}::text)`),
      sql`, `,
    );
    await db.execute(sql`
      update "official_document" as d
      set "file_hash" = v.hash
      from (values ${valores}) as v(id, hash)
      where d."id" = v.id
    `);
    consultas += 1;
  }

  /**
   * Y UN SOLO INSERT para la contabilidad de la tanda entera, aciertos y
   * fallos. Los aciertos dejan `hash_error` a null adrede: si un documento
   * falló hace un mes y hoy se ha descargado bien, el motivo viejo tiene que
   * desaparecer, no quedarse ahí engañando.
   *
   * No hace falta quitar repetidos (que es lo que obliga a `dedupeBy` en
   * `upsert.ts`): `documento_id` es la clave primaria de `documento_vigencia`,
   * así que el LEFT JOIN devuelve como máximo una fila por documento y la
   * misma tanda no puede tocar la misma fila dos veces.
   */
  await db
    .insert(documentoVigencia)
    .values(
      tanda.map((r) => ({
        documentoId: r.fila.id,
        familia: r.fila.familia ?? r.fila.titulo,
        asunto: r.fila.asunto ?? r.fila.titulo,
        estado: r.fila.estado ?? ('vigente' as const),
        motivo: r.fila.estado === null ? MOTIVO_SIN_CALCULAR : undefined,
        hashIntentadoEn: ahora,
        hashError: r.ok ? null : r.error,
      })),
    )
    .onConflictDoUpdate({
      target: documentoVigencia.documentoId,
      set: {
        // SOLO las dos columnas del hash. Todo lo demás de esta tabla lo
        // calcula `recalcularVigencia()` y esta pasada no tiene nada que decir
        // al respecto: pisarlo aquí borraría su trabajo.
        hashIntentadoEn: sql`excluded.hash_intentado_en`,
        hashError: sql`excluded.hash_error`,
      },
    });
  consultas += 1;
}

// ---------------------------------------------------------------------------
// 5. El pool: `TANDA` obreros tirando de una cola compartida
// ---------------------------------------------------------------------------

/**
 * Un `Promise.all` sobre los 278 lanzaría 278 descargas simultáneas contra
 * esgrima.es. Eso no es aceptable ni siquiera si aguantara: es el muro de una
 * federación, no un CDN. Cuatro a la vez es cortés y sigue siendo ~4× más
 * rápido que en serie.
 *
 * El pool es un cursor compartido y N funciones asíncronas tirando de él. El
 * `indice = siguiente++` es seguro sin cerrojos porque JavaScript es de un
 * hilo y entre leer y escribir el cursor no hay ningún `await`: ningún otro
 * obrero puede colarse en medio.
 *
 * Los resultados se acumulan y se vuelcan cada `TANDA`, en vez de una sola vez
 * al final. Así una ejecución interrumpida a mitad pierde como mucho los
 * cuatro documentos de la tanda en vuelo, no las dos horas de trabajo: es lo
 * que hace que «volver a lanzarlo» sea barato de verdad.
 */
const buffer: Resultado[] = [];
const resultados: Resultado[] = [];
/** Cadena de volcados, para que no haya dos escribiendo a la vez. */
let volcados: Promise<void> = Promise.resolve();

function encolarVolcado(): Promise<void> {
  volcados = volcados.then(async () => {
    // El `splice` es síncrono al entrar, así que la tanda que se lleva este
    // volcado no la puede llevarse otro. Si otro obrero se le adelantó, aquí
    // no queda nada y `volcarTanda` sale por la puerta de al lado.
    await volcarTanda(buffer.splice(0, buffer.length));
  });
  return volcados;
}

let siguiente = 0;

async function obrero(): Promise<void> {
  while (true) {
    const indice = siguiente++;
    if (indice >= aRevisar.length) return;
    const resultado = await procesar(aRevisar[indice]);
    buffer.push(resultado);
    resultados.push(resultado);
    if (buffer.length >= TANDA) await encolarVolcado();
  }
}

if (aRevisar.length > 0) {
  console.log(
    `\n${pendientes.length} documentos sin hash (sin intento en los últimos ` +
      `${DIAS_REINTENTO} días). Se revisan ${aRevisar.length}, de ${TANDA} en ${TANDA}.\n`,
  );
  await Promise.all(
    Array.from({ length: Math.min(TANDA, aRevisar.length) }, () => obrero()),
  );
  // La última tanda, que casi nunca llega a `TANDA` elementos justos.
  await encolarVolcado();
}

// ---------------------------------------------------------------------------
// 6. Informe
// ---------------------------------------------------------------------------

const nuevos = resultados.filter((r): r is ResultadoOk => r.ok);
const fallos = resultados.filter((r): r is ResultadoFallo => !r.ok);

/**
 * Se recalcula la vigencia SOLO si han salido hashes nuevos, porque es lo
 * único que puede haber cambiado el estado `duplicada` de alguna familia.
 */
if (!SIN_VIGENCIA && nuevos.length > 0) {
  const v = await recalcularVigencia();
  consultas += v.consultas;
  console.log(
    `\nVigencia recalculada con los hashes nuevos: ${v.duplicadas} duplicadas, ` +
      `${v.vigentes} vigentes, ${v.superadas} superadas, ${v.canceladas} canceladas.`,
  );
}

/** Los duplicados exactos: la pregunta que justifica toda esta pasada. */
const [recuento] = await db
  .select({
    conHash: sql<number>`count(${officialDocument.fileHash})::int`,
    distintos: sql<number>`count(distinct ${officialDocument.fileHash})::int`,
    total: sql<number>`count(*)::int`,
  })
  .from(officialDocument);
consultas += 1;

const duracionMs = Date.now() - t0;
const msPorDocumento = resultados.length > 0 ? duracionMs / resultados.length : 0;
const msDescargaMedia =
  resultados.length > 0
    ? resultados.reduce((suma, r) => suma + r.ms, 0) / resultados.length
    : 0;

console.log('\n== Pasada de hashes de los PDF ==\n');

if (aRevisar.length === 0) {
  console.log('  Nada nuevo: no hay ningún documento pendiente de hashear.');
  console.log(
    `  (${recuento.conHash} de ${recuento.total} documentos ya tienen hash; el resto ` +
      `tiene un intento de hace menos de ${DIAS_REINTENTO} días.)`,
  );
} else {
  console.log(`  Documentos revisados .... ${resultados.length}`);
  console.log(`  Hashes nuevos ........... ${nuevos.length}`);
  console.log(`  Fallos .................. ${fallos.length}`);
}

console.log(`  Peticiones HTTP ......... ${peticionesHttp}`);
console.log(`  Consultas a la base ..... ${consultas}`);
console.log(`  Descargado .............. ${(bytesDescargados / 1024 / 1024).toFixed(1)} MB`);
console.log(`  Duración total .......... ${(duracionMs / 1000).toFixed(1)} s`);
if (resultados.length > 0) {
  console.log(`  Por documento ........... ${msPorDocumento.toFixed(0)} ms`);
  console.log(`  Descarga media .......... ${msDescargaMedia.toFixed(0)} ms`);
}

if (fallos.length > 0) {
  /**
   * Agrupados por motivo, con la URL fuera de la clave: `descargarPdf` mete la
   * URL en el mensaje, así que sin quitarla habría un grupo por documento y la
   * lista no diría nada. Con ella fuera se ve de un golpe «17 × HTTP 404».
   */
  const porMotivo = new Map<string, ResultadoFallo[]>();
  for (const f of fallos) {
    const clave = f.error.replace(/https?:\/\/\S+/g, '…').trim();
    const lista = porMotivo.get(clave) ?? [];
    lista.push(f);
    porMotivo.set(clave, lista);
  }
  console.log('\n  Por qué fallaron:');
  for (const [clave, lista] of [...porMotivo.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`    ${String(lista.length).padStart(3)} × ${clave}`);
    for (const f of lista.slice(0, 3)) {
      console.log(`          · ${recortar(f.fila.titulo, 70)}`);
      console.log(`            ${f.fila.url}`);
    }
    if (lista.length > 3) console.log(`          · … y ${lista.length - 3} más`);
  }
  console.log(
    '\n  El motivo queda apuntado en documento_vigencia.hash_error, así que no se\n' +
      `  reintentarán hasta dentro de ${DIAS_REINTENTO} días. Para forzarlo antes: --dias=1.`,
  );
}

console.log(
  `\n  Estado de la tabla: ${recuento.conHash} de ${recuento.total} documentos con hash, ` +
    `${recuento.distintos} hashes distintos.`,
);
console.log(
  `  Duplicados exactos (count(*) - count(distinct)): ${recuento.conHash - recuento.distintos}.`,
);

const quedan = pendientes.length - aRevisar.length;
if (quedan > 0) {
  console.log(
    `\n  Quedan ${quedan} por intentar en esta ventana. Vuelve a lanzarlo: no repite trabajo.`,
  );
}
