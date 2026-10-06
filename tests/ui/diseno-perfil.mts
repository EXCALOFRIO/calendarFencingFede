/**
 * Capturas sin servidor del diseño del perfil y de /ranking a 320, 393 y 1440
 * px: cabecera y pestaña Ranking de un español en activo, un extranjero, un
 * retirado y un olímpico; resultados y rivales del español; /ranking
 * Nacional, Internacional y «Solo JJOO» con la tarjeta del tirador cruzada
 * por persona; y la cabecera de la aplicación con la marca. Falla si algo se
 * desborda en horizontal o si un objetivo táctil del perfil baja de 44 px.
 *
 *   $env:PERF_DB=<copia SQLite de D1>
 *   $env:INTERNACIONALES=<dir con NN-*.sql>   (opcional: rankings internacionales superpuestos)
 *   $env:RANKING_SQL=<dir con ranking-*.sql>  (opcional: ranking nacional por temporadas)
 *   $env:FASE=sin-sql | con-sql               (subcarpeta de salida)
 *   npx tsx --import ./tests/ui/auditoria-sonda.mts tests/ui/diseno-perfil.mts
 *
 * La copia se abre en sólo lectura; los SQL van a un SQLite temporal con sólo
 * las tablas de ranking (ver `ranking-superposicion.mts`). Salida en
 * `capturas/diseno-perfil/<FASE>/`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
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
import { Marca } from '@/components/marca';
import { CabeceraFicha, FichaCompleta, PanelRivales, PestanaRanking } from '@/components/explorar/ficha-deportiva';
import { RankingAmbitoPerfil } from '@/components/explorar/perfil/ranking-ambito';
import { ResultadosPerfilVista } from '@/components/explorar/perfil/resultados-perfil';
import { conClasificacionFie, ladoMundial, ladoNacional } from '@/components/ranking/armar-ficha';
import { PanelRanking, type FichaPanel } from '@/components/ranking/panel-ranking';
import { SelectorTemporada } from '@/components/ranking/selector-temporada';
import { TablaRankingOficial } from '@/components/ranking/tabla-oficial';
import { completarTablaFie } from '@/app/(app)/ranking/consultas';
import { getAnotacionesOlimpicas } from '@/lib/queries/olimpica';
import { getClasificacionFie, getRankingOficialScreenData, groupKey, listGruposClasificacionFie, type PuestoOficial } from '@/lib/queries/ranking';
import { personasOficiales } from '@/lib/queries/personas-ranking';
import { listarTemporadasNacionales } from '@/lib/queries/ranking-temporadas';
import { leerFiltroRankingNacional } from '@/lib/ranking/url-nacional';
import { chipsRanking } from '@/lib/sport/explorar/chips-ranking';
import { cargarDiferidosPerfil } from '@/lib/sport/explorar/perfil-diferido';
import { cargarExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { resolverPersona } from '@/lib/sport/explorar/personas';
import { bloquesRankingPerfil } from '@/lib/sport/explorar/ranking-ambitos';
import { leerPuestosOficialesVigentes, leerResumenMundial } from '@/lib/sport/explorar/ranking-nacional';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { crearContexto } from '../helpers/explorar';
import { bindingDeLectura } from './d1-lectura.mts';

const RAIZ = process.cwd();
const FASE = process.env.FASE ?? 'sin-sql';
const SALIDA = path.join(RAIZ, 'capturas', 'diseno-perfil', FASE);
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const DIRS = [
  process.env.INTERNACIONALES ? { dir: process.env.INTERNACIONALES, patron: /^\d{2}-.*\.sql$/ } : null,
  process.env.RANKING_SQL ? { dir: process.env.RANKING_SQL, patron: /^ranking-.*\.sql$/ } : null,
].filter((d) => d !== null);

/**
 * Sin SQL, la copia en sólo lectura. Con SQL, un SQLite temporal con sólo las
 * tablas de ranking (lo de la copia más los SQL en orden) y la copia adjunta
 * para todo lo demás: la copia no se toca.
 */
