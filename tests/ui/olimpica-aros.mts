/**
 * Capturas sin servidor de la etiqueta olímpica (aros y colores) a 320, 393 y
 * 1440 px sobre una copia de D1 en sólo lectura, y medida de lo que cuesta:
 *
 *   - /ranking internacional con «Solo JJOO» (la tabla real, `TablaRankingFie`);
 *   - la cabecera del perfil de olímpicos (verde, amarillo y gris si los hay);
 *   - Buscar: filas de perfil con la marca al lado (como quedaría integrada);
 *   - lo que se ve al tocar, en las tres pantallas.
 *
 * Sin JavaScript en la página la burbuja no se abre: «al tocar» se pinta su
 * contenido real (`ContenidoBurbujaOlimpica`) en una caja con las clases del
 * `PopoverContent`.
 *
 *   $env:PERF_DB=<copia SQLite de D1>
 *   $env:CAPTURAS=olimpica-criterios   # opcional
 *   npx tsx tests/ui/olimpica-aros.mts
 *
 * Salida en `capturas/<CAPTURAS>/` (por defecto `capturas/olimpica-aros/`).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
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
import { createD1Database } from '@/db/d1/runtime';
import { CabeceraFicha } from '@/components/explorar/ficha-deportiva';
import { FilaPerfil, CLASE_LISTA_PERFILES } from '@/components/explorar/buscador-social-fila';
import { ContenidoBurbujaOlimpica, MarcaOlimpicaPersona } from '@/components/olimpica/burbuja-olimpica';
import { IconoAros } from '@/components/olimpica/icono-aros';
import { PastillaOlimpica } from '@/components/olimpica/pastilla-olimpica';
import { TablaRankingFie } from '@/components/ranking/tabla-fie';
import { completarTablaFie } from '@/app/(app)/ranking/consultas';
import { getAnotacionesOlimpicas, olvidarAnotacionesOlimpicas } from '@/lib/queries/olimpica';
import { getClasificacionFie, listGruposClasificacionFie } from '@/lib/queries/ranking';
import { colorOlimpico, mejorMarcaOlimpica, type AnotacionOlimpica, type ArmaOlimpica, type GeneroOlimpico } from '@/lib/ranking/olimpica';
import { chipsRanking } from '@/lib/sport/explorar/chips-ranking';
import { cargarExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { leerOlimpicaPersonas, type OlimpicaPerfil } from '@/lib/sport/explorar/olimpica-perfil';
import { crearContexto } from '../helpers/explorar';
import { bindingDeLectura, type Medida } from './d1-lectura.mts';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', process.env.CAPTURAS || 'olimpica-aros');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');

const sqlite = new DatabaseSync(BASE, { readOnly: true });
const medidas: Medida[] = [];
const binding = bindingDeLectura(sqlite, medidas);
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: binding }, ctx: {}, cf: {} };
const db = createD1Database(binding);
const ctx = { ...crearContexto().ctx, db };
const informe: string[] = [];

async function medir<T>(rotulo: string, fn: () => Promise<T>): Promise<T> {
  medidas.length = 0;
  const t0 = performance.now();
  const r = await fn();
  const ms = performance.now() - t0;
  const filas = medidas.reduce((s, m) => s + m.filas, 0);
  const sqlMs = medidas.reduce((s, m) => s + m.ms, 0);
  informe.push(`coste ${rotulo}: ${medidas.length} consultas, ${filas} filas devueltas, ${sqlMs.toFixed(1)} ms SQL, ${ms.toFixed(1)} ms total`);
  return r;
}

const PRUEBAS: [ArmaOlimpica, GeneroOlimpico][] = [
  ['FLORETE', 'M'], ['FLORETE', 'F'], ['ESPADA', 'M'], ['ESPADA', 'F'], ['SABLE', 'M'], ['SABLE', 'F'],
];

function personaDeFie(fieId: string): string | null {
  const fila = sqlite.prepare(`SELECT x.person_id AS id FROM sport_external_id x
    WHERE x.scheme = 'fie_addr_id' AND x.value = ? AND x.link_status = 'CONFIRMADO' LIMIT 1`).get(fieId) as { id: string } | undefined;
  return fila?.id ?? null;
}

function personaPorNombre(patron: string): string | null {
  const fila = sqlite.prepare(`SELECT id FROM sport_person WHERE display_name LIKE ? AND merged_into_person_id IS NULL
    ORDER BY (SELECT count(*) FROM sport_result r WHERE r.person_id = sport_person.id) DESC LIMIT 1`).get(patron) as { id: string } | undefined;
  return fila?.id ?? null;
}

// --- Coste ------------------------------------------------------------------
const pruebas = new Map<string, Awaited<ReturnType<typeof getAnotacionesOlimpicas>>>();
for (const [arma, genero] of PRUEBAS) {
  pruebas.set(`${arma}|${genero}`, await medir(`getAnotacionesOlimpicas(${arma}, ${genero})`, () => getAnotacionesOlimpicas(arma, genero)));
}

// --- Quién sale -------------------------------------------------------------
type Hallazgo = { clave: string; fieId: string; anotacion: AnotacionOlimpica; prueba: string; noc: string | null };
const nocDe = (fieId: string) => (sqlite.prepare(`SELECT country_code AS noc FROM fie_clasificacion WHERE fie_id = ? AND format = 'INDIVIDUAL' ORDER BY season DESC LIMIT 1`).get(Number(fieId)) as { noc: string } | undefined)?.noc ?? null;
const hallazgos: Hallazgo[] = [];
for (const [clave, p] of pruebas) {
  for (const [fieId, a] of Object.entries(p?.individual ?? {})) {
    if (colorOlimpico(a)) hallazgos.push({ clave, fieId, anotacion: a, prueba: clave, noc: nocDe(fieId) });
  }
  const c = Object.values(p?.individual ?? {}).reduce<Record<string, number>>((acc, a) => {
    const k = colorOlimpico(a) ?? 'sin';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  informe.push(`${clave} (${p?.fechaRanking ?? 'sin fecha'}): ${JSON.stringify(c)}`);
}
const espanolAmarillo = hallazgos.find((h) => h.noc === 'ESP' && colorOlimpico(h.anotacion) === 'amarillo' && personaDeFie(h.fieId));
const espanolVerde = hallazgos.find((h) => h.noc === 'ESP' && colorOlimpico(h.anotacion) === 'verde' && personaDeFie(h.fieId));
const gris = hallazgos.find((h) => colorOlimpico(h.anotacion) === 'gris' && personaDeFie(h.fieId));
informe.push(`español amarillo: ${espanolAmarillo ? `${espanolAmarillo.fieId} ${espanolAmarillo.prueba}` : 'ninguno'}; español verde: ${espanolVerde?.fieId ?? 'ninguno'}; gris: ${gris ? `${gris.fieId} ${gris.noc}` : 'ninguno'}`);

const perfiles: [string, string | null][] = [
  ['choupenitch', personaPorNombre('CHOUPENITCH%')],
  ['ranvier', personaPorNombre('RANVIER Pauline%')],
  ['marino', personaPorNombre('MARINO Maria%')],
  ['llavador', personaPorNombre('LLAVADOR Carlos%')],
  ['borodachev', personaPorNombre('BORODACHEV Kirill%')],
  ['espanol-amarillo', espanolAmarillo ? personaDeFie(espanolAmarillo.fieId) : null],
  ['espanol-verde', espanolVerde ? personaDeFie(espanolVerde.fieId) : null],
  ['gris', gris ? personaDeFie(gris.fieId) : null],
];

// --- HTML -------------------------------------------------------------------
async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}
const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
function documento(css: string, cuerpo: React.ReactElement, ruta = '/explorar', consulta = ''): string {
  const conContexto = React.createElement(AppRouterContext.Provider, { value: ROUTER as never },
    React.createElement(PathnameContext.Provider, { value: ruta },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(consulta) }, cuerpo)));
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-4 py-4">${renderToStaticMarkup(conContexto)}</main></body></html>`;
}

/** La burbuja «abierta»: la pastilla y debajo su contenido en la caja del `PopoverContent`. */
function abierta(titulo: string, anotacion: AnotacionOlimpica, fechaRanking?: string | null) {
  return React.createElement('section', { className: 'flex min-w-0 flex-col gap-1' },
    React.createElement('p', { className: 'text-xs text-muted-foreground' }, titulo),
    React.createElement('div', { className: 'flex' }, React.createElement(PastillaOlimpica, { anotacion })),
    React.createElement('div', {
      className: 'w-[min(19rem,calc(100vw-2rem))] rounded-md border border-filete-alto bg-popover p-3 text-popover-foreground shadow-[var(--sombra-flotante)]',
    }, React.createElement(ContenidoBurbujaOlimpica, { anotacion, fechaRanking })));
}

