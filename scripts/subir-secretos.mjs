#!/usr/bin/env node
/**
 * Sube a Cloudflare los secretos de producción, leyéndolos de `.env`.
 *
 *   npm run cf:secretos
 *
 * Por qué existe: `wrangler secret put` los pide de uno en uno y por teclado.
 * Con diez secretos eso son diez pegados manuales en los que es fácil colar un
 * salto de línea o equivocarse de campo.
 *
 * Qué NO hace: no imprime ningún valor, ni entero ni recortado. Solo dice el
 * nombre y si entró. Y no inventa nada: lo que no esté en `.env` se salta y se
 * avisa.
 *
 * Los valores viajan por la entrada estándar de `wrangler`, no como argumento,
 * para que no acaben en el historial del intérprete de órdenes ni en la lista
 * de procesos de la máquina.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const WORKER = 'calendario-fie-fede';

/**
 * Los secretos de verdad. Lo que no es secreto —la URL pública, el agente de
 * usuario, los interruptores— va como `vars` en `wrangler.jsonc`, a la vista,
 * que para eso no es secreto.
 */
const SECRETOS = [
  ['NEON_AUTH_URL', 'URL del proveedor gestionado, sin conexión SQL'],
  ['NEON_AUTH_BASE_URL', 'alias de la URL de Neon Auth'],
  ['NEON_AUTH_COOKIE_SECRET', 'imprescindible: cookies y vistas privadas'],
  ['CRON_SECRET', 'imprescindible: sin ella las rutas de cron dan 503'],
  ['CREDENTIAL_ENCRYPTION_KEY', 'cifra las credenciales de Skermo'],
  ['RESEND_API_KEY', 'opcional: envío de correos'],
  ['EMAIL_FROM', 'opcional: remitente de los correos'],
  ['ADMIN_ALERT_EMAIL', 'opcional: aviso si una fuente falla dos días'],
];

/** Lee `.env` sin depender de ninguna librería. */
function leerEnv() {
  const valores = new Map();
  let texto;
  try {
    texto = readFileSync('.env', 'utf8');
  } catch {
    console.error('No encuentro el fichero .env en este directorio.');
    process.exit(1);
  }
  for (const linea of texto.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const i = limpia.indexOf('=');
    if (i === -1) continue;
    const nombre = limpia.slice(0, i).trim();
    let valor = limpia.slice(i + 1).trim();
    // Quita las comillas si las hay, pero no toca nada de dentro.
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    valores.set(nombre, valor);
  }
  return valores;
}

function subir(nombre, valor) {
  return new Promise((resolve) => {
    /**
     * `shell: true` en Windows.
     *
     * Sin ello, Node se niega a lanzar `npx.cmd` con `EINVAL`: desde la
     * versión 18.20 no ejecuta ficheros `.cmd` ni `.bat` directamente, por
     * una vulnerabilidad de inyección de argumentos. Aquí los argumentos son
     * constantes menos el nombre del secreto, que viene de una lista fija de
     * este mismo fichero, así que no hay nada que inyectar. El VALOR del
     * secreto no pasa por la línea de órdenes: va por la entrada estándar,
     * que es lo que de verdad importa proteger.
     */
    const hijo = spawn(
      'npx',
      ['wrangler', 'secret', 'put', nombre, '--name', WORKER],
      { stdio: ['pipe', 'ignore', 'pipe'], shell: process.platform === 'win32' },
    );
    let error = '';
    hijo.stderr.on('data', (d) => (error += d.toString()));
    hijo.on('close', (codigo) => resolve({ ok: codigo === 0, error }));
    hijo.stdin.write(valor);
    hijo.stdin.end();
  });
}

const env = leerEnv();

// Este guion nunca habilita contraseñas ni sube DATABASE_URL al Worker.

console.log(`Subiendo secretos al Worker «${WORKER}».\n`);

let puestos = 0;
let faltan = [];

for (const [nombre, para] of SECRETOS) {
  const valor = env.get(nombre);
  if (!valor) {
    faltan.push([nombre, para]);
    console.log(`  ·  ${nombre.padEnd(26)} no está en .env, se salta`);
    continue;
  }
  const { ok, error } = await subir(nombre, valor);
  if (ok) {
    puestos += 1;
    console.log(`  ✓  ${nombre.padEnd(26)} ${para}`);
  } else {
    console.log(`  ✗  ${nombre.padEnd(26)} FALLÓ`);
    // Wrangler puede incluir datos de la solicitud en un error. No reenviarlos.
    process.exitCode = 1;
  }
}

console.log(`\n${puestos} secretos puestos.`);

if (faltan.length > 0) {
  console.log('\nSin poner porque no están en .env:');
  for (const [nombre, para] of faltan) console.log(`  ${nombre} — ${para}`);
  console.log(
    '\nSi alguno de los marcados como imprescindibles está en esta lista, la\n' +
      'aplicación desplegada no va a funcionar hasta que lo pongas.',
  );
}

console.log(
  '\nLos cambios en los secretos necesitan un despliegue para surtir efecto:\n' +
    '  npx opennextjs-cloudflare deploy',
);
