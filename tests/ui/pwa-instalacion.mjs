// Fixture sintética hidratada: no levanta Next, no usa cuentas ni servicios remotos.
// Ejecutar desde la raíz: node tests/ui/pwa-instalacion.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, stop } from 'esbuild';
import { chromium } from 'playwright';

const raiz = fileURLToPath(new URL('../../', import.meta.url));
const salida = await mkdtemp(path.join(tmpdir(), 'calendarfencing-pwa-'));
const compilado = await build({
  stdin: {
    contents: `
      import * as React from 'react';
      import { hydrateRoot } from 'react-dom/client';
      import { Instalable } from './src/components/instalable';
      function Fixture() {
        React.useEffect(() => { window.hidratada = true; }, []);
        return <Instalable />;
      }
      hydrateRoot(document.getElementById('root'), <Fixture />);
    `,
    resolveDir: raiz, loader: 'tsx',
  },
  bundle: true, write: false, outdir: salida, jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
});
const js = compilado.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = compilado.outputFiles.find((f) => f.path.endsWith('.css')).text;
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Prueba sintética PWA</title><link rel="stylesheet" href="/fixture.css">
<style>
*{box-sizing:border-box}body{margin:0;background:#090A0F;color:#f6f6f7;font-family:Arial,sans-serif}
main{padding:24px;max-width:768px;margin:auto}h1{font-size:24px}p{line-height:1.5}
label{display:block;margin:24px 0 8px}input{font:16px Arial;padding:12px;width:100%;max-width:320px}
nav{position:fixed;bottom:0;left:0;right:0;padding:20px;background:#191b22;text-align:center;border-top:1px solid #454751}
</style></head><body><main><h1>CalendarFencing</h1>
<p>Calendario de ejemplo · sin cuenta ni datos reales</p>
<label for="filtro">Buscar competición</label><input id="filtro" placeholder="Nombre de competición">
</main><div id="root"></div><nav aria-label="Principal">Calendario · Ranking</nav>
<script src="/fixture.js"></script></body></html>`;
const server = createServer((req, res) => {
  const tipo = req.url === '/fixture.js' ? 'application/javascript' : req.url === '/fixture.css' ? 'text/css' : 'text/html';
  res.writeHead(200, { 'Content-Type': `${tipo}; charset=utf-8` });
  res.end(req.url === '/fixture.js' ? js : req.url === '/fixture.css' ? css : html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errores = [];
let casos = 0;

async function escenario({ ios = false, otroIOS = false, standalone = false, bloqueado = false, cooldown = false, width = 360 } = {}) {
  const contexto = await browser.newContext({
    viewport: { width, height: 800 }, reducedMotion: 'reduce',
    ...(ios ? { userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 ${otroIOS ? 'CriOS/130' : 'Version/18.0'} Mobile/15E148 Safari/604.1` } : {}),
  });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (error) => errores.push(error.message));
  pagina.on('console', (mensaje) => { if (mensaje.type() === 'error') errores.push(mensaje.text()); });
  await pagina.clock.install();
  await pagina.addInitScript(({ standalone, bloqueado, cooldown }) => {
    window.registrosSW = [];
    window.prompts = 0;
    Object.defineProperty(navigator, 'standalone', { value: standalone });
    Object.defineProperty(navigator, 'serviceWorker', { value: {
      register: async (ruta, opciones) => {
        window.registrosSW.push({ ruta, opciones, estado: document.readyState });
        return {};
      },
    } });
    if (cooldown) localStorage.setItem('calendarfencing:instalacion:v1', String(Date.now() + 86400000));
    if (bloqueado) Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  }, { standalone, bloqueado, cooldown });
  await pagina.goto(url);
  await pagina.waitForFunction(() => window.hidratada);
  assert.equal(await pagina.locator('aside').count(), 0, 'No invitación inmediata');
  assert.equal(await pagina.evaluate(() => window.registrosSW.every((r) => r.estado === 'complete' && r.opciones.updateViaCache === 'none')), true);
  return { pagina, contexto };
}

async function emitir(pagina, outcome = 'accepted') {
  await pagina.evaluate((resultado) => {
    const evento = new Event('beforeinstallprompt', { cancelable: true });
    evento.prompt = async () => { window.prompts++; if (resultado === 'error') throw new Error('Cancelado'); };
    evento.userChoice = Promise.resolve({ outcome: resultado });
    window.dispatchEvent(evento);
    window.prevented = evento.defaultPrevented;
  }, outcome);
}

