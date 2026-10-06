/**
 * Auditoría de completitud de asaltos de las pruebas FIE individuales (2017+):
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-completar-auditar.ts \
 *     [--base <sqlite>] [--salida <json>]
 *
 * Por prueba compara lo que publica la API FIE (caché de `fie-completar-descargar`)
 * con lo guardado en la base, fase a fase:
 *  - poules: Σ n·(n−1)/2 por poule, menos los cruces no disputados (0-0 de quien se
 *    retiró, incomparecencias), frente a los asaltos guardados;
 *  - cuadro: cruces sin BYE (sin el cuadro repetido), menos retiradas, frente a los
 *    guardados.
 * Sin datos FIE de una fase se mira lo guardado de otras fuentes (Ophardt, Fencing
 * Time, Engarde) con la misma regla sobre su propia estructura. Además, todo tirador
 * de la clasificación tiene que aparecer en alguna poule o cuadro.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumento } from './comun';
import { analizarCuadro, analizarPoules, claveAsalto, disputados, total, type AnalisisFase } from './fie-completar-analisis';
import {
  abrirBase, asaltosDeBase, BASE_PRODUCCION, grupoPrueba, INFORME_COMPLETITUD, leerFieCache, pruebasFieIndividuales,
  puestosDeBase, type AsaltoBase, type PruebaBase,
} from './fie-completar-comun';

export type EstadoFase = 'completo' | 'faltan' | 'no_aplica' | 'sin_datos';

export type FaseAuditada = {
  /** fie = datos de la API FIE; otra = sólo lo guardado de otra fuente; ninguna. */
  fuente: 'fie' | 'otra' | 'ninguna';
  estado: EstadoFase;
  teorico: number;
  disputados: number;
  guardados: number;
  /** Legibles en la FIE que no están en la base. */
  faltanRecuperables: number;
  /** Disputados que la FIE publica rotos (no se pueden importar desde la FIE). */
  ilegibles: number;
  motivos: Record<string, number>;
  /** Guardados que no están entre los legibles de la FIE (claves antiguas, otra fuente). */
  sobrantes: number;
  prioridad: number;
  vueltas?: number;
  realineadas?: number;
};

export type PruebaAuditada = {
  season: string;
  competitionKey: string;
  nombre: string;
  grupo: string;
  categoria: string;
  arma: string;
  genero: string;
  fecha: string | null;
  puestos: number;
  /** Tiradores de la clasificación que no aparecen en ninguna poule ni cuadro de la fuente. */
  sinAsaltoEnFuente: number | null;
  poules: FaseAuditada;
  cuadro: FaseAuditada;
  estado: 'completo' | 'faltan_poules' | 'faltan_cuadro' | 'faltan_ambos' | 'sin_asaltos';
  recuperableFie: boolean;
  notas: string[];
};

/** Poules guardadas de otra fuente: cada poule con k tiradores debe tener k·(k−1)/2 asaltos. */
function poulesGuardadas(bouts: AsaltoBase[]): { teorico: number; guardados: number } {
  const porRonda = new Map<string, { t: Set<string>; n: number }>();
  for (const b of bouts) {
    const r = porRonda.get(b.roundKey) ?? { t: new Set(), n: 0 };
    r.t.add(b.aRef);
    r.t.add(b.bRef);
    r.n += 1;
    porRonda.set(b.roundKey, r);
  }
  let teorico = 0;
  let guardados = 0;
  for (const r of porRonda.values()) {
    teorico += (r.t.size * (r.t.size - 1)) / 2;
    guardados += r.n;
  }
  return { teorico, guardados };
}

/** Cuadro guardado de otra fuente: eliminación directa con E tiradores = E − 1 asaltos. */
function cuadroGuardado(bouts: AsaltoBase[]): { teorico: number; guardados: number } {
  const t = new Set(bouts.flatMap((b) => [b.aRef, b.bRef]));
  return { teorico: Math.max(0, t.size - 1), guardados: bouts.length };
}

