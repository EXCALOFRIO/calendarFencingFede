import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import { userProfile } from '../src/db/schema';
import {
  buscarCandidatos,
  vincularFichaDesdeRanking,
} from '../src/lib/altas/desde-ranking';
import { sinAcentos } from '../src/lib/altas/texto';
import { newIcalToken } from '../src/lib/auth/session';

/**
 * Da de alta a un tirador a partir del ranking oficial de la RFEE.
 *
 *   npx tsx scripts/alta-desde-ranking.ts CLF01835
 *   npx tsx scripts/alta-desde-ranking.ts "llavador"
 *
 * No es un guion de relleno: es **la forma en la que la federación daría de
 * alta a alguien de verdad**. Todos los datos —nombre, licencia, fecha de
 * nacimiento, club, arma y categoría— salen de la fila que ya publica Skermo
 * en `app.skermo.org/ranking-rfee/public/RFEE` y que esta aplicación ingiere
 * cada noche. No se teclea nada ni se inventa nada.
 *
 * -------------------------------------------------------------------------
 * LA REGLA DE NEGOCIO NO ESTÁ AQUÍ
 * -------------------------------------------------------------------------
 * Buscar, crear la ficha con los datos oficiales, asignar las armas y
 * emparejar todas las filas del ranking por licencia vive en
 * `src/lib/altas/desde-ranking.ts`, y es exactamente el mismo código que usa la
 * pantalla `/alta`. Antes estaba escrito aquí y solo aquí: la consecuencia es
 * que la pantalla habría tenido que reimplementarlo y en un mes las dos altas
 * harían cosas distintas.
 *
 * Lo que sí es de este guion es lo de alrededor: inventarse un correo
 * `@demo.local` para que `npm run demo:borrar` se lo lleve y crear la cuenta de
 * acceso. Cuando haya altas de verdad, el correo será el de la persona y la
 * contraseña la pondrá ella.
 *
 * Y una diferencia deliberada con la pantalla: aquí NO se pide el número de
 * licencia como prueba de identidad. Quien ejecuta esto es la dirección
 * técnica, que ya es la autoridad que da de alta a la gente; pedirle la
 * licencia del tirador sería teatro. En `/alta`, donde quien pulsa es la propia
 * persona, la licencia es obligatoria.
 */

const BUSQUEDA = process.argv[2];
const CONTRASENA = 'Demo-2026-Esgrima!';
const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

if (!BUSQUEDA) {
  console.error(
    'Falta a quién dar de alta. Se busca por licencia o por parte del nombre:\n' +
      '  npx tsx scripts/alta-desde-ranking.ts CLF01835\n' +
      '  npx tsx scripts/alta-desde-ranking.ts "llavador"',
  );
  process.exit(1);
}

const candidatos = await buscarCandidatos(BUSQUEDA, 5);
const candidato = candidatos[0];

if (!candidato) {
  console.error(
    `No hay nadie que case con «${BUSQUEDA}» en el ranking oficial ingerido.\n` +
      'Comprueba la licencia o prueba con parte del apellido.',
  );
  process.exit(1);
}

if (candidatos.length > 1) {
  console.log(
    `Hay ${candidatos.length} que casan con «${BUSQUEDA}». Se coge el primero:\n` +
      candidatos
        .map(
          (c, i) =>
            `  ${i === 0 ? '→' : ' '} ${c.nombre} (${c.anioNacimiento ?? '?'}, ${
              c.club ?? 'sin club'
            })`,
        )
        .join('\n') +
      '\nSi no es el que querías, busca por su número de licencia.\n',
  );
}

if (candidato.sinLicencia) {
  console.error(
    `«${candidato.nombre}» está en el ranking pero sin número de licencia, y ` +
      'sin licencia no se empareja: hay homónimos. Resuélvelo a mano desde ' +
      '/admin/emparejar.',
  );
  process.exit(1);
}

const mejor = candidato.clasificaciones[0];

console.log(`\nDando de alta a ${candidato.nombre}`);
console.log(`  nacimiento    ${candidato.anioNacimiento ?? 'no publicado'}`);
console.log(`  club          ${candidato.club ?? 'no publicado'}`);
console.log(`  armas         ${candidato.armas.join(', ')}`);
for (const c of candidato.clasificaciones) {
  console.log(
    `  ranking       ${c.arma} ${c.genero} ${c.categoriaOriginal}: ` +
      `${c.puesto ?? 'sin clasificar'}.º con ${c.puntos ?? 0} puntos (${c.temporada})`,
  );
}

/**
 * El correo de demostración. Se construye con el nombre y el primer apellido,
 * sin acentos, que es lo que hacen las federaciones de verdad y lo que permite
 * reconocer la cuenta de un vistazo en `/admin/usuarios`.
 */
const correo = `${sinAcentos(candidato.nombrePila).replace(/\s+/g, '')}.${
  sinAcentos(candidato.apellidos).split(/\s+/)[0] ?? 'tirador'
}@demo.local`;

console.log(`  correo        ${correo}\n`);

const [perfilExistente] = await db
  .select({ id: userProfile.id })
  .from(userProfile)
  .where(eq(userProfile.email, correo))
  .limit(1);

const perfilId =
  perfilExistente?.id ??
  (
    await db
      .insert(userProfile)
      .values({
        email: correo,
        fullName: candidato.nombre,
        role: 'athlete',
        icalToken: newIcalToken(),
        inviteStatus: 'pendiente',
      })
      .returning({ id: userProfile.id })
  )[0].id;

const resultado = await vincularFichaDesdeRanking({
  profileId: perfilId,
  clave: candidato.clave,
  origen: 'guion',
});

if (!resultado.ok) {
  console.error(`\nNo se ha dado de alta (${resultado.motivo}):\n  ${resultado.error}`);
  // `YA_TIENES_FICHA` no es un fallo del guion: es que ya estaba hecho.
  process.exit(resultado.motivo === 'YA_TIENES_FICHA' ? 0 : 1);
}

// La cuenta de acceso, por el mismo camino que usa la pantalla de entrada.
const alta = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: correo,
    password: CONTRASENA,
    name: candidato.nombre,
  }),
}).catch(() => null);

console.log(`Ficha        ${resultado.alta.atletaId}`);
console.log(`Cuenta       ${perfilId}`);
console.log(`Licencia     ${resultado.alta.licencia}`);
console.log(`Armas        ${resultado.alta.armas.join(', ')}`);
console.log(
  `Ranking      ${resultado.alta.filasEmparejadas} filas emparejadas por licencia` +
    (mejor?.puesto ? ` (mejor puesto: ${mejor.puesto}.º)` : ''),
);
console.log(
  `Acceso       ${
    alta?.ok
      ? 'creado'
      : `la cuenta de autenticación no se creó (HTTP ${alta?.status ?? 'sin respuesta'}); ` +
        'seguramente ya existía'
  }`,
);
console.log(`\nEntra con    ${correo} / ${CONTRASENA}`);