async function comprobarDiseno(pagina) {
  const medidas = await pagina.evaluate(() => ({
    cabe: document.documentElement.scrollWidth <= innerWidth,
    controles: [...document.querySelectorAll('aside button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { width: r.width, height: r.height, transition: getComputedStyle(b).transitionDuration };
    }),
    posicion: getComputedStyle(document.querySelector('aside')).position,
  }));
  assert.equal(medidas.cabe, true);
  assert.equal(medidas.posicion, 'static');
  assert.ok(medidas.controles.every((b) => b.width >= 44 && b.height >= 44 && b.transition === '0s'));
  await pagina.getByLabel('Buscar competición').fill('Prueba');
  assert.equal(await pagina.getByLabel('Buscar competición').inputValue(), 'Prueba');
}

try {
  for (const otroIOS of [false, true]) {
    const { pagina, contexto } = await escenario({ ios: true, otroIOS });
    await pagina.clock.fastForward(8_100);
    await pagina.getByRole('button', { name: 'Cómo añadir' }).click();
    assert.match(await pagina.locator('aside').innerText(), /Compartir → Añadir a pantalla de inicio → Añadir/);
    if (otroIOS) assert.match(await pagina.locator('aside').innerText(), /Abre esta web en Safari/);
    await comprobarDiseno(pagina);
    if (!otroIOS) await pagina.screenshot({ path: path.join(salida, 'iphone-360.png'), fullPage: true });
    await pagina.getByRole('button', { name: 'Ahora no' }).click();
    assert.equal(await pagina.locator('aside').count(), 0);
    await pagina.reload();
    await pagina.waitForFunction(() => window.hidratada);
    await pagina.clock.fastForward(8_100);
    assert.equal(await pagina.locator('aside').count(), 0, 'Descarte persiste');
    await contexto.close(); casos++;
  }
  for (const resultado of ['accepted', 'dismissed', 'error']) {
    const { pagina, contexto } = await escenario({ width: 1280 });
    await emitir(pagina, resultado);
    await pagina.clock.fastForward(8_100);
    await pagina.getByRole('button', { name: 'Instalar app' }).waitFor();
    assert.equal(await pagina.evaluate(() => window.prompts), 0);
    assert.equal(await pagina.evaluate(() => window.prevented), true);
    await comprobarDiseno(pagina);
    if (resultado === 'accepted') await pagina.screenshot({ path: path.join(salida, 'chromium-1280.png'), fullPage: true });
    await pagina.getByRole('button', { name: 'Instalar app' }).click();
    if (resultado === 'error') await pagina.getByRole('status').waitFor();
    else await pagina.locator('aside').waitFor({ state: 'detached' });
    assert.equal(await pagina.evaluate(() => window.prompts), 1);
    const dias = await pagina.evaluate(() => (Number(localStorage.getItem('calendarfencing:instalacion:v1')) - Date.now()) / 86400000);
    assert.ok(dias > (resultado === 'accepted' ? 179 : 29));
    await contexto.close(); casos++;
  }
  for (const opciones of [{ ios: true, standalone: true }, { ios: true, cooldown: true }, {}]) {
    const { pagina, contexto } = await escenario(opciones);
    await pagina.clock.fastForward(8_100);
    assert.equal(await pagina.locator('aside').count(), 0, 'Standalone/cooldown/sin evento no ofrecen');
    await contexto.close(); casos++;
  }
  {
    const { pagina, contexto } = await escenario({ bloqueado: true });
    await emitir(pagina);
    await pagina.clock.fastForward(8_100);
    await pagina.getByRole('button', { name: 'Ahora no' }).click();
    await pagina.evaluate(() => history.pushState({}, '', '/ranking'));
    await emitir(pagina);
    await pagina.clock.fastForward(30_000);
    assert.equal(await pagina.locator('aside').count(), 0);
    await contexto.close(); casos++;
  }
  {
    const { pagina, contexto } = await escenario();
    await emitir(pagina);
    await pagina.clock.fastForward(8_100);
    await pagina.getByRole('button', { name: 'Instalar app' }).waitFor();
    await pagina.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await pagina.locator('aside').waitFor({ state: 'detached' });
    await contexto.close(); casos++;
  }
  assert.deepEqual(errores, [], 'Sin errores de hidratación/consola');
  console.log(JSON.stringify({ casos, errores, capturas: salida }, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await browser.close();
  stop();
  console.log('Fixture y navegador cerrados.');
}
