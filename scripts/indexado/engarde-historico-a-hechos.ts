/**
 * Convierte al formato común de hechos, sin red, lo descargado por
 * `engarde-historico-descargar.ts` (engarde-service.com antes de 2018-19) y
 * por `wayback-engarde-descargar.ts` (esgrimacyl.es y fecv.es archivados).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/engarde-historico-a-hechos.ts \
 *     [--entrada <calendario-trabajo/engarde-historico>] [--salida <calendario-trabajo/hechos/engarde-historico>] \
 *     [--engarde <calendario-trabajo/hechos/engarde>] [--hasta 2018-09-01]
 *
 * Claves: edición `engarde:{org}/{evt}` y prueba `engarde:{org}/{evt}/{compe}`
 * (las mismas que `engarde-a-hechos.ts`: una prueba que ya está en
 * `hechos/engarde` no se repite aquí); en la Wayback,
 * `engarde-wayback:{sitio}/{carpeta}` y `.../{documento o subcarpeta}`.
 *
 * Arma, género, categoría y modalidad salen del índice salvo en los torneos
 * migrados del sistema antiguo, cuyo índice trae valores por defecto
 * (`engarde-antiguo.ts`): ahí salen del título publicado. Si el título no los
 * fija sin ambigüedad la prueba se descarta (`atributos_incompletos`), y si no
 * hay fecha publicada, también (`sin_fecha`): no se adivina la temporada.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { mapGender, mapWeapon } from '../../src/lib/ingest/mappers';
import { parsearFechaTexto, parsearPaginaEngarde, urlPruebaEngarde } from '../../src/lib/ingest/sources/engarde';
import {
  armaDeTitulo,
  cabeceraDocumento,
  categoriaDeCodigo,
  categoriasDeTitulo,
  documentosDelMenu,
  esCuadroPrincipal,
  esEquiposDeTitulo,
  esFechaFicticiaEngarde,
  esTorneoDePrueba,
  generoDeTitulo,
  normalizarClasificacionAntigua,
  normalizarCuadroAntiguo,
  tipoDocumentoEngarde,
} from '../../src/lib/ingest/sources/engarde-antiguo';
import { argumento } from './comun';
import { convertirPrueba, temporadaRfee, type Paginas, type PruebaIndice } from './engarde-a-hechos';
import { CacheEngarde, claveCache, paginasDePrueba } from './engarde-descargar';
import {
  CARPETA_ENGARDE_HISTORICO,
  FECHA_CORTE,
  fechaTorneoLista,
  indiceTorneo,
  listaTorneos,
  ORGANIZADORES_ES,
  urlFicheroEngarde,
  type CompIndice,
} from './engarde-historico-descargar';
import { capturasDeDocumentos, claveWayback, PREFIJOS_WAYBACK } from './wayback-engarde-descargar';

type Arma = HechosPrueba['competition']['weapon'];
type Genero = HechosPrueba['competition']['gender'];
type Categoria = HechosPrueba['competition']['category'];

export type Atributos = { arma: Arma | null; genero: Genero | null; categoria: Categoria | null; individual: boolean | null };

/** Primer valor no nulo de los títulos, en orden de preferencia. */
function primero<T>(titulos: readonly string[], f: (t: string) => T | null): T | null {
  for (const t of titulos) {
    const v = f(t);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Atributos de una prueba. `titulos` va del más específico (título del índice)
 * al menos (cabecera del documento). Con `legado` el sexo, el arma y la
 * modalidad del índice son valores por defecto y no cuentan.
 */
export function atributosPrueba(
  c: Pick<CompIndice, 'sexe' | 'arme' | 'estindividuelle' | 'categorie'>,
  titulos: readonly string[],
  legado: boolean,
  equiposEnTabla: boolean,
): Atributos {
  const ts = titulos.filter((t) => t && t.trim());
  const armaT = primero(ts, armaDeTitulo);
  const generoT = primero(ts, generoDeTitulo);
  const catsT = ts.map(categoriasDeTitulo).find((cs) => cs.length > 0) ?? [];
  const catT = catsT.length === 1 ? catsT[0] : null;
  const catI = categoriaDeCodigo(c.categorie);
  const equiposT = ts.some(esEquiposDeTitulo);

  let arma: Arma | null;
  let genero: Genero | null;
  let individual: boolean | null;
  if (legado) {
    arma = armaT;
    genero = generoT;
    individual = equiposT || equiposEnTabla ? false : true;
  } else {
    const armaI = c.arme && c.arme !== '-' ? mapWeapon(c.arme) : null;
    const generoI = /^(n|x|mixte?|mixed|mixto)$/i.test(c.sexe.trim()) ? 'MIXTO' : mapGender(c.sexe);
    arma = armaI && armaT && armaI !== armaT ? null : (armaI ?? armaT);
    genero = generoI && generoT && generoI !== generoT ? null : (generoI ?? generoT);
    const indI = c.estindividuelle === '1' ? true : c.estindividuelle === '0' ? false : null;
    individual = indI === true && (equiposT || equiposEnTabla) ? null : (indI ?? !(equiposT || equiposEnTabla));
  }
  // Un título que nombra varias categorías («M10 i M12») no decide; el índice sí, si no contradice al título.
  let categoria: Categoria | null;
  if (catI && catsT.length > 0) categoria = catsT.includes(catI) ? catI : null;
  else categoria = catI ?? catT;
  return { arma, genero, categoria, individual };
}

/** Temporada «AAAA-AAAA» que nombra una ruta («02015-16/Segovia», «2014-2015/Aranda»). */
export function temporadaDeCarpeta(ruta: string): string | null {
  const m = ruta.match(/(?:^|\/)0?(20\d{2})-(\d{2}|20\d{2})(?:\/|$)/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return b === a + 1 ? `${a}-${b}` : null;
}

/** Primera fecha publicada en las líneas de cabecera de un documento. */
export function fechaDeLineas(lineas: readonly string[]): string | null {
  for (const l of [...lineas].reverse()) {
    const f = parsearFechaTexto(l);
    if (f) return f;
  }
  return null;
}

type Documento = { fichero: string; html: string; url: string };

export type EntradaPrueba = {
  org: string;
  evt: string;
  compe: string;
  claveTorneo: string;
  claveCompeticion: string;
  nombreTorneo: string;
  comp: Pick<CompIndice, 'sexe' | 'arme' | 'estindividuelle' | 'categorie' | 'etat' | 'ville' | 'pays'>;
  legado: boolean;
  titulos: string[];
  fechaIndice: string | null;
  fechaTorneo: string | null;
  /** Temporada que nombra la carpeta publicada («02015-16», «2016-17»), sólo si ningún documento trae fecha. */
  temporadaCarpeta: string | null;
  clasificacion: Documento | null;
  poules: (Documento & { pagina: number })[];
  cuadros: Documento[];
  faltan: string[];
  extractor: string;
};

export type ResultadoConversion = { ok: true; hechos: HechosPrueba } | { ok: false; motivo: string };

export function convertirEntrada(e: EntradaPrueba, hasta: string): ResultadoConversion {
  if (!e.clasificacion && e.poules.length === 0 && e.cuadros.length === 0) return { ok: false, motivo: 'sin_documentos' };
  if (esTorneoDePrueba(e.nombreTorneo)) return { ok: false, motivo: 'torneo_de_prueba' };
  const clasHtml = e.clasificacion ? normalizarClasificacionAntigua(e.clasificacion.html) : null;
  const pagina = clasHtml ? parsearPaginaEngarde(clasHtml) : null;
  const cabeceras = [e.clasificacion, ...e.poules, ...e.cuadros].filter((d): d is Documento => !!d).map((d) => cabeceraDocumento(d.html));
  const titulos = [...e.titulos, ...cabeceras.flatMap((c) => [c.titulo ?? '', c.lineas.join(' ')])];
  const atr = atributosPrueba(e.comp, titulos, e.legado, pagina?.equipos ?? false);
  const fecha =
    e.fechaIndice ?? pagina?.fecha ?? cabeceras.map((c) => fechaDeLineas([c.titulo ?? '', ...c.lineas])).find(Boolean) ?? e.fechaTorneo;
  const season = fecha ? temporadaRfee(fecha) : e.temporadaCarpeta;
  if (!season) return { ok: false, motivo: 'sin_fecha' };
  if (fecha ? fecha >= hasta : season >= temporadaRfee(hasta)) return { ok: false, motivo: 'posterior_al_corte' };
  if (!atr.arma || !atr.genero || !atr.categoria || atr.individual === null) return { ok: false, motivo: 'atributos_incompletos' };

  const p: PruebaIndice = {
    org: e.org, evt: e.evt, compe: e.compe, url: urlPruebaEngarde(e.org, e.evt, e.compe),
    titulo: e.titulos.find(Boolean) ?? cabeceras[0]?.titulo ?? e.compe,
    // `categoria` es el tipo del índice actual (sin M10/M12); `convertirPrueba` usa `categoriaFinal`.
    arma: atr.arma, genero: atr.genero, categoria: null,
    categoriaOriginal: e.comp.categorie || null, categoriaContradictoria: false, individual: atr.individual, fecha,
    ciudad: e.comp.ville || null, pais: e.comp.pays || null,
    // Una clasificación general en una exportación estática es la de la prueba terminada.
    estado: e.comp.etat || 'completed',
    sexe: e.comp.sexe, generoFinal: atr.genero, categoriaFinal: atr.categoria,
  };
  const paginas: Paginas = {
    prueba: clasHtml ?? '<html><body></body></html>',
    clasfinal: null,
    poules: e.poules.map((d) => ({ pagina: d.pagina, html: d.html })),
    cuadros: e.cuadros.map((d) => ({ url: d.url, html: normalizarCuadroAntiguo(d.html) })),
    faltan: e.faltan,
  };
  const r = convertirPrueba(p, paginas, {
    season, nombreTorneo: e.nombreTorneo, inicio: fecha, fin: fecha, ciudad: e.comp.ville || null,
  });
  if (!r.ok) return r;
  const principal = e.clasificacion ?? e.poules[0] ?? e.cuadros[0];
  const h: HechosPrueba = {
    ...r.hechos,
    extractor: e.extractor,
    sourceUrl: principal.url,
    sourceSha256: createHash('sha256').update(principal.html).digest('hex'),
    edition: { ...r.hechos.edition, tournamentKey: e.claveTorneo },
    competition: { ...r.hechos.competition, competitionKey: e.claveCompeticion, categoryRaw: e.comp.categorie || p.titulo || null },
  };
  return { ok: true, hechos: hechosPrueba.parse(h) };
}

// ---------------------------------------------------------------------------
// Lectura de la caché
// ---------------------------------------------------------------------------

const soloCache = (cache: CacheEngarde) => async (clave: string) => cache.leer(clave);

function numeroPoules(fichero: string): number {
  const n = fichero.match(/(\d+)\.html?$/i);
  return n ? Number(n[1]) : 1;
}

/** Pruebas de engarde-service.com en la caché, listas para convertir. */
export async function entradasEngardeService(cache: CacheEngarde, orgs: readonly string[]): Promise<EntradaPrueba[]> {
  const traer = soloCache(cache);
  const out: EntradaPrueba[] = [];
  for (const org of orgs) {
    for (const t of await listaTorneos(org, traer)) {
      const comps = await indiceTorneo(org, t.Event, traer);
      for (const c of comps) {
        if (c.etat === 'empty') continue;
        const docs: { fichero: string; html: string; url: string; tipo: string }[] = [];
        const faltan: string[] = [];
        const menu = cache.leer(claveCache(org, t.Event, c.compe, 'files_menu.html'));
        if (menu !== null) {
          for (const d of documentosDelMenu(menu)) {
            if (d.tipo === 'cuadro' && !esCuadroPrincipal(d.fichero)) continue;
            const html = cache.leer(claveCache(org, t.Event, c.compe, `files_${d.fichero}`));
            if (html === null) faltan.push(d.fichero);
            else docs.push({ ...d, html, url: urlFicheroEngarde(org, t.Event, c.compe, d.fichero) });
          }
        } else {
          const prueba = cache.leer(claveCache(org, t.Event, c.compe, 'prueba.html'));
          if (prueba && !/currently has no data/i.test(prueba)) {
            for (const f of paginasDePrueba(prueba, org, t.Event, c.compe)) {
              const html = cache.leer(claveCache(org, t.Event, c.compe, f));
              const tipo = tipoDocumentoEngarde(f);
              if (!tipo) continue;
              if (html === null) faltan.push(f);
              else docs.push({ fichero: f, tipo, html, url: `${urlPruebaEngarde(org, t.Event, c.compe)}/${f}` });
            }
          }
        }
        const legado = esFechaFicticiaEngarde(c.date);
        out.push({
          org, evt: t.Event, compe: c.compe,
          claveTorneo: `engarde:${org}/${t.Event}`,
          claveCompeticion: `engarde:${org}/${t.Event}/${c.compe}`,
          nombreTorneo: t.Titre?.trim() || `${org}/${t.Event}`,
          comp: c, legado,
          titulos: [c.titre, c.content],
          fechaIndice: legado ? null : parsearFechaTexto(c.date),
          fechaTorneo: fechaTorneoLista(t),
          temporadaCarpeta: null,
          clasificacion: docs.find((d) => d.tipo === 'clasificacion') ?? null,
          poules: docs.filter((d) => d.tipo === 'poules').map((d) => ({ ...d, pagina: numeroPoules(d.fichero) })),
          cuadros: docs.filter((d) => d.tipo === 'cuadro'),
          faltan,
          extractor: 'lector_engarde_estatico',
        });
      }
    }
  }
  return out;
}

/**
 * Pruebas de las webs archivadas. esgrimacyl.es publica una carpeta por prueba
 * con sus documentos; fecv.es, un fichero por prueba con sólo la clasificación.
 */
export function entradasWayback(cache: CacheEngarde): EntradaPrueba[] {
  const out: EntradaPrueba[] = [];
  for (const { sitio, prefijo } of PREFIJOS_WAYBACK) {
    const cdx = cache.leer(`_wayback/${sitio}/_cdx.json`);
    if (!cdx) continue;
    const capturas = capturasDeDocumentos(sitio, prefijo, (JSON.parse(cdx) as string[][]).slice(1));
    const grupos = new Map<string, { fichero: string; html: string; url: string }[]>();
    for (const cap of capturas) {
      const html = cache.leer(claveWayback(sitio, cap.ruta));
      if (html === null) continue;
      const partes = decodeURIComponent(cap.ruta).split('/');
      const fichero = partes.pop()!;
      const carpeta = partes.join('/');
      const url = `https://web.archive.org/web/${cap.timestamp}/${cap.original}`;
      // fecv: cada fichero es una prueba; esgrimacyl: cada carpeta.
      const grupo = sitio === 'fecv' ? `${carpeta}/${fichero.replace(/\.html?$/i, '')}` : carpeta;
      const g = grupos.get(grupo) ?? [];
      g.push({ fichero, html, url });
      grupos.set(grupo, g);
    }
    for (const [grupo, docs] of grupos) {
      const tipo = (f: string) => (sitio === 'fecv' ? 'clasificacion' : tipoDocumentoEngarde(f));
      const clasificacion = docs.find((d) => tipo(d.fichero) === 'clasificacion') ?? null;
      const torneo = sitio === 'fecv' ? grupo.split('/')[0] : grupo.split('/').slice(0, -1).join('/') || grupo;
      out.push({
        org: sitio, evt: torneo, compe: grupo,
        claveTorneo: `engarde-wayback:${sitio}/${torneo}`,
        claveCompeticion: `engarde-wayback:${sitio}/${grupo}`,
        nombreTorneo: (clasificacion ? cabeceraDocumento(clasificacion.html).titulo : null) ?? `${sitio} ${torneo}`,
        comp: { sexe: '', arme: '', estindividuelle: '', categorie: '', etat: 'completed', ville: '', pays: '' },
        legado: true,
        titulos: [],
        fechaIndice: null,
        fechaTorneo: null,
        temporadaCarpeta: temporadaDeCarpeta(grupo),
        clasificacion,
        poules: docs.filter((d) => tipo(d.fichero) === 'poules').map((d) => ({ ...d, pagina: numeroPoules(d.fichero) })),
        cuadros: docs.filter((d) => tipo(d.fichero) === 'cuadro'),
        faltan: [],
        extractor: 'lector_engarde_wayback',
      });
    }
  }
  return out;
}

/** `competitionKey` de los hechos ya escritos en otra carpeta (para no duplicar pruebas). */
export function clavesExistentes(carpeta: string): Set<string> {
  const s = new Set<string>();
  if (!existsSync(carpeta)) return s;
  for (const f of readdirSync(carpeta)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const h = JSON.parse(readFileSync(join(carpeta, f), 'utf8')) as HechosPrueba;
    s.add(h.competition.competitionKey);
  }
  return s;
}

async function main(): Promise<void> {
  const entrada = argumento('entrada', CARPETA_ENGARDE_HISTORICO);
  const hechos = join(tmpdir(), 'calendario-trabajo', 'hechos');
  const salida = argumento('salida', join(hechos, 'engarde-historico'));
  const hasta = argumento('hasta', FECHA_CORTE);
  const yaEngarde = clavesExistentes(argumento('engarde', join(hechos, 'engarde')));
  mkdirSync(salida, { recursive: true });

  const entradas = [
    ...(await entradasEngardeService(new CacheEngarde(entrada), ORGANIZADORES_ES)),
    ...entradasWayback(new CacheEngarde(join(entrada, 'wayback'))),
  ];
  type Grupo = { pruebas: number; ficheros: number; resultados: number; poule: number; tableau: number; descartadas: Record<string, number> };
  const porOrigen: Record<string, Grupo> = {};
  const porTemporada: Record<string, Record<string, number>> = {};
  const estados: Record<string, Record<string, number>> = {};
  const descartadas: { prueba: string; motivo: string }[] = [];
  const escritos = new Set<string>();
  for (const e of entradas) {
    const g = (porOrigen[e.org] ??= { pruebas: 0, ficheros: 0, resultados: 0, poule: 0, tableau: 0, descartadas: {} });
    g.pruebas += 1;
    const r: ResultadoConversion = yaEngarde.has(e.claveCompeticion) ? { ok: false, motivo: 'ya_en_hechos_engarde' } : convertirEntrada(e, hasta);
    if (!r.ok) {
      g.descartadas[r.motivo] = (g.descartadas[r.motivo] ?? 0) + 1;
      if (r.motivo !== 'sin_documentos' && r.motivo !== 'posterior_al_corte') descartadas.push({ prueba: e.claveCompeticion, motivo: r.motivo });
      continue;
    }
    const h = r.hechos;
    const fichero = ficheroHechos(h);
    if (escritos.has(fichero)) {
      g.descartadas.clave_repetida = (g.descartadas.clave_repetida ?? 0) + 1;
      continue;
    }
    writeFileSync(join(salida, fichero), JSON.stringify(h, null, 2));
    escritos.add(fichero);
    g.ficheros += 1;
    g.resultados += h.results.length;
    for (const b of h.bouts) b.phase === 'POULE' ? (g.poule += 1) : (g.tableau += 1);
    const t = (porTemporada[e.org] ??= {});
    t[h.edition.season] = (t[h.edition.season] ?? 0) + 1;
    for (const s of ['results', 'pools', 'tableau'] as const) {
      const x = (estados[s] ??= {});
      x[h.status[s]] = (x[h.status[s]] ?? 0) + 1;
    }
  }
  // La carpeta de salida es exclusiva de este conversor.
  for (const f of readdirSync(salida)) if (f.endsWith('.json') && !f.startsWith('_') && !escritos.has(f)) rmSync(join(salida, f));
  const informe = { generado: new Date().toISOString(), entradas: entradas.length, ficheros: escritos.size, porOrigen, porTemporada, estados, descartadas };
  writeFileSync(join(salida, '_informe.json'), JSON.stringify(informe, null, 2));
  console.log(JSON.stringify({ ...informe, descartadas: descartadas.length }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
