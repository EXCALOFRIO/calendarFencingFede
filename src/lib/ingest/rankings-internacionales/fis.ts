import { desescaparXml, type HojaXlsx } from './xlsx';
import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Ranking nazionale de la Federazione Italiana Scherma. Cada actualización es
 * un «documento» de `federscherma.it` con un .xlsx (una hoja por arma y género:
 * FF, FM, SCF, SCM, SPF, SPM) que se descarga por
 * `forceDownload.php?ID_file=<id>`. robots.txt sin restricciones; la API REST
 * de WordPress está cerrada (403), así que los documentos se localizan con el
 * buscador público `/?s=...&post_type=documento`, que lista título, fecha e id.
 *
 * Cada hoja: título «RANKING ASSOLUTO 2025 - 2026 - FIORETTO FEMMINILE», una
 * línea de estado (FINALE / INIZIALE / Aggiornamento n. X del dd/mm/aaaa) y la
 * tabla con Rank, NOME (o Atleta), Codice (tessera FIS), Società, Anno (fecha
 * de nacimiento como número de serie de Excel) y TOTALE.
 */

export const FIS_BASE = 'https://federscherma.it';
export const urlBusquedaFis = (consulta: string, pagina: number) =>
  `${FIS_BASE}/${pagina > 1 ? `page/${pagina}/` : ''}?s=${encodeURIComponent(consulta).replace(/%20/g, '+')}&post_type=documento`;
export const urlArchivoFis = (idFile: string) => `${FIS_BASE}/wp-content/plugins/if_document_manager/forceDownload.php?ID_file=${idFile}`;

export const CONSULTAS_FIS = ['ranking finale', 'ranking assoluto', 'ranking giovani', 'ranking cadetti', 'ranking under 23', 'ranking u23'];

export type DocumentoFis = { post: string; idFile: string; fecha: string; titulo: string };

export function parseBusquedaFis(html: string): DocumentoFis[] {
  const salida: DocumentoFis[] = [];
  for (const m of html.matchAll(/<article\b[^>]*data-id="(\d+)"[\s\S]*?<\/article>/g)) {
    const bloque = m[0];
    const fecha = /datetime="(\d{4}-\d{2}-\d{2})/.exec(bloque)?.[1];
    const titulo = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(bloque)?.[1];
    const idFile = /ID_file=(\d+)/.exec(bloque)?.[1];
    if (!fecha || !titulo || !idFile) continue;
    salida.push({ post: m[1], idFile, fecha, titulo: desescaparXml(titulo.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() });
  }
  return salida;
}

const CATEGORIA_TITULO: [RegExp, Categoria, string][] = [
  [/^ASSOLUT[OI]$/, 'ABS', 'ASSOLUTI'],
  [/^GIOVANI$/, 'M20', 'GIOVANI'],
  [/^CADETTI$/, 'M17', 'CADETTI'],
  [/^(U|UNDER)\s*23$/, 'M23', 'UNDER 23'],
];

export type ClaseDocumentoFis = { categoria: Categoria; categoriaRaw: string; temporada: string; finale: boolean };

/** «RANKING ASSOLUTO 2025-2026 FINALE», «RANKING U23 2024/2025 FINALE», «RANKING CADETTI 2024-25 FINALE»... */
export function claseDocumentoFis(titulo: string): ClaseDocumentoFis | null {
  const m = /^RANKING\s+(ASSOLUT[OI]|GIOVANI|CADETTI|U(?:NDER)?\s*23)\s+(\d{4})\s*[-/]\s*(\d{2}|\d{4})\b/i.exec(titulo.trim());
  if (!m) return null;
  const nombre = m[1].toUpperCase().replace(/\s+/g, ' ');
  const cat = CATEGORIA_TITULO.find(([r]) => r.test(nombre));
  if (!cat) return null;
  const inicio = Number(m[2]);
  const fin = m[3].length === 2 ? Math.floor(inicio / 100) * 100 + Number(m[3]) : Number(m[3]);
  if (fin !== inicio + 1) return null;
  return { categoria: cat[1], categoriaRaw: cat[2], temporada: `${inicio}-${fin}`, finale: /\bFINALE\b/i.test(titulo) };
}

/** Por (categoría, temporada): el FINALE si existe; si no, el documento más reciente. */
export function elegirDocumentosFis(docs: readonly DocumentoFis[]): (DocumentoFis & ClaseDocumentoFis)[] {
  const porClave = new Map<string, DocumentoFis & ClaseDocumentoFis>();
  for (const d of docs) {
    const c = claseDocumentoFis(d.titulo);
    if (!c) continue;
    const clave = `${c.categoria}|${c.temporada}`;
    const previo = porClave.get(clave);
    const mejor = !previo
      || (c.finale && !previo.finale)
      || (c.finale === previo.finale && (d.fecha > previo.fecha || (d.fecha === previo.fecha && Number(d.post) > Number(previo.post))));
    if (mejor) porClave.set(clave, { ...d, ...c });
  }
  return [...porClave.values()].sort((a, b) => a.temporada.localeCompare(b.temporada) || a.categoria.localeCompare(b.categoria));
}

const HOJA: Record<string, { arma: Arma; genero: Genero }> = {
  FF: { arma: 'FLORETE', genero: 'F' }, FM: { arma: 'FLORETE', genero: 'M' },
  SCF: { arma: 'SABLE', genero: 'F' }, SCM: { arma: 'SABLE', genero: 'M' },
  SPF: { arma: 'ESPADA', genero: 'F' }, SPM: { arma: 'ESPADA', genero: 'M' },
};

/** Año de nacimiento desde la celda «Anno»: número de serie de Excel o año de cuatro cifras. */
export function anioDeCeldaFis(valor: string): number | null {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (Number.isInteger(n) && n >= 1900 && n <= 2100) return n;
  if (n < 1 || n > 80_000) return null;
  const anio = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000).getUTCFullYear();
  return anio >= 1900 && anio <= 2100 ? anio : null;
}

