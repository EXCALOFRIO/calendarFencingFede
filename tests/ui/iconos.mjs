import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Banco de pruebas del icono de arma QUE HAY AHORA EN EL COMPONENTE.
 *
 *   node tests/ui/iconos.mjs   →  capturas/iconos.png
 *
 * Lo pinta a los tamaños REALES a los que vive y dentro de los contextos
 * reales: una barra estrecha del mes, una tarjeta grande de competición, una
 * pastilla de prueba y un selector. Existe porque cinco versiones de estos
 * iconos se dieron por buenas mirándolas a 48 px y a 12 px eran las tres la
 * misma mancha.
 *
 * Para comparar PROPUESTAS nuevas está el otro banco:
 *   node tests/ui/iconos-comparar.mjs
 *
 * Lee el componente en vez de copiar los trazos: la caja, el trazo, el giro y
 * los caminos salen del fichero, así que no puede quedarse desfasado.
 */

const FUENTE = 'src/components/calendario/iconos-arma.tsx';
const src = readFileSync(FUENTE, 'utf8');

/** Atributos compartidos, tal y como estén escritos en el componente. */
const attr = (nombre, def) =>
  src.match(new RegExp(`${nombre}="([^"]+)"`))?.[1] ?? def;
const VIEWBOX = attr('viewBox', '0 0 100 100');
const TRAZO = attr('strokeWidth', '6.15');
const GIRO = src.match(/<g transform="([^"]+)">/)?.[1] ?? '';

const bloques = {};
for (const nombre of ['IconoFlorete', 'IconoEspada', 'IconoSable']) {
  const i = src.indexOf(`export function ${nombre}`);
  const j = src.indexOf('</Svg>', i);
  bloques[nombre] = src
    .slice(i, j)
    .replace(/[\s\S]*?<Svg \{\.\.\.props\}>/, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\n\s+/g, ' ');
}

const ARMAS = [
  ['Florete', 'FLO'],
  ['Espada', 'ESP'],
  ['Sable', 'SAB'],
];

const svg = (nombre, px) =>
  `<svg viewBox="${VIEWBOX}" width="${px}" height="${px}" fill="none"
     stroke="currentColor" stroke-width="${TRAZO}" stroke-linecap="round"
     stroke-linejoin="round" style="flex:none">
     <g transform="${GIRO}">${bloques['Icono' + nombre]}</g>
   </svg>`;

// Los tamaños que importan. El umbral del componente es 22: por debajo no se
// usa el dibujo, y está aquí justo para poder comprobar que se hace bien.
const TAM = [12, 14, 16, 18, 22, 24, 28, 32, 64];

let html = `<!doctype html><meta charset="utf-8"><body style="
  margin:0;padding:24px;background:oklch(0.17 0.008 265);
  color:oklch(0.97 0.004 265);font:14px ui-sans-serif,system-ui">`;

// --- 1. Todos los tamaños -------------------------------------------------
html += `<table style="border-spacing:16px 10px;margin-left:-16px">
  <tr><th></th>${TAM.map(
    (t) =>
      `<th style="font:500 11px system-ui;opacity:${t < 22 ? 0.35 : 0.6}">${t}${
        t < 22 ? '*' : ''
      }</th>`,
  ).join('')}</tr>`;
for (const [nombre] of ARMAS) {
  html += `<tr><th style="text-align:right;font:500 12px system-ui;opacity:.7">${nombre}</th>${TAM.map(
    (t) => `<td style="text-align:center">${svg(nombre, t)}</td>`,
  ).join('')}</tr>`;
}
html += `</table>
  <p style="font:400 11px system-ui;opacity:.5;margin:2px 0 0">
  * por debajo de 22 px el componente NO pinta el dibujo: pinta la
  abreviatura. Están aquí para ver de qué se libra.</p>`;

// --- 2. Las tres juntas, que es la prueba de verdad -----------------------
html += `<h2 style="font:600 15px system-ui;margin:24px 0 8px">
  Las tres juntas, al tamaño de uso</h2>
  <div style="display:flex;gap:26px;align-items:center">`;
for (const px of [22, 24, 28, 32]) {
  html += `<span style="display:flex;align-items:center;gap:4px">
    ${ARMAS.map(([n]) => svg(n, px)).join('')}
    <span style="font:400 10px system-ui;opacity:.45;margin-left:4px">${px}</span>
  </span>`;
}
html += `</div>`;

// --- 3. Tarjeta grande de competición ------------------------------------
const COLOR = [
  ['rgba(198,11,30,.18)', '#f09aa5', 'RFEE'],
  ['rgba(212,175,55,.16)', '#e3c467', 'FIE'],
  ['rgba(70,130,220,.18)', '#8fb6f0', 'EFC'],
];
html += `<h2 style="font:600 15px system-ui;margin:26px 0 8px">
  En la tarjeta de competición (el caso normal)</h2>
  <div style="display:flex;gap:10px;flex-wrap:wrap">`;
