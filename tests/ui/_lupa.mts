/**
 * Lupa: recorta una zona a 4x para juzgar un estado de control.
 * Uso: EMAIL=... RUTA=/ranking SEL='...' SALIDA=x.png npx tsx tests/ui/_sel-lupa.mts
 * Temporal: se borra al acabar el trabajo.
 */
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const BASE = 'http://localhost:3000';
const EMAIL = process.env.EMAIL ?? 'direccion.tecnica@demo.local';
const RUTA = process.env.RUTA ?? '/';
const SEL = process.env.SEL ?? '';
const SALIDA = process.env.SALIDA ?? 'capturas/lupa/lupa.png';
const ESCALA = Number(process.env.ESCALA ?? 4);
const MOVIL = process.env.MOVIL === '1';
const ANTES = process.env.ANTES ?? '';
const MARGEN = Number(process.env.MARGEN ?? 14);

const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: 'Demo-2026-Esgrima!' }),
});
if (!r.ok) throw new Error(`acceso ${r.status} ${await r.text()}`);
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

mkdirSync('capturas/lupa', { recursive: true });
const nav = await chromium.launch();
const ctx = await nav.newContext({
  ...(MOVIL ? devices['iPhone 14 Pro'] : { viewport: { width: 1440, height: 900 } }),
  deviceScaleFactor: ESCALA,
  locale: 'es-ES',
});
await ctx.addCookies(cookies);
const p = await ctx.newPage();
await p.goto(BASE + RUTA, { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);

if (ANTES) {
  // Lista de clics separados por «;», por selector CSS.
  for (const paso of ANTES.split(';')) {
    const t = paso.trim();
    if (!t) continue;
    await p.locator(t).first().click();
    await p.waitForTimeout(550);
  }
}

const caja = SEL ? await p.locator(SEL).first().boundingBox() : null;
if (SEL && !caja) throw new Error(`sin caja para ${SEL}`);
await p.screenshot({
  path: SALIDA,
  clip: caja
    ? {
        x: Math.max(0, caja.x - MARGEN),
        y: Math.max(0, caja.y - MARGEN),
        width: caja.width + MARGEN * 2,
        height: caja.height + MARGEN * 2,
      }
    : undefined,
  fullPage: !caja,
});
console.log(
  `lupa ok ${SALIDA}` +
    (caja ? `  caja x=${Math.round(caja.x)} y=${Math.round(caja.y)} w=${Math.round(caja.width)} h=${Math.round(caja.height)}` : ''),
);
await nav.close();
