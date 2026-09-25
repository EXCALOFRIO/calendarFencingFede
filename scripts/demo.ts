import 'dotenv/config';
import { and, asc, eq, inArray, isNull, like, notLike, sql } from 'drizzle-orm';
import { db } from '../src/db';
import {
  athlete,
  athleteWeapon,
  callUp,
  callUpAthlete,
  club,
  configChangeLog,
  deadlineRule,
  entry,
  entryEventLog,
  event,
  eventCompetition,
  profileWeapon,
  rankingPoint,
  rankingRule,
  rankingSnapshot,
  result,
  season,
  seasonCategory,
  userProfile,
} from '../src/db/schema';
import { newIcalToken } from '../src/lib/auth/session';
import { computeSeasonRanking } from '../src/lib/ranking/compute';
// Las fuentes publican los nombres de torneo en MAYÚSCULAS. Pasarlos por
// `titular()` es obligatorio en toda la aplicación, también aquí.
import { titular as titulo } from '../src/lib/utils';

/**
 * Datos de DEMOSTRACIÓN para poder enseñar la aplicación.
 *
 * ---------------------------------------------------------------------------
 * ESTO NO DEBE EJECUTARSE NUNCA EN PRODUCCIÓN
 * ---------------------------------------------------------------------------
 * La regla del producto es que no hay datos de ejemplo: una pantalla sin datos
 * se ve vacía y explica por qué. Este script existe solo para poder mirar la
 * aplicación llena antes de que haya personas reales dadas de alta.
 *
 * Por eso todo lo que crea:
 *   - se puede reconocer y borrar por marcas que NO se pintan en pantalla
 *     (ver el bloque de abajo: correos `@demo.local`, club de demostración,
 *     perfil que firma la normativa y las convocatorias);
 *   - se borra entero con `npm run demo:borrar`;
 *   - se cuelga de competiciones REALES del calendario ya ingerido, porque el
 *     objetivo es ver cómo se comporta la app con datos de verdad, no fabricar
 *     un calendario falso.
 *
 * Ejecuta:  npm run demo
 */

/**
 * ---------------------------------------------------------------------------
 * CÓMO SE MARCA LO DE DEMOSTRACIÓN (y por qué NO en los nombres)
 * ---------------------------------------------------------------------------
 * La primera versión escribía "DEMO" delante de cada nombre de persona y de
 * club. En pantalla se leía «Carla DEMO Absoluto · DEMO · Sala de Armas del
 * Ejemplo», que delante de la federación parece una aplicación a medio hacer.
 *
 * Así que la marca se ha movido a campos QUE NO SE PINTAN:
 *
 *   - `user_profile.email`   termina en `@demo.local`
 *   - `club.contact_email`   termina en `@demo.local`
 *   - `athlete.club_id`      apunta al club de demostración (y `notes` lo dice)
 *   - `call_up.created_by_profile_id`        -> perfil de demostración
 *   - `ranking_rule` / `deadline_rule`.`updated_by_profile_id` -> ídem
 *   - `config_change_log.changed_by_profile_id`                -> ídem
 *
 * `npm run demo:borrar` recorre exactamente esa lista. La única marca que sí
 * se ve es el número de licencia (`DEMO-0001`), y está puesta a propósito:
 * una licencia inventada con pinta de licencia real de la RFEE sería
 * justamente el tipo de dato falso que esta aplicación no admite.
 */
const SUFIJO_CORREO = '@demo.local';

/**
 * ---------------------------------------------------------------------------
 * DE DÓNDE SALE CADA NÚMERO DE LA NORMATIVA
 * ---------------------------------------------------------------------------
 * Ni un solo plazo, recargo, coeficiente o número de plazas de este fichero
 * está inventado. Todos salen de dos documentos oficiales de la RFEE que ya
 * están ingeridos en `official_document`, y cada fila que se escribe guarda el
 * documento y su URL en `source_document` / `source_url` para que la
 * aplicación pueda enseñar la procedencia debajo del dato.
 *
 * Lo que la circular no dice, no se pone: se queda a null y la interfaz dirá
 * "no publicado". Es preferible un hueco visible a un número plausible.
 */
const NORMATIVA_RANKINGS = {
  /** Se enseña tal cual debajo del dato: es una cita, no una etiqueta. */
  documento:
    'Normativa para Rankings Nacionales, Torneos Nacionales y Campeonatos de ' +
    'España 2026-2027 (V1, septiembre de 2026)',
  url: 'https://esgrima.es/wp-content/uploads/2026/09/NORMATIVA-PARA-RANKINGS-NACIONALES_26-27_V1.pdf',
  /** Fecha de publicación en esgrima.es, usada como `effective_from`. */
  publicado: new Date('2026-09-04T00:00:00Z'),
};

const CIRCULAR_12_26 = {
  documento: 'Circular 12-26 · Gestión administrativa 2026-2027',
  url: 'https://esgrima.es/wp-content/uploads/2026/09/CIRCULAR_12-26_GESTION_ADMINISTRATIVA_26-27.pdf',
  publicado: new Date('2026-09-02T00:00:00Z'),
};

/**
 * Tabla de puntos por puesto del ranking nacional.
 *
 * Sale de la fórmula del punto 1.4.1 de la Normativa para Rankings Nacionales
 * 26-27, que es un `MAX(...)` de tramos:
 *
 *   MAX(SI(pos=1;1414); SI(pos=2;1212); SI(pos<5;1010); SI(pos<9;808);
 *       SI(pos<17;606); SI(pos<33;404); SI(pos<65;202); SI(pos<129;101))
 *
 * OJO, y esto hay que decirlo en voz alta: la fórmula oficial suma además un
 * término que depende del NÚMERO DE PARTICIPANTES
 * (`1000 * (1,01 - log10(puesto)/log10(participantes))`). El esquema de
 * `ranking_rule.points_table` solo sabe expresar "puesto -> puntos", así que
 * ese término no se puede representar y los totales de esta demostración son
 * la parte de tramos, no el punto oficial de la RFEE. No se rellena con una
 * aproximación: se pone lo que la circular publica como tabla y se avisa.
 */
