/**
 * Recupera de los ficheros de hechos de Engarde lo que la depuración de solapes
 * (`medir-solapes.ts#depurarSolapesEngarde`, dentro de `unificar-personas.ts`) tiró sin dejarlo en
 * ningún sitio. Va DESPUÉS de los ciclos de unificación y vínculo y ANTES de `sincronizar-d1`:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote9-rfee-engarde-recuperar.ts --db <copia.sqlite> \
 *     [--hechos <carpeta>] [--carpetas lote7-skermo,lote7-engarde-rfee,...] [--puestos] [--simular] \
 *     [--medir] [--hoy 2026-10-07] [--informe <json>]
 *
 * Dos pérdidas:
 *  - Fases descartadas: una prueba de Engarde emparejada con una prueba FIE se descarta entera. Un
 *    TNR que se tira el día siguiente al satélite FIE de la misma sede comparte más de la mitad de
 *    los tiradores con el satélite, así que sus poules y su cuadro desaparecen aunque la prueba
 *    Skermo del TNR no tenga ninguna. Aquí, si la lectura de Engarde ya no está en la base (ni su
 *    prueba ni su cobertura), se busca su prueba nacional (`skermo_rfee` antes que `rfee_pdf`;
 *    misma especie, ±1 día, al menos 3 nombres y el 80 % de los suyos en Engarde) y, en cada fase
 *    en la que esa prueba no tiene ningún asalto, se insertan los de Engarde (cuadro individual sin
 *    incoherencias). Si Engarde es la prueba FIE (el 80 % de los nombres en las dos direcciones) no
 *    se toca nada.
 *  - Puestos (`--puestos`, opcional): la depuración no deja los puestos de Engarde. Si la prueba
 *    destino tiene tiradores y ninguno con puesto (Criterium leídos del PDF sin clasificación) y
 *    Engarde, del mismo género, da puesto a todos los suyos, cada tirador de la destino que casa
 *    con un único nombre de Engarde recibe ese puesto; si alguno no casa, no se toca la prueba.
 * Nunca borra ni sustituye nada. Idempotente: tras aplicarse la lectura tiene cobertura y queda
 * como fundida, y los puestos ya no están vacíos.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import {
  claveRegistro, construirUnidades, evaluarUnidades, filasCatalogo, registrosNuevo7, type Registro,
} from './cobertura';
import {
  ahora, argumento, bandera, CARPETA_CACHES, CARPETA_TRABAJO, jsonCanonico, normalizarNombre, prepararCopiaTrabajo,
  quitarGuardia, restaurarGuardia, sha256, uuid,
} from './comun';
import { consistenciaCuadro } from './cuadro-consistencia';

const BASES_PROTEGIDAS = new Set(['base.sqlite', 'remoto.sqlite', 'nuevo9.sqlite']);
export const CARPETAS_POR_DEFECTO = ['lote7-skermo', 'lote7-engarde-rfee', 'lote7-pdf', 'lote7-pdf-opcional', 'lote7-faltan'];
const FUENTES_NACIONALES = ['skermo_rfee', 'rfee_pdf'] as const;
const PREFERENCIA: Record<string, number> = { skermo_rfee: 0, rfee_pdf: 1 };

type Fase = 'POULE' | 'TABLEAU';
const FASES: readonly Fase[] = ['POULE', 'TABLEAU'];

export type Lectura = { ruta: string; hechos: HechosPrueba };

export type Recuperacion = {
  clave: string;
  ruta: string;
  /** `en_base`: la prueba de Engarde sigue en la base; `fundida`: su cobertura apunta a otra prueba. */
  estado: 'en_base' | 'fundida' | 'descartada' | 'es_fie' | 'sin_destino' | 'ambigua';
  destino: { id: string; source: string; season: string; key: string; nombres: number; comunes: number } | null;
  fases: { fase: Fase; asaltos: number }[];
  fasesOmitidas: { fase: Fase; motivo: string }[];
  puestos: number;
  puestosMotivo: string | null;
};

