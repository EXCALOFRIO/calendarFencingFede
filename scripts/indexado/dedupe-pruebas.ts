/**
 * Une en UNA prueba las copias nacionales del mismo evento que vienen de fuentes
 * distintas: la clasificación de Skermo (con licencias, sin asaltos) y la lectura
 * del PDF o de Engarde (con poules y cuadro, y a veces sólo con los puestos que
 * `depurarSolapes` no supo atribuir). Sin esto la ficha del evento sale dos
 * veces: una con puestos y «asaltos sin leer», otra con asaltos y «sin puesto».
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/dedupe-pruebas.ts --db <copia.sqlite> [--simular] [--informe <json>]
 *     [--inventario <national-inventory.json>]
 *
 * Reglas (se ejecuta dentro de `unificar-personas.ts`, después de `depurarSolapes`):
 *  - Mismo evento: pruebas INDIVIDUAL de rfee_pdf, skermo_rfee o engarde con la misma
 *    arma, categoría y género, fecha a
 *    ±2 días y al menos la mitad de los nombres de la menor (mínimo 4) compatibles
 *    con la otra. A 3 días sólo con el mismo género y categoría, 8 nombres o más y el 90 %
 *    en común en los dos sentidos (`ESTRICTO`). Los nombres son los de puestos y asaltos; un nombre del PDF
 *    recortado por la columna («RAMIREZ LARENA Al») es compatible con el completo
 *    («ALEJANDRO RAMIREZ LARENA»), ver `nombresCompatiblesRecorte`.
 *  - Por grupo, la prueba que queda es la de mejores puestos: skermo_rfee, luego
 *    rfee_pdf, luego engarde; a igualdad, la de más puestos. Un grupo con dos
 *    pruebas skermo_rfee no se toca (no se sabe cuál es cuál).
 *  - Por fase (poule, cuadro) se queda la lectura con más asaltos válidos del grupo; a
 *    igualdad, la de menos marcadores imposibles, la de Engarde frente al PDF y la que ya
 *    está en la prueba destino (`dedupe-lecturas.ts`); se trasladan a la destino
 *    conservando el id cuando la misma clave ya estaba allí (recargas). Las demás
 *    lecturas de esa fase se borran. La cobertura de la fase pasa a la destino.
 *  - Los puestos de las otras pruebas cuyo nombre casa con un puesto de la destino
 *    se borran (su vínculo de persona pasa si allí falta). Una prueba que queda sin
 *    puestos ni asaltos se borra con su cobertura (y su edición, si queda vacía).
 *  - Las pruebas conjuntas (`dedupe-conjuntas.ts`, opción `excluir`) no entran en ningún grupo.
 *  - Después, los asaltos rfee_pdf/engarde de la destino se vinculan con el puesto
 *    de su mismo nombre en la prueba (`revincularAsaltosPorPuesto`).
 *
 * Idempotente: si el cargador vuelve a crear la prueba PDF, su lectura empata con la
 * ya trasladada y se borra sin cambiar nada en la destino.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  argumento,
  bandera,
  CARPETA_CACHES,
  NUEVO_POR_DEFECTO,
  palabrasNombre,
  prepararCopiaTrabajo,
  quitarGuardia,
  restaurarGuardia,
} from './comun';
import {
  anomaliasLectura,
  anotarEleccion,
  elegirLectura,
  nuevoInformeLecturas,
  type Anomalias,
  type InformeLecturas,
  type Lectura,
  type PuestoDe,
} from './dedupe-lecturas';

export const FUENTES_NACIONALES = ['skermo_rfee', 'rfee_pdf', 'engarde'] as const;
const RANGO_DESTINO: Record<string, number> = { skermo_rfee: 3, rfee_pdf: 2, engarde: 1 };
const FASES = ['POULE', 'TABLEAU'] as const;
type Fase = (typeof FASES)[number];
const KIND: Record<Fase, string> = { POULE: 'pools', TABLEAU: 'tableau' };

// ------------------------------------------------------------------ nombres

export {
  cabe,
  casarUnico,
  nombresCompatiblesRecorte,
  nombresEnComun,
  prepararNombre,
  type NombrePreparado,
} from '../../src/lib/ingest/hechos/nombres-prueba';
import {
  casarUnico,
  nombresCompatiblesRecorte,
  nombresEnComun,
  prepararNombre,
  type NombrePreparado,
} from '../../src/lib/ingest/hechos/nombres-prueba';

// ------------------------------------------------------------------ emparejado

export type PruebaNacional = {
  id: string;
  source: string;
  season: string;
  competition_key: string;
  edition_id: string;
  weapon: string;
  gender: string;
  category: string;
  fecha: string;
  /** URL de la fuente sin fragmento (en rfee_pdf, el PDF). */
  url: string | null;
  resultados: number;
  conPuesto: number;
  asaltos: Record<Fase, number>;
  nombres: NombrePreparado[];
};

export type GrupoDuplicado = { destino: PruebaNacional; otras: PruebaNacional[]; comunes: number };

const dia = (f: string) => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/**
 * `enlazadas`: el catálogo de Skermo publica el PDF de `b` como clasificación de `a`. Entonces la
 * categoría puede no coincidir: el TNR absoluto que se tira dentro del satélite U23 de Sabadell
 * enlaza el PDF de la prueba U23, que el lector clasifica como M23.
 */
/** Hasta aquí (días) basta la regla normal; a `VENTANA_ESTRICTA` días, `ESTRICTO`. */
export const VENTANA_NORMAL = 2;
export const VENTANA_ESTRICTA = 3;
/**
 * A 3 días: el PDF de la RFEE fecha la prueba el sábado del primer día y Engarde el día en que se
 * tiró (Campeonato de España junior 2020: PDF 5-12, Engarde 8-12), o al revés. Sólo con el mismo
 * género y la misma categoría (sin catálogo que las enlace) y casi todos los tiradores en común
 * en los dos sentidos.
 */
