import type { EstadoEsquema } from '@/lib/sport/esquema';
import { sha256 } from '@/lib/utils';
import type { FilaAsalto, FilaResultado, ResumenEscritura } from '../fie-resultados-persist';
import type { EstadoCobertura } from '../sources/fie-resultados';
import type { AsaltoPdf, LecturaPdf, PruebaPdf, Rechazo, Region } from '../sources/rfee-pdf/tipos';

/**
 * Persistencia de la lectura de un PDF de resultados de la RFEE.
 *
 * El PDF NO se guarda (ni en Postgres): se conserva su URL, su huella SHA-256
 * y el checkpoint de lo que se leyó o quedó pendiente de revisión. Reglas:
 *
 *  - Identidad. Las referencias locales (`p0001`) sólo valen dentro de un
 *    documento y una prueba, así que se namespacean por documento y prueba.
 *    Ningún puesto ni asalto de PDF lleva `person_id`: nada se promueve a
 *    identidad confirmada por prefijo ni por nombre, y la conciliación es un
 *    paso posterior con evidencia.
 *  - Relectura. Con la misma huella el contenido es el mismo, así que no se
 *    reescribe nada (salvo `releer`); con otra huella se vuelve a escribir y
 *    se concilia: los hechos del documento que la nueva lectura ya no publica
 *    (fila movida, asalto ahora en conflicto, prueba desaparecida) se retiran,
 *    porque el modelo no tiene un estado «vigente» por hecho. Sólo se retira
 *    cuando la lectura es fiable (sin regiones rechazadas, OCR ni pruebas en
 *    revisión): si no lo es, nada cambia, el documento queda en `conflicto`
 *    con `correccion` en el checkpoint y SIN huella aceptada, de modo que la
 *    siguiente ejecución lo vuelve a intentar.
 *  - Edición. Se decide una vez por documento (nombre y rango de fechas de
 *    todas sus pruebas); la cabecera y la fecha de cada prueba se conservan en
 *    el checkpoint y en la propia prueba, no en la edición.
 *  - Un documento que no se pudo leer (error técnico, tamaño o páginas por
 *    encima del límite, host no admitido) se registra como error o pendiente
 *    reanudable con su motivo; no se descarta ni se trunca.
 *  - Una prueba con cabecera incompleta, una región rechazada o páginas sin
 *    texto dejan el documento `parcial` con página, región y motivo en el
 *    checkpoint. No se rellena ningún campo ausente. No se ejecuta OCR.
 *  - «No publicado» sólo se registra cuando la propia lectura del documento
 *    lo acredita (poules/cuadro `sin_resultados` sin regiones rechazadas de
 *    esa sección); lo desconocido o fallido queda diferido.
 */

export const FUENTE_PDF = 'rfee_pdf';

/** Cuántos motivos de revisión/rechazo caben en el checkpoint; el total real se declara aparte. */
const MAX_MOTIVOS_CHECKPOINT = 50;

export type FilaCoberturaPdf = {
  season: string;
  factKind: 'pdf' | 'results' | 'pools' | 'tableau';
  competitionKey: string;
  competitionId: string | null;
  status: EstadoCobertura;
  publishedTotal?: number | null;
  importedTotal?: number;
  sourceUrl: string | null;
  lastError: string | null;
  cursor?: string | null;
};

/** Edición del documento: la misma para todas sus pruebas. */
export type EdicionPdf = {
  nombre: string;
  inicio: string | null;
  fin: string | null;
  url: string;
};

export type PruebaPdfPersistible = {
  competitionKey: string;
  edicionKey: string;
  edicion: EdicionPdf;
  /** Título propio de la prueba (su cabecera), no el de la edición. */
  nombre: string;
  season: string;
  fecha: string | null;
  arma: NonNullable<PruebaPdf['arma']>;
  genero: NonNullable<PruebaPdf['genero']>;
  categoria: string;
  categoriaOriginal: string | null;
  formato: NonNullable<PruebaPdf['formato']>;
  url: string;
};

