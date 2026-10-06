import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  enlazarPrueba,
  sentenciasPrueba,
  temporadasVecinas,
  unaPorCompeticion,
  type CandidatoRelevo,
  type ContextoEnlace,
  type EquipoPrueba,
  type MotivoSinEnlace,
  type NivelEnlace,
  type PruebaRelevosJson,
  type ViaEnlace,
} from '../src/lib/ingest/relevos';
import { componerChunk, proyeccion } from './indexado/sincronizar-d1';

/**
 * Relevos de las pruebas por equipos a `sport_team_match` / `sport_relay`
 * (migración drizzle-d1/0010_relevos.sql).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/relevos.ts --generar --base <copia .sqlite> --salida <dir> [--origen <dir relevos>] [--solo-torneo]
 *   ... --comprobar --base <copia .sqlite> --salida <dir>
 *
 * --generar: lee los JSON de `<origen>/<fuente>/*.json` (por defecto
 *   calendario-trabajo/relevos) y la copia (sólo lectura), enlaza cada prueba
 *   con su `sport_competition` y cada tirador con una persona (componentes,
 *   mismo torneo y, si éste no da candidato, la temporada: ver
 *   src/lib/ingest/relevos.ts) y escribe ficheros SQL atómicos (lease +
 *   contexto de capacidad + cuerpo + cierre) e `informe.json`, con cada enlace
 *   y su nivel y lo que no se enlazó con su motivo. `--solo-torneo` desactiva
 *   el nivel de temporada, para medir. Se guardan todos los relevos, también
 *   los que no tienen persona: una generación posterior los enlaza.
 * --comprobar: aplica la 0010 y los ficheros sobre una base en memoria con el
 *   esquema, los datos que referencian y las guardas de la copia; comprueba
 *   recuentos, idempotencia (re-aplicar no cambia nada) y claves ajenas.
 */

const TRABAJO = join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'calendario-datos', 'calendario-trabajo');
const MIGRACION = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle-d1', '0010_relevos.sql');
const MAX_CUERPO_BYTES = 8 * 1024 * 1024;
/** D1 rechaza sentencias de más de 100 KiB. */
const MAX_SENTENCIA_BYTES = 100 * 1024;
const SALTOS = 3;

const args = process.argv.slice(2);
const arg = (nombre: string, def = '') => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const bandera = (nombre: string) => args.includes(`--${nombre}`);

function abrirBase(ruta: string) {
  if (!ruta || !existsSync(ruta)) throw new Error('falta --base <copia .sqlite>');
  return new DatabaseSync(resolve(ruta), { readOnly: true });
}

