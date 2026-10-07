/**
 * Capturas sin servidor de la bandeja de notificaciones y de Ajustes ›
 * Notificaciones a 320, 393 y 1440 px, con avisos generados por el código
 * real (`notificarEventosDeportivos`, `registrarLecturasPerfil`,
 * `construirAvisosCalendario`) sobre pruebas, personas y torneos reales de la
 * copia de producción. Falla si algo se desborda en horizontal en el móvil.
 *
 *   PERF_DB=<copia SQLite de producción> npx tsx tests/ui/notificaciones.mts
 *
 * La copia se adjunta en SOLO LECTURA. Lo simulado (una cuenta, sus dos
 * tiradoras, una inscripción, a quién sigue, las preferencias y los avisos) va
 * en un SQLite temporal que se borra al terminar. Para poder vincular la cuenta
 * a personas reales, ese temporal lleva una copia de SOLO las filas de
 * `sport_person` y `sport_competition` de las cuatro pruebas elegidas, que
 * tapan a las de la copia; todo lo demás se lee de la copia.
 *
 * Salida en `capturas/notificaciones/`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { createD1Database } from '@/db/d1/runtime';
import { AjustesNotificaciones, type AccionesAjustes, type EstadoPush } from '@/components/notificaciones/ajustes';
import { AccionesNotificaciones, BandejaNotificaciones } from '@/components/notificaciones/bandeja';
import { cabeceraDeRuta } from '@/components/navegacion-app';
import { CabeceraCompacta } from '@/components/sistema/cabecera-compacta';
import { abrirAviso, agruparBandeja, contarNoLeidas, guardarAvisos, leerBandeja, leerPreferenciasDe } from '@/lib/notificaciones/bandeja';
import { construirAvisosCalendario, type EventoCalendario } from '@/lib/notificaciones/calendario';
import { registrarLecturasPerfil } from '@/lib/notificaciones/perfil';
import { notificarEventosDeportivos } from '@/lib/notificaciones/resultados';
import { listEvents } from '@/lib/queries/calendar';
import { hoyMadrid, parseFechaMadrid } from '@/lib/callups/fechas';
import { nombreVisible } from '@/lib/sport/nombre-visible';

const RAIZ = process.cwd();
const SALIDA = process.env.SALIDA ? path.resolve(process.env.SALIDA) : path.join(RAIZ, 'capturas', 'notificaciones', 'v2');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');

// ---------------------------------------------------------------- base temporal

const TEMPORAL = path.join(tmpdir(), `notificaciones-${process.pid}.sqlite`);
if (existsSync(TEMPORAL)) rmSync(TEMPORAL);
const sqlite = new DatabaseSync(TEMPORAL, { enableForeignKeyConstraints: false });
sqlite.exec(`ATTACH DATABASE 'file:${BASE.replace(/\\/g, '/')}?mode=ro' AS src`);

const SQL_0000 = readFileSync(path.join(RAIZ, 'drizzle-d1', '0000_aplicacion.sql'), 'utf8');
function crearComoEn0000(tabla: string) {
  const m = new RegExp('CREATE TABLE `' + tabla + '` \\([\\s\\S]*?\\n\\);').exec(SQL_0000);
  if (!m) throw new Error(`sin CREATE TABLE ${tabla} en la 0000`);
  sqlite.exec(m[0]);
}
for (const t of ['user_profile', 'athlete', 'entry', 'sport_favorite', 'sport_person', 'sport_competition']) crearComoEn0000(t);
sqlite.exec(readFileSync(path.join(RAIZ, 'drizzle-d1', '0014_notificaciones.sql'), 'utf8'));

function valor(v: unknown): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new TypeError(`valor no admitido: ${typeof v}`);
}

/** Como `bindingDeLectura`, pero con escritura: los avisos se guardan en el temporal. */
function binding(): D1Binding {
  function sentencia(query: string, values: unknown[] = []): D1Statement & { _x: () => D1QueryResult<unknown> } {
    const ejecutar = (): D1QueryResult<unknown> => {
      const p = sqlite.prepare(query);
      const params = values.map(valor);
      const rows = p.columns().length > 0 ? p.all(...params) : (p.run(...params), []);
      return { success: true, results: rows, meta: { duration: 0, changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0 } } as D1QueryResult<unknown>;
    };
    return {
      _x: ejecutar,
      bind: (...p: unknown[]) => sentencia(query, p),
      all: async <T,>() => ejecutar() as D1QueryResult<T>,
      run: async <T,>() => ejecutar() as D1QueryResult<T>,
      raw: async <T,>() => ejecutar().results.map((x) => Object.values(x as object)) as unknown as T[],
      first: async <T,>(columna?: string) => {
        const fila = ejecutar().results[0] as Record<string, unknown> | undefined;
        return (fila ? (columna ? fila[columna] : fila) : null) as T | null;
      },
    } as never;
  }
  return {
    prepare: (q) => sentencia(q),
    batch: async <T,>(sts: D1Statement[]) => sts.map((s) => (s as unknown as { _x: () => D1QueryResult<T> })._x()),
  };
}

