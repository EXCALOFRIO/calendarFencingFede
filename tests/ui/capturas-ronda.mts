/**
 * Capturas a 360 px del Worker COMPILADO con D1/KV/R2 locales, reutilizando el
 * estado que prepara `tests/perf/red-lenta-local.mts` (copia del espejo).
 *
 *   PERF_MOVIL_DIR=<directorio con estado/> CAPTURAS_DIR=<salida> tsx tests/ui/capturas-ronda.mts
 *
 * Por cada pantalla guarda la captura y comprueba que no haya desborde
 * horizontal ni errores de JavaScript. Sesión QA sintética generada en memoria;
 * no carga .env ni llama a servicios reales.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium, type Page } from 'playwright';
import { unstable_dev } from 'wrangler';
import { ficheroD1 } from '../perf/d1-local.mts';
import { COOKIE_ACCESO_QA, firmarSesionQa } from '../../src/lib/auth/qa-token';

const REPO = resolve(import.meta.dirname, '../..');
const base = process.env.PERF_MOVIL_DIR;
const salida = process.env.CAPTURAS_DIR;
if (!base || !salida) throw new Error('faltan PERF_MOVIL_DIR y CAPTURAS_DIR');
const dir = resolve(base);
const paquete = resolve(process.env.PERF_PAQUETE ?? join(REPO, '.open-next'));
const estado = join(dir, 'estado');
const fichero = ficheroD1(estado);
if (!fichero) throw new Error('falta_estado_local: ejecuta antes tests/perf/red-lenta-local.mts');
if (!existsSync(join(paquete, 'worker.js'))) throw new Error('falta_cf_build');
mkdirSync(salida, { recursive: true });

const ADMIN = 'fc001000-0000-4000-8000-000000000001';
const sqlite = new DatabaseSync(fichero);
try {
  sqlite.prepare(`INSERT INTO user_profile (id, email, full_name, role, invite_status, ical_token)
    VALUES (?, 'medida-local@example.test', 'Medición local', 'admin', 'aceptada', ?)
    ON CONFLICT(id) DO NOTHING`).run(ADMIN, randomUUID());
} finally { sqlite.close(); }

const config = join(dir, 'worker-capturas.json');
const entradaLocal = join(dir, 'worker-capturas.mjs');
writeFileSync(entradaLocal, `
import app from ${JSON.stringify(join(paquete, 'worker.js').replaceAll('\\', '/'))};
const fetchLocal = globalThis.fetch;
globalThis.fetch = (entrada, opciones) => {
  const u = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return Promise.resolve(new Response(null, {status: 502}));
  return fetchLocal(entrada, opciones);
};
export default app;
`);
writeFileSync(config, JSON.stringify({
  name: 'calendario-capturas-local',
  main: entradaLocal,
  compatibility_date: '2026-09-15',
  compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
  d1_databases: [{ binding: 'DB', database_name: 'calendario-fie-fede-db', database_id: 'e1c28f19-278c-4d8f-9c7c-9b9d1c45653e', remote: false }],
  kv_namespaces: [{ binding: 'CACHE_DATOS', id: `cache-capturas-${randomUUID()}`, remote: false }],
  r2_buckets: [{ binding: 'ARCHIVOS', bucket_name: 'archivos-capturas-local', remote: false }],
  assets: { directory: join(paquete, 'assets'), binding: 'ASSETS' },
}, null, 2));
const ahora = Date.now();
const concesion = {
  version: 1, id: randomUUID(), adminProfileId: ADMIN,
  keyHash: randomBytes(32).toString('hex'), issuedAt: ahora - 1_000, expiresAt: ahora + 2 * 60 * 60 * 1_000 - 1_000,
};
const secretoLocal = randomBytes(32).toString('hex');
const sesion = firmarSesionQa({
  version: 1, grantId: concesion.id, adminProfileId: ADMIN, issuedAt: ahora, expiresAt: ahora + 30 * 60 * 1_000,
}, secretoLocal);
delete process.env.CLOUDFLARE_API_TOKEN;
const worker = await unstable_dev(entradaLocal, {
  config, envFiles: [process.platform === 'win32' ? 'NUL' : '/dev/null'],
  ip: '127.0.0.1', port: 8978, local: true, logLevel: 'error',
  persist: true, persistTo: estado,
  vars: {
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:8978',
    NEON_AUTH_COOKIE_SECRET: secretoLocal,
    ACCESO_QA_CONCESION: JSON.stringify(concesion),
    RESULTADOS_AUTO_ENABLED: 'false', AI_EXTRACTION_ENABLED: 'false',
    SPORT_INCREMENTAL_ENABLED: 'false', CACHE_API_COMPARTIDA: 'false',
    D1_STORAGE_BUDGET_BYTES: '8589934592',
  },
  experimental: { forceLocal: true, watch: false, disableDevRegistry: true, disableExperimentalWarning: true },
});
const origen = `http://127.0.0.1:${worker.port}`;
const PERSONA = '/explorar/b40372bf-0b56-4faf-a603-4e0b7f351739';

type Informe = { pantalla: string; url: string; desborde: number; errores: string[]; ok: boolean; nota?: string };
const informe: Informe[] = [];
const browser = await chromium.launch({ headless: true });

async function contexto(conSesion: boolean) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
  });
  if (conSesion) await context.addCookies([{ name: COOKIE_ACCESO_QA, value: sesion, url: origen, httpOnly: true, sameSite: 'Lax' }]);
  return context;
}

async function capturar(page: Page, pantalla: string, errores: string[], nota?: string) {
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => undefined);
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.waitForTimeout(600);
  const desborde = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
  // Pantalla visible, como la ve el usuario: con content-visibility, lo que
  // queda fuera no se pinta y una captura completa sale en blanco por abajo.
  await page.screenshot({ path: join(salida!, `${pantalla}.png`) });
  informe.push({ pantalla, url: page.url().replace(origen, ''), desborde, errores: [...errores], ok: desborde <= 1 && errores.length === 0, nota });
  errores.length = 0;
}

try {
  const context = await contexto(true);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(`${e.name}: ${e.message.slice(0, 160)}`));
  const ir = async (ruta: string, pantalla: string) => {
    await page.goto(`${origen}${ruta}`, { waitUntil: 'domcontentloaded' });
    await capturar(page, pantalla, errores);
  };

  await ir('/', '01-calendario');
  const tarjeta = page.locator('main a[href*="evento"], main button[aria-haspopup], main [data-tarjeta] a').first();
  if (await tarjeta.count()) {
    await tarjeta.tap().catch(() => undefined);
    await page.waitForTimeout(1_500);
    await capturar(page, '02-ficha-competicion', errores);
  }
  await ir('/explorar', '03-explorar-para-ti');
  await ir('/explorar/buscar?q=garcia', '04-explorar-tiradores');
  await ir('/explorar/ediciones?q=mundial', '05-explorar-torneos-mundial');
  const edicion = page.locator('a[href*="/explorar/ediciones/"]').first();
  if (await edicion.count()) {
    await edicion.tap();
    await page.waitForURL((u) => /^\/explorar\/ediciones\/[^/]+$/.test(u.pathname));
    await capturar(page, '06-competicion-selector', errores);
    const enlacePoules = page.locator('a[href*="vista=poules"], button:has-text("Poules")').first();
    if (await enlacePoules.count()) {
      await enlacePoules.tap();
      await page.waitForTimeout(2_500);
      await capturar(page, '07-competicion-poules', errores);
      const poule = page.locator('button[aria-expanded="false"]').first();
      if (await poule.count()) {
        await poule.tap();
        await page.waitForTimeout(900);
        await capturar(page, '08-poule-girada', errores);
      }
    }
  }
  await ir(PERSONA, '09-perfil');
  await ir(`${PERSONA}/estadisticas`, '10-perfil-estadisticas');
  await ir(`${PERSONA}/rivales`, '11-perfil-rivales');
  await ir(`${PERSONA}/cara-a-cara`, '12-cara-a-cara');
  await ir('/explorar/pais/ESP', '13-pais');
  await ir('/explorar/pais/ESP/contra/FRA', '14-selecciones-esp-fra');
  await ir('/ranking', '15-ranking');
  await ir('/explorar/yo', '16-tu');
  await ir('/notificaciones', '17-notificaciones');
  await ir('/estado', '18-como-voy');
  await context.close();

  const anonimo = await contexto(false);
  const acceso = await anonimo.newPage();
  const erroresAcceso: string[] = [];
  acceso.on('pageerror', (e) => erroresAcceso.push(`${e.name}: ${e.message.slice(0, 160)}`));
  await acceso.goto(`${origen}/entrar`, { waitUntil: 'domcontentloaded' });
  await capturar(acceso, '19-entrar', erroresAcceso);
  await anonimo.close();
} finally {
  await browser.close();
  await worker.stop();
}
writeFileSync(join(salida, 'informe.json'), JSON.stringify(informe, null, 2));
for (const i of informe) console.log(`${i.ok ? 'OK ' : 'MAL'} ${i.pantalla} desborde=${i.desborde} errores=${i.errores.length} ${i.url}`);
if (informe.some((i) => !i.ok)) process.exitCode = 1;
