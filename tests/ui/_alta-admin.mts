/**
 * El alta de un tirador desde el ranking, mirada de verdad.
 *
 * Se crea una cuenta de administración de usar y tirar (`@pruebas.local`,
 * como las del resto de las pruebas), se busca a alguien en la clasificación
 * oficial, se mira lo que sale y se borra la cuenta. No deja nada detrás.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const CORREO = 'e2e-alta-admin@pruebas.local';
const CONTRASENA = 'Demo-2026-Esgrima!';

const sql = neon(process.env.DATABASE_URL!);

await sql`insert into user_profile (email, full_name, role, ical_token, invite_status)
  values (${CORREO}, 'Prueba alta admin', 'admin', ${'tk' + Math.random().toString(36).slice(2)}, 'aceptada')
  on conflict (email) do nothing`;

await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: CORREO, password: CONTRASENA, name: 'Prueba' }),
}).catch(() => null);

const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: CORREO, password: CONTRASENA }),
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

if (cookies.length === 0) throw new Error(`Sin sesión (HTTP ${r.status})`);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies(cookies);
const p = await ctx.newPage();
p.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLA>', m.text().slice(0, 300));
});

await p.goto(`${BASE}/admin/usuarios`, { waitUntil: 'networkidle', timeout: 60_000 });
await p.screenshot({ path: 'capturas/alta-admin-1-vacio.png', fullPage: true });

await p.getByLabel(/Nombre o apellidos/i).fill('zabala');
await p.getByRole('button', { name: /^Buscar$/ }).click();
await p.waitForTimeout(2500);
await p.screenshot({ path: 'capturas/alta-admin-2-candidatos.png', fullPage: true });

const botones = p.getByRole('button', { name: /^Es este$/ });
console.log('candidatos con botón:', await botones.count());
if ((await botones.count()) > 0) {
  await botones.first().click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'capturas/alta-admin-3-elegido.png', fullPage: true });
}

const desborde = await p.evaluate(
  () => document.documentElement.scrollWidth - window.innerWidth,
);
console.log('desborde horizontal:', desborde, 'px');

// Y el móvil, que es donde se estrecha.
const movil = await b.newContext({
  viewport: { width: 393, height: 852 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});
await movil.addCookies(cookies);
const m = await movil.newPage();
await m.goto(`${BASE}/admin/usuarios`, { waitUntil: 'networkidle', timeout: 60_000 });
await m.getByLabel(/Nombre o apellidos/i).fill('zabala');
await m.getByRole('button', { name: /^Buscar$/ }).click();
await m.waitForTimeout(2500);
await m.screenshot({ path: 'capturas/alta-admin-4-movil.png', fullPage: true });
console.log(
  'desborde móvil:',
  await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  'px',
);

await b.close();

await sql`delete from neon_auth."session" where "userId" in
  (select id from neon_auth."user" where email = ${CORREO})`;
await sql`delete from neon_auth."account" where "userId" in
  (select id from neon_auth."user" where email = ${CORREO})`;
await sql`delete from neon_auth."user" where email = ${CORREO}`;
await sql`delete from user_profile where email = ${CORREO}`;
console.log('cuenta de prueba borrada');