export type DepsPersistenciaPdf = {
  esquema: () => Promise<EstadoEsquema>;
  /** ¿Admite M10 y M12 (migración 0019)? Sin esta dependencia se supone que no. */
  categoriasHistoricas?: () => Promise<boolean>;
  /** Preserve an existing namespace only after proving its exact original URL. */
  resolverDocumento?: (season: string, sourceUrl: string, suggestedDocId: string) => Promise<string>;
  leerCheckpoint: (
    season: string,
    docKey: string,
  ) => Promise<{ status: string; cursor: string | null; lastError?: string | null } | null>;
  upsertPrueba: (p: PruebaPdfPersistible) => Promise<string>;
  upsertResultados: (competitionId: string, filas: FilaResultado[]) => Promise<ResumenEscritura>;
  upsertAsaltos: (competitionId: string, filas: FilaAsalto[]) => Promise<ResumenEscritura>;
  upsertCobertura: (fila: FilaCoberturaPdf) => Promise<void>;
  /**
   * Deja los hechos `rfee_pdf` del documento (competiciones `pdf:<docId>:*` de
   * la temporada) exactamente como `vigentes`: retira puestos y asaltos que ya
   * no están y los de las pruebas que ya no aparecen. Sólo se llama con una
   * lectura fiable, después de escribir la nueva.
   */
  reconciliar: (peticion: PeticionReconciliacion) => Promise<ResultadoReconciliacion>;
};

export type ClaveAsalto = Pick<FilaAsalto, 'phase' | 'roundKey' | 'fencerARef' | 'fencerBRef'>;

export type PruebaVigente = {
  competitionId: string;
  competitionKey: string;
  /** `sourceFactKey` de los puestos que la lectura vigente publica. */
  resultados: string[];
  asaltos: ClaveAsalto[];
};

export type PeticionReconciliacion = { season: string; docId: string; vigentes: PruebaVigente[] };

export type ResultadoReconciliacion = {
  puestosRetirados: number;
  asaltosRetirados: number;
  pruebasRetiradas: { competitionKey: string; competitionId: string }[];
};

/** Fila del inventario de la que sale la URL, para no perder la referencia original. */
export type ContextoPdf = {
  season: string;
  indice?: number | null;
  refOriginal?: string | null;
  sourceUrl?: string | null;
  /** Título de la fila: sólo sustituye a una cabecera ausente en un documento de una prueba, o nombra la edición. */
  titulo?: string | null;
};

export type RevisionPdf = {
  clave: string;
  motivo: string;
  paginas: number[];
};

type MotivoRechazo = { seccion: Rechazo['seccion']; motivo: string; region: Region | null };

export type PruebaCheckpoint = {
  clave: string;
  /** Cabecera de la prueba tal como se leyó (primeras líneas). */
  cabecera: string[];
  fecha: string | null;
  paginas: number[];
};

export type CheckpointPdf = {
  v: 1;
  /** Huella ACEPTADA; `null` mientras la corrección de un documento está en revisión. */
  sha256: string | null;
  paginas: number | null;
  ocr: { necesario: boolean; paginas: number[] };
  revision: RevisionPdf[];
  revisionTotal: number;
  rechazos: MotivoRechazo[];
  rechazosTotal: number;
  /** Marca del checkpoint sembrado por el descubrimiento: aún no hay lectura ni hechos. */
  semilla?: boolean;
  /** Fila del inventario de la que salió la URL. */
  origen?: { indice: number | null; refOriginal: string | null; sourceUrl: string | null; titulo?: string | null };
  edicion?: { nombre: string; inicio: string | null; fin: string | null };
  pruebas?: PruebaCheckpoint[];
  pruebasTotal?: number;
  correccion?: { shaPrevio: string | null; shaNuevo: string; motivos: string[] };
  retirados?: { puestos: number; asaltos: number; pruebas: number };
};

export function decodificarCheckpointPdf(texto: string | null | undefined): CheckpointPdf | null {
  if (!texto) return null;
  try {
    const c = JSON.parse(texto) as Partial<CheckpointPdf>;
    if (c.v !== 1 || !('sha256' in c)) return null;
    return c as CheckpointPdf;
  } catch {
    return null;
  }
}

