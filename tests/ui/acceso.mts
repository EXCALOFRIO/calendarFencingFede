import { chromium, devices, type Page } from 'playwright';

/**
 * Capturas y MEDIDAS de la pantalla de acceso.
 *
 *   RUTA=/probar-acceso npx tsx tests/ui/acceso.mts
 *
 * Es el guion temporal con el que se valida el fondo de competición. No basta
 * con mirar la captura: aquí además se mide, sobre los píxeles reales de la
 * imagen, la luminancia del recuadro que hay **detrás de cada texto** y se
 * calcula el contraste contra el color con el que se pinta ese texto. Un fondo
 * fotográfico puede dejar una zona clara justo debajo de una línea y pasar
 * desapercibido en una captura pequeña.
 *
 * Se borra junto con `/probar-acceso` cuando el fondo esté integrado.
 */

const BASE = process.env.BASE ?? 'http://localhost:3000';
const RUTA = process.env.RUTA ?? '/probar-acceso';
const SUFIJO = process.env.SUFIJO ?? '';

/** Contraste WCAG entre dos luminancias relativas ya calculadas. */
function contraste(a: number, b: number): number {
  const [claro, oscuro] = a > b ? [a, b] : [b, a];
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Textos que tienen que seguir leyéndose, con su color real del tema. */
const TEXTOS = [
  // `--foreground`: oklch(0.98 0.002 265) ≈ #f9f9fb
  { sel: 'h1', luminancia: 0.95, nombre: 'h1' },
  { sel: '[data-marca]', luminancia: 0.95, nombre: 'marca' },
  // `--muted-foreground`: oklch(0.75 0.01 265) ≈ #adaeb6
  { sel: '[data-entradilla]', luminancia: 0.427, nombre: 'entradilla' },
  { sel: '[data-pie]', luminancia: 0.427, nombre: 'pie' },
];

const browser = await chromium.launch();
let problemas = 0;

for (const [nombre, config] of [
  ['iphone', devices['iPhone 14 Pro']],
  ['escritorio', { viewport: { width: 1440, height: 900 } }],
  ['ancho', { viewport: { width: 2560, height: 1400 }, deviceScaleFactor: 1 }],
  // Un portátil normal, y una ventana baja donde la tira tiene que
  // desaparecer sola en vez de pisar el titular.
  ['portatil', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }],
  ['bajo', { viewport: { width: 1440, height: 700 } }],
] as const) {
  const contexto = await browser.newContext({ ...config, locale: 'es-ES' });
  const pagina = await contexto.newPage();

  const errores: string[] = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });

  /** Peso de imagen realmente descargado, que es lo único que cuenta. */
  const descargas: { url: string; bytes: number }[] = [];
  pagina.on('response', async (res) => {
    const tipo = res.headers()['content-type'] ?? '';
    if (!tipo.startsWith('image/')) return;
    const bytes = Number(res.headers()['content-length'] ?? 0);
    descargas.push({ url: new URL(res.url()).pathname, bytes });
  });

  const res = await pagina.goto(`${BASE}${RUTA}`, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await pagina.waitForTimeout(900);

  const ruta = `capturas/acceso-${nombre}${SUFIJO}.png`;
  await pagina.screenshot({ path: ruta });
  const rutaEntera = `capturas/acceso-${nombre}${SUFIJO}-entera.png`;
  await pagina.screenshot({ path: rutaEntera, fullPage: true });

  const desborda = await pagina.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (desborda > 0) problemas += 1;

  /**
   * Se mide arriba Y con la página rodada hasta el final, y se guarda el
   * PEOR de los dos.
   *
   * El fondo va `fixed`: no se mueve con el contenido. En el móvil la página
   * rueda casi 400 px, así que el pie de «Las altas las hace el
   * administrador» acaba sobre una parte del fondo distinta de la que tiene
   * debajo al cargar —y encima ni sale en la primera pantalla—. Medir solo
   * arriba deja fuera justo el caso peor.
   */
  const acumulado = new Map<string, { peor: number; media: number }>();

  for (const desplazamiento of ['arriba', 'abajo'] as const) {
    await pagina.evaluate(
      (d) => window.scrollTo(0, d === 'abajo' ? document.body.scrollHeight : 0),
      desplazamiento,
    );
    await pagina.waitForTimeout(250);

    const medidas = await medir(pagina);
    for (const m of medidas) {
      if (m.peor === null || m.peor === undefined) continue;
      const previo = acumulado.get(m.nombre);
      if (!previo || m.peor > previo.peor) {
        acumulado.set(m.nombre, { peor: m.peor, media: m.media ?? m.peor });
      }
    }
  }

  console.log(`\n== ${nombre} ${RUTA} ${res?.status()}  desborde ${desborda}px`);
  for (const t of TEXTOS) {
    const m = acumulado.get(t.nombre);
    if (!m) {
      console.log(`   ${t.nombre.padEnd(11)} no encontrado`);
      problemas += 1;
      continue;
    }
    const peor = contraste(t.luminancia, m.peor);
    const medio = contraste(t.luminancia, m.media);
    const veredicto = peor >= 4.5 ? 'AA' : peor >= 3 ? 'solo AA grande' : 'FALLA';
    if (peor < 4.5) problemas += 1;
    console.log(
      `   ${t.nombre.padEnd(11)} peor ${peor.toFixed(2)}:1   medio ${medio.toFixed(2)}:1   ${veredicto}`,
    );
  }

  const total = descargas.reduce((s, d) => s + d.bytes, 0);
  console.log(`   imágenes: ${descargas.length}  ${(total / 1024).toFixed(1)} kB`);
  for (const d of descargas) {
    console.log(`     ${(d.bytes / 1024).toFixed(1).padStart(7)} kB  ${d.url}`);
  }
  console.log(`   capturas: ${ruta}  ${rutaEntera}`);

  if (errores.length > 0) {
    problemas += errores.length;
    console.log(`   errores: ${[...new Set(errores)].slice(0, 4).join(' | ')}`);
  }

  await contexto.close();
}

