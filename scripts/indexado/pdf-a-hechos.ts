/**
 * Lector local de PDFs RFEE -> ficheros de hechos (`src/lib/ingest/hechos/formato.ts`).
 *
 * Sólo lectura: caché nacional en disco y, opcionalmente, una copia SQLite de
 * producción para resolver el namespace del documento igual que
 * `pdf-db.ts#resolverDocumento` (las filas de producción usan el docId
 * legado, el nombre del fichero). Sin red, sin escritura en ninguna base.
 *
 * Uso:
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/pdf-a-hechos.ts \
 *     --cache <dir caché nacional> --salida <dir hechos> [--base <base.sqlite>] [--limite N] [--solo <pdf-id>] \
 *     [--inventario <national-inventory.json>]  (por defecto <cache>/../history-national/national-inventory.json)
 *
 * Escribe `<salida>/pdf-lector/*.json`, `<salida>/pdf-lector/_informe.json` y
 * `<salida>/pdf-calidad.json` (reescrito de forma atómica cada lote).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ficheroHechos,
  hechosPrueba,
  type AsaltoHecho,
  type HechosPrueba,
  type ResultadoHecho,
} from '../../src/lib/ingest/hechos/formato';
import { docIdDeUrl, docIdLegadoDeUrl, extraerPaginas, sha256Hex } from '../../src/lib/ingest/sources/rfee-pdf/lectura';
import { leerResultadosPdf } from '../../src/lib/ingest/sources/rfee-pdf/resultados';
import type { CoberturaPdf, LecturaPdf, PaginaTexto, PruebaPdf, Rechazo } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { cargarIndiceFechas, fechasCatalogo, type IndiceFechas } from './fechas-catalogo';

export type EstadoHecho = HechosPrueba['status']['results'];
export type EstadosPdf = { results: EstadoHecho; pools: EstadoHecho; tableau: EstadoHecho };

export type PruebaDescartada = { clave: string; motivo: string; paginas: number[] };

export type ConversionPdf = {
  hechos: HechosPrueba[];
  descartadas: PruebaDescartada[];
  /** Refs locales de producción (`<docId>:<clave>:p0001`) por asalto, para comparar con la base. */
  refsLocales: Map<HechosPrueba, { phase: string; roundKey: string; aRef: string; bRef: string }[]>;
  avisos: string[];
};

const SECCION = { results: 'puestos', pools: 'poules', tableau: 'cuadro' } as const;

/**
 * Estado honesto de una sección. `sin_resultados` sólo cuando el documento no
 * publica la sección y ninguna región de esa sección quedó rechazada (misma
 * regla que `pdf-persist.ts#filaDeCobertura`).
 */
export function estadoSeccion(kind: keyof typeof SECCION, c: CoberturaPdf, rechazos: readonly Rechazo[]): EstadoHecho {
  const rechazada = rechazos.some((r) => r.seccion === SECCION[kind]);
  switch (c.estado) {
    case 'completo':
      return 'completo';
    case 'sin_resultados':
      return kind !== 'results' && rechazada ? 'parcial' : 'sin_resultados';
    case 'error':
      return 'ilegible';
    default:
      // parcial, conflicto y pendiente: hay algo publicado que no se leyó con seguridad.
      return 'parcial';
  }
}

const tituloDe = (p: PruebaPdf): string | null => p.cabecera.map((l) => l.trim()).find((l) => l !== '') ?? null;

