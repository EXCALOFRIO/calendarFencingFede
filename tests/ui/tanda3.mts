/**
 * Capturas sin servidor de la tercera tanda de ranking y perfil, a 393, 320 y
 * 1440 px: la cabecera con sus dos filas de ranking (Internacional y
 * Nacional) y las tres caras de la tarjeta, y la pestaña Ranking con sus
 * bloques (Internacional, Europeo, Nacional), para un español en activo, un
 * extranjero con federación leída, un retirado y alguien en zona olímpica.
 * Además, /ranking nacional de la temporada vigente. Falla si algo se desborda
 * en horizontal a 393 o 320 px.
 *
 *   PERF_DB=<copia SQLite de D1 con los rankings cargados> npx tsx tests/ui/tanda3.mts
 *
 * La copia se abre en sólo lectura. Salida en `capturas/tanda3/`.
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
import { RankingNacionalPerfil } from '@/components/explorar/perfil/ranking-perfil';
import { RankingAmbitoPerfil, SeccionRanking } from '@/components/explorar/perfil/ranking-ambito';
import { PanelRanking, type FichaPanel } from '@/components/ranking/panel-ranking';
import { SelectorTemporada } from '@/components/ranking/selector-temporada';
import { TablaRankingOficial } from '@/components/ranking/tabla-oficial';
import { getAnotacionesOlimpicas } from '@/lib/queries/olimpica';
import { getRankingOficialScreenData, groupKey, listGruposClasificacionFie } from '@/lib/queries/ranking';
import { personasOficiales } from '@/lib/queries/personas-ranking';
import { listarTemporadasNacionales } from '@/lib/queries/ranking-temporadas';
import { leerFiltroRankingNacional } from '@/lib/ranking/url-nacional';
import { chipsRanking } from '@/lib/sport/explorar/chips-ranking';
import { cargarDiferidosPerfil } from '@/lib/sport/explorar/perfil-diferido';
import { cargarExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { conClasificacionVigente, esEspanol } from '@/lib/sport/explorar/ranking-ambitos';
import { leerPuestosOficialesVigentes } from '@/lib/sport/explorar/ranking-nacional';
import { crearContexto } from '../helpers/explorar';
import { bindingDeLectura } from './d1-lectura.mts';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'tanda3');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');

const sqlite = new DatabaseSync(BASE, { readOnly: true });
const binding = bindingDeLectura(sqlite);
// Las consultas de `@/lib/queries/*` usan la D1 global (`@/db`): se le da esta copia.
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: binding }, ctx: {}, cf: {} };
const db = createD1Database(binding);
const ctx = { ...crearContexto().ctx, db };

/** Por nombre y no por id: la copia se regenera y los ids pueden cambiar. */
function personaPorNombre(nombre: string): string {
  const fila = sqlite.prepare(`SELECT id FROM sport_person WHERE display_name = ? AND merged_into_person_id IS NULL
    ORDER BY (SELECT count(*) FROM sport_result r WHERE r.person_id = sport_person.id) DESC LIMIT 1`).get(nombre) as { id: string } | undefined;
  if (!fila) throw new Error(`sin persona: ${nombre}`);
  return fila.id;
}

/** Alguien de las seis pruebas olímpicas en zona de clasificación, si la copia tiene a alguno con ficha. */
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

function documento(css: string, cuerpo: React.ReactElement, ruta = '/explorar'): string {
  const conContexto = React.createElement(AppRouterContext.Provider, { value: ROUTER as never },
    React.createElement(PathnameContext.Provider, { value: ruta },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams('') }, cuerpo)));
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-4 py-4">${renderToStaticMarkup(conContexto)}</main></body></html>`;
}

type Pagina = { nombre: string; cuerpo: React.ReactElement; ruta?: string; recorte?: number };
const informe: string[] = [];

async function paginasDePersona(clave: string, id: string): Promise<Pagina[]> {
  const [vista, extras] = await Promise.all([
    cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS, { diferirRivales: true }),
    cargarExtrasPerfil(ctx, id),
  ]);
  if (vista.tipo !== 'ok') throw new Error(`${clave}: ${vista.tipo}`);
  const europeo = await cargarDiferidosPerfil(ctx, id).europeo;
  const ambitos = extras.rankingAmbitos ?? null;
  const chips = chipsRanking({
    nacional: extras.rankingNacional, mundial: extras.rankingMundial, resumenMundial: extras.resumenMundial, ambitos, olimpica: extras.olimpica,
  });
  informe.push(`${clave} (${vista.ficha.nombre}, ${ambitos?.pais ?? 'sin país'}): ${JSON.stringify(chips.map((c) => ({ ...c, olimpica: c.olimpica?.estado })))}`);
  const cabecera = (cara: number) => React.createElement(CabeceraFicha, { ficha: vista.ficha, datos: extras.datos, chips, caraInicial: cara });
  const extranjero = ambitos !== null && !esEspanol(ambitos.pais);
  const nacional = !extranjero && extras.rankingNacional?.mejor ? extras.rankingNacional : null;
  const internacional = conClasificacionVigente(ambitos?.internacional ?? null, extras.resumenMundial);
  const pestana = React.createElement('div', { className: 'flex min-w-0 flex-col gap-8' },
    internacional ? React.createElement(RankingAmbitoPerfil, { titulo: 'Internacional', bloque: internacional, nivel: 'pagina' }) : null,
    europeo ? React.createElement(RankingAmbitoPerfil, { titulo: 'Europeo', bloque: europeo, nivel: 'pagina' }) : null,
    nacional ? React.createElement(SeccionRanking, { titulo: 'Nacional', detalle: 'RFEE', nivel: 'pagina' },
      React.createElement(RankingNacionalPerfil, { ranking: nacional, nivel: 'pagina' })) : null,
    extranjero && ambitos.nacionalFuera ? React.createElement(RankingAmbitoPerfil, { titulo: 'Nacional', bloque: ambitos.nacionalFuera, nivel: 'pagina' }) : null,
  );
  const paginas: Pagina[] = [
    { nombre: `${clave}-cabecera`, cuerpo: cabecera(0) },
    { nombre: `${clave}-ranking`, cuerpo: pestana, recorte: 2400 },
  ];
  const ambito = vista.ficha.perfil?.ambito;
  if (ambito && ambito.internacional.competiciones > 0 && ambito.nacional.competiciones > 0) {
    paginas.push({ nombre: `${clave}-cara-internacional`, cuerpo: cabecera(1) }, { nombre: `${clave}-cara-nacional`, cuerpo: cabecera(2) });
  }
  return paginas;
}

