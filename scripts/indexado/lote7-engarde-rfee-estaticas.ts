/**
 * Exportaciones estáticas de Engarde del organismo rfee (`/files/rfee/<carpeta>/`) cuyos
 * torneos ya no están en la lista de `getTournois.php`: se leen en vivo y, si no responden,
 * de la Wayback Machine (capturas `id_`), y se escriben en `hechos/lote7-engarde-rfee/` las
 * pruebas o fases que faltan en nuevo7 y en los demás lotes 7, con las reglas de
 * `lote7-engarde-rfee.ts` (misma clave `engarde:rfee/<carpeta>/<prueba>`).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-engarde-rfee-estaticas.ts [--db <nuevo7.sqlite>] \
 *     [--carpetas cespm15,...] [--salida <carpeta de hechos>]
 */
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import { parsearFechaTexto } from '../../src/lib/ingest/sources/engarde';
import type { AsaltoHecho } from '../../src/lib/ingest/hechos/formato';
import { decodificarHtml, documentosDelMenu, esCuadroPrincipal, tipoDocumentoEngarde } from '../../src/lib/ingest/sources/engarde-antiguo';
import { argumento } from './comun';
import { convertirEntrada, type EntradaPrueba } from './engarde-historico-a-hechos';
import {
  compatible, equivalentesLotes, equivalentesNuevo7, fasesQueFaltan, SALIDA_ENGARDE_RFEE, solapeNombres, type Cobertura,
} from './lote7-engarde-rfee';
import { encuentrosEngarde, podioDe, refsEquipos } from './lote7-equipos-engarde';
import { abrirNuevo7, dia, EscritorHechos, NUEVO7 } from './lote7-faltan-comun';
import { divisionLiga, type Atributos } from './lote7-faltan-engarde';
import { Red } from './lote7-faltan-red';

export const CARPETAS_ESTATICAS = ['cespm15', 'tnr-m20-fm', 'tnrm20barajas', 'tntefabscne', 'ffabsalcobendas', 'cm_burgos'] as const;
const BASE = 'https://engarde-service.com/files/rfee';
const FUSIONA_CON_ENGARDE = new Set(['skermo_rfee', 'rfee_pdf']);

