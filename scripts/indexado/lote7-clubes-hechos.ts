/**
 * Hechos de las pruebas nacionales cuyos resultados completos (clasificación, poules, cuadro)
 * publicó el club organizador o la federación territorial en su web, en PDF separados por fase.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-clubes-hechos.ts [--solo <id evento>] [--sin-red] [--detalle]
 *
 * - Los documentos de cada evento están en `EVENTOS` (URLs públicas encontradas a mano en la web
 *   del club); se descargan una vez a `cache-lote7-clubes/` con `lote7-clubes-red.ts`.
 * - Los PDF de estos clubes son la página HTML de Engarde impresa desde el navegador, que el lector
 *   RFEE/Engarde local no reconoce; se leen con `lote7-clubes-impreso.ts`. Ningún modelo: todo es
 *   geometría del texto y validación (matriz de poule, árbol del cuadro, podio contra clasificación).
 * - Claves rfee_pdf derivadas de URL: edición `pdf:<docIdDeUrl(página que publica los PDF)>`,
 *   prueba `pdf:<mismo docId>:<ARMA>:<GENERO>:<FORMATO>:<CATEGORIA>`. `sourceUrl` y `sourceSha256`
 *   son los del PDF de la clasificación; las URLs de poules y cuadro van en las notas.
 * - Salida: `hechos/lote7-clubes/` (individual) y `hechos/lote7-clubes-equipos/` (equipos), con
 *   `_informe.json` en la primera.
 */
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type AsaltoHecho, type HechosPrueba, type ResultadoHecho } from '../../src/lib/ingest/hechos/formato';
import { docIdDeUrl, extraerPaginas } from '../../src/lib/ingest/sources/rfee-pdf/lectura';
import type { PaginaTexto } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { asaltosDePoule, leerClasificacion, leerCuadro, leerPoules, nombresCasan, type FilaClasificacion } from './lote7-clubes-impreso';
import { HECHOS_CLUBES, HECHOS_CLUBES_EQUIPOS, obtener } from './lote7-clubes-red';
import { EVENTOS, type EventoClub, type PruebaClub } from './lote7-clubes-eventos';

type Estado = HechosPrueba['status']['results'];

export type Documento = { url: string; sha256: string; paginas: PaginaTexto[] };

async function documento(url: string, sinRed: boolean): Promise<Documento> {
  const r = await obtener(url, { soloCache: sinRed });
  if (r.status !== 200) throw new Error(`http_${r.status}:${url}`);
  const { paginas } = await extraerPaginas(r.bytes);
  return { url, sha256: r.sha256, paginas };
}

const ordenar = (b: AsaltoHecho): AsaltoHecho =>
  b.aRef < b.bRef ? b : { ...b, aRef: b.bRef, bRef: b.aRef, aName: b.bName, bName: b.aName, scoreA: b.scoreB, scoreB: b.scoreA, winner: b.winner === null ? null : b.winner === 'A' ? 'B' : 'A' };

/** Emparejamiento de un nombre leído en poule o cuadro con una sola fila de la clasificación. */
export function emparejar(nombre: string, filas: readonly { factKey: string; name: string }[]): string | null {
  const exactos = filas.filter((f) => nombresCasan(f.name, nombre));
  return exactos.length === 1 ? exactos[0].factKey : null;
}

export type ConversionClub = { hechos: HechosPrueba; resumen: Record<string, unknown> };