export const ESTRICTO = { minimo: 8, cuota: 0.9 } as const;

export function mismoEvento(a: PruebaNacional, b: PruebaNacional, umbral = 0.5, enlazadas = false): number {
  if (a.weapon !== b.weapon || (a.category !== b.category && !enlazadas)) return 0;
  // Dentro de una edición (un documento, un torneo Engarde) dos pruebas son fases distintas
  // («1ª fase» y «fase final»): las une el cargador o se quedan como están.
  if (a.edition_id === b.edition_id || (a.source === 'engarde' && b.source === 'engarde')) return 0;
  if (a.gender !== b.gender && a.gender !== 'MIXTO' && b.gender !== 'MIXTO') return 0;
  const dias = Math.abs(dia(a.fecha) - dia(b.fecha));
  if (dias > VENTANA_ESTRICTA) return 0;
  const estricta = dias > VENTANA_NORMAL;
  if (estricta && (a.gender !== b.gender || a.category !== b.category)) return 0;
  const [menor, mayor] = a.nombres.length <= b.nombres.length ? [a, b] : [b, a];
  if (menor.nombres.length < (estricta ? ESTRICTO.minimo : 4)) return 0;
  const comunes = nombresEnComun(menor.nombres, mayor.nombres);
  if (comunes < 4) return 0;
  const sobreMenor = comunes / menor.nombres.length;
  // En el sentido contrario: el PDF repite cada tirador con el nombre entero (puestos) y
  // recortado (asaltos), y esas variantes casan todas con el mismo nombre de la otra prueba.
  const sobreMayor = nombresEnComun(mayor.nombres, menor.nombres) / mayor.nombres.length;
  if (estricta) return sobreMenor >= ESTRICTO.cuota && sobreMayor >= ESTRICTO.cuota ? comunes : 0;
  if (sobreMenor >= umbral && sobreMayor >= umbral) return comunes;
  // Una lectura sólo de cuadro (los 32 primeros de 90) cabe entera en la clasificación;
  // dos pruebas con puestos donde una contiene a la otra son dos fases o dos eventos.
  const soloAsaltos = menor.resultados <= menor.nombres.length / 4;
  return soloAsaltos && sobreMenor >= 0.8 ? comunes : 0;
}

export function cargarPruebasNacionales(db: DatabaseSync, desde = '0000-00-00'): PruebaNacional[] {
  const comps = db.prepare(
    `SELECT c.id, c.source, c.season, c.competition_key, c.edition_id, c.weapon, c.gender, c.category,
            coalesce(c.competition_date, e.start_date) fecha, c.source_url url
       FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
      WHERE c.source IN (${FUENTES_NACIONALES.map((f) => `'${f}'`).join(',')}) AND c.format = 'INDIVIDUAL'
        AND coalesce(c.competition_date, e.start_date) >= ?`,
  ).all(desde) as Omit<PruebaNacional, 'resultados' | 'conPuesto' | 'asaltos' | 'nombres'>[];
  const porId = new Map<string, PruebaNacional>();
  const vistos = new Map<string, Set<string>>();
  for (const c of comps) {
    porId.set(c.id, { ...c, url: c.url ? c.url.split('#')[0] : null, resultados: 0, conPuesto: 0, asaltos: { POULE: 0, TABLEAU: 0 }, nombres: [] });
    vistos.set(c.id, new Set());
  }
  const anotar = (id: string, nombre: string) => {
    const p = porId.get(id);
    if (!p) return;
    const n = prepararNombre(nombre);
    if (!n.norm || vistos.get(id)!.has(n.norm)) return;
    vistos.get(id)!.add(n.norm);
    p.nombres.push(n);
  };
  for (const r of db.prepare(
    `SELECT r.competition_id c, r.source_name n, r.position p FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id
      WHERE c.source IN (${FUENTES_NACIONALES.map((f) => `'${f}'`).join(',')}) AND c.format = 'INDIVIDUAL'`,
  ).iterate() as Iterable<{ c: string; n: string; p: number | null }>) {
    const p = porId.get(r.c);
    if (!p) continue;
    p.resultados += 1;
    if (r.p !== null) p.conPuesto += 1;
    anotar(r.c, r.n);
  }
  for (const b of db.prepare(
    `SELECT b.competition_id c, b.phase f, b.fencer_a_name a, b.fencer_b_name bn FROM sport_bout b
       JOIN sport_competition c ON c.id = b.competition_id
      WHERE c.source IN (${FUENTES_NACIONALES.map((f) => `'${f}'`).join(',')}) AND c.format = 'INDIVIDUAL'`,
  ).iterate() as Iterable<{ c: string; f: Fase; a: string; bn: string }>) {
    const p = porId.get(b.c);
    if (!p) continue;
    p.asaltos[b.f] += 1;
    anotar(b.c, b.a);
    anotar(b.c, b.bn);
  }
  return [...porId.values()].filter((p) => p.fecha);
}

function rangoDestino(p: PruebaNacional): number[] {
  return [RANGO_DESTINO[p.source] ?? 0, p.conPuesto, p.resultados];
}

export function elegirDestino(pruebas: readonly PruebaNacional[]): PruebaNacional {
  return [...pruebas].sort((x, y) => {
    const a = rangoDestino(x);
    const b = rangoDestino(y);
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return b[i] - a[i];
    return x.id < y.id ? -1 : 1;
  })[0];
}

export type Emparejado = { grupos: GrupoDuplicado[]; gruposConVariasSkermo: GrupoDuplicado[] };

