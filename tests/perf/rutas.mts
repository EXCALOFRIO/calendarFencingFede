/**
 * Arnés de rendimiento por ruta: por cada pantalla, las mismas lecturas que
 * hace su `page.tsx`, contra el D1 local de workerd con una copia de
 * producción. Da, por ruta:
 *
 *   - consultas: sentencias que llegan a D1;
 *   - leídas: suma de `meta.rows_read` (lo que factura Cloudflare);
 *   - devueltas: filas que vuelven a la aplicación;
 *   - idas: sentencias en serie en el camino crítico (latencia de red);
 *   - ms: tiempo de pared en local (cada ida a workerd cuesta ~1-40 ms);
 *   - motor: suma de `meta.duration`, el tiempo de SQLite;
 *   - KB datos: JSON de lo que la página pasa a sus componentes (cota inferior
 *     del RSC: el RSC real añade el marcado).
 *
 * Y las sentencias que más leen, con su plan (`EXPLAIN QUERY PLAN`) y si
 * barren una tabla entera.
 *
 *   PERF_ESTADO=<dir> [PERF_COPIA=<copia a instalar>] npx tsx tests/perf/rutas.mts [salida.json] [filtro]
 *   npx tsx tests/perf/rutas.mts --comparar antes.json despues.json
 *
 * `PERF_ESTADO` es el directorio de estado de Miniflare (ver d1-local.mts); la
 * primera vez se le da `PERF_COPIA`, una copia de trabajo preparada con
 * `preparar-copia.mts`, que se mueve dentro.
 *
 * Tamaño real de HTML y RSC: con la aplicación servida (`npm run cf:preview`
 * o producción) y una cookie de sesión,
 *
 *   PERF_URL=https://... PERF_COOKIE='neon-auth.session_token=...' npx tsx tests/perf/rutas.mts --http
 *
 * Sólo hace GET de páginas, como un navegador.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { D1Binding } from '@/db/d1/binding';
import { createD1Database } from '@/db/d1/runtime';
import { completarLecturas, idasEnSerie, medidor, type Registro } from './medidor.mts';

const args = process.argv.slice(2);

type Medida = {
  ruta: string;
  consultas: number;
  leidas: number;
  devueltas: number;
  escritas: number;
  idas: number;
  ms: number;
  motorMs: number;
  kbDatos: number;
  peores: { sql: string; leidas: number; devueltas: number; motorMs: number; plan: string[]; barridos: string[] }[];
};

// ---------------------------------------------------------------- comparar
if (args[0] === '--comparar') {
  const [a, b] = [args[1], args[2]].map((f) => JSON.parse(readFileSync(f, 'utf8')) as Medida[]);
  const porRuta = new Map(b.map((m) => [m.ruta, m]));
  const n = (x: number) => x.toLocaleString('es-ES');
  console.log('| Ruta | Consultas | Filas leídas antes | después | Δ | ms antes | después |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const x of a) {
    const y = porRuta.get(x.ruta);
    if (!y) continue;
    const d = x.leidas ? Math.round((1 - y.leidas / x.leidas) * 100) : 0;
    console.log(`| ${x.ruta} | ${x.consultas}→${y.consultas} | ${n(x.leidas)} | ${n(y.leidas)} | −${d} % | ${x.ms} | ${y.ms} |`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------- http
if (args[0] === '--http') {
  const base = process.env.PERF_URL;
  const cookie = process.env.PERF_COOKIE ?? '';
  if (!base) throw new Error('Falta PERF_URL');
  const rutas = (process.env.PERF_RUTAS ?? [
    '/', '/?mes=2019-03', '/explorar', '/explorar?q=zabala', '/explorar/siguiendo',
    '/explorar/b40372bf-0b56-4faf-a603-4e0b7f351739', '/explorar/8bf5062e-5677-4540-b2bc-1ae911cda424',
    '/explorar/cfe36c0d-bcae-4ef7-b8b5-30fdc27eec4e', '/explorar/ediciones/838ee011-1cc1-4000-9a10-b46d12f974e7',
    '/explorar/b40372bf-0b56-4faf-a603-4e0b7f351739/cara-a-cara?rival=eb4bccf2-503a-4746-ad5b-34fcaf279e0c',
    '/ranking', '/ranking?temporada=2019-2020',
  ].join(',')).split(',');
  console.log('| Ruta | HTML KB | HTML gzip KB | TTFB ms | total ms | RSC KB | RSC gzip KB |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const r of rutas) {
    const pedir = async (rsc: boolean) => {
      const t0 = performance.now();
      const res = await fetch(new URL(r, base), {
        redirect: 'manual',
        headers: { cookie, ...(rsc ? { RSC: '1' } : {}), 'accept-encoding': 'identity' },
      });
      const ttfb = performance.now() - t0;
      const cuerpo = Buffer.from(await res.arrayBuffer());
      return { estado: res.status, ttfb, total: performance.now() - t0, kb: cuerpo.length / 1024, gz: gzipSync(cuerpo).length / 1024 };
    };
    const html = await pedir(false);
    const rsc = await pedir(true);
    const f = (x: number) => x.toFixed(1);
    console.log(`| ${r} (${html.estado}) | ${f(html.kb)} | ${f(html.gz)} | ${html.ttfb.toFixed(0)} | ${html.total.toFixed(0)} | ${f(rsc.kb)} | ${f(rsc.gz)} |`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------- D1 local
const ESTADO = process.env.PERF_ESTADO;
if (!ESTADO) throw new Error('Falta PERF_ESTADO (directorio de estado de Miniflare)');
const { abrirD1Local } = await import('./d1-local.mts');
const local = await abrirD1Local(ESTADO, process.env.PERF_COPIA);
const BASE: D1Binding = local.DB;

// --aplicar <fichero.sql>: aplica una migración al D1 LOCAL (p. ej. 0015) y sale.
if (args[0] === '--aplicar') {
  const texto = readFileSync(args[1], 'utf8').replace(/--[^\n]*/g, '');
  for (const s of texto.split(';').map((x) => x.trim()).filter(Boolean)) {
    const t = performance.now();
    const r = await BASE.prepare(s).run();
    console.log(`${(performance.now() - t).toFixed(0).padStart(6)} ms  ${r.meta.rows_read} leídas  ${r.meta.rows_written} escritas  ${s.replace(/\s+/g, ' ').slice(0, 90)}`);
  }
  await local.cerrar();
  process.exit(0);
}

