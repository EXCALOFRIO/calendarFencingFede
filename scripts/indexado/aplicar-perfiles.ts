/**
 * Aplica los datos de perfil a una COPIA SQLite (nunca a producción):
 *
 *   npx tsx scripts/indexado/aplicar-perfiles.ts --db <copia.sqlite>
 *     [--fie perfiles/fie-atletas.jsonl] [--nacional perfiles/nacional.jsonl]
 *     [--hoy AAAA-MM-DD] [--con-fecha] [--simular]
 *     [--sql-salida <dir>] [--informe <fichero.json>]
 *
 * 1. Crea `perfil_deportista` (drizzle-d1/0007_perfil_deportista.sql) si falta
 *    y la reconstruye entera: nombre completo, año (y con `--con-fecha` fecha)
 *    de nacimiento, mano, altura, club y un JSON pequeño con extras de la FIE.
 * 2. Copia el año de nacimiento a `sport_person.birth_year` de la persona
 *    canónica (columna existente: es la que activa el veto de menores en la
 *    ficha, la foto y la búsqueda). Ese cambio llega a D1 por el flujo normal
 *    de `sincronizar-d1.ts --diff` contra la copia exacta de producción.
 * 3. Con `--sql-salida`, escribe los ficheros SQL de `perfil_deportista` para
 *    D1 (la tabla no tiene guardas: va fuera del espacio sport_*).
 *
 * Privacidad: a un posible menor (cumple 18 o menos este año) sólo se le
 * guarda el año, que es lo que le protege; ni fecha, ni mano, ni altura, ni extras.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { argumento, bandera, CARPETA_TRABAJO, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia } from './comun';
import { consensoFecha } from './perfiles-datos';
import type { FilaFieAtleta } from './fie-atletas';
import { mapaCanonico, type FilaNacional } from './perfiles-nacional';
import {
  clave,
  completarNombre,
  cubre,
  palabrasOriginales,
  type NombreCompleto,
  type VarianteNombre,
} from './perfiles-nombre';

const PROTEGIDAS = /^(nuevo5|nuevo6|auditoria-cruces|base|remoto)\.sqlite$/i;
const MAX_SENTENCIA_BYTES = 90_000;
const MAX_FILAS_INSERT = 100;
const CHUNK_BYTES = 5 * 1024 * 1024;
/** Igual que sincronizar-d1: 1 KiB por fila más 4 veces los bytes cambiados. */
const SOBRECOSTE_FILA = 1_024;
const FACTOR_CARGA = 4;

/** Misma regla que `posibleMenor` de src/lib/sport/explorar/ficha.ts. */
export function posibleMenor(anio: number | null, hoy: string): boolean {
  if (anio === null) return false;
  return Number(hoy.slice(0, 4)) - anio <= 18;
}

export type FilaPerfil = {
  person_id: string;
  full_name: string | null;
  given_name: string | null;
  family_name: string | null;
  name_extended: 0 | 1;
  birth_year: number | null;
  birth_date: string | null;
  birth_source: string | null;
  hand: 'L' | 'R' | null;
  height_cm: number | null;
  club_code: string | null;
  club_name: string | null;
  club_source: string | null;
  club_seen_on: string | null;
  fie_id: number | null;
  extra: string | null;
  updated_at: number;
};

const COLUMNAS: (keyof FilaPerfil)[] = [
  'person_id', 'full_name', 'given_name', 'family_name', 'name_extended', 'birth_year', 'birth_date',
  'birth_source', 'hand', 'height_cm', 'club_code', 'club_name', 'club_source', 'club_seen_on',
  'fie_id', 'extra', 'updated_at',
];