/** Fila del catálogo nacional (`national-inventory.json#ownRfeeCatalog`), lo que se usa de ella. */
export type FilaCatalogoNacional = { fuente: string; temporada: string; clavePrueba: string | null; enlaces?: { tipo: string; url: string }[] };

/** Prueba skermo_rfee → URLs (sin fragmento) de los PDF que su fila del catálogo publica. */
export function enlacesDelCatalogo(pruebas: readonly PruebaNacional[], catalogo: readonly FilaCatalogoNacional[]): Map<string, Set<string>> {
  const porClave = new Map<string, Set<string>>();
  for (const f of catalogo) {
    if (f.fuente !== 'skermo_rfee' || !f.clavePrueba) continue;
    const urls = (f.enlaces ?? []).filter((e) => e.tipo === 'pdf').map((e) => e.url.split('#')[0]);
    if (urls.length > 0) porClave.set(`${f.temporada}|${f.clavePrueba}`, new Set(urls));
  }
  const out = new Map<string, Set<string>>();
  for (const p of pruebas) {
    const u = p.source === 'skermo_rfee' ? porClave.get(`${p.season}|${p.competition_key}`) : undefined;
    if (u) out.set(p.id, u);
  }
  return out;
}

export function emparejarDuplicados(
  pruebas: readonly PruebaNacional[], umbral = 0.5, enlaces: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): Emparejado {
  const porClave = new Map<string, PruebaNacional[]>();
  for (const p of pruebas) {
    const k = `${p.weapon}|${p.category}`;
    (porClave.get(k) ?? porClave.set(k, []).get(k)!).push(p);
  }
  const padre = new Map<string, string>();
  const raiz = (id: string): string => {
    let r = id;
    while (padre.get(r) !== r) r = padre.get(r)!;
    padre.set(id, r);
    return r;
  };
  const comunesPar = new Map<string, number>();
  const unir = (x: PruebaNacional, y: PruebaNacional, comunes: number) => {
    for (const id of [x.id, y.id]) if (!padre.has(id)) padre.set(id, id);
    const [a, b] = [raiz(x.id), raiz(y.id)];
    if (a !== b) padre.set(a, b);
    comunesPar.set(x.id, Math.max(comunesPar.get(x.id) ?? 0, comunes));
  };
  for (const lista of porClave.values()) {
    lista.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id < b.id ? -1 : 1));
    for (let i = 0; i < lista.length; i += 1) {
      for (let j = i + 1; j < lista.length; j += 1) {
        if (dia(lista[j].fecha) - dia(lista[i].fecha) > VENTANA_ESTRICTA) break;
        const comunes = mismoEvento(lista[i], lista[j], umbral);
        if (comunes > 0) unir(lista[i], lista[j], comunes);
      }
    }
  }
  if (enlaces.size > 0) {
    const pdfPorUrl = new Map<string, PruebaNacional[]>();
    for (const p of pruebas) {
      if (p.source === 'rfee_pdf' && p.url) (pdfPorUrl.get(p.url) ?? pdfPorUrl.set(p.url, []).get(p.url)!).push(p);
    }
    for (const p of pruebas) {
      for (const u of enlaces.get(p.id) ?? []) {
        for (const x of pdfPorUrl.get(u) ?? []) {
          if (x.category === p.category) continue;
          const comunes = mismoEvento(p, x, umbral, true);
          if (comunes > 0) unir(p, x, comunes);
        }
      }
    }
  }
  const porId = new Map(pruebas.map((p) => [p.id, p]));
  const miembros = new Map<string, PruebaNacional[]>();
  for (const id of padre.keys()) {
    const r = raiz(id);
    (miembros.get(r) ?? miembros.set(r, []).get(r)!).push(porId.get(id)!);
  }
  const out: Emparejado = { grupos: [], gruposConVariasSkermo: [] };
  for (const lista of miembros.values()) {
    const destino = elegirDestino(lista);
    const comunes = Math.max(...lista.map((p) => comunesPar.get(p.id) ?? 0));
    const g = { destino, otras: lista.filter((p) => p !== destino), comunes };
    if (lista.filter((p) => p.source === 'skermo_rfee').length > 1) out.gruposConVariasSkermo.push(g);
    else out.grupos.push(g);
  }
  out.grupos.sort((a, b) => (a.destino.fecha < b.destino.fecha ? -1 : 1));
  return out;
}

// ------------------------------------------------------------------ fusión

/** Firma de asalto tolerante a recortes y al orden: primera palabra de cada nombre y tocados. */
export function firmaLaxa(a: string, sa: number, b: string, sb: number): string {
  const w = (n: string) => palabrasNombre(n)[0] ?? '';
  return [`${w(a)}:${sa}`, `${w(b)}:${sb}`].sort().join('|');
}

/** Fracción de los asaltos de la lectura menor que también están en la mayor. */
export function solapeFirmas(x: readonly string[], y: readonly string[]): number {
  const [menor, mayor] = x.length <= y.length ? [x, y] : [y, x];
  if (menor.length === 0) return 1;
  const resto = new Map<string, number>();
  for (const f of mayor) resto.set(f, (resto.get(f) ?? 0) + 1);
  let comunes = 0;
  for (const f of menor) {
    const n = resto.get(f) ?? 0;
    if (n > 0) {
      comunes += 1;
      resto.set(f, n - 1);
    }
  }
  return comunes / menor.length;
}