let registro: Registro[] = [];
const enlace = medidor(BASE, () => registro);
// `getCloudflareContext()` lee este símbolo: el `db` global de la aplicación pasa por el medidor.
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = {
  env: { DB: enlace }, ctx: { waitUntil() {}, passThroughOnException() {} }, cf: {},
};

// Importes después del contexto: algunos módulos leen el binding al cargarse.
const { db } = await import('@/db');
const { sql } = await import('drizzle-orm');
const { esquemaDeportivo } = await import('@/lib/sport/esquema-db');
const { indiceExplorarDisponible } = await import('@/lib/sport/explorar/indice-db');
const { depsEvidenciaDb } = await import('@/lib/entries/evidencia-db');
const { getManagedAthletes } = await import('@/lib/auth/session');
const { getCurrentSeason, getDataFreshness } = await import('@/lib/queries/calendar');
const { calendarioCompartido } = await import('@/lib/queries/calendario-cache');
const { cargarPantallaCalendario } = await import('@/lib/queries/calendario-pantalla');
const { quienVaDelEvento } = await import('@/lib/queries/quien-va');
const { cargarBuscarVacioCompartido, cargarCaraACaraCompartida, cargarCatalogoCompartido, cargarEdicionCompartida, fuentesPropuestasCompartidas } = await import('@/lib/sport/explorar/cache-real');
const { leerSugeridosDePersona } = await import('@/lib/sport/explorar/siguiendo-pantalla');
const { cargarSeries } = await import('@/lib/sport/explorar/ediciones-pantalla');
const { cargarCatalogoEdiciones } = await import('@/lib/sport/explorar/catalogo');
const { leerDatosIndiceEdiciones } = await import('@/lib/sport/explorar/indice-ediciones');
const { cargarExplorar } = await import('@/lib/sport/explorar/pantalla');
const { CRITERIOS_VACIOS } = await import('@/lib/sport/explorar/url');
const { cargarConteoSiguiendo, leerPropuestasParaSeguir } = await import('@/lib/sport/explorar/siguiendo-pantalla');
const { cargarInicio } = await import('@/lib/sport/explorar/inicio-pantalla');
const { sugerirPersonas } = await import('@/lib/sport/explorar/sugerencias');
const { cargarFichaPantalla } = await import('@/lib/sport/explorar/ficha-pantalla');
const { CRITERIOS_FICHA_VACIOS } = await import('@/lib/sport/explorar/ficha-url');
const { cargarEstadoFavorito } = await import('@/lib/sport/explorar/favoritos-pantalla');
const { cargarExtrasPerfil } = await import('@/lib/sport/explorar/perfil-extra');
const { cargarDiferidosPerfil } = await import('@/lib/sport/explorar/perfil-diferido');
const pd = await import('@/lib/sport/explorar/perfil-diferido');
const pc = await import('@/lib/sport/explorar/perfil-cache-real');
const pais = await import('@/lib/sport/explorar/pais-cache-real');
const paisUrl = await import('@/lib/sport/explorar/pais-url');
const { leerDueloPaises } = await import('@/lib/sport/explorar/pais');
const { leerCriteriosEdicion } = await import('@/lib/sport/explorar/edicion-url');
const { leerCriteriosCaraACara } = await import('@/lib/sport/explorar/cara-a-cara-url');
const rk = await import('@/lib/queries/ranking');
const rkt = await import('@/lib/queries/ranking-temporadas');
const { personasOficiales } = await import('@/lib/queries/personas-ranking');
const { leerPuestosOficialesVigentes, leerResumenMundial } = await import('@/lib/sport/explorar/ranking-nacional');
const { resolverPersona } = await import('@/lib/sport/explorar/personas');
const { armasInternas } = await import('@/lib/ranking/acceso-interno');
const { completarTablaFie } = await import('@/app/(app)/ranking/consultas');
const { cargarPantallaRanking, leerVistaRanking } = await import('@/app/(app)/ranking/datos');
const { leerFiltroRankingNacional } = await import('@/lib/ranking/url-nacional');
const { cargarListaSiguiendo } = await import('@/lib/sport/explorar/inicio-pantalla');
const { resolverPersonaPropia } = await import('@/lib/sport/explorar/propietario');
const { listCallUpsForAthletes } = await import('@/lib/queries/callups');
const { contarNoLeidas, leerBandeja } = await import('@/lib/notificaciones/bandeja');
const { tablaFieCompartida, conMios } = await import('@/app/(app)/ranking/compartido');
const { athlete, entry, userProfile, club, sportPerson } = await import('@/db/schema');
const { and, eq, inArray, or } = await import('drizzle-orm');
type SessionProfile = import('@/lib/auth/session').SessionProfile;
type ContextoExplorador = import('@/lib/sport/explorar/contexto').ContextoExplorador;

