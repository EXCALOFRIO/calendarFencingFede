import { chromium, devices } from 'playwright';

/**
 * Captura de la ficha de un torneo, que es la pantalla que más se abre
 * después del calendario y la única que no se ve con `npm run mirar`,
 * porque hay que tocar una barra para que aparezca.
 *
 *   npm run ficha
 *
 * Variables: `EMAIL` (por defecto la tiradora de demostración) y `BUSCAR`,
 * que filtra el calendario antes de abrir la primera barra y sirve para
 * llegar a un torneo concreto.
 */

const BASE = process.env.BASE ?? 'http://localhost:3000';
const EMAIL = process.env.EMAIL ?? 'tiradora@demo.local';
const CONTRASENA = process.env.CONTRASENA ?? 'Demo-2026-Esgrima!';

const entrada = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: CONTRASENA }),
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

if (cookies.length === 0) {
  throw new Error(
    `No se pudo entrar como ${EMAIL} (HTTP ${entrada.status}). Sin sesión, la ` +
      'captura sería de la pantalla de acceso, así que se aborta.',
  );
}

const navegador = await chromium.launch();

for (const [nombre, config] of [
  ['escritorio', { viewport: { width: 1440, height: 900 } }],
  ['iphone', devices['iPhone 14 Pro']],
] as const) {
  const contexto = await navegador.newContext({ ...config, locale: 'es-ES' });
  await contexto.addCookies(cookies);
  const pagina = await contexto.newPage();

  const errores: string[] = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => m.type() === 'error' && errores.push(m.text()));

  await pagina.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 });
  if (new URL(pagina.url()).pathname.startsWith('/entrar')) {
    throw new Error('Acabó en /entrar: la sesión no se aplicó.');
  }

  // Se abren TODAS las armas para que haya torneos de sobra que abrir.
  await pagina
    .getByRole('button', { name: 'Ver todo' })
    .click()
    .catch(() => {});
  await pagina.waitForTimeout(400);

  const buscar = process.env.BUSCAR;
  if (buscar) {
    await pagina.getByRole('searchbox', { name: /Buscar/ }).fill(buscar);
    await pagina.waitForTimeout(500);
  }

  const barras = pagina.locator('div.relative.grid.grid-cols-7 > button');
  const cuantas = await barras.count();
  if (cuantas === 0) throw new Error('No hay ninguna barra en el calendario.');

  await barras.first().click({ force: true });
  // La lista de inscritos llega por una acción de servidor, así que hay que
  // esperar a que vuelva: con 800 ms la captura salía con «Mirando quién va…».
  await pagina.waitForTimeout(2500);

  await pagina.screenshot({ path: `capturas/ficha-${nombre}.png` });

  const m = await pagina.evaluate(() => ({
    desborda: document.documentElement.scrollWidth - window.innerWidth,
    abierta: Boolean(document.querySelector('[data-slot="sheet-content"]')),
  }));

  console.log(
    `${nombre.padEnd(11)} ${cuantas} barras · ficha ${m.abierta ? 'abierta' : 'NO ABIERTA'} · ` +
      `desborde ${m.desborda}px` +
      (errores.length ? `\n  errores: ${[...new Set(errores)].slice(0, 2).join(' | ')}` : ''),
  );

  await contexto.close();
}

await navegador.close();