const TABLA_PUNTOS_RFEE = {
  '1': 1414,
  '2': 1212,
  '3-4': 1010,
  '5-8': 808,
  '9-16': 606,
  '17-32': 404,
  '33-64': 202,
  '65-128': 101,
} as const;

type PersonaDemo = {
  etiqueta: string;
  nombre: string;
  rol: 'admin' | 'coach' | 'club' | 'guardian' | 'athlete';
  armas?: ('FLORETE' | 'ESPADA' | 'SABLE')[];
};

const PERSONAS: PersonaDemo[] = [
  // Hace falta un admin de demostración: sin él no había forma de entrar al
  // panel con los usuarios de prueba, y las capturas del panel acababan
  // fotografiando la pantalla de acceso sin que nadie se diera cuenta.
  { etiqueta: 'direccion.tecnica', nombre: 'Beatriz Colomer Ríos', rol: 'admin' },
  { etiqueta: 'seleccionador.florete', nombre: 'Álvaro Nieto Bermúdez', rol: 'coach', armas: ['FLORETE'] },
  { etiqueta: 'seleccionador.espada', nombre: 'Marta Quintela Aguirre', rol: 'coach', armas: ['ESPADA'] },
  { etiqueta: 'maestro.club', nombre: 'Ignacio Prats Elizalde', rol: 'club' },
  { etiqueta: 'madre', nombre: 'Rosa Lacalle Vergara', rol: 'guardian' },
  // Tiradora con cuenta propia: es el caso más común de toda la aplicación,
  // una adulta que se gestiona sola. Sirve para ver la app tal y como la ve
  // la mayoría, sin el rodeo del tutor ni los permisos de gestión.
  { etiqueta: 'tiradora', nombre: 'Carla Ordóñez Rivas', rol: 'athlete' },
];

/** Tiradores. Las fechas dan categorías distintas a propósito. */
const TIRADORES = [
  { nombre: 'Lucía', apellidos: 'Fernández Lacalle', nac: '2009-03-14', gen: 'F' as const, armas: ['FLORETE' as const], lic: 'DEMO-0001', tutor: 'madre' },
  { nombre: 'Marcos', apellidos: 'Fernández Lacalle', nac: '2013-11-02', gen: 'M' as const, armas: ['FLORETE' as const, 'SABLE' as const], lic: 'DEMO-0002', tutor: 'madre' },
  { nombre: 'Ainhoa', apellidos: 'Etxebarria Lasa', nac: '2006-07-21', gen: 'F' as const, armas: ['ESPADA' as const], lic: 'DEMO-0003', tutor: null },
  { nombre: 'Pablo', apellidos: 'Serrano Quiroga', nac: '2004-01-30', gen: 'M' as const, armas: ['ESPADA' as const], lic: 'DEMO-0004', tutor: null },
  { nombre: 'Nerea', apellidos: 'Costa Belmonte', nac: '2011-05-09', gen: 'F' as const, armas: ['SABLE' as const], lic: 'DEMO-0005', tutor: null },
  // Sin licencia y sin consentimiento a propósito: así se ve el aviso de
  // "qué te falta", que es una de las pantallas que hay que poder enseñar.
  // Absoluta femenina de espada, con cuenta propia (no tutor).
  { nombre: 'Carla', apellidos: 'Ordóñez Rivas', nac: '1999-04-11', gen: 'F' as const, armas: ['ESPADA' as const], lic: 'DEMO-0006', tutor: null, cuenta: 'tiradora' },
  { nombre: 'Hugo', apellidos: 'Ibáñez Moreda', nac: '2010-09-18', gen: 'M' as const, armas: ['FLORETE' as const], lic: null, tutor: null },
  /**
   * Las tres siguientes existen por una razón concreta: los 80 resultados
   * reales que hay ingeridos son TODOS de la misma prueba, ESPADA / F / M20
   * (el TNR M20 del 20 de septiembre de 2026). Para poder emparejar
   * resultados de verdad hace falta al menos un puñado de tiradoras que
   * encajen en esa combinación, y ninguna de las de arriba lo hace: Ainhoa es
   * M23 y Carla es absoluta.
   *
   * Los años de nacimiento están dentro del rango M20 de `season_category`
   * de la temporada 2026-2027 (2007-2012), no elegidos al azar.
   *
   * Sara cuelga de la madre a propósito: así la pantalla "Mi estado" de una
   * cuenta de tutor enseña puesto y puntos de una competición ya celebrada.
   */
  { nombre: 'Sara', apellidos: 'Fernández Lacalle', nac: '2008-02-17', gen: 'F' as const, armas: ['ESPADA' as const], lic: 'DEMO-0007', tutor: 'madre' },
  { nombre: 'Marta', apellidos: 'Vilanova Sedano', nac: '2009-06-05', gen: 'F' as const, armas: ['ESPADA' as const], lic: 'DEMO-0008', tutor: null },
  { nombre: 'Irene', apellidos: 'Salas Cardeñosa', nac: '2010-10-12', gen: 'F' as const, armas: ['ESPADA' as const], lic: 'DEMO-0009', tutor: null },
];

/** Las tres que se emparejan con resultados reales de ESPADA / F / M20. */
const TIRADORAS_M20 = [
  'Sara Fernández Lacalle',
  'Marta Vilanova Sedano',
  'Irene Salas Cardeñosa',
];

