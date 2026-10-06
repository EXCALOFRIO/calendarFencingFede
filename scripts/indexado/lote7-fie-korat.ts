/**
 * Poules de los Campeonatos de Asia cadetes 2017 (Korat), que la base tiene
 * sin poules, desde el PDF de Engarde que enlaza Ophardt Online (ya en
 * `cache-fie-completar/ophardt-pdf`, con su texto `pdftotext -layout`).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-korat.ts [--db <sqlite>] [--salida <dir>]
 *
 * Cada fila de la matriz trae, tras nombre y nación, una celda por rival (sin
 * la diagonal, que no se imprime): «V» victoria a 5, «V4» victoria con 4,
 * una cifra derrota con esos tocados, «A»/«X» asalto no disputado. Una poule
 * sólo se acepta si TODAS sus filas cuadran con lo que el propio PDF publica:
 * las dos celdas de cada asalto son recíprocas (una victoria, una derrota con
 * menos o igual tocados), y por tirador V/M, indicador (TD − TR) y TD salen
 * de sus asaltos. Lo que no cuadra se descarta entero; nada se interpreta por
 * modelo y las referencias son las `source_fact_key` de la clasificación.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento } from './comun';
import { abrirBase, puestosDeBase, sha256 } from './fie-completar-comun';
import { CARPETA_PDF, INVENTARIO_OPHARDT } from './fie-completar-ophardt';
import { hechosBase } from './fie-completar-otras';
import { anadirAsaltos } from './fie-huecos-asaltos';
import { BASE_LOTE7, objetivos, soloFasesQueFaltan } from './lote7-fie-fww';
import { CARPETA_LOTE7, SALIDA_LOTE7 } from './lote7-fie-red';

type Lectura = Parameters<typeof anadirAsaltos>[1];
type BoutLeido = NonNullable<Lectura['poules']>['bouts'][number];

type Celda = { tipo: 'V'; tocados: number } | { tipo: 'D'; tocados: number } | { tipo: 'nulo' };
type Fila = { nombre: string; pais: string; celdas: Celda[]; vm: number | null; ind: number | null; hs: number | null };

const CELDA = /^(V\d?|\d{1,2}|A|X|E)$/;
const MAX = 5;

function celda(t: string): Celda {
  if (t === 'A' || t === 'X' || t === 'E') return { tipo: 'nulo' };
  if (t.startsWith('V')) return { tipo: 'V', tocados: t.length > 1 ? Number(t.slice(1)) : MAX };
  return { tipo: 'D', tocados: Number(t) };
}

/** Filas de cada «Poule No n» del texto; una línea sin nación continúa la fila anterior. */
export function poulesDeTexto(txt: string): Map<number, Fila[]> {
  const poules = new Map<number, Fila[]>();
  let actual: Fila[] | null = null;
  let pendiente: { nombre: string; pais: string; tokens: string[] } | null = null;
  const cerrar = () => {
    if (!pendiente || !actual) return;
    const tokens = pendiente.tokens.map((t) => t.replace(/‐/g, '-'));
    const i = tokens.findIndex((t) => /^\d\.\d{3}$/.test(t) || t === 'aban' || t === 'excl');
    const celdas = (i < 0 ? tokens : tokens.slice(0, i)).filter((t) => CELDA.test(t)).map(celda);
    const num = (t: string | undefined) => (t !== undefined && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null);
    actual.push({
      nombre: pendiente.nombre, pais: pendiente.pais, celdas,
      vm: i >= 0 ? num(tokens[i]) : null, ind: i >= 0 ? num(tokens[i + 1]) : null, hs: i >= 0 ? num(tokens[i + 2]) : null,
    });
    pendiente = null;
  };
  for (const linea of txt.split(/\r?\n/)) {
    const cab = /^\s*Poule No (\d+)\b/.exec(linea);
    if (cab) {
      cerrar();
      actual = [];
      poules.set(Number(cab[1]), actual);
      continue;
    }
    if (!actual) continue;
    if (/V\/M\s+ind/.test(linea)) {
      cerrar();
      continue;
    }
    const fila = /^\s{3,}(\S.*?\S)\s{2,}([A-Z]{3})\s+(.*)$/.exec(linea);
    if (fila && !CELDA.test(fila[1])) {
      cerrar();
      pendiente = { nombre: fila[1], pais: fila[2], tokens: fila[3].trim().split(/\s+/) };
      continue;
    }
    if (pendiente && linea.trim() && linea.trim().split(/\s+/).every((t) => CELDA.test(t) || /^-?‐?\d+(\.\d+)?$/.test(t))) {
      pendiente.tokens.push(...linea.trim().split(/\s+/));
      continue;
    }
    if (!linea.trim()) {
      cerrar();
      continue;
    }
    // Cualquier otra línea (clasificación tras poules, cuadro, pie) cierra la poule: sus filas son contiguas.
    cerrar();
    actual = null;
  }
  cerrar();
  return poules;
}