await browser.close();
if (problemas > 0) {
  console.log(`\n${problemas} problemas detectados.`);
  process.exitCode = 1;
}

/** Mide, en la posición actual de la página, el fondo que hay bajo cada texto. */
async function medir(pagina: Page) {
  // Recuadros de los textos, en píxeles de la captura.
  const cajas = await pagina.evaluate((textos) => {
    const dpr = window.devicePixelRatio;
    return textos.map((t) => {
      const el = document.querySelector(t.sel);
      if (!el) return { nombre: t.nombre, luminancia: t.luminancia, caja: null };
      const r = el.getBoundingClientRect();
      /**
       * Si el texto no cabe ENTERO en la ventana, esta pasada no cuenta.
       *
       * Sin esto, al rodar la página hasta el final el titular se sale por
       * arriba, su recuadro da una `y` negativa, se recorta a cero y se acaba
       * midiendo la franja de arriba de la pantalla —que es otra cosa— como
       * si fuera el fondo del titular. Daba 1,01:1 y un falso «FALLA». La
       * otra pasada, la de arriba, ya mide ese texto donde toca.
       */
      if (r.top < 0 || r.bottom > window.innerHeight) {
        return { nombre: t.nombre, luminancia: t.luminancia, caja: null };
      }
      return {
        nombre: t.nombre,
        luminancia: t.luminancia,
        caja: {
          x: Math.round(r.x * dpr),
          y: Math.round(r.y * dpr),
          w: Math.round(r.width * dpr),
          h: Math.round(r.height * dpr),
        },
      };
    });
  }, TEXTOS);

  /**
   * Se captura con los textos ocultos: así se mide el FONDO que hay debajo,
   * no la mezcla de fondo y letra. La hoja se añade una vez y se queda; en la
   * segunda pasada ya está puesta y `addStyleTag` la duplica sin efecto.
   */
  await pagina.addStyleTag({
    content: TEXTOS.map((t) => `${t.sel}{visibility:hidden!important}`).join(''),
  });
  const soloFondo = await pagina.screenshot({ type: 'png' });

  /**
   * Dentro de este `evaluate` no se declara NI UNA función, y es a propósito.
   *
   * `tsx` compila con esbuild, que a cada función con nombre le pega un
   * ayudante `__name(...)`. Ese ayudante no existe en la página, así que en
   * cuanto hay un `const lum = (…) => …` dentro del `evaluate` la llamada
   * revienta con «__name is not defined». Todo va con bucles y expresiones.
   */
  const medidas = await pagina.evaluate(
    async ({ png, cajas }) => {
      const blob = new Blob([new Uint8Array(png)], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      const lienzo = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = lienzo.getContext('2d');
      if (!ctx) return [];
      ctx.drawImage(bitmap, 0, 0);

      const salida = [];
      for (const c of cajas) {
        if (!c.caja || c.caja.w < 2 || c.caja.h < 2) {
          salida.push({ nombre: c.nombre, luminancia: c.luminancia, peor: null });
          continue;
        }
        const x = Math.max(0, c.caja.x);
        const y = Math.max(0, c.caja.y);
        const w = Math.min(c.caja.w, bitmap.width - x);
        const h = Math.min(c.caja.h, bitmap.height - y);
        if (w < 2 || h < 2) {
          salida.push({ nombre: c.nombre, luminancia: c.luminancia, peor: null });
          continue;
        }
        const datos = ctx.getImageData(x, y, w, h).data;
        let peor = -1;
        let suma = 0;
        for (let i = 0; i < datos.length; i += 4) {
          let l = 0;
          const pesos = [0.2126, 0.7152, 0.0722];
          for (let k = 0; k < 3; k++) {
            const s = datos[i + k] / 255;
            l += pesos[k] * (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
          }
          suma += l;
          if (l > peor) peor = l;
        }
        salida.push({
          nombre: c.nombre,
          luminancia: c.luminancia,
          peor,
          media: suma / (datos.length / 4),
        });
      }
      return salida;
    },
    { png: [...soloFondo], cajas },
  );

  return medidas;
}