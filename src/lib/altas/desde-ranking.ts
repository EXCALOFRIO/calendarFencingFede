import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  athlete,
  athleteWeapon,
  club,
  officialRankingEntry,
  userProfile,
} from '@/db/schema';
import { titular, yearFromIsoDate } from '@/lib/utils';
import { ACENTOS, LLANOS, normalizarLicencia, sinAcentos } from './texto';

/**
 * Alta de un tirador a partir del ranking oficial de la RFEE.
 *
 * Es el único sitio donde se crea una ficha con los datos de Skermo, y lo usan
 * las dos puertas que existen: la pantalla `/alta`, que es la que ve una
 * persona, y `scripts/alta-desde-ranking.ts`, que es la que usa la dirección
 * técnica desde la línea de órdenes. Estaban separadas y esto las une a
 * propósito: si la regla de negocio vive en dos sitios, en un mes hacen cosas
 * distintas.
 *
 * -------------------------------------------------------------------------
 * LOS DATOS NO LOS TECLEA NADIE
 * -------------------------------------------------------------------------
 * Nombre, apellidos, fecha de nacimiento, club, arma, género y licencia salen
 * de la fila de `official_ranking_entry`, que es una copia fiel de lo que
 * publica `app.skermo.org/ranking-rfee/public/RFEE`. Lo único que teclea la
 * persona es su número de licencia, y no para guardarlo: para demostrar que la
 * fila es suya.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ LA LICENCIA ES LA PRUEBA DE IDENTIDAD
 * -------------------------------------------------------------------------
 * La tabla del ranking publica puesto, nombre, fecha de nacimiento, club y
 * puntos — pero **no la licencia** (eso lo dice el comentario del esquema y es
 * la razón de que `source_license` se rellene a posteriori, ficha a ficha).
 * Así que el número de licencia es algo que el tirador lleva en su carné y que
 * no se puede leer de la pantalla pública del ranking. Para una aplicación de
 * veinte personas de la selección, eso es una prueba de identidad razonable.
 *
 * Lo que NO es: un secreto criptográfico. Quien conozca la licencia de otro
 * puede reclamar su ficha. De ahí los dos límites de abajo —una ficha por
 * cuenta y una cuenta por ficha— y el contador de intentos: rebotan el caso
 * fácil (probar a ver si suena) sin fingir que esto es autenticación fuerte.
 */

export type Arma = 'FLORETE' | 'ESPADA' | 'SABLE';
export type Genero = 'M' | 'F' | 'MIXTO';

/** Un tirador dentro de un ranking concreto: su puesto y sus puntos. */
export type ClasificacionOficial = {
  temporada: string;
  arma: Arma;
  genero: Genero;
  categoria: string;
  /** Literal de la fuente: «VET50» se normaliza a VET y aquí queda el original. */
  categoriaOriginal: string;
  /** `null` si todavía no está clasificado (Skermo lo marca 9999). */
  puesto: number | null;
  puntos: number | null;
  urlFuente: string | null;
};

/**
 * Un resultado de la búsqueda.
 *
 * Trae **todo lo que hace falta para distinguir a dos homónimos** —arma,
 * género, categoría, club, año de nacimiento y puesto— y nada más. En concreto
 * NO trae la licencia: si la trajera, el dato que sirve de prueba viajaría al
 * navegador de cualquiera que escriba un apellido y la comprobación del paso
 * siguiente no valdría nada.
 */
export type Candidato = {
  /** Clave estable del tirador en Skermo. No es la licencia. */
  clave: string;
  /** Nombre en forma de título: la fuente lo publica en MAYÚSCULAS. */
  nombre: string;
  /** Nombre y apellidos por separado, que es como los publica la fuente. */
  nombrePila: string;
  apellidos: string;
  /** El nombre tal y como lo publica la fuente, para poder auditarlo. */
  nombreOficial: string;
  anioNacimiento: number | null;
  club: string | null;
  /** Todas sus clasificaciones: puede estar en absoluto y en sub-23, o en dos armas. */
  clasificaciones: ClasificacionOficial[];
  armas: Arma[];
  /** La fuente no ha resuelto su licencia todavía: no se puede comprobar nada. */
  sinLicencia: boolean;
  /** Ya hay una ficha con esa licencia colgada de una cuenta. */
  yaVinculado: boolean;
};

