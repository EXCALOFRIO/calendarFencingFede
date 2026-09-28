import { chromium, devices } from 'playwright';

/**
 * «Mi estado» de un tirador concreto, para ver si sus pruebas dicen **Dentro**.
 *
 *   EMAIL=carlos.llavador@demo.local npx tsx tests/ui/_estado-dentro.mts
 *
 * Es la otra pantalla donde se lee el emparejado de la lista oficial, y la que
 * usa esa palabra literal (`src/components/estado/pruebas.tsx`).
 */

const BASE = process.env.BASE ?? 'http://localhost:3000';

const entrada = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: process.env.EMAIL ?? 'carlos.llavador@demo.local',
    password: process.env.CONTRASENA ?? 'Demo-2026-Esgrima!',
  }),
});
const cookies = (entrada.headers.getSetCookie?.() ?? []).map((cabecera) => {
  const par = cabecera.split(';')[0];
  const i = par.indexOf('=');
  return {
    name: par.slice(0, i).trim(),
    value: par.slice(i + 1),
    domain: new URL(BASE).hostname,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
  };
});
if (cookies.length === 0) throw new Error(`Sin sesión (HTTP ${entrada.status}).`);

const navegador = await chromium.launch();

for (const [vista, config] of [
  ['escritorio', { viewport: { width: 1440, height: 1400 } }],
  ['iphone', devices['iPhone 14 Pro']],
] as const) {
  const contexto = await navegador.newContext({ ...config, locale: 'es-ES' });
  await contexto.addCookies(cookies);
  const p = await contexto.newPage();
  const errores: string[] = [];
  p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errores.push(`console: ${m.text()}`));
  p.on('response', (r) => {
    if (r.status() >= 400) errores.push(`http ${r.status()} ${r.url()}`);
  });

  await p.goto(`${BASE}/estado`, { waitUntil: 'networkidle', timeout: 60_000 });
  await p.waitForTimeout(2500);

  const dentro = await p.getByText(/^Dentro$/).count();
  const sinConfirmar = await p.getByText(/sin confirmar/i).count();
  await p.screenshot({ path: `capturas/estado-dentro-${vista}.png`, fullPage: true });

  console.log(
    `${vista.padEnd(11)} «Dentro»=${dentro} · «sin confirmar»=${sinConfirmar} · ` +
      `errores ${errores.length}`,
  );
  for (const e of errores.slice(0, 6)) console.log(`   ${e}`);
  await contexto.close();
}

await navegador.close();