function abrir(): { sqlite: DatabaseSync; temporal: string | null } {
  if (DIRS.length === 0) return { sqlite: new DatabaseSync(BASE!, { readOnly: true }), temporal: null };
  const destino = path.join(tmpdir(), `diseno-perfil-${process.pid}.sqlite`);
  if (existsSync(destino)) rmSync(destino);
  const db = new DatabaseSync(destino, { enableForeignKeyConstraints: false });
  db.exec(`ATTACH DATABASE 'file:${BASE!.replace(/\\/g, '/')}?mode=ro' AS src`);
  const ddl = db.prepare(`SELECT type, sql FROM src.sqlite_master
    WHERE sql IS NOT NULL AND tbl_name IN ('sport_ranking_publication','sport_ranking_entry') AND type IN ('table','index')
    ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, CASE tbl_name WHEN 'sport_ranking_publication' THEN 0 ELSE 1 END`).all() as { sql: string }[];
  for (const d of ddl) db.exec(d.sql);
  db.exec('INSERT INTO main.sport_ranking_publication SELECT * FROM src.sport_ranking_publication');
  db.exec('INSERT INTO main.sport_ranking_entry SELECT * FROM src.sport_ranking_entry');
  db.exec('BEGIN');
  for (const { dir, patron } of DIRS) {
    for (const f of readdirSync(dir).filter((x) => patron.test(x)).sort()) {
      for (const linea of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        if (/^INSERT INTO sport_ranking_(publication|entry)\b/.test(linea)) db.exec(linea);
      }
    }
  }
  db.exec('COMMIT');
  return { sqlite: db, temporal: destino };
}

const { sqlite, temporal } = abrir();
const binding = bindingDeLectura(sqlite);
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: binding }, ctx: {}, cf: {} };
const db = createD1Database(binding);
const ctx = { ...crearContexto().ctx, db };
const informe: string[] = [`fase ${FASE}: ${DIRS.map((d) => path.basename(d.dir)).join(' + ') || 'sin SQL superpuestos'}`];

function personaPorNombre(nombre: string): string {
  const fila = sqlite.prepare(`SELECT id FROM sport_person WHERE display_name = ? AND merged_into_person_id IS NULL
    ORDER BY (SELECT count(*) FROM sport_result r WHERE r.person_id = sport_person.id) DESC LIMIT 1`).get(nombre) as { id: string } | undefined;
  if (!fila) throw new Error(`sin persona: ${nombre}`);
  return fila.id;
}

async function personaOlimpica(): Promise<string | null> {
  for (const [arma, genero] of [['FLORETE', 'M'], ['ESPADA', 'F'], ['SABLE', 'M']] as const) {
    const a = await getAnotacionesOlimpicas(arma, genero);
    for (const [fieId, anotacion] of Object.entries(a?.individual ?? {})) {
      if (anotacion.estado !== 'clasificado') continue;
      const fila = sqlite.prepare(`SELECT x.person_id AS id FROM sport_external_id x WHERE x.scheme = 'fie_addr_id' AND x.value = ? AND x.link_status = 'CONFIRMADO' LIMIT 1`).get(fieId) as { id: string } | undefined;
      if (fila) return fila.id;
    }
  }
  return null;
}

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };

function documento(css: string, cuerpo: React.ReactElement, ruta = '/explorar', consulta = '', cabecera = ''): string {
  const conContexto = React.createElement(AppRouterContext.Provider, { value: ROUTER as never },
    React.createElement(PathnameContext.Provider, { value: ruta },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(consulta) }, cuerpo)));
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased">${cabecera}<main class="ancho-app flex flex-1 flex-col px-4 py-4">${renderToStaticMarkup(conContexto)}</main></body></html>`;
}

type Pagina = { nombre: string; html: string; recorte?: number; tactil?: boolean };
const paginas: Pagina[] = [];
const css = await compilarCss();

