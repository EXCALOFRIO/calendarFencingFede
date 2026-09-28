import { chromium, devices } from 'playwright';

/**
 * Abre la ficha de UN evento por su identificador y comprueba qué dice
 * «¿Estás dentro?».
 *
 *   EVENTO=<uuid> PRUEBA="FLORETE M" NOMBRE=dentro npx tsx tests/ui/_dentro.mts
 *
 * Existe porque `_torneo.mts` elige la barra por su TEXTO, y en octubre hay
 * cuatro torneos que se llaman «COPA MUNDO» (Orán, Casablanca, Takamatsu y el
 * satélite): el patrón se lo llevaba una barra que ni se ve. Aquí la barra se
 * elige por `data-evento`, que es exacto y no se presta a confusión.
 */

const BASE = process.env.BASE ?? 'http://localhost:3000';
const EVENTO = process.env.EVENTO;
const NOMBRE = process.env.NOMBRE ?? 'dentro';
const ESPERA = Number(process.env.ESPERA ?? 9000);
const AVANZAR = Number(process.env.AVANZAR ?? 1);
if (!EVENTO) throw new Error('Falta EVENTO=<uuid del evento>.');

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

  await p.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 });
  await p
    .getByRole('button', { name: /Filtros del calendario/i })
    .click()
    .catch(() => {});
  await p.waitForTimeout(300);
  await p
    .getByRole('button', { name: /^Ver todo$/ })
    .click()
    .catch(() => {});
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  for (let i = 0; i < AVANZAR; i += 1) {
    await p.getByRole('button', { name: /^Siguiente$/i }).click();
    await p.waitForTimeout(700);
  }

  /**
   * El mismo evento aparece DOS veces en el DOM: como barra de la rejilla y
   * como tarjeta de la agenda, y una de las dos está siempre oculta según el
   * ancho. Así que no vale `.first()`: hay que quedarse con la que se ve.
   */
  const candidatas = p.locator(`[data-evento="${EVENTO}"]`);
  const total = await candidatas.count();
  let diana = null;
  for (let i = 0; i < total; i += 1) {
    const c = candidatas.nth(i);
    await c.scrollIntoViewIfNeeded().catch(() => {});
    if (await c.isVisible()) {
      diana = c;
      break;
    }
  }
  if (!diana) throw new Error(`Las ${total} apariciones del evento están ocultas en ${vista}.`);
  await p.waitForTimeout(400);
  const rotulo = (await diana.innerText().catch(() => '(sin texto)')).replace(/\s+/g, ' ');
  await diana.click({ force: true });
  await p.waitForTimeout(ESPERA);

  /**
   * Y ahora lo que se viene a comprobar. No vale con que la captura salga:
   * se lee el texto de la banda «¿Estás dentro?» y se dice si aparece la
   * marca de que estás en la lista oficial.
   */
  const banda = p.getByRole('dialog').getByText(/Estás en la lista oficial/i);
  const dentro = (await banda.count()) > 0;
  const tu = await p.getByRole('dialog').getByText(/^tú$/).count();

  await p.screenshot({ path: `capturas/${NOMBRE}-${vista}.png` });
  await p.mouse.wheel(0, 1200);
  await p.waitForTimeout(800);
  await p.screenshot({ path: `capturas/${NOMBRE}-${vista}-lista.png` });

  console.log(
    `${vista.padEnd(11)} «${rotulo}» · DENTRO=${dentro ? 'sí' : 'NO'} · ` +
      `marcas «tú»=${tu} · errores ${errores.length}`,
  );
  for (const e of errores.slice(0, 6)) console.log(`   ${e}`);
  await contexto.close();
}

await navegador.close();
