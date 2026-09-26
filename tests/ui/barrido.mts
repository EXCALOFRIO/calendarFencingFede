import { chromium, devices } from 'playwright';

/**
 * Barrido final: cada papel recorre sus pantallas, en móvil y en escritorio.
 *
 * Lo que se mide de verdad, no «la página carga»:
 *   - código de respuesta,
 *   - desborde horizontal en píxeles,
 *   - errores de JavaScript y de hidratación en la consola,
 *   - que no se haya acabado en la pantalla de acceso.
 */

const BASE = 'http://localhost:3000';
const CONTRASENA = 'Demo-2026-Esgrima!';

const PAPELES: [string, string, string[]][] = [
  [
    'tiradora',
    'tiradora@demo.local',
    // `/alta` entra con dos papeles a propósito: con esta cuenta, que YA tiene
    // ficha, se barre la pantalla de confirmación; con la de la dirección
    // técnica, que no tiene, se barre el buscador. Son los dos estados que
    // puede enseñar la misma URL.
    ['/', '/estado', '/convocatorias', '/ranking', '/documentos', '/perfil', '/alta'],
  ],
  ['tutora', 'madre@demo.local', ['/', '/estado', '/perfil', '/alta']],
  ['seleccionador', 'seleccionador.florete@demo.local', ['/', '/tiradores', '/convocatorias']],
  [
    'admin',
    'direccion.tecnica@demo.local',
    [
      '/',
      '/estado',
      '/convocatorias',
      '/ranking',
      '/tiradores',
      '/admin',
      '/admin/inscripciones',
      '/admin/usuarios',
      '/admin/ajustes',
      '/admin/normativa',
      '/admin/cuarentena',
      '/admin/emparejar',
      '/admin/extraccion',
      '/alta',
    ],
  ],
];

type Cookie = ReturnType<typeof aCookie>;

function aCookie(cabecera: string) {
  const par = cabecera.split(';')[0];
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

async function sesion(email: string): Promise<Cookie[]> {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CONTRASENA }),
  });
  const cookies = (r.headers.getSetCookie?.() ?? []).map(aCookie);
  if (cookies.length === 0) {
    throw new Error(`Sin sesión para ${email} (HTTP ${r.status}). Se aborta.`);
  }
  return cookies;
}

const navegador = await chromium.launch();
let problemas = 0;

for (const [papel, email, rutas] of PAPELES) {
  // Una sola entrada por papel: Neon Auth responde 429 si se pide sesión en
  // cada pantalla.
  const cookies = await sesion(email);

  for (const [pantalla, cfg] of [
    ['móvil', devices['iPhone 14 Pro']],
    ['escritorio', { viewport: { width: 1440, height: 900 } }],
  ] as const) {
    const ctx = await navegador.newContext({ ...cfg, locale: 'es-ES' });
    await ctx.addCookies(cookies);
    const p = await ctx.newPage();

    for (const ruta of rutas) {
      const errores: string[] = [];
      const onError = (e: Error) => errores.push(e.message);
      const onConsole = (m: { type(): string; text(): string }) => {
        if (m.type() === 'error') errores.push(m.text());
      };
      p.on('pageerror', onError);
      p.on('console', onConsole);

      const res = await p.goto(`${BASE}${ruta}`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });
      await p.waitForTimeout(350);

      const m = await p.evaluate(() => ({
        desborda: document.documentElement.scrollWidth - window.innerWidth,
        cortados: [...document.querySelectorAll<HTMLElement>('*')].filter(
          (e) =>
            e.children.length === 0 &&
            e.scrollWidth > e.clientWidth + 1 &&
            getComputedStyle(e).overflowX !== 'auto' &&
            !/truncate|sr-only/.test(e.className.toString()),
        ).length,
      }));

      const enEntrar = new URL(p.url()).pathname.startsWith('/entrar');
      const estado = res?.status() ?? 0;
      const mal = enEntrar || m.desborda > 0 || estado >= 400 || errores.length > 0;
      if (mal) problemas += 1;

      console.log(
        `${mal ? '✗' : '·'} ${papel.padEnd(14)} ${pantalla.padEnd(11)} ` +
          `${ruta.padEnd(24)} ${estado} desborde ${String(m.desborda).padStart(3)}px ` +
          `cortados ${String(m.cortados).padStart(2)}` +
          (enEntrar ? '  ⚠ ACABÓ EN /entrar' : '') +
          (errores.length
            ? `\n    ${[...new Set(errores)].slice(0, 2).join(' | ').slice(0, 220)}`
            : ''),
      );

      p.off('pageerror', onError);
      p.off('console', onConsole);
    }

    await ctx.close();
  }
}

await navegador.close();
console.log(problemas === 0 ? '\nSin problemas.' : `\n${problemas} pantallas con algo.`);
if (problemas > 0) process.exitCode = 1;