export type InformeRecuperar = {
  lecturas: number;
  porEstado: Record<string, number>;
  asaltosInsertados: number;
  puestosRellenados: number;
  recuperaciones: Recuperacion[];
  rechazados: { ruta: string; error: string }[];
};

export function leerLecturas(raiz: string, carpetas: readonly string[]): { lecturas: Lectura[]; rechazados: InformeRecuperar['rechazados'] } {
  const porClave = new Map<string, Lectura>();
  const rechazados: InformeRecuperar['rechazados'] = [];
  const recorrer = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? recorrer(join(dir, e.name)) : e.name.endsWith('.json') && !e.name.startsWith('_') ? [join(dir, e.name)] : []);
  for (const c of carpetas) {
    const dir = join(raiz, c);
    if (!existsSync(dir)) continue;
    for (const ruta of recorrer(dir).sort()) {
      const r = hechosPrueba.safeParse(JSON.parse(readFileSync(ruta, 'utf8')));
      if (!r.success) {
        rechazados.push({ ruta, error: r.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
        continue;
      }
      const h = r.data;
      if (h.source !== 'engarde' || h.competition.format !== 'INDIVIDUAL') continue;
      const k = `${h.edition.season}|${h.competition.competitionKey}`;
      const previa = porClave.get(k);
      // La misma prueba en dos carpetas: la lectura con más asaltos.
      if (!previa || h.bouts.length > previa.hechos.bouts.length) porClave.set(k, { ruta, hechos: h });
    }
  }
  return { lecturas: [...porClave.values()], rechazados };
}

/** Asaltos como los guarda `cargar-hechos`: sin autoasaltos, con `aRef < bRef` y sin claves repetidas. */
export function asaltosOrientados(h: HechosPrueba, fase: Fase): AsaltoHecho[] {
  const out = new Map<string, AsaltoHecho>();
  for (const o of h.bouts) {
    if (o.phase !== fase || o.aRef === o.bRef) continue;
    const b: AsaltoHecho = o.aRef < o.bRef ? o : {
      ...o, aRef: o.bRef, bRef: o.aRef, aName: o.bName, bName: o.aName, scoreA: o.scoreB, scoreB: o.scoreA,
      winner: o.winner === null ? null : o.winner === 'A' ? 'B' : 'A',
    };
    const k = `${b.roundKey}\u0000${b.aRef}\u0000${b.bRef}`;
    if (!out.has(k)) out.set(k, b);
  }
  return [...out.values()];
}

const nombresDeHechos = (h: HechosPrueba) =>
  new Set([...h.results.map((r) => r.name), ...h.bouts.flatMap((b) => [b.aName, b.bName])].map(normalizarNombre).filter(Boolean));

const dia = (f: string) => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);
const fechaDia = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);

type Comp = { id: string; source: string; season: string; competition_key: string; gender: string };