/** Igual que `pdf-persist.ts#decidirEdicion` sin título de contexto (el replay local no lo pasa). */
function edicionDe(lectura: LecturaPdf): { nombre: string; inicio: string | null; fin: string | null } {
  const fechas = lectura.pruebas.map((p) => p.fecha).filter((f): f is string => f !== null).sort();
  const cuentas = new Map<string, number>();
  for (const t of lectura.pruebas.map(tituloDe)) if (t) cuentas.set(t, (cuentas.get(t) ?? 0) + 1);
  const titulos = [...cuentas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  return { nombre: titulos[0] ?? `RFEE ${lectura.docId}`, inicio: fechas[0] ?? null, fin: fechas.at(-1) ?? null };
}

function faltantes(p: PruebaPdf): string[] {
  return (
    [
      ['arma', p.arma],
      ['genero', p.genero],
      ['formato', p.formato],
      ['categoria', p.categoria],
    ] as const
  )
    .filter(([, v]) => v === null)
    .map(([k]) => k);
}

/**
 * Convierte una lectura (ya con `docId` resuelto y `sha256`) en hechos por prueba.
 * Sin fecha en la cabecera del PDF, la edición y la prueba toman la del catálogo nacional.
 */
export function lecturaAHechos(lectura: LecturaPdf, season: string, fechas: IndiceFechas | null = null): ConversionPdf {
  if (!lectura.sha256) throw new Error('lectura_sin_sha256');
  const edicion = edicionDe(lectura);
  if (edicion.inicio === null) {
    const f = fechasCatalogo(fechas, season, lectura.url);
    edicion.inicio = f.inicio;
    edicion.fin = f.fin;
  }
  const hechos: HechosPrueba[] = [];
  const descartadas: PruebaDescartada[] = [];
  const refsLocales: ConversionPdf['refsLocales'] = new Map();
  const avisos: string[] = [];

  for (const p of lectura.pruebas) {
    const faltan = faltantes(p);
    if (faltan.length > 0) {
      descartadas.push({ clave: p.clave, motivo: `cabecera_incompleta:${faltan.join(',')}`, paginas: p.paginas });
      continue;
    }
    // Header and classification disagree on the format: the reader drops every row, so an
    // empty fact file would look like a retraction of the facts already published.
    if (p.cobertura.puestos.estado === 'pendiente') {
      const motivo = p.rechazos.find((r) => r.seccion === 'prueba')?.motivo ?? p.cobertura.puestos.motivo ?? 'sin motivo';
      descartadas.push({ clave: p.clave, motivo: `prueba_no_atribuible:${motivo}`, paginas: p.paginas });
      continue;
    }
    const prefijo = `${lectura.docId}:${p.clave}:`;
    const notas: string[] = [];

    const porRef = new Map<string, string>();
    const nombrePorRef = new Map<string, string>();
    const results: ResultadoHecho[] = [];
    for (const x of p.puestos) {
      const nombre = x.nombre.trim();
      if (nombre === '') {
        notas.push(`Fila sin nombre omitida (${x.sourceFactKey})`);
        continue;
      }
      const factKey = `${prefijo}${x.sourceFactKey}`;
      porRef.set(x.ref, factKey);
      nombrePorRef.set(x.ref, nombre);
      const posicion = x.posicion !== null && Number.isInteger(x.posicion) && x.posicion > 0 ? x.posicion : null;
      results.push({
        factKey,
        name: nombre,
        countryCode: x.pais && /^[A-Z]{3}$/.test(x.pais) ? x.pais : null,
        club: x.club?.trim() || null,
        position: posicion,
        positionRaw: x.posicionRaw ?? (posicion === null && x.posicion !== null ? String(x.posicion) : null),
        points: null,
        fieId: null,
        license: null,
        birthYear: null,
      });
    }

    const bouts: AsaltoHecho[] = [];
    const locales: { phase: string; roundKey: string; aRef: string; bRef: string }[] = [];
    let sinEmparejar = 0;
    if (p.formato === 'INDIVIDUAL') {
      for (const a of p.asaltos) {
        if (![a.puntosA, a.puntosB].every((n) => Number.isInteger(n) && n >= 0 && n <= 45)) {
          notas.push(`Asalto ${a.ronda} con marcador fuera de rango omitido (${a.puntosA}-${a.puntosB})`);
          continue;
        }
        const aRef = porRef.get(a.refA);
        const bRef = porRef.get(a.refB);
        if (!aRef || !bRef) sinEmparejar += 1;
        bouts.push({
          phase: a.fase,
          roundKey: a.ronda,
          aRef: aRef ?? `${prefijo}${a.refA}`,
          bRef: bRef ?? `${prefijo}${a.refB}`,
          // El cuadro trunca los nombres a su columna («COMPAGNONI BL»); el puesto atribuido trae el completo.
          aName: nombrePorRef.get(a.refA) ?? a.nombreA,
          bName: nombrePorRef.get(a.refB) ?? a.nombreB,
          scoreA: a.puntosA,
          scoreB: a.puntosB,
          winner: null,
        });
        locales.push({ phase: a.fase, roundKey: a.ronda, aRef: `${prefijo}${a.refA}`, bRef: `${prefijo}${a.refB}` });
      }
    }
    if (sinEmparejar > 0) notas.push(`${sinEmparejar} asaltos con referencia local: tirador no emparejado con la clasificación`);

    for (const [k, c] of Object.entries(p.cobertura)) if (c.motivo) notas.push(`${k}: ${c.motivo}`);
    if (p.estado === 'conflicto') notas.push('Prueba en conflicto según el lector');
    if (p.categoriaPublicada && p.categoriaPublicada !== p.categoriaOriginal) notas.push(`Categoría publicada: ${p.categoriaPublicada}`);
    if (p.cohorte) notas.push(`Cohorte: ${p.cohorte}`);
    notas.push(`Páginas: ${p.paginas.join(',')}`);
    const titulo = tituloDe(p);
    if (titulo && titulo !== edicion.nombre) notas.push(`Título de la prueba: ${titulo}`);

    const candidato = {
      version: 1 as const,
      source: 'rfee_pdf' as const,
      extractor: 'lector_pdf',
      sourceUrl: lectura.url,
      sourceSha256: lectura.sha256,
      edition: {
        season,
        tournamentKey: `pdf:${lectura.docId}`,
        name: edicion.nombre,
        startDate: edicion.inicio,
        endDate: edicion.fin,
        city: null,
        countryCode: null,
      },
      competition: {
        competitionKey: `pdf:${lectura.docId}:${p.clave}`,
        weapon: p.arma!,
        gender: p.genero!,
        category: p.categoria as HechosPrueba['competition']['category'],
        categoryRaw: p.categoriaOriginal,
        format: p.formato!,
        date: p.fecha ?? fechasCatalogo(fechas, season, lectura.url, {
          weapon: p.arma!, gender: p.genero!, category: p.categoria!, format: p.formato!,
        }).prueba,
      },
      status: {
        results: estadoSeccion('results', p.cobertura.puestos, p.rechazos),
        pools: estadoSeccion('pools', p.cobertura.poules, p.rechazos),
        tableau: estadoSeccion('tableau', p.cobertura.cuadro, p.rechazos),
        publishedParticipants: p.cobertura.puestos.publicado,
        notes: notas,
      },
      results,
      bouts,
    };
    const r = hechosPrueba.safeParse(candidato);
    if (!r.success) {
      descartadas.push({ clave: p.clave, motivo: `formato_invalido:${r.error.issues[0]?.path.join('.')}:${r.error.issues[0]?.message}`, paginas: p.paginas });
      continue;
    }
    hechos.push(r.data);
    refsLocales.set(r.data, locales);
  }
  if (lectura.ocr.necesario) avisos.push(`OCR necesario en páginas ${lectura.ocr.paginas.join(',')}`);
  return { hechos, descartadas, refsLocales, avisos };
}

const ORDEN: EstadoHecho[] = ['ilegible', 'parcial', 'completo', 'sin_resultados'];
export function peorEstado(estados: EstadoHecho[]): EstadoHecho {
  for (const e of ORDEN) if (estados.includes(e)) return e;
  return 'sin_resultados';
}

export type CalidadPdf = {
  pdfId: string;
  url: string;
  sha256: string | null;
  blobPath: string | null;
  pages: number | null;
  season: string | null;
  docId: string | null;
  competitions: number;
  results: number;
  bouts: number;
  status: EstadosPdf;
  needsDroid: boolean;
  reason: string;
  /** Páginas que no se atribuyen a ninguna prueba (portadas, listados, sin cabecera...). */
  unattributedPages: number[];
  ocrPages: number[];
  discarded: PruebaDescartada[];
};

export function calidadDe(
  base: Pick<CalidadPdf, 'pdfId' | 'url' | 'sha256' | 'blobPath' | 'season' | 'docId'>,
  lectura: LecturaPdf,
  conv: ConversionPdf,
): CalidadPdf {
  const h = conv.hechos;
  const status: EstadosPdf = h.length
    ? {
        results: peorEstado(h.map((x) => x.status.results)),
        pools: peorEstado(h.map((x) => x.status.pools)),
        tableau: peorEstado(h.map((x) => x.status.tableau)),
      }
    : lectura.ocr.necesario && lectura.pruebas.length === 0
      ? { results: 'ilegible', pools: 'ilegible', tableau: 'ilegible' }
      : { results: 'sin_resultados', pools: 'sin_resultados', tableau: 'sin_resultados' };
  const results = h.reduce((n, x) => n + x.results.length, 0);
  const bouts = h.reduce((n, x) => n + x.bouts.length, 0);
  const motivos: string[] = [];
  if (lectura.pruebas.length === 0) motivos.push('sin cabecera de prueba reconocible');
  if (conv.descartadas.length > 0) motivos.push(`${conv.descartadas.length} pruebas descartadas (${[...new Set(conv.descartadas.map((d) => d.motivo))].join('; ')})`);
  if (results === 0) motivos.push('0 resultados leídos');
  for (const k of ['results', 'pools', 'tableau'] as const) {
    const malas = h.filter((x) => x.status[k] === 'parcial' || x.status[k] === 'ilegible').length;
    if (malas > 0) motivos.push(`${k} no completo en ${malas}/${h.length} pruebas`);
  }
  if (lectura.ocr.necesario) motivos.push(`OCR necesario en páginas ${lectura.ocr.paginas.join(',')}`);
  const needsDroid = motivos.length > 0;
  const sinAtribuir = lectura.paginas.filter((p) => p.prueba === null).map((p) => p.pagina);
  if (!needsDroid && sinAtribuir.length > 0) motivos.push(`páginas sin atribuir ${sinAtribuir.join(',')} (informativo)`);
  return {
    ...base,
    pages: lectura.perfil?.paginas ?? null,
    competitions: h.length,
    results,
    bouts,
    status,
    needsDroid,
    reason: motivos.join('; ') || 'completo',
    unattributedPages: sinAtribuir,
    ocrPages: lectura.ocr.paginas,
    discarded: conv.descartadas,
  };
}

/** Nombre de fichero sin colisiones: `ficheroHechos` recorta a 150 caracteres. */
export function nombreUnico(h: HechosPrueba, usados: Set<string>): string {
  let nombre = ficheroHechos(h);
  if (usados.has(nombre)) {
    const sufijo = createHash('sha256').update(`${h.edition.season}|${h.competition.competitionKey}`).digest('hex').slice(0, 10);
    nombre = nombre.replace(/\.json$/, `__${sufijo}.json`);
  }
  usados.add(nombre);
  return nombre;
}

// ---------------------------------------------------------------------------
// Producción (sólo lectura) para resolver el namespace y comparar.

type FilaNamespace = { season: string; docId: string; url: string | null };
export type IndiceBase = {
  namespaces: Map<string, (string | null)[]>;
  competiciones: Map<string, { results: Set<string>; bouts: Set<string> }>;
  docsPorSeason: Map<string, Set<string>>;
};

const claveNs = (season: string, docId: string) => `${season}|${docId}`;
export const claveAsalto = (b: { phase: string; roundKey: string; aRef: string; bRef: string }) =>
  JSON.stringify([b.phase, b.roundKey, b.aRef, b.bRef]);

async function cargarBase(ruta: string): Promise<IndiceBase> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(ruta, { readOnly: true });
  try {
    const filas: FilaNamespace[] = [];
    for (const r of db.prepare(`select season, competition_key k, source_url u from sport_import_coverage where source='rfee_pdf' and fact_kind='pdf'`).all() as { season: string; k: string; u: string | null }[]) {
      if (r.k.startsWith('doc:')) filas.push({ season: r.season, docId: r.k.slice(4), url: r.u });
    }
    for (const r of db.prepare(`select season, competition_key k, source_url u from sport_competition where source='rfee_pdf'`).all() as { season: string; k: string; u: string | null }[]) {
      const m = /^pdf:([^:]+):/.exec(r.k);
      if (m) filas.push({ season: r.season, docId: m[1], url: r.u });
    }
    for (const r of db.prepare(`select season, tournament_key k, source_url u from sport_edition where source='rfee_pdf'`).all() as { season: string; k: string; u: string | null }[]) {
      if (r.k.startsWith('pdf:')) filas.push({ season: r.season, docId: r.k.slice(4), url: r.u });
    }
    const namespaces = new Map<string, (string | null)[]>();
    const docsPorSeason = new Map<string, Set<string>>();
    for (const f of filas) {
      const k = claveNs(f.season, f.docId);
      namespaces.set(k, [...(namespaces.get(k) ?? []), f.url]);
      docsPorSeason.set(f.season, (docsPorSeason.get(f.season) ?? new Set()).add(f.docId));
    }
    const competiciones = new Map<string, { results: Set<string>; bouts: Set<string> }>();
    const ids = new Map<string, string>();
    for (const r of db.prepare(`select id, season, competition_key k from sport_competition where source='rfee_pdf'`).all() as { id: string; season: string; k: string }[]) {
      const k = `${r.season}|${r.k}`;
      ids.set(String(r.id), k);
      competiciones.set(k, { results: new Set(), bouts: new Set() });
    }
    for (const r of db.prepare(`select competition_id c, source_fact_key f from sport_result where source='rfee_pdf'`).all() as { c: string; f: string }[]) {
      const k = ids.get(String(r.c));
      if (k) competiciones.get(k)!.results.add(r.f);
    }
    for (const r of db.prepare(`select competition_id c, phase, round_key, fencer_a_ref a, fencer_b_ref b from sport_bout where source='rfee_pdf'`).all() as { c: string; phase: string; round_key: string; a: string; b: string }[]) {
      const k = ids.get(String(r.c));
      if (k) competiciones.get(k)!.bouts.add(claveAsalto({ phase: r.phase, roundKey: r.round_key, aRef: r.a, bRef: r.b }));
    }
    return { namespaces, competiciones, docsPorSeason };
  } finally {
    db.close();
  }
}