/** /ranking nacional vigente, con la tarjeta del tirador por la misma lectura que su perfil. */
async function paginaRanking(personaId: string, apellidos: string, nombre: string): Promise<Pagina> {
  const grupo = { weapon: 'FLORETE', gender: 'M', category: 'ABS' } as const;
  const [oficial, temporadas, mundial, puestos] = await Promise.all([
    getRankingOficialScreenData(), listarTemporadasNacionales(db), listGruposClasificacionFie(), leerPuestosOficialesVigentes(db, [personaId]),
  ]);
  const personas = await personasOficiales(db, oficial.seasonLabel);
  const mejor = puestos.find((p) => p.categoria === 'ABS') ?? puestos[0];
  informe.push(`/ranking tarjeta ${apellidos}: ${mejor ? `${mejor.puesto}º de ${mejor.clasificados} (${mejor.temporada})` : 'sin puesto'}`);
  const ficha: FichaPanel = {
    athleteId: 'atleta', nombre, apellidos, personaId,
    lados: [
      { federacion: 'RFEE', etiqueta: 'Nacional', mejor: mejor ? { etiqueta: 'Florete absoluto', puesto: mejor.puesto } : null },
      { federacion: 'FIE', etiqueta: 'Internacional', mejor: null },
    ],
  };
  const vigente = oficial.seasonLabel ?? temporadas[0] ?? null;
  return {
    nombre: 'ranking-nacional',
    ruta: '/ranking',
    recorte: 1500,
    cuerpo: React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'mb-6 flex flex-wrap items-center gap-x-3 gap-y-2' },
        React.createElement('h1', { className: 'text-3xl sm:text-4xl' }, 'Ranking')),
      React.createElement(PanelRanking, {
        federacionInicial: 'RFEE',
        fichas: [ficha],
        rfee: React.createElement(TablaRankingOficial, {
          grupos: oficial.groups, tablas: oficial.tables, cortes: oficial.cutoffs, desgloses: {}, internos: {},
          mios: [], grupoInicial: groupKey(grupo), conMiFicha: true, personas,
          selectorTemporada: React.createElement(SelectorTemporada, { temporadas: [...new Set([...(vigente ? [vigente] : []), ...temporadas])], vigente, actual: leerFiltroRankingNacional({}) }),
        }),
        fie: { grupos: mundial.grupos, inicial: { format: 'INDIVIDUAL', ...grupo }, primeraTabla: null, mios: [], cargar: async () => null },
      })),
  };
}

const llavador = personaPorNombre(process.env.NOMBRE_ESP ?? 'LLAVADOR Carlos');
const personas: [string, string][] = [
  ['espanol', llavador],
  ['extranjero', personaPorNombre(process.env.NOMBRE_EXT ?? 'RANVIER Pauline')],
  ['retirado', personaPorNombre(process.env.NOMBRE_RET ?? 'ABAJO Jose Luis')],
];
const olimpico = await personaOlimpica();
if (olimpico) personas.push(['olimpico', olimpico]);

const paginas: Pagina[] = [await paginaRanking(llavador, 'Llavador Fernández', 'Carlos')];
for (const [clave, id] of personas) paginas.push(...(await paginasDePersona(clave, id)));

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
const anchos = [
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
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
      if (a.viewport.width < 768 && ancho > a.viewport.width) {
        const culpables = await pagina.evaluate((w) => [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((el) => el.getBoundingClientRect().right > w + 0.5 && el.offsetParent !== null)
          .slice(0, 8).map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 80)}`), a.viewport.width);
        problemas.push(`${p.nombre} @${a.viewport.width}: scrollWidth ${ancho}\n    ${culpables.join('\n    ')}`);
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
}

console.log(capturas.join('\n'));
console.log(informe.join('\n'));
if (problemas.length > 0) {
  console.error(`Problemas:\n${problemas.join('\n')}`);
  process.exitCode = 1;
}