const HOY = process.env.PERF_HOY ?? '2026-10-08';
const LLAVADOR = 'b40372bf-0b56-4faf-a603-4e0b7f351739';
const ZABALA = '8bf5062e-5677-4540-b2bc-1ae911cda424';
const RANVIER = 'cfe36c0d-bcae-4ef7-b8b5-30fdc27eec4e';
const RIVAL = 'eb4bccf2-503a-4746-ad5b-34fcaf279e0c';
const MUNDIAL_2026 = '838ee011-1cc1-4000-9a10-b46d12f974e7';
const TNR_2026 = '31ff3c2d-d830-4724-bece-0945ba45a176';

const cuenta = (profileId: string, role: SessionProfile['role'], weapons: SessionProfile['weapons'] = []): SessionProfile => ({
  authUserId: 'perf', email: 'perf@example.test', profileId, fullName: 'Medida', role,
  clubId: null, clubName: null, icalToken: '', weapons,
});
const TIRADOR = cuenta('4e1f6cfc-2693-42dd-8876-d75e1a9c8c9e', 'athlete');
const SELECCIONADOR = cuenta('089ce449-a4ae-4a45-8697-f370d742ca80', 'coach', ['FLORETE']);

function contexto(perfil: SessionProfile): ContextoExplorador {
  const d = createD1Database(enlace);
  return {
    db: d,
    perfil: async () => perfil,
    esquema: esquemaDeportivo,
    indiceExplorar: indiceExplorarDisponible,
    hoy: () => HOY,
    propietario: {
      async atletasDeCuenta(profileId) {
        return (await getManagedAthletes(profileId)).map((a) => ({
          id: a.id, rfeeLicense: a.rfeeLicense, rfeeValidUntil: a.rfeeLicenseValidUntil,
          fieLicense: a.fieLicense, fieValidUntil: a.fieLicenseValidUntil,
        }));
      },
      async personasEnlazadas(athleteIds) {
        if (athleteIds.length === 0) return [];
        const f = await db.select({ personId: sportPerson.id, athleteId: sportPerson.athleteId })
          .from(sportPerson).where(inArray(sportPerson.athleteId, athleteIds));
        return f.flatMap((x) => (x.athleteId ? [{ personId: x.personId, athleteId: x.athleteId }] : []));
      },
      fichasFiePorAtleta: depsEvidenciaDb.fichasFiePorAtleta,
      evidencia: depsEvidenciaDb,
    },
  };
}

/** Lo que `getSessionProfile` lee de D1 en CADA petición (además de la ida a Neon Auth). */
async function sesion(perfil: SessionProfile) {
  const correo = 'nadie@example.test';
  await db.select({ id: userProfile.id }).from(userProfile)
    .where(sql`lower(trim(${userProfile.email})) = ${correo}`).limit(2);
  await db.select({ profileId: userProfile.id, clubName: club.name }).from(userProfile)
    .leftJoin(club, eq(userProfile.clubId, club.id))
    .where(and(eq(userProfile.authUserId, 'perf'), sql`lower(trim(${userProfile.email})) = ${correo}`)).limit(1);
  return perfil;
}

async function armazon(perfil: SessionProfile) {
  await sesion(perfil);
  return Promise.all([getDataFreshness(), getCurrentSeason(), getManagedAthletes(perfil.profileId)]);
}

/** Lo mismo que `(app)/page.tsx`: `cargarPantallaCalendario` (caché compartida + lo de la cuenta). */
async function calendario(perfil: SessionProfile, mes: string | null) {
  return cargarPantallaCalendario({ profileId: perfil.profileId, hoy: HOY, mes, meses: 3 });
}

async function perfilCompleto(perfil: SessionProfile, id: string) {
  const ctx = contexto(perfil);
  const diferidos = cargarDiferidosPerfil(ctx, id);
  const [vista, favorito, extras] = await Promise.all([
    cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS, { diferirRivales: true }),
    cargarEstadoFavorito(ctx, id),
    cargarExtrasPerfil(ctx, id, { conRendimiento: false }),
  ]);
  return { vista, favorito, extras, diferidos: await esperarTodo(diferidos) };
}