export function planificar(db: DatabaseSync, lecturas: readonly Lectura[], opciones: { puestos?: boolean } = {}): Recuperacion[] {
  const existe = db.prepare(`SELECT id FROM sport_competition WHERE source='engarde' AND season=? AND competition_key=?`);
  const coberturas = db.prepare(`SELECT DISTINCT competition_id id FROM sport_import_coverage
    WHERE source='engarde' AND season=? AND competition_key=? AND competition_id IS NOT NULL`);
  const hayCobertura = db.prepare(`SELECT 1 FROM sport_import_coverage WHERE source='engarde' AND season=? AND competition_key=? LIMIT 1`);
  const comp = db.prepare(`SELECT id, source, season, competition_key, gender FROM sport_competition WHERE id=?`);
  const candidatas = db.prepare(`SELECT c.id, c.source, c.season, c.competition_key, c.gender
      FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE c.source IN ('skermo_rfee', 'rfee_pdf', 'fie') AND c.weapon=? AND c.category=? AND c.format=?
       AND coalesce(c.competition_date, e.start_date) BETWEEN ? AND ?`);
  const nombresResultados = db.prepare(`SELECT source_name n FROM sport_result WHERE competition_id=?`);
  const nombresAsaltos = db.prepare(`SELECT fencer_a_name a, fencer_b_name b FROM sport_bout WHERE competition_id=?`);
  const asaltosFase = db.prepare(`SELECT count(*) n FROM sport_bout WHERE competition_id=? AND phase=?`);
  const puestosDestino = db.prepare(`SELECT count(*) n, count(position) p FROM sport_result WHERE competition_id=?`);
  const filasDestino = db.prepare(`SELECT source_name n FROM sport_result WHERE competition_id=?`);
  const nombres = (id: string) => {
    const s = new Set((nombresResultados.all(id) as { n: string }[]).map((r) => normalizarNombre(r.n)).filter(Boolean));
    if (s.size > 0) return s;
    for (const b of nombresAsaltos.all(id) as { a: string; b: string }[]) for (const n of [b.a, b.b]) s.add(normalizarNombre(n));
    s.delete('');
    return s;
  };
  const comunes = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;

  const out: Recuperacion[] = [];
  for (const { ruta, hechos: h } of lecturas) {
    const r: Recuperacion = {
      clave: h.competition.competitionKey, ruta, estado: 'sin_destino', destino: null, fases: [], fasesOmitidas: [], puestos: 0, puestosMotivo: null,
    };
    out.push(r);
    const season = h.edition.season;
    if (existe.get(season, r.clave)) {
      r.estado = 'en_base';
      continue;
    }
    const enE = nombresDeHechos(h);
    let destino: Comp | null = null;
    const fundidas = (coberturas.all(season, r.clave) as { id: string }[]).map((x) => comp.get(x.id) as Comp | undefined).filter((x): x is Comp => !!x);
    if (fundidas.length > 0 || hayCobertura.get(season, r.clave)) {
      r.estado = 'fundida';
      destino = fundidas.length === 1 ? fundidas[0] : null;
    } else {
      const fecha = h.competition.date ?? h.edition.startDate;
      if (!fecha) continue;
      const d = dia(fecha);
      const cands = (candidatas.all(h.competition.weapon, h.competition.category, h.competition.format, fechaDia(d - 1), fechaDia(d + 1)) as Comp[])
        .filter((c) => c.gender === h.competition.gender || c.gender === 'MIXTO' || h.competition.gender === 'MIXTO')
        .map((c) => ({ c, n: nombres(c.id) }))
        .map((x) => ({ ...x, comunes: comunes(x.n, enE) }));
      if (cands.some((x) => x.c.source === 'fie' && x.comunes >= 0.8 * x.n.size && x.comunes >= 0.8 * enE.size)) {
        r.estado = 'es_fie';
        continue;
      }
      const nacionales = cands
        .filter((x) => (FUENTES_NACIONALES as readonly string[]).includes(x.c.source) && x.comunes >= 3 && x.comunes >= 0.8 * x.n.size)
        .sort((a, b) => PREFERENCIA[a.c.source] - PREFERENCIA[b.c.source] || b.comunes - a.comunes || (a.c.id < b.c.id ? -1 : 1));
      if (nacionales.length === 0) continue;
      const mejor = nacionales[0];
      // Otra clasificación distinta dentro de la misma lectura (veteranos por franjas, Criterium por
      // años): es una prueba conjunta y no se reparte aquí.
      if (nacionales.slice(1).some((x) => comunes(x.n, mejor.n) < 0.5 * Math.min(x.n.size, mejor.n.size))) {
        r.estado = 'ambigua';
        continue;
      }
      r.estado = 'descartada';
      destino = mejor.c;
    }
    if (!destino) continue;
    const nd = nombres(destino.id);
    r.destino = { id: destino.id, source: destino.source, season: destino.season, key: destino.competition_key, nombres: nd.size, comunes: comunes(nd, enE) };

    if (r.estado === 'descartada') {
      for (const fase of FASES) {
        const nuevos = asaltosOrientados(h, fase);
        if (nuevos.length === 0) continue;
        if (Number((asaltosFase.get(destino.id, fase) as { n: number }).n) > 0) {
          r.fasesOmitidas.push({ fase, motivo: 'destino_con_asaltos' });
          continue;
        }
        if (fase === 'TABLEAU' && consistenciaCuadro(nuevos).incoherentes.size > 0) {
          r.fasesOmitidas.push({ fase, motivo: 'cuadro_incoherente' });
          continue;
        }
        r.fases.push({ fase, asaltos: nuevos.length });
      }
    }

    if (opciones.puestos) r.puestosMotivo = motivoPuestos(h, destino, puestosDestino, filasDestino);
    if (opciones.puestos && r.puestosMotivo === null) r.puestos = Number((puestosDestino.get(destino.id) as { n: number }).n);
  }
  return out;
}