/** Convierte los documentos de una prueba en un fichero de hechos validado. */
export function convertirPrueba(
  ev: Pick<EventoClub, 'id' | 'paginaUrl' | 'season' | 'nombre' | 'inicio' | 'fin' | 'ciudad'>,
  p: PruebaClub,
  docs: { clasificacion: Documento; poules: Documento | null; cuadro: Documento | null },
): ConversionClub {
  const docId = docIdDeUrl(ev.paginaUrl);
  const clave = `${p.arma}:${p.genero}:${p.formato}:${p.categoria}`;
  const prefijo = `${docId}:${clave}:`;
  const notas: string[] = [`Documentos publicados por el organizador en ${ev.paginaUrl}`, `Clasificación: ${docs.clasificacion.url}`];
  const resumen: Record<string, unknown> = { evento: ev.id, prueba: clave };

  const cl = leerClasificacion(docs.clasificacion.paginas);
  const results: ResultadoHecho[] = cl.filas.map((f: FilaClasificacion) => ({
    factKey: `${prefijo}clas:p${f.pagina}:y${Math.round(f.y)}`,
    name: f.nombre,
    countryCode: f.pais,
    club: f.club,
    position: f.posicion,
    positionRaw: f.posicionRaw,
    points: null,
    fieId: null,
    license: null,
    birthYear: null,
  }));
  const posiciones = results.map((r) => r.position).filter((n): n is number => n !== null);
  const huecosPuesto = posiciones.some((n, i) => i > 0 && n < posiciones[i - 1]);
  let estadoResultados: Estado = results.length === 0 ? 'ilegible' : huecosPuesto || cl.avisos.some((a) => a.startsWith('sin_')) ? 'parcial' : 'completo';
  if (results.length > 0 && posiciones[0] !== 1) estadoResultados = 'parcial';
  resumen.resultados = results.length;

  const bouts: AsaltoHecho[] = [];
  let sinEmparejar = 0;
  const ref = (nombre: string, local: string) => {
    const k = emparejar(nombre, results);
    if (k === null) sinEmparejar += 1;
    return k ?? `${prefijo}${local}`;
  };

  let estadoPoules: Estado = 'sin_resultados';
  if (docs.poules) {
    notas.push(`Poules: ${docs.poules.url}`);
    const lp = leerPoules(docs.poules.paginas);
    const errores = [...lp.avisos];
    let n = 0;
    for (const po of lp.poules) {
      const { asaltos, errores: e } = asaltosDePoule(po, p.maxPoule ?? 5);
      if (e.length > 0) { errores.push(`poule ${po.vuelta}.${po.numero}: ${e.slice(0, 4).join(', ')}`); continue; }
      const ronda = po.vuelta === 1 ? `P${po.numero}` : `V${po.vuelta}P${po.numero}`;
      for (const a of asaltos) {
        bouts.push(ordenar({
          phase: 'POULE', roundKey: ronda,
          aRef: ref(a.a, `poule:${ronda}:${a.a}`), bRef: ref(a.b, `poule:${ronda}:${a.b}`),
          aName: emparejadoNombre(a.a, results), bName: emparejadoNombre(a.b, results), scoreA: a.ta, scoreB: a.tb, winner: a.ganador,
        }));
        n += 1;
      }
    }
    const tiradores = lp.poules.reduce((s, x) => s + x.filas.length, 0);
    resumen.poules = { poules: lp.poules.length, tiradores, asaltos: n, errores };
    estadoPoules = lp.poules.length === 0 ? 'ilegible' : errores.length > 0 ? 'parcial' : 'completo';
    if (errores.length > 0) notas.push(`poules: ${errores.join('; ')}`);
  }

  let estadoCuadro: Estado = 'sin_resultados';
  if (docs.cuadro) {
    notas.push(`Cuadro: ${docs.cuadro.url}`);
    const lc = leerCuadro(docs.cuadro.paginas);
    const errores = [...lc.errores];
    const asaltos = lc.cruces.map((c) => ({ c, b: ordenar({
      phase: 'TABLEAU' as const, roundKey: c.ronda,
      aRef: ref(c.a, `cuadro:${c.ronda}:${c.a}`), bRef: ref(c.b, `cuadro:${c.ronda}:${c.b}`),
      aName: emparejadoNombre(c.a, results), bName: emparejadoNombre(c.b, results),
      scoreA: c.ta, scoreB: c.tb, winner: c.ta === c.tb ? c.ganador : null,
    }) }));
    // Podio: el ganador de la final es el 1.º de la clasificación y el finalista el 2.º.
    const final = lc.cruces.find((c) => c.ronda === 'T2');
    if (final) {
      const g = emparejar(final.ganador === 'A' ? final.a : final.b, results);
      const f = emparejar(final.ganador === 'A' ? final.b : final.a, results);
      const pos = (k: string | null) => results.find((r) => r.factKey === k)?.position ?? null;
      if (pos(g) !== 1 || pos(f) !== 2) errores.push(`podio_no_casa:${pos(g)}/${pos(f)}`);
    } else if (lc.tamano > 0) errores.push('sin_final');
    const maxCuadro = p.maxCuadro ?? (p.formato === 'EQUIPOS' ? 45 : 15);
    for (const { c } of asaltos) if (Math.max(c.ta, c.tb) > maxCuadro) errores.push(`marcador_mayor_que_${maxCuadro}:${c.ronda}`);
    if (errores.length === 0) bouts.push(...asaltos.map((x) => x.b));
    const porRonda: Record<string, number> = {};
    for (const c of lc.cruces) porRonda[c.ronda] = (porRonda[c.ronda] ?? 0) + 1;
    resumen.cuadro = { tamano: lc.tamano, cruces: lc.cruces.length, porRonda, byes: lc.byes, errores, avisos: lc.avisos };
    const sinAsalto = lc.avisos.filter((a) => a.startsWith('sin_asalto') || a.startsWith('tercero:sin_asalto'));
    if (sinAsalto.length > 0) notas.push(`cuadro: ${sinAsalto.length} cruces sin asalto publicado (${sinAsalto.join('; ')})`);
    estadoCuadro = errores.length > 0 ? (lc.cruces.length === 0 ? 'ilegible' : 'parcial') : lc.cruces.length > 0 ? 'completo' : 'ilegible';
    if (errores.length > 0) notas.push(`cuadro no enviado: ${errores.slice(0, 6).join('; ')}`);
  }
  if (sinEmparejar > 0) notas.push(`${sinEmparejar} referencias de asalto sin fila única en la clasificación`);
  resumen.sinEmparejar = sinEmparejar;
  for (const a of cl.avisos) notas.push(`clasificación: ${a}`);
  if (p.notas) notas.push(...p.notas);

  const candidato = {
    version: 1 as const,
    source: 'rfee_pdf' as const,
    extractor: 'lector_pdf',
    sourceUrl: docs.clasificacion.url,
    sourceSha256: docs.clasificacion.sha256,
    edition: { season: ev.season, tournamentKey: `pdf:${docId}`, name: ev.nombre, startDate: ev.inicio, endDate: ev.fin, city: ev.ciudad, countryCode: 'ESP' },
    competition: { competitionKey: `pdf:${docId}:${clave}`, weapon: p.arma, gender: p.genero, category: p.categoria, categoryRaw: p.categoriaRaw, format: p.formato, date: p.fecha },
    status: {
      results: estadoResultados,
      pools: estadoPoules,
      tableau: estadoCuadro,
      publishedParticipants: results.length || null,
      notes: notas,
    },
    results,
    bouts,
  };
  return { hechos: hechosPrueba.parse(candidato), resumen };
}

