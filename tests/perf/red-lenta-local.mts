/**
 * Navegador real contra el Worker COMPILADO, con D1/KV/R2 exclusivamente locales.
 * No carga .env, no usa cuentas ni cookies reales y no llama a Neon Auth.
 *
 * PERF_ORIGINAL=<espejo.sqlite> PERF_MOVIL_DIR=<directorio nuevo>
 *   tsx tests/perf/red-lenta-local.mts antes [normal|limitada] [repeticiones]
 *
 * Se reutiliza la MISMA copia entre antes/después. El original nunca se abre en
 * escritura. Las credenciales de QA se generan en memoria para esta instancia
 * local y se pierden al terminar. No se guardan HAR, HTML ni datos personales.
 * Hay que compilar de nuevo antes de medir «despues», con el Worker detenido.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium, type Page } from 'playwright';
import { unstable_dev } from 'wrangler';
import { abrirD1Local, ficheroD1 } from './d1-local.mts';
import { prepararEsquema } from './preparar-copia.mts';
import { COOKIE_ACCESO_QA, firmarSesionQa } from '../../src/lib/auth/qa-token';

const REPO = resolve(import.meta.dirname, '../..');
const fase = process.argv[2] ?? 'antes';
const red = process.argv[3] ?? 'normal';
const repeticiones = Number(process.argv[4] ?? 3);
if (!['antes', 'despues'].includes(fase) || !['normal', 'limitada'].includes(red) ||
    !Number.isInteger(repeticiones) || repeticiones < 1 || repeticiones > 5) {
  throw new Error('uso: red-lenta-local.mts antes|despues normal|limitada [1..5]');
}
const base = process.env.PERF_MOVIL_DIR;
if (!base || !process.env.PERF_ORIGINAL) throw new Error('faltan PERF_MOVIL_DIR y PERF_ORIGINAL');
const dir = resolve(base);
const original = resolve(process.env.PERF_ORIGINAL);
const paquete = resolve(process.env.PERF_PAQUETE ?? join(REPO, '.open-next'));
if (!existsSync(original)) throw new Error('espejo_original_no_disponible');
if (!existsSync(join(paquete, 'worker.js'))) throw new Error('falta_cf_build');
mkdirSync(dir, { recursive: true });
const marcador = join(dir, 'solo-benchmark-local.json');
if (!existsSync(marcador)) writeFileSync(marcador, JSON.stringify({ version: 1, original }));
else if (JSON.parse(readFileSync(marcador, 'utf8')).original !== original) throw new Error('otro_espejo_en_el_directorio');
const estado = join(dir, 'estado');
let fichero = ficheroD1(estado);
if (!fichero) {
  const libre = statfsSync(dir);
  if (libre.bavail * libre.bsize < 4 * 1024 ** 3) throw new Error('menos_de_4_GiB_libres');
  const copia = join(dir, 'copia-movil.sqlite');
  if (existsSync(copia)) throw new Error('copia_temporal_ya_existe');
  console.log('Preparando copia local de medición, sin modificar el espejo.');
  copyFileSync(original, copia);
  const sqlite = new DatabaseSync(copia);
  try {
    sqlite.exec('PRAGMA cache_size=-131072; PRAGMA temp_store=MEMORY');
    prepararEsquema(sqlite);
    for (const archivo of ['0014_notificaciones.sql', '0015_indices_rendimiento.sql', '0017_resultados_automaticos.sql', '0020_quitar_indices_duplicados.sql']) {
      sqlite.exec(readFileSync(join(REPO, 'drizzle-d1', archivo), 'utf8'));
    }
  } finally { sqlite.close(); }
  const local = await abrirD1Local(estado, copia);
  fichero = local.fichero;
  await local.cerrar();
}

// Una cuenta sintética, sin vínculo a fichas reales, sólo en la copia desechable.
const ADMIN = 'fc001000-0000-4000-8000-000000000001';
const sqlite = new DatabaseSync(fichero);
try {
  sqlite.prepare(`INSERT INTO user_profile (id, email, full_name, role, invite_status, ical_token)
    VALUES (?, 'medida-local@example.test', 'Medición local', 'admin', 'aceptada', ?)
    ON CONFLICT(id) DO NOTHING`).run(ADMIN, randomUUID());
} finally { sqlite.close(); }

// Configuración NUEVA, nunca la de producción. Sin AI, IMAGES ni servicios remotos.
const config = join(dir, 'worker-local.json');
const entradaLocal = join(dir, 'worker-local.mjs');
// Sin peticiones del servidor a servicios reales (fotos, Neon, correo o IA).
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
  name: 'calendario-medicion-local',
  main: entradaLocal,
  compatibility_date: '2026-09-15',
  compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
  d1_databases: [{ binding: 'DB', database_name: 'calendario-fie-fede-db', database_id: 'e1c28f19-278c-4d8f-9c7c-9b9d1c45653e', remote: false }],
  kv_namespaces: [{ binding: 'CACHE_DATOS', id: `cache-medicion-${randomUUID()}`, remote: false }],
  r2_buckets: [{ binding: 'ARCHIVOS', bucket_name: 'archivos-medicion-local', remote: false }],
  assets: { directory: join(paquete, 'assets'), binding: 'ASSETS' },
}, null, 2));
const ahora = Date.now();
const concesion = {
  version: 1, id: randomUUID(), adminProfileId: ADMIN,
  keyHash: randomBytes(32).toString('hex'), issuedAt: ahora - 1_000, expiresAt: ahora + 2 * 60 * 60 * 1_000 - 1_000,
};
const secretoLocal = randomBytes(32).toString('hex');
const sesion = firmarSesionQa({
  version: 1, grantId: concesion.id, adminProfileId: ADMIN,
  issuedAt: ahora, expiresAt: ahora + 30 * 60 * 1_000,
}, secretoLocal);
// No se heredan credenciales de Cloudflare ni un archivo .env del repositorio.
delete process.env.CLOUDFLARE_API_TOKEN;
const worker = await unstable_dev(entradaLocal, {
  config, envFiles: [process.platform === 'win32' ? 'NUL' : '/dev/null'],
  ip: '127.0.0.1', port: 8977, local: true, logLevel: 'error',
  // Wrangler añade /v3; getPlatformProxy recibió esa subcarpeta directamente.
  persist: true, persistTo: estado,
  vars: {
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:8977',
    NEON_AUTH_COOKIE_SECRET: secretoLocal,
    ACCESO_QA_CONCESION: JSON.stringify(concesion),
    RESULTADOS_AUTO_ENABLED: 'false', AI_EXTRACTION_ENABLED: 'false',
    SPORT_INCREMENTAL_ENABLED: 'false', CACHE_API_COMPARTIDA: 'false',
    D1_STORAGE_BUDGET_BYTES: '8589934592',
  },
  experimental: { forceLocal: true, watch: false, disableDevRegistry: true, disableExperimentalWarning: true },
});
const origen = `http://127.0.0.1:${worker.port}`;
if (new URL(origen).hostname !== '127.0.0.1') throw new Error('benchmark_solo_loopback');
const browser = await chromium.launch({ headless: true });
const estaticos = new Set(readdirSync(join(paquete, 'assets'), { recursive: true })
  .map((p) => `/${String(p).replaceAll('\\', '/')}`));
const perfil = red === 'normal'
  ? { cpu: 4, latencia: 150, descarga: 1_600_000 / 8, subida: 750_000 / 8, saveData: false }
  : { cpu: 6, latencia: 400, descarga: 400_000 / 8, subida: 200_000 / 8, saveData: true };
type Metrica = {
  operacion: string; repeticion: number; ms: number;
  peticiones: number; dinamicas: number; bytes: number; fallidas: number;
  fcp: number | null; lcp: number | null; cls: number; longTasks: number; bloqueoMs: number;
  desglose?: Record<string, number>;
};
const resultados: Metrica[] = [];
const errores: string[] = [];
const comprobaciones: { repeticion: number; sinDesborde: boolean; barraFija: boolean; raizSinNuevaEntrada: boolean }[] = [];
const LLAVADOR = '/explorar/b40372bf-0b56-4faf-a603-4e0b7f351739';
const compilacion = process.env.PERF_COMPILACION ??
  (paquete === join(REPO, '.open-next') ? readFileSync(join(REPO, '.next/BUILD_ID'), 'utf8').trim() : 'paquete-anterior-conservado');
const etiqueta = process.env.PERF_ETIQUETA ?? fase;
if (!/^[a-z0-9-]+$/.test(etiqueta)) throw new Error('etiqueta_de_informe_invalida');
const guardar = (completo: boolean) => writeFileSync(join(dir, `${etiqueta}-${red}.json`), JSON.stringify({
  fase, compilacion, red: perfil, repeticiones, completo, errores, resultados, comprobaciones,
}, null, 2));

try {
  for (let repeticion = 1; repeticion <= repeticiones; repeticion += 1) {
    const context = await browser.newContext({
      viewport: { width: 360, height: 780 }, deviceScaleFactor: 1,
      isMobile: true, hasTouch: true, serviceWorkers: 'block',
      extraHTTPHeaders: perfil.saveData ? { 'Save-Data': 'on' } : {},
    });
    await context.addCookies([{ name: COOKIE_ACCESO_QA, value: sesion, url: origen, httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript(({ saveData }) => {
      try {
        Object.defineProperty(navigator, 'connection', { configurable: true, value: {
          saveData, effectiveType: saveData ? '2g' : '4g', downlink: saveData ? 0.4 : 1.6, rtt: saveData ? 400 : 150,
          addEventListener() {}, removeEventListener() {},
        } });
      } catch { /* un navegador sin NetworkInformation conserva el comportamiento por defecto */ }
      const s = { fcp: null as number | null, lcp: null as number | null, cls: 0, longTasks: 0, bloqueoMs: 0 };
      Object.assign(window, { __medidaMovil: s });
      for (const tipo of ['paint', 'largest-contentful-paint', 'layout-shift', 'longtask']) {
        try {
          new PerformanceObserver((lista) => {
            for (const e of lista.getEntries()) {
              if (tipo === 'paint' && e.name === 'first-contentful-paint') s.fcp = e.startTime;
              if (tipo === 'largest-contentful-paint') s.lcp = e.startTime;
              if (tipo === 'layout-shift' && !(e as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput) {
                s.cls += (e as PerformanceEntry & { value: number }).value;
              }
              if (tipo === 'longtask') { s.longTasks += 1; s.bloqueoMs += Math.max(0, e.duration - 50); }
            }
          }).observe({ type: tipo, buffered: true });
        } catch { /* métrica no implementada por esta versión */ }
      }
    }, { saveData: perfil.saveData });
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    page.on('pageerror', (e) => errores.push(e.name)); // Nunca texto con SQL ni datos de sesión.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    // No usar context.route(): Playwright desactiva la caché HTTP al interceptar.
    // La app local usa HTTP; todos sus recursos externos se publican con HTTPS.
    await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: perfil.latencia, downloadThroughput: perfil.descarga, uploadThroughput: perfil.subida,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: perfil.cpu });
    let cuentas = { peticiones: 0, dinamicas: 0, bytes: 0, fallidas: 0, desglose: {} as Record<string, number> };
    cdp.on('Network.requestWillBeSent', (e) => {
      if (!e.request.url.startsWith(origen)) return;
      cuentas.peticiones += 1;
      const u = new URL(e.request.url);
      const estatica = estaticos.has(decodeURIComponent(u.pathname));
      if (!estatica) cuentas.dinamicas += 1;
      const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]));
      const tipo = estatica ? `estatico:${e.type}` : h['next-router-prefetch'] ? 'precarga' : u.searchParams.has('_rsc') ? 'rsc' : e.request.method;
      const ruta = estatica ? '' : u.pathname.replace(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/gi, '[id]');
      const clave = `${tipo} ${ruta}`.trim();
      cuentas.desglose[clave] = (cuentas.desglose[clave] ?? 0) + 1;
    });
    cdp.on('Network.loadingFinished', (e) => { cuentas.bytes += e.encodedDataLength; });
    cdp.on('Network.loadingFailed', () => { cuentas.fallidas += 1; });
    const medir = async (operacion: string, accion: () => Promise<unknown>, lista?: (page: Page) => Promise<unknown>) => {
      const inicial = await page.evaluate(() => (window as unknown as { __medidaMovil?: Metrica }).__medidaMovil).catch(() => undefined);
      cuentas = { peticiones: 0, dinamicas: 0, bytes: 0, fallidas: 0, desglose: {} };
      const t = performance.now();
      const respuesta = await accion();
      if (respuesta && typeof respuesta === 'object' && 'status' in respuesta &&
          typeof respuesta.status === 'function' && respuesta.status() >= 400) {
        throw new Error(`respuesta_local_${respuesta.status()}`);
      }
      await page.locator('main').waitFor({ state: 'visible' });
      if (lista) await lista(page);
      // Dos frames aseguran que no medimos sólo el cambio de URL, antes de pintar.
      await page.evaluate(() => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))));
      const ms = performance.now() - t;
      // Ventana fija de observación para fotos/precargas: igual en las dos versiones.
      await page.waitForTimeout(1_200);
      const vitals = await page.evaluate(() => (window as unknown as { __medidaMovil: Metrica }).__medidaMovil);
      if (new URL(page.url()).pathname === '/entrar') throw new Error('sesion_local_no_funciona');
      resultados.push({
        operacion, repeticion, ms: Math.round(ms), ...cuentas,
        fcp: vitals.fcp, lcp: vitals.lcp, cls: vitals.cls,
        longTasks: Math.max(0, vitals.longTasks - (operacion.includes('recarga') ? 0 : inicial?.longTasks ?? 0)),
        bloqueoMs: Math.max(0, vitals.bloqueoMs - (operacion.includes('recarga') ? 0 : inicial?.bloqueoMs ?? 0)),
      });
      console.log(`${red} ${repeticion} ${operacion}: ${Math.round(ms)} ms, ${cuentas.peticiones} peticiones, ${Math.round(cuentas.bytes / 1024)} KiB`);
      guardar(false);
    };
    try {
      await medir('buscar-competiciones-carga', () => page.goto(`${origen}/explorar/ediciones`, { waitUntil: 'domcontentloaded' }));
      const campo = page.locator('input[type="search"]').first();
      await page.waitForFunction(() => {
        const input = document.querySelector('input[type="search"]');
        return input && Object.keys(input).some((k) => k.startsWith('__reactProps$'));
      });
      await medir('buscar-mndial', () => campo.fill('mndial'), async () => {
        await page.waitForURL((u) => u.searchParams.get('q') === 'mndial');
        await page.locator('a[href*="/explorar/ediciones/"]').first().waitFor({ state: 'visible' });
      });
      await medir('competicion-navegar', () => page.locator('a[href*="/explorar/ediciones/"]').first().tap(), async () => {
        await page.waitForURL((u) => /^\/explorar\/ediciones\/[^/]+$/.test(u.pathname));
        await page.locator('h1').first().waitFor({ state: 'visible' });
      });
      await medir('perfil-carga', () => page.goto(`${origen}${LLAVADOR}`, { waitUntil: 'domcontentloaded' }));
      await medir('perfil-estadisticas', () => page.locator(`a[href="${LLAVADOR}/estadisticas"]`).first().tap(), async () => {
        await page.waitForURL('**/estadisticas');
        await page.locator('a[data-seccion="estadisticas"][aria-current="page"]').waitFor({ state: 'visible' });
      });
      await medir('perfil-recarga', () => page.reload({ waitUntil: 'domcontentloaded' }));
      await medir('perfil-atras', () => page.goBack({ waitUntil: 'domcontentloaded' }), async () => {
        await page.waitForURL((u) => u.pathname === LLAVADOR);
      });
      const sinDesborde = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
      const barra = page.locator('nav[data-barra="app"]');
      const posicion = await barra.boundingBox();
      await page.evaluate(() => scrollTo(0, 600));
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      const desplazada = await barra.boundingBox();
      const barraFija = Boolean(posicion && desplazada && Math.abs(posicion.y - desplazada.y) < 1);
      if (fase === 'despues' && repeticion === 1) await page.screenshot({ path: join(dir, `perfil-${red}.png`) });
      const longitud = await page.evaluate(() => history.length);
      await barra.locator('a[aria-current="page"]').tap();
      await page.waitForURL((u) => u.pathname !== LLAVADOR);
      const raizSinNuevaEntrada = await page.evaluate((antes) => history.length <= antes, longitud);
      comprobaciones.push({ repeticion, sinDesborde, barraFija, raizSinNuevaEntrada });
      if (!sinDesborde || !barraFija || !raizSinNuevaEntrada) throw new Error('regresion_visual_o_navegacion');
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await worker.stop();
}
guardar(errores.length === 0 && resultados.length === repeticiones * 7);
if (errores.length) throw new Error('errores_de_navegador_en_la_medicion');
console.log(`Mediciones locales guardadas en ${dir}; no son un ensayo de capacidad de producción.`);