export type ResumenPdf = {
  estado: 'aplicado' | 'sin_cambios' | 'documento_no_leido' | 'esquema_no_aplicado' | 'correccion_en_revision';
  motivo: 'tecnico' | 'limite' | 'host_no_admitido' | null;
  competiciones: string[];
  puestos: ResumenEscritura;
  asaltos: ResumenEscritura;
  /** Hechos retirados por la conciliación de una relectura con otra huella. */
  retirados: { puestos: number; asaltos: number; pruebas: number };
  revision: RevisionPdf[];
  /** Puestos guardados sin persona: observaciones revisables, no identidad. */
  sinIdentidad: number;
  documento: EstadoCobertura | null;
};

const SIN_ESCRITURA: ResumenEscritura = { nuevos: 0, revisados: 0, sinCambios: 0 };

export const claveDocumento = (docId: string): string => `doc:${docId}`;
const clavePrueba = (docId: string, clave: string): string => `pdf:${docId}:${clave}`;

export function motivoDeErrorPdf(error: string): 'tecnico' | 'limite' | 'host_no_admitido' {
  if (/Origen no permitido/i.test(error)) return 'host_no_admitido';
  if (/pesa \d+ bytes|declara \d+ bytes|supera el l[ií]mite|p[aá]ginas y el l[ií]mite|textos y el l[ií]mite/i.test(error)) {
    return 'limite';
  }
  return 'tecnico';
}

function recortar<T>(items: readonly T[]): T[] {
  return items.slice(0, MAX_MOTIVOS_CHECKPOINT);
}

async function hashDe(...partes: unknown[]): Promise<string> {
  return sha256(JSON.stringify(partes));
}

const urlPagina = (url: string, region: Region): string => `${url}#page=${region.pagina}`;

/** Página, franja vertical y origen del marcador del asalto: lo que hace falta para revisarlo en el PDF. */
const urlAsalto = (url: string, region: Region, marcador: AsaltoPdf['marcador']): string =>
  `${url}#page=${region.pagina}&y=${Math.round(region.yMin)}-${Math.round(region.yMax)}&marcador=${marcador}`;

const tituloDe = (p: PruebaPdf): string | null => p.cabecera.map((l) => l.trim()).find((l) => l !== '') ?? null;

/**
 * Nombre y fechas de la edición del documento, una sola vez. El rango cubre
 * todas las pruebas con fecha (también las que quedan en revisión). El nombre
 * es la cabecera común; si las cabeceras difieren manda el título de la fila
 * verificada y, sin él, la cabecera más repetida (desempate alfabético), de
 * modo que no depende del orden de las pruebas en el documento.
 */