async function paginasDePersona(clave: string, id: string) {
  const [vista, extras] = await Promise.all([
    cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS, { diferirRivales: true }),
    cargarExtrasPerfil(ctx, id),
  ]);
  if (vista.tipo !== 'ok') throw new Error(`${clave}: ${vista.tipo}`);
  const diferidos = cargarDiferidosPerfil(ctx, id);
  const europeo = await diferidos.europeo;
  const chips = chipsRanking({
    nacional: extras.rankingNacional, mundial: extras.rankingMundial, resumenMundial: extras.resumenMundial,
    ambitos: extras.rankingAmbitos ?? null, olimpica: extras.olimpica,
  });
  const bloques = bloquesRankingPerfil(extras);
  informe.push(`${clave} (${vista.ficha.nombre}, ${extras.rankingAmbitos?.pais ?? 'sin país'}): cabecera ${chips.map((c) => `${c.ambito} ${c.puesto}º${c.actual ? '' : ` (mejor ${c.temporada})`}`).join(', ') || 'sin filas'}; pestaña ${bloques.hay ? 'sí' : 'no'} [${[
    bloques.internacional && `Internacional ${bloques.internacional.actual.map((p) => `${p.puesto}º`).join('/') || `mejor ${bloques.internacional.mejor?.puesto}º`}`,
    bloques.mundial && 'Internacional (lista FIE)', europeo && 'Europeo', bloques.nacional && `Nacional ${bloques.nacional.mejor?.puesto}º`, bloques.nacionalFuera && 'Nacional (federación propia)',
  ].filter(Boolean).join(', ')}]`);
  const cabecera = React.createElement(CabeceraFicha, { ficha: vista.ficha, datos: extras.datos, chips });
  paginas.push({ nombre: `${clave}-cabecera`, html: documento(css, cabecera), tactil: true });
  const pestana = React.createElement('div', { className: 'flex min-w-0 flex-col gap-8' },
    React.createElement(PestanaRanking, {
      bloques, nivel: 'pagina',
      europeo: europeo ? React.createElement(RankingAmbitoPerfil, { titulo: 'Europeo', bloque: europeo, nivel: 'pagina' }) : null,
    }));
  paginas.push({ nombre: `${clave}-ranking`, html: documento(css, pestana), recorte: 2400 });
  return { vista, diferidos };
}

const llavador = personaPorNombre(process.env.NOMBRE_ESP ?? 'LLAVADOR Carlos');
const personas: [string, string][] = [
  ['espanol', llavador],
  ['extranjero', personaPorNombre(process.env.NOMBRE_EXT ?? 'RANVIER Pauline')],
  ['retirado', personaPorNombre(process.env.NOMBRE_RET ?? 'ABAJO Jose Luis')],
];
const olimpico = await personaOlimpica();
if (olimpico) personas.push(['olimpico', olimpico]);
// Sólo ranking europeo: la pestaña Ranking tiene que salir aunque el bloque llegue en diferido.
if (DIRS.length > 0) personas.push(['europeo', personaPorNombre(process.env.NOMBRE_EUR ?? 'PETTOLA Chiara')]);

for (const [clave, id] of personas) {
  const { vista, diferidos } = await paginasDePersona(clave, id);
  if (clave === 'europeo') {
    const extras = await cargarExtrasPerfil(ctx, id);
    paginas.push({
      nombre: 'europeo-pestanas', tactil: true, recorte: 900,
      html: documento(css, React.createElement(FichaCompleta, {
        ficha: vista.ficha, historial: vista.historial, base: `${RUTA_EXPLORAR}/${id}`, criterios: CRITERIOS_FICHA_VACIOS, nivel: 'pagina', extras,
      })),
    });
  }
  if (clave !== 'espanol') continue;
  const perfil = vista.ficha.perfil!;
  if (perfil.resultados) {
    paginas.push({
      nombre: 'espanol-resultados', tactil: true, recorte: 1600,
      html: documento(css, React.createElement(ResultadosPerfilVista, {
        personaId: id, resultados: perfil.resultados, base: `${RUTA_EXPLORAR}/${id}`, criterios: CRITERIOS_FICHA_VACIOS, nivel: 'pagina',
      })),
    });
  }
  const rivales = await diferidos.rivales;
  paginas.push({
    nombre: 'espanol-rivales', tactil: true, recorte: 3600,
    html: documento(css, React.createElement('div', { className: 'flex min-w-0 flex-col gap-8' },
      React.createElement(PanelRivales, { ficha: vista.ficha, perfil: { ...perfil, rivalesStats: rivales.stats }, enfrentados: rivales.enfrentados, nivel: 'pagina' }))),
  });
  paginas.push({
    nombre: 'espanol-rivales-clasico', tactil: true, recorte: 3600,
    html: documento(css, React.createElement('div', { className: 'flex min-w-0 flex-col gap-8' },
      React.createElement(PanelRivales, { ficha: vista.ficha, perfil: { ...perfil, rivalesStats: rivales.stats }, nivel: 'pagina' }))),
  });
}

