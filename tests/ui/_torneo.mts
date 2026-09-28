import { chromium, devices } from 'playwright';

/**
 * Abre la ficha de UN torneo concreto y la captura, en escritorio y en móvil.
 *
 *   PATRON="Copa Mundo Orán" NOMBRE=oran npx tsx tests/ui/_torneo.mts
 *   PATRON="TNR M17" AVANZAR=1 NOMBRE=tnr npx tsx tests/ui/_torneo.mts
 *
 * Existe porque `npm run ficha` abre «la primera barra» o la que resalta el
 * buscador, y con eso no se puede volver sobre un torneo concreto: buscando
 * «COPA MUNDO» el resaltado se lo llevaba la Copa del Mundo Cadete de Hong
 * Kong y la de Orán no se veía nunca. Aquí la barra se elige por su texto.
 *
 * `EXCLUIR` quita las variantes que estorban: en Orán hay tres torneos el mismo
 * mes (absoluto, cadete y júnior) y el que interesa es el que NO es ninguno de
 * los otros dos.
 *
 * Variables: `PATRON` (obligatoria), `EXCLUIR`, `AVANZAR`, `NOMBRE`, `ESPERA`.
 */

const BASE = process.env.BASE ?? 'http://localhost:3000';
const PATRON = new RegExp(process.env.PATRON ?? '.', 'i');
const EXCLUIR = process.env.EXCLUIR ? new RegExp(process.env.EXCLUIR, 'i') : null;
const AVANZAR = Number(process.env.AVANZAR ?? 1);
const NOMBRE = process.env.NOMBRE ?? 'torneo';
/**
 * Nueve segundos, y no es generosidad. Lo extraído de los PDFs no viene con la
 * ficha: lo pide una acción de servidor al abrirla (`useConDatosDeLosPdfs`), y
 * esa acción se traga sus propios errores para no tumbar la ficha. Con 3.000 ms
 * la captura salía con «La organización internacional no publica el pabellón»
 * y parecía que el dato no había llegado, cuando solo no había llegado TODAVÍA.
 */
const ESPERA = Number(process.env.ESPERA ?? 9000);

const entrada = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: process.env.EMAIL ?? 'tiradora@demo.local',
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
  ['escritorio', { viewport: { width: 1440, height: 1200 } }],
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
   * En móvil el mes no se pinta entero: hay que desplazarse para que existan
   * las barras de la segunda mitad. Se baja hasta el final antes de buscar.
   */
  await p.mouse.wheel(0, 3000);
  await p.waitForTimeout(600);

  const barras = p.locator('[data-barra="torneo"]');
  const buscar = async () => {
    const total = await barras.count();
    for (let i = 0; i < total; i += 1) {
      const texto = (await barras.nth(i).innerText()).replace(/\s+/g, ' ');
      if (!PATRON.test(texto)) continue;
      if (EXCLUIR?.test(texto)) continue;
      return { diana: i, total };
    }
    return { diana: -1, total };
  };

  let { diana, total } = await buscar();

  /**
   * EN MÓVIL LAS BARRAS NO ESTÁN TODAS. El mes de octubre pinta 39 barras en
   * escritorio y 7 en un iPhone, porque la rejilla reparte el alto por día y en
   * 393 px no caben: los días llenos resumen en «+8 torneos». Así que buscar
   * por texto no basta y hace falta la paleta del buscador, que lleva al mes
   * del torneo y RESALTA su barra (ver `vista.tsx`).
   */
  if (diana < 0) {
    await p.getByRole('button', { name: /Buscar un torneo o una sede/i }).click();
    await p.waitForTimeout(400);
    // `BUSCAR` es una variable aparte de `PATRON`: en la paleta se escribe lo
    // que el buscador entiende —una ciudad, «Orán»— y no la expresión con la
    // que después se filtra el rótulo de la barra.
    await p.getByRole('combobox').fill(process.env.BUSCAR ?? process.env.PATRON ?? '');
    await p.waitForTimeout(700);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1200);
    const resaltadas = p.locator('[data-barra="torneo"].ring-foreground');
    if ((await resaltadas.count()) > 0) {
      const rotulo = (await resaltadas.first().innerText()).replace(/\s+/g, ' ');
      await resaltadas.first().click({ force: true });
      await p.waitForTimeout(ESPERA);
      await p.screenshot({ path: `capturas/${NOMBRE}-${vista}.png` });
      await p.mouse.wheel(0, 5000);
      await p.waitForTimeout(1200);
      await p.screenshot({ path: `capturas/${NOMBRE}-${vista}-fin.png` });
      console.log(
        `${vista.padEnd(11)} por buscador · «${rotulo}» · errores ${errores.length}`,
      );
      for (const e of errores.slice(0, 6)) console.log(`   ${e}`);
      await contexto.close();
      continue;
    }
    throw new Error(`No hay barra que case con ${PATRON} entre las ${total} de ${vista}.`);
  }
  const rotulo = (await barras.nth(diana).innerText()).replace(/\s+/g, ' ');
  await barras.nth(diana).click({ force: true });
  await p.waitForTimeout(ESPERA);

  await p.screenshot({ path: `capturas/${NOMBRE}-${vista}.png` });
  await p.mouse.wheel(0, 5000);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `capturas/${NOMBRE}-${vista}-fin.png` });

  console.log(
    `${vista.padEnd(11)} barra ${diana}/${total} · «${rotulo}» · errores ${errores.length}`,
  );
  for (const e of errores.slice(0, 6)) console.log(`   ${e}`);
  await contexto.close();
}

await navegador.close();
