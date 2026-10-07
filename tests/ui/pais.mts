/**
 * Matriz de dispositivos de las fichas de país, sin servidor de la aplicación:
 * la ficha de España (sin filtros y en M20 espada) y el cara a cara España -
 * Italia (M20 espada masculina y por equipos), pintados con los datos de una
 * copia con la 0018 reconstruida, más una maqueta con relevos (la copia no
 * tiene relevos entre selecciones: Engarde sólo los publica de clubes). Mide
 * con `medirVariante` de la matriz (táctil < 40 px, texto < 12 px, desborde,
 * consola…) en todas las variantes y deja las capturas en `capturas/pais/`.
 *
 *   PAIS_DB=<copia SQLite con la 0018 reconstruida> npx tsx tests/ui/pais.mts [--rapido]
 *
 * La copia se abre en sólo lectura. Falla si hay algún control táctil por
 * debajo de 40 px, texto por debajo de 12 px o desborde horizontal.
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
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
import { DueloPaisesVista } from '@/components/explorar/pais/duelo-paises';
import { FichaPaisVista } from '@/components/explorar/pais/ficha-pais';
import { leerDueloPaises, leerFichaPais, type DueloPaises } from '@/lib/sport/explorar/pais';
import { nombrePaisFie } from '@/lib/sport/explorar/pais-codigos';
import { frasesDuelo, frasesPais } from '@/lib/sport/explorar/pais-frases';
import { leerFiltrosDuelo, leerFiltrosPais, rutaDuelo, rutaPais } from '@/lib/sport/explorar/pais-url';
import { parsearMatriz } from './matriz-config.mts';
import { medirVariante } from './matriz-medir.mts';
import { d1DeLectura } from './d1-lectura.mts';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'pais');
const BASE = process.env.PAIS_DB;
if (!BASE) throw new Error('Falta PAIS_DB');
const rapido = process.argv.includes('--rapido');

const sqlite = new DatabaseSync(BASE, { readOnly: true });
const db = d1DeLectura(sqlite);

type Pagina = { nombre: string; ruta: string; cuerpo: React.ReactElement };

async function ficha(nombre: string, codigo: string, q: Record<string, string>): Promise<Pagina> {
  const filtros = leerFiltrosPais(q);
  const datos = await leerFichaPais(db, codigo, filtros);
  return {
    nombre,
    ruta: rutaPais(codigo),
    cuerpo: React.createElement(FichaPaisVista, { ficha: datos, filtros, frases: frasesPais(nombrePaisFie(codigo), datos, filtros) }),
  };
}

function duelo(nombre: string, d: DueloPaises, q: Record<string, string>): Pagina {
  const filtros = leerFiltrosDuelo(q);
  return {
    nombre,
    ruta: rutaDuelo(d.codigo, d.rival),
    cuerpo: React.createElement(DueloPaisesVista, {
      duelo: d, pagina: d, filtros, categorias: d.categorias, desde: '',
      frases: frasesDuelo(nombrePaisFie(d.codigo), nombrePaisFie(d.rival), d, filtros),
    }),
  };
}

const M20 = { arma: 'ESPADA', genero: 'M', categoria: 'M20' };
const EQUIPOS = { modalidad: 'equipos' };
const espIta = await leerDueloPaises(db, 'ESP', 'ITA', leerFiltrosDuelo(M20));
const espItaEquipos = await leerDueloPaises(db, 'ESP', 'ITA', leerFiltrosDuelo(EQUIPOS));

/** Maqueta: los relevos de un encuentro con los tiradores de los cruces individuales reales. */
function conRelevos(d: DueloPaises, individual: DueloPaises): DueloPaises {
  const nuestros = individual.pruebas.flatMap((p) => p.cruces.map((c) => c.nuestro)).slice(0, 3);
  const suyos = individual.pruebas.flatMap((p) => p.cruces.map((c) => c.suyo)).slice(0, 3);
  const [prueba, ...resto] = d.pruebas;
  if (!prueba?.cruces[0] || nuestros.length < 3 || suyos.length < 3) return d;
  let mn = 0;
  let ms = 0;
  const relevos = Array.from({ length: 9 }, (_, i) => {
    const tn = [5, 3, 6, 4, 5, 4, 6, 3, 9][i];
    const ts = [4, 5, 5, 6, 3, 5, 4, 6, 7][i];
    mn += tn;
    ms += ts;
    return { numero: i + 1, nuestro: nuestros[i % 3], suyo: suyos[(i + 1) % 3], tocadosNuestros: tn, tocadosSuyos: ts, marcadorNuestro: mn, marcadorSuyo: ms };
  });
  const cruce = { ...prueba.cruces[0], tocadosNuestros: mn, tocadosSuyos: ms, relevos };
  return { ...d, pruebas: [{ ...prueba, cruces: [cruce, ...prueba.cruces.slice(1)] }, ...resto] };
}