/** Misma decisión que `pdf-db.ts#resolverDocumento`, contra la copia de producción. */
export function resolverDocId(indice: IndiceBase | null, season: string, url: string): { docId: string; motivo: string } {
  const sugerido = docIdDeUrl(url);
  if (!indice) return { docId: sugerido, motivo: 'sin_base' };
  const conflictos = (urls: (string | null)[]) => urls.filter((u) => !(u === url || (u !== null && u.startsWith(`${url}#`)))).length;
  const actual = indice.namespaces.get(claveNs(season, sugerido)) ?? [];
  if (conflictos(actual) > 0) throw new Error('pdf_document_namespace_conflict');
  if (actual.length > 0) return { docId: sugerido, motivo: 'url' };
  const legado = docIdLegadoDeUrl(url);
  if (legado !== sugerido) {
    const filas = indice.namespaces.get(claveNs(season, legado)) ?? [];
    if (filas.length > 0 && conflictos(filas) === 0) return { docId: legado, motivo: 'legado' };
    if (filas.length > 0) return { docId: sugerido, motivo: 'legado_en_conflicto' };
  }
  return { docId: sugerido, motivo: 'nuevo' };
}

// ---------------------------------------------------------------------------

type UnidadManifiesto = {
  id: string;
  tipo: string;
  url: string;
  asociaciones: { temporada: string }[];
  estado: string;
  sha256: string | null;
  bytes: number | null;
  httpStatus: number | null;
  motivo: string | null;
};