const css = await compilarCss();
type Pagina = { nombre: string; html: string; recorte?: number };
const paginas: Pagina[] = [];

// El icono grande en los tres colores de estado, a 14, 16 y 20 px, y las tres pastillas.
const tres = [
  hallazgos.find((h) => colorOlimpico(h.anotacion) === 'verde'),
  hallazgos.find((h) => colorOlimpico(h.anotacion) === 'amarillo' && h.anotacion.faltan !== null),
  hallazgos.find((h) => colorOlimpico(h.anotacion) === 'gris'),
].filter((h): h is Hallazgo => Boolean(h));
const COLORES_ESTADO = ['text-ok', 'text-warn', 'text-muted-foreground'] as const;
paginas.push({
  nombre: 'aros',
  html: documento(css, React.createElement('div', { className: 'flex min-w-0 flex-col gap-4' },
    React.createElement('div', { className: 'grid w-full max-w-md grid-cols-3 gap-3' },
      ...COLORES_ESTADO.map((c) => React.createElement('span', { key: c, className: c }, React.createElement(IconoAros, { className: 'w-full', apagados: c === 'text-muted-foreground' })))),
    React.createElement('div', { className: 'w-full max-w-md rounded-xl bg-white p-4 text-black' }, React.createElement(IconoAros, { className: 'w-full' })),
    ...COLORES_ESTADO.map((c) => React.createElement('div', { key: c, className: `flex items-center gap-4 ${c}` },
      ...['w-3.5', 'w-4', 'w-5'].map((w) => React.createElement(IconoAros, { key: w, className: w, apagados: c === 'text-muted-foreground' })))),
    React.createElement('div', { className: 'flex flex-wrap items-center gap-4' },
      ...tres.map((h) => React.createElement(PastillaOlimpica, { key: h.fieId, anotacion: h.anotacion }))))),
});

