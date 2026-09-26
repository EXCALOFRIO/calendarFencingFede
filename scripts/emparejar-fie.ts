import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../src/db';
import { athlete, fieFencer } from '../src/db/schema';
import {
  fechaNacimientoDeLicenciaFie,
  normalizarLicenciaFie,
} from '../src/lib/ingest/sources/fie-tiradores';

/**
 * LA COLA DE FICHAS FIE, desde la línea de órdenes.
 *
 *   npx tsx scripts/emparejar-fie.ts                    -> ver la cola
 *   npx tsx scripts/emparejar-fie.ts --confirmar 21966  -> enlazar una
 *   npx tsx scripts/emparejar-fie.ts --rechazar 57091   -> no es la misma persona
 *   npx tsx scripts/emparejar-fie.ts --confirmar-comprobadas
 *
 * ¿Por qué un script y no una pantalla? Porque la FIE **no comparte ningún
 * identificador con la RFEE**: su número de licencia es la fecha de nacimiento
 * en DDMMAAAA más tres dígitos ("26041992000"), no la licencia española
 * ("CLF01835"). Sin clave común, el enlace lo tiene que decidir una persona, y
 * hasta que exista el panel en `/admin/emparejar` esta es la forma de
 * decidirlo. La consulta que alimentará ese panel ya está lista:
 * `listPropuestasFie()` en `src/lib/queries/ranking.ts`.
 *
 * Al confirmar se escribe el número de licencia FIE en la ficha del tirador
 * (`athlete.fie_license`), igual que hace `asignarResultado` con la licencia
 * de la RFEE. A partir de ahí el enlace se rehace solo en cada ingestión, por
 * licencia y no por nombre, y este trabajo no se repite nunca.
 *
 * `--confirmar-comprobadas` NO es "confirmar por nombre". Solo acepta las
 * propuestas en las que se cumplen las tres condiciones a la vez, y todas son
 * hechos, no parecidos:
 *   1. la FIE publica un número de licencia,
 *   2. la fecha de nacimiento que lleva dentro ese número coincide **al día**
 *      con la que tenemos en la ficha,
 *   3. y esa ficha de la FIE es candidata de un único tirador nuestro.
 * Cualquier propuesta que no cumpla las tres se queda en la cola y se lista
 * aparte, para que la mire alguien.
 */

type Fila = {
  fieId: number;
  sourceName: string;
  photoUrl: string | null;
  profileUrl: string;
  sourceBirthDate: string | null;
  fieLicense: string | null;
  fieLicenseStatus: string | null;
  matchEvidence: string | null;
  athleteId: string | null;
  candidatoId: string | null;
  candidatoNombre: string | null;
  candidatoApellidos: string | null;
  candidatoNacimiento: string | null;
  candidatoLicenciaRfee: string | null;
  candidatoLicenciaFie: string | null;
};

async function cargarCola(estado: 'PROPUESTO' | 'CONFIRMADO'): Promise<Fila[]> {
  const filas = await db
    .select({
      fieId: fieFencer.fieId,
      sourceName: fieFencer.sourceName,
      photoUrl: fieFencer.photoUrl,
      profileUrl: fieFencer.profileUrl,
      sourceBirthDate: fieFencer.sourceBirthDate,
      fieLicense: fieFencer.fieLicense,
      fieLicenseStatus: fieFencer.fieLicenseStatus,
      matchEvidence: fieFencer.matchEvidence,
      athleteId: fieFencer.athleteId,
      candidatoId: sql<
        string | null
      >`coalesce(${fieFencer.athleteId}, ${fieFencer.proposedAthleteId})`,
      candidatoNombre: athlete.firstName,
      candidatoApellidos: athlete.lastName,
      candidatoNacimiento: athlete.birthDate,
      candidatoLicenciaRfee: athlete.rfeeLicense,
      candidatoLicenciaFie: athlete.fieLicense,
    })
    .from(fieFencer)
    .leftJoin(
      athlete,
      sql`${athlete.id} = coalesce(${fieFencer.athleteId}, ${fieFencer.proposedAthleteId})`,
    )
    .where(eq(fieFencer.linkStatus, estado))
    .orderBy(fieFencer.sourceName);

  return filas.map((f) => ({
    ...f,
    sourceBirthDate: f.sourceBirthDate ? String(f.sourceBirthDate).slice(0, 10) : null,
    candidatoNacimiento: f.candidatoNacimiento
      ? String(f.candidatoNacimiento).slice(0, 10)
      : null,
  }));
}

/** Las tres condiciones de hecho. Ninguna mira el nombre. */
function comprobaciones(f: Fila) {
  const fechaEnLicencia = fechaNacimientoDeLicenciaFie(f.fieLicense);
  return {
    tieneLicencia: Boolean(f.fieLicense),
    fechaCuadra:
      Boolean(fechaEnLicencia) && fechaEnLicencia === f.candidatoNacimiento,
    fechaEnLicencia,
    tieneCandidato: Boolean(f.candidatoId),
    ambiguo: (f.matchEvidence ?? '').startsWith('AMBIGUO'),
  };
}

