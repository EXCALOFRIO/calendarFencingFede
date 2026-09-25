import { chromium, devices } from 'playwright';

/**
 * Capturas y medidas de la interfaz.
 *
 *   RUTAS='/,/estado' EMAIL=madre@demo.local npm run mirar
 *
 * -------------------------------------------------------------------------
 * POR QUÉ FALLA A GRITOS
 * -------------------------------------------------------------------------
 * La primera versión hacía `sign-up` y, si fallaba, `sign-in`, y se tragaba
 * los dos errores. Con una cuenta que ya existía con otra contraseña, el
 * `sign-up` devolvía 422, el `sign-in` 401, el navegador iba sin cookie y la
 * herramienta **fotografiaba la pantalla de acceso** informando de
 * `200 · desborde 0px`. Es decir: decía que todo estaba bien sin haber
 * mirado nunca la pantalla.
 *
 * Una herramienta de validación que falla en silencio es peor que no tener
 * herramienta, porque da confianza falsa. Ahora, si no hay sesión, revienta.
 */

const BASE = process.env.BASE ?? 'http://localhost:3000';
const EMAIL = process.env.EMAIL ?? 'madre@demo.local';
const CONTRASENA = process.env.CONTRASENA ?? 'Demo-2026-Esgrima!';
const RUTAS = (process.env.RUTAS ?? '/').split(',').map((r) => r.trim());

type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
};

function leerCookies(res: Response): Cookie[] {
  const { hostname } = new URL(BASE);
  return (res.headers.getSetCookie?.() ?? [])
    .map((c) => {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      if (i === -1) return null;
      return {
        name: par.slice(0, i).trim(),
        value: par.slice(i + 1),
        domain: hostname,
        path: '/',
        httpOnly: true,
        // Las cookies llevan el prefijo `__Secure-`, que Chrome exige que sea
        // segura. `localhost` cuenta como contexto seguro, así que vale.
        secure: true,
        sameSite: 'Lax' as const,
      };
    })
    .filter((c): c is Cookie => c !== null);
}

async function sesion(): Promise<Cookie[]> {
  const alta = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: CONTRASENA, name: EMAIL }),
  }).catch(() => null);

  const entrada = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: CONTRASENA }),
  });

  const cookies = entrada.ok ? leerCookies(entrada) : [];

  if (cookies.length === 0) {
    throw new Error(
      `No se pudo iniciar sesión como ${EMAIL}.\n` +
        `  alta:    HTTP ${alta?.status ?? 'sin respuesta'}\n` +
        `  entrada: HTTP ${entrada.status} ${await entrada.text()}\n` +
        'Sin sesión, las capturas serían de la pantalla de acceso. Se aborta.\n' +
        'Usuarios de demostración: ejecuta `npm run demo` y usa uno de los ' +
        'correos @demo.local.',
    );
  }

  return cookies;
}

const cookies = await sesion();
const browser = await chromium.launch();
let problemas = 0;

for (const [nombre, config] of [
  ['iphone', devices['iPhone 14 Pro']],
  ['escritorio', { viewport: { width: 1440, height: 900 } }],
] as const) {
  const contexto = await browser.newContext({ ...config, locale: 'es-ES' });
  await contexto.addCookies(cookies);
  const pagina = await contexto.newPage();

  const errores: string[] = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });

  for (const ruta of RUTAS) {
    const slug = ruta.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'inicio';
    const res = await pagina.goto(`${BASE}${ruta}`, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    await pagina.waitForTimeout(600);

    const m = await pagina.evaluate(() => ({
      desborda: document.documentElement.scrollWidth - window.innerWidth,
      alto: document.body.scrollHeight,
      nodos: document.querySelectorAll('*').length,
      // Si acabamos en la pantalla de acceso, la captura no vale de nada.
      esAcceso: Boolean(document.querySelector('input[name="otp"], form[action*="entrar"]')),
      bytes: document.documentElement.outerHTML.length,
    }));

    await pagina.screenshot({ path: `capturas/${nombre}-${slug}.png` });

    const finalEsEntrar = new URL(pagina.url()).pathname.startsWith('/entrar');
    const aviso = finalEsEntrar ? '  ⚠ ACABÓ EN /entrar: sin sesión' : '';
    if (finalEsEntrar) problemas += 1;
    if (m.desborda > 0) problemas += 1;

    console.log(
      `${nombre.padEnd(11)} ${ruta.padEnd(24)} ${res?.status()}  ` +
        `desborde ${String(m.desborda).padStart(3)}px  ` +
        `alto ${String(m.alto).padStart(5)}  nodos ${String(m.nodos).padStart(4)}  ` +
        `${(m.bytes / 1024).toFixed(0).padStart(4)} kB${aviso}`,
    );
  }

  if (errores.length > 0) {
    problemas += errores.length;
    console.log(`  errores (${nombre}): ${[...new Set(errores)].slice(0, 4).join(' | ')}`);
  }

  await contexto.close();
}

await browser.close();

if (problemas > 0) {
  console.log(`\n${problemas} problemas detectados.`);
  process.exitCode = 1;
}
