import { chromium, devices } from 'playwright';

/**
 * Captura de la ficha de un torneo, que es la pantalla que más se abre
 * después del calendario y la única que no se ve con `npm run mirar`,
 * porque hay que tocar una barra para que aparezca.
 *
 *   npm run ficha
 *
 * Variables:
 *   `EMAIL`    quién mira. Por defecto la tiradora de demostración.
 *   `BUSCAR`   texto que se escribe en el buscador del calendario.
 *   `AVANZAR`  cuántos meses se adelanta antes de abrir nada.
 *   `NOMBRE`   sufijo del fichero, para no pisar la captura anterior.
 *              `capturas/ficha-<NOMBRE>-iphone.png`.
 */

const BASE = process.env.BASE ?? 'http://localhost:3000';
const EMAIL = process.env.EMAIL ?? 'tiradora@demo.local';
const CONTRASENA = process.env.CONTRASENA ?? 'Demo-2026-Esgrima!';

const entrada = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: CONTRASENA }),
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

if (cookies.length === 0) {
  throw new Error(
    `No se pudo entrar como ${EMAIL} (HTTP ${entrada.status}). Sin sesión, la ` +
      'captura sería de la pantalla de acceso, así que se aborta.',
  );
}

const navegador = await chromium.launch();

for (const [nombre, config] of [
  ['escritorio', { viewport: { width: 1440, height: 900 } }],
  ['iphone', devices['iPhone 14 Pro']],
] as const) {
  const contexto = await navegador.newContext({ ...config, locale: 'es-ES' });
  await contexto.addCookies(cookies);
  const pagina = await contexto.newPage();

  const errores: string[] = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => m.type() === 'error' && errores.push(m.text()));

  await pagina.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 });
  if (new URL(pagina.url()).pathname.startsWith('/entrar')) {
    throw new Error('Acabó en /entrar: la sesión no se aplicó.');
  }

  /**
   * Se abren TODAS las armas para que haya torneos de sobra que abrir.
   *
   * «Ver todo» ya no está a la vista: vive dentro del panel de filtros, que
   * es un `Popover` (los filtros se tocan una vez y se dejan puestos, así que
   * no merecen tres renglones de la pantalla). Hay que abrirlo, pulsar y
   * cerrarlo con Escape; si se deja abierto, tapa la rejilla en la captura.
   */
  await pagina
    .getByRole('button', { name: /Filtros del calendario/i })
    .click()
    .catch(() => {});
  await pagina.waitForTimeout(300);
  await pagina
    .getByRole('button', { name: /^Ver todo$/ })
    .click()
    .catch(() => {});
  await pagina.keyboard.press('Escape');
  await pagina.waitForTimeout(400);

  /**
   * El buscador ya no esconde nada: lleva al mes del torneo y lo resalta
   * (ver `vista.tsx`). Así que escribir no basta: hay que abrir la barra
   * RESALTADA.
   *
   * Y el campo de la cabecera ya no existe: es un icono que abre una paleta
   * (`Command`), porque medía media anchura y estaba vacío el 99 % del
   * tiempo. Aquí se abre la paleta, se escribe, se elige la primera
   * coincidencia y la paleta se cierra sola.
   */
  const buscar = process.env.BUSCAR;
  if (buscar) {
    await pagina.getByRole('button', { name: /Buscar un torneo o una sede/i }).click();
    await pagina.waitForTimeout(300);
    await pagina.getByRole('combobox').fill(buscar);
    await pagina.waitForTimeout(500);
    await pagina.keyboard.press('Enter');
    await pagina.waitForTimeout(700);
  }

  /**
   * `AVANZAR=1` pasa al mes siguiente antes de abrir nada.
   *
   * Hace falta para ver el plazo ABIERTO: el calendario arranca en el mes en
   * curso y a estas alturas de septiembre sus torneos ya tienen la inscripción
   * cerrada, así que la barra de plazos salía entera en gris y no se podía
   * juzgar. Los tramos con color viven un mes más adelante.
   */
  const avanzar = Number(process.env.AVANZAR ?? 0);
  for (let i = 0; i < avanzar; i += 1) {
    await pagina.getByRole('button', { name: /^Siguiente$/i }).click();
    await pagina.waitForTimeout(600);
  }

  /**
   * DE DÓNDE SE ABRE LA FICHA: BARRA EN ESCRITORIO, TARJETA EN MÓVIL.
   *
   * Este guion buscaba solo `[data-barra="torneo"]` y desde el rediseño del
   * calendario **no encontraba ninguna en el móvil**: por debajo de `sm` la
   * rejilla de siete columnas va `hidden sm:flex` y lo que se pinta es la
   * agenda (`agenda-mes.tsx`), donde cada competición es una tarjeta a ancho
   * completo. El guion moría con «No hay ninguna barra en el calendario» y
   * dejaba de capturar la mitad de los casos, que es justo la mitad que
   * importa: esto es lo único que abre la hoja lateral y es lo que cazó un 500
   * que ni el compilador ni el barrido veían.
   *
   * Se buscan las dos cosas a la vez y se filtra por lo que de verdad se ve:
   * los dos árboles existen siempre en el DOM y el apagado mide 0, así que sin
   * `:visible` se tocaría un nodo invisible y el clic no abriría nada.
   */
  const abribles = pagina.locator(
    '[data-barra="torneo"]:visible, [data-agenda="tarjeta"]:visible',
  );
  const cuantas = await abribles.count();
  if (cuantas === 0) {
    throw new Error('No hay ninguna barra ni tarjeta que abrir en el calendario.');
  }

  // Con búsqueda, la buena es la que lleva el aro de resaltado.
  const resaltadas = pagina.locator(
    '[data-barra="torneo"].ring-foreground:visible, [data-agenda="tarjeta"].ring-foreground:visible',
  );
  const diana =
    buscar && (await resaltadas.count()) > 0 ? resaltadas.first() : abribles.first();
  await diana.scrollIntoViewIfNeeded();
  await diana.click({ force: true });
  // La lista de inscritos llega por una acción de servidor, así que hay que
  // esperar a que vuelva: con 800 ms la captura salía con «Mirando quién va…».
  await pagina.waitForTimeout(2500);

  const sufijo = process.env.NOMBRE ? `${process.env.NOMBRE}-${nombre}` : nombre;
  await pagina.screenshot({ path: `capturas/ficha-${sufijo}.png` });

  /**
   * Y el final de la hoja, que es la mitad que no se ve.
   *
   * La ficha se desplaza DENTRO de la hoja lateral, así que ni `fullPage` ni
   * la captura del elemento traen lo de abajo: hay que desplazar el panel a
   * mano. Sin esta segunda imagen se juzgaba media pantalla.
   */
  const hoja = pagina.locator('[data-slot="sheet-content"]');
  await hoja.evaluate((n) => n.scrollTo({ top: n.scrollHeight }));
  await pagina.waitForTimeout(500);
  await pagina.screenshot({ path: `capturas/ficha-${sufijo}-fin.png` });

  const m = await pagina.evaluate(() => ({
    desborda: document.documentElement.scrollWidth - window.innerWidth,
    abierta: Boolean(document.querySelector('[data-slot="sheet-content"]')),
  }));

  console.log(
    `${nombre.padEnd(11)} ${cuantas} ${nombre === 'iphone' ? 'tarjetas' : 'barras'} · ` +
      `ficha ${m.abierta ? 'abierta' : 'NO ABIERTA'} · ` +
      `desborde ${m.desborda}px` +
      (errores.length ? `\n  errores: ${[...new Set(errores)].slice(0, 2).join(' | ')}` : ''),
  );

  await contexto.close();
}

await navegador.close();