/** /ranking como lo monta la página: la tarjeta cruza por la persona y sus fusiones, nunca por el nombre. */
async function paginaRanking(federacion: 'RFEE' | 'FIE', consulta = '') {
  const grupo = { weapon: 'FLORETE', gender: 'M', category: 'ABS' } as const;
  const atleta = 'atleta-llavador';
  const ids = (await resolverPersona(db, llavador))?.ids ?? [llavador];
  const [oficial, temporadas, mundial, puestos, resumen] = await Promise.all([
    getRankingOficialScreenData(), listarTemporadasNacionales(db), listGruposClasificacionFie(),
    leerPuestosOficialesVigentes(db, ids), leerResumenMundial(db, ids),
  ]);
  const personasRfee = await personasOficiales(db, oficial.seasonLabel);
  const nacional = ladoNacional(puestos.map((f): PuestoOficial => ({
    athleteId: atleta, seasonLabel: f.temporada, weapon: f.arma as PuestoOficial['weapon'], gender: f.genero as PuestoOficial['gender'],
    category: f.categoria, categoryRaw: f.categoriaRaw, position: f.puesto === null ? null : Number(f.puesto),
    totalPoints: f.puntos === null ? null : Number.parseFloat(f.puntos), club: f.club, deCuantos: f.clasificados,
    actualizadoEl: new Date(Number(f.lectura ?? 0)), sourceUrl: f.url,
  })), { licencia: null, anioNacimiento: null });
  const compacto = (lado: ReturnType<typeof ladoNacional>) => ({
    federacion: lado.federacion, etiqueta: lado.etiqueta, motivoVacio: lado.motivoVacio,
    mejor: lado.variantes[0] ? { etiqueta: lado.variantes[0].etiqueta, puesto: lado.variantes[0].insignia.puesto } : null,
  });
  const ficha: FichaPanel = {
    athleteId: atleta, nombre: 'Carlos', apellidos: 'Llavador Fernández', personaId: llavador,
    lados: [compacto(nacional), conClasificacionFie(compacto(ladoMundial(null)), resumen.actuales ?? [])],
  };
  const tabla = oficial.tables[groupKey(grupo)];
  const enLista = tabla?.rows.find((r) => ids.includes(personasRfee[r.id] ?? ''));
  const primera = await completarTablaFie(await getClasificacionFie({ format: 'INDIVIDUAL', ...grupo, athleteIdsPropios: [] }));
  const enFie = primera?.rows.find((r) => ids.includes(primera.personas[String(r.fieId)] ?? ''));
  informe.push(`/ranking ${federacion}${consulta ? ` ?${consulta}` : ''}: tarjeta Nacional ${ficha.lados[0].mejor?.puesto ?? '—'}º / Internacional ${ficha.lados[1].mejor?.puesto ?? '—'}º; lista nacional ${enLista?.position ?? '—'}º, lista FIE ${enFie?.position ?? '—'}º`);
  const vigente = oficial.seasonLabel ?? temporadas[0] ?? null;
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'mb-6 flex flex-wrap items-center gap-x-3 gap-y-2' },
      React.createElement('h1', { className: 'text-3xl sm:text-4xl' }, 'Ranking')),
    React.createElement(PanelRanking, {
      federacionInicial: federacion,
      fichas: [ficha],
      rfee: React.createElement(TablaRankingOficial, {
        grupos: oficial.groups, tablas: oficial.tables, cortes: oficial.cutoffs, desgloses: {}, internos: {},
        mios: [], grupoInicial: groupKey(grupo), conMiFicha: true, personas: personasRfee,
        selectorTemporada: React.createElement(SelectorTemporada, { temporadas: [...new Set([...(vigente ? [vigente] : []), ...temporadas])], vigente, actual: leerFiltroRankingNacional({}) }),
      }),
      fie: { grupos: mundial.grupos, inicial: { format: 'INDIVIDUAL', ...grupo }, primeraTabla: primera, mios: [], cargar: async () => null },
    }));
}