/** Asaltos de una poule si toda ella cuadra con lo publicado; `null` y el motivo si no. */
export function asaltosDePoule(filas: Fila[], numero: number): { bouts: BoutLeido[] } | { motivo: string } {
  const n = filas.length;
  if (n < 3 || filas.some((f) => f.celdas.length !== n - 1)) return { motivo: 'celdas_no_cuadran' };
  // Celda de la fila i contra el rival j (la diagonal no se imprime).
  const de = (i: number, j: number) => filas[i].celdas[j < i ? j : j - 1];
  const bouts: BoutLeido[] = [];
  const tot = filas.map(() => ({ v: 0, m: 0, td: 0, tr: 0 }));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = de(i, j);
      const b = de(j, i);
      if (a.tipo === 'nulo' || b.tipo === 'nulo') {
        if (a.tipo !== b.tipo) return { motivo: 'nulo_no_reciproco' };
        continue;
      }
      if (a.tipo === b.tipo) return { motivo: 'dos_victorias_o_derrotas' };
      const [g, p] = a.tipo === 'V' ? [a, b] : [b, a];
      if (g.tocados > MAX || g.tocados < p.tocados) return { motivo: 'marcador_imposible' };
      for (const [k, x, y] of [[i, a, b], [j, b, a]] as const) {
        tot[k].m += 1;
        tot[k].v += x.tipo === 'V' ? 1 : 0;
        tot[k].td += x.tocados;
        tot[k].tr += y.tocados;
      }
      bouts.push({
        phase: 'POULE', roundKey: `P${numero}`, a: { nombre: filas[i].nombre, pais: filas[i].pais }, b: { nombre: filas[j].nombre, pais: filas[j].pais },
        scoreA: a.tocados, scoreB: b.tocados, winner: a.tocados === b.tocados ? (a.tipo === 'V' ? 'A' : 'B') : null,
      });
    }
  }
  for (let i = 0; i < n; i += 1) {
    const f = filas[i];
    const t = tot[i];
    if (t.m === 0) continue;
    if (f.vm === null || f.ind === null || f.hs === null) return { motivo: 'totales_sin_publicar' };
    if (Math.abs(f.vm - t.v / t.m) > 0.0015 || f.hs !== t.td || f.ind !== t.td - t.tr) return { motivo: 'totales_no_cuadran' };
  }
  return { bouts };
}

type Inventario = { pruebas: { season: string; competitionKey: string; pdf?: string }[] };

const plegar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z ]+/g, ' ').trim();
const junto = (s: string) => plegar(s).replace(/ /g, '');
const letras = (s: string) => [...junto(s)].sort().join('');
/** Apellido de la clasificación: las palabras iniciales en mayúsculas («AL ZAHRANI Abdulrhman» → «alzahrani»). */
const apellidoClasificacion = (s: string) => {
  const p = s.trim().split(/\s+/);
  const n = p.findIndex((w) => w !== w.toUpperCase());
  return junto(p.slice(0, n <= 0 ? 1 : n).join(' '));
};
const nombreClasificacion = (s: string) => {
  const p = s.trim().split(/\s+/);
  const n = p.findIndex((w) => w !== w.toUpperCase());
  return plegar(p.slice(n <= 0 ? 1 : n).join(' ')).split(' ').filter(Boolean);
};

function distancia(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let previo = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = t;
    }
  }
  return d[b.length];
}

/**
 * Con el mismo apellido, los nombres de pila deben casar palabra a palabra
 * (igual, uno prefijo del otro o una errata: ≥ 65 % de parecido), y sólo uno
 * de los dos lados puede tener palabras de sobra: «LAU Ho Chuen» no es «LAU Ho Fung».
 */
export function nombresCompatibles(pdf: string[], clasificacion: string[]) {
  if (pdf.length === 0) return true;
  const libres = [...clasificacion];
  let sobranPdf = 0;
  for (const w of pdf) {
    const i = libres.findIndex((c) => c === w || c.startsWith(w) || w.startsWith(c) || 1 - distancia(c, w) / Math.max(c.length, w.length) >= 0.65);
    if (i < 0) sobranPdf += 1;
    else libres.splice(i, 1);
  }
  return sobranPdf < pdf.length && (sobranPdf === 0 || libres.length === 0);
}