const enlace = binding();
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: enlace }, ctx: {}, cf: {} };
const db = createD1Database(enlace);

// ---------------------------------------------------------------- datos simulados sobre pruebas reales

const informe: string[] = [];
const AHORA = Date.now();
const HORA = 3_600_000;

type Prueba = { id: string; nombre: string; fecha: string };
const pruebas = sqlite.prepare(`
  SELECT c.id, e.name AS nombre, c.competition_date AS fecha FROM src.sport_competition c JOIN src.sport_edition e ON e.id = c.edition_id
  WHERE c.format = 'INDIVIDUAL' AND c.competition_date <= date('now')
    AND (SELECT count(*) FROM src.sport_result r WHERE r.competition_id = c.id AND r.person_id IS NOT NULL AND r.position IS NOT NULL) >= 12
  ORDER BY c.competition_date DESC, c.id LIMIT 4`).all() as Prueba[];
if (pruebas.length < 4) throw new Error('la copia no tiene cuatro pruebas individuales con resultados');
const ids = JSON.stringify(pruebas.map((p) => p.id));

sqlite.exec(`INSERT INTO main.sport_competition SELECT * FROM src.sport_competition WHERE id IN (SELECT value FROM json_each('${ids}'))`);
// Las personas de esas pruebas, aquella en la que se fundieron y las fundidas en ellas.
sqlite.exec(`
  CREATE TEMP TABLE personas_prueba AS SELECT DISTINCT person_id AS id FROM src.sport_result
    WHERE competition_id IN (SELECT value FROM json_each('${ids}')) AND person_id IS NOT NULL;
  INSERT OR IGNORE INTO main.sport_person SELECT * FROM src.sport_person WHERE id IN (SELECT id FROM personas_prueba);
  INSERT OR IGNORE INTO main.sport_person SELECT * FROM src.sport_person WHERE id IN (SELECT merged_into_person_id FROM main.sport_person);
  INSERT OR IGNORE INTO main.sport_person SELECT * FROM src.sport_person WHERE merged_into_person_id IN (SELECT id FROM main.sport_person);`);

function enPuesto(competicion: string, puesto: number): { id: string; nombre: string } {
  const f = sqlite.prepare(`SELECT p.id, p.display_name AS nombre FROM src.sport_result r JOIN main.sport_person p ON p.id = r.person_id
    WHERE r.competition_id = ? AND r.position >= ? AND p.merged_into_person_id IS NULL ORDER BY r.position LIMIT 1`).get(competicion, puesto) as { id: string; nombre: string };
  return f;
}