function decidirEdicion(lectura: LecturaPdf, contexto: ContextoPdf): EdicionPdf {
  const fechas = lectura.pruebas.map((p) => p.fecha).filter((f): f is string => f !== null).sort();
  const cuentas = new Map<string, number>();
  for (const t of lectura.pruebas.map(tituloDe)) if (t) cuentas.set(t, (cuentas.get(t) ?? 0) + 1);
  const titulos = [...cuentas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const delContexto = contexto.titulo?.trim() || null;
  const nombre =
    titulos.length === 1
      ? titulos[0]
      : titulos.length > 1
        ? (delContexto ?? titulos[0])
        : (delContexto ?? `RFEE ${lectura.docId}`);
  return { nombre, inicio: fechas[0] ?? null, fin: fechas.at(-1) ?? null, url: lectura.url };
}

function cabeceraFaltante(p: PruebaPdf): string | null {
  const faltan = (
    [
      ['arma', p.arma],
      ['genero', p.genero],
      ['formato', p.formato],
      ['categoria', p.categoria],
    ] as const
  )
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  return faltan.length > 0 ? `cabecera_incompleta:${faltan.join(',')}` : null;
}

function filaDeCobertura(
  base: Pick<FilaCoberturaPdf, 'season' | 'competitionKey' | 'competitionId' | 'sourceUrl'>,
  factKind: 'results' | 'pools' | 'tableau',
  c: PruebaPdf['cobertura']['puestos'],
  rechazos: readonly Rechazo[],
): FilaCoberturaPdf {
  const seccion = factKind === 'results' ? 'puestos' : factKind === 'pools' ? 'poules' : 'cuadro';
  const rechazadaLaSeccion = rechazos.some((r) => r.seccion === seccion);
  let status = c.estado;
  let cursor: string | null = null;
  if (factKind !== 'results' && status === 'sin_resultados') {
    if (rechazadaLaSeccion) status = 'parcial';
    else cursor = 'no_publicado';
  }
  return {
    ...base,
    factKind,
    status,
    publishedTotal: c.publicado,
    importedTotal: c.importado,
    lastError: c.motivo,
    cursor,
  };
}

type PruebaAceptada = {
  p: PruebaPdf;
  arma: NonNullable<PruebaPdf['arma']>;
  genero: NonNullable<PruebaPdf['genero']>;
  formato: NonNullable<PruebaPdf['formato']>;
  categoria: string;
};

/** Cuántas líneas de la cabecera de cada prueba se guardan en el checkpoint. */
const LINEAS_CABECERA_CHECKPOINT = 4;

export async function persistirLecturaPdf(
  deps: DepsPersistenciaPdf,
  lectura: LecturaPdf,
  contextoEntrada: ContextoPdf,
  opciones: { releer?: boolean } = {},
): Promise<ResumenPdf> {
  const resumen: ResumenPdf = {
    estado: 'aplicado',
    motivo: null,
    competiciones: [],
    puestos: SIN_ESCRITURA,
    asaltos: SIN_ESCRITURA,
    retirados: { puestos: 0, asaltos: 0, pruebas: 0 },
    revision: [],
    sinIdentidad: 0,
    documento: null,
  };
  const esquema = await deps.esquema();
  if (!esquema.identidad) return { ...resumen, estado: 'esquema_no_aplicado' };

  const { season } = contextoEntrada;
  if (deps.resolverDocumento) {
    const docId = await deps.resolverDocumento(season, lectura.url, lectura.docId);
    if (docId !== lectura.docId) {
      // The positioned reader also prefixes its sporting test keys with docId.
      // Preserve those keys on a verified legacy reread, not just the outer ID.
      const prefix = `${lectura.docId}:`;
      const clave = (key: string) => key.startsWith(prefix) ? `${docId}:${key.slice(prefix.length)}` : key;
      lectura = { ...lectura, docId,
        pruebas: lectura.pruebas.map((p) => ({ ...p, clave: clave(p.clave) })),
        paginas: lectura.paginas.map((p) => ({ ...p, prueba: p.prueba === null ? null : clave(p.prueba) })),
      };
    }
  }
  const docKey = claveDocumento(lectura.docId);
  const docBase = { season, competitionKey: docKey, competitionId: null, sourceUrl: lectura.url };

  if (lectura.estado === 'error' || !lectura.sha256) {
    const error = lectura.error ?? 'El documento no se pudo leer';
    const motivo = motivoDeErrorPdf(error);
    // Un límite o un host no admitido es una decisión pendiente, no un fallo técnico.
    // Sin cursor ni cifras: la última lectura válida y sus hechos siguen siendo los vigentes.
    const status: EstadoCobertura = motivo === 'tecnico' ? 'error' : 'pendiente';
    await deps.upsertCobertura({ ...docBase, factKind: 'pdf', status, lastError: `[${motivo}] ${error}` });
    return { ...resumen, estado: 'documento_no_leido', motivo, documento: status };
  }
  const sha = lectura.sha256;

  const previo = await deps.leerCheckpoint(season, docKey);
  const previoCp = decodificarCheckpointPdf(previo?.cursor);
  // El checkpoint sembrado por el descubrimiento sólo aporta el origen: no hay hechos que corregir ni retirar.
  const previoConHechos = previoCp !== null && (previoCp.sha256 !== null || previoCp.correccion !== undefined) ? previoCp : null;
  // Una relectura (p. ej. `--releer` desde cobertura) puede llegar sin la fila del inventario: la evidencia ya
  // verificada del checkpoint no se pierde, y la edición común no cambia por faltar el contexto.
  const origenPrevio = previoCp?.origen;
  const contexto: ContextoPdf = {
    ...contextoEntrada,
    indice: contextoEntrada.indice ?? origenPrevio?.indice ?? null,
    refOriginal: contextoEntrada.refOriginal ?? origenPrevio?.refOriginal ?? null,
    sourceUrl: contextoEntrada.sourceUrl ?? origenPrevio?.sourceUrl ?? null,
    titulo: contextoEntrada.titulo ?? origenPrevio?.titulo ?? null,
  };
  if (
    !opciones.releer &&
    previo &&
    previoCp?.sha256 === sha &&
    ['completo', 'parcial', 'sin_resultados', 'conflicto'].includes(previo.status)
  ) {
    await deps.upsertCobertura({
      ...docBase,
      factKind: 'pdf',
      status: previo.status as EstadoCobertura,
      lastError: previo.lastError ?? null,
    });
    return { ...resumen, estado: 'sin_cambios', documento: previo.status as EstadoCobertura };
  }

  const revision: RevisionPdf[] = [];
  const aceptadas: PruebaAceptada[] = [];
  let pendienteCategorias = false;
  for (const p of lectura.pruebas) {
    const faltante = cabeceraFaltante(p);
    if (faltante) {
      revision.push({ clave: p.clave, motivo: faltante, paginas: p.paginas });
      continue;
    }
    const categoria = p.categoria as string;
    if (
      (categoria === 'M10' || categoria === 'M12') &&
      !(deps.categoriasHistoricas && (await deps.categoriasHistoricas()))
    ) {
      revision.push({ clave: p.clave, motivo: 'categoria_pendiente_migracion_0019', paginas: p.paginas });
      pendienteCategorias = true;
      continue;
    }
    aceptadas.push({
      p,
      arma: p.arma as NonNullable<PruebaPdf['arma']>,
      genero: p.genero as NonNullable<PruebaPdf['genero']>,
      formato: p.formato as NonNullable<PruebaPdf['formato']>,
      categoria,
    });
  }
  resumen.revision = revision;

  const rechazos: MotivoRechazo[] = [
    ...lectura.rechazos,
    ...lectura.pruebas.flatMap((p) => p.rechazos),
  ].map((r) => ({ seccion: r.seccion, motivo: r.motivo, region: r.region }));
  const pruebasNoCompletas = lectura.pruebas.some((p) => p.estado !== 'completo');

  const edicion = decidirEdicion(lectura, contexto);
  const construirCheckpoint = (extra: Partial<CheckpointPdf>): CheckpointPdf => ({
    v: 1,
    sha256: sha,
    paginas: lectura.perfil?.paginas ?? null,
    ocr: { necesario: lectura.ocr.necesario, paginas: lectura.ocr.paginas },
    revision: recortar(revision),
    revisionTotal: revision.length,
    rechazos: recortar(rechazos),
    rechazosTotal: rechazos.length,
    origen: {
      indice: contexto.indice ?? null,
      refOriginal: contexto.refOriginal ?? null,
      sourceUrl: contexto.sourceUrl ?? null,
      titulo: contexto.titulo ?? null,
    },
    edicion: { nombre: edicion.nombre, inicio: edicion.inicio, fin: edicion.fin },
    pruebas: recortar(lectura.pruebas).map((p) => ({
      clave: p.clave,
      cabecera: p.cabecera.map((l) => l.trim()).filter((l) => l !== '').slice(0, LINEAS_CABECERA_CHECKPOINT),
      fecha: p.fecha,
      paginas: p.paginas,
    })),
    pruebasTotal: lectura.pruebas.length,
    ...extra,
  });

  // Que falte un hecho en la nueva lectura sólo prueba que se corrigió si la lectura es fiable:
  // una región sin leer, un OCR pendiente o un total que no cuadra pueden ocultar filas vigentes.
  const motivosNoFiable: string[] = [];
  if (lectura.pruebas.length === 0) motivosNoFiable.push('ninguna prueba leída');
  if (rechazos.length > 0) motivosNoFiable.push(`${rechazos.length} regiones o páginas rechazadas`);
  if (lectura.ocr.necesario) motivosNoFiable.push('OCR necesario (no ejecutado)');
  if (revision.length > 0) motivosNoFiable.push(`${revision.length} pruebas en revisión`);
  if (lectura.pruebas.some((p) => p.cobertura.puestos.estado !== 'completo' && p.cobertura.puestos.estado !== 'sin_resultados')) {
    motivosNoFiable.push('clasificación incompleta o contradictoria');
  }
  if (lectura.pruebas.some((p) => [p.cobertura.poules, p.cobertura.cuadro]
    .some((c) => c.estado !== 'completo' && c.estado !== 'sin_resultados'))) {
    motivosNoFiable.push('asaltos incompletos o contradictorios');
  }
  if (lectura.estado === 'conflicto' || lectura.pruebas.some((p) =>
    p.estado === 'conflicto' || p.excluidos.conflicto > 0 || p.excluidos.incoherente > 0)) {
    motivosNoFiable.push('documento o prueba contradictorios');
  }
  const lecturaFiable = motivosNoFiable.length === 0;
  const esCorreccion = previoConHechos !== null && previoConHechos.sha256 !== sha;
  const shaPrevio = previoConHechos?.sha256 ?? previoConHechos?.correccion?.shaPrevio ?? null;

  if (esCorreccion && !lecturaFiable) {
    const correccion = { shaPrevio, shaNuevo: sha, motivos: motivosNoFiable };
    // Sin huella aceptada ni cifras: los hechos anteriores siguen y la siguiente ejecución reintenta.
    await deps.upsertCobertura({
      ...docBase,
      factKind: 'pdf',
      status: 'conflicto',
      lastError: `correccion_pendiente_revision: ${motivosNoFiable.join('; ')}`,
      cursor: JSON.stringify(construirCheckpoint({ sha256: null, correccion })),
    });
    resumen.documento = 'conflicto';
    return { ...resumen, estado: 'correccion_en_revision' };
  }

  const soloUna = lectura.pruebas.length === 1;
  const vigentes: PruebaVigente[] = [];
  let importados = 0;

  // Marcar ANTES del primer hecho, también en la importación inicial: una
  // interrupción no puede dejar hechos sin evidencia para una corrección.
  const registrarCorreccion = (status: EstadoCobertura, lastError: string, motivos: string[]) =>
    deps.upsertCobertura({
      ...docBase,
      factKind: 'pdf',
      status,
      lastError,
      cursor: JSON.stringify(construirCheckpoint({ sha256: null, correccion: { shaPrevio, shaNuevo: sha, motivos } })),
    });
  const enCurso = esCorreccion ? 'correccion_en_curso' : 'importacion_en_curso';
  await registrarCorreccion('pendiente', enCurso, [enCurso]);
  try {
    for (const { p, arma, genero, formato, categoria } of aceptadas) {
      const key = clavePrueba(lectura.docId, p.clave);
      const primeraPagina = p.paginas.length > 0 ? Math.min(...p.paginas) : null;
      const competitionId = await deps.upsertPrueba({
        competitionKey: key,
        edicionKey: `pdf:${lectura.docId}`,
        edicion,
        nombre: tituloDe(p) ?? (soloUna ? contexto.titulo?.trim() || null : null) ?? `RFEE ${lectura.docId}`,
        season,
        fecha: p.fecha,
        arma,
        genero,
        categoria,
        categoriaOriginal: p.categoriaOriginal,
        formato,
        url: primeraPagina === null ? lectura.url : `${lectura.url}#page=${primeraPagina}`,
      });
      resumen.competiciones.push(key);

      const prefijo = `${lectura.docId}:${p.clave}:`;
      const filas: FilaResultado[] = await Promise.all(
        p.puestos.map(async (x) => ({
          sourceFactKey: `${prefijo}${x.sourceFactKey}`,
          personId: null,
          sourceName: x.nombre,
          sourceCountryCode: null,
          sourceClub: x.club,
          position: x.posicion,
          positionRaw: x.posicionRaw,
          officialPoints: null,
          occurredOn: p.fecha,
          sourceUrl: urlPagina(lectura.url, x.region),
          contentHash: await hashDe(x.posicion, x.posicionRaw, x.nombre, x.club, p.fecha, x.region),
        })),
      );
      if (filas.length > 0) {
        const r = await deps.upsertResultados(competitionId, filas);
        resumen.puestos = sumar(resumen.puestos, r);
        resumen.sinIdentidad += filas.length;
        importados += filas.length;
      }

      const asaltos: FilaAsalto[] =
        p.asaltos.length > 0 && formato === 'INDIVIDUAL'
          ? await Promise.all(
              p.asaltos.map(async (a) => ({
                phase: a.fase,
                roundKey: a.ronda,
                fencerARef: `${prefijo}${a.refA}`,
                fencerBRef: `${prefijo}${a.refB}`,
                fencerAPersonId: null,
                fencerBPersonId: null,
                fencerAName: a.nombreA,
                fencerBName: a.nombreB,
                scoreA: a.puntosA,
                scoreB: a.puntosB,
                occurredOn: p.fecha,
                sourceUrl: urlAsalto(lectura.url, a.region, a.marcador),
                // La fecha publicada y el origen del marcador son parte del hecho: una corrección que sólo
                // cambie uno de ellos tiene que revisar la fila, no quedar como idéntica.
                contentHash: await hashDe(a.fase, a.ronda, a.puntosA, a.puntosB, a.nombreA, a.nombreB, p.fecha, a.marcador, a.region),
              })),
            )
          : [];
      if (asaltos.length > 0) {
        resumen.asaltos = sumar(resumen.asaltos, await deps.upsertAsaltos(competitionId, asaltos));
      }
      vigentes.push({
        competitionId,
        competitionKey: key,
        resultados: filas.map((f) => f.sourceFactKey),
        asaltos: asaltos.map(({ phase, roundKey, fencerARef, fencerBRef }) => ({ phase, roundKey, fencerARef, fencerBRef })),
      });

      const base = { season, competitionKey: key, competitionId, sourceUrl: lectura.url };
      await deps.upsertCobertura(filaDeCobertura(base, 'results', p.cobertura.puestos, p.rechazos));
      await deps.upsertCobertura(filaDeCobertura(base, 'pools', p.cobertura.poules, p.rechazos));
      await deps.upsertCobertura(filaDeCobertura(base, 'tableau', p.cobertura.cuadro, p.rechazos));
    }

    if (lecturaFiable) {
      const r = await deps.reconciliar({ season, docId: lectura.docId, vigentes });
      resumen.retirados = { puestos: r.puestosRetirados, asaltos: r.asaltosRetirados, pruebas: r.pruebasRetiradas.length };
      for (const t of r.pruebasRetiradas) {
        const base = { season, competitionKey: t.competitionKey, competitionId: t.competitionId, sourceUrl: lectura.url };
        for (const factKind of ['results', 'pools', 'tableau'] as const) {
          await deps.upsertCobertura({
            ...base,
            factKind,
            status: 'sin_resultados',
            publishedTotal: null,
            importedTotal: 0,
            lastError: 'La prueba ya no aparece en la lectura vigente del documento',
            cursor: 'retirada_por_correccion',
          });
        }
      }
    }

    const hayConflicto = lectura.pruebas.some((p) => p.estado === 'conflicto') || lectura.estado === 'conflicto';

    let status: EstadoCobertura = lectura.estado;
    if (pendienteCategorias) status = 'pendiente';
    else if (hayConflicto) status = 'conflicto';
    else if (status === 'completo' && (revision.length > 0 || rechazos.length > 0 || lectura.ocr.necesario || pruebasNoCompletas)) {
      status = 'parcial';
    }

    const motivos: string[] = [];
    if (revision.length > 0) motivos.push(`${revision.length} pruebas en revisión (${[...new Set(revision.map((r) => r.motivo))].join(', ')})`);
    if (rechazos.length > 0) motivos.push(`${rechazos.length} regiones o páginas rechazadas`);
    if (lectura.ocr.necesario) motivos.push(`OCR necesario en páginas ${lectura.ocr.paginas.join(',')} (no ejecutado)`);
    if (pruebasNoCompletas && motivos.length === 0) motivos.push('Alguna prueba quedó incompleta');

    await deps.upsertCobertura({
      ...docBase,
      factKind: 'pdf',
      status,
      publishedTotal: null,
      importedTotal: importados,
      lastError: motivos.length > 0 ? motivos.join('; ') : null,
      cursor: JSON.stringify(construirCheckpoint({ retirados: resumen.retirados })),
    });
    resumen.documento = status;
  } catch (e) {
    const motivo = esCorreccion ? 'correccion_fallida' : 'importacion_fallida';
    // Si esta escritura también falla queda el marcador incompleto previo.
    // No almacenar mensajes del transporte que podrían incluir SQL privado.
    await registrarCorreccion('error', motivo, [motivo]).catch(() => undefined);
    throw e;
  }
  return resumen;
}

function sumar(a: ResumenEscritura, b: ResumenEscritura): ResumenEscritura {
  return { nuevos: a.nuevos + b.nuevos, revisados: a.revisados + b.revisados, sinCambios: a.sinCambios + b.sinCambios };
}
