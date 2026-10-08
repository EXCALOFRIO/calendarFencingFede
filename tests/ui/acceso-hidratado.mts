/**
 * Arnes SSR + hidratación REAL de EntrarPage/FormularioAcceso.
 * Solo HTTP loopback, acciones sintéticas, sin Next/Neon, fuentes ni red externa.
 * Ejecutar: npx tsx tests/ui/acceso-hidratado.mts
 * Las capturas ocultan el input OTP incluso cuando contiene valores sintéticos.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const raiz = process.cwd();
const salida = path.join(raiz, 'capturas', 'acceso-pulido');
const sinteticas = `
  export async function accionSintetica() {
    globalThis.__envios = (globalThis.__envios || 0) + 1;
    await new Promise(r => setTimeout(r, 450));
    return { error: 'El código no es válido o ha caducado. Pide uno nuevo.' };
  }
  export async function reenvioSintetico() {
    globalThis.__reenvios = (globalThis.__reenvios || 0) + 1;
    await new Promise(r => setTimeout(r, 450));
    return { aviso: 'Si el correo está invitado, recibirás otro código.' };
  }
  export async function cambioSintetico() {
    globalThis.__cambios = (globalThis.__cambios || 0) + 1;
  }`;
const stubs: Record<string, string> = {
  'next/headers': `export const cookies = async () => ({get: () => ({value:'persona@example.test'}),has:()=>false}); export const headers = async () => new Headers();`,
  'next/navigation': `export function redirect(){ throw Error('No debe navegar el arnés'); }`,
  '@/lib/auth/session': `export const getSessionProfile = async () => null;`,
  '@/lib/auth/server': `export function getAuth(){throw Error('Proveedor bloqueado');}`,
  '@/lib/auth/preview-token': `export const COOKIE_VISTA_PREVIA='preview';`,
  '@/lib/auth/qa-token': `export const COOKIE_ACCESO_QA='qa';`,
  'acciones-sinteticas': sinteticas,
};
const plugin: Plugin = {
  name: 'acceso-sintetico',
  setup(b) {
    b.onResolve({ filter: /^(next\/(headers|navigation)|@\/lib\/auth\/(session|server|preview-token|qa-token)|acciones-sinteticas)$/ },
      ({ path: p }) => ({ path: p, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path: p }) => ({ contents: stubs[p], loader: 'js' }));
    b.onLoad({ filter: /[\\/]app[\\/]entrar[\\/]page\.tsx$/ }, ({ path: p }) => ({
      contents: `import {accionSintetica,reenvioSintetico,cambioSintetico} from 'acciones-sinteticas';\n` +
        readFileSync(p, 'utf8')
          .replace('accion={esPasoCodigo ? verificarCodigo : enviarCodigo}', 'accion={accionSintetica}')
          .replace('reenviar={reenviarCodigo}', 'reenviar={reenvioSintetico}')
          .replace('cambiarCorreo={cambiarCorreo}', 'cambiarCorreo={cambioSintetico}'),
      loader: 'tsx', resolveDir: path.dirname(p),
    }));
  },
};
const comun = {
  bundle: true, write: false, jsx: 'automatic' as const, plugins: [plugin],
  tsconfig: path.join(raiz, 'tsconfig.json'), logLevel: 'silent' as const,
  define: { 'process.env.NODE_ENV': '"production"' },
};
const nodeBundle = await build({
  ...comun, platform: 'node', format: 'cjs', outfile: 'arnes.js',
  stdin: {
    contents: `import Page from './src/app/entrar/page'; import {renderToString} from 'react-dom/server';
      export async function html(paso,error) { return renderToString(await Page({searchParams:Promise.resolve({paso,error})})); }`,
    resolveDir: raiz, loader: 'tsx',
  },
});
const modulo = { exports: {} as { html: (paso?: string, error?: string) => Promise<string> } };
new Function('require', 'module', 'exports', nodeBundle.outputFiles.find(f => f.path.endsWith('.js'))!.text)(
  createRequire(import.meta.url), modulo, modulo.exports,
);
const browserBundle = await build({
  ...comun, platform: 'browser', format: 'esm', outfile: 'cliente.js',
  stdin: {
    contents: `import Page from './src/app/entrar/page'; import {hydrateRoot} from 'react-dom/client';
      const p=new URLSearchParams(location.search);
      const elemento=await Page({searchParams:Promise.resolve({paso:p.get('paso'),error:p.get('error')})});
      hydrateRoot(document.getElementById('raiz'),elemento);
      requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__hidratado=true;}));`,
    resolveDir: raiz, loader: 'tsx',
  },
});
const origenCss = path.join(raiz, 'src/app/globals.css');
const globalCss = await postcss([tailwind({ base: raiz })]).process(readFileSync(origenCss, 'utf8'), { from: origenCss });
const css = globalCss.css + '\n' + browserBundle.outputFiles.find(f => f.path.endsWith('.css'))!.text;
const js = browserBundle.outputFiles.find(f => f.path.endsWith('.js'))!.text;
const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/cliente.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(js);
  if (url.pathname.startsWith('/fotos/')) {
    const fichero = path.join(raiz, 'public', url.pathname);
    try { return void res.writeHead(200, { 'content-type': 'image/webp' }).end(readFileSync(fichero)); }
    catch { return void res.writeHead(404).end(); }
  }
  const cuerpo = await modulo.exports.html(url.searchParams.get('paso') ?? undefined, url.searchParams.get('error') ?? undefined);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
    `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
    <body><div id="raiz">${cuerpo}</div><script type="module" src="/cliente.js"></script></body></html>`,
  );
});
await new Promise<void>(resolve => servidor.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
mkdirSync(salida, { recursive: true });
const browser = await chromium.launch();
let capturas = 0;
try {
  for (const width of [360, 393, 1440]) {
    for (const reduce of [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 1440 ? 900 : 852 },
        reducedMotion: reduce ? 'reduce' : 'no-preference',
      });
      const errores: string[] = [];
      page.on('pageerror', () => errores.push('pageerror'));
      page.on('console', m => { if (m.type() === 'error') errores.push('console-error'); });
      await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
      const abrir = async (codigo: boolean) => {
        await page.goto(base + (codigo ? '/?paso=codigo' : '/'));
        await page.waitForFunction(() => (window as unknown as { __hidratado: boolean }).__hidratado);
      };
      const capturar = async (nombre: string) => {
        await page.screenshot({
          path: path.join(salida, `${nombre}-${width}${reduce ? '-reducido' : ''}.png`),
          fullPage: true, style: '#otp { color: transparent !important; caret-color: transparent !important; }',
        });
        capturas++;
      };
      await abrir(false);
      assert.equal(await page.locator('input:focus').count(), 0);
      assert.equal(await page.locator('input').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16), true);
      await capturar('correo');
      await page.getByLabel('Correo electrónico').fill('persona@example.test');
      await page.getByRole('button', { name: 'Enviar código', exact: true }).click();
      await page.getByRole('button', { name: 'Enviando…', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Enviando…', exact: true }).isDisabled(), true);
      await page.getByText('El código no es válido', { exact: false }).waitFor();
      assert.equal(await page.getByLabel('Correo electrónico').inputValue(), 'persona@example.test');

      await abrir(true);
      assert.equal(await page.locator('input').count(), 1);
      // El paso del código enfoca su campo: un toque menos.
      assert.equal(await page.locator('#otp:focus').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await capturar('codigo');
      const otp = page.getByLabel('Código de verificación');
      const boton = page.getByRole('button', { name: 'Continuar', exact: true });
      const antes = await boton.boundingBox();
      // Simula autofill nativo y pegado desde portapapeles en un contexto nuevo.
      const codigo = [0, ...Array.from({ length: 5 }, (_, i) => i + 1)].join('');
      await otp.fill(codigo);
      assert.equal(await otp.inputValue() === codigo, true);
      const context = page.context();
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate(value => navigator.clipboard.writeText(value), ` ${codigo.slice(0, 3)} ${codigo.slice(3)} `);
      await otp.selectText();
      await otp.press('Control+V');
      assert.equal(await otp.inputValue() === codigo, true);
      assert.equal(await otp.evaluate(el => el.scrollLeft), 0);

      // Un pegado más largo que el código se queda con las seis primeras cifras.
      await page.evaluate(value => navigator.clipboard.writeText(value), `${codigo}9876`);
      await otp.selectText();
      await otp.press('Control+V');
      assert.equal(await otp.inputValue() === codigo, true);

      // Teclear una séptima cifra no la añade ni desplaza el código.
      await otp.fill('');
      await otp.pressSequentially(`${codigo}9`);
      assert.equal(await otp.inputValue() === codigo, true);
      assert.equal(await otp.evaluate(el => el.scrollLeft), 0);

      // Con el código completo y el cursor al principio, la cifra sobrescribe (acordado).
      await otp.evaluate(el => (el as HTMLInputElement).setSelectionRange(0, 0));
      await otp.press('9');
      assert.equal(await otp.inputValue() === `9${codigo.slice(1)}`, true);
      assert.equal(await otp.evaluate(el => (el as HTMLInputElement).selectionStart), 1);

      // IME en modo composición (Samsung, Gboard con sugerencias): nunca más de seis.
      const cdp = await context.newCDPSession(page);
      await otp.fill('');
      await otp.focus();
      const largo = `${codigo}98`;
      for (let i = 1; i <= largo.length; i++) {
        await cdp.send('Input.imeSetComposition', { text: largo.slice(0, i), selectionStart: i, selectionEnd: i });
        assert.ok(await page.locator('[data-rellena="true"]').count() <= 6);
      }
      await cdp.send('Input.insertText', { text: largo });
      assert.ok((await otp.inputValue()).length <= 6);
      assert.equal(/^\d*$/.test(await otp.inputValue()), true);
      assert.equal(await otp.evaluate(el => el.scrollLeft), 0);
      await cdp.detach();
      await otp.fill(codigo);

      await otp.press('End');
      await otp.press('Backspace');
      assert.equal((await otp.inputValue()).length, 5);
      await boton.click();
      assert.equal(await page.evaluate(() => (window as unknown as { __envios?: number }).__envios ?? 0), 0);
      await otp.fill(codigo);
      await otp.evaluate(el => (el as HTMLInputElement).setSelectionRange(2, 3));
      await otp.press('8');
      assert.equal((await otp.inputValue())[2], '8');
      await boton.click();
      await page.getByRole('button', { name: 'Comprobando…', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Reenviar código', exact: true }).isDisabled(), true);
      await otp.press('Enter');
      await capturar('pendiente');
      await page.getByText('El código no es válido', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => (window as unknown as { __envios: number }).__envios), 1);
      assert.equal((await otp.inputValue()).length, 6);
      assert.equal(await otp.getAttribute('aria-invalid'), 'true');
      // El error se ve en las seis casillas, no solo en el texto.
      assert.equal(await page.locator('[data-rellena]').first().evaluate(el => {
        const muestra = document.createElement('i');
        muestra.style.color = 'var(--destructive)';
        document.body.append(muestra);
        const color = getComputedStyle(muestra).color;
        muestra.remove();
        return getComputedStyle(el).borderTopColor === color;
      }), true);
      assert.equal((await boton.boundingBox())!.y, antes!.y);
      await capturar('error');
      await page.getByRole('button', { name: 'Reenviar código', exact: true }).click();
      await page.getByText('Si el correo está invitado, recibirás otro código.', { exact: true }).waitFor();
      assert.equal((await otp.inputValue()).length, 6);
      if (reduce) assert.equal(await page.locator('[data-rellena="true"]').first().evaluate(el => getComputedStyle(el).animationName), 'none');
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      for (const el of await page.locator('button,input').all()) {
        const box = await el.boundingBox();
        assert.ok(box && box.height >= 44 && box.width >= 44);
      }
      if (width !== 1440) {
        // Aproximación al viewport disponible con teclado, no teclado físico.
        await page.setViewportSize({ width, height: 420 });
        await otp.scrollIntoViewIfNeeded();
        const caja = await otp.boundingBox();
        assert.ok(caja && caja.y >= 0 && caja.y + caja.height <= 420);
        await page.setViewportSize({ width: 852, height: 393 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      assert.deepEqual(errores, []);
      await page.close();
    }
  }
  console.log(`Acceso hidratado: ${capturas} capturas; paste/autofill/ceros/edición/7.ª cifra/IME/error/pending/reenvío/reduced-motion correctos.`);
  console.log(salida);
} finally {
  await browser.close();
  await new Promise<void>(resolve => servidor.close(() => resolve()));
}