const U = '11111111-1111-4111-8111-111111111111';
sqlite.prepare(`INSERT INTO main.user_profile (id, auth_user_id, email, full_name, role, invite_status, ical_token) VALUES (?, 'auth-prueba', 'prueba@example.test', 'Cuenta de prueba', 'coach', 'aceptada', 'tok-prueba')`).run(U);
const [p1, p2, p3, p4] = pruebas;
const tiradoraA = enPuesto(p1.id, 3);
const tiradoraB = enPuesto(p1.id, 9);
const inscrita = enPuesto(p3.id, 5);
const atleta = (id: string, persona: { id: string; nombre: string }, tutor: string | null) => {
  const [nombre, ...resto] = persona.nombre.split(' ');
  sqlite.prepare(`INSERT INTO main.athlete (id, guardian_profile_id, first_name, last_name, birth_date, gender, active) VALUES (?, ?, ?, ?, '2008-01-01', 'F', 1)`)
    .run(id, tutor, nombre, resto.join(' ') || nombre);
  sqlite.prepare(`UPDATE main.sport_person SET athlete_id = ? WHERE id = ?`).run(id, persona.id);
};
atleta('22222222-2222-4222-8222-222222222221', tiradoraA, U);
atleta('22222222-2222-4222-8222-222222222222', tiradoraB, U);
atleta('22222222-2222-4222-8222-222222222223', inscrita, null);
sqlite.prepare(`UPDATE main.sport_competition SET event_competition_id = 'ec-simulada' WHERE id = ?`).run(p3.id);
sqlite.prepare(`INSERT INTO main.entry (id, athlete_id, event_competition_id, status, requested_by_profile_id) VALUES ('e1', '22222222-2222-4222-8222-222222222223', 'ec-simulada', 'submitted', ?)`).run(U);
for (const puesto of [1, 4, 6]) sqlite.prepare(`INSERT INTO main.sport_favorite (profile_id, person_id, created_at) VALUES (?, ?, ?)`).run(U, enPuesto(p4.id, puesto).id, AHORA);
sqlite.prepare(`INSERT OR IGNORE INTO main.sport_favorite (profile_id, person_id, created_at) VALUES (?, ?, ?)`).run(U, enPuesto(p2.id, 2).id, AHORA);
sqlite.prepare(`INSERT OR IGNORE INTO main.sport_favorite (profile_id, person_id, created_at) VALUES (?, ?, ?)`).run(U, tiradoraA.id, AHORA);

// Avisos en momentos distintos, para que la bandeja tenga sus tramos.
await notificarEventosDeportivos(db, [{ tipo: 'resultados_publicados', competitionId: p4.id }], { vapid: null, ahora: new Date(AHORA - 20 * 24 * HORA) });
await notificarEventosDeportivos(db, [{ tipo: 'resultados_publicados', competitionId: p3.id }], { vapid: null, ahora: new Date(AHORA - 3 * 24 * HORA) });
await notificarEventosDeportivos(db, [{ tipo: 'resultado_nuevo', competitionId: p2.id, personIds: [enPuesto(p2.id, 2).id] }], { vapid: null, ahora: new Date(AHORA - 26 * HORA) });
await notificarEventosDeportivos(db, [{ tipo: 'resultados_publicados', competitionId: p1.id }], { vapid: null, ahora: new Date(AHORA - 40 * 60_000) });

const persona = { personId: tiradoraA.id, nombre: nombreVisible(tiradoraA.nombre), perfiles: [U] };
const ranking = (puesto: number, olimpico: string) => [{ personId: tiradoraA.id, lecturas: [
  { clave: 'nacional:sim', valor: `2025-2026|${puesto}`, etiqueta: 'Ranking nacional · Espada femenino absoluto' },
  { clave: 'olimpico:ESPADA-F', valor: olimpico, etiqueta: 'Estado olímpico · Espada femenino absoluto' },
] }];
await registrarLecturasPerfil(db, [persona], ranking(9, 'cerca'), new Date(AHORA - 30 * 24 * HORA));
await registrarLecturasPerfil(db, [persona], ranking(6, 'clasificado'), new Date(AHORA - 3 * HORA));