function leerJsonl<T>(ruta: string): T[] {
  if (!existsSync(ruta)) { console.warn(`(no existe ${ruta}: se sigue sin esa fuente)`); return []; }
  return readFileSync(ruta, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}

const ORDEN_FUENTE: Record<string, VarianteNombre['orden']> = { skermo_rfee: 'nombre-apellidos' };

export type EntradaPerfil = {
  personaId: string;
  actual: string;
  variantes: VarianteNombre[];
  fie: FilaFieAtleta | null;
  nacional: FilaNacional | null;
};

/** Combina todas las fuentes de UNA persona canónica en su fila de perfil. */
export function construirFila(e: EntradaPerfil, hoy: string, conFecha: boolean, ahora: number):
  { fila: FilaPerfil; nombre: NombreCompleto | null } {
  const variantes = [...e.variantes];
  if (e.fie) {
    variantes.push({ texto: e.fie.nombrePublicado, nombre: e.fie.nombre, apellidos: e.fie.apellidos, fuente: 'fie', peso: 3 });
    if (e.fie.palabrasFoto.length > 0) variantes.push({ texto: e.fie.palabrasFoto.join(' '), fuente: 'fie_foto', soloAcentos: true });
  }
  if (e.nacional) variantes.push(...e.nacional.variantes);
  const nombre = completarNombre(e.actual, variantes);

  const fechas = [...(e.nacional?.fechas ?? [])];
  if (e.fie?.fechaNacimiento) fechas.push({ fecha: e.fie.fechaNacimiento, fuente: 'fie' });
  const consenso = consensoFecha(fechas);
  let anio = consenso.anio;
  let fuenteAnio = consenso.fuente;
  const subdivision = [...new Set(e.nacional?.aniosSubdivision ?? [])];
  if (anio === null && !consenso.conflicto && subdivision.length === 1) {
    anio = subdivision[0];
    fuenteAnio = 'rfee_pdf_subdivision';
  }
  const adulto = anio !== null && !posibleMenor(anio, hoy);

  const fie = e.fie;
  let clubCodigo = e.nacional?.club?.codigo ?? null;
  let clubNombre = e.nacional?.club?.nombre ?? null;
  let clubFuente = e.nacional?.club?.fuente ?? null;
  let clubFecha = e.nacional?.club?.fecha ?? null;
  if (!clubCodigo && !clubNombre && fie && fie.clubes.length > 0 && adulto) {
    clubNombre = fie.clubes[0].nombre;
    clubFuente = 'fie_biografia';
    clubFecha = null;
  }

  const extra = fie && adulto
    ? JSON.stringify({
      fie: {
        rank: fie.puestoMundial, weapon: fie.arma, category: fie.categoria,
        medals: fie.medallas, licenseStatus: fie.licenciaEstado,
        ...(fie.clubes.length ? { clubs: fie.clubes.slice(0, 3) } : {}),
        ...(fie.residencia ? { residence: fie.residencia } : {}),
      },
      ...(nombre ? { name: { source: nombre.fuente, reason: nombre.motivo, accents: nombre.conAcentos } } : {}),
    })
    : nombre && nombre.extendido
      ? JSON.stringify({ name: { source: nombre.fuente, reason: nombre.motivo, accents: nombre.conAcentos } })
      : null;

  const fila: FilaPerfil = {
    person_id: e.personaId,
    full_name: nombre?.completo || null,
    given_name: nombre?.nombre || null,
    family_name: nombre?.apellidos || null,
    name_extended: nombre?.extendido ? 1 : 0,
    birth_year: anio,
    birth_date: conFecha && adulto && consenso.fecha ? consenso.fecha : null,
    birth_source: anio !== null ? fuenteAnio : null,
    hand: adulto && fie?.mano ? (fie.mano === 'zurdo' ? 'L' : 'R') : null,
    height_cm: adulto ? fie?.alturaCm ?? null : null,
    club_code: clubCodigo,
    club_name: clubNombre,
    club_source: clubCodigo || clubNombre ? clubFuente : null,
    club_seen_on: clubCodigo || clubNombre ? clubFecha : null,
    fie_id: fie?.fieId ?? null,
    extra,
    updated_at: ahora,
  };
  return { fila, nombre };
}

export type PropuestaVinculo = {
  fieId: number;
  personaFie: string;
  nombreFie: string;
  personaRfee: string;
  nombreRfee: string;
  fechaNacimiento: string;
};

/**
 * Personas FIE españolas sin grupo nacional que casan con UNA persona nacional
 * por fecha de nacimiento exacta y nombre (todas las palabras FIE dentro del
 * nombre RFEE). NO se fusionan ni se usan para alargar nombres: es una lista
 * para revisar con unificar-personas.
 */
export function proponerVinculos(
  fie: Map<string, FilaFieAtleta>,
  nacional: Map<string, FilaNacional>,
  canonicas: readonly { id: string; nombre: string }[],
): PropuestaVinculo[] {
  const nombres = new Map(canonicas.map((c) => [c.id, c.nombre]));
  const porFecha = new Map<string, { id: string; palabras: string[][] }[]>();
  for (const [id, n] of nacional) {
    const fechas = new Set(n.fechas.map((f) => f.fecha));
    if (fechas.size !== 1) continue;
    const palabras = n.variantes.map((v) => palabrasOriginales(v.texto).map(clave));
    if (palabras.length === 0) continue;
    const [fecha] = fechas;
    porFecha.set(fecha, [...(porFecha.get(fecha) ?? []), { id, palabras }]);
  }
  const salida: PropuestaVinculo[] = [];
  for (const [id, f] of fie) {
    if (f.pais !== 'ESP' || !f.fechaNacimiento) continue;
    if ((nacional.get(id)?.fechas.length ?? 0) > 0) continue;
    const base = palabrasOriginales(f.nombrePublicado).map(clave);
    const candidatos = (porFecha.get(f.fechaNacimiento) ?? [])
      .filter((c) => c.id !== id && c.palabras.some((p) => cubre(p, base)));
    if (candidatos.length !== 1) continue;
    salida.push({
      fieId: f.fieId, personaFie: id, nombreFie: f.nombrePublicado,
      personaRfee: candidatos[0].id, nombreRfee: nombres.get(candidatos[0].id) ?? '',
      fechaNacimiento: f.fechaNacimiento,
    });
  }
  return salida;
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

function bytesFila(f: FilaPerfil): number {
  return COLUMNAS.reduce((s, c) => s + (f[c] === null ? 0 : Buffer.byteLength(String(f[c]))), 0);
}

function emitirSql(filas: FilaPerfil[], dir: string): { ficheros: string[]; bytesSql: number } {
  mkdirSync(dir, { recursive: true });
  const ficheros: string[] = [];
  let actual: string[] = [];
  let tam = 0;
  let bytesSql = 0;
  const cerrar = () => {
    if (actual.length === 0) return;
    const ruta = join(dir, `perfil_deportista-${String(ficheros.length + 1).padStart(4, '0')}.sql`);
    writeFileSync(ruta, actual.join('\n') + '\n');
    ficheros.push(ruta);
    actual = [];
    tam = 0;
  };
  const anadir = (s: string) => {
    if (tam + s.length > CHUNK_BYTES) cerrar();
    actual.push(s);
    tam += s.length + 1;
    bytesSql += s.length + 1;
  };
  anadir('DELETE FROM perfil_deportista;');
  const cabecera = `INSERT INTO perfil_deportista (${COLUMNAS.join(', ')}) VALUES\n`;
  let valores: string[] = [];
  let tamSentencia = cabecera.length;
  const volcar = () => {
    if (valores.length === 0) return;
    anadir(`${cabecera}${valores.join(',\n')};`);
    valores = [];
    tamSentencia = cabecera.length;
  };
  for (const f of filas) {
    const v = `(${COLUMNAS.map((c) => literal(f[c])).join(', ')})`;
    if (valores.length >= MAX_FILAS_INSERT || tamSentencia + v.length + 2 > MAX_SENTENCIA_BYTES) volcar();
    valores.push(v);
    tamSentencia += v.length + 2;
  }
  volcar();
  cerrar();
  return { ficheros, bytesSql };
}

function migracionSql(): string {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(aqui, '..', '..', 'drizzle-d1', '0007_perfil_deportista.sql'), 'utf8');
  return sql.replace(/CREATE TABLE perfil_deportista/, 'CREATE TABLE IF NOT EXISTS perfil_deportista');
}

async function main() {
  const dbRuta = resolve(argumento('db', join(CARPETA_TRABAJO, 'perfiles.sqlite')));
  if (PROTEGIDAS.test(basename(dbRuta))) throw new Error(`${basename(dbRuta)} es de otro agente o copia exacta de producción: usa una copia`);
  const carpeta = join(CARPETA_TRABAJO, 'perfiles');
  const fieDefecto = existsSync(join(carpeta, 'fie-atletas-completo.jsonl'))
    ? join(carpeta, 'fie-atletas-completo.jsonl') : join(carpeta, 'fie-atletas.jsonl');
  const fieRuta = resolve(argumento('fie', fieDefecto));
  const nacionalRuta = resolve(argumento('nacional', join(carpeta, 'nacional.jsonl')));
  const hoy = argumento('hoy', new Date().toISOString().slice(0, 10));
  const conFecha = bandera('con-fecha');
  const simular = bandera('simular');
  const sqlSalida = argumento('sql-salida', '');
  const informeRuta = argumento('informe', join(carpeta, 'informe-aplicar.json'));
  const ahora = Date.now();

  const db = new DatabaseSync(dbRuta);
  prepararCopiaTrabajo(db);
  const canon = mapaCanonico(db);

  // Variantes publicadas para cada grupo de fusión: alias y nombres de sus resultados individuales.
  const variantesPorPersona = new Map<string, VarianteNombre[]>();
  const anadir = (personaId: string, v: VarianteNombre) => {
    const c = canon.get(personaId);
    if (!c) return;
    const lista = variantesPorPersona.get(c) ?? [];
    lista.push(v);
    variantesPorPersona.set(c, lista);
  };
  for (const a of db.prepare(`SELECT person_id AS p, source AS s, name_original AS n FROM sport_person_alias`).all() as { p: string; s: string; n: string }[]) {
    anadir(a.p, { texto: a.n, fuente: a.s, orden: ORDEN_FUENTE[a.s], peso: 1 });
  }
  for (const r of db.prepare(`
    SELECT r.person_id AS p, r.source AS s, r.source_name AS n, count(*) AS k
    FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id
    WHERE r.person_id IS NOT NULL AND c.format = 'INDIVIDUAL'
    GROUP BY r.person_id, r.source, r.source_name`).all() as { p: string; s: string; n: string; k: number }[]) {
    anadir(r.p, { texto: r.n, fuente: r.s, orden: ORDEN_FUENTE[r.s], peso: Number(r.k) });
  }

  const fie = new Map(leerJsonl<FilaFieAtleta>(fieRuta).map((f) => [canon.get(f.personaId) ?? f.personaId, f]));
  const nacional = new Map(leerJsonl<FilaNacional>(nacionalRuta).map((f) => [f.personaId, f]));

  const canonicas = db.prepare(`
    SELECT p.id AS id, p.display_name AS nombre, p.birth_year AS anio
    FROM sport_person p WHERE p.merged_into_person_id IS NULL`).all() as { id: string; nombre: string; anio: number | null }[];

  // Universo del informe: personas canónicas con algún resultado desde 2017.
  const recientes = new Set((db.prepare(`
    SELECT DISTINCT r.person_id AS p FROM sport_result r
    JOIN sport_competition c ON c.id = r.competition_id JOIN sport_edition e ON e.id = c.edition_id
    WHERE r.person_id IS NOT NULL AND coalesce(r.occurred_on, c.competition_date, e.start_date) >= '2017'`).all() as { p: string }[])
    .map((r) => canon.get(r.p) ?? r.p));

  const filas: FilaPerfil[] = [];
  const cambiosAnio: { id: string; anio: number }[] = [];
  const motivos: Record<string, number> = {};
  const cobertura = { personas: 0, anio: 0, fecha: 0, club: 0, clubCodigo: 0, clubNombre: 0, mano: 0, altura: 0, nombreExtendido: 0, conAcentos: 0, fie: 0, menores: 0 };
  const ejemplos: Record<string, unknown> = {};
  const muestra: string[] = [];
  const EJEMPLOS = new Set(['b40372bf-0b56-4faf-a603-4e0b7f351739', '8bf5062e-5677-4540-b2bc-1ae911cda424']);

  for (const p of canonicas) {
    const { fila, nombre } = construirFila({
      personaId: p.id,
      actual: p.nombre,
      variantes: variantesPorPersona.get(p.id) ?? [],
      fie: fie.get(p.id) ?? null,
      nacional: nacional.get(p.id) ?? null,
    }, hoy, conFecha, ahora);
    filas.push(fila);
    if (fila.birth_year !== null && fila.birth_year !== (p.anio === null ? null : Number(p.anio))) {
      cambiosAnio.push({ id: p.id, anio: fila.birth_year });
    }
    if (nombre) motivos[nombre.motivo] = (motivos[nombre.motivo] ?? 0) + 1;
    if (nombre?.extendido && muestra.length < 60 && (muestra.length < 30 || nombre.conAcentos)) {
      muestra.push(`${p.nombre} → ${nombre.completo} [${nombre.fuente}]`);
    }
    if (EJEMPLOS.has(p.id)) ejemplos[p.id] = { actual: p.nombre, ...fila, extra: fila.extra ? JSON.parse(fila.extra) : null };
    if (!recientes.has(p.id)) continue;
    cobertura.personas += 1;
    if (fila.birth_year !== null) cobertura.anio += 1;
    if (fila.birth_date !== null) cobertura.fecha += 1;
    if (fila.club_code || fila.club_name) cobertura.club += 1;
    if (fila.club_code) cobertura.clubCodigo += 1;
    if (fila.club_name) cobertura.clubNombre += 1;
    if (fila.hand) cobertura.mano += 1;
    if (fila.height_cm) cobertura.altura += 1;
    if (fila.name_extended) cobertura.nombreExtendido += 1;
    if (nombre?.conAcentos) cobertura.conAcentos += 1;
    if (fila.fie_id) cobertura.fie += 1;
    if (posibleMenor(fila.birth_year, hoy)) cobertura.menores += 1;
  }

  const propuestas = proponerVinculos(fie, nacional, canonicas);
  const propuestasRuta = join(dirname(resolve(informeRuta)), 'propuestas-vinculo-fie-rfee.jsonl');
  writeFileSync(propuestasRuta, propuestas.map((p) => JSON.stringify(p)).join('\n') + (propuestas.length ? '\n' : ''));

  const bytesTabla = filas.reduce((s, f) => s + bytesFila(f), 0);
  const cargoPersona = cambiosAnio.reduce((s, c) => s + SOBRECOSTE_FILA + FACTOR_CARGA * String(c.anio).length, 0);

  if (!simular) {
    db.exec(migracionSql());
    const guardas = quitarGuardia(db);
    try {
      db.exec('BEGIN');
      db.exec('DELETE FROM perfil_deportista');
      const ins = db.prepare(`INSERT INTO perfil_deportista (${COLUMNAS.join(', ')}) VALUES (${COLUMNAS.map(() => '?').join(', ')})`);
      for (const f of filas) ins.run(...COLUMNAS.map((c) => f[c]));
      const upd = db.prepare(`UPDATE sport_person SET birth_year = ? WHERE id = ? AND merged_into_person_id IS NULL`);
      for (const c of cambiosAnio) upd.run(c.anio, c.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      if (guardas > 0) restaurarGuardia(db);
    }
  }
  db.close();

  const sql = sqlSalida ? emitirSql(filas, resolve(sqlSalida)) : null;
  const pct = (n: number) => `${((100 * n) / Math.max(1, cobertura.personas)).toFixed(1)}%`;
  const informe = {
    db: dbRuta, fie: fieRuta, nacional: nacionalRuta, hoy, conFecha, simular,
    filasPerfil: filas.length,
    cambiosBirthYear: cambiosAnio.length,
    bytes: {
      perfilDeportistaDatos: bytesTabla,
      sportPersonCargoLedger: cargoPersona,
      sqlD1: sql?.bytesSql ?? null,
    },
    ficherosSql: sql?.ficheros ?? [],
    propuestasVinculo: { total: propuestas.length, fichero: propuestasRuta },
    motivosNombre: motivos,
    muestraExtendidos: muestra,
    coberturaDesde2017: Object.fromEntries(Object.entries(cobertura).map(([k, v]) => [k, k === 'personas' ? v : `${v} (${pct(v)})`])),
    ejemplos,
  };
  mkdirSync(dirname(resolve(informeRuta)), { recursive: true });
  writeFileSync(resolve(informeRuta), JSON.stringify(informe, null, 2));
  console.log(JSON.stringify(informe, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