async function main() {
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error('Este script no se ejecuta en producción. Es solo para la demo.');
  }

  console.log('Creando datos de demostración...\n');

  // --- Club ---
  // El club se reconoce por su correo `@demo.local`, no por el nombre: el
  // nombre se lee en pantalla y tiene que parecer un club de verdad.
  const correoClub = `club${SUFIJO_CORREO}`;
  let [clubDemo] = await db
    .select({ id: club.id })
    .from(club)
    .where(eq(club.contactEmail, correoClub))
    .limit(1);

  if (!clubDemo) {
    [clubDemo] = await db
      .insert(club)
      .values({
        name: 'Sala de Armas Puerta de Alcalá',
        shortName: 'SAPA-M',
        regionalFederation: 'Federación Madrileña de Esgrima',
        contactEmail: correoClub,
      })
      .returning({ id: club.id });
  }
  console.log('  Club de demostración listo.');

  // --- Personas ---
  const perfiles = new Map<string, string>();
  for (const p of PERSONAS) {
    const email = `${p.etiqueta}${SUFIJO_CORREO}`;
    let [perfil] = await db
      .select({ id: userProfile.id })
      .from(userProfile)
      .where(eq(userProfile.email, email))
      .limit(1);

    if (!perfil) {
      [perfil] = await db
        .insert(userProfile)
        .values({
          email,
          fullName: p.nombre,
          role: p.rol,
          clubId: clubDemo.id,
          icalToken: newIcalToken(),
          inviteStatus: 'pendiente',
        })
        .returning({ id: userProfile.id });
    } else {
      await db
        .update(userProfile)
        .set({ role: p.rol, fullName: p.nombre, clubId: clubDemo.id })
        .where(eq(userProfile.id, perfil.id));
    }

    if (p.armas?.length) {
      await db.delete(profileWeapon).where(eq(profileWeapon.profileId, perfil.id));
      await db
        .insert(profileWeapon)
        .values(p.armas.map((weapon) => ({ profileId: perfil.id, weapon })))
        .onConflictDoNothing();
    }

    perfiles.set(p.etiqueta, perfil.id);
  }
  console.log(`  ${PERSONAS.length} personas de demostración listas.`);

  // --- Tiradores ---
  const tiradoresCreados: { id: string; nombre: string; armas: string[] }[] = [];
  for (const t of TIRADORES) {
    let [ficha] = await db
      .select({ id: athlete.id })
      .from(athlete)
      .where(
        and(
          eq(athlete.firstName, t.nombre),
          eq(athlete.lastName, t.apellidos),
          // Acotado al club de demostración: los nombres ya no llevan marca,
          // así que sin esto se podría reutilizar la ficha de alguien real.
          eq(athlete.clubId, clubDemo.id),
        ),
      )
      .limit(1);

    if (!ficha) {
      [ficha] = await db
        .insert(athlete)
        .values({
          firstName: t.nombre,
          lastName: t.apellidos,
          birthDate: t.nac,
          gender: t.gen,
          clubId: clubDemo.id,
          rfeeLicense: t.lic,
          rfeeLicenseValidUntil: t.lic ? '2027-08-31' : null,
          // Hugo se queda sin consentimiento a propósito.
          consentSignedAt: t.lic ? new Date('2026-09-01') : null,
          guardianProfileId: t.tutor ? (perfiles.get(t.tutor) ?? null) : null,
          // Si el tirador tiene cuenta propia, la ficha se cuelga de ella.
          userProfileId:
            'cuenta' in t && t.cuenta ? (perfiles.get(t.cuenta) ?? null) : null,
          notes: 'Ficha de demostración. Bórrala con npm run demo:borrar.',
        })
        .returning({ id: athlete.id });
    }

    await db
      .insert(athleteWeapon)
      .values(t.armas.map((weapon, i) => ({ athleteId: ficha.id, weapon, primary: i === 0 })))
      .onConflictDoNothing();

    tiradoresCreados.push({ id: ficha.id, nombre: `${t.nombre} ${t.apellidos}`, armas: t.armas });
  }
  console.log(`  ${TIRADORES.length} tiradores de demostración listos.`);

  // --- Inscripciones sobre competiciones REALES del calendario ---
  const hoy = new Date().toISOString().slice(0, 10);
  const categorias = await categoriasDeTemporada();
  const pruebas = await db
    .select({
      id: eventCompetition.id,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      eventName: event.name,
      startDate: event.startDate,
    })
    .from(eventCompetition)
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(and(sql`${event.startDate} >= ${hoy}`, soloCanonicos()))
    .orderBy(asc(event.startDate))
    .limit(200);

  const estados = [
    'pending_club',
    'club_approved',
    'federation_approved',
    'submitted',
  ] as const;

  let inscripciones = 0;
  for (const [i, t] of tiradoresCreados.entries()) {
    /**
     * Cada tirador se apunta a las dos primeras pruebas futuras de su arma Y
     * DE SU GÉNERO, en estados distintos para que se vea la línea de progreso
     * completa.
     *
     * El filtro por género no es un detalle: sin él, la demostración enseñaba
     * a un chico inscrito en "Sable F", que es justo el tipo de dato absurdo
     * que hace desconfiar de toda la aplicación.
     */
    const suyo = TIRADORES.find((x) => `${x.nombre} ${x.apellidos}` === t.nombre);
    const genero = suyo?.gen;
    /**
     * Y por su CATEGORÍA: se puede subir de categoría, no bajar. Sin esto la
     * demostración apuntaba a una júnior a una prueba cadete, que es igual de
     * absurdo que el chico en "Sable F" y desprestigia igual la aplicación.
     */
    const elegibles = suyo ? categoriasElegibles(suyo.nac, categorias) : null;
    const suyas = pruebas
      .filter(
        (p) =>
          t.armas.includes(p.weapon) &&
          (!genero || p.gender === genero) &&
          (!elegibles || elegibles.includes(p.category)),
      )
      .slice(0, 2);

    for (const [j, p] of suyas.entries()) {
      const estado = estados[(i + j) % estados.length];
      const ficha = TIRADORES.find(
        (x) => `${x.nombre} ${x.apellidos}` === t.nombre,
      );
      const solicitante =
        (ficha && 'cuenta' in ficha && ficha.cuenta
          ? perfiles.get(ficha.cuenta)
          : null) ??
        perfiles.get('madre') ??
        perfiles.get('maestro.club')!;

      const [creada] = await db
        .insert(entry)
        .values({
          athleteId: t.id,
          eventCompetitionId: p.id,
          status: estado,
          requestedByProfileId: solicitante,
          requestedAt: new Date(Date.now() - 6 * 86_400_000),
          clubDecidedAt: estado !== 'pending_club' ? new Date(Date.now() - 4 * 86_400_000) : null,
          clubDecidedByProfileId:
            estado !== 'pending_club' ? (perfiles.get('maestro.club') ?? null) : null,
          federationDecidedAt:
            estado === 'federation_approved' || estado === 'submitted'
              ? new Date(Date.now() - 2 * 86_400_000)
              : null,
          submittedAt: estado === 'submitted' ? new Date(Date.now() - 86_400_000) : null,
        })
        .onConflictDoNothing({
          target: [entry.athleteId, entry.eventCompetitionId],
        })
        .returning({ id: entry.id });

      if (creada) {
        inscripciones += 1;
        await db.insert(entryEventLog).values({
          entryId: creada.id,
          fromStatus: null,
          toStatus: estado,
          actorProfileId: solicitante,
          actorLabel: 'demostración',
        });
      }
    }
  }
  console.log(`  ${inscripciones} inscripciones de demostración sobre pruebas reales.`);

  // --- Normativa, resultados, ranking y convocatorias ---
  const temporada = await temporadaActual();
  const admin = perfiles.get('direccion.tecnica') ?? null;
  const porNombre = new Map(tiradoresCreados.map((t) => [t.nombre, t.id]));

  if (!temporada) {
    console.log(
      '  AVISO: no hay ninguna temporada marcada como actual. Sin ella no se ' +
        'puede sembrar normativa, ranking ni convocatorias.',
    );
  } else {
    await sembrarNormativaRanking(temporada.id, admin);
    await sembrarNormativaPlazos(temporada.id, admin);
    const emparejados = await emparejarResultadosReales(porNombre, admin);
    await calcularRanking(temporada.id, emparejados > 0);
    await sembrarConvocatorias(temporada.id, porNombre, admin);
  }

  console.log('\nListo. Entra en http://localhost:3000/entrar con cualquiera de:');
  for (const p of PERSONAS) {
    console.log(`  ${p.etiqueta}${SUFIJO_CORREO}   (${p.rol}${p.armas ? ' · ' + p.armas.join(', ') : ''})`);
  }
  console.log('\nContraseña para todas (solo en local):  Demo-2026-Esgrima!');
  console.log('Para borrarlo todo:  npm run demo:borrar');
}