/**
 * El perfil por secciones: lo que leen el layout (cabecera + Resultados) y
 * cada sección al abrirse. `directo` es la lectura de D1 de siempre; sin él,
 * la caché compartida del perfil (`perfil-cache.ts`), con el favorito y la
 * propiedad de la ficha leídos aparte, en la petición.
 */
function seccionPerfil(perfil: SessionProfile, id: string, seccion: 'cabecera' | 'estadisticas' | 'rivales' | 'curiosidades' | 'ranking', directo: boolean) {
  const ctx = contexto(perfil);
  const [d, c] = [pd, pc];
  switch (seccion) {
    case 'cabecera':
      return directo
        ? Promise.all([
          cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS, { diferirRivales: true }),
          cargarEstadoFavorito(ctx, id),
          cargarExtrasPerfil(ctx, id, { conRendimiento: false }),
        ])
        : Promise.all([c.cargarCabeceraPerfil(ctx, id), cargarEstadoFavorito(ctx, id)]);
    case 'estadisticas':
      return directo ? d.cargarRendimientoPerfil(ctx, id) : c.cargarRendimientoCompartido(ctx, id);
    case 'rivales':
      return directo ? Promise.all([d.cargarRivalesPerfil(ctx, id), d.cargarRelevosPerfil(ctx, id)]) : c.cargarRivalesCompartidos(ctx, id);
    case 'curiosidades':
      return directo ? d.cargarCuriosidadesPerfil(ctx, id) : c.cargarCuriosidadesCompartidas(ctx, id);
    case 'ranking':
      // Los extras de la sección Ranking son los de la cabecera, ya leídos en la misma petición.
      return directo ? d.cargarEuropeoPerfil(ctx, id) : c.cargarEuropeoCompartido(ctx, id);
  }
}

async function rankingVigente(perfil: SessionProfile) {
  const armas = armasInternas(perfil);
  const [oficial, atletas, historicas, interno] = await Promise.all([
    rk.getRankingOficialScreenData(),
    getManagedAthletes(perfil.profileId),
    rkt.listarTemporadasNacionales(db).catch(() => [] as string[]),
    rk.getRankingScreenData(armas),
  ]);
  const mios = atletas.map((a) => a.id);
  const [fichasFie, puestos, mundial, misGruposFie, personaDe, personasRfee] = await Promise.all([
    rk.getFichasFie(mios),
    rk.getPuestosOficiales(mios),
    rk.listGruposClasificacionFie(),
    rk.gruposDeMisTiradoresFie(mios),
    rkt.personaPorAtleta(db, mios).catch(() => ({}) as Record<string, string>),
    personasOficiales(db, oficial.seasonLabel),
  ]);
  const grupos = Object.fromEntries(await Promise.all(Object.entries(personaDe).map(async ([a, p]) =>
    [a, (await resolverPersona(db, p).catch(() => null))?.ids ?? [p]] as const)));
  const [extra, fieVigente] = await Promise.all([
    Promise.all(atletas.filter((a) => grupos[a.id] && !puestos.some((p) => p.athleteId === a.id))
      .map((a) => leerPuestosOficialesVigentes(db, grupos[a.id]))),
    Promise.all(Object.entries(grupos).map(async ([a, ids]) => [a, (await leerResumenMundial(db, ids)).actuales ?? []] as const)),
  ]);
  const individual = mundial.grupos.find((g) => g.format === 'INDIVIDUAL' && g.weapon === 'FLORETE' && g.gender === 'M' && g.category === 'ABS')
    ?? mundial.grupos[0];
  const primera = individual
    ? await completarTablaFie(await rk.getClasificacionFie({ format: 'INDIVIDUAL', weapon: individual.weapon, gender: individual.gender, category: individual.category, athleteIdsPropios: mios }))
    : null;
  return { oficial, historicas, interno, fichasFie: [...fichasFie], puestos, extra, mundial, misGruposFie, personasRfee, fieVigente, primera };
}

async function rankingPasado(perfil: SessionProfile, temporada: string) {
  const atletas = await getManagedAthletes(perfil.profileId);
  const [historicas, grupos, mias] = await Promise.all([
    rkt.listarTemporadasNacionales(db),
    rkt.listarGruposNacionales(db, temporada),
    rkt.personasDeAtletas(db, atletas.map((a) => a.id)).catch(() => [] as string[]),
  ]);
  const grupo = rkt.elegirGrupo(grupos, { temporada, arma: null, genero: null, categoria: null } as never);
  const tabla = grupo ? await rkt.leerTablaNacional(db, temporada, grupo) : null;
  return { historicas, grupos, mias, tabla };
}

async function esperarTodo(o: object): Promise<Record<string, unknown>> {
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) salida[k] = await v;
  return salida;
}

/** Un torneo nacional próximo de la copia, para medir la ficha del calendario (o `PERF_FICHA`). */
const FICHA = process.env.PERF_FICHA ?? (await BASE.prepare(`SELECT id FROM event WHERE disappeared_at IS NULL AND canonical_event_id IS NULL
  AND scope = 'NACIONAL' AND start_date >= ? ORDER BY start_date, name LIMIT 1`).bind(HOY).first<{ id: string }>())?.id ?? '';
