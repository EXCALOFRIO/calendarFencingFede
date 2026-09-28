import { chromium, devices } from 'playwright';

/**
 * EL CALENDARIO DE BLOQUES, EN SUS CINCO ESTADOS.
 *
 *   EMAIL=direccion.tecnica@demo.local TODO=antes- npx tsx tests/ui/_ver-bloques.mts
 *
 * -------------------------------------------------------------------------
 * POR QUÉ NO BASTA `npm run mirar`
 * -------------------------------------------------------------------------
 * `mirar` captura una URL, y los estados que hay que juzgar en esta pantalla
 * **no son URLs**: el mes que se está viendo y la vista de uno o tres meses
 * son estado del cliente. Con `mirar` solo se puede fotografiar septiembre de
 * 2026, que además está vacío, así que se estaba validando el rediseño del
 * calendario con la única captura en la que no hay ni un torneo.
 *
 * Esto recorre los cinco estados que de verdad importan, en escritorio y en
 * iPhone, y mide en cada uno el desborde horizontal (tiene que ser 0):
 *
 *   1  septiembre, que es el **mes vacío**
 *   2  octubre, con el fin de semana de cinco competiciones del 3 y 4
 *   3  noviembre
 *   4  el **trimestre**, que es donde se ve si las tres columnas se equilibran
 *   5  y se abre una ficha, que es lo único que no se puede juzgar en estático
 *
 * `TODO` es un prefijo para el nombre del fichero, para poder comparar un
 * antes y un después sin que el segundo pise al primero. `EMAIL` decide con
 * qué filtros se abre la pantalla, y las dos cuentas dicen cosas distintas:
 * la del tirador de florete enseña el caso normal (dos o tres torneos por mes)
 * y la de la dirección técnica el caso peor (116 torneos en el trimestre, con
 * bloques de diez).
 */

const BASE = 'http://localhost:3000';
const EMAIL = process.env.EMAIL ?? 'carlos.llavador@demo.local';
const CONTRASENA = 'Demo-2026-Esgrima!';

function aCookie(c: string) {
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
}

const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: CONTRASENA }),
});
const cookies = (r.headers.getSetCookie?.() ?? []).map(aCookie);
if (cookies.length === 0) throw new Error(`sin sesión ${r.status}`);

const navegador = await chromium.launch();
const TODO = process.env.TODO ?? '';

for (const [nombre, opciones] of [
  ['escritorio', { viewport: { width: 1440, height: 900 } }],
  ['iphone', devices['iPhone 14 Pro']],
] as const) {
  const ctx = await navegador.newContext({ ...(opciones as object) });
  await ctx.addCookies(cookies);
  const p = await ctx.newPage();
  const errores: string[] = [];
  p.on('console', (m) => m.type() === 'error' && errores.push(m.text().slice(0, 160)));
  p.on('pageerror', (e) => errores.push(String(e).slice(0, 160)));
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  const medir = async (etiqueta: string) => {
    await p.waitForTimeout(500);
    await p.screenshot({ path: `capturas/bloq/${TODO}${nombre}-${etiqueta}.png` });
    const m = await p.evaluate(() => ({
      desborda: document.documentElement.scrollWidth - window.innerWidth,
      tarjetas: document.querySelectorAll('[data-bloque]').length,
      torneos: document.querySelectorAll('[data-barra="torneo"]').length,
    }));
    console.log(
      `${nombre.padEnd(11)} ${etiqueta.padEnd(16)} desborde ${String(m.desborda).padStart(3)}px · ` +
        `bloques ${m.tarjetas} · torneos ${m.torneos}` +
        (errores.length ? `\n   ERRORES: ${[...new Set(errores)].slice(0, 2).join(' | ')}` : ''),
    );
  };

  await medir('1-sept');
  // Octubre
  await p.getByRole('button', { name: /^Siguiente$/i }).click();
  await medir('2-octubre');
  // Noviembre
  await p.getByRole('button', { name: /^Siguiente$/i }).click();
  await medir('3-noviembre');
  // Volver a septiembre y pasar a trimestre
  await p.getByRole('button', { name: /^Anterior$/i }).click();
  await p.getByRole('button', { name: /^Anterior$/i }).click();
  await p.getByRole('button', { name: /Filtros del calendario/i }).click();
  await p.waitForTimeout(300);
  await p.getByRole('combobox').last().click();
  await p.waitForTimeout(300);
  await p.getByRole('option', { name: 'Tres meses' }).click();
  await p.waitForTimeout(300);
  await p.keyboard.press('Escape');
  await medir('4-trimestre');

  // Y abrir una ficha del fin de semana múltiple
  await p.getByRole('button', { name: /^Siguiente$/i }).click().catch(() => {});
  await p.waitForTimeout(400);
  const abribles = p.locator('[data-barra="torneo"]:visible');
  if ((await abribles.count()) > 0) {
    await abribles.first().scrollIntoViewIfNeeded();
    await abribles.first().click({ force: true });
    await p.waitForTimeout(2200);
    await p.screenshot({ path: `capturas/bloq/${TODO}${nombre}-5-ficha.png` });
    const abierta = await p.locator('[data-slot="sheet-content"]').count();
    console.log(`${nombre.padEnd(11)} ficha ${abierta ? 'ABIERTA' : 'NO ABIERTA'}`);
    await p.keyboard.press('Escape');
  }

  await ctx.close();
}

await navegador.close();
