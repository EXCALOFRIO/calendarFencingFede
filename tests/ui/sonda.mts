/**
 * Sonda puntual: se le pasa una ruta y un guion, y lo ejecuta con sesión de
 * admin en el iPhone. Sirve para cazar el elemento concreto que desborda o
 * para comprobar una medida sin repetir toda la auditoría.
 *
 *   npx tsx tests/ui/sonda.mts /calendario ancestros
 */
import { chromium, devices } from 'playwright';
import { autenticar, BASE_URL } from '../e2e/sesion.js';

// Git Bash reescribe los argumentos que empiezan por «/» como rutas de
// Windows, así que la ruta también se puede pasar por RUTA=... .
const ruta = process.env.RUTA ?? process.argv[2] ?? '/';
const modo = process.env.MODO ?? process.argv[3] ?? 'ancestros';
const escritorio = process.argv.includes('--escritorio');

const browser = await chromium.launch();
const context = await browser.newContext({
  ...(escritorio ? { viewport: { width: 1440, height: 900 } } : devices['iPhone 14 Pro']),
  locale: 'es-ES',
});
await autenticar(context, 'admin', 'admin');
const page = await context.newPage();
await page.goto(`${BASE_URL}${ruta}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(600);

const GUIONES: Record<string, string> = {
  /** Cadena completa de ancestros de los elementos que se salen por la derecha. */
  ancestros: `(() => {
    const limite = document.documentElement.clientWidth;
    const salida = [];
    const marcados = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right <= limite + 0.5) continue;
      marcados.add(el);
    }
    for (const el of marcados) {
      if (Array.from(el.children).some((h) => marcados.has(h))) continue;
      const cadena = [];
      let n = el;
      while (n && n !== document.body) {
        const r = n.getBoundingClientRect();
        const s = getComputedStyle(n);
        cadena.push({
          tag: n.tagName.toLowerCase(),
          cls: (typeof n.className === 'string' ? n.className : '').slice(0, 120),
          l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width),
          ow: n.offsetWidth, sw: n.scrollWidth,
          display: s.display, minW: s.minWidth, ws: s.whiteSpace, ov: s.overflowX,
        });
        n = n.parentElement;
      }
      salida.push(cadena);
      if (salida.length >= 3) break;
    }
    return { limite, scrollWidth: document.documentElement.scrollWidth, salida };
  })()`,

  /** Comprueba de verdad que se llega al final de la lista sin que tape la barra. */
  barra: `(async () => {
    const nav = document.querySelector('nav[class*="fixed"][class*="bottom-0"]');
    const main = document.querySelector('main');
    // 'instant': el html lleva scroll-behavior:smooth y si no se fuerza,
    // la medida se toma antes de que el desplazamiento haya terminado.
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 400));
    const nr = nav ? nav.getBoundingClientRect() : null;
    const mr = main ? main.getBoundingClientRect() : null;
    const ultimo = main ? main.lastElementChild : null;
    return {
      scrollY: Math.round(window.scrollY),
      alturaDoc: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      navTop: nr ? Math.round(nr.top) : null,
      navAlto: nr ? Math.round(nr.height) : null,
      mainBottom: mr ? Math.round(mr.bottom) : null,
      holgura: nr && mr ? Math.round(nr.top - mr.bottom) : null,
      bodyPaddingBottom: getComputedStyle(document.body).paddingBottom,
      contenedorPaddingBottom: main && main.parentElement
        ? getComputedStyle(main.parentElement).paddingBottom : null,
    };
  })()`,

  /** Contraste real de los tokens del tema sobre los fondos que se usan. */
  tokens: `(() => {
    const cs = getComputedStyle(document.documentElement);
    // El tema está en oklch() y getComputedStyle lo devuelve tal cual; la
    // conversión fiable a sRGB es pintarlo en un lienzo y leer el píxel.
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
    function mezclar(f, b, alpha) {
      const a = alpha ?? f.a;
      return { r: f.r*a + b.r*(1-a), g: f.g*a + b.g*(1-a), b: f.b*a + b.b*(1-a), a: 1 };
    }
    function lum(c) {
      const f = (v) => { const s = v/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4); };
      return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b);
    }
    function ratio(a, b) { const l1 = lum(a), l2 = lum(b); return Math.round(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05))*100)/100; }
    const t = (n) => aRgb(cs.getPropertyValue(n).trim());
    const bg = t('--background'), card = t('--card'), sec = t('--secondary'), pop = t('--popover');
    const nombres = ['--foreground','--muted-foreground','--primary','--gold','--destructive',
      '--deadline-ok','--deadline-warn','--deadline-danger','--deadline-closed','--secondary-foreground'];
    const filas = [];
    for (const n of nombres) {
      const c = t(n);
      filas.push({ token: n, rgb: [c.r,c.g,c.b].map(Math.round).join(','),
        sobreFondo: ratio(c, bg), sobreCard: ratio(c, card), sobreSecundario: ratio(c, sec) });
    }
    // Las pastillas pintan el texto del token sobre un fondo del mismo token al 15 %.
    const pastillas = [];
    for (const n of ['--deadline-ok','--deadline-warn','--deadline-danger','--primary','--gold']) {
      const c = t(n);
      const fondoPastilla = mezclar(c, card, 0.15);
      pastillas.push({ token: n, sobrePastillaEnCard: ratio(c, fondoPastilla),
        fondoPastilla: [fondoPastilla.r,fondoPastilla.g,fondoPastilla.b].map(Math.round).join(',') });
    }
    // Aviso de datos rancios: warn al 15 % sobre el fondo de página.
    const w = t('--deadline-warn');
    const avisoRancio = ratio(w, mezclar(w, bg, 0.15));
    // Texto sobre el botón de oro y sobre el carmesí.
    const botones = [
      { boton: 'oro', ratio: ratio(t('--gold-foreground'), t('--gold')) },
      { boton: 'carmesí', ratio: ratio(t('--primary-foreground'), t('--primary')) },
      { boton: 'destructivo', ratio: ratio(t('--destructive-foreground'), t('--destructive')) },
    ];
    return { filas, pastillas, avisoRancio, botones,
      fondos: { background: [bg.r,bg.g,bg.b].map(Math.round).join(','), card: [card.r,card.g,card.b].map(Math.round).join(','), secondary: [sec.r,sec.g,sec.b].map(Math.round).join(','), popover: [pop.r,pop.g,pop.b].map(Math.round).join(',') } };
  })()`,

  /** Estado de interruptores y casillas, que el mínimo global de 44 px deforma. */
  switches: `(() => {
    const out = [];
    for (const el of document.querySelectorAll('[role=switch], [role=checkbox], input[type=checkbox], input[type=radio], [role=radio]')) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      out.push({ rol: el.getAttribute('role') || el.tagName.toLowerCase(),
        w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10,
        minH: s.minHeight, minW: s.minWidth, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80) });
    }
    return out;
  })()`,
};

const guion = GUIONES[modo] ?? modo;
const res = await page.evaluate(guion);
console.log(JSON.stringify(res, null, 2));
await browser.close();