export type InformeDuplicados = {
  pruebasNacionales: number;
  grupos: number;
  gruposConVariasSkermo: number;
  gruposOmitidosRondasDistintas: number;
  porFuentes: Record<string, number>;
  fasesTrasladadas: number;
  asaltosTrasladados: number;
  asaltosYaPresentes: number;
  asaltosDescartados: number;
  /** De los descartados, los que no tienen la misma firma laxa en la lectura que gana (recortes, erratas o asaltos que sólo una lectura trae). */
  asaltosDescartadosSinPareja: number;
  resultadosDuplicadosBorrados: number;
  /** Puestos que sólo publica la otra lectura (extranjeros que Skermo no lista) y pasan a la destino. */
  resultadosTrasladados: number;
  /** Puestos sin nombre compatible cuyo puesto ya está en la destino: se borran como duplicados. */
  resultadosPuestoOcupado: number;
  gruposOmitidosPuestosDistintos: number;
  personasHeredadas: number;
  competicionesBorradas: number;
  edicionesBorradas: number;
  coberturasMovidas: number;
  coberturasBorradas: number;
  revinculo: InformeRevinculo;
  /** Elección de la lectura de cada fase: motivo (más asaltos, anomalías, Engarde) y marcadores imposibles. */
  lecturas: InformeLecturas;
  /** Pruebas conjuntas y sus partes (`dedupe-conjuntas.ts`) que no entran en ningún grupo. */
  pruebasExcluidas: number;
  ejemplos: { destino: string; otras: string[]; fases: string[] }[];
  /** Sólo al simular: muestra de puestos `ocupado`. */
  ocupadosEjemplo: string[];
};

type FilaAsalto = { id: string; source: string; round_key: string; fencer_a_ref: string; fencer_b_ref: string; content_hash: string };

export type FilaPuesto = { id: string; source_name: string; person_id: string | null; position: number | null };
export type AccionPuesto = 'duplicado' | 'ocupado' | 'trasladar';
export type PlanPuesto = { fila: FilaPuesto; accion: AccionPuesto; destino: FilaPuesto | null };

/**
 * Qué hacer con cada puesto de las otras pruebas del grupo:
 *  - `duplicado`: su nombre casa (exacto o recortado) con un puesto de la destino; si
 *    casa con varios también, porque es uno de ellos aunque no se sepa cuál;
 *  - `trasladar`: no casa con ninguno y su puesto está libre en la destino (Skermo
 *    deja huecos en los puestos de los extranjeros, que sólo publica el PDF);
 *  - `ocupado`: no casa pero su puesto ya lo tiene otro tirador en la destino: es ese mismo\n *    puesto con el nombre mal escrito («KIM YOUM» por «KIM YUOM») y se borra como duplicado.
 * Lo trasladado cuenta para las pruebas siguientes del grupo (copias del mismo PDF).
 */
export function planPuestos(destino: readonly FilaPuesto[], otras: readonly { id: string; filas: readonly FilaPuesto[] }[]): Map<string, PlanPuesto[]> {
  const filas = [...destino];
  const preparados = filas.map((r) => prepararNombre(r.source_name));
  const puestos = new Set(filas.map((r) => r.position).filter((p) => p !== null));
  const out = new Map<string, PlanPuesto[]>();
  for (const o of otras) {
    const plan: PlanPuesto[] = [];
    for (const r of o.filas) {
      const n = prepararNombre(r.source_name);
      const i = casarUnico(n, preparados);
      if (i !== null) {
        plan.push({ fila: r, accion: 'duplicado', destino: filas[i] });
        continue;
      }
      if (preparados.some((m) => nombresCompatiblesRecorte(n, m))) {
        plan.push({ fila: r, accion: 'duplicado', destino: null });
        continue;
      }
      if (r.position !== null && puestos.has(r.position)) {
        plan.push({ fila: r, accion: 'ocupado', destino: null });
        continue;
      }
      plan.push({ fila: r, accion: 'trasladar', destino: null });
      filas.push(r);
      preparados.push(n);
      if (r.position !== null) puestos.add(r.position);
    }
    out.set(o.id, plan);
  }
  return out;
}

export type OpcionesDuplicados = {
  simular?: boolean;
  desde?: string;
  umbral?: number;
  /** Catálogo nacional: empareja también por el PDF que Skermo publica para la prueba. */
  catalogo?: readonly FilaCatalogoNacional[];
  /** Pruebas que no se agrupan con ninguna otra (las conjuntas de `dedupe-conjuntas.ts`). */
  excluir?: ReadonlySet<string>;
  /** Sólo los grupos con alguna de estas pruebas (un lote que funde sólo lo que ha preparado). */
  soloCon?: ReadonlySet<string>;
};

export type FilaAsaltoLectura = {
  source: string; round_key: string; fencer_a_ref: string; fencer_b_ref: string; fencer_a_name: string;
  fencer_b_name: string; score_a: number | null; score_b: number | null;
};

/** Lectura de una fase para `elegirLectura`: asaltos, anomalías y si es de Engarde (la mayoría de sus asaltos). */
export function evaluarLectura<T>(ref: T, filas: readonly FilaAsaltoLectura[], fase: Fase, destino: boolean, puestoDe?: PuestoDe):
  Lectura<T> & { tipos: Anomalias['tipos'] } {
  const an = anomaliasLectura(filas.map((b) => ({
    fase, ronda: b.round_key, a: b.fencer_a_ref, b: b.fencer_b_ref, nombreA: b.fencer_a_name, nombreB: b.fencer_b_name,
    tocadosA: b.score_a, tocadosB: b.score_b,
  })), puestoDe);
  const engarde = filas.filter((b) => b.source === 'engarde').length * 2 > filas.length;
  return { ref, asaltos: filas.length, anomalias: an.asaltos, engarde, destino, tipos: an.tipos };
}