/**
 * El PDF de Korat recorta los nombres al ancho de columna, junta o separa
 * palabras y a veces invierte nombre y apellido. Para cada tirador que no
 * casa tal cual con la clasificación se busca, en su nación (o en cualquiera
 * si figura como FIE), una única fila libre que sea: el mismo nombre sin
 * espacios o uno prefijo del otro (≥ 8 letras), las mismas letras
 * reordenadas, o cuyo apellido coincida con la primera palabra del PDF o sea
 * prefijo suyo (≥ 5 letras). La asignación es inyectiva; lo ambiguo no se toca.
 */
export function aliasKorat(pdf: { nombre: string; pais: string }[], clasificacion: { name: string; countryCode: string | null }[]) {
  const exacto = (t: { nombre: string; pais: string }, r: { name: string; countryCode: string | null }) =>
    plegar(t.nombre).split(' ').sort().join(' ') === plegar(r.name).split(' ').sort().join(' ') && r.countryCode === t.pais;
  const tomadas = new Set(clasificacion.filter((r) => pdf.some((t) => exacto(t, r))));
  const sueltos = pdf.filter((t) => !clasificacion.some((r) => exacto(t, r)));
  const nacion = (t: { pais: string }, r: { countryCode: string | null }) => r.countryCode === t.pais || t.pais === 'FIE';
  const fuerte = (t: { nombre: string; pais: string }, r: { name: string; countryCode: string | null }) => {
    if (!nacion(t, r)) return false;
    const a = junto(t.nombre);
    const b = junto(r.name);
    return a === b || (Math.min(a.length, b.length) >= 8 && (a.startsWith(b) || b.startsWith(a))) || (a.length >= 8 && letras(t.nombre) === letras(r.name));
  };
  const encaja = (t: { nombre: string; pais: string }, r: { name: string; countryCode: string | null }) => {
    if (!nacion(t, r)) return false;
    const [cabeza, ...resto] = t.nombre.trim().split(/\s+/);
    const primera = junto(cabeza);
    const ape = apellidoClasificacion(r.name);
    if (primera === ape) return nombresCompatibles(plegar(resto.join(' ')).split(' ').filter(Boolean), nombreClasificacion(r.name));
    return ape.length >= 5 && primera.startsWith(ape);
  };
  const propuestas = new Map<string, { t: { nombre: string; pais: string }; r: { name: string; countryCode: string | null } }>();
  const cuenta = new Map<{ name: string; countryCode: string | null }, number>();
  for (const t of sueltos) {
    const libres = clasificacion.filter((r) => !tomadas.has(r));
    const fuertes = libres.filter((r) => fuerte(t, r));
    const c = fuertes.length ? fuertes : libres.filter((r) => encaja(t, r));
    if (c.length !== 1) continue;
    propuestas.set(`${t.nombre}|${t.pais}`, { t, r: c[0] });
    cuenta.set(c[0], (cuenta.get(c[0]) ?? 0) + 1);
  }
  const alias = new Map<string, { nombre: string; pais: string }>();
  for (const [k, { r }] of propuestas) if (cuenta.get(r) === 1) alias.set(k, { nombre: r.name, pais: r.countryCode ?? '' });
  return alias;
}

export type PuestoGeneral = { puesto: number; nombre: string; pais: string };

/** «Overall ranking (ordered by ranking - N fencers)» del PDF Engarde; null si las filas no suman N. */
export function rankingGeneral(texto: string): PuestoGeneral[] | null {
  const lineas = texto.split(/\r?\n/);
  let declarado: number | null = null;
  let dentro = false;
  const filas: PuestoGeneral[] = [];
  for (const l of lineas) {
    const cab = /Overall ranking \(ordered by ranking - (\d+) fencers\)/.exec(l);
    if (cab) {
      declarado = Number(cab[1]);
      dentro = true;
      continue;
    }
    if (!dentro) continue;
    if (/Document engarde|^\s*\S.*page \d+\/\d+/.test(l)) {
      dentro = false;
      continue;
    }
    const m = /^\s*(\d{1,3})\s{2,}(\S.*?)\s{2,}([A-Z]{3})\s*$/.exec(l);
    if (m) filas.push({ puesto: Number(m[1]), nombre: m[2].trim(), pais: m[3] });
  }
  return declarado !== null && filas.length === declarado ? filas : null;
}

export const PREFIJO_CLAVE_KORAT = 'korat2017_oficial:';

