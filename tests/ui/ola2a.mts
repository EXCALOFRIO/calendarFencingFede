/**
 * Capturas sin servidor del armazón nuevo (ola 2A, `docs/diseno-sistema.md`
 * § 10 pasos 1, 2, 8 y 9): la barra única, la cabecera compacta de cada
 * pantalla y la cabecera de escritorio alrededor del contenido real de
 * Calendario, Explorar, Buscar, Ranking, Tú y Notificaciones.
 *
 *   $env:PERF_DB = "$env:USERPROFILE\calendario-datos\calendario-trabajo\nuevo11.sqlite"
 *   $env:SONDA_DIR = 'ola2a'
 *   npx tsx --import ./tests/ui/auditoria-sonda.mts tests/ui/ola2a.mts
 *
 * La copia se abre en sólo lectura detrás de un D1 de mentira, con los mismos
 * cargadores que las páginas, y se pinta con `renderToStaticMarkup` y el CSS
 * compilado de `globals.css`, dentro de los mismos componentes que monta
 * `(app)/layout.tsx` (`CabeceraEscritorio`, `CabeceraApp`, `NavMovil`). Sin
 * hidratar: la barra y las cabeceras salen tal como llegan en el HTML.
 *
 * Mide en cada captura el alto de la barra y de la cabecera, el área táctil
 * de los controles del sistema (el `::after`) y el desbordamiento horizontal.
 * Salida en `capturas/ola2a/despues/` a 320, 393 y 1440 px.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { SessionProfile } from '@/lib/auth/session';
import { bindingDeLectura } from './d1-lectura.mts';

const RAIZ = process.cwd();
process.env.PERF_DB ??= path.join(homedir(), 'calendario-datos', 'calendario-trabajo', 'nuevo11.sqlite');
const BASE = process.env.PERF_DB;
const SALIDA = path.join(RAIZ, 'capturas', 'ola2a', 'despues');

// El `db` global de la aplicación (calendario, ranking) lee de la copia, en sólo lectura.
const sqlite = new DatabaseSync(BASE, { readOnly: true });
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = {
  env: { DB: bindingDeLectura(sqlite) },
  cf: {},
  ctx: { waitUntil: () => {} },
};

const { CabeceraApp } = await import('@/components/cabecera-app');
const { CabeceraEscritorio } = await import('@/components/cabecera-escritorio');
const { NavMovil } = await import('@/components/nav');
const { CampanaCliente } = await import('@/components/notificaciones/campana-cliente');
const { AccionesNotificaciones, BandejaNotificaciones } = await import('@/components/notificaciones/bandeja');
const { agruparBandeja } = await import('@/lib/notificaciones/bandeja');
const { VistaCalendario } = await import('@/components/calendario/vista');
const { listEvents, getDataFreshness } = await import('@/lib/queries/calendar');
const { cargarPantallaRanking } = await import('@/app/(app)/ranking/datos');
const { VistaRanking } = await import('@/app/(app)/ranking/vista');
const { leerFiltroRankingNacional } = await import('@/lib/ranking/url-nacional');
const { seccionesDeTu } = await import('@/components/tu/filas');
const { FilaSalir, IdentidadTu, ListaTu } = await import('@/components/tu/lista-tu');
const { cargarBuscarVacio, cargarInicio } = await import('@/lib/sport/explorar/inicio-pantalla');
const { LIMITE_FEED } = await import('@/lib/sport/explorar/siguiendo-pantalla');
const { CRITERIOS_VACIOS, opcionesTemporada } = await import('@/lib/sport/explorar/url');
const { contenidoExplorar } = await import('./_explorar-app-vista.tsx');
const { CUENTA, ctx } = await import('./_explorar-base.mts');
const { formatDateEs } = await import('@/lib/utils');

const h = React.createElement;
const hoy = new Date().toISOString().slice(0, 10);
const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
const nada = async () => {
  throw new Error('sin servidor');
};

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const cuenta = { nombre: 'Carlos Llavador', iniciales: 'CL', segundaLinea: 'Florete · Absoluto' };
const frescura = await getDataFreshness();
const aviso = frescura.stale
  ? h('p', { role: 'status', className: 'ancho-app flex items-center gap-[6px] px-4 pt-[8px] text-[12px] leading-[16px] text-warn' },
    frescura.lastSeenAt ? `Sin actualizar desde el ${formatDateEs(frescura.lastSeenAt)}. Comprueba en la fuente oficial.` : 'Todavía no se ha cargado ningún dato.')
  : null;

/** El armazón de `(app)/layout.tsx`, con los mismos componentes, alrededor de `contenido`. */
function documento(css: string, ruta: string, contenido: React.ReactElement): string {
  const [pathname, consulta = ''] = ruta.split('?');
  const campana = h(CampanaCliente, { inicial: 3 });
  const arbol = h(AppRouterContext.Provider, { value: ROUTER as never },
    h(PathnameContext.Provider, { value: pathname! },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(consulta) as never },
        h('div', { className: 'hueco-barra flex min-h-dvh flex-col' },
          h(CabeceraEscritorio, { campana, cuenta, esAdmin: false }),
          h(CabeceraApp, { campana, aviso }),
          h('main', { id: 'contenido', className: 'ancho-app flex flex-1 flex-col px-4 py-4' }, contenido),
          h(NavMovil, {})))));
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased">${renderToStaticMarkup(arbol)}</body></html>`;
}

