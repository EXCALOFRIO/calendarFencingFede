/**
 * Mide el alto que gana (o pierde) la rejilla del calendario.
 *
 * Uso:  npx tsx <este fichero> <etiqueta>
 *
 * El dato que manda es `disponible`: el alto de la caja que mide
 * `useAltoDisponible`, que es literalmente lo que `planificar()` reparte entre
 * las semanas del mes.
 *
 * `page.evaluate` va SIEMPRE con cadena: con `tsx`, esbuild compila con
 * `keepNames` y envuelve las funciones con nombre en un ayudante `__name` que
 * no existe en el navegador.
 */
import { mkdirSync } from 'node:fs';
import { chromium, devices, type BrowserContext } from 'playwright';

const BASE = 'http://localhost:3000';
const etiqueta = process.argv[2] ?? 'antes';
const SALIDA = 'capturas/arq';

const CASOS = [
  { nombre: 'vacio', atajo: 'llavador', avanzar: 0 },
  { nombre: 'octubre', atajo: 'admin', avanzar: 1 },
  { nombre: 'cargado', atajo: 'admin', avanzar: 2 },
] as const;

const PANTALLAS = [
  { nombre: 'iphone', opciones: { ...devices['iPhone 14 Pro'], locale: 'es-ES' } },
  { nombre: 'esc1440', opciones: { viewport: { width: 1440, height: 900 }, locale: 'es-ES' } },
  { nombre: 'esc2560', opciones: { viewport: { width: 2560, height: 1400 }, locale: 'es-ES' } },
] as const;

const MEDIDA = `(() => {
  const main = document.querySelector('main');
  if (!main) return { error: 'sin main' };
  const rm = main.getBoundingClientRect();
  const px = (n) => Math.round(n * 10) / 10;

  // Solo lo que de verdad se ve: en esta pantalla convive la rejilla apagada
  // con la agenda encendida, o al revés, y una caja con display:none mide 0.
  const visible = (el) => el.getClientRects().length > 0;

  const cajas = [...main.querySelectorAll('[data-rejilla="hueco"]')].filter(visible);
  const cabeceras = [...main.querySelectorAll('.rounded-t-lg')].filter(visible);

  const cabecera = cabeceras[0]?.getBoundingClientRect() ?? null;
  const caja = cajas[0]?.getBoundingClientRect() ?? null;
  const ultima = cajas[cajas.length - 1]?.getBoundingClientRect() ?? null;

  const barras = [...main.querySelectorAll('[data-barra="torneo"]')].filter(visible);
  const altos = barras.map((b) => px(b.getBoundingClientRect().height));
  const tarjetas = [...main.querySelectorAll('[data-agenda="tarjeta"]')].filter(visible);

  const cortados = [];
  for (const b of [...barras, ...tarjetas]) {
    for (const t of b.querySelectorAll('span')) {
      if (t.children.length > 0) continue;
      const texto = (t.textContent ?? '').trim();
      if (texto.length < 4) continue;
      const clamp = getComputedStyle(t).webkitLineClamp;
      const desbordaX = t.scrollWidth - t.clientWidth > 1;
      const desbordaY = t.scrollHeight - t.clientHeight > 1;
      if (desbordaX || (clamp !== 'none' && desbordaY)) cortados.push(texto.slice(0, 44));
    }
  }

  /*
    ALCANZABLES: a cuántos torneos se puede llegar sin cambiar de mes.
    Es el criterio duro del encargo. Se cuentan IDENTIFICADORES distintos, no
    nombres: en octubre hay seis «Copa del Mundo» y lo que las separa es la
    sede. Cuentan las barras visibles, las tarjetas de la agenda y lo que
    esconde cada «+N» —esa cuenta la da el propio botón—. Lo que no está en
    ninguno de los tres sitios no existe para quien mira esta pantalla.
  */
  const ids = new Set();
  for (const el of [...barras, ...tarjetas]) {
    const id = el.getAttribute('data-evento');
    if (id) ids.add(id);
  }
  let escondidos = 0;
  for (const mas of main.querySelectorAll('[data-mas="semana"]')) {
    if (!visible(mas)) continue;
    escondidos += Number(mas.getAttribute('data-cuantos') ?? 0);
  }

  const esperados = Number(
    main.querySelector('[data-torneos]')?.getAttribute('data-torneos') ?? -1,
  );

  return {
    agenda: tarjetas.length,
    tocables: ids.size,
    escondidos,
    alcanzables: (ids.size + escondidos) + ' de ' + esperados,
    ventana: window.innerHeight,
    // Lo que se gasta ANTES de ver un día: del borde de main a la cabecera.
    chrome: cabecera ? px(cabecera.top - rm.top) : null,
    // EL DATO: lo que planificar() reparte.
    disponible: caja ? px(caja.height) : null,
    calendario: cabecera && ultima ? px(ultima.bottom - cabecera.top) : null,
    rejillas: cajas.length,
    barras: barras.length,
    barraMin: altos.length ? Math.min(...altos) : null,
    barraMax: altos.length ? Math.max(...altos) : null,
    cortados: [...new Set(cortados)],
    desborda: document.documentElement.scrollWidth - window.innerWidth,
    altoDoc: document.documentElement.scrollHeight,
  };
})()`;