/**
 * Filas del ranking general del PDF que la FIE no publicó. Cada fila FIE debe
 * tener en el PDF su mismo puesto: si el puesto es de un solo tirador casa
 * directamente; en un empate decide la nación y, si aún hay varios, una
 * palabra del nombre en común. Todas las filas FIE deben casar (si no, un
 * tirador saldría dos veces) y la suma tiene que dar el total del PDF.
 * Devuelve también las discrepancias de nación o grafía, que se anotan.
 */
export function filasKoratQueFaltan(general: readonly PuestoGeneral[], resultados: readonly { factKey: string; name: string; countryCode: string | null; position: number | null }[]):
  { filas: HechosPrueba['results']; avisos: string[]; pares: { pdf: PuestoGeneral; fie: { nombre: string; pais: string | null } }[] } | { motivo: string } {
  const libres = new Set(general.map((_, i) => i));
  const avisos: string[] = [];
  const pares: { pdf: PuestoGeneral; fie: { nombre: string; pais: string | null } }[] = [];
  const palabras = (s: string) => new Set(plegar(s).split(' ').filter((w) => w.length >= 3));
  for (const r of resultados) {
    const comun = (i: number) => [...palabras(general[i].nombre)].some((w) => palabras(r.name).has(w));
    let c = [...libres].filter((i) => general[i].puesto === r.position);
    if (c.length > 1) {
      const misma = c.filter((i) => general[i].pais === r.countryCode);
      c = misma.length === 1 ? misma : (misma.length ? misma : c).filter(comun);
    }
    if (c.length !== 1) return { motivo: `fila_fie_sin_casar: ${r.position} ${r.name} ${r.countryCode}` };
    const o = general[c[0]];
    if (o.pais !== r.countryCode && !comun(c[0])) return { motivo: `puesto_con_otro_tirador: ${r.position} ${r.name} ${r.countryCode} / ${o.nombre} ${o.pais}` };
    libres.delete(c[0]);
    pares.push({ pdf: o, fie: { nombre: r.name, pais: r.countryCode } });
    if (o.pais !== r.countryCode) avisos.push(`${r.name}: nación FIE ${r.countryCode}, PDF ${o.pais}`);
    else if (![...palabras(o.nombre)].some((w) => palabras(r.name).has(w))) avisos.push(`${r.name}: en el PDF «${o.nombre}»`);
  }
  const nuevas = [...libres].map((i) => general[i]);
  const claves = nuevas.map((o) => `${PREFIJO_CLAVE_KORAT}${junto(o.nombre)}-${o.pais.toLowerCase()}`);
  if (new Set(claves).size !== claves.length) return { motivo: 'claves_repetidas' };
  return {
    avisos,
    pares,
    filas: nuevas.map((o, i) => ({
      factKey: claves[i], name: o.nombre, countryCode: o.pais, club: null, position: o.puesto, positionRaw: String(o.puesto),
      points: null, fieId: null, license: null, birthYear: null,
    })),
  };
}

