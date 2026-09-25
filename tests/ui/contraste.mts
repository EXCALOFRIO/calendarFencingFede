/**
 * Contraste real de los tokens del tema, medido en el navegador.
 *
 *   npx tsx tests/ui/contraste.mts            # tabla de los tokens actuales
 *   BARRIDO=1 npx tsx tests/ui/contraste.mts  # además, barrido de luminosidad
 *
 * Por qué en el navegador y no a mano: el tema está escrito en `oklch()` y
 * `getComputedStyle` devuelve `oklch(...)` tal cual, así que una expresión
 * regular sobre `rgb(...)` no lee nada (y dice, en silencio, que todo está
 * bien). Aquí el color se pinta en un lienzo de 1×1 y se lee el píxel: la
 * conversión la hace el propio Chrome, que es la que ve el usuario.
 *
 * WCAG 2.1 AA: 4,5:1 para texto normal y 3:1 para texto grande
 * (>= 24 px, o >= 18,66 px en negrita) y para elementos gráficos.
 */
import { chromium } from 'playwright';
import { autenticar, BASE_URL } from '../e2e/sesion.js';

const GUION = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const lz = document.createElement('canvas');
  lz.width = lz.height = 1;
  const ctx = lz.getContext('2d', { willReadFrequently: true });

  function aRgb(css) {
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
    const n = ctx.getImageData(0, 0, 1, 1).data;
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
    const b = ctx.getImageData(0, 0, 1, 1).data;
    const a = 1 - (b[0] - n[0]) / 255;
    if (a < 0.004) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: n[0] / a, g: n[1] / a, b: n[2] / a, a };
  }
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  };
  const mezclar = (f, b, a) => ({ r: f.r*a + b.r*(1-a), g: f.g*a + b.g*(1-a), b: f.b*a + b.b*(1-a), a: 1 });
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const tok = (n) => aRgb(cs.getPropertyValue(n).trim());

  const fondos = {
    background: tok('--background'),
    card: tok('--card'),
    secondary: tok('--secondary'),
    popover: tok('--popover'),
  };

  const TEXTOS = ['--foreground', '--muted-foreground', '--primary', '--gold', '--destructive',
    '--deadline-ok', '--deadline-warn', '--deadline-danger', '--deadline-closed',
    '--secondary-foreground', '--accent-foreground'];

  const tabla = [];
  for (const n of TEXTOS) {
    const c = tok(n);
    const fila = { token: n, hex: hex(c) };
    for (const [nf, f] of Object.entries(fondos)) fila['sobre_' + nf] = ratio(c, f);
    tabla.push(fila);
  }

  // Pastillas (Badge): texto del token sobre un fondo del mismo token al 15 %
  // compuesto sobre la tarjeta, que es como están definidas en primitives.tsx.
  const pastillas = [];
  for (const n of ['--primary', '--gold', '--deadline-ok', '--deadline-warn', '--deadline-danger']) {
    const c = tok(n);
    for (const [nf, f] of [['card', fondos.card], ['background', fondos.background]]) {
      const relleno = mezclar(c, f, 0.15);
      pastillas.push({ token: n, sobre: nf, hexRelleno: hex(relleno), ratioTexto: ratio(c, relleno),
        ratioRellenoVsFondo: ratio(relleno, f) });
    }
  }

  // Texto sobre fondos sólidos (botones).
  const solidos = [
    { nombre: 'primary-foreground sobre primary', r: ratio(tok('--primary-foreground'), tok('--primary')) },
    { nombre: 'gold-foreground sobre gold', r: ratio(tok('--gold-foreground'), tok('--gold')) },
    { nombre: 'destructive-foreground sobre destructive', r: ratio(tok('--destructive-foreground'), tok('--destructive')) },
    { nombre: 'secondary-foreground sobre secondary', r: ratio(tok('--secondary-foreground'), tok('--secondary')) },
    { nombre: 'foreground sobre accent', r: ratio(tok('--foreground'), tok('--accent')) },
  ];

  // Bordes y separadores: 3:1 frente al fondo adyacente (WCAG 1.4.11).
  const bordes = [
    { nombre: '--border sobre card', r: ratio(mezclar(tok('--border'), fondos.card, tok('--border').a), fondos.card) },
    { nombre: '--input sobre background', r: ratio(mezclar(tok('--input'), fondos.background, tok('--input').a), fondos.background) },
    { nombre: '--ring sobre background', r: ratio(tok('--ring'), fondos.background) },
  ];

  // Aviso de datos rancios de la cabecera: warn al 15 % sobre el fondo.
  const w = tok('--deadline-warn');
  const avisoRancio = ratio(w, mezclar(w, fondos.background, 0.15));

  const salida = {
    fondos: Object.fromEntries(Object.entries(fondos).map(([k, v]) => [k, hex(v)])),
    tabla, pastillas, solidos, bordes, avisoRancio,
  };

  if (${process.env.BARRIDO ? 'true' : 'false'}) {
    // Barrido: qué luminosidad oklch hace falta para llegar a 4,5:1 sobre la
    // tarjeta, y qué pasa entonces con el blanco encima (uso como fondo).
    const barrido = {};
    const blanco = tok('--foreground');
    for (const [nombre, base] of [['carmesi', [0.222, 17.6]], ['danger', [0.22, 22]], ['ok', [0.17, 152]], ['warn', [0.15, 78]], ['gold', [0.148, 84]], ['gris', [0.01, 286]]]) {
      barrido[nombre] = [];
      for (let L = 0.50; L <= 0.86; L += 0.02) {
        const l = Math.round(L * 100) / 100;
        const c = aRgb('oklch(' + l + ' ' + base[0] + ' ' + base[1] + ')');
        barrido[nombre].push({
          L: l, hex: hex(c),
          textoSobreCard: ratio(c, fondos.card),
          textoSobreFondo: ratio(c, fondos.background),
          pastilla15SobreCard: ratio(c, mezclar(c, fondos.card, 0.15)),
          blancoEncima: ratio(blanco, c),
          negroEncima: ratio({ r: 24, g: 24, b: 27, a: 1 }, c),
        });
      }
    }
    salida.barrido = barrido;
  }

  return salida;
})()`;

/**
 * Se mide dentro de la aplicación y con sesión, no en `/entrar`.
 *
 * Comprobado: en `/entrar` el `:root` sólo trae `--gold`; el resto de tokens
 * (`--background`, `--foreground`, `--card`, `--primary`…) salen vacíos, así
 * que medir ahí da 1:1 en todo y parece que no hay contraste ninguno. Con
 * sesión, en `/`, sí están todos.
 */
const RUTA = process.env.RUTA ?? '/';
const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'es-ES' });
await autenticar(context, 'admin', 'admin');
const page = await context.newPage();
await page.goto(`${BASE_URL}${RUTA}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
const r = (await page.evaluate(GUION)) as any;
await browser.close();

