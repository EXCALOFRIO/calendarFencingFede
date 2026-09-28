import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: process.env.EMAIL ?? 'direccion.tecnica@demo.local',
    password: 'Demo-2026-Esgrima!',
  }),
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

mkdirSync('capturas/cal', { recursive: true });
const nav = await chromium.launch();
const ctx = await nav.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 3,
  locale: 'es-ES',
});
await ctx.addCookies(cookies);
const p = await ctx.newPage();
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
if (process.env.AVANZAR) {
  await p.getByRole('button', { name: /^Siguiente$/i }).click();
  await p.waitForTimeout(700);
}

const caja = await p.locator('[data-barra]').first().boundingBox();
if (!caja) throw new Error('sin barra');
await p.screenshot({
  path: process.env.SALIDA ?? 'capturas/cal/zoom-barra.png',
  clip: {
    x: Math.max(0, caja.x - 20),
    y: Math.max(0, caja.y - 26),
    width: Math.min(560, caja.width + 60),
    height: caja.height + 52,
  },
});
console.log(`zoom ok  barra w=${Math.round(caja.width)} h=${Math.round(caja.height)}`);
await nav.close();