function puntosFis(valor: string): string | null {
  const n = Number(valor);
  if (valor.trim() === '' || !Number.isFinite(n)) return null;
  return String(Math.round(n * 1000) / 1000);
}

function fechaEstado(filas: readonly string[][]): string | null {
  for (const f of filas.slice(0, 8)) {
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(f.join(' '));
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

/** Una lista por hoja reconocida. La fecha publicada es la del estado de la hoja o, si no la trae, la del documento. */
export function listasFis(doc: DocumentoFis & ClaseDocumentoFis, hojas: readonly HojaXlsx[]): ListaInternacional[] {
  const salida: ListaInternacional[] = [];
  for (const h of hojas) {
    const codigo = /^([A-Z]+)\b/.exec(h.nombre.trim().toUpperCase())?.[1] ?? '';
    const ag = HOJA[codigo];
    if (!ag) continue;
    const iCab = h.filas.findIndex((f) => /^rank$/i.test(f[0] ?? '') && f.some((x) => /^(nome|atleta)$/i.test(x)));
    if (iCab < 0) continue;
    const cab = h.filas[iCab].map((x) => x.trim().toLowerCase());
    const iNom = cab.findIndex((x) => x === 'nome' || x === 'atleta');
    const iCod = cab.indexOf('codice');
    const iAnno = cab.indexOf('anno');
    const iTot = cab.indexOf('totale');
    const filas: FilaInternacional[] = [];
    const vistos = new Set<string>();
    for (const f of h.filas.slice(iCab + 1)) {
      const nombre = (f[iNom] ?? '').trim();
      const codigoFis = iCod >= 0 ? (f[iCod] ?? '').trim() : '';
      const puesto = Number(f[0]);
      if (!nombre || !Number.isInteger(puesto) || puesto <= 0) continue;
      const ref = codigoFis ? `fis:${codigoFis}` : `fis:${nombre}`;
      if (vistos.has(ref)) continue;
      vistos.add(ref);
      filas.push({
        ref,
        nombre,
        pais: null,
        puesto,
        puntos: iTot >= 0 ? puntosFis(f[iTot] ?? '') : null,
        anioNacimiento: iAnno >= 0 ? anioDeCeldaFis(f[iAnno] ?? '') : null,
      });
    }
    if (!filas.length) continue;
    const fecha = fechaEstado(h.filas) ?? doc.fecha;
    salida.push({
      fuente: 'fis_ranking',
      temporada: doc.temporada,
      arma: ag.arma,
      genero: ag.genero,
      categoria: doc.categoria,
      categoriaRaw: doc.categoriaRaw,
      publicadoEl: fecha,
      baseFecha: 'source',
      url: urlArchivoFis(doc.idFile),
      total: filas.length,
      filas,
    });
  }
  return salida;
}
