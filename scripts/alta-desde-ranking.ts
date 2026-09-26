import 'dotenv/config';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../src/db';
import {
  athlete,
  athleteWeapon,
  club,
  officialRankingEntry,
  userProfile,
} from '../src/db/schema';
import { newIcalToken } from '../src/lib/auth/session';
import { titular } from '../src/lib/utils';

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
 * Y de propina hace lo que el panel de administración llama «emparejar»:
 * deja la fila del ranking apuntando a la ficha recién creada, así que el
 * puesto y los puntos oficiales aparecen en la aplicación desde el primer
 * momento.
 *
 * La cuenta se crea con correo `@demo.local` a propósito, para que
 * `npm run demo:borrar` se la lleve. Cuando haya altas de verdad, el correo
 * será el de la persona y la contraseña la pondrá ella con su código.
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

/** Quita acentos y deja un hueco entre nombre y apellidos para el correo. */
function sinAcentos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Parte «CARLOS LLAVADOR FERNANDEZ» en nombre y apellidos.
 *
 * Skermo publica el nombre completo en una sola cadena, y en España lo normal
 * son dos apellidos. Cuando la fila trae los campos separados se usan esos,
 * que es el dato bueno; esto es solo el respaldo.
 */
function partirNombre(completo: string): { nombre: string; apellidos: string } {
  const trozos = completo.trim().split(/\s+/);
  if (trozos.length <= 1) return { nombre: completo, apellidos: '' };
  // Con tres o más trozos, el primero es el nombre y el resto apellidos.
  return {
    nombre: trozos[0],
    apellidos: trozos.slice(1).join(' '),
  };
}

const [fila] = await db
  .select()
  .from(officialRankingEntry)
  .where(
    sql`${officialRankingEntry.sourceLicense} ilike ${BUSQUEDA}
        or ${officialRankingEntry.sourceAthleteName} ilike ${`%${BUSQUEDA}%`}`,
  )
  .orderBy(sql`${officialRankingEntry.position} asc nulls last`)
  .limit(1);

if (!fila) {
  console.error(
    `No hay nadie que case con «${BUSQUEDA}» en el ranking oficial ingerido.\n` +
      'Comprueba la licencia o prueba con parte del apellido.',
  );
  process.exit(1);
}

if (!fila.sourceLicense) {
  console.error(
    `«${fila.sourceAthleteName}» está en el ranking pero sin número de ` +
      'licencia, y sin licencia no se empareja: hay homónimos. Resuélvelo a ' +
      'mano desde /admin/emparejar.',
  );
  process.exit(1);
}

const { nombre, apellidos } = partirNombre(fila.sourceAthleteName ?? '');
/**
 * Skermo publica los nombres en MAYÚSCULAS. Se guardan como se leen, que es
 * como se escribe un nombre: «Carlos Llavador Fernández», no
 * «CARLOS LLAVADOR FERNANDEZ». El original queda en la fila del ranking, que
 * no se toca.
 */
const nombrePila = titular(fila.sourceFirstName?.trim() || nombre);
const apellidosReales = titular(fila.sourceLastName?.trim() || apellidos);
const nombreCompleto = `${nombrePila} ${apellidosReales}`.trim();

const correo = `${sinAcentos(nombrePila).replace(/\s+/g, '')}.${sinAcentos(
  apellidosReales,
)
  .split(/\s+/)[0]
  ?.replace(/\s+/g, '')}@demo.local`;

console.log(`\nDando de alta a ${nombreCompleto}`);
console.log(`  licencia      ${fila.sourceLicense}`);
console.log(`  nacimiento    ${fila.sourceBirthDate ?? 'no publicado'}`);
console.log(`  arma/género   ${fila.weapon} ${fila.gender}`);
console.log(`  categoría     ${fila.category}`);
console.log(
  `  ranking       ${fila.position ?? 'sin clasificar'}.º con ${fila.totalPoints} puntos (${fila.seasonLabel})`,
);
console.log(`  club          ${fila.sourceClub ?? 'no publicado'}`);
console.log(`  correo        ${correo}\n`);

/**
 * El club se crea si no existe, con el código tal y como lo publica Skermo.
 * No se traduce a un nombre bonito: `FED-M-C` es como aparece en la fuente y
 * lo que permite cruzarlo después.
 */
let clubId: string | null = null;
if (fila.sourceClub) {
  const [existente] = await db
    .select({ id: club.id })
    .from(club)
    .where(eq(club.name, fila.sourceClub))
    .limit(1);

  clubId =
    existente?.id ??
    (
      await db
        .insert(club)
        .values({
          name: fila.sourceClub,
          contactEmail: `${sinAcentos(fila.sourceClub)}@demo.local`,
        })
        .returning({ id: club.id })
    )[0].id;
}

// 1. La cuenta.
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
        fullName: nombreCompleto,
        role: 'athlete',
        clubId,
        icalToken: newIcalToken(),
        inviteStatus: 'pendiente',
      })
      .returning({ id: userProfile.id })
  )[0].id;

// 2. La ficha de tirador, con los datos oficiales.
const [fichaExistente] = await db
  .select({ id: athlete.id })
  .from(athlete)
  .where(eq(athlete.rfeeLicense, fila.sourceLicense))
  .limit(1);

const atletaId =
  fichaExistente?.id ??
  (
    await db
      .insert(athlete)
      .values({
        firstName: nombrePila,
        lastName: apellidosReales,
        birthDate: fila.sourceBirthDate ?? '1900-01-01',
        gender: fila.gender === 'F' ? 'F' : 'M',
        clubId,
        rfeeLicense: fila.sourceLicense,
        rfeeLicenseValidUntil: '2027-08-31',
        consentSignedAt: new Date(),
        userProfileId: perfilId,
        notes:
          'Alta creada a partir del ranking oficial de la RFEE con ' +
          'scripts/alta-desde-ranking.ts.',
      })
      .returning({ id: athlete.id })
  )[0].id;

await db
  .update(athlete)
  .set({ userProfileId: perfilId, clubId })
  .where(eq(athlete.id, atletaId));

// 3. El arma, que es lo que determina todo lo que ve en el calendario.
await db
  .insert(athleteWeapon)
  .values({ athleteId: atletaId, weapon: fila.weapon })
  .onConflictDoNothing();

/**
 * 4. Emparejar TODAS sus filas del ranking, no solo la que se buscó.
 *
 * Un tirador puede estar en varias: absoluto y sub-23, o dos armas. Se
 * emparejan por licencia, nunca por nombre.
 */
const emparejadas = await db
  .update(officialRankingEntry)
  .set({ athleteId: atletaId })
  .where(
    and(
      eq(officialRankingEntry.sourceLicense, fila.sourceLicense),
      isNull(officialRankingEntry.athleteId),
    ),
  )
  .returning({ id: officialRankingEntry.id });

// 5. La cuenta de acceso, por el mismo camino que usa la pantalla de entrada.
const alta = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: correo,
    password: CONTRASENA,
    name: nombreCompleto,
  }),
}).catch(() => null);

console.log(`Ficha        ${atletaId}`);
console.log(`Cuenta       ${perfilId}`);
console.log(`Ranking      ${emparejadas.length} filas emparejadas por licencia`);
console.log(
  `Acceso       ${
    alta?.ok
      ? 'creado'
      : `la cuenta de autenticación no se creó (HTTP ${alta?.status ?? 'sin respuesta'}); ` +
        'seguramente ya existía'
  }`,
);
console.log(`\nEntra con    ${correo} / ${CONTRASENA}`);
