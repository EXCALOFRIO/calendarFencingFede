import { chromium, devices } from 'playwright';

/**
 * Comprobación de la URL de producción, con un navegador de verdad.
 *
 *   npm run produccion
 *
 * Existe porque «el despliegue ha terminado» y «la aplicación funciona» son
 * dos cosas distintas, y la segunda solo se sabe entrando. Un `curl` a la
 * portada devuelve 307 tanto si todo va bien como si la sesión está rota.
 *
 * Esto entra con una cuenta real, comprueba que llega al calendario con
 * torneos de verdad y deja una captura de lo que se ve.
 */

const BASE = process.env.URL ?? 'https://calendario-esgrima.aleramlar.workers.dev';
const EMAIL = process.env.EMAIL ?? 'tiradora@demo.local';
const CONTRASENA = process.env.CONTRASENA ?? 'Demo-2026-Esgrima!';

const navegador = await chromium.launch();
let problemas = 0;

for (const [nombre, config] of [
  ['escritorio', { viewport: { width: 1440, height: 900 } }],
  ['iphone', devices['iPhone 14 Pro']],
] as const) {
  const contexto = await navegador.newContext({ ...config, locale: 'es-ES' });
  const pagina = await contexto.newPage();

  const errores: string[] = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => m.type() === 'error' && errores.push(m.text()));

  // 1. La pantalla de acceso se pinta.
  const acceso = await pagina.goto(`${BASE}/entrar`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  console.log(`${nombre.padEnd(11)} /entrar  ${acceso?.status()}`);
  if (acceso?.status() !== 200) problemas += 1;

  // 2. Se entra de verdad, por el formulario, como una persona.
  const hayContrasena =
    (await pagina.locator('input[type="password"]').count()) > 0;

  if (!hayContrasena) {
    console.log(
      '  ✗ No hay formulario de contraseña: falta ACCESO_CON_CONTRASENA=1, ' +
        'así que no puede entrar nadie.',
    );
    problemas += 1;
  } else {
    await pagina.locator('input[type="email"]').last().fill(EMAIL);
    await pagina.locator('input[type="password"]').fill(CONTRASENA);
    await pagina.getByRole('button', { name: /Entrar con contraseña/i }).click();
    await pagina.waitForLoadState('networkidle', { timeout: 90_000 });

    const ruta = new URL(pagina.url()).pathname;

    if (ruta.startsWith('/entrar')) {
      /**
       * Se distingue el fallo del dominio de cualquier otro, porque es el
       * único que no se arregla desde el código: hay que ir a un panel.
       */
      const respuesta = await fetch(`${BASE}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: CONTRASENA }),
      });
      const cuerpo = await respuesta.text();

      const lineas = cuerpo.includes('INVALID_ORIGIN')
        ? [
            `  ✗ Neon Auth no confía en este dominio (${respuesta.status} INVALID_ORIGIN).`,
            '    Se arregla en un minuto y sin tocar código: en el panel de Neon,',
            '    Auth › Configuration › Domains, añade con protocolo y sin barra',
            `    final:  ${BASE}`,
          ]
        : [
            `  ✗ Se quedó en /entrar. La API responde ${respuesta.status}:`,
            `    ${cuerpo.slice(0, 200)}`,
          ];

      console.log(lineas.join('\n'));
      problemas += 1;
    } else {
      // 3. Y lo que se ve es el calendario CON DATOS, no una pantalla vacía.
      const barras = await pagina
        .locator('div.relative.grid.grid-cols-7 > button')
        .count();
      const titulo = await pagina.locator('h1').first().innerText();
      console.log(`  ✓ Entró en ${ruta} · «${titulo}» · ${barras} torneos pintados`);
      if (barras === 0) {
        console.log('  ✗ El calendario está vacío: no llega a la base de datos.');
        problemas += 1;
      }
      await pagina.screenshot({ path: `capturas/prod-${nombre}-calendario.png` });
    }
  }

  if (errores.length > 0) {
    problemas += errores.length;
    console.log(`  errores: ${[...new Set(errores)].slice(0, 3).join(' | ')}`);
  }

  await contexto.close();
}

await navegador.close();
console.log(problemas === 0 ? '\nProducción en pie.' : `\n${problemas} problemas.`);
if (problemas > 0) process.exitCode = 1;