const SONDA_CLS = `
  window.__cls = 0;
  window.__saltos = [];
  new PerformanceObserver((lista) => {
    for (const e of lista.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__cls += e.value;
      window.__saltos.push({ t: Math.round(e.startTime), v: Math.round(e.value * 1000) / 1000 });
    }
  }).observe({ type: 'layout-shift', buffered: true });
`;

async function medir(ctx: BrowserContext, caso: (typeof CASOS)[number], pantalla: string) {
  const p = await ctx.newPage();
  await p.addInitScript(SONDA_CLS);
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await p.waitForSelector('main [data-barra="torneo"], main .rounded-t-lg, main [data-agenda]', {
    timeout: 60_000,
  }).catch(() => null);
  await p.waitForTimeout(3_600); // más allá del salto tardío de los 2,8 s

  for (let i = 0; i < caso.avanzar; i += 1) {
    await p.getByRole('button', { name: /^Siguiente$/i }).first().click();
    await p.waitForTimeout(500);
  }
  await p.waitForTimeout(700);

  const m = (await p.evaluate(MEDIDA)) as Record<string, unknown>;
  const cls = (await p.evaluate(
    `({ cls: Math.round((window.__cls ?? 0) * 1000) / 1000, saltos: window.__saltos ?? [] })`,
  )) as { cls: number; saltos: { t: number; v: number }[] };

  const ruta = `${SALIDA}/${etiqueta}-${caso.nombre}-${pantalla}.png`;
  await p.screenshot({ path: ruta });
  await p.close();
  return { ...m, cls: cls.cls, saltos: cls.saltos.filter((s) => s.v >= 0.005), captura: ruta };
}

async function main() {
  mkdirSync(SALIDA, { recursive: true });
  const nav = await chromium.launch();

  for (const caso of CASOS) {
    for (const pantalla of PANTALLAS) {
      const ctx = await nav.newContext(pantalla.opciones);
      const p0 = await ctx.newPage();
      await p0.goto(`${BASE}/probar/${caso.atajo}`, {
        waitUntil: 'domcontentloaded',
        timeout: 90_000,
      });
      await p0.close();

      const m = (await medir(ctx, caso, pantalla.nombre)) as Record<string, unknown> & {
        cortados: string[];
        saltos: unknown[];
        captura: string;
      };
      await ctx.close();

      const { captura, cortados, saltos, ...resto } = m;
      console.log(
        `\n== ${caso.nombre} / ${pantalla.nombre} ==\n` +
          Object.entries(resto)
            .map(([k, v]) => `   ${k.padEnd(12)} ${String(v)}`)
            .join('\n') +
          (saltos.length ? `\n   saltos       ${JSON.stringify(saltos)}` : '') +
          `\n   CORTADOS(${cortados.length}) ${cortados.join(' | ')}` +
          `\n   ${captura}`,
      );
    }
  }

  await nav.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
