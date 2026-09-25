import 'dotenv/config';
import type { BrowserContext, ConsoleMessage, Page } from 'playwright';

/**
 * Andamiaje mínimo de las pruebas de extremo a extremo.
 *
 * No se usa `@playwright/test` porque el proyecto solo tiene `playwright`
 * instalado (la librería, no el corredor) y no se pueden añadir dependencias.
 * Con un `comprobar()` y un `caso()` basta: lo que importa aquí es ejecutar los
 * flujos contra el servidor de verdad, no el corredor.
 */

export type Resultado = {
  nombre: string;
  ok: boolean;
  error?: string;
  notas: string[];
};

export const resultados: Resultado[] = [];

let actual: Resultado | null = null;

export function nota(texto: string): void {
  if (actual) actual.notas.push(texto);
  console.log(`      · ${texto}`);
}

export class FalloDeComprobacion extends Error {}

export function comprobar(condicion: unknown, mensaje: string): asserts condicion {
  if (!condicion) throw new FalloDeComprobacion(mensaje);
}

export function comprobarIgual<T>(real: T, esperado: T, mensaje: string): void {
  if (real !== esperado) {
    throw new FalloDeComprobacion(`${mensaje} (esperado ${String(esperado)}, real ${String(real)})`);
  }
}

export async function caso(nombre: string, fn: () => Promise<void>): Promise<void> {
  const r: Resultado = { nombre, ok: true, notas: [] };
  actual = r;
  resultados.push(r);
  console.log(`\n▶ ${nombre}`);
  try {
    await fn();
    console.log(`  ✅ ${nombre}`);
  } catch (e) {
    r.ok = false;
    r.error = e instanceof Error ? `${e.message}` : String(e);
    console.log(`  ❌ ${nombre}\n     ${r.error}`);
  } finally {
    actual = null;
  }
}

export function resumen(): number {
  const fallos = resultados.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(72));
  console.log(`RESUMEN: ${resultados.length - fallos.length}/${resultados.length} casos correctos`);
  for (const f of fallos) console.log(`  ❌ ${f.nombre}\n     ${f.error}`);
  console.log('='.repeat(72));
  return fallos.length;
}

// ---------------------------------------------------------------------------
// Captura de errores del navegador
// ---------------------------------------------------------------------------

export type ErrorDeNavegador = { tipo: 'pageerror' | 'console'; texto: string; url: string };

/**
 * Ruido conocido del modo desarrollo que no es un fallo de la aplicación.
 * Se filtra por texto exacto y no por "contiene error" para no tapar nada real.
 */
const RUIDO = [
  'Download the React DevTools',
  'Failed to load resource: the server responded with a status of 404 (Not Found)/favicon',
  '[Fast Refresh]',
  'react-devtools',
];

export function vigilarErrores(page: Page): ErrorDeNavegador[] {
  const errores: ErrorDeNavegador[] = [];

  page.on('pageerror', (e) => {
    errores.push({ tipo: 'pageerror', texto: `${e.name}: ${e.message}`, url: page.url() });
  });

  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return;
    const texto = m.text();
    if (RUIDO.some((r) => texto.includes(r))) return;
    errores.push({ tipo: 'console', texto, url: page.url() });
  });

  return errores;
}

/** Vacía el acumulador y devuelve lo que había. */
export function recoger(errores: ErrorDeNavegador[]): ErrorDeNavegador[] {
  return errores.splice(0, errores.length);
}

/**
 * Navega y espera a que la página esté HIDRATADA.
 *
 * Con `domcontentloaded` no basta: en desarrollo el bundle tarda en llegar y
 * un clic sobre un botón todavía sin hidratar no hace nada, lo que se
 * confunde con un fallo de la aplicación. También es el momento en que
 * aparecen los errores de hidratación, así que hay que esperar aquí para
 * poder capturarlos.
 */
export async function ir(page: Page, url: string) {
  const res = await page.goto(url, { waitUntil: 'load', timeout: 180_000 });
  await page
    .waitForFunction(() => Boolean((window as unknown as { next?: unknown }).next), null, {
      timeout: 30_000,
    })
    .catch(() => null);
  await page.waitForTimeout(1500);
  return res;
}

/** Repite `accion` hasta que `listo` devuelva true. Para la hidratación tardía. */
export async function reintentar(
  accion: () => Promise<void>,
  listo: () => Promise<boolean>,
  intentos = 6,
  espera = 1500,
): Promise<boolean> {
  for (let i = 0; i < intentos; i += 1) {
    await accion().catch(() => null);
    await new Promise((r) => setTimeout(r, espera));
    if (await listo().catch(() => false)) return true;
  }
  return false;
}

/** Texto visible de la página, normalizado para poder buscar frases. */
export async function textoDe(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

/**
 * Rutas de página que tiene la aplicación, leídas del sistema de ficheros.
 *
 * Se descubren en vez de escribirlas a mano para que la lista no se quede
 * vieja en cuanto alguien añada, mueva o quite una pantalla: es justo lo que
 * haría `next build` al listar las rutas.
 */
export async function rutasDePagina(raiz: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const { join, relative, sep } = await import('node:path');

  const encontradas: string[] = [];

  async function recorrer(dir: string) {
    const entradas = await readdir(dir, { withFileTypes: true });
    for (const e of entradas) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) {
        await recorrer(ruta);
      } else if (e.name === 'page.tsx' || e.name === 'page.ts') {
        const rel = relative(raiz, dir).split(sep);
        // Los grupos `(app)` no aparecen en la URL; los tramos dinámicos
        // `[id]` se devuelven tal cual para que quien llame los rellene.
        const tramos = rel.filter((t) => t !== '' && !t.startsWith('('));
        encontradas.push('/' + tramos.join('/'));
      }
    }
  }

  await recorrer(raiz);
  return [...new Set(encontradas)].sort();
}

export async function nuevaSesion(
  context: BrowserContext,
): Promise<{ page: Page; errores: ErrorDeNavegador[] }> {
  const page = await context.newPage();
  const errores = vigilarErrores(page);
  return { page, errores };
}