// Calendario real: los próximos torneos de la copia, con su escalera de plazos.
const vistas = await listEvents({ conPlazos: true, scope: ['NACIONAL', 'INTERNACIONAL'], limit: 200 });
const eventos: EventoCalendario[] = vistas.map((e) => ({
  id: e.id, name: e.name, startDate: e.startDate, endDate: e.endDate, city: e.city,
  competitions: e.competitions.map((c) => ({
    weapon: c.weapon, gender: c.gender, category: c.category, format: c.format,
    deadlines: c.deadlines.map((d) => ({ type: d.type, label: d.label, deadlineAt: d.deadlineAt, blocking: d.blocking })),
  })),
}));
const conCierre = eventos.flatMap((e) => e.competitions.flatMap((c) => c.deadlines.filter((d) => d.type === 'L1' && d.deadlineAt.getTime() > AHORA).map((d) => ({ e, d }))))
  .sort((a, b) => a.d.deadlineAt.getTime() - b.d.deadlineAt.getTime())[0];
if (conCierre) {
  const momento = new Date(conCierre.d.deadlineAt.getTime() - 2 * 24 * HORA - 5 * HORA);
  const criterios = [{ profileId: U, armas: null, generos: null, categorias: null }];
  const nuevos = new Set(eventos.filter((e) => e.id !== conCierre.e.id).slice(0, 2).map((e) => e.id));
  const avisos = construirAvisosCalendario(criterios, eventos.filter((e) => e.id === conCierre.e.id || nuevos.has(e.id)), nuevos, momento, new Map());
  await guardarAvisos(db, avisos.filter((a) => a.clave.startsWith('plazo:')), new Map(), new Date(AHORA - 2 * HORA));
  await guardarAvisos(db, avisos.filter((a) => a.clave.startsWith('nueva:')), new Map(), new Date(AHORA - 5 * 24 * HORA));
  informe.push(`calendario: ${avisos.length} avisos (${conCierre.e.name})`);
}
await guardarAvisos(db, [{
  profileId: U, tipo: 'prueba', clave: 'prueba:1', grupo: 'prueba', titulo: 'Notificación de prueba',
  cuerpo: 'Si ves esto, los avisos de CalendarFencing te llegan bien.', url: '/notificaciones', datos: null,
}], new Map(), new Date(AHORA - 6 * 24 * HORA));

// Lo de hace semanas, ya leído.
const vieja = sqlite.prepare(`SELECT id FROM notificacion WHERE profile_id = ? ORDER BY actualizada_en LIMIT 1`).get(U) as { id: string };
await abrirAviso(db, U, vieja.id, new Date(AHORA - 19 * 24 * HORA));
sqlite.prepare(`INSERT INTO notificacion_preferencia (profile_id, clave, activa, actualizada_en) VALUES (?, 'tipo:calendario', 0, ?)`).run(U, AHORA);

const filas = await leerBandeja(db, U);
const noLeidas = await contarNoLeidas(db, U);
informe.push(`bandeja: ${filas.length} avisos, ${noLeidas} sin leer; pruebas: ${pruebas.map((p) => `${p.nombre} (${p.fecha})`).join(' | ')}`);
const textoAvisos = JSON.stringify(filas);
for (const prohibido of ['birth', 'foto', '2008-01-01']) if (textoAvisos.includes(prohibido)) throw new Error(`un aviso lleva «${prohibido}»`);
const preferencias = await leerPreferenciasDe(db, U);

// ---------------------------------------------------------------- páginas

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
const ACCIONES: AccionesAjustes = {
  guardarPreferencia: async () => ({ ok: true, mensaje: '' }),
  suscribir: async () => ({ ok: true, mensaje: '' }),
  desuscribir: async () => ({ ok: true, mensaje: '' }),
  probar: async () => ({ ok: true, mensaje: '' }),
};

/**
 * La cabecera compacta real de la ruta, con el título que le da
 * `cabeceraDeRuta` (como `CabeceraApp` en el layout): las pantallas ya no
 * pintan su `<h1>`.
 */