function pintar(f: Fila) {
  const c = comprobaciones(f);
  const quien = f.candidatoId
    ? `${f.candidatoNombre} ${f.candidatoApellidos} (nac. ${f.candidatoNacimiento}, licencia RFEE ${f.candidatoLicenciaRfee ?? '—'})`
    : 'SIN CANDIDATO';

  console.log(`\nFIE ${f.fieId}  «${f.sourceName}»`);
  console.log(`   nuestro candidato : ${quien}`);
  console.log(`   ficha FIE         : ${f.profileUrl}`);
  console.log(`   foto (enlazada)   : ${f.photoUrl ?? '— no publica foto'}`);
  console.log(
    `   licencia FIE      : ${f.fieLicense ?? '—'} (${f.fieLicenseStatus ?? 'sin estado'})` +
      (c.fechaEnLicencia ? ` -> lleva dentro la fecha ${c.fechaEnLicencia}` : ''),
  );
  console.log(
    `   nacimiento        : FIE ${f.sourceBirthDate ?? '—'} / nuestro ${f.candidatoNacimiento ?? '—'}` +
      (c.fechaCuadra ? '  ✓ cuadra al día' : '  ✗ NO cuadra'),
  );
  console.log(`   evidencia         : ${f.matchEvidence ?? '—'}`);
}

async function confirmar(fieId: number): Promise<void> {
  const [fila] = (await cargarCola('PROPUESTO')).filter((f) => f.fieId === fieId);
  if (!fila) {
    console.log(`No hay ninguna propuesta pendiente para la ficha FIE ${fieId}.`);
    return;
  }
  if (!fila.candidatoId) {
    console.log(
      `La ficha FIE ${fieId} no tiene candidato propuesto. No se enlaza a ciegas.`,
    );
    return;
  }

  await db
    .update(fieFencer)
    .set({
      athleteId: fila.candidatoId,
      linkStatus: 'CONFIRMADO',
      linkedVia: 'persona',
      linkedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(fieFencer.fieId, fieId));

  /**
   * Se guarda la licencia FIE en la ficha del tirador: es lo que hace que este
   * trabajo no se repita. A partir de mañana la ingestión lo empareja sola por
   * licencia. Solo se escribe si estaba vacía, para no pisar lo que haya
   * puesto una persona.
   */
  let licenciaGuardada = false;
  if (fila.fieLicense && !fila.candidatoLicenciaFie) {
    await db
      .update(athlete)
      .set({ fieLicense: fila.fieLicense, updatedAt: new Date() })
      .where(and(eq(athlete.id, fila.candidatoId), sql`${athlete.fieLicense} is null`));
    licenciaGuardada = true;
  }

  console.log(
    `✓ FIE ${fieId} «${fila.sourceName}» enlazada a ${fila.candidatoNombre} ` +
      `${fila.candidatoApellidos}.` +
      (licenciaGuardada
        ? ` Licencia FIE ${fila.fieLicense} guardada en su ficha: las próximas pasadas la emparejan solas.`
        : ''),
  );
}

async function rechazar(fieId: number): Promise<void> {
  const cambiadas = await db
    .update(fieFencer)
    .set({
      athleteId: null,
      linkStatus: 'RECHAZADO',
      linkedVia: 'persona',
      linkedAt: new Date(),
      matchEvidence: 'Una persona ha dicho que no es la misma persona.',
      updatedAt: new Date(),
    })
    .where(eq(fieFencer.fieId, fieId))
    .returning({ fieId: fieFencer.fieId });

  console.log(
    cambiadas.length > 0
      ? `✓ FIE ${fieId} marcada como RECHAZADO. No se volverá a proponer.`
      : `No hay ninguna ficha FIE ${fieId} en la base.`,
  );
}

// ------------------------------------------------------------------ main ---

const args = process.argv.slice(2);
const bandera = (nombre: string) => args.includes(nombre);
const valor = (nombre: string) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};

if (bandera('--confirmar')) {
  const id = Number.parseInt(valor('--confirmar') ?? '', 10);
  if (!Number.isFinite(id)) {
    console.error('Uso: --confirmar <fieId>');
    process.exit(1);
  }
  await confirmar(id);
} else if (bandera('--rechazar')) {
  const id = Number.parseInt(valor('--rechazar') ?? '', 10);
  if (!Number.isFinite(id)) {
    console.error('Uso: --rechazar <fieId>');
    process.exit(1);
  }
  await rechazar(id);
} else if (bandera('--confirmar-comprobadas')) {
  const cola = await cargarCola('PROPUESTO');
  const listas = cola.filter((f) => {
    const c = comprobaciones(f);
    return c.tieneLicencia && c.fechaCuadra && c.tieneCandidato && !c.ambiguo;
  });
  const dudosas = cola.filter((f) => !listas.includes(f));

  console.log(
    `${cola.length} propuestas en la cola: ${listas.length} con las tres ` +
      `comprobaciones de hecho en verde, ${dudosas.length} a revisar a mano.\n`,
  );

  for (const f of listas) {
    pintar(f);
    await confirmar(f.fieId);
  }

  if (dudosas.length > 0) {
    console.log(
      `\n--- ${dudosas.length} se quedan en la cola (falta una comprobación) ---`,
    );
    for (const f of dudosas) pintar(f);
  }
} else {
  const propuestas = await cargarCola('PROPUESTO');
  const confirmadas = await cargarCola('CONFIRMADO');

  console.log(`=== ${confirmadas.length} fichas FIE CONFIRMADAS ===`);
  for (const f of confirmadas) pintar(f);

  console.log(`\n\n=== ${propuestas.length} PROPUESTAS pendientes ===`);
  for (const f of propuestas) pintar(f);

  if (propuestas.length > 0) {
    console.log(
      '\nPara enlazar: npx tsx scripts/emparejar-fie.ts --confirmar <fieId>' +
        '\nPara descartar: npx tsx scripts/emparejar-fie.ts --rechazar <fieId>',
    );
  }
}
