/**
 * Compilación para Cloudflare.
 *
 * Es `next build` + `opennextjs-cloudflare build`, con un paso intermedio en
 * medio que existe SOLO por Windows:
 *
 * Next.js 16 deja en `.next/standalone/.next/node_modules/` enlaces a los
 * paquetes que externaliza del servidor (aquí, `prettier`, que entra de
 * rebote por el rastreo de dependencias y no se usa en ejecución). En Windows
 * los crea como *junctions*, que no necesitan permisos especiales.
 *
 * OpenNext, al copiar los ficheros rastreados, los reproduce con
 * `fs.symlinkSync` SIN indicar el tipo, y Node intenta entonces un enlace
 * simbólico de directorio de verdad. Eso en Windows exige el modo de
 * desarrollador o permisos de administrador, y sin ellos la compilación se
 * cae con `EPERM: operation not permitted, symlink`.
 *
 * Como esos enlaces apuntan a paquetes que el Worker no ejecuta, se borran
 * antes de empaquetar. En Linux y macOS el directorio no da guerra y el
 * borrado es inofensivo, así que el script vale igual en CI.
 *
 * Si algún día se compila desde WSL o desde Linux, `next build &&
 * opennextjs-cloudflare build` a secas también funciona.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENLACES_PROBLEMATICOS = '.next/standalone/.next/node_modules';

/**
 * Variables que el Worker necesita EN EJECUCIÓN.
 *
 * Todo lo demás del `.env` es de la máquina de quien compila y no pinta nada
 * dentro del paquete: credenciales de despliegue, alias sueltos, restos de
 * pruebas. En particular `CLOUDFLARE_API_TOKEN`, que puede desplegar y
 * modificar Workers de la cuenta entera y **jamás** debe viajar dentro de uno.
 */
const VARIABLES_DE_EJECUCION = new Set([
  'DATABASE_URL',
  'NEON_AUTH_URL',
  'NEON_AUTH_COOKIE_SECRET',
  'CRON_SECRET',
  'ACCESO_CON_CONTRASENA',
  'CREDENTIAL_ENCRYPTION_KEY',
  'AWS_ENDPOINT_URL_S3',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'ADMIN_ALERT_EMAIL',
  'NEXT_PUBLIC_APP_URL',
  'INGEST_USER_AGENT',
]);

function ejecutar(orden, argumentos, entorno = {}) {
  const resultado = spawnSync(orden, argumentos, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...entorno },
  });
  if (resultado.status !== 0) {
    process.exit(resultado.status ?? 1);
  }
}

/**
 * 1. Compilación de Next en modo `standalone`.
 *
 * Estas dos variables son las que pone OpenNext cuando es él quien lanza
 * `next build` (node_modules/@opennextjs/aws/dist/build/buildNextApp.js,
 * función `setStandaloneBuildMode`). Como aquí lo lanzamos nosotros para
 * poder colar el paso 2 en medio, hay que ponerlas a mano: sin ellas no se
 * genera `.next/standalone/` y el empaquetado falla buscando
 * `pages-manifest.json`.
 *
 * Escribe en `.next/` (no en `.next/dev/`), así que no molesta a un
 * `next dev` que esté corriendo.
 */
ejecutar('npx', ['next', 'build'], {
  NEXT_PRIVATE_STANDALONE: 'true',
  NEXT_PRIVATE_OUTPUT_TRACE_ROOT: process.cwd(),
});

// 2. Fuera los enlaces a paquetes externalizados.
if (existsSync(ENLACES_PROBLEMATICOS)) {
  rmSync(ENLACES_PROBLEMATICOS, { recursive: true, force: true });
  console.log(`\n[cloudflare] Retirados los enlaces de ${ENLACES_PROBLEMATICOS}`);
}

// 3. Empaquetado para el Worker, sin repetir el paso 1.
ejecutar('npx', ['opennextjs-cloudflare', 'build', '--skipNextBuild']);

/**
 * 4. El `.env` NO viaja dentro del Worker.
 *
 * Next, en modo `standalone`, copia el `.env` del proyecto al directorio de
 * salida, y OpenNext lo empaqueta con el resto. Comprobado tras el primer
 * despliegue: el `.env` **entero** acabó dentro del Worker, incluido el
 * `CLOUDFLARE_API_TOKEN`, que puede desplegar y modificar Workers de toda la
 * cuenta. No es accesible desde fuera —se sirve un 404— pero un secreto de
 * despliegue dentro de la cosa desplegada está mal, y los de verdad van en el
 * almacén de secretos de Cloudflare (`npm run cf:secretos`).
 *
 * Por defecto se borra. `CF_ENV_EMBEBIDO=1` deja una copia **filtrada** con
 * solo las variables de ejecución, que es lo que permite tener un despliegue
 * en pie mientras no estén puestos los secretos. Es una muleta y se dice:
 * el mensaje lo recuerda en cada compilación.
 */
const embebido = process.env.CF_ENV_EMBEBIDO === '1';

/**
 * `globSync` de Node no encuentra ficheros que empiezan por punto sin
 * activar `dot`, y el comportamiento cambia entre versiones. Se recorre el
 * directorio a mano, que aquí es barato y no depende de eso.
 */
function buscarEnv(directorio) {
  const encontrados = [];
  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) encontrados.push(...buscarEnv(ruta));
    else if (entrada.name === '.env' || entrada.name.startsWith('.env.')) {
      encontrados.push(ruta);
    }
  }
  return encontrados;
}

for (const ruta of buscarEnv('.open-next')) {
  if (!embebido) {
    rmSync(ruta, { force: true });
    continue;
  }

  const filtrado = readFileSync(ruta, 'utf8')
    .split(/\r?\n/)
    .filter((linea) => {
      const nombre = linea.split('=')[0]?.trim();
      return nombre ? VARIABLES_DE_EJECUCION.has(nombre) : false;
    })
    .join('\n');
  writeFileSync(ruta, `${filtrado}\n`);
}

console.log(
  embebido
    ? '\n[cloudflare] AVISO: se han dejado las variables de ejecución dentro\n' +
        '              del paquete (CF_ENV_EMBEBIDO=1). Es una muleta hasta que\n' +
        '              estén los secretos: `npm run cf:secretos` y vuelve a\n' +
        '              compilar SIN esa variable.'
    : '\n[cloudflare] Ningún .env dentro del paquete. Los valores tienen que\n' +
        '              estar en el almacén de secretos: `npm run cf:secretos`.',
);
