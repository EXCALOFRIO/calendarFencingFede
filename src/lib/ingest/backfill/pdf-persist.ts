import type { EstadoEsquema } from '@/lib/sport/esquema';
import { sha256 } from '@/lib/utils';
import type { FilaAsalto, FilaResultado, ResumenEscritura } from '../fie-resultados-persist';
import type { EstadoCobertura } from '../sources/fie-resultados';
import type { LecturaPdf, PruebaPdf, Rechazo, Region } from '../sources/rfee-pdf/tipos';

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
 *    las claves naturales evitan duplicados.
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

export type PruebaPdfPersistible = {
  competitionKey: string;
  edicionKey: string;
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
  leerCheckpoint: (
    season: string,
    docKey: string,
  ) => Promise<{ status: string; cursor: string | null; lastError?: string | null } | null>;
  upsertPrueba: (p: PruebaPdfPersistible) => Promise<string>;
  upsertResultados: (competitionId: string, filas: FilaResultado[]) => Promise<ResumenEscritura>;
  upsertAsaltos: (competitionId: string, filas: FilaAsalto[]) => Promise<ResumenEscritura>;
  upsertCobertura: (fila: FilaCoberturaPdf) => Promise<void>;
};

export type RevisionPdf = {
  clave: string;
  motivo: string;
  paginas: number[];
};

type MotivoRechazo = { seccion: Rechazo['seccion']; motivo: string; region: Region | null };

export type CheckpointPdf = {
  v: 1;
  sha256: string | null;
  paginas: number | null;
  ocr: { necesario: boolean; paginas: number[] };
  revision: RevisionPdf[];
  revisionTotal: number;
  rechazos: MotivoRechazo[];
  rechazosTotal: number;
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
  estado: 'aplicado' | 'sin_cambios' | 'documento_no_leido' | 'esquema_no_aplicado';
  motivo: 'tecnico' | 'limite' | 'host_no_admitido' | null;
  competiciones: string[];
  puestos: ResumenEscritura;
  asaltos: ResumenEscritura;
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

export async function persistirLecturaPdf(
  deps: DepsPersistenciaPdf,
  lectura: LecturaPdf,
  contexto: { season: string },
  opciones: { releer?: boolean } = {},
): Promise<ResumenPdf> {
  const resumen: ResumenPdf = {
    estado: 'aplicado',
    motivo: null,
    competiciones: [],
    puestos: SIN_ESCRITURA,
    asaltos: SIN_ESCRITURA,
    revision: [],
    sinIdentidad: 0,
    documento: null,
  };
  const esquema = await deps.esquema();
  if (!esquema.identidad) return { ...resumen, estado: 'esquema_no_aplicado' };

  const { season } = contexto;
  const docKey = claveDocumento(lectura.docId);
  const docBase = { season, competitionKey: docKey, competitionId: null, sourceUrl: lectura.url };

  if (lectura.estado === 'error' || !lectura.sha256) {
    const error = lectura.error ?? 'El documento no se pudo leer';
    const motivo = motivoDeErrorPdf(error);
    // Un límite o un host no admitido es una decisión pendiente, no un fallo técnico.
    const status: EstadoCobertura = motivo === 'tecnico' ? 'error' : 'pendiente';
    await deps.upsertCobertura({ ...docBase, factKind: 'pdf', status, lastError: `[${motivo}] ${error}` });
    return { ...resumen, estado: 'documento_no_leido', motivo, documento: status };
  }

  const previo = await deps.leerCheckpoint(season, docKey);
  const previoCp = decodificarCheckpointPdf(previo?.cursor);
  if (
    !opciones.releer &&
    previo &&
    previoCp?.sha256 === lectura.sha256 &&
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
  let importados = 0;
  let pendienteCategorias = false;

  for (const p of lectura.pruebas) {
    const faltante = cabeceraFaltante(p);
    if (faltante) {
      revision.push({ clave: p.clave, motivo: faltante, paginas: p.paginas });
      continue;
    }
    const arma = p.arma as NonNullable<PruebaPdf['arma']>;
    const genero = p.genero as NonNullable<PruebaPdf['genero']>;
    const formato = p.formato as NonNullable<PruebaPdf['formato']>;
    const categoria = p.categoria as string;
    if (
      (categoria === 'M10' || categoria === 'M12') &&
      !(deps.categoriasHistoricas && (await deps.categoriasHistoricas()))
    ) {
      revision.push({ clave: p.clave, motivo: 'categoria_pendiente_migracion_0019', paginas: p.paginas });
      pendienteCategorias = true;
      continue;
    }

    const key = clavePrueba(lectura.docId, p.clave);
    const competitionId = await deps.upsertPrueba({
      competitionKey: key,
      edicionKey: `pdf:${lectura.docId}`,
      nombre: p.cabecera[0] ?? `RFEE ${lectura.docId}`,
      season,
      fecha: p.fecha,
      arma,
      genero,
      categoria,
      categoriaOriginal: p.categoriaOriginal,
      formato,
      url: lectura.url,
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

    if (p.asaltos.length > 0 && formato === 'INDIVIDUAL') {
      const asaltos: FilaAsalto[] = await Promise.all(
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
          sourceUrl: urlPagina(lectura.url, a.region),
          contentHash: await hashDe(a.fase, a.ronda, a.puntosA, a.puntosB, a.nombreA, a.nombreB, a.region),
        })),
      );
      resumen.asaltos = sumar(resumen.asaltos, await deps.upsertAsaltos(competitionId, asaltos));
    }

    const base = { season, competitionKey: key, competitionId, sourceUrl: lectura.url };
    await deps.upsertCobertura(filaDeCobertura(base, 'results', p.cobertura.puestos, p.rechazos));
    await deps.upsertCobertura(filaDeCobertura(base, 'pools', p.cobertura.poules, p.rechazos));
    await deps.upsertCobertura(filaDeCobertura(base, 'tableau', p.cobertura.cuadro, p.rechazos));
  }
  resumen.revision = revision;

  const rechazos: MotivoRechazo[] = [
    ...lectura.rechazos,
    ...lectura.pruebas.flatMap((p) => p.rechazos),
  ].map((r) => ({ seccion: r.seccion, motivo: r.motivo, region: r.region }));
  const pruebasNoCompletas = lectura.pruebas.some((p) => p.estado !== 'completo');
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

  const checkpoint: CheckpointPdf = {
    v: 1,
    sha256: lectura.sha256,
    paginas: lectura.perfil?.paginas ?? null,
    ocr: { necesario: lectura.ocr.necesario, paginas: lectura.ocr.paginas },
    revision: recortar(revision),
    revisionTotal: revision.length,
    rechazos: recortar(rechazos),
    rechazosTotal: rechazos.length,
  };
  await deps.upsertCobertura({
    ...docBase,
    factKind: 'pdf',
    status,
    publishedTotal: null,
    importedTotal: importados,
    lastError: motivos.length > 0 ? motivos.join('; ') : null,
    cursor: JSON.stringify(checkpoint),
  });
  resumen.documento = status;
  return resumen;
}

function sumar(a: ResumenEscritura, b: ResumenEscritura): ResumenEscritura {
  return { nuevos: a.nuevos + b.nuevos, revisados: a.revisados + b.revisados, sinCambios: a.sinCambios + b.sinCambios };
}