paginas.push(
  { nombre: 'ranking-nacional', html: documento(css, await paginaRanking('RFEE'), '/ranking'), recorte: 1600, tactil: true },
  { nombre: 'ranking-internacional', html: documento(css, await paginaRanking('FIE'), '/ranking'), recorte: 1600, tactil: true },
  { nombre: 'ranking-internacional-jjoo', html: documento(css, await paginaRanking('FIE', 'jjoo=1'), '/ranking', 'jjoo=1'), recorte: 1600, tactil: true },
);

// La cabecera de `(app)/layout.tsx` con sus mismas clases, para medir la marca.
const marca = renderToStaticMarkup(React.createElement(Marca, { className: 'size-7', titulo: 'CalendarFencing, al calendario' }));
paginas.push({
  nombre: 'cabecera-app', tactil: true,
  html: documento(css, React.createElement('p', { className: 'text-sm text-muted-foreground' }, 'Explorar'), '/explorar', '',
    `<header class="sticky top-0 z-30 border-b bg-card"><div class="ancho-app flex h-14 items-center gap-4 px-4"><a href="/" class="-mx-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2.5 px-2">${marca}</a></div></header>`),
});

mkdirSync(SALIDA, { recursive: true });
const html = new Map(paginas.map((p) => [`/${p.nombre}`, p.html]));
const servidor = createServer((pet, res) => {
  const url = new URL(pet.url ?? '/', 'http://x');
  const pagina = html.get(decodeURIComponent(url.pathname));
  if (pagina) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pagina);
    return;
  }
  const fichero = path.join(RAIZ, 'public', path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
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
const anchos = [
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];

const capturas: string[] = [];
const problemas: string[] = [];
try {
  for (const p of paginas) {
    for (const a of anchos) {
      const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
      await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
      await pagina.evaluate(() => document.fonts.ready);
      const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
      if (ancho > a.viewport.width) problemas.push(`${p.nombre} @${a.viewport.width}: scrollWidth ${ancho}`);
      if (p.tactil && a.viewport.width < 768) {
        // Objetivos táctiles de menos de 44 px (si no están dentro de otro que sí llega).
        const pequenos = await pagina.evaluate(() => [...document.querySelectorAll<HTMLElement>('a[href], button, select, input:not([type=hidden]), summary, label:has(input[type=radio])')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width <= 1 || r.height <= 1 || getComputedStyle(el).visibility === 'hidden') return false;
            if (el.matches('input[type=radio]')) return false;
            const padre = el.parentElement?.closest<HTMLElement>('a[href], button, label');
            const rp = padre?.getBoundingClientRect();
            if (rp && rp.height >= 43.5 && rp.width >= 43.5) return false;
            return r.height < 43.5 || r.width < 43.5;
          })
          .map((el) => `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)} ${el.tagName.toLowerCase()} «${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}»`));
        if (pequenos.length > 0) informe.push(`  táctil ${p.nombre} @${a.viewport.width}: ${pequenos.length} por debajo de 44 px: ${[...new Set(pequenos)].slice(0, 6).join(' | ')}`);
      }
      const destino = path.join(SALIDA, `${p.nombre}-${a.sufijo}.png`);
      const total = await pagina.evaluate(() => document.scrollingElement!.scrollHeight);
      const alto = Math.min(p.recorte ?? total, total);
      await pagina.setViewportSize({ width: a.viewport.width, height: Math.max(a.viewport.height, alto) });
      await pagina.screenshot({ path: destino, clip: { x: 0, y: 0, width: a.viewport.width, height: alto } });
      capturas.push(path.relative(RAIZ, destino));
      await pagina.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
  sqlite.close();
  if (temporal && existsSync(temporal)) rmSync(temporal);
}

console.log(`${capturas.length} capturas en ${path.relative(RAIZ, SALIDA)}`);
console.log(informe.join('\n'));
if (problemas.length > 0) {
  console.error(`Problemas:\n${problemas.join('\n')}`);
  process.exitCode = 1;
}
