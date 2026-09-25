import { chromium, devices } from 'playwright';

/**
 * Capturas de la aplicación en móvil y escritorio.
 *
 * Se usa el perfil de iPhone real de Playwright (no una ventana estrecha):
 * el ancho es lo de menos, lo que cambia el resultado es el pixel ratio, el
 * user agent y que el puntero sea táctil, que es lo que activa los tamaños
 * mínimos de 44 px.
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const RUTAS = (process.env.RUTAS ?? '/entrar').split(',');

const browser = await chromium.launch();

for (const [nombre, config] of [
  ['iphone', devices['iPhone 14 Pro']],
  ['escritorio', { viewport: { width: 1440, height: 900 } }],
]) {
  const context = await browser.newContext({ ...config, locale: 'es-ES' });
  const page = await context.newPage();

  for (const ruta of RUTAS) {
    const slug = ruta.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'inicio';
    try {
      const res = await page.goto(`${BASE}${ruta}`, {
        waitUntil: 'networkidle',
        timeout: 60000,
      });
      // Deja que terminen las animaciones de entrada antes de capturar.
      await page.waitForTimeout(900);
      await page.screenshot({
        path: `capturas/${nombre}-${slug}.png`,
        fullPage: nombre === 'escritorio',
      });
      console.log(`${nombre} ${ruta} -> ${res?.status()}`);

      const errores = [];
      page.on('pageerror', (e) => errores.push(e.message));
      if (errores.length) console.log('  errores JS:', errores.join(' | '));
    } catch (e) {
      console.log(`${nombre} ${ruta} -> ERROR ${e.message.split('\n')[0]}`);
    }
  }

  await context.close();
}

await browser.close();
console.log('listo');