// /ranking internacional con «Solo JJOO»: la prueba de Choupenitch.
const mundial = await listGruposClasificacionFie();
for (const [arma, genero] of [['FLORETE', 'M'], ['ESPADA', 'M']] as const) {
  const grupo = { weapon: arma, gender: genero, category: 'ABS' } as const;
  const primera = await medir(`tabla /ranking ${arma} ${genero}`, async () =>
    completarTablaFie(await getClasificacionFie({ format: 'INDIVIDUAL', ...grupo, athleteIdsPropios: [] })));
  const tabla = React.createElement(TablaRankingFie, {
    grupos: mundial.grupos, inicial: { format: 'INDIVIDUAL', ...grupo }, primeraTabla: primera, mios: [], cargar: async () => null,
  });
  paginas.push({ nombre: `ranking-jjoo-${arma.toLowerCase()}-${genero.toLowerCase()}`, html: documento(css, tabla, '/ranking', 'jjoo=1'), recorte: 1500 });
}

// Lo que se ve al tocar en /ranking: un verde, un amarillo y un gris de la tabla.
const muestras = [
  hallazgos.find((h) => colorOlimpico(h.anotacion) === 'verde' && h.prueba === 'FLORETE|M'),
  espanolAmarillo ?? hallazgos.find((h) => colorOlimpico(h.anotacion) === 'amarillo'),
  gris,
].filter((h): h is Hallazgo => Boolean(h));
paginas.push({
  nombre: 'ranking-al-tocar',
  html: documento(css, React.createElement('div', { className: 'flex min-w-0 flex-col gap-6' },
    ...muestras.map((h) => abierta(`/ranking ${h.prueba} · ${h.noc ?? ''} fie ${h.fieId}`, h.anotacion, pruebas.get(h.prueba)?.fechaRanking ?? null))), '/ranking'),
});

// Cabeceras del perfil.
for (const [clave, id] of perfiles) {
  if (!id) { informe.push(`perfil ${clave}: no encontrado`); continue; }
  const [vista, extras] = await Promise.all([
    cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS, { diferirRivales: true }),
    medir(`cargarExtrasPerfil ${clave}`, () => cargarExtrasPerfil(ctx, id)),
  ]);
  if (vista.tipo !== 'ok') { informe.push(`perfil ${clave}: ${vista.tipo}`); continue; }
  const chips = chipsRanking({
    nacional: extras.rankingNacional, mundial: extras.rankingMundial, resumenMundial: extras.resumenMundial,
    ambitos: extras.rankingAmbitos ?? null, olimpica: extras.olimpica,
  });
  const marca = chips.find((c) => c.olimpica)?.olimpica ?? null;
  informe.push(`perfil ${clave} (${vista.ficha.nombre}): ${(extras.olimpica ?? []).map((o) => `${o.arma}/${o.genero} ${colorOlimpico(o.anotacion)}`).join(', ') || 'sin marca'}; en cabecera: ${marca ? colorOlimpico(marca) : 'no'}`);
  paginas.push({
    nombre: `perfil-${clave}`,
    html: documento(css, React.createElement('div', { className: 'flex min-w-0 flex-col gap-6' },
      React.createElement(CabeceraFicha, { ficha: vista.ficha, datos: extras.datos, chips }),
      marca ? abierta('Al tocar la etiqueta', marca) : null)),
    recorte: 1400,
  });
}