export type MotivoRechazo =
  | 'YA_TIENES_FICHA'
  | 'NO_ENCONTRADO'
  | 'SIN_LICENCIA_EN_LA_FUENTE'
  | 'LICENCIA_NO_COINCIDE'
  | 'YA_VINCULADO'
  | 'DEMASIADOS_INTENTOS';

export type Alta = {
  atletaId: string;
  nombre: string;
  licencia: string;
  club: string | null;
  fechaNacimiento: string;
  armas: Arma[];
  clasificaciones: ClasificacionOficial[];
  /** Cuántas filas del ranking oficial han quedado apuntando a la ficha. */
  filasEmparejadas: number;
};

export type ResultadoAlta =
  | { ok: true; alta: Alta }
  | { ok: false; motivo: MotivoRechazo; error: string };

/** El nombre de la fuente, en minúsculas y sin acentos, dentro de la consulta. */
const NOMBRE_LLANO = sql`lower(translate(${officialRankingEntry.sourceAthleteName}, ${ACENTOS}, ${LLANOS}))`;

/** Mínimo de letras para buscar por nombre. Con una sale media federación. */
const MINIMO_NOMBRE = 3;

/**
 * Busca en el ranking oficial por nombre o por número de licencia.
 *
 * Por licencia la comparación es EXACTA y no por prefijo, a propósito: con
 * prefijos, este buscador sería una forma de ir adivinando licencias ajenas
 * letra a letra. Por nombre se exige que aparezcan todas las palabras
 * tecleadas, que es lo que hace útil escribir «maria mariño» cuando la fuente
 * publica «MARIA MARIÑO BLANCO».
 */