/** Otra prueba del Mundial 2026 que no es la que se abre por defecto. */
const OTRA_PRUEBA = (await BASE.prepare(`SELECT id FROM sport_competition WHERE edition_id = ?
  ORDER BY competition_date DESC, id DESC LIMIT 1`).bind(MUNDIAL_2026).first<{ id: string }>())?.id ?? '';
/** Cursor de la segunda página del cara a cara España-Italia (sin la 0018, vacío). */
const CURSOR_ESP_ITA = await leerDueloPaises(createD1Database(BASE), 'ESP', 'ITA', paisUrl.leerFiltrosDuelo({ arma: 'ESPADA', genero: 'M', categoria: 'M20' }))
  .then((d) => d.siguiente ?? '', () => '');

/**
 * Lo que hace `fichaDelEvento` (`(app)/detalle-evento.ts`) tras la sesión:
 * detalle y lista oficial de la caché compartida, «es mío» de la cuenta. Antes
 * de la fase 2 eran tres acciones (detalle, inscritos y la banda de
 * resultados), medidas como `getEvent` + `leerListaUnidaTrasGuarda` +
 * `cargarResultadosEvento`.
 */
async function fichaEvento(perfil: SessionProfile, id: string) {
  const [detalle, inscritos] = await Promise.all([
    calendarioCompartido.detalle(id),
    quienVaDelEvento(perfil, id, calendarioCompartido.listaPublica(id)),
  ]);
  return { detalle, inscritos };
}