if (r.fondos.background === '#000000' && r.tabla[0].sobre_card === 1) {
  console.error(
    `AVISO: en ${RUTA} no hay tokens en :root (todo sale 1:1). Prueba otra ruta con RUTA=…\n`,
  );
}

const ok = (v: number, min: number) => (v >= min ? 'AA' : 'FALLA');

console.log('Fondos:', r.fondos, '\n');

console.log('— Texto sobre fondo (AA normal 4,5 / AA grande 3,0) —');
console.log(
  ['token'.padEnd(24), 'hex'.padEnd(9), 'bg'.padEnd(7), 'card'.padEnd(7), 'secondary'.padEnd(10), 'veredicto(card)'].join(''),
);
for (const f of r.tabla) {
  console.log(
    [
      f.token.padEnd(24),
      f.hex.padEnd(9),
      String(f.sobre_background).padEnd(7),
      String(f.sobre_card).padEnd(7),
      String(f.sobre_secondary).padEnd(10),
      `${ok(f.sobre_card, 4.5)} normal / ${ok(f.sobre_card, 3)} grande`,
    ].join(''),
  );
}

console.log('\n— Pastillas (texto del token sobre relleno del mismo token al 15 %) —');
for (const p of r.pastillas) {
  console.log(
    `${p.token.padEnd(20)} sobre ${p.sobre.padEnd(11)} relleno ${p.hexRelleno}  texto ${String(p.ratioTexto).padEnd(6)} ${ok(p.ratioTexto, 4.5)}   relleno/fondo ${p.ratioRellenoVsFondo}`,
  );
}

console.log('\n— Texto sobre relleno sólido —');
for (const s of r.solidos) console.log(`${s.nombre.padEnd(46)} ${String(s.r).padEnd(7)} ${ok(s.r, 4.5)}`);

console.log('\n— Bordes y foco (mínimo 3:1) —');
for (const b of r.bordes) console.log(`${b.nombre.padEnd(30)} ${String(b.r).padEnd(7)} ${ok(b.r, 3)}`);

console.log(`\nAviso de datos rancios (warn sobre warn/15 % sobre fondo): ${r.avisoRancio} ${ok(r.avisoRancio, 4.5)}`);

if (r.barrido) {
  console.log('\n— Barrido de luminosidad oklch —');
  for (const [nombre, filas] of Object.entries(r.barrido as Record<string, any[]>)) {
    console.log(`\n  ${nombre}`);
    console.log('   L     hex      card   fondo  pastilla15  blancoEncima  oscuroEncima');
    for (const f of filas) {
      console.log(
        `   ${String(f.L).padEnd(6)}${f.hex.padEnd(9)}${String(f.textoSobreCard).padEnd(7)}${String(f.textoSobreFondo).padEnd(7)}${String(f.pastilla15SobreCard).padEnd(12)}${String(f.blancoEncima).padEnd(14)}${f.negroEncima}`,
      );
    }
  }
}
