import { chromium, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Banco de decisión de la bandera de país.
 *
 *   node tests/ui/iconos-banderas.mjs
 *      → capturas/banderas-escritorio.png
 *      → capturas/banderas-iphone.png
 *
 * POR QUÉ HAY QUE MIRARLO EN DOS SITIOS
 * -------------------------------------
 * La forma corta de pintar una bandera es el emoji: se saca del código ISO de
 * dos letras sumando 127 397 a cada una, y sale «🇪🇸» sin una sola imagen.
 * Funciona en iPhone y en Android... y **no funciona en Windows**, que es donde
 * se desarrolla esta aplicación y donde el usuario la revisa: Segoe UI Emoji no
 * trae los pares de indicadores regionales, así que el navegador pinta las dos
 * letras sueltas. Por eso esto se captura en escritorio Windows además de en
 * móvil, y por eso la decisión no se puede tomar leyendo documentación.
 *
 * Aviso honesto sobre la captura de móvil: Playwright emula el tamaño y el
 * `user agent` del iPhone, pero **usa las fuentes de esta máquina**. La captura
 * de móvil sirve para juzgar el TAMAÑO y el peso en una fila estrecha, no para
 * demostrar cómo se pinta el emoji en iOS.
 *
 * Los dos usos reales, que no piden lo mismo:
 *   ficha de torneo   mediano, una vez, con el nombre del país al lado.
 *   fila de ranking   pequeño, cincuenta veces seguidas, y sin ensuciar.
 */

/** Países que de verdad salen en este calendario, más España delante. */
const PAISES = [
  ['ESP', 'ES', 'España'],
  ['FRA', 'FR', 'Francia'],
  ['ITA', 'IT', 'Italia'],
  ['GER', 'DE', 'Alemania'],
  ['HUN', 'HU', 'Hungría'],
  ['POL', 'PL', 'Polonia'],
  ['EGY', 'EG', 'Egipto'],
  ['JPN', 'JP', 'Japón'],
];

const emoji = (iso2) =>
  String.fromCodePoint(...[...iso2].map((c) => 127_397 + c.charCodeAt(0)));

const html = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:22px;background:oklch(0.17 0.008 265);
  color:oklch(0.98 0.002 265);font:14px ui-sans-serif,system-ui">

<h2 style="font:600 15px system-ui;margin:0 0 4px">1 · Emoji desde el código ISO</h2>
<p style="font:400 12px system-ui;opacity:.6;margin:0 0 8px">
  Si aquí se leen letras en vez de banderas, el emoji queda descartado.</p>
<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
  ${PAISES.map(
    ([, iso2, nombre]) =>
      `<span style="display:inline-flex;align-items:center;gap:6px">
        <span style="font-size:20px;line-height:1">${emoji(iso2)}</span>
        <span style="font:400 12px system-ui;opacity:.7">${nombre}</span></span>`,
  ).join('')}
</div>
<div style="display:flex;gap:10px;align-items:center;font:400 11px system-ui;opacity:.55">
  a 14 px: ${PAISES.map(([, i]) => `<span style="font-size:14px">${emoji(i)}</span>`).join('')}
</div>

<h2 style="font:600 15px system-ui;margin:22px 0 4px">2 · Código de país en pastilla</h2>
<p style="font:400 12px system-ui;opacity:.6;margin:0 0 8px">
  Tres letras, tabulares, en una pastilla del mismo gris que las demás
  superficies. Es lo que hace la FIE en sus tablas.</p>
<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px">
  ${PAISES.map(
    ([iso3]) =>
      `<span style="display:inline-grid;place-items:center;min-width:2.4em;
        padding:2px 6px;border-radius:3px;background:oklch(0.27 0.009 265);
        border:1px solid oklch(1 0 0 / 9%);font:600 11px/1.3 ui-sans-serif,system-ui;
        letter-spacing:.03em;font-variant-numeric:tabular-nums">${iso3}</span>`,
  ).join('')}
</div>

<h2 style="font:600 15px system-ui;margin:22px 0 4px">3 · En la ficha de torneo (mediano)</h2>
<div style="display:flex;flex-direction:column;gap:7px;width:340px">
  ${['ESP', 'FRA', 'EGY']
    .map((iso3, i) => {
      const [, , nombre] = PAISES.find(([a]) => a === iso3);
      const ciudad = ['Alicante', 'París', 'El Cairo'][i];
      return `<div style="display:flex;align-items:center;gap:8px;
        padding:9px 11px;border:1px solid oklch(1 0 0 / 9%);border-radius:6px;
        background:oklch(0.215 0.009 265)">
        <span style="display:inline-grid;place-items:center;min-width:2.6em;
          padding:3px 7px;border-radius:3px;background:oklch(0.27 0.009 265);
          border:1px solid oklch(1 0 0 / 9%);font:600 12px/1.3 ui-sans-serif,system-ui;
          letter-spacing:.03em">${iso3}</span>
        <span style="font:500 14px ui-sans-serif,system-ui">${ciudad}</span>
        <span style="font:400 13px ui-sans-serif,system-ui;opacity:.6">${nombre}</span>
      </div>`;
    })
    .join('')}
</div>

<h2 style="font:600 15px system-ui;margin:22px 0 4px">4 · En una fila de ranking (pequeño, repetido)</h2>
<p style="font:400 12px system-ui;opacity:.6;margin:0 0 8px">
  La prueba de que no ensucia: cincuenta filas seguidas.</p>
<table style="border-collapse:collapse;width:420px;font:400 13px ui-sans-serif,system-ui">
  ${Array.from({ length: 12 }, (_, i) => {
    const [iso3] = PAISES[i % PAISES.length];
    const nombres = ['Llavador C.', 'Martín A.', 'Ruiz P.', 'Soler M.'];
    return `<tr style="border-bottom:1px solid oklch(1 0 0 / 6%)">
      <td style="padding:5px 8px;text-align:right;font:600 13px ui-sans-serif;
        font-variant-numeric:tabular-nums;opacity:.85">${i + 1}</td>
      <td style="padding:5px 8px">
        <span style="display:inline-grid;place-items:center;min-width:2.4em;
          padding:1px 5px;border-radius:3px;background:oklch(0.27 0.009 265);
          border:1px solid oklch(1 0 0 / 9%);font:600 10px/1.4 ui-sans-serif,system-ui;
          letter-spacing:.03em">${iso3}</span></td>
      <td style="padding:5px 8px">${nombres[i % 4]}</td>
      <td style="padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;
        opacity:.75">${(300 - i * 17).toFixed(0)}</td>
    </tr>`;
  }).join('')}
</table>

<h2 style="font:600 15px system-ui;margin:22px 0 4px">5 · Y la misma fila con emoji, para comparar</h2>
<table style="border-collapse:collapse;width:420px;font:400 13px ui-sans-serif,system-ui">
  ${Array.from({ length: 5 }, (_, i) => {
    const [, iso2] = PAISES[i % PAISES.length];
    return `<tr style="border-bottom:1px solid oklch(1 0 0 / 6%)">
      <td style="padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums">${i + 1}</td>
      <td style="padding:5px 8px;font-size:15px">${emoji(iso2)}</td>
      <td style="padding:5px 8px">Llavador C.</td>
    </tr>`;
  }).join('')}
</table>
</body>`;

mkdirSync('capturas', { recursive: true });
writeFileSync('capturas/banderas.html', html);
const url = pathToFileURL('capturas/banderas.html').href;
const nav = await chromium.launch();

const esc = await nav.newPage({ viewport: { width: 760, height: 900 }, deviceScaleFactor: 2 });
await esc.goto(url);
await esc.screenshot({ path: 'capturas/banderas-escritorio.png', fullPage: true });

const mov = await nav.newContext({ ...devices['iPhone 14 Pro'] });
const pmov = await mov.newPage();
await pmov.goto(url);
await pmov.screenshot({ path: 'capturas/banderas-iphone.png', fullPage: true });

await nav.close();
console.log('capturas/banderas-escritorio.png\ncapturas/banderas-iphone.png');
