import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

/**
 * Capturas del calendario para juzgar el rediseño.
 *
 *   ETAPA=antes MESES=0,1,2,3 tsx <este fichero>
 *
 * Recorre varias cuentas × móvil/escritorio × varios meses y deja las
 * imágenes en `capturas/cal/<etapa>-...`. Informa de cuántas barras hay en
 * cada mes para poder elegir «mes cargado» y «mes flojo» sin adivinar.
 */

const BASE = process.env.BASE ?? 'http://localhost:3000';
const CONTRASENA = 'Demo-2026-Esgrima!';
const ETAPA = process.env.ETAPA ?? 'antes';
const MESES = (process.env.MESES ?? '0,1,2,3').split(',').map(Number);
const CUENTAS = (
  process.env.CUENTAS ??
  'tiradora@demo.local,seleccionador.florete@demo.local,direccion.tecnica@demo.local'
).split(',');
const DESTINO = process.env.DESTINO ?? 'capturas/cal';

mkdirSync(DESTINO, { recursive: true });

async function cookiesDe(email: string) {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CONTRASENA }),
  });
  const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => {
    const par = c.split(';')[0];
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
  if (cookies.length === 0) {
    throw new Error(`Sin sesión para ${email} (HTTP ${r.status}).`);
  }
  return cookies;
}

const navegador = await chromium.launch();

for (const email of CUENTAS) {
  const quien = email.split('@')[0].replace(/\./g, '-');
  const cookies = await cookiesDe(email);

  for (const [disp, config] of [
    ['iphone', devices['iPhone 14 Pro']],
    ['escritorio', { viewport: { width: 1440, height: 900 } }],
  ] as const) {
    const contexto = await navegador.newContext({ ...config, locale: 'es-ES' });
    await contexto.addCookies(cookies);
    const pagina = await contexto.newPage();

    const errores: string[] = [];
    pagina.on('pageerror', (e) => errores.push(e.message));
    pagina.on('console', (m) => m.type() === 'error' && errores.push(m.text()));

    await pagina.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 });
    if (new URL(pagina.url()).pathname.startsWith('/entrar')) {
      throw new Error(`Acabó en /entrar con ${email}.`);
    }
    await pagina.waitForTimeout(500);

    for (let i = 0; i <= Math.max(...MESES); i += 1) {
      if (MESES.includes(i)) {
        const ruta = `${DESTINO}/${ETAPA}-${quien}-${disp}-m${i}.png`;
        await pagina.screenshot({ path: ruta });
        const m = await pagina.evaluate(() => {
          const barras = document.querySelectorAll(
            '[data-barra="torneo"]',
          ).length;
          const rot = document.querySelector('h1')?.textContent ?? '';
          return {
            barras,
            rot,
            desborda: document.documentElement.scrollWidth - window.innerWidth,
            altoDoc: document.body.scrollHeight,
            ventana: window.innerHeight,
          };
        });
        console.log(
          `${quien.padEnd(22)} ${disp.padEnd(11)} m${i} ${m.rot.padEnd(16)} ` +
            `barras ${String(m.barras).padStart(2)}  desborde ${m.desborda}px  ` +
            `doc ${m.altoDoc}/${m.ventana}`,
        );
      }
      if (i < Math.max(...MESES)) {
        await pagina
          .getByRole('button', { name: /^Siguiente$/i })
          .click()
          .catch(() => {});
        await pagina.waitForTimeout(500);
      }
    }

    if (errores.length) {
      console.log(`  errores: ${[...new Set(errores)].slice(0, 3).join(' | ')}`);
    }
    await contexto.close();
  }
}

await navegador.close();