function faseFie(a: AnalisisFase, guardadas: AsaltoBase[]): FaseAuditada {
  const claves = new Set(guardadas.map((b) => `${b.phase}|${b.roundKey}|${b.aRef}|${b.bRef}`));
  const legibles = new Set(a.asaltos.map(claveAsalto));
  const faltan = a.asaltos.filter((b) => !claves.has(claveAsalto(b))).length;
  const sobrantes = [...claves].filter((k) => !legibles.has(k)).length;
  const ilegibles = total(a.ilegibles);
  const motivos: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.ilegibles)) motivos[`ilegible:${k}`] = v!;
  for (const [k, v] of Object.entries(a.noDisputados)) motivos[`no_disputado:${k}`] = v!;
  return {
    fuente: 'fie',
    estado: faltan === 0 && ilegibles === 0 ? 'completo' : 'faltan',
    teorico: a.teorico,
    disputados: disputados(a),
    guardados: guardadas.length,
    faltanRecuperables: faltan,
    ilegibles,
    motivos,
    sobrantes,
    prioridad: a.prioridad,
    ...(a.vueltas > 1 ? { vueltas: a.vueltas } : {}),
    ...(a.realineadas ? { realineadas: a.realineadas } : {}),
  };
}

function faseOtra(fase: 'POULE' | 'TABLEAU', guardadas: AsaltoBase[], aplica: boolean | null): FaseAuditada {
  const base: FaseAuditada = {
    fuente: 'ninguna', estado: 'sin_datos', teorico: 0, disputados: 0, guardados: guardadas.length, faltanRecuperables: 0,
    ilegibles: 0, motivos: {}, sobrantes: 0, prioridad: 0,
  };
  if (guardadas.length === 0) return aplica === false ? { ...base, estado: 'no_aplica' } : base;
  const s = fase === 'POULE' ? poulesGuardadas(guardadas) : cuadroGuardado(guardadas);
  return {
    ...base,
    fuente: 'otra',
    teorico: s.teorico,
    disputados: s.teorico,
    estado: s.guardados >= s.teorico ? 'completo' : 'faltan',
    motivos: s.guardados >= s.teorico ? {} : { estructura_incompleta: s.teorico - s.guardados },
  };
}

export function auditarPrueba(p: PruebaBase, bouts: AsaltoBase[], puestos: { factKey: string }[]): PruebaAuditada {
  const crudoP = leerFieCache(p.season, p.competitionKey, 'pools');
  const crudoT = leerFieCache(p.season, p.competitionKey, 'tableau');
  const aP = analizarPoules(crudoP?.cuerpo);
  const aT = analizarCuadro(crudoT?.cuerpo);
  const gP = bouts.filter((b) => b.phase === 'POULE');
  const gT = bouts.filter((b) => b.phase === 'TABLEAU');
  const notas: string[] = [];
  if (!crudoP || !crudoT) notas.push('sin caché FIE de poules o cuadro');

  const idsRanking = puestos.map((r) => r.factKey).filter((k) => /^\d+$/.test(k));
  // Sin poules publicadas: si todos los clasificados entran en el cuadro, la prueba no tuvo poules.
  let poulesAplica: boolean | null = null;
  if (!aP.publicado && aT.publicado && idsRanking.length > 0) {
    const fuera = idsRanking.filter((k) => !aT.tiradores.has(k)).length;
    poulesAplica = fuera > 0;
    if (!poulesAplica) notas.push('eliminación directa: todos los clasificados entran en el cuadro');
  }
  const poules = aP.publicado ? faseFie(aP, gP) : faseOtra('POULE', gP, poulesAplica);
  const cuadro = aT.publicado ? faseFie(aT, gT) : faseOtra('TABLEAU', gT, null);

  let sinAsaltoEnFuente: number | null = null;
  if (aP.publicado || aT.publicado) {
    const en = new Set([...aP.tiradores, ...aT.tiradores]);
    sinAsaltoEnFuente = idsRanking.filter((k) => !en.has(k)).length;
  }

  const faltaP = poules.estado === 'faltan' || poules.estado === 'sin_datos';
  const faltaT = cuadro.estado === 'faltan' || cuadro.estado === 'sin_datos';
  const estado: PruebaAuditada['estado'] = bouts.length === 0
    ? 'sin_asaltos'
    : faltaP && faltaT ? 'faltan_ambos' : faltaP ? 'faltan_poules' : faltaT ? 'faltan_cuadro' : 'completo';
  return {
    season: p.season,
    competitionKey: p.competitionKey,
    nombre: p.editionName,
    grupo: grupoPrueba(p.editionName, p.category),
    categoria: p.category,
    arma: p.weapon,
    genero: p.gender,
    fecha: p.date ?? p.startDate,
    puestos: puestos.length,
    sinAsaltoEnFuente,
    poules,
    cuadro,
    estado,
    recuperableFie: poules.faltanRecuperables + cuadro.faltanRecuperables > 0,
    notas,
  };
}

