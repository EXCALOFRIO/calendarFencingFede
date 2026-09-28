import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Banco de decisión del icono de arma.
 *
 *   node tests/ui/iconos-comparar.mjs   →  capturas/iconos-comparar.png
 *
 * POR QUÉ EXISTE ESTE BANCO Y NO BASTA CON `iconos.mjs`
 * -----------------------------------------------------
 * `iconos.mjs` pinta el icono que hay AHORA en el componente. Este pinta
 * VARIANTES enfrentadas a los tamaños reales, que es lo que hace falta para
 * decidir. El dibujo de arma se ha rehecho seis veces y cinco se dieron por
 * buenas mirándolas a 48 px.
 *
 * Lo que se compara, todo con el MISMO peso de trazo efectivo para que la
 * comparación sea de dibujo y no de escala:
 *
 *   vertical   el dibujo del usuario tal cual, sin el círculo de la punta.
 *   diagonal   el mismo dibujo girado 45°, mismo tamaño.
 *   diag+larga el mismo dibujo girado 45° y estirado para ocupar la diagonal
 *              de la caja, que mide 141 frente a los 100 del lado. Aquí está
 *              la única ganancia real de la diagonal: el arma cabe más grande,
 *              y con ella la guarda, que es lo único que distingue las tres.
 *   quitado    diag+larga con UNA sola pieza por guarda en vez de dos
 *              apiladas. A 16 px dos trazos separados por 2 unidades de la
 *              caja (0,3 px) no son dos trazos: son un borrón.
 *
 * Y abajo, lo que de verdad decide: las tres armas JUNTAS a 14 y 16 px, y
 * dentro de barras de calendario de verdad enfrentadas a la abreviatura
 * FLO/ESP/SAB, que es la alternativa a no dibujar nada.
 */

// ---------------------------------------------------------------------------
// Geometría, en las coordenadas VERTICALES del usuario (viewBox 0 0 100 100).
// El giro lo pone después un `transform` de grupo, así que estas cadenas son
// literalmente el dibujo que él mandó y se pueden comparar línea a línea.
// ---------------------------------------------------------------------------

/** Tal cual lo mandó, menos el círculo de la punta (lo pidió fuera). */
const FIEL = {
  florete: `
    <line x1="50" y1="13" x2="50" y2="65" />
    <path d="M 42 66 C 42 63.5 58 63.5 58 66" />
    <line x1="41" y1="66" x2="59" y2="66" />
    <line x1="50" y1="67" x2="50" y2="83" />
    <circle cx="50" cy="86" r="2.5" fill="currentColor" stroke="none" />`,
  espada: `
    <line x1="50" y1="12" x2="50" y2="59" />
    <path d="M 33 66 C 33 55 67 55 67 66" />
    <ellipse cx="50" cy="66" rx="17" ry="3.5" />
    <line x1="50" y1="70" x2="50" y2="84" />
    <circle cx="50" cy="87.5" r="3" fill="currentColor" stroke="none" />`,
  sable: `
    <path d="M 44.5 13.5 C 44.5 11 47.5 11 47.5 13.5 L 46 15.5 L 46 62" />
    <line x1="46" y1="64" x2="46" y2="84" />
    <line x1="36" y1="63" x2="56" y2="63" />
    <path d="M 37 63 C 37 60 52 59 58 63 C 67 70 66 82 46 86.5" />
    <circle cx="46" cy="86.5" r="2.5" fill="currentColor" stroke="none" />`,
};

/**
 * El mismo lenguaje de formas con MENOS piezas y mejores proporciones.
 * Minimalismo es quitar, y con trazo 8 hay que quitar por obligación: dos
 * trazos de 8 separados por menos de 12 unidades no son dos trazos, son uno
 * gordo. Eso pasaba en las tres guardas del dibujo original.
 *
 *  - Florete: la coquille eran una curva y una recta a 2,5 unidades. Se queda
 *    la curva sola, con más vuelo: un disco plano visto de canto, un trazo.
 *  - Espada: la campana eran una cúpula y una elipse a 7,5 unidades. Se queda
 *    la cúpula CERRADA por su cuerda, más ancha (40 frente a 34) y sobre todo
 *    más honda (20 de vuelo frente a 11), que es lo que la separa del florete
 *    y además es lo que tiene de verdad: en espada la mano es blanco válido.
 *  - Sable: la primera curva del guardamanos repetía la cruz. Fuera: cruz más
 *    la D que baja a envolver los nudillos hasta el pomo.
 *  - Los pomos eran círculos de radio 2,5 y el remate redondo del trazo 8 ya
 *    mide 4: estaban dentro del propio trazo, no se veían nunca. Fuera.
 */
