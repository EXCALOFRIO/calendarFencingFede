/**
 * ¿Cabe el panel de filtros sin desplazarse?
 *
 * Mide lo que hay que medir y no «se ve bien»: el alto del contenido contra
 * el alto visible del panel. Si el primero es mayor, hay barra de
 * desplazamiento, y da igual que la captura parezca correcta.
 *
 * Se prueba en el móvil más estrecho que soportamos y con el peor caso: la
 * dirección técnica, que ve las diez categorías.
 */
import { chromium, devices } from 'playwright';

const BASE = 'http://localhost:3000';
const CONTRASENA = 'Demo-2026-Esgrima!';

async function sesion(email: string) {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CONTRASENA }),
  });
  const cookies = (r.headers.getSetCookie?.() ?? [])
    .map((par) => {
      const i = par.indexOf('=');
      return {
        name: par.slice(0, i).trim(),
        value: par.slice(i + 1).split(';')[0]!,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
      };
    })
    .filter((c) => c.name && c.value);
  if (cookies.length === 0) throw new Error(`Sin sesión para ${email} (${r.status})`);
  return cookies;
}

const cookies = await sesion('direccion.tecnica@demo.local');
const b = await chromium.launch();

const pantallas: [string, Parameters<typeof b.newContext>[0]][] = [
  ['iphone-se', { ...devices['iPhone SE'] }],
  ['iphone-14', { ...devices['iPhone 14 Pro'] }],
  ['escritorio', { viewport: { width: 1440, height: 900 } }],
];

let problemas = 0;

for (const [nombre, opciones] of pantallas) {
  const ctx = await b.newContext(opciones);
  await ctx.addCookies(cookies);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 });

  // Hay dos disparadores —hoja en el móvil, menú en escritorio— y CSS esconde
  // el que no toca. Se pulsa el visible.
  await p.getByRole('button', { name: /Filtros del calendario/i }).first().click();
  await p.waitForTimeout(600);

  const medida = await p.evaluate(() => {
    const panel =
      document.querySelector<HTMLElement>('[data-slot="popover-content"]') ??
      document.querySelector<HTMLElement>('[data-slot="sheet-content"]');
    if (!panel) return null;
    /*
      `sr-only` recorta a un píxel a propósito para que el texto exista para
      un lector de pantalla y no se vea. Eso cuenta como «desbordado» y no lo
      es: nadie lo desplaza con el dedo.
    */
    const dentro = [...panel.querySelectorAll<HTMLElement>('*')].filter(
      (e) =>
        e.scrollHeight > e.clientHeight + 1 &&
        e.clientHeight > 0 &&
        !e.closest('.sr-only'),
    );
    const r = panel.getBoundingClientRect();
    return {
      alto: Math.round(panel.scrollHeight),
      visible: Math.round(panel.clientHeight),
      abajo: Math.round(r.bottom),
      ventana: window.innerHeight,
      anidados: dentro.length,
      quienes: dentro.map(
        (e) =>
          `${e.tagName.toLowerCase()}.${(e.className || '').toString().slice(0, 40)} ` +
          `(${e.scrollHeight}>${e.clientHeight})`,
      ),
    };
  });

  if (!medida) {
    console.log(`${nombre.padEnd(11)} ✗ no se ha encontrado el panel`);
    problemas += 1;
  } else {
    const seDesplaza = medida.alto > medida.visible + 1;
    const seSale = medida.abajo > medida.ventana;
    const mal = seDesplaza || seSale || medida.anidados > 0;
    console.log(
      `${nombre.padEnd(11)} ${mal ? '✗' : '✓'} contenido ${medida.alto}px · ` +
        `visible ${medida.visible}px · acaba en ${medida.abajo} de ${medida.ventana} · ` +
        `cajas que se desplazan dentro: ${medida.anidados}`,
    );
    for (const q of medida.quienes) console.log(`              ${q}`);
    if (mal) problemas += 1;
  }

  await p.screenshot({ path: `capturas/filtros-${nombre}.png` });

  /*
    Y que el filtro nuevo filtre. Se comparan las cifras del propio panel:
    son las que cuenta la pantalla, así que si el ámbito no se aplicara de
    verdad no se moverían.
  */
  const cifras = async () =>
    (await p.locator('p:has-text("torneos")').first().textContent())?.trim() ?? '';

  const todo = await cifras();
  await p.getByRole('radio', { name: /^Internacional$/ }).click();
  await p.waitForTimeout(500);
  const inter = await cifras();
  await p.getByRole('radio', { name: /^Nacional$/ }).click();
  await p.waitForTimeout(500);
  const nac = await cifras();

  console.log(`              todo: ${todo} | internacional: ${inter} | nacional: ${nac}`);
  if (inter === todo || nac === todo || inter === nac) {
    console.log('              ✗ el ámbito no cambia lo que se enseña');
    problemas += 1;
  }

  await ctx.close();
}

await b.close();
console.log(problemas === 0 ? '\nCabe entero en todas.' : `\n${problemas} con problema.`);
process.exit(problemas === 0 ? 0 : 1);
