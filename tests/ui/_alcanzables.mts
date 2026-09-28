/**
 * EL CRITERIO DURO: ¿se puede ABRIR cada torneo del mes desde un móvil?
 *
 * Existe porque este fallo se nos escapó entero. En octubre, en un iPhone, la
 * rejilla pintaba **7 barras de 39** y el resto no estaba en ninguna parte: la
 * Copa del Mundo de Orán no tenía barra, y como la ficha solo se abre tocando
 * la barra, ese torneo **no se podía abrir desde un teléfono**. Y `npm run
 * barrido` daba el visto bueno, porque no había desborde ni texto cortado: es
 * un fallo de acceso al contenido y ninguna métrica de maquetación lo caza.
 *
 * Contar nodos tampoco basta —una tarjeta puede estar en el DOM y quedar
 * debajo de una barra fija—, así que aquí se **toca una por una** y se
 * comprueba que la hoja de la ficha se abre.
 *
 * Uso: npx tsx tests/ui/_alcanzables.mts
 */
import { chromium, devices } from 'playwright';
const BASE = 'http://localhost:3000';
const nav = await chromium.launch();
const ctx = await nav.newContext({ ...devices['iPhone 14 Pro'], locale: 'es-ES' });
const e = await ctx.newPage();
await e.goto(`${BASE}/probar/admin`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await e.close();
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
await p.waitForTimeout(3600);
await p.getByRole('button', { name: /^Siguiente$/i }).first().click();
await p.waitForTimeout(900);

const total = await p.locator('[data-agenda="tarjeta"]').count();
const esperados = Number(await p.locator('[data-torneos]').first().getAttribute('data-torneos'));
console.log(`octubre, iPhone: ${total} tarjetas para ${esperados} torneos`);

let abiertos = 0;
const fallos: string[] = [];
for (let i = 0; i < total; i += 1) {
  const t = p.locator('[data-agenda="tarjeta"]').nth(i);
  await t.scrollIntoViewIfNeeded();
  const nombre = (await t.locator('.line-clamp-2').first().innerText()).trim();
  await t.click();
  const hoja = p.locator('[data-slot="sheet-content"], [role="dialog"]').first();
  const ok = await hoja.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
  if (ok) abiertos += 1;
  else fallos.push(nombre);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(220);
}
console.log(`ABIERTOS ${abiertos} de ${total}`);
if (fallos.length) console.log('NO SE ABREN:', fallos.join(' | '));

const oran = p.locator('[data-agenda="tarjeta"]', { hasText: /Or[áa]n/i });
console.log(`tarjetas con «Orán»: ${await oran.count()}`);
await nav.close();