function perfilDe(nombre: string): SessionProfile {
  const fila = sqlite.prepare(`SELECT p.id, p.role FROM athlete a JOIN user_profile p ON p.id = a.user_profile_id
    WHERE a.active = 1 AND a.first_name || ' ' || a.last_name LIKE ? LIMIT 1`).get(`${nombre}%`) as { id: string; role: SessionProfile['role'] } | undefined;
  return {
    authUserId: 'arnes', email: 'arnes@example.test', profileId: fila?.id ?? CUENTA, fullName: nombre,
    role: fila?.role ?? 'athlete', clubId: null, clubName: null, icalToken: 'x', weapons: ['FLORETE'],
  } as SessionProfile;
}

const css = await compilarCss();
const paginas = new Map<string, string>();

// Calendario: el mes actual, con los mismos eventos que la portada.
{
  const eventos = await listEvents({ limit: 500, scope: ['NACIONAL', 'INTERNACIONAL'] });
  paginas.set('calendario', documento(css, '/', h(VistaCalendario, {
    inicial: { vista: 'mes', mes: hoy.slice(0, 7) },
    eventos,
    perfil: { role: 'athlete', weapons: ['FLORETE'] },
    tiradores: [],
    inscripciones: {},
    temporada: '2026-2027',
    actualizado: null,
    solicitarInscripcion: nada,
    pasadoInicial: null,
    cargarPasado: nada,
  } as never)));
}

// Explorar (el feed) y Buscar sin nada escrito.
{
  const { vista, siguiendo } = await cargarInicio(ctx, {});
  if (vista.tipo === 'sin_sesion') throw new Error('sin sesión');
  paginas.set('explorar', documento(css, '/explorar', contenidoExplorar({
    vista: 'inicio', cuenta: CUENTA, criterios: { cursor: '', soloMedallas: false }, inicio: vista, siguiendo, limite: LIMITE_FEED,
  })));
  const propuestas = await cargarBuscarVacio(ctx);
  paginas.set('buscar', documento(css, '/explorar/buscar', contenidoExplorar({
    vista: 'buscar', cuenta: CUENTA, criterios: CRITERIOS_VACIOS, explorar: { tipo: 'sin_criterio' }, temporadas: opcionesTemporada(hoy), propuestas,
  })));
}

// Ranking: la pantalla tal cual, con su propio título (no lleva cabecera compacta todavía).
{
  const perfil = perfilDe(process.env.TIRADOR ?? 'Carlos Llavador');
  const datos = await cargarPantallaRanking(perfil, leerFiltroRankingNacional({}));
  paginas.set('ranking', documento(css, '/ranking', h(VistaRanking, { datos, cargar: (async () => null) as never } as never)));
}

// Tú: un tirador con ficha vinculada y convocatorias.
{
  const secciones = seccionesDeTu({ role: 'athlete', fichaPropia: '/explorar/00000000-0000-4000-8000-000000000001', convocatorias: 2 });
  paginas.set('tu', documento(css, '/explorar/yo', h('div', { className: 'flex w-full min-w-0 flex-col gap-[24px] lg:mx-auto lg:max-w-2xl' },
    h(IdentidadTu, cuenta),
    h(ListaTu, { secciones }),
    h(FilaSalir, { accion: nada }))));
  const admin = seccionesDeTu({ role: 'admin', fichaPropia: null, convocatorias: 0 });
  paginas.set('tu-admin', documento(css, '/explorar/yo', h('div', { className: 'flex w-full min-w-0 flex-col gap-[24px] lg:mx-auto lg:max-w-2xl' },
    h(IdentidadTu, { nombre: 'Dirección técnica', iniciales: 'DT', segundaLinea: null }),
    h(ListaTu, { secciones: admin }),
    h(FilaSalir, { accion: nada }))));
}