export async function buscarCandidatos(
  texto: string,
  tope = 8,
): Promise<Candidato[]> {
  const limpio = texto.trim();
  if (limpio.length === 0) return [];

  const palabras = sinAcentos(limpio).split(/\s+/).filter(Boolean);
  const licencia = normalizarLicencia(limpio);

  const porNombre =
    sinAcentos(limpio).replace(/\s+/g, '').length >= MINIMO_NOMBRE
      ? and(...palabras.map((p) => sql`${NOMBRE_LLANO} like ${`%${p}%`}`))
      : undefined;

  const porLicencia = sql`upper(${officialRankingEntry.sourceLicense}) = ${licencia}`;

  const filas = await db
    .select({
      clave: officialRankingEntry.skermoAthleteId,
      nombre: officialRankingEntry.sourceAthleteName,
      nombrePila: officialRankingEntry.sourceFirstName,
      apellidos: officialRankingEntry.sourceLastName,
      licencia: officialRankingEntry.sourceLicense,
      nacimiento: officialRankingEntry.sourceBirthDate,
      clubFuente: officialRankingEntry.sourceClub,
      temporada: officialRankingEntry.seasonLabel,
      arma: officialRankingEntry.weapon,
      genero: officialRankingEntry.gender,
      categoria: officialRankingEntry.category,
      categoriaOriginal: officialRankingEntry.categoryRaw,
      puesto: officialRankingEntry.position,
      puntos: officialRankingEntry.totalPoints,
      urlFuente: officialRankingEntry.sourceUrl,
    })
    .from(officialRankingEntry)
    .where(porNombre ? or(porLicencia, porNombre) : porLicencia)
    // Por nombre, para que agrupar sea estable; el puesto ordena dentro.
    .orderBy(
      officialRankingEntry.sourceAthleteName,
      sql`${officialRankingEntry.position} asc nulls last`,
    )
    // Un apellido muy común son unas pocas decenas de filas. El tope está para
    // que teclear «ma» no se traiga la tabla entera, no para recortar a nadie.
    .limit(240);

  if (filas.length === 0) return [];

  const porTirador = new Map<string, typeof filas>();
  for (const f of filas) {
    // Sin id de Skermo no hay clave estable; se cae a la licencia y, en último
    // término, al nombre. Hoy no pasa (las 1.235 filas lo traen), pero la fila
    // sin id no puede tumbar la búsqueda entera.
    const clave = f.clave ?? f.licencia ?? f.nombre;
    const lista = porTirador.get(clave) ?? [];
    lista.push(f);
    porTirador.set(clave, lista);
  }

  const elegidos = [...porTirador.entries()].slice(0, tope);

  /**
   * ¿Alguna de estas fichas tiene ya dueño? Se comprueba aquí y no al
   * confirmar para poder decirlo en la propia lista: enterarse de que la ficha
   * es de otro después de teclear la licencia es el peor momento posible.
   */
  const licencias = elegidos
    .map(([, lista]) => lista.find((f) => f.licencia)?.licencia)
    .filter((l): l is string => Boolean(l));

  const vinculadas = new Set<string>();
  if (licencias.length > 0) {
    const fichas = await db
      .select({
        rfeeLicense: athlete.rfeeLicense,
        userProfileId: athlete.userProfileId,
        guardianProfileId: athlete.guardianProfileId,
      })
      .from(athlete)
      .where(inArray(athlete.rfeeLicense, licencias));
    for (const f of fichas) {
      if (!f.rfeeLicense) continue;
      if (f.userProfileId || f.guardianProfileId) {
        vinculadas.add(normalizarLicencia(f.rfeeLicense));
      }
    }
  }

  return elegidos.map(([clave, lista]) => {
    const primera = lista[0];
    const licenciaFila = lista.find((f) => f.licencia)?.licencia ?? null;

    return {
      clave,
      nombre: nombreCompleto(primera),
      nombrePila: titular(primera.nombrePila?.trim() || ''),
      apellidos: titular(primera.apellidos?.trim() || ''),
      nombreOficial: primera.nombre,
      anioNacimiento: primera.nacimiento
        ? yearFromIsoDate(primera.nacimiento)
        : null,
      club: primera.clubFuente,
      armas: [...new Set(lista.map((f) => f.arma))],
      clasificaciones: lista.map(aClasificacion),
      sinLicencia: licenciaFila === null,
      yaVinculado: licenciaFila
        ? vinculadas.has(normalizarLicencia(licenciaFila))
        : false,
    };
  });
}

/**
 * Intentos fallidos de licencia por cuenta.
 *
 * Vive en memoria del proceso a propósito: no hace falta tabla para frenar a
 * quien prueba licencias a mano, y el coste de una tabla nueva (migración,
 * limpieza, otro sitio donde mirar) no se paga con lo que da. La contrapartida
 * es honesta y hay que decirla: con varias instancias del servidor, cada una
 * lleva su cuenta, y al reiniciar se olvida. Frena a una persona probando, no
 * a un guion decidido.
 */
const INTENTOS = new Map<string, { fallos: number; desde: number }>();
const VENTANA_MS = 10 * 60 * 1000;
const MAX_FALLOS = 5;

function intentosAgotados(profileId: string): boolean {
  const registro = INTENTOS.get(profileId);
  if (!registro) return false;
  if (Date.now() - registro.desde > VENTANA_MS) {
    INTENTOS.delete(profileId);
    return false;
  }
  return registro.fallos >= MAX_FALLOS;
}

function apuntarFallo(profileId: string): void {
  const registro = INTENTOS.get(profileId);
  if (!registro || Date.now() - registro.desde > VENTANA_MS) {
    INTENTOS.set(profileId, { fallos: 1, desde: Date.now() });
    return;
  }
  registro.fallos += 1;
}

/**
 * Vincula la ficha de un tirador del ranking oficial a una cuenta.
 *
 * Devuelve el motivo del rechazo como código, no solo como frase: la pantalla
 * necesita distinguir «esa licencia no es» de «esa ficha ya tiene dueño» para
 * decir qué hacer en cada caso, y el guion de la línea de órdenes también.
 */