type Sentencia = ReturnType<DatabaseSync['prepare']>;

/** null si los puestos de Engarde pueden rellenar los de la destino; si no, el motivo. */
function motivoPuestos(h: HechosPrueba, destino: Comp, puestosDestino: Sentencia, filasDestino: Sentencia): string | null {
  const p = puestosDestino.get(destino.id) as { n: number; p: number };
  if (Number(p.n) === 0) return 'destino_sin_tiradores';
  if (Number(p.p) > 0) return 'destino_con_puestos';
  if (h.results.length === 0 || h.results.some((x) => x.position === null)) return 'engarde_sin_puestos';
  if (h.competition.gender !== destino.gender) return 'genero_distinto';
  const plan = emparejarPuestos((filasDestino.all(destino.id) as { n: string }[]).map((x) => x.n), h);
  return plan ? null : 'nombres_sin_pareja';
}

/** Puesto de Engarde de cada nombre de la destino, o null si alguno no casa con un único nombre. */
export function emparejarPuestos(nombresDestino: readonly string[], h: HechosPrueba): Map<string, { position: number; positionRaw: string | null }> | null {
  const porNombre = new Map<string, { position: number; positionRaw: string | null } | null>();
  for (const x of h.results) {
    const n = normalizarNombre(x.name);
    porNombre.set(n, porNombre.has(n) ? null : { position: x.position!, positionRaw: x.positionRaw ?? String(x.position) });
  }
  const out = new Map<string, { position: number; positionRaw: string | null }>();
  for (const n of nombresDestino) {
    const p = porNombre.get(normalizarNombre(n));
    if (!p) return null;
    out.set(n, p);
  }
  return out;
}