for (const [i, [nombre]] of ARMAS.entries()) {
  const [fondo, tinta, org] = COLOR[i];
  html += `<div style="width:230px;border:1px solid rgba(255,255,255,.1);
    border-radius:6px;background:${fondo};padding:11px 13px">
    <div style="display:flex;align-items:center;gap:9px;color:${tinta}">
      ${svg(nombre, 28)}
      <span style="font:600 13px ui-sans-serif,system-ui">${nombre} F · Absoluto</span>
    </div>
    <div style="font:600 15px ui-sans-serif,system-ui;margin-top:7px">TNR de Alicante</div>
    <div style="font:400 12px ui-sans-serif,system-ui;opacity:.6;margin-top:2px">
      24–27 sept 2026 · ${org}</div>
  </div>`;
}
html += `</div>`;

// --- 4. Barra estrecha del mes: aquí va la abreviatura -------------------
html += `<h2 style="font:600 15px system-ui;margin:26px 0 4px">
  En la barra estrecha del mes (la excepción)</h2>
  <p style="font:400 12px system-ui;opacity:.6;margin:0 0 9px">
  Alto y letra copiados de <code>rejilla-mes.tsx</code>. Abreviatura desnuda
  al lado del género enmarcado: dos formas distintas, no dos recuadros.</p>`;
for (const [alto, rem] of [
  [16, 0.6],
  [20, 0.68],
]) {
  html += `<div style="display:flex;gap:6px;margin-bottom:5px">`;
  for (const [i, [, corta]] of ARMAS.entries()) {
    const [fondo, tinta] = COLOR[i];
    html += `<div style="display:flex;align-items:center;gap:5px;height:${alto}px;
      padding:0 6px;border-radius:3px;background:${fondo};color:${tinta};
      font:500 ${rem}rem/1 ui-sans-serif,system-ui;width:185px;overflow:hidden">
      <span style="flex:none;font-weight:700;letter-spacing:-.01em">${corta}</span>
      <span style="flex:none;display:inline-grid;place-items:center;
        width:${alto < 17 ? 12 : 14}px;height:${alto < 17 ? 12 : 14}px;border-radius:3px;
        background:rgba(255,255,255,.12);font:700 ${alto < 17 ? 0.5 : 0.6}rem/1 system-ui">F</span>
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">TNR de Alicante</span>
    </div>`;
  }
  html += `</div>`;
}

// --- 4 bis. Tres letras contra una: el choque con el género --------------
html += `<h2 style="font:600 15px system-ui;margin:24px 0 4px">
  ¿Tres letras o una? El género va al lado</h2>
  <p style="font:400 12px system-ui;opacity:.6;margin:0 0 9px">
  Existe otra propuesta en el repositorio que abrevia el arma con una sola
  inicial: F, E, S. El problema no es que no se lea —se lee— es que en la
  barra del mes el marcador de al lado es el género, y ahí «F» ya significa
  femenino. Estas son las dos, con dos armas y con una.</p>`;
for (const [etiqueta, marca] of [
  ['una inicial (F/E/S)', (ns) => ns.map((n) => n[0].toUpperCase()).join('')],
  ['abreviatura (FLO/ESP/SAB)', (ns) => ns.map((n) => ARMAS.find(([x]) => x === n)[1]).join(' ')],
]) {
  html += `<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px">
    <span style="font:400 10px system-ui;opacity:.45;width:160px;flex:none">${etiqueta}</span>`;
  for (const [i, juego] of [['Florete'], ['Florete', 'Espada'], ['Espada', 'Sable']].entries()) {
    const [fondo, tinta] = COLOR[i];
    html += `<div style="display:flex;align-items:center;gap:5px;height:18px;
      padding:0 6px;border-radius:3px;background:${fondo};color:${tinta};
      font:500 0.65rem/1 ui-sans-serif,system-ui;width:180px;overflow:hidden">
      <span style="flex:none;font-weight:700;letter-spacing:-.01em">${marca(juego)}</span>
      <span style="flex:none;display:inline-grid;place-items:center;width:13px;height:13px;
        border-radius:3px;background:rgba(255,255,255,.12);font:700 .55rem/1 system-ui">F</span>
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">TNR de Alicante</span>
    </div>`;
  }
  html += `</div>`;
}

// --- 5. Pastilla de prueba y selector ------------------------------------
html += `<h2 style="font:600 15px system-ui;margin:26px 0 8px">
  Pastilla de prueba y selector de arma</h2>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">`;
for (const [nombre] of ARMAS) {
  html += `<span style="display:inline-flex;align-items:center;gap:7px;
    border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:7px 13px;
    font:500 12px ui-sans-serif,system-ui">
    ${svg(nombre, 22)} ${nombre} F Absoluto</span>`;
}
html += `</div></body>`;

mkdirSync('capturas', { recursive: true });
writeFileSync('tests/ui/iconos.html', html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 830, height: 900 }, deviceScaleFactor: 2 });
await p.goto(pathToFileURL('tests/ui/iconos.html').href);
await p.screenshot({ path: 'capturas/iconos.png', fullPage: true });
await b.close();
console.log('capturas/iconos.png');