function leerPruebas(origen: string): { fichero: string; prueba: PruebaRelevosJson }[] {
  const salida: { fichero: string; prueba: PruebaRelevosJson }[] = [];
  for (const fuente of readdirSync(origen, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    for (const f of readdirSync(join(origen, fuente)).filter((x) => x.endsWith('.json') && !x.startsWith('_')).sort()) {
      const prueba = JSON.parse(readFileSync(join(origen, fuente, f), 'utf8')) as PruebaRelevosJson;
      if (prueba.schemaVersion !== 1) throw new Error(`${fuente}/${f}: schemaVersion ${prueba.schemaVersion}`);
      salida.push({ fichero: `${fuente}/${f}`, prueba });
    }
  }
  return salida;
}

type Competicion = { id: string; format: string; edition_id: string; weapon: string; gender: string; season: string };
type FilaCandidato = { person_id: string; source_name: string; source_club: string | null; source_country_code: string | null };

function lectorBase(base: DatabaseSync) {
  const porClave = base.prepare(`SELECT id, format, edition_id, weapon, gender, season FROM sport_competition WHERE source = ? AND season = ? AND competition_key = ?`);
  const porClaveSola = base.prepare(`SELECT id, format, edition_id, weapon, gender, season FROM sport_competition WHERE competition_key = ? AND format = 'EQUIPOS'`);
  const equipos = base.prepare(`SELECT source_fact_key AS ref, source_name AS nombre, source_club AS club, source_country_code AS pais FROM sport_result WHERE competition_id = ?`);
  const componentes = base.prepare(`SELECT person_id, source_name, source_club, source_country_code FROM sport_result WHERE competition_id = ? AND person_id IS NOT NULL`);
  const torneo = base.prepare(`SELECT r.person_id, r.source_name, r.source_club, r.source_country_code
    FROM sport_competition c JOIN sport_result r ON r.competition_id = c.id
    WHERE c.edition_id = ? AND c.weapon = ? AND c.gender = ? AND c.format = 'INDIVIDUAL' AND r.person_id IS NOT NULL`);
  const temporadaSql = (n: number) => base.prepare(`SELECT r.person_id, r.source_name, r.source_club, r.source_country_code
    FROM sport_competition c JOIN sport_result r ON r.competition_id = c.id
    WHERE c.season IN (${Array.from({ length: n }, () => '?').join(',')}) AND c.weapon = ? AND c.gender = ? AND c.format = 'INDIVIDUAL' AND r.person_id IS NOT NULL`);
  const pools = new Map<string, CandidatoRelevo[]>();
  const persona = base.prepare(`SELECT id, merged_into_person_id AS destino, display_name AS nombre, country_code AS pais FROM sport_person WHERE id = ?`);
  const canonicas = new Map<string, { id: string; nombre: string; pais: string | null } | null>();

  const canonica = (id: string) => {
    if (canonicas.has(id)) return canonicas.get(id)!;
    let actual = persona.get(id) as { id: string; destino: string | null; nombre: string; pais: string | null } | undefined;
    for (let salto = 0; actual?.destino && salto < SALTOS; salto += 1) {
      actual = persona.get(actual.destino) as typeof actual;
    }
    const r = actual && !actual.destino ? { id: actual.id, nombre: actual.nombre, pais: actual.pais } : null;
    canonicas.set(id, r);
    return r;
  };

  const candidatos = (filas: FilaCandidato[]): CandidatoRelevo[] => filas.flatMap((f) => {
    const c = canonica(f.person_id);
    if (!c) return [];
    const paises = [f.source_country_code, c.pais].filter((p): p is string => Boolean(p));
    return [{ personId: c.id, nombres: [f.source_name, c.nombre], clubes: f.source_club ? [f.source_club] : [], paises: [...new Set(paises)] }];
  });

  return {
    competicion(p: PruebaRelevosJson): Competicion | 'no_encontrada' | 'ambigua' {
      const exacta = porClave.get(p.source, p.season, p.competitionKey) as Competicion | undefined;
      if (exacta) return exacta;
      const otras = porClaveSola.all(p.competitionKey) as Competicion[];
      return otras.length === 1 ? otras[0] : otras.length > 1 ? 'ambigua' : 'no_encontrada';
    },
    contexto(c: Competicion, conTemporada: boolean): ContextoEnlace {
      const temporadas = temporadasVecinas(c.season);
      const clave = `${temporadas.join(',')}|${c.weapon}|${c.gender}`;
      let pool = pools.get(clave);
      if (conTemporada && !pool) {
        pool = candidatos(temporadaSql(temporadas.length).all(...temporadas, c.weapon, c.gender) as FilaCandidato[]);
        pools.set(clave, pool);
      }
      const porRef = new Map<string, EquipoPrueba>();
      for (const e of equipos.all(c.id) as { ref: string; nombre: string; club: string | null; pais: string | null }[]) {
        porRef.set(e.ref, { nombre: e.nombre, club: e.club, pais: e.pais });
      }
      return {
        equiposPorRef: porRef,
        componentes: candidatos(componentes.all(c.id) as FilaCandidato[]),
        torneo: candidatos(torneo.all(c.edition_id, c.weapon, c.gender) as FilaCandidato[]),
        ...(conTemporada ? { temporada: pool } : {}),
      };
    },
  };
}

type ResumenPrueba = {
  fichero: string;
  competitionKey: string;
  temporada: string;
  competicion: string | null;
  motivoPrueba?: 'no_encontrada' | 'ambigua' | 'no_es_de_equipos' | 'misma_prueba_que_otra';
  /** Con `misma_prueba_que_otra`: el JSON que se cargó para esa misma prueba. */
  enSuLugar?: { fichero: string; competitionKey: string; competicion: string };
  encuentros: number;
  relevos: number;
  tiradores: number;
  enlazados: number;
  relevosConLosDos: number;
  personas: number;
  candidatosTorneo: number;
  componentes: number;
  vias: Partial<Record<ViaEnlace, number>>;
  /** Tiradores enlazados (cada aparición en un relevo) por nivel. */
  niveles: Partial<Record<NivelEnlace, number>>;
  motivos: Partial<Record<MotivoSinEnlace, number>>;
  /** Cada (equipo, nombre) enlazado una vez, con su nivel. */
  enlaces: { equipo: string; nombre: string | null; personId: string; nivel: NivelEnlace; via: ViaEnlace }[];
  sinEnlace: { equipo: string; nombre: string | null; motivo: MotivoSinEnlace }[];
};

const MAX_SIN_ENLACE_POR_PRUEBA = 40;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function generar() {
  if (!arg('salida')) throw new Error('falta --salida <dir>');
  const salida = resolve(arg('salida'));
  const origen = resolve(arg('origen', join(TRABAJO, 'relevos')));
  const rutaBase = resolve(arg('base'));
  const base = abrirBase(rutaBase);
  const lector = lectorBase(base);
  const soloTorneo = bandera('solo-torneo');

  if (existsSync(salida)) for (const f of readdirSync(salida)) if (/^\d{2}-.*\.sql$/.test(f)) rmSync(join(salida, f));
  mkdirSync(salida, { recursive: true });

  const resumenes: ResumenPrueba[] = [];
  const grupos = new Map<string, { sentencias: string[]; cargo: number; pruebas: number; encuentros: number; relevos: number }[]>();

  const pruebas = leerPruebas(origen);
  const resueltas = pruebas.flatMap(({ fichero, prueba }) => {
    const c = lector.competicion(prueba);
    return typeof c === 'string' || c.format !== 'EQUIPOS' ? [] : [{
      fichero, competitionKey: prueba.competitionKey, competitionId: c.id,
      relevos: prueba.matches.reduce((s, m) => s + m.relays.length, 0),
    }];
  });
  const { descartadas } = unaPorCompeticion(resueltas);

  for (const { fichero, prueba } of pruebas) {
    const r: ResumenPrueba = {
      fichero, competitionKey: prueba.competitionKey, temporada: prueba.season, competicion: null,
      encuentros: prueba.matches.length, relevos: 0, tiradores: 0, enlazados: 0, relevosConLosDos: 0, personas: 0,
      candidatosTorneo: 0, componentes: 0, vias: {}, niveles: {}, motivos: {}, enlaces: [], sinEnlace: [],
    };
    resumenes.push(r);
    r.relevos = prueba.matches.reduce((s, m) => s + m.relays.length, 0);
    const c = lector.competicion(prueba);
    if (typeof c === 'string') {
      r.motivoPrueba = c;
      continue;
    }
    if (c.format !== 'EQUIPOS') {
      r.motivoPrueba = 'no_es_de_equipos';
      continue;
    }
    const otra = descartadas.get(fichero);
    if (otra) {
      r.motivoPrueba = 'misma_prueba_que_otra';
      r.enSuLugar = { fichero: otra.fichero, competitionKey: otra.competitionKey, competicion: c.id };
      continue;
    }
    r.competicion = c.id;
    const ctx = lector.contexto(c, !soloTorneo);
    r.candidatosTorneo = new Set(ctx.torneo.map((x) => x.personId)).size;
    r.componentes = new Set(ctx.componentes.map((x) => x.personId)).size;
    const enlaces = enlazarPrueba(prueba, ctx);
    const personas = new Set<string>();
    const vistos = new Set<string>();
    prueba.matches.forEach((m, i) => m.relays.forEach((rel, j) => {
      const e = enlaces[i][j];
      if (e.a.personId && e.b.personId) r.relevosConLosDos += 1;
      for (const [lado, equipo, nombre] of [[e.a, m.teamA.name, rel.fencerA.name], [e.b, m.teamB.name, rel.fencerB.name]] as const) {
        r.tiradores += 1;
        if (lado.personId !== null) {
          r.enlazados += 1;
          personas.add(lado.personId);
          r.vias[lado.via] = (r.vias[lado.via] ?? 0) + 1;
          r.niveles[lado.nivel] = (r.niveles[lado.nivel] ?? 0) + 1;
          const k = `${equipo}|${nombre}`;
          if (!vistos.has(k)) r.enlaces.push({ equipo, nombre, personId: lado.personId, nivel: lado.nivel, via: lado.via });
          vistos.add(k);
        } else {
          r.motivos[lado.motivo] = (r.motivos[lado.motivo] ?? 0) + 1;
          const k = `${equipo}|${nombre}|${lado.motivo}`;
          if (!vistos.has(k) && r.sinEnlace.length < MAX_SIN_ENLACE_POR_PRUEBA) r.sinEnlace.push({ equipo, nombre, motivo: lado.motivo });
          vistos.add(k);
        }
      }
    }));
    r.personas = personas.size;

    const sql = sentenciasPrueba(prueba, c.id, enlaces);
    for (const s of sql.sentencias) {
      if (Buffer.byteLength(s, 'utf8') > MAX_SENTENCIA_BYTES) throw new Error(`${fichero}: sentencia de más de 100 KiB`);
    }
    const clave = `${prueba.source}-${prueba.season}`;
    const partes = grupos.get(clave) ?? [];
    let parte = partes[partes.length - 1];
    const bytes = sql.sentencias.reduce((n, s) => n + s.length + 2, 0);
    const actual = parte ? parte.sentencias.reduce((n, s) => n + s.length + 2, 0) : 0;
    if (!parte || actual + bytes > MAX_CUERPO_BYTES) {
      parte = { sentencias: [], cargo: 0, pruebas: 0, encuentros: 0, relevos: 0 };
      partes.push(parte);
    }
    parte.sentencias.push(...sql.sentencias);
    parte.cargo += sql.cargo;
    parte.pruebas += 1;
    parte.encuentros += sql.encuentros;
    parte.relevos += sql.relevos;
    grupos.set(clave, partes);
  }

  const medido = statSync(rutaBase).size;
  const ficheros: { archivo: string; fuente: string; temporada: string; pruebas: number; encuentros: number; relevos: number; cargoBytes: number; bytes: number; sha256: string }[] = [];
  let n = 0;
  for (const grupo of [...grupos.keys()].sort()) {
    const partes = grupos.get(grupo)!;
    partes.forEach((p, i) => {
      n += 1;
      const archivo = `${String(n).padStart(2, '0')}-relevos-${grupo}${partes.length > 1 ? `-${i + 1}` : ''}.sql`;
      const texto = componerChunk(p.sentencias.map((s) => `${s};\n`).join(''), { owner: randomUUID(), medidoBytes: medido, proyectadoBytes: proyeccion(p.cargo) });
      writeFileSync(join(salida, archivo), texto);
      const [fuente, ...resto] = grupo.split('-');
      ficheros.push({
        archivo, fuente, temporada: resto.join('-'), pruebas: p.pruebas, encuentros: p.encuentros, relevos: p.relevos,
        cargoBytes: p.cargo, bytes: Buffer.byteLength(texto), sha256: createHash('sha256').update(texto, 'utf8').digest('hex'),
      });
    });
  }

  const suma = <K extends 'encuentros' | 'relevos' | 'tiradores' | 'enlazados' | 'relevosConLosDos'>(k: K, rs = resumenes) => rs.reduce((s, r) => s + r[k], 0);
  const cargadas = resumenes.filter((r) => r.competicion);
  const acumular = <T extends string>(campo: 'vias' | 'niveles' | 'motivos') => {
    const total: Partial<Record<T, number>> = {};
    for (const r of resumenes) for (const [k, v] of Object.entries(r[campo]) as [T, number][]) total[k] = (total[k] ?? 0) + v;
    return total;
  };
  const informe = {
    generado: new Date().toISOString(),
    base: rutaBase,
    origen,
    pruebas: resumenes.length,
    pruebasEnlazadas: cargadas.length,
    pruebasSinEnlace: resumenes.filter((r) => !r.competicion).map((r) => ({ fichero: r.fichero, competitionKey: r.competitionKey, motivo: r.motivoPrueba, ...(r.enSuLugar ? { enSuLugar: r.enSuLugar } : {}) })),
    encuentros: suma('encuentros', cargadas),
    relevos: suma('relevos', cargadas),
    tiradores: suma('tiradores', cargadas),
    tiradoresEnlazados: suma('enlazados', cargadas),
    tasaEnlace: pct(suma('enlazados', cargadas), suma('tiradores', cargadas)),
    relevosConLosDosEnlazados: suma('relevosConLosDos', cargadas),
    tasaRelevosConLosDos: pct(suma('relevosConLosDos', cargadas), suma('relevos', cargadas)),
    pruebasConComponentes: cargadas.filter((r) => r.componentes > 0).length,
    pruebasConCandidatosDelTorneo: cargadas.filter((r) => r.candidatosTorneo > 0).length,
    soloTorneo,
    vias: acumular<ViaEnlace>('vias'),
    niveles: acumular<NivelEnlace>('niveles'),
    motivosSinEnlace: acumular<MotivoSinEnlace>('motivos'),
    totalCargoBytes: ficheros.reduce((s, f) => s + f.cargoBytes, 0),
    ficheros,
    porPrueba: resumenes.map((r) => ({ ...r, tasaEnlace: pct(r.enlazados, r.tiradores) })),
  };
  writeFileSync(join(salida, 'informe.json'), `${JSON.stringify(informe, null, 2)}\n`);
  const { porPrueba, ficheros: fs, pruebasSinEnlace, ...corto } = informe;
  console.log(JSON.stringify({ ...corto, pruebasSinEnlace: pruebasSinEnlace.length, ficheros: `${fs.length} ficheros`, porPrueba: `${porPrueba.length} pruebas` }, null, 2));
  base.close();
}

// ------------------------------------------------------------ Comprobar ---

function comprobar() {
  const salida = resolve(arg('salida'));
  const rutaBase = resolve(arg('base'));
  const informe = JSON.parse(readFileSync(join(salida, 'informe.json'), 'utf8')) as {
    ficheros: { archivo: string; encuentros: number; relevos: number }[];
  };
  const db = new DatabaseSync(':memory:');
  db.exec(`ATTACH DATABASE 'file:${rutaBase.replace(/\\/g, '/')}?mode=ro' AS src`);
  db.exec('PRAGMA foreign_keys = OFF');
  const tablas = ['sport_person', 'sport_competition', 'sport_edition', 'athlete', 'sport_write_lease', 'sport_write_context',
    'sport_write_charge', 'sport_capacity_ledger'];
  const ddl = db.prepare(`SELECT type, name, sql FROM src.sqlite_master WHERE sql IS NOT NULL AND (tbl_name IN (${tablas.map(() => '?').join(',')}) OR name = 'sport_write_authorized') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END`).all(...tablas) as { type: string; name: string; sql: string }[];
  for (const d of ddl.filter((x) => x.type === 'table')) db.exec(d.sql);
  const yaMigrada = (db.prepare(`SELECT count(*) AS n FROM src.sqlite_master WHERE name IN ('sport_team_match','sport_relay')`).get() as { n: number }).n;
  db.exec(`INSERT INTO main.sport_person SELECT * FROM src.sport_person`);
  db.exec(`UPDATE main.sport_person SET athlete_id = NULL`);
  db.exec(`INSERT INTO main.sport_edition SELECT * FROM src.sport_edition`);
  db.exec(`INSERT INTO main.sport_competition SELECT * FROM src.sport_competition`);
  db.exec(`UPDATE main.sport_competition SET event_competition_id = NULL`);
  db.exec(`UPDATE main.sport_edition SET event_id = NULL`);
  db.exec(`INSERT INTO main.sport_capacity_ledger SELECT * FROM src.sport_capacity_ledger`);
  db.exec(`INSERT INTO main.sport_write_lease SELECT * FROM src.sport_write_lease`);
  for (const d of ddl.filter((x) => x.type !== 'table')) db.exec(d.sql);
  db.exec('DETACH DATABASE src');
  db.exec(readFileSync(MIGRACION, 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  const guardas = (db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND (name LIKE 'sport_fence_%' OR name LIKE 'sport_charge_%' OR name LIKE 'sport_context_%')`).get() as { n: number }).n;
  console.log(`Base de prueba en memoria con ${guardas} triggers de guarda${yaMigrada ? ' (la copia ya tenía la 0010; se aplica la del repositorio)' : ''}.`);
  try {
    db.exec(`INSERT INTO sport_team_match(id,competition_id,source,source_key,phase,team_a_name,team_b_name,score_a,score_b,consistent) VALUES('x',(SELECT id FROM sport_competition LIMIT 1),'x','x','TABLEAU','a','b',0,0,1)`);
    throw new Error('la guarda no bloqueó una escritura sin lease');
  } catch (e) {
    if ((e as Error).message.includes('guarda no bloqueó')) throw e;
  }
  const cuenta = () => db.prepare(`SELECT (SELECT count(*) FROM sport_team_match) AS m, (SELECT count(*) FROM sport_relay) AS r,
    (SELECT count(*) FROM sport_relay WHERE fencer_a_person_id IS NOT NULL OR fencer_b_person_id IS NOT NULL) AS p`).get() as { m: number; r: number; p: number };
  const huella = () => (db.prepare(`SELECT coalesce(sum(length(id || coalesce(fencer_a_person_id,'') || coalesce(fencer_b_person_id,'') || touches_a || touches_b || after_a || after_b)),0) AS h FROM sport_relay`).get() as { h: number }).h;
  const ledger = () => (db.prepare(`SELECT accounted_bytes AS a FROM sport_capacity_ledger`).get() as { a: number }).a;
  const ledgerAntes = ledger();
  let ok = true;
  for (const f of informe.ficheros) {
    const antes = cuenta();
    const sql = readFileSync(join(salida, f.archivo), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      console.log(`FALLO ${f.archivo}: ${(e as Error).message}`);
      ok = false;
      continue;
    }
    const despues = cuenta();
    const h = huella();
    const owner = sql.match(/VALUES\('global','([0-9a-f-]{36})'/)?.[1];
    if (!owner) throw new Error(`${f.archivo}: sin cabecera de lease`);
    const l0 = ledger();
    db.exec('BEGIN IMMEDIATE');
    db.exec(sql.replaceAll(owner, randomUUID()));
    db.exec('COMMIT');
    const reaplicado = cuenta();
    const filasCobradas = ledger() - l0;
    const bien = despues.m - antes.m === f.encuentros && despues.r - antes.r === f.relevos
      && reaplicado.m === despues.m && reaplicado.r === despues.r && huella() === h;
    ok &&= bien;
    console.log(`${bien ? 'OK' : 'DISTINTO'} ${f.archivo}: +${despues.m - antes.m} encuentros (esperados ${f.encuentros}), +${despues.r - antes.r} relevos (esperados ${f.relevos}), ${despues.p - antes.p} con persona; re-aplicado +${reaplicado.r - despues.r}, cobro ${filasCobradas} B`);
  }
  const fk = [...db.prepare('PRAGMA foreign_key_check(sport_team_match)').all(), ...db.prepare('PRAGMA foreign_key_check(sport_relay)').all()];
  const abiertos = db.prepare(`SELECT (SELECT count(*) FROM sport_write_context) + (SELECT count(*) FROM sport_write_charge) AS n`).get() as { n: number };
  const fin = db.prepare(`SELECT accounted_bytes AS a, blocked AS b FROM sport_capacity_ledger`).get() as { a: number; b: number };
  const huerfanos = (db.prepare(`SELECT count(*) AS n FROM (SELECT fencer_a_person_id AS id FROM sport_relay UNION ALL SELECT fencer_b_person_id FROM sport_relay) r
    LEFT JOIN sport_person p ON p.id = r.id WHERE r.id IS NOT NULL AND (p.id IS NULL OR p.merged_into_person_id IS NOT NULL)`).get() as { n: number }).n;
  console.log(`foreign_key_check=${fk.length} personasNoCanonicas=${huerfanos} contextosAbiertos=${abiertos.n} ledger=${fin.a} (+${fin.a - ledgerAntes}) bloqueado=${fin.b}`);
  ok &&= fk.length === 0 && abiertos.n === 0 && fin.b === 0 && huerfanos === 0;
  console.log(ok ? 'COMPROBACIÓN OK' : 'COMPROBACIÓN CON FALLOS');
  process.exitCode = ok ? 0 : 1;
}

try {
  if (bandera('generar')) generar();
  else if (bandera('comprobar')) comprobar();
  else {
    console.error('Modo: --generar --base <sqlite> --salida <dir> [--origen <dir>] | --comprobar --base <sqlite> --salida <dir>');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exitCode = 1;
}