// ------------------------------------------------------- Ayudas de calendario ---

/**
 * Solo eventos CANÓNICOS y vivos.
 *
 * Otro proceso une los torneos duplicados entre Skermo y la FIE: la ficha de
 * la FIE se queda absorbida con `canonical_event_id` apuntando a la de
 * Skermo, y el calendario solo pinta la de Skermo. Si los datos de
 * demostración se enganchan a la absorbida, "Mi estado" dice
 * «San Salvador World Cup 2026» mientras el calendario dice
 * «Copa Mundo Júnior» para el mismo torneo, y parecen dos aplicaciones.
 */
function soloCanonicos() {
  return and(isNull(event.canonicalEventId), isNull(event.disappearedAt));
}

type FilaCategoria = {
  code: string;
  birthYearMin: number | null;
  birthYearMax: number | null;
  rank: number;
  laddered: boolean;
};

async function categoriasDeTemporada(): Promise<FilaCategoria[]> {
  const [actual] = await db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.current, true))
    .limit(1);
  if (!actual) return [];
  return db
    .select({
      code: seasonCategory.code,
      birthYearMin: seasonCategory.birthYearMin,
      birthYearMax: seasonCategory.birthYearMax,
      rank: seasonCategory.rank,
      laddered: seasonCategory.laddered,
    })
    .from(seasonCategory)
    .where(eq(seasonCategory.seasonId, actual.id))
    .orderBy(asc(seasonCategory.rank));
}

/**
 * Categorías en las que puede competir alguien nacido en ese año.
 *
 * Es la misma regla de la escalera que `src/lib/categories.ts` (se sube de
 * categoría, no se baja), reescrita aquí en pequeño porque el `CategoryCode`
 * de esa librería todavía no incluye M14 ni M23, que sí están en el enum de
 * la base y en `season_category`. Devuelve null si la temporada no tiene
 * categorías configuradas: entonces no se filtra nada, en vez de adivinar.
 */
function categoriasElegibles(
  nacimientoIso: string,
  filas: FilaCategoria[],
): string[] | null {
  if (filas.length === 0) return null;
  const anio = Number.parseInt(nacimientoIso.slice(0, 4), 10);
  const dentro = (f: FilaCategoria) =>
    (f.birthYearMin === null || anio >= f.birthYearMin) &&
    (f.birthYearMax === null || anio <= f.birthYearMax);

  const escalera = filas.filter((f) => f.laddered).sort((a, b) => a.rank - b.rank);
  const suya = escalera.find(dentro) ?? escalera.at(-1);
  if (!suya) return null;

  const codigos = escalera.filter((f) => f.rank >= suya.rank).map((f) => f.code);
  for (const f of filas.filter((x) => !x.laddered)) {
    if (dentro(f) && !codigos.includes(f.code)) codigos.push(f.code);
  }
  return codigos;
}

// ---------------------------------------------------------------- Normativa ---

async function temporadaActual() {
  const [fila] = await db
    .select({ id: season.id, label: season.label })
    .from(season)
    .where(eq(season.current, true))
    .limit(1);
  return fila ?? null;
}

/** Deja constancia del cambio igual que hace el panel de admin. */
async function anotarCambio(
  tabla: string,
  filaId: string,
  despues: unknown,
  autor: string | null,
) {
  await db.insert(configChangeLog).values({
    tableName: tabla,
    rowId: filaId,
    action: 'alta',
    before: null,
    after: despues as Record<string, unknown>,
    changedByProfileId: autor,
  });
}