const REFINADO = {
  florete: `
    <line x1="50" y1="13" x2="50" y2="65" />
    <path d="M 42 66 C 42 63.5 58 63.5 58 66" />
    <line x1="41" y1="66" x2="59" y2="66" />
    <line x1="50" y1="67" x2="50" y2="85" />`,
  espada: `
    <line x1="50" y1="12" x2="50" y2="52" />
    <path d="M 31 65 C 31 41 69 41 69 65" />
    <ellipse cx="50" cy="67" rx="19" ry="4" />
    <line x1="50" y1="71" x2="50" y2="87" />`,
  sable: `
    <path d="M 45 14 C 45 11 48 11 48 14 L 46.5 17 L 46.5 61" />
    <line x1="34" y1="64" x2="57" y2="64" />
    <line x1="46.5" y1="66" x2="46.5" y2="86" />
    <path d="M 57 64 C 68 72 66 83 46.5 86" />`,
};

// ---------------------------------------------------------------------------
// Variantes. `giro` en grados, `estira` es el factor sobre la diagonal.
// El trazo se divide por `estira` para que el peso EFECTIVO en pantalla sea
// el mismo en todas: si no, se compararía escala en vez de dibujo.
//
// El giro es +45: la punta acaba ARRIBA A LA DERECHA. Es la dirección que ya
// tenía el icono anterior de esta aplicación y la de `Sword` de Lucide, que es
// el vecino de al lado en cualquier barra.
// ---------------------------------------------------------------------------
const TRAZO = 8;

/**
 * Guardas descartadas, con el motivo. Están aquí para que nadie vuelva a
 * proponerlas sin mirar primero lo que pasó:
 *
 *   espada, cúpula cerrada por una cuerda recta  → banderín (fallo nº 4).
 *   espada, solo el aro sin cúpula               → anillo plano, no es honda.
 *   espada, cúpula honda sin el aro              → arco suelto, no es una copa.
 *   florete, solo la curva con más vuelo         → cuerda floja a 64 px.
 *   florete, curva + aro elíptico                → masa que compite con la
 *                                                  espada justo en lo que las
 *                                                  tiene que separar.
 */
const DESCARTADAS = {
  'espada · cúpula cerrada → banderín': `
    <line x1="50" y1="12" x2="50" y2="50" />
    <path d="M 30 67 C 30 47 70 47 70 67 Z" />
    <line x1="50" y1="69" x2="50" y2="87" />`,
  'espada · solo el aro → anillo plano': `
    <line x1="50" y1="12" x2="50" y2="60" />
    <ellipse cx="50" cy="66" rx="19" ry="5.5" />
    <line x1="50" y1="72" x2="50" y2="87" />`,
  'espada · cúpula sin aro → arco suelto': `
    <line x1="50" y1="12" x2="50" y2="52" />
    <path d="M 30 66 C 30 42 70 42 70 66" />
    <line x1="50" y1="68" x2="50" y2="87" />`,
  'florete · solo la curva → cuerda floja': `
    <line x1="50" y1="12" x2="50" y2="62" />
    <path d="M 39 67 C 39 60 61 60 61 67" />
    <line x1="50" y1="69" x2="50" y2="87" />`,
  'florete · curva + aro → compite con la espada': `
    <line x1="50" y1="12" x2="50" y2="60" />
    <path d="M 39 65 C 39 57 61 57 61 65" />
    <ellipse cx="50" cy="66.5" rx="11" ry="2.6" />
    <line x1="50" y1="70" x2="50" y2="87" />`,
};

const VARIANTES = [
  ['A · vertical, tal cual (trazo 8, sin punta)', FIEL, 0, 1],
  ['B · diagonal 45°, tal cual', FIEL, 45, 1.3],
  ['C · diagonal 45° + refinado  ← el elegido', REFINADO, 45, 1.3],
];

