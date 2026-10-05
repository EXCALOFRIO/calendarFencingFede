/**
 * Convierte los ficheros Engarde de la web antigua de la RFEE (descargados de
 * la Wayback Machine por `rfee-wayback-descargar.ts`) al formato común de
 * hechos, sin red.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/rfee-wayback-a-hechos.ts \
 *     [--entrada <calendario-trabajo/rfee-wayback>] [--salida <calendario-trabajo/hechos/rfee-wayback>] \
 *     [--7z <ruta a 7z.exe>]
 *
 * 1. Descomprime cada `raw/<id>.zip|rar` en `ex/<id>` con 7-Zip (también los
 *    archivos anidados), si no está ya descomprimido.
 * 2. Cada carpeta con `competition.egw` y `tireur.txt` legibles es una unidad
 *    (Engarde 9 cifra los ficheros: esas no se leen). Las pruebas por equipos,
 *    las repescas y las copias de seguridad (`-SVG`) no se convierten.
 * 3. Las unidades de la misma prueba (copias en varios archivos, subcompeticiones
 *    `-AUX`, 1ª fase y fase final) se agrupan: misma arma, sexo y categoría,
 *    fechas a ±3 días y la mayoría de los tiradores en común.
 * 4. Por grupo, una prueba: puestos con la regla de Engarde (fase final, y
 *    debajo los eliminados de cada fase anterior), asaltos de poule y de cuadro.
 *
 * Claves: edición `rfee-wayback:<idc>-<id>` de la ficha del calendario que
 * enlaza el archivo (o `rfee-wayback:archivo-<id>`), prueba
 * `rfee-wayback:<id archivo>/<título reducido>`, participante `lic:<licencia>`
 * si Engarde la trae o `engarde:<nombre normalizado>|<club>`. De la fecha de
 * nacimiento sólo se guarda el año.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import {
  ficheroHechos,
  hechosPrueba,
  type AsaltoHecho,
  type HechosPrueba,
  type ResultadoHecho,
} from '../../src/lib/ingest/hechos/formato';
import {
  asaltosDeCuadro,
  clasificarUnidad,
  decodificarEngarde,
  leerUnidad,
  type AsaltoNativo,
  type Tirador,
  type UnidadEngarde,
} from '../../src/lib/ingest/sources/engarde-nativo';
import { argumento, CARPETA_TRABAJO } from './comun';
import type { Manifiesto } from './rfee-wayback-descargar';

type Categoria = HechosPrueba['competition']['category'];
type Estado = HechosPrueba['status']['results'];

const SIETE_ZIP = 'C:\\Program Files\\7-Zip\\7z.exe';

/* ------------------------------------------------------------ extracción */

function descomprimir(raw: string, ex: string, sieteZip: string): { nuevos: number; errores: string[] } {
  const errores: string[] = [];
  let nuevos = 0;
  const extraer = (archivo: string, destino: string) => {
    // `-pnone`: un archivo con contraseña falla en vez de quedarse esperando a que se escriba.
    const r = spawnSync(sieteZip, ['x', '-y', '-pnone', `-o${destino}`, archivo], { timeout: 120_000, stdio: 'ignore' });
    if (r.status !== 0) errores.push(`${relative(raw, archivo)}: ${r.error?.message ?? `7z ${r.status}`}`);
  };
  for (const f of readdirSync(raw).filter((x) => /^\d+\.(zip|rar)$/i.test(x)).sort()) {
    const destino = join(ex, f.replace(/\.\w+$/, ''));
    if (existsSync(destino)) continue;
    extraer(join(raw, f), destino);
    nuevos += 1;
  }
  for (let ronda = 0; ronda < 3; ronda += 1) {
    const anidados: string[] = [];
    const recorrer = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) recorrer(p);
        else if (/\.(zip|rar|7z)$/i.test(e.name) && !existsSync(`${p}__x`)) anidados.push(p);
      }
    };
    recorrer(ex);
    if (anidados.length === 0) break;
    for (const p of anidados) extraer(p, `${p}__x`);
  }
  return { nuevos, errores };
}

