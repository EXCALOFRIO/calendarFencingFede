import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Banco de pruebas de los iconos de arma.
 *
 * Los pinta a los tamaños REALES a los que viven en la aplicación, sobre el
 * fondo real y dentro de una barra de calendario de verdad. Existe porque
 * tres versiones de estos iconos se dieron por buenas mirándolas a 48 px y a
 * 12 px eran las tres la misma mancha.
 *
 *   node tests/ui/iconos.mjs   →  capturas/iconos.png
 */

const src = readFileSync('src/components/calendario/iconos-arma.tsx', 'utf8');
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

const tam = [12, 14, 16, 18, 22, 32, 64];
const fila = (n, svg) =>
  `<tr><th style="text-align:right;font:600 13px system-ui">${n}</th>${tam
    .map(
      (t) =>
        `<td><svg viewBox="0 0 24 24" width="${t}" height="${t}">${svg}</svg></td>`,
    )
    .join('')}</tr>`;

const barra = (n, i) => `
  <div style="display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;border-radius:6px;
              background:${['rgba(225,29,72,.22)', 'rgba(212,175,55,.2)', 'rgba(70,130,220,.22)'][i]};
              color:${['#f0839a', '#e3c467', '#8fb6f0'][i]};font:600 12px system-ui">
    <svg viewBox="0 0 24 24" width="16" height="16" style="flex:none">${bloques['Icono' + n]}</svg>
    <span>Copa del Mundo Cadete</span>
    <span style="opacity:.7">Udine</span>
  </div>`;

writeFileSync(
  'tests/ui/iconos.html',
  `<!doctype html><meta charset="utf-8">
  <body style="background:#26262a;color:#f5f5f6;font:14px system-ui;padding:28px">
    <table style="border-spacing:22px 14px">
      <tr><th></th>${tam
        .map((t) => `<th style="font:400 12px system-ui;opacity:.6">${t}px</th>`)
        .join('')}</tr>
      ${fila('Florete', bloques.IconoFlorete)}
      ${fila('Espada', bloques.IconoEspada)}
      ${fila('Sable', bloques.IconoSable)}
    </table>
    <div style="margin-top:30px;display:flex;flex-direction:column;gap:5px;width:420px">
      ${['Florete', 'Espada', 'Sable'].map(barra).join('')}
    </div>
  </body>`,
);

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 780, height: 540 }, deviceScaleFactor: 2 });
await p.goto(pathToFileURL('tests/ui/iconos.html').href);
await p.screenshot({ path: 'capturas/iconos.png' });
await b.close();
console.log('capturas/iconos.png');
