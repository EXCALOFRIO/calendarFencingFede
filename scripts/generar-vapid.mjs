/**
 * Genera un par de claves VAPID (P-256, RFC 8292) con WebCrypto y lo guarda
 * en un JSON FUERA del repositorio. Por pantalla solo sale la clave pública.
 *
 *   node scripts/generar-vapid.mjs <ruta/vapid.json> [--asunto mailto:...] [--forzar]
 *
 * Formato: { publica, privada, asunto, creada } en base64url (`privada` es el
 * escalar `d`). La pública va como variable `VAPID_PUBLIC_KEY`; la privada,
 * como secreto del Worker `VAPID_PRIVATE_KEY`.
 *
 * Cambiar las claves deja inservibles todas las suscripciones existentes (el
 * servicio de push las rechaza con 403): por eso no sobrescribe sin --forzar.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const destino = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--asunto');
if (!destino) {
  console.error('Uso: node scripts/generar-vapid.mjs <ruta/vapid.json> [--asunto mailto:...] [--forzar]');
  process.exit(2);
}
const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const absoluto = path.resolve(destino);
if (absoluto.toLowerCase().startsWith(raiz.toLowerCase() + path.sep)) {
  console.error('Las claves no se guardan dentro del repositorio.');
  process.exit(2);
}
if (existsSync(absoluto) && !args.includes('--forzar')) {
  console.error(`Ya existe ${absoluto}. Cambiar las claves invalida todas las suscripciones; usa --forzar si es lo que quieres.`);
  process.exit(1);
}
const i = args.indexOf('--asunto');
const asunto = i >= 0 ? args[i + 1] : 'https://calendario-fie-fede.excalofrio.workers.dev';
if (!/^(mailto:|https:\/\/)/.test(asunto ?? '')) {
  console.error('El asunto tiene que ser mailto: o https://');
  process.exit(2);
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publica = b64(new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey)));
const { d } = await crypto.subtle.exportKey('jwk', par.privateKey);

mkdirSync(path.dirname(absoluto), { recursive: true });
writeFileSync(absoluto, JSON.stringify({ publica, privada: d, asunto, creada: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
console.log(`Guardado en ${absoluto}`);
console.log(`VAPID_PUBLIC_KEY=${publica}`);