const RUTAS: { ruta: string; cargar: () => Promise<unknown> }[] = [
  { ruta: 'armazón: sesión + layout (cada página)', cargar: () => armazon(TIRADOR) },
  { ruta: 'calendario, mes actual', cargar: () => calendario(TIRADOR, null) },
  { ruta: 'calendario, marzo 2019', cargar: () => calendario(TIRADOR, '2019-03') },
  {
    ruta: 'calendario: trimestre anterior (acción)',
    cargar: () => calendarioCompartido.tramoPasado({ desde: '2026-07-01', hasta: '2026-09-30', hoy: HOY }),
  },
  { ruta: 'calendario: ficha de evento (detalle + inscritos + resultados)', cargar: () => fichaEvento(TIRADOR, FICHA) },
  {
    ruta: 'edición Mundial 2026, otra prueba',
    cargar: () => cargarEdicionCompartida(contexto(TIRADOR), MUNDIAL_2026, leerCriteriosEdicion({ prueba: OTRA_PRUEBA })),
  },
  {
    ruta: 'catálogo de ediciones sin filtros, sin caché (antes)',
    cargar: () => { const c = contexto(TIRADOR); return Promise.all([cargarSeries(c), cargarCatalogoEdiciones(c, {})]); },
  },
  {
    ruta: 'catálogo de ediciones sin filtros',
    cargar: () => cargarCatalogoCompartido(contexto(TIRADOR), { q: '', fuente: '', temporada: '' }, undefined),
  },
  // Buscador de competiciones: la fría lee el índice de ediciones (una vez por versión); la caliente es lo que cuesta cada tecla.
  { ruta: 'competiciones: datos del índice (una vez por versión)', cargar: () => leerDatosIndiceEdiciones(contexto(TIRADOR)) },
  ...(['mndial', 'copa del mun', 'turin', 'gp turin 2024'] as const).map((q) => ({
    ruta: `competiciones «${q}» (por tecla)`,
    cargar: () => cargarCatalogoCompartido(contexto(TIRADOR), { q, fuente: '', temporada: '' }, undefined),
  })),
  {
    ruta: 'competiciones arma + categoría + años (por toque)',
    cargar: () => cargarCatalogoCompartido(contexto(TIRADOR), { q: 'copa del mundo', fuente: 'fie', temporada: '', arma: 'ESPADA', categoria: 'M20', desde: '2018', hasta: '2024' }, undefined),
  },
  { ruta: 'competiciones «turin» sin índice (antes)', cargar: () => cargarCatalogoEdiciones(contexto(TIRADOR), { q: 'turin' }) },
  { ruta: 'buscar vacío (propuestas)', cargar: () => { const c = contexto(TIRADOR); return Promise.all([cargarExplorar(c, CRITERIOS_VACIOS, undefined), cargarConteoSiguiendo(c), leerPropuestasParaSeguir(c)]); } },
  { ruta: 'buscar vacío (propuestas, caché)', cargar: () => { const c = contexto(TIRADOR); return Promise.all([cargarConteoSiguiendo(c), cargarBuscarVacioCompartido(c)]); } },
  // Feed y Siguiendo vacíos (cuenta que no sigue a nadie): antes, las propuestas iban directas a D1.
  { ruta: 'feed vacío, seleccionador (directo)', cargar: () => cargarInicio(contexto(SELECCIONADOR), {}) },
  { ruta: 'feed vacío, seleccionador (caché)', cargar: () => { const c = contexto(SELECCIONADOR); return cargarInicio(c, {}, fuentesPropuestasCompartidas(c)); } },
  { ruta: 'sugeridos de Llavador (directo)', cargar: () => leerSugeridosDePersona(contexto(TIRADOR), LLAVADOR) },
  { ruta: 'sugeridos de Llavador (caché)', cargar: () => fuentesPropuestasCompartidas(contexto(TIRADOR)).sugeridosDe!(LLAVADOR) },
  { ruta: 'buscar «zabala»', cargar: () => { const c = contexto(TIRADOR); return Promise.all([cargarExplorar(c, { ...CRITERIOS_VACIOS, q: 'zabala' }, undefined), cargarConteoSiguiendo(c)]); } },
  { ruta: 'sugerencias en vivo «zabal» (por tecla)', cargar: () => sugerirPersonas(contexto(TIRADOR), { q: 'zabal' }) },
  { ruta: 'feed (sigue a 20)', cargar: () => cargarInicio(contexto(TIRADOR), {}) },
  { ruta: 'perfil Llavador', cargar: () => perfilCompleto(TIRADOR, LLAVADOR) },
  { ruta: 'perfil Zabala', cargar: () => perfilCompleto(TIRADOR, ZABALA) },
  { ruta: 'perfil Ranvier', cargar: () => perfilCompleto(TIRADOR, RANVIER) },
  // Perfil por secciones: «directo» es D1 sin caché; «caché» es la caché compartida (la pasada caliente la encuentra llena).
  ...([['Llavador', LLAVADOR], ['Zabala', ZABALA], ['Ranvier', RANVIER]] as const).flatMap(([nombre, id]) =>
    (['cabecera', 'estadisticas', 'rivales', 'curiosidades', 'ranking'] as const).flatMap((s) => [true, false].map((directo) => ({
      ruta: `perfil ${nombre} · ${s === 'cabecera' ? 'cabecera + Resultados' : s} (${directo ? 'directo' : 'caché'})`,
      cargar: () => seccionPerfil(TIRADOR, id, s, directo),
    })))),
  { ruta: 'edición Mundial 2026 (FIE)', cargar: () => cargarEdicionCompartida(contexto(TIRADOR), MUNDIAL_2026, leerCriteriosEdicion({})) },
  { ruta: 'edición TNR 3-10-2026 (Skermo)', cargar: () => cargarEdicionCompartida(contexto(TIRADOR), TNR_2026, leerCriteriosEdicion({})) },
  { ruta: 'cara a cara Llavador, elegir rival', cargar: () => cargarCaraACaraCompartida(contexto(TIRADOR), LLAVADOR, leerCriteriosCaraACara({})) },
  {
    // Duelo y relevos en la misma entrada de la caché (antes: dos lecturas, la de relevos en un `Suspense`).
    ruta: 'cara a cara Llavador vs rival',
    cargar: () => cargarCaraACaraCompartida(contexto(TIRADOR), LLAVADOR, leerCriteriosCaraACara({ rival: RIVAL })),
  },
  // Fichas de país (0018): lo mismo que `explorar/pais/[codigo]` y `.../contra/[otro]`.
  ...([
    ['país ESP, sin filtros', 'ESP', {}],
    ['país ESP, espada M20', 'ESP', { arma: 'ESPADA', categoria: 'M20' }],
    ['país FRA, sin filtros', 'FRA', {}],
  ] as const).map(([nombre, codigo, q]) => ({
    ruta: nombre,
    cargar: () => pais.cargarFichaPaisCompartida(contexto(TIRADOR), codigo, paisUrl.leerFiltrosPais(q)),
  })),
  ...([
    ['selecciones ESP-ITA, M20 espada masculina', 'ESP', 'ITA', { arma: 'ESPADA', genero: 'M', categoria: 'M20' }],
    ['selecciones ESP-ITA, sin filtros', 'ESP', 'ITA', {}],
    ['selecciones ESP-FRA, equipos', 'ESP', 'FRA', { modalidad: 'equipos' }],
  ] as const).map(([nombre, codigo, rival, q]) => ({
    ruta: nombre,
    cargar: () => pais.cargarDueloPaisesCompartido(contexto(TIRADOR), codigo, rival, paisUrl.leerFiltrosDuelo(q), ''),
  })),
  {
    // La página siguiente de la lista va directa a D1 (con cursor no se cachea).
    ruta: 'selecciones ESP-ITA, M20 espada masculina, página 2',
    cargar: async () => {
      const f = paisUrl.leerFiltrosDuelo({ arma: 'ESPADA', genero: 'M', categoria: 'M20' });
      return pais.cargarDueloPaisesCompartido(contexto(TIRADOR), 'ESP', 'ITA', f, CURSOR_ESP_ITA);
    },
  },
  { ruta: 'ranking vigente, tirador (nacional + mundial)', cargar: () => rankingVigente(TIRADOR) },
  { ruta: 'ranking vigente, seleccionador', cargar: () => rankingVigente(SELECCIONADOR) },
  { ruta: 'ranking nacional 2019-2020', cargar: () => rankingPasado(TIRADOR, '2019-2020') },
  // Lo mismo que `ranking/page.tsx`: `cargarPantallaRanking` con la URL dada.
  ...([
    ['tirador, internacional', TIRADOR, ''],
    ['tirador, nacional', TIRADOR, 'ambito=nacional'],
    ['seleccionador, nacional', SELECCIONADOR, 'ambito=nacional'],
    ['seleccionador, internacional', SELECCIONADOR, ''],
    ['tirador, europeo', TIRADOR, 'ambito=europeo'],
    ['tirador, nacional 2019-2020', TIRADOR, 'ambito=nacional&temporada=2019-2020'],
  ] as const).map(([nombre, perfil, consulta]) => ({
    ruta: `ranking /ranking página, ${nombre}`,
    cargar: () => {
      const p = Object.fromEntries(new URLSearchParams(consulta));
      return cargarPantallaRanking(perfil, leerFiltroRankingNacional(p), leerVistaRanking(p));
    },
  })),
  {
    // Lo que lee la acción `cargarRankingNacional` al elegir otro grupo (sin la sesión).
    ruta: 'ranking nacional: otro grupo (acción)',
    cargar: async () => (await import('@/app/(app)/ranking/consultas')).leerNacionalDeGrupo({ weapon: 'ESPADA', gender: 'M', category: 'ABS' }),
  },
  {
    // Lo que lee `cargarClasificacionFie` (la acción de verdad), sin la sesión.
    ruta: 'ranking mundial: cambiar de tabla (acción, caché)', cargar: async () => {
      const [mios, tabla] = await Promise.all([
        getManagedAthletes(TIRADOR.profileId),
        tablaFieCompartida('INDIVIDUAL', 'ESPADA', 'F', 'ABS', HOY),
      ]);
      return conMios(tabla, mios.map((a) => a.id));
    },
  },
  { ruta: 'siguiendo (sigue a 20)', cargar: () => { const c = contexto(TIRADOR); return cargarListaSiguiendo(c, undefined, fuentesPropuestasCompartidas(c)); } },
  {
    // `notificaciones/page.tsx` y la campana del armazón (bandeja vacía en la copia: sólo cuesta el índice).
    ruta: 'notificaciones (bandeja + campana)',
    cargar: () => Promise.all([leerBandeja(db, TIRADOR.profileId), contarNoLeidas(db, TIRADOR.profileId)]),
  },
  ...([['tirador', TIRADOR], ['seleccionador', SELECCIONADOR]] as const).map(([nombre, perfil]) => ({
    // Lo mismo que `explorar/yo/page.tsx` («Tú»).
    ruta: `Tú, ${nombre}`,
    cargar: async () => {
      const [propia, atletas, temporada] = await Promise.all([
        resolverPersonaPropia(contexto(perfil), perfil.profileId).catch(() => null),
        getManagedAthletes(perfil.profileId),
        getCurrentSeason(),
      ]);
      const convocatorias = perfil.role === 'athlete'
        ? await listCallUpsForAthletes(atletas.map((a) => a.id)).then((l) => l.length, () => 0)
        : 0;
      return { propia, atletas, temporada, convocatorias };
    },
  })),
  {
    ruta: 'ranking mundial: cambiar de tabla (acción)', cargar: async () => {
      const mios = (await getManagedAthletes(TIRADOR.profileId)).map((a) => a.id);
      return completarTablaFie(await rk.getClasificacionFie({ format: 'INDIVIDUAL', weapon: 'ESPADA', gender: 'F', category: 'ABS', athleteIdsPropios: mios }));
    },
  },
];

