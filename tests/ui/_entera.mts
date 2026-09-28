import { chromium, devices } from 'playwright';

/**
 * Captura de página ENTERA (no solo el hueco visible) para poder juzgar el alto
 * y la jerarquía de una pantalla larga.
 *
 *   RUTAS='/estado' EMAIL=... PREFIJO=nuevo npx tsx <este fichero>
 */
const BASE = process.env.BASE ?? 'http://localhost:3000';
const EMAIL = process.env.EMAIL ?? 'carlos.llavador@demo.local';
const PREFIJO = process.env.PREFIJO ?? 'entera';
const RUTAS = (process.env.RUTAS ?? '/estado').split(',').map((r) => r.trim());
const SOLO = process.env.SOLO ?? '';

const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: 'Demo-2026-Esgrima!' }),
});
const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => {
  const par = c.split(';')[0];
  const i = par.indexOf('=');
  return {
    name: par.slice(0, i).trim(),
    value: par.slice(i + 1),
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
  };
});
if (cookies.length === 0) throw new Error(`sin sesión para ${EMAIL}`);

const nav = await chromium.launch();

const modos = [
  ['iphone', { ...devices['iPhone 14 Pro'], deviceScaleFactor: 2 }],
  ['escritorio', { viewport: { width: 1440, height: 900 } }],
] as const;

for (const [nombre, cfg] of modos) {
  if (SOLO && SOLO !== nombre) continue;
  const ctx = await nav.newContext({ ...cfg, locale: 'es-ES' });
  await ctx.addCookies(cookies);
  const p = await ctx.newPage();
  for (const ruta of RUTAS) {
    const slug = ruta.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'inicio';
    await p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await p.waitForTimeout(700);
    if (process.env.CLIC) {
      await p.getByRole('button', { name: process.env.CLIC }).first().click();
      await p.waitForTimeout(600);
    }
    const alto = await p.evaluate(() => document.body.scrollHeight);
    const selector = process.env.MEDIR || 'main h1';
    await p.addScriptTag({ content: `window.__sel = ${JSON.stringify(selector)};` });
    const primer = await p.evaluate(() => {
      const h = document.querySelector(
        (window as unknown as { __sel: string }).__sel,
      );
      return h ? Math.round(h.getBoundingClientRect().top + window.scrollY) : -1;
    });
    await p.screenshot({
      path: `capturas/${PREFIJO}-${nombre}-${slug}.png`,
      fullPage: true,
    });
    console.log(`${nombre.padEnd(11)} ${ruta.padEnd(18)} alto ${alto}  h1 a ${primer}px`);
  }
  await ctx.close();
}

await nav.close();