function emparejadoNombre(nombre: string, results: readonly ResultadoHecho[]): string {
  const k = emparejar(nombre, results);
  return results.find((r) => r.factKey === k)?.name ?? nombre;
}

async function main() {
  const argv = process.argv.slice(2);
  const solo = argv.includes('--solo') ? argv[argv.indexOf('--solo') + 1] : null;
  const sinRed = argv.includes('--sin-red');
  mkdirSync(HECHOS_CLUBES, { recursive: true });
  mkdirSync(HECHOS_CLUBES_EQUIPOS, { recursive: true });
  const escritos = new Set<string>();
  const informe: Record<string, unknown>[] = [];
  for (const ev of EVENTOS) {
    if (solo && ev.id !== solo) continue;
    for (const p of ev.pruebas) {
      try {
        const docs = {
          clasificacion: await documento(p.clasificacion, sinRed),
          poules: p.poules ? await documento(p.poules, sinRed) : null,
          cuadro: p.cuadro ? await documento(p.cuadro, sinRed) : null,
        };
        const { hechos, resumen } = convertirPrueba(ev, p, docs);
        const carpeta = p.formato === 'EQUIPOS' ? HECHOS_CLUBES_EQUIPOS : HECHOS_CLUBES;
        const nombre = ficheroHechos(hechos);
        writeFileSync(join(carpeta, nombre), JSON.stringify(hechos, null, 1), 'utf8');
        escritos.add(join(carpeta, nombre));
        const fila = {
          ...resumen, fichero: join(carpeta, nombre), status: { results: hechos.status.results, pools: hechos.status.pools, tableau: hechos.status.tableau },
          asaltosPoule: hechos.bouts.filter((b) => b.phase === 'POULE').length, asaltosCuadro: hechos.bouts.filter((b) => b.phase === 'TABLEAU').length,
        };
        informe.push(fila);
        console.log(JSON.stringify(argv.includes('--detalle') ? fila : { evento: ev.id, prueba: resumen.prueba, resultados: resumen.resultados, ...fila.status, poule: fila.asaltosPoule, cuadro: fila.asaltosCuadro }));
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        informe.push({ evento: ev.id, prueba: `${p.arma}:${p.genero}:${p.formato}:${p.categoria}`, error });
        console.log(JSON.stringify({ evento: ev.id, error }));
      }
    }
  }
  if (!solo) {
    for (const carpeta of [HECHOS_CLUBES, HECHOS_CLUBES_EQUIPOS]) {
      for (const f of readdirSync(carpeta)) if (f.startsWith('rfee_pdf__') && !escritos.has(join(carpeta, f))) unlinkSync(join(carpeta, f));
    }
    writeFileSync(join(HECHOS_CLUBES, '_informe.json'), JSON.stringify({ generadoEn: new Date().toISOString(), pruebas: informe }, null, 1), 'utf8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
