/**
 * Filas leídas (`meta.rows_read` de D1, lo que factura Cloudflare) por
 * operación, antes y después de la tanda de octubre: foto de una ficha,
 * sugerencias del buscador, cambio de tabla del ranking mundial y feed
 * «Siguiendo». Sólo D1 local (workerd) sobre una copia preparada con
 * `opt-datos.mts --preparar`; no imprime filas, parámetros ni identidades.
 *
 *   PERF_ESTADO=<estado> npx tsx tests/perf/opt-datos-oct.mts <salida.json>
 *
 * «antes» se reproduce en el MISMO estado con las sentencias anteriores
 * (siguen exportadas o se escriben aquí tal cual eran).
 */
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { abrirD1Local } from './d1-local.mts';
import { completarLecturas, medidor, type Registro } from './medidor.mts';

const estado = process.env.PERF_ESTADO;
if (!estado) throw new Error('Falta PERF_ESTADO exclusivo de este arnés');
const hoy = process.env.PERF_HOY ?? '2026-10-08';
const salida = process.argv[2];

const local = await abrirD1Local(estado, process.env.PERF_COPIA);
let registros: Registro[] = [];
const enlace = medidor(local.DB, () => registros);
const pendientes: Promise<unknown>[] = [];
const kv = new Map<string, string>();
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = {
  env: { DB: enlace, CACHE_DATOS: {
    async get(k: string) { return kv.get(k) ?? null; },
    async put(k: string, v: string) { kv.set(k, v); },
  } },
  ctx: { waitUntil(p: Promise<unknown>) { pendientes.push(p); }, passThroughOnException() {} }, cf: {},
};

type Medida = { operacion: string; variante: string; consultas: number; leidas: number; devueltas: number; ms: number; bytes: number };
const medidas: Medida[] = [];

async function medir(operacion: string, variante: string, fn: () => Promise<unknown>) {
  registros = [];
  const t = performance.now();
  const valor = await fn();
  const ms = performance.now() - t;
  await Promise.all(pendientes.splice(0));
  const propias = registros;
  registros = [];
  await completarLecturas(local.DB, propias);
  const m: Medida = {
    operacion, variante, consultas: propias.length,
    leidas: propias.reduce((s, x) => s + (x.leidas ?? 0), 0),
    devueltas: propias.reduce((s, x) => s + x.devueltas, 0),
    ms: Math.round(ms), bytes: Buffer.byteLength(JSON.stringify(valor ?? null)),
  };
  medidas.push(m);
  console.log(JSON.stringify(m));
  return valor;
}