// Buscar: las filas con la marca al lado (fuera del enlace), como en `FilaPerfil` con `accion`.
const idsBuscar = [
  ...perfiles.map(([, id]) => id),
  personaPorNombre('LLAVADOR Carlos%'),
  personaPorNombre('PETTOLA Chiara%'),
].filter((x): x is string => Boolean(x));
olvidarAnotacionesOlimpicas();
await medir(`leerOlimpicaPersonas en frío (${idsBuscar.length} personas)`, () => leerOlimpicaPersonas(db, idsBuscar));
const marcas = await medir(`leerOlimpicaPersonas con la memoria (${idsBuscar.length} personas)`, () => leerOlimpicaPersonas(db, idsBuscar));
const nombres = new Map(idsBuscar.map((id) => [id, sqlite.prepare('SELECT display_name AS n FROM sport_person WHERE id = ?').get(id) as { n: string }]));
const paisDe = (id: string) => (sqlite.prepare(`SELECT f.country_code AS p FROM sport_external_id x JOIN fie_clasificacion f ON f.fie_id = CAST(x.value AS INTEGER)
  WHERE x.person_id = ? AND x.scheme = 'fie_addr_id' AND x.link_status = 'CONFIRMADO' LIMIT 1`).get(id) as { p: string } | undefined)?.p ?? null;
const lista = React.createElement('ul', { className: CLASE_LISTA_PERFILES },
  ...idsBuscar.map((id) => React.createElement(FilaPerfil, {
    key: id,
    p: { id, nombre: nombres.get(id)?.n ?? id, pais: paisDe(id) },
    accion: React.createElement(MarcaOlimpicaPersona, { marcas: marcas[id], className: 'mr-1' }),
  })));
const mejores = idsBuscar.map((id) => mejorMarcaOlimpica(marcas[id] as OlimpicaPerfil[] | undefined)).filter((m): m is OlimpicaPerfil => m !== null);
paginas.push({
  nombre: 'buscar',
  html: documento(css, React.createElement('div', { className: 'flex min-w-0 flex-col gap-6 lg:max-w-2xl' },
    lista,
    ...mejores.slice(0, 2).map((m) => abierta('Al tocar en Buscar', m.anotacion)))),
  recorte: 2000,
});
informe.push(`buscar: ${Object.keys(marcas).length} de ${idsBuscar.length} personas con marca`);

// --- Capturas ---------------------------------------------------------------
mkdirSync(SALIDA, { recursive: true });
const html = new Map(paginas.map((p) => [`/${p.nombre}`, p.html]));
const servidor = createServer((pet, res) => {
  const url = new URL(pet.url ?? '/', 'http://x');
  const pagina = html.get(decodeURIComponent(url.pathname));
  if (pagina) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pagina); return; }
  const fichero = path.join(RAIZ, 'public', path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
  if (!fichero.startsWith(path.join(RAIZ, 'public')) || !existsSync(fichero)) { res.writeHead(404).end(); return; }
  const tipo = fichero.endsWith('.png') ? 'image/png' : fichero.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': tipo }).end(readFileSync(fichero));
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const puerto = (servidor.address() as AddressInfo).port;
const navegador = await chromium.launch();
const anchos = [
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];
const problemas: string[] = [];
let n = 0;
try {
  for (const p of paginas) {
    for (const a of anchos) {
      const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
      await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
      await pagina.evaluate(() => document.fonts.ready);
      const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
      if (ancho > a.viewport.width) problemas.push(`${p.nombre} @${a.viewport.width}: scrollWidth ${ancho}`);
      const total = await pagina.evaluate(() => document.scrollingElement!.scrollHeight);
      const alto = Math.min(p.recorte ?? total, total);
      await pagina.setViewportSize({ width: a.viewport.width, height: Math.max(a.viewport.height, alto) });
      await pagina.screenshot({ path: path.join(SALIDA, `${p.nombre}-${a.sufijo}.png`), clip: { x: 0, y: 0, width: a.viewport.width, height: alto } });
      n++;
      await pagina.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
  sqlite.close();
}
console.log(`${n} capturas en ${path.relative(RAIZ, SALIDA)}`);
console.log(informe.join('\n'));
if (problemas.length > 0) {
  console.error(`Problemas:\n${problemas.join('\n')}`);
  process.exitCode = 1;
}