export function fundirDuplicados(db: DatabaseSync, opciones: OpcionesDuplicados = {}): InformeDuplicados {
  const excluir = opciones.excluir ?? new Set<string>();
  const todasNacionales = cargarPruebasNacionales(db, opciones.desde);
  const pruebas = todasNacionales.filter((p) => !excluir.has(p.id));
  const emparejado = emparejarDuplicados(pruebas, opciones.umbral, enlacesDelCatalogo(pruebas, opciones.catalogo ?? []));
  const elegido = (g: GrupoDuplicado) => !opciones.soloCon || [g.destino, ...g.otras].some((p) => opciones.soloCon!.has(p.id));
  const grupos = emparejado.grupos.filter(elegido);
  const gruposConVariasSkermo = emparejado.gruposConVariasSkermo.filter(elegido);
  const inf: InformeDuplicados = {
    pruebasNacionales: pruebas.length, grupos: grupos.length, gruposConVariasSkermo: gruposConVariasSkermo.length,
    gruposOmitidosRondasDistintas: 0, porFuentes: {}, fasesTrasladadas: 0, asaltosTrasladados: 0, asaltosYaPresentes: 0, asaltosDescartados: 0, asaltosDescartadosSinPareja: 0,
    resultadosDuplicadosBorrados: 0, resultadosTrasladados: 0, resultadosPuestoOcupado: 0, gruposOmitidosPuestosDistintos: 0, personasHeredadas: 0, competicionesBorradas: 0,
    edicionesBorradas: 0, coberturasMovidas: 0, coberturasBorradas: 0,
    revinculo: { pruebas: 0, ladosRevinculados: 0, ladosVinculadosNuevos: 0, descartadosHomonimo: 0, descartadosRonda: 0 },
    lecturas: nuevoInformeLecturas(), pruebasExcluidas: todasNacionales.length - pruebas.length, ejemplos: [], ocupadosEjemplo: [],
  };
  for (const g of grupos) {
    const k = [g.destino.source, ...g.otras.map((o) => o.source).sort()].join('+');
    inf.porFuentes[k] = (inf.porFuentes[k] ?? 0) + 1;
  }
  const q = (sql: string) => db.prepare(sql);
  const asaltosFase = q(`SELECT id, source, round_key, fencer_a_ref, fencer_b_ref, content_hash FROM sport_bout WHERE competition_id=? AND phase=?`);
  const borrarAsalto = q(`DELETE FROM sport_bout WHERE id=?`);
  const moverAsalto = q(`UPDATE sport_bout SET competition_id=? WHERE id=?`);
  const coberturasFase = q(`SELECT id, source, competition_id FROM sport_import_coverage WHERE competition_id=? AND fact_kind=?`);
  const moverCobertura = q(`UPDATE sport_import_coverage SET competition_id=?, imported_total=?, updated_at=? WHERE id=?`);
  const borrarCobertura = q(`DELETE FROM sport_import_coverage WHERE id=?`);
  const puestos = q(`SELECT id, source_name, person_id, position FROM sport_result WHERE competition_id=? ORDER BY position IS NULL, position, id`);
  const moverPuesto = q(`UPDATE OR IGNORE sport_result SET competition_id=? WHERE id=?`);
  const heredar = q(`UPDATE sport_result SET person_id=? WHERE id=? AND person_id IS NULL`);
  const borrarPuesto = q(`DELETE FROM sport_result WHERE id=?`);
  const quedan = q(`SELECT (SELECT count(*) FROM sport_result WHERE competition_id=?) + (SELECT count(*) FROM sport_bout WHERE competition_id=?) n`);
  // Por clave sólo las huérfanas: la cobertura de poules y cuadro ya trasladada a la destino lleva la misma clave.
  const borrarCoberturasComp = q(`DELETE FROM sport_import_coverage WHERE competition_id=?1 OR (source=?2 AND season=?3 AND competition_key=?4 AND competition_id IS NULL)`);
  const borrarComp = q(`DELETE FROM sport_competition WHERE id=?`);
  const borrarEdicion = q(`DELETE FROM sport_edition WHERE id=? AND NOT EXISTS (SELECT 1 FROM sport_competition WHERE edition_id=?)`);
  const asaltosLectura = q(`SELECT source, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name, fencer_b_name, score_a, score_b
    FROM sport_bout WHERE competition_id=? AND phase=?`);
  // Una parte de una prueba conjunta que se funde en otra deja su vínculo a la destino.
  const hayConjuntas = Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sport_competition_combined'`).get());
  const moverParte = hayConjuntas
    ? q(`UPDATE OR IGNORE sport_competition_combined SET part_competition_id=? WHERE part_competition_id=?`)
    : null;
  const destinos: string[] = [];

  const firmasFase = q(`SELECT fencer_a_name a, score_a sa, fencer_b_name b, score_b sb FROM sport_bout WHERE competition_id=? AND phase=?`);
  const firmas = (id: string, fase: Fase) => (firmasFase.all(id, fase) as { a: string; sa: number; b: string; sb: number }[])
    .map((x) => firmaLaxa(x.a, x.sa, x.b, x.sb));

  if (!opciones.simular) db.exec('BEGIN');
  try {
    for (const g of grupos) {
      const todas = [g.destino, ...g.otras];
      const d = g.destino;
      const fasesMovidas: string[] = [];
      // Dos lecturas de la misma fase que apenas comparten asaltos son rondas distintas
      // (primera y segunda vuelta de poules en documentos separados): no se tocan.
      const distintas = FASES.some((fase) => {
        const con = todas.filter((p) => p.asaltos[fase] > 0);
        for (let i = 0; i < con.length; i += 1) {
          for (let j = i + 1; j < con.length; j += 1) {
            if (solapeFirmas(firmas(con[i].id, fase), firmas(con[j].id, fase)) < 0.5) return true;
          }
        }
        return false;
      });
      if (distintas) {
        inf.gruposOmitidosRondasDistintas += 1;
        continue;
      }
      const filasDestino = puestos.all(d.id) as FilaPuesto[];
      const planes = planPuestos(filasDestino, g.otras.map((p) => ({ id: p.id, filas: puestos.all(p.id) as FilaPuesto[] })));
      // Otra fase u otro evento: muchos puestos sin nombre en la destino que chocan con sus puestos, o
      // demasiados que entrarían en huecos. Los extranjeros de un TNR dentro de un satélite (Skermo
      // los omite y deja su puesto libre) pueden ser bastantes, así que el segundo límite es holgado.
      // La base es destino + otra: de la otra suelen quedar sólo los restos de `depurarSolapes`.
      const dudosa = [...planes.values()].some((pl) => {
        const n = (a: AccionPuesto) => pl.filter((x) => x.accion === a).length;
        const base = pl.length + filasDestino.length;
        return n('ocupado') > Math.max(3, base * 0.15) || n('trasladar') > Math.max(3, base * 0.4);
      });
      if (dudosa) {
        inf.gruposOmitidosPuestosDistintos += 1;
        continue;
      }
      const preparadosDestino = filasDestino.map((r) => prepararNombre(r.source_name));
      const puestoDe: PuestoDe = (nombre) => {
        const i = casarUnico(prepararNombre(nombre), preparadosDestino);
        const puesto = i === null ? null : filasDestino[i].position;
        return puesto === null ? null : { grupo: d.id, puesto };
      };
      for (const fase of FASES) {
        const conAsaltos = todas.filter((p) => p.asaltos[fase] > 0);
        if (conAsaltos.length === 0) continue;
        // Gana la lectura con más asaltos válidos; luego la de menos marcadores imposibles, la de
        // Engarde frente al PDF y, a igualdad de todo, la que ya está en la destino (`dedupe-lecturas.ts`).
        const lecturas = conAsaltos.map((p) =>
          evaluarLectura(p, asaltosLectura.all(p.id, fase) as FilaAsaltoLectura[], fase, p === d, puestoDe));
        const eleccion = elegirLectura(lecturas);
        const ganadora = eleccion.ganadora.ref;
        anotarEleccion(inf.lecturas, `${d.source}:${d.competition_key}`, fase,
          lecturas.map((l) => ({ ...l, ref: `${l.ref.source}:${l.ref.id}` })),
          { ganadora: { ...eleccion.ganadora, ref: `${ganadora.source}:${ganadora.id}` }, motivo: eleccion.motivo });
        if (ganadora === d && conAsaltos.length === 1) continue;
        fasesMovidas.push(`${fase}:${ganadora.source}`);
        const firmasGanadora = new Set(firmas(ganadora.id, fase));
        for (const p of conAsaltos) {
          if (p === ganadora) continue;
          inf.asaltosDescartadosSinPareja += firmas(p.id, fase).filter((f) => !firmasGanadora.has(f)).length;
        }
        if (opciones.simular) {
          if (ganadora !== d) {
            inf.asaltosTrasladados += ganadora.asaltos[fase];
            inf.fasesTrasladadas += 1;
          }
          continue;
        }
        const nuevos = asaltosFase.all(ganadora.id, fase) as FilaAsalto[];
        const fuentes = new Set(nuevos.map((b) => b.source));
        const claveDe = (b: FilaAsalto) => `${b.source}\u0000${b.round_key}\u0000${b.fencer_a_ref}\u0000${b.fencer_b_ref}`;
        if (ganadora !== d) {
          inf.fasesTrasladadas += 1;
          const enDestino = new Map((asaltosFase.all(d.id, fase) as FilaAsalto[]).map((b) => [claveDe(b), b]));
          const claves = new Set(nuevos.map(claveDe));
          for (const [k, b] of enDestino) {
            if (claves.has(k)) continue;
            borrarAsalto.run(b.id);
            inf.asaltosDescartados += 1;
          }
          for (const b of nuevos) {
            const previo = enDestino.get(claveDe(b));
            if (previo && previo.content_hash === b.content_hash) {
              borrarAsalto.run(b.id);
              inf.asaltosYaPresentes += 1;
              continue;
            }
            if (previo) borrarAsalto.run(previo.id);
            moverAsalto.run(d.id, b.id);
            inf.asaltosTrasladados += 1;
          }
        }
        for (const p of todas) {
          if (p === ganadora || p === d) continue;
          inf.asaltosDescartados += Number(q(`DELETE FROM sport_bout WHERE competition_id=? AND phase=?`).run(p.id, fase).changes);
        }
        if (ganadora === d) {
          // La destino ya tenía la mejor lectura: sólo sobran las de otras fuentes en ella.
          for (const b of asaltosFase.all(d.id, fase) as FilaAsalto[]) {
            if (fuentes.has(b.source)) continue;
            borrarAsalto.run(b.id);
            inf.asaltosDescartados += 1;
          }
        }
        // Cobertura de la fase: una por fuente de los asaltos que quedan, la de la lectura ganadora
        // antes que la ya trasladada. En una recarga el cargador apunta la cobertura a la prueba
        // PDF recreada aunque gane la lectura que ya estaba en la destino: esa también vale.
        const total = Number((q(`SELECT count(*) n FROM sport_bout WHERE competition_id=? AND phase=?`).get(d.id, fase) as { n: number }).n);
        const asignadas = new Set<string>();
        const orden = [ganadora, d, ...todas.filter((p) => p !== ganadora && p !== d)].filter((p, i, xs) => xs.indexOf(p) === i);
        const filasCobertura = orden.flatMap((p) =>
          (coberturasFase.all(p.id, KIND[fase]) as { id: string; source: string }[]).map((c) => ({ p, c })));
        for (const { p, c } of filasCobertura) {
          if (fuentes.has(c.source) && !asignadas.has(c.source)) {
            asignadas.add(c.source);
            moverCobertura.run(d.id, total, Date.now(), c.id);
            if (p !== d) inf.coberturasMovidas += 1;
          } else {
            borrarCobertura.run(c.id);
            inf.coberturasBorradas += 1;
          }
        }
      }
      if (inf.ejemplos.length < 40) inf.ejemplos.push({ destino: `${d.source}:${d.id}`, otras: g.otras.map((o) => `${o.source}:${o.id}`), fases: fasesMovidas });

      for (const p of g.otras) {
        for (const r of planes.get(p.id)!) {
          if (r.accion === 'ocupado') {
            inf.resultadosPuestoOcupado += 1;
            if (opciones.simular && inf.ocupadosEjemplo.length < 200) inf.ocupadosEjemplo.push(`${p.id} ${r.fila.position} ${r.fila.source_name}`);
          }
          if (r.accion === 'trasladar') {
            inf.resultadosTrasladados += 1;
            if (!opciones.simular && Number(moverPuesto.run(d.id, r.fila.id).changes) === 0) borrarPuesto.run(r.fila.id);
            continue;
          }
          inf.resultadosDuplicadosBorrados += 1;
          if (opciones.simular) continue;
          if (r.destino && r.fila.person_id && !r.destino.person_id) {
            heredar.run(r.fila.person_id, r.destino.id);
            r.destino.person_id = r.fila.person_id;
            inf.personasHeredadas += 1;
          }
          borrarPuesto.run(r.fila.id);
        }
        if (opciones.simular || Number((quedan.get(p.id, p.id) as { n: number }).n) > 0) continue;
        moverParte?.run(d.id, p.id);
        inf.coberturasBorradas += Number(borrarCoberturasComp.run(p.id, p.source, p.season, p.competition_key).changes);
        borrarComp.run(p.id);
        inf.competicionesBorradas += 1;
        inf.edicionesBorradas += Number(borrarEdicion.run(p.edition_id, p.edition_id).changes);
      }
      destinos.push(d.id);
    }
    if (!opciones.simular) {
      inf.revinculo = revincularAsaltosPorPuesto(db, destinos, false);
      db.exec('COMMIT');
    }
  } catch (e) {
    if (!opciones.simular) db.exec('ROLLBACK');
    throw e;
  }
  return inf;
}