try {
  const { createD1Database } = await import('@/db/d1/runtime');
  const { esquemaDeportivo } = await import('@/lib/sport/esquema-db');
  const { contextoPublico } = await import('@/lib/sport/explorar/contexto-publico');
  const { listaUuid } = await import('@/lib/sport/explorar/filtros-sql');
  const { leerFotoDeportista } = await import('@/lib/sport/explorar/foto');
  const { sqlIdFieConfirmado } = await import('@/lib/sport/explorar/perfil-sql');
  const sug = await import('@/lib/sport/explorar/sugerencias');
  const { ordenarSugerencias, consultaSugerencias, MAX_SUGERENCIAS_SOCIAL } = await import('@/lib/sport/explorar/sugerencias-modelo');
  const { leerOlimpicaPersonas } = await import('@/lib/sport/explorar/olimpica-perfil');
  const { crearSugerenciasCompartidas } = await import('@/lib/sport/explorar/sugerencias-cache');
  const { crearCache } = await import('@/lib/cache/cache');
  const { almacenMemoria } = await import('@/lib/cache/almacenes');
  const { leerFeedSiguiendo, olvidarMemoFeed, sqlFeedSiguiendo } = await import('@/lib/sport/explorar/seguidos');
  const { getManagedAthletes } = await import('@/lib/auth/session');
  const { tablaFieCompartida, conMios } = await import('@/app/(app)/ranking/compartido');
  const { completarTablaFie } = await import('@/app/(app)/ranking/consultas');
  const rk = await import('@/lib/queries/ranking');

  const db = createD1Database(enlace);
  const indiceExplorar = async () => true;
  // Cuenta de fixture sólo en la copia (la misma de opt-datos y rutas), que sigue a 20 personas.
  const cuenta = '4e1f6cfc-2693-42dd-8876-d75e1a9c8c9e';
  const top = await local.DB.prepare(`SELECT DISTINCT coalesce(per.merged_into_person_id, per.id) AS id
    FROM sport_ranking_publication p JOIN sport_ranking_entry e ON e.publication_id = p.id
    JOIN sport_person per ON per.id = e.person_id
    WHERE p.source = 'fie_tiradores' AND p.format = 'INDIVIDUAL' AND e.position <= 4 LIMIT 19`).all<{ id: string }>();
  const seguidas = ['8bf5062e-5677-4540-b2bc-1ae911cda424', ...top.results.map((r) => r.id)];
  await local.DB.batch(seguidas.map((id, i) => local.DB.prepare(
    'INSERT OR IGNORE INTO sport_favorite (profile_id, person_id, created_at) VALUES (?, ?, ?)',
  ).bind(cuenta, id, 1_700_000_000_000 + i)));
  const perfil = {
    authUserId: 'perf', email: 'perf@example.test', profileId: cuenta, fullName: 'Medida',
    role: 'athlete' as const, clubId: null, clubName: null, icalToken: '', weapons: [],
  };
  const base = { db, esquema: esquemaDeportivo, indiceExplorar };
  const ctx = { ...contextoPublico(hoy, base), perfil: async () => perfil, hoy: () => hoy };

  // 1. Foto de una ficha: el ID FIE confirmado del grupo.
  const fotos = await local.DB.prepare(`SELECT x.person_id AS id FROM sport_external_id x
    JOIN sport_person p ON p.id = x.person_id
    WHERE x.scheme = 'fie_addr_id' AND x.link_status = 'CONFIRMADO' AND p.birth_year < 2000
      AND p.merged_into_person_id IS NULL LIMIT 3`).all<{ id: string }>();
  for (const [i, { id }] of fotos.results.entries()) {
    await medir('foto: ID FIE del grupo', `antes #${i + 1}`, () => db.execute(sql`
      SELECT DISTINCT value AS valor FROM sport_external_id
      WHERE person_id IN (${listaUuid([id])})
        AND scheme = 'fie_addr_id' AND scope_source = 'fie' AND link_status = 'CONFIRMADO'
      ORDER BY value LIMIT 2`));
    await medir('foto: ID FIE del grupo', `despues #${i + 1}`, () => db.execute(sqlIdFieConfirmado([id])));
    await medir('foto: leerFotoDeportista completa', `despues #${i + 1}`, () => leerFotoDeportista(ctx, id, {
      almacen: null, fetch: (async () => new Response('', { status: 404 })) as typeof fetch,
    }));
  }

  // 2. Sugerencias del buscador social (límite 20), antes y con la caché fría y caliente.
  const escritas = ['garc', 'garcia', 'alej', 'alejandro', 'martinez', 'lopez', 'zabala', 'llavador', 'carlos llav'];
  const cache = crearCache({
    almacen: (() => { const m = almacenMemoria(); return () => m; })(),
    versiones: { de: async () => 'v1', olvidar() {} },
    esperar: (p) => { pendientes.push(p); },
  });
  const publicas = crearSugerenciasCompartidas({ cache, publico: (d) => contextoPublico(d, base) });
  const antes = async (texto: string) => {
    const q = consultaSugerencias(texto)!;
    const candidatos = (await db.execute(sug.sqlCandidatosIndexados(q, cuenta))) as unknown as { rows?: never[] } | never[];
    const filas = Array.isArray(candidatos) ? candidatos : candidatos.rows ?? [];
    const ids = ordenarSugerencias(q, filas, MAX_SUGERENCIAS_SOCIAL).map((s) => s.id);
    if (ids.length === 0) return [];
    return Promise.all([db.execute(sug.sqlResumenSugerencias(ids, cuenta)), leerOlimpicaPersonas(db, ids)]);
  };
  for (const q of escritas) await medir('sugerencias', `antes «${q}»`, () => antes(q));
  for (const q of escritas) await medir('sugerencias', `despues fria «${q}»`, () => sug.sugerirPersonas(ctx, { q, limite: MAX_SUGERENCIAS_SOCIAL }, { publicas }));
  for (const q of escritas) await medir('sugerencias', `despues caliente «${q}»`, () => sug.sugerirPersonas(ctx, { q, limite: MAX_SUGERENCIAS_SOCIAL }, { publicas }));

  const sinSeguidas = { ...ctx, perfil: async () => ({ ...perfil, profileId: '00000000-0000-4000-8000-0000000000ff' }) };
  for (const q of escritas.slice(0, 3)) {
    await medir('sugerencias', `despues caliente, cuenta sin seguidas «${q}»`, () => sug.sugerirPersonas(sinSeguidas, { q, limite: MAX_SUGERENCIAS_SOCIAL }, { publicas }));
  }

  // 3. Ranking mundial: cambiar de tabla (lo que hace `cargarClasificacionFie`).
  const tirador = '4e1f6cfc-2693-42dd-8876-d75e1a9c8c9e';
  await medir('ranking mundial: cambiar de tabla', 'sin caché (completarTablaFie)', async () => {
    const mios = (await getManagedAthletes(tirador)).map((a) => a.id);
    return completarTablaFie(await rk.getClasificacionFie({ format: 'INDIVIDUAL', weapon: 'ESPADA', gender: 'F', category: 'ABS', athleteIdsPropios: mios }));
  });
  for (const v of ['acción, caché fría', 'acción, caché caliente', 'acción, caché caliente (otra vez)']) {
    await medir('ranking mundial: cambiar de tabla', v, async () => {
      const [mios, tabla] = await Promise.all([
        getManagedAthletes(tirador),
        tablaFieCompartida('INDIVIDUAL', 'ESPADA', 'F', 'ABS', hoy),
      ]);
      return conMios(tabla, mios.map((a) => a.id));
    });
  }

  // 4. Feed «Siguiendo» (Inicio): primera visita y vuelta atrás.
  // Antes: las mismas sentencias del feed, sin revisión ni memo, en cada visita.
  const feedAntes = async (soloMedallas: boolean) => {
    const leer = (candidatos?: null) => db.execute(sqlFeedSiguiendo(cuenta, 20, null, soloMedallas, candidatos)) as unknown as Promise<{ rows: { umbral: string }[] }>;
    const r = await leer();
    return r.rows.length <= 20 && (r.rows.length === 0 || r.rows[0].umbral !== '0000-00-00') ? leer(null) : r;
  };
  for (const v of ['antes visita', 'antes vuelta']) await medir('feed siguiendo', v, () => feedAntes(false));
  await medir('feed siguiendo', 'antes medallas', () => feedAntes(true));
  olvidarMemoFeed(db);
  await medir('feed siguiendo', 'despues primera visita', () => leerFeedSiguiendo(ctx, { limite: 20 }));
  await medir('feed siguiendo', 'despues vuelta (<60 s)', () => leerFeedSiguiendo(ctx, { limite: 20 }));
  await medir('feed siguiendo', 'despues medallas primera', () => leerFeedSiguiendo(ctx, { limite: 20, soloMedallas: true }));
  await medir('feed siguiendo', 'despues medallas vuelta', () => leerFeedSiguiendo(ctx, { limite: 20, soloMedallas: true }));

  if (salida) writeFileSync(salida, JSON.stringify({ hoy, medidas }, null, 2));
} finally {
  await local.cerrar();
}