function main() {
  const db = abrirBase(argumento('db', BASE_LOTE7));
  const salida = argumento('salida', SALIDA_LOTE7);
  mkdirSync(salida, { recursive: true });
  const inv = JSON.parse(readFileSync(INVENTARIO_OPHARDT, 'utf8')) as Inventario;
  const informe: Record<string, unknown>[] = [];
  let escritos = 0;
  for (const p of objetivos(db).filter((x) => x.season === '2017' && /asiatiques cadets/i.test(x.editionName) && x.poule === 0)) {
    const x = inv.pruebas.find((e) => e.season === p.season && e.competitionKey === p.competitionKey);
    const txt = join(CARPETA_PDF, `${p.season}-${p.competitionKey}.txt`);
    const pdf = join(CARPETA_PDF, `${p.season}-${p.competitionKey}.pdf`);
    if (!x?.pdf || !existsSync(txt) || !existsSync(pdf)) {
      informe.push({ season: p.season, competitionKey: p.competitionKey, motivo: 'sin PDF/texto en caché' });
      continue;
    }
    const poules = poulesDeTexto(readFileSync(txt, 'utf8'));
    const bouts: BoutLeido[] = [];
    const descartados: Record<string, number> = {};
    let esperados = 0;
    for (const [numero, filas] of poules) {
      esperados += (filas.length * (filas.length - 1)) / 2;
      const r = asaltosDePoule(filas, numero);
      if ('motivo' in r) descartados[`P${numero}:${r.motivo}`] = 1;
      else bouts.push(...r.bouts);
    }
    const puestos = puestosDeBase(db, p.id);
    const fie = hechosBase(p, puestos);
    // Si la FIE publicó menos filas que el ranking general del PDF se añaden las que faltan; el fichero
    // trae todas las filas previas sin cambios, así que el cargador lo aplica como `completo` sin borrar.
    const general = rankingGeneral(readFileSync(txt, 'utf8'));
    const extension = general && general.length >= fie.results.length ? filasKoratQueFaltan(general, fie.results) : null;
    const base = extension && 'filas' in extension && extension.filas.length > 0
      ? hechosPrueba.parse({
        ...fie,
        status: {
          ...fie.status, results: 'completo', publishedParticipants: general!.length,
          notes: [`Clasificación: ${fie.results.length} filas FIE sin cambios y ${extension!.filas.length} del ranking general del PDF Engarde (${x.pdf}), claves ${PREFIJO_CLAVE_KORAT}<nombre>-<nación>; identidad por nombre y nación (el PDF no da ID FIE)${extension.avisos.length ? `; FIE y el PDF difieren (se conserva el dato FIE): ${extension.avisos.join('; ')}` : ''}`],
        },
        results: [...fie.results, ...extension.filas],
      })
      : fie;
    const tiradores = [...new Map(poules.size ? [...poules.values()].flat().map((f) => [`${f.nombre}|${f.pais}`, { nombre: f.nombre, pais: f.pais }]) : []).values()];
    const alias = aliasKorat(tiradores, base.results);
    // El ranking general del PDF usa la misma grafía que sus poules: su pareja FIE por puesto manda.
    const porPdf = new Map(extension && 'pares' in extension
      ? extension.pares.map((x) => [`${plegar(x.pdf.nombre)}|${x.pdf.pais}`, { nombre: x.fie.nombre, pais: x.fie.pais ?? '' }]) : []);
    // Las matrices de poule recortan el nombre al ancho de columna («SAHARUDIN Ahmad H»).
    const porPrefijo = (t: { nombre: string; pais: string | null }) => {
      const n = plegar(t.nombre);
      if (n.length < 8 || !extension || !('pares' in extension)) return undefined;
      const c = extension.pares.filter((x) => x.pdf.pais === t.pais && plegar(x.pdf.nombre).startsWith(n));
      return c.length === 1 ? { nombre: c[0].fie.nombre, pais: c[0].fie.pais ?? '' } : undefined;
    };
    const renombrar = (t: { nombre: string; pais: string | null }) =>
      porPdf.get(`${plegar(t.nombre)}|${t.pais}`) ?? alias.get(`${t.nombre}|${t.pais}`) ?? porPrefijo(t) ?? t;
    for (const b of bouts) {
      b.a = renombrar(b.a);
      b.b = renombrar(b.b);
    }
    const r = anadirAsaltos(base, { arma: null, genero: null, puestos: [], poules: { bouts, esperados, descartados }, cuadro: null }, {
      nombre: 'pdf_ophardt_engarde', url: x.pdf,
      descripcion: 'matrices de poule del PDF Engarde enlazado por Ophardt, leídas del texto y validadas con V/M, indicador y TD publicados',
    });
    const h = soloFasesQueFaltan(hechosPrueba.parse({
      ...r.hechos, extractor: base === fie ? 'lote7_pdf_matriz' : 'lote7_pdf_matriz_oficial', sourceUrl: x.pdf, sourceSha256: sha256(new Uint8Array(readFileSync(pdf))),
      status: { ...r.hechos.status, pools: Object.keys(descartados).length === 0 && r.hechos.status.pools === 'completo' ? 'completo' : 'parcial' },
    }), p);
    const fila = {
      season: p.season, competitionKey: p.competitionKey, poules: poules.size, aceptadas: poules.size - Object.keys(descartados).length,
      importados: h.bouts.length, esperados, descartados, refs: r.informe.pools.descartados, alias: Object.fromEntries([...alias].map(([k, v]) => [k, `${v.nombre} (${v.pais})`])), sinCasar: r.informe.tiradores.sinCasar,
      clasificacion: {
        fie: fie.results.length, pdf: general?.length ?? null, anadidas: base.results.length - fie.results.length, estado: h.status.results,
        avisos: extension && 'avisos' in extension ? extension.avisos : [], motivo: extension && 'motivo' in extension ? extension.motivo : null,
      },
    };
    informe.push(fila);
    if (h.bouts.length === 0) continue;
    writeFileSync(join(salida, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
    escritos += 1;
  }
  db.close();
  writeFileSync(join(CARPETA_LOTE7, 'korat-informe.json'), `${JSON.stringify({ generado: new Date().toISOString(), escritos, pruebas: informe }, null, 1)}\n`);
  for (const i of informe) console.log(JSON.stringify(i));
  console.log(`${escritos} ficheros en ${salida}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