const TAM = [12, 14, 16, 18, 22, 32, 64];
const ARMAS = ['florete', 'espada', 'sable'];

function svg(cuerpo, { giro, estira }, px, trazo = TRAZO) {
  const t = [
    giro ? `rotate(${giro} 50 50)` : '',
    estira !== 1 ? `translate(50 50) scale(${estira}) translate(-50 -50)` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<svg viewBox="0 0 100 100" width="${px}" height="${px}" fill="none"
      stroke="currentColor" stroke-width="${(trazo / estira).toFixed(2)}"
      stroke-linecap="round" stroke-linejoin="round" style="flex:none">
      ${t ? `<g transform="${t}">${cuerpo}</g>` : cuerpo}
    </svg>`;
}

const CHIP = {
  florete: 'FLO',
  espada: 'ESP',
  sable: 'SAB',
};

let html = `<!doctype html><meta charset="utf-8"><body style="
  margin:0;padding:22px 24px;background:oklch(0.17 0.008 265);
  color:oklch(0.97 0.004 265);font:14px system-ui">`;

// --- 1. Variantes a todos los tamaños -------------------------------------
for (const [titulo, formas, giro, estira] of VARIANTES) {
  html += `<h2 style="font:600 15px system-ui;margin:20px 0 6px">${titulo}</h2>
    <table style="border-collapse:collapse"><tr><th></th>${TAM.map(
      (t) => `<th style="font:500 11px system-ui;opacity:.6;padding:0 10px">${t}px</th>`,
    ).join('')}</tr>`;
  for (const arma of ARMAS) {
    html += `<tr><th style="text-align:right;font:500 12px system-ui;opacity:.7;padding-right:8px">${arma}</th>`;
    for (const px of TAM) {
      html += `<td style="padding:6px 10px;text-align:center">${svg(
        formas[arma],
        { giro, estira },
        px,
      )}</td>`;
    }
    html += `</tr>`;
  }
  html += `</table>`;
}

// --- 1 bis. Guardas descartadas, con el motivo ----------------------------
html += `<h2 style="font:600 15px system-ui;margin:24px 0 4px">
  Guardas descartadas</h2>
  <p style="font:400 12px system-ui;opacity:.65;margin:0 0 8px">
  Cada una falla a 96 px, no a 16: el dibujo se va a otra cosa. Mirar la
  columna de la derecha.</p>
  <table style="border-collapse:collapse">`;
for (const [n, cuerpo] of Object.entries(DESCARTADAS)) {
  html += `<tr><th style="text-align:right;font:500 12px system-ui;opacity:.7;
    padding-right:10px;white-space:nowrap">${n}</th>${[22, 28, 32, 48, 96]
    .map(
      (t) =>
        `<td style="padding:4px 9px;text-align:center">${svg(
          cuerpo,
          { giro: 45, estira: 1.3 },
          t,
        )}</td>`,
    )
    .join('')}</tr>`;
}
html += `</table>`;

// --- 2. LAS TRES JUNTAS: es la única prueba que importa -------------------
html += `<h2 style="font:600 15px system-ui;margin:26px 0 4px">
  Las tres juntas — ¿se distinguen entre sí?</h2>
  <p style="font:400 12px system-ui;opacity:.65;margin:0 0 10px">
  Aisladas todas parecen un arma. El problema real es tener florete y espada
  en dos barras contiguas del mismo calendario.</p>`;
for (const [titulo, formas, giro, estira] of VARIANTES) {
  html += `<div style="display:flex;align-items:center;gap:18px;margin-bottom:9px">
    <span style="font:500 11px system-ui;opacity:.6;width:250px">${titulo}</span>`;
  for (const px of [14, 16, 18, 22]) {
    html += `<span style="display:flex;align-items:center;gap:3px">
      ${ARMAS.map((a) => svg(formas[a], { giro, estira }, px)).join('')}
      <span style="font:400 10px system-ui;opacity:.45;margin-left:3px">${px}</span>
    </span>`;
  }
  html += `</div>`;
}

// --- 3. Dentro de barras de calendario de verdad --------------------------
const BARRAS = [
  ['apretada', 16, 0.6, 12],
  ['normal', 20, 0.68, 16],
  ['holgada', 26, 0.75, 18],
];

html += `<h2 style="font:600 15px system-ui;margin:26px 0 4px">
  En la barra del mes — dibujo contra abreviatura</h2>
  <p style="font:400 12px system-ui;opacity:.65;margin:0 0 10px">
  Alturas y tamaños de letra copiados de <code>rejilla-mes.tsx</code>:
  0,6 rem con la barra a menos de 17 px, 0,68 rem por debajo de 20, 0,75 rem
  el resto. El género va al lado, y ojo: si el arma se abrevia con una sola
  letra, «F» de florete choca con «F» de femenino.</p>`;

for (const [nombre, alto, rem, icono] of BARRAS) {
  html += `<div style="font:500 11px system-ui;opacity:.55;margin:12px 0 4px">${nombre} · barra ${alto} px · texto ${rem} rem</div>`;
  for (const [etiqueta, marca] of [
    [
      'dibujo diagonal larga',
      (a) => svg(REFINADO[a], { giro: 45, estira: 1.3 }, icono),
    ],
    [
      'abreviatura FLO/ESP/SAB',
      (a) =>
        `<span style="flex:none;font:700 ${rem * 0.92}rem/1 ui-sans-serif,system-ui;
           letter-spacing:.02em;opacity:.95">${CHIP[a]}</span>`,
    ],
    [
      'abreviatura en recuadro',
      (a) =>
        `<span style="flex:none;display:inline-grid;place-items:center;
           padding:1px 3px;border-radius:3px;background:rgba(255,255,255,.12);
           font:700 ${rem * 0.85}rem/1.1 ui-sans-serif,system-ui">${CHIP[a]}</span>`,
    ],
  ]) {
    html += `<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px">
      <span style="font:400 10px system-ui;opacity:.45;width:150px;flex:none">${etiqueta}</span>`;
    for (const [i, a] of ARMAS.entries()) {
      const fondo = ['rgba(225,29,72,.22)', 'rgba(212,175,55,.2)', 'rgba(70,130,220,.22)'][i];
      const tinta = ['#f0839a', '#e3c467', '#8fb6f0'][i];
      html += `<div style="display:flex;align-items:center;gap:5px;height:${alto}px;
        padding:0 6px;border-radius:3px;background:${fondo};color:${tinta};
        font:500 ${rem}rem/1 ui-sans-serif,system-ui;width:190px;overflow:hidden">
        ${marca(a)}
        <span style="flex:none;display:inline-grid;place-items:center;width:${alto < 17 ? 12 : 14}px;
          height:${alto < 17 ? 12 : 14}px;border-radius:3px;background:rgba(255,255,255,.1);
          font:700 ${alto < 17 ? 0.5 : 0.6}rem/1 system-ui">F</span>
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">TNR Absoluto</span>
      </div>`;
    }
    html += `</div>`;
  }
}

// --- 4. A tamaño de uso: pastilla de prueba y selector -------------------
html += `<h2 style="font:600 15px system-ui;margin:26px 0 8px">
  De 22 px arriba: pastilla de prueba y selector de arma</h2>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">`;
for (const a of ARMAS) {
  html += `<span style="display:inline-flex;align-items:center;gap:6px;
    border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 12px;
    font:500 12px ui-sans-serif,system-ui">
    ${svg(REFINADO[a], { giro: 45, estira: 1.3 }, 22)}
    ${a[0].toUpperCase() + a.slice(1)} F Absoluto</span>`;
}
html += `</div><div style="display:flex;gap:10px;margin-top:14px">`;
for (const a of ARMAS) {
  html += `<span style="display:inline-flex;flex-direction:column;align-items:center;gap:4px;
    font:500 11px ui-sans-serif,system-ui;opacity:.8">
    ${svg(REFINADO[a], { giro: 45, estira: 1.3 }, 32)}32</span>`;
}
html += `</div></body>`;

mkdirSync('capturas', { recursive: true });
writeFileSync('capturas/iconos-comparar.html', html);
const nav = await chromium.launch();
const pag = await nav.newPage({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 2 });
await pag.goto(pathToFileURL('capturas/iconos-comparar.html').href);
await pag.screenshot({ path: 'capturas/iconos-comparar.png', fullPage: true });
await nav.close();
console.log('capturas/iconos-comparar.png');