/**
 * Normativa del ranking nacional, copiada de la circular.
 *
 * Fuente: Normativa para Rankings Nacionales, Torneos Nacionales y
 * Campeonatos de España 2026-2027 (V1, septiembre de 2026).
 *
 *  - Cuántas pruebas cuentan: apartado 1.3, "competiciones y coeficientes de
 *    la temporada por categoría".
 *  - Coeficientes: apartados 1.2 y 1.3 (competición de la propia categoría
 *    coeficiente 1; Campeonato de España de la propia categoría 1,25).
 *  - Tabla de puntos por puesto: apartado 1.4.1.
 *  - Plazas por ranking y plazas del CNTyC: apartado 4.1 (clasificación para
 *    los Campeonatos de España: 38 por ranking + 2 por lesión + 2 por
 *    territorio = 42).
 *
 * Lo que la circular NO dice y por tanto se queda vacío:
 *  - `cutoff_date`: la normativa habla de "la última competición puntuable
 *    antes del Campeonato de España", no de una fecha. No se inventa ninguna.
 *  - `weapon`: se deja a null porque la normativa es la misma para espada,
 *    florete y sable ("para el Ranking Nacional Sub23 de espada, florete y
 *    sable...").
 *  - Coeficiente de los circuitos internacionales: el ranking NACIONAL no los
 *    puntúa, así que no aparecen. Sin coeficiente, `compute.ts` deja la
 *    prueba a cero y lo explica; no le pone un 1,0 por defecto.
 */
const REGLAS_RANKING = [
  // Apartado 1.3: "RESULTADOS DE LAS 2 COMPETICIONES M13" -> 2 pruebas.
  // Apartado 4.1: el Cto. de España M13 individual es abierto -> 0 plazas.
  { categoria: 'M13' as const, pruebas: 2, porRanking: 0, tecnicas: 0 },
  { categoria: 'M15' as const, pruebas: 2, porRanking: 0, tecnicas: 0 },
  // "LOS 3 MEJORES RESULTADOS" en cadete y júnior; 2 en Sub23 y sénior.
  { categoria: 'M17' as const, pruebas: 3, porRanking: 38, tecnicas: 4 },
  { categoria: 'M20' as const, pruebas: 3, porRanking: 38, tecnicas: 4 },
  { categoria: 'M23' as const, pruebas: 2, porRanking: 38, tecnicas: 4 },
  { categoria: 'ABS' as const, pruebas: 2, porRanking: 38, tecnicas: 4 },
];

async function sembrarNormativaRanking(seasonId: string, autor: string | null) {
  // Se borra y se vuelve a escribir: la clave única lleva `weapon`, que aquí
  // es null, y en Postgres dos NULL no chocan, así que un upsert dejaría
  // duplicados en cada ejecución.
  // Se identifican por quién las puso: el perfil de demostración. No hay
  // ninguna marca en el texto porque el texto es una cita de la circular.
  // La bitácora se limpia aquí, antes de las dos siembras de normativa, para
  // que ejecutar el script tres veces no deje tres juegos de "cambios
  // recientes" iguales en el panel.
  if (autor) {
    await db.delete(rankingRule).where(eq(rankingRule.updatedByProfileId, autor));
    await db.delete(configChangeLog).where(eq(configChangeLog.changedByProfileId, autor));
  }

  for (const r of REGLAS_RANKING) {
    const [fila] = await db
      .insert(rankingRule)
      .values({
        seasonId,
        weapon: null,
        category: r.categoria,
        countingEvents: r.pruebas,
        /**
         * Apartado 1.2: coeficiente 1 en las competiciones nacionales de la
         * categoría y 1,25 en el Campeonato de España de la categoría. El
         * enum `circuit` no distingue el TNR júnior del sénior, así que el
         * 1,25 de "categoría inmediatamente superior" no se puede expresar.
         */
        coefficients: { TNR: 1, CTO_ESPANA: 1.25 },
        pointsTable: TABLA_PUNTOS_RFEE,
        rankingPlaces: r.porRanking,
        technicalPlaces: r.tecnicas,
        // La normativa no publica fecha de corte. Se queda sin poner.
        cutoffDate: null,
        sourceDocument: NORMATIVA_RANKINGS.documento,
        sourceUrl: NORMATIVA_RANKINGS.url,
        effectiveFrom: NORMATIVA_RANKINGS.publicado,
        updatedByProfileId: autor,
      })
      .returning({ id: rankingRule.id });

    await anotarCambio('ranking_rule', fila.id, { categoria: r.categoria }, autor);
  }

  console.log(`  ${REGLAS_RANKING.length} reglas de ranking (Normativa 26-27).`);
}

/**
 * Plazos y multas de inscripción de las competiciones NACIONALES.
 *
 * Fuentes:
 *  - Plazo ordinario: Circular 12-26 de gestión administrativa, punto 5:
 *    "el plazo de inscripción finaliza el viernes de la semana anterior a la
 *    competición a las 12:00 h". Lo repite el apartado 3.3.1 de la Normativa
 *    para Rankings Nacionales 26-27.
 *  - Multas: apartado 3.3.2 de la Normativa para Rankings Nacionales 26-27.
 *    "Límite 1: hasta el lunes anterior a las 23:59 ... INDIVIDUALES 5 € por
 *    tirador/a". "Límite 2: hasta el martes anterior a la competición a las
 *    23:59 ... INDIVIDUALES 30 € por tirador/a".
 *  - Cierre duro: apartado 3.3.4, "No se permitirá inscripción el día de la
 *    competición"; pasado el Límite 2 ya no se puede agregar a nadie.
 *
 * TRADUCCIÓN A `days_before`, que es lo único que sabe guardar el esquema:
 * la circular fija días de la semana, no un número de días. Los TNR y los
 * Campeonatos de España empiezan en sábado, así que el viernes de la semana
 * anterior son 8 días antes, el lunes anterior 5 y el martes anterior 4. Es
 * una traducción, no un dato publicado, y por eso queda escrita aquí.
 *
 * El importe de cada fila es el que se paga DESPUÉS de que venza ese hito,
 * que es como lo enuncia la interfaz ("después, +5 €" en `proximoHito` de
 * src/components/estado/inscripcion.tsx).
 */
const REGLAS_PLAZOS = [
  {
    tipo: 'L1' as const,
    etiqueta: 'Límite ordinario',
    dias: 8,
    recargo: '5.00',
    bloquea: false,
    doc: CIRCULAR_12_26,
  },
  {
    tipo: 'L2' as const,
    etiqueta: 'Segundo plazo',
    dias: 5,
    recargo: '30.00',
    bloquea: false,
    doc: NORMATIVA_RANKINGS,
  },
  {
    tipo: 'L3' as const,
    etiqueta: 'Tercer plazo',
    dias: 4,
    // Después del Límite 2 no hay más recargo: no se puede inscribir.
    recargo: null,
    bloquea: true,
    doc: NORMATIVA_RANKINGS,
  },
];