export async function vincularFichaDesdeRanking({
  profileId,
  clave,
  licencia,
  origen,
}: {
  profileId: string;
  /** La `clave` de un `Candidato` (el id del tirador en Skermo). */
  clave: string;
  /**
   * La prueba de identidad. **Obligatoria en el autoservicio** y ausente en el
   * guion: quien ejecuta `scripts/alta-desde-ranking.ts` es la dirección
   * técnica, que ya es la autoridad que da de alta a la gente y no tiene por
   * qué conocer la licencia de nadie. Pedírsela sería teatro.
   */
  licencia?: string;
  /**
   * De dónde viene el alta. Cambia la nota que queda en la ficha —para que en
   * `/admin/usuarios` se vea que no la creó la dirección técnica— y, solo en el
   * guion de demostración, deja el consentimiento firmado.
   */
  origen: 'autoservicio' | 'guion';
}): Promise<ResultadoAlta> {
  /**
   * Una ficha por cuenta. No es una limitación técnica: si una cuenta ya
   * gestiona un tirador, «búscate en el ranking» no es lo que necesita, y
   * dejarla reclamar una segunda ficha convierte esta pantalla en la forma
   * cómoda de colgarse la ficha de otro.
   */
  const [suya] = await db
    .select({ id: athlete.id, nombre: athlete.firstName })
    .from(athlete)
    .where(
      and(
        eq(athlete.active, true),
        or(
          eq(athlete.userProfileId, profileId),
          eq(athlete.guardianProfileId, profileId),
        ),
      ),
    )
    .limit(1);

  if (suya) {
    return {
      ok: false,
      motivo: 'YA_TIENES_FICHA',
      error:
        'Tu cuenta ya tiene una ficha de tirador vinculada, así que no hay ' +
        'nada que dar de alta. Si la ficha no es la que te corresponde, ' +
        'escribe a la dirección técnica: cambiarla no es algo que deba poder ' +
        'hacer uno mismo.',
    };
  }

  if (intentosAgotados(profileId)) {
    return {
      ok: false,
      motivo: 'DEMASIADOS_INTENTOS',
      error:
        `Has fallado la licencia ${MAX_FALLOS} veces. Espera diez minutos y ` +
        'vuelve a intentarlo, o pide a la dirección técnica que te vincule la ' +
        'ficha; tardan menos que tú adivinando.',
    };
  }

  const filas = await db
    .select({
      nombre: officialRankingEntry.sourceAthleteName,
      nombrePila: officialRankingEntry.sourceFirstName,
      apellidos: officialRankingEntry.sourceLastName,
      licencia: officialRankingEntry.sourceLicense,
      nacimiento: officialRankingEntry.sourceBirthDate,
      clubFuente: officialRankingEntry.sourceClub,
      temporada: officialRankingEntry.seasonLabel,
      arma: officialRankingEntry.weapon,
      genero: officialRankingEntry.gender,
      categoria: officialRankingEntry.category,
      categoriaOriginal: officialRankingEntry.categoryRaw,
      puesto: officialRankingEntry.position,
      puntos: officialRankingEntry.totalPoints,
      urlFuente: officialRankingEntry.sourceUrl,
    })
    .from(officialRankingEntry)
    .where(eq(officialRankingEntry.skermoAthleteId, clave))
    .orderBy(sql`${officialRankingEntry.position} asc nulls last`);

  if (filas.length === 0) {
    return {
      ok: false,
      motivo: 'NO_ENCONTRADO',
      error:
        'Esa fila del ranking ya no está. Vuelve a buscarte: la clasificación ' +
        'oficial se relee cada noche y puede haber cambiado.',
    };
  }

  const licenciaOficial = filas.find((f) => f.licencia)?.licencia ?? null;

  if (!licenciaOficial) {
    return {
      ok: false,
      motivo: 'SIN_LICENCIA_EN_LA_FUENTE',
      error:
        'De esta fila todavía no tenemos el número de licencia, así que no hay ' +
        'nada con lo que comprobar que eres tú, ni con qué emparejar el resto ' +
        'de tus clasificaciones. Pídele la vinculación a la dirección técnica.',
    };
  }

  if (
    origen === 'autoservicio' &&
    normalizarLicencia(licenciaOficial) !== normalizarLicencia(licencia ?? '')
  ) {
    apuntarFallo(profileId);
    return {
      ok: false,
      motivo: 'LICENCIA_NO_COINCIDE',
      error:
        'Esa licencia no es la de esta ficha. Mírala en tu carné de la RFEE: ' +
        'son tres letras y cinco cifras, con la forma ABC01234. Comprueba ' +
        'también que has elegido la fila que te corresponde, que puede haber ' +
        'homónimos.',
    };
  }

  const primera = filas[0];

  // La fecha de nacimiento es obligatoria en la ficha y la fuente la publica
  // siempre. Si algún día faltase, se dice; no se inventa un 1900-01-01.
  if (!primera.nacimiento) {
    return {
      ok: false,
      motivo: 'SIN_LICENCIA_EN_LA_FUENTE',
      error:
        'La clasificación oficial no publica tu fecha de nacimiento, y sin ella ' +
        'no se puede derivar tu categoría. Pídele la vinculación a la dirección ' +
        'técnica.',
    };
  }

  /**
   * ¿Existe ya una ficha con esa licencia? Puede pasar de dos formas: la creó
   * la dirección técnica y está libre (entonces se adopta, no se duplica: la
   * licencia es única en `athlete`), o ya tiene dueño (entonces rebota).
   */
  const [existente] = await db
    .select({
      id: athlete.id,
      userProfileId: athlete.userProfileId,
      guardianProfileId: athlete.guardianProfileId,
      notes: athlete.notes,
    })
    .from(athlete)
    .where(sql`upper(${athlete.rfeeLicense}) = ${normalizarLicencia(licenciaOficial)}`)
    .limit(1);

  if (
    existente &&
    (existente.userProfileId !== null || existente.guardianProfileId !== null)
  ) {
    return {
      ok: false,
      motivo: 'YA_VINCULADO',
      error:
        'Esa ficha ya está vinculada a otra cuenta. Si crees que la cuenta es ' +
        'tuya, entra con ella; si no, escribe a la dirección técnica para que ' +
        'lo revise. Desde aquí no se le quita una ficha a nadie.',
    };
  }

  const nombrePila = titular(primera.nombrePila?.trim() || '');
  const apellidos = titular(primera.apellidos?.trim() || '');
  const nombre = `${nombrePila} ${apellidos}`.trim() || titular(primera.nombre);

  /**
   * El club se crea si no existe, con el código tal y como lo publica Skermo:
   * `FED-M-C` no es un nombre bonito, pero es el que permite cruzarlo después.
   * No se traduce ni se adorna.
   */
  const clubId = await clubDe(primera.clubFuente);

  const nota =
    origen === 'autoservicio'
      ? 'Alta de autoservicio: la persona se identificó con su número de ' +
        'licencia en /alta y los datos salen del ranking oficial de la RFEE. ' +
        'No la creó la dirección técnica.'
      : 'Alta creada a partir del ranking oficial de la RFEE con ' +
        'scripts/alta-desde-ranking.ts.';

  const atletaId =
    existente?.id ??
    (
      await db
        .insert(athlete)
        .values({
          firstName: nombrePila || nombre,
          lastName: apellidos,
          birthDate: primera.nacimiento,
          gender: primera.genero === 'F' ? 'F' : 'M',
          clubId,
          rfeeLicense: normalizarLicencia(licenciaOficial),
          /**
           * Ni fecha de caducidad de licencia ni consentimiento: la fuente no
           * publica ninguno de los dos y ponerlos sería inventarlos. Salen en
           * «Qué te falta» de `/estado`, que es donde tienen que salir.
           */
          consentSignedAt: origen === 'guion' ? new Date() : null,
          userProfileId: profileId,
          notes: nota,
        })
        .returning({ id: athlete.id })
    )[0].id;

  if (existente) {
    await db
      .update(athlete)
      .set({
        userProfileId: profileId,
        clubId,
        notes: existente.notes ? `${existente.notes} ${nota}` : nota,
        updatedAt: new Date(),
      })
      .where(eq(athlete.id, atletaId));
  }

  /**
   * Las armas, que es lo que determina todo lo que ve en el calendario. Van
   * TODAS las de sus filas del ranking: quien puntúa en florete y en espada
   * compite en las dos, y dejarle una sola le esconde medio calendario.
   */
  const armas = [...new Set(filas.map((f) => f.arma))];
  await db
    .insert(athleteWeapon)
    .values(armas.map((arma) => ({ athleteId: atletaId, weapon: arma })))
    .onConflictDoNothing();

  /**
   * Emparejar TODAS sus filas del ranking, no solo la que se buscó. Un tirador
   * puede estar en absoluto y en sub-23, o en dos armas. Se empareja por
   * licencia, nunca por nombre: hay homónimos y los acentos van a su aire.
   */
  const emparejadas = await db
    .update(officialRankingEntry)
    .set({ athleteId: atletaId, updatedAt: new Date() })
    .where(
      and(
        sql`upper(${officialRankingEntry.sourceLicense}) = ${normalizarLicencia(licenciaOficial)}`,
        isNull(officialRankingEntry.athleteId),
      ),
    )
    .returning({ id: officialRankingEntry.id });

  /**
   * El club en la cuenta, solo si no tenía ninguno y solo para tiradores y
   * tutores: a un seleccionador o a la dirección técnica el club no les cambia
   * lo que ven, pero tampoco hace falta tocárselo.
   */
  if (clubId) {
    await db
      .update(userProfile)
      .set({ clubId, updatedAt: new Date() })
      .where(
        and(
          eq(userProfile.id, profileId),
          isNull(userProfile.clubId),
          or(eq(userProfile.role, 'athlete'), eq(userProfile.role, 'guardian')),
        ),
      );
  }

  INTENTOS.delete(profileId);

  return {
    ok: true,
    alta: {
      atletaId,
      nombre,
      licencia: normalizarLicencia(licenciaOficial),
      club: primera.clubFuente,
      fechaNacimiento: primera.nacimiento,
      armas,
      clasificaciones: filas.map(aClasificacion),
      filasEmparejadas: emparejadas.length,
    },
  };
}