/** Título y pruebas enlazadas (`#liens`) de la portada de una exportación estática. */
export function portadaEstatica(html: string): { titulo: string | null; pruebas: { compe: string; nombre: string }[] } {
  const titulo = /<div id="title">([^<]+)<\/div>/i.exec(html)?.[1]?.trim() ?? /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const liens = /<div id="liens">([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? html;
  const pruebas: { compe: string; nombre: string }[] = [];
  for (const m of liens.matchAll(/<a\s+href="([^"/?#:]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const nombre = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!pruebas.some((p) => p.compe === m[1])) pruebas.push({ compe: m[1], nombre });
  }
  return { titulo, pruebas };
}

/**
 * Nombre del torneo: el título de la portada o, si la exportación lo publica como «undefined»,
 * el comienzo común de los nombres de sus pruebas («Campeonato de España M-15»), con el año.
 */
export function nombreTorneo(titulo: string | null, pruebas: readonly string[], fecha: string | null): string {
  if (titulo && titulo !== 'undefined') return titulo;
  const palabras = pruebas.map((p) => p.split(/\s+/));
  const comun: string[] = [];
  for (let i = 0; palabras.length > 0 && palabras.every((p) => p[i] !== undefined && p[i] === palabras[0][i]); i += 1) comun.push(palabras[0][i]);
  const base = comun.join(' ').trim() || 'Engarde rfee';
  return fecha && !base.includes(fecha.slice(0, 4)) ? `${base} ${fecha.slice(0, 4)}` : base;
}

type Captura = { timestamp: string; original: string };

async function main(): Promise<void> {
  const hoy = new Date().toISOString().slice(0, 10);
  const db = abrirNuevo7(argumento('db', NUEVO7));
  // Lo que este lector escribió en una ejecución anterior no cuenta como existente.
  const propias = (k: string) => CARPETAS_ESTATICAS.some((c) => k.startsWith(`engarde:rfee/${c}/`));
  const existentes = [...equivalentesNuevo7(db), ...equivalentesLotes(['lote7-efc']).filter((x) => !(x.origen === 'lote7-engarde-rfee' && propias(x.key)))];
  const red = new Red(undefined, 1200, 1);
  const escritor = new EscritorHechos('lector_engarde_estatica', argumento('salida', SALIDA_ENGARDE_RFEE));
  const porCarpeta: Record<string, unknown>[] = [];
  const pedidas = argumento('carpetas', '').split(',').map((c) => c.trim()).filter(Boolean);
  const carpetas = pedidas.length ? CARPETAS_ESTATICAS.filter((c) => pedidas.includes(c)) : CARPETAS_ESTATICAS;

  for (const carpeta of carpetas) {
    const cdx = await red.get(`https://web.archive.org/cdx/search/cdx?url=engarde-service.com/files/rfee/${carpeta}/&matchType=prefix&filter=statuscode:200&fl=timestamp,original&limit=5000`);
    const capturas: Captura[] = cdx.status === 200
      ? cdx.body.toString('utf8').split('\n').filter(Boolean).map((l) => ({ timestamp: l.split(' ')[0], original: l.split(' ')[1] }))
      : [];
    const ruta = (original: string) => original.replace(/^https?:\/\/(www\.)?engarde-service\.com(:80)?\/files\/rfee\//i, '').replace(/index\.php\?page=/i, '');
    const ultima = (rel: string) => capturas.filter((c) => ruta(c.original) === rel).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] ?? null;
    /** Página en vivo o, si no, su última captura; `origen` dice de dónde salió. */
    const traer = async (rel: string): Promise<{ html: string; url: string; origen: 'vivo' | 'wayback' } | null> => {
      const vivo = await red.get(`${BASE}/${rel}`);
      // El servidor anuncia utf-8 pero estas exportaciones son ISO-8859-1 según su <meta>.
      const cuerpo = decodificarHtml(vivo.body);
      if (vivo.status === 200 && !/<title>\s*Engarde\s*<\/title>|currently has no data/i.test(cuerpo)) return { html: cuerpo, url: `${BASE}/${rel}`, origen: 'vivo' };
      const c = ultima(rel);
      if (!c) return null;
      const w = await red.get(`https://web.archive.org/web/${c.timestamp}id_/${c.original}`);
      return w.status === 200 ? { html: decodificarHtml(w.body), url: `https://web.archive.org/web/${c.timestamp}/${c.original}`, origen: 'wayback' } : null;
    };
    const info: Record<string, unknown> = { carpeta, capturasWayback: capturas.length, documentosArchivados: capturas.filter((c) => tipoDocumentoEngarde(ruta(c.original).split('/').pop() ?? '')).length };
    porCarpeta.push(info);
    const portada = await traer(`${carpeta}/`);
    if (!portada) {
      info.resultado = 'sin_portada';
      continue;
    }
    const { titulo, pruebas } = portadaEstatica(portada.html);
    const fechaTorneo = parsearFechaTexto(titulo ?? '');
    Object.assign(info, { titulo, fechaTorneo, portada: portada.origen, pruebas: [] as unknown[] });
    for (const { compe, nombre } of pruebas) {
      const k = `engarde:rfee/${carpeta}/${compe}`;
      const fila: Record<string, unknown> = { prueba: k, nombre };
      (info.pruebas as unknown[]).push(fila);
      const menu = await traer(`${carpeta}/${compe}/menu.html`);
      if (!menu) {
        fila.resultado = 'sin_menu_ni_documentos';
        continue;
      }
      fila.menu = menu.origen;
      const docs: { fichero: string; html: string; url: string; tipo: string }[] = [];
      const faltan: string[] = [];
      for (const d of documentosDelMenu(menu.html)) {
        const r = await traer(`${carpeta}/${compe}/${d.fichero}`);
        if (r) docs.push({ fichero: d.fichero, html: r.html, url: r.url, tipo: d.tipo });
        else faltan.push(d.fichero);
      }
      fila.documentos = docs.length;
      fila.faltan = faltan;
      const entrada: EntradaPrueba = {
        org: 'rfee', evt: carpeta, compe, claveTorneo: `engarde:rfee/${carpeta}`, claveCompeticion: k, nombreTorneo: titulo ?? carpeta,
        comp: { sexe: '', arme: '', estindividuelle: '', categorie: '', etat: 'completed', ville: '', pays: '' },
        legado: true, titulos: [nombre, titulo ?? ''], fechaIndice: null, fechaTorneo, temporadaCarpeta: null,
        clasificacion: docs.find((d) => d.tipo === 'clasificacion') ?? null,
        poules: docs.filter((d) => d.tipo === 'poules').map((d) => ({ ...d, pagina: Number(/(\d+)\.html?$/i.exec(d.fichero)?.[1] ?? 1) })),
        cuadros: docs.filter((d) => d.tipo === 'cuadro'),
        faltan, extractor: 'lector_engarde_estatica',
      };
      const r = convertirEntrada(entrada, hoy);
      if (!r.ok) {
        fila.resultado = r.motivo;
        continue;
      }
      const h = r.hechos;
      const c = h.competition;
      h.edition.name = nombreTorneo(titulo, pruebas.map((x) => x.nombre), c.date ?? h.edition.startDate);
      if (c.format === 'EQUIPOS' && h.results.length > 0) {
        const docsEq = docs.filter((d) => d.tipo === 'poules' || (d.tipo === 'cuadro' && esCuadroPrincipal(d.fichero))).map((d) => ({
          url: d.url, html: d.html, tipo: d.tipo as 'poules' | 'cuadro', pagina: Number(/(\d+)\.html?$/i.exec(d.fichero)?.[1] ?? 1), antiguo: true,
        }));
        const eq = encuentrosEngarde(docsEq, faltan, refsEquipos(h.results), podioDe(h.results));
        if (eq.bouts.length > 0) {
          h.bouts = eq.bouts as AsaltoHecho[];
          h.status.pools = eq.pools;
          h.status.tableau = eq.tableau;
          h.status.notes = h.status.notes.filter((n) => !/no se importan asaltos individuales/i.test(n)).concat(eq.notas);
        }
      }
      const fecha = c.date ?? h.edition.startDate;
      if (!fecha) {
        fila.resultado = 'sin_fecha';
        continue;
      }
      const a: Atributos = { weapon: c.weapon, gender: c.gender, category: c.category, format: c.format, fecha, division: c.format === 'EQUIPOS' ? divisionLiga(`${nombre} ${compe}`) : null };
      const e: Cobertura = { resultados: h.results.length, poules: h.bouts.filter((b) => b.phase === 'POULE').length, cuadro: h.bouts.filter((b) => b.phase === 'TABLEAU').length };
      const nombres = [...new Set([...h.results.map((x) => x.name), ...h.bouts.flatMap((b) => [b.aName, b.bName])].map(normalizeSportName).filter(Boolean))];
      const mismaClave = existentes.filter((x) => x.key === k);
      const mismos = existentes.filter((x) => x.key !== k && compatible(a, x)).map((x) => ({ x, s: a.format === 'INDIVIDUAL' ? solapeNombres(nombres, x.nombres()) : null }))
        .filter((y) => y.s === null || y.s >= 0.3);
      const equivalentes = [...mismaClave, ...mismos.map((y) => y.x)];
      const ex: Cobertura = {
        resultados: Math.max(0, ...equivalentes.map((y) => y.resultados)), poules: Math.max(0, ...equivalentes.map((y) => y.poules)), cuadro: Math.max(0, ...equivalentes.map((y) => y.cuadro)),
      };
      const fases = fasesQueFaltan(e, ex);
      Object.assign(fila, {
        atributos: `${c.weapon} ${c.gender} ${c.category} ${c.format} ${fecha}`, engarde: e, existente: ex,
        equivalentes: equivalentes.map((y) => `${y.origen}:${y.source}:${y.key}`).slice(0, 4),
      });
      const fusionable = mismaClave.some((y) => y.source === 'engarde') ||
        (a.format === 'INDIVIDUAL' && mismos.some((y) => y.x.origen === 'nuevo7' && FUSIONA_CON_ENGARDE.has(y.x.source) && y.s !== null && y.s >= 0.5));
      if (equivalentes.length > 0 && fases.length === 0) fila.resultado = 'completa_en_nuevo7';
      else if (equivalentes.length > 0 && !fusionable) {
        fila.resultado = equivalentes.some((y) => y.source === 'fie') ? 'existe_en_fie_sin_fusion' : 'fase_falta_sin_fusion_segura';
        fila.faltanFases = fases;
      } else {
        h.status.notes.push(`Exportación estática de Engarde (${portada.origen === 'vivo' && menu.origen === 'vivo' ? 'en vivo' : 'Wayback Machine'}); el torneo ya no figura en la lista del organismo rfee`);
        escritor.escribir(h);
        fila.resultado = equivalentes.length === 0 ? 'escrita_falta_entera' : `escrita_fases_${fases.join('_')}`;
        existentes.push({
          origen: 'lote7-engarde-rfee', source: 'engarde', key: k, weapon: a.weapon, gender: a.gender, category: a.category, format: a.format, d: dia(fecha),
          division: a.division ?? null, ...e, nombres: () => nombres,
        });
      }
    }
  }
  db.close();
  escritor.limpiarAntiguos();
  const resumen = { generado: new Date().toISOString(), ficheros: escritor.total, peticiones: red.peticiones, carpetas: porCarpeta };
  escritor.informe('engarde-rfee-estaticas', resumen);
  console.log(JSON.stringify(resumen, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