// ------------------------------------------------------------------ vínculos

export type InformeRevinculo = {
  pruebas: number;
  ladosRevinculados: number;
  ladosVinculadosNuevos: number;
  /** Nombres de asalto no resueltos porque otro nombre de la prueba, compatible con él, va a otro puesto (o a ninguno). */
  descartadosHomonimo: number;
  /** Lados devueltos a su vínculo anterior porque la persona acababa con dos referencias en la misma ronda. */
  descartadosRonda: number;
};

/**
 * Los asaltos de PDF y Engarde se vinculan por nombre; si el nombre está recortado
 * («ZABALA GUTIERRE») el paso por nombre crea una persona aparte. Dentro de una
 * prueba con puestos el nombre se resuelve con el puesto: el exacto si es único, si
 * no el único compatible. Sólo se sustituye un vínculo nulo o a una persona sin
 * ningún identificador (creada por nombre); nunca se repite persona en un asalto.
 * No se resuelve un nombre si otro nombre de asalto de la prueba compatible con él
 * no va al mismo puesto («ZABALA GUTIERREZ» con «… Juan» en la clasificación y
 * «… Pedro» sólo en las poules), ni se deja a una persona con dos referencias en
 * la misma ronda. Sin `ids`, recorre todas las pruebas nacionales individuales.
 */