function cabeceraDeLaRuta(ruta: string) {
  const c = cabeceraDeRuta(ruta, false);
  if (!c || c.variante === 'raiz') throw new Error(`${ruta} debería ser una subpantalla`);
  if (!c.titulo) throw new Error(`${ruta} no tiene título en cabeceraDeRuta`);
  return React.createElement(CabeceraCompacta, { variante: 'subpantalla', titulo: c.titulo, volverA: c.volverA });
}

function documento(css: string, cuerpo: React.ReactElement, ruta: string): string {
  const conContexto = (el: React.ReactElement) => React.createElement(AppRouterContext.Provider, { value: ROUTER as never },
    React.createElement(PathnameContext.Provider, { value: ruta },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams('') }, el)));
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><div class="flex min-h-dvh flex-col">${renderToStaticMarkup(conContexto(cabeceraDeLaRuta(ruta)))}
<main class="ancho-app flex flex-1 flex-col px-4 py-4">${renderToStaticMarkup(conContexto(cuerpo))}</main></div></body></html>`;
}

// Igual que la página: «Hoy» es el día de Madrid.
const secciones = agruparBandeja(filas, new Date(AHORA), parseFechaMadrid(`${hoyMadrid()}T00:00`)?.getTime());

// Los mismos contenedores que `ajustes/notificaciones/page.tsx` y `notificaciones/page.tsx`.
const ajustes = (estado: EstadoPush, ios = false) => React.createElement('div', { className: 'mx-auto flex w-full max-w-[640px] min-w-0 flex-col pt-[8px]' },
  React.createElement(AjustesNotificaciones, { preferencias, vapidPublica: 'B', soloLectura: false, acciones: ACCIONES, estadoInicial: estado, ios }));
const bandeja = (conAvisos: boolean) => React.createElement('div', { className: 'mx-auto flex w-full max-w-[640px] min-w-0 flex-col gap-[8px]' },
  React.createElement(AccionesNotificaciones, { hayNoLeidas: conAvisos && noLeidas > 0, marcarTodas: '/x' }),
  React.createElement(BandejaNotificaciones, { secciones: conAvisos ? secciones : [], ahora: AHORA, abrir: '/abrir' }));

type Pagina = { nombre: string; ruta: string; cuerpo: React.ReactElement; anchos?: string[] };
const paginas: Pagina[] = [
  { nombre: 'bandeja', ruta: '/notificaciones', cuerpo: bandeja(true) },
  { nombre: 'bandeja-vacia', ruta: '/notificaciones', anchos: ['393'], cuerpo: bandeja(false) },
  { nombre: 'ajustes', ruta: '/ajustes/notificaciones', cuerpo: ajustes('apagado') },
  { nombre: 'ajustes-iphone', ruta: '/ajustes/notificaciones', anchos: ['320', '393'], cuerpo: ajustes('ios-instalar', true) },
  { nombre: 'ajustes-activo', ruta: '/ajustes/notificaciones', anchos: ['393'], cuerpo: ajustes('activo') },
];

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });
const html = new Map(paginas.map((p) => [`/${p.nombre}`, documento(css, p.cuerpo, p.ruta)]));
const servidor = createServer((pet, res) => {
  const ruta = decodeURIComponent(new URL(pet.url ?? '/', 'http://x').pathname);
  const pagina = html.get(ruta);
  if (pagina) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pagina);
    return;
  }
  const fichero = path.join(RAIZ, 'public', path.normalize(ruta).replace(/^([/\\])+/, ''));
  if (!fichero.startsWith(path.join(RAIZ, 'public')) || !existsSync(fichero)) {
    res.writeHead(404).end();
    return;
  }
  const tipo = fichero.endsWith('.png') ? 'image/png' : fichero.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': tipo }).end(readFileSync(fichero));
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const puerto = (servidor.address() as AddressInfo).port;

const navegador = await chromium.launch();
const ANCHOS = [
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];
const capturas: string[] = [];
const problemas: string[] = [];
try {
  for (const p of paginas) {
    for (const an of ANCHOS.filter((a) => !p.anchos || p.anchos.includes(a.sufijo))) {
      const pagina = await navegador.newPage({ viewport: an.viewport, deviceScaleFactor: an.escala });
      await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
      await pagina.evaluate(() => document.fonts.ready);
      const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
      if (an.viewport.width < 768 && ancho > an.viewport.width) {
        const culpables = await pagina.evaluate((w) => [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((el) => el.getBoundingClientRect().right > w + 0.5 && el.offsetParent !== null)
          .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 60)}`), an.viewport.width);
        problemas.push(`${p.nombre} @${an.viewport.width}: ${ancho}px (${culpables.join(', ')})`);
      }
      // En el móvil: lo pulsable se toca en 44 × 44 (su caja o, en las piezas del sistema, su `::after`),
      // ningún texto baja de 12 px y ninguna superficie lleva alfa (`docs/diseno-sistema.md` § 2, § 9).
      if (an.viewport.width < 768) {
        const medida = await pagina.evaluate(() => {
          const visibles = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => el.getClientRects().length > 0);
          const pequenos = visibles.filter((el) => el.matches('a[href], button, summary, [role=switch]')).filter((el) => {
            const r = el.getBoundingClientRect();
            const d = getComputedStyle(el, '::after');
            const conArea = d.content !== 'none' && d.position === 'absolute';
            const alto = Math.max(r.height, conArea ? parseFloat(d.height) || 0 : 0);
            const ancho = Math.max(r.width, conArea ? parseFloat(d.width) || 0 : 0);
            return alto < 43.5 || ancho < 43.5;
          }).map((el) => `${el.tagName.toLowerCase()} «${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}» ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
          const textoPequeno = visibles.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && !el.closest('.sr-only'))
            .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12)
            .map((el) => `«${el.textContent!.trim().slice(0, 30)}» ${getComputedStyle(el).fontSize}`);
          const alfa = visibles.filter((el) => {
            const m = /rgba?\(([^)]+)\)|oklch\(([^)]+)\)|oklab\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
            const partes = m ? (m[1] ?? m[2] ?? m[3]).split(/[\s,/]+/).filter(Boolean) : [];
            const a = partes.length === 4 ? parseFloat(partes[3]) / (partes[3].endsWith('%') ? 100 : 1) : 1;
            return a > 0 && a < 1;
          }).map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 50)}`);
          return { pequenos: pequenos.slice(0, 6), textoPequeno: textoPequeno.slice(0, 6), alfa: alfa.slice(0, 6) };
        });
        if (medida.pequenos.length) problemas.push(`${p.nombre} @${an.viewport.width}: táctil < 44: ${medida.pequenos.join('; ')}`);
        if (medida.textoPequeno.length) problemas.push(`${p.nombre} @${an.viewport.width}: texto < 12 px: ${medida.textoPequeno.join('; ')}`);
        if (medida.alfa.length) problemas.push(`${p.nombre} @${an.viewport.width}: fondo con alfa: ${medida.alfa.join('; ')}`);
      }
      const total = await pagina.evaluate(() => document.scrollingElement!.scrollHeight);
      await pagina.setViewportSize({ width: an.viewport.width, height: Math.max(an.viewport.height, total) });
      const destino = path.join(SALIDA, `${p.nombre}-${an.sufijo}.png`);
      await pagina.screenshot({ path: destino, clip: { x: 0, y: 0, width: an.viewport.width, height: total } });
      capturas.push(path.relative(RAIZ, destino));
      await pagina.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
  sqlite.close();
  if (existsSync(TEMPORAL)) rmSync(TEMPORAL);
}

console.log(capturas.join('\n'));
console.log(informe.join('\n'));
if (problemas.length > 0) {
  console.error(`Problemas:\n${problemas.join('\n')}`);
  process.exitCode = 1;
}
