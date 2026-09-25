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

const WORKER = 'calendario-esgrima';

/**
 * Los secretos de verdad. Lo que no es secreto —la URL pública, el agente de
 * usuario, los interruptores— va como `vars` en `wrangler.jsonc`, a la vista,
 * que para eso no es secreto.
 */
const SECRETOS = [
  ['DATABASE_URL', 'imprescindible: sin ella la aplicación no arranca'],
  ['NEON_AUTH_URL', 'imprescindible: sin ella no se puede iniciar sesión'],
  ['NEON_AUTH_COOKIE_SECRET', 'imprescindible: firma la cookie de sesión'],
  ['CRON_SECRET', 'imprescindible: sin ella las rutas de cron dan 503'],
  ['ACCESO_CON_CONTRASENA', 'imprescindible hoy: sin ella no entra nadie'],
  ['CREDENTIAL_ENCRYPTION_KEY', 'cifra las credenciales de Skermo'],
  ['AWS_ENDPOINT_URL_S3', 'almacenamiento de PDFs (respaldo de R2)'],
  ['AWS_ACCESS_KEY_ID', 'almacenamiento de PDFs'],
  ['AWS_SECRET_ACCESS_KEY', 'almacenamiento de PDFs'],
  ['AWS_REGION', 'almacenamiento de PDFs'],
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
    const hijo = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['wrangler', 'secret', 'put', nombre, '--name', WORKER],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let error = '';
    hijo.stderr.on('data', (d) => (error += d.toString()));
    hijo.on('close', (codigo) => resolve({ ok: codigo === 0, error }));
    hijo.stdin.write(valor);
    hijo.stdin.end();
  });
}

const env = leerEnv();

// El interruptor de la puerta de contraseña no está en `.env` por defecto: se
// enciende aquí a propósito y se apaga borrando el secreto en Cloudflare.
if (!env.get('ACCESO_CON_CONTRASENA')) env.set('ACCESO_CON_CONTRASENA', '1');

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
    console.log(`     ${error.trim().split('\n').slice(-3).join('\n     ')}`);
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