// Notificaciones: una bandeja sintética (la tabla no está en la copia de producción).
{
  const ahora = Date.now();
  const fila = (id: number, tipo: string, horas: number, titulo: string, cuerpo: string, leida = false) => ({
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, tipo, grupo: `g${id}`, titulo, cuerpo,
    url: '/explorar', datos: null, leida, creadaEn: ahora - horas * 3_600_000, actualizadaEn: ahora - horas * 3_600_000,
  });
  const filas = [
    fila(1, 'perfil', 1, 'Nuevo resultado de Zabala', '3.º en la Copa de España de Madrid'),
    fila(2, 'inscripcion', 5, 'Inscripción confirmada', 'Copa de España Absoluta · Florete'),
    fila(3, 'plazo', 30, 'Cierra la inscripción', 'Circuito Nacional M20 · faltan 3 días', true),
  ];
  const secciones = agruparBandeja(filas as never, new Date(ahora), ahora - (ahora % 86_400_000));
  paginas.set('notificaciones', documento(css, '/notificaciones', h('div', { className: 'mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-4' },
    h(AccionesNotificaciones, { hayNoLeidas: true, marcarTodas: nada as never }),
    h(BandejaNotificaciones, { secciones, ahora, abrir: nada as never }))));
}

const servidor = createServer((pet, res) => {
  const nombre = (pet.url ?? '/').replace(/^\//, '');
  const html = paginas.get(nombre);
  if (html) res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  else res.writeHead(404).end();
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const origen = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

const anchos = [
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];
mkdirSync(SALIDA, { recursive: true });
const navegador = await chromium.launch();
const informe: Record<string, unknown>[] = [];
const fallos: string[] = [];

for (const a of anchos) {
  const contexto = await navegador.newContext({ viewport: a.viewport, deviceScaleFactor: a.escala, reducedMotion: 'reduce' });
  for (const nombre of paginas.keys()) {
    const p = await contexto.newPage();
    p.on('pageerror', (e) => fallos.push(`${nombre}@${a.sufijo}: ${e.message}`));
    await p.goto(`${origen}/${nombre}`, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.evaluate('window.__name = window.__name || ((f) => f)');
    const m = await p.evaluate(() => {
      const caja = (s: string) => {
        const el = [...document.querySelectorAll<HTMLElement>(s)].find((e) => e.getClientRects().length > 0);
        return el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : null;
      };
      // Controles del sistema: se ven de ≤ 36 px y se tocan en ≥ 44 (el `::after`).
      const sistema = [...document.querySelectorAll<HTMLElement>('[data-slot^="sistema-boton"], [data-slot="campana"], [data-slot="button"]')]
        .filter((e) => e.getClientRects().length > 0);
      const malos = sistema.flatMap((el) => {
        const r = el.getBoundingClientRect();
        const tras = getComputedStyle(el, '::after');
        const w = Math.max(r.width, Number.parseFloat(tras.width) || 0);
        const alto = Math.max(r.height, Number.parseFloat(tras.height) || 0);
        return w < 44 || alto < 44 ? [`${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20)}: ${w.toFixed(0)}×${alto.toFixed(0)}`] : [];
      });
      const visibles = sistema.map((el) => Math.round(el.getBoundingClientRect().height));
      return {
        barra: caja('nav[data-barra="app"]'),
        cabecera: caja('header[data-slot="sistema-cabecera"]'),
        cabeceraEscritorio: caja('header[data-slot="cabecera-escritorio"]'),
        controles: sistema.length,
        altoMaximoControl: visibles.length ? Math.max(...visibles) : null,
        areaCorta: malos,
        desborde: document.documentElement.scrollWidth - window.innerWidth,
        pestanaMarcada: document.querySelector('nav[data-barra="app"] [aria-current="page"]')?.getAttribute('data-pestana') ?? null,
      };
    });
    informe.push({ pagina: nombre, ancho: a.sufijo, ...m });
    if (a.viewport.width < 768 && m.desborde > 0) fallos.push(`${nombre}@${a.sufijo}: desborda ${m.desborde} px`);
    if (a.viewport.width < 1024 && m.barra !== null && m.barra > 51.5) fallos.push(`${nombre}@${a.sufijo}: la barra mide ${m.barra} px`);
    if (m.areaCorta.length) fallos.push(`${nombre}@${a.sufijo}: área táctil < 44: ${m.areaCorta.join(', ')}`);
    await p.screenshot({ path: path.join(SALIDA, `${nombre}-${a.sufijo}.png`) });
    await p.close();
  }
  await contexto.close();
}
await navegador.close();
servidor.close();

writeFileSync(path.join(SALIDA, 'medidas.json'), JSON.stringify(informe, null, 2));
console.table(informe.map((x) => ({ ...x, areaCorta: (x.areaCorta as string[]).length })));
if (fallos.length) {
  console.error(`\nFallos:\n${fallos.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`\n${informe.length} capturas en ${path.relative(RAIZ, SALIDA)}; sin desborde ni áreas táctiles cortas.`);
}