/* ---------------------------------------------------------------- fichas */

export type Ficha = {
  clave: string;
  titulo: string | null;
  inicio: string | null;
  fin: string | null;
  municipio: string | null;
  archivos: string[];
};

const fechaEs = (s: string | undefined) => {
  const m = s?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
const textoPlano = (s: string) =>
  s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Ficha `ampliar_calendario.asp` de la web antigua: título, fechas, municipio y archivos enlazados. */
export function leerFicha(html: string, clave: string): Ficha {
  const titulo = html.match(/font-size:17px[^>]*>([\s\S]*?)<\/td>/i)?.[1];
  const campo = (etiqueta: string) => html.match(new RegExp(`${etiqueta}:?\\s*</strong>([^<]*)`, 'i'))?.[1]?.trim() || null;
  return {
    clave,
    titulo: titulo ? textoPlano(titulo) || null : null,
    inicio: fechaEs(campo('Fecha Inicio') ?? undefined),
    fin: fechaEs(campo('Fecha Fin') ?? undefined),
    municipio: campo('Municipio'),
    archivos: [...html.matchAll(/href="calendario\/(\d+)\.(zip|rar)"/gi)].map((m) => m[1]),
  };
}

const capital = (s: string | null) =>
  s ? s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) : null;

/* ------------------------------------------------------------- categoría */

const CATEGORIA_TITULO: [RegExp, Categoria][] = [
  [/\bveteran|\bvet\b/, 'VET'],
  [/\babsolut|\bsenior|\babs\b|\bm-?23\b|\bsub-?23\b/, 'ABS'],
  [/\bjunior|\bm-?20\b|\bu-?20\b|\bsub-?20\b|\bjr\b/, 'M20'],
  [/\bcadet|\bm-?17\b|\bu-?17\b|\bsub-?17\b/, 'M17'],
  [/\binfantil|\bm-?15\b|\bu-?15\b|\bsub-?15\b/, 'M15'],
  [/\bm-?14\b|\bu-?14\b/, 'M14'],
  [/\balevin|\bm-?13\b|\bu-?13\b/, 'M13'],
  [/\bm-?12\b|\bu-?12\b/, 'M12'],
  [/\bm-?11\b|\bu-?11\b/, 'M11'],
  [/\bbenjamin|\bm-?10\b|\bu-?10\b/, 'M10'],
  [/\bm-?9\b|\bu-?9\b/, 'M9'],
];

/** Engarde usa las categorías francesas; en España minime era infantil (M15), benjamin alevín (M13). */
const CATEGORIA_ENGARDE: Record<string, Categoria> = {
  veteran: 'VET', senior: 'ABS', junior: 'M20', cadet: 'M17', minime: 'M15', benjamin: 'M13', pupille: 'M11', poussin: 'M9',
};

const sinAcentos = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Categoría: la que nombran los títulos si es una sola (los organizadores
 * escribían «M-15» aunque eligieran otra categoría de Engarde); si no, la de Engarde.
 */
export function categoriaDe(textos: readonly (string | null)[], engarde: string | null): Categoria | null {
  for (const t of textos) {
    if (!t) continue;
    const s = sinAcentos(t).replace(/_/g, ' ');
    const halladas = new Set(CATEGORIA_TITULO.filter(([re]) => re.test(s)).map(([, c]) => c));
    // «ABS» suele acompañar a otra categoría en las fases nacionales («M-23 ABS»).
    if (halladas.size === 2 && halladas.has('ABS')) halladas.delete('ABS');
    if (halladas.size === 1) return [...halladas][0];
  }
  return engarde ? (CATEGORIA_ENGARDE[engarde] ?? null) : null;
}

export function temporadaRfee(fecha: string): string {
  const a = Number(fecha.slice(0, 4));
  const m = Number(fecha.slice(5, 7));
  return m >= 9 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}

/* ---------------------------------------------------------------- unidades */