const paginas: Pagina[] = [
  await ficha('ficha-esp', 'ESP', {}),
  await ficha('ficha-esp-espada-m20', 'ESP', { arma: 'ESPADA', categoria: 'M20' }),
  duelo('duelo-esp-ita-m20-espada', espIta, M20),
  duelo('duelo-esp-ita-equipos', espItaEquipos, EQUIPOS),
  duelo('duelo-relevos-maqueta', conRelevos(espItaEquipos, espIta), EQUIPOS),
];

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };

function documento(css: string, p: Pagina): string {
  const conContexto = React.createElement(AppRouterContext.Provider, { value: ROUTER as never },
    React.createElement(PathnameContext.Provider, { value: p.ruta },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams('') }, p.cuerpo)));
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<title>${p.nombre}</title>
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-[16px] py-[16px] sm:px-[24px]">${renderToStaticMarkup(conContexto)}</main></body></html>`;
}

const css = await compilarCss();
const html = new Map(paginas.map((p) => [`/${p.nombre}`, documento(css, p)]));
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
  res.writeHead(200, { 'content-type': fichero.endsWith('.png') ? 'image/png' : 'application/octet-stream' }).end(readFileSync(fichero));
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const puerto = (servidor.address() as AddressInfo).port;

const variantes = parsearMatriz({ rapido });
const navegador = await chromium.launch();
const filas: string[] = [];
let fallos = 0;
mkdirSync(SALIDA, { recursive: true });
try {
  for (const p of paginas) {
    for (const v of variantes) {
      const r = await medirVariante(navegador, `http://127.0.0.1:${puerto}/${p.nombre}`, v, { alias: 'pais', pagina: p.nombre, ruta: p.ruta }, { carpeta: SALIDA, raiz: RAIZ });
      const m = r.medida;
      const tactiles = m?.tactiles.length ?? -1;
      const texto = m?.textoPequenoTotal ?? -1;
      const desborde = m?.desborde ?? -1;
      const consola = r.consola.length;
      const mal = r.error || tactiles !== 0 || texto !== 0 || desborde > 0;
      if (mal) fallos += 1;
      filas.push(`| ${p.nombre} | ${v.clave} | ${tactiles} | ${texto} | ${desborde} | ${consola} | ${r.error ?? ''}${mal && m ? ` ${[...m.tactiles, ...m.textoPequeno, ...m.culpables].slice(0, 3).join(' · ')}` : ''} |`);
    }
  }
} finally {
  await navegador.close();
  servidor.close();
  sqlite.close();
}

const informe = [
  `# Fichas de país: matriz de dispositivos`,
  '',
  `${paginas.length} pantallas × ${variantes.length} variantes. Capturas en \`capturas/pais/<variante>/<pantalla>.png\`.`,
  '',
  '| Pantalla | Variante | Táctil < 40 | Texto < 12 | Desborde px | Consola | Notas |',
  '|---|---|---:|---:|---:|---:|---|',
  ...filas,
  '',
].join('\n');
writeFileSync(path.join(SALIDA, 'informe.md'), informe);
console.log(informe);
if (fallos > 0) {
  console.error(`${fallos} medidas con fallos`);
  process.exitCode = 1;
}