/** Busca el club por el código de la fuente y lo crea si no existe. */
async function clubDe(nombreFuente: string | null): Promise<string | null> {
  if (!nombreFuente) return null;

  const [existente] = await db
    .select({ id: club.id })
    .from(club)
    .where(eq(club.name, nombreFuente))
    .limit(1);

  if (existente) return existente.id;

  const [creado] = await db
    .insert(club)
    .values({ name: nombreFuente })
    .returning({ id: club.id });
  return creado.id;
}

type FilaRanking = {
  temporada: string;
  arma: Arma;
  genero: Genero;
  categoria: string;
  categoriaOriginal: string;
  puesto: number | null;
  puntos: string | null;
  urlFuente: string | null;
};

function aClasificacion(fila: FilaRanking): ClasificacionOficial {
  return {
    temporada: fila.temporada,
    arma: fila.arma,
    genero: fila.genero,
    categoria: fila.categoria,
    categoriaOriginal: fila.categoriaOriginal,
    puesto: fila.puesto,
    puntos: fila.puntos === null ? null : Number.parseFloat(fila.puntos),
    urlFuente: fila.urlFuente,
  };
}

/**
 * Nombre en forma de título.
 *
 * Skermo publica «CARLOS LLAVADOR FERNANDEZ» y se guarda «Carlos Llavador
 * Fernandez», que es como se escribe un nombre. El original queda intacto en la
 * fila del ranking, que no se toca.
 */
function nombreCompleto(fila: {
  nombre: string;
  nombrePila: string | null;
  apellidos: string | null;
}): string {
  const pila = titular(fila.nombrePila?.trim() || '');
  const apellidos = titular(fila.apellidos?.trim() || '');
  return `${pila} ${apellidos}`.trim() || titular(fila.nombre);
}