async function sembrarNormativaPlazos(seasonId: string, autor: string | null) {
  if (autor) {
    await db.delete(deadlineRule).where(eq(deadlineRule.updatedByProfileId, autor));
  }

  for (const r of REGLAS_PLAZOS) {
    const [fila] = await db
      .insert(deadlineRule)
      .values({
        seasonId,
        scope: 'NACIONAL',
        // Se aplican a cualquier circuito y categoría nacional: la circular no
        // distingue. Una regla más específica del admin ganaría a esta.
        circuit: null,
        category: null,
        type: r.tipo,
        label: r.etiqueta,
        daysBefore: r.dias,
        surchargeEur: r.recargo,
        blocking: r.bloquea,
        sourceDocument: r.doc.documento,
        sourceUrl: r.doc.url,
        effectiveFrom: r.doc.publicado,
        updatedByProfileId: autor,
      })
      .returning({ id: deadlineRule.id });

    await anotarCambio('deadline_rule', fila.id, { tipo: r.tipo, dias: r.dias }, autor);
  }

  console.log(`  ${REGLAS_PLAZOS.length} plazos nacionales (Circular 12-26 y Normativa 26-27).`);
}

// ------------------------------------------------- Resultados y ranking ---

/**
 * Empareja resultados REALES con las tiradoras de demostración que encajan.
 *
 * Es exactamente lo que hace a mano el admin en /admin/emparejar: poner
 * `athlete_id` en una fila que la fuente publicó sin licencia reconocible. Se
 * cogen unas pocas y el resto se queda sin emparejar, que es su estado
 * natural y lo que llena la cola del panel.
 *
 * Además se crea una inscripción `submitted` sobre esa misma prueba, porque
 * "Mi estado" solo enseña el puesto si hay inscripción Y resultado.
 */
async function emparejarResultadosReales(
  porNombre: Map<string, string>,
  autor: string | null,
): Promise<number> {
  const candidatas = TIRADORAS_M20.map((n) => porNombre.get(n)).filter(
    (id): id is string => Boolean(id),
  );
  if (candidatas.length === 0) return 0;

  /**
   * Primero se deshace lo de la ejecución anterior. Sin esto, la segunda vez
   * que se ejecuta el script se emparejan TRES FILAS NUEVAS con las mismas
   * tiradoras, cada una acaba con dos resultados en la misma prueba y el
   * cálculo del ranking revienta contra `ranking_point_key`. Los resultados
   * son reales: se desemparejan, no se borran.
   */
  await db
    .update(result)
    .set({ athleteId: null })
    .where(
      and(inArray(result.athleteId, candidatas), notLike(result.contentHash, 'demo-%')),
    );

  /**
   * Las filas reales de ESPADA / F / M20 que todavía no tienen tirador,
   * ordenadas por puesto. Se reparten separadas para que la tabla del ranking
   * no salga con tres puestos consecutivos.
   */
  const libres = await db
    .select({
      id: result.id,
      position: result.position,
      eventCompetitionId: result.eventCompetitionId,
    })
    .from(result)
    .innerJoin(eventCompetition, eq(eventCompetition.id, result.eventCompetitionId))
    .innerJoin(event, eq(event.id, eventCompetition.eventId))
    .where(
      and(
        isNull(result.athleteId),
        eq(eventCompetition.weapon, 'ESPADA'),
        eq(eventCompetition.gender, 'F'),
        eq(eventCompetition.category, 'M20'),
        eq(eventCompetition.format, 'INDIVIDUAL'),
        soloCanonicos(),
      ),
    )
    .orderBy(asc(result.position));

  const elegidas = [libres[1], libres[5], libres[14]].filter(Boolean);
  let emparejados = 0;

  for (const [i, fila] of elegidas.entries()) {
    const athleteId = candidatas[i % candidatas.length];
    await db.update(result).set({ athleteId }).where(eq(result.id, fila.id));
    emparejados += 1;

    if (!fila.eventCompetitionId) continue;

    const [creada] = await db
      .insert(entry)
      .values({
        athleteId,
        eventCompetitionId: fila.eventCompetitionId,
        status: 'submitted',
        requestedByProfileId: autor,
        requestedAt: new Date(Date.now() - 20 * 86_400_000),
        clubDecidedAt: new Date(Date.now() - 18 * 86_400_000),
        federationDecidedAt: new Date(Date.now() - 16 * 86_400_000),
        submittedAt: new Date(Date.now() - 15 * 86_400_000),
      })
      .onConflictDoNothing({ target: [entry.athleteId, entry.eventCompetitionId] })
      .returning({ id: entry.id });

    if (creada) {
      await db.insert(entryEventLog).values({
        entryId: creada.id,
        fromStatus: null,
        toStatus: 'submitted',
        actorProfileId: autor,
        actorLabel: 'demostración',
      });
    }
  }

  /**
   * NO se inventa ninguna otra prueba para engordar el desglose. En la
   * temporada 2026-2027 solo se ha celebrado UNA competición nacional hasta
   * hoy (el TNR M20 del 20 de septiembre), así que cada tiradora tiene una
   * sola prueba puntuable de las tres que permite la normativa. La suma que
   * enseña la pantalla es de verdad la suma; lo que no hay, no se rellena.
   */

  console.log(
    `  ${emparejados} resultados reales emparejados; el resto sigue en la cola ` +
      'de "por emparejar".',
  );
  return emparejados;
}

/** Recalcula el ranking con el mismo código que usaría la aplicación. */
async function calcularRanking(seasonId: string, hayResultados: boolean) {
  if (!hayResultados) return;
  const salida = await computeSeasonRanking({ seasonId, persist: true });
  if (!salida.ok) {
    console.log(`  Ranking no calculado: ${salida.reason ?? 'sin motivo'}`);
    return;
  }
  console.log(
    `  Ranking calculado: ${salida.groups.length} grupos, ` +
      `${salida.pointsWritten} puntos y ${salida.snapshotsWritten} puestos.`,
  );
}