type Resumen = Record<string, number>;
const anadir = (m: Record<string, Resumen>, k: string, estado: string) => {
  const r = (m[k] ??= { pruebas: 0 });
  r.pruebas += 1;
  r[estado] = (r[estado] ?? 0) + 1;
};

export function resumir(pruebas: PruebaAuditada[]) {
  const porTemporada: Record<string, Resumen> = {};
  const porCategoria: Record<string, Resumen> = {};
  const porGrupo: Record<string, Resumen> = {};
  const global: Resumen = { pruebas: 0 };
  const asaltos = { poulesDisputados: 0, poulesGuardados: 0, cuadroDisputados: 0, cuadroGuardados: 0,
    recuperablesFie: 0, ilegiblesFie: 0, sobrantes: 0 };
  for (const p of pruebas) {
    global.pruebas += 1;
    global[p.estado] = (global[p.estado] ?? 0) + 1;
    anadir(porTemporada, p.season, p.estado);
    anadir(porCategoria, p.categoria, p.estado);
    anadir(porGrupo, p.grupo, p.estado);
    asaltos.poulesDisputados += p.poules.disputados;
    asaltos.poulesGuardados += p.poules.guardados;
    asaltos.cuadroDisputados += p.cuadro.disputados;
    asaltos.cuadroGuardados += p.cuadro.guardados;
    asaltos.recuperablesFie += p.poules.faltanRecuperables + p.cuadro.faltanRecuperables;
    asaltos.ilegiblesFie += p.poules.ilegibles + p.cuadro.ilegibles;
    asaltos.sobrantes += p.poules.sobrantes + p.cuadro.sobrantes;
  }
  const pct = global.pruebas ? Math.round(((global.completo ?? 0) / global.pruebas) * 1000) / 10 : 0;
  return { global: { ...global, porcentajeCompletas: pct }, asaltos, porTemporada, porCategoria, porGrupo };
}

function tabla(titulo: string, m: Record<string, Resumen>): string {
  const cols = ['pruebas', 'completo', 'faltan_poules', 'faltan_cuadro', 'faltan_ambos', 'sin_asaltos'];
  const filas = Object.entries(m).sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }));
  const w = Math.max(titulo.length, ...filas.map(([k]) => k.length));
  const lineas = [`${titulo.padEnd(w)} ${cols.map((c) => c.padStart(13)).join(' ')}   %compl`];
  for (const [k, r] of filas) {
    lineas.push(`${k.padEnd(w)} ${cols.map((c) => String(r[c] ?? 0).padStart(13)).join(' ')}   ${(((r.completo ?? 0) / r.pruebas) * 100).toFixed(1).padStart(6)}`);
  }
  return lineas.join('\n');
}

export function auditar(rutaBase: string) {
  const db = abrirBase(rutaBase);
  const hoy = new Date().toISOString().slice(0, 10);
  const todas = pruebasFieIndividuales(db);
  const celebradas = todas.filter((p) => (p.date ?? p.startDate ?? '9999') < hoy);
  const conPuestos = celebradas.filter((p) => p.resultados > 0);
  const pruebas = conPuestos.map((p) => auditarPrueba(p, asaltosDeBase(db, p.id), puestosDeBase(db, p.id)));
  db.close();
  return {
    generado: new Date().toISOString(),
    base: rutaBase,
    universo: {
      individualesFie2017: todas.length,
      celebradas: celebradas.length,
      conPuestos: conPuestos.length,
      sinPuestos: celebradas.length - conPuestos.length,
    },
    resumen: resumir(pruebas),
    pruebas,
  };
}

function main() {
  const base = argumento('base', BASE_PRODUCCION);
  const salida = argumento('salida', INFORME_COMPLETITUD);
  const r = auditar(base);
  writeFileSync(salida, `${JSON.stringify(r, null, 1)}\n`);
  console.log(JSON.stringify({ universo: r.universo, global: r.resumen.global, asaltos: r.resumen.asaltos }, null, 2));
  console.log(tabla('temporada', r.resumen.porTemporada));
  console.log(tabla('categoría', r.resumen.porCategoria));
  console.log(tabla('grupo', r.resumen.porGrupo));
  console.log(`informe en ${salida}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