function aplicarPlan(db: DatabaseSync, plan: readonly Recuperacion[], porRuta: ReadonlyMap<string, HechosPrueba>): { asaltos: number; puestos: number } {
  const personas = db.prepare(`SELECT source_name n, person_id p FROM sport_result WHERE competition_id=? AND person_id IS NOT NULL`);
  const insertarAsalto = db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref,
      fencer_a_person_id, fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, occurred_on, source_url, content_hash,
      revision, first_seen_at, revised_at) VALUES (?,?,'engarde',?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`);
  const insertarCobertura = db.prepare(`INSERT INTO sport_import_coverage (id, source, season, fact_kind, competition_key, competition_id,
      status, published_total, imported_total, attempts, source_url, last_checked_at, updated_at) VALUES (?,'engarde',?,?,?,?,?,?,?,1,?,?,?)`);
  const filas = db.prepare(`SELECT id, source_name n FROM sport_result WHERE competition_id=? AND position IS NULL`);
  const ponerPuesto = db.prepare(`UPDATE sport_result SET position=?, position_raw=?, revision=revision+1, revised_at=? WHERE id=? AND position IS NULL`);
  let asaltos = 0;
  let puestos = 0;
  const t = ahora();
  for (const r of plan) {
    if (!r.destino) continue;
    const h = porRuta.get(r.ruta)!;
    const porNombre = new Map<string, string | null>();
    for (const x of personas.all(r.destino.id) as { n: string; p: string }[]) {
      const n = normalizarNombre(x.n);
      porNombre.set(n, porNombre.has(n) && porNombre.get(n) !== x.p ? null : x.p);
    }
    const persona = (nombre: string) => porNombre.get(normalizarNombre(nombre)) ?? null;
    const fecha = h.competition.date ?? h.edition.startDate;
    for (const { fase } of r.fases) {
      const lista = asaltosOrientados(h, fase);
      for (const b of lista) {
        const pa = persona(b.aName);
        let pb = persona(b.bName);
        if (pa !== null && pa === pb) pb = null;
        const hash = sha256(jsonCanonico({ source: h.source, competitionKey: r.clave, fact: b }));
        insertarAsalto.run(uuid(), r.destino.id, fase, b.roundKey, b.aRef, b.bRef, pa, pb, b.aName, b.bName, b.scoreA, b.scoreB,
          fecha, h.sourceUrl, hash, t, t);
        asaltos += 1;
      }
      const s = fase === 'POULE' ? 'pools' : 'tableau';
      const estado = h.status[s] === 'ilegible' ? 'error' : h.status[s];
      insertarCobertura.run(uuid(), h.edition.season, s, r.clave, r.destino.id, estado, null, lista.length, h.sourceUrl, t, t);
    }
    if (r.puestos > 0) {
      const lista = filas.all(r.destino.id) as { id: string; n: string }[];
      const pareja = emparejarPuestos(lista.map((x) => x.n), h);
      if (!pareja) continue;
      for (const x of lista) {
        const p = pareja.get(x.n)!;
        puestos += Number(ponerPuesto.run(p.position, p.positionRaw, t, x.id).changes);
      }
    }
  }
  return { asaltos, puestos };
}

export function recuperar(db: DatabaseSync, lecturas: readonly Lectura[], opciones: { simular?: boolean; puestos?: boolean } = {}): InformeRecuperar {
  const plan = planificar(db, lecturas, opciones);
  const inf: InformeRecuperar = { lecturas: lecturas.length, porEstado: {}, asaltosInsertados: 0, puestosRellenados: 0, recuperaciones: plan, rechazados: [] };
  for (const r of plan) inf.porEstado[r.estado] = (inf.porEstado[r.estado] ?? 0) + 1;
  if (opciones.simular) {
    inf.asaltosInsertados = plan.reduce((s, r) => s + r.fases.reduce((x, f) => x + f.asaltos, 0), 0);
    inf.puestosRellenados = plan.reduce((s, r) => s + r.puestos, 0);
    return inf;
  }
  const porRuta = new Map(lecturas.map((l) => [l.ruta, l.hechos] as const));
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  try {
    db.exec('BEGIN');
    try {
      const x = aplicarPlan(db, plan, porRuta);
      inf.asaltosInsertados = x.asaltos;
      inf.puestosRellenados = x.puestos;
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    restaurarGuardia(db);
  }
  return inf;
}

// ------------------------------------------------------------------ medición en simulación

export type Medida = { completas: number; clasificacion: number; pruebas: number };
export type MedidaRecuperacion = { antes: Medida; despues: Medida; completadas: string[]; conClasificacion: string[] };

/** Lecturas de la base con lo que el plan añadiría (asaltos de cada fase y puestos), sin escribir. */
export function registrosConPlan(registros: readonly Registro[], plan: readonly Recuperacion[], porRuta: ReadonlyMap<string, HechosPrueba>): Registro[] {
  const porClave = new Map<string, Registro>(registros.map((r) => [claveRegistro(r), { ...r, parcial: { ...r.parcial } }]));
  for (const p of plan) {
    if (!p.destino) continue;
    const r = porClave.get(`${p.destino.source}|${p.destino.season}|${p.destino.key}`);
    if (!r) continue;
    const h = porRuta.get(p.ruta)!;
    for (const { fase } of p.fases) {
      const lista = asaltosOrientados(h, fase);
      if (fase === 'POULE') {
        r.pb += lista.length;
        r.poulesRondas = new Set(lista.map((b) => b.roundKey)).size;
        r.poulesTiradores = new Set(lista.flatMap((b) => [b.aRef, b.bRef])).size;
      } else r.tb += lista.length;
    }
    if (p.puestos > 0) r.conPuesto = r.res;
  }
  return [...porClave.values()];
}

export function medirRfee(registros: readonly Registro[], catalogo: Parameters<typeof construirUnidades>[0]['catalogo'], hoy: string) {
  const us = evaluarUnidades(construirUnidades({ nuevo7: [...registros], lote7: [], lote8: [], catalogo, efcPendientes: [], hoy }))
    .filter((u) => u.fuente === 'RFEE');
  return us;
}

export function medirRecuperacion(registros: readonly Registro[], plan: readonly Recuperacion[], porRuta: ReadonlyMap<string, HechosPrueba>,
  catalogo: Parameters<typeof construirUnidades>[0]['catalogo'], hoy: string): MedidaRecuperacion {
  const antes = medirRfee(registros, catalogo, hoy);
  const despues = new Map(medirRfee(registrosConPlan(registros, plan, porRuta), catalogo, hoy).map((u) => [u.id, u] as const));
  const medida = (us: Iterable<{ ev: { antes: { completa: boolean; clasificacion: boolean } } }>): Medida => {
    const m = { completas: 0, clasificacion: 0, pruebas: 0 };
    for (const u of us) {
      m.pruebas += 1;
      if (u.ev.antes.completa) m.completas += 1;
      if (u.ev.antes.clasificacion) m.clasificacion += 1;
    }
    return m;
  };
  const completadas: string[] = [];
  const conClasificacion: string[] = [];
  for (const u of antes) {
    const d = despues.get(u.id);
    if (!d) continue;
    if (d.ev.antes.completa && !u.ev.antes.completa) completadas.push(`${u.id} ${u.nombre} ${u.weapon} ${u.gender} ${u.category}`);
    if (d.ev.antes.clasificacion && !u.ev.antes.clasificacion) conClasificacion.push(`${u.id} ${u.nombre} ${u.weapon} ${u.gender} ${u.category}`);
  }
  return { antes: medida(antes), despues: medida(despues.values()), completadas, conClasificacion };
}

function main(): void {
  const rutaDb = argumento('db', '');
  if (!rutaDb || !existsSync(rutaDb)) throw new Error('Uso: --db <copia de trabajo .sqlite> (obligatorio; nunca el remoto)');
  const simular = bandera('simular');
  if (!simular && BASES_PROTEGIDAS.has(basename(rutaDb).toLowerCase())) throw new Error(`${basename(rutaDb)} es de sólo lectura`);
  const raiz = argumento('hechos', join(CARPETA_TRABAJO, 'hechos'));
  const carpetas = argumento('carpetas', CARPETAS_POR_DEFECTO.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const puestos = bandera('puestos');
  const { lecturas, rechazados } = leerLecturas(raiz, carpetas);
  const db = new DatabaseSync(rutaDb, simular ? { readOnly: true } : {});
  const inf = recuperar(db, lecturas, { simular, puestos });
  inf.rechazados = rechazados;
  let medida: MedidaRecuperacion | null = null;
  if (bandera('medir')) {
    if (!simular) throw new Error('--medir sólo con --simular (mide sobre la base sin escribir)');
    const hoy = argumento('hoy', new Date().toISOString().slice(0, 10));
    const inv = JSON.parse(readFileSync(argumento('inventario', join(CARPETA_CACHES, 'history-national', 'national-inventory.json')), 'utf8'));
    medida = medirRecuperacion(registrosNuevo7(db), inf.recuperaciones, new Map(lecturas.map((l) => [l.ruta, l.hechos] as const)), filasCatalogo(inv, hoy), hoy);
  }
  db.close();
  const salida = argumento('informe', '');
  if (salida) writeFileSync(salida, JSON.stringify({ ...inf, medida }, null, 2));
  const utiles = inf.recuperaciones.filter((r) => r.fases.length > 0 || r.puestos > 0);
  console.log(JSON.stringify({
    lecturas: inf.lecturas, porEstado: inf.porEstado, asaltosInsertados: inf.asaltosInsertados, puestosRellenados: inf.puestosRellenados,
    rechazados: inf.rechazados.length,
    recuperaciones: utiles.map((r) => ({ clave: r.clave, estado: r.estado, destino: r.destino && `${r.destino.source}:${r.destino.key} (${r.destino.comunes}/${r.destino.nombres})`, fases: r.fases, puestos: r.puestos })),
    omitidas: inf.recuperaciones.filter((r) => r.fasesOmitidas.length > 0).map((r) => ({ clave: r.clave, omitidas: r.fasesOmitidas })),
    medida,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