/** Sigue a 20 personas del ranking FIE en la copia (sólo la copia de trabajo). */
async function sembrarSeguidas() {
  const ya = await BASE.prepare('SELECT count(*) AS n FROM sport_favorite WHERE profile_id = ?').bind(TIRADOR.profileId).first<{ n: number }>();
  if (Number(ya?.n) >= 20) return;
  const top = await BASE.prepare(`SELECT DISTINCT coalesce(per.merged_into_person_id, per.id) AS id
    FROM sport_ranking_publication p JOIN sport_ranking_entry e ON e.publication_id = p.id
    JOIN sport_person per ON per.id = e.person_id
    WHERE p.source = 'fie_tiradores' AND p.format = 'INDIVIDUAL' AND e.position <= 4 LIMIT 19`).all<{ id: string }>();
  const ids = [ZABALA, ...top.results.map((r) => r.id)];
  await BASE.batch(ids.map((id, i) => BASE.prepare('INSERT OR IGNORE INTO sport_favorite (profile_id, person_id, created_at) VALUES (?, ?, ?)')
    .bind(TIRADOR.profileId, id, 1_700_000_000_000 + i)));
}

const replacer = (_k: string, v: unknown) => (v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v);
const tablasGrandes = new Map<string, number>();
async function filasDe(tabla: string) {
  if (!tablasGrandes.has(tabla)) {
    const r = await BASE.prepare(`SELECT count(*) AS n FROM "${tabla}"`).first<{ n: number }>().catch(() => null);
    tablasGrandes.set(tabla, Number(r?.n ?? 0));
  }
  return tablasGrandes.get(tabla)!;
}