// ------------------------------------------------------------ Convocatorias ---

/** Primera prueba futura que encaje, para colgar de ella una convocatoria. */
async function pruebaFutura(categoria: 'ABS' | 'M23' | 'M20', diasMinimos: number) {
  const desde = new Date(Date.now() + diasMinimos * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [fila] = await db
    .select({
      competitionId: eventCompetition.id,
      eventId: event.id,
      eventName: event.name,
      city: event.city,
      country: event.country,
      startDate: event.startDate,
    })
    .from(eventCompetition)
    .innerJoin(event, eq(event.id, eventCompetition.eventId))
    .where(
      and(
        eq(eventCompetition.weapon, 'ESPADA'),
        eq(eventCompetition.gender, 'F'),
        eq(eventCompetition.category, categoria),
        eq(eventCompetition.format, 'INDIVIDUAL'),
        eq(event.scope, 'INTERNACIONAL'),
        sql`${event.startDate} >= ${desde}`,
        eq(event.cancelled, false),
        soloCanonicos(),
      ),
    )
    .orderBy(asc(event.startDate))
    .limit(1);
  return fila ?? null;
}

/** Puesto real de una tiradora en el último ranking calculado, si lo tiene. */
async function puestoEnRanking(seasonId: string, athleteId: string) {
  const [fila] = await db
    .select({ position: rankingSnapshot.position })
    .from(rankingSnapshot)
    .where(
      and(
        eq(rankingSnapshot.seasonId, seasonId),
        eq(rankingSnapshot.athleteId, athleteId),
      ),
    )
    .orderBy(sql`${rankingSnapshot.computedAt} desc`)
    .limit(1);
  return fila?.position ?? null;
}

/**
 * Una convocatoria publicada y un borrador sin publicar.
 *
 * La publicada cuelga de una prueba internacional REAL que todavía no se ha
 * celebrado, con plazo de respuesta futuro y las tres respuestas posibles a
 * la vista. La tiradora con cuenta propia se queda PENDIENTE a propósito:
 * es la que permite enseñar el botón de confirmar en directo.
 */
async function sembrarConvocatorias(
  seasonId: string,
  porNombre: Map<string, string>,
  autor: string | null,
) {
  if (autor) {
    await db.delete(callUp).where(eq(callUp.createdByProfileId, autor));
  }

  const carla = porNombre.get('Carla Ordóñez Rivas');
  const sara = porNombre.get('Sara Fernández Lacalle');
  const marta = porNombre.get('Marta Vilanova Sedano');
  const ainhoa = porNombre.get('Ainhoa Etxebarria Lasa');

  const ahora = Date.now();
  const plazo = new Date(ahora + 6 * 86_400_000);

  // --- Publicada ---
  const prueba = await pruebaFutura('ABS', 10);
  if (prueba && carla && sara && marta) {
    const donde = [prueba.city, prueba.country].filter(Boolean).join(', ');
    const [conv] = await db
      .insert(callUp)
      .values({
        eventId: prueba.eventId,
        title: `Selección de espada femenina — ${titulo(prueba.eventName)}`,
        body:
          'Convocatoria de demostración. Las plazas por ranking salen del ' +
          'ranking nacional júnior de espada femenina calculado por la ' +
          'aplicación, con el puesto de cada tiradora anotado al lado. La ' +
          'plaza de criterio técnico la decide la dirección técnica y no ' +
          'depende del ranking.',
        travelNotes:
          'Viaje y alojamiento de demostración: nada de esto está contratado. ' +
          'Confirma o rechaza antes del plazo para que se pueda cerrar la ' +
          'lista.',
        published: true,
        publishedAt: new Date(ahora - 2 * 86_400_000),
        respondBy: plazo,
        createdByProfileId: autor,
      })
      .returning({ id: callUp.id });

    const convocadas = [
      {
        athleteId: sara,
        placeType: 'ranking' as const,
        status: 'confirmado' as const,
        respondedAt: new Date(ahora - 86_400_000),
        rejectionReason: null,
      },
      {
        athleteId: marta,
        placeType: 'ranking' as const,
        status: 'rechazado' as const,
        respondedAt: new Date(ahora - 43_200_000),
        rejectionReason:
          'Lesión en el codo del brazo armado. Parte médico entregado a la ' +
          'dirección técnica (dato de demostración).',
      },
      {
        // La tiradora con cuenta propia, sin responder: es la que se usa para
        // enseñar el botón "Confirmar que voy" delante de la gente.
        athleteId: carla,
        placeType: 'tecnica' as const,
        status: 'pendiente' as const,
        respondedAt: null,
        rejectionReason: null,
      },
    ];

    for (const c of convocadas) {
      await db.insert(callUpAthlete).values({
        callUpId: conv.id,
        athleteId: c.athleteId,
        eventCompetitionId: prueba.competitionId,
        placeType: c.placeType,
        // Solo se anota el puesto cuando existe de verdad. Para la plaza
        // técnica no hay puesto que anotar, y no se pone uno cualquiera.
        rankingPositionAtCutoff:
          c.placeType === 'ranking' ? await puestoEnRanking(seasonId, c.athleteId) : null,
        status: c.status,
        respondedAt: c.respondedAt,
        rejectionReason: c.rejectionReason,
        respondBy: plazo,
        notifiedAt: new Date(ahora - 2 * 86_400_000),
      });
    }

    console.log(
      `  1 convocatoria publicada a «${prueba.eventName}» (${donde}, ` +
        `${prueba.startDate}) con 3 convocadas.`,
    );
  } else {
    console.log('  AVISO: no se encontró prueba futura para la convocatoria publicada.');
  }

  // --- Borrador sin publicar ---
  const borradorPrueba = await pruebaFutura('M23', 10);
  if (borradorPrueba && ainhoa) {
    const [borrador] = await db
      .insert(callUp)
      .values({
        eventId: borradorPrueba.eventId,
        title: `Selección Sub-23 de espada femenina — ${titulo(borradorPrueba.eventName)}`,
        body:
          'Borrador de demostración: todavía no se ha publicado, así que no lo ' +
          've ninguna tiradora. Sirve para enseñar el flujo de "Publicar y ' +
          'avisar" de la dirección técnica.',
        published: false,
        publishedAt: null,
        respondBy: new Date(ahora + 14 * 86_400_000),
        createdByProfileId: autor,
      })
      .returning({ id: callUp.id });

    await db.insert(callUpAthlete).values({
      callUpId: borrador.id,
      athleteId: ainhoa,
      eventCompetitionId: borradorPrueba.competitionId,
      placeType: 'ranking',
      rankingPositionAtCutoff: await puestoEnRanking(seasonId, ainhoa),
      status: 'pendiente',
      respondBy: new Date(ahora + 14 * 86_400_000),
    });

    console.log(`  1 borrador sin publicar a «${borradorPrueba.eventName}».`);
  } else {
    console.log('  AVISO: no se encontró prueba futura para el borrador.');
  }
}

/**
 * Borra TODO lo de demostración, en el orden que respeta las claves ajenas.
 *
 * Nada se busca por el texto que se ve en pantalla: los nombres de las
 * personas y del club son nombres normales a propósito. Lo que se sigue es la
 * cadena de marcas invisibles:
 *
 *   correo `@demo.local` -> perfiles  ->  club de demostración -> tiradores
 *                                     ->  convocatorias, normativa y bitácora
 *
 * Hay dos sutilezas que la primera versión se dejaba y que importan:
 *
 *  1. Los `result` EMPAREJADOS son filas REALES ingeridas de Skermo. Borrarlas
 *     porque apuntan a un tirador de demostración sería destruir datos de
 *     verdad. Se les quita el `athlete_id` y vuelven a la cola de "por
 *     emparejar", que es exactamente el estado en el que estaban.
 *  2. Las convocatorias y la normativa no cuelgan de ningún tirador, así que
 *     no caen en cascada: se borran por el perfil que las creó, y ANTES de
 *     borrar los perfiles (si no, la clave ajena se pone a null y se pierde
 *     el rastro).
 */
export async function borrarDemo() {
  const perfilesDemo = await db
    .select({ id: userProfile.id })
    .from(userProfile)
    .where(like(userProfile.email, `%${SUFIJO_CORREO}`));
  const idsPerfiles = perfilesDemo.map((p) => p.id);

  const clubesDemo = await db
    .select({ id: club.id })
    .from(club)
    .where(like(club.contactEmail, `%${SUFIJO_CORREO}`));
  const idsClubes = clubesDemo.map((c) => c.id);

  const tiradoresDemo =
    idsClubes.length > 0
      ? await db
          .select({ id: athlete.id })
          .from(athlete)
          .where(inArray(athlete.clubId, idsClubes))
      : [];
  const idsTiradores = tiradoresDemo.map((t) => t.id);

  // --- Lo que cuelga de un perfil de demostración ---
  let convocatorias = 0;
  let normativa = 0;
  if (idsPerfiles.length > 0) {
    const cu = await db
      .delete(callUp)
      .where(inArray(callUp.createdByProfileId, idsPerfiles))
      .returning({ id: callUp.id });
    convocatorias = cu.length;

    const rr = await db
      .delete(rankingRule)
      .where(inArray(rankingRule.updatedByProfileId, idsPerfiles))
      .returning({ id: rankingRule.id });
    const dr = await db
      .delete(deadlineRule)
      .where(inArray(deadlineRule.updatedByProfileId, idsPerfiles))
      .returning({ id: deadlineRule.id });
    normativa = rr.length + dr.length;

    await db
      .delete(configChangeLog)
      .where(inArray(configChangeLog.changedByProfileId, idsPerfiles));
  }

  // --- Lo que cuelga de un tirador de demostración ---
  let desemparejados = 0;
  if (idsTiradores.length > 0) {
    await db.delete(callUpAthlete).where(inArray(callUpAthlete.athleteId, idsTiradores));
    await db.delete(rankingPoint).where(inArray(rankingPoint.athleteId, idsTiradores));
    await db.delete(rankingSnapshot).where(inArray(rankingSnapshot.athleteId, idsTiradores));

    // Los resultados REALES solo se desemparejan; los de demostración (si
    // algún día se crean) llevan el hash con prefijo `demo-` y sí se borran.
    const sueltos = await db
      .update(result)
      .set({ athleteId: null })
      .where(
        and(
          inArray(result.athleteId, idsTiradores),
          notLike(result.contentHash, 'demo-%'),
        ),
      )
      .returning({ id: result.id });
    desemparejados = sueltos.length;

    await db
      .delete(result)
      .where(
        and(
          inArray(result.athleteId, idsTiradores),
          like(result.contentHash, 'demo-%'),
        ),
      );

    // `entry_event_log` cae solo por la clave ajena en cascada.
    await db.delete(entry).where(inArray(entry.athleteId, idsTiradores));
    await db.delete(athleteWeapon).where(inArray(athleteWeapon.athleteId, idsTiradores));
    await db.delete(athlete).where(inArray(athlete.id, idsTiradores));
  }

  if (idsPerfiles.length > 0) {
    await db.delete(profileWeapon).where(inArray(profileWeapon.profileId, idsPerfiles));
    await db.delete(userProfile).where(inArray(userProfile.id, idsPerfiles));
  }

  if (idsClubes.length > 0) {
    await db.delete(club).where(inArray(club.id, idsClubes));
  }

  console.log(
    `Borrados: ${idsTiradores.length} tiradores, ${idsPerfiles.length} perfiles, ` +
      `${idsClubes.length} clubes, ${convocatorias} convocatorias y ` +
      `${normativa} reglas de normativa de demostración.`,
  );
  console.log(
    `Devueltos a la cola de "por emparejar": ${desemparejados} resultados reales.`,
  );
  console.log(
    'Los usuarios de autenticación quedan en el esquema neon_auth (lo gestiona ' +
      'Neon); se reconocen por el dominio @demo.local.',
  );
}

if (process.argv.includes('--borrar')) {
  await borrarDemo();
  process.exit(0);
}

await main();
process.exit(0);