export type Unidad = {
  archivo: string;
  ruta: string;
  u: UnidadEngarde;
  categoria: Categoria | null;
  presentes: Set<string>;
  /** Nombres normalizados de los que siguen en competición al acabar la unidad (pasan a otra fase). */
  supervivientes: Set<string>;
  asaltosPoule: number;
  asaltosCuadro: number;
};

function leerCarpeta(d: string): Map<string, string> {
  const f = new Map<string, string>();
  for (const x of readdirSync(d)) {
    if (!/\.(txt|egw)$/i.test(x)) continue;
    const p = join(d, x);
    if (statSync(p).isFile()) f.set(x.toLowerCase(), decodificarEngarde(readFileSync(p)));
  }
  return f;
}

const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);

function solapes(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

/** `x` es una fase previa de `y`: casi todos los que siguen en competición al acabar `x` tiran `y`. */
export function precede(x: Pick<Unidad, 'supervivientes' | 'presentes'>, y: Pick<Unidad, 'presentes'>): boolean {
  const s = x.supervivientes.size;
  if (s < 2 || s >= x.presentes.size) return false;
  return solapes(x.supervivientes, y.presentes) >= 0.8 * s;
}

/**
 * Misma prueba: atributos compatibles, fechas a ±3 días y, o la mayoría de los
 * tiradores del menor en el mayor (copias), o una es fase previa de la otra en
 * el mismo archivo (1ª fase y fase final, con cabezas de serie exentos).
 */
export function mismaPrueba(x: Unidad, y: Unidad): boolean {
  if (x.u.meta.arma !== y.u.meta.arma || x.u.meta.sexo !== y.u.meta.sexo) return false;
  if (x.categoria && y.categoria && x.categoria !== y.categoria) return false;
  const fx = x.u.meta.fecha;
  const fy = y.u.meta.fecha;
  if (fx && fy && Math.abs(dia(fx) - dia(fy)) > 3) return false;
  const menor = Math.min(x.presentes.size, y.presentes.size);
  if (menor < 4) return false;
  if (solapes(x.presentes, y.presentes) / menor >= 0.7) return true;
  return x.archivo === y.archivo && (precede(x, y) || precede(y, x));
}

/** Copias de una misma fase: casi los mismos tiradores. */
export function copiasDe(unidades: Unidad[]): Unidad[][] {
  const fases: Unidad[][] = [];
  const orden = [...unidades].sort((a, b) => b.presentes.size - a.presentes.size || (a.archivo < b.archivo ? -1 : 1));
  for (const u of orden) {
    const f = fases.find((g) => {
      const r = g[0];
      const comunes = solapes(u.presentes, r.presentes);
      return comunes / (u.presentes.size + r.presentes.size - comunes) >= 0.85;
    });
    if (f) f.push(u);
    else fases.push([u]);
  }
  return fases;
}

/**
 * Niveles de fases a partir de la final: `[[final], [fases previas a la final], ...]`.
 * La final es la fase que no precede a ninguna otra (si hay varias, la de más asaltos);
 * las que no se enlazan con ningún nivel quedan en `sueltas`.
 */
export function nivelesDe(fases: Unidad[]): { niveles: Unidad[][]; sueltas: Unidad[] } {
  const sinSucesor = fases.filter((f) => !fases.some((g) => g !== f && precede(f, g)));
  const candidatas = sinSucesor.length ? sinSucesor : fases;
  const final = [...candidatas].sort((a, b) => peso(b) - peso(a) || b.presentes.size - a.presentes.size)[0];
  const niveles: Unidad[][] = [[final]];
  const usadas = new Set([final]);
  for (;;) {
    const actual = niveles[niveles.length - 1];
    const previas = fases.filter((f) => !usadas.has(f) && actual.some((g) => precede(f, g)));
    if (previas.length === 0) break;
    for (const f of previas) usadas.add(f);
    niveles.push(previas.sort((a, b) => b.presentes.size - a.presentes.size || (a.ruta < b.ruta ? -1 : 1)));
  }
  return { niveles, sueltas: fases.filter((f) => !usadas.has(f)) };
}

const peso = (u: Unidad) => u.asaltosPoule + u.asaltosCuadro;

/* --------------------------------------------------------------- conversión */

type Identidad = { clave: string; tirador: Tirador };

/** Claves de participante de un grupo: licencia si es única, si no nombre normalizado y club. */
function identidades(unidades: Unidad[]): (u: Unidad, cle: string) => Identidad | null {
  const licenciasDeNombre = new Map<string, Set<string>>();
  const nombresDeLicencia = new Map<string, Set<string>>();
  for (const x of unidades) {
    for (const t of x.u.tiradores.values()) {
      const n = normalizeSportName(t.nombre);
      if (!n || !t.licencia) continue;
      (licenciasDeNombre.get(n) ?? licenciasDeNombre.set(n, new Set()).get(n)!).add(t.licencia);
      (nombresDeLicencia.get(t.licencia) ?? nombresDeLicencia.set(t.licencia, new Set()).get(t.licencia)!).add(n);
    }
  }
  return (x, cle) => {
    const t = x.u.tiradores.get(cle);
    if (!t) return null;
    const n = normalizeSportName(t.nombre);
    if (!n) return null;
    const lic = t.licencia && nombresDeLicencia.get(t.licencia)?.size === 1 ? t.licencia : null;
    const delNombre = licenciasDeNombre.get(n);
    const unica = delNombre?.size === 1 ? [...delNombre][0] : null;
    if (lic) return { clave: `lic:${lic}`, tirador: t };
    if (unica && nombresDeLicencia.get(unica)?.size === 1) return { clave: `lic:${unica}`, tirador: t };
    return { clave: `engarde:${n}|${t.club ?? t.nacion ?? ''}`, tirador: t };
  };
}

export type Conversion = { ok: true; hechos: HechosPrueba } | { ok: false; motivo: string };

export type Contexto = {
  ficha: Ficha | null;
  archivo: string;
  sourceUrl: string;
  sha256: string;
};

export function convertirGrupo(unidades: Unidad[], ctx: Contexto): Conversion {
  const reps = copiasDe(unidades).map((f) => [...f].sort((a, b) => peso(b) - peso(a) || (a.archivo < b.archivo ? -1 : 1))[0]);
  const { niveles, sueltas } = nivelesDe(reps);
  const base = niveles[0][0];
  const meta = base.u.meta;
  const categoria = base.categoria ?? unidades.find((x) => x.categoria)?.categoria ?? null;
  if (!meta.arma || !meta.sexo || !categoria) return { ok: false, motivo: 'atributos_incompletos' };
  const usadas = niveles.flat();
  const ident = identidades(usadas);
  const notas: string[] = [];

  // Puestos: la fase final manda; debajo, los eliminados de cada fase anterior.
  // Si una fase previa se tiró en grupos paralelos no hay orden entre grupos: sin puesto.
  const resultados = new Map<string, ResultadoHecho>();
  let colocados = 0;
  let completa = true;
  let fiables = true;
  for (let n = 0; n < niveles.length; n += 1) {
    const nivel = niveles[n];
    if (nivel.length > 1) {
      fiables = false;
      notas.push(`Fase previa en ${nivel.length} grupos: sus eliminados quedan sin puesto final`);
    }
    const nuevos: { p: ReturnType<typeof clasificarUnidad>['puestos'][number]; id: Identidad; grupo: number }[] = [];
    nivel.forEach((x, grupo) => {
      const c = clasificarUnidad(x.u, { poulesSonFinal: niveles.length === 1 });
      if (n === 0 && !c.completa) completa = false;
      // Si la fase final no acaba (falta la final), los que siguen en ella van por delante sin puesto.
      if (n === 0) colocados += c.supervivientes.length;
      if (n > 0 && c.supervivientes.some((s) => {
        const id = ident(x, s);
        return id && !resultados.has(id.clave);
      })) completa = false;
      for (const p of c.puestos) {
        const id = ident(x, p.cle);
        if (id && !resultados.has(id.clave) && !nuevos.some((e) => e.id.clave === id.clave)) nuevos.push({ p, id, grupo });
      }
    });
    const conPuesto = nuevos.filter((e) => e.p.posicion !== null);
    for (const e of nuevos) {
      const t = e.id.tirador;
      let posicion: number | null = null;
      let raw = e.p.posicionRaw;
      if (e.p.posicion !== null && fiables) {
        const mejores = conPuesto.filter((o) => o.p.posicion! < e.p.posicion!).length;
        posicion = colocados + 1 + mejores;
        raw = String(posicion);
      } else if (e.p.posicion !== null) {
        raw = `Eliminado en fase previa (${e.p.posicion}º de su grupo)`;
      }
      resultados.set(e.id.clave, {
        factKey: e.id.clave,
        name: t.nombre,
        countryCode: t.nacion && /^[A-Z]{3}$/.test(t.nacion) ? t.nacion : null,
        club: t.club,
        position: posicion,
        positionRaw: raw,
        points: null,
        fieId: null,
        license: t.licencia,
        birthYear: t.anioNacimiento,
      });
    }
    colocados += conPuesto.length;
  }
  if (!fiables) completa = false;
  if (usadas.length > 1) notas.push(`Prueba en ${niveles.length} fases (${[...usadas].reverse().map((r) => r.ruta.split('/').pop()).join(' | ')})`);
  if (sueltas.length) notas.push(`Unidades sin enlazar con la fase final, no importadas: ${sueltas.map((r) => r.ruta.split('/').pop()).join(' | ')}`);

  // Asaltos, de la primera fase a la final: vuelta de poules acumulada entre fases y,
  // en grupos paralelos, numeración de poules seguida.
  const asaltos: AsaltoHecho[] = [];
  let vueltaBase = 0;
  let esperadosPoule = 0;
  let sinResultadoPoule = 0;
  let cuadroIncompleto = false;
  let sinRef = 0;
  const anadir = (x: Unidad, b: AsaltoNativo, fase: 'POULE' | 'TABLEAU', ronda: string) => {
    const a = ident(x, b.a);
    const c = ident(x, b.b);
    if (!a || !c || a.clave === c.clave) {
      sinRef += 1;
      return;
    }
    asaltos.push({
      phase: fase, roundKey: ronda, aRef: a.clave, bRef: c.clave, aName: a.tirador.nombre, bName: c.tirador.nombre,
      scoreA: Math.min(b.tocadosA, 45), scoreB: Math.min(b.tocadosB, 45), winner: b.tocadosA === b.tocadosB ? b.ganador : null,
    });
  };
  for (const nivel of [...niveles].reverse()) {
    let vueltasNivel = 0;
    const pouleBase = new Map<number, number>();
    for (const x of nivel) {
      const vueltas = [...new Set(x.u.poules.map((p) => p.vuelta))].sort((a, b) => a - b);
      vueltasNivel = Math.max(vueltasNivel, vueltas.length);
      const maximo = new Map<number, number>();
      for (const { vuelta, poule } of x.u.poules) {
        const v = vueltaBase + vueltas.indexOf(vuelta) + 1;
        const numero = (pouleBase.get(v) ?? 0) + poule.numero;
        maximo.set(v, Math.max(maximo.get(v) ?? 0, numero));
        const prefijo = v <= 1 ? 'P' : `V${v}P`;
        esperadosPoule += poule.esperados;
        sinResultadoPoule += poule.sinResultado;
        for (const b of poule.asaltos) anadir(x, b, 'POULE', `${prefijo}${numero}`);
      }
      for (const [v, m] of maximo) pouleBase.set(v, m);
      for (const b of asaltosDeCuadro(x.u)) anadir(x, b, 'TABLEAU', b.ronda);
      if (clasificarUnidad(x.u).cuadroIncompleto) cuadroIncompleto = true;
      if (x.u.otrasSuites.length) notas.push(`Cuadros de clasificación o repesca no importados: ${x.u.otrasSuites.join(', ')}`);
    }
    vueltaBase += vueltasNivel;
  }
  // Un asalto repetido entre fases (misma pareja y ronda) se queda una vez.
  const vistos = new Set<string>();
  const unicos = asaltos.filter((b) => {
    const k = `${b.phase}|${b.roundKey}|${[b.aRef, b.bRef].sort().join('|')}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });

  const res = [...resultados.values()].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
  const nPoule = unicos.filter((b) => b.phase === 'POULE').length;
  const nCuadro = unicos.length - nPoule;
  if (res.length === 0 && unicos.length === 0) return { ok: false, motivo: 'sin_hechos' };
  const estadoResultados: Estado = res.length === 0 ? 'sin_resultados' : completa ? 'completo' : 'parcial';
  if (estadoResultados === 'parcial') notas.push('Clasificación incompleta: la final no está decidida o falta alguna fase');
  if (estadoResultados === 'sin_resultados') notas.push('Los ficheros no permiten calcular puestos');
  const estadoPoules: Estado = nPoule === 0 ? 'sin_resultados' : sinResultadoPoule === 0 && sinRef === 0 ? 'completo' : 'parcial';
  if (estadoPoules === 'parcial') notas.push(`Poules: ${nPoule} asaltos de ${esperadosPoule} posibles`);
  const estadoCuadro: Estado = nCuadro === 0 ? 'sin_resultados' : cuadroIncompleto || sinRef > 0 ? 'parcial' : 'completo';
  if (estadoCuadro === 'parcial') notas.push('Cuadro con rondas sin decidir o tiradores sin identificar');
  notas.push('Puestos calculados con la regla de Engarde a partir de poules y cuadro');

  const fechas = usadas.map((x) => x.u.meta.fecha).filter((f): f is string => !!f).sort();
  const fecha = fechas[0] ?? ctx.ficha?.inicio ?? null;
  if (!fecha) return { ok: false, motivo: 'sin_fecha' };
  const titulo = meta.titulo ?? meta.campeonato ?? meta.tituloReducido ?? basename(base.ruta);
  const clavePrueba = (meta.tituloReducido ?? basename(base.ruta)).replace(/\s+/g, '_');
  const h: HechosPrueba = {
    version: 1,
    source: 'engarde',
    extractor: 'lector_engarde_nativo',
    sourceUrl: ctx.sourceUrl,
    sourceSha256: ctx.sha256,
    edition: {
      season: temporadaRfee(fecha),
      tournamentKey: ctx.ficha ? `rfee-wayback:${ctx.ficha.clave}` : `rfee-wayback:archivo-${ctx.archivo}`,
      name: ctx.ficha?.titulo ?? meta.campeonato ?? titulo,
      startDate: ctx.ficha?.inicio ?? fecha,
      endDate: ctx.ficha?.fin ?? fechas[fechas.length - 1] ?? fecha,
      city: capital(ctx.ficha?.municipio ?? null),
      countryCode: 'ESP',
    },
    competition: {
      competitionKey: `rfee-wayback:${ctx.archivo}/${clavePrueba}`,
      weapon: meta.arma,
      gender: meta.sexo,
      category: categoria,
      categoryRaw: titulo,
      format: 'INDIVIDUAL',
      date: fecha,
    },
    status: { results: estadoResultados, pools: estadoPoules, tableau: estadoCuadro, publishedParticipants: null, notes: notas },
    results: res,
    bouts: unicos,
  };
  return { ok: true, hechos: hechosPrueba.parse(h) };
}

/* -------------------------------------------------------------------- main */

export type InformeRfeeWayback = {
  generado: string;
  archivos: { descargados: number; descomprimidos: number; erroresExtraccion: string[]; conUnidades: number };
  fichas: { leidas: number; conArchivo: number };
  unidades: { carpetas: number; leidas: number; descartadas: Record<string, number> };
  grupos: number;
  ficheros: number;
  descartados: Record<string, number>;
  porTemporada: Record<string, number>;
  resultados: number;
  conLicencia: number;
  conAnioNacimiento: number;
  asaltos: { POULE: number; TABLEAU: number };
  estados: Record<string, Record<string, number>>;
};

function main(): void {
  const entrada = argumento('entrada', join(CARPETA_TRABAJO, 'rfee-wayback'));
  const salida = argumento('salida', join(CARPETA_TRABAJO, 'hechos', 'rfee-wayback'));
  const raw = join(entrada, 'raw');
  const ex = join(entrada, 'ex');
  mkdirSync(ex, { recursive: true });
  mkdirSync(salida, { recursive: true });
  const manifiesto: Manifiesto = JSON.parse(readFileSync(join(entrada, 'manifiesto.json'), 'utf8'));
  const extraccion = descomprimir(raw, ex, argumento('7z', SIETE_ZIP));

  const fichas = new Map<string, Ficha>();
  const fichaDeArchivo = new Map<string, Ficha>();
  for (const f of readdirSync(raw).filter((x) => /^ficha-\d+-\d+\.html$/.test(x)).sort()) {
    const clave = f.slice(6, -5);
    const ficha = leerFicha(decodificarEngarde(readFileSync(join(raw, f))), clave);
    fichas.set(clave, ficha);
    for (const a of ficha.archivos) if (!fichaDeArchivo.has(a)) fichaDeArchivo.set(a, ficha);
  }

  const inf: InformeRfeeWayback = {
    generado: new Date().toISOString(),
    archivos: { descargados: readdirSync(raw).filter((x) => /^\d+\.(zip|rar)$/i.test(x)).length, descomprimidos: extraccion.nuevos, erroresExtraccion: extraccion.errores, conUnidades: 0 },
    fichas: { leidas: fichas.size, conArchivo: [...fichas.values()].filter((f) => f.archivos.length).length },
    unidades: { carpetas: 0, leidas: 0, descartadas: {} },
    grupos: 0, ficheros: 0, descartados: {}, porTemporada: {}, resultados: 0, conLicencia: 0, conAnioNacimiento: 0,
    asaltos: { POULE: 0, TABLEAU: 0 }, estados: {},
  };
  const descartarUnidad = (m: string) => (inf.unidades.descartadas[m] = (inf.unidades.descartadas[m] ?? 0) + 1);

  const unidades: Unidad[] = [];
  const archivosConUnidades = new Set<string>();
  for (const archivo of readdirSync(ex).filter((x) => /^\d+$/.test(x)).sort((a, b) => Number(a) - Number(b))) {
    const recorrer = (d: string) => {
      const nombres = readdirSync(d, { withFileTypes: true });
      if (nombres.some((e) => e.isFile() && e.name.toLowerCase() === 'competition.egw')) {
        inf.unidades.carpetas += 1;
        const ruta = relative(ex, d).replace(/\\/g, '/');
        if (/-SVG/i.test(ruta)) descartarUnidad('copia_seguridad');
        else if (/repesca|repechage/i.test(ruta)) descartarUnidad('repesca');
        else {
          const l = leerUnidad(leerCarpeta(d));
          if (!l.ok) descartarUnidad(l.motivo);
          else if (l.unidad.meta.individual === false || (l.unidad.meta.individual === null && nombres.some((e) => e.name.toLowerCase() === 'equipe.txt'))) {
            descartarUnidad('equipos');
          } else {
            const u = l.unidad;
            const presentes = new Set([...u.tiradores.values()].filter((t) => t.presente).map((t) => normalizeSportName(t.nombre)));
            const supervivientes = new Set(clasificarUnidad(u).supervivientes.map((c) => normalizeSportName(u.tiradores.get(c)?.nombre ?? '')).filter(Boolean));
            const textos = [u.meta.titulo, u.meta.campeonato, ...u.meta.titulos, u.meta.tituloReducido, ruta, fichaDeArchivo.get(archivo)?.titulo ?? null];
            unidades.push({
              archivo, ruta, u, presentes, supervivientes, categoria: categoriaDe(textos, u.meta.categoria),
              asaltosPoule: u.poules.reduce((s, p) => s + p.poule.asaltos.length, 0),
              asaltosCuadro: asaltosDeCuadro(u).length,
            });
            archivosConUnidades.add(archivo);
            inf.unidades.leidas += 1;
          }
        }
      }
      for (const e of nombres) if (e.isDirectory()) recorrer(join(d, e.name));
    };
    recorrer(join(ex, archivo));
  }
  inf.archivos.conUnidades = archivosConUnidades.size;

  // Grupos por unión de pares compatibles.
  const padre = unidades.map((_, i) => i);
  const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const porArma = new Map<string, number[]>();
  unidades.forEach((u, i) => {
    const k = `${u.u.meta.arma}|${u.u.meta.sexo}`;
    (porArma.get(k) ?? porArma.set(k, []).get(k)!).push(i);
  });
  for (const ids of porArma.values()) {
    for (let a = 0; a < ids.length; a += 1) {
      for (let b = a + 1; b < ids.length; b += 1) {
        if (mismaPrueba(unidades[ids[a]], unidades[ids[b]])) padre[raiz(ids[a])] = raiz(ids[b]);
      }
    }
  }
  const grupos = new Map<number, Unidad[]>();
  unidades.forEach((u, i) => (grupos.get(raiz(i)) ?? grupos.set(raiz(i), []).get(raiz(i))!).push(u));
  inf.grupos = grupos.size;

  const escritos = new Set<string>();
  const sha = new Map<string, string>();
  for (const g of grupos.values()) {
    // El archivo de referencia: el de menor id que enlaza una ficha; si ninguno, el de menor id.
    const archivos = [...new Set(g.map((x) => x.archivo))].sort((a, b) => Number(a) - Number(b));
    const archivo = archivos.find((a) => fichaDeArchivo.has(a)) ?? archivos[0];
    const fichero = readdirSync(raw).find((x) => x.startsWith(`${archivo}.`) && /\.(zip|rar)$/i.test(x))!;
    const m = manifiesto[fichero];
    if (!sha.has(fichero)) sha.set(fichero, createHash('sha256').update(readFileSync(join(raw, fichero))).digest('hex'));
    const r = convertirGrupo(g, {
      ficha: fichaDeArchivo.get(archivo) ?? null,
      archivo,
      sourceUrl: `https://web.archive.org/web/${m.timestamp}id_/${m.original}`,
      sha256: sha.get(fichero)!,
    });
    if (!r.ok) {
      inf.descartados[r.motivo] = (inf.descartados[r.motivo] ?? 0) + 1;
      continue;
    }
    const h = r.hechos;
    let nombre = ficheroHechos(h);
    for (let n = 2; escritos.has(nombre); n += 1) {
      h.competition.competitionKey = `${h.competition.competitionKey.replace(/~\d+$/, '')}~${n}`;
      nombre = ficheroHechos(h);
    }
    writeFileSync(join(salida, nombre), JSON.stringify(h, null, 2));
    escritos.add(nombre);
    inf.ficheros += 1;
    inf.porTemporada[h.edition.season] = (inf.porTemporada[h.edition.season] ?? 0) + 1;
    inf.resultados += h.results.length;
    inf.conLicencia += h.results.filter((x) => x.license).length;
    inf.conAnioNacimiento += h.results.filter((x) => x.birthYear).length;
    for (const b of h.bouts) inf.asaltos[b.phase] += 1;
    for (const s of ['results', 'pools', 'tableau'] as const) {
      const e = (inf.estados[s] ??= {});
      e[h.status[s]] = (e[h.status[s]] ?? 0) + 1;
    }
  }
  // La carpeta de salida es exclusiva de este conversor.
  for (const f of readdirSync(salida)) if (f.endsWith('.json') && !f.startsWith('_') && !escritos.has(f)) rmSync(join(salida, f));
  inf.porTemporada = Object.fromEntries(Object.entries(inf.porTemporada).sort());
  writeFileSync(join(salida, '_informe.json'), JSON.stringify(inf, null, 2));
  console.log(JSON.stringify(inf, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