async function plan(r: Registro): Promise<{ plan: string[]; barridos: string[] }> {
  try {
    const p = await BASE.prepare(`EXPLAIN QUERY PLAN ${r.sql}`).bind(...r.params).all<{ detail: string }>();
    const plan = p.results.map((x) => x.detail);
    const barridos: string[] = [];
    for (const d of plan) {
      const m = /^SCAN (\w+)(?: AS \w+)?$/.exec(d) ?? /^SCAN (\w+)(?: AS \w+)? USING (?:COVERING )?INDEX/.exec(d);
      if (m && !/^(CONSTANT|json_each)/.test(m[1])) {
        const n = await filasDe(m[1]);
        if (n >= 1000) barridos.push(`${m[1]} (${n.toLocaleString('es-ES')} filas)${/USING/.test(d) ? ' por índice' : ''}`);
      }
      if (/AUTOMATIC/.test(d)) barridos.push(`índice automático: ${d}`);
    }
    return { plan, barridos };
  } catch {
    return { plan: [], barridos: [] };
  }
}

await sembrarSeguidas();
const filtro = args[1] ? new RegExp(args[1], 'i') : null;
const resultados: Medida[] = [];
const resumen = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 160);
/*
  Cada ruta se carga dos veces y se mide las dos: «fría» es la primera carga
  del proceso (caché compartida vacía, detectores sin memorizar) y «caliente»
  la segunda. Para que la fría de una ruta no herede lo que dejó otra, lanza
  un proceso por ruta con el filtro (ver docs/rendimiento.md).
*/
const PASADAS = [{ nombre: 'fría' }, { nombre: 'caliente' }] as const;
for (const r of RUTAS) for (const pasada of PASADAS) {
  if (filtro && !filtro.test(r.ruta)) continue;
  registro = [];
  const t0 = performance.now();
  const datos = await r.cargar();
  const ms = performance.now() - t0;
  // Lo que la caché deja en segundo plano (escrituras en memoria) no es de la ruta.
  await new Promise((fin) => setTimeout(fin, 20));
  const propio = registro;
  registro = [];
  await completarLecturas(BASE, propio);
  const kbDatos = Buffer.byteLength(JSON.stringify(datos, replacer) ?? '') / 1024;
  const peores = [];
  for (const x of [...propio].sort((a, b) => (b.leidas ?? 0) - (a.leidas ?? 0)).slice(0, Number(process.env.TOP ?? 5))) {
    peores.push({ sql: resumen(x.sql), leidas: x.leidas ?? 0, devueltas: x.devueltas, motorMs: Math.round((x.motorMs ?? 0) * 10) / 10, ...(await plan(x)) });
  }
  const m: Medida = {
    ruta: `${r.ruta} [${pasada.nombre}]`,
    consultas: propio.length,
    leidas: propio.reduce((s, x) => s + (x.leidas ?? 0), 0),
    devueltas: propio.reduce((s, x) => s + x.devueltas, 0),
    escritas: propio.reduce((s, x) => s + x.escritas, 0),
    idas: idasEnSerie(propio),
    ms: Math.round(ms),
    motorMs: Math.round(propio.reduce((s, x) => s + (x.motorMs ?? 0), 0)),
    kbDatos: Math.round(kbDatos * 10) / 10,
    peores,
  };
  resultados.push(m);
  if (process.env.PERF_VOLCAR) {
    // Todas las sentencias de la ruta, con el SQL entero, para estudiarlas una a una.
    const nombre = m.ruta.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase();
    writeFileSync(`${process.env.PERF_VOLCAR}/${nombre}.json`, JSON.stringify(propio.map((x) => ({
      leidas: x.leidas, devueltas: x.devueltas, motorMs: x.motorMs, via: x.via,
      inicio: Math.round(x.inicio - t0), fin: Math.round(x.fin - t0), sql: x.sql,
      params: x.params.map((p) => (typeof p === 'string' && p.length > 200 ? `${p.slice(0, 200)}…` : p)),
    })).sort((a, b) => (b.leidas ?? 0) - (a.leidas ?? 0)), null, 2));
  }
  console.log(`\n## ${m.ruta}\n${m.consultas} consultas, ${m.leidas.toLocaleString('es-ES')} filas leídas, ${m.devueltas.toLocaleString('es-ES')} devueltas, ${m.idas} idas en serie, ${m.ms} ms (motor ${m.motorMs} ms), ${m.kbDatos} KB de datos${m.escritas ? `, ${m.escritas} ESCRITAS` : ''}`);
  for (const p of m.peores) {
    console.log(`  ${String(p.leidas).padStart(9)} leídas ${String(p.devueltas).padStart(6)} devueltas ${String(p.motorMs).padStart(7)} ms  ${p.sql}`);
    for (const b of p.barridos) console.log(`             BARRE ${b}`);
  }
}

console.log('\n| Ruta | Consultas | Filas leídas | Devueltas | Idas | ms local | Motor ms | KB datos |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const m of resultados) {
  console.log(`| ${m.ruta} | ${m.consultas} | ${m.leidas.toLocaleString('es-ES')} | ${m.devueltas.toLocaleString('es-ES')} | ${m.idas} | ${m.ms} | ${m.motorMs} | ${m.kbDatos} |`);
}
if (args[0] && !args[0].startsWith('--')) writeFileSync(args[0], JSON.stringify(resultados, null, 2));
await local.cerrar();