export function revincularAsaltosPorPuesto(db: DatabaseSync, ids?: readonly string[], transaccion = true): InformeRevinculo {
  const inf: InformeRevinculo = { pruebas: 0, ladosRevinculados: 0, ladosVinculadosNuevos: 0, descartadosHomonimo: 0, descartadosRonda: 0 };
  const lista = ids ?? (db.prepare(
    `SELECT DISTINCT b.competition_id id FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id
      WHERE b.source IN ('rfee_pdf','engarde') AND c.format = 'INDIVIDUAL'
        AND c.source IN (${FUENTES_NACIONALES.map((f) => `'${f}'`).join(',')})`,
  ).all() as { id: string }[]).map((r) => r.id);
  const puestos = db.prepare(`SELECT source_name n, person_id p FROM sport_result WHERE competition_id=? AND person_id IS NOT NULL`);
  const asaltos = db.prepare(
    `SELECT id, phase || '|' || round_key ronda, fencer_a_ref ar, fencer_b_ref br, fencer_a_name an, fencer_b_name bn,
            fencer_a_person_id ap, fencer_b_person_id bp FROM sport_bout
      WHERE competition_id=? AND source IN ('rfee_pdf','engarde')`,
  );
  const raizDe = db.prepare(`SELECT coalesce(merged_into_person_id, id) r FROM sport_person WHERE id=?`);
  const conIdentidad = db.prepare(
    `SELECT EXISTS(SELECT 1 FROM sport_external_id WHERE person_id=?1)
         OR EXISTS(SELECT 1 FROM sport_person WHERE id=?1 AND (athlete_id IS NOT NULL OR merged_into_person_id IS NOT NULL))
         OR EXISTS(SELECT 1 FROM sport_person WHERE merged_into_person_id=?1) v`,
  );
  const actualizar = db.prepare(`UPDATE sport_bout SET fencer_a_person_id=?, fencer_b_person_id=? WHERE id=?`);
  const cacheIdentidad = new Map<string, boolean>();
  const sustituible = (p: string | null) => {
    if (p === null) return true;
    let v = cacheIdentidad.get(p);
    if (v === undefined) {
      v = Number((conIdentidad.get(p) as { v: number }).v) === 0;
      cacheIdentidad.set(p, v);
    }
    return v;
  };
  const cacheRaiz = new Map<string, string>();
  const raiz = (p: string | null) => {
    if (p === null) return null;
    let r = cacheRaiz.get(p);
    if (r === undefined) cacheRaiz.set(p, (r = (raizDe.get(p) as { r: string } | undefined)?.r ?? p));
    return r;
  };
  if (transaccion) db.exec('BEGIN');
  try {
    for (const id of lista) {
      const ps = puestos.all(id) as { n: string; p: string }[];
      if (ps.length === 0) continue;
      const preparados = ps.map((r) => prepararNombre(r.n));
      const bs = asaltos.all(id) as {
        id: string; ronda: string; ar: string; br: string; an: string; bn: string; ap: string | null; bp: string | null;
      }[];
      const nombres = new Map<string, NombrePreparado>();
      for (const b of bs) for (const n of [b.an, b.bn]) if (!nombres.has(n)) nombres.set(n, prepararNombre(n));
      const indice = new Map<string, number | null>();
      for (const [n, p] of nombres) indice.set(n, casarUnico(p, preparados));
      const porPalabra = new Map<string, string[]>();
      for (const [n, p] of nombres) for (const w of new Set(p.palabras)) (porPalabra.get(w) ?? porPalabra.set(w, []).get(w)!).push(n);
      const resuelto = new Map<string, string | null>();
      for (const [n, p] of nombres) {
        const i = indice.get(n)!;
        if (i === null) { resuelto.set(n, null); continue; }
        const vecinos = new Set(p.palabras.flatMap((w) => porPalabra.get(w) ?? []));
        const homonimo = [...vecinos].some((m) => m !== n && indice.get(m) !== i && nombresCompatiblesRecorte(p, nombres.get(m)!));
        if (homonimo) inf.descartadosHomonimo += 1;
        resuelto.set(n, homonimo ? null : ps[i].p);
      }
      const propuestos: { b: (typeof bs)[number]; a: string | null; bb: string | null }[] = [];
      for (const b of bs) {
        let [a, bb] = [b.ap, b.bp];
        const na = resuelto.get(b.an)!;
        const nb = resuelto.get(b.bn)!;
        if (na && raiz(na) !== raiz(a) && sustituible(a)) a = na;
        if (nb && raiz(nb) !== raiz(bb) && sustituible(bb)) bb = nb;
        propuestos.push({ b, a, bb });
      }
      // Una persona tira con una sola referencia por ronda: si dos acaban en la misma raíz,
      // los lados que cambiaron vuelven a su vínculo anterior.
      const refsDe = new Map<string, Map<string, Set<string>>>();
      for (const { b, a, bb } of propuestos) {
        const m = refsDe.get(b.ronda) ?? refsDe.set(b.ronda, new Map()).get(b.ronda)!;
        for (const [ref, p] of [[b.ar, a], [b.br, bb]] as const) {
          const r = raiz(p);
          if (r) (m.get(r) ?? m.set(r, new Set()).get(r)!).add(ref);
        }
      }
      const repetida = (ronda: string, p: string | null) => {
        const r = raiz(p);
        return r !== null && refsDe.get(ronda)!.get(r)!.size > 1;
      };
      let tocada = false;
      for (const x of propuestos) {
        const { b } = x;
        if (x.a !== b.ap && repetida(b.ronda, x.a)) { x.a = b.ap; inf.descartadosRonda += 1; }
        if (x.bb !== b.bp && repetida(b.ronda, x.bb)) { x.bb = b.bp; inf.descartadosRonda += 1; }
        const { a, bb } = x;
        if (a === b.ap && bb === b.bp) continue;
        if (a !== null && bb !== null && raiz(a) === raiz(bb)) continue;
        actualizar.run(a, bb, b.id);
        for (const [antes, despues] of [[b.ap, a], [b.bp, bb]] as const) {
          if (antes === despues) continue;
          if (antes === null) inf.ladosVinculadosNuevos += 1;
          else inf.ladosRevinculados += 1;
        }
        tocada = true;
      }
      if (tocada) inf.pruebas += 1;
    }
    if (transaccion) db.exec('COMMIT');
  } catch (e) {
    if (transaccion) db.exec('ROLLBACK');
    throw e;
  }
  return inf;
}

