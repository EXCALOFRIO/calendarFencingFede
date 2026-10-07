/**
 * Lectura determinista de un PDF RFEE (`sources/rfee-pdf`) -> hechos por prueba. La usan el
 * lote manual (`scripts/indexado/pdf-a-hechos.ts`, desde la caché) y la ingesta automática
 * (desde la red): mismas claves de edición, prueba, puesto y asalto. Sin red ni disco.
 */
import { hechosPrueba, type AsaltoHecho, type HechosPrueba, type ResultadoHecho } from './formato';
import type { CoberturaPdf, LecturaPdf, PruebaPdf, Rechazo } from '../sources/rfee-pdf/tipos';
import { fechasCatalogo, type IndiceFechas } from './fechas-catalogo';
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