function escribirAtomico(ruta: string, contenido: string) {
  const tmp = `${ruta}.${process.pid}.tmp`;
  writeFileSync(tmp, contenido, 'utf8');
  renameSync(tmp, ruta);
}

function args(argv: string[]) {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`Argumento inválido: ${argv[i]}`);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}

async function main() {
  const a = args(process.argv.slice(2));
  const cache = resolve(a.cache ?? '');
  const salida = resolve(a.salida ?? '');
  if (!a.cache || !a.salida) throw new Error('Uso: --cache <dir> --salida <dir> [--base <sqlite>] [--limite N] [--solo <pdf-id>]');
  const dirHechos = join(salida, 'pdf-lector');
  mkdirSync(dirHechos, { recursive: true });
  const indice = a.base ? await cargarBase(resolve(a.base)) : null;
  const rutaInventario = a.inventario ?? join(resolve(cache, '..'), 'history-national', 'national-inventory.json');
  const fechas = cargarIndiceFechas(rutaInventario);
  if (!fechas) console.warn(`Sin inventario nacional en ${rutaInventario}: las pruebas sin fecha en el PDF quedan sin fecha`);

  const manifiesto = JSON.parse(readFileSync(join(cache, 'manifest.json'), 'utf8')) as { unidades: UnidadManifiesto[] };
  let unidades = manifiesto.unidades.filter((u) => u.tipo === 'pdf').sort((x, y) => (x.sha256 ?? '').localeCompare(y.sha256 ?? '') || x.id.localeCompare(y.id));
  if (a.solo) unidades = unidades.filter((u) => u.id === a.solo);
  if (a.limite) unidades = unidades.slice(0, Number(a.limite));

  const calidad: CalidadPdf[] = [];
  const usados = new Set<string>();
  const escritos = new Set<string>();
  const errores: { pdfId: string; error: string }[] = [];
  const resolucion: Record<string, number> = {};
  const comparacion = {
    competicionesProduccionEnDocsLeidos: 0,
    competicionesCoinciden: 0,
    competicionesNuevas: 0,
    competicionesProduccionNoEmitidas: [] as string[],
    resultados: { emitidos: 0, coinciden: 0, nuevos: 0, produccionNoEmitidos: 0, produccionTotalEnDocsLeidos: 0 },
    asaltos: { emitidos: 0, coincidenRefLocal: 0, nuevos: 0, produccionNoEmitidos: 0, produccionTotalEnDocsLeidos: 0 },
  };
  const totales = {
    unidades: unidades.length, leidas: 0, competiciones: 0, resultados: 0, asaltos: 0, descartadas: 0, needsDroid: 0,
    porEstado: { results: {} as Record<string, number>, pools: {} as Record<string, number>, tableau: {} as Record<string, number> },
    porMotivoDescarte: {} as Record<string, number>,
  };
  const volcarCalidad = () => escribirAtomico(join(salida, 'pdf-calidad.json'), JSON.stringify(calidad, null, 1));

  let paginasCache = null as { sha: string; paginas: PaginaTexto[]; perfil: LecturaPdf['perfil'] } | null;
  const inicio = Date.now();
  for (const [i, u] of unidades.entries()) {
    const season = u.asociaciones?.length === 1 ? u.asociaciones[0].temporada : null;
    const blobPath = u.sha256 ? join(cache, 'blobs', `${u.sha256}.bin`) : null;
    const base = { pdfId: u.id, url: u.url, sha256: u.sha256, blobPath: blobPath && existsSync(blobPath) ? blobPath : null, season, docId: null as string | null };
    const fallo = (motivo: string) => {
      errores.push({ pdfId: u.id, error: motivo });
      calidad.push({
        ...base, pages: null, competitions: 0, results: 0, bouts: 0,
        status: { results: 'ilegible', pools: 'ilegible', tableau: 'ilegible' },
        needsDroid: true, reason: `no leído: ${motivo}`, unattributedPages: [], ocrPages: [], discarded: [],
      });
    };
    try {
      if (!season) { fallo('asociacion_temporada_ambigua'); continue; }
      if (u.estado !== 'cached' || !u.sha256 || !base.blobPath) { fallo(`unidad_${u.estado}${u.motivo ? `:${u.motivo}` : ''}`); continue; }
      const { docId, motivo } = resolverDocId(indice, season, u.url);
      resolucion[motivo] = (resolucion[motivo] ?? 0) + 1;
      base.docId = docId;
      if (paginasCache?.sha !== u.sha256) {
        const bytes = new Uint8Array(readFileSync(base.blobPath));
        const sha = await sha256Hex(bytes);
        if (sha !== u.sha256) { fallo('hash_mismatch'); continue; }
        const { paginas, perfil } = await extraerPaginas(bytes);
        paginasCache = { sha, paginas, perfil };
      }
      const lectura: LecturaPdf = { ...leerResultadosPdf(paginasCache.paginas, { url: u.url, docId }), sha256: paginasCache.sha, perfil: paginasCache.perfil };
      const conv = lecturaAHechos(lectura, season, fechas);
      for (const h of conv.hechos) {
        const nombre = nombreUnico(h, usados);
        writeFileSync(join(dirHechos, nombre), JSON.stringify(h, null, 1), 'utf8');
        escritos.add(nombre);
        totales.competiciones += 1;
        totales.resultados += h.results.length;
        totales.asaltos += h.bouts.length;
        for (const k of ['results', 'pools', 'tableau'] as const) totales.porEstado[k][h.status[k]] = (totales.porEstado[k][h.status[k]] ?? 0) + 1;
      }
      totales.descartadas += conv.descartadas.length;
      for (const d of conv.descartadas) {
        const m = d.motivo.split(':').slice(0, 2).join(':');
        totales.porMotivoDescarte[m] = (totales.porMotivoDescarte[m] ?? 0) + 1;
      }
      totales.leidas += 1;

      if (indice) {
        const emitidas = new Set(conv.hechos.map((h) => `${season}|${h.competition.competitionKey}`));
        const prefijo = `${season}|pdf:${docId}:`;
        for (const [k, v] of indice.competiciones) {
          if (!k.startsWith(prefijo)) continue;
          comparacion.competicionesProduccionEnDocsLeidos += 1;
          comparacion.resultados.produccionTotalEnDocsLeidos += v.results.size;
          comparacion.asaltos.produccionTotalEnDocsLeidos += v.bouts.size;
          if (!emitidas.has(k)) {
            comparacion.competicionesProduccionNoEmitidas.push(k);
            comparacion.resultados.produccionNoEmitidos += v.results.size;
            comparacion.asaltos.produccionNoEmitidos += v.bouts.size;
          }
        }
        for (const h of conv.hechos) {
          const prod = indice.competiciones.get(`${season}|${h.competition.competitionKey}`);
          comparacion.resultados.emitidos += h.results.length;
          comparacion.asaltos.emitidos += h.bouts.length;
          if (!prod) {
            comparacion.competicionesNuevas += 1;
            comparacion.resultados.nuevos += h.results.length;
            comparacion.asaltos.nuevos += h.bouts.length;
            continue;
          }
          comparacion.competicionesCoinciden += 1;
          const keys = new Set(h.results.map((r) => r.factKey));
          for (const r of keys) if (prod.results.has(r)) comparacion.resultados.coinciden += 1; else comparacion.resultados.nuevos += 1;
          for (const r of prod.results) if (!keys.has(r)) comparacion.resultados.produccionNoEmitidos += 1;
          const locales = new Set((conv.refsLocales.get(h) ?? []).map(claveAsalto));
          for (const b of locales) if (prod.bouts.has(b)) comparacion.asaltos.coincidenRefLocal += 1; else comparacion.asaltos.nuevos += 1;
          for (const b of prod.bouts) if (!locales.has(b)) comparacion.asaltos.produccionNoEmitidos += 1;
        }
      }
      calidad.push(calidadDe(base, lectura, conv));
    } catch (e) {
      fallo(e instanceof Error ? e.message : String(e));
    }
    if ((i + 1) % 100 === 0) {
      volcarCalidad();
      console.log(`${i + 1}/${unidades.length} unidades, ${Math.round((Date.now() - inicio) / 1000)} s`);
    }
  }
  volcarCalidad();
  if (!a.solo && !a.limite) {
    for (const f of readdirSync(dirHechos)) if (f.endsWith('.json') && !f.startsWith('_') && !escritos.has(f)) unlinkSync(join(dirHechos, f));
  }
  totales.needsDroid = calidad.filter((c) => c.needsDroid).length;
  const informe = {
    generadoEn: new Date().toISOString(),
    cache,
    base: a.base ?? null,
    segundos: Math.round((Date.now() - inicio) / 1000),
    totales,
    pdfsUnicos: new Set(unidades.map((u) => u.sha256)).size,
    resolucionDocId: resolucion,
    comparacion: { ...comparacion, competicionesProduccionNoEmitidas: comparacion.competicionesProduccionNoEmitidas.slice(0, 200), competicionesProduccionNoEmitidasTotal: comparacion.competicionesProduccionNoEmitidas.length },
    errores,
  };
  escribirAtomico(join(dirHechos, '_informe.json'), JSON.stringify(informe, null, 1));
  console.log(JSON.stringify({ ...informe, errores: errores.length, comparacion: { ...informe.comparacion, competicionesProduccionNoEmitidas: undefined } }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