export const INVENTARIO_NACIONAL = join(CARPETA_CACHES, 'history-national', 'national-inventory.json');

/** Filas del catálogo nacional, o ninguna si el inventario no está en disco. */
export function leerCatalogoNacional(ruta = INVENTARIO_NACIONAL): FilaCatalogoNacional[] {
  if (!existsSync(ruta)) return [];
  return (JSON.parse(readFileSync(ruta, 'utf8')).ownRfeeCatalog ?? []) as FilaCatalogoNacional[];
}

function main(): void {
  const rutaDb = argumento('db', NUEVO_POR_DEFECTO);
  const simular = bandera('simular');
  const catalogo = leerCatalogoNacional(argumento('inventario', INVENTARIO_NACIONAL));
  const db = new DatabaseSync(rutaDb, simular ? { readOnly: true } : {});
  let informe: InformeDuplicados;
  if (simular) informe = fundirDuplicados(db, { simular: true, catalogo });
  else {
    prepararCopiaTrabajo(db);
    restaurarGuardia(db);
    quitarGuardia(db);
    try {
      informe = fundirDuplicados(db, { catalogo });
    } finally {
      restaurarGuardia(db);
    }
  }
  db.close();
  const salida = argumento('informe', '');
  if (salida) writeFileSync(salida, JSON.stringify(informe, null, 2));
  console.log(JSON.stringify({ ...informe, ejemplos: informe.ejemplos.slice(0, 15) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
